#!/usr/bin/env node
// Download the pinned official runtime and verify its release checksum.
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { isMain, root, run } from "./tools.mjs";

export function runtimeTarget(
  platform = process.platform,
  arch = process.arch,
) {
  if (platform === "darwin" && ["arm64", "x64"].includes(arch)) {
    return `${arch === "arm64" ? "aarch64" : "x86_64"}-apple-darwin`;
  }
  if (platform === "linux" && arch === "x64") return "x86_64-unknown-linux-gnu";
  throw new Error("Supported desktop platforms: macOS and x86-64 Linux.");
}

export function ensureRuntime({ cacheDir = join(root, ".tools") } = {}) {
  const name = `gpui-shell-${runtimeTarget()}`;
  mkdirSync(cacheDir, { recursive: true });
  const archive = join(cacheDir, `${name}.tar.gz`);
  const checksum = `${archive}.sha256`;
  const url = `https://github.com/longbridge/gpui-kit/releases/download/v0.7.3/${name}.tar.gz`;
  for (const [destination, suffix] of [
    [archive, ""],
    [checksum, ".sha256"],
  ]) {
    if (!existsSync(destination)) {
      const temporary = `${destination}.part`;
      run("curl", ["-fL", "--retry", "3", "-o", temporary, url + suffix]);
      renameSync(temporary, destination);
    }
  }
  const expected = readFileSync(checksum, "utf8").trim().split(/\s+/)[0];
  const actual = createHash("sha256")
    .update(readFileSync(archive))
    .digest("hex");
  if (!/^[a-f0-9]{64}$/i.test(expected) || actual !== expected.toLowerCase()) {
    throw new Error(`Checksum mismatch: remove ${archive} and try again.`);
  }
  const binary = join(cacheDir, name, "gpui-shell");
  if (!existsSync(binary)) {
    const stage = mkdtempSync(join(cacheDir, "runtime-"));
    try {
      const stagedBinary = join(stage, "gpui-shell");
      const fd = openSync(stagedBinary, "wx", 0o755);
      try {
        // Read only the named binary to stdout. Archive paths and links never
        // become filesystem entries, and a running cached binary is not replaced.
        run("tar", ["-xOzf", archive, `${name}/gpui-shell`], {
          stdio: ["ignore", fd, "inherit"],
        });
      } finally {
        closeSync(fd);
      }
      if (!statSync(stagedBinary).size)
        throw new Error("Runtime archive has no executable");
      renameSync(stage, join(cacheDir, name));
    } finally {
      rmSync(stage, { recursive: true, force: true });
    }
  }
  return binary;
}

if (isMain(import.meta.url)) console.log(ensureRuntime());
