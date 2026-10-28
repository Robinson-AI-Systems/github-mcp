// CAP-4: the protected SCIM write journal must really enforce replay,
// profile and account boundaries under PostgreSQL, not merely the fake DB.
// All external requests use an in-memory synthetic GitHub; no live org writes.
import crypto from 'node:crypto';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {createDb} from '../../src/db.js';
import {createCredentials} from '../../src/github/credentials.js';
import {createDispatch} from '../../src/tools/dispatch.js';
import {registry} from '../../src/tools/index.js';
import {makeFakeGitHub} from '../../test/helpers/fake-github.js';
import {openIsolatedSchema,closeIsolatedSchema,neonShapedQuery} from '../../test/helpers/pg-neon-adapter.js';

const R={
  list:'GET /scim/v2/organizations/{org}/Users',
  create:'POST /scim/v2/organizations/{org}/Users',
  get:'GET /scim/v2/organizations/{org}/Users/{scim_user_id}'
};
const USER='provider-test@work.example';
const args={userName:USER,primaryEmail:USER,givenName:'Provider',familyName:'Test',
  displayName:'Provider Test'};
const env={TOKEN_ENCRYPTION_KEY:crypto.randomBytes(32).toString('base64url')};
const conn={client_id:'db-scim-connection',accounts:['example-org'],
  default_account:'example-org',mode:'production',profile:'full',listing:'catalog'};
let db,credentials,gh;
const calls=()=>gh.calls.filter(x=>x.method==='POST');
async function run(connection,input){
  const res=await createDispatch({env,credentials,fetch:gh.fetch,
    now:()=>Date.UTC(2026,9,22,17,0,0),sleep:async()=>{},gates:[]})({
    registry,name:'github_org_scim_provision',args:input,
    connection,db});
  return res.structuredContent;
}
beforeAll(async()=>{
  const url=process.env.TEST_DATABASE_URL;
  if(!url||!['localhost','127.0.0.1','[::1]','::1'].includes(new URL(url).hostname))
    throw Error('Refusing non-local PostgreSQL for SCIM contract tests.');
  await openIsolatedSchema(url);
  db=createDb(neonShapedQuery());
  await db.initSchema();
  await db.upsertAccount({login:'example-org',accountId:1001,
    accountType:'Organization',label:'Example Org',credentialKind:'fine_grained'});
  gh=makeFakeGitHub({routes:Object.values(R)});
  credentials=createCredentials({db,env,fetch:gh.fetch,
    now:()=>Date.UTC(2026,9,22,17,0,0)});
  await credentials.storeFineGrained('example-org',
    'github_pat_FAKE0123456789abcdefghij',{expiresAt:null});
});
afterAll(async()=>{await closeIsolatedSchema()});
describe('SCIM replay and authorization with disposable PostgreSQL',()=>{
  it('enforces owner/profile/mode, issues one exact write and journals replay across dispatchers',async()=>{
    let member=null;
    gh.when(R.list).reply(200,()=>({
      totalResults:member?1:0,startIndex:1,itemsPerPage:member?1:0,
      Resources:member?[member]:[]}));
    gh.when(R.create).reply(201,()=>{
      member={id:'db-scim-person-1',userName:USER,
        displayName:'Provider Test',active:true,externalId:'idp-1',
        name:{givenName:'Provider',familyName:'Test'},
        emails:[{value:USER,primary:true}]};
      return member;
    });
    gh.when(R.get).reply(200,()=>member);

    const preview=await run(conn,{...args,dryRun:true});
    expect(preview.status).toBe('preview');
    expect(calls()).toHaveLength(0);
    const notConfirmed=await run({...conn,pass:true,allow_writes:true,allow_access_changes:true},args);
    expect(notConfirmed.status).toBe('needs_confirmation');
    expect(calls()).toHaveLength(0);
    const foreign=await run({...conn,accounts:['another-org'],
      default_account:'another-org'},{...args,owner:'example-org',confirm:true});
    expect(foreign?.status).not.toBe('applied');
    expect(calls()).toHaveLength(0);
    const restricted=await run({...conn,profile:'read_only'},{...args,confirm:true});
    expect(restricted?.status).not.toBe('applied');
    expect(calls()).toHaveLength(0);
    const inactive=await run({...conn,mode:'preview',pass:true,allow_writes:true,allow_access_changes:true},{...args,confirm:true});
    expect(inactive?.status).not.toBe('applied');
    expect(calls()).toHaveLength(0);

    const first=await run(conn,{...args,confirm:true});
    expect(first).toMatchObject({status:'applied',done:true,confirmed:true});
    expect(calls()).toHaveLength(1);
    expect(calls()[0].route).toBe(R.create);
    expect(calls()[0].body.name).toEqual({givenName:'Provider',
      familyName:'Test'});
    const replay=await run(conn,{...args,confirm:true});
    expect(replay).toMatchObject({status:'replayed',replayed:true,
      requestKey:first.requestKey});
    expect(calls()).toHaveLength(1);
    const persisted=await db.claimChange({tool:'github_org_scim_provision',
      summary:'same intent across instances',requestKey:first.requestKey});
    expect(persisted).toMatchObject({claimed:false,existing:{confirmed:true}});
    expect(gh.invalid).toEqual([]);
  });
});
