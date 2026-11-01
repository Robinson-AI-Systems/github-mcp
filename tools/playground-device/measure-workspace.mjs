// PLAY-2: read-only local preflight of the *actual* native workspace root.
// No repository/file paths, file contents, credentials or secrets leave this tool.
// A plain Git checkout cannot prove the complete encrypted transfer will fit.
import {lstat,readdir,readFile,realpath} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve,join,isAbsolute} from 'node:path';
import {performance} from 'node:perf_hooks';
import {pathToFileURL} from 'node:url';

export const SEALED_LIMIT_BYTES=100*1024*1024;
export const SEALED_LIMIT_ENTRIES=100000;
const BINDING=/^[a-f0-9]{64}$/;
const DIGEST=/^[a-f0-9]{40}$/;
const EXCLUDE=new Set(['mutation.lock','attachment.json','attachment-freeze.json']);
const GENERATED=new Set(['node_modules','.next','.turbo','dist','build','coverage','.cache']);
const deny=()=>new TypeError('This workspace cannot be safely measured; check its local path, permissions and state.');
function category(path,kind){
 const a=path.split('/');
 if(a.some(x=>GENERATED.has(x)))return 'generated';
 if(a.some(x=>x==='.git')||a[0]==='worktrees')return 'git_metadata';
 if(kind==='native'&&a[0]==='control')return 'control';
 return 'workspace';
}
function observeGit(repo){
 const run=args=>execFileSync('git',['-C',repo,...args],{
  encoding:'utf8',timeout:12000,maxBuffer:1024*1024,stdio:['ignore','pipe','ignore'],
  env:{...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_OPTIONAL_LOCKS:'0',GIT_TERMINAL_PROMPT:'0'}
 });
 try{
  const head=run(['rev-parse','--verify','HEAD']).trim().toLowerCase();
  if(!DIGEST.test(head))return {head:null,dirty:'unknown',entries:null};
  const status=run(['status','--porcelain=v1','-z','--untracked-files=normal']);
  return {head,dirty:status.length!==0,entries:status.split('\0').filter(Boolean).length};
 }catch{return {head:null,dirty:'unknown',entries:null};}
}
async function nativeMetadata(root,kind){
 if(kind!=='native')return {nativeState:null,generation:null,bindingPresent:false};
 try{
  const stat=await lstat(join(root,'workspace.json'));
  if(!stat.isFile()||stat.size>65536)return {nativeState:null,generation:null,bindingPresent:false};
  const doc=JSON.parse(await readFile(join(root,'workspace.json'),'utf8'));
  return {nativeState:typeof doc.state==='string'?doc.state.slice(0,32):null,
   generation:Number.isSafeInteger(doc.generation)&&doc.generation>=0?doc.generation:null,
   bindingPresent:BINDING.test(doc.binding??'')};
 }catch{return {nativeState:null,generation:null,bindingPresent:false};}
}
export async function measureWorkspace({root,kind='repository',expectedBinding,maxWalkEntries=125000}={}){
 if(typeof root!=='string'||!isAbsolute(root)||!['native','repository'].includes(kind)||
    !Number.isSafeInteger(maxWalkEntries)||maxWalkEntries<1||maxWalkEntries>200000||
    (expectedBinding!==undefined&&!BINDING.test(expectedBinding)))throw deny();
 const dir=resolve(root),start=performance.now();
 const base=await lstat(dir);
 if(!base.isDirectory()||base.isSymbolicLink()||(await realpath(dir))!==dir)throw deny();
 const beforeGit=observeGit(kind==='native'?join(dir,'repo'):dir);
 const beforeMeta=await nativeMetadata(dir,kind);
 const digest=createHash('sha256');
 const totals={workspace:0,git_metadata:0,control:0,generated:0};
 let files=0,directories=0,links=0,unsupported=0,entries=0,rawBytes=0,largestBytes=0,
  excluded=0,unsafePaths=0,incomplete=false;
 async function walk(base,prefix=''){
  const names=(await readdir(base)).sort();
  for(const name of names){
   const path=prefix?prefix+'/'+name:name;
   if(!prefix&&EXCLUDE.has(path)){excluded++;continue;}
   entries++;
   if(entries>maxWalkEntries){incomplete=true;return;}
   if(path.length>4096||path.includes('\\')||/[\x00-\x1f]/.test(path)||['.','..'].includes(name)){unsafePaths++;continue;}
   const stat=await lstat(join(base,name));
   digest.update(JSON.stringify([path,stat.mode&0o777,stat.size,Math.trunc(stat.mtimeMs),stat.isSymbolicLink()?'link':stat.isDirectory()?'dir':stat.isFile()?'file':'other'])+'\n');
   if(stat.isSymbolicLink()){links++;continue;}
   if(stat.isDirectory()){directories++;await walk(join(base,name),path);if(incomplete)return;continue;}
   if(!stat.isFile()||!Number.isSafeInteger(stat.size)||stat.size<0){unsupported++;continue;}
   files++;rawBytes+=stat.size;largestBytes=Math.max(largestBytes,stat.size);
   totals[category(path,kind)]+=stat.size;
  }
 }
 await walk(dir);
 const afterGit=observeGit(kind==='native'?join(dir,'repo'):dir);
 const afterMeta=await nativeMetadata(dir,kind);
 const stable=JSON.stringify(beforeGit)===JSON.stringify(afterGit)&&
   JSON.stringify(beforeMeta)===JSON.stringify(afterMeta);
 const fitsRaw=rawBytes<=SEALED_LIMIT_BYTES&&entries<=SEALED_LIMIT_ENTRIES&&
   links===0&&unsupported===0&&unsafePaths===0&&!incomplete;
 const report={kind,source:'local_read_only',gitHead:afterGit.head,
  dirty:afterGit.dirty,statusEntries:afterGit.entries,
  generation:afterMeta.generation,nativeState:afterMeta.nativeState,
  bindingPresent:afterMeta.bindingPresent,
  files,directories,symlinks:links,unsupported,invalidPaths:unsafePaths,entries,excluded,
  rawBytes,largestFileBytes:largestBytes,categoryBytes:totals,
  maxSealedBytes:SEALED_LIMIT_BYTES,maxSealedEntries:SEALED_LIMIT_ENTRIES,
  metadataSha256:digest.digest('hex'),elapsedMs:Math.max(0,Math.round(performance.now()-start)),
  complete:!incomplete,sourceStableDuringScan:stable,
  rawLimitsFit:fitsRaw,
  sealedTransferCandidate:kind==='native'&&fitsRaw&&stable&&afterMeta.nativeState==='ready'&&
    afterMeta.generation!==null&&afterMeta.bindingPresent&&
    expectedBinding!==undefined,
  actualTransferVerified:false,
  note:kind==='native'
   ?'Preflight only: an authorized generation-locked encrypted export/import with readback must still succeed.'
   :'Repository-only proxy: native metadata and worktrees are not included; do not infer sealed-transfer fitness.'
 };
 if(expectedBinding!==undefined){
  try{
   const meta=JSON.parse(await readFile(join(dir,'workspace.json'),'utf8'));
   report.sealedTransferCandidate=report.sealedTransferCandidate&&meta.binding===expectedBinding;
  }catch{report.sealedTransferCandidate=false;}
 }
 return report;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 const args=process.argv.slice(2);
 const allowed=new Set(['--root','--kind','--expected-binding']);
 const input={};
 try{
  for(let i=0;i<args.length;i+=2){
   if(!allowed.has(args[i])||typeof args[i+1]!=='string'||Object.hasOwn(input,args[i]))throw deny();
   input[args[i]]=args[i+1];
  }
  if(!input['--root'])throw deny();
  const result=await measureWorkspace({root:input['--root'],kind:input['--kind']??'repository',
   ...(input['--expected-binding']?{expectedBinding:input['--expected-binding']}:{})});
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
 }catch{
  process.stderr.write('Workspace preflight could not be completed. Verify the local path and read permissions. No transfer was attempted.\n');
  process.exitCode=1;
 }
}
