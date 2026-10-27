import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkLayout, policy } from './check-ci-layout.mjs';
const source = () => readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url),'utf8');
test('actual verification families remain parallel and every job reaches the required gate',()=>{
 assert.equal(checkLayout(source()).gate,policy.gate);
 const id=policy.parallel.find(x=>x!==policy.parallel[0]);
 const serialized=source().replace('  '+id+':\n','  '+id+':\n    needs: '+policy.parallel[0]+'\n');
 assert.throws(()=>checkLayout(serialized),/serialized/);
 const ignored=source().replace('  '+id+':\n','  '+id+':\n    continue-on-error: true\n');
 assert.throws(()=>checkLayout(ignored),/silently ignore/);
 const gate=source().replace('needs: [','needs: [not-a-real-job, ');
 assert.throws(()=>checkLayout(gate),/dependency|EVERY/);
});
test('timeout increases and removed aggregate result checks cannot hide slow/missing work',()=>{
 const id=policy.parallel[0];
 const increased=source().replace(new RegExp('(  '+id+':\\n[\\s\\S]*?timeout-minutes:) \\d+'),'$1 999');
 assert.throws(()=>checkLayout(increased),/timeout/);
 const missing=source().replaceAll('needs.'+id+'.result','needs.'+id+'.ignored');
 assert.throws(()=>checkLayout(missing),/inspect result/);
 assert.throws(()=>checkLayout(source().replaceAll('scripts/ci-phase.mjs','scripts/untimed.mjs')),/Missing measured/);
 assert.throws(()=>checkLayout(source().replaceAll('--budget-seconds 30','--budget-seconds 31')),/feedback budget increased/);
});
test('sharded cohorts cannot silently become one serial runner',()=>{
 for(const [id] of Object.entries(policy.matrices??{})){
  const changed=source().replace(new RegExp('(  '+id+':\\n[\\s\\S]*?strategy:\\n)'), '$1      max-parallel: 1\n');
  assert.throws(()=>checkLayout(changed),/collapse or serialize/);
 }
});

test('browser shard coverage, 3-minute watchdog and durable timing are required',()=>{
 const src=source();
 assert.match(src,/shard:\s*\[sign-in, home-page, fair-use\]/);
 assert.throws(()=>checkLayout(src.replace('timeout-minutes: 3','timeout-minutes: 4')),/timeout/);
 assert.throws(()=>checkLayout(src.replace('scripts/browser-shards.mjs --check','scripts/untested.mjs --check')),/coverage/);
 assert.throws(()=>checkLayout(src.replace('ci-timing-check','missing-timing-check')),/timing artifact/);
 assert.throws(()=>checkLayout(src.replace('shard: [sign-in, home-page, fair-use]','shard: [sign-in, fair-use]')),/browser/);
});
