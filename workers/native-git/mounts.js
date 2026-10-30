import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
export async function repositoryMounts(repo,{read=readFile}={}){
 let text;try{text=await read('/proc/self/mountinfo','utf8');}catch{return {worktree:null,git:null,gitReadOnly:null};}
 const entries=text.split('\n').filter(Boolean).map(line=>line.split(' '));
 const find=path=>entries.find(fields=>fields[4]===path);
 const fingerprint=fields=>fields?createHash('sha256').update(JSON.stringify([fields[2],fields[3]])).digest('hex'):null;
 const files=find(repo),git=find(repo+'/.git');return {worktree:fingerprint(files),git:fingerprint(git),gitReadOnly:git?git[5].split(',').includes('ro'):null};
}
