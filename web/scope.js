// Render the original Digiscope callbacks in the browser's docked canvas.
const names={0:'Signal waveform',2:'Signal phase',3:'Signal phase history',4:'Signal phase amplitude history',5:'RTTY waveform',6:'RTTY crosshairs',8:'Modem timing waveform',9:'Modem signal waterfall',10:'Blank signal scope'};
export function scopeViews(mode){if(mode>=1&&mode<=4)return[2,3,4];if(mode===5||mode===6)return[5,6];if(mode===8||mode===9)return[8,9];return[mode];}
export function createScope(canvas){
  const ctx=canvas.getContext('2d'),video=document.createElement('canvas'),vc=video.getContext('2d');
  let data={mode:10,trace:[],xy:[],video:[]},serial,view=10,history=[],videoSerial;
  function describe(){canvas.dataset.scopeView=String(view);canvas.setAttribute('aria-label',names[view]||'Signal scope');canvas.title=view===10?'The selected modem does not provide a signal scope in fldigi.':scopeViews(data.mode).length>1?'Click to change scope view':names[view]||'Signal scope';}
  function draw(){
    const w=canvas.width,h=canvas.height;ctx.fillStyle='#000';ctx.fillRect(0,0,w,h);describe();if(view===10)return;
    ctx.strokeStyle='#00ff00';ctx.lineWidth=1;
    if(view>=2&&view<=4){
      const cx=w/2,cy=h/2,r=.95*Math.min(w,h)/2;
      ctx.strokeStyle='#ccc';ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]]){ctx.moveTo(cx+dx*r,cy+dy*r);ctx.lineTo(cx+dx*r*.9,cy+dy*r*.9);}ctx.stroke();
      if(!data.highlight){ctx.strokeStyle='#00ff00';ctx.beginPath();ctx.arc(cx,cy,r*.1,0,Math.PI*2);ctx.stroke();return;}
      const points=view===2?[data]:history;
      points.forEach((p,i)=>{const length=r*.9*(view===4?Math.max(0,Math.min(1,p.quality)):1);ctx.strokeStyle=`rgba(0,255,0,${.2+.8*(i+1)/Math.max(1,points.length)})`;ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(cx+Math.sin(p.phase)*length,cy-Math.cos(p.phase)*length);ctx.stroke();});return;
    }
    if(view===6){
      const cx=w/2,cy=h/2;ctx.strokeStyle='#ccc';ctx.beginPath();for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]]){ctx.moveTo(cx+dx*cx*.6,cy+dy*cy*.6);ctx.lineTo(cx+dx*cx,cy+dy*cy);}ctx.stroke();ctx.strokeStyle='#00ff00';ctx.beginPath();for(let i=0;i+1<data.xy.length;i+=2){const x=(data.xy[i]+1)*cx,y=(data.xy[i+1]+1)*cy;if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y);}ctx.stroke();return;
    }
    if(view===9){ctx.drawImage(video,2,2,Math.max(1,w-4),Math.max(1,h-4));return;}
    const trace=data.trace?.length?data.trace:[0,0],count=Math.min(Math.max(1,w-4),trace.length);ctx.beginPath();
    for(let i=0;i<count;i++){const value=trace[Math.min(trace.length-1,Math.round(i*trace.length/Math.max(1,count)))];const x=2+i*(w-4)/Math.max(1,count-1),y=h-2-(h-4)*(view===5?.5+.75*value:value);if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y);}ctx.stroke();
    if(data.axis){ctx.strokeStyle='#ccc';ctx.beginPath();const y=h-2-data.axis*(h-4);ctx.moveTo(2,y);ctx.lineTo(w-2,y);ctx.stroke();}
  }
  function reset(redraw=true){
    // Reset signal history without discarding the modem's view/graticule.
    // A seek/source reset may be followed by no PCM (e.g. while paused).
    serial=undefined;history=[];videoSerial=undefined;
    data={mode:data.mode,phase:0,quality:0,highlight:false,axis:0,trace:[],xy:[],video:[]};
    vc.clearRect(0,0,video.width,video.height);if(redraw)draw();
  }
  function update(next){
    if(!next)return;
    if(next.serial!==serial){const nextView=scopeViews(next.mode).includes(view)?view:next.mode===1?2:next.mode;reset(false);serial=next.serial;view=nextView;}
    data=next;if(data.highlight){history.push({phase:data.phase,quality:data.quality});history=history.slice(-8);}
    const w=Math.max(1,canvas.width-4),h=Math.max(1,canvas.height-4);
    if(video.width!==w||video.height!==h){video.width=w;video.height=h;videoSerial=undefined;}
    if(data.video.length&&data.videoSerial!==videoSerial){videoSerial=data.videoSerial;const down=!data.videoDirection;vc.drawImage(video,0,down?1:-1);const row=vc.createImageData(w,1);for(let x=0;x<w;x++){const v=Math.max(0,Math.min(255,data.video[Math.floor(x*data.video.length/w)]));row.data[x*4]=row.data[x*4+1]=row.data[x*4+2]=v;row.data[x*4+3]=255;}row.data[Math.floor(w/2)*4]=255;row.data[Math.floor(w/2)*4+1]=row.data[Math.floor(w/2)*4+2]=0;vc.putImageData(row,0,down?0:h-1);}
    draw();
  }
  function cycle(){const views=scopeViews(data.mode);view=views[(views.indexOf(view)+1)%views.length];draw();}
  canvas.addEventListener('click',cycle);canvas.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();cycle();}});
  return {update,draw,reset};
}
