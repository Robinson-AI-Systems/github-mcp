// F-3: real GitHub search across six result types, with bounded fragments.
// Never return raw blobs, entire files or unbounded search hits.
import { defineRead } from './define-read.js';
import { plain, readerFor } from './github-read.js';
const OWNER={type:'string',maxLength:39};
const ROUTES={
  code:'GET /search/code',issue:'GET /search/issues',
  pull_request:'GET /search/issues',commit:'GET /search/commits',
  repository:'GET /search/repositories',user:'GET /search/users'
};
const truncate=(v,n)=>typeof v==='string'?v.slice(0,n):null;
const repoName=x=>x?.repository?.full_name??(typeof x?.repository_url==='string'
  ?x.repository_url.replace('https://api.github.com/repos/',''):null);
// PUB-5 C: search results fail closed: text is untrusted unless GitHub says the author is an owner, member or collaborator.
const outsider=x=>['OWNER','MEMBER','COLLABORATOR'].includes(x?.author_association)?{}:{untrusted:true};
const projected={
  code:x=>({name:x.name,path:x.path,sha:x.sha,repository:repoName(x),url:x.html_url,
    fragments:(x.text_matches??[]).slice(0,2).map(t=>({
      fragment:truncate(t.fragment,220),
      matches:(t.matches??[]).slice(0,3).map(m=>truncate(m.text,60))
    }))}),
  issue:x=>({number:x.number,title:truncate(x.title,300),state:x.state,
    repository:repoName(x),url:x.html_url,author:x.user?.login,
    updated_at:x.updated_at,...outsider(x)}),
  pull_request:x=>({number:x.number,title:truncate(x.title,300),state:x.state,
    repository:repoName(x),url:x.html_url,author:x.user?.login,
    draft:x.draft??false,updated_at:x.updated_at,...outsider(x)}),
  // A commit message can be written by anyone who can push to a fork: always repository text, never instructions.
  commit:x=>({sha:x.sha,repository:repoName(x),
    message:truncate(x.commit?.message,240),author:x.author?.login,
    url:x.html_url,untrusted:true}),
  repository:x=>({full_name:x.full_name,private:x.private,
    description:truncate(x.description,240),stars:x.stargazers_count,
    updated_at:x.updated_at,url:x.html_url}),
  user:x=>({login:x.login,type:x.type,url:x.html_url})
};
export const searchGitHub=defineRead({
  name:'github_search_github',area:'search',audience:['B','Op'],
  description:'Search GitHub code, issues, PRs, commits, repos or users (find organizations: type users plus type:org in the query).',
  properties:{
    owner:OWNER,
    type:{type:'string',enum:Object.keys(ROUTES)},
    query:{type:'string',minLength:1,maxLength:500},
    sort:{type:'string',maxLength:32},
    order:{type:'string',enum:['asc','desc']},
    page:{type:'integer',minimum:1,maximum:100},
    max:{type:'integer',minimum:1,maximum:50}
  },
  required:['type','query'],
  handler:(a,ctx)=>plain(async()=>{
    const {octokit}=await readerFor(a,ctx);
    const max=a.max??20,page=a.page??1;
    if(page*max>1000)throw new TypeError('GitHub search exposes up to 1000 results; choose an earlier page or smaller max.');
    // GitHub issues search includes PRs. Constrain type at the query level,
    // then independently exclude mismatched server responses.
    const query=a.type==='issue'?`${a.query} is:issue`:a.type==='pull_request'?`${a.query} is:pr`:a.query;
    const route=ROUTES[a.type];
    const params={q:query,per_page:max,page,
      ...(a.order?{order:a.order}:{}),...(a.sort?{sort:a.sort}:{}),
      ...(a.type==='code'?{headers:{accept:'application/vnd.github.text-match+json'}}:{})};
    const {data}=await octokit.request(route,params);
    if(!data||!Array.isArray(data.items)||!Number.isSafeInteger(data.total_count))
      throw new TypeError('GitHub returned malformed search results. No result was trusted.');
    const items=data.items.filter(x=>a.type!=='issue'||!x.pull_request)
      .filter(x=>a.type!=='pull_request'||!!x.pull_request)
      .map(projected[a.type]);
    return {
      type:a.type,query,page,count:items.length,total_count:data.total_count,
      incomplete_results:data.incomplete_results===true,
      completeness:data.incomplete_results===true?'incomplete':'provider_reported_complete',
      ...(items.length===0?{absence_verified:false,warning:data.incomplete_results===true
        ?'GitHub returned an incomplete zero-hit search. This does not establish absence. Narrow the query and retry, or inspect the exact file/tree at a ref.'
        :'No indexed matches were returned. Search indexing, visibility and query semantics can omit existing content; inspect exact files before asserting absence.'}:{}),
      items,more_possible:page*max<Math.min(data.total_count,1000),
      ...(data.total_count>1000?{github_result_cap:1000}:{})
    };
  })
});
export const tools=[searchGitHub.tool];
export const handlers={[searchGitHub.tool.name]:searchGitHub.handler};
