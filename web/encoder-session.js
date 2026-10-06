import {options} from './decoder-session.js';

export function createEncoderSession(core,send){
  const modes=JSON.parse(core.UTF8ToString(core._web_modes()));
  let job,rate,total=0,limit,bytes=0,live=false,spectrumAt=0;
  function textCall(fn,text,...args){
    const encoded=new TextEncoder().encode(text),pointer=core._malloc(encoded.length+1);
    if(!pointer)throw new Error('Not enough memory to encode this message.');
    try{core.HEAPU8.set(encoded,pointer);core.HEAPU8[pointer+encoded.length]=0;return fn(pointer,...args);}
    finally{core._free(pointer);}
  }
  return {handle(data){
    if(data.type==='start'){
      job=data.job;total=0;spectrumAt=0;live=!!data.live;bytes=new TextEncoder().encode(data.text).length;
      if(bytes>100000)throw new Error('A message is limited to 100,000 UTF-8 bytes.');
      const settings=data.settings,mode=modes.find(m=>m.id===settings.mode&&m.enabled);
      if(!mode||!core._web_tx_supported(mode.id))throw new Error('This mode cannot generate text audio.');
      // Configure before and after construction: some constructors initialize
      // their transmit codec from the upstream configuration defaults.
      const configure=()=>{for(const [key,index]of Object.entries(options)){
        if(settings[key]===undefined)continue;
        if([31,32].includes(index)&&mode.name!=='OLIVIA')continue;
        if([35,36].includes(index)&&mode.name!=='CONTESTIA')continue;
        core._web_set_option(index,Number(settings[key]));
      }};
      configure();core._web_create(mode.id);configure();
      core._web_set_option(44,settings.sideband==='LSB'?0:1);
      core._web_set_frequency(settings.txFrequencyLock?settings.txFrequency:settings.frequency);
      rate=textCall(core._web_tx_begin,data.text,data.live?1:0,settings.txOffset||0);
      if(!rate)throw new Error('Cannot initialize the selected encoder.');
      limit=rate*1800;
      send({type:'started',job,rate,frequency:core._web_tx_frequency(),live:!!data.live});
      return;
    }
    if(data.job!==job)return;
    if(data.type==='append'){
      const count=new TextEncoder().encode(data.text).length;
      if(bytes+count>100000)throw new Error('A transmit session is limited to 100,000 UTF-8 bytes.');
      if(textCall(core._web_tx_append,data.text))bytes+=count;
      else send({type:'queue-closed',job});
    }else if(data.type==='finish')core._web_tx_finish();
    else if(data.type==='pull'){
      const length=core._web_tx_step(Math.min(8192,data.maximum||4096));
      if(length<0)throw new Error('The generated audio exceeds the 30-minute limit.');
      total+=length;if(total>limit)throw new Error('The generated audio exceeds the 30-minute limit.');
      const pointer=core._web_tx_buffer();
      const samples=core.HEAPF32.slice(pointer/4,pointer/4+length);
      const transfers=[samples.buffer];let spectrum;
      if(live&&total-spectrumAt>=512){
        spectrumAt=total-total%512;
        const fftPointer=core._web_spectrum();
        spectrum=core.HEAPF32.slice(fftPointer/4,fftPointer/4+core._web_spectrum_size());
        transfers.push(spectrum.buffer);
      }
      send({type:'samples',job,rate,samples,spectrum,total,cursor:core._web_tx_cursor(),ending:!!core._web_tx_ended(),done:!!core._web_tx_done()},transfers);
    }
  }};
}
