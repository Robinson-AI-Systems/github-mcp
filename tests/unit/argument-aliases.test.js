import {it,expect} from 'vitest';
import {standardAliases} from '../../src/tools/argument-aliases.js';
import {defineRead} from '../../src/tools/define-read.js';
import {defineGithubWrite} from '../../src/tools/define-github-write.js';
import {makeWorld,parse} from '../../test/helpers/write-contract.js';
it('does not alias distinct declared values and covers named provider spellings',()=>{
 expect(standardAliases('github_pr_x',{number:{},issue_number:{},runId:{},max:{}})).toEqual({runId:['run_id'],max:['limit'],number:['pull_number','pr']});
 expect(standardAliases('github_branch_create',{from:{}})).toEqual({from:['fromRef']});
 expect(standardAliases('github_issue_x',{issue_number:{}})).toEqual({issue_number:['number']});
});
it('normalizes multiple read aliases and refuses disagreement before the handler',async()=>{
 let calls=0;const read=defineRead({name:'github_pr_aliases',description:'Read aliases.',properties:{number:{type:'integer'}},required:['number'],handler:a=>{calls++;return a;}});
 expect(await read.handler({pull_number:7,pr:7},{})).toEqual({number:7});
 expect(()=>read.handler({pull_number:7,pr:8},{})).toThrow(/Conflicting/);expect(calls).toBe(1);
});
it('normalizes write aliases before the target and replay key, never sending a second write',async()=>{
 const w=await makeWorld({mode:'production',gates:[]});let sent=0;
 const def=defineGithubWrite({name:'github_pr_aliases',description:'Test aliases.',properties:{number:{type:'integer'}},required:['number'],declarations:{production:'never'},
  target:a=>{expect(a.number).toBe(7);expect(a.pr).toBeUndefined();return {owner:'example-org',scope:'repo',repo:'hello'};},
  read:()=>null,classify:()=>({}),summarize:()=> 'Alias write',apply:()=>{sent++;return {};},readAfter:()=>({number:7}),verify:()=>true});
 const first=parse(await def.handler({pr:7,requestKey:'same-alias-intent'},w.ctx));expect(first.status).toBe('applied');
 const second=parse(await def.handler({number:7,requestKey:'same-alias-intent'},w.ctx));expect(second.status).toBe('replayed');expect(sent).toBe(1);
 expect(()=>def.handler({pr:7,pull_number:8},w.ctx)).toThrow(/Conflicting/);
});
