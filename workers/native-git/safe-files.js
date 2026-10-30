// Directory handles pin every path component across concurrent worktree edits.
// This closes the lstat/open race once an untrusted command container shares files.
import {open,mkdir,rm} from 'node:fs/promises';
import {constants} from 'node:fs';
const directory=constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW;
async function parent(repo,path,create=false){
 if(typeof path!=='string'||path.length>4096||path.includes('\\')||path.includes(':')||/[\x00-\x1f]/.test(path)||path.split('/').some(p=>!p||p==='.'||p==='..'||p.toLowerCase()==='.git'))throw new TypeError('Use a relative regular workspace file outside Git metadata.');
 const parts=path.split('/'),name=parts.pop();let handle=await open(repo,directory);
 try{for(const part of parts){const next='/proc/self/fd/'+handle.fd+'/'+part;if(create)await mkdir(next,{mode:0o700}).catch(e=>{if(e.code!=='EEXIST')throw e;});const child=await open(next,directory);await handle.close();handle=child;}return {handle,path:'/proc/self/fd/'+handle.fd+'/'+name};}catch(e){await handle.close();throw e;}
}
export async function readWorkspaceFile(repo,path,limit=20*1024*1024){
 const p=await parent(repo,path);let file;try{file=await open(p.path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);const stat=await file.stat();if(!stat.isFile()||stat.size>limit)throw new TypeError('File is not regular or exceeds the worker read bound.');const buffer=Buffer.alloc(limit+1);let size=0;while(size<buffer.length){const r=await file.read(buffer,size,buffer.length-size,size);if(!r.bytesRead)break;size+=r.bytesRead;}if(size>limit)throw new TypeError('File exceeds the worker read bound.');return buffer.subarray(0,size);}finally{await file?.close();await p.handle.close();}
}
export async function writeWorkspaceFile(repo,path,bytes){
 const p=await parent(repo,path,true);let file;try{file=await open(p.path,constants.O_WRONLY|constants.O_CREAT|constants.O_NOFOLLOW|constants.O_NONBLOCK,0o600);if(!(await file.stat()).isFile())throw new TypeError('Only regular workspace files can be written.');await file.truncate(0);await file.writeFile(bytes);await file.sync();}finally{await file?.close();await p.handle.close();}
}
export async function removeWorkspaceFile(repo,path){const p=await parent(repo,path);try{await rm(p.path);}finally{await p.handle.close();}}
