import {describe,it,expect} from 'vitest';
import {redact,containsCredential,contentProtectionReport,redactPreservingLines} from '../../src/github/content-protection.js';
import {makeWorld,parse} from '../../test/helpers/write-contract.js';
import {createDispatch} from '../../src/tools/dispatch.js';
import {registry} from '../../src/tools/index.js';
const fake='FAKE_DATABASE_ONLY_12345';
const cases=[
 'postgresql' + `://sample:${fake}@example.invalid:5432/db`,
 `mongodb+srv://sample:${fake}@example.invalid/db`,
 `redis://:${fake}@example.invalid:6379`,
 `Host=example.invalid;Port=5432;Database=sample;Username=sample;Password=${fake};SSL Mode=Require`,
 `Server=example.invalid;Database=sample;User ID=sample;Pwd="${fake};more";Encrypt=true`,
 `Host=example.invalid;\nDatabase=sample;\nPassword='${fake} doubled''quote';`,
 `DB_PASSWORD=${fake}`,`const DATABASE_PASSWORD = "${fake}";`
];
describe('shared database credential format protection',()=>{
 for(const [i,source] of cases.entries())it(`protects database format ${i} with value-free locations and idempotent redaction`,()=>{
  const shown=redact(source);expect(shown).not.toContain(fake);expect(shown).toContain('[hidden]');expect(redact(shown)).toBe(shown);
  expect(containsCredential(source)).toBe(true);expect(containsCredential(JSON.stringify({body:source}))).toBe(true);
  expect(containsCredential(JSON.stringify({body:shown}))).toBe(false);
  const r=contentProtectionReport(source);expect(r.byte_exact_available).toBe(false);expect(r.findings[0].rule).toMatch(/^database-/);expect(JSON.stringify(r)).not.toContain(fake);
  const f=r.findings[0];expect(Buffer.from(source).subarray(f.byte_offset,f.byte_offset+f.byte_length).toString()).toContain(fake);
 });
 it('keeps code identifiers, environment lookups, parameterized sources and empty passwords exact',()=>{
  for(const source of ['rtc_pass_request rtc_pass_rate','const password = getPassword();','process.env.DB_PASSWORD','DB_PASSWORD=${DATABASE_PASSWORD}','DB_PASSWORD=process.env.PG_PASSWORD','postgresql://sample@example.invalid/db','postgresql://sample:@example.invalid/db','const config = {password: input.password};','const fields = ["Password", "Host"];']){
   expect(redact(source)).toBe(source);expect(containsCredential(source)).toBe(false);
  }
 });
 it('preserves original line numbering and UTF-8 byte offsets',()=>{
  const source='😀\nHost=example.invalid;Password='+fake+';\nnext';const report=contentProtectionReport(source);
  expect(report.findings[0]).toMatchObject({line:2,column:31});
  expect(redactPreservingLines(source).split('\n')).toHaveLength(3);
 });
});
const call=(w,name,args)=>createDispatch({env:w.ctx.env,credentials:w.credentials,fetch:w.gh.fetch,gates:[],now:w.ctx.now,sleep:w.ctx.sleep})({registry,name,args,connection:w.connection,db:w.db});
it('full file, line windows, scan and byte refusal use database password protection through MCP',async()=>{
 const w=await makeWorld({profile:'full'}),source='Host=example.invalid;Database=sample;Password='+fake+';\n';
 const file={type:'file',path:'docs/config.md',sha:'a'.repeat(40),size:Buffer.byteLength(source),encoding:'base64',content:Buffer.from(source).toString('base64')};
 w.gh.when('GET /repos/{owner}/{repo}/contents/{path}').reply(200,file);
 const full=parse(await call(w,'github_content_get',{repo:'fixture',path:file.path,fullText:true}));expect(full.content).toContain('[hidden]');expect(JSON.stringify(full)).not.toContain(fake);
 expect(full.content_protection).toMatchObject({content_exact:false,byte_exact_available:false});
 const bytes=await call(w,'github_content_get',{repo:'fixture',path:file.path,byteOffset:0,byteLength:10});expect(bytes.isError).toBe(true);expect(JSON.stringify(bytes)).not.toContain(fake);
 const report=parse(await call(w,'github_content_protection_check',{repo:'fixture',path:file.path}));expect(report.total_findings).toBe(1);expect(report.findings[0].rule).toBe('database-connection-password');expect(JSON.stringify(report)).not.toContain(fake);
 const scan=parse(await call(w,'github_security_scan_files',{repo:'fixture',paths:[file.path]}));expect(scan.findings).toMatchObject([{rule:'database-connection-password'}]);expect(JSON.stringify(scan)).not.toContain(fake);
 expect(w.gh.invalid).toEqual([]);
});

it('finds every repeated connection-string occurrence and masks literal expression-shaped passwords',()=>{
 const line='Host=example.invalid;Password=FAKE_REPEATED_VALUE;';const repeated=line+'\n\n'+line;
 expect(contentProtectionReport(repeated).findings).toHaveLength(2);expect(redact(repeated)).not.toContain('FAKE_REPEATED_VALUE');
 const expression='Host=example.invalid;Password=FAKE_Sample(123)!;';expect(redact(expression)).not.toContain('FAKE_Sample');
 expect(redact('if (process.env.DB_PASSWORD === undefined) { return; }')).toBe('if (process.env.DB_PASSWORD === undefined) { return; }');
});
