# UI workflow catalog

`workflow.json` is a flat mapping from **DOM ID** to workflow tags. It inventories
the browser application's fields and controls, including disabled controls,
menus, configuration pages, dynamically generated modem choices and presets,
30 channel rows, and meaningful read-only results and signal displays.
Use `document.getElementById(id)` to resolve an entry. No dependencies are needed.

| Tag | Intended use |
| --- | --- |
| `decode` | Decode recordings or microphone audio, including receiving text/images, tuning, signal inspection, and saving results. |
| `encode` | Render and download transmit text as WAV, or play a realtime transmit session through the speakers. |
| `rig` | Radio hardware, on-air operation, station/contact identity, directed callsign features, contesting, or QSO logging. |
| `util` | Other currently disabled optional features: native audio backends, command-line options, web integrations, autostart, and the unassigned macro slot. |

Shared modem/protocol settings carry both `encode` and `decode`. Shared navigation,
configuration management, waterfall display controls, help, and diagnostics also carry both so those controls
remain accessible in either workflow. Receiver-specific processing and displays
carry only `decode`; transmit text, audio generation, and output corrections carry
only `encode`. Contact and operator callsigns are `rig`, as are MYCALL formatting
options, FSK hardware keying, CW keying/QSK, Spot, TUNE, RF frequency/bandwidth,
QSY, and reception-report websites. RF frequency is separate from audio frequency.
Microphone capture is `decode`: it needs an audio input, but no radio rig.

Some distinctions are intentional even though the feature is disabled today:

- RxID is `decode` and TxID is `encode`: mode identification is carried in audio
  and can be useful for puzzles without a physical radio. The IDs configuration
  page therefore carries both tags.
- KPSQL and capture sample-rate selection are `decode`; their disabled states do
  not make them utilities.
- T/R switches and Tx macros carry only `encode`, so they are enabled in the
  encode, both, and full workflows and disabled in decode. Rx carries both tags:
  it finishes an active TX session without requesting microphone permission.
  In encode-only it is disabled while no TX session is active. The shipped CQ, ANS,
  QSO, KN, SK, Me/Qth, and Brag macros are intended for on-air contacts and carry
  `rig`. The empty macro slot is `util` until it has an assigned purpose.
- Transmit frequency lock carries both tags because it relates receive and
  transmit audio frequencies. Store carries both for saving an audio-frequency
  preset, although this receiver already saves frequency automatically.
- Native OSS, PortAudio, and PulseAudio backends are `util`; browser microphone
  device selection is `decode`. Native playback sample rate is `encode`, following
  fldigi's transmit/output-device usage; browser recording playback controls and
  playback volume are `decode`.
- CW reference WPM, DominoEX FEC, and MT63 8-bit character handling carry both
  tags, based on their receive/transmit use in the supplied fldigi source.

IDs already present in `index.html` and `config-<setting key>` IDs are preserved.
Previously anonymous controls now have stable IDs. Dynamic menu/tree IDs use
`prefix + '-' + encodeURIComponent(name)`, preserving the original mode/page
name without collisions. Examples: `mode-BPSK31`, `mode-Cont-4%2F125`,
`mode-preset-RTTY-45`, `mode-preset-IFKP%201.0`, and
`config-page-Soundcard%2FDevices`. `channel-row-1` through `channel-row-30` identify
fixed browser slots, not particular received frequencies. Configuration field
IDs can appear on several pages, but only one configuration page renders at a
time. Select options belong to their select field rather than separate controls.

The catalog covers the UI implemented in `index.html` and the builders in
`app.js`, not every native fldigi setting or every key in `configuration.js`.
Unavailable native modes omitted from the browser menu have no catalog entry.
The linked Beginners' Guide and external websites are destinations, not
additional application controls. Decorative artwork, window symbols, cursor
geometry, and layout-only containers are excluded. Useful composite displays
such as the channel panel, playback bar, and fax controls are included.

The application reads this catalog through `workflow.js` and selects a profile
from the URL's `workflow` query argument:

| URL value | Enabled tags |
| --- | --- |
| `decode` (default) | `decode` |
| `encode` | `encode` |
| `both` | `encode`, `decode` |
| `full` | `encode`, `decode`, `rig`, `util` |

Missing or unknown values select `decode`. Matching controls are enabled even if
they were disabled in the original receive-only UI; this includes RxID, KPSQL,
Store, and planned transmit/rig controls. Enabling a control does not implement
its underlying feature. Text audio generation and realtime TX are implemented;
rig operations and other native integrations remain unimplemented.
The status message is shared between encoding and decoding because both need
configuration and error feedback.

Filtering preserves the layout, grays disabled controls, removes disabled links
and scope controls from keyboard focus, exposes disabled states to accessibility
APIs, and prevents their input handlers from running. It reapplies after settings,
modem menus, configuration trees, and configuration pages render. Mode-specific
restrictions also apply: DTMF disables tuning, sideband, AFC, SQL, and reverse.
An absent element may belong to an unopened configuration page. Native modes
omitted from the browser's mode menu remain omitted in every workflow.

Encode-only blocks microphone requests, audio-file loading/playback, audio and
configuration messages to the decoder, decoded reports, and receive keyboard
shortcuts. The worker loads the modem list for shared mode selection; it receives
no decoding requests. The transmit editor accepts text and uses the configured
fldigi transmit background color. TX generate reviews the current settings and
renders a finite WAV in a separate encoder worker, then downloads it automatically.
An empty transmit editor shows a warning instead of the generation dialog. The
dialog and its progress controls are tagged `encode`. T/R and Tx start
realtime speaker playback; Rx or T/R finishes queued text and the modem tail.
Immediate stop terminates the worker and scheduled audio. Native FSQ and NAVTEX
finish their framed message when the encoder returns. Realtime playback retains
only a short playback queue and does not accumulate a recording.
The encoder's native FFT feeds the waterfall on the playback clock, independently
of speaker volume. Its queued display frames are discarded on immediate stop.
This also works in encode-only without sending audio to the receiver worker.

TX controls also have runtime restrictions: WEFAX requires image input and cannot
generate text audio; during TX, mode/settings controls are locked, render captures
the editor, and live TX permits appending at its end. WAV generation adds no
media player or result toolbar. Realtime TX pauses the receiver's file and holds
an active microphone stream with receive processing paused. Once queued TX audio
and its tail have played, microphone receive resumes on the same stream and
worklet, with a fresh input generation. Explicit Stop releases capture and clears
the resume intent; device disconnection or loading a recording also clears it.
TX never acquires a microphone by itself or resumes a received-file recording.
WAV generation stops microphone capture. Canceling
or failing a render does not download a partial file.

`node tests/workflow.test.mjs` checks tag validity, stable and unique identifiers,
complete static-control coverage, every configuration page, generated modem
menus/presets and channel rows, and catalog entries without a UI counterpart.
`node tests/workflow-filter.test.mjs` checks profile selection, the full tag union,
runtime restrictions, dynamic replacement, and disabled event handling. The audio
source tests also verify microphone handoff, stop/disconnection handling, and
encode-only decoder isolation. `encoder.test.mjs` verifies
all 159 selectable encoder variants, native decoding round-trips, idle/finish,
chunk continuity, tuning offset, native TX/RX FFT agreement, and WAV headers. `transmitter.test.mjs` checks
workflow gating, empty-input warnings, render snapshots, automatic downloads,
cancellation, live text queues,
worker load races, settings locks, and synchronized waterfall/playback timing. The static-site packager
includes the catalog, workflow module, and documentation automatically.
