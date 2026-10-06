import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {defaults} from '../web/configuration.js';

const app=fs.readFileSync(new URL('../web/app.js',import.meta.url),'utf8');
const between=(start,end)=>app.slice(app.indexOf(start),app.indexOf(end));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const settle=()=>new Promise(resolve=>setImmediate(resolve));

// Execute the real source-selection functions and event handlers. Only browser
// APIs are mocked, including permission requests and suspended audio contexts.
function receiver(workflow='decode'){
  class Element {
    constructor(){this.listeners={};this.attributes={};this.hidden=false;this.textContent='';this.value=0;this.clickCalls=0;}
    addEventListener(name,fn){(this.listeners[name]??=[]).push(fn);}
    dispatch(name){for(const fn of this.listeners[name]??=[])fn({target:this});}
    setAttribute(name,value){this.attributes[name]=value;}
    getAttribute(name){return this.attributes[name];}
    click(){this.clickCalls++;this.dispatch('click');}
  }
  const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  const audio=new Element();audio.paused=true;audio.ended=false;audio.seeking=false;audio.duration=NaN;audio.currentTime=0;audio.playCalls=0;
  audio.play=async()=>{audio.playCalls++;audio.paused=false;audio.dispatch('play');};
  audio.pause=()=>{audio.paused=true;};
  audio.removeAttribute=name=>{delete audio[name];};
  audio.load=()=>{audio.paused=true;audio.duration=NaN;audio.currentTime=0;};
  const permission=deferred(),revoked=[],reports=[],messages=[],dialogs=[],requests=[],bodyClasses=new Set(),keyboardListeners={};let urlSerial=0,mediaSources=0;
  class Node {
    constructor(){this.port={postMessage:data=>reports.push(data)};this.gain={value:0};}
    connect(){}
    disconnect(){this.disconnected=true;}
  }
  class AudioContext {
    constructor(){this.state='running';this.sampleRate=48000;this.audioWorklet={addModule:()=>sandbox.setupGate?.promise??Promise.resolve()};}
    resume(){this.state='running';return this.resumeGate?.promise??Promise.resolve();}
    createGain(){return new Node();}
    createMediaElementSource(){assert.equal(++mediaSources,1,'reuse the existing MediaElementAudioSourceNode');return new Node();}
    createMediaStreamSource(){return new Node();}
  }
  const track={stopped:false,label:'Test microphone',stop(){this.stopped=true;},addEventListener(){},getSettings(){return {};}};
  const capture={getTracks:()=>[track],getAudioTracks:()=>[track]};
  const sandbox={
    $:get,audio,settings:{...defaults},decodeEnabled:workflow!=='encode',encodeEnabled:workflow!=='decode',workerReady:true,live:false,openingLive:false,sourceGeneration:0,audioGeneration:0,activeInput:'none',fileUrl:undefined,
    stream:undefined,liveSource:undefined,liveWorklet:undefined,liveGain:undefined,fileSource:undefined,fileWorklet:undefined,fileGain:undefined,
    audioContext:undefined,audioSetup:undefined,captureDeviceSelection:undefined,latestSpectrum:undefined,
    AudioContext,AudioWorkletNode:Node,Float32Array,scopeDisplay:{reset(){}},worker:{postMessage:data=>reports.push(data)},
    window:{isSecureContext:true},navigator:{mediaDevices:{getUserMedia:constraints=>{requests.push(constraints);return permission.promise;}}},
    document:{body:{classList:{add:name=>bodyClasses.add(name),remove:name=>bodyClasses.delete(name)}},
      addEventListener:(name,handler)=>keyboardListeners[name]=handler,querySelector:()=>null},
    URL:{createObjectURL:()=>`blob:test-${++urlSerial}`,revokeObjectURL:url=>revoked.push(url)},
    status:(message,error=false)=>messages.push({message,error}),showMessage:(title,message)=>dialogs.push({title,message}),refreshDevices:async()=>{},
    actions:{'export-text':()=>reports.push('export-text')},closeMenus(){},openConfig(){},
  };
  const api=vm.runInNewContext([
    between('function postDecoder(','function configureDecoder('),
    between('function configureDecoder(','function syncFrequencyInputs('),
    between('function ensureReady(){','function download('),
    '({startLive,stopLive,loadFile,togglePlayback,closeFile,postDecoder,configureDecoder,generateAudio})',
  ].join('\n'),sandbox);
  vm.runInNewContext(between("document.addEventListener('keydown',event=>{","window.addEventListener('beforeunload'"),sandbox);
  return {...api,state:sandbox,get,audio,permission,capture,track,revoked,reports,messages,dialogs,requests,bodyClasses,keydown:keyboardListeners.keydown};
}

// Switching a playing recording to mic removes the file before permission is
// granted. Queued playback clicks/events cannot stop or replace mic capture.
{
  const rx=receiver();await rx.loadFile({name:'first.wav'});await rx.togglePlayback();
  const oldUrl=rx.state.fileUrl,oldWorklet=rx.state.fileWorklet;
  assert.equal(rx.state.activeInput,'file');
  const pending=rx.startLive();
  assert.equal(rx.state.fileUrl,undefined);assert.ok(rx.audio.paused);assert.equal(rx.audio.src,undefined);
  assert.equal(rx.get('playback-bar').hidden,true);assert.equal(rx.get('file-name').textContent,'');
  assert.equal(rx.get('file-position').value,0);assert.equal(rx.get('file-time').textContent,'0:00 / 0:00');
  assert.deepEqual(rx.revoked,[oldUrl]);
  await rx.togglePlayback();assert.ok(rx.state.openingLive);assert.equal(rx.audio.playCalls,1);
  rx.audio.dispatch('play');assert.equal(rx.state.activeInput,'none');
  await settle();rx.permission.resolve(rx.capture);await pending;
  assert.ok(rx.state.live);assert.equal(rx.state.activeInput,'live');assert.equal(rx.get('source-indicator').textContent,'LIVE');
  const generation=rx.state.audioGeneration;
  await rx.togglePlayback();rx.audio.dispatch('play');
  assert.ok(rx.state.live);assert.equal(rx.track.stopped,false);assert.equal(rx.state.audioGeneration,generation);
  assert.equal(rx.get('source-indicator').textContent,'LIVE');
  // Loading a recording stops the mic, and the file audio graph remains usable.
  await rx.loadFile({name:'second.wav'});
  assert.equal(rx.track.stopped,true);assert.equal(rx.state.live,false);assert.equal(rx.state.openingLive,false);
  assert.equal(rx.state.fileWorklet,oldWorklet);assert.equal(rx.get('playback-bar').hidden,false);
  await rx.togglePlayback();assert.equal(rx.state.activeInput,'file');assert.equal(rx.audio.playCalls,2);
  rx.get('close-file').dispatch('click');assert.equal(rx.state.fileUrl,undefined);assert.equal(rx.state.activeInput,'none');
  assert.equal(rx.get('playback-bar').hidden,true);
}

// A Play action awaiting AudioContext.resume must not resume a recording after
// mic capture has taken ownership of the receiver.
{
  const rx=receiver();await rx.loadFile({name:'first.wav'});
  const gate=deferred();rx.state.audioContext.state='suspended';rx.state.audioContext.resumeGate=gate;
  const pendingPlay=rx.togglePlayback();await settle();
  const pendingCapture=rx.startLive();await settle();rx.permission.resolve(rx.capture);await pendingCapture;
  gate.resolve();await pendingPlay;
  assert.equal(rx.audio.playCalls,0);assert.ok(rx.state.live);assert.equal(rx.track.stopped,false);
  assert.equal(rx.state.activeInput,'live');
}

// Importing while a permission request is pending cancels that capture; a late
// permission result is stopped instead of reviving the microphone.
{
  const rx=receiver();const pendingCapture=rx.startLive();await settle();
  await rx.loadFile({name:'replacement.wav'});const url=rx.state.fileUrl;
  rx.permission.resolve(rx.capture);await pendingCapture;
  assert.equal(rx.track.stopped,true);assert.equal(rx.state.live,false);assert.equal(rx.state.openingLive,false);
  assert.equal(rx.state.fileUrl,url);assert.equal(rx.get('source-indicator').textContent,'FILE');
  await rx.togglePlayback();assert.equal(rx.state.activeInput,'file');
}

// Denied capture leaves the old file unloaded and playback cannot affect input.
{
  const rx=receiver();await rx.loadFile({name:'first.wav'});
  const pendingCapture=rx.startLive();await settle();
  const denied=new Error('Permission denied');denied.name='NotAllowedError';rx.permission.reject(denied);await pendingCapture;
  await rx.togglePlayback();
  assert.equal(rx.state.fileUrl,undefined);assert.equal(rx.state.activeInput,'none');assert.equal(rx.audio.playCalls,0);
  assert.equal(rx.get('playback-bar').hidden,true);assert.equal(rx.get('source-indicator').textContent,'RX');
  assert.equal(rx.messages.at(-1).error,true);assert.match(rx.messages.at(-1).message,/access is blocked/);
  assert.match(rx.dialogs.at(-1).message,/Site settings → Microphone/);assert.match(rx.dialogs.at(-1).message,/Apps → Chrome → Permissions → Microphone/);
}

// The permission request starts synchronously in the tap handler, without waiting
// for a worklet fetch/resume, and keeps the receiver's unprocessed input constraints.
{
  const rx=receiver();const pending=rx.startLive();
  assert.equal(rx.requests.length,1);assert.equal(rx.state.audioContext,undefined);
  assert.equal(rx.requests[0].video,false);assert.equal(rx.requests[0].audio.echoCancellation,false);
  assert.equal(rx.requests[0].audio.noiseSuppression,false);assert.equal(rx.requests[0].audio.autoGainControl,false);
  rx.permission.resolve(rx.capture);await pending;assert.equal(rx.state.live,true);
}

// Capture acquired before audio setup must be released on cancellation or a
// worklet failure. Audio setup errors must not be mislabeled as permission errors.
{
  const rx=receiver();rx.state.setupGate=deferred();const pending=rx.startLive();
  rx.permission.resolve(rx.capture);await settle();assert.equal(rx.state.stream,rx.capture);
  rx.stopLive();assert.equal(rx.track.stopped,true);rx.state.setupGate.resolve();await pending;
  assert.equal(rx.state.live,false);assert.equal(rx.state.activeInput,'none');
}
{
  const rx=receiver();rx.state.setupGate=deferred();const pending=rx.startLive();
  rx.permission.resolve(rx.capture);await settle();
  const error=new Error('Audio setup failed');error.name='NotAllowedError';rx.state.setupGate.reject(error);await pending;
  assert.equal(rx.track.stopped,true);assert.equal(rx.state.openingLive,false);assert.equal(rx.dialogs.length,0);
  assert.equal(rx.messages.at(-1).message,'Audio setup failed');assert.equal(rx.messages.at(-1).error,true);
}

// Unsupported/blocked contexts explain the actual reason without issuing a
// permission request or disrupting an already playing recording.
for(const [configure,expected]of [
  [rx=>rx.state.window.isSecureContext=false,/requires HTTPS or localhost/],
  [rx=>rx.state.navigator.mediaDevices=undefined,/unavailable in this browser/],
  [rx=>rx.state.document.permissionsPolicy={allowsFeature:()=>false},/Permissions Policy/],
]){
  const rx=receiver();await rx.loadFile({name:'keep.wav'});await rx.togglePlayback();const url=rx.state.fileUrl;
  configure(rx);await rx.startLive();assert.equal(rx.requests.length,0);assert.equal(rx.state.openingLive,false);
  assert.equal(rx.state.fileUrl,url);assert.equal(rx.audio.paused,false);assert.equal(rx.state.activeInput,'file');
  assert.match(rx.messages.at(-1).message,expected);assert.equal(rx.messages.at(-1).error,true);
}

for(const [name,expected]of [['NotFoundError',/selected microphone is unavailable/],['OverconstrainedError',/Default audio input/],['NotReadableError',/microphone could not be opened/]]){
  const rx=receiver();const pending=rx.startLive();const error=new Error('Capture failed');error.name=name;
  rx.permission.reject(error);await pending;assert.match(rx.messages.at(-1).message,expected);
  assert.equal(rx.messages.at(-1).error,true);assert.equal(rx.state.openingLive,false);assert.equal(rx.dialogs.length,0);
}

// Encode-only must refuse audio entry points even when called directly, and
// never forward PCM/configuration or consume stale worker reports.
{
  const tx=receiver('encode');
  await tx.startLive();await tx.loadFile({name:'blocked.wav'});await tx.togglePlayback();
  tx.postDecoder({type:'audio',samples:new Float32Array(2048),rate:8000});tx.configureDecoder(true);
  assert.equal(tx.requests.length,0);assert.equal(tx.state.audioContext,undefined);
  assert.equal(tx.state.fileUrl,undefined);assert.equal(tx.audio.playCalls,0);assert.equal(tx.reports.length,0);
  for(const properties of [{key:'F3'},{key:'o',ctrlKey:true},{key:'s',ctrlKey:true},{key:' ',code:'Space'}]){
    let prevented=false;tx.keydown({target:{matches:()=>false},preventDefault(){prevented=true;},...properties});
    if(properties.code!=='Space')assert.ok(prevented);
  }
  assert.equal(tx.get('audio-upload').clickCalls,0);assert.equal(tx.requests.length,0);assert.equal(tx.reports.length,0);
  tx.audio.dispatch('play');assert.equal(tx.audio.paused,true);
  vm.runInNewContext(between('worker.onmessage=','function ensureReady(){'),tx.state);
  tx.state.worker.onmessage({data:{type:'decoded',text:'SHOULD NOT APPEAR'}});
  tx.state.worker.onmessage({data:{type:'configured',sequence:0}});
  assert.equal(tx.get('rx-text').value,0);assert.equal(tx.messages.length,0);
  tx.generateAudio();assert.match(tx.dialogs.at(-1).message,/not implemented/);
}
{
  const rx=receiver('decode');rx.generateAudio();assert.equal(rx.dialogs.length,0);
}

console.log('Passed: exclusive audio sources, permission diagnostics, capture cancellation, and encode-only decoder isolation.');
