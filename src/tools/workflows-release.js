import { completeDispatchResult, guardedResultBody } from '../core/result-envelope.js';
// W-6: staged release and PR-evidenced cleanup; mutations only through guarded writers.
import {createHash} from 'node:crypto';
import {matchesAny,productionNames} from './production-guard.js';
const OWNER={type:'string',maxLength:39},REPO={type:'string',minLength:1,maxLength:100};
const TEXT={type:'string',minLength:1,maxLength:250},ID={type:'integer',minimum:1};
const common={owner:OWNER,repo:REPO,confirm:{type:'boolean'},dryRun:{type:'boolean'},requestKey:{type:'string',minLength:4,maxLength:128}};
const scope=a=>({...a.owner?{owner:a.owner}:{},repo:a.repo});
const receipt=(v,error=false)=>({structuredContent:v,content:[{type:'text',text:JSON.stringify(v)}],...error?{isError:true}:{}});
const refused=reason=>receipt({done:false,status:'refused',reason},true);
const shape=r=>r&&!r.isError?completeDispatchResult(r)??null:null;
const incomplete=x=>!x||x.more_exist||x.next_page_possible||x.kept_result||x.complete===false;
const key=(a,step,ctx)=>'w6-'+createHash('sha256').update(JSON.stringify([a.requestKey,{owner:a.owner??ctx.connection.default_account,repo:a.repo},step])).digest('hex');
const budget=(ctx,start)=>ctx.now()-start<46000;
async function invoke(ctx,name,args){return shape(await ctx.callTool(name,args));}
async function change(ctx,name,args){
  const result=await ctx.callTool(name,args);
  return guardedResultBody(result)??{status:result?.isError?'refused':'unknown',
    reason:(result?.content?.find(x=>x.type==='text')?.text??'No verified guarded result.').slice(0,400)};
}
// Reader results can be retained even when provider pagination was complete.
// Consume connection-bound pages; a lost/changed/shortened page never authorizes a write.
async function readInventory(ctx,tool,args,start){
  const first=await invoke(ctx,tool,args);
  if(!first?.kept_result)return first;
  const handle=first.kept_result.handle;
  if(!handle)return null;
  const items=[];let size=100,total=null,pages=null;
  for(let page=1;page<=25;page++){
    if(!budget(ctx,start))return null;
    const part=await invoke(ctx,'github_get_result',{handle,page,pageSize:size,...args.fields?{fields:args.fields}:{}});
    const info=part?.page_info;
    if(!part||part.handle!==handle||part.shown!==undefined||part.text_cut||!info||info.page!==page||
      !Array.isArray(part.items)||!Number.isInteger(info.total)||info.total<0||info.total>500||
      !Number.isInteger(info.page_size)||info.page_size<1||!Number.isInteger(info.pages)||info.pages<1||info.pages>25)return null;
    if(page===1){size=info.page_size;total=info.total;pages=info.pages;}
    else if(info.page_size!==size||info.total!==total||info.pages!==pages)return null;
    items.push(...part.items);
    if(page===pages){
      if(items.length!==total)return null;
      const {kept_result:retained,...metadata}=first;
      void retained;
      return {...metadata,items,count:items.length};
    }
  }
  return null;
}
export function nextVersion(tag,bump){
  const match=/^(v?)(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(tag??'');
  if(!match)return null;
  const parts=match.slice(2).map(Number);
  if(!parts.every(Number.isSafeInteger))return null;
  const i={major:0,minor:1,patch:2}[bump];
  if(i===undefined)return null;
  parts[i]++;for(let j=i+1;j<3;j++)parts[j]=0;
  return parts.every(Number.isSafeInteger)?match[1]+parts.join('.'):null;
}
export async function release(a,ctx){
  if(ctx.connection.profile!=='full')return refused('Release workflows require the full profile.');
  const start=ctx.now(),s=scope(a);
  let tag=a.tag,previous=a.from;
  if(['next-patch','next-minor','next-major'].includes(tag)){
    if(a.publish||a.confirm&&!a.dryRun)return refused('Freeze the computed version as an explicit tag before confirming any change.');
    const latest=await invoke(ctx,'github_release_get',{...s,selector:'latest'});
    if(!latest||latest.not_found)return refused('No readable latest published release; provide an explicit initial tag.');
    tag=nextVersion(latest.tag_name,a.tag.slice(5));previous=previous??latest.tag_name;
    if(!tag)return refused('Latest release is not a stable three-part version; provide an explicit tag.');
    return receipt({done:false,status:'version_planned',tag,previous_tag:previous,
      next:'Repeat with this explicit tag to preview a draft; publication is a separate confirmed step.'});
  }
  const inventory=[];
  let exhausted=false;
  for(let page=1;page<=10;page++){
    if(!budget(ctx,start))return receipt({done:false,status:'pending',next:'Resume release inventory; no change was attempted.'});
    const list=await readInventory(ctx,'github_release_list',{...s,page,max:30,fields:['id','tag_name','draft']},start);
    if(!list||list.kept_result||!Array.isArray(list.items))return refused('Complete release inventory is unavailable; duplicate creation cannot be excluded.');
    inventory.push(...list.items);
    if(!list.next_page_possible){exhausted=true;break;}
  }
  if(!exhausted)return refused('Release inventory exceeded its bounded pages; select a narrower supported release operation.');
  const matches=inventory.filter(x=>x.tag_name===tag);
  if(matches.length>1)return refused('Multiple releases have the same tag; resolve the ambiguity explicitly.');
  const found=matches[0];
  if(found){
    const current=await invoke(ctx,'github_release_get',{...s,selector:'id',releaseId:found.id});
    if(!current||current.tag_name!==tag||typeof current.draft!=='boolean')return refused('Release changed or is unreadable; no publication attempted.');
    if(!current.draft)return receipt({done:true,status:'already_published',tag,release_id:current.id,html_url:current.html_url});
    if(!a.publish)return receipt({done:true,status:'draft_ready',tag,release_id:current.id,html_url:current.html_url,
      next:'Review the draft. To publish, supply publish=true and this exact releaseId with independent production confirmation.'});
    if(a.releaseId!==current.id)return refused('Publication requires the exact independently observed draft releaseId.');
    if(!a.requestKey)return refused('Publication requires a stable requestKey for safe recovery.');
    if(!budget(ctx,start))return receipt({done:false,status:'pending',next:'Resume before publishing; the workflow budget expired.'});
    const result=await change(ctx,'github_release_update',{...s,releaseId:current.id,expectedTag:tag,draft:false,
      dryRun:a.dryRun===true||a.confirm!==true,confirm:a.confirm===true,requestKey:key(a,'publish:'+current.id,ctx)});
    if(result?.status!=='applied')return receipt({done:false,status:'not_published',underlying_status:result?.status??'unknown',result,
      next:'Inspect the guarded result and draft state before retrying with the same requestKey.'});
    const after=await invoke(ctx,'github_release_get',{...s,selector:'id',releaseId:current.id});
    const verified=after?.id===current.id&&after.tag_name===tag&&after.draft===false;
    return receipt({done:verified,status:verified?'published':'unverified',tag,release_id:current.id,
      next:verified?'Publication independently verified.':'Reconcile this exact release before retrying; no automatic publication retry.'});
  }
  if(a.publish||a.releaseId)return refused('No existing matching draft; publication never creates and publishes in one invocation.');
  if(a.confirm&&!a.dryRun&&!a.requestKey)return refused('Draft creation requires a stable requestKey.');
  if(!budget(ctx,start))return receipt({done:false,status:'pending',next:'Resume draft preparation before changing anything.'});
  const result=await change(ctx,'github_release_create',{...s,tag,draft:true,generateReleaseNotes:true,previewGeneratedNotes:true,
    ...(previous?{previousTag:previous}:{}),...(a.target?{targetCommitish:a.target}:{}),
    dryRun:a.dryRun===true||a.confirm!==true,confirm:a.confirm===true,
    ...(a.requestKey?{requestKey:key(a,'draft:'+tag,ctx)}:{})});
  return receipt({done:false,status:result?.status==='applied'?'draft_created':'draft_not_created',tag,
    underlying_status:result?.status??'unknown',result,
    next:'Repeat this explicit tag to independently inspect the draft; never request another next-version calculation as recovery.'});
}
async function policy(ctx,owner,repo){
  // Optional policy absent is fine; missing/unreadable policy store is not proof of absence.
  if(typeof ctx.db?.profileForRepository!=='function')return null;
  try{await ctx.db.getSetting('production_names');return {profile:(await ctx.db.profileForRepository(owner,repo))??{},names:await productionNames(ctx.db)};}catch{return null;}
}
export async function cleanup(a,ctx){
  if(!['everyday','full'].includes(ctx.connection.profile))return refused('Cleanup requires everyday or full profile.');
  const start=ctx.now(),s=scope(a),owner=a.owner??ctx.connection.default_account;
  const repo=await invoke(ctx,'github_repo_get',s);
  if(!repo?.default_branch)return refused('Default branch could not be verified.');
  const p=await policy(ctx,owner,a.repo);
  if(!p)return refused('Project and production policy could not be verified.');
  const branches=await readInventory(ctx,'github_branch_list',{...s,max:500,detail:'full',fields:['name','protected','commit.sha']},start);
  if(incomplete(branches)||!Array.isArray(branches.items))return refused('Branch inventory is incomplete; no branch deletion attempted.');
  const selected=a.branches??branches.items.map(x=>x.name);
  const unknown=selected.find(name=>!branches.items.some(x=>x.name===name));
  if(unknown)return refused('A selected branch is not present in the complete inventory: '+unknown);
  const results=[];
  for(const name of selected){
    if(!budget(ctx,start))return receipt({done:false,status:'pending',results,next:'Repeat the same selection; fresh inventory skips already removed branches. Omit deleted names when explicitly selecting.'});
    const branch=branches.items.find(x=>x.name===name),sha=branch.commit?.sha??branch.sha;
    const skip=reason=>results.push({branch:name,status:'excluded',reason});
    if(name===repo.default_branch||branch.protected!==false){skip('Default, protected or unknown-protection branch.');continue;}
    if(matchesAny(name,[...p.names.branches,...p.profile.productionBranches??[]])||
      (p.profile.ownedRefs??[]).some(x=>matchesAny(name,[x.pattern]))){skip('Production or project-owned branch.');continue;}
    const exact=await invoke(ctx,'github_branch_get',{...s,branch:name});
    if(!exact||exact.head!==sha||exact.protected!==false||!Array.isArray(exact.rules)||exact.rules.length){skip('Branch changed, has rules, or effective protection is unreadable.');continue;}
    const prs=await readInventory(ctx,'github_pr_list',{...s,state:'all',head:owner+':'+name,max:200,detail:'full',fields:['number','state','head.ref','head.sha','head.repo.full_name']},start);
    if(incomplete(prs)||!Array.isArray(prs.items)){skip('PR inventory incomplete; closed state cannot be proven.');continue;}
    const same=prs.items.filter(x=>x.head?.ref===name&&x.head?.repo?.full_name?.toLowerCase()===`${owner}/${a.repo}`.toLowerCase());
    if(same.some(x=>x.state==='open')){skip('An open PR still uses this branch.');continue;}
    const closed=same.find(x=>x.state==='closed'&&x.head?.sha===sha);
    if(!closed){skip('No closed or merged PR records this exact unchanged branch head.');continue;}
    const preview=a.dryRun===true||a.confirm!==true;
    if(!preview&&!a.requestKey)return refused('Cleanup execution requires a stable requestKey.');
    if(!budget(ctx,start))return receipt({done:false,status:'pending',results,next:'Resume before deleting the next branch.'});
    const result=await change(ctx,'github_branch_delete',{...s,branch:name,expectedHeadSha:sha,cleanupPrNumber:closed.number,
      confirm:a.confirm===true,dryRun:preview,...a.requestKey?{requestKey:key(a,'cleanup:'+name+':'+sha,ctx)}:{}});
    results.push({branch:name,head_sha:sha,pr:closed.number,status:result?.status??'unknown',result});
    if(preview&&result?.status!=='preview')return receipt({done:false,status:'refused',results,next:'The guarded writer did not validate this preview; resolve its exact refusal before execution.'});
    if(!preview&&result?.status!=='applied')return receipt({done:false,status:'stopped',results,next:'Reconcile this exact guarded deletion result before continuing; untouched branches were not attempted.'});
    if(!preview){
      if(!budget(ctx,start))return receipt({done:false,status:'pending',results,next:'Re-read branch inventory to verify absence before doing any more cleanup.'});
      const after=await readInventory(ctx,'github_branch_list',{...s,max:500,fields:['name']},start);
      if(incomplete(after)||!Array.isArray(after.items)||after.items.some(x=>x.name===name))
        return receipt({done:false,status:'unverified',results,next:'Fresh inventory did not prove absence; inspect possible replay, recreation or permission failure before continuing.'});
      results[results.length-1].absence_confirmed=true;
    }
  }
  return receipt({done:true,status:a.dryRun||!a.confirm?'preview':'complete',results,
    note:'Exclusions were preserved. Provider DELETE has no atomic expected-SHA argument; fresh pre-delete evidence and absence readback cannot remove the remaining provider race.'});
}
const make=(name,description,audience,profiles,delegatedWrites,properties,handler)=>({tool:{name,description,area:'workflow',audience,usesRegistry:true,passthrough:true,boundsResult:true,profiles,delegatedWrites,
  inputSchema:{type:'object',properties:{...common,...properties},required:['repo',...(name.endsWith('_release')?['tag']:[])],additionalProperties:false},
  annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:true}},handler});
const definitions=[
  make('github_workflow_release','Plan a version, create a draft with generated notes, then separately publish an exact confirmed draft through guarded tools.',['B'],['full'],['github_release_create','github_release_update'],{tag:TEXT,from:TEXT,target:TEXT,publish:{type:'boolean'},releaseId:ID},release),
  make('github_workflow_cleanup_branches','Preview and delete unchanged closed-PR branches while excluding default, protected, production and project-owned refs.',['B','Op'],['everyday','full'],['github_branch_delete'],{branches:{type:'array',items:TEXT,maxItems:100,uniqueItems:true}},cleanup)
];
export const tools=definitions.map(x=>x.tool);
export const handlers=Object.fromEntries(definitions.map(x=>[x.tool.name,x.handler]));
