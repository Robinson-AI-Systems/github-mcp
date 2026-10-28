import { isOwnerConnection } from '../core/authority.js';
import { redact } from './util.js';
// V-2 read-only remote cleanup rehearsal. No freeze, closing PRs or DELETE.
import {ownerOf,octo,refusal} from './github-write.js';
import {readCleanupRun,inspectScratchArtifacts} from '../dev/cleanup-execute.js';
import {listAll} from '../github/client.js';
import {compareObservedScratchLabels} from '../dev/label-drift.js';
import {summarizeScratchBirth} from '../dev/birth-report.js';


function reasonCode(error) {
  const s=String(error?.message??'').toLowerCase();
  if(/active or unresolved cleanup execution/.test(s))return 'CLEANUP_EXECUTION_UNRESOLVED';
  if(/unrecorded or ambiguous label|recorded scratch labels|label was repurposed/.test(s))
    return 'LABEL_PROVENANCE_UNVERIFIED';
  if(/inventory|capped|pagination|truncated|incomplete|total_count/.test(s))
    return 'INCOMPLETE_REMOTE_INVENTORY';
  if(/permission|forbidden|unauthoriz|access denied/.test(s))
    return 'REMOTE_PERMISSION_DENIED';
  if(/default branch|commit|head|sha|moved|retarget/.test(s))
    return 'REMOTE_STATE_CHANGED';
  if(/foreign|unrecorded|not exact|mismatch|replaced|repurposed/.test(s))
    return 'FOREIGN_OR_CHANGED_RESOURCE';
  return 'REMOTE_PREFLIGHT_REFUSED';
}
export function cleanupPreflightResult({runId,owner,repo,phase,blocker=null,snapshot=null}) {
  return {
    run_id:runId,owner,repo,phase,
    status:blocker?'blocked':'remote_snapshot_accepted',
    blocker_code:blocker?reasonCode(blocker):null,
    blocker_detail:blocker&&blocker.status===422?redact(String(blocker.message)).slice(0,300):null,
    ...(snapshot?{inventory_counts:{
      branches:snapshot.branch_count,pull_requests:snapshot.pr_count,
      issues:snapshot.issue_count,tags:snapshot.tag_count,
      releases:snapshot.release_count,rulesets:snapshot.ruleset_count,
      labels:snapshot.label_count,workflows:snapshot.workflow_count}}:{}),
    deletion_authorized:false,destructive_operations_performed:false,
    persistent_cleanup_freeze:false,snapshot_atomic:false,
    connected_acceptance_proven:false,
    next_action:blocker
      ? 'Resolve this precise inventory or ownership refusal; inspect the unchanged run and remote resources. No deletion was attempted.'
      : 'Fresh independent preflights, current owner consent, and the guarded cleanup write are STILL required before any deletion.'
  };
}

async function auditBirthDrift(args,ctx,{owner,state,github}){
  const connection=ctx.connection.client_id,runId=args.runId,repo=args.repo;
  const [birth,intents]=await Promise.all([
    ctx.db.getDevBirthLabels({runId,account:owner,connection}),
    ctx.db.listDevIntents({runId,account:owner,connection,limit:50})
  ]);
  const report=summarizeScratchBirth({run:state.run,objects:state.objects,
    intents,birth,listingComplete:state.objects.length<50&&intents.length<50});
  if(!report.journal_binding_verified)
    return {state:report.state,journal_binding_verified:false,
      creator_provenance_verified:false,deletion_authorized:false};
  const {items,capped}=await listAll(github,'GET /repos/{owner}/{repo}/labels',
    {owner,repo,per_page:100},{max:100});
  if(capped)throw refusal('Live label inventory is incomplete; no ownership inference.');
  const delta=compareObservedScratchLabels(birth.labels,items);
  const head=(await github.request('GET /repos/{owner}/{repo}/git/ref/{ref}',{
    owner,repo,ref:`heads/${state.existing.default_branch}`
  })).data;
  const workflow=state.objects.find(x=>x.object_type==='workflow_file');
  const expectedSha=workflow?.created_sha??birth.source_sha;
  const unchanged=/^[a-f0-9]{40}$/.test(expectedSha??'')&&head?.object?.sha===expectedSha;
  return {state:'compared',journal_binding_verified:true,
    default_branch_commit_unchanged:unchanged,...delta};
}
export async function inspectCleanupPreview(args,ctx){
    if(!isOwnerConnection(ctx.connection)&&ctx.connection?.mode!=='preview')
      throw new TypeError('Developer cleanup inspection is preview-only.');
    const requested=ownerOf(args,ctx);
    const owner=ctx.connection?.accounts?.find(a=>a.toLowerCase()===requested.toLowerCase());
    if(!owner)throw new TypeError('This account is not in your connection.');
    const base={runId:args.runId,owner,repo:args.repo};
    let state;
    try{
      if(await ctx.db.getDevCleanupExecution({runId:args.runId,account:owner,connection:ctx.connection.client_id}))
        throw refusal('This run has an active or unresolved cleanup execution; resolve it before requesting another cleanup.');
      // Same scoped journal, exact repo and scratch-org checks as destructive
      // cleanup. Never hold an open-world GitHub read error to mean "empty".
      state=await readCleanupRun(ctx,owner,args.repo,args.runId);
    }catch(error){
      if([401,403,422].includes(error?.status)||error instanceof TypeError)
        return cleanupPreflightResult({...base,phase:'journal_or_scope',blocker:error});
      throw error;
    }
    if(!state.deleteRepository) {
      // readCleanupRun itself already performed independent standalone resource
      // checks. This read does not acquire the freeze or reserve write authority.
      return cleanupPreflightResult({...base,phase:'standalone_resources'});
    }
    if(!state.existing)
      return cleanupPreflightResult({...base,phase:'repository_absent',blocker:
        refusal('Exact scratch repository is missing; reconcile the journal and remote state.')});
    const github=await octo(ctx,owner);
    let labelAudit=null;
    try{
      if(args.includeBirthLabels)
        labelAudit=await auditBirthDrift(args,ctx,{owner,state,github});
      const snapshot=await inspectScratchArtifacts(github,{
        owner,repo:args.repo,run:state.run,objects:state.objects,intents:state.intents,birth:state.birth,
        defaultBranch:state.existing.default_branch
      });
      return {...cleanupPreflightResult({...base,phase:'scratch_remote_inventory',snapshot}),...(labelAudit?{birth_label_drift:labelAudit}:{})};
    }catch(error){
      if([401,403,422].includes(error?.status)||error instanceof TypeError)
        return {...cleanupPreflightResult({...base,phase:'scratch_remote_inventory',blocker:error}),...(labelAudit?{birth_label_drift:labelAudit}:{})};
      throw error;
    }
}
