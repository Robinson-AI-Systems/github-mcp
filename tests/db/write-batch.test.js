import {beforeAll,afterAll,beforeEach,describe,it,expect} from 'vitest';
import {createDb} from '../../src/db.js';
import {openIsolatedSchema,closeIsolatedSchema,rawQuery,neonShapedQuery} from '../../test/helpers/pg-neon-adapter.js';
const A='a'.repeat(64),B='b'.repeat(64),C='c'.repeat(64);
let db1,db2;
beforeAll(async()=>{
  if(!process.env.TEST_DATABASE_URL||!['localhost','127.0.0.1','::1','[::1]']
      .includes(new URL(process.env.TEST_DATABASE_URL).hostname))
    throw new Error('C-16 PostgreSQL tests require a disposable local TEST_DATABASE_URL.');
  await openIsolatedSchema(process.env.TEST_DATABASE_URL);
  db1=createDb(neonShapedQuery());
  db2=createDb(neonShapedQuery());
  await db1.initSchema();
});
afterAll(async()=>{await closeIsolatedSchema();});
beforeEach(async()=>{await rawQuery('TRUNCATE gh_write_batches');});
const claim=(db,more={})=>db.claimWriteBatch({
  key:A,connection:'tenant-1',account:'org',intentHash:B,lease:'lease-1',...more});
describe('C-16 write batch tenant journal on real disposable PostgreSQL',()=>{
  it('stores only hashes, lease state and bounded safe receipts; not source or provider secrets',async()=>{
    expect(await claim(db1)).toMatchObject({claimed:true,status:'running',items:[]});
    const items=[{index:0,name:'github_branch_create',status:'applied',
      reference:{sha:'d'.repeat(40),branch:'topic'},verified:true}];
    expect(await db1.saveWriteBatch({key:A,connection:'tenant-1',account:'org',
      lease:'lease-1',status:'complete',items})).toBe(true);
    const [row]=await rawQuery('SELECT * FROM gh_write_batches WHERE batch_id=$1',[A]);
    expect(row.status).toBe('complete');
    expect(row.intent_hash).toBe(B);
    expect(row.items).toEqual(items);
    expect(JSON.stringify(row)).not.toMatch(/access_token|source_bytes|private_key/);
    const replay=await claim(db2,{lease:'other'});
    expect(replay).toMatchObject({claimed:false,status:'complete',items});
  });
  it('atomic claims allow exactly one process to start a shared intent',async()=>{
    const [a,b]=await Promise.all([
      claim(db1,{lease:'left'}),claim(db2,{lease:'right'})]);
    expect([a,b].filter(x=>x.claimed)).toHaveLength(1);
    expect([a,b].find(x=>!x.claimed)).toMatchObject({status:'in_progress',items:[]});
  });
  it('denies other connection/account and conflicting intent without returning another tenant receipts',async()=>{
    await claim(db1);
    expect(await claim(db2,{connection:'tenant-2'})).toEqual({claimed:false,status:'denied',items:[]});
    expect(await claim(db2,{account:'another'})).toEqual({claimed:false,status:'denied',items:[]});
    expect(await claim(db2,{intentHash:C})).toEqual({claimed:false,status:'conflict',items:[]});
  });
  it('a stale lease may be reclaimed once and retains the prior started mutation to reconcile',async()=>{
    await claim(db1,{lease:'stale'});
    expect(await db1.saveWriteBatch({key:A,connection:'tenant-1',account:'org',
      lease:'stale',status:'running',
      items:[{index:0,name:'github_branch_create',status:'started'}]})).toBe(true);
    await rawQuery("UPDATE gh_write_batches SET lease_until=now()-interval '1 second' WHERE batch_id=$1",[A]);
    const [x,y]=await Promise.all([
      claim(db1,{lease:'restart-1'}),claim(db2,{lease:'restart-2'})]);
    expect([x,y].filter(z=>z.claimed)).toHaveLength(1);
    expect([x,y].find(z=>z.claimed).items).toEqual([
      {index:0,name:'github_branch_create',status:'started'}]);
    expect(await db1.saveWriteBatch({key:A,connection:'tenant-1',account:'org',
      lease:'stale',status:'complete',items:[]})).toBe(false);
  });
  it('never permits an expired, wrong-account or wrong-lease writer to overwrite a newer receipt',async()=>{
    await claim(db1);
    expect(await db1.saveWriteBatch({key:A,connection:'tenant-other',account:'org',
      lease:'lease-1',status:'complete',items:[]})).toBe(false);
    expect(await db1.saveWriteBatch({key:A,connection:'tenant-1',account:'org',
      lease:'wrong',status:'complete',items:[]})).toBe(false);
    await rawQuery("UPDATE gh_write_batches SET lease_until=now()-interval '1 second' WHERE batch_id=$1",[A]);
    expect(await db1.saveWriteBatch({key:A,connection:'tenant-1',account:'org',
      lease:'lease-1',status:'complete',items:[]})).toBe(false);
  });
  it('partial guard refusal is persisted, reusable only with the same SHA-256 plan, and cannot double-submit',async()=>{
    await claim(db1);
    const items=[{index:0,name:'github_branch_create',status:'applied',verified:true,
      reference:{sha:'f'.repeat(40)}},{index:1,name:'github_content_commit_git_data',status:'refused'}];
    expect(await db1.saveWriteBatch({key:A,connection:'tenant-1',account:'org',
      lease:'lease-1',items,status:'partial'})).toBe(true);
    const r=await claim(db2,{lease:'resume'});
    expect(r).toMatchObject({claimed:true,status:'running',items});
    expect(await claim(db1,{lease:'duplicate'})).toMatchObject({claimed:false,status:'in_progress'});
  });
  it('uncertain result cannot be reclaimed or re-issued automatically',async()=>{
    await claim(db1);
    expect(await db1.saveWriteBatch({key:A,connection:'tenant-1',account:'org',lease:'lease-1',
      items:[{index:0,name:'github_branch_create',status:'uncertain'}],
      status:'uncertain'})).toBe(true);
    expect(await claim(db2,{lease:'later'})).toMatchObject({claimed:false,status:'uncertain'});
  });
});
