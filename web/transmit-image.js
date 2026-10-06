// Formats and header codes follow the desktop *-pic.cxx image dialogs.
export const supportsImageTransmit=mode=>['WEFAX','MFSK','THOR','IFKP','FSQ'].includes(mode?.family);
const sizes=[[59,74],[120,150],[240,300],[160,120],[320,240],[640,480]];
const fsqSizes=[[160,120,false],[320,240,false],[640,480,true],[640,480,false],[240,300,false],[240,300,true],[120,150,false],[120,150,true]];
const lpms=[240,120,90,60];
export function imageFormats(mode){
  if(mode.family==='WEFAX')return lpms.map((lpm,format)=>({value:String(format),label:`Grayscale · ${lpm} lines/min`,gray:true,format,lpm}));
  if(mode.family==='MFSK')return [false,true].map(gray=>({value:gray?'gray':'color',label:gray?'Grayscale':'Color',gray,format:0}));
  if(mode.family==='FSQ')return fsqSizes.map(([width,height,gray],format)=>({value:String(format),label:`${width} × ${height} · ${gray?'Grayscale':'Color'}`,width,height,gray,format}));
  return sizes.flatMap(([width,height],format)=>[false,true].map(gray=>({value:`${format}-${gray?'gray':'color'}`,label:`${width} × ${height} · ${gray?'Grayscale':'Color'}`,width,height,gray,format})));
}
export function imagePlan(mode,sourceWidth,sourceHeight,{format,width=320,spp=8,callsign='',lowercase=true}={}){
  if(!supportsImageTransmit(mode))throw new Error('This mode does not transmit image files.');
  if(!Number.isInteger(sourceWidth)||!Number.isInteger(sourceHeight)||sourceWidth<1||sourceHeight<1||sourceWidth*sourceHeight>16000000)throw new Error('Choose an image with at most 16 million pixels.');
  const choices=imageFormats(mode),choice=choices.find(item=>item.value===String(format));
  if(!choice)throw new Error('Choose a supported image format.');
  let targetWidth=choice.width,targetHeight=choice.height;
  if(mode.family==='WEFAX'||mode.family==='MFSK'){
    targetWidth=mode.family==='WEFAX'?(mode.name==='WEFAX576'?1809:904):Number(width);
    targetHeight=Math.max(1,Math.round(sourceHeight*targetWidth/sourceWidth));
  }
  if(!Number.isInteger(targetWidth)||targetWidth<1||targetWidth>4095||targetHeight>4095)throw new Error('The prepared image must be at most 4095 pixels wide and high. Reduce its width or crop the source image.');
  spp=mode.family==='MFSK'?Number(spp):mode.family==='IFKP'?8:10;
  if(mode.family==='MFSK'&&![2,4,8].includes(spp))throw new Error('Choose a supported image speed.');
  callsign=lowercase?callsign.trim().toLowerCase():callsign.trim().toUpperCase();
  if(mode.family==='FSQ'&&!/^[a-z0-9/]{3,20}$/i.test(callsign))throw new Error('Enter your FSQ callsign (3–20 letters, numbers, or /).');
  const rate=mode.family==='IFKP'?16000:mode.family==='FSQ'?12000:8000;
  const pixelSeconds=targetWidth*targetHeight*(choice.gray?1:3)*spp/rate;
  // Allow for the text/FEC header and native modem tail; the worker also
  // enforces the exact 30-minute limit on the generated sample count.
  const seconds=mode.family==='WEFAX'?20+(targetHeight+21)*60/choice.lpm:pixelSeconds+120;
  if(seconds>1800)throw new Error('This image would exceed the 30-minute limit. Choose a smaller image, grayscale, or a faster image speed.');
  return {...choice,width:targetWidth,height:targetHeight,spp,callsign,seconds,name:mode.name};
}

export function createImageTransmitDialog({$,enabled,workflowUI,getMode,getSettings,onSend}){
  const dialog=$('tx-image-dialog'),canvas=$('tx-image-preview');
  let bitmap,sourceName='',plan,pixels,loadSerial=0;
  function ready(value){for(const id of ['tx-image-live','tx-image-save'])workflowUI.setRuntimeDisabled(id,!value);workflowUI.apply();}
  function prepare(){
    plan=pixels=undefined;ready(false);
    if(!bitmap){$('tx-image-info').textContent='Choose an image to preview its transmit format.';return;}
    try{
      const mode=getMode();plan=imagePlan(mode,bitmap.width,bitmap.height,{format:$('tx-image-format').value,width:$('tx-image-width').value,spp:$('tx-image-speed').value,callsign:$('tx-image-callsign').value,lowercase:getSettings().fsqLowercase});
      canvas.width=plan.width;canvas.height=plan.height;
      const ctx=canvas.getContext('2d',{willReadFrequently:true});
      ctx.fillStyle='#fff';ctx.fillRect(0,0,plan.width,plan.height);
      const scale=Math.min(plan.width/bitmap.width,plan.height/bitmap.height),w=bitmap.width*scale,h=bitmap.height*scale;
      ctx.drawImage(bitmap,(plan.width-w)/2,(plan.height-h)/2,w,h);
      const rgba=ctx.getImageData(0,0,plan.width,plan.height);
      pixels=new Uint8Array(plan.width*plan.height*3);
      for(let i=0,j=0;i<rgba.data.length;i+=4,j+=3){
        const gray=Math.floor((mode.family==='MFSK'||mode.family==='WEFAX'?31*rgba.data[i]+61*rgba.data[i+1]+8*rgba.data[i+2]:30*rgba.data[i]+60*rgba.data[i+1]+10*rgba.data[i+2])/100);
        for(let c=0;c<3;c++)pixels[j+c]=plan.gray?(rgba.data[i+c]=gray):rgba.data[i+c];
      }
      if(plan.gray)ctx.putImageData(rgba,0,0);
      canvas.hidden=false;
      $('tx-image-info').textContent=`${sourceName} · ${plan.width} × ${plan.height} · ${plan.gray?'Grayscale':'Color'}${plan.lpm?` · ${plan.lpm} lines/min`:''}\n${mode.family==='FSQ'?'Addressed to allcall. Image header: 3 baud. ':''}Includes the modem header and end signals. Maximum duration: 30 minutes.`;
      ready(true);
    }catch(error){canvas.hidden=true;$('tx-image-info').textContent=error.message;}
  }
  async function load(file){
    const serial=++loadSerial;bitmap?.close();bitmap=undefined;canvas.hidden=true;ready(false);
    if(!file){prepare();return;}
    $('tx-image-info').textContent='Loading image…';
    try{
      if(file.size>20*1024*1024)throw new Error('Choose an image file smaller than 20 MB.');
      const next=await createImageBitmap(file);
      if(serial!==loadSerial){next.close();return;}
      if(next.width*next.height>16000000){next.close();throw new Error('Choose an image with at most 16 million pixels.');}
      bitmap=next;sourceName=file.name;prepare();
    }catch(error){if(serial===loadSerial)$('tx-image-info').textContent=error.message==='The source image could not be decoded.'?'Choose a browser-supported image such as PNG, JPEG, or WebP.':error.message;}
  }
  function open(intent='live'){
    if(!enabled||!supportsImageTransmit(getMode()))return;
    const mode=getMode(),settings=getSettings(),choices=imageFormats(mode);
    $('tx-image-mode').textContent=`${mode.label} · ${mode.family==='WEFAX'?1900:mode.family==='FSQ'?1500:Math.round(settings.txFrequencyLock?settings.txFrequency:settings.frequency)} Hz`;
    $('tx-image-format').replaceChildren(...choices.map(choice=>{const option=document.createElement('option');option.value=choice.value;option.textContent=choice.label;return option;}));
    $('tx-image-format').value=mode.family==='WEFAX'?String(settings.wefaxLpm):mode.family==='MFSK'?'color':mode.family==='FSQ'?'1':'4-color';
    $('tx-image-width-row').hidden=mode.family!=='MFSK';$('tx-image-speed-row').hidden=mode.family!=='MFSK';$('tx-image-callsign-row').hidden=mode.family!=='FSQ';
    if(mode.family==='FSQ'&&!$('tx-image-callsign').value)$('tx-image-callsign').value=settings.callsign;
    $('tx-image-live').autofocus=intent==='live';$('tx-image-save').autofocus=intent==='render';
    prepare();dialog.showModal();
  }
  function send(kind){
    prepare();if(!plan||!pixels)return;
    const image={...plan,pixels:pixels.slice()};dialog.close();onSend(kind,image);
  }
  $('tx-image-file').addEventListener('change',()=>load($('tx-image-file').files?.[0]));
  for(const id of ['tx-image-format','tx-image-width','tx-image-speed','tx-image-callsign'])$(id).addEventListener('input',prepare);
  $('tx-image-live').addEventListener('click',()=>send('live'));
  $('tx-image-save').addEventListener('click',()=>send('render'));
  ready(false);
  return {open,dispose(){loadSerial++;bitmap?.close();}};
}
