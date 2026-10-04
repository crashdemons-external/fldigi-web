// Independent telephone keypad signal, not fldigi's tone generator.
const keys='123A456B789C*0#D',rows=[697,770,852,941],columns=[1209,1336,1477,1633];
export function dtmfSignal(text,{rate=8000,toneMs=150,gapMs=60,tailMs=350,amplitude=.3}={}){
  const tone=Math.round(rate*toneMs/1000),gap=Math.round(rate*gapMs/1000);
  const pcm=new Float32Array(text.length*(tone+gap)+Math.round(rate*tailMs/1000));
  for(let k=0;k<text.length;k++){
    const index=keys.indexOf(text[k]);if(index<0)throw new Error('Invalid test DTMF digit');
    const row=rows[Math.floor(index/4)],column=columns[index%4],start=k*(tone+gap);
    for(let i=0;i<tone;i++)pcm[start+i]=amplitude*(Math.sin(2*Math.PI*row*i/rate)+Math.sin(2*Math.PI*column*i/rate));
  }
  return pcm;
}
