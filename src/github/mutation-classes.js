import {visit,Kind,valueFromASTUntyped,getNamedType,isInputObjectType,isListType,isNonNullType} from 'graphql';
// U-2: policy belongs outside the schema parser. A valid mutation is not proof
// that it is permitted, belongs to the account, is free, or is reversible.
const curated=new Map(Object.entries({
  mergePullRequest:'github_pr_merge',
  createPullRequest:'github_pr_create',
  updatePullRequest:'github_pr_update',
  closePullRequest:'github_pr_close',
  reopenPullRequest:'github_pr_update',
  createIssue:'github_issue_create',
  updateIssue:'github_issue_update',
  addStar:'github_repo_star',
  removeStar:'github_repo_star',
  createDiscussion:'github_discussion_create',
  addDiscussionComment:'github_discussion_comment',
  createCommitOnBranch:'github_content_push_files',
  updateRepository:'github_repo_update_settings',
  changeUserStatus:'github_account_set_status',
  updateBranchProtectionRule:'github_protection_set',
  createBranchProtectionRule:'github_protection_set',
  deleteBranchProtectionRule:'github_protection_remove',
  createRepositoryRuleset:'github_ruleset_save',
  updateRepositoryRuleset:'github_ruleset_save',
  deleteRepositoryRuleset:'github_ruleset_delete'
}));
export const curatedGraphqlMutation=name=>curated.get(name)??null;
/** Read-only list of every curated tool name a GraphQL mutation points at (used by the registry consistency test). */
export const curatedTargets=()=>Object.freeze([...new Set(curated.values())]);
const money=/codespace|copilot|enterprise|billing|budget|sponsor|purchase|paid|marketplace|license|runner|securityFeature|storage|minutes|payment/i;
const secretKey=/(?:token|secret|password|passphrase|private.?key|auth.?code|invitation.?code|webhook.?signature|credential)/i;
const secretValue=/(github_pat_[A-Za-z0-9_]+|gh[pousr]_[A-Za-z0-9._-]{18,}|rtc_pass_[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/;
const dangerousKey=/(bypass.?rules|bypassRules|force.?push|skip.?checks)/i;
function scan(value,key='',depth=0,ownerDirected=false){
  if(depth>16)throw new TypeError('GraphQL variables nested too deeply.');
  if(!ownerDirected&&dangerousKey.test(key)&&Boolean(value))
    throw new TypeError('GraphQL rule bypass, skipped checks or forced updates cannot use the universal route.');
  if(secretKey.test(key)&&value!==null&&value!==undefined)
    throw new TypeError('Secrets and credential arguments require their curated sealed/credential tool.');
  if(typeof value==='string'){
    if(secretValue.test(value))throw new TypeError('Credential or private key material is forbidden in GraphQL.');
    if(value.length>12000)throw new TypeError('GraphQL argument value exceeds safe length.');
  }else if(Array.isArray(value)){
    if(value.length>250)throw new TypeError('GraphQL argument list exceeds safe size.');
    value.forEach(x=>scan(x,key,depth+1,ownerDirected));
  }else if(value&&typeof value==='object'){
    if(Object.keys(value).length>100)throw new TypeError('GraphQL input object has too many keys.');
    for(const [k,v]of Object.entries(value))scan(v,k,depth+1,ownerDirected);
  }
}
/** Scan both coerced variable values and document literal/default values.
 * A valid schema argument is not authorization to put credentials in an MCP tool. */
export function assertSafeGraphqlArguments(entry,{ownerDirected=false}={}){
  scan(entry.variables,'',0,ownerDirected);
  visit(entry.ast,{
    Argument(node){scan(valueFromASTUntyped(node.value,entry.variables),node.name.value,0,ownerDirected);},
    VariableDefinition(node){if(node.defaultValue)scan(valueFromASTUntyped(node.defaultValue,entry.variables),node.variable.name.value,0,ownerDirected);},
    Field(node){
      // Credentials supplied as aliased output fields are still handled by the
      // dispatcher's redaction; provider text is never treated as instructions.
      if(node.kind!==Kind.FIELD)throw new TypeError('Unknown GraphQL AST field.');
      if(secretKey.test(node.name.value))
        throw new TypeError('GraphQL secret-bearing provider output field is forbidden, even behind an alias.');
    }
  });
}
export function classifyGraphqlMutation(name,input,{ownerDirected=false}={}){
  if(typeof name!=='string'||!/^[A-Za-z][A-Za-z0-9_]{1,100}$/.test(name))
    throw new TypeError('Unknown or unsupported GraphQL mutation field.');
  scan(input,'',0,ownerDirected);
  const curatedTool=curatedGraphqlMutation(name);
  if(curatedTool)throw new TypeError('The specialist '+curatedTool+' tool must handle '+name+'; the generic GraphQL route cannot bypass its guards.');
  if(!ownerDirected&&money.test(name))throw new TypeError('Potentially priced mutation '+name+' has no reviewed price estimate. Use the cost-aware specialized tool.');
  // There is no safe "ordinary" mutation class until an owner-reviewed policy
  // explicitly names its resource and consequences. Default both high-risk marks.
  return Object.freeze({name,production:true,accessWidening:true,notifies:true,spendRisk:money.test(name)});
}
/** Derive all existing resource IDs, not just a six-name allowlist.
 * Every ID must independently resolve into the enrolled account before dispatch.
 * Unknown node families fail closed until a typed ownership proof is added. */
export function relevantGraphqlNodeId(input,entry){
  const source=input?.input;
  if(!source||typeof source!=='object'||Array.isArray(source))
    throw new TypeError('Universal GraphQL mutation needs one typed input object.');
  const mutationField=entry?.schema?.getMutationType()?.getFields()?.[entry.mutation];
  const arg=mutationField?.args?.find(x=>x.name==='input');
  if(!arg)throw new TypeError('GraphQL mutation has no independently typed input.');
  const ids=[];
  const walk=(value,type,key,depth=0)=>{
    if(depth>12)throw new TypeError('GraphQL ID input nesting exceeds safe bound.');
    while(isNonNullType(type))type=type.ofType;
    if(isListType(type)){
      if(!Array.isArray(value)||value.length>12)
        throw new TypeError('GraphQL resource ID array must be bounded.');
      value.forEach(v=>walk(v,type.ofType,key,depth+1));
      return;
    }
    const named=getNamedType(type);
    if(named?.name==='ID'){
      if(typeof value!=='string'||!value)
        throw new TypeError('GraphQL '+key+' must be an existing node ID.');
      ids.push({name:key,value});
      return;
    }
    if(isInputObjectType(named)){
      if(value===null||typeof value!=='object'||Array.isArray(value))
        throw new TypeError('GraphQL resource input is not an object.');
      for(const [name,val] of Object.entries(value)){
        const field=named.getFields()[name];
        if(!field)throw new TypeError('Unknown typed GraphQL input '+name+'.');
        walk(val,field.type,name,depth+1);
      }
    }
    // String-typed option identifiers (iterationId,
    // singleSelectOptionId, multiSelectOptionIds) are NOT node IDs.
  };
  walk(source,arg.type,'input');
  if(ids.length<1||ids.length>12||new Set(ids.map(x=>x.value)).size!==ids.length)
    throw new TypeError('Universal GraphQL mutation requires one to twelve distinct schema-typed node IDs.');
  const primary=ids.find(x=>x.name==='projectId')??ids.find(x=>/discussionId|issueId|pullRequestId|repositoryId|subjectId/.test(x.name))??ids[0];
  const keys=new Set(ids.map(x=>x.name));
  return {...primary,ids,changes:Object.fromEntries(Object.entries(source).filter(([name])=>name!=='clientMutationId'&&!keys.has(name)))};
}
