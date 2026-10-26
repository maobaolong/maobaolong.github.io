(function(){'use strict';
const root=document.querySelector('.kv-review-guide');if(!root)return;
const zh=root.dataset.locale==='zh';
const byId=id=>root.querySelector('#'+id);

const revision='383874621325a7057190711527ad268c183e0b19';
root.querySelectorAll('[data-src]').forEach(a=>{const raw=a.dataset.src;const match=raw.match(/^(.*?)(?::(\d+))?$/);a.href='https://github.com/maobaolong/vllm/blob/'+revision+'/'+match[1]+(match[2]?'#L'+match[2]:'');});
function renderAmbiguity(blocks){
 root.querySelectorAll('[data-blocks]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.blocks)===blocks)));
 const badge=byId('ambiguityBadge');badge.textContent=blocks===2?(zh?'Shape 和 stride 完全相同':'Identical shape and strides'):(zh?'这两种 shape 现在可区分':'These two shapes now differ');badge.className='pill '+(blocks===2?'warn':'done');
 const total=blocks*4;
 for(const order of ['bf','kf']){
  const shape=order==='bf'?[blocks,2,1,1,2,1]:[2,blocks,1,1,2,1];
  const stride=[shape[1]*2,2,2,2,1,1];
  byId(order+'Shape').textContent=(zh?'形状 [':'shape [')+shape.join(',')+(zh?'] · 步长 [':'] · stride [')+stride.join(',')+']';
  const mem=byId(order+'Memory');mem.replaceChildren();
  for(let i=0;i<total;i++){
   const kv=order==='bf'?Math.floor(i/2)%2:Math.floor(i/(blocks*2));
   const block=order==='bf'?Math.floor(i/4):Math.floor((i%(blocks*2))/2);
   const cell=document.createElement('div');cell.className='cell'+(kv?' v':'');cell.textContent=String(i);
   const desc=document.createElement('small');desc.textContent=(kv?'V':'K')+(zh?' · 块':' · b')+block;cell.append(desc);mem.append(cell);
  }
  const sequences=[0,1].map(kv=>{const seq=[];for(let b=0;b<blocks;b++)for(let n=0;n<2;n++)seq.push(order==='bf'?(b*2+kv)*2+n:(kv*blocks+b)*2+n);return seq;});
  const out=byId(order+'Canonical');out.replaceChildren();sequences.forEach((seq,k)=>{const line=document.createElement('div');line.textContent=(k?'V':'K')+' = ['+seq.join(', ')+']';out.append(line);});
 }
}
root.querySelectorAll('[data-blocks]').forEach(b=>b.addEventListener('click',()=>renderAmbiguity(Number(b.dataset.blocks))));renderAmbiguity(2);
const traceEn=[
 ['initialize_kv_cache','GPUModelRunner · gpu/model_runner.py',0,'The runner creates a fresh empty dictionary. It is an output parameter, not a requested allocation layout.'],
 ['init_kv_cache','gpu/attn_utils.py',0,'The same dictionary is passed down. The standard and HiSparse allocation branches both accept it.'],
 ['allocate_kv_cache','worker/utils.py',0,'The allocator allocates backing storage and walks the allocation plan. Self-managed raw storage does not acquire an axis entry.'],
 ['create_kv_cache_views','kv_cache_interface.py',2,'The function creates the actual per-layer BHNC views, then updates this dictionary with the roles for their layer keys.'],
 ['propagate shared aliases','gpu/attn_utils.py',3,'A shared layer uses its target tensor and inherits the matching descriptor. Different names need not mean different storage.'],
 ['get_kv_connector → ActiveKVConnector','gpu/kv_connector.py',3,'The runner passes caches and the populated dictionary. The active connector invokes the new registration hook.'],
 ['register_kv_caches_with_layouts','connector base / opt-in child',3,'An opt-in child can consume the declaration. The inherited base validates supplied entries, then calls the old tensor-only hook; it does not teach that old hook to use metadata.']
];
const traceZh=[
  [
    "initialize_kv_cache",
    "GPUModelRunner · gpu/model_runner.py",
    0,
    "Runner 创建一个新的空字典。这是输出参数，不是请求 allocator 采用某种布局。"
  ],
  [
    "init_kv_cache",
    "gpu/attn_utils.py",
    0,
    "继续传递同一个字典。标准分配和 HiSparse 两条路径都接收它。"
  ],
  [
    "allocate_kv_cache",
    "worker/utils.py",
    0,
    "Allocator 分配 backing storage 并遍历分配计划。自管理的 raw storage 不会获得轴声明。"
  ],
  [
    "create_kv_cache_views",
    "kv_cache_interface.py",
    2,
    "先创建真正的逐层 BHNC view，再把这些层名对应的轴角色填入同一个字典。"
  ],
  [
    "传递共享别名",
    "gpu/attn_utils.py",
    3,
    "共享层使用目标张量，并继承匹配的描述符。不同层名不一定代表不同 storage。"
  ],
  [
    "get_kv_connector → ActiveKVConnector",
    "gpu/kv_connector.py",
    3,
    "Runner 传入 caches 和已经填好的字典，ActiveKVConnector 调用新的注册 hook。"
  ],
  [
    "register_kv_caches_with_layouts",
    "connector base／主动接入的 child",
    3,
    "主动接入的 child 可以消费声明。继承的 base 实现先校验，再调用旧的只传张量的 hook；旧 hook 不会因此自动学会使用 metadata。"
  ]
];
const trace=zh?traceZh:traceEn;
const stepContainer=byId('traceSteps');
function chooseStep(index){
 stepContainer.querySelectorAll('button').forEach((b,i)=>b.setAttribute('aria-pressed',String(i===index)));
 const t=trace[index];byId('traceTitle').textContent=t[0];byId('traceCount').textContent=String(t[2]);byId('traceExplanation').textContent=t[3];
 const obj={};if(t[2]>=2){obj['layer.0']=['BLOCK','HEAD','STATE','CONTENT'];obj['layer.1']=['BLOCK','HEAD','STATE','CONTENT'];}if(t[2]===3)obj[zh?'layer.2（layer.0 的别名）':'layer.2 (alias of layer.0)']=['BLOCK','HEAD','STATE','CONTENT'];
 byId('tracePayload').textContent=JSON.stringify(obj,null,2);
}
trace.forEach((t,i)=>{const b=document.createElement('button');b.type='button';b.className='step';b.setAttribute('aria-pressed','false');const n=document.createElement('span');n.className='index';n.textContent=String(i+1);const text=document.createElement('span');const title=document.createElement('b');title.textContent=t[0];const detail=document.createElement('span');detail.className='detail';detail.textContent=t[1];text.append(title,detail);b.append(n,text);b.addEventListener('click',()=>chooseStep(i));stepContainer.append(b);});chooseStep(0);
})();

