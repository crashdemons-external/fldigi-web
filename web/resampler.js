// Streaming, band-limited sample-rate conversion for browser audio inputs.
// The decoder still receives its original fldigi sample rate and double precision DSP.
export class Resampler {
  constructor(inputRate, outputRate) {
    this.ratio = inputRate / outputRate;
    this.half = Math.ceil(16 * Math.max(1, this.ratio));
    this.position = this.half;
    this.buffer = new Float32Array(this.half);
    this.cutoff = 0.94 / Math.max(1, this.ratio);
    this.filters = Array.from({length:256}, (_,phase) => {
      const weights = new Float64Array(this.half * 2 + 1); let sum = 0;
      for (let j = -this.half; j <= this.half; j++) {
        const x = j - phase / 256, z = Math.PI * x * this.cutoff;
        const window = 0.42 + 0.5 * Math.cos(Math.PI * x / (this.half + 1)) + 0.08 * Math.cos(2 * Math.PI * x / (this.half + 1));
        const weight = Math.abs(z) < 1e-12 ? this.cutoff : this.cutoff * Math.sin(z) / z;
        weights[j + this.half] = weight * window; sum += weight * window;
      }
      for (let i = 0; i < weights.length; i++) weights[i] /= sum;
      return weights;
    });
  }
  process(samples) {
    const buffer = new Float32Array(this.buffer.length + samples.length);
    buffer.set(this.buffer); buffer.set(samples, this.buffer.length);
    const result = [];
    while (this.position + this.half < buffer.length) {
      const center = Math.floor(this.position), phase = Math.min(255, Math.floor((this.position - center) * 256));
      const weights = this.filters[phase]; let value = 0;
      for (let j = 0; j < weights.length; j++) value += buffer[center - this.half + j] * weights[j];
      result.push(value); this.position += this.ratio;
    }
    const used = Math.max(0, Math.floor(this.position) - this.half);
    this.buffer = buffer.slice(used); this.position -= used;
    return Float32Array.from(result);
  }
}
