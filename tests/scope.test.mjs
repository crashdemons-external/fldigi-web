import assert from 'node:assert/strict';
import {createScope} from '../web/scope.js';

// Record the actual renderer's canvas commands without adding a canvas package.
function canvas(width=158,height=120){
  const calls=[],listeners=new Map(),attributes=new Map();
  const ctx={};
  for(const method of ['fillRect','clearRect','beginPath','arc','moveTo','lineTo','stroke','drawImage','putImageData'])ctx[method]=(...args)=>calls.push({method,args});
  ctx.createImageData=(w,h)=>({data:new Uint8ClampedArray(w*h*4)});
  return {width,height,dataset:{},calls,listeners,attributes,getContext:()=>ctx,
    setAttribute:(key,value)=>attributes.set(key,value),addEventListener:(key,fn)=>listeners.set(key,fn)};
}
const previousDocument=globalThis.document;
globalThis.document={createElement:()=>canvas()};
function sample(mode,extra={}){return {mode,serial:1,phase:Math.PI/2,quality:.8,highlight:false,axis:0,trace:[],xy:[],video:[],videoSerial:0,videoDirection:false,...extra};}
try{
  // Rectangle proportions reproduce the clipped circle reported in Firefox.
  for(const [width,height]of [[158,90],[156,118],[115,190],[158,280]]){
    const c=canvas(width,height),scope=createScope(c);scope.update(sample(1));
    let arcs=c.calls.filter(call=>call.method==='arc');assert.equal(arcs.length,2,'phase graticule and idle center must be visible');
    for(const {args:[x,y,r]}of arcs){assert.equal(x,width/2);assert.equal(y,height/2);assert.ok(x-r>=0&&x+r<=width);assert.ok(y-r>=0&&y+r<=height);}
    c.calls.length=0;scope.update(sample(1,{highlight:true}));assert.ok(c.calls.some(call=>call.method==='lineTo'&&call.args[0]>width/2),'signal vector drawn');
    c.calls.length=0;scope.reset();assert.equal(c.dataset.scopeView,'2');assert.equal(c.attributes.get('aria-label'),'Signal phase');
    arcs=c.calls.filter(call=>call.method==='arc');assert.equal(arcs.length,2,'audio reset must keep the phase graticule with no old vector');
    c.calls.length=0;c.height=80;scope.draw();assert.ok(c.calls.filter(call=>call.method==='arc').every(({args:[,y,r]})=>y===40&&y-r>=0&&y+r<=80),'resize centers within the new box');
  }
  for(const [mode,label]of [[0,'Signal waveform'],[5,'RTTY waveform'],[8,'Modem timing waveform']]){
    const c=canvas(),scope=createScope(c);scope.update(sample(mode));
    assert.equal(c.attributes.get('aria-label'),label);assert.ok(c.calls.some(call=>call.method==='lineTo'),'native zero buffer has a visible idle baseline');
    c.calls.length=0;scope.update(sample(mode,{trace:[0,.5,1]}));assert.ok(c.calls.some(call=>call.method==='lineTo'));
    c.calls.length=0;scope.reset();assert.equal(c.dataset.scopeView,String(mode));assert.ok(c.calls.some(call=>call.method==='lineTo'));
  }
  const c=canvas(),scope=createScope(c);scope.update(sample(5,{trace:[-.5,0,.5],xy:[0,0,1,1]}));c.listeners.get('click')();assert.equal(c.dataset.scopeView,'6');
  c.calls.length=0;scope.reset();assert.equal(c.dataset.scopeView,'6','audio reset preserves the selected crosshair view');assert.ok(c.calls.some(call=>call.method==='lineTo'),'crosshair graticule survives reset');
  scope.update(sample(5,{serial:2}));assert.equal(c.dataset.scopeView,'6','fresh reset metadata keeps the compatible selected view');
  c.calls.length=0;scope.update(sample(10,{serial:3}));assert.equal(c.dataset.scopeView,'10');assert.ok(!c.calls.some(call=>['arc','lineTo'].includes(call.method)),'native blank modes must stay blank');
}finally{if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;}
console.log('Passed: phase-circle bounds/resize, signal vectors, idle waveform baselines, reset graticules, crosshair selection, and native blank modes.');
