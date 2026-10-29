import {standardAliases} from './argument-aliases.js';
// GitHub's flavour of the write layer (B-1): the request key, the plain handling of the client's own errors, and the
// rule that a write is attempted only through `githubFor` (the pinned, spaced, rate-aware client).
import { defineWrite } from '../core/write.js';
import { requestKey } from '../github/client.js';
import { GithubClientError } from '../github/errors.js';
import { explainGithubError } from './errors.js';

export { explainGithubError };

/** GitHub answered "no" (a 4xx other than a timeout): the change definitely was not made. Transport errors and 5xx are uncertain. */
export function classifyGithubError(error) {
  if (error instanceof GithubClientError) return 'rejected'; // raised before any request was sent
  const status = error?.status;
  return Number.isInteger(status) && status >= 400 && status < 500 && status !== 408 ? 'rejected' : 'uncertain';
}

/** @param {Parameters<typeof defineWrite>[0]} spec same as `defineWrite`; the request key, error handling default to GitHub's. */
export function defineGithubWrite(spec) {
  const definition = defineWrite({
    classifyError: classifyGithubError,
    explain: explainGithubError,
    requestKey: (ctx, args) => requestKey(ctx, spec.name, args),
    ...spec
  });
  // Compatibility is shared by direct and wrapped routes; normalization happens
  // before the existing lifecycle sees target arguments or computes replay keys.
  const aliases=standardAliases(spec.name,spec.properties??{});
  const entries=Object.entries(aliases).flatMap(([canonical,names])=>names.map(alias=>[canonical,alias]));
  if(!entries.length)return definition;
  const {tool,handler}=definition;
  return Object.freeze({
    tool:Object.freeze({...tool,aliases:Object.freeze(Object.fromEntries(Object.entries(aliases).map(([key,names])=>[key,Object.freeze(names)]))),canonicalRequired:Object.freeze([...(spec.required??[])]),
      inputSchema:{...tool.inputSchema,properties:{...tool.inputSchema.properties,...Object.fromEntries(entries.map(([canonical,alias])=>[alias,{...spec.properties[canonical],description:'Alias for '+canonical+'.'}]))},
        ...(tool.inputSchema.required?{required:tool.inputSchema.required.filter(key=>!Object.hasOwn(aliases,key))}:{})}}),
    handler:(args,ctx)=>{
      if(!args||typeof args!=='object'||Array.isArray(args))return handler(args,ctx);
      const normalized={...args};
      for(const [canonical,alias] of entries){
        if(!Object.hasOwn(args,alias))continue;
        if(Object.hasOwn(normalized,canonical)&&normalized[canonical]!==args[alias])throw new TypeError('Conflicting '+canonical+' and '+alias+'; provide one value.');
        normalized[canonical]=args[alias];delete normalized[alias];
      }
      for(const canonical of Object.keys(aliases))if(spec.required?.includes(canonical)&&normalized[canonical]===undefined)
        throw new TypeError(canonical+' is required (or an accepted alias).');
      return handler(normalized,ctx);
    }
  });
}
