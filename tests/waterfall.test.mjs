import assert from 'node:assert/strict';
import createCore from '../web/fldigi-core.js';
import {clampTuningFrequency, pointerFrequency, positionMarkers, snapMarkerPositions} from '../web/waterfall-geometry.js';
import {rttyPresets} from '../web/rtty-presets.js';

const core=await createCore();
const modes=JSON.parse(core.UTF8ToString(core._web_modes()));
const geometry=()=>JSON.parse(core.UTF8ToString(core._web_waterfall_geometry()));
const create=name=>{const mode=modes.find(mode=>mode.name===name);assert.ok(mode,name);core._web_create(mode.id);return geometry();};
core._web_set_option(13,0);core._web_set_option(14,4000);

// RTTY tone centers are separated by the shift; each top bar covers the
// original baud*2 receive filter. Narrow and wide use the same 75 baud modem.
create('RTTY');
const expected=[
  {bandwidth:170,bands:[[-130,-39],[39,130]],status:'45.45/170'},
  {bandwidth:170,bands:[[-135,-35],[35,135]],status:'50 /170'},
  {bandwidth:170,bands:[[-160,-10],[10,160]],status:'75 /170'},
  {bandwidth:850,bands:[[-500,-350],[350,500]],status:'75 /850'},
  {bandwidth:170,bands:[[-185,15],[-15,185]],status:'100/170'},
];
for(const [index,preset]of rttyPresets.entries()){
  for(const [key,value]of [[4,preset.rttyShift],[5,preset.rttyBaud],[6,preset.rttyBits]])core._web_set_option(key,value);
  core._web_set_frequency(1500);
  assert.equal(core._web_bandwidth(),expected[index].bandwidth,preset.label);
  assert.deepEqual(geometry().bands,expected[index].bands,preset.label);
  assert.equal(core.UTF8ToString(core._web_status1()).trim(),expected[index].status,preset.label);
  const markers=positionMarkers(geometry(),1500,1000,1000,800);
  assert.equal((markers.tracks[0]+markers.tracks[1])/2,markers.center,preset.label+' must be centered');
}
// The native init status must survive creation, even before any audio arrives.
core._web_create(modes.find(mode=>mode.name==='RTTY').id);
assert.ok(core.UTF8ToString(core._web_status1()).includes('100'));

const psk=create('BPSK31');
assert.deepEqual(psk.tracks,[-15,15]);
assert.deepEqual(psk.bands,[[-41,41]],'PSK top marker includes the native 50 Hz search range');
const mt63=modes.find(mode=>mode.name==='MT63-2KL');
assert.ok(mt63);core._web_create(mt63.id);
assert.deepEqual(geometry().bands,[[-1001,969]],'MT63 has one bar with the native upper-edge adjustment');
assert.deepEqual(geometry().tracks,[-1000,968]);
const fsq=create('FSQ');
const bw=Math.trunc(core._web_bandwidth());
assert.deepEqual(fsq.tracks,[-Math.trunc(69*bw/100),Math.trunc(69*bw/100)]);

// Mouse x denotes the center, including a zoomed/offset frequency scale.
const tuned=pointerFrequency(120,800,1000,1000,170,0,4000);
assert.equal(tuned,1150);
const centered=positionMarkers({bands:[[-160,-10],[10,160]],tracks:[-85,85],hover:[-85,85],markerEdges:[-86,86]},tuned,1000,1000,800);
assert.equal(centered.center,120);assert.equal((centered.tracks[0]+centered.tracks[1])/2,120);
assert.equal(pointerFrequency(0,800,0,4000,2000,0,4000),1000);
assert.equal(pointerFrequency(800,800,0,4000,2000,0,4000),3000);
assert.equal(clampTuningFrequency(1500,3500,500,3500),2000);

// Rasterized bars and thin/wide tracks must share the triangle's pixel center,
// even where separately rounded absolute edges used to differ by a pixel.
for(const width of [233,515,1000.25])for(const range of [4000,2000,1000])for(const x of [110,110.25,110.5,110.75]){
  for(const shape of [psk,{bands:[[-185,15],[-15,185]],tracks:[-85,85],hover:[-85,85],markerEdges:[-86,86]}]){
    const frequency=pointerFrequency(x,width,1000,range,0,0,8000);
    const pixels=snapMarkerPositions(positionMarkers(shape,frequency,1000,range,width));
    assert.ok(Math.abs(pixels.center-x)<=0.5,'Center stays within the clicked pixel');
    for(const edges of [pixels.tracks,pixels.hover,pixels.markerEdges])assert.equal((edges[0]+edges[1])/2,pixels.center);
    const bands=pixels.bands;
    assert.equal((bands[0][0]+bands.at(-1)[1])/2,pixels.center,'Outer red edges center on the arrow');
    if(bands.length===2)assert.equal(bands[0][1]-bands[0][0],bands[1][1]-bands[1][0],'RTTY bars have equal widths');
    for(const [low,high]of bands)assert.ok(Number.isInteger(low-0.5)&&Number.isInteger(high-low+1));
  }
}
const halfPixel=snapMarkerPositions({center:110.25,bands:[[99.75,120.75]],tracks:[107.75,112.75],hover:[],markerEdges:[]});
assert.deepEqual(halfPixel.tracks,[107.5,113.5],'Half-pixel offsets round equally on both sides');
const asymmetric=snapMarkerPositions(positionMarkers({bands:[[-1001,969]],tracks:[-1000,968],hover:[],markerEdges:[]},1500,0,4000,800));
assert.ok(asymmetric.center-asymmetric.tracks[0]>asymmetric.tracks[1]-asymmetric.center,'Preserve native asymmetric MT63 geometry');
for(const mode of modes.filter(mode=>mode.enabled)){
  core._web_create(mode.id);const shape=geometry();
  if(mode.name==='DTMF'){assert.deepEqual(shape,{bands:[],tracks:[],hover:[],markerEdges:[]},'fixed DTMF tones have no tuning markers');continue;}
  assert.ok(shape.bands.length>=1&&shape.bands.flat().every(Number.isFinite),mode.name);
  assert.ok(shape.tracks.every(Number.isFinite)&&shape.hover.every(Number.isFinite),mode.name);
}
console.log('Passed: original RTTY presets, native geometry, pixel-centered markers, mouse centering, zoom offsets, and cutoff bounds.');
