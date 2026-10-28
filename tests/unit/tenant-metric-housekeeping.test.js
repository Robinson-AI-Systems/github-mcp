import {it,expect} from 'vitest';
import {createTenantMetricBuffer} from '../../src/tenancy/runtime-limits.js';

it('coalesces metrics into one insert with independently deterministic sampled housekeeping', async()=>{
  for(const sample of [0,1]){
    const statements=[];
    const sql=async(parts)=>{statements.push(parts.join('?'));return [];};
    const buffer=createTenantMetricBuffer(sql,{random:()=>sample});
    buffer.record({event:'provider',outcome:'ok',durationMs:1});
    buffer.record({event:'mcp',outcome:'ok',durationMs:2});
    expect(await buffer.flush()).toBe(2);
    expect(statements.filter(x=>x.startsWith('INSERT INTO gh_tenant_runtime_metrics'))).toHaveLength(1);
    expect(statements.filter(x=>x.startsWith('DELETE FROM'))).toHaveLength(sample===0?3:0);
    expect(await buffer.flush()).toBe(0);
    expect(statements).toHaveLength(sample===0?4:1);
  }
});
