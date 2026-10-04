"""Prepare exact fldigi artwork and a small, local Font Awesome SVG subset.

Only Python's standard library is used. No archive scripts or icon library JS
are executed. fldigi's XPM pixels and the supplied SVG paths stay unchanged.
"""
from pathlib import Path
import ast
import hashlib
import json
import re
import struct
import zipfile
import zlib
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
ICONS = ROOT / 'web/icons'
FLDIGI = ROOT / 'vendor/fldigi/src'
ORIGINAL = ['fldigi_icon', 'start_here_icon', 'help_browser_icon', 'net_icon',
            'pskr_icon', 'utilities_terminal_icon', 'audio_card_icon',
            'executable_icon', 'dialog_information_icon', 'help_about_icon',
            'edit_clear_icon', 'save_icon', 'text_icon', 'tango_view_refresh']
FA = ['solid/microphone', 'solid/file-audio', 'solid/gear', 'solid/broom',
      'solid/volume-high', 'solid/volume-xmark', 'solid/book-open',
      'solid/circle-question', 'solid/globe', 'solid/satellite-dish',
      'solid/terminal', 'solid/microchip', 'solid/code', 'solid/lightbulb',
      'solid/star', 'solid/rotate', 'solid/file-lines', 'brands/github']


def chunk(kind, data):
    return struct.pack('!I', len(data)) + kind + data + struct.pack('!I', zlib.crc32(kind + data))


def xpm_png(strings, source):
    width, height, count, step = map(int, strings[0].split()[:4])
    palette = {}
    for line in strings[1:count + 1]:
        key = line[:step]
        color = re.search(r'\bc\s+(.+)', line[step:]).group(1).strip()
        if color == 'None': value = bytes([0, 0, 0, 0])
        elif re.fullmatch(r'#[0-9a-fA-F]{6}', color): value = bytes.fromhex(color[1:]) + b'\xff'
        else: raise ValueError(f'Unsupported XPM color {color!r} in {source}')
        palette[key] = value
    rows = strings[count + 1:count + 1 + height]
    assert len(rows) == height and all(len(row) == width * step for row in rows), source
    pixels = b''.join(b'\0' + b''.join(palette[row[x:x + step]] for x in range(0, len(row), step)) for row in rows)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!2I5B', width, height, 8, 6, 0, 0, 0))
            + chunk(b'tEXt', b'Source\0' + source.encode())
            + chunk(b'IDAT', zlib.compress(pixels)) + chunk(b'IEND', b''))


def main():
    originals = {}
    for filename in ['misc/pixmaps.cxx', 'misc/pixmaps_tango.cxx']:
        text = (FLDIGI / filename).read_text(encoding='utf-8')
        aliases = dict(re.findall(r'#define\s+(\w+)\s+(\w+)', text))
        for match in re.finditer(r'const char\s*\*\s*(\w+)\[\]\s*=\s*\{(.*?)\};', text, re.S):
            name = aliases.get(match[1], match[1])
            strings = [ast.literal_eval(s) for s in re.findall(r'"(?:\\.|[^"\\])*"', match[2])]
            originals[name] = (strings, filename)
    destination = ICONS / 'fldigi'; destination.mkdir(parents=True, exist_ok=True)
    manifest = {'fldigi': {}, 'fontawesome': {}}
    for name in ORIGINAL:
        strings, filename = originals[name]
        (destination / (name + '.png')).write_bytes(xpm_png(strings, f'fldigi 4.2.13: src/{filename}: {name}'))
        manifest['fldigi'][name] = {'source': 'vendor/fldigi/src/' + filename, 'dimensions': strings[0].split()[:2],
                                    'license': 'Public domain (Tango)' if 'tango' in filename else 'See original fldigi source notices'}

    supplied = ROOT / 'reference/fontawesome-free-7.2.0-web.zip'
    destination = ICONS / 'fontawesome'; destination.mkdir(exist_ok=True)
    if supplied.exists():
        with zipfile.ZipFile(supplied) as archive:
            prefix = 'fontawesome-free-7.2.0-web/'
            (destination / 'LICENSE.txt').write_bytes(archive.read(prefix + 'LICENSE.txt'))
            for icon in FA:
                raw = archive.read(prefix + 'svgs/' + icon + '.svg')
                node = ET.fromstring(raw)
                if any(element.tag.split('}')[-1] not in ['svg', 'path', 'g'] for element in node.iter()):
                    raise ValueError(f'Unexpected SVG element in {icon}')
                (destination / (icon.split('/')[-1] + '.svg')).write_bytes(raw)
        manifest['fontawesome']['archiveSha256'] = hashlib.sha256(supplied.read_bytes()).hexdigest()
    else:
        if not (destination / 'LICENSE.txt').exists() or not all((destination / (name.split('/')[-1] + '.svg')).exists() for name in FA):
            raise SystemExit('Supply reference/fontawesome-free-7.2.0-web.zip or the prepared web/icons/fontawesome assets.')
        prior = ICONS / 'manifest.json'
        if prior.exists(): manifest['fontawesome']['archiveSha256'] = json.loads(prior.read_text(encoding='utf-8'))['fontawesome'].get('archiveSha256')
    manifest['fontawesome'].update(version='7.2.0', icons=FA, license='CC BY 4.0', changes='None to original SVG files; paths bundled into an SVG symbol sprite.')
    symbols = []
    for name in FA:
        raw = (destination / (name.split('/')[-1] + '.svg')).read_text(encoding='utf-8')
        viewbox = re.search(r'viewBox="([^"]+)"', raw)[1]
        body = raw[raw.index('>') + 1:raw.rindex('</svg>')]
        symbols.append(f'<symbol id="{name.split("/")[-1]}" viewBox="{viewbox}">{body}</symbol>')
    (ICONS / 'fontawesome.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg">\n' + '\n'.join(symbols) + '\n</svg>\n', encoding='utf-8')
    (ICONS / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')

    # This is the same embedded beginners' document that native fldigi writes.
    guide = (FLDIGI / 'dialogs/guide.cxx').read_text(encoding='utf-8').replace('\\\n', '')
    literal = guide[guide.index('"'):guide.rindex('"') + 1]
    document = ast.literal_eval(literal)
    (ROOT / 'web/beginners.html').write_text(document, encoding='utf-8')
    print(f'Prepared {len(ORIGINAL)} exact fldigi icons, {len(FA)} static Font Awesome candidates, and the original beginners guide.')


if __name__ == '__main__': main()
