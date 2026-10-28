import {describe,it,expect} from 'vitest';
import {redactExcerpt} from '../../src/github/content-protection.js';
import {normalizeChange} from '../../src/db.js';
import {cap} from '../../src/tools/public-read.js';
import {summarizeLog} from '../../src/github/log-summary.js';

describe('credential redaction precedes textual truncation',()=>{
  const pass='rtc_pass_'+'x'.repeat(43);
  for(const limit of [40,80,200,400,1500,2000]){
    it(`protects all RTC credential overlap positions at limit ${limit}`,()=>{
      for(let overlap=1;overlap<pass.length;overlap++){
        const text='a'.repeat(Math.max(0,limit-overlap))+pass+'suffix';
        const value=cap(text,limit);
        expect(value).not.toContain(pass.slice(0,Math.min(overlap,40)));
        expect(value).not.toContain('rtc_pass_');
      }
    });
  }
  it('protects provider log text across the 400-character line cap',()=>{
    const summary=summarizeLog('Error: '+'a'.repeat(342)+pass+' tail');
    expect(JSON.stringify(summary)).not.toContain(pass.slice(0,40));
    expect(summary.errors[0]).toContain('[hidden]');
  });
});

it('redacts a journal summary before its persistence cap',()=>{
  const token='rtc_pass_'+'x'.repeat(43);
  const saved=normalizeChange({tool:'github_fixture',summary:'a'.repeat(1949)+token+' suffix'});
  expect(saved.summary).not.toContain(token.slice(0,40));
  expect(saved.summary).toContain('[hidden]');
});

it('protects a credential prefix when GitHub already clipped the provider excerpt',()=>{
  const prefix='rtc_pass_'+'x'.repeat(32);
  expect(redactExcerpt('provider snippet '+prefix)).toBe('provider snippet [hidden]');
});

it('retains conservative partial-prefix protection in provider error excerpts',async()=>{
  const {explainGithubError}=await import('../../src/tools/errors.js');
  const prefix='rtc_pass_'+'x'.repeat(32);
  const shown=explainGithubError({status:403,message:'Denied '+prefix,response:{data:{message:'Denied '+prefix}}});
  expect(JSON.stringify(shown)).not.toContain(prefix);
});
