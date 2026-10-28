// CAP-4 credential revocation: real PostgreSQL journal, with only synthetic
// GitHub responses. No provider account, live token or production data touched.
import crypto from 'node:crypto';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {createDb} from '../../src/db.js';
import {createCredentials} from '../../src/github/credentials.js';
import {createDispatch} from '../../src/tools/dispatch.js';
import {registry} from '../../src/tools/index.js';
import {makeFakeGitHub} from '../../test/helpers/fake-github.js';
import {openIsolatedSchema,closeIsolatedSchema,neonShapedQuery}
  from '../../test/helpers/pg-neon-adapter.js';

const ROUTES=[
  'GET /orgs/{org}/credential-authorizations',
  'DELETE /orgs/{org}/credential-authorizations/{credential_id}'
];
const args={credentialId:24680,login:'alice'};
const conn={client_id:'saml-real-pg-owner',accounts:['example-org'],
  default_account:'example-org',profile:'full',mode:'production',listing:'catalog'};
const env={TOKEN_ENCRYPTION_KEY:crypto.randomBytes(32).toString('base64url')};
let gh,db,credentials;
const affected=()=>gh.calls.filter(c=>c.method==='DELETE');
const record={credential_id:24680,login:'alice',credential_type:'OAuth app token',
  credential_authorized_at:'2026-10-01T00:00:00Z',
  scopes:['repo'],token_last_eight:'NEVERLOG',fingerprint:'secret-fingerprint'};
async function dispatch(connection,parameters){
  const result=await createDispatch({env,credentials,fetch:gh.fetch,
    gates:[],sleep:async()=>{},now:()=>Date.UTC(2026,9,22,17,0)})({
    registry,name:'github_org_saml_revoke_authorization',
    args:parameters,connection,db});
  return result.structuredContent??{status:'refused'};
}
beforeAll(async()=>{
  const url=process.env.TEST_DATABASE_URL;
  if(!url||!['localhost','127.0.0.1','[::1]','::1'].includes(new URL(url).hostname))
    throw Error('Refusing non-local PostgreSQL for SAML revocation tests.');
  await openIsolatedSchema(url);
  db=createDb(neonShapedQuery());await db.initSchema();
  await db.upsertAccount({login:'example-org',accountId:1001,
    accountType:'Organization',label:'Example Org',credentialKind:'fine_grained'});
  gh=makeFakeGitHub({routes:ROUTES});
  credentials=createCredentials({db,env,fetch:gh.fetch,
    now:()=>Date.UTC(2026,9,22,17,0)});
  await credentials.storeFineGrained('example-org',
    'github_pat_FAKE0123456789abcdefghij',{expiresAt:null});
});
afterAll(async()=>{await closeIsolatedSchema()});
describe('SAML revocation uses the real PostgreSQL replay journal',()=>{
  it('rejects foreign and preview principals then accepts exactly one concurrent revocation',async()=>{
    let authorized=true;
    gh.when(ROUTES[0]).reply(200,()=>authorized?[record]:[]);
    gh.when(ROUTES[1]).reply(204,()=>{authorized=false;return null});
    const foreign=await dispatch({...conn,accounts:['another-org'],
      default_account:'another-org'},{...args,owner:'example-org',confirm:true});
    expect(foreign.status).not.toBe('applied');
    const limited=await dispatch({...conn,profile:'read_only'},{...args,confirm:true});
    expect(limited.status).not.toBe('applied');
    const preview=await dispatch({...conn,mode:'preview',pass:true,allow_writes:true,allow_access_changes:true},{...args,confirm:true});
    expect(preview.status).not.toBe('applied');
    const pending=await dispatch({...conn,pass:true,allow_writes:true,allow_access_changes:true},args);
    expect(pending.status).toBe('needs_confirmation');
    expect(affected()).toHaveLength(0);

    const [left,right]=await Promise.all([
      dispatch(conn,{...args,confirm:true}),
      dispatch(conn,{...args,confirm:true})
    ]);
    expect([left.status,right.status].sort()).toEqual(['applied','replayed']);
    expect(affected()).toHaveLength(1);
    expect(affected()[0].path).toBe(
      '/orgs/example-org/credential-authorizations/24680');
    const applied=left.status==='applied'?left:right;
    expect(applied).toMatchObject({done:true,confirmed:true});
    const repeat=await dispatch(conn,{...args,confirm:true});
    expect(repeat.status).toBe('replayed');
    expect(affected()).toHaveLength(1);

    const row=await db.getChange(applied.logged.id);
    expect(row.before).toMatchObject({credential_id:24680,login:'alice'});
    expect(JSON.stringify(row)).not.toMatch(/NEVERLOG|secret-fingerprint|scopes/);
    const claimed=await db.claimChange({tool:'github_org_saml_revoke_authorization',
      summary:'original key reserved',requestKey:applied.requestKey});
    expect(claimed).toMatchObject({claimed:false,existing:{confirmed:true}});
    expect(gh.invalid).toEqual([]);
  });
});
