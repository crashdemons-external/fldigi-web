import assert from 'node:assert/strict';
import createCore from '../web/fldigi-core.js';
import {createEncoderSession} from '../web/encoder-session.js';
import {defaults} from '../web/configuration.js';
import {pcm16,wavBlob,prepareTransmitText} from '../web/transmit-audio.js';

const core=await createCore(),receiver=await createCore();
const modes=JSON.parse(core.UTF8ToString(core._web_modes()));
let messages=[],job=0;
const session=createEncoderSession(core,message=>messages.push(message));
function begin(name,text,settings={},live=false){
  messages=[];job++;
  const mode=modes.find(m=>m.name===name);assert.ok(mode,name);
  session.handle({type:'start',job,settings:{...defaults,mode:mode.id,...settings},text,live});
  assert.equal(messages.at(-1).type,'started');return messages.at(-1).rate;
}
function pull(maximum=8192){session.handle({type:'pull',job,maximum});return messages.at(-1);}
function render(name,text='CQ CQ DE WEBTEST 12345\n',settings={},maximum=8192){
  const rate=begin(name,text,settings),chunks=[];let count=0,data;
  for(let step=0;step<100000;step++){
    data=pull(maximum);assert.ok(data.samples.length<=maximum);
    assert.equal(data.spectrum,undefined,'file rendering skips waterfall analysis');
    assert.ok(data.samples.every(Number.isFinite),`${name}: invalid samples`);
    if(data.samples.length){chunks.push(data.samples);count+=data.samples.length;}
    if(data.done)break;
  }
  assert.ok(data.done,`${name}: encoder did not finish`);assert.ok(count>0,`${name}: no audio`);
  const samples=new Float32Array(count);let offset=0;for(const chunk of chunks){samples.set(chunk,offset);offset+=chunk.length;}
  assert.ok(samples.some(sample=>Math.abs(sample)>.05),`${name}: silent audio`);
  return {samples,rate};
}

// Exercise every native text variant, including slow/FEC modes and presets.
const available=modes.filter(m=>m.enabled&&core._web_tx_supported(m.id)&&!m.name.startsWith('OFDM'));
for(const mode of available)render(mode.name,mode.family==='DTMF'?'123A*#':'TEST 123\n');
console.log(`Encoder: ${available.length} text/keypad mode variants generate finite audio with native tails.`);
assert.equal(core._web_tx_supported(modes.find(m=>m.name==='WEFAX576').id),0);

const block=receiver._malloc(512*4);
function decode(name,{samples,rate},settings={}){
  receiver._web_create(modes.find(m=>m.name===name).id);receiver._web_set_frequency(1500);
  receiver._web_set_option(0,0);receiver._web_set_option(1,0);
  if(name==='RTTY')receiver._web_set_option(5,1);
  if(name==='CW')receiver._web_set_option(17,0);
  const all=new Float32Array(samples.length+rate*4);all.set(samples);
  for(let offset=0;offset<all.length;offset+=512){const data=all.subarray(offset,offset+512);receiver.HEAPF32.set(data,block/4);receiver._web_process(block,data.length);}
  receiver._web_flush();return receiver.UTF8ToString(receiver._web_take_text());
}
for(const name of ['BPSK31','RTTY','CW']){
  const generated=render(name,'CQ CQ DE WEBTEST 12345\n'.repeat(3));
  const decoded=decode(name,generated);assert.ok(decoded.includes('CQ CQ DE WEBTEST 12345'),`${name}: ${JSON.stringify(decoded)}`);
}
const keypad='123A456B789C*0#D';
const tones=render('DTMF',keypad);receiver._web_set_option(2,0);
assert.ok(decode('DTMF',tones).includes(keypad),'original DTMF generator must round-trip every key');

// The two instances must leave an ongoing receiver untouched.
receiver._web_create(modes.find(m=>m.name==='RTTY').id);receiver._web_set_frequency(1700);
render('BPSK31');assert.equal(receiver._web_frequency(),1700);

// TX uses the same native FFT as RX, without passing audio to the receive codec.
begin('BPSK31','WATERFALL TEST\n',{frequency:1800,txOffset:100,wfWindow:0,wfLatency:16},true);
receiver._web_create(modes.find(m=>m.name==='BPSK31').id);
receiver._web_set_option(0,0);receiver._web_set_option(56,0);receiver._web_set_option(57,16);
let txSpectrum;
for(let i=0;i<32;i++){
  const data=pull(512);
  receiver.HEAPF32.set(data.samples,block/4);receiver._web_process(block,data.samples.length);
  if(data.spectrum){assert.equal(data.spectrum.length,4096);assert.ok(data.spectrum.every(Number.isFinite));txSpectrum=data.spectrum;}
}
assert.ok(txSpectrum,'live TX sends its native waterfall analysis');
const spectrumPointer=receiver._web_spectrum();
assert.deepEqual(txSpectrum,receiver.HEAPF32.slice(spectrumPointer/4,spectrumPointer/4+4096),'TX and RX FFTs match for identical PCM and display settings');
const peakBin=txSpectrum.indexOf(Math.max(...txSpectrum));
assert.ok(Math.abs(peakBin*8000/8192-1700)<20,'TX waterfall shows the actual frequency after offset');
assert.equal(core.UTF8ToString(core._web_take_text()),'','TX spectrum does not decode its own transmission');

begin('BPSK31','FIRST\n',{},true);
let sample;
for(let i=0;i<200;i++){sample=pull(2048);assert.equal(sample.done,false);}
session.handle({type:'append',job,text:'SECOND\n'});
session.handle({type:'finish',job});
for(let i=0;i<2000;i++){sample=pull(2048);if(sample.done)break;}
assert.ok(sample.done);assert.equal(sample.cursor,13);
const count=messages.length;session.handle({type:'pull',job:job-1});assert.equal(messages.length,count,'stale job cannot affect the current encoder');
begin('CW','E',{},true);for(let i=0;i<100;i++){sample=pull();assert.equal(sample.done,false);}
session.handle({type:'finish',job});assert.ok(pull().done,'CW idle silence must yield and then finish');

const a=render('BPSK31','CHUNK TEST\n',{},512),b=render('BPSK31','CHUNK TEST\n',{},8192);
assert.deepEqual(a.samples,b.samples,'splitting a native modulation buffer must preserve its samples');
const offsetAudio=render('BPSK31','CQ CQ WEBTEST 123\n'.repeat(3),{frequency:1600,txOffset:100});
assert.ok(decode('BPSK31',offsetAudio).includes('WEBTEST 123'),'native TX offset must shift the audio frequency');
begin('FSQ','TEST',{frequency:1700,txOffset:100});assert.equal(messages.at(-1).frequency,1400,'FSQ keeps its native 1500 Hz base frequency');
begin('BPSK31','TEST',{frequency:1600,txOffset:100,txFrequencyLock:true,txFrequency:1700});assert.equal(messages.at(-1).frequency,1600);
assert.throws(()=>session.handle({type:'start',job:++job,text:'a'.repeat(100001),settings:{...defaults,mode:1}}),/100,000/);

const pcm=pcm16(new Float32Array([-2,-1,0,1,2,NaN]));
const wav=await wavBlob([pcm],6,8000).arrayBuffer(),view=new DataView(wav);
assert.equal(view.getUint32(24,true),8000);assert.equal(view.getUint32(40,true),12);assert.equal(wav.byteLength,56);
assert.equal(view.getInt16(44,true),-32768);assert.equal(view.getInt16(50,true),32767);assert.equal(view.getInt16(54,true),0);
const mode=name=>modes.find(m=>m.name===name);
assert.equal(prepareTransmitText('abc\r\n123',mode('RTTY'),defaults),'ABC\n123');
assert.throws(()=>prepareTransmitText('😀',mode('RTTY'),defaults),/ASCII/);
assert.throws(()=>prepareTransmitText('E',mode('DTMF'),defaults),/DTMF accepts/);
assert.throws(()=>prepareTransmitText('A=B',mode('RTTY'),defaults),/Baudot/);
assert.throws(()=>prepareTransmitText('TEST!',mode('THROB1'),defaults),/Throb/);
assert.equal(prepareTransmitText('Test!',mode('THRBX1'),defaults),'TEST!');
assert.throws(()=>prepareTransmitText('TEST\x03',mode('BPSK31'),defaults),/control characters/);
assert.throws(()=>prepareTransmitText('a'.repeat(100001),mode('BPSK31'),defaults),/100,000/);
receiver._free(block);
console.log('Passed: native BPSK31/RTTY/CW/DTMF round-trips, live append/finish, isolation, chunk continuity, offset, character validation and WAV format.');
