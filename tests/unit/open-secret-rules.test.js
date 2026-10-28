import {it,expect} from 'vitest';
import {redact,contentProtectionReport,containsCredential} from '../../src/github/content-protection.js';
import {OPEN_SECRET_RULE_IDS,OPEN_SECRET_RULE_SOURCE} from '../../src/github/open-secret-rules.js';
// Constructed repetition fixtures only, never issued credentials or copies of repository findings.
const cases={
 'aws-access-token':'AKIA'+'A'.repeat(16),
 'digitalocean-pat':'dop_v1_'+'a'.repeat(64),
 'gitlab-pat':'glpat-'+'A'.repeat(20),
 'grafana-api-key':'eyJrIjoi'+'A'.repeat(80),
 'hashicorp-tf-api-token':'A'.repeat(14)+'.atlasv1.'+'B'.repeat(65),
 'huggingface-access-token':'hf_'+'A'.repeat(34),
 'linear-api-key':'lin_api_'+'A'.repeat(40),
 'mailgun-private-api-token':'MAILGUN_API_KEY="key-'+'a'.repeat(32)+'"',
 'notion-api-token':'ntn_'+'1'.repeat(11)+'A'.repeat(35),
 'npm-access-token':'npm_'+'A'.repeat(36),
 'openai-api-key':'sk-proj-'+'A'.repeat(58)+'T3BlbkFJ'+'B'.repeat(58),
 'postman-api-token':'PMAK-'+'a'.repeat(24)+'-'+'b'.repeat(34),
 'pypi-upload-token':'pypi-AgEIcHlwaS5vcmc'+'A'.repeat(60),
 'sendgrid-api-token':'SG.'+'A'.repeat(66),
 'shopify-access-token':'shpat_'+'a'.repeat(32),
 'slack-app-token':'xapp-1-'+'A'.repeat(12)+'-1234567890-'+'a'.repeat(30),
 'slack-bot-token':'xoxb-'+'1'.repeat(12)+'-'+'2'.repeat(12)+'-'+'A'.repeat(24),
 'slack-config-access-token':'xoxe.xoxb-1-'+'A'.repeat(164),
 'slack-config-refresh-token':'xoxe-1-'+'A'.repeat(146),
 'slack-legacy-token':'xoxs-1-2-3-'+'a'.repeat(32),
 'slack-user-token':'xoxp-'+'1'.repeat(12)+'-'+'2'.repeat(12)+'-'+'3'.repeat(12)+'-'+'A'.repeat(30),
 'stripe-access-token':'sk_live_'+'A'.repeat(24),
 'anthropic-admin-api-key':'sk-ant-admin01-'+'A'.repeat(93)+'AA',
 'anthropic-api-key':'sk-ant-api03-'+'A'.repeat(93)+'AA',
 'azure-ad-client-secret':'ABC1Q~'+'A'.repeat(32),
 'gcp-api-key':'AIza'+'A'.repeat(35)
};
for(const [id,value] of Object.entries(cases))it(`protects the reviewed ${id} format without returning values`,()=>{
 const report=contentProtectionReport(value);expect(report.findings.some(f=>f.rule===id)).toBe(true);expect(report.byte_exact_available).toBe(false);
 expect(redact(value)).not.toBe(value);expect(containsCredential(JSON.stringify({body:redact(value)}))).toBe(false);expect(JSON.stringify(report)).not.toContain(value);
});
it('pins corpus provenance and has a positive fixture for every imported rule',()=>{
 expect(Object.keys(cases).sort()).toEqual([...OPEN_SECRET_RULE_IDS].sort());expect(OPEN_SECRET_RULE_SOURCE.rules).toBe(26);expect(OPEN_SECRET_RULE_SOURCE.revision).toBe('5f6ec56cfa6f8c67648d863582c7ae2f206d5c1c');
});
it('does not reveal a longer suffix of a recognized token',()=>{
 const value='glpat-'+'A'.repeat(60);expect(redact(value)).toBe('[hidden]');
});
it('covers quoted generic credential assignments and explicit database/cloud keys in JSON',()=>{
 const value='FAKE_Only_AbC_0123456789';
 const json=JSON.stringify({DB_PASSWORD:value});expect(containsCredential(json)).toBe(true);expect(redact(json)).not.toContain(value);
 const generic=`const api_key = "${value}";`;expect(contentProtectionReport(generic).findings).toMatchObject([{rule:'generic-credential-assignment'}]);
 const database=JSON.stringify({host:'example.invalid',database:'sample',password:value});expect(redact(database)).not.toContain(value);
 expect(redact('const api_key = process.env.API_KEY;')).toBe('const api_key = process.env.API_KEY;');
});
