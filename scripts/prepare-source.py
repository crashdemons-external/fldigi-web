"""Extract the supplied fldigi archive without executing upstream build scripts."""
from pathlib import Path
import hashlib
import json
import zipfile

ROOT = Path(__file__).resolve().parents[1]
ARCHIVE = ROOT / "reference" / "fldigi-source.zip"
DEST = ROOT / "vendor" / "fldigi"
RESERVED = {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)), *(f"LPT{i}" for i in range(1, 10))}


def main():
    if not ARCHIVE.exists():
        if (DEST / 'SOURCE.json').exists() and (DEST / 'src/psk/psk.cxx').exists():
            print('Using the included prepared fldigi source.');return
        raise SystemExit(f"Missing supplied source archive: {ARCHIVE}")
    digest = hashlib.sha256(ARCHIVE.read_bytes()).hexdigest()
    manifest = DEST / "SOURCE.json"
    if manifest.exists() and json.loads(manifest.read_text())["sha256"] == digest:
        print("Supplied fldigi source is already prepared.")
        return
    renamed = {}
    with zipfile.ZipFile(ARCHIVE) as archive:
        prefix = archive.namelist()[0].split("/")[0] + "/"
        for entry in archive.infolist():
            relative = entry.filename.removeprefix(prefix)
            if not relative or entry.is_dir():
                continue
            parts = relative.split("/")
            if any(part in ("", ".", "..") for part in parts):
                raise SystemExit(f"Unsafe archive entry: {entry.filename}")
            safe = ["_" + part if part.split(".")[0].upper() in RESERVED else part for part in parts]
            target = DEST.joinpath(*safe)
            if not target.resolve().is_relative_to(DEST.resolve()):
                raise SystemExit(f"Entry leaves source directory: {entry.filename}")
            if safe != parts:
                renamed[relative] = "/".join(safe)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(archive.read(entry))
    manifest.write_text(json.dumps({"archive": ARCHIVE.name, "sha256": digest, "version": "4.2.13", "renamed_paths": renamed}, indent=2) + "\n")
    print(f"Prepared original fldigi source in {DEST}; {len(renamed)} reserved paths renamed.")


if __name__ == "__main__":
    main()
