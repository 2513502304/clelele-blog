const CACHE = 'live2d-prototype-native-v1';
const MAX_BYTES = 128 * 1024 * 1024, MAX_ENTRIES = 512;
const transient = new Set([408,429,500,502,503,504]);
const digest = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
const wait = (ms, signal) => new Promise((resolve,reject) => {
  signal?.throwIfAborted(); const abort=()=>{clearTimeout(timer);reject(signal.reason);};
  const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},ms);
  signal?.addEventListener('abort',abort,{once:true});
});

/** Verified bytes only; bounded FIFO eviction. Decoded models and GPU sessions are never cached. */
export function createModelResourceCache({ request = globalThis.fetch.bind(globalThis), open = () => caches.open(CACHE), maxBytes = MAX_BYTES, timeoutMs = 30000 } = {}) {
  let cachePromise, sizes, writes=Promise.resolve();
  const cache=()=>cachePromise??=Promise.resolve().then(open).catch(()=>null);
  const save=(store,key,response,size)=>writes=writes.then(async()=>{
    if(size>maxBytes)return;
    if(!sizes){sizes=new Map();for(const req of await store.keys())sizes.set(req.url,Number((await store.match(req))?.headers.get('Content-Length'))||0);}
    sizes.delete(key);let total=size+[...sizes.values()].reduce((a,b)=>a+b,0);
    for(const [old,n] of sizes){if(total<=maxBytes&&sizes.size<MAX_ENTRIES)break;await store.delete(old);sizes.delete(old);total-=n;}
    await store.put(key,response);sizes.set(key,size);
  }).catch(()=>{sizes=undefined;});
  return async (input, init={}) => {
    const url=new URL(String(input),location.href), signal=init.signal;signal?.throwIfAborted();
    const asset=/\/assets\/([a-f0-9]{64})(\.[a-z0-9.]+)$/.exec(url.pathname);
    // The decoded hash is stable, but compression bytes can differ. Keep source identity
    // so each pinned manifest sees the stored representation it declares.
    const key=asset?url.href:null, store=key?await cache():null;
    const hit=store?await store.match(key).catch(()=>null):null;signal?.throwIfAborted();if(hit)return hit;
    for(let attempt=0;attempt<3;attempt++){
      try{
        const timeout=AbortSignal.timeout(timeoutMs), joined=signal?AbortSignal.any([signal,timeout]):timeout;
        const response=await request(url.href,{...init,signal:joined,cache:'force-cache'});
        if(!response.ok){await response.body?.cancel();const e=Error(`资源请求失败（HTTP ${response.status}）`);e.retry=transient.has(response.status);throw e;}
        const bytes=await response.arrayBuffer();joined.throwIfAborted();
        if(bytes.byteLength>64*1024*1024)throw Error('资源超出大小限制。');
        if(asset){
          let decoded=bytes;
          // Some HTTP stacks already decompress gzip; its magic bytes distinguish that case.
          if(asset[2].endsWith('.gz')&&new Uint8Array(bytes)[0]===31&&new Uint8Array(bytes)[1]===139)
            decoded=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
          if(await digest(decoded)!==asset[1]){const e=Error('资源校验失败，未写入缓存；请重试。');e.retry=true;throw e;}
        }else{
          const value=JSON.parse(new TextDecoder().decode(bytes));
          if(!value?.files||![2,3].includes(value.format))throw Error('模型清单格式不正确。');
        }
        signal?.throwIfAborted();
        const result=new Response(bytes,{headers:{'Content-Type':asset?'application/octet-stream':'application/json','Content-Length':String(bytes.byteLength)}});
        if(store)await save(store,key,result.clone(),bytes.byteLength);
        signal?.throwIfAborted();return result;
      }catch(error){signal?.throwIfAborted();if(attempt===2||!(error.retry||error instanceof TypeError||error.name==='TimeoutError'))throw error;await wait(300*2**attempt,signal);}
    }
  };
}
export const fetchModelResource = createModelResourceCache();
