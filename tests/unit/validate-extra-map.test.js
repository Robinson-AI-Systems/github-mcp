import {describe,it,expect} from 'vitest';
import {validateArgs} from '../../src/core/validate.js';

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
