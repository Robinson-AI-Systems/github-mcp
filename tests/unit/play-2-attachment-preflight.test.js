import {mkdtemp,mkdir,writeFile,symlink,rm,open} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {afterEach,describe,expect,it} from 'vitest';
import {measureWorkspace,SEALED_LIMIT_BYTES,SEALED_LIMIT_ENTRIES} from '../../tools/playground-device/measure-workspace.mjs';

const roots=[];
async function root(){
 const dir=await mkdtemp(join(tmpdir(),'play2-measure-'));roots.push(dir);
 return dir;
}
function git(cwd,...args){
 return execFileSync('git',['-C',cwd,...args],{encoding:'utf8',
  env:{...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0'}});
}
async function createNative(){
 const dir=await root(),repo=join(dir,'repo'),binding='a'.repeat(64);
 await mkdir(repo);
 git(repo,'init','-q','-b','main');
 git(repo,'config','user.name','Fixture');git(repo,'config','user.email','fixture@example.test');
 await writeFile(join(repo,'tracked.txt'),'version1\n');
 git(repo,'add','tracked.txt');git(repo,'commit','-q','-m','fixture');
 await writeFile(join(dir,'workspace.json'),JSON.stringify({state:'ready',generation:3,binding}));
 await mkdir(join(dir,'control'));await writeFile(join(dir,'control','receipt.json'),'{}');
 return {dir,repo,binding};
}
afterEach(async()=>{for(const dir of roots.splice(0))await rm(dir,{recursive:true,force:true});});

describe('PLAY-2 safe on-device attachment measurement',()=>{
 it('measures the exact native root, including Git metadata; never emits file paths or contents',async()=>{
  const {dir,repo,binding}=await createNative();
  await mkdir(join(repo,'node_modules'));
  await writeFile(join(repo,'node_modules','credential-looking-file.txt'),'ghp_FAKE-not-a-token');
  const report=await measureWorkspace({root:dir,kind:'native',expectedBinding:binding});
  expect(report).toMatchObject({kind:'native',source:'local_read_only',
   nativeState:'ready',generation:3,bindingPresent:true,
   symlinks:0,sourceStableDuringScan:true,sealedTransferCandidate:true,actualTransferVerified:false});
  expect(report.gitHead).toMatch(/^[a-f0-9]{40}$/);
  expect(report.rawBytes).toBeGreaterThan(0);
  expect(report.categoryBytes.generated).toBeGreaterThan(0);
  expect(report.categoryBytes.git_metadata).toBeGreaterThan(0);
  expect(report.maxSealedEntries).toBe(SEALED_LIMIT_ENTRIES);
  const exposed=JSON.stringify(report);
  expect(exposed).not.toContain('credential-looking-file');
  expect(exposed).not.toContain('ghp_FAKE');
  expect(exposed).not.toContain(dir);
  expect((await measureWorkspace({root:dir,kind:'native',expectedBinding:'b'.repeat(64)})).sealedTransferCandidate).toBe(false);
 });
 it('never mistakes an ordinary Git checkout for a complete workspace export',async()=>{
  const {repo}=await createNative();
  await writeFile(join(repo,'uncommitted.txt'),'dirty data\n');
  const result=await measureWorkspace({root:repo,kind:'repository'});
  expect(result).toMatchObject({kind:'repository',dirty:true,rawLimitsFit:true,sealedTransferCandidate:false});
  expect(result.note).toMatch(/Repository-only proxy/);
 });
 it('measures and rejects symlinks without traversing them',async()=>{
  const {dir,repo,binding}=await createNative();
  const foreign=await root();await writeFile(join(foreign,'outside.txt'),'private data');
  await symlink(foreign,join(repo,'outside-link'));
  const result=await measureWorkspace({root:dir,kind:'native',expectedBinding:binding});
  expect(result).toMatchObject({symlinks:1,rawLimitsFit:false,sealedTransferCandidate:false});
  expect(JSON.stringify(result)).not.toContain('outside.txt');
  await expect(measureWorkspace({root:join(repo,'outside-link'),kind:'repository'})).rejects.toThrow();
 });
 it('rejects oversized sparse files even when filenames and file bytes are never read',async()=>{
  const {dir,repo,binding}=await createNative(),handle=await open(join(repo,'oversize.bin'),'w');
  try{await handle.truncate(SEALED_LIMIT_BYTES+1);}finally{await handle.close();}
  const result=await measureWorkspace({root:dir,kind:'native',expectedBinding:binding});
  expect(result.rawBytes).toBeGreaterThan(SEALED_LIMIT_BYTES);
  expect(result.rawLimitsFit).toBe(false);
  expect(result.sealedTransferCandidate).toBe(false);
  expect(result.largestFileBytes).toBe(SEALED_LIMIT_BYTES+1);
 });
 it('remains explicitly incomplete under a tight traversal cap and refuses a malformed binding',async()=>{
  const {dir,binding}=await createNative();
  const result=await measureWorkspace({root:dir,kind:'native',expectedBinding:binding,maxWalkEntries:2});
  expect(result).toMatchObject({complete:false,rawLimitsFit:false,sealedTransferCandidate:false});
  await expect(measureWorkspace({root:dir,kind:'native',expectedBinding:'bad'})).rejects.toThrow();
 });
});
