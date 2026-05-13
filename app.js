const $ = id => document.getElementById(id);
const canvas = $('mainCanvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
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

const els = ['detectBtn','cleanupBtn','saveBtn','toggleOverlay','toggleClean'];
function setEnabled(enabled){ els.forEach(id => $(id).disabled = !enabled); $('reportBtn').disabled = !(enabled && paid); }
function setPaid(v){ paid = v; $('reportBtn').disabled = !(v && originalData); }
$('paidToggle').addEventListener('change', e => setPaid(e.target.checked));
$('sensitivity').addEventListener('input', e => $('sensValue').textContent=e.target.value);
$('minSize').addEventListener('input', e => $('sizeValue').textContent=e.target.value);

$('fileInput').addEventListener('change', e => {
  const file = e.target.files[0]; if(!file) return;
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
  $('emptyState').style.display='none'; $('fileSummary').innerHTML = `<strong>${currentFileName}</strong><span>${canvas.width} × ${canvas.height}px analysis preview</span>`; setEnabled(true); fitCanvas(); runDetection();
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
$('resetBtn').addEventListener('click', ()=>{ if(originalData){spots=[];manualSpots=[];cleanData=null;cleanMode=false;overlay=true;ctx.putImageData(originalData,0,0);updateResults(null);} });
$('clearManual').addEventListener('click', ()=>{manualSpots=[]; render(); updateResults(summary());});
document.querySelectorAll('.tool').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.tool').forEach(x=>x.classList.remove('active'));b.classList.add('active');activeTool=b.dataset.tool;}));

canvas.addEventListener('click', e=>{
  if(!originalData || activeTool==='pan') return;
  const rect=canvas.getBoundingClientRect();
  const x=(e.clientX-rect.left)*(canvas.width/rect.width), y=(e.clientY-rect.top)*(canvas.height/rect.height);
  if(activeTool==='mark') manualSpots.push({x,y,r:16,area:800,manual:true});
  if(activeTool==='erase'){
    spots=spots.filter(s=>Math.hypot(s.x-x,s.y-y)>Math.max(20,s.r+8));
    manualSpots=manualSpots.filter(s=>Math.hypot(s.x-x,s.y-y)>Math.max(20,s.r+8));
  }
  render(); updateResults(summary());
});

function runDetection(){
  if(!originalData) return;
  const sens = Number($('sensitivity').value);
  const minArea = Number($('minSize').value);
  const w=canvas.width,h=canvas.height,data=originalData.data;
  const gray = new Uint8ClampedArray(w*h);
  for(let i=0,p=0;i<data.length;i+=4,p++) gray[p]=Math.round((data[i]*.299+data[i+1]*.587+data[i+2]*.114));
  const blur = boxBlur(gray,w,h,15);
  const mask = new Uint8Array(w*h);
  for(let i=0;i<gray.length;i++){
    const diff = blur[i]-gray[i]; // dust is usually darker than local background
    if(diff > sens) mask[i]=1;
  }
  spots = connectedComponents(mask,w,h,minArea,120000).map(c=>({x:c.cx,y:c.cy,r:Math.max(6,Math.sqrt(c.area/Math.PI)*1.8),area:c.area}));
  render(); updateResults(summary());
}

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
  for(let y=0;y<h;y++) for(let x=0;x<w;x++){
    const start=y*w+x; if(!mask[start]||seen[start]) continue;
    let head=0,tail=0,area=0,sx=0,sy=0,minx=x,maxx=x,miny=y,maxy=y;
    qx[tail]=x;qy[tail++]=y;seen[start]=1;
    while(head<tail){
      const cx=qx[head],cy=qy[head++]; area++; sx+=cx; sy+=cy; if(cx<minx)minx=cx;if(cx>maxx)maxx=cx;if(cy<miny)miny=cy;if(cy>maxy)maxy=cy;
      for(const [nx,ny] of [[cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]]){
        if(nx<0||ny<0||nx>=w||ny>=h) continue; const ni=ny*w+nx; if(mask[ni]&&!seen[ni]){seen[ni]=1;qx[tail]=nx;qy[tail++]=ny;}
      }
    }
    const bw=maxx-minx+1,bh=maxy-miny+1,elong=Math.max(bw,bh)/Math.max(1,Math.min(bw,bh));
    if(area>=minArea && area<=maxArea && elong<8) comps.push({area,cx:sx/area,cy:sy/area,bw,bh,elong});
  }
  return comps.sort((a,b)=>b.area-a.area).slice(0,600);
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
  const large=all.filter(s=>s.area>1800).length, medium=all.filter(s=>s.area>350&&s.area<=1800).length, small=count-large-medium;
  let sev='Low', rec='No immediate action required';
  if(count>60||large>5){sev='High';rec='Professional wet clean recommended';}
  else if(count>20||large>1){sev='Medium';rec='Dry/wet clean recommended';}
  else if(count>0){sev='Low';rec='Blower check or monitor';}
  const avg=count? all.reduce((a,s)=>a+s.area,0)/count:0;
  let pattern='No clear contamination';
  if(count>0) pattern = large>=3||avg>900 ? 'Possible oil / moisture pattern' : 'Likely dry dust';
  return {count,small,medium,large,sev,rec,pattern};
}
function updateResults(s){
  if(!s){$('spotCount').textContent='–';$('severity').textContent='–';$('pattern').textContent='–'; if($('recommendation')) $('recommendation').textContent='–'; if($('smallCount'))$('smallCount').textContent='–'; if($('mediumCount'))$('mediumCount').textContent='–'; if($('largeCount'))$('largeCount').textContent='–'; if($('apertureRisk'))$('apertureRisk').textContent='–';return;}
  $('spotCount').textContent=s.count; $('severity').textContent=s.sev; $('pattern').textContent=s.pattern; if($('recommendation')) $('recommendation').textContent=s.rec; if($('smallCount'))$('smallCount').textContent=s.small; if($('mediumCount'))$('mediumCount').textContent=s.medium; if($('largeCount'))$('largeCount').textContent=s.large; if($('apertureRisk'))$('apertureRisk').textContent=s.count>20?'High':(s.count>0?'Moderate':'Low');
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
function fitCanvas(){ scale=1; applyScale(); }
function applyScale(){ canvas.style.width=(canvas.width*scale)+'px'; canvas.style.height=(canvas.height*scale)+'px'; $('zoomLabel').textContent=Math.round(scale*100)+'%'; }
function saveAnnotated(){ render(); const a=document.createElement('a'); a.download='cameracal-annotated-dust-map.png'; a.href=canvas.toDataURL('image/png'); a.click(); }

function generateReportWindow(){
  if(!paid) return alert('Payment required before report generation.');
  const s=summary(); render(); const imgUrl=canvas.toDataURL('image/png'); const logoUrl=document.querySelector('.brandLogo').src;
  const html=`<!doctype html><html><head><title>Cameracal Sensor Health Report</title><style>body{font-family:Arial,sans-serif;margin:0;color:#10223d}.page{padding:34px;page-break-after:always}.head{display:flex;justify-content:space-between;align-items:center;border-bottom:4px solid #0057d8;padding-bottom:16px}.head img{width:260px;max-height:82px;object-fit:contain}.blue{color:#0057d8}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:20px 0}.card{border:1px solid #c9d9ef;border-radius:8px;padding:14px;background:#f8fbff}.card strong{display:block;font-size:24px;color:#0057d8}.map{max-width:100%;border:1px solid #c9d9ef;border-radius:10px}.cta{border:2px solid #0057d8;padding:18px;border-radius:12px;background:#f1f7ff}.small{color:#56667d;font-size:12px}.contact{border-top:1px solid #c9d9ef;margin-top:18px;padding-top:12px}@media print{button{display:none}}</style></head><body>
  <div class="page"><div class="head"><div><h1>Sensor Health Check Report</h1><p>Cameracal Services – The Camera Specialist</p></div><img src="${logoUrl}" alt="Cameracal Services"></div><p><b>Report date:</b> ${new Date().toLocaleString()}<br><b>Image:</b> ${currentFileName||'Uploaded image'}<br><b>Report ID:</b> CS-${Date.now()}</p><div class="grid"><div class="card">Total spots<strong>${s.count}</strong></div><div class="card">Severity<strong>${s.sev}</strong></div><div class="card">Pattern<strong style="font-size:16px">${s.pattern}</strong></div><div class="card">Recommendation<strong style="font-size:16px">${s.rec}</strong></div></div><p>This report analyses sensor contamination visible under dust-revealing conditions. Results depend on the supplied image and shooting conditions.</p></div>
  <div class="page"><h2>Dust Map & Distribution</h2><img class="map" src="${imgUrl}"><div class="grid"><div class="card">Small<strong>${s.small}</strong></div><div class="card">Medium<strong>${s.medium}</strong></div><div class="card">Heavy<strong>${s.large}</strong></div><div class="card">Auto-clean preview<strong style="font-size:16px">${cleanData?'Created':'Not created'}</strong></div></div></div>
  <div class="page"><h2>Interpretation</h2><p><b>Observed pattern:</b> ${s.pattern}.</p><p>Contamination generally becomes more visible at smaller apertures such as f/11 to f/22, especially in skies, plain backgrounds and evenly lit surfaces.</p><p class="small">Where contamination type is suggested, this is an informed indication only and not a guaranteed diagnosis. Physical inspection may be required.</p></div>
  <div class="page"><h2>Recommended Action</h2><p><b>${s.rec}</b></p><div class="cta"><h3>Book Cameracal Services Sensor Cleaning</h3><p><b>Option A: In-person cleaning</b> – professional inspection, clean and verification.</p><p><b>Option B: Secure Peli case collection & return</b> – for customers unable to attend in person. Camera is sent securely for professional cleaning and returned after verification.</p><p>Report fee may be refunded against a booked clean within the stated promotional period.</p><div class="contact"><b>Contact:</b> 07540 877068 &nbsp; | &nbsp; info@cameracal.co.uk &nbsp; | &nbsp; www.cameracal.co.uk</div></div><p class="small">Auto Clean Preview, if used, is a visual aid only and is not a substitute for professional retouching or physical sensor cleaning.</p></div>
  <button onclick="window.print()" style="position:fixed;right:20px;top:20px;padding:12px 18px">Print / Save as PDF</button></body></html>`;
  const w=window.open('','_blank'); w.document.write(html); w.document.close();
}
