import {describe,it,expect} from 'vitest';
import {validateArgs,validateToolArgs} from '../../src/core/validate.js';

describe('mapped object input validation',()=>{
  const nested={type:'object',maxProperties:2,additionalProperties:{
    type:'array',maxItems:2,uniqueItems:true,items:{type:'string',minLength:1,maxLength:12}
  }};
  const schema={type:'object',properties:{rules:nested},required:['rules'],additionalProperties:false};
  it('accepts a bounded valid dynamic key map',()=>{
    expect(validateArgs(schema,{rules:{hello:['/src'],repo:['/private']}})).toBeNull();
  });
  it('validates every extra value against the specified item schema',()=>{
    expect(validateArgs(schema,{rules:{hello:['/src',17]}})).toContain('must be text');
    expect(validateArgs(schema,{rules:{hello:['/a','/b','/c']}})).toContain('too many');
    expect(validateArgs(schema,{rules:{hello:['/x'],two:['/y'],three:['/z']}})).toContain('too many properties');
  });
  it('does not permit arbitrary props at the root or in closed nested maps',()=>{
    expect(validateArgs(schema,{rules:{hello:['/src']},unknown:1})).toContain('Unknown argument');
    const closed={type:'object',properties:{user:{type:'object',properties:{name:{type:'string'}},additionalProperties:false}}};
    expect(validateArgs(closed,{user:{name:'a',secret:'not accepted'}})).toContain('Unknown argument');
  });
});

it('does not reflect a truncated credential prefix from an unknown long property name',()=>{
  const key='rtc_pass_'+'x'.repeat(43);
  const message=validateArgs({type:'object',properties:{},additionalProperties:false},{[key]:true});
  expect(message).toContain('Unknown argument');
  expect(message).not.toContain(key.slice(0,40));
});
it('names every missing argument at once, and any unknown one beside them (ALL-MISSING-1)',()=>{
    const s2={type:'object',properties:{repo:{type:'string'},runId:{type:'integer'},expectedHeadSha:{type:'string'}},
      required:['repo','runId','expectedHeadSha'],additionalProperties:false};
    expect(validateArgs(s2,{repo:'x'})).toBe('runId and expectedHeadSha are required.');
    expect(validateArgs(s2,{})).toBe('repo, runId and expectedHeadSha are required.');
    expect(validateArgs(s2,{repo:'x',pr:5})).toBe('runId and expectedHeadSha are required. Not arguments of this tool: pr.');
    expect(validateArgs(s2,{repo:'x',runId:1})).toBe('expectedHeadSha is required.');
});
it('names a required argument that has an alias in the same message as an unknown one (ALL-MISSING-2)',()=>{
  const tool={inputSchema:{type:'object',properties:{repo:{type:'string'},runId:{type:'integer'},run_id:{type:'integer'}},required:['repo'],additionalProperties:false},
    canonicalRequired:['repo','runId'],aliases:{runId:['run_id']}};
  expect(validateToolArgs(tool,{repo:'x',pr:5})).toBe('runId is required. Not arguments of this tool: pr.');
  expect(validateToolArgs(tool,{repo:'x',run_id:5})).toBeNull();
  expect(validateToolArgs(tool,{repo:'x',runId:5})).toBeNull();
  expect(validateToolArgs(tool,{pr:5})).toBe('repo and runId are required. Not arguments of this tool: pr.');
});
