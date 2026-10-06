import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import createCore from '../web/fldigi-core.js';
import {createEncoderSession} from '../web/encoder-session.js';
import {createDecoderSession} from '../web/decoder-session.js';
import {defaults} from '../web/configuration.js';

// Exercise generated Hell audio through the receiver and the actual browser
// renderer. The reference is fldigi's Raster::data pixel placement, where the
// first received pixel belongs at the bottom of the displayed column.
const app=fs.readFileSync(new URL('../web/app.js',import.meta.url),'utf8');
const draw=app.slice(app.indexOf('function drawRaster('),app.indexOf('function drawPicture('));
const txCore=await createCore(),rxCore=await createCore();
const modes=JSON.parse(txCore.UTF8ToString(txCore._web_modes()));
let audio=[],reports=[];
const tx=createEncoderSession(txCore,data=>{if(data.samples?.length)audio.push(data.samples);});
const rx=createDecoderSession(rxCore,data=>{if(data.raster?.length)reports.push(data);});
let job=0;
for(const name of ['FELDHELL','FSKH105','FSKH245','HELL80']){
  job++;audio=[];reports=[];
  const settings={...defaults,mode:modes.find(mode=>mode.name===name).id,sql:false,afc:false};
  tx.handle({type:'start',job,text:'F L P TEST',settings});
  let done=false;
  // Pull until the native modem finishes. The final empty pull is observed
  // through web_tx_done rather than relying on the number of generated chunks.
  for(let i=0;i<10000&&!done;i++){
    tx.handle({type:'pull',job,maximum:512});done=!!txCore._web_tx_done();
  }
  assert.ok(done,`${name}: generation completed`);
  rx.handle({type:'reset',generation:job});
  rx.handle({type:'configure',generation:job,sequence:job,settings});
  for(const samples of audio)rx.handle({type:'audio',generation:job,rate:txCore._web_sample_rate(),samples});
  rx.handle({type:'flush',generation:job});
  assert.ok(reports.length,`${name}: receiver emitted raster columns`);
  const painted=[];
  const ctx={fillRect(){},drawImage(){},createImageData:(_w,h)=>({data:new Uint8ClampedArray(h*4)}),putImageData:(image,x,y)=>painted.push({image,x,y})};
  const canvas={clientWidth:10000,clientHeight:200,width:0,height:0,getContext:()=>ctx};
  const context=vm.createContext({rasterCanvas:canvas,rasterX:0,rasterY:0,Math});
  vm.runInContext(draw,context);
  let asymmetric=false;
  for(const report of reports){
    context.columns=report.raster;context.height=report.rasterHeight;
    const before=painted.length;
    vm.runInContext('drawRaster(columns,height)',context);
    assert.equal(painted.length-before,report.raster.length/report.rasterHeight);
    for(let offset=0;offset<report.raster.length;offset+=report.rasterHeight){
      const {image}=painted[before+offset/report.rasterHeight];
      for(let receivedRow=0;receivedRow<report.rasterHeight;receivedRow++){
        const displayRow=report.rasterHeight-receivedRow-1;
        const value=report.raster[offset+receivedRow];
        asymmetric ||= value!==report.raster[offset+displayRow];
        assert.equal(image.data[displayRow*4],value,`${name}: native bottom-to-top column must display upright`);
        assert.equal(image.data[displayRow*4+3],255);
      }
    }
  }
  assert.ok(asymmetric,`${name}: test glyphs must distinguish upright and flipped raster`);
}
rx.dispose();
console.log('Passed: generated Feld Hell, FSK Hell-105/245 and Hell-80 render with the original fldigi vertical orientation.');
