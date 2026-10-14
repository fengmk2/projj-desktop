#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
python3 - <<'PYENV'
import json, os, pathlib
pathlib.Path('app/environment.js').write_text('export const projjHome = ' + json.dumps(os.environ.get('PROJJ_HOME')) + ';\n')
PYENV
cargo build --bins
mkdir -p app/bin
cp target/debug/projj target/debug/projj-desktop-backend app/bin/
export PATH="$PWD/app/bin:$PATH"
shell_bin="${GPUI_SHELL:-}"
if [ -z "$shell_bin" ]; then
  shell_bin=$(command -v gpui-shell || true)
fi
if [ -z "$shell_bin" ]; then
  shell_bin=$(python3 scripts/runtime.py)
fi
if [ "${1:-}" = check ]; then
  exec "$shell_bin" check -d app
fi
exec "$shell_bin" run -d app --watch
