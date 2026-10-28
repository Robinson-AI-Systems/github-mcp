import { isReviewedFree } from './spend-classes.js';
// U-1: reviewed conservative policy for non-curated universal operations.
// A miss cannot become a non-production, non-access-widening, or free operation.
const productionWords=/(create|delete|transfer|invite|enable|assign|approve|revoke|purchase|upgrade|grant|publish|set|change|update settings|remove)/i;
const accessWords=/(collaborat|member|team|role|permission|visibility|public|invitation|access|token|key|secret|bypass|rule|organization|security)/i;
const protectedPaths=/(^\/orgs\/|^\/enterprises\/|\/(rulesets|branches\/\{branch\}\/protection|actions\/permissions|hooks|keys|environments|pages|releases|git\/refs|settings|security-and-analysis))/i;
export function classifyUniversal(op) {
  if (!op || !op.method || op.method==='GET') return Object.freeze({production:false,accessWidening:false,notifies:false,spendRisk:false});
  const s=op.summary+' '+op.path+' '+(op.operationId??'');
  // Classification is fail-closed: absence of a pricing keyword does not
  // prove this write has no usage charge, seat cost or future metering.
  // Unknown writes remain both production and access changes until individually classified.
  const classification={
    production:protectedPaths.test(op.path)||productionWords.test(s)||!['GET','HEAD'].includes(op.method),
    accessWidening:accessWords.test(s)||productionWords.test(s)||!['GET','HEAD'].includes(op.method),
    notifies:op.notifies===true,
    spendRisk:!isReviewedFree(op)
  };
  return Object.freeze(classification);
}
export function assertUniversalAuthority(op,params,body,{ownerDirected=false}={}) {
  const path=op.path.toLowerCase();
  if (path.startsWith('/app/') || path==='/app' || path.startsWith('/applications/'))
    throw new TypeError('App-JWT/application management endpoints are not available through universal tools.');
  // Enterprise routes must carry a verifiable enterprise slug; the universal
  // dispatcher enforces the master's real admin membership before any request.
  // Never make a local blanket ban override GitHub's verified enterprise grants.
  if ((path.startsWith('/enterprises/') || path.startsWith('/enterprise/')) &&
      !/^\/enterprises\/\{enterprise\}(?:\/|$)/.test(op.path))
    throw new TypeError('Enterprise operations require a verified enterprise slug in the pinned route.');
  if (op.method==='HEAD' || op.method==='OPTIONS')
    throw new TypeError('Use a documented GET operation for a readable result.');
  if (/\/(dependabot|actions|codespaces)\/secrets(\/|$)/i.test(path) && op.method!=='GET')
    throw new TypeError('Secret writes must use the curated sealed-secret tool.');
  if (/\/(private-vulnerability-reporting|secret-scanning)\/(.*\/)?(secrets|secret)/i.test(path) && op.method!=='GET')
    throw new TypeError('Secret material cannot be submitted through universal tools.');
  const all={params,body};
  const visit=(value,key='',depth=0)=>{
    if(depth>16)throw new TypeError('Request nesting is too deep.');
    if(!ownerDirected && key===['bypass','rules'].join('_') && value===true)throw new TypeError('Rule bypass is never permitted.');
    if(typeof value==='string'){
      if(/(password|(^|_)access_token|private_key|client_secret|(^|_)secret_value|refresh_token)/i.test(key))
        throw new TypeError('Credential or private key arguments are not permitted.');
      if(/(github_pat_[A-Za-z0-9_]+|gh[pousr]_[A-Za-z0-9._-]{18,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/.test(value))
        throw new TypeError('Credential or private key material is not permitted.');
    } else if(Array.isArray(value))value.forEach(x=>visit(x,key,depth+1));
    else if(value && typeof value==='object')for(const [k,v]of Object.entries(value))visit(v,k,depth+1);
  };
  visit(all);
}
export function universalPrice(op) {
  // A provider write's bill can depend on future usage, external entitlement
  // and the tenant's activity; it cannot be priced by a regex over its name.
  // Null invokes the shared unknown-spend classification, confirmation and
  // *user-chosen* cap/RTC pass refusal rather than a developer-global ban.
  // Only 54 individually reviewed, pinned routes have provably zero cost.
  if (!op || op.method === 'GET') return 0;
  return isReviewedFree(op) ? 0 : null;
}
