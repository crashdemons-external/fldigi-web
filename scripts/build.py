"""Dependency-free Emscripten build, on Windows, macOS, or Linux."""
from pathlib import Path
import argparse
import json
import os
import shutil
import subprocess
import sys
import concurrent.futures
import hashlib

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--debug', action='store_true')
    args = parser.parse_args()
    subprocess.run([sys.executable, str(ROOT / 'scripts/prepare-source.py')], check=True)
    subprocess.run([sys.executable, str(ROOT / 'scripts/prepare-browser-core.py')], check=True)
    subprocess.run([sys.executable, str(ROOT / 'scripts/prepare-web-assets.py')], check=True)
    env = os.environ.copy()
    local_sdk = ROOT / '.tools/emsdk/upstream'
    emcc = shutil.which('em++') or shutil.which('em++.bat')
    if not emcc and (local_sdk / 'emscripten/em++.py').exists():
        config = ROOT / '.tools/emscripten-config.py'
        node = shutil.which('node')
        if not node: raise SystemExit('Node.js is required by Emscripten.')
        config.write_text(f"LLVM_ROOT = {str(local_sdk / 'bin')!r}\nBINARYEN_ROOT = {str(local_sdk)!r}\nNODE_JS = [{node!r}]\n")
        env['EM_CONFIG'] = str(config)
        compiler = [sys.executable, str(local_sdk / 'emscripten/em++.py')]
    elif emcc: compiler = [emcc]
    else: raise SystemExit('Emscripten is unavailable. Activate the official emsdk, then run this script again. See README.md.')
    sources = json.loads((ROOT / 'build/generated/sources.json').read_text())
    paths = [ROOT / 'vendor/fldigi/src' / p for p in sources]
    paths = [ROOT / 'build/generated' / p.name if (ROOT / 'build/generated' / p.name).exists() else p for p in paths]
    paths += [ROOT / 'native/web_modem.cpp', ROOT / 'native/core_api.cpp', ROOT / 'build/generated/mode_table.cpp']
    flags = ['-I' + str(ROOT / 'build/generated/include'), '-I' + str(ROOT / 'native'), '-std=c++17', '-Wno-deprecated-declarations', '-Wno-unused-value', '-Wno-parentheses', '-Wno-vla-cxx-extension', '-fexceptions']
    flags += ['-O0', '-g3'] if args.debug else ['-O3', '-g1']
    objdir = ROOT / 'build/objects'; objdir.mkdir(exist_ok=True)
    header_hash = hashlib.sha256()
    header_hash.update(subprocess.check_output(compiler+['--version'],env=env,cwd=ROOT))
    for header in sorted(list((ROOT / 'build/generated/include').rglob('*.h')) + list((ROOT / 'native').glob('*.h'))): header_hash.update(header.read_bytes())
    def compile_source(source):
        source_flags = flags
        if source.suffix == '.c':
            source_flags = [flag for flag in flags if flag != '-std=c++17'] + ['-x', 'c', '-std=c99']
        key = hashlib.sha256(source.read_bytes() + header_hash.digest() + repr(source_flags).encode()).hexdigest()
        obj = objdir / (source.stem + '-' + key[:16] + '.o')
        if obj.exists(): return obj, ''
        result = subprocess.run(compiler + source_flags + ['-c', str(source), '-o', str(obj)], env=env, cwd=ROOT, capture_output=True, text=True)
        return (obj if result.returncode == 0 else None), result.stdout + result.stderr
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(compile_source, paths))
    for _, output in results:
        if output: print(output)
    if any(obj is None for obj, _ in results): raise SystemExit(1)
    cmd = compiler + flags + [str(obj) for obj, _ in results]
    if args.debug: cmd += ['-sASSERTIONS=1']
    exports = ['_web_create', '_web_process', '_web_set_frequency', '_web_set_option', '_web_sample_rate', '_web_frequency', '_web_metric', '_web_bandwidth', '_web_modes', '_web_take_text', '_web_take_secondary', '_web_status1', '_web_status2', '_web_spectrum', '_web_spectrum_size', '_web_reset', '_web_channels', '_web_phase', '_web_phase_quality', '_malloc', '_free']
    exports += ['_web_take_raster','_web_raster_size','_web_raster_height']
    exports += ['_web_take_image_updates','_web_image_updates_size','_web_image_width','_web_image_height','_web_image_serial']
    exports += ['_web_flush', '_web_waterfall_geometry', '_web_scope']
    cmd += ['-sMODULARIZE=1', '-sEXPORT_ES6=1', '-sENVIRONMENT=web,worker,node', '-sALLOW_MEMORY_GROWTH=1', '-sINITIAL_MEMORY=33554432', '-sSTACK_SIZE=5242880', '-sEXPORTED_FUNCTIONS=' + json.dumps(exports), '-sEXPORTED_RUNTIME_METHODS=["UTF8ToString","HEAPF32","HEAPU8","HEAPU32"]', '-sFILESYSTEM=0', '-o', str(ROOT / 'web/fldigi-core.js')]
    (ROOT / 'web').mkdir(exist_ok=True)
    print('Building the original fldigi decoder sources with Emscripten...')
    result = subprocess.run(cmd, env=env, cwd=ROOT)
    if result.returncode: raise SystemExit(result.returncode)
    print('Built web/fldigi-core.js and web/fldigi-core.wasm')
    from datetime import datetime, timezone
    source_info = json.loads((ROOT / 'vendor/fldigi/SOURCE.json').read_text(encoding='utf-8'))
    build_info = {'fldigiVersion': source_info['version'], 'sourceArchiveSha256': source_info['sha256'],
                  'compiler': subprocess.check_output(compiler + ['--version'], env=env, cwd=ROOT, text=True).splitlines()[0],
                  'builtAt': datetime.now(timezone.utc).isoformat(), 'optimization': 'debug (-O0)' if args.debug else 'release (-O3)',
                  'wasmSha256': hashlib.sha256((ROOT / 'web/fldigi-core.wasm').read_bytes()).hexdigest()}
    (ROOT / 'web/build-info.json').write_text(json.dumps(build_info, indent=2) + '\n', encoding='utf-8')
    shutil.copyfile(ROOT/'COPYING',ROOT/'web/LICENSE.txt')
    shutil.copyfile(ROOT/'THIRD_PARTY_NOTICES.md',ROOT/'web/THIRD_PARTY_NOTICES.md')
    licenses = ROOT/'web/licenses';licenses.mkdir(exist_ok=True)
    for name in ['COPYING', 'COPYING.LIB']:
        shutil.copyfile(ROOT/'vendor/fldigi/src/libtiniconv'/name,licenses/('tiniconv-'+name))


if __name__ == '__main__': main()
