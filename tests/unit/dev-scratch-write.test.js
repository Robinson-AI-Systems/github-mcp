import {describe,expect,it} from 'vitest';
import {runWriteContract,makeWorld,parse} from '../../test/helpers/write-contract.js';
import * as scratch from '../../src/tools/dev-scratch-write.js';
import {requireScratchOrg} from '../../src/dev/scratch.js';
import {runDevMutationOnce} from '../../src/dev/execute.js';

const NAME='fixture-repo', RUN='run-scratch-101', MARKER=`rtc_run=${RUN}`;
const def={tool:scratch.tools[0],handler:scratch.handlers.github_dev_create_scratch_repo};
const repository=(changes={})=>({name:NAME,full_name:`example-org/${NAME}`,private:true,
  visibility:'private',description:`Scratch fixture for ${MARKER}`,default_branch:'main',...changes});
const arrange=(gh,outcome)=>{
  gh.when('GET /repos/{owner}/{repo}').replySequence([
    {status:404,body:{message:'Not Found'}},
    {status:200,body:repository(outcome==='mismatch'?{private:false}:{})}
  ]);
  gh.when('POST /orgs/{org}/repos').reply(201,repository());
  gh.when('GET /repos/{owner}/{repo}/labels').reply(200,[
    {id:11,name:'bug',color:'D73A4A',description:'First observed GitHub label'}
  ]);
  gh.when('GET /repos/{owner}/{repo}/git/ref/{ref}').reply(200,{
    ref:'refs/heads/main',object:{sha:'a'.repeat(40)}
  });
};

runWriteContract({
  label:'github_dev_create_scratch_repo',definition:def,
  args:{runId:RUN,name:NAME},scratchAccount:true,previewOnly:true,needsConfirm:false,arrange
});
describe('V-1 scratch-account preflight and durable execution',()=>{
  it('refuses non-scratch accounts before the first GitHub read or write',async()=>{
    const w=await makeWorld();
    const out=parse(await def.handler({runId:RUN,name:NAME,confirm:true},w.ctx));
    expect(out.done).toBe(false);
    expect(w.gh.calls).toEqual([]);
    expect(await w.db.getDevRun({id:RUN,account:'example-org',connection:'client-1'})).toBeNull();
  });
  it('preserves production-mode restriction for non-owner scratch connections before any read',async()=>{
    const w=await makeWorld({scratchAccount:true,mode:'production'});
    const out=parse(await def.handler({runId:RUN,name:NAME,confirm:true},w.ctx));
    expect(out.status).toBe('refused');
    expect(w.gh.calls).toEqual([]);
  });
  it('executes the full owner scratch lifecycle entry in production mode and records exact origin',async()=>{
    const w=await makeWorld({scratchAccount:true,mode:'production',profile:'full'});arrange(w.gh,'ok');
    const out=parse(await def.handler({runId:RUN,name:NAME},w.ctx));
    expect(out).toMatchObject({status:'applied',confirmed:true});
    expect(w.gh.calls.filter(c=>c.method==='POST')).toHaveLength(1);
    expect(w.gh.invalid).toEqual([]);
  });
  it('does not mistake a full-profile restricted pass for its owner',async()=>{
    const w=await makeWorld({scratchAccount:true,mode:'production',profile:'full',delegated:true});
    const out=parse(await def.handler({runId:RUN,name:NAME},w.ctx));
    expect(out.status).toBe('refused');expect(w.gh.calls).toEqual([]);
  });
  it('validates trusted App installation, org type and all-repo selection',async()=>{
    const w=await makeWorld({scratchAccount:true});
    await expect(requireScratchOrg(w.ctx,'example-org')).resolves.toMatchObject({is_scratch:true});
    await w.db.setInstallation('example-org',{installationId:902,repositorySelection:'selected',
      permissions:{contents:'write'},status:'active'});
    await expect(requireScratchOrg(w.ctx,'example-org')).rejects.toThrow(/IN-06/);
    expect(w.gh.calls).toEqual([]);
  });
  it('refuses an unverified readback marker that belongs to a longer run ID',async()=>{
    const w=await makeWorld({scratchAccount:true});
    w.gh.when('GET /repos/{owner}/{repo}').replySequence([
      {status:404,body:{message:'Not Found'}},
      {status:200,body:repository({description:`Scratch fixture for rtc_run=${RUN}-other`})}
    ]);
    w.gh.when('POST /orgs/{org}/repos').reply(201,repository());
    w.gh.when('GET /repos/{owner}/{repo}/labels').reply(200,[]);
    w.gh.when('GET /repos/{owner}/{repo}/git/ref/{ref}').reply(200,{
      ref:'refs/heads/main',object:{sha:'a'.repeat(40)}
    });
    const out=parse(await def.handler({runId:RUN,name:NAME,confirm:true},w.ctx));
    expect(out.done).toBe(false);
    expect(w.gh.calls.filter(x=>x.method==='POST')).toHaveLength(1);
    expect(w.gh.invalid).toEqual([]);
  });
  it('leaves an uncertain claim when initial repository SHA cannot be read',async()=>{
    const w=await makeWorld({scratchAccount:true});arrange(w.gh,'ok');
    w.gh.when('GET /repos/{owner}/{repo}/git/ref/{ref}').reply(200,{
      ref:'refs/heads/main',object:{sha:'not-a-commit'}});
    const out=parse(await def.handler({runId:RUN,name:NAME,confirm:true},w.ctx));
    expect(out.done).toBe(false);
    const intent=await w.db.getDevIntent({runId:RUN,account:'example-org',
      connection:'client-1',stepId:'create-scratch-repo'});
    expect(intent.status).toBe('uncertain');
    expect(w.gh.calls.filter(x=>x.method==='POST')).toHaveLength(1);
    expect(w.gh.invalid).toEqual([]);
  });
  it('records the real repository full_name once and never blindly retries a claimed step',async()=>{
    const w=await makeWorld({scratchAccount:true});arrange(w.gh,'ok');
    const out=parse(await def.handler({runId:RUN,name:NAME,confirm:true},w.ctx));
    expect(out).toMatchObject({status:'applied',confirmed:true});
    const objects=await w.db.listDevObjects({runId:RUN,account:'example-org',connection:'client-1'});
    expect(objects).toEqual([expect.objectContaining({object_type:'repo',object_id:`example-org/${NAME}`,created_sha:'a'.repeat(40)})]);
    const intent=await w.db.getDevIntent({runId:RUN,account:'example-org',connection:'client-1',stepId:'create-scratch-repo'});
    expect(intent).toMatchObject({status:'recorded',object_id:`example-org/${NAME}`});
    expect(await w.db.getDevBirthLabels({runId:RUN,account:'example-org',connection:'client-1'}))
      .toMatchObject({repo:NAME,source_sha:'a'.repeat(40),labels:[
        {id:11,name:'bug',color:'d73a4a',description:'First observed GitHub label'}]});
    const same=await runDevMutationOnce(w.ctx,{runId:RUN,account:'example-org',connection:'client-1',
      stepId:'create-scratch-repo',type:'repo',owner:'example-org',repo:NAME,objectName:NAME,
      create:async()=>{throw new Error('duplicate GitHub operation');}});
    expect(same).toMatchObject({replayed:true,objectId:`example-org/${NAME}`});
  });
});
