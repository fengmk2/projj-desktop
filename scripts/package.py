#!/usr/bin/env python3
"""Build a self-contained desktop bundle, including Projj's CLI and backend."""
import os
import pathlib
import plistlib
import shutil
import subprocess
import platform

root = pathlib.Path(__file__).resolve().parent.parent
os.chdir(root)
subprocess.run(['cargo', 'build', '--release', '--bins', '--locked'], check=True)
runtime = os.environ.get('GPUI_SHELL')
if not runtime:
    runtime = subprocess.check_output(['python3', 'scripts/runtime.py'], text=True).strip().splitlines()[-1]
runtime = pathlib.Path(runtime).resolve()
version = '0.1.0'
dist = root / 'dist'
dist.mkdir(exist_ok=True)
if platform.system() == 'Darwin':
    destination = dist / 'Projj.app'
    if destination.exists(): shutil.rmtree(destination)
    contents = destination / 'Contents'
    executables = contents / 'MacOS'
    app = contents / 'Resources/app'
    executables.mkdir(parents=True)
    shutil.copy2(runtime, executables / 'gpui-shell')
    launcher = executables / 'Projj'
    launcher.write_text('''#!/bin/sh
set -eu
bundle_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
export PATH="$bundle_dir/Resources/app/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
exec "$bundle_dir/MacOS/gpui-shell"
''')
    launcher.chmod(0o755)
    with (contents / 'Info.plist').open('wb') as f:
        plistlib.dump(dict(CFBundleExecutable='Projj', CFBundleIdentifier='com.fengmk2.projj-desktop', CFBundleName='Projj', CFBundleDisplayName='Projj', CFBundlePackageType='APPL', CFBundleShortVersionString=version, CFBundleVersion='1', CFBundleIconFile='Projj', NSHighResolutionCapable=True, LSMinimumSystemVersion='12.0'),f)
else:
    destination = dist / 'projj-desktop'
    if destination.exists(): shutil.rmtree(destination)
    destination.mkdir()
    app = destination / 'app'
    shutil.copy2(runtime, destination / 'gpui-shell')
    launcher = destination / 'projj-desktop'
    launcher.write_text('''#!/bin/sh
set -eu
app_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
export PATH="$app_dir/app/bin:$PATH"
exec "$app_dir/gpui-shell"
''')
    launcher.chmod(0o755)
shutil.copytree(root / 'app', app, ignore=shutil.ignore_patterns('bin','gpui-kit.d.ts','jsconfig.json','AGENTS.md','node_modules','environment.js'))
(app / 'environment.js').write_text('export const projjHome = null;\n')
(app / 'bin').mkdir()
for binary in ['projj','projj-desktop-backend']:
    shutil.copy2(root / 'target/release' / binary, app / 'bin' / binary)
shutil.copy2(root / 'LICENSE', app / 'LICENSE')
shutil.copy2(root / 'licenses/gpui-shell.LICENSE', app / 'LICENSE-GPUI-SHELL')
# The runtime generates declarations and editor metadata on launch. Include
# those files before signing so the first launch does not alter sealed resources.
subprocess.run([str(runtime), 'types', '-d', str(app)], check=True)
if platform.system() == 'Darwin':
    iconset = dist / 'Projj.iconset'
    iconset.mkdir(exist_ok=True)
    master = dist / 'icon.png'
    subprocess.run(['xcrun','swift','scripts/icon.swift',str(master)], check=True)
    for size in [16,32,128,256,512]:
        for scale in [1,2]:
            suffix = '@2x' if scale == 2 else ''
            subprocess.run(['sips','-z',str(size*scale),str(size*scale),str(master),'--out',str(iconset / f'icon_{size}x{size}{suffix}.png')],check=True,stdout=subprocess.DEVNULL)
    subprocess.run(['iconutil','-c','icns',str(iconset),'-o',str(contents / 'Resources/Projj.icns')],check=True)
    subprocess.run(['codesign','--force','--deep','--sign','-',str(destination)],check=True)
print(destination)
