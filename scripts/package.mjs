#!/usr/bin/env node
// Build a self-contained desktop bundle, including Projj's CLI and backend.
import {
  chmodSync,
  copyFileSync,
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { ensureRuntime } from "./runtime.mjs";
import { packageVersion, root, run } from "./tools.mjs";

process.chdir(root);
const version = packageVersion();
run("cargo", ["build", "--release", "--bins", "--locked"]);
const runtime = resolve(process.env.GPUI_SHELL || ensureRuntime());
const dist = join(root, "dist");
mkdirSync(dist, { recursive: true });
const macOS = process.platform === "darwin";
const destination = join(dist, macOS ? "Projj.app" : "projj-desktop");
const contents = join(destination, "Contents");
const app = macOS ? join(contents, "Resources/app") : join(destination, "app");
rmSync(destination, { recursive: true, force: true });

function copyExecutable(source, target) {
  copyFileSync(source, target);
  chmodSync(target, 0o755);
}

if (macOS) {
  const executables = join(contents, "MacOS");
  mkdirSync(executables, { recursive: true });
  copyExecutable(runtime, join(executables, "gpui-shell"));
  const launcher = join(executables, "Projj");
  writeFileSync(
    launcher,
    `#!/bin/sh
set -eu
bundle_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
export PATH="$bundle_dir/Resources/app/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
exec "$bundle_dir/MacOS/gpui-shell"
`,
    { mode: 0o755 },
  );
  const bundleVersion = version.split("-", 1)[0];
  run("plutil", ["-convert", "xml1", "-o", join(contents, "Info.plist"), "-"], {
    stdio: ["pipe", "inherit", "inherit"],
    input: JSON.stringify({
      CFBundleExecutable: "Projj",
      CFBundleIdentifier: "com.fengmk2.projj-desktop",
      CFBundleName: "Projj",
      CFBundleDisplayName: "Projj",
      CFBundlePackageType: "APPL",
      CFBundleShortVersionString: bundleVersion,
      CFBundleVersion: bundleVersion,
      CFBundleIconFile: "Projj",
      NSHighResolutionCapable: true,
      LSMinimumSystemVersion: "12.0",
    }),
  });
} else {
  mkdirSync(destination, { recursive: true });
  copyExecutable(runtime, join(destination, "gpui-shell"));
  writeFileSync(
    join(destination, "projj-desktop"),
    `#!/bin/sh
set -eu
app_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
export PATH="$app_dir/app/bin:$PATH"
exec "$app_dir/gpui-shell"
`,
    { mode: 0o755 },
  );
}

const excluded = new Set([
  "bin",
  "gpui-kit.d.ts",
  "jsconfig.json",
  "AGENTS.md",
  "node_modules",
  "environment.js",
  ".DS_Store",
]);
cpSync(join(root, "app"), app, {
  recursive: true,
  filter: (source) => !excluded.has(basename(source)),
});
const manifestPath = join(app, "gpui-shell.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
manifest.version = version;
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
writeFileSync(join(app, "environment.js"), "export const projjHome = null;\n");
mkdirSync(join(app, "bin"));
for (const binary of ["projj", "projj-desktop-backend"]) {
  copyExecutable(
    join(root, "target/release", binary),
    join(app, "bin", binary),
  );
}
copyFileSync(join(root, "LICENSE"), join(app, "LICENSE"));
copyFileSync(
  join(root, "licenses/gpui-shell.LICENSE"),
  join(app, "LICENSE-GPUI-SHELL"),
);
// Generate editor metadata before signing so the first launch preserves the seal.
run(runtime, ["types", "-d", app]);
if (macOS) {
  const iconset = join(dist, "Projj.iconset");
  mkdirSync(iconset, { recursive: true });
  const master = join(dist, "icon.png");
  run("xcrun", ["swift", "scripts/icon.swift", master]);
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      const suffix = scale === 2 ? "@2x" : "";
      run(
        "sips",
        [
          "-z",
          String(size * scale),
          String(size * scale),
          master,
          "--out",
          join(iconset, `icon_${size}x${size}${suffix}.png`),
        ],
        {
          stdio: ["ignore", "ignore", "inherit"],
        },
      );
    }
  }
  run("iconutil", [
    "-c",
    "icns",
    iconset,
    "-o",
    join(contents, "Resources/Projj.icns"),
  ]);
  run("codesign", ["--force", "--deep", "--sign", "-", destination]);
}
console.log(destination);
