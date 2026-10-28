import {describe,it,expect} from 'vitest';
import {createDispatch} from '../../src/tools/dispatch.js';
import {registry} from '../../src/tools/index.js';
import * as g from '../../src/tools/universal-graphql.js';
import {inspectGraphql,githubGraphqlSchema} from '../../src/github/graphql-schema.js';
import {classifyGraphqlMutation,relevantGraphqlNodeId} from '../../src/github/mutation-classes.js';
import {makeWorld,parse,runWriteContract} from '../../test/helpers/write-contract.js';

const query='query OwnerRepo($owner: String!, $name: String!) { repository(owner:$owner, name:$name) { nameWithOwner } }';
const queryArgs={query,variables:{owner:'example-org',name:'hello'}};
// Legacy (no reviewed spec) title-change shape. updateDiscussion now has a Y-2 spec; updateProjectV2 does not.
const doc='mutation UpdateProject($input: UpdateProjectV2Input!) { updateProjectV2(input:$input) { projectV2 { id title } } }';
const changes={projectId:'PVT_kwDO12345',title:'New approved title'};
const writeArgs={mutation:doc,variables:{input:changes},owner:'example-org',repo:'hello'};
const node=(title)=>({__typename:'ProjectV2',id:changes.projectId,title,owner:{login:'example-org'}});
const reply=(body)=>({status:200,body:{data:body}});
async function dispatch(w,name,args) {
  return createDispatch({credentials:w.credentials,fetch:w.gh.fetch,gates:w.ctx.gates,now:w.ctx.now,sleep:w.ctx.sleep})
    .call(null,{registry,name,args,connection:w.connection,db:w.db});
}
function stubMutation(gh,outcome) {
  gh.when('POST /graphql').replySequence([
    reply({node:node('Earlier title')}),
    reply({updateProjectV2:{projectV2:{id:changes.projectId,title:changes.title}}}),
    reply({node:node(outcome==='mismatch'?'Earlier title':changes.title)})
  ]);
}
describe('U-2 pinned GraphQL schema, AST and cost',()=>{
  it('registers exactly two connected tools with their original read/full-only contracts',()=>{
    expect(g.tools.map(x=>x.name)).toEqual(['github_graphql_read','github_graphql_write']);
    expect(g.tools[1].writeContract).toBe('defineWrite-v1');
    expect(g.tools[1].profiles).toEqual(['full']);
    for(const tool of g.tools)expect(registry.tools.find(x=>x.name===tool.name)).toBeTruthy();
    expect(githubGraphqlSchema().getMutationType().getFields().mergePullRequest).toBeTruthy();
    expect(inspectGraphql(g.SCOPE_QUERY,{id:'D_kgDO12345'},'query').operation.operation).toBe('query');
    expect(inspectGraphql(g.PROJECT_FIELD_QUERY,{itemId:'PV2_ITEM',fieldName:'Status'},'query').operation.operation).toBe('query');
  });
  it('validates names, variables and parsed document using real pinned GraphQL schema',()=>{
    expect(inspectGraphql(query,queryArgs.variables).points).toBeGreaterThanOrEqual(1);
    expect(()=>inspectGraphql('query{repository(owner:"example-org",name:"hello"){fieldThatDoesNotExist}}')).toThrow(/Cannot query field/);
    expect(()=>inspectGraphql('query {',{})).toThrow(/syntax/);
    expect(()=>inspectGraphql(query,{...queryArgs.variables,extra:9})).toThrow(/undeclared/);
    expect(()=>inspectGraphql(query,{owner:'example-org'})).toThrow(/name/);
    expect(()=>inspectGraphql(query,{owner:42,name:'hello'})).toThrow(/String/);
    expect(()=>inspectGraphql('query A{viewer{login}} query B{viewer{login}}')).toThrow(/exactly one operation/);
  });
  it('refuses a mutation on the read path including aliases, fragments and unused operations',()=>{
    const mutation='mutation Mutate($input: MergePullRequestInput!){renamed:mergePullRequest(input:$input){pullRequest{id}}}';
    const vals={input:{pullRequestId:'PR_123'}};
    expect(()=>inspectGraphql(mutation,vals,'query')).toThrow(/cannot contain another operation type/);
    const viaFragment='mutation M($input: MergePullRequestInput!){...Parts} fragment Parts on Mutation { alias:mergePullRequest(input:$input){pullRequest{id}} }';
    const p=inspectGraphql(viaFragment,vals,'mutation');
    expect(p.mutation).toBe('mergePullRequest');
    expect(()=>classifyGraphqlMutation(p.mutation,p.input)).toThrow(/github_pr_merge/);
    expect(()=>inspectGraphql('query A{viewer{login}} mutation B($input: MergePullRequestInput!){mergePullRequest(input:$input){pullRequest{id}}}',vals,'query')).toThrow();
    expect(()=>inspectGraphql('mutation M($input:MergePullRequestInput!){x:mergePullRequest(input:$input){pullRequest{id}} y:mergePullRequest(input:$input){pullRequest{id}}}',vals,'mutation')).toThrow(/exactly one root mutation/);
  });
  it('estimates nested first/last connection cost including variable and fragment expansion',()=>{
    const depth='query Cost($n: Int!) { viewer { repositories(first:$n) { nodes { issues(first:$n) { nodes { comments(first:$n) { nodes { id } } } } } } } }';
    expect(()=>inspectGraphql(depth,{n:100})).toThrow(/500 points|500,000 nodes/);
    const unbounded='query {viewer { repositories { nodes {id} } } }';
    expect(()=>inspectGraphql(unbounded)).toThrow(/first or last/);
    const excessive='query($n:Int!){viewer{repositories(first:$n){nodes{id}}}}';
    expect(()=>inspectGraphql(excessive,{n:101})).toThrow(/1 to 100/);
  });
  it('refuses nested secrets, bypass, future priced operations and enqueues as production/access',()=>{
    expect(()=>classifyGraphqlMutation('updateDiscussion',{input:{discussionId:'D_ID',payload:{access_token:'notallowed'}}})).toThrow(/Secrets/);
    expect(()=>classifyGraphqlMutation('updateDiscussion',{input:{discussionId:'D_ID',bypassRules:true}})).toThrow(/bypass/);
    expect(()=>classifyGraphqlMutation('createCodespace',{input:{id:'R_ID'}})).toThrow(/price/);
    expect(classifyGraphqlMutation('enqueuePullRequest',{input:{id:'PR_ID'}})).toMatchObject({production:true,accessWidening:true});
    expect(classifyGraphqlMutation('updateProjectV2',{input:changes})).toMatchObject({production:true,accessWidening:true});
  });
  it('runs a valid read through scoped pinned client and bounded result shaping',async()=>{
    const w=await makeWorld({profile:'read_only'});
    w.gh.when('POST /graphql').reply(200,{data:{repository:{nameWithOwner:'example-org/hello'}}});
    const result=await dispatch(w,'github_graphql_read',queryArgs);
    expect(result.isError).not.toBe(true);
    expect(parse(result).data.repository.nameWithOwner).toBe('example-org/hello');
    expect(w.gh.calls).toHaveLength(1);
    expect(w.gh.invalid).toEqual([]);
  });
  it('refuses an explicitly foreign GraphQL account before any provider request',async()=>{
    const w=await makeWorld({profile:'read_only'});
    const other=await dispatch(w,'github_graphql_read',{...queryArgs,variables:{...queryArgs.variables,owner:'another-org'}});
    expect(other.isError).toBe(true);
    expect(w.gh.calls).toEqual([]);
  });
  it('denies unknown node ownership and missing confirmation without a mutation',async()=>{
    const w=await makeWorld({delegated:true,profile:'full',mode:'production'});
    w.gh.when('POST /graphql').reply(200,{data:{node:{...node('Prior'),owner:{login:'other-org'}}}});
    const res=parse(await dispatch(w,'github_graphql_write',{...writeArgs,confirm:true}));
    expect(res.status).not.toBe('applied');
    expect(w.gh.calls.filter(x=>/^mutation/.test(x.body?.query??''))).toEqual([]);
    const p=await makeWorld({delegated:true,profile:'full',mode:'production'});
    stubMutation(p.gh,'ok');
    const preview=parse(await dispatch(p,'github_graphql_write',writeArgs));
    expect(preview.status,'Verified GraphQL write preflight: '+JSON.stringify(preview)+'; fake invalid: '+JSON.stringify(p.gh.invalid.map(x=>x.invalid))+'; calls: '+JSON.stringify(p.gh.calls.map(x=>({route:x.route,query:x.body?.query})))).toBe('needs_confirmation');
    expect(p.gh.calls.filter(x=>/^mutation/.test(x.body?.query??''))).toEqual([]);
  });
});
describe('U-2 reviewed GraphQL security and broad resource shape regressions',()=>{
  it('never transmits credential variables or literal invitation tokens in a read',async()=>{
    const w=await makeWorld({profile:'read_only'});
    const q='query Token($text:String!){search(query:$text,type:ISSUE,first:2){nodes{... on Issue{id}}}}';
    const bad=await dispatch(w,'github_graphql_read',{query:q,repo:'hello',variables:{text:'repo:example-org/hello github_pat_REDACTED0123456789abc'}});
    expect(bad.isError).toBe(true);
    expect(w.gh.calls).toEqual([]);
    const q2='query {enterpriseAdministratorInvitationByToken(invitationToken:"secretValue") {id}}';
    const invalid=await dispatch(w,'github_graphql_read',{query:q2});
    expect(invalid.isError).toBe(true);
    expect(w.gh.calls).toEqual([]);
  });
  it('rejects foreign user and repositoryOwner roots and unscoped viewer traversals',async()=>{
    const w=await makeWorld({profile:'read_only'});
    for(const query of [
      'query{user(login:"other-org"){login}}',
      'query{repositoryOwner(login:"foreign"){login}}',
      'query{viewer{repositories(first:2){nodes{id}}}}',
      'query{unknownRootWithoutScope{id}}'
    ]){
      expect((await dispatch(w,'github_graphql_read',{query})).isError,query).toBe(true);
    }
    expect(w.gh.calls).toEqual([]);
  });
  it('rejects OR/foreign repository broadeners on scoped search',async()=>{
    const w=await makeWorld({profile:'read_only'});
    const query='query Seek($q:String!){search(query:$q,type:ISSUE,first:2){nodes{... on Issue{id}}}}';
    const response=await dispatch(w,'github_graphql_read',{query,repo:'hello',variables:{q:'repo:example-org/hello OR repo:foreign/repo'}});
    expect(response.isError).toBe(true);
    expect(w.gh.calls).toEqual([]);
  });
  it('conservatively marks even alias-renamed outsider authored GraphQL text untrusted',async()=>{
    const w=await makeWorld({profile:'read_only'});
    w.gh.when('POST /graphql').reply(200,{data:{repository:{issue:{aliasTitle:'Read me',body:'External instructions',authorAssociation:'NONE'}}}});
    const query='query{repository(owner:"example-org",name:"hello"){issue(number:1){aliasTitle:title body authorAssociation}}}';
    const response=await dispatch(w,'github_graphql_read',{query});
    expect(response.isError).not.toBe(true);
    expect(parse(response).data.untrusted).toBe(true);
    expect(parse(response).data.repository.issue.untrusted).toBe(true);
    expect(w.gh.invalid).toEqual([]);
  });
  it('does not multiply the nodes list by 100 twice after a bounded connection',()=>{
    const bounded='query Hundred($n:Int!){viewer{repositories(first:$n){nodes{issues(first:$n){nodes{id}}}}}}';
    const result=inspectGraphql(bounded,{n:100});
    expect(result.nodes).toBeLessThan(100000);
    expect(result.points).toBeLessThan(500);
    expect(result.connections).toBe(2);
  });
  it('previews multiple independently scoped ProjectV2 IDs without mutation dispatch',async()=>{
    const w=await makeWorld({delegated:true,profile:'full',mode:'production'});
    const mutation='mutation Project($input:UpdateProjectV2ItemFieldValueInput!){updateProjectV2ItemFieldValue(input:$input){projectV2Item{id}}}';
    const vars={input:{projectId:'PV2_PROJECT',itemId:'PV2_ITEM',fieldId:'PV2_FIELD',value:{text:'New value'}}};
    const owned={id:'PV2_PROJECT',owner:{login:'example-org'}};
    const nodes={
      PV2_PROJECT:{__typename:'ProjectV2',...owned},
      PV2_ITEM:{__typename:'ProjectV2Item',id:'PV2_ITEM',project:owned},
      PV2_FIELD:{__typename:'ProjectV2Field',id:'PV2_FIELD',fieldName:'Status',project:owned}
    };
    w.gh.when('POST /graphql').reply(200,request=>({data:{node:request.body.query.includes('UniversalFieldReadback')
      ? {id:'PV2_ITEM',fieldValueByName:null} : nodes[request.body.variables?.id]??null}}));
    const result=parse(await dispatch(w,'github_graphql_write',{mutation,variables:vars,repo:'hello'}));
    expect(result.status,JSON.stringify(result)+' invalid '+JSON.stringify(w.gh.invalid.map(x=>x.invalid))).toBe('needs_confirmation');
    expect(w.gh.calls.filter(x=>/^\s*mutation\b/.test(x.body?.query??''))).toHaveLength(0);
    expect(w.gh.invalid).toEqual([]);
  });
});
describe('U-2 reviewed secret selections, typed IDs and independently confirmed field updates',()=>{
  it('refuses aliased temporary repository auth tokens before GitHub is called',async()=>{
    const w=await makeWorld({profile:'read_only'});
    const query='query{repository(owner:"example-org",name:"hello"){safe:tempCloneToken}}';
    const result=await dispatch(w,'github_graphql_read',{query});
    expect(result.isError).toBe(true);
    expect(w.gh.calls).toEqual([]);
  });
  it('extracts schema-typed IDs from list inputs but excludes String option identifiers',()=>{
    const doc='mutation Assign($input:AddAssigneesToAssignableInput!){addAssigneesToAssignable(input:$input){assignable{__typename}}}';
    const entry=inspectGraphql(doc,{input:{assignableId:'I_ONE',assigneeIds:['U_A','U_B']}},'mutation');
    expect(relevantGraphqlNodeId(entry.input,entry).ids.map(x=>x.value)).toEqual(['I_ONE','U_A','U_B']);
    const pdoc='mutation Project($input:UpdateProjectV2ItemFieldValueInput!){updateProjectV2ItemFieldValue(input:$input){projectV2Item{id}}}';
    const entry2=inspectGraphql(pdoc,{input:{projectId:'PV2_PROJECT',itemId:'PV2_ITEM',fieldId:'PV2_FIELD',value:{singleSelectOptionId:'option—not-a-node'}}},'mutation');
    expect(relevantGraphqlNodeId(entry2.input,entry2).ids.map(x=>x.name)).toEqual(['fieldId','itemId','projectId']);
  });
  it('refuses unreviewed list-recipient mutations without independent recipient/readback proof',async()=>{
    const w=await makeWorld({profile:'full',mode:'production'});
    const mutation='mutation Assign($input:AddAssigneesToAssignableInput!){addAssigneesToAssignable(input:$input){assignable{__typename}}}';
    const result=await dispatch(w,'github_graphql_write',{mutation,repo:'hello',
      variables:{input:{assignableId:'I_ONE',assigneeIds:['U_FOREIGN']}}});
    expect(result.isError).toBe(true);
    expect(w.gh.calls).toEqual([]);
  });
  it('confirms a changed ProjectV2 field only after independent typed field/value reread',async()=>{
    const w=await makeWorld({profile:'full',mode:'production',advanceClockOnSleep:true});
    const mutation='mutation Project($input:UpdateProjectV2ItemFieldValueInput!){updateProjectV2ItemFieldValue(input:$input){projectV2Item{id}}}';
    const owned={id:'PV2_PROJECT',owner:{login:'example-org'}};
    const nodes={
      PV2_PROJECT:{__typename:'ProjectV2',...owned},
      PV2_ITEM:{__typename:'ProjectV2Item',id:'PV2_ITEM',project:owned},
      PV2_FIELD:{__typename:'ProjectV2Field',id:'PV2_FIELD',fieldName:'Status',project:owned}
    };
    let sent=0;
    w.gh.when('POST /graphql').reply(200,request=>{
      const q=request.body?.query??'';
      if(q.includes('UniversalFieldReadback'))return {data:{node:{id:'PV2_ITEM',
        fieldValueByName:sent?{__typename:'ProjectV2ItemFieldTextValue',field:{id:'PV2_FIELD'},text:'New value'}:null}}};
      if(/^\s*mutation\b/.test(q)){sent++;return {data:{updateProjectV2ItemFieldValue:{projectV2Item:{id:'PV2_ITEM'}}}};}
      return {data:{node:nodes[request.body.variables?.id]??null}};
    });
    const result=parse(await dispatch(w,'github_graphql_write',{mutation,repo:'hello',
      variables:{input:{projectId:'PV2_PROJECT',itemId:'PV2_ITEM',fieldId:'PV2_FIELD',value:{text:'New value'}}},
      confirm:true}));
    expect(result.status,JSON.stringify(result)+' invalid '+JSON.stringify(w.gh.invalid.map(x=>x.invalid))).toBe('applied');
    expect(result.confirmed).toBe(true);
    expect(sent).toBe(1);
    expect(w.gh.invalid).toEqual([]);
  });
});
runWriteContract({
  label:'U-2 updateProjectV2 verified scoped GraphQL mutation',
  definition:{tool:g.tools[1],handler:g.handlers.github_graphql_write},
  args:writeArgs,profile:'full',production:true,needsConfirm:true,accessWidening:true,
  notifies:['example-org'],advanceClockOnSleep:true,
  arrange:(gh,outcome)=>stubMutation(gh,outcome)
});

 it('unsupported owner GraphQL contract gives actionable alternatives without claiming a GitHub permission refusal', async () => {
   const w = await makeWorld({ profile: 'full', mode: 'production' });
   const result = await dispatch(w, 'github_graphql_write', {
     owner: 'example-org', repo: 'hello',
     mutation: 'mutation($input: UpdateProjectV2CollaboratorsInput!) { updateProjectV2Collaborators(input: $input) { clientMutationId } }',
     variables: { input: { projectId: 'PVT_kwDO12345', collaborators: [] } }
   });
   const value = JSON.stringify(result);
   expect(value).toContain('no implemented ownership/readback contract');
   expect(value).toContain('github_api_describe');
   expect(value).toContain('github_where_is_setting');
   expect(value).not.toContain('refused on purpose');
   expect(w.gh.calls).toHaveLength(0);
 });
