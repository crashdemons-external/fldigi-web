import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createTransmitter} from '../web/transmitter.js';
import {createTransmitPlayback} from '../web/transmit-audio.js';
import {createWorkflowFilter} from '../web/workflow.js';
import {defaults} from '../web/configuration.js';

const catalog=JSON.parse(fs.readFileSync(new URL('../web/workflow.json',import.meta.url)));
const workers=[],timers=new Map();let intervalId=0;
const original={Worker:globalThis.Worker,setInterval:globalThis.setInterval,clearInterval:globalThis.clearInterval};
globalThis.Worker=class{
  constructor(){this.messages=[];workers.push(this);}
  postMessage(data){this.messages.push(data);}
  terminate(){this.terminated=true;}
  emit(data){this.onmessage({data});}
};
globalThis.setInterval=fn=>{timers.set(++intervalId,fn);return intervalId;};
globalThis.clearInterval=id=>timers.delete(id);
const settle=()=>new Promise(resolve=>setImmediate(resolve));

class Element{
  constructor(id){this.id=id;this.attributes={};this.dataset={};this.disabled=false;this.value='';this.hidden=false;this.textContent='';this.listeners={};this.tagName='BUTTON';this.classList={toggle(){}};this.paused=true;this.ended=false;}
  setAttribute(name,value){this.attributes[name]=String(value);}
  getAttribute(name){return this.attributes[name]??null;}
  removeAttribute(name){delete this.attributes[name];}
  addEventListener(name,fn){(this.listeners[name]??=[]).push(fn);}
  async dispatch(name){for(const fn of this.listeners[name]||[])await fn({target:this});}
  showModal(){this.open=true;}
  close(){this.open=false;}
  pause(){this.paused=true;this.dispatch('pause');}
  async play(){this.paused=false;this.dispatch('play');}
  load(){}
}
function audioClock(){
  const nodes=[];
  const clock={currentTime:0,destination:{},createGain(){return {gain:{value:0},connect(){},disconnect(){this.disconnected=true;}};},
    createBuffer(channels,length,rate){return {length,rate,getChannelData:()=>new Float32Array(length)};},
    createBufferSource(){const source={playbackRate:{value:1},connect(){},disconnect(){this.disconnected=true;},start(time){this.startTime=time;},stop(){this.stopped=true;}};nodes.push(source);return source;},nodes};
  return clock;
}
function ui(profile,resumeResult=false){
  const elements=new Map(Object.keys(catalog).map(id=>[id,new Element(id)]));
  const $=id=>elements.get(id),document={getElementById:$,querySelectorAll:()=>[],addEventListener(){}};
  globalThis.document={body:{classList:{toggle(){}}}};
  const workflowUI=createWorkflowFilter(catalog,profile,document),clock=audioClock(),events=[],downloads=[],states=[],warnings=[],spectra=[];
  const settings={...defaults,mode:1};let mode={id:1,name:'BPSK31',label:'BPSK-31',family:'PSK',enabled:true},pauses=0,resumes=0,stops=0;const pauseKinds=[];
  const tx=createTransmitter({$,enabled:profile!=='decode',decodeEnabled:profile!=='encode',workflowUI,getSettings:()=>settings,getMode:()=>mode,
    context:async()=>clock,pauseInput(kind){pauses++;pauseKinds.push(kind);},resumeInput(){resumes++;return resumeResult;},stopInput(){stops++;},status:(message,error)=>events.push({message,error}),onState:state=>states.push(state),download:(...args)=>downloads.push(args),showMessage:(...args)=>warnings.push(args),onSpectrum:(...args)=>spectra.push(args)});
  tx.update();return {$,tx,clock,events,downloads,warnings,spectra,settings,states,pauseKinds,setMode(next){mode=next;tx.update();},get pauses(){return pauses;},get resumes(){return resumes;},get stops(){return stops;}};
}
function started(worker,live=false){worker.emit({type:'ready'});const start=worker.messages.at(-1);worker.emit({type:'started',job:start.job,rate:8000,frequency:1500,live});return start.job;}

try{
  const decode=ui('decode'),workerCount=workers.length;
  decode.$('tx-text').value='TEST';decode.tx.generate();decode.tx.toggle();await decode.$('tx-render-generate').dispatch('click');await settle();
  assert.equal(workers.length,workerCount);assert.equal(decode.pauses,0);assert.equal(decode.$('tx-render-dialog').open,undefined);
  assert.equal(decode.$('macro-tr').disabled,true);

  for(const profile of ['encode','both','full']){
    const page=ui(profile),beforeEmpty=workers.length;
    for(const empty of ['', ' \n\t']){
      page.$('tx-text').value=empty;page.tx.generate();
      assert.equal(page.$('tx-render-dialog').open,undefined,'empty input shows a warning instead of the generation dialog');
      assert.equal(page.warnings.at(-1)[0],'Warning');assert.match(page.warnings.at(-1)[1],/Enter text/);
    }
    assert.equal(workers.length,beforeEmpty);assert.equal(page.pauses,0);
    page.$('tx-text').value='FIRST\n';page.tx.generate();assert.ok(page.$('tx-render-dialog').open);
    await page.$('tx-render-generate').dispatch('click');await settle();const worker=workers.at(-1);
    const job=started(worker);page.settings.frequency=1700;page.$('tx-text').value='EDITED';
    assert.equal(worker.messages.find(m=>m.type==='start').settings.frequency,1500,'render captures settings');
    assert.equal(worker.messages.find(m=>m.type==='start').text,'FIRST\n','render captures text');
    assert.equal(page.$('tx-text').disabled,true);assert.equal(page.downloads.length,0);
    assert.equal(page.$('tx-audio-bar').hidden,true,'file generation has no media toolbar');
    worker.emit({type:'samples',job,rate:8000,samples:new Float32Array([0,.5,-.5,0]),cursor:6,total:4,done:true});
    assert.equal(page.tx.active,false);assert.equal(page.$('tx-render-dialog').open,false);assert.ok(worker.terminated);
    assert.equal(page.$('tx-text').disabled,false);assert.equal(page.$('tx-audio-bar').hidden,true);
    assert.equal(page.downloads.length,1,'the completed WAV downloads without another click');
    assert.equal(page.downloads[0][0],'fldigi-BPSK31-1500Hz.wav');assert.equal(page.downloads[0][1].size,52);assert.equal(page.downloads[0][2],'audio/wav');
    assert.equal(page.clock.nodes.length,0,'file generation never schedules speaker playback');
    assert.deepEqual(page.pauseKinds,['render']);assert.equal(page.resumes,0);
    assert.equal(page.spectra.length,0,'WAV generation never draws the transmit waterfall');
    for(const id of ['tx-preview','tx-save','tx-clear','tx-audio'])assert.equal(page.$(id),undefined,'no generated-file controls remain');
    // Canceling generation never downloads a partial WAV. Late results are ignored.
    page.tx.generate();await page.$('tx-render-generate').dispatch('click');await settle();const replacement=workers.at(-1),replacementJob=started(replacement);
    page.tx.cancel();replacement.emit({type:'samples',job:replacementJob,rate:8000,samples:new Float32Array(400),done:true});
    assert.equal(page.downloads.length,1);assert.ok(replacement.terminated);
    page.tx.dispose();assert.equal(page.$('tx-audio-bar').hidden,true);
  }

  const live=ui('encode');live.$('tx-text').value='FIRST\n';live.tx.toggle();await settle();const worker=workers.at(-1);
  // Typing during module initialization cannot duplicate appended text.
  live.$('tx-text').value='FIRST\nSECOND\n';await live.$('tx-text').dispatch('input');
  const job=started(worker,true);
  assert.equal(worker.messages.find(m=>m.type==='start').text,'FIRST\n');
  assert.equal(worker.messages.filter(m=>m.type==='append').length,1);assert.equal(worker.messages.find(m=>m.type==='append').text,'SECOND\n');
  assert.equal(live.$('tx-text').disabled,false);assert.equal(live.$('rx-button').disabled,false);
  assert.equal(live.$('frequency').disabled,true);assert.equal(live.$('macro-tr').getAttribute('aria-pressed'),'true');
  const firstSpectrum=new Float32Array(4096).fill(-80);firstSpectrum[1536]=-5;
  worker.emit({type:'samples',job,rate:8000,samples:new Float32Array(2048),spectrum:firstSpectrum,cursor:1,total:2048,done:false});
  assert.equal(live.clock.nodes.length,1);assert.ok(live.clock.nodes[0].startTime>=.12);
  assert.equal(live.spectra.length,0,'lookahead cannot draw before its audio has played');
  live.clock.currentTime=.376;for(const fn of [...timers.values()])fn();
  assert.equal(live.spectra.length,1);assert.equal(live.spectra[0][0],firstSpectrum);assert.equal(live.spectra[0][1],8000);
  live.$('tx-text').value='EDIT PREFIX';await live.$('tx-text').dispatch('input');assert.equal(live.$('tx-text').value,'FIRST\nSECOND\n');
  assert.match(live.events.at(-1).message,/Queued text is locked/);
  live.tx.finish();assert.ok(worker.messages.some(m=>m.type==='finish'));assert.equal(live.$('tx-text').readOnly,true);
  worker.emit({type:'samples',job,rate:8000,samples:new Float32Array(2048),cursor:13,total:4096,done:true});
  assert.equal(live.tx.active,true,'finish waits for the scheduled tail to play');
  live.clock.currentTime=10;for(const fn of [...timers.values()])fn();
  assert.equal(live.tx.active,false);assert.ok(worker.terminated);assert.equal(live.$('rx-button').disabled,true);
  assert.equal(live.$('tx-audio-bar').hidden,true,'live TX does not accumulate a recording');

  live.tx.toggle();await settle();const aborted=workers.at(-1),abortJob=started(aborted,true);
  aborted.emit({type:'samples',job:abortJob,rate:8000,samples:new Float32Array(2048),spectrum:firstSpectrum,done:false});
  const drawnBeforeAbort=live.spectra.length;
  live.tx.cancel();assert.ok(live.clock.nodes.at(-1).stopped);assert.equal(live.tx.active,false);assert.equal(timers.size,0);
  aborted.emit({type:'samples',job:abortJob,rate:8000,samples:new Float32Array(2048),done:false});assert.equal(live.tx.active,false);
  live.clock.currentTime+=10;for(const fn of [...timers.values()])fn();assert.equal(live.spectra.length,drawnBeforeAbort,'cancellation discards queued waterfall frames');
  // Native framed modes close their input before their buffered tail is drained.
  live.tx.toggle();await settle();const ending=workers.at(-1),endingJob=started(ending,true);
  ending.emit({type:'samples',job:endingJob,rate:8000,samples:new Float32Array(2048),ending:true,done:false});
  assert.equal(live.$('tx-text').readOnly,true);assert.equal(live.$('macro-tr').disabled,true);
  live.tx.cancel();
  const beforeCancel=workers.length;live.tx.toggle();live.tx.cancel();await settle();
  assert.equal(workers.length,beforeCancel,'canceling audio initialization must not create a late encoder');
  live.setMode({id:999,name:'DTMF',family:'DTMF',enabled:true});assert.equal(live.$('frequency').disabled,true);assert.equal(live.$('macro-tr').disabled,false);
  live.setMode({id:99,name:'WEFAX576',family:'WEFAX',enabled:true});assert.equal(live.$('macro-tr').disabled,true);assert.equal(live.$('menu-generate-audio').disabled,true);

  // Held microphone receive resumes only after the modem tail has played.
  const mic=ui('both',true);mic.$('tx-text').value='E';mic.tx.toggle();await settle();
  let micWorker=workers.at(-1),micJob=started(micWorker,true);
  assert.deepEqual(mic.pauseKinds,['live']);mic.tx.finish();
  micWorker.emit({type:'samples',job:micJob,rate:8000,samples:new Float32Array(512),done:true});
  assert.equal(mic.resumes,0);mic.clock.currentTime=1;for(const fn of [...timers.values()])fn();
  assert.equal(mic.resumes,1);assert.equal(mic.stops,0);assert.match(mic.events.at(-1).message,/Live receive resumed/);
  // The immediate Stop button releases input instead of resuming it.
  mic.tx.toggle();await settle();micWorker=workers.at(-1);started(micWorker,true);
  await mic.$('tx-cancel').dispatch('click');assert.equal(mic.stops,1);assert.equal(mic.resumes,1);assert.ok(micWorker.terminated);
  // An encoder failure is an automatic handoff, not an explicit Stop.
  mic.tx.toggle();await settle();micWorker=workers.at(-1);started(micWorker,true);
  micWorker.emit({type:'error',message:'Test encoder failure'});
  assert.equal(mic.resumes,2);assert.equal(mic.stops,1);assert.equal(mic.events.at(-1).error,true);
  // Disposing while the audio context is loading must also release capture.
  mic.tx.toggle();mic.tx.dispose();await settle();assert.equal(mic.stops,2);assert.equal(mic.resumes,2);

  const clock=audioClock(),playback=createTransmitPlayback(clock,.25,5000);
  playback.push(new Float32Array(800),8000,firstSpectrum);playback.push(new Float32Array(800),8000,firstSpectrum);
  assert.equal(clock.nodes[0].playbackRate.value,1.005);
  assert.ok(Math.abs(clock.nodes[1].startTime-(.12+.1/1.005))<1e-9,'chunks must be scheduled without gaps');
  clock.currentTime=.22;const due=playback.takeSpectra();assert.equal(due.length,1);assert.ok(Math.abs(due[0].rate-8040)<1e-9,'the display frequency scale follows corrected playback speed');
  playback.stop();assert.ok(clock.nodes.every(node=>node.stopped&&node.disconnected));
  clock.currentTime=10;assert.deepEqual(playback.takeSpectra(),[]);
  console.log('Passed: workflow gating, empty-input warnings, snapshot render, automatic download, cancellation, live append/finish/abort, load races, RX transition and synchronized TX waterfall timing.');
}finally{Object.assign(globalThis,original);}
