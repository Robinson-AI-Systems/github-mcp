// Operator-only, authenticated encrypted full-workspace export/import. Never a chat byte-read bypass.
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { lstat, readFile, writeFile, readdir, mkdir, open, rm } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { NativeGitWorker } from './engine.js';
const MAX_BYTES = 100 * 1024 * 1024;
const ID = /^git_[a-f0-9]{32}$/;
const keyBytes = key => { const b = Buffer.from(key ?? '', 'base64'); if (b.length !== 32) throw new TypeError('Use a protected 32-byte base64 snapshot encryption key.'); return b; };
const validPath = p => typeof p === 'string' && p.length <= 4096 && !p.includes('\\') && !/[\x00-\x1f]/.test(p) && p.split('/').every(x => x && x !== '.' && x !== '..');
export async function exportWorkspaceFile({root,id,key,path,expectedGeneration}){
 if(!ID.test(id))throw new TypeError('Invalid workspace.');const dir=join(resolve(root),id);if((await lstat(dir)).isSymbolicLink())throw new TypeError('Invalid workspace root.');
 const lock=await open(join(dir,'mutation.lock'),'wx',0o600);let output;
 try{
  const meta=JSON.parse(await readFile(join(dir,'workspace.json'),'utf8'));if(meta.state!=='ready'||expectedGeneration!==undefined&&meta.generation!==expectedGeneration)throw new TypeError('Workspace state or generation changed before export.');
  output=await open(path,'wx',0o600);const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',keyBytes(key),nonce);cipher.setAAD(Buffer.from('robinson-native-git-snapshot/v1'));await output.write(Buffer.concat([Buffer.from('RNG1'),nonce,Buffer.alloc(16)]));
  const emit=async value=>{const bytes=cipher.update(value);if(bytes.length)await output.write(bytes);};let first=true,total=0,files=0;
  await emit(Buffer.from(JSON.stringify({version:1,id}).slice(0,-1)+',"files":['));
  const walk=async(base,prefix='')=>{for(const name of (await readdir(base)).sort()){
   const relative=prefix?prefix+'/'+name:name;if(relative==='mutation.lock'||relative==='attachment.json'||relative==='attachment-freeze.json')continue;if(!validPath(relative)||++files>100000)throw new TypeError('Unsupported snapshot path/count.');
   const stat=await lstat(join(base,name));if(stat.isSymbolicLink())throw new TypeError('Snapshot symlinks require an isolated filesystem snapshot.');if(!first)await emit(Buffer.from(','));first=false;
   if(stat.isDirectory()){await emit(Buffer.from(JSON.stringify({path:relative,directory:true})));await walk(join(base,name),relative);}
   else if(stat.isFile()){
    total+=stat.size;if(total>MAX_BYTES)throw new TypeError('Snapshot exceeds100MiB; no partial attachment was accepted.');await emit(Buffer.from(JSON.stringify({path:relative,mode:stat.mode&0o777}).slice(0,-1)+',"base64":"'));
    const file=await open(join(base,name),'r');try{const b=Buffer.alloc(32766);let offset=0;while(offset<stat.size){const n=Math.min(b.length,stat.size-offset),r=await file.read(b,0,n,offset);if(r.bytesRead!==n)throw new TypeError('Source file changed during snapshot.');await emit(Buffer.from(b.subarray(0,n).toString('base64')));offset+=n;}const after=await file.stat();if(after.size!==stat.size||after.mtimeMs!==stat.mtimeMs)throw new TypeError('Source file changed during snapshot.');}finally{await file.close();}await emit(Buffer.from('"}'));
   }else throw new TypeError('Unsupported snapshot file type.');
  }};
  await walk(dir);await emit(Buffer.from(']}'));const tail=cipher.final();if(tail.length)await output.write(tail);await output.write(cipher.getAuthTag(),0,16,16);await output.sync();return {files,bytes:total};
 }catch(error){await output?.close();output=null;await rm(path,{force:true});throw error;}finally{await output?.close();await lock.close();await rm(join(dir,'mutation.lock'),{force:true});}
}
export async function exportWorkspace(options){
 const staging=join(resolve(options.root),'.snapshot-exports');await mkdir(staging,{recursive:true,mode:0o700});const path=join(staging,randomBytes(16).toString('hex'));
 try{await exportWorkspaceFile({...options,path});return await readFile(path);}finally{await rm(path,{force:true});}
}

// Receiver-only bootstrap for an allocation with separately mounted worktree,
// Git metadata and broker-control volumes. Never overwrites initialized work.
export async function importMountedWorkspace({root,bytes,key,id,expectedBinding}){
 if(!ID.test(id)||!Buffer.isBuffer(bytes)||bytes.length<32||bytes.length>150*1024*1024||bytes.subarray(0,4).toString()!=='RNG1')throw new TypeError('Invalid attachment snapshot.');
 const cipher=createDecipheriv('aes-256-gcm',keyBytes(key),bytes.subarray(4,16));cipher.setAAD(Buffer.from('robinson-native-git-snapshot/v1'));cipher.setAuthTag(bytes.subarray(16,32));
 const payload=JSON.parse(Buffer.concat([cipher.update(bytes.subarray(32)),cipher.final()]).toString('utf8'));
 if(payload.version!==1||payload.id!==id||!Array.isArray(payload.files)||payload.files.length>100000)throw new TypeError('Attachment manifest identity is invalid.');
 const metaFile=payload.files.find(f=>f.path==='workspace.json'&&!f.directory),meta=metaFile?JSON.parse(Buffer.from(metaFile.base64,'base64').toString('utf8')):null;
 if(meta?.binding!==expectedBinding||meta.state!=='ready')throw new TypeError('Attachment principal binding or source state differs.');
 const names=new Set();let size=0;for(const f of payload.files){if(!validPath(f.path)||names.has(f.path))throw new TypeError('Invalid attachment path.');names.add(f.path);if(!f.directory){if(typeof f.base64!=='string'||Buffer.from(f.base64,'base64').toString('base64')!==f.base64)throw new TypeError('Invalid attachment bytes.');size+=Buffer.byteLength(f.base64,'base64');if(size>MAX_BYTES)throw new TypeError('Attachment exceeds the snapshot bound.');}}
 const dir=join(resolve(root),id),digest=createHash('sha256').update(bytes).digest('hex'),marker=join(dir,'attachment.json');
 await mkdir(dir,{recursive:true,mode:0o700});if(await (await import('node:fs/promises')).realpath(dir)!==dir)throw new TypeError('Attachment root is not isolated.');
 let prior;try{prior=JSON.parse(await readFile(marker,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 if(prior&&prior.digest!==digest)throw new TypeError('This allocation has a different attachment intent.');
 if(prior?.complete)return {...prior,replayed:true};
 if(!prior){try{await readFile(join(dir,'workspace.json'));throw new TypeError('Refusing to overwrite an initialized workspace.');}catch(e){if(e.code!=='ENOENT')throw e;}await writeFile(marker,JSON.stringify({digest,complete:false}),{flag:'wx',mode:0o600});}
 // Keep the broker unavailable for Git until all files and hash verification finish.
 await writeFile(join(dir,'workspace.json'),JSON.stringify({...meta,state:'opening'}),{mode:0o600});
 for(const f of payload.files.filter(f=>f.directory)){const path=join(dir,f.path);await mkdir(path,{recursive:true,mode:0o700});if(await (await import('node:fs/promises')).realpath(path)!==path)throw new TypeError('Attachment directory contains a symlink.');}
 for(const f of payload.files.filter(f=>!f.directory&&f.path!=='workspace.json')){
  const path=join(dir,f.path);await mkdir(dirname(path),{recursive:true,mode:0o700});if(await (await import('node:fs/promises')).realpath(dirname(path))!==dirname(path))throw new TypeError('Attachment parent contains a symlink.');
  const data=Buffer.from(f.base64,'base64');try{await writeFile(path,data,{flag:'wx',mode:(f.mode&0o111)?0o700:0o600});}catch(e){if(e.code!=='EEXIST'||!(await readFile(path)).equals(data))throw new TypeError('Attachment conflicts with existing bytes; both copies were preserved.');}
  if(!(await readFile(path)).equals(data))throw new TypeError('Attachment file hash did not verify.');
 }
 const worker=new NativeGitWorker({root:resolve(root),authorize:async()=>true});const trees=payload.files.filter(f=>f.directory&&/^worktrees\/[^/]+$/.test(f.path)).map(f=>join(dir,f.path));if(trees.length)await worker.git(join(dir,'repo'),['worktree','repair','--',...trees]);
 await writeFile(join(dir,'workspace.json'),JSON.stringify(meta),{mode:0o600});const result={digest,complete:true,workspace_id:id,generation:meta.generation,files:names.size,bytes:size};await writeFile(marker,JSON.stringify(result),{mode:0o600});return result;
}
export async function importWorkspace({ root, bytes, key }) {
 if (!Buffer.isBuffer(bytes) || bytes.length < 32 || bytes.length > 150 * 1024 * 1024 || bytes.subarray(0, 4).toString() !== 'RNG1') throw new TypeError('Invalid encrypted workspace snapshot.');
 const cipher = createDecipheriv('aes-256-gcm', keyBytes(key), bytes.subarray(4, 16)); cipher.setAAD(Buffer.from('robinson-native-git-snapshot/v1')); cipher.setAuthTag(bytes.subarray(16, 32));
 const payload = JSON.parse(Buffer.concat([cipher.update(bytes.subarray(32)), cipher.final()]).toString('utf8'));
 if (payload.version !== 1 || !ID.test(payload.id) || !Array.isArray(payload.files) || payload.files.length > 100000) throw new TypeError('Invalid snapshot manifest.');
 const names = new Set(); let size = 0;
 for (const f of payload.files) { if (!validPath(f.path) || names.has(f.path)) throw new TypeError('Invalid snapshot path.'); names.add(f.path); if (!f.directory) { if (typeof f.base64 !== 'string') throw new TypeError('Invalid snapshot file.'); size += Buffer.byteLength(f.base64, 'base64'); if (size > MAX_BYTES) throw new TypeError('Snapshot too large.'); } }
 await mkdir(resolve(root), { recursive: true, mode: 0o700 });
 const dir = join(resolve(root), payload.id); await mkdir(dir, { mode: 0o700 });
 try {
  for (const f of payload.files.filter(f => f.directory)) await mkdir(join(dir, f.path), { recursive: true, mode: 0o700 });
  for (const f of payload.files.filter(f => !f.directory)) { const path = join(dir, f.path); await mkdir(dirname(path), { recursive: true, mode: 0o700 }); await writeFile(path, Buffer.from(f.base64, 'base64'), { mode: (f.mode & 0o111) ? 0o700 : 0o600, flag: 'wx' }); }
  // Linked worktrees contain absolute Git metadata paths; repair them after moving hosts/roots.
  const treeRoot = join(dir, 'worktrees'); let trees = []; try { trees = await readdir(treeRoot); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (trees.length) { const worker = new NativeGitWorker({ root: resolve(root), authorize: async () => true }); await worker.git(join(dir, 'repo'), ['worktree', 'repair', '--', ...trees.map(t => join(treeRoot, t))]); }
  return { workspace_id: payload.id, files: payload.files.length, bytes: size, encrypted_sha256: createHash('sha256').update(bytes).digest('hex') };
 } catch (error) { await rm(dir, { recursive: true, force: true }); throw error; }
}
