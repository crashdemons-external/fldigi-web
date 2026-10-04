// Capture exact PCM blocks away from the browser UI thread.
class FldigiInput extends AudioWorkletProcessor {
  constructor(options) {
    super(); this.channel = options.processorOptions?.channel ?? 'left';
    this.active = options.processorOptions?.active ?? true;
    this.generation = options.processorOptions?.generation ?? 0;
    this.block = new Float32Array(2048); this.used = 0;
    this.port.onmessage = ({data}) => {
      if(data.command==='reset'){
        if(data.generation<this.generation)return;
        this.generation=data.generation;this.block=new Float32Array(2048);this.used=0;this.active=Boolean(data.active);return;
      }
      if(data.generation!==this.generation)return;
      if (data.channel) this.channel = data.channel;
      if (data.command === 'flush') {
        if(this.used){const samples=this.block.slice(0,this.used);this.port.postMessage({samples,rate:sampleRate,generation:this.generation},[samples.buffer]);}
        this.block=new Float32Array(2048);this.used=0;this.active=false;
        this.port.postMessage({type:'flushed',finished:data.finished,generation:this.generation});
      }
      if(data.active !== undefined)this.active=data.active;
    };
  }
  process(inputs, outputs) {
    const input = inputs[0]; if (!this.active || !input?.length) return true;
    const left = input[0], right = input[1] || left;
    const output = outputs[0];
    for (let i = 0; i < left.length; i++) {
      const sample = this.channel === 'right' ? right[i] : this.channel === 'mix' ? (left[i] + right[i]) / 2 : left[i];
      this.block[this.used++] = sample;
      if (output?.[0]) output[0][i] = sample;
      if (this.used === this.block.length) {
        this.port.postMessage({samples:this.block, rate:sampleRate,generation:this.generation}, [this.block.buffer]);
        this.block = new Float32Array(2048); this.used = 0;
      }
    }
    return true;
  }
}
registerProcessor('fldigi-input', FldigiInput);
