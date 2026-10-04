import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import createCore from '../web/fldigi-core.js';
import {createDecoderSession} from '../web/decoder-session.js';
import {defaults,validatedConfig} from '../web/configuration.js';
import {appendReceivedText} from '../web/received-text.js';
import {scopeViews} from '../web/scope.js';

const core=await createCore(),modes=JSON.parse(core.UTF8ToString(core._web_modes()));
const codes=[...fs.readFileSync(new URL('../vendor/fldigi/src/psk/pskvaricode.cxx',import.meta.url),'utf8').split('varicodetab1[] = {')[1].split('};')[0].matchAll(/"([01]+)"/g)].map(m=>m[1]);
function psk(bytes,frequency=1500){
  const bits='0'.repeat(64)+bytes.map(c=>codes[c]+'00').join('')+'0'.repeat(64);
  const pcm=new Float32Array(bits.length*256);let n=0,sign=1;
  for(const bit of bits){for(let i=0;i<256;i++,n++)pcm[n]=.65*(bit==='1'?sign:sign*Math.cos(Math.PI*i/256))*Math.cos(2*Math.PI*frequency*n/8000);if(bit==='0')sign=-sign;}
  return pcm;
}
const messages=[],session=createDecoderSession(core,m=>messages.push(m));let sequence=0,generation=0;
function send(data){session.handle({...data,generation});}
function configure(name,extra={},retune=false){send({type:'configure',sequence:++sequence,retune,settings:{...defaults,afc:false,mode:modes.find(m=>m.name===name).id,...extra}});return messages.at(-1);}
function feed(samples,size=2048){for(let i=0;i<samples.length;i+=size)send({type:'audio',samples:samples.slice(i,i+size),rate:8000});}
function reset(){generation++;send({type:'reset'});messages.length=0;}
function transcript(){return messages.filter(m=>m.type==='decoded').reduce((text,m)=>appendReceivedText(text,m.text),'');}

for(const [name,expected]of [['Cont-4/125',94],['Cont-8/250',219],['Cont-16/1K',938]]){
  reset();configure(name);assert.equal(core._web_bandwidth(),expected,name);
  configure(name,{sql:true,frequency:1510},true);feed(new Float32Array(2048));
  assert.equal(core._web_bandwidth(),expected,`${name}: full settings updates must preserve preset`);
  // The C boundary protects the preset too, independently of the session guard.
  core._web_set_option(35,2);core._web_set_option(36,2);feed(new Float32Array(2048));assert.equal(core._web_bandwidth(),expected);
}
configure('CONTESTIA',{contestiaBandwidth:0,contestiaTones:1});assert.equal(core._web_bandwidth(),94,'named → generic must apply saved custom parameters');
configure('CONTESTIA',{contestiaBandwidth:2,contestiaTones:2});assert.equal(core._web_bandwidth(),438,'generic settings apply immediately');
for(const [name,expected]of [['OLIVIA-4/125',94],['OLIVIA-8/250',219]]){
  configure(name);configure(name,{sql:true});feed(new Float32Array(2048));assert.equal(core._web_bandwidth(),expected);
}

const cases=[
  [[65,0xc3,0xa9,66,10],'AéB\n'],
  [[65,0xe9,66,10],'AéB\n'],
  [[65,0x80,66,10],'A€B\n'],
  [[65,8,66,10],'B\n'],
  [[65,10,8,66,10],'A\nB\n'],
  [[65,0xc3,0xa9,8,66,10],'AB\n'],
  [[65,0xc3],'AÃ'], // Original CP1252 fallback on a final incomplete UTF-8 sequence.
];
for(const [bytes,expected]of cases){
  for(const size of [512,2048,1e9]){
    reset();configure('BPSK31');feed(psk(bytes),size);send({type:'flush'});
    assert.equal(transcript(),expected,`${bytes}: ${size}-sample reports`);
    for(const m of messages.filter(m=>m.type==='decoded'))assert.ok(!m.text.includes('\ufffd'),'reports must contain complete characters');
  }
}
assert.equal(appendReceivedText('A😀','\bB'),'AB');
assert.equal(appendReceivedText('A\n','\bB'),'A\nB');
assert.equal(appendReceivedText('😀ABC','',4),'ABC','text limit must not orphan a surrogate');

reset();configure('BPSK31',{afc:true});feed(psk([...Buffer.from('CQ CQ DE WEBTEST 12345\n'.repeat(4))],1503));
assert.ok(transcript().includes('CQ CQ DE WEBTEST 12345'));
assert.ok(messages.some(m=>m.scope?.mode===1&&m.scope.highlight&&Number.isFinite(m.scope.phase)&&m.scope.quality>0),'PSK native phase changes must reach the renderer');
const tracked=core._web_frequency();assert.ok(Math.abs(tracked-1503)<.1);
configure('BPSK31',{afc:true,showScope:false,frequency:1500});assert.equal(core._web_frequency(),tracked,'display settings must not undo AFC');
configure('BPSK31',{afc:true,frequency:1510},true);assert.equal(core._web_frequency(),1510,'explicit tuning must apply');

reset();configure('BPSK31',{},true);feed(psk([...Buffer.from('OLD TEXT\n')]));reset();
const count=messages.length;
session.handle({type:'audio',generation:generation-1,samples:psk([...Buffer.from('OLD TEXT\n')]),rate:8000});
session.handle({type:'flush',generation:generation-1});session.handle({type:'reset',generation:generation-1});
assert.equal(messages.length,count,'old audio/flush cannot produce reports');
feed(psk([...Buffer.from('NEW TEXT\n')]));send({type:'flush'});assert.equal(transcript(),'NEW TEXT\n');
assert.ok(messages.every(m=>m.generation===generation));

function readWav(file){const bytes=fs.readFileSync(new URL(`./fixtures/${file}`,import.meta.url));return Float32Array.from({length:(bytes.length-44)/2},(_,i)=>bytes.readInt16LE(44+i*2)/32768);}
reset();configure('RTTY');feed(readWav('rtty.wav'));
let scope=messages.find(m=>m.scope?.trace.length&&m.scope?.xy.length)?.scope;
assert.equal(scope?.mode,5);assert.ok(scope.trace.every(Number.isFinite));assert.ok(scope.xy.length>2);
reset();configure('CW');feed(readWav('cw.wav'));scope=messages.find(m=>m.scope?.trace.length)?.scope;assert.equal(scope?.mode,0);
configure('MT63-1KL');scope=messages.at(-1).scope;assert.equal(scope.mode,10);assert.deepEqual(scope.trace,[]);assert.equal(scope.phase,0);
for(const name of ['DOMEX4','THOR4']){
  let phase=0;const changingTones=Float32Array.from({length:80000},(_,i)=>{const frequency=1430+(Math.floor(i/2048)*5%18)*7.8125;phase+=2*Math.PI*frequency/8000;return .6*Math.cos(phase);});
  reset();configure(name);feed(changingTones);scope=messages.at(-1).scope;
  assert.equal(scope.mode,8);assert.ok(scope.trace.length>0);assert.ok(scope.video.length>0);assert.ok(scope.videoSerial>0);
  assert.ok([...scope.trace,...scope.video].every(Number.isFinite));
  assert.ok(scope.trace.every(v=>v>=0&&v<=1),`${name}: native default auto-scaling keeps the waveform inside the canvas`);
  assert.ok(scope.trace.some(v=>v>.5),`${name}: scaled timing waveform is visible`);
}
{
  let phase=0;const mfskTones=Float32Array.from({length:80000},(_,i)=>{phase+=2*Math.PI*(1383+(Math.floor(i/512)*5%16)*15.625)/8000;return .6*Math.cos(phase);});
  reset();configure('MFSK16');feed(mfskTones);scope=messages.at(-1).scope;assert.equal(scope.mode,0);assert.ok(scope.trace.length>0);
  assert.ok(scope.trace.every(v=>v>=0&&v<=1),'MFSK waveform is scaled into the visible canvas');assert.ok(scope.trace.some(v=>v>.5));
}
assert.deepEqual(scopeViews(1),[2,3,4]);assert.deepEqual(scopeViews(5),[5,6]);assert.deepEqual(scopeViews(8),[8,9]);

// The supplied waterfall's full-length window and latency normalization.
const tone=Float32Array.from({length:16384},(_,i)=>Math.cos(2*Math.PI*1500*i/8000));
function peak(window,latency){reset();configure('BPSK31',{wfWindow:window,wfLatency:latency},true);feed(tone);return messages.at(-1).spectrum[1536];}
const rectangular=peak(0,16),blackman=peak(1,16),hann=peak(3,16);
assert.ok(Math.abs(rectangular)<.01);assert.ok(Math.abs(blackman-20*Math.log10(.42/Math.sqrt(.42**2+.5**2/2+.08**2/2)))<.02);assert.ok(Math.abs(hann-20*Math.log10(.5/Math.sqrt(.5**2+.5**2/2)))<.02);
assert.ok(Math.abs(peak(0,8)-rectangular-10*Math.log10(2))<.01);

// Exercise the actual AudioWorklet implementation with discontinuity/queue ordering.
let Worklet;const posted=[];
class Processor{constructor(){this.port={postMessage:data=>posted.push(data)};}}
vm.runInNewContext(fs.readFileSync(new URL('../web/audio-worklet.js',import.meta.url),'utf8'),{AudioWorkletProcessor:Processor,sampleRate:48000,Float32Array,registerProcessor:(_name,cls)=>Worklet=cls});
const worklet=new Worklet({processorOptions:{generation:1}});
const command=data=>worklet.port.onmessage({data}),process=(n,value)=>worklet.process([[new Float32Array(n).fill(value)]],[]);
process(100,.1);command({command:'reset',generation:2,active:true});process(1948,.9);assert.equal(posted.length,0,'reset discards old partial block');
command({command:'flush',generation:1,finished:true});assert.equal(posted.length,0,'stale flush ignored');
process(100,.9);assert.equal(posted.length,1);assert.equal(posted[0].generation,2);assert.ok(posted[0].samples.every(v=>v>.8));
command({command:'reset',generation:3,active:false});process(4096,.1);assert.equal(posted.length,1,'inactive source stays silent');
command({active:true,generation:3});process(100,.7);command({command:'flush',generation:3,finished:true});assert.equal(posted[1].samples.length,100);assert.equal(posted[2].type,'flushed');assert.equal(posted[2].generation,3);
command({command:'reset',generation:2,active:true});process(2048,.1);assert.equal(posted.length,3,'late old reset cannot reactivate a source');

assert.equal(validatedConfig({channelSquelch:-999}).channelSquelch,-3);
assert.equal(validatedConfig({channelSquelch:999}).channelSquelch,6);
assert.equal(validatedConfig({channelSquelch:1.26}).channelSquelch,1.3);
assert.equal(validatedConfig({fsqPeakHits:999}).fsqPeakHits,6);
assert.equal(validatedConfig({dominoBandwidth:999}).dominoBandwidth,2);
session.dispose();
console.log('Passed: preset stability, continuous charset/backspace handling, AFC tuning, stream generations, native scopes, worklet resets, and configuration bounds.');
