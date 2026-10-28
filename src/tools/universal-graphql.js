import { isOwnerConnection } from '../core/authority.js';
// U-2 universal GraphQL: pinned schema, AST-aware read/mutation separation,
// explicit scoped node preflight and the existing journaled GitHub write lifecycle.
import {defineRead} from './define-read.js';
import {defineGithubWrite} from './define-github-write.js';
import {githubFor,graphql} from '../github/client.js';
import {plain} from './github-read.js';
import {inspectGraphql,graphqlSelectionFields,graphqlRootSelections} from '../github/graphql-schema.js';
import {valueFromASTUntyped} from 'graphql';
import {writeSpec,REFUSED_MUTATIONS,specReadQuery,specInput,inverseDocument,snapshotChanged} from '../github/graphql-writes.js';
import {refusal} from './github-write.js';
import {classifyGraphqlMutation,relevantGraphqlNodeId,assertSafeGraphqlArguments} from '../github/mutation-classes.js';

const DOCUMENT={type:'string',minLength:5,maxLength:24000,description:'One validated GraphQL document, including typed variable definitions'};
const VARIABLES={type:'object',additionalProperties:true,maxProperties:48,description:'Typed GraphQL input variables; no credentials'};
const OWNER={type:'string',minLength:1,maxLength:39,description:'Already-enrolled account; defaults to this connection'};
const REPO={type:'string',minLength:1,maxLength:100,description:'Explicit repository for guarded GraphQL mutations'};
const CRED={type:'string',enum:['I','U','M'],description:'I installation; U user credential; M your enrolled master token (only when the App cannot do it)'};
const common={variables:VARIABLES,owner:OWNER,cred:CRED};

export const SCOPE_QUERY='query UniversalResourceScope($id: ID!) { node(id: $id) { __typename id ... on Repository { nameWithOwner } ... on Issue { title repository { nameWithOwner } } ... on PullRequest { title repository { nameWithOwner } } ... on Discussion { title repository { nameWithOwner } } ... on Release { releaseName:name repository { nameWithOwner } } ... on Milestone { title repository { nameWithOwner } } ... on Label { labelName:name repository { nameWithOwner } } ... on Commit { repository { nameWithOwner } } ... on DiscussionComment { discussion { repository { nameWithOwner } } } ... on IssueComment { issue { repository { nameWithOwner } } } ... on ProjectV2 { title owner { ... on Organization { login } ... on User { login } } } ... on ProjectV2Item { project { id owner { ... on Organization { login } ... on User { login } } } content { ... on Issue { repository { nameWithOwner } } ... on PullRequest { repository { nameWithOwner } } } } ... on ProjectV2Field { fieldName:name project { id owner { ... on Organization { login } ... on User { login } } } } ... on ProjectV2SingleSelectField { fieldName:name project { id owner { ... on Organization { login } ... on User { login } } } } ... on ProjectV2IterationField { fieldName:name project { id owner { ... on Organization { login } ... on User { login } } } } ... on ProjectV2MultiSelectField { fieldName:name project { id owner { ... on Organization { login } ... on User { login } } } } ... on Organization { login } ... on User { login } ... on ProjectV2View { project { id owner { ... on Organization { login } ... on User { login } } } } ... on ProjectV2StatusUpdate { project { id owner { ... on Organization { login } ... on User { login } } } } ... on ProjectV2Workflow { project { id owner { ... on Organization { login } ... on User { login } } } } ... on DraftIssue { projectsV2(first: 20) { nodes { id owner { ... on Organization { login } ... on User { login } } } } } ... on Team { slug organization { login } } ... on DiscussionCategory { repository { nameWithOwner } } ... on PullRequestReviewComment { pullRequest { repository { nameWithOwner } } } ... on Deployment { repository { nameWithOwner } } ... on PullRequestReview { pullRequest { repository { nameWithOwner } } } ... on DiscussionPollOption { poll { discussion { repository { nameWithOwner } } } } ... on CommitComment { repository { nameWithOwner } } ... on LinkedBranch { ref { repository { nameWithOwner } } } } }';
/** Exact field readback is separate from GitHub's mutation response. It also
 * carries its owning field's real ID, preventing a same-name field collision. */
export const PROJECT_FIELD_QUERY='query UniversalFieldReadback($itemId: ID!, $fieldName: String!) { node(id:$itemId) { ... on ProjectV2Item { id fieldValueByName(name:$fieldName) { __typename ... on ProjectV2ItemFieldValueCommon { field { ... on Node { id } } } ... on ProjectV2ItemFieldTextValue { text } ... on ProjectV2ItemFieldNumberValue { number } ... on ProjectV2ItemFieldDateValue { date } ... on ProjectV2ItemFieldSingleSelectValue { optionId } ... on ProjectV2ItemFieldIterationValue { iterationId } ... on ProjectV2ItemFieldMultiSelectValue { options { id } } } } } }';

function ownerFor(a,c){
  const requested=a.owner??c.connection?.default_account;
  if(typeof requested!=='string'||!c.connection?.accounts?.some(x=>x.toLowerCase()===requested.toLowerCase()))
    throw new TypeError('GraphQL account is not enrolled in this connection.');
  return c.connection.accounts.find(x=>x.toLowerCase()===requested.toLowerCase());
}
function credFor(a){
  const cred=a.cred??'I';
  if(!['I','U','M'].includes(cred))throw new TypeError('GraphQL credential must be an enrolled I, U or M credential.');
  return cred;
}
async function accountGraphql(ctx,owner,cred,repo){
  const account=await ctx.db.getAccount(owner);
  const client=await githubFor(ctx,{owner,cred,
    ...(repo&&cred==='I'&&account?.credential_kind==='app'?{scope:{repositories:[repo]}}:{})});
  return (document,variables)=>graphql(client,document,variables);
}
function scopedNode(node,owner,repo){
  if(!node?.id||typeof node.__typename!=='string')
    throw new TypeError('GraphQL ID could not be independently resolved.');
  const name=node.nameWithOwner??node.repository?.nameWithOwner??
    node.discussion?.repository?.nameWithOwner??node.poll?.discussion?.repository?.nameWithOwner??node.issue?.repository?.nameWithOwner??
    node.pullRequest?.repository?.nameWithOwner??node.ref?.repository?.nameWithOwner;
  if(typeof name==='string'&&name.toLowerCase()===(owner+'/'+repo).toLowerCase())
    return {id:node.id,type:'repository',repo:name,projectId:null};
  const project=node.__typename==='ProjectV2'?node:node.project;
  if(project?.owner?.login?.toLowerCase()===owner.toLowerCase()&&project.id){
    const contentRepo=node.content?.repository?.nameWithOwner;
    if(contentRepo&&contentRepo.toLowerCase()!==(owner+'/'+repo).toLowerCase())
      throw new TypeError('GraphQL project item links to a repository outside the selected account/repository.');
    return {id:node.id,type:'project',repo:owner+'/'+repo,projectId:project.id};
  }
  throw new TypeError('GraphQL resource is not proven to belong to the requested enrolled account and repository.');
}
/** Y-2 org scope: the node is the enrolled organization itself, or a team inside it. */
function orgNode(node,owner){
  if(!node?.id||typeof node.__typename!=='string')
    throw new TypeError('GraphQL ID could not be independently resolved.');
  const same=l=>typeof l==='string'&&l.toLowerCase()===owner.toLowerCase();
  const login=node.__typename==='Team'?node.organization?.login:node.__typename==='Organization'?node.login:null;
  if(same(login))
    return {id:node.id,type:'organization',repo:null,projectId:null};
  // GQL-1: a project, or something inside one, belongs to the account when the project's owner is that account.
  const project=node.__typename==='ProjectV2'?node:node.project;
  if(project?.id&&same(project.owner?.login))
    return {id:node.id,type:'project',repo:null,projectId:project.id};
  // A draft issue can sit in several projects: every one of them must belong to the account.
  const drafts=node.__typename==='DraftIssue'?node.projectsV2?.nodes:null;
  if(Array.isArray(drafts)&&drafts.length>0&&drafts.every(p=>p?.id&&same(p.owner?.login)))
    return {id:node.id,type:'project',repo:null,projectId:drafts[0].id};
  throw new TypeError('GraphQL resource is not proven to belong to the requested enrolled organization.');
}
async function readScope(entry,owner,repo,ctx,cred){
  // A broad U credential must not turn the selected account into permission
  // to query unrelated organization, enterprise, user or repository roots.
  const named=entry.variables,roots=graphqlRootSelections(entry);
  const permitted=new Set(['organization','repository','enterprise','user','repositoryOwner','node','nodes','search','viewer','rateLimit','__typename']);
  for(const field of roots){
    const operation=field.name.value;
    if(!permitted.has(operation))
      throw new TypeError('GraphQL root '+operation+' has no independently verified enrolled-account scope.');
    if(['organization','repository','enterprise','user','repositoryOwner'].includes(operation)){
      const key=operation==='repository'?'owner':'login';
      const arg=field.arguments?.find(x=>x.name.value===key);
      const value=valueFromASTUntyped(arg?.value,named);
      if(typeof value!=='string'||value.toLowerCase()!==owner.toLowerCase())
        throw new TypeError('GraphQL query names an account outside the enrolled connection.');
      if(operation==='repository'&&repo){
        const repoArg=field.arguments?.find(x=>x.name.value==='name');
        if(valueFromASTUntyped(repoArg?.value,named)?.toLowerCase()!==repo.toLowerCase())
          throw new TypeError('GraphQL query repository differs from the exact selected scope.');
      }
    }
    if(operation==='viewer'){
      // viewer grants a U credential access to other memberships and repos.
      // Only current-principal identity scalars can be returned this way.
      const identity=new Set(['login','id','name','avatarUrl','url','__typename']);
      const nested=graphqlRootSelections({operation:{selectionSet:field.selectionSet},fragments:entry.fragments});
      if(nested.some(x=>!identity.has(x.name.value)||x.selectionSet))
        throw new TypeError('GraphQL viewer traversal is not scoped. Use organization or repository roots instead.');
    }
    if(['node','nodes'].includes(operation)){
      if(typeof repo!=='string'||!/^[A-Za-z0-9_.-]{1,100}$/.test(repo))
        throw new TypeError('Opaque GraphQL nodes require an explicit repository for independent ID verification.');
      const arg=field.arguments?.find(x=>x.name.value===(operation==='node'?'id':'ids'));
      const ids=valueFromASTUntyped(arg?.value,named);
      const list=operation==='node'?[ids]:ids;
      if(!Array.isArray(list)||list.length<1||list.length>10||
        list.some(x=>typeof x!=='string'||!x))
        throw new TypeError('Opaque GraphQL node queries need one to ten valid IDs.');
      const call=await accountGraphql(ctx,owner,cred,repo);
      for(const id of list){
        const result=await call(SCOPE_QUERY,{id});
        if(result?.node?.id!==id)throw new TypeError('GraphQL ID could not be verified.');
        scopedNode(result.node,owner,repo);
      }
    }
    if(operation==='search'){
      if(typeof repo!=='string'||!/^[A-Za-z0-9_.-]{1,100}$/.test(repo))
        throw new TypeError('GraphQL search requires the explicit selected repository.');
      const arg=field.arguments?.find(x=>x.name.value==='query');
      const value=valueFromASTUntyped(arg?.value,named);
      const tokens=typeof value==='string'?value.split(/\s+/).filter(Boolean):[];
      const qualifiers=tokens.filter(x=>/^-?(?:repo|org|user):/i.test(x));
      if(qualifiers.length!==1||qualifiers[0].toLowerCase()!=='repo:'+(owner+'/'+repo).toLowerCase()||
        tokens.some(x=>/^(?:OR|NOT)$/i.test(x)||/^-repo:/i.test(x)))
        throw new TypeError('GraphQL search must be limited to one exact repo:owner/repo without alternate accounts.');
    }
  }
}

function resolveRead(a,c){
  const owner=ownerFor(a,c),cred=credFor(a);
  const entry=inspectGraphql(a.query,a.variables??{},'query');
  assertSafeGraphqlArguments(entry,{ownerDirected:isOwnerConnection(c.connection)});
  return {owner,cred,repo:a.repo??null,entry};
}
function targetWrite(a,c){
  const owner=ownerFor(a,c),repo=a.repo;
  if(JSON.stringify(a.variables??{}).length>24_000)
    throw new TypeError('GraphQL variables exceed the safe request budget.');
  const entry=inspectGraphql(a.mutation,a.variables??{},'mutation');
  assertSafeGraphqlArguments(entry,{ownerDirected:isOwnerConnection(c.connection)});
  if(REFUSED_MUTATIONS.has(entry.mutation))
    throw new TypeError(entry.mutation+' is refused on purpose: '+REFUSED_MUTATIONS.get(entry.mutation));
  const spec=writeSpec(entry.mutation);
  const repoOk=typeof repo==='string'&&/^[A-Za-z0-9_.-]{1,100}$/.test(repo);
  if((!spec||spec.scope==='repo')&&!repoOk)
    throw new TypeError('GraphQL mutation requires an explicitly named, valid repository.');
  if(spec?.scope==='org'&&repo!==undefined)
    throw new TypeError('This organization-level GraphQL mutation takes no repository.');
  const classification=classifyGraphqlMutation(entry.mutation,entry.input,{ownerDirected:isOwnerConnection(c.connection)});
  const node=relevantGraphqlNodeId(entry.input,entry);
  if(spec){
    // GraphQL fills in schema defaults (for example `notifyTeam: false`). A default is not a request, so it is not "uncovered".
    const arg=entry.schema.getMutationType().getFields()[entry.mutation].args.find(x=>x.name==='input');
    let inputType=arg.type;while(inputType.ofType)inputType=inputType.ofType;
    const fields=inputType.getFields();
    const covered=new Set([...Object.keys(spec.ids),...spec.changes,'clientMutationId']);
    const defaultOf=f=>f?.astNode?.defaultValue?valueFromASTUntyped(f.astNode.defaultValue):undefined;
    const supplied=Object.fromEntries(Object.entries(entry.input.input).filter(([k,v])=>
      covered.has(k)||defaultOf(fields[k])===undefined||JSON.stringify(defaultOf(fields[k]))!==JSON.stringify(v)));
    const checked=specInput(spec,entry.mutation,supplied,node.ids);
    const primary=node.ids.find(x=>x.name===spec.primary);
    return {owner,repo:spec.scope==='org'?null:repo,scope:spec.scope,kind:spec.scope==='org'?'graphql-org':'graphql-repo',ref:null,
      cred:credFor(a),entry,classification,spec,
      node:{...primary,ids:node.ids,changes:checked.changes}};
  }
  const keys=Object.keys(node.changes);
  const projectChange=entry.mutation==='updateProjectV2ItemFieldValue'&&keys.length===1&&keys[0]==='value';
  const titleChange=keys.length===1&&keys[0]==='title'&&typeof node.changes.title==='string';
  if(!projectChange&&!titleChange)
    throw new TypeError('GraphQL write has no independently verifiable readback for this mutation/input; use the specialized guarded tool.');
  return {owner,repo,scope:'repo',kind:'graphql-repo',ref:null,cred:credFor(a),entry,classification,node};
}
// No provider write is attempted unless this exact node can be independently
// resolved to the caller's enrolled account AND requested repository.
const valueFields=new Map([
  ['text',['ProjectV2ItemFieldTextValue','text']],
  ['number',['ProjectV2ItemFieldNumberValue','number']],
  ['date',['ProjectV2ItemFieldDateValue','date']],
  ['singleSelectOptionId',['ProjectV2ItemFieldSingleSelectValue','optionId']],
  ['iterationId',['ProjectV2ItemFieldIterationValue','iterationId']],
  ['multiSelectOptionIds',['ProjectV2ItemFieldMultiSelectValue','options']]
]);
function expectedProjectValue(target){
  const value=target.entry.input?.input?.value;
  if(!value||typeof value!=='object'||Array.isArray(value))
    throw new TypeError('Project field change needs an exact typed value for independent readback.');
  const keys=Object.keys(value).filter(k=>value[k]!==undefined&&value[k]!==null);
  if(keys.length!==1||!valueFields.has(keys[0]))
    throw new TypeError('Project field change requires one supported, independently verifiable value.');
  return {key:keys[0],value:value[keys[0]],type:valueFields.get(keys[0])[0],property:valueFields.get(keys[0])[1]};
}
function confirmedField(expected,snapshot){
  if(!expected||!snapshot||snapshot.__typename!==expected.type)return false;
  if(expected.key==='multiSelectOptionIds'){
    const actual=snapshot.options?.map(x=>x?.id);
    return Array.isArray(actual)&&Array.isArray(expected.value)&&actual.length===expected.value.length&&
      actual.every(x=>typeof x==='string')&&
      [...actual].sort().join('|')===[...expected.value].sort().join('|');
  }
  return JSON.stringify(snapshot[expected.property])===JSON.stringify(expected.value);
}
const PIN_LIMIT_QUERY='query PinnedIssueLimit($owner: String!, $name: String!) { repository(owner:$owner, name:$name) { pinnedIssues(first: 4) { totalCount } } }';
const ADMIN_QUERY='query RepositoryAdminCheck($owner: String!, $name: String!) { repository(owner:$owner, name:$name) { viewerPermission } }';
async function readSpecNode(call,spec,id){
  const value=await call(specReadQuery(spec),{id});
  return value?.node??null;
}
/** Extra read-only checks some specs name; the answer is a plain sentence when the write must not go ahead. */
async function specPreflight(call,target){
  const [owner,name]=[target.owner,target.repo];
  if(target.spec.preflight==='pinned-issue-limit'){
    const x=await call(PIN_LIMIT_QUERY,{owner,name});
    const count=x?.repository?.pinnedIssues?.totalCount;
    if(!Number.isInteger(count))return 'The number of pinned issues could not be read, so the write was not allowed.';
    if(count>=3)return 'This repository already has 3 pinned issues, the most GitHub allows. Unpin one first.';
  }
  if(target.spec.preflight==='repo-admin'){
    const x=await call(ADMIN_QUERY,{owner,name});
    if(x?.repository?.viewerPermission!=='ADMIN')
      return 'Deleting an issue needs repository admin rights, and this credential could not be confirmed as admin on '+owner+'/'+name+'.';
  }
  return null;
}
async function specBaseline(c,target,{afterWrite=false}={}){
  const call=await accountGraphql(c,target.owner,target.cred,target.repo??undefined);
  const spec=target.spec,nodes=[];
  if(!afterWrite){
    // Every ID must resolve, be of an allowed type and sit inside the enrolled account (and repository for repo scope).
    for(const identity of target.node.ids){
      const value=await call(SCOPE_QUERY,{id:identity.value});
      const node=value?.node;
      if(!node||node.id!==identity.value)
        throw new TypeError('GraphQL '+identity.name+' cannot be independently resolved.');
      const allowed=spec.ids[identity.name];
      if(!allowed.includes(node.__typename))
        throw new TypeError('GraphQL '+identity.name+' must be a '+allowed.join(' or ')+', not a '+node.__typename+'.');
      if(spec.scope==='org')orgNode(node,target.owner);else scopedNode(node,target.owner,target.repo);
      nodes.push({name:identity.name,id:node.id,type:node.__typename});
    }
  }
  const specNode=await readSpecNode(call,spec,target.node.value);
  if(!afterWrite&&!specNode)throw new TypeError('GraphQL '+spec.primary+' node could not be read before the write.');
  let blocked=null;
  if(!afterWrite){
    if(spec.already?.(target.entry.input.input,specNode))
      blocked='Already in the requested state, so nothing would change.';
    else blocked=await specPreflight(call,target);
  }
  return {verified:true,verifiable:true,id:target.node.value,type:specNode?.__typename??nodes.find(x=>x.name===spec.primary)?.type??null,
    repo:target.repo?target.owner+'/'+target.repo:target.owner,node:specNode,specNode,blocked,targetIds:nodes};
}
async function baseline(a,c,target){
  if(target.spec)return specBaseline(c,target);
  const call=await accountGraphql(c,target.owner,target.cred,target.repo);
  const nodes=[];const projectIds=new Set();
  for(const identity of target.node.ids){
    const value=await call(SCOPE_QUERY,{id:identity.value});
    const node=value?.node;
    if(!node||node.id!==identity.value)
      throw new TypeError('GraphQL '+identity.name+' cannot be independently resolved.');
    const ownership=scopedNode(node,target.owner,target.repo);
    if(ownership.projectId)projectIds.add(ownership.projectId);
    if(identity.name==='projectId'&&ownership.projectId!==node.id)
      throw new TypeError('GraphQL projectId does not refer to an owned project.');
    nodes.push({identity,ownership,node});
  }
  if(projectIds.size>1)throw new TypeError('GraphQL mutation references unrelated projects.');
  const primary=nodes.find(x=>x.identity.value===target.node.value)??nodes[0];
  const result={verified:true,id:primary.node.id,type:primary.node.__typename,
    repo:target.owner+'/'+target.repo,node:primary.node,
    targetIds:nodes.map(x=>({name:x.identity.name,id:x.node.id,type:x.node.__typename,projectId:x.ownership.projectId}))};
  if(target.entry.mutation==='updateProjectV2ItemFieldValue'){
    const project=nodes.find(x=>x.identity.name==='projectId');
    const item=nodes.find(x=>x.identity.name==='itemId');
    const field=nodes.find(x=>x.identity.name==='fieldId');
    if(!project||!item||!field||!field.node.fieldName||
      project.ownership.projectId!==item.ownership.projectId||
      project.ownership.projectId!==field.ownership.projectId)
      throw new TypeError('Project, field, item and exact field name cannot be independently verified.');
    const expected=expectedProjectValue(target);
    const value=await call(PROJECT_FIELD_QUERY,{itemId:item.node.id,fieldName:field.node.fieldName});
    if(value?.node?.id!==item.node.id)
      throw new TypeError('Project field readback returned an unverified item.');
    const snapshot=value.node.fieldValueByName??null;
    if(snapshot&&snapshot.field?.id!==field.node.id)
      throw new TypeError('Project field readback refers to a different field.');
    return {...result,verifiable:true,fieldSnapshot:snapshot,fieldExpected:expected};
  }
  const changes=Object.entries(target.node.changes);
  if(changes.length!==1||changes[0][0]!=='title'||!Object.hasOwn(primary.node,'title'))
    throw new TypeError('GraphQL change lacks an exact independently readable target field.');
  return {...result,verifiable:true};
}
function changesMatch(changes,node){
  const entries=Object.entries(changes);
  return entries.length>0&&entries.every(([key,value])=>
    key==='title'&&Object.hasOwn(node??{},key)&&JSON.stringify(node[key])===JSON.stringify(value));
}

/** All GraphQL response objects can contain alias-renamed outsider text. The
 * graph carries a conservative provenance mark on every object, not only REST
 * author_association keys. No user-supplied GraphQL body is trusted as instructions. */
function markGraphqlUntrusted(value,depth=0){
  if(depth>22||value===null||typeof value!=='object')return value;
  if(Array.isArray(value))return value.map(x=>markGraphqlUntrusted(x,depth+1));
  const result=Object.fromEntries(Object.entries(value).map(([k,v])=>[k,markGraphqlUntrusted(v,depth+1)]));
  if(typeof value.authorAssociation==='string')result.author_association=value.authorAssociation;
  return {...result,untrusted:true};
}
const gqlRead=defineRead({
  name:'github_graphql_read',area:'universal',audience:['B','O','Op'],
  description:'Read a single pinned-schema GitHub GraphQL query after validating variables, connection bounds, points and account scope.',
  properties:{query:DOCUMENT,...common,repo:REPO},required:['query'],
  handler:(a,c)=>plain(async()=>{
    const chosen=resolveRead(a,c);
    await readScope(chosen.entry,chosen.owner,chosen.repo,c,chosen.cred);
    const call=await accountGraphql(c,chosen.owner,chosen.cred,chosen.repo);
    const data=await call(chosen.entry.source,chosen.entry.variables);
    return {account:chosen.owner,pointsEstimate:chosen.entry.points,
      maximumNodes:chosen.entry.nodes,connections:chosen.entry.connections,
      rootFields:graphqlSelectionFields(chosen.entry),data:markGraphqlUntrusted(data)};
  })
});
const gqlWrite=defineGithubWrite({
  name:'github_graphql_write',area:'universal',audience:['B','O','Op'],
  description:'PRODUCTION: Confirm one schema-valid non-curated GraphQL mutation under full resource, access and replay guards.',
  properties:{mutation:DOCUMENT,...common,repo:REPO},required:['mutation'],
  declarations:{production:'always',accessWidening:true,notifies:true,spend:false,confirm:'always',cred:'I,U',profiles:['full']},
  target:(a,c)=>targetWrite(a,c),
  read:async(a,c,t)=>baseline(a,c,t),
  price:({before,target:t})=>{
    if(before?.verified!==true||before?.verifiable!==true)
      throw new TypeError('An independently verifiable scoped GraphQL baseline is required before any write.');
    return t.classification?.spendRisk ? null : 0;
  },
  classify:({target:t,before})=>({
    // Reviewed specs never get LESS caution than the generic default (Batch Y decision Y4): access and notification
    // marks stay on for every spec; a destructive spec only makes the production sentence stronger.
    production:'GraphQL '+t.entry.mutation+(t.spec?.cls.destructive?' PERMANENTLY DELETES in ':' may change ')+(t.repo?t.owner+'/'+t.repo:t.owner),
    accessWidening:(t.spec?'Reviewed GraphQL changes still count as access-sensitive until an owner decision lowers a mark.':
      'Unreviewed GraphQL mutations are access-sensitive until independently classified.'),
    notifies:[t.owner+' (GraphQL recipients are not independently known)'],
    ...(before?.verified!==true?{production:'Unverified GraphQL resource ownership'}:{})
  }),
  summarize:({target:t,before})=>t.spec
    ?(before?.blocked?'BLOCKED ('+before.blocked+') ':'')+'GraphQL '+t.entry.mutation+(t.spec.cls.destructive?' (permanent, '+(t.spec.undoHint??'cannot be undone')+')':'')+
      ' on '+(t.repo?t.owner+'/'+t.repo:t.owner)+', verified '+(before?.type??'unknown')+' node'
    :'Single GraphQL '+t.entry.mutation+' on '+t.owner+'/'+t.repo+
    ', verified '+(before?.type??'unknown')+' node; fields '+Object.keys(t.node.changes).join(',').slice(0,180),
  apply:async({args:a,ctx:c,target:t,before})=>{
    // The same parser and curated classifier must still accept the request at
    // dispatch, not just the preview; the write contract enforces one send.
    const checked=targetWrite(a,c);
    if(checked.node.value!==t.node.value||checked.entry.mutation!==t.entry.mutation)
      throw new TypeError('GraphQL mutation intent changed after its preview.');
    const call=await accountGraphql(c,t.owner,t.cred,t.repo??undefined);
    if(t.spec){
      if(before?.blocked)throw refusal(before.blocked);
      // Concurrent-change protection: the node must still look exactly as it did in the preview.
      const now=await readSpecNode(call,t.spec,t.node.value);
      if(snapshotChanged(now,before?.specNode))
        throw refusal('This item changed since the preview, so nothing was sent. Preview again.');
    }
    const data=await call(checked.entry.source,checked.entry.variables);
    return {data,headers:{}};
  },
  readAfter:async({args:a,ctx:c,target:t,before,response})=>{
    if(t.spec){
      const after=await specBaseline(c,t,{afterWrite:true});
      return {verified:true,verifiable:true,node:after.specNode,specNode:after.specNode,mutation:t.entry.mutation,
        receipt:response?.data?.[t.entry.mutation]??null,before:before?.specNode??null};
    }
    const after=await baseline(a,c,t);
    return {verified:after.verified,verifiable:after.verifiable,node:after.node,
      fieldSnapshot:after.fieldSnapshot??null,fieldExpected:after.fieldExpected??null,
      mutation:t.entry.mutation,receipt:response?.data?.[t.entry.mutation]??null,
      before:before?.node??null};
  },
  verify:({target:t,before,after})=>
    before?.verified===true&&before?.verifiable===true&&
    after?.verified===true&&after?.verifiable===true&&
    (t.spec
      ? t.spec.verify(t.entry.input.input,after.specNode,before.specNode)
      : t.entry.mutation==='updateProjectV2ItemFieldValue'
      ? confirmedField(after.fieldExpected,after.fieldSnapshot)&&
        JSON.stringify(before.fieldSnapshot)!==JSON.stringify(after.fieldSnapshot)
      : changesMatch(t.node.changes,after.node)&&
        JSON.stringify(after.node)!==JSON.stringify(before.node)),
  present:({target:t,after,response})=>({
    mutation:t.entry.mutation,account:t.owner,repository:t.repo,
    independentlyRead:after?.verified===true,
    observed:after?.verified?(after.node??(t.spec?.deleted?'deleted':null)):null,
    providerReceipt:response?.data?.[t.entry.mutation]??null,
    ...(t.spec&&!t.spec.inverse?{undo:t.spec.undoHint??'This change has no automatic opposite.'}:{})
  }),
  inverse:({target:t,before,after})=>{
    if(!t.spec?.inverse)return null;
    const made=t.spec.inverse(t.entry.input.input,before?.specNode,after?.specNode);
    if(!made)return null;
    return {tool:'github_graphql_write',args:{
      mutation:inverseDocument(made.mutation),variables:{input:made.input},owner:t.owner,
      ...(t.repo?{repo:t.repo}:{}),...(t.cred==='U'||t.cred==='M'?{cred:t.cred}:{})}};
  }
});
export const tools=[gqlRead.tool,gqlWrite.tool];
export const handlers={github_graphql_read:gqlRead.handler,github_graphql_write:gqlWrite.handler};
