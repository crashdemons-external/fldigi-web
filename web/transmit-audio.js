// Plain PCM WAV needs no recorder, codec package or installed audio backend.
export function pcm16(samples){
  const bytes=new Uint8Array(samples.length*2),view=new DataView(bytes.buffer);
  for(let i=0;i<samples.length;i++){
    const value=Number.isFinite(samples[i])?Math.max(-1,Math.min(1,samples[i])):0;
    view.setInt16(i*2,Math.round(value*(value<0?32768:32767)),true);
  }
  return bytes;
}
export function wavBlob(chunks,sampleCount,rate){
  const header=new Uint8Array(44),view=new DataView(header.buffer);
  const ascii=(offset,text)=>{for(let i=0;i<text.length;i++)header[offset+i]=text.charCodeAt(i);};
  ascii(0,'RIFF');view.setUint32(4,36+sampleCount*2,true);ascii(8,'WAVE');ascii(12,'fmt ');
  view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);
  view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);
  ascii(36,'data');view.setUint32(40,sampleCount*2,true);
  return new Blob([header,...chunks],{type:'audio/wav'});
}
export function prepareTransmitText(text,mode,settings){
  if(!mode?.enabled||mode.family==='WEFAX')throw new Error('This mode requires an image; text audio generation is unavailable.');
  let normalized=String(text).replace(/\r\n?/g,'\n');
  if(['IFKP','FSQ'].includes(mode.family)&&normalized.includes('<MYCALL>')){
    const callsign=settings.callsign?.trim();
    if(!callsign)throw new Error('Set your callsign under Configure → Operator-Station before using <MYCALL>.');
    const lowercase=mode.family==='IFKP'?settings.ifkpLowercase:settings.fsqLowercase;
    normalized=normalized.replaceAll('<MYCALL>',lowercase?callsign.toLowerCase():callsign.toUpperCase());
  }
  if(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(normalized))throw new Error('Remove control characters from the transmit text.');
  normalized=normalized.replace(/\t/g,'    ');
  const asciiOnly=['CW','Throb','Contestia','IFKP','FSQ','NAVTEX'].includes(mode.family)||mode.family==='RTTY'&&settings.rttyBits!==2||mode.family==='MT63'&&!settings.mt638bit;
  if(asciiOnly&&/[^\x0a\x20-\x7e]/.test(normalized))throw new Error('This mode requires ASCII text. Remove accented characters and emoji, or choose an 8-bit text mode.');
  if(mode.family==='DTMF'){
    normalized=normalized.toUpperCase();
    if(/[^0-9A-D*# ,\-\n]/.test(normalized))throw new Error('DTMF accepts 0–9, A–D, * and #; spaces, commas and hyphens insert pauses.');
    normalized=normalized.replace(/\n/g,' ');
  }
  if(mode.family==='RTTY'&&settings.rttyBits===0||mode.family==='NAVTEX'){
    normalized=normalized.toUpperCase();
    // The port uses the original default USTTY figures tables, not ITA2.
    if(/[^A-Z0-9 \n!"#$&'(),.\/:;?\-]/.test(normalized))throw new Error('This Baudot mode cannot represent one or more characters in the message.');
  }
  if(mode.family==='Throb'){
    normalized=normalized.toUpperCase();
    const charset=mode.name.startsWith('THRBX')?/[^A-Z0-9 \n,.'\/()#"+\-;:?!@=]/:/[^A-Z0-9 \n,.'\/()?@\-]/;
    if(charset.test(normalized))throw new Error('This Throb mode cannot represent one or more characters in the message.');
  }
  if(new TextEncoder().encode(normalized).length>100000)throw new Error('A message is limited to 100,000 UTF-8 bytes.');
  return normalized;
}

// Schedule short modem buffers against the Web Audio clock. Only a small
// lookahead is requested from the worker; no session recording accumulates.
export function createTransmitPlayback(context,volume=0.5,ppm=0){
  const gain=context.createGain(),sources=new Set();gain.gain.value=volume;gain.connect(context.destination);
  const spectra=[];
  const speed=1+ppm/1e6;
  let end=context.currentTime+0.12,start=end,stopped=false;
  return {
    push(samples,rate,spectrum){
      if(stopped||!samples.length)return;
      const buffer=context.createBuffer(1,samples.length,rate);buffer.getChannelData(0).set(samples);
      const source=context.createBufferSource();source.buffer=buffer;source.playbackRate.value=speed;source.connect(gain);
      end=Math.max(end,context.currentTime+0.02);source.start(end);end+=samples.length/rate/speed;
      // Analysis includes this buffer's samples: display it when they have played,
      // rather than drawing the worker's lookahead before the sound is audible.
      if(spectrum)spectra.push({time:end,spectrum,rate:rate*speed});
      sources.add(source);source.onended=()=>{source.disconnect();sources.delete(source);};
    },
    get buffered(){return Math.max(0,end-context.currentTime);},
    get elapsed(){return Math.max(0,context.currentTime-start);},
    takeSpectra(){const ready=[];while(spectra.length&&spectra[0].time<=context.currentTime)ready.push(spectra.shift());return ready;},
    setVolume(value){gain.gain.value=value;},
    stop(){stopped=true;spectra.length=0;for(const source of sources){source.onended=null;source.stop();source.disconnect();}sources.clear();gain.disconnect();},
  };
}
