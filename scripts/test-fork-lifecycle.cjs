// Local Anvil forks only. Saves a per-chain/protocol test report and stage evidence.
/* eslint-disable @typescript-eslint/no-require-imports -- Standalone CommonJS Node runner, outside the application bundle. */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { loadEnvConfig } = require('@next/env');
loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
const chains = [
  [1,'Ethereum','MAINNET',['https://ethereum-rpc.publicnode.com','https://eth.llamarpc.com'],['aave-v3','spark','compound-v3','morpho-blue','fluid','euler-v2']],
  [8453,'Base','BASE',['https://mainnet.base.org','https://base-rpc.publicnode.com'],['aave-v3','compound-v3','morpho-blue','moonwell','fluid','euler-v2']],
  [42161,'Arbitrum','ARBITRUM',['https://arb1.arbitrum.io/rpc','https://arbitrum-one-rpc.publicnode.com'],['aave-v3','compound-v3','morpho-blue','fluid','euler-v2']],
  [10,'Optimism','OPTIMISM',['https://mainnet.optimism.io','https://optimism-rpc.publicnode.com'],['aave-v3','compound-v3','morpho-blue','moonwell']],
  [137,'Polygon','POLYGON',['https://polygon-bor-rpc.publicnode.com','https://polygon.drpc.org'],['aave-v3','morpho-blue','fluid']],
  [43114,'Avalanche','AVALANCHE',['https://api.avax.network/ext/bc/C/rpc'],['aave-v3','euler-v2']],
];
const earn = process.argv.includes('--earn');
if (earn) { chains.splice(3); for (const chain of chains) chain[4] = ['earn']; }
const dir = path.resolve('test-results', `${earn ? 'earn-' : ''}lifecycle-${new Date().toISOString().replace(/[:.]/g,'-')}`);
fs.mkdirSync(dir,{recursive:true});
const results = [];
const secrets = Object.entries(process.env).filter(([k])=>k.startsWith('RPC_URL_')).map(([,v])=>v).filter(Boolean);
const clean = s => secrets.reduce((s,v)=>s.split(v).join('[configured RPC]'),String(s));
const sleep = ms => new Promise(r=>setTimeout(r,ms));
async function rpc(url,method,params=[]) {
  const r = await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(15000)});
  const j=await r.json(); if(j.error)throw Error(j.error.message); return j.result;
}
function save() { fs.writeFileSync(path.join(dir,'summary.json'),JSON.stringify({createdAt:new Date().toISOString(),scope:'Contract executors on local Anvil forks; not browser wallet or mainnet transactions. Wallet balances are seeded; protocol caps and liquidity are not modified.',results},null,2)); }
async function runChain(c,index) {
  const [id,name,key,defaults,protocols]=c;
  const port=18545+index, local=`http://127.0.0.1:${port}`;
  let proc, block, upstream, logs='';
  try {
    for(const candidate of [process.env[`RPC_URL_${key}`],...defaults].filter(Boolean)) {
      try { const chain=await rpc(candidate,'eth_chainId'); if(Number(chain)!==id)throw Error('wrong chain'); block=Number(await rpc(candidate,'eth_blockNumber')); upstream=candidate;break; } catch(e) { console.log(`${name}: RPC probe failed: ${clean(e.message)}`); }
    }
    if(!upstream)throw Error('No upstream RPC available');
    proc=spawn('anvil',['--host','127.0.0.1','--port',String(port),'--chain-id','31337','--fork-url',upstream,'--fork-block-number',String(block),'--retries','2','--timeout','15000','--silent'],{windowsHide:true});
    proc.stdout.on('data',x=>logs+=clean(x));proc.stderr.on('data',x=>logs+=clean(x));
    let ready=false;
    for(let i=0;i<45;i++){if(proc.exitCode!==null)throw Error(`Anvil exited: ${logs.slice(-1000)}`);try{const v=await rpc(local,'web3_clientVersion');if(!/anvil/i.test(v))throw Error('Not Anvil');ready=true;break;}catch{}await sleep(1000);}
    if(!ready)throw Error('Anvil did not become ready');
    console.log(`${name}: fork ready at block ${block}`);
    for(const protocol of protocols) {
      if(process.env.LIFECYCLE_PROTOCOL && protocol!==process.env.LIFECYCLE_PROTOCOL)continue;
      const snapshot=await rpc(local,'evm_snapshot');
      console.log(`START ${name} ${protocol}`);
      const started=Date.now();const base=path.join(dir,`${id}-${protocol}`);
      let output='';
      const env={...process.env,FORK_RPC_URL:local,FORK_OF:String(id),FORK_PROTOCOL:protocol,[`RPC_URL_${key}`]:local};
      const code=await new Promise(resolve=>{
        const testArgs=earn?['tests/earn-fork.test.ts']:['tests/fork-borrow.test.ts','-t','borrow → partial repay → full repay → collateral back in the wallet'];
        const p=spawn(process.execPath,['node_modules/vitest/vitest.mjs','run',...testArgs,'--reporter=json',`--outputFile=${base}.json`],{env,windowsHide:true});
        const timer=setTimeout(()=>p.kill(),360000);
        p.stdout.on('data',x=>{output+=clean(x);});p.stderr.on('data',x=>output+=clean(x));
        p.on('error',e=>{output+=clean(e.message);});p.on('close',code=>{clearTimeout(timer);resolve(code);});
      });
      fs.writeFileSync(`${base}.log`,output);
      // Redact any configured RPC URLs in framework error reports too.
      if(fs.existsSync(`${base}.json`))fs.writeFileSync(`${base}.json`,clean(fs.readFileSync(`${base}.json`,'utf8')));
      const report=fs.existsSync(`${base}.json`)?JSON.parse(fs.readFileSync(`${base}.json`,'utf8')):null;
      const executed=report?.testResults?.flatMap(t=>t.assertionResults).filter(a=>a.status==='passed')??[];
      const passed=code===0&&(earn ? executed.length===({1:5,8453:5,42161:2}[id]) : executed.length===1&&executed[0].title.includes('collateral back in the wallet'));
      const result={chain:id,name,protocol,block,status:passed?'passed':'failed',seconds:Math.round((Date.now()-started)/1000),log:path.basename(`${base}.log`)};
      results.push(result);save();console.log(`END ${name} ${protocol}: ${result.status} (${result.seconds}s)`);
      if(code!==0)console.log(output.slice(-1800));
      await rpc(local,'evm_revert',[snapshot]);
    }
  } catch(e) {console.log(`BLOCKED ${name}: ${clean(e.message)}`);for(const protocol of protocols.filter(p=>!process.env.LIFECYCLE_PROTOCOL||p===process.env.LIFECYCLE_PROTOCOL)){if(!results.some(r=>r.chain===id&&r.protocol===protocol))results.push({chain:id,name,protocol,block,status:'blocked',reason:clean(e.message)});}save();}
  finally {if(proc)proc.kill();fs.writeFileSync(path.join(dir,`${id}-anvil.log`),logs);}
}
(async()=>{console.log(`Reports: ${dir}`);const selected=chains.filter(c=>!process.env.LIFECYCLE_CHAIN||c[0]===Number(process.env.LIFECYCLE_CHAIN));let next=0;await Promise.all([0,1].map(async()=>{while(next<selected.length){const c=selected[next++];await runChain(c,chains.indexOf(c));}}));save();console.log(JSON.stringify(results.map(({chain,protocol,status})=>({chain,protocol,status})),null,2));process.exitCode=results.some(r=>r.status!=='passed')?1:0;})();
