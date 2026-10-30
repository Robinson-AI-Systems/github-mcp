// Trusted project service, never mounted into a coding allocation. Its bearer
// can only request a live recheck/cleanup of already revoked or expired work.
const url=new URL(process.env.PLAYGROUND_SWEEP_URL),key=process.env.PLAYGROUND_SWEEP_KEY;
if(url.protocol!=='https:'||url.username||url.password||!key||!/^[a-f0-9]{64}$/.test(key))throw new TypeError('Configure the fixed maintenance endpoint and cleanup-only capability.');
let running=false,stopping=false;
const tick=async()=>{if(running||stopping)return;running=true;try{const res=await fetch(url,{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(30000)});if(!res.ok)process.stderr.write('Allocation cleanup recheck pending.\n');await res.body?.cancel();}catch{process.stderr.write('Allocation cleanup endpoint unavailable; retained state will be rechecked.\n');}finally{running=false;}};
const timer=setInterval(()=>{void tick();},30000);void tick();
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{stopping=true;clearInterval(timer);});
