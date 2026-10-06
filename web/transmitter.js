import {prepareTransmitText,pcm16,wavBlob,createTransmitPlayback} from './transmit-audio.js';
import {Resampler} from './resampler.js';
import {supportsImageTransmit,createImageTransmitDialog} from './transmit-image.js';

export function createTransmitter({$,enabled,decodeEnabled,workflowUI,getSettings,getMode,context,pauseInput,status,onState,download,showMessage,onSpectrum=()=>{},resumeInput=()=>false,stopInput=()=>{}}){
  const dialog=$('tx-render-dialog');
  let serial=0,session,timer,renderImage=false;
  const imageDialog=createImageTransmitDialog({$,enabled,workflowUI,getMode,getSettings,onSend:(kind,image)=>start(kind,image)});
  const active=()=>!!session;
  function update(){
    const fax=getMode()?.family==='WEFAX',dtmf=getMode()?.family==='DTMF';
    for(const id of ['macro-tr','waterfall-tr','macro-tx','macro-tx-start','menu-generate-audio'])
      workflowUI.setRuntimeDisabled(id,!!session&&(session.kind==='render'||session.finishing));
    workflowUI.setRuntimeDisabled('menu-send-image',active()||!supportsImageTransmit(getMode()));
    workflowUI.setRuntimeDisabled('tx-text',fax||!!session?.image||session?.kind==='render');
    workflowUI.setRuntimeDisabled('tx-cancel',session?.kind!=='live');
    workflowUI.setRuntimeDisabled('tx-render-generate',active()||renderImage);
    workflowUI.setRuntimeDisabled('rx-button',!decodeEnabled&&session?.kind!=='live');
    // Mode and settings are immutable for each rendering / live TX session.
    for(const id of ['menu-op-mode','current-mode','menu-configure','shortcut-configure','save-config','menu-import-config','frequency','frequency-top','sideband','reverse','frequency-lock']){
      const modeRestriction=(fax||dtmf)&&id==='frequency-lock'||dtmf&&['frequency','frequency-top','sideband','reverse'].includes(id);
      workflowUI.setRuntimeDisabled(id,active()||modeRestriction);
    }
    $('tx-text').readOnly=!!session?.finishing||!!session?.image;
    $('tx-text').title=fax?'WEFAX transmits images. Press T/R or choose File → Audio → Transmit image.':'Compose text for TX generate or realtime playback. During TX, append text at the end; T/R finishes the session.';
    $('rx-button').title=session?.kind==='live'?(session.image?'Stop image TX and return to receive':'Finish queued transmit text and return to receive'):'Start or stop live audio capture (F3)';
    for(const id of ['macro-tr','waterfall-tr','macro-tx','macro-tx-start'])$(id).setAttribute('aria-pressed',String(session?.kind==='live'));
    $('tx-audio-bar').hidden=!enabled||session?.kind!=='live';
    session?.playback?.setVolume(getSettings().txVolume);
    if(!session)$('tx-audio-info').textContent='';
    document.body.classList.toggle('transmitting',session?.kind==='live');
    workflowUI.apply();onState(session?.kind||'idle');
  }
  function time(seconds){return Math.floor(seconds/60)+':'+String(Math.floor(seconds%60)).padStart(2,'0');}
  function stopWorker(current){clearInterval(timer);timer=undefined;current.worker?.terminate();current.playback?.stop();}
  function completeLive(current){
    if(session!==current)return;
    stopWorker(current);session=undefined;$('output-level').value='';
    const resumed=resumeInput();update();status(resumed?'TX complete · Live receive resumed':'TX complete · Receive ready');
  }
  function cancel(announce=true,returnToReceive=false){
    const current=session;if(!current)return;
    session=undefined;serial++;stopWorker(current);$('output-level').value='';
    $('tx-render-status').textContent='Generation canceled.';
    if(current.kind==='live'){if(returnToReceive)resumeInput();else stopInput();}
    update();if(announce)status(current.kind==='live'?'TX stopped immediately':'Audio generation canceled');
  }
  function fail(current,message){
    if(session!==current)return;
    cancel(false,true);$('tx-render-status').textContent=message;status(message,true);
  }
  function pull(current){
    if(session!==current||current.pending||current.done)return;
    current.pending=true;current.worker.postMessage({type:'pull',job:current.id,maximum:current.kind==='live'?512:8192});
  }
  function tick(current){
    if(session!==current)return;
    for(const {spectrum,rate}of current.playback.takeSpectra())onSpectrum(spectrum,rate);
    $('tx-audio-info').textContent=`${current.mode.label} · TX ${time(current.playback.elapsed)} · ${current.image?'Image · Stops automatically':current.finishing?'Finishing…':'Type to append; T/R to finish'}`;
    if(current.done){if(current.playback.buffered===0)completeLive(current);}
    else if(current.playback.buffered<0.75)pull(current);
  }
  function rendered(current){
    if(session!==current)return;
    if(current.resampler){const tail=current.resampler.process(new Float32Array(current.resampler.half*2));current.chunks.push(pcm16(tail));current.count+=tail.length;}
    const blob=wavBlob(current.chunks,current.count,current.rate);
    const name=`fldigi-${current.mode.name.replace(/[^a-z0-9_-]/gi,'-')}-${current.mode.family==='DTMF'?'keypad':Math.round(current.frequency)+'Hz'}${current.image?'-image':''}.wav`;
    download(name,blob,'audio/wav');
    stopWorker(current);session=undefined;
    $('tx-render-progress').value=100;
    dialog.close();update();
  }
  function receive(current,data){
    if(session!==current||data.job!==undefined&&data.job!==current.id)return;
    if(data.type==='ready'){
      current.worker.postMessage({type:'start',job:current.id,text:current.initialText,image:current.image,settings:current.settings,live:current.kind==='live'},current.image?[current.image.pixels.buffer]:[]);
    }else if(data.type==='error')fail(current,data.message);
    else if(data.type==='queue-closed'){
      current.finishing=true;update();status('This modem has finished accepting text. Appended text remains in the editor for the next TX.');
    }
    else if(data.type==='started'){
      current.rate=data.rate;current.frequency=data.frequency;
      if(current.kind==='render'&&current.settings.txPpm)current.resampler=new Resampler(data.rate*(1+current.settings.txPpm/1e6),data.rate);
      // Text typed while the WASM module was loading was kept locally.
      if(current.appended){current.worker.postMessage({type:'append',job:current.id,text:current.appended});current.appended='';}
      current.started=true;
      if(current.image&&current.kind==='live')status('Transmitting image · Returns to receive automatically');
      if(current.finishing)current.worker.postMessage({type:'finish',job:current.id});
      if(current.kind==='live')timer=setInterval(()=>tick(current),30);
      pull(current);
    }else if(data.type==='samples'){
      current.pending=false;current.done=data.done;
      if(current.kind==='render'){
        const samples=current.resampler?current.resampler.process(data.samples):data.samples;
        if(samples.length){current.chunks.push(pcm16(samples));current.count+=samples.length;}
        const percent=current.image?Math.min(99,Math.round(data.progress??0)):current.bytes?Math.min(99,Math.round(data.cursor/current.bytes*100)):0;
        $('tx-render-progress').value=percent;
        $('tx-render-status').textContent=current.image?`Generating · ${percent}% of image · ${time(data.total/data.rate)} of audio`:`Generating · ${percent}% of text · ${time(data.total/data.rate)} of audio`;
        if(data.done)rendered(current);else pull(current);
      }else{
        if(data.ending&&!current.finishing){current.finishing=true;update();}
        current.playback.push(data.samples,data.rate,data.spectrum);
        let peak=0;for(const sample of data.samples)peak=Math.max(peak,Math.abs(sample));
        const level=peak*current.settings.txVolume;$('output-level').value=level>0?Math.round(20*Math.log10(level)):'—';
        tick(current);
      }
    }
  }
  async function start(kind,image){
    if(!enabled||session)return;
    const mode=getMode(),settings={...getSettings()};
    let text;
    try{
      if(!mode)throw new Error('The fldigi modems are still loading.');
      if(mode.family==='WEFAX'&&!image){imageDialog.open(kind);return;}
      text=image?'':prepareTransmitText($('tx-text').value,mode,settings);
      if(!image&&!text.trim())throw new Error('Enter transmit text first.');
    }catch(error){$('tx-render-status').textContent=error.message;status(error.message,true);return;}
    const current={id:++serial,kind,mode:{...mode},settings,image,text,initialText:text,editorText:$('tx-text').value,bytes:new TextEncoder().encode(text).length,
      chunks:[],count:0,pending:false,done:false,finishing:false,appended:'',started:false};
    session=current;pauseInput(kind);update();
    if(image&&kind==='render'){
      renderImage=true;update();
      $('tx-render-summary').textContent=`${mode.label} · ${image.width} × ${image.height} · ${image.gray?'Grayscale':'Color'}\nYour image will be encoded and downloaded as a mono PCM WAV file. Maximum duration: 30 minutes.`;
      dialog.showModal();
    }
    $('tx-render-progress').value=0;$('tx-render-status').textContent='Loading encoder…';
    status(kind==='live'?'Starting realtime TX…':'Generating audio…');
    try{
      if(kind==='live'){
        const audioContext=await context();if(session!==current)return;
        current.playback=createTransmitPlayback(audioContext,settings.txVolume,settings.txPpm);
      }
      if(session!==current)return;
      current.worker=new Worker(new URL('./encoder-worker.js',import.meta.url),{type:'module'});
      current.worker.onmessage=({data})=>{try{receive(current,data);}catch(error){fail(current,error.message);}};
      current.worker.onerror=()=>fail(current,'The fldigi encoder failed. Rebuild the browser core and try again.');
    }catch(error){fail(current,error.message);}
  }
  function finish(){
    const current=session;if(!current||current.kind!=='live'||current.finishing)return;
    if(current.image){cancel(true,true);return;}
    current.finishing=true;if(current.started)current.worker.postMessage({type:'finish',job:current.id});
    update();status('Finishing TX · Sending remaining queued text and modem tail…');
  }
  function toggle(){if(!enabled)return;if(session?.kind==='live')finish();else if(!session)start('live');}
  function generate(){
    if(!enabled||session)return;
    if(getMode()?.family==='WEFAX'){imageDialog.open('render');return;}
    if(!$('tx-text').value.trim()){
      showMessage('Warning','Enter text in the transmit box before generating an audio file.');
      return;
    }
    const mode=getMode(),settings=getSettings();
    renderImage=false;
    $('tx-render-summary').textContent=`${mode?.label||'Loading modem…'} · ${mode?.family==='DTMF'?'fixed keypad tones':`${Math.round(settings.txFrequencyLock?settings.txFrequency:settings.frequency)} Hz`}\nWhen you click Generate, your current input will be encoded and downloaded as a mono PCM WAV file. Maximum duration: 30 minutes.`;
    $('tx-render-status').textContent='Ready to generate';
    $('tx-render-progress').value=0;update();dialog.showModal();
  }
  $('tx-text').addEventListener('input',()=>{
    const current=session;if(!current||current.kind!=='live'||current.finishing||current.image)return;
    try{
      const next=$('tx-text').value;
      if(!next.startsWith(current.editorText))throw new Error('Queued text is locked during TX. Append at the end, or finish TX before editing.');
      const normalized=prepareTransmitText(next,current.mode,current.settings);
      const addition=normalized.slice(current.text.length);current.text=normalized;current.editorText=next;
      if(addition){if(current.started)current.worker.postMessage({type:'append',job:current.id,text:addition});else current.appended+=addition;}
    }catch(error){$('tx-text').value=current.editorText;status(error.message,true);}
  });
  for(const id of ['macro-tr','waterfall-tr'])$(id).addEventListener('click',toggle);
  for(const id of ['macro-tx','macro-tx-start'])$(id).addEventListener('click',()=>start('live'));
  $('tx-render-generate').addEventListener('click',()=>start('render'));
  $('tx-render-close').addEventListener('click',()=>{if(session?.kind==='render')cancel();dialog.close();});
  dialog.addEventListener('cancel',()=>{if(session?.kind==='render')cancel();});
  $('tx-cancel').addEventListener('click',()=>cancel());
  return {update,generate,toggle,finish,cancel,image(){if(enabled&&!session)imageDialog.open();},get active(){return active();},dispose(){cancel(false);imageDialog.dispose();}};
}
