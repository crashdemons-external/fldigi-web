import {SCALE_HEIGHT, MARKER_HEIGHT, WATERFALL_TOP, clampTuningFrequency, pointerFrequency, positionMarkers, snapMarkerPositions} from './waterfall-geometry.js';
import {rttyPresets} from './rtty-presets.js';
import {defaults, validatedConfig, storageKey} from './configuration.js';
import {appendReceivedText} from './received-text.js';
import {createScope} from './scope.js';

const $ = id => document.getElementById(id);
// Stable IDs for dynamically created controls cataloged in workflow.json.
const controlId = (prefix,name) => prefix+'-'+encodeURIComponent(name);
// fldigi 4.2.13 comments out its OFDM Op Mode submenu pending development;
// its generated mode table still contains these entries and unavailable utility modes.
const sourceDisabledModes=new Set(['OFDM500F','OFDM750F','OFDM3500']);
const selectableMode=mode=>mode.enabled&&!sourceDisabledModes.has(mode.name);
// Intentional UI-only deviation from the fldigi source label: make Morse explicit.
const displayModeName=mode=>mode.name==='CW'?'CW (morse)':mode.label;
const dtmfSelected=()=>settings.modeName==='DTMF';
let settings;
try{settings=validatedConfig(JSON.parse(localStorage.getItem(storageKey)));}catch{settings={...defaults};}
let workerReady=false,modes=[],audioContext,audioSetup,stream,liveSource,liveWorklet,liveGain,fileSource,fileWorklet,fileGain;
let configureSequence=0,configuredMode,audioGeneration=0,activeInput='none',captureDeviceSelection;
let live=false,openingLive=false,sourceGeneration=0,fileUrl,waterfallPaused=false,displayMode='WF',latestSpectrum,latestRate=8000,latestBandwidth=31.25,waterfallRows=0;
let latestGeometry={bands:[[-41,41]],tracks:[-15,15],hover:[-15,15],markerEdges:[-41,41]};
let waterfallOffset=0,displayMagnification=1,hoverPointer,cursorHideTimer;
let configDraft,configPage='Soundcard/Devices',devices=[];
let pictureData,pictureSerial=0,rasterX=0,rasterY=0;
const audio=$('audio-file');
const rasterCanvas=document.createElement('canvas');rasterCanvas.id='rx-raster';rasterCanvas.setAttribute('aria-label','Decoded Hellschreiber raster');rasterCanvas.hidden=true;$('rx-text').after(rasterCanvas);
const history=document.createElement('canvas'); const historyContext=history.getContext('2d');
const waterfallContext=$('waterfall').getContext('2d');
const scopeDisplay=createScope($('scope'));
const eventLog=[];
function logEvent(message,error=false){
  if(eventLog.at(-1)?.message===message&&eventLog.at(-1)?.error===error)return;
  eventLog.push({time:new Date().toISOString(),message,error});if(eventLog.length>250)eventLog.shift();
}
window.addEventListener('error',event=>logEvent(event.message,true));
window.addEventListener('unhandledrejection',event=>logEvent(event.reason?.message||String(event.reason),true));
function status(message,error=false){$('status-message').textContent=message;$('status-message').classList.toggle('error',error);logEvent(message,error);}
function saveSettings(){try{localStorage.setItem(storageKey,JSON.stringify(settings));}catch{status('Configuration could not be saved in browser storage.',true);}}
function postDecoder(data,transfers=[]){worker.postMessage({...data,generation:audioGeneration},transfers);}
function resetAudioPipeline(source='none'){
  activeInput=source;audioGeneration++;postDecoder({type:'reset'});
  latestSpectrum=undefined;scopeDisplay.reset();
  for(const [kind,node]of [['file',fileWorklet],['live',liveWorklet]])node?.port.postMessage({command:'reset',generation:audioGeneration,active:kind===source&&(kind!=='file'||!audio.paused&&!audio.seeking)});
}
function configureDecoder(retune=false){
  if(!workerReady)return;
  if(configuredMode!==settings.mode){configuredMode=settings.mode;resetAudioPipeline(activeInput);retune=true;}
  postDecoder({type:'configure',settings,retune,sequence:++configureSequence});
}
function syncFrequencyInputs(){for(const id of ['frequency','frequency-top'])if(document.activeElement!==$(id))$(id).value=Math.round(settings.frequency);}
function syncSquelchControls(){
  $('squelch').value=settings.squelch;$('squelch-slider').value=settings.squelch;
  $('squelch-slider').title=`Squelch level: ${settings.squelch} (drag up to increase)`;
}
function setSquelch(value){
  const number=Number(value);if(!Number.isFinite(number))return;
  const threshold=Math.round(Math.max(0,Math.min(100,number)));
  if(settings.squelch===threshold){syncSquelchControls();return;}
  settings.squelch=threshold;syncSquelchControls();configureDecoder();saveSettings();
}
function applySettings(persist=true){
  document.documentElement.style.setProperty('--rx',settings.rxColor);
  $('rx-text').style.fontFamily=`${settings.rxFont}, monospace`;$('rx-text').style.fontSize=settings.rxFontSize+'px';$('tx-text').style.fontSize=settings.rxFontSize+'px';
  $('rx-text').style.whiteSpace=settings.rxWrap?'pre-wrap':'pre';$('rx-text').wrap=settings.rxWrap?'soft':'off';
  $('window-title').textContent='fldigi - NO CALLSIGN SET (receive-only alpha)';
  $('sideband').value=settings.sideband;
  $('channel-panel').classList.toggle('hidden-panel',!settings.showChannels);$('scope').classList.toggle('hidden-panel',!settings.showScope);
  for(const key of ['reference','span'])$(key).value=settings[key];syncSquelchControls();syncFrequencyInputs();
  $('channel-squelch').value=settings.channelSquelch;$('channel-squelch-label').textContent=Number(settings.channelSquelch).toFixed(1);
  for(const key of ['afc','sql','reverse'])$(key).setAttribute('aria-pressed',String(settings[key]));
  $('magnification').textContent='x'+settings.magnification;$('waterfall-speed').textContent=settings.speed;
  const mode=modes.find(m=>m.name===settings.modeName&&selectableMode(m))||modes.find(m=>m.name===defaults.modeName&&selectableMode(m));
  if(mode){settings.modeName=mode.name;settings.mode=mode.id;$('current-mode').textContent=displayModeName(mode);}
  const dtmf=dtmfSelected();
  for(const id of ['frequency','frequency-top','afc','sql','reverse','sideband'])$(id).disabled=dtmf;
  document.querySelectorAll('[data-tune]').forEach(button=>button.disabled=dtmf);
  $('waterfall').setAttribute('aria-label',dtmf?'Audio waterfall; DTMF uses fixed tone frequencies':'Audio waterfall; hover to preview, click to tune');
  $('sql').title=dtmf?'DTMF always uses the squelch threshold':'Enable squelch gating';
  if(dtmf){hoverPointer=undefined;clearTimeout(cursorHideTimer);$('waterfall').style.cursor='default';}
  $('rx-raster').hidden=mode?.family!=='Hellschreiber';$('rx-text').hidden=mode?.family==='Hellschreiber';$('fax-controls').hidden=mode?.family!=='WEFAX';
  for(const node of [liveWorklet,fileWorklet])node?.port.postMessage({channel:settings.channel,generation:audioGeneration});
  if(fileGain)fileGain.gain.value=$('file-mute').getAttribute('aria-pressed')==='true'?0:settings.playbackVolume;
  if(displayMagnification!==settings.magnification){displayMagnification=settings.magnification;waterfallOffset=Math.max(0,Math.min(4000-4000/displayMagnification,settings.frequency-2000/displayMagnification));}
  configureDecoder();resizeCanvases();updateTuningCursor();if(persist)saveSettings();
  if((live||openingLive)&&captureDeviceSelection!==settings.inputDevice){stopLive();startLive();}
}
function tune(frequency){if(dtmfSelected()||!Number.isFinite(Number(frequency)))return;settings.frequency=clampTuningFrequency(Number(frequency),latestBandwidth,settings.lowCutoff,settings.highCutoff);$('frequency').value=Math.round(settings.frequency);$('frequency-top').value=Math.round(settings.frequency);configureDecoder(true);updateTuningCursor();saveSettings();}
let hoverOpenedMenu;
function closeBranches(root=document){root.querySelectorAll('.submenu-open').forEach(branch=>{branch.classList.remove('submenu-open');branch.querySelector('.submenu-heading').setAttribute('aria-expanded','false');});}
function closeMenus(){closeBranches();hoverOpenedMenu=undefined;document.querySelectorAll('.menu.open').forEach(menu=>{menu.classList.remove('open');menu.querySelector('.menu-heading').setAttribute('aria-expanded','false');});}
function openMenu(menu){closeMenus();menu.classList.add('open');menu.querySelector('.menu-heading').setAttribute('aria-expanded','true');}
document.querySelectorAll('.menu-heading').forEach(button=>{
  button.addEventListener('click',event=>{event.stopPropagation();if(button.disabled)return;const menu=button.parentElement,keepOpen=!menu.classList.contains('open')||hoverOpenedMenu===menu;closeMenus();if(keepOpen)openMenu(menu);});
  button.parentElement.addEventListener('pointerenter',event=>{if(event.pointerType!=='mouse'||button.disabled)return;const menu=button.parentElement;if(document.querySelector('.menu.open')&&!menu.classList.contains('open')){openMenu(menu);hoverOpenedMenu=menu;}});
});
function bindMenuBranches(root){root.querySelectorAll('.menu-branch').forEach(branch=>{
  const heading=branch.querySelector('.submenu-heading');
  heading.setAttribute('aria-label',heading.textContent);
  const open=()=>{
    if(heading.disabled)return;closeBranches(branch.parentElement);branch.classList.add('submenu-open');heading.setAttribute('aria-expanded','true');
    const popup=branch.querySelector('.menu-submenu');popup.style.top='-3px';popup.style.left='100%';popup.style.maxHeight='';
    const viewport=window.visualViewport,left=viewport?.offsetLeft||0,top=viewport?.offsetTop||0;
    const right=left+(viewport?.width||innerWidth)-4,bottom=top+(viewport?.height||innerHeight)-4;
    const bounds=popup.getBoundingClientRect(),parent=branch.getBoundingClientRect();
    if(bounds.right>right){
      popup.style.left=(Math.max(left+4,right-bounds.width)-parent.left)+'px';
      // An overlapping submenu must not cover the heading that opened it:
      // mouse hover can open it before the pending click reaches the heading.
      const anchor=heading.getBoundingClientRect(),below=Math.max(0,bottom-anchor.bottom),above=Math.max(0,anchor.top-top-4);
      const useBelow=below>=bounds.height||below>=above,height=Math.min(bounds.height,useBelow?below:above);
      popup.style.top=(useBelow?anchor.bottom-parent.top:anchor.top-parent.top-height)+'px';
      popup.style.maxHeight=Math.max(24,height)+'px';
    }else if(bounds.bottom>bottom)popup.style.top=(Math.max(top+4,bottom-bounds.height)-parent.top)+'px';
  };
  // Touch/pen pointers enter on contact and leave when lifted. Closing here can
  // hide the tapped action before its click, including the file-picker action.
  branch.addEventListener('pointerenter',event=>{if(event.pointerType==='mouse')open();});
  branch.addEventListener('pointerleave',event=>{if(event.pointerType==='mouse')closeBranches(branch.parentElement);});
  heading.addEventListener('click',event=>{event.stopPropagation();open();});
  heading.addEventListener('keydown',event=>{if(event.key==='ArrowRight'||event.key==='ArrowDown'){event.preventDefault();open();branch.querySelector('.menu-submenu button:not(:disabled)')?.focus();}else if(event.key==='ArrowLeft'){event.preventDefault();closeBranches(branch.parentElement);heading.focus();}});
});}
bindMenuBranches(document.querySelector('.menus'));
document.addEventListener('click',event=>{if(!event.target.closest('.menu'))closeMenus();});
document.querySelectorAll('.menu-popup a').forEach(link=>link.addEventListener('click',closeMenus));
// Labels, order, and values follow the FSQ and IFKP Op Mode callbacks in fldigi 4.2.13.
const speedPresetMenus={
  FSQ:{setting:'fsqBaud',presets:[['FSQ-6',6],['FSQ-4.5',4.5],['FSQ-3',3],['FSQ-2',2],['FSQ-1.5',1.5]]},
  IFKP:{setting:'ifkpBaud',presets:[['IFKP 0.5',0],['IFKP 1.0',1],['IFKP 2.0',2]]},
};
function buildModeMenu(){
  const groups=new Map();for(const mode of modes.filter(mode=>selectableMode(mode)&&mode.family!=='DTMF')){let family=mode.family || (/^MFSK/.test(mode.name)?'MFSK':/^THOR/.test(mode.name)?'THOR':/HELL/.test(mode.name)?'Hellschreiber':/^WEFAX/.test(mode.name)?'WEFAX':mode.name);if(!groups.has(family))groups.set(family,[]);groups.get(family).push(mode);}
  $('mode-options').replaceChildren();
  for(const [name,group]of groups){
    const speedMenu=speedPresetMenus[name];
    if(group.length===1&&name!=='RTTY'&&!speedMenu){const button=document.createElement('button');button.id=controlId('mode',group[0].name);button.textContent=displayModeName(group[0]);button.disabled=!group[0].enabled;button.addEventListener('click',()=>selectMode(group[0]));$('mode-options').append(button);continue;}
    const parent=document.createElement('div');parent.className='mode-family menu-branch';const heading=document.createElement('button');heading.id=controlId('mode-family',name);heading.className='family-heading submenu-heading';heading.textContent=name;heading.disabled=group.every(m=>!m.enabled);heading.setAttribute('aria-haspopup','true');heading.setAttribute('aria-expanded','false');parent.append(heading);
    const submenu=document.createElement('div');submenu.className='mode-submenu menu-submenu';
    if(name==='RTTY'){
      for(const preset of rttyPresets){const button=document.createElement('button');button.id=controlId('mode-preset',preset.label);button.textContent=preset.label;button.addEventListener('click',()=>{for(const key of ['rttyBaud','rttyShift','rttyBits'])settings[key]=preset[key];selectMode(group[0]);});submenu.append(button);}
      submenu.append(document.createElement('hr'));const custom=document.createElement('button');custom.id='mode-rtty-custom';custom.textContent='Custom...';custom.addEventListener('click',()=>{selectMode(group[0]);openConfig('Modem/RTTY');});submenu.append(custom);
    }else if(speedMenu){
      for(const [label,value] of speedMenu.presets){const button=document.createElement('button');button.id=controlId('mode-preset',label);button.textContent=label;button.addEventListener('click',()=>{settings[speedMenu.setting]=value;selectMode(group[0]);});submenu.append(button);}
    }else for(const mode of group){const button=document.createElement('button');button.id=controlId('mode',mode.name);button.textContent=displayModeName(mode);button.disabled=!mode.enabled;button.addEventListener('click',()=>selectMode(mode));submenu.append(button);}
    parent.append(submenu);$('mode-options').append(parent);
  }
  const dtmf=modes.find(mode=>mode.family==='DTMF'&&selectableMode(mode));
  if(dtmf){const button=document.createElement('button');button.id=controlId('mode',dtmf.name);button.textContent=displayModeName(dtmf);button.addEventListener('click',()=>selectMode(dtmf));$('mode-options').append(document.createElement('hr'),button);}
  bindMenuBranches($('mode-options'));
}
function selectMode(mode){settings.modeName=mode.name;settings.mode=mode.id;applySettings();closeMenus();status(`${displayModeName(mode)} · ${live?'Live audio':fileUrl?'Audio file ready':'Receiver ready'}`);}
const channelRows=Array.from({length:30},(_,index)=>{const row=document.createElement('div');row.id=controlId('channel-row',index+1);row.className='channel-row';const f=document.createElement('span');f.className='channel-frequency';const text=document.createElement('span');row.append(f,text);row.addEventListener('click',()=>{if(row.dataset.frequency)tune(row.dataset.frequency);});$('channel-list').append(row);return row;});
const worker=new Worker(new URL('./decoder-worker.js',import.meta.url),{type:'module'});
worker.onerror=event=>{status('Decoder failed to start. Run the Emscripten build and serve this page over localhost or HTTPS.',true);console.error(event.message);};
worker.onmessage=({data})=>{
  if(data.generation!==undefined&&data.generation!==audioGeneration)return;
  if(data.type==='ready'){workerReady=true;modes=data.modes;const mode=modes.find(m=>m.name===settings.modeName&&selectableMode(m))||modes.find(m=>m.name==='BPSK31');settings.modeName=mode.name;settings.mode=mode.id;buildModeMenu();applySettings();status('Receiver ready · File → Audio → Playback, or Rx for mic capture');}
  else if(data.type==='configured'){if(data.sequence!==configureSequence)return;latestRate=data.rate;latestBandwidth=data.bandwidth;latestGeometry=data.geometry;scopeDisplay.update(data.scope);settings.frequency=data.frequency;syncFrequencyInputs();$('status1').textContent=data.status1||'';$('status2').textContent=data.status2||'';updateTuningCursor();if(data.imageWidth&&data.imageSerial!==pictureSerial){drawPicture({...data,imageUpdates:new Uint32Array(0)},false);}}
  else if(data.type==='error'){status(data.message,true);}
  else if(data.type==='decoded'){
    if(data.text){$('rx-text').value=appendReceivedText($('rx-text').value,data.text);$('rx-text').scrollTop=$('rx-text').scrollHeight;}
    if(data.secondary){$('secondary-text').hidden=false;$('secondary-text').textContent=appendReceivedText($('secondary-text').textContent,data.secondary,200);}
    latestSpectrum=data.spectrum;latestRate=data.rate;scopeDisplay.update(data.scope);
    if(data.sequence===configureSequence){
      if(data.status1)$('status1').textContent=data.status1;if(data.status2)$('status2').textContent=data.status2;
      latestBandwidth=data.bandwidth;latestGeometry=data.geometry;
      settings.frequency=data.frequency;syncFrequencyInputs();
    }
    const signalLevel=Math.max(0,Math.min(100,data.metric));$('signal-meter-fill').style.height=signalLevel+'%';$('signal-meter').setAttribute('aria-valuenow',String(Math.round(signalLevel)));updateTuningCursor();drawWaterfall();drawScope();
    data.channels.forEach((channel,i)=>{const row=channelRows[i];row.dataset.frequency=channel.frequency||'';row.children[0].textContent=channel.frequency?channel.frequency.toFixed(1):'';row.children[1].textContent=channel.text;});
    if(data.raster.length)drawRaster(data.raster,data.rasterHeight);
    if(data.imageUpdates.length)drawPicture(data);
  }
};
function ensureReady(){if(!workerReady)throw new Error('The fldigi decoder is still loading.');}
function ensureMicrophoneAccess(){
  if(!window.isSecureContext)throw new Error('Microphone capture requires HTTPS or localhost. An HTTP address on your local network cannot request microphone permission.');
  if(!navigator.mediaDevices?.getUserMedia)throw new Error('Microphone capture is unavailable in this browser. Open the receiver directly in Chrome or another browser that supports microphone input.');
  const policy=document.permissionsPolicy||document.featurePolicy;
  if(policy?.allowsFeature('microphone')===false)throw new Error('Microphone capture is blocked by this page\'s Permissions Policy. Open the receiver directly instead of inside an embedded page, or allow microphone access in the embedding page.');
}
function reportMicrophoneError(error){
  if(error.name==='NotAllowedError'||error.name==='PermissionDeniedError'){
    status('Microphone access is blocked. Check site and device permissions, then try Rx again.',true);
    showMessage('Microphone access blocked','The browser refused microphone access. A saved site block, device permission, or browser policy can prevent a permission prompt.\n\nAllow microphone access for this site in your browser\'s site settings.\n\nOn Android Chrome:\n1. Chrome → Settings → Site settings → Microphone: allow sites to ask, and allow this site if it is blocked.\n2. Android Settings → Apps → Chrome → Permissions → Microphone: allow access while using the app.\n3. Return to this page and tap Rx again.');
  }else if(error.name==='NotFoundError'||error.name==='OverconstrainedError')status('The selected microphone is unavailable. Choose Default audio input under Configure → Sound card → Devices and try Rx again.',true);
  else if(error.name==='NotReadableError')status('The microphone could not be opened. Check device access and other apps using it, then try Rx again.',true);
  else status(error.message,true);
}
async function context(){
  if(!audioSetup){audioContext=new AudioContext({latencyHint:'interactive'});audioSetup=audioContext.audioWorklet.addModule('./audio-worklet.js');}
  await audioSetup;
  if(audioContext.state==='suspended')await audioContext.resume();return audioContext;
}
function connectInput(input,isFile){
  const worklet=new AudioWorkletNode(audioContext,'fldigi-input',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1],processorOptions:{channel:settings.channel,active:isFile?activeInput==='file'&&!audio.paused&&!audio.seeking:true,generation:audioGeneration}});
  const gain=audioContext.createGain();gain.gain.value=isFile?settings.playbackVolume:0;
  input.connect(worklet);worklet.connect(gain);gain.connect(audioContext.destination);
  worklet.port.onmessage=({data})=>{
    if(data.generation!==audioGeneration||worklet!==(activeInput==='file'?fileWorklet:activeInput==='live'?liveWorklet:undefined))return;
    if(data.type==='flushed'){if(data.finished){postDecoder({type:'audio',samples:new Float32Array(audioContext.sampleRate*2),rate:audioContext.sampleRate});postDecoder({type:'flush'});}return;}
    if(!workerReady)return;let sum=0;const amp=Math.pow(10,settings.inputGain/20);
    for(let i=0;i<data.samples.length;i++){data.samples[i]*=amp;sum+=data.samples[i]**2;}
    $('input-level').value=Math.round(20*Math.log10(Math.sqrt(sum/data.samples.length)+1e-8));
    postDecoder({type:'audio',...data},[data.samples.buffer]);
  };
  return {worklet,gain};
}
function stopLive(){
  const wasCapturing=live||openingLive;sourceGeneration++;openingLive=false;
  if(wasCapturing)resetAudioPipeline('none');
  stream?.getTracks().forEach(track=>track.stop());stream=undefined;liveSource?.disconnect();liveWorklet?.disconnect();liveGain?.disconnect();liveSource=liveWorklet=liveGain=undefined;live=false;document.body.classList.remove('live');$('rx-button').setAttribute('aria-pressed','false');$('source-indicator').textContent=fileUrl?'FILE':'RX';
}
async function startLive(){
  if(live||openingLive){stopLive();status('Live audio stopped');return;}
  try{ensureReady();ensureMicrophoneAccess();}catch(error){status(error.message,true);return;}
  const generation=++sourceGeneration;openingLive=true;captureDeviceSelection=settings.inputDevice;
  try{
    resetAudioPipeline('none');if(fileUrl)closeFile();status('Waiting for microphone permission…');
    // Request capture directly from the user's tap, before asynchronous audio setup.
    let capture;
    try{capture=await navigator.mediaDevices.getUserMedia({audio:{deviceId:captureDeviceSelection==='default'?undefined:{exact:captureDeviceSelection},echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false});}
    catch(error){if(generation!==sourceGeneration)return;stopLive();reportMicrophoneError(error);return;}
    if(generation!==sourceGeneration){capture.getTracks().forEach(track=>track.stop());return;}
    stream=capture;await context();if(generation!==sourceGeneration)return;
    resetAudioPipeline('live');liveSource=audioContext.createMediaStreamSource(stream);({worklet:liveWorklet,gain:liveGain}=connectInput(liveSource,false));
    live=true;openingLive=false;document.body.classList.add('live');$('rx-button').setAttribute('aria-pressed','true');$('source-indicator').textContent='LIVE';
    const track=stream.getAudioTracks()[0];track.addEventListener('ended',()=>{if(stream===capture){stopLive();status('Audio input disconnected',true);}});
    const applied=track.getSettings();const processed=applied.echoCancellation||applied.noiseSuppression||applied.autoGainControl;
    status(`Live: ${track.label || 'Audio input'}${processed?' · Device speech processing is active':''}`);await refreshDevices();
  }catch(error){if(generation!==sourceGeneration)return;stopLive();status(error.message,true);}
}
async function loadFile(file){
  try{ensureReady();stopLive();resetAudioPipeline('none');audio.pause();if(fileUrl)URL.revokeObjectURL(fileUrl);fileUrl=URL.createObjectURL(file);audio.src=fileUrl;$('file-name').textContent=file.name;$('file-name').title=file.name;$('playback-bar').hidden=false;$('source-indicator').textContent='FILE';syncPlaybackButton();
    const selectedUrl=fileUrl;await context();if(fileUrl!==selectedUrl)return;if(!fileSource){fileSource=audioContext.createMediaElementSource(audio);({worklet:fileWorklet,gain:fileGain}=connectInput(fileSource,true));}if(audio.paused)status(`${file.name} · Press ▶ to play and decode`);}
  catch(error){status(error.message,true);}
}
async function togglePlayback(){
  if(!fileUrl||live||openingLive)return;
  const selectedUrl=fileUrl;
  try{ensureReady();await context();if(fileUrl!==selectedUrl||live||openingLive)return;if(audio.paused)await audio.play();else audio.pause();}
  catch(error){if(fileUrl===selectedUrl&&!live&&!openingLive)status(error.message,true);}
}
function closeFile(){
  if(activeInput==='file')resetAudioPipeline('none');
  const previousUrl=fileUrl;fileUrl=undefined;audio.pause();audio.removeAttribute('src');audio.load();if(previousUrl)URL.revokeObjectURL(previousUrl);
  $('playback-bar').hidden=true;$('file-name').textContent=$('file-name').title='';$('file-position').value=0;$('file-time').textContent='0:00 / 0:00';$('source-indicator').textContent=live?'LIVE':'RX';syncPlaybackButton();
}
function stopAudio(){stopLive();resetAudioPipeline('none');audio.pause();if(fileUrl&&audio.currentTime!==0)audio.currentTime=0;status('Audio stopped');}
function formatTime(seconds){if(!Number.isFinite(seconds))return '0:00';return Math.floor(seconds/60)+':'+String(Math.floor(seconds%60)).padStart(2,'0');}
function syncPlaybackButton(){const playing=!audio.paused&&!audio.ended;$('play-file').textContent=playing?'Ⅱ':'▶';$('play-file').setAttribute('aria-label',playing?'Pause playback':'Play audio file');$('play-file').title=playing?'Pause playback':'Play audio file';}
for(const eventName of ['play','pause','ended','emptied'])audio.addEventListener(eventName,syncPlaybackButton);
audio.addEventListener('play',()=>{if(!fileUrl||live||openingLive){audio.pause();return;}if(activeInput!=='file')resetAudioPipeline('file');fileWorklet?.port.postMessage({active:!audio.seeking,generation:audioGeneration});$('source-indicator').textContent='FILE';status('Playing and decoding: '+$('file-name').textContent);});
audio.addEventListener('pause',()=>{if(!audio.paused||activeInput!=='file'||audio.seeking)return;fileWorklet?.port.postMessage({command:'flush',generation:audioGeneration});if(fileUrl)status('Audio playback paused');});
audio.addEventListener('timeupdate',()=>{$('file-position').value=Number.isFinite(audio.duration)?audio.currentTime/audio.duration*1000:0;$('file-time').textContent=formatTime(audio.currentTime)+' / '+formatTime(audio.duration);});
audio.addEventListener('loadedmetadata',()=>{$('file-time').textContent='0:00 / '+formatTime(audio.duration);});
audio.addEventListener('seeking',()=>{if(activeInput==='file')resetAudioPipeline('file');});
audio.addEventListener('seeked',()=>{if(activeInput==='file')fileWorklet?.port.postMessage({active:!audio.paused,generation:audioGeneration});});
audio.addEventListener('ended',()=>{if(!audio.ended||activeInput!=='file')return;fileWorklet?.port.postMessage({command:'flush',finished:true,generation:audioGeneration});status('Playback complete: '+$('file-name').textContent);});
audio.addEventListener('error',()=>status('This audio file could not be played. Try a PCM WAV file or another browser-supported format.',true));
$('audio-upload').addEventListener('change',event=>{if(event.target.files[0])loadFile(event.target.files[0]);event.target.value='';});
$('play-file').addEventListener('click',togglePlayback);$('stop-file').addEventListener('click',stopAudio);
$('file-position').addEventListener('input',event=>{if(Number.isFinite(audio.duration))audio.currentTime=event.target.value/1000*audio.duration;});
function setSpeakerIcon(muted){
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('class','ui-icon icon-blue');svg.setAttribute('aria-hidden','true');
  const use=document.createElementNS('http://www.w3.org/2000/svg','use');use.setAttribute('href','icons/fontawesome.svg#'+(muted?'volume-xmark':'volume-high'));svg.append(use);$('file-mute').replaceChildren(svg);
}
$('file-mute').addEventListener('click',()=>{const muted=$('file-mute').getAttribute('aria-pressed')!=='true';$('file-mute').setAttribute('aria-pressed',String(muted));setSpeakerIcon(muted);if(fileGain)fileGain.gain.value=muted?0:settings.playbackVolume;});
$('close-file').addEventListener('click',()=>{closeFile();status(live?'Live audio capture active':'Receiver ready');});
$('rx-button').addEventListener('click',startLive);$('source-indicator').addEventListener('click',()=>fileUrl?togglePlayback():startLive());
function download(name,data,type){const url=URL.createObjectURL(new Blob([data],{type}));const link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);status('Download requested: '+name);}
function drawRaster(columns,height){
  const width=Math.max(1,Math.floor(rasterCanvas.clientWidth));const ctx=rasterCanvas.getContext('2d');
  if(rasterCanvas.width!==width||rasterCanvas.height<height*4){rasterCanvas.width=width;rasterCanvas.height=Math.max(height*4,rasterCanvas.clientHeight);ctx.fillStyle='#fff';ctx.fillRect(0,0,rasterCanvas.width,rasterCanvas.height);rasterX=rasterY=0;}
  for(let offset=0;offset+height<=columns.length;offset+=height){
    if(rasterX>=width){rasterX=0;rasterY+=height+4;if(rasterY+height>rasterCanvas.height){ctx.drawImage(rasterCanvas,0,-height-4);rasterY-=height+4;ctx.fillStyle='#fff';ctx.fillRect(0,rasterY,width,height+4);}}
    const image=ctx.createImageData(1,height);for(let y=0;y<height;y++){const i=y*4;image.data[i]=image.data[i+1]=image.data[i+2]=columns[offset+y];image.data[i+3]=255;}ctx.putImageData(image,rasterX++,rasterY);
  }
}
function drawPicture(data,show=true){
  const canvas=$('received-picture'),ctx=canvas.getContext('2d');
  const fresh=pictureSerial!==data.imageSerial;
  if(fresh||!pictureData||canvas.width!==data.imageWidth||canvas.height!==data.imageHeight){
    const previous=pictureData;canvas.width=data.imageWidth;canvas.height=data.imageHeight;pictureData=ctx.createImageData(canvas.width,canvas.height);pictureData.data.fill(255);
    if(!fresh&&previous)pictureData.data.set(previous.data.subarray(0,pictureData.data.length));pictureSerial=data.imageSerial;
  }
  for(let i=0;i<data.imageUpdates.length;i+=2){const index=data.imageUpdates[i];pictureData.data[Math.floor(index/3)*4+index%3]=data.imageUpdates[i+1];}
  ctx.putImageData(pictureData,0,0);$('picture-size').textContent=`${canvas.width} × ${canvas.height}`;
  if(show&&fresh&&!$('picture-dialog').open)$('picture-dialog').showModal();
}
$('save-picture').addEventListener('click',()=>{if(pictureData)$('received-picture').toBlob(blob=>blob&&download('fldigi-received.png',blob,'image/png'));});
document.querySelectorAll('[data-fax-action]').forEach(button=>button.addEventListener('click',()=>postDecoder({type:'fax-action',action:Number(button.dataset.faxAction)})));
function showMessage(title,text,downloadName){$('message-title').textContent=title;$('message-content').textContent=text;$('message-download').hidden=!downloadName;$('message-download').dataset.filename=downloadName||'';$('message-dialog').showModal();}
$('message-download').addEventListener('click',()=>download($('message-download').dataset.filename,$('message-content').textContent+'\n','text/plain;charset=utf-8'));
async function showAudioInfo(){
  await refreshDevices();const track=stream?.getAudioTracks()[0],actual=track?.getSettings();
  const inputs=devices.map((device,i)=>'• '+(device.label||`Audio input ${i+1} (name available after microphone permission)`)).join('\n')||'No audio inputs were enumerated.';
  showMessage('Audio device info',`Capture: ${live?'Active — '+(track?.label||'Microphone'):'Inactive'}\nInput channel: ${settings.channel}\nBrowser sample rate: ${audioContext?audioContext.sampleRate+' Hz':'Not initialized'}\nDecoder sample rate: ${latestRate} Hz\nReceive gain: ${settings.inputGain} dB\nSample-rate correction: ${settings.rxPpm} ppm${actual?'\nEcho cancellation: '+Boolean(actual.echoCancellation)+'\nNoise suppression: '+Boolean(actual.noiseSuppression)+'\nAutomatic gain control: '+Boolean(actual.autoGainControl):''}\n\nAvailable capture devices:\n${inputs}\n\nBrowser device information is shown here. Microphone permission is requested by RX capture (use mic).`);
}
async function showBuildInfo(){
  try{
    const response=await fetch(new URL('./build-info.json',import.meta.url));if(!response.ok)throw new Error('Build metadata is unavailable. Rebuild with scripts/build.py.');const info=await response.json();
    showMessage('Build info',`fldigi ${info.fldigiVersion} · Browser receive port\n${info.compiler}\n${info.optimization}\nBuilt: ${info.builtAt}\nEnabled receive modes: ${modes.filter(mode=>mode.enabled).length}\n\nOriginal source archive SHA-256:\n${info.sourceArchiveSha256}\n\nWASM SHA-256:\n${info.wasmSha256}\n\nAudio processing: Web Audio / AudioWorklet\nDecoder: original C++ compiled to WebAssembly\nIcons: original fldigi artwork and Font Awesome Free 7.2.0\nFrontend package dependencies: none`);
  }catch(error){showMessage('Build info',error.message);}
}
const actions={
  'show-picture':()=>pictureData?$('picture-dialog').showModal():status('No image has been received yet'),
  'open-audio':()=>$('audio-upload').click(),live:startLive,stop:stopAudio,
  'export-text':()=>download('fldigi-received.txt',$('rx-text').value,'text/plain;charset=utf-8'),clear:()=>{$('rx-text').value='';$('secondary-text').textContent='';},
  'import-config':()=>$('config-upload').click(),'export-config':()=>download('fldigi-configuration.json',JSON.stringify({format:'fldigi-web-configuration',version:1,settings},null,2)+'\n','application/json'),
  'toggle-browser':()=>{settings.showChannels=!settings.showChannels;applySettings();},'toggle-scope':()=>{settings.showScope=!settings.showScope;applySettings();},
  fullscreen:()=>document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen(),
  'clear-waterfall':()=>{historyContext.fillStyle='#000';historyContext.fillRect(0,0,history.width,history.height);drawWaterfall(false);},
  'clear-channels':()=>{postDecoder({type:'clear-channels'});channelRows.forEach(row=>{row.children[0].textContent=row.children[1].textContent='';});},
  'audio-info':showAudioInfo,'build-info':showBuildInfo,
  'event-log':()=>showMessage('Event log',eventLog.map(entry=>`${entry.time}  ${entry.error?'ERROR':'INFO'}  ${entry.message}`).join('\n')||'No events recorded in this session.','fldigi-event-log.txt'),
  help:()=>showMessage('fldigi browser receiver','Use File → Audio → Playback (load audio file) to select a recording, then press ▶. Choose RX capture (use mic), click Rx, or press F3 for live microphone or audio-device input. Starting mic capture closes the loaded recording; loading a recording stops mic capture. TX generate (save audio file) is disabled for now.\n\nSelect the signal mode under Op Mode, then click a signal in the waterfall to tune. AFC follows frequency drift. SQL suppresses output below the selected signal threshold.\n\nDTMF is at the bottom of Op Mode, below the separator. It exclusively decodes keypad tones using fixed audio frequencies; tuning is inactive. The squelch threshold always applies. Switching modes disables DTMF.\n\nConfigure → Sound card chooses the input channel, input device, gain, and sample-rate correction. Configuration is saved in this browser. File exports download a file; imports use a file picker.\n\nCapture requires HTTPS or localhost. Audio remains on this computer. Transmission, rig control, and external application connections are disabled. Decoder state resets when seeking in a recording.'),
  about:()=>showMessage('About fldigi','fldigi 4.2.13-alpha0 · Browser receive port\n\nOriginal fldigi modem and DSP sources by Dave Freese, W1HKJ, and the fldigi contributors. Compiled with Emscripten.\n\nGNU GPL version 3 or later. Corresponding source and build scripts are included in this project. See COPYING and THIRD_PARTY_NOTICES.md.\n\nThis version supports microphone input and local audio-file playback. Unavailable modes and desktop controls are shown disabled.\n\nIcons: original fldigi artwork and Font Awesome Free 7.2.0 by Fonticons, Inc. (CC BY 4.0). See THIRD_PARTY_NOTICES.md and icons/fontawesome/LICENSE.txt for the icon notices.'),
};
document.querySelectorAll('[data-action]').forEach(button=>button.addEventListener('click',()=>{closeMenus();actions[button.dataset.action]?.();}));
document.querySelectorAll('[data-close-dialog]').forEach(button=>button.addEventListener('click',()=>$(button.dataset.closeDialog).close()));
$('config-upload').addEventListener('change',async event=>{try{const file=event.target.files[0];if(!file)return;const input=JSON.parse(await file.text());if(input.format!=='fldigi-web-configuration'||input.version!==1)throw new Error('This is not a fldigi browser configuration file.');settings=validatedConfig(input.settings);applySettings();configureDecoder(true);status('Configuration imported');}catch(error){showMessage('Import configuration',error.message);}finally{event.target.value='';}});
for(const key of ['frequency','frequency-top']){
  const commit=event=>{if(event.target.value!==''&&Number(event.target.value)!==settings.frequency)tune(event.target.value);};
  $(key).addEventListener('change',commit);$(key).addEventListener('blur',commit);
  $(key).addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();commit(event);}});
}
for(const key of ['reference','span'])$(key).addEventListener('change',event=>{settings=validatedConfig({...settings,[key]:Number(event.target.value)});applySettings();});
$('squelch-slider').addEventListener('input',event=>setSquelch(event.target.value));
$('squelch-slider').addEventListener('wheel',event=>{event.preventDefault();const delta=event.deltaY||event.deltaX;if(delta)setSquelch(settings.squelch-Math.sign(delta)*(event.shiftKey?10:1));},{passive:false});
for(const eventName of ['change','blur'])$('squelch').addEventListener(eventName,event=>{if(event.target.value!=='')setSquelch(event.target.value);});
$('squelch').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();if(event.target.value!=='')setSquelch(event.target.value);}});
document.querySelectorAll('[data-adjust]').forEach(button=>button.addEventListener('click',()=>{const [key,amount]=button.dataset.adjust.split(':');settings=validatedConfig({...settings,[key]:settings[key]+Number(amount)});applySettings();}));
document.querySelectorAll('[data-tune]').forEach(button=>button.addEventListener('click',()=>tune(settings.frequency+Number(button.dataset.tune))));
for(const key of ['afc','sql','reverse'])$(key).addEventListener('click',()=>{settings[key]=!settings[key];applySettings();});
$('sideband').addEventListener('change',event=>{settings.sideband=event.target.value;applySettings();});
$('channel-squelch').addEventListener('input',event=>{settings=validatedConfig({...settings,channelSquelch:Number(event.target.value)});$('channel-squelch-label').textContent=settings.channelSquelch.toFixed(1);configureDecoder();saveSettings();});
$('channel-search').addEventListener('keydown',event=>{if(event.key==='Enter'){const row=channelRows.find(r=>r.children[1].textContent.toUpperCase().includes(event.target.value.toUpperCase())&&r.dataset.frequency);if(row)tune(row.dataset.frequency);}});
$('current-mode').addEventListener('click',()=>{closeMenus();$('mode-menu').classList.add('open');$('mode-menu').querySelector('.menu-heading').setAttribute('aria-expanded','true');});
$('store-frequency').addEventListener('click',()=>{saveSettings();status('Receive frequency stored: '+Math.round(settings.frequency)+' Hz');});
$('magnification').addEventListener('click',()=>{settings.magnification=settings.magnification===4?1:settings.magnification*2;applySettings();});
$('waterfall-speed').addEventListener('click',()=>{settings.speed=settings.speed==='NORM'?'FAST':settings.speed==='FAST'?'SLOW':'NORM';applySettings();});
$('waterfall-pause').addEventListener('click',()=>{waterfallPaused=!waterfallPaused;$('waterfall-pause').setAttribute('aria-pressed',String(waterfallPaused));$('waterfall-pause').textContent=waterfallPaused?'▶':'Ⅱ';});
$('display-mode').addEventListener('click',()=>{displayMode=displayMode==='WF'?'FFT':'WF';$('display-mode').textContent=displayMode;drawWaterfall(false);});
function viewStart(){return waterfallOffset;}
function updateTuningCursor(){drawTuningMarkers();$('qso-frequency').value=(14070.100+settings.frequency/1000).toFixed(3);drawFrequencyScale();}
function svgElement(tag,attributes){const element=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [key,value]of Object.entries(attributes))element.setAttribute(key,String(value));return element;}
function markerPositions(frequency){return snapMarkerPositions(positionMarkers(latestGeometry,frequency,viewStart(),4000/settings.magnification,$('waterfall').clientWidth));}
function addVerticalTracks(group,positions,color,wide=false){for(const x of positions)group.append(svgElement('rect',{'data-role':'track-edge',x:x-(wide?1.5:.5),y:WATERFALL_TOP,width:wide?3:1,height:Math.max(0,$('waterfall').clientHeight-WATERFALL_TOP),fill:color}));}
function drawTuningMarkers(){
  const overlay=$('tuning-cursor'),width=$('waterfall').clientWidth,height=$('waterfall').clientHeight,positions=markerPositions(settings.frequency);
  overlay.setAttribute('viewBox',`0 0 ${width} ${height}`);
  overlay.replaceChildren(svgElement('rect',{x:0,y:SCALE_HEIGHT,width,height:MARKER_HEIGHT,fill:'#000'}),svgElement('rect',{x:0,y:SCALE_HEIGHT,width,height:1,fill:'#e0e0e0'}),svgElement('rect',{x:0,y:WATERFALL_TOP-1,width,height:1,fill:'#e0e0e0'}));
  const receive=svgElement('g',{id:'receive-tracks','data-frequency':settings.frequency,'data-center-x':positions.center});
  for(const [low,high]of positions.bands)receive.append(svgElement('rect',{'data-role':'bandwidth',x:low-.5,y:SCALE_HEIGHT+1,width:Math.max(1,high-low+1),height:MARKER_HEIGHT-2,fill:'#ff0000'}));
  if(settings.useBWTracks)addVerticalTracks(receive,positions.tracks,'#ff0000',settings.useWideTracks);
  if(!dtmfSelected())overlay.append(receive);
  overlay.append(svgElement('g',{id:'hover-cursor'}));drawHoverPreview();
}
function frequencyAtPointer(event){const bounds=$('waterfall').getBoundingClientRect();return pointerFrequency(event.clientX-bounds.left,bounds.width,viewStart(),4000/settings.magnification,latestBandwidth,settings.lowCutoff,settings.highCutoff);}
function drawHoverPreview(){
  const preview=$('hover-cursor');if(!preview)return;preview.replaceChildren();
  preview.removeAttribute('data-frequency');preview.removeAttribute('data-center-x');
  if(dtmfSelected()||!hoverPointer)return;
  const bounds=$('waterfall').getBoundingClientRect();
  if(hoverPointer.clientY<bounds.top+SCALE_HEIGHT||hoverPointer.clientY>=bounds.bottom||hoverPointer.clientX<bounds.left||hoverPointer.clientX>=bounds.right)return;
  const frequency=frequencyAtPointer(hoverPointer),positions=markerPositions(frequency);
  preview.setAttribute('data-frequency',frequency);preview.setAttribute('data-center-x',positions.center);
  // Native hover marker: yellow tips and a white center triangle in the bar;
  // white edge/center tracks over the color waterfall (ui_colors.cxx).
  for(const x of positions.markerEdges)preview.append(svgElement('path',{d:`M ${x} ${SCALE_HEIGHT+1} L ${x-4} ${WATERFALL_TOP-1} L ${x+4} ${WATERFALL_TOP-1} Z`,fill:'#ffff00'}));
  preview.append(svgElement('path',{d:`M ${positions.center} ${SCALE_HEIGHT+1} L ${positions.center-4} ${WATERFALL_TOP-1} L ${positions.center+4} ${WATERFALL_TOP-1} Z`,fill:'#ffffff'}));
  if(settings.useCursorLines)addVerticalTracks(preview,positions.hover,'#ffffff',settings.useWideCursor);
  if(settings.useCursorCenterLine)addVerticalTracks(preview,[positions.center],'#ffffff',settings.useWideCenter);
}
function clearHoverPreview(){hoverPointer=undefined;clearTimeout(cursorHideTimer);$('waterfall').style.cursor=dtmfSelected()?'default':'';drawHoverPreview();}
$('waterfall').addEventListener('pointermove',event=>{
  if(dtmfSelected()||event.pointerType==='touch')return;
  hoverPointer={clientX:event.clientX,clientY:event.clientY};clearTimeout(cursorHideTimer);$('waterfall').style.cursor='';drawHoverPreview();
  if(event.clientY>=$('waterfall').getBoundingClientRect().top+SCALE_HEIGHT)cursorHideTimer=setTimeout(()=>{$('waterfall').style.cursor='none';},1000);
});
$('waterfall').addEventListener('pointerleave',clearHoverPreview);
$('waterfall').addEventListener('pointercancel',clearHoverPreview);
window.addEventListener('blur',clearHoverPreview);
$('waterfall').addEventListener('pointerdown',event=>{if(event.button!==0||event.clientY<$('waterfall').getBoundingClientRect().top+WATERFALL_TOP)return;tune(frequencyAtPointer(event));});
function resizeCanvases(){const canvas=$('waterfall'),width=Math.max(1,Math.floor(canvas.clientWidth)),height=Math.max(1,Math.floor(canvas.clientHeight));if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}if(history.width!==4000||history.height!==Math.max(1,height-WATERFALL_TOP)){history.width=4000;history.height=Math.max(1,height-WATERFALL_TOP);historyContext.fillStyle='#000';historyContext.fillRect(0,0,history.width,history.height);}$('frequency-scale').width=width;$('frequency-scale').height=SCALE_HEIGHT;const scope=$('scope');scope.width=Math.max(1,scope.clientWidth);scope.height=Math.max(1,scope.clientHeight);drawFrequencyScale();drawWaterfall(false);drawTuningMarkers();drawScope();}
function drawFrequencyScale(){const canvas=$('frequency-scale'),ctx=canvas.getContext('2d'),width=canvas.width,start=viewStart(),range=4000/settings.magnification;ctx.fillStyle='#000';ctx.fillRect(0,0,width,23);ctx.strokeStyle='#bbb';ctx.fillStyle='#eee';ctx.font='12px Arial';ctx.textAlign='center';ctx.beginPath();for(let hz=Math.ceil(start/100)*100;hz<start+range;hz+=100){const x=(hz-start)/range*width;ctx.moveTo(x,22);ctx.lineTo(x,hz%500===0?14:18);if(hz%500===0&&hz>start+40)ctx.fillText(hz,x,11);}ctx.stroke();}
function palette(value){if(value<.07)return [0,0,0];if(value<.32)return [0,0,Math.round((value-.07)/.25*255)];if(value<.52)return [0,Math.round((value-.32)/.2*255),255];if(value<.65)return [0,255,Math.round((.65-value)/.13*255)];if(value<.82)return [Math.round((value-.65)/.17*255),255,0];if(value<.94)return [255,Math.round((.94-value)/.12*255),0];return [255,255,255];}
function drawWaterfall(add=true){
  const canvas=$('waterfall'),ctx=waterfallContext,width=canvas.width,height=history.height,start=viewStart(),range=4000/settings.magnification;
  ctx.fillStyle='#000';ctx.fillRect(0,0,canvas.width,canvas.height);
  // Retain the full audio passband, as fldigi does, so zooming rescales the
  // existing signal history together with the scale and bandwidth markers.
  if(latestSpectrum&&add&&!waterfallPaused){waterfallRows++;if(settings.speed!=='SLOW'||waterfallRows%4===0){
    const rowHeight=settings.speed==='FAST'?2:1;historyContext.drawImage(history,0,rowHeight);
    const row=historyContext.createImageData(history.width,rowHeight);
    for(let x=0;x<history.width;x++){const bin=Math.min(4095,Math.round(x*8192/latestRate));const rgb=palette(Math.max(0,Math.min(1,(latestSpectrum[bin]-settings.reference+settings.span)/settings.span)));for(let y=0;y<rowHeight;y++){const i=(y*history.width+x)*4;row.data.set([...rgb,255],i);}}
    historyContext.putImageData(row,0,0);
  }}
  if(displayMode==='WF'){ctx.imageSmoothingEnabled=false;ctx.drawImage(history,start,0,range,height,0,WATERFALL_TOP,width,height);}
  else if(latestSpectrum){ctx.strokeStyle='#0f0';ctx.beginPath();for(let x=0;x<width;x++){const bin=Math.min(4095,Math.round((start+x/width*range)*8192/latestRate));const value=Math.max(0,Math.min(1,(latestSpectrum[bin]-settings.reference+settings.span)/settings.span));const y=WATERFALL_TOP+(1-value)*height;if(x)ctx.lineTo(x,y);else ctx.moveTo(x,y);}ctx.stroke();}
}
function drawScope(){scopeDisplay.draw();}
new ResizeObserver(resizeCanvases).observe($('waterfall').parentElement);
async function refreshDevices(){try{devices=(await navigator.mediaDevices.enumerateDevices()).filter(device=>device.kind==='audioinput');if($('configuration').open&&configPage==='Soundcard/Devices')renderConfigPage();}catch{devices=[];}}
const configSections=[['Configure'],['Colors-Fonts'],['Contests',true],['IDs',true],['Logging',true],['Modem'],['Modem/PSK'],['Modem/RTTY'],['Modem/CW'],['Modem/MFSK'],['Modem/THOR'],['Modem/DominoEX'],['Modem/Throb'],['Modem/MT63'],['Modem/FSQ'],['Modem/Hellschreiber'],['Modem/IFKP'],['Modem/WEFAX'],['Modem/Olivia'],['Modem/Contestia'],['Misc'],['Operator-Station'],['Rig Control',true],['Soundcard'],['Soundcard/Devices'],['Soundcard/Right channel'],['Soundcard/Settings'],['Soundcard/Signal Level'],['Soundcard/Wav file recording',true],['UI'],['Waterfall'],['Web',true],['Autostart',true],['IO',true]];
const collapsedSections=new Set();
const treeGroups=['Modem','Soundcard'];
function renderTree(){
  const tree=$('config-tree');tree.replaceChildren();
  function addSection(container,name,disabled,children=[]){
    const row=document.createElement('div');row.className='tree-row';
    if(children.length){
      const toggle=document.createElement('button');toggle.id=controlId('config-expand',name);toggle.className='tree-toggle';toggle.dataset.section=name;toggle.textContent=collapsedSections.has(name)?'⊞':'⊟';toggle.setAttribute('aria-label',`${collapsedSections.has(name)?'Expand':'Collapse'} ${name}`);toggle.setAttribute('aria-expanded',String(!collapsedSections.has(name)));toggle.disabled=Boolean(disabled);
      toggle.addEventListener('click',()=>{if(collapsedSections.has(name))collapsedSections.delete(name);else collapsedSections.add(name);renderTree();Array.from(tree.querySelectorAll('.tree-toggle')).find(button=>button.dataset.section===name)?.focus();});row.append(toggle);
    }else{const connector=document.createElement('span');connector.className='tree-connector';connector.textContent='┊';connector.setAttribute('aria-hidden','true');row.append(connector);}
    const button=document.createElement('button');button.id=controlId('config-page',name);button.textContent=name.split('/').at(-1);button.className='tree-label';button.disabled=Boolean(disabled);button.classList.toggle('active',name===configPage);button.dataset.page=name;
    button.addEventListener('click',()=>{configPage=name==='Configure'?'Operator-Station':name==='Soundcard'?'Soundcard/Devices':name==='Modem'?'Modem/PSK':name;renderTree();renderConfigPage();});row.append(button);container.append(row);
    if(children.length){const group=document.createElement('div');group.className='tree-children';group.hidden=collapsedSections.has(name);group.setAttribute('role','group');group.setAttribute('aria-label',name+' sections');for(const [child,unavailable]of children)addSection(group,child,unavailable,configSections.filter(([section])=>section.startsWith(child+'/')));container.append(group);}
  }
  addSection(tree,'Configure',false,configSections.filter(([name])=>name!=='Configure'&&!name.includes('/')));
  $('collapse-tree').textContent=collapsedSections.has('Configure')||treeGroups.every(name=>collapsedSections.has(name))?'Expand Tree':'Collapse Tree';
}
function configField(label,key,type='text',options,disabled=false){
  const row=document.createElement('div');row.className='config-row';const caption=document.createElement('label');caption.textContent=label;caption.htmlFor='config-'+key;row.append(caption);let input;
  if(options){input=document.createElement('select');for(const [value,label]of options){const option=document.createElement('option');option.value=value;option.textContent=label;input.append(option);}}
  else{input=document.createElement('input');input.type=type;}
  input.id='config-'+key;input.disabled=disabled;row.classList.toggle('unavailable',disabled);if(type==='checkbox')input.checked=Boolean(configDraft[key]);else input.value=configDraft[key]??'';
  const bounds={channelSquelch:[-3,6,.1],rttyCustomShift:[1,2000,1],pskSearchRange:[10,500,10],dominoBandwidth:[1,2,.1],fsqMovingAverage:[1,15,1],fsqPeakHits:[3,6,1],wfLatency:[1,16,1],playbackVolume:[0,1,.05]}[key];
  if(type==='number'){input.step='any';if(bounds)[input.min,input.max,input.step]=bounds.map(String);}
  const readValue=()=>{configDraft[key]=type==='checkbox'?input.checked:typeof defaults[key]==='number'?Number(input.value):input.value;};input.addEventListener('input',readValue);input.addEventListener('change',readValue);row.append(input);return row;
}
function fieldset(title,rows){const fieldset=document.createElement('fieldset');const legend=document.createElement('legend');legend.textContent=title;fieldset.append(legend,...rows);return fieldset;}
function note(text){const node=document.createElement('p');node.className='config-note';node.textContent=text;return node;}
function renderConfigPage(){
  $('config-caption').textContent=configPage;const body=$('config-fields');body.replaceChildren();
  if(configPage==='Operator-Station'){body.append(fieldset('Operator information',[configField('Callsign','callsign','text',null,true),configField('Name','operatorName','text',null,true),configField('QTH','qth','text',null,true),configField('Locator','locator','text',null,true),note('Station details are unused while logging, transmission, and directed replies are disabled.')]));}
  else if(configPage==='Soundcard/Devices'){
    const selected=devices.some(d=>d.deviceId===configDraft.inputDevice)||configDraft.inputDevice==='default'?[]:[[configDraft.inputDevice,'Saved input (currently unavailable)']];
    body.append(fieldset('Audio input',[configField('Capture','inputDevice','text',[['default','Default audio input'],...selected,...devices.filter(d=>d.deviceId!=='default').map((d,i)=>[d.deviceId,d.label||'Audio input '+(i+1)])]),note('Microphone permission is requested when live capture starts. Saving a different device restarts active capture.'),...(live?[note('Active input: '+(stream?.getAudioTracks()[0]?.label||'Audio input'))]:[])]));
    const unsupported=fieldset('Desktop audio backends',[configField('OSS','oss','checkbox',null,true),configField('PortAudio','portaudio','checkbox',null,true),configField('PulseAudio','pulseaudio','checkbox',null,true)]);body.append(unsupported);
    const refresh=document.createElement('button');refresh.id='refresh-audio-devices';refresh.textContent='Refresh devices';refresh.addEventListener('click',refreshDevices);body.append(refresh,note('Browser audio is processed locally by the fldigi receiver.'));
  }else if(configPage==='Soundcard/Right channel'){body.append(fieldset('Receive channel',[configField('Signal channel','channel','text',[['left','Left channel'],['right','Right channel'],['mix','Mix both channels']])]));}
  else if(configPage==='Soundcard/Settings'){body.append(fieldset('Sample rate',[configField('Capture','captureRate','text',[['native','Native']],true),configField('Playback','playbackRate','text',[['native','Native']],true),note('Band-limited converter → original modem sample rate')]));body.append(fieldset('Corrections',[configField('RX ppm','rxPpm','number'),configField('TX ppm','txPpm','number',null,true),configField('TX offset','txOffset','number',null,true)]));}
  else if(configPage==='Soundcard/Signal Level'){body.append(fieldset('Signal level',[configField('Receive gain (dB)','inputGain','number'),configField('Playback volume','playbackVolume','number'),note('Receive gain affects decoding. Playback volume affects the speakers.')]));}
  else if(configPage==='Waterfall'){
    body.append(fieldset('Display',[configField('Reference level','reference','number'),configField('Amplitude span','span','number'),configField('Magnification','magnification','number'),configField('Speed','speed','text',[['FAST','FAST'],['NORM','NORM'],['SLOW','SLOW']]),configField('Docked scope','showScope','checkbox')]));
    body.append(fieldset('Cursor',[configField('Cursor lines','useCursorLines','checkbox'),configField('Center line','useCursorCenterLine','checkbox'),configField('Wide cursor','useWideCursor','checkbox'),configField('Wide center line','useWideCenter','checkbox')]));
    body.append(fieldset('Bandwidth tracks',[configField('Show tracks','useBWTracks','checkbox'),configField('Wide tracks','useWideTracks','checkbox')]));
    body.append(fieldset('FFT',[configField('Window','wfWindow','text',[[0,'Rectangular'],[1,'Blackman'],[2,'Hamming'],[3,'Hann'],[4,'Triangular']]),configField('Latency','wfLatency','number')]));
  }
  else if(configPage==='UI'||configPage==='Colors-Fonts'){body.append(fieldset('Receive / transmit text',[configField('Font','rxFont','text',[['Courier New','Courier New'],['monospace','Monospace'],['Consolas','Consolas']]),configField('Font size','rxFontSize','number'),configField('Receive color','rxColor','color'),configField('Transmit color','txColor','color',null,true),configField('Word wrap','rxWrap','checkbox'),configField('Show channels','showChannels','checkbox')]));}
  else if(configPage==='Modem/RTTY'){body.append(fieldset('Receive',[configField('Shift (Hz)','rttyShift','text',[...([23,85,160,170,182,200,240,350,425,850].map((v,i)=>[i,v])),[10,'Custom']]),configField('Custom shift (Hz)','rttyCustomShift','number'),configField('Baud','rttyBaud','text',[45,45.45,50,56,75,100,110,150,200,300].map((v,i)=>[i,v])),configField('Data bits','rttyBits','text',[[0,'5 (Baudot)'],[1,'7 (ASCII)'],[2,'8 (ASCII)']]),configField('Parity','rttyParity','text',[[0,'None'],[1,'Even'],[2,'Odd'],[3,'Zero'],[4,'One']]),configField('Stop bits','rttyStop','text',[[0,'1'],[1,'1.5'],[2,'2']]),configField('AFC speed','rttyAfcSpeed','text',[[0,'Slow'],[1,'Medium'],[2,'Fast']]),configField('Lower case','lowercase','checkbox'),configField('Reverse','reverse','checkbox')]));body.append(fieldset('Transmit',[configField('FSK keying','useFSK','checkbox',null,true)]));}
  else if(configPage==='Modem/CW'){body.append(fieldset('Receive',[configField('Tracking','cwTrack','checkbox'),configField('Tracking range','cwRange','number'),configField('Minimum WPM','cwMin','number'),configField('Maximum WPM','cwMax','number'),configField('Matched filter','cwMatched','checkbox'),configField('SOM decoding','cwSom','checkbox')]));body.append(fieldset('Filter',[configField('Bandwidth (Hz)','cwBandwidth','number'),configField('Filter length','cwFilter','text',[[0,'128'],[1,'256'],[2,'512']]),configField('Reference WPM','cwSpeed','number')]));body.append(fieldset('Transmit',[configField('QSK','qsk','checkbox',null,true),configField('Keying','keying','text',null,true)]));}
  else if(configPage==='Modem/Hellschreiber'){body.append(fieldset('Receive',[configField('AGC','hellAgc','text',[[1,'Slow'],[2,'Medium'],[3,'Fast']]),configField('Receive width','hellWidth','number'),configField('Receive height','hellHeight','number'),configField('Bandwidth (Hz)','hellBandwidth','number'),configField('Blackboard','hellBlackboard','checkbox')]));}
  else if(configPage==='Modem/IFKP'){body.append(fieldset('Receive',[configField('Speed','ifkpBaud','text',[[0,'0.5'],[1,'1.0'],[2,'2.0']])]));body.append(fieldset('Transmit',[configField('MYCALL lower case','ifkpLowercase','checkbox',null,true)]));}
  else if(configPage==='Modem/PSK'){body.append(fieldset('Receive',[configField('AFC','afc','checkbox'),configField('Search range (Hz)','pskSearchRange','number'),configField('Squelch','sql','checkbox'),configField('Squelch level','squelch','number')]));}
  else if(configPage==='Modem/MT63'){body.append(fieldset('Receive',[configField('Long integration','mt63Integration','checkbox'),configField('8-bit characters (UTF-8)','mt638bit','checkbox')]));}
  else if(configPage==='Modem/DominoEX'){body.append(fieldset('Receive',[configField('FEC','dominoFec','checkbox'),configField('Filtering','dominoFilter','checkbox'),configField('Filter bandwidth factor','dominoBandwidth','number')]));}
  else if(configPage==='Modem/FSQ'){body.append(fieldset('Receive',[configField('Speed (baud)','fsqBaud','text',[1.5,2,3,4.5,6].map(v=>[v,v])),configField('FFT moving average','fsqMovingAverage','number'),configField('Minimum detector hits','fsqPeakHits','number')]));body.append(fieldset('Transmit',[configField('MYCALL lower case','fsqLowercase','checkbox',null,true)]),note('Directed commands, automatic replies, and external logging remain disabled.'));}
  else if(configPage==='Modem/Throb'){body.append(fieldset('Receive',[configField('Lower case','lowercase','checkbox')]));}
  else if(configPage==='Modem/WEFAX'){body.append(fieldset('Receive',[configField('Lines per minute','wefaxLpm','text',[[0,'240'],[1,'120'],[2,'90'],[3,'60']]),note('View → Received picture opens the image. Skip APT / Skip phasing starts reception for recordings without a start sequence. Save downloads a PNG.')]));}
  else if(configPage==='Modem/Olivia'||configPage==='Modem/Contestia'){const prefix=configPage==='Modem/Olivia'?'olivia':'contestia';body.append(fieldset('Receive',[configField('Bandwidth (Hz)',prefix+'Bandwidth','text',[125,250,500,1000,2000].map((v,i)=>[i,v])),configField('Tones',prefix+'Tones','text',[2,4,8,16,32,64].map((v,i)=>[i,v])),configField('Integration',prefix+'Integration','number'),configField('Search margin',prefix+'Margin','number'),...(prefix==='contestia'?[configField('Lower case','lowercase','checkbox')]:[])]));body.append(note('Bandwidth and tones configure the generic mode. Named variants in Op Mode retain their original settings.'));}
  else if(configPage.startsWith('Modem/')){body.append(fieldset('Receive',[configField('AFC','afc','checkbox'),configField('Squelch','sql','checkbox'),configField('Squelch level','squelch','number')]));body.append(note('Select a tone count and bandwidth variant under Op Mode. Additional desktop receive options are not yet exposed for this page.'));}
  else if(configPage==='Misc'){body.append(fieldset('Receive',[configField('Lower case','lowercase','checkbox'),configField('Channel squelch','channelSquelch','number'),note('Lower case applies to RTTY, Throb, and Contestia.')]));}
}
function openConfig(page){closeMenus();configDraft={...settings};configPage=page||'Soundcard/Devices';collapsedSections.delete('Configure');collapsedSections.delete(configPage.split('/')[0]);renderTree();renderConfigPage();$('configuration').showModal();refreshDevices();}
document.querySelectorAll('[data-config]').forEach(button=>button.addEventListener('click',()=>openConfig(button.dataset.config)));
$('restore-defaults').addEventListener('click',()=>{configDraft={...defaults};renderConfigPage();});
$('save-config').addEventListener('click',()=>{for(const input of $('config-fields').querySelectorAll('input:not(:disabled),select:not(:disabled)')){const key=input.id.slice(7);if(Object.hasOwn(defaults,key))configDraft[key]=input.type==='checkbox'?input.checked:typeof defaults[key]==='number'?Number(input.value):input.value;}settings=validatedConfig(configDraft);applySettings();configDraft={...settings};status('Configuration saved');});
$('collapse-tree').addEventListener('click',()=>{const expand=collapsedSections.has('Configure')||treeGroups.every(name=>collapsedSections.has(name));collapsedSections.delete('Configure');for(const name of treeGroups)if(expand)collapsedSections.delete(name);else collapsedSections.add(name);renderTree();});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'){closeMenus();return;}
  if(event.key.toLowerCase()==='a'&&!event.ctrlKey&&!event.altKey&&!event.metaKey&&!event.target.matches('input,textarea,select')&&!document.querySelector('dialog[open]')){event.preventDefault();closeMenus();actions.about();return;}
  if(event.key==='F3'){event.preventDefault();startLive();}
  if(event.ctrlKey&&event.key.toLowerCase()==='o'){event.preventDefault();$('audio-upload').click();}
  if(event.ctrlKey&&event.key.toLowerCase()==='s'){event.preventDefault();actions['export-text']();}
  if(event.altKey&&event.key.toLowerCase()==='c'){event.preventDefault();openConfig();}
  if(event.code==='Space'&&!event.target.matches('input,textarea,select,button')&&!$('configuration').open&&fileUrl){event.preventDefault();togglePlayback();}
});
window.addEventListener('beforeunload',()=>{stream?.getTracks().forEach(track=>track.stop());if(fileUrl)URL.revokeObjectURL(fileUrl);});
applySettings(false);
