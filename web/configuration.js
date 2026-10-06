export const defaults = {
  modeName:'BPSK31', frequency:1500, afc:true, sql:false, squelch:3, reverse:false, sideband:'USB',
  channelSquelch:-3, showChannels:true, showScope:true, reference:-20, span:70, magnification:1, speed:'NORM',
  callsign:'', operatorName:'', qth:'', locator:'', rxFont:'Courier New', rxFontSize:14, rxColor:'#fff3bd', txColor:'#c4ebfc', rxWrap:true,
  inputDevice:'default', channel:'left', rxPpm:0, inputGain:0, playbackVolume:0.5,
  txVolume:0.5,txPpm:0,txOffset:0,txFrequencyLock:false,txFrequency:1500,
  dtmfToneMs:50,dtmfGapMs:50,
  rttyShift:3, rttyBaud:1, rttyBits:0, rttyParity:0, rttyStop:1, lowercase:false,
  lowCutoff:0,highCutoff:4000,cwSpeed:18,cwBandwidth:150,cwTrack:true,cwMatched:false,cwRange:10,cwMin:5,cwMax:50,cwFilter:2,cwSom:false,
  hellAgc:2,hellWidth:2,hellHeight:20,hellBandwidth:245,hellBlackboard:false,fsqBaud:4.5,ifkpBaud:1,ifkpLowercase:true,
  oliviaBandwidth:2,oliviaTones:2,oliviaIntegration:4,oliviaMargin:8,contestiaBandwidth:2,contestiaTones:2,contestiaIntegration:4,contestiaMargin:8,wefaxLpm:1,
  useCursorLines:true,useCursorCenterLine:true,useWideCursor:false,useWideCenter:false,useBWTracks:true,useWideTracks:false,
  rttyAfcSpeed:1,rttyCustomShift:450,mt63Integration:false,mt638bit:true,dominoFec:false,dominoFilter:true,dominoBandwidth:2,
  pskSearchRange:50,fsqMovingAverage:4,fsqPeakHits:3,fsqLowercase:false,wfWindow:1,wfLatency:8,
};
export const storageKey = 'fldigi-web.configuration.v1';
export function validatedConfig(candidate) {
  const result = {...defaults};
  for (const [key,value] of Object.entries(candidate || {})) {
    if (!Object.hasOwn(defaults,key) || typeof value !== typeof defaults[key]) continue;
    if (typeof value === 'number' && !Number.isFinite(value)) continue;
    result[key] = value;
  }
  result.frequency = Math.max(0,Math.min(4000,result.frequency));
  result.span = Math.max(10,Math.min(150,result.span));result.reference=Math.max(-120,Math.min(30,result.reference));
  result.squelch=Math.round(Math.max(0,Math.min(100,result.squelch)));result.rxFontSize=Math.max(8,Math.min(32,result.rxFontSize));
  result.channelSquelch=Math.round(Math.max(-3,Math.min(6,result.channelSquelch))*10)/10;
  result.rxPpm=Math.max(-5000,Math.min(5000,result.rxPpm));result.inputGain=Math.max(-40,Math.min(40,result.inputGain));
  result.playbackVolume=Math.max(0,Math.min(1,result.playbackVolume));
  result.txVolume=Math.max(0,Math.min(1,result.txVolume));result.txPpm=Math.max(-5000,Math.min(5000,result.txPpm));
  result.txOffset=Math.max(-500,Math.min(500,result.txOffset));result.txFrequency=Math.max(0,Math.min(4000,result.txFrequency));
  result.callsign=result.callsign.trim().toUpperCase();
  if(!/^[A-Z0-9/]{0,32}$/.test(result.callsign))result.callsign=defaults.callsign;
  result.dtmfToneMs=Math.round(Math.max(40,Math.min(2000,result.dtmfToneMs)));
  result.dtmfGapMs=Math.round(Math.max(30,Math.min(2000,result.dtmfGapMs)));
  if(!['left','right','mix'].includes(result.channel))result.channel='left';
  if(!['USB','LSB'].includes(result.sideband))result.sideband='USB';
  if(!['NORM','FAST','SLOW'].includes(result.speed))result.speed='NORM';
  if(![1,2,4].includes(result.magnification))result.magnification=1;
  for(const key of ['rxColor','txColor'])if(!/^#[0-9a-f]{6}$/i.test(result[key]))result[key]=defaults[key];
  for(const [key,max] of [['rttyShift',10],['rttyBaud',9],['rttyBits',2],['rttyParity',4],['rttyStop',2],['rttyAfcSpeed',2],['wfWindow',4]])result[key]=Math.max(0,Math.min(max,Math.round(result[key])));
  if(![1.5,2,3,4.5,6].includes(result.fsqBaud))result.fsqBaud=defaults.fsqBaud;
  for(const [key,min,max]of [['lowCutoff',0,500],['highCutoff',3500,4000],['cwSpeed',5,100],['cwBandwidth',20,1000],['cwRange',1,40],['cwMin',5,50],['cwMax',5,100],['cwFilter',0,2],['hellAgc',1,3],['hellWidth',1,4],['hellHeight',14,42],['hellBandwidth',20,3000],['ifkpBaud',0,2],['oliviaBandwidth',0,4],['oliviaTones',0,5],['oliviaIntegration',1,8],['oliviaMargin',1,32],['contestiaBandwidth',0,4],['contestiaTones',0,5],['contestiaIntegration',1,8],['contestiaMargin',1,32],['wefaxLpm',0,3]])result[key]=Math.max(min,Math.min(max,result[key]));
  result.cwMax=Math.max(result.cwMin,result.cwMax);
  for(const [key,min,max]of [['rttyCustomShift',1,2000],['pskSearchRange',10,500],['fsqMovingAverage',1,15],['fsqPeakHits',3,6],['wfLatency',1,16]])result[key]=Math.round(Math.max(min,Math.min(max,result[key])));
  result.dominoBandwidth=Math.max(1,Math.min(2,result.dominoBandwidth));
  for(const key of ['cwFilter','hellAgc','hellWidth','hellHeight','ifkpBaud','oliviaBandwidth','oliviaTones','oliviaIntegration','contestiaBandwidth','contestiaTones','contestiaIntegration','wefaxLpm'])result[key]=Math.round(result[key]);
  return result;
}
