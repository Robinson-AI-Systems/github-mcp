import test from 'node:test';
import assert from 'node:assert/strict';
import { runPhase, writePhaseEvidence, CI_HARD_WATCHDOG_MS } from './ci-phase.mjs';
const args=['--budget-seconds','30','--','node','check.js'];
const measured=(seconds,result)=>{
  let i=0;const output=[];let opts;
  const data=runPhase(args,{execute:(_,__,o)=>{opts=o;return result;},
    clock:()=>i++?seconds*1000:0,output:x=>output.push(x),label:'browser-sign-in'});
  return {data,output,opts};
};
test('passing below 30 seconds remains green and has measured timing',()=>{
  const {data,output}=measured(21.57,{status:0});
  assert.equal(data.exitCode,0);assert.equal(data.overrunSeconds,0);
  assert.equal(data.withinBudget,true);assert.ok(output.every(x=>!x.startsWith('::warning')));
});
test('passing above target remains green and emits one precise warning',()=>{
  const {data,output,opts}=measured(45.75,{status:0});
  assert.equal(data.exitCode,0);assert.equal(data.overrunSeconds,15.75);
  assert.match(output.join('\n'),/::warning title=CI phase over 30-second target/);
  assert.equal(opts.timeout,CI_HARD_WATCHDOG_MS);
});
test('records all passing-overrun durations as credential-free artifact and summary lines',()=>{
  const {data}=measured(46.2,{status:0});const lines=[];
  const record=writePhaseEvidence(data,{timingFile:'.ci-timing/phase.jsonl',summaryFile:'step.md',
    mkdir:()=>{},append:(path,value)=>lines.push([path,value])});
  assert.equal(record.status,'passed');
  assert.equal(JSON.parse(lines[0][1]).overrunSeconds,16.2);
  assert.match(lines[1][1],/slow pass/);
  assert.doesNotMatch(JSON.stringify(lines),/check\.js|authorization|password/i);
});
test('real failures, signals and hard watchdog timeouts still fail',()=>{
  for(const result of [{status:17},{status:0,signal:'SIGTERM'},
    {error:Object.assign(Error('timeout'),{code:'ETIMEDOUT'})}]){
    assert.equal(measured(1,result).data.exitCode,1);
  }
  assert.equal(measured(1,{error:Object.assign(Error('timeout'),{code:'ETIMEDOUT'})}).data.timedOut,true);
  assert.equal(runPhase(['--budget-seconds','30','--',process.execPath,'-e','process.exit(17)'],
    {output:()=>{}}).exitCode,1);
});
test('soft target increases or missing commands refuse',()=>{
  assert.throws(()=>runPhase(['--budget-seconds','31','--','node','check.js']),/1–30/);
  assert.throws(()=>runPhase(['--budget-seconds','30','--']),/Usage/);
});
