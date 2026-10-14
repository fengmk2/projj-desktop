#!/usr/bin/env python3
"""Download the pinned official runtime and verify its release checksum."""
import hashlib
import pathlib
import platform
import subprocess
import tarfile
import tempfile
import shutil

root = pathlib.Path(__file__).resolve().parent.parent
system = platform.system()
arch = platform.machine()
if system == 'Darwin':
    target = ('aarch64' if arch == 'arm64' else 'x86_64') + '-apple-darwin'
elif system == 'Linux' and arch == 'x86_64':
    target = 'x86_64-unknown-linux-gnu'
else:
    raise SystemExit('Supported desktop platforms: macOS and x86-64 Linux.')
name = f'gpui-shell-{target}'
cache = root / '.tools'
cache.mkdir(exist_ok=True)
archive = cache / f'{name}.tar.gz'
checksum = cache / f'{name}.tar.gz.sha256'
url = f'https://github.com/longbridge/gpui-kit/releases/download/v0.7.3/{name}.tar.gz'
for path, suffix in [(archive, ''), (checksum, '.sha256')]:
    if not path.exists():
        temp = path.with_suffix(path.suffix + '.part')
        subprocess.run(['curl', '-fL', '--retry', '3', '-o', str(temp), url + suffix], check=True)
        temp.rename(path)
expected = checksum.read_text().split()[0]
if hashlib.sha256(archive.read_bytes()).hexdigest() != expected:
    raise SystemExit(f'Checksum mismatch: remove {archive} and try again.')
if not (cache / name / 'gpui-shell').exists():
    with tempfile.TemporaryDirectory(dir=cache) as stage:
        stage = pathlib.Path(stage)
        with tarfile.open(archive) as tar:
            for member in tar.getmembers():
                target_path = (stage / member.name).resolve()
                if not target_path.is_relative_to(stage.resolve()) or member.issym() or member.islnk():
                    raise SystemExit('Unsafe archive member: ' + member.name)
            tar.extractall(stage)
        shutil.move(str(stage / name), cache / name)
print(cache / name / 'gpui-shell')
