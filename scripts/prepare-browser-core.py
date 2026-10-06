"""Create a browser include overlay; upstream decoder sources remain unchanged."""
from pathlib import Path
import json
import re
import shutil

ROOT = Path(__file__).resolve().parents[1]
UPSTREAM = ROOT / "vendor/fldigi/src"
GENERATED = ROOT / "build/generated"
SOURCES = [
    "filters/filters.cxx", "filters/fftfilt.cxx", "filters/viterbi.cxx",
    "psk/psk.cxx", "psk/pskcoeff.cxx", "psk/pskvaricode.cxx", "psk/pskeval.cxx", "psk/viewpsk.cxx",
    "mfsk/interleave.cxx", "mfsk/mfskvaricode.cxx",
    "dominoex/dominoex.cxx", "dominoex/dominovar.cxx", "throb/throb.cxx",
    "mt63/dsp.cxx", "mt63/mt63base.cxx", "mt63/mt63.cxx",
    "olivia/olivia.cxx", "contestia/contestia.cxx", "rtty/rtty.cxx",
    "cw/cw.cxx", "cw/morse.cxx", "mfsk/mfsk.cxx", "thor/thor.cxx", "thor/thorvaricode.cxx", "misc/misc.cxx",
    "scamp/scamp.cxx", "scamp/scamp_protocol.cxx", "ifkp/ifkp.cxx", "feld/feld.cxx", "feld/feldfonts.cxx", "misc/re.cxx",
    "navtex/navtex.cxx", "fsq/fsq.cxx",
    "wefax/wefax.cxx", "misc/strutil.cxx",
    "misc/charsetdistiller.cxx", "libtiniconv/tiniconv.c", "libtiniconv/tiniconv_desc.c", "dtmf/dtmf.cxx",
]
HEADERS = "globals.h complex.h misc.h ascii.h filters.h fftfilt.h gfft.h viterbi.h psk.h pskcoeff.h pskvaricode.h pskeval.h viewpsk.h mfskvaricode.h interleave.h dominoex.h dominovar.h throb.h mbuffer.h dsp.h mt63.h mt63base.h olivia.h contestia.h rtty.h cw.h morse.h mfsk.h thor.h thorvaricode.h scamp.h scamp_protocol.h ifkp.h feld.h fontdef.h re.h navtex.h fsq.h crc8.h wefax.h strutil.h".split()


def stream_image(text, family):
    """Yield image modulation in small batches, retaining upstream DSP code.

    Desktop send_image runs a whole image on its transmit thread. A worker
    needs resumable pixel iteration so realtime TX has bounded lookahead.
    Keep the original preamble and pixel modulation statements verbatim.
    """
    start = text.index(f'void {family}::send_image()')
    end_marker = {'thor': 'void thor::thor_send_image', 'ifkp': 'std::string img_str;', 'fsq': 'void fsq::send_string'}[family]
    end = text.index(end_marker, start)
    original = text[start:end]
    condition = {'thor': 'if (send_gray)', 'ifkp': 'if (send_color == false)', 'fsq': 'if (color == false)'}[family]
    split = original.index(condition)
    preamble_start = original.index('\tREQ(')
    head = original[:preamble_start]
    preamble = original[preamble_start:split]
    pixel_start = original.rindex('tx_pixelnbr = col + row * W;')
    modulation_end = re.search(r'(?:ModulateXmtr|transmit)\(outbuf, (?:IMAGEspp|10)\);', original[pixel_start:]).end() + pixel_start
    pixel = original[pixel_start:modulation_end]
    pixel = pixel.replace(f'tx_pixel = {family}pic_TxGetPixel(tx_pixelnbr, color);', f'''tx_pixel = gray ?
            0.3 * {family}pic_TxGetPixel(tx_pixelnbr, 0) +
            0.6 * {family}pic_TxGetPixel(tx_pixelnbr, 1) +
            0.1 * {family}pic_TxGetPixel(tx_pixelnbr, 2) :
            {family}pic_TxGetPixel(tx_pixelnbr, color);''')
    gray = {'thor': 'send_gray', 'ifkp': '!send_color', 'fsq': '!color'}[family]
    channel = '2 - (web_image_position / W) % 3' if family == 'fsq' else '(web_image_position / W) % 3'
    replacement = head + '\nif (web_image_position == 0) {\n' + preamble + '\n}\n' + f'''
    const bool gray = {gray};
    const int channels = gray ? 1 : 3;
    const int total = W * H * channels;
    const int limit = std::min(total, web_image_position + 128);
    for (; web_image_position < limit; ++web_image_position) {{
        int row = web_image_position / (W * channels);
        int col = web_image_position % W;
        int color = gray ? 0 : {channel};
        {pixel}
    }}
    web_image_done = web_image_position == total;
    if (web_image_done) start_deadman();
}}

'''
    # Desktop text tones already use the TX carrier. Keep image FM on that
    # same carrier when the browser's frequency lock / offset is configured.
    replacement = re.sub(r'\bfrequency\b', 'get_txfreq_woffset()', replacement)
    text = text[:start] + replacement + text[end:]
    if family == 'thor':
        text = text.replace('case TX_STATE_IMAGE:\n', 'case TX_STATE_IMAGE:\n\t\tif (web_image_position == 0) {\n')
        text = text.replace('\t\tsend_image();', '\t\t}\n\t\tsend_image();\n\t\tif (!web_image_done) return 0;', 1)
    elif family == 'ifkp':
        text = text.replace('\t\t\tsend_image();', '\t\t\tsend_image();\n\t\t\tif (!web_image_done) return 0;', 1)
    else:
        text = text.replace('int fsq::tx_process()\n{', '''int fsq::tx_process()
{
    if (fsq_tx_image && web_image_position > 0) {
        send_image();
        if (!web_image_done) return 0;
        flush_buffer();
        fsq_tx_image = false;
        stopflag = false;
        return -1;
    }''')
        text = text.replace('\t\tsend_eot = false;', '\t\tsend_eot = false;\n\t\tif (fsq_tx_image && !web_image_done) return 0;', 1)
    return text


def stream_fax(text):
    # Retain the native APT/phasing/image/stop state machine and FM modulator;
    # Persist its sample cursor and yield after 32 native 256-sample buffers.
    text = text.replace('fax_state m_tx_state;', 'int m_web_tx_sample_idx = 0;\n\tfax_state m_tx_state;')
    text = text.replace('void init_tx(int the_smpl_rate);', 'bool web_tx_idle() const { return m_tx_state == IDLE; }\n\tvoid init_tx(int the_smpl_rate);')
    text = text.replace('m_tx_state = TXAPTSTART;', 'm_tx_state = TXAPTSTART;\n\tm_web_tx_sample_idx = 0;')
    start = text.index('bool fax_implementation::trx_do_next(void)')
    end = text.index('void fax_implementation::tx_params_set', start)
    body = text[start:end]
    body = body.replace('int curr_sample_idx = 0 , nb_samples_to_send  = 0 ;', 'int &curr_sample_idx = m_web_tx_sample_idx;\n\tint nb_samples_to_send = 0;')
    body = body.replace('for (int num_bytes_to_write = 0; ; ++num_bytes_to_write)', 'int num_bytes_to_write = 0;\n\tfor (; ; ++num_bytes_to_write)')
    body = body.replace('bool end_of_loop = false ;', 'int web_blocks = 0;\n\tbool end_of_loop = false ;')
    body = body.replace('num_bytes_to_write = 0 ;', 'num_bytes_to_write = 0;\n\t\t\tif (++web_blocks == 32) { delete [] buf; return true; }')
    body = body.replace('m_tx_state = TXBLACK;\n\t\t\t\tcurr_sample_idx = 0;\n\t\t\t\tcontinue;', 'm_tx_state = TXBLACK;\n\t\t\t\tcurr_sample_idx = 0;\n\t\t\t\t--num_bytes_to_write;\n\t\t\t\tcontinue;')
    body = body.replace('m_tx_state = IDLE;\n\t\t\t\tend_of_loop = true ;\n\t\t\t\tcontinue ;', 'm_tx_state = IDLE;\n\t\t\t\tend_of_loop = true;\n\t\t\t\tbreak;')
    # The final incomplete block belongs to the tail; desktop discards it.
    body = body.replace('} // loop\n\tdelete [] buf;', '} // loop\n\tif (num_bytes_to_write > 0) modulate(buf, num_bytes_to_write);\n\tdelete [] buf;')
    text = text[:start] + body + text[end:]
    text = text.replace('bool tx_was_completed = m_impl->trx_do_next();', 'bool tx_was_completed = m_impl->trx_do_next();\n\tif (tx_was_completed && !m_impl->web_tx_idle()) return 0;')
    return text


def elements(text):
    text = text.replace("\\\n", " ")
    for match in re.finditer(r"ELEM_\(", text):
        start = match.end(); depth = 0; quoted = False; escaped = False; args = []; last = start
        for i in range(start, len(text)):
            c = text[i]
            if quoted:
                if escaped: escaped = False
                elif c == "\\": escaped = True
                elif c == '"': quoted = False
            elif c == '"': quoted = True
            elif c == "(": depth += 1
            elif c == ")":
                if depth == 0:
                    args.append(text[last:i].strip()); break
                depth -= 1
            elif c == "," and depth == 0:
                args.append(text[last:i].strip()); last = i + 1
        if len(args) == 5 and re.fullmatch(r"\w+", args[1]): yield args


def main():
    inc = GENERATED / "include"; inc.mkdir(parents=True, exist_ok=True)
    for name in HEADERS:
        shutil.copyfile(UPSTREAM / "include" / name, inc / name)
    # Keep the upstream DTMF DSP/debounce algorithm; make stream state belong
    # to the receiver instance and release its filters on mode/source resets.
    dtmf = (UPSTREAM / 'include/dtmf.h').read_text(encoding='utf-8')
    dtmf = dtmf.replace('NUMTONES', 'DTMF_NUMTONES')
    dtmf = dtmf.replace('int framesize;', 'int framesize;\n\tsize_t dptr = 0;')
    dtmf = dtmf.replace('~cDTMF() {};', '~cDTMF() { for (auto filter : filt) delete filter; };')
    dtmf = dtmf.replace('void receive(const float* buf, size_t len);', 'void receive(const float* buf, size_t len);\n\tvoid flush();')
    (inc / 'dtmf.h').write_text(dtmf, encoding='utf-8')
    shutil.copyfile(UPSTREAM / 'include/charsetdistiller.h', inc / 'charsetdistiller.h')
    shutil.copyfile(UPSTREAM / 'libtiniconv/tiniconv.h', inc / 'tiniconv.h')
    # Preserve fldigi's quality buckets and clamped circular history verbatim.
    base = (UPSTREAM / 'trx/modem.cxx').read_text()
    quality = re.search(r'int modem::get_quality\(int mode\).*?return get_quality\(mode\);\s*}', base, re.S).group(0)
    (inc / 'web_modem_quality.h').write_text(quality + '\n')
    # Preserve the native signal ramps and output limiter, replacing only the
    # sound-card write. Hardware PTT/auxiliary channels remain desktop-only.
    modulation = base[base.index('void modem::ModulateXmtr'):]
    envelope = modulation[modulation.index('\tint num ='):modulation.index('\tif (progdefaults.PTTrightchannel)')]
    level = modulation[modulation.index('\tdouble mult ='):modulation.index('\n\ttry {')]
    transmit = 'void modem::ModulateXmtr(double* buffer,int len) {\nif(!buffer||len<1)return;\ntx_sample_rate=samplerate;tx_sample_count+=len;\nconst double SIGLIMIT=0.95;\n' + envelope + level + '\nweb_tx_audio(buffer,len);\n}\n'
    (inc / 'web_modem_transmit.h').write_text(transmit)
    (inc / 're.h').write_text((inc / 're.h').read_text().replace('"compat/regex.h"','<regex.h>'))
    shutil.copytree(UPSTREAM / "include/jalocha", inc / "jalocha", dirs_exist_ok=True)
    modem = (UPSTREAM / "include/modem.h").read_text(encoding="utf-8", errors="replace")
    modem = re.sub(r'^#include "(?:threads|sound|digiscope|plot_xy)\.h"', '#include "web_compat.h"', modem, flags=re.M)
    (inc / "modem.h").write_text(modem)
    # Desktop-facing headers resolve to a small explicit browser adapter.
    includes = set()
    combined = ""
    for name in SOURCES:
        text = (UPSTREAM / name).read_text(encoding="utf-8", errors="replace")
        if name == 'dtmf/dtmf.cxx':
            text = text.replace('#include <samplerate.h>', '') # Unused native backend header.
            text = text.replace('#include "dtmf.h"', '#include "modem.h"\n#include "dtmf.h"').replace('NUMTONES', 'DTMF_NUMTONES')
            # The native copy loop can retain dptr == framesize and then read
            # beyond a short next chunk. Assemble complete frames explicitly.
            start = text.index('\tint x;', text.index('void cDTMF::receive'))
            end = text.index('\t\tx = decode();', start) + len('\t\tx = decode();')
            text = text[:start] + '''\tif (!progdefaults.DTMFdecode || !buf || !len) return;
\tframesize = (active_modem->get_samplerate() == 8000) ? 240 : 331;
\tsize_t bufptr = 0;
\twhile (bufptr < len) {
\t\tdata[dptr++] = buf[bufptr++];
\t\tif (dptr < size_t(framesize)) continue;
\t\tdptr = 0;
\t\tint x = decode();''' + text[end:]
            text = text.replace('REQ(showDTMF, dtmfchars);', 'showDTMF(dtmfchars);')
            text = text.replace('if (maxpower <', 'active_modem->display_metric(clamp(maxpower / 10.0, 0.0, 100.0));\n\tif (maxpower <')
            text += '\nvoid cDTMF::flush() { if (!dtmfchars.empty()) { showDTMF(dtmfchars); dtmfchars.clear(); } }\n'
            (GENERATED / 'dtmf.cxx').write_text(text, encoding='utf-8')
        if name == 'cw/cw.cxx':
            # Serial keying and its native background threads follow the DSP implementation.
            text = text[:text.index('Cserial CW_KEYLINE_serial;')]
            text += '\nvoid cw::send_CW(int) {}\n'
        if name in ['mfsk/mfsk.cxx', 'thor/thor.cxx', 'ifkp/ifkp.cxx']:
            text = re.sub(r'#include "(?:mfsk|thor|ifkp)-pic.cxx"', '#include "web_picture.h"', text)
        if name == 'mfsk/mfsk.cxx':
            text = text.replace('int i = 0;\n\t\t\tint blocklen = 128;', 'int &i = web_image_position;\n\t\t\tint blocklen = 128;')
            text = text.replace('while (i < xmtbytes)', 'if (i < xmtbytes)')
            text = text.replace('\t\t\t\ti += blocklen;\n\t\t\t}', '\t\t\t\ti = std::min(xmtbytes, i + blocklen);\n\t\t\t}\n\t\t\tif (i < xmtbytes) return 0;\n\t\t\tweb_image_done = true;')
        if name in ['thor/thor.cxx', 'ifkp/ifkp.cxx', 'fsq/fsq.cxx']:
            text = stream_image(text, Path(name).stem)
        if name == 'ifkp/ifkp.cxx':
            text = text.replace('frequency = (basetone + tone * IFKP_SPACING) * samplerate / symlen;', 'frequency = (basetone + tone * IFKP_SPACING) * samplerate / symlen - progdefaults.TxOffset;')
            text = text.replace('#include "ifkp_varicode.cxx"', (UPSTREAM / 'ifkp/ifkp_varicode.cxx').read_text())
            text = text[:text.index('static picture *def_ifkp_avatar')] + '\nvoid ifkp::m_ifkp_send_avatar() {}\n' + text[text.index('int ifkp::tx_process'):]
            text += '\nstd::string ifkp::imageheader;\n'
        if name == 'feld/feld.cxx':
            text = text.replace('REQ(put_rx_data,', 'put_rx_data(')
        if name == 'navtex/navtex.cxx':
            # Native station catalogs, ADIF/KML integrations do not participate in DSP.
            text = text[:text.index('class NavtexRecord')] + text[text.index('}; // NavtexCatalog')+len('}; // NavtexCatalog'):]
            start=text.index('void display( const std::string & alt_string )')
            end=text.index('} // display',start)+len('} // display')
            text=text[:start]+'void display(const std::string &alt_string){std::string::operator=(alt_string);cleanup();}\n'+text[end:]
        if name == 'fsq/fsq.cxx':
            text = text.replace('freq = (tx_basetone + tone * spacing) * samplerate / FSQ_SYMLEN;', 'freq = (tx_basetone + tone * spacing) * samplerate / FSQ_SYMLEN - progdefaults.TxOffset;')
            text=text.replace('#include "fsq-pic.cxx"','#include "web_picture.h"')
            text=text.replace('#include "fsq_varicode.cxx"',(UPSTREAM/'fsq/fsq_varicode.cxx').read_text())
            text=text[:text.index('void  clear_xmt_arrays()\n{')]+'\nvoid fsq::reply(std::string){}\nvoid fsq::delayed_reply(std::string,int){}\nvoid fsq::start_aging(){}\nvoid fsq::stop_aging(){}\nvoid fsq::start_sounder(int){}\nvoid SOUNDER_close(){}\n'
        if name == 'wefax/wefax.cxx':
            text = stream_fax(text)
            text=text.replace('#include "wefax-pic.h"','#include "web_wefax.h"')
            start=text.index('void wefax::qso_rec_save(void)');end=text.index('void wefax::set_freq(double freq)',start)
            text=text[:start]+'void wefax::qso_rec_save(void){}\n'+text[end:]
        if name in ['mfsk/mfsk.cxx','thor/thor.cxx','ifkp/ifkp.cxx','fsq/fsq.cxx','wefax/wefax.cxx']:
            callbacks=['showRxViewer','updateRxPic','thor_showRxViewer','thor_clear_avatar','thor_updateRxPic','thor_update_avatar','ifkp_showRxViewer','ifkp_clear_avatar','ifkp_updateRxPic','ifkp_update_avatar','fsq_showRxViewer','fsq_updateRxPic','wefax_pic::resize_rx_viewer','wefax_pic::update_rx_pic_bw']
            for callback in callbacks:
                text=re.sub(r'REQ\(\s*'+re.escape(callback)+r'\s*,',callback+'(',text)
                text=re.sub(r'REQ\(\s*'+re.escape(callback)+r'\s*\)',callback+'()',text)
        if name == 'misc/misc.cxx':
            text = text[:text.index('#include')] + '#include "misc.h"\n' + text[text.index('unsigned char grayencode'):]
        if name == 'thor/thor.cxx':
            text += '\nstd::string thor::imageheader;\nstd::string thor::avatarheader;\nint thor::IMAGEspp=THOR_IMAGESPP;\n'
        if name in ['cw/cw.cxx', 'mfsk/mfsk.cxx', 'thor/thor.cxx', 'misc/misc.cxx', 'ifkp/ifkp.cxx', 'feld/feld.cxx', 'navtex/navtex.cxx', 'fsq/fsq.cxx', 'wefax/wefax.cxx']:
            (GENERATED / Path(name).name).write_text(text, encoding='utf-8')
        combined += text
        includes.update(re.findall(r'^#include [<"]([^>"\n]+)[>"]', text, re.M))
    for name in HEADERS:
        includes.update(re.findall(r'^#include [<"]([^>"\n]+)[>"]', (inc / name).read_text(encoding="utf-8", errors="replace"), re.M))
    for name in includes:
        if name in HEADERS or name in ['modem.h', 'dtmf.h', 'charsetdistiller.h', 'tiniconv.h'] or name.startswith("jalocha/"): continue
        if name.startswith("FL/") or (UPSTREAM / "include" / name).exists():
            target = inc / name; target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text('#pragma once\n#include "web_compat.h"\n')
    (inc / "config.h").write_text('#pragma once\n#define BENCHMARK_MODE 0\n#define HAVE_STD_BIND 1\n#define HAVE_STD_HASH 1\n#define HAVE_CLOCK_GETTIME 1\n#include "web_compat.h"\n')
    combined = re.sub(r'/\*.*?\*/|//[^\n]*', '', combined, flags=re.S)
    fields = set(re.findall(r"progdefaults\.(\w+)", combined))
    fields.update(['wfPreFilter', 'wf_latency', 'TxOffset', 'SoftStart'])
    values = {a[1]: a for a in elements((UPSTREAM / "include/configuration.h").read_text(encoding="utf-8", errors="replace"))}
    config = ['#pragma once', 'struct WebConfiguration {']
    for name in sorted(fields):
        if name not in values: raise RuntimeError(f"No upstream default for {name}")
        kind, _, _, _, default = values[name]
        default = default.replace('rtty::RTTY_PARITY_NONE', '0')
        config.append(f"    {kind} {name} = {default};")
    config.append('};\nextern WebConfiguration progdefaults;\n')
    (inc / "web_configuration.h").write_text("\n".join(config))
    status_fields = set(re.findall(r"progStatus\.(\w+)", combined))
    status_fields.add('txlevel')
    status_text = (UPSTREAM / "include/status.h").read_text(encoding="utf-8", errors="replace")
    status = ['#pragma once', 'struct WebStatus {']
    for name in sorted(status_fields):
        match = re.search(r"\b(bool|double|float|int|std::string)\s+" + name + r"\s*;", status_text)
        if not match: raise RuntimeError(f"No status type for {name}")
        status.append(f"    {match[1]} {name} {{}};")
    status.append('};\nextern WebStatus progStatus;\n')
    (inc / "web_status.h").write_text("\n".join(status))
    # Preserve upstream mode names and ordering, without native modem globals.
    source = (UPSTREAM / "globals/globals.cxx").read_text(encoding="utf-8", errors="replace")
    table = re.search(r"const struct mode_info_t mode_info\[NUM_MODES\] = \{(.*?)\n\};", source, re.S).group(1)
    table = re.sub(r'/\*.*?\*/|//[^\n]*', '', table, flags=re.S)
    rows = re.findall(r'\{\s*(MODE_\w+)\s*,\s*&([\w]+)\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"', table)
    families = {}
    for mode, pointer, short, label in rows:
        family = None
        for key, pattern in [('PSK', r'psk|ofdm'), ('DominoEX', r'dominoex'), ('Throb', r'throb'), ('MT63', r'mt63'), ('Olivia', r'olivia'), ('Contestia', r'contestia'), ('RTTY', r'^rtty'), ('CW', r'^cw_'), ('MFSK', r'^mfsk'), ('THOR', r'^thor'), ('SCAMP', r'^sc(?:amp|fsk|ook)'), ('IFKP', r'^ifkp'), ('Hellschreiber', r'^feld'), ('NAVTEX', r'navtex|sitorb'), ('FSQ', r'^fsq'), ('WEFAX',r'^wefax')]:
            if re.search(pattern, pointer): family = key; break
        families[mode] = family
    cpp = ['#include "web_compat.h"', 'const struct mode_info_t mode_info[NUM_MODES] = {']
    table = re.sub(r"&\w+", "nullptr", table)
    table = re.sub(r"\b(?:DISABLED_IO|ARQ_IO|KISS_IO)\b", "0", table)
    cpp += [table, '};', 'const char* web_family(int mode) { switch(mode) {']
    for mode, family in families.items():
        if family: cpp.append(f'case {mode}: return "{family}";')
    cpp += ['case WEB_MODE_DTMF: return "DTMF";', 'default: return ""; }}']
    (GENERATED / "mode_table.cpp").write_text("\n".join(cpp))
    (GENERATED / "sources.json").write_text(json.dumps(SOURCES, indent=2))
    viewer = (UPSTREAM / 'psk/viewpsk.cxx').read_text(encoding='utf-8')
    viewer = viewer.replace('REQ(&viewaddchr,', 'viewaddchr(').replace('REQ(&viewclearchannel,', 'viewclearchannel(')
    (GENERATED / 'viewpsk.cxx').write_text(viewer, encoding='utf-8')
    print(f"Browser overlay prepared; {len(fields)} original configuration defaults, {sum(bool(v) for v in families.values())} receive modes.")


if __name__ == '__main__': main()
