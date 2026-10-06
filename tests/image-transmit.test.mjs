import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import createCore from '../web/fldigi-core.js';
import {createEncoderSession} from '../web/encoder-session.js';
import {defaults} from '../web/configuration.js';
import {imageFormats,imagePlan,supportsImageTransmit} from '../web/transmit-image.js';

const core=await createCore(),rx=await createCore();
const modes=JSON.parse(core.UTF8ToString(core._web_modes()));
const mode=name=>modes.find(m=>m.name===name);
let job=0,messages=[];
const encoder=createEncoderSession(core,message=>messages.push(message));
function image(name,format,width=32,height=24,spp=8){
  const m=mode(name);
  const plan=imagePlan(m,width,height,{format,width,spp,callsign:'w1abc'});
  // Tiny fax fixture: its width remains defined by IOC, with eight lines.
  if(m.family==='WEFAX')plan.height=8;
  const pixels=new Uint8Array(plan.width*plan.height*3);
  for(let y=0;y<plan.height;y++)for(let x=0;x<plan.width;x++){
    const i=(y*plan.width+x)*3;
    // Broad color bands reveal row/channel ordering after FM filtering.
    pixels[i]=x<plan.width/2?220:40;
    pixels[i+1]=y<plan.height/2?180:70;
    pixels[i+2]=x<plan.width/2?30:210;
  }
  return {...plan,pixels};
}
function render(name,input,maximum=8192,live=false,settings={}){
  job++;messages=[];
  encoder.handle({type:'start',job,text:'',image:input,live,settings:{...defaults,mode:mode(name).id,...settings}});
  assert.equal(messages.at(-1).type,'started');
  const {rate,frequency}=messages.at(-1),chunks=[];let data,count=0;
  for(let step=0;step<100000;step++){
    encoder.handle({type:'pull',job,maximum});data=messages.at(-1);
    assert.ok(data.samples.length<=maximum);assert.ok(data.samples.every(Number.isFinite));
    if(data.samples.length){chunks.push(data.samples);count+=data.samples.length;}
    if(data.done)break;
  }
  assert.ok(data.done,`${name}: finite image must finish automatically`);
  assert.ok(count>rate,`${name}: missing image/header audio`);
  const samples=new Float32Array(count);let offset=0;for(const part of chunks){samples.set(part,offset);offset+=part.length;}
  assert.ok(samples.some(v=>Math.abs(v)>.05),`${name}: silent image`);
  return {samples,rate,frequency};
}
const block=rx._malloc(512*4);
function decode(name,{samples,rate},frequency=name.startsWith('WEFAX')?1900:1500){
  rx._web_create(mode(name).id);rx._web_set_frequency(frequency);
  rx._web_set_option(0,0);rx._web_set_option(1,0);
  if(name==='FSQ')rx._web_set_option(43,3);
  const all=new Float32Array(samples.length+rate*4);all.set(samples);
  let updates=0,picture;
  for(let offset=0;offset<all.length;offset+=512){
    const part=all.subarray(offset,offset+512);rx.HEAPF32.set(part,block/4);rx._web_process(block,part.length);
    const pointer=rx._web_take_image_updates(),length=rx._web_image_updates_size();
    if(length){
      if(!picture||picture.length!==rx._web_image_width()*rx._web_image_height()*3)picture=new Uint8Array(rx._web_image_width()*rx._web_image_height()*3);
      for(let i=0;i<length;i+=2)picture[rx.HEAPU32[pointer/4+i]]=rx.HEAPU32[pointer/4+i+1];
      updates+=length/2;
    }
  }
  return {updates,picture,width:rx._web_image_width(),height:rx._web_image_height(),text:rx.UTF8ToString(rx._web_take_text())};
}
// Recorded by building the supplied original monolithic image loops with the
// same browser adapters. Yielding must not change their wire audio or phase.
const desktopHashes={MFSK16:'80ea5448ec171337d7127f414ec988bad309a0400a087b324f7197116b1382ec',THOR16:'7e3d3982fc3321004f54d8d2cdf01b365f97499905649f1f8b7e7db03ee72b54',IFKP:'2c10cddca983b6d4417abebf3f6d0af46120dd4102283a6fad35247a18afe524',FSQ:'2a306fec0b9dc92f0ef2cb2b7cfc39822aaa998517eba0809388c82eff09b6ee'};
for(const [name,format]of [['MFSK16','color'],['THOR16','0-color'],['IFKP','0-color'],['FSQ','6'],['WEFAX576','1'],['WEFAX288','3']]){
  const input=image(name,format),generated=render(name,input),decoded=decode(name,generated);
  if(desktopHashes[name])assert.equal(createHash('sha256').update(new Uint8Array(generated.samples.buffer)).digest('hex'),desktopHashes[name],`${name}: PCM differs from desktop modulation`);
  assert.equal(decoded.width,input.width,`${name}: image header width`);
  if(!name.startsWith('WEFAX'))assert.equal(decoded.height,input.height,`${name}: image header height`);
  assert.ok(decoded.updates>=input.width*input.height,`${name}: missing decoded pixels`);
  if(['MFSK16','IFKP'].includes(name)){
    for(const y of [.25,.75])for(const x of [.25,.75])for(let c=0;c<3;c++){
      const i=3*(Math.floor(y*input.height)*input.width+Math.floor(x*input.width))+c;
      assert.ok(Math.abs(decoded.picture[i]-input.pixels[i])<8,`${name}: decoded color/channel order`);
    }
  }
  if(name.startsWith('WEFAX')){
    const lpm=[240,120,90,60][input.format],expected=20+(input.height+21)*Math.floor(11025*60/lpm)/11025;
    assert.ok(Math.abs(generated.samples.length/generated.rate-expected)<.001,'native fax APT/phasing/image/stop timing');
  }
  assert.ok(core._web_tx_image_supported(mode(name).id));
}
const fixture=image('MFSK32','gray');
assert.deepEqual(render('MFSK32',fixture,512).samples,render('MFSK32',fixture,8192).samples,'image PCM is independent of pull size');
for(const spp of [2,4]){
  const fast=render('MFSK32',image('MFSK32','color',32,24,spp));
  assert.equal(decode('MFSK32',fast).width,32,`MFSK X${8/spp} image speed header`);
}
assert.equal(supportsImageTransmit(mode('BPSK31')),false);
assert.throws(()=>imagePlan(mode('IFKP'),200,100,{format:'bad'}),/supported image format/);
assert.throws(()=>imagePlan(mode('MFSK16'),100,100,{format:'color',width:4095}),/30-minute/);
assert.throws(()=>imagePlan(mode('FSQ'),100,100,{format:'0',callsign:''}),/callsign/);
assert.equal(imagePlan(mode('FSQ'),100,100,{format:'0',callsign:'W1ABC',lowercase:true}).callsign,'w1abc');
assert.equal(imagePlan(mode('FSQ'),100,100,{format:'0',callsign:'w1abc',lowercase:false}).callsign,'W1ABC');
for(const [name,format]of [['MFSK32','color'],['THOR16','0-color'],['IFKP','0-color']]){
  const shifted=render(name,image(name,format),8192,false,{txOffset:100});
  assert.equal(shifted.frequency,1400);assert.ok(decode(name,shifted,1400).updates>0,`${name}: image header and FM use the same offset carrier`);
}
const shiftedFsq=render('FSQ',image('FSQ','7'),8192,false,{txOffset:100});
const lastGrayPixels=shiftedFsq.samples.slice(-64-512,-64);let crossings=0;
for(let i=1;i<lastGrayPixels.length;i++)if(lastGrayPixels[i-1]<0&&lastGrayPixels[i]>=0)crossings++;
assert.ok(Math.abs(crossings*shiftedFsq.rate/512-1312.5)<25,'FSQ image FM honors the existing TX offset');
assert.equal(render('WEFAX576',image('WEFAX576','1'),8192,false,{txOffset:100}).frequency,1900,'WEFAX retains its standard carrier and APT tones');
// Every restored variant and each native fixed image format must terminate.
for(const m of modes.filter(m=>core._web_tx_image_supported(m.id)&&['MFSK','THOR'].includes(m.family)))render(m.name,image(m.name,m.family==='MFSK'?'gray':'0-gray'));
for(const name of ['IFKP','FSQ'])for(const format of imageFormats(mode(name)))render(name,image(name,format.value));
const liveImage=image('IFKP','0-gray');job++;messages=[];
encoder.handle({type:'start',job,text:'',image:liveImage,live:true,settings:{...defaults,mode:mode('IFKP').id}});
encoder.handle({type:'append',job,text:'MUST NOT APPEND'});assert.equal(messages.at(-1).type,'queue-closed','realtime image jobs cannot accept text');
let final,sawSpectrum=false;
for(let i=0;i<10000;i++){encoder.handle({type:'pull',job,maximum:512});final=messages.at(-1);sawSpectrum||=!!final.spectrum;if(final.done)break;}
assert.ok(final.done);assert.ok(sawSpectrum,'finite image realtime TX keeps its waterfall analysis');
rx._free(block);
console.log('Passed: native image PCM compatibility, all image variants/formats, WEFAX timing, image receive headers/pixels, color order, chunk continuity, validation and finite realtime waterfall.');
