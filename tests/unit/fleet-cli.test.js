import {it,expect} from 'vitest';
import {spawnSync} from 'node:child_process';

it('verifies the shipped Python CLI, reversible installer and fake connector process',()=>{
 const result=spawnSync('python3',['-m','unittest','discover','-s','tools/ras-github','-p','test_*.py'],{encoding:'utf8',timeout:60000});
 expect(result.status,result.stderr||result.error?.message).toBe(0);
 expect(result.stderr).toMatch(/Ran [1-9]\d* tests/);
 expect(result.stderr).toMatch(/\nOK\s*$/);
});
