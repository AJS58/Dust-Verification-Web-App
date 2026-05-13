const $ = id => document.getElementById(id);
const canvas = $('mainCanvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const loupe = $('loupe');
const loupeCanvas = $('loupeCanvas');
const loupeCtx = loupeCanvas ? loupeCanvas.getContext('2d') : null;
let img = new Image();
let originalData = null;
let cleanData = null;
let spots = [];
let manualSpots = [];
let overlay = true;
let cleanMode = false;
let scale = 1;
let currentFileName = '';
let paid = false;
let activeTool = 'pan';
let enlargeMode = false;

const els = ['detectBtn','cleanupBtn','saveBtn','toggleOverlay','toggleClean'];
function setEnabled(enabled){ els.forEach(id => $(id).disabled = !enabled); $('reportBtn').disabled = !(enabled && paid); }
function setPaid(v){ paid = v; $('reportBtn').disabled = !(v && originalData); }
$('paidToggle').addEventListener('change', e => setPaid(e.target.checked));
$('unlockBtn').addEventListener('click', () => { $('paidToggle').checked = true; setPaid(true); alert('Demo unlock enabled. In the live version this button would connect to Stripe/PayPal payment for the £6.99 report.'); });
$('sensitivity').addEventListener('input', e => $('sensValue').textContent=e.target.value);
$('minSize').addEventListener('input', e => $('sizeValue').textContent=e.target.value);

$('fileInput').addEventListener('change', e => {
  const file = e.target.files[0]; if(!file) return;
  const name = file.name || '';
  const isJpeg = file.type === 'image/jpeg' || /\.(jpe?g)$/i.test(name);
  if(!isJpeg){
    alert('This version accepts JPEG files only. Please export a JPEG dust-test image and upload that file.');
    e.target.value = '';
    return;
  }
  currentFileName = file.name;
  const url = URL.createObjectURL(file);
  img.onload = () => { URL.revokeObjectURL(url); loadImageToCanvas(); };
  img.src = url;
});

function loadImageToCanvas(){
  const maxSide = 1800;
  let w = img.naturalWidth, h = img.naturalHeight;
  const r = Math.min(1, maxSide / Math.max(w,h));
  canvas.width = Math.round(w*r); canvas.height = Math.round(h*r);
  ctx.drawImage(img,0,0,canvas.width,canvas.height);
  originalData = ctx.getImageData(0,0,canvas.width,canvas.height);
  cleanData = null; spots=[]; manualSpots=[]; scale=1; cleanMode=false; overlay=true;
  $('emptyState').style.display='none'; $('fileSummary').innerHTML = `<strong>${currentFileName}</strong><span>JPEG loaded — ${canvas.width} × ${canvas.height}px analysis preview</span>`; setEnabled(true); fitCanvas(); runDetection();
}

$('detectBtn').addEventListener('click', runDetection);
$('cleanupBtn').addEventListener('click', createCleanPreview);
$('saveBtn').addEventListener('click', saveAnnotated);
$('toggleOverlay').addEventListener('click', ()=>{overlay=!overlay; cleanMode=false; render();});
$('viewOriginal').addEventListener('click', ()=>{overlay=false; cleanMode=false; render();});
$('toggleClean').addEventListener('click', ()=>{ if(cleanData){ cleanMode=!cleanMode; render(); }});
$('reportBtn').addEventListener('click', generateReportWindow);
$('zoomIn').addEventListener('click', ()=>{scale=Math.min(4,scale*1.2); applyScale();});
$('zoomOut').addEventListener('click', ()=>{scale=Math.max(.15,scale/1.2); applyScale();});
$('fitBtn').addEventListener('click', fitCanvas);
$('enlargeBtn').addEventListener('click', ()=>{ enlargeMode=!enlargeMode; $('canvasWrap').classList.toggle('enlargeMode', enlargeMode); $('enlargeBtn').classList.toggle('active', enlargeMode); if(!enlargeMode && loupe) loupe.hidden=true; });
$('resetBtn').addEventListener('click', ()=>{ if(originalData){spots=[];manualSpots=[];cleanData=null;cleanMode=false;overlay=true;ctx.putImageData(originalData,0,0);updateResults(null);} });
$('clearManual').addEventListener('click', ()=>{manualSpots=[]; render(); updateResults(summary());});
document.querySelectorAll('.tool').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.tool').forEach(x=>x.classList.remove('active'));b.classList.add('active');activeTool=b.dataset.tool; const wrap=$('canvasWrap'); wrap.classList.toggle('markMode',activeTool==='mark'); wrap.classList.toggle('eraseMode',activeTool==='erase');}));
document.querySelectorAll('.mode').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.mode').forEach(x=>x.classList.remove('active'));b.classList.add('active'); if(originalData) runDetection();}));

canvas.addEventListener('click', e=>{
  if(!originalData || activeTool==='pan') return;
  const rect=canvas.getBoundingClientRect();
  const x=(e.clientX-rect.left)*(canvas.width/rect.width), y=(e.clientY-rect.top)*(canvas.height/rect.height);
  if(activeTool==='mark') manualSpots.push({x,y,r:16,area:800,manual:true});
  if(activeTool==='erase'){
    eraseAt(x,y);
  }
  render(); updateResults(summary());
});

canvas.addEventListener('mousemove', e=>{
  if(!originalData) return;
  const rect=canvas.getBoundingClientRect();
  const x=(e.clientX-rect.left)*(canvas.width/rect.width), y=(e.clientY-rect.top)*(canvas.height/rect.height);
  if(enlargeMode) updateLoupe(x,y,e);
});
canvas.addEventListener('mouseleave', ()=>{ if(loupe) loupe.hidden=true; });

function eraseAt(x,y){
  const eraseRadius = Math.max(34, canvas.width/42); // wider hit area so the tool feels reliable
  let removed = 0;
  const keep = s => {
    const d = Math.hypot(s.x-x,s.y-y);
    const threshold = Math.max(eraseRadius, (s.r||0)+22);
    const shouldRemove = d > threshold;
    if(!shouldRemove) removed++;
    return shouldRemove;
  };
  spots = spots.filter(keep);
  manualSpots = manualSpots.filter(keep);
  // Fallback: if the click was close but missed the wider threshold, remove the nearest spot.
  if(!removed){
    const all = [...spots.map((s,i)=>({s,i,list:'spots',d:Math.hypot(s.x-x,s.y-y)})), ...manualSpots.map((s,i)=>({s,i,list:'manual',d:Math.hypot(s.x-x,s.y-y)}))].sort((a,b)=>a.d-b.d);
    if(all[0] && all[0].d < eraseRadius*1.8){
      if(all[0].list==='spots') spots.splice(all[0].i,1); else manualSpots.splice(all[0].i,1);
    }
  }
}

function updateLoupe(x,y,e){
  if(!loupe || !loupeCtx || !originalData) return;
  const sourceSize = 150;
  const sx = Math.max(0, Math.min(canvas.width-sourceSize, x-sourceSize/2));
  const sy = Math.max(0, Math.min(canvas.height-sourceSize, y-sourceSize/2));
  loupeCtx.clearRect(0,0,loupeCanvas.width,loupeCanvas.height);
  loupeCtx.drawImage(canvas, sx, sy, sourceSize, sourceSize*(loupeCanvas.height/loupeCanvas.width), 0, 0, loupeCanvas.width, loupeCanvas.height);
  loupe.hidden=false;
  // Keep the loupe inside the preview area but away from the pointer where possible.
  const wrap = $('canvasWrap').getBoundingClientRect();
  const lx = Math.min(Math.max(20, e.clientX-wrap.left+24), wrap.width-210);
  const ly = Math.min(Math.max(20, e.clientY-wrap.top+24), wrap.height-165);
  loupe.style.left = lx + 'px';
  loupe.style.top = ly + 'px';
  loupe.style.bottom = 'auto';
}


function runDetection(){
  if(!originalData) return;
  // Sensitivity is user-facing detection strength: higher value = lower threshold / more detection.
  const strength = Number($('sensitivity').value);
  const minArea = Number($('minSize').value);
  const modeBtn = document.querySelector('.mode.active');
  const mode = modeBtn ? modeBtn.textContent.trim().toLowerCase() : 'standard';
  const w=canvas.width,h=canvas.height,data=originalData.data;
  const gray = new Uint8ClampedArray(w*h);
  let mean=0;
  for(let i=0,p=0;i<data.length;i+=4,p++){
    const g=Math.round((data[i]*.299+data[i+1]*.587+data[i+2]*.114));
    gray[p]=g; mean+=g;
  }
  mean/=gray.length;

  // Multi-scale local-background comparison. This handles normal small sensor dust AND extreme bonded debris.
  const r1 = mode.includes('aggressive') ? 11 : (mode.includes('high') ? 15 : 19);
  const r2 = mode.includes('aggressive') ? 35 : (mode.includes('high') ? 45 : 55);
  const blurSmall = boxBlur(gray,w,h,r1);
  const blurLarge = boxBlur(gray,w,h,r2);
  const threshold = Math.max(8, 62 - strength * 0.55); // 90 strength ≈ 12.5 threshold
  const absoluteDark = Math.max(18, mean - (mode.includes('aggressive') ? 42 : 55));
  const mask = new Uint8Array(w*h);
  for(let i=0;i<gray.length;i++){
    const localDiff = Math.max(blurSmall[i]-gray[i], blurLarge[i]-gray[i]);
    const veryDark = gray[i] < absoluteDark;
    const obviousEdge = localDiff > threshold;
    // Combine local contrast and absolute darkness to avoid splitting large dark contamination into small pieces.
    if(obviousEdge || (veryDark && localDiff > threshold*.45)) mask[i]=1;
  }

  // Closing joins cracked/fragmented deposits into coherent contamination regions.
  const closed = closeMask(mask,w,h, mode.includes('aggressive') ? 2 : 1);
  spots = connectedComponents(closed,w,h,minArea, w*h).map(c=>({
    x:c.cx,
    y:c.cy,
    r:Math.max(5,Math.sqrt(c.area/Math.PI)*1.45),
    area:c.area,
    bw:c.bw,
    bh:c.bh,
    elong:c.elong
  }));
  render(); updateResults(summary());
}

function dilateMask(src,w,h,r){
  const out=new Uint8Array(w*h);
  for(let y=0;y<h;y++) for(let x=0;x<w;x++){
    let found=0;
    for(let yy=Math.max(0,y-r);yy<=Math.min(h-1,y+r)&&!found;yy++){
      for(let xx=Math.max(0,x-r);xx<=Math.min(w-1,x+r);xx++){
        if(src[yy*w+xx]){found=1;break;}
      }
    }
    out[y*w+x]=found;
  }
  return out;
}
function erodeMask(src,w,h,r){
  const out=new Uint8Array(w*h);
  for(let y=0;y<h;y++) for(let x=0;x<w;x++){
    let keep=1;
    for(let yy=Math.max(0,y-r);yy<=Math.min(h-1,y+r)&&keep;yy++){
      for(let xx=Math.max(0,x-r);xx<=Math.min(w-1,x+r);xx++){
        if(!src[yy*w+xx]){keep=0;break;}
      }
    }
    out[y*w+x]=keep;
  }
  return out;
}
function closeMask(src,w,h,r){ return erodeMask(dilateMask(src,w,h,r),w,h,r); }

function boxBlur(src,w,h,r){
  const out=new Uint8ClampedArray(w*h), tmp=new Uint32Array(w*h);
  for(let y=0;y<h;y++){
    let sum=0; for(let x=-r;x<=r;x++) sum+=src[y*w+Math.min(w-1,Math.max(0,x))];
    for(let x=0;x<w;x++){ tmp[y*w+x]=sum/(2*r+1); sum-=src[y*w+Math.max(0,x-r)]; sum+=src[y*w+Math.min(w-1,x+r+1)]; }
  }
  for(let x=0;x<w;x++){
    let sum=0; for(let y=-r;y<=r;y++) sum+=tmp[Math.min(h-1,Math.max(0,y))*w+x];
    for(let y=0;y<h;y++){ out[y*w+x]=sum/(2*r+1); sum-=tmp[Math.max(0,y-r)*w+x]; sum+=tmp[Math.min(h-1,y+r+1)*w+x]; }
  }
  return out;
}

function connectedComponents(mask,w,h,minArea,maxArea){
  const seen=new Uint8Array(w*h), comps=[];
  const qx=new Int32Array(w*h), qy=new Int32Array(w*h);
  const dirs=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
  for(let y=0;y<h;y++) for(let x=0;x<w;x++){
    const start=y*w+x; if(!mask[start]||seen[start]) continue;
    let head=0,tail=0,area=0,sx=0,sy=0,minx=x,maxx=x,miny=y,maxy=y;
    qx[tail]=x;qy[tail++]=y;seen[start]=1;
    while(head<tail){
      const cx=qx[head],cy=qy[head++]; area++; sx+=cx; sy+=cy;
      if(cx<minx)minx=cx;if(cx>maxx)maxx=cx;if(cy<miny)miny=cy;if(cy>maxy)maxy=cy;
      for(const [dx,dy] of dirs){
        const nx=cx+dx, ny=cy+dy;
        if(nx<0||ny<0||nx>=w||ny>=h) continue;
        const ni=ny*w+nx;
        if(mask[ni]&&!seen[ni]){seen[ni]=1;qx[tail]=nx;qy[tail++]=ny;}
      }
    }
    const bw=maxx-minx+1,bh=maxy-miny+1,elong=Math.max(bw,bh)/Math.max(1,Math.min(bw,bh));
    if(area>=minArea && area<=maxArea) comps.push({area,cx:sx/area,cy:sy/area,bw,bh,elong});
  }
  return comps.sort((a,b)=>b.area-a.area).slice(0,900);
}

function createCleanPreview(){
  if(!originalData) return;
  const w=canvas.width,h=canvas.height;
  const out = new ImageData(new Uint8ClampedArray(originalData.data), w,h);
  const all=[...spots,...manualSpots];
  all.forEach(s=>{
    const rad=Math.ceil(Math.max(8,s.r*1.4));
    for(let yy=Math.max(0,Math.floor(s.y-rad)); yy<Math.min(h,Math.ceil(s.y+rad)); yy++){
      for(let xx=Math.max(0,Math.floor(s.x-rad)); xx<Math.min(w,Math.ceil(s.x+rad)); xx++){
        if(Math.hypot(xx-s.x,yy-s.y)>rad) continue;
        let rs=0,gs=0,bs=0,n=0;
        for(let a=0;a<16;a++){
          const ang=(Math.PI*2*a)/16, sx=Math.round(s.x+Math.cos(ang)*(rad+7)), sy=Math.round(s.y+Math.sin(ang)*(rad+7));
          if(sx>=0&&sy>=0&&sx<w&&sy<h){const p=(sy*w+sx)*4; rs+=originalData.data[p];gs+=originalData.data[p+1];bs+=originalData.data[p+2];n++;}
        }
        if(n){const p=(yy*w+xx)*4, blend=.86; out.data[p]=out.data[p]*(1-blend)+(rs/n)*blend; out.data[p+1]=out.data[p+1]*(1-blend)+(gs/n)*blend; out.data[p+2]=out.data[p+2]*(1-blend)+(bs/n)*blend;}
      }
    }
  });
  cleanData=out; cleanMode=true; render();
}

function summary(){
  const all=[...spots,...manualSpots], count=all.length;
  const heavy=all.filter(s=>s.area>900 || Math.max(s.bw||0,s.bh||0)>32).length;
  const medium=all.filter(s=>!(s.area>900 || Math.max(s.bw||0,s.bh||0)>32) && (s.area>140 || Math.max(s.bw||0,s.bh||0)>12)).length;
  const small=Math.max(0,count-heavy-medium);
  let sev='Low', rec='No immediate action required';
  if(count>65||heavy>8){sev='Extreme';rec='Professional wet clean / inspection strongly recommended';}
  else if(count>40||heavy>3){sev='High';rec='Professional wet clean recommended';}
  else if(count>15||heavy>0){sev='Medium';rec='Dry/wet clean recommended';}
  else if(count>0){sev='Low';rec='Blower check or monitor';}
  const avg=count? all.reduce((a,s)=>a+s.area,0)/count:0;
  const largest=count? Math.max(...all.map(s=>s.area)):0;
  let pattern='No clear contamination';
  if(count>0){
    if(sev==='Extreme' || heavy>=5 || largest>3000) pattern='Possible organic residue / bonded debris';
    else if(heavy>=2 || avg>700) pattern='Possible oil / moisture pattern';
    else pattern='Likely dry dust';
  }
  return {count,small,medium,large:heavy,sev,rec,pattern};
}

function apertureVisibility(s){
  // This is a single-image estimate for the paid report, based on count + heavy particle level.
  // A true aperture comparison mode can be added later by asking the user to upload f/8, f/11, f/16 and f/22 test frames.
  const heavyFactor = s.large * 4;
  const score = s.count + heavyFactor;
  const rows = [
    {ap:'f/8', risk: score>80?'High':score>45?'Moderate':score>18?'Low':'Minimal', note: score>80?'Large/heavy contamination may remain visible on plain areas.':'Only larger contamination is likely to show clearly.'},
    {ap:'f/11', risk: score>60?'High':score>30?'Moderate':score>10?'Low':'Minimal', note:'Dust visibility increases on skies, white backgrounds and studio backdrops.'},
    {ap:'f/16', risk: score>35?'Extreme':score>18?'High':score>6?'Moderate':'Low', note:'This is the recommended dust-test aperture range.'},
    {ap:'f/22', risk: score>20?'Extreme':score>10?'High':score>3?'Moderate':'Low', note:'Small particles and faint marks become much more visible.'}
  ];
  const overall = rows.some(r=>r.risk==='Extreme')?'Extreme':rows.some(r=>r.risk==='High')?'High':rows.some(r=>r.risk==='Moderate')?'Moderate':'Low';
  return {overall, rows};
}

function updateResults(s){
  if(!s){$('spotCount').textContent='–';$('severity').textContent='–';$('pattern').textContent='–'; if($('recommendation')) $('recommendation').textContent='–'; if($('smallCount'))$('smallCount').textContent='–'; if($('mediumCount'))$('mediumCount').textContent='–'; if($('largeCount'))$('largeCount').textContent='–'; if($('apertureRisk'))$('apertureRisk').textContent='–';return;}
  $('spotCount').textContent=s.count; $('severity').textContent=s.sev; $('pattern').textContent=s.pattern; if($('recommendation')) $('recommendation').textContent=s.rec; if($('smallCount'))$('smallCount').textContent=s.small; if($('mediumCount'))$('mediumCount').textContent=s.medium; if($('largeCount'))$('largeCount').textContent=s.large; if($('apertureRisk'))$('apertureRisk').textContent=apertureVisibility(s).overall;
}
function render(){
  if(!originalData) return;
  ctx.putImageData(cleanMode&&cleanData?cleanData:originalData,0,0);
  if(overlay){
    ctx.save(); ctx.lineWidth=Math.max(2,canvas.width/900); ctx.strokeStyle='#ff3030'; ctx.fillStyle='rgba(255,48,48,.08)';
    [...spots,...manualSpots].forEach((s,i)=>{ctx.beginPath();ctx.arc(s.x,s.y,s.r,0,Math.PI*2);ctx.fill();ctx.stroke(); if(i<80){ctx.fillStyle='#ff3030';ctx.font=`${Math.max(12,canvas.width/120)}px Arial`;ctx.fillText(String(i+1),s.x+s.r+3,s.y);ctx.fillStyle='rgba(255,48,48,.08)';}});
    ctx.restore();
  }
}
function fitCanvas(){
  if(!canvas.width || !canvas.height){ scale=1; applyScale(); return; }
  const wrap = $('canvasWrap');
  const availW = Math.max(320, wrap.clientWidth - 24);
  const availH = Math.max(260, wrap.clientHeight - 24);
  scale = Math.min(availW / canvas.width, availH / canvas.height, 1.15);
  if(scale <= 0 || !isFinite(scale)) scale = 1;
  applyScale();
}
function applyScale(){
  canvas.style.width=(canvas.width*scale)+'px';
  canvas.style.height=(canvas.height*scale)+'px';
  $('zoomLabel').textContent=Math.round(scale*100)+'%';
}

function saveAnnotated(){ render(); const a=document.createElement('a'); a.download='cameracal-annotated-dust-map.png'; a.href=canvas.toDataURL('image/png'); a.click(); }

function generateReportWindow(){
  if(!paid) return alert('Payment required before report generation.');
  const s=summary(); const av=apertureVisibility(s); render(); const imgUrl=canvas.toDataURL('image/png'); const logoUrl=document.querySelector('.brandLogo').src;
  const html=`<!doctype html><html><head><title>Cameracal Sensor Health Report</title><style>body{font-family:Arial,sans-serif;margin:0;color:#10223d}.page{padding:34px;page-break-after:always}.head{display:flex;justify-content:space-between;align-items:center;border-bottom:4px solid #0057d8;padding-bottom:16px}.head img{width:360px;max-height:110px;object-fit:contain}.blue{color:#0057d8}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:20px 0}.card{border:1px solid #c9d9ef;border-radius:8px;padding:14px;background:#f8fbff}.card strong{display:block;font-size:24px;color:#0057d8}.map{max-width:100%;border:1px solid #c9d9ef;border-radius:10px}.cta{border:2px solid #0057d8;padding:18px;border-radius:12px;background:#f1f7ff}.small{color:#56667d;font-size:12px} table{width:100%;border-collapse:collapse;margin-top:14px}th,td{border:1px solid #c9d9ef;padding:10px;text-align:left}th{background:#f1f7ff;color:#0057d8}.contact{border-top:1px solid #c9d9ef;margin-top:18px;padding-top:12px}@media print{button{display:none}}</style></head><body>
  <div class="page"><div class="head"><div><h1>Sensor Health Check Report</h1><p>Cameracal Services – The Camera Specialist</p></div><img src="${logoUrl}" alt="Cameracal Services"></div><p><b>Report date:</b> ${new Date().toLocaleString()}<br><b>Image:</b> ${currentFileName||'Uploaded image'}<br><b>Report ID:</b> CS-${Date.now()}</p><div class="grid"><div class="card">Total spots<strong>${s.count}</strong></div><div class="card">Severity<strong>${s.sev}</strong></div><div class="card">Pattern<strong style="font-size:16px">${s.pattern}</strong></div><div class="card">Recommendation<strong style="font-size:16px">${s.rec}</strong></div></div><p>This report analyses sensor contamination visible under dust-revealing conditions. Results depend on the supplied image and shooting conditions.</p></div>
  <div class="page"><h2>Dust Map & Distribution</h2><img class="map" src="${imgUrl}"><div class="grid"><div class="card">Small<strong>${s.small}</strong></div><div class="card">Medium<strong>${s.medium}</strong></div><div class="card">Heavy<strong>${s.large}</strong></div><div class="card">Auto-clean preview<strong style="font-size:16px">${cleanData?'Created':'Not created'}</strong></div></div></div>
  <div class="page"><h2>Interpretation</h2><p><b>Observed pattern:</b> ${s.pattern}.</p><p>If the pattern is reported as organic residue / bonded debris, this indicates an extreme contamination pattern that may be consistent with solid particles or sticky residue bonded to the sensor filter glass. Physical inspection is required for confirmation.</p><p>Contamination generally becomes more visible at smaller apertures such as f/11 to f/22, especially in skies, plain backgrounds and evenly lit surfaces.</p><p class="small">Where contamination type is suggested, this is an informed indication only and not a guaranteed diagnosis. Physical inspection may be required.</p></div>
  <div class="page"><h2>Aperture Visibility Estimate</h2><p>This paid report includes an estimated guide to how likely the detected contamination is to be visible at wider and smaller apertures. This is calculated from the supplied dust-test image, total spot count and heavy contamination level.</p><table><thead><tr><th>Aperture</th><th>Estimated Visibility Risk</th><th>Comment</th></tr></thead><tbody>${av.rows.map(r=>`<tr><td><b>${r.ap}</b></td><td><b>${r.risk}</b></td><td>${r.note}</td></tr>`).join('')}</tbody></table><p class="small">For a true measured aperture comparison, upload a controlled set of images taken at f/8, f/11, f/16 and f/22. This can be added as a future Pro report mode.</p></div>
  <div class="page"><h2>Recommended Action</h2><p><b>${s.rec}</b></p>

<div class="cta">
<h3>Preventative Maintenance Recommendation</h3>

<p>To help minimise future sensor contamination, Cameracal Services recommends the periodic use of a filtered air blower system such as the:</p>

<h3 style="color:#0057d8">VSGO Air-Move Filter Blower</h3>

<p>Filtered blower systems help reduce the risk of introducing:</p>

<ul>
<li>airborne dust</li>
<li>fibres</li>
<li>moisture particles</li>
<li>debris contamination</li>
</ul>

<p>Unlike standard non-filtered blowers, filtered systems help provide cleaner airflow during routine maintenance and lens changes.</p>

<p><b>Recommended especially for:</b></p>

<ul>
<li>mirrorless cameras</li>
<li>outdoor lens changes</li>
<li>wildlife photography</li>
<li>motorsport photography</li>
<li>coastal or dusty environments</li>
<li>landscape photography at smaller apertures</li>
</ul>
</div>

<div class="cta" style="margin-top:20px">
<h3>Professional Sensor Cleaning</h3>

<p>Where contamination becomes:</p>

<ul>
<li>bonded</li>
<li>oily</li>
<li>moisture related</li>
<li>organic</li>
<li>or resistant to filtered air cleaning</li>
</ul>

<p>professional sensor cleaning may be required.</p>

<div class="contact">
<b>CAMERACAL SERVICES</b><br><br>
Professional sensor cleaning, contamination diagnostics, autofocus calibration and camera health checks.<br><br>

<b>Contact:</b><br>
07540 877068<br>
info@cameracalservices.co.uk<br>
www.cameracalservices.co.uk
</div>
</div>

<p class="small">Auto Clean Preview, if used, is a visual aid only and is not a substitute for professional retouching or physical sensor cleaning.</p></div>
  <button onclick="window.print()" style="position:fixed;right:20px;top:20px;padding:12px 18px">Print / Save as PDF</button></body></html>`;
  const w=window.open('','_blank'); w.document.write(html); w.document.close();
}


// Information modals for top navigation
(function(){
  const modal = document.getElementById('infoModal');
  const title = document.getElementById('modalTitle');
  const content = document.getElementById('modalContent');
  const close = document.getElementById('modalClose');
  const how = document.getElementById('howBtn');
  const help = document.getElementById('helpBtn');
  const show = (heading, html) => { title.textContent = heading; content.innerHTML = html; modal.hidden = false; };
  if (how) how.addEventListener('click', () => show('How it works', `
    <ol class="modalList">
      <li><b>Choose JPEG as the recommended version</b> for this app.</li>
      <li><b>Take a dust-test image</b> at F16 / F22, ideally of a plain white background or blue sky.</li>
      <li><b>Upload the JPEG</b> into the app and run Auto Detect to highlight visible dust, debris, smears or bonded contamination.</li>
      <li><b>Review the result</b> using the manual Add Mark and improved Erase tools if required.</li>
      <li><b>Generate the paid report</b> to unlock the PDF, aperture visibility estimate and cleaning recommendation.</li>
    </ol>
    <p>The report is designed to help decide whether a blower clean, wet clean, or professional Cameracal Services sensor clean is recommended.</p>`));
  if (help) help.addEventListener('click', () => show('Help', `
    <h3>Recommended image</h3>
    <p>Use a JPEG image taken at F16 / F22 of a plain bright subject. Defocus the lens slightly and avoid patterned backgrounds.</p>
    <h3>Manual tools</h3>
    <p><b>Add Mark</b> allows you to click missed contamination. <b>Erase</b> now uses a wider removal area and removes the nearest detected or manually added mark near the cursor. <b>Clear All</b> removes manual adjustments.</p>
    <h3>Report access</h3>
    <p>The free preview shows the detection result. The full PDF report, downloadable overlay and aperture visibility guidance are unlocked after payment.</p>
    <h3>Need a clean?</h3>
    <p>Use the Book a Sensor Clean button or contact Cameracal Services on 07540 877068.</p>`));
  if (close) close.addEventListener('click', () => modal.hidden = true);
  if (modal) modal.addEventListener('click', (e) => { if(e.target === modal) modal.hidden = true; });
  window.addEventListener('keydown', e => { if(e.key === 'Escape' && modal && !modal.hidden) modal.hidden = true; });
})();
