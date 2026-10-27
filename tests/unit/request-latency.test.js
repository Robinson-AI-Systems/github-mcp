import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';

describe('C-8 synthetic read-path critical-path measurement',()=>{
  it('reports the scheduled read/telemetry savings without claiming real GitHub latency',()=>{
    const report=JSON.parse(execFileSync(process.execPath,['scripts/benchmark-request-latency.mjs'],{
      cwd:process.cwd(),encoding:'utf8',timeout:30000
    }));
    expect(report).toMatchObject({fakeReadMs:25,repetitions:5});
    expect(report.rows.map(r=>r.name)).toEqual(['actAsEvidence','providerTwoReadsAndFlush']);
    for(const row of report.rows) {
      expect(row.serialControlMedianMs).toBeGreaterThan(row.optimizedMedianMs);
      expect(row.optimizedMedianMs).toBeGreaterThanOrEqual(0);
    }
    console.log('C-8 synthetic benchmark '+JSON.stringify(report));
  });
});
