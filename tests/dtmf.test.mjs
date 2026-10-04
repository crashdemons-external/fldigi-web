import assert from 'node:assert/strict';
import fs from 'node:fs';
import createCore from '../web/fldigi-core.js';
import {createDecoderSession} from '../web/decoder-session.js';
import {defaults} from '../web/configuration.js';
import {dtmfSignal} from './dtmf-signal.mjs';

const core=await createCore(),modes=JSON.parse(core.UTF8ToString(core._web_modes()));
const dtmf=modes.find(m=>m.name==='DTMF');assert.ok(dtmf?.enabled);assert.equal(modes.at(-1),dtmf);
const block=core._malloc(65536*4);
const read=fn=>core.UTF8ToString(fn());
function feed(samples,size=512){for(let i=0;i<samples.length;i+=size){const chunk=samples.subarray(i,i+size);core.HEAPF32.set(chunk,block/4);core._web_process(block,chunk.length);}}
const digits=text=>text.replace(/\s|<DTMF>/g,'');
function select(name){assert.ok(core._web_create(modes.find(m=>m.name===name).id));core._web_set_option(2,3);}
const keypad='123A456B789C*0#D';
for(const size of [1,119,240,241,512,4096,65536]){
  select('DTMF');feed(dtmfSignal(keypad),size);core._web_flush();
  const text=read(core._web_take_text);assert.ok(text.startsWith('\n<DTMF> '));assert.equal(digits(text),keypad,`${size}-sample native chunks`);
  assert.equal(core._web_sample_rate(),8000);assert.equal(core._web_bandwidth(),0);
  assert.deepEqual(JSON.parse(read(core._web_waterfall_geometry)),{bands:[],tracks:[],hover:[],markerEdges:[]});
  assert.equal(JSON.parse(read(core._web_scope)).mode,10);
  assert.ok(JSON.parse(read(core._web_channels)).every(c=>!c.text&&!c.frequency),'PSK channel decoding must be off');
}
select('DTMF');const frequency=core._web_frequency();core._web_set_frequency(350);assert.equal(core._web_frequency(),frequency,'DTMF ignores tuning');
core._web_set_option(44,0);core._web_set_option(3,1);core._web_set_option(0,1);core._web_set_option(1,1);
feed(dtmfSignal('55',{toneMs:600}));core._web_flush();assert.equal(digits(read(core._web_take_text)),'55','held digits emit once; silence permits repetition');
core._web_set_option(44,1);core._web_set_option(3,0);core._web_set_option(0,0);core._web_set_option(1,0);
select('DTMF');feed(dtmfSignal('9',{tailMs:0}));assert.equal(read(core._web_take_text),'','native output waits for the silence/flush boundary');core._web_flush();assert.equal(digits(read(core._web_take_text)),'9');core._web_flush();assert.equal(read(core._web_take_text),'','flush must not duplicate text');
for(const size of [119,240,361]){
  select('DTMF');feed(dtmfSignal('1').slice(0,size));core._web_reset();feed(dtmfSignal('2'),119);core._web_flush();assert.equal(digits(read(core._web_take_text)),'2','resets discard buffered digits and partial frames');
}
select('DTMF');core._web_set_option(2,100);feed(dtmfSignal('8',{amplitude:.1}));core._web_flush();assert.equal(read(core._web_take_text),'','native squelch threshold suppresses weak tones');
core._web_set_option(2,3);feed(dtmfSignal('8',{amplitude:.1}));core._web_flush();assert.equal(digits(read(core._web_take_text)),'8');
select('DTMF');feed(dtmfSignal('A',{tailMs:0}));select('BPSK31');feed(dtmfSignal('B'));core._web_flush();assert.ok(!read(core._web_take_text).includes('<DTMF>'),'switching away must disable DTMF');
core._web_set_frequency(1500);
const wav=fs.readFileSync(new URL('./fixtures/bpsk31.wav',import.meta.url));feed(Float32Array.from({length:(wav.length-44)/2},(_,i)=>wav.readInt16LE(44+i*2)/32768));core._web_flush();assert.ok(read(core._web_take_text).includes('CQ CQ DE WEBTEST 12345'),'normal modem resumes decoding');
select('DTMF');core._web_flush();assert.equal(read(core._web_take_text),'','switching back must not resurrect the old digit');
core._free(block);

// Exercise the real worker session/resampler and stale-generation boundary.
const messages=[],session=createDecoderSession(core,m=>messages.push(m));let generation=1,sequence=0;
function send(data){session.handle({...data,generation});}
send({type:'reset'});
function configure(name){send({type:'configure',sequence:++sequence,settings:{...defaults,mode:modes.find(m=>m.name===name).id}});}
for(const rate of [8000,44100,48000]){
  generation++;send({type:'reset'});configure('DTMF');messages.length=0;
  const samples=dtmfSignal(keypad,{rate});for(let i=0;i<samples.length;i+=2048)send({type:'audio',rate,samples:samples.slice(i,i+2048)});send({type:'flush'});
  assert.equal(digits(messages.map(m=>m.text||'').join('')),keypad,`${rate} Hz input`);
}
generation++;send({type:'reset'});configure('DTMF');messages.length=0;
session.handle({type:'audio',generation:generation-1,rate:8000,samples:dtmfSignal('D')});send({type:'flush'});assert.equal(messages.map(m=>m.text||'').join(''),'');
configure('BPSK31');messages.length=0;send({type:'audio',rate:8000,samples:dtmfSignal('C')});send({type:'flush'});assert.ok(!messages.map(m=>m.text||'').join('').includes('<DTMF>'));
session.dispose();
console.log('Passed: all 16 DTMF keys, chunk boundaries, repetition/flush, reset/switch exclusivity, squelch, tuning independence, and 8/44.1/48 kHz input.');
