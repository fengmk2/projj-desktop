#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
node --input-type=module <<'JS'
import { writeFileSync } from 'node:fs';
writeFileSync('app/environment.js', 'export const projjHome = ' + JSON.stringify(process.env.PROJJ_HOME ?? null) + ';\n');
JS
cargo build --bins
mkdir -p app/bin
cp target/debug/projj target/debug/projj-desktop-backend app/bin/
export PATH="$PWD/app/bin:$PATH"
shell_bin="${GPUI_SHELL:-}"
if [ -z "$shell_bin" ]; then
  shell_bin=$(command -v gpui-shell || true)
fi
if [ -z "$shell_bin" ]; then
  shell_bin=$(node scripts/runtime.mjs)
fi
if [ "${1:-}" = check ]; then
  exec "$shell_bin" check -d app
fi
exec "$shell_bin" run -d app --watch
