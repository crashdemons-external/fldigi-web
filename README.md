# fldigi web

Fldigi web is a browser-based port of selected [fldigi](https://www.w1hkj.org/) amateur-radio sound-card modems. It decodes recordings or microphone audio, generates WAV files from text, and simulates realtime transmission through the speakers in an interface inspired by desktop fldigi.

The project builds 163 original receive modes from fldigi 4.2.13 plus DTMF, including CW, PSK, RTTY, MFSK, Olivia, MT63, Hellschreiber, and WEFAX. The 159 selectable text/keypad variants also generate audio using the original modem encoders. Audio is processed locally using WebAssembly. WEFAX image generation and radio hardware control are unavailable.

**Live demo:** [Fldigi Web](https://crashdemons-external.github.io/fldigi-web/)

The UI workflow catalog is in [web/workflow.json](web/workflow.json), with DOM IDs
mapped to `decode`, `encode`, `rig`, and `util` tags. See
[web/workflow.md](web/workflow.md) for classification rules and ID conventions.

## Generate and play transmit audio

The default `?workflow=both` enables encoding and decoding. Use
`?workflow=encode`, `?workflow=decode`, or `?workflow=full` to select another
workflow.

Compose text in the TX pane and select an Op Mode and audio frequency. **File →
Audio → TX generate** opens a review dialog. **Generate** captures the text and
modem settings and renders a complete transmission, including its preamble and
tail, as quickly as the encoder can run. The completed WAV downloads automatically,
without adding a media player or result toolbar. The WAV is mono 16-bit PCM at the
modem's native sample rate. An empty TX pane shows a warning; canceling generation
does not download a partial recording.

**T/R**, **Tx**, or **TX** starts realtime playback of the TX pane. Append text at
the end while transmitting; queued text stays locked until the session ends.
The transmitted signal appears in the waterfall in sync with speaker playback,
including in encode-only mode. Speaker volume does not affect the displayed signal.
**T/R** or **Rx** finishes the remaining queued text and the modem tail before
returning to receive. **■** or **File → Audio → Stop audio** stops immediately,
releases microphone access, and leaves receive off.
Modes with an idle signal continue transmitting when the queue is empty; FSQ and
NAVTEX/SITOR-B finish when their native encoder ends the message. Each new TX
session starts with the full contents of the editor. Realtime TX does not record
audio; use TX generate to create a file.

If microphone receive is active, realtime TX keeps its stream open while pausing
receive processing. Finishing TX resumes that same stream without another
permission request, so the waterfall continues from TX audio into live receive.
Starting TX pauses received-file playback; returning to receive does not resume
a recording or acquire a microphone that was previously off. WAV generation
stops microphone capture. Encoder and receiver modem state live in separate workers. A
session freezes its mode and settings. Configure → Sound card provides TX speaker
volume, TX sample-rate correction (ppm), and TX frequency offset (subtracted from
the selected frequency). Speaker volume does not alter WAV amplitude. Frequency
lock retains the current TX audio frequency while receive tuning changes.

Messages are limited to 100,000 UTF-8 bytes and 30 minutes of generated audio.
Baudot/ASCII modes reject incompatible character sets; Baudot text becomes upper
case and DTMF accepts keypad characters and pauses. WEFAX image generation,
TxID/RxID, rig control, and native application integrations are not implemented.

Choose the UI workflow with `?workflow=encode`, `?workflow=decode`,
`?workflow=both`, or `?workflow=full`. The default is `both`; unknown values
also use `both`. `both` enables the union of encoding and decoding controls;
`full` includes rig and utility controls. Encode-only blocks recording playback,
microphone capture, and decoding. Matching controls are enabled even when their
underlying feature is still planned; rig control remains unimplemented. Enabled transmit text and macro colors follow the
supplied fldigi source and screenshots.

## Build and run

Install Python 3 and the official [Emscripten SDK](https://emscripten.org/docs/getting_started/downloads.html), with `em++` available on `PATH`. From the project root, build the browser decoder and start the local server:

```sh
python scripts/build.py
python scripts/serve.py
```

Open <http://localhost:8080>. The build reads `reference/fldigi-source.zip`; provide this archive separately when it is not present in your checkout. A generated browser core is included, so the build step can be skipped when you only want to run the application.

Fldigi web is distributed under the GNU General Public License, version 3 or later. See [COPYING](COPYING) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Microphone access on Android Chrome

Live capture requires HTTPS or localhost. Opening a local server by its HTTP LAN
address on a phone cannot request microphone permission; the hosted demo uses HTTPS.

If capture is blocked without a prompt, check both permission settings:

- In Chrome, open **Settings → Site settings → Microphone**. Allow sites to ask
  and allow the receiver's site if it appears under Blocked.
- In Android, open **Settings → Apps → Chrome → Permissions → Microphone** and
  allow access while using the app.

Return to the receiver and tap **Rx** again. See
[Google's microphone permission instructions](https://support.google.com/chrome/answer/2693767?co=GENIE.Platform%3DAndroid&hl=en).
