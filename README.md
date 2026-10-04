# fldigi web

Fldigi web is a browser-based, receive-only port of selected [fldigi](https://www.w1hkj.org/) amateur-radio sound-card modem decoders. It accepts audio from recordings or a microphone and displays decoded text, a waterfall, tuning controls, and modem scopes in an interface inspired by desktop fldigi.

The project builds 163 receive modes from fldigi 4.2.13, including CW, PSK, RTTY, MFSK, Olivia, MT63, Hellschreiber, WEFAX, and DTMF. Audio is decoded locally in the browser using WebAssembly; no radio transmission or rig control is provided.

## Build and run

Install Python 3 and the official [Emscripten SDK](https://emscripten.org/docs/getting_started/downloads.html), with `em++` available on `PATH`. From the project root, build the browser decoder and start the local server:

```sh
python scripts/build.py
python scripts/serve.py
```

Open <http://localhost:8080>. The build reads `reference/fldigi-source.zip`; provide this archive separately when it is not present in your checkout. A generated browser core is included, so the build step can be skipped when you only want to run the application.

Fldigi web is distributed under the GNU General Public License, version 3 or later. See [COPYING](COPYING) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
