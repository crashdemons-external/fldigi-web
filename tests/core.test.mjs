import assert from 'node:assert/strict';
import fs from 'node:fs';
import createCore from '../web/fldigi-core.js';

const core = await createCore();
const modes = JSON.parse(core.UTF8ToString(core._web_modes()));
const enabled = modes.filter(mode => mode.enabled);
assert.ok(enabled.length >= 100);
const block = core._malloc(512 * 4);
function feed(samples) {
  for (let offset = 0; offset < samples.length; offset += 512) {
    const chunk = samples.subarray(offset, offset + 512);
    core.HEAPF32.set(chunk, block / 4);
    core._web_process(block, chunk.length);
  }
}
for (const mode of enabled) {
  assert.ok(core._web_create(mode.id) > 0, mode.name);
  feed(new Float32Array(1024));
  assert.ok(Number.isFinite(core._web_metric()), mode.name);
}
function readWav(path) {
  const bytes = fs.readFileSync(new URL(path, import.meta.url));
  const pcm = new Float32Array((bytes.length - 44) / 2);
  for (let i = 0; i < pcm.length; i++) pcm[i] = bytes.readInt16LE(44 + i * 2) / 32768;
  return pcm;
}
for (const [name, file] of [['BPSK31', 'bpsk31.wav'], ['RTTY', 'rtty.wav'], ['CW','cw.wav']]) {
  const mode = modes.find(mode => mode.name === name);
  assert.ok(mode, name);
  core._web_create(mode.id);
  core._web_set_frequency(1500);
  core._web_set_option(0, 0);
  core._web_set_option(1, 0);
  if (name === 'RTTY') core._web_set_option(5, 1);
  feed(readWav(`./fixtures/${file}`));
  const text = core.UTF8ToString(core._web_take_text());
  console.log(`${name}: ${JSON.stringify(text)}`);
  assert.ok(text.includes('CQ CQ DE WEBTEST 12345'), `${name} failed to decode the known message`);
}
const rtty = modes.find(mode => mode.name === 'RTTY');
core._web_set_option(44, 1); // USB
core._web_set_option(3, 0); // Rv off
core._web_set_option(5, 1);
core._web_create(rtty.id);
core._web_set_frequency(1500);
const rttyAudio = readWav('./fixtures/rtty.wav');
feed(rttyAudio);
assert.ok(core.UTF8ToString(core._web_take_text()).includes('CQ CQ DE WEBTEST 12345'));
core._web_set_option(44, 0); // Switch to LSB without restarting the decoder.
feed(rttyAudio);
assert.ok(!core.UTF8ToString(core._web_take_text()).includes('CQ CQ DE WEBTEST 12345'));
core._web_set_option(3, 1); // Rv cancels the sideband inversion.
feed(rttyAudio);
assert.ok(core.UTF8ToString(core._web_take_text()).includes('CQ CQ DE WEBTEST 12345'));
core._web_set_option(44, 1);
core._web_set_option(3, 0);
core._web_set_frequency(1750);core._web_reset();assert.equal(core._web_frequency(),1750,'Seeking must preserve tuning');
core._web_set_option(13,500);core._web_set_option(14,3500);
core._web_create(modes.find(mode=>mode.name==='OFDM3500').id);
core._web_set_frequency(1500);assert.equal(core._web_frequency(),2000,'A mode wider than the passband must stay centered');
core._free(block);
console.log(`Passed: ${enabled.length} mode initialization checks, BPSK31/RTTY/CW decoding, live USB/LSB polarity, and tuning preservation.`);
