# fldigi web

Fldigi is a sound card software modem for amateur radio. This project ports selected fldigi receive decoders to the browser with Emscripten and presents them in an interface modeled closely on the desktop application. This README is adapted from the `README` in the supplied fldigi 4.2.13 source archive.

## What this port does

- Decodes audio from a local recording or a live microphone/audio input. The audio is processed in the browser.
- Provides a waterfall, audio-frequency tuning, received text, a channel view, and a configuration dialog styled after fldigi.
- Builds 163 receive modes from the supplied fldigi 4.2.13 C++ sources: CW, PSK/QPSK/8PSK/OFDM, RTTY, SCAMP, MFSK, THOR, DominoEX, Throb, MT63, Olivia, Contestia, NAVTEX/SITOR-B, FSQ, IFKP, Hellschreiber, and WEFAX.
- Adds an exclusive **DTMF** Op Mode around the original optional fldigi DTMF decoder.
- Displays Hellschreiber raster output and received modem images. **View → Received picture** opens the image window; **Save** downloads PNG. WEFAX supports skipping APT and phasing for incomplete recordings.
- Preserves the original streaming charset conversion, including UTF-8 and CP1252 fallback. Received backspaces edit complete characters on the current line, including text from earlier decoder reports.
- Saves configuration in browser local storage. Configuration import uses a JSON file picker; configuration and received-text exports download files.

This is a receive-only port. Transmission, rig control, native logbook integrations, FSQ directed commands/replies, and external-application connections are disabled in the interface. RSID detection and the desktop SSB/WWV/frequency-analysis/FMT utility modes are also disabled. Microphone capture and local-file playback are the two audio inputs.

The omitted utility modes were a first-pass scope choice, rather than a WebAssembly limitation. The upstream SSB mode has a dummy receive function; it does not decode speech or text. WWV monitors time-signal ticks for sound-card sample-clock calibration and needs its own scope/calibration controls. Frequency Analysis and FMT need measurement plots, logging/download adapters, and, for FMT, replacement of the native measurement thread. Their original sources remain in `vendor/fldigi` for a later port.

## Run the receiver as a web app

Python 3 is required for the included local server; alternatively you can copy the web/ folder to your host. The repository includes the generated browser core in `web/`, so a build is not needed just to run the receiver.

```sh
python scripts/serve.py
```

Open <http://localhost:8080> in a browser with WebAssembly and Web Audio support. On systems where Python is named `python3`, use that command instead. Node.js users can also run `npm start`; there are no npm package dependencies to install.

Choose **File → Audio → Playback (load audio file)** to open a recording, then press play. A PCM WAV file is a reliable starting point; other audio formats depend on browser support. For live input, click **Rx** or press **F3** and allow microphone access. Browser microphone capture requires localhost or HTTPS. Select a mode under **Op Mode**, then click the signal in the waterfall to tune it.

The **USB/LSB** selector sets receive polarity for fldigi modes that use sideband, and **Rv** flips that polarity again. Match it to the receiver mode used to make the audio. It does not control a radio; the adjacent rig-bandwidth selector remains disabled. The original WEFAX decoder does not use this sideband setting.

**Op Mode → DTMF**, below the separator at the bottom of the menu, decodes telephone keypad tones (`0–9`, `*`, `#`, `A–D`) from either audio input. It uses fldigi's original Goertzel detection and repeated-tone handling at 8 kHz, with output grouped as `<DTMF>` lines after a pause or the end of a recording. It is the only decoder active while selected; changing modes disables it and discards its buffered digits. Tuning markers, frequency controls, AFC, sideband and reverse are inactive in DTMF. The squelch threshold is always used by the original DTMF detector, so the SQL toggle is also grayed out. Saved tuning and toggle settings return when another mode is selected.

The waterfall includes the native bandwidth-marker strip above the spectrogram: two filter bars for RTTY, one for other receive modes, with fldigi's mode-specific widths. The receive tracks are centered on the tuned frequency. Hovering previews the prospective tuning with yellow marker tips and white edge/center lines; clicking tunes to that center, subject to the modem's frequency limits. The zoomed scale stays fixed while tuning. Cursor and track visibility/width can be changed under **Configure → Waterfall**.

Drag the small pill beside the detected-signal meter to adjust the **squelch threshold** from 0 to 100; moving upward raises the threshold. Arrow keys and the mouse wheel adjust it by one step (Shift + wheel by ten). The slider and numeric squelch field stay synchronized, and the value is saved in browser storage. The **SQL** button enables squelch gating.

The PSK channel squelch slider uses fldigi's **-3 to 6** range in 0.1 steps; imported configuration is clamped to the same range. **Lk** is disabled because the original control locks transmit frequency. The receive frequency and cursor continue to show the actual frequency tracked by AFC. Changing a display setting does not retune the decoder.

The docked scope follows the original modem callbacks: PSK phase views, RTTY waveform/crosshairs, CW and other waveform views, and DominoEX/THOR timing/waterfall views. Click the scope (or press Enter/Space when focused) to cycle the views supported by the active mode. Modes that blank the native scope also blank the browser scope, including Olivia, Contestia, MT63, Hellschreiber and SCAMP. Some other upstream modes have no scope-output implementation. Scope history clears on mode changes and audio resets; resets retain the view and its idle graticule. Waveforms use the original auto-scaling default, and the phase circle stays centered within rectangular browser layouts.

Configuration includes RTTY AFC speed/custom shift, MT63 long integration/8-bit reception, DominoEX FEC/filter/bandwidth factor, PSK search range, FSQ detector averaging/minimum hits, and the original FFT window/latency values. Named Olivia and Contestia variants retain their native bandwidth and tones when settings change; the generic modes use the saved custom values. Lower-case receive conversion is offered for the original RTTY, Throb, and Contestia implementations. IFKP/FSQ callsign conversion is a transmit option and is disabled.

Saving a different capture device while live automatically reopens capture for that exact device. An unavailable selected device reports an error instead of silently choosing another input. Seek, stop, source replacement, and mode changes discard partial audio blocks throughout the worklet/resampler/decoder pipeline; obsolete queued audio and reports are ignored. Pausing and resuming the same recording preserves decoder continuity.

**Op Mode → RTTY** restores the upstream presets: RTTY-45 (45.45 baud / 170 Hz shift), RTTY-50 (50 / 170), RTTY-75N (75 / 170), RTTY-75W (75 / 850), and RTTY-100 (100 / 170, from the native quick-change menu). Each selects the original 5-bit Baudot settings. **Custom...** opens **Configure → Modem → RTTY** for the other baud rates, shifts, bits, parity, and stop lengths. These presets share the original RTTY decoder; they are not separate modem implementations.

Help follows the original fldigi menu, including the original offline Beginners' Guide, documentation/site/reception-report links, and browser versions of Audio device info, Build info, and Event log. The event log can be saved as text. Native command-line options are grayed out; Check for Updates is omitted. Browser receiver help, the source repository, and License remain under Help. Original fldigi icons take precedence wherever the exact artwork exists; selected Font Awesome SVGs identify browser-specific actions. The selection process and current choices are documented in `AGENTS.md`.

## Build from the supplied fldigi source

Install and activate the official [Emscripten SDK](https://emscripten.org/docs/getting_started/downloads.html), with `em++` available on `PATH`. The build also needs Python 3 and the Node.js runtime used by Emscripten. Run one of the following from the project root:

```sh
python scripts/build.py
```

On Windows, `./build.ps1` is available; on macOS or Linux, use `./build.sh`. Add `--debug` to the Python or shell command, or `-Debug` to the PowerShell command, for a debug build. The script reads `reference/fldigi-source.zip`, prepares the upstream source under `vendor/fldigi/`, and writes `web/fldigi-core.js` and `web/fldigi-core.wasm`. The `reference/` directory is ignored by Git, so supply that ZIP separately when rebuilding from a fresh clone. The script handles DOS-reserved names in the archive; do not extract the ZIP directly on Windows.

The tested compiler is **Emscripten 6.0.11**. An optional pinned installation script downloads the official compiler into `.tools/emsdk`, uses your existing Node.js, and installs the compiler tool alone. It avoids SDK activation hooks and npm lifecycle scripts:

```sh
python scripts/setup-emsdk.py
python scripts/build.py
```

The build invokes Python and Emscripten directly; it does not run upstream installation scripts or npm lifecycle scripts. There are no frontend dependencies. The included prepared `vendor/fldigi` sources can also be used when the original reference archive is absent.

To check the built decoder with the included signal fixtures, run `npm test` (or run the six `tests/*.test.mjs` files with Node). Independently synthesized BPSK31, RTTY, and CW recordings must decode the known message. All enabled modes are checked for initialization, and the streaming resampler is checked at 8, 11.025, 16, 44.1, and 48 kHz. Waterfall tests cover the native RTTY preset settings, filter bars, mode-specific geometry, pointer centering, zoom offsets, and cutoff bounds. Behavior regressions cover named presets, streamed UTF-8/CP1252/backspaces, AFC tuning, reset generations, native scope payloads and scaling, circle clipping/resize, reset graticules, worklet resets, and configuration bounds. DTMF checks cover all 16 keys at 8/44.1/48 kHz, chunk boundaries, repeated digits, flushing, reset/switch exclusivity, squelch, and tuning independence. Other modes retain upstream implementations but have not been verified with known-message recordings. Real microphone capture, permission denial, and switching physical devices still need testing on your hardware; file playback through the browser's AudioWorklet has been verified.

To regenerate the recordings, run `python scripts/generate-fixtures.py`.

## Package / host

```sh
python scripts/package.py
```

This writes `build/fldigi-web.zip`, a static site containing the generated JS/WASM. Extract it on a static host with HTTPS and an `application/wasm` MIME type. No server-side application or cross-origin isolation headers are needed. Audio and recordings stay in the browser; the local server only serves static files. `file://` does not support the worker and audio pipeline.

The desktop layout is designed for approximately 660 px or wider. It follows the supplied Linux/Windows fldigi screenshots with a compact layout at smaller desktop sizes. Configuration is saved only when **Save** is clicked; toolbar controls save immediately. JSON exports are portable between browsers.

## Implementation

- `vendor/fldigi`: original source, byte-preserved apart from Windows-safe path renaming.
- `scripts/prepare-browser-core.py`: generated include and UI adapter overlay. No source edits are written to `vendor`.
- `native/`: base modem adapter, explicit desktop/device stubs, and a small C API.
- `web/decoder-worker.js`, `decoder-session.js`: original modem execution off the UI thread and generation-aware receive sessions.
- `web/audio-worklet.js`: PCM capture for both live input and file playback.
- `web/resampler.js`: streaming windowed-sinc conversion to each modem's original sample rate.
- `web/index.html`, `style.css`, `app.js`, `configuration.js`, `scope.js`, `received-text.js`: classic controls, waterfall, modem scopes, modal configuration, storage, streaming text, and file handling.

The browser overrides the upper tuning limit to 4000 Hz to accommodate wide modes. Modem filters, coefficients, FEC, symbol processing, character tables, charset conversion, and quality buckets remain original. FFT window functions and native power-density semantics are retained in the browser waterfall adapter. Waterfall rendering and spatial display averaging still differ from desktop fldigi; the parallel channel panel remains PSK-only. Additional desktop receive options are not yet exposed on every configuration page. See `THIRD_PARTY_NOTICES.md` for the specific desktop seams replaced by the overlay.

## Source and license

Fldigi's upstream site is <https://www.w1hkj.org/>.  The port retains the upstream decoder files and adds a small browser adapter in `native/`.

Fldigi and this port are distributed under the GNU General Public License, version 3 or later; individual upstream files retain their original notices. See [COPYING](COPYING) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). 
