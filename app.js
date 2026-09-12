'use strict';
const $ = id => document.getElementById(id);
const drawing = new FlyDrawing($('fly'));
let previewBody = new FlyBody();
let current = { body: previewBody.snapshot(), brain: {timeMs:0}, events:[] };
let worker, paused=false, ready=false, contactOn=false, trialSeed=1;
let frames=[], renderTimes=[], lastFrame=0, workerSamples=[], rasterEvents=[];
let displayedCounts=[0,0,0], rateDuration=0;
let framesSinceRaster=0;

function experimentWorker(FlyBrain, FlyBody) {
  let brain, body, paused=false, lastWall=0, credit=0, sequence=0, raster=[], config, seed;
  let computeMs=0, stepsSinceReport=0, reportedAt=0;
  let watch;
  function report() {
    const snap=brain.snapshot();
    const m=config.groups.mn9;
    postMessage({type:'state',sequence:sequence++,brain:snap,body:body.snapshot(),events:raster,
      mn9:m.map(i=>({index:i,spikes:brain.counts[i],voltage:brain.voltage(i)})),computeMs,steps:stepsSinceReport,seed,
      memoryBytes:config.buffer.byteLength + brain.size * 65,paused});
    raster=[];computeMs=0;stepsSinceReport=0;reportedAt=brain.tick;
  }
  function initialize(newSeed) {
    seed=newSeed;
    const {meta,buffer}=config, n=meta.neuronCount,m=meta.edgeCount,o=meta.byteOffsets;
    brain=new FlyBrain({offsets:new Uint32Array(buffer,o.offsets,n+1),targets:new Uint32Array(buffer,o.targets,m),
      weights:new Int16Array(buffer,o.weights,m),ids:new BigUint64Array(buffer,o.ids,n),
      groups:{sweet:meta.groups.sweet,bitter:meta.groups.bitter,mn9:meta.groups.mn9,roundup:meta.groups.roundup}},seed);
    body=new FlyBody();watch=new Int16Array(n).fill(-1);
    for(let k=0;k<21;k++){watch[meta.groups.sweet[k]]=k;watch[meta.groups.bitter[k]]=21+k;}
    watch[meta.groups.mn9[0]]=42;watch[meta.groups.mn9[1]]=43;
    raster=[];credit=0;computeMs=0;stepsSinceReport=0;reportedAt=0;lastWall=performance.now();
    config.groups=meta.groups;report();
  }
  onmessage = e => {
    const a=e.data;
    if(a.type==='init'){config=a;initialize(a.seed);postMessage({type:'ready'});setTimeout(run,8);return;}
    if(!brain)return;
    if(a.type==='drop')body.drop={...body.drop,x:a.x,y:a.y};
    if(a.type==='controls'){
      body.bitter=a.bitter;body.blockTaste=a.taste;
      brain.setClamped('mn9',a.motor);
    }
    if(a.type==='pause'){paused=a.value;lastWall=performance.now();credit=0;report();}
    if(a.type==='reset'){initialize(a.seed);}
  };
  function run() {
    const now=performance.now();credit+=paused?0:Math.min(100,now-lastWall);lastWall=now;
    if(!paused){
      const start=performance.now();let count=0;
      // Bounded batches keep interaction responsive even on a slower machine.
      const target=Math.min(1000,Math.floor(credit*10));
      for(let k=0;k<target;k++){
        if(k%100===0&&performance.now()-start>10)break;
        brain.setRates(...body.sensoryRates());
        const spikes=brain.step();let motor=0;
        for(const i of spikes){const row=watch[i];if(row>=0)raster.push([(brain.tick-1)*.1,row]);if(row>=42)motor++;}
        body.step(.1,motor);count++;
      }
      computeMs+=performance.now()-start;stepsSinceReport+=count;credit-=count*.1;
      // Discard excessive wall-time debt, never skip or alter neural steps.
      credit=Math.min(credit,100);
      if(brain.tick-reportedAt>=330)report();
    }
    setTimeout(run,8);
  }
}

async function startExperiment() {
  if(typeof FlyData==='undefined')throw new Error('The network file is missing. Extract the complete project first.');
  if(typeof DecompressionStream==='undefined')throw new Error('This browser needs DecompressionStream support. Open this file in an up-to-date Chrome, Safari or Firefox.');
  $('loading').textContent='Unpacking 127,400 neurons…';
  await new Promise(r=>setTimeout(r,0));
  const meta=FlyData.meta;
  // Decode in chunks to avoid another full-length intermediate byte string.
  const encoded=FlyData.base64;
  const chunks=[];
  for(let p=0;p<encoded.length;p+=1048576){
    const text=atob(encoded.slice(p,p+1048576));
    const bytes=new Uint8Array(text.length);for(let i=0;i<text.length;i++)bytes[i]=text.charCodeAt(i);chunks.push(bytes);
  }
  FlyData.base64='';
  const buffer=await new Response(new Blob(chunks).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  if(buffer.byteLength!==meta.uncompressedBytes)throw new Error('The network is incomplete. Download the ZIP again.');
  if(crypto.subtle){
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer)),x=>x.toString(16).padStart(2,'0')).join('');
    if(hash!==meta.sha256)throw new Error('Network integrity check failed. Download the ZIP again.');
  }
  const source=`(${experimentWorker.toString()})(${FlyBrain.toString()},${FlyBody.toString()});`;
  const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
  worker=new Worker(url);URL.revokeObjectURL(url);
  worker.onerror=e=>showFailure(new Error(e.message));
  worker.onmessage=receive;
  trialSeed=crypto.getRandomValues(new Uint32Array(1))[0];
  worker.postMessage({type:'init',buffer,meta,seed:trialSeed},[buffer]);
  const ids=meta.groups.mn9.map(i=>meta.neurons[i].id);
  $('cells').replaceChildren(...ids.map((id,i)=>{
    const span=document.createElement('span');span.textContent=`MN9 ${i+1} · ${id}`;return span;
  }));
}
function receive(e) {
  const m=e.data;
  if(m.type==='ready'){
    ready=true;$('loading').hidden=true;for(const el of document.querySelectorAll('button,input'))el.disabled=false;
    document.body.dataset.ready='true';return;
  }
  if(m.type!=='state')return;
  if(m.brain.timeMs<current.brain.timeMs){
    rasterEvents=[];displayedCounts=[0,0,0];rateDuration=0;
    $('motor-rate').textContent='0 · 0 Hz';$('network-rate').textContent='0 / s';
  }
  current=m;contactOn=m.body.contact;
  rasterEvents.push(...m.events);const cutoff=m.brain.timeMs-2000;
  let first=0;while(first<rasterEvents.length&&rasterEvents[first][0]<cutoff)first++;
  if(first)rasterEvents.splice(0,first);
  workerSamples.push({computeMs:m.computeMs,simMs:m.steps*.1});if(workerSamples.length>600)workerSamples.shift();
  for(const [t,row]of m.events){if(row===42)displayedCounts[0]++;if(row===43)displayedCounts[1]++;}
  displayedCounts[2]+=m.brain.windowSpikes;
  rateDuration+=m.brain.windowMs;
  if(rateDuration>=250){
    const factor=1000/rateDuration;
    $('motor-rate').textContent=`${Math.round(displayedCounts[0]*factor)} · ${Math.round(displayedCounts[1]*factor)} Hz`;
    $('network-rate').textContent=`${Math.round(displayedCounts[2]*factor).toLocaleString()} / s`;
    displayedCounts=[0,0,0];rateDuration=0;
  }
  $('input-rate').textContent=m.body.rates[1]?`${m.body.rates[0]} + ${m.body.rates[1]} Hz`:`${m.body.rates[0]} Hz`;
  $('angle').textContent=`${Math.round(m.body.joints.angle)}°`;
  $('instruction').textContent=m.body.contact?'Move the drop away to break contact.':'Drag the drop to the mouth.';
  document.body.dataset.contact=String(m.body.contact);
  document.body.dataset.extension=String(m.body.extension);
  document.body.dataset.timeMs=String(m.brain.timeMs);
  document.body.dataset.totalSpikes=String(m.brain.totalSpikes);
  document.body.dataset.mn9=m.mn9.map(x=>x.spikes).join(',');
  document.body.dataset.seed=String(m.seed);
}
function showFailure(error) {
  $('loading').hidden=false;$('loading').textContent=error.message;$('loading').classList.add('error');
  for(const el of document.querySelectorAll('button,input'))el.disabled=true;
  console.error(error);
}
function sendDrop(x,y) {
  previewBody.drop={...previewBody.drop,x,y};current.body.drop={...previewBody.drop};
  worker?.postMessage({type:'drop',x,y});
}
function controls() {worker?.postMessage({type:'controls',bitter:$('bitter').checked,taste:$('taste').checked,motor:$('motor').checked});}
for(const id of ['bitter','taste','motor'])$(id).onchange=controls;
$('touch').onclick=()=>sendDrop(105,23);
$('pause').onclick=()=>{paused=!paused;$('pause').textContent=paused?'Resume':'Pause';worker?.postMessage({type:'pause',value:paused});};
$('reset').onclick=()=>{
  for(const id of ['bitter','taste','motor'])$(id).checked=false;
  trialSeed=crypto.getRandomValues(new Uint32Array(1))[0];
  worker.postMessage({type:'reset',seed:trialSeed});
  rasterEvents=[];previewBody=new FlyBody();
};
document.addEventListener('visibilitychange',()=>worker?.postMessage({type:'pause',value:document.hidden||paused}));
let drag=false;
$('fly').addEventListener('pointerdown',e=>{
  if(!ready)return;const r=$('fly').getBoundingClientRect();const p=drawing.point(e.clientX-r.left,e.clientY-r.top);
  if(Math.hypot(p.x-current.body.drop.x,p.y-current.body.drop.y)<current.body.drop.radius+18){drag=true;$('fly').setPointerCapture(e.pointerId);}
});
$('fly').addEventListener('pointermove',e=>{if(!drag)return;const r=$('fly').getBoundingClientRect();const p=drawing.point(e.clientX-r.left,e.clientY-r.top);sendDrop(Math.max(-160,Math.min(205,p.x)),Math.max(-90,Math.min(125,p.y)));});
for(const name of ['pointerup','pointercancel'])$('fly').addEventListener(name,()=>drag=false);
$('fly').addEventListener('keydown',e=>{
  if(!ready)return;if(e.key==='Enter'){e.preventDefault();sendDrop(105,23);return;}
  const d={ArrowLeft:[-4,0],ArrowRight:[4,0],ArrowUp:[0,-4],ArrowDown:[0,4]}[e.key];
  if(d){e.preventDefault();sendDrop(current.body.drop.x+d[0],current.body.drop.y+d[1]);}
});
function drawRaster() {
  const canvas=$('raster'),r=canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);
  if(canvas.width!==Math.round(r.width*dpr)){canvas.width=Math.round(r.width*dpr);canvas.height=150*dpr;}
  const c=canvas.getContext('2d');c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,r.width,150);
  const left=104,span=r.width-left-8,now=current.brain.timeMs;
  c.font='11px -apple-system,sans-serif';c.fillStyle='#676459';
  const rows=[['Sugar · 21 cells',25],['Bitter · 21 cells',62],['MN9 1',98],['MN9 2',120]];
  for(const [label,y]of rows){c.fillText(label,0,y);c.strokeStyle='#e2dfd5';c.beginPath();c.moveTo(left,y);c.lineTo(r.width,y);c.stroke();}
  c.fillStyle='#6f765a';
  for(const [t,row]of rasterEvents){const x=left+(t-now+2000)/2000*span;let y;
    if(row<21)y=12+row*1.25;else if(row<42)y=49+(row-21)*1.25;else y=row===42?92:114;
    c.fillStyle=row<21?'#6f765a':row<42?'#8e7964':'#914535';c.fillRect(x,y,.9,row<42?1.3:9);
  }
  c.fillStyle='#817c70';c.fillText('−2 s',left,146);c.textAlign='right';c.fillText('now',r.width,146);c.textAlign='left';
  const quant=(arr,q)=>{const a=[...arr].sort((a,b)=>a-b);return a[Math.floor((a.length-1)*q)]||0;};
  const work=workerSamples.filter(x=>x.simMs>0);
  const ratio=work.reduce((a,x)=>a+x.computeMs,0)/Math.max(1,work.reduce((a,x)=>a+x.simMs,0));
  const memory=current.memoryBytes?`${(current.memoryBytes/1048576).toFixed(1)} MiB network + state (estimate)`:'loading';
  $('performance').textContent=`${(current.brain.timeMs/1000).toFixed(1)} s simulated · seed ${trialSeed} · frame p95 ${quant(frames,.95).toFixed(1)} ms · drawing p95 ${quant(renderTimes,.95).toFixed(2)} ms · neural + body compute ${(ratio*100).toFixed(1)}% of simulated time · ${memory}`;
}
function frame(t) {
  if(lastFrame&&t-lastFrame<250){frames.push(t-lastFrame);if(frames.length>600)frames.shift();}lastFrame=t;
  const start=performance.now();drawing.draw(current.body,contactOn);
  renderTimes.push(performance.now()-start);if(renderTimes.length>600)renderTimes.shift();
  if($('inspect').open&&++framesSinceRaster%3===0)drawRaster();
  requestAnimationFrame(frame);
}
new ResizeObserver(()=>drawing.resize()).observe($('stage'));
requestAnimationFrame(frame);
