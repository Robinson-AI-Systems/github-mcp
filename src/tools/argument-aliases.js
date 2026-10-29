// Provider spelling compatibility, never argument guessing. Keep distinct declared
// arguments distinct; normalize before authorization, journaling and request keys.
export function standardAliases(name, properties) {
 const aliases={};
 const add=(canonical,names)=>{
  if(!Object.hasOwn(properties,canonical))return;
  const free=names.filter(alias=>!Object.hasOwn(properties,alias));
  if(free.length)aliases[canonical]=free;
 };
 add('runId',['run_id']);add('jobId',['job_id']);add('artifactId',['artifact_id']);
 add('max',['limit']);add('limit',['max']);
 if(name.startsWith('github_pr_'))add('number',['pull_number','pr','issue_number']);
 add('issue_number',['number']);
 if(name==='github_branch_create')add('from',['fromRef']);
 return aliases;
}
