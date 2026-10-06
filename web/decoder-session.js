import {Resampler} from './resampler.js';

export const options = {afc:0,sql:1,squelch:2,reverse:3,rttyShift:4,rttyBaud:5,rttyBits:6,rttyParity:7,rttyStop:8,lowercase:9,showChannels:12,
  lowCutoff:13,highCutoff:14,cwSpeed:15,cwBandwidth:16,cwTrack:17,cwMatched:18,cwRange:19,cwMin:20,cwMax:21,cwFilter:22,cwSom:23,
  hellAgc:24,hellWidth:25,hellHeight:26,hellBandwidth:27,hellBlackboard:28,ifkpBaud:29,ifkpLowercase:30,
  oliviaBandwidth:31,oliviaTones:32,oliviaIntegration:33,oliviaMargin:34,contestiaBandwidth:35,contestiaTones:36,contestiaIntegration:37,contestiaMargin:38,wefaxLpm:39,fsqBaud:43,
  rttyAfcSpeed:45,rttyCustomShift:46,mt63Integration:47,mt638bit:48,dominoFec:49,dominoFilter:50,dominoBandwidth:51,pskSearchRange:52,fsqMovingAverage:53,fsqPeakHits:54,fsqLowercase:55,wfWindow:56,wfLatency:57,dtmfToneMs:58,dtmfGapMs:59};

export function createDecoderSession(core, send) {
  const modes=JSON.parse(core.UTF8ToString(core._web_modes()));
  const block=core._malloc(512*4);
  let settings={},mode,resampler,inputRate,pending=new Float32Array(0),samplesProcessed=0,sequence=0,generation=0;
  const read=fn=>core.UTF8ToString(fn());
  function resetStream(){resampler=undefined;pending=new Float32Array(0);samplesProcessed=0;}
  function metadata(){return {generation,sequence,rate:core._web_sample_rate(),frequency:core._web_frequency(),bandwidth:core._web_bandwidth(),geometry:JSON.parse(read(core._web_waterfall_geometry)),scope:JSON.parse(read(core._web_scope)),status1:read(core._web_status1),status2:read(core._web_status2),imageWidth:core._web_image_width(),imageHeight:core._web_image_height(),imageSerial:core._web_image_serial()};}
  function configure(data){
    if(data.generation!==generation)return;
    const next={...settings,...data.settings};const candidate=modes.find(m=>m.id===next.mode&&m.enabled);
    if(!candidate)throw new Error('This receive mode is unavailable in the browser.');
    const changed=mode!==next.mode;
    if(changed){if(!core._web_create(next.mode))throw new Error('Cannot initialize the selected receive mode.');mode=next.mode;resetStream();}
    for(const [key,index]of Object.entries(options)){
      if(next[key]===undefined)continue;
      // Named variants own their native tone count and bandwidth.
      if([31,32].includes(index)&&candidate.name!=='OLIVIA')continue;
      if([35,36].includes(index)&&candidate.name!=='CONTESTIA')continue;
      core._web_set_option(index,Number(next[key]));
    }
    core._web_set_option(44,next.sideband==='LSB'?0:1);
    if(changed||data.retune)core._web_set_frequency(next.frequency??1500);
    else if(next.lowCutoff!==settings.lowCutoff||next.highCutoff!==settings.highCutoff)core._web_set_frequency(core._web_frequency());
    if(next.channelSquelch!==undefined)core._web_set_option(10,next.channelSquelch);
    settings=next;sequence=data.sequence;send({type:'configured',...metadata()});
  }
  function report(){
    const pointer=core._web_spectrum();const spectrum=core.HEAPF32.slice(pointer/4,pointer/4+core._web_spectrum_size());
    const rp=core._web_take_raster(),raster=core.HEAPU8.slice(rp,rp+core._web_raster_size());
    const ip=core._web_take_image_updates(),imageUpdates=core.HEAPU32.slice(ip/4,ip/4+core._web_image_updates_size());
    send({type:'decoded',...metadata(),text:read(core._web_take_text),secondary:read(core._web_take_secondary),metric:core._web_metric(),channels:JSON.parse(read(core._web_channels)),spectrum,samplesProcessed,raster,rasterHeight:core._web_raster_height(),imageUpdates},[spectrum.buffer,raster.buffer,imageUpdates.buffer]);
  }
  function process(data){
    const rate=data.rate*(1+(settings.rxPpm||0)/1e6);
    if(!resampler||inputRate!==rate){inputRate=rate;resampler=new Resampler(rate,core._web_sample_rate());}
    const samples=resampler.process(data.samples);const joined=new Float32Array(pending.length+samples.length);joined.set(pending);joined.set(samples,pending.length);
    let offset=0;while(offset+512<=joined.length){core.HEAPF32.set(joined.subarray(offset,offset+512),block/4);core._web_process(block,512);offset+=512;samplesProcessed+=512;}
    pending=joined.slice(offset);if(offset)report();
  }
  return {
    handle(data){
      if(data.type==='reset'){if(data.generation<generation)return;generation=data.generation;core._web_reset();resetStream();return;}
      if(data.generation!==generation)return;
      if(data.type==='configure')configure(data);
      else if(data.type==='audio')process(data);
      else if(data.type==='clear-channels')core._web_set_option(11,0);
      else if(data.type==='flush'){core._web_flush();report();}
      else if(data.type==='fax-action'){core._web_set_option(data.action,0);report();}
    },
    dispose(){core._free(block);},
  };
}
