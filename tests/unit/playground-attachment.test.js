import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {NativeGitWorker} from '../../workers/native-git/engine.js';
import {attachmentRequest} from '../../workers/native-git/attachment.js';
it('seals, pages, resumes and attaches real uncommitted Git state with owned source finalization locking',async()=>{
 const root=await mkdtemp(join(tmpdir(),'attachment-')),seed=join(root,'seed');await mkdir(seed);const git=(...args)=>execFileSync('git',args,{cwd:seed,stdio:'pipe'});
 const binding={authority:'fixture',connection:'fixture',owner:'example-org',repo:'hello'};
 try{
  git('init','-b','main');git('config','user.name','Fixture');git('config','user.email','fixture@example.test');await writeFile(join(seed,'file.txt'),'base\n');git('add','.');git('commit','-m','base');
  const source=new NativeGitWorker({root:join(root,'source'),authorize:async()=>true,allowLocalFixtures:true}),target=new NativeGitWorker({root:join(root,'target'),authorize:async()=>true,allowLocalFixtures:true});
  const {workspace_id:id}=await source.create(binding,{fixtureRemote:seed,requestKey:'open'});
  let generation=(await source.inspect(id,binding)).generation;
  const changed=Buffer.alloc(700000,3);await source.execute(id,binding,{operation:'write_file',args:{path:'uncommitted.bin',base64:changed.toString('base64')},requestKey:'edit',expectedGeneration:generation});generation=(await source.inspect(id,binding)).generation;
  const key=Buffer.alloc(32,7).toString('base64'),transferId='a'.repeat(64);
  const invoke=(worker,action,options)=>attachmentRequest(worker,{action,binding,workspace_id:id,allowWrite:true,options},{singleWorkspaceId:worker===target?id:undefined});
  const exported=await invoke(source,'attachment_export',{mode:'prepare',key,transferId,expectedGeneration:generation});expect(exported.bytes).toBeGreaterThan(changed.length);
  await invoke(target,'attachment_import',{mode:'begin',transferId,bytes:exported.bytes,digest:exported.digest});let offset=0;
  while(offset<exported.bytes){const page=await invoke(source,'attachment_export',{mode:'read',transferId,offset});const state=await invoke(target,'attachment_import',{mode:'append',transferId,offset,base64:page.base64});offset=state.offset;expect((await invoke(target,'attachment_import',{mode:'begin',transferId,bytes:exported.bytes,digest:exported.digest})).offset).toBe(offset);}
  await invoke(source,'attachment_export',{mode:'freeze',transferId});
  await expect(source.execute(id,binding,{operation:'write_file',args:{path:'late.txt',base64:'eA=='},requestKey:'late',expectedGeneration:generation})).rejects.toThrow(/Workspace is leased/);
  const imported=await invoke(target,'attachment_import',{mode:'finish',transferId,key});expect(imported.complete).toBe(true);expect(imported.generation).toBe(generation);
  expect(await readFile(join(root,'target',id,'repo','uncommitted.bin'))).toEqual(changed);
  const [a,b]=await Promise.all([source.inspect(id,binding),target.inspect(id,binding)]);expect(b.head).toBe(a.head);expect(b.status).toBe(a.status);
  expect((await invoke(target,'attachment_import',{mode:'finish',transferId,key})).replayed).toBe(true);
  await invoke(source,'attachment_export',{mode:'release',transferId});await invoke(source,'attachment_export',{mode:'release',transferId});
  expect((await source.execute(id,binding,{operation:'write_file',args:{path:'late.txt',base64:'eA=='},requestKey:'late',expectedGeneration:generation})).status).toBe('applied');
 }finally{await rm(root,{recursive:true,force:true});}
});
