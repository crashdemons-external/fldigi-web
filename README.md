# fldigi web

Fldigi web is a browser-based, receive-only port of selected [fldigi](https://www.w1hkj.org/) amateur-radio sound-card modem decoders. It accepts audio from recordings or a microphone and displays decoded text, a waterfall, tuning controls, and modem scopes in an interface inspired by desktop fldigi.

The project builds 163 receive modes from fldigi 4.2.13, including CW, PSK, RTTY, MFSK, Olivia, MT63, Hellschreiber, WEFAX, and DTMF. Audio is decoded locally in the browser using WebAssembly; no radio transmission or rig control is provided.

**Live demo:** [Fldigi Web](https://crashdemons-external.github.io/fldigi-web/)

The UI workflow catalog is in [web/workflow.json](web/workflow.json), with DOM IDs
mapped to `decode`, `encode`, `rig`, and `util` tags. See
[web/workflow.md](web/workflow.md) for classification rules and ID conventions.

Choose the UI workflow with `?workflow=encode`, `?workflow=decode`,
`?workflow=both`, or `?workflow=full`. The default is `decode`; unknown values
also use `decode`. `both` enables the union of encoding and decoding controls;
`full` includes rig and utility controls. Encode-only blocks recording playback,
microphone capture, and decoding. Matching controls are enabled even when their
underlying feature is still planned; audio generation, transmission, and rig
control remain unimplemented. Enabled transmit text and macro colors follow the
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
