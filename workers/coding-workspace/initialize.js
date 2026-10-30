// Runs once before the two isolated services. Only their new named volumes are
// mounted here; no host path, Docker socket, provider key or repository code.
import {mkdir,chown,chmod,realpath} from 'node:fs/promises';
import {join} from 'node:path';
const id=process.env.NATIVE_GIT_SINGLE_WORKSPACE_ID;
if(!/^git_[a-f0-9]{32}$/.test(id??''))throw new TypeError('Pin the single native workspace before initializing owned allocation volumes.');
for(const path of ['/data',join('/data',id),join('/data',id,'repo'),join('/data',id,'repo','.git')]){
 await mkdir(path,{recursive:true,mode:0o700});if(await realpath(path)!==path)throw new TypeError('Owned allocation volumes must not be symlinks.');await chown(path,1000,1000);await chmod(path,0o700);
}
await mkdir('/workspace',{recursive:true,mode:0o755});if(await realpath('/workspace')!=='/workspace')throw new TypeError('Invalid runtime control mount.');await chown('/workspace',0,0);await chmod('/workspace',0o755);
