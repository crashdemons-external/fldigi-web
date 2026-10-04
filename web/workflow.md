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
- T/R switches carry both tags; Tx macros carry `encode`. The shipped CQ, ANS,
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

This catalog does **not** change availability or implement workflow filtering.
Future filtering should match the union of selected tags, preserve current
capability checks and mode-specific disabled states, and apply again when dynamic
controls render. An absent element may simply belong to an unopened configuration
page. A full rig profile should include all four tags; matching `rig` alone would
select only the radio-specific subset. `encode` is classification, not permission
to enable an unfinished transmitter.

`node tests/workflow.test.mjs` checks tag validity, stable and unique identifiers,
complete static-control coverage, every configuration page, generated modem
menus/presets and channel rows, and catalog entries without a UI counterpart.
The static-site packager includes this JSON and documentation automatically.
