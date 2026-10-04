"""Create a static-site ZIP for deployment."""
from pathlib import Path
import zipfile

ROOT=Path(__file__).resolve().parents[1]

if __name__=='__main__':
    destination=ROOT/'build/fldigi-web.zip';destination.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(destination,'w',zipfile.ZIP_DEFLATED) as archive:
        for path in sorted((ROOT/'web').rglob('*')):
            if path.is_file() and path.name != 'fldigi-web-source.zip':
                archive.write(path,path.relative_to(ROOT/'web').as_posix())
    print(f'Static website: {destination}')
