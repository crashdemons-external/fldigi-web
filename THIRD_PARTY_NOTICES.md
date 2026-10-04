# Source and licenses

This browser port is distributed under GNU GPL version 3 or later. The GPL text
is in `COPYING`. Original copyright and license notices remain in `vendor/fldigi`.

## fldigi 4.2.13

The supplied archive is `fldigi-fldigi-e7c3ab3709ad62a7d91829364eb48a05fa325c0d`.
Its SHA-256 is recorded in `vendor/fldigi/SOURCE.json`. Original authors include
Dave Freese, W1HKJ, Tomi Manninen, OH2BNS, and the contributors named in each file.
Most fldigi files use GPL version 3 or later. Individual notices take precedence:
the FFT header `gfft.h` uses LGPL version 3 or later; WEFAX includes code from
HAMFAX under GPL version 2 or later; the included Jalocha DSP headers retain their
original notices. Emscripten's runtime and compiler support code retain their
upstream licenses, available in the official SDK.

The receive text path also compiles fldigi's original `CharsetDistiller` and
bundled TINICONV conversion library. The latter retains its original library
LGPL version 2 notices and fldigi contributor notices. The supplied `COPYING`
and `COPYING.LIB` are included under `web/licenses/tiniconv-*`.

## Interface artwork and guide

The original fldigi XPM icons are converted to PNG without changing their
pixels. The Tango artwork in `src/misc/pixmaps_tango.cxx` is public domain, as
recorded in that file. Custom/other artwork in `src/misc/pixmaps.cxx` retains
the original source notices. The embedded Beginners' Guide in
`src/dialogs/guide.cxx` is reproduced as `web/beginners.html`; its original
AsciiDoc table-of-contents/footnote script and notices are preserved.

Font Awesome Free 7.2.0 icons by Fonticons, Inc. (https://fontawesome.com) are
from the user-supplied official web archive. SVG icons are licensed under
CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Original SVG files
and the supplied license are retained in `web/icons/fontawesome/`. The UI
bundles unchanged paths into an SVG symbol sprite; no Font Awesome JavaScript
or webfonts are loaded. Provenance and the archive hash are in
`web/icons/manifest.json`. Font Awesome's MIT and SIL OFL terms in the supplied
license apply to the corresponding code/fonts if those are used later.

## Browser adaptation

Upstream files in `vendor/fldigi` are byte-preserved; the reserved directory name
`aux` is renamed `_aux` during Windows-safe extraction. Build scripts generate an
include overlay and copies of a few translation units in `build/generated`.
These adaptations replace FLTK and hardware interfaces, route receive output to
the browser, omit serial keying threads and FSQ transmit scheduling, and disable
native station catalogs and logbook integrations. The modem DSP algorithms,
filters, FEC implementations, character tables, and coefficients remain upstream.

`native/web_modem.cpp` adapts the original base modem to a receive-only worker;
`native/web_compat.h`, `web_picture.h`, and `web_wefax.h` replace desktop services.
JavaScript handles browser audio, sample-rate conversion, storage, files, and UI.

## Distribution

Help links to the project's GitHub repository for the upstream sources, browser
sources, adapters, build scripts, tests, and notices. When distributing the
generated WASM, publish its matching source there and keep the license files
and notices in the static-site distribution.
