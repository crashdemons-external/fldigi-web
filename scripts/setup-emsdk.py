"""Optional official Emscripten installation without npm or SDK activation hooks."""
from pathlib import Path
import shutil
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[1]
SDK=ROOT/'.tools/emsdk'
SDK_COMMIT='96c657fc60920d2a6a82318aa50e0abf82749604'
# Emscripten 6.0.11: official emsdk release tool. Installing the tool alone avoids
# sdk_post_install(), bundled Node installation, and npm ci lifecycle execution.
TOOL='releases-f6264d4a4dd9ba24a9f0a5702835a44d1463de13-64bit'

def run(*args):subprocess.run(list(args),cwd=ROOT,check=True)

if __name__=='__main__':
    if not shutil.which('git') or not shutil.which('node'):
        raise SystemExit('Install official Git and Node.js first. No packages are required.')
    if not SDK.exists():
        run('git','clone','--no-checkout','https://github.com/emscripten-core/emsdk.git',str(SDK))
        run('git','-C',str(SDK),'checkout',SDK_COMMIT)
    print('Installing the official Emscripten 6.0.11 compiler binaries. This is a large download.')
    run(sys.executable,str(SDK/'emsdk.py'),'install',TOOL)
    print('Ready. Run python scripts/build.py; SDK activation is unnecessary for this local installation.')
