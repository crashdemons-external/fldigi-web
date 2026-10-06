# UI workflow catalog

`workflow.json` is a flat mapping from **DOM ID** to workflow tags. It inventories
the browser application's fields and controls, including disabled controls,
menus, configuration pages, dynamically generated modem choices and presets,
30 channel rows, and meaningful read-only results and signal displays.
Use `document.getElementById(id)` to resolve an entry. No dependencies are needed.

| Tag | Intended use |
| --- | --- |
| `decode` | Decode recordings or microphone audio, including receiving text/images, tuning, signal inspection, and saving results. |
| `encode` | Generate audio from data for eventual file export. These tags describe planned use; encoding remains unimplemented. |
| `rig` | Radio hardware, on-air operation, station/contact identity, directed callsign features, contesting, or QSO logging. |
| `util` | Other currently disabled optional features: native audio backends, command-line options, web integrations, autostart, and the unassigned macro slot. |

Shared modem/protocol settings carry both `encode` and `decode`. Shared navigation,
configuration management, help, and diagnostics also carry both so those controls
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
  encode, both, and full workflows and disabled in decode. The shipped CQ, ANS,
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
its underlying feature. Audio generation and rig operations remain unimplemented.
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
fldigi transmit background color. Generating audio shows a message explaining
that audio generation and export are not implemented yet.

`node tests/workflow.test.mjs` checks tag validity, stable and unique identifiers,
complete static-control coverage, every configuration page, generated modem
menus/presets and channel rows, and catalog entries without a UI counterpart.
`node tests/workflow-filter.test.mjs` checks profile selection, the full tag union,
runtime restrictions, dynamic replacement, and disabled event handling. The audio
source tests also verify encode-only decoder isolation. The static-site packager
includes the catalog, workflow module, and documentation automatically.
