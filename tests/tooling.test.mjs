import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { releaseVersion } from "../scripts/release-version.mjs";
import { ensureRuntime, runtimeTarget } from "../scripts/runtime.mjs";

test("release tags match the Cargo version and classify prereleases", () => {
  assert.deepEqual(releaseVersion("0.1.0", "v0.1.0"), {
    tag: "v0.1.0",
    prerelease: false,
  });
  assert.deepEqual(releaseVersion("0.2.0-rc.1", "v0.2.0-rc.1"), {
    tag: "v0.2.0-rc.1",
    prerelease: true,
  });
  assert.deepEqual(releaseVersion("1.2.3"), {
    tag: "v1.2.3",
    prerelease: false,
  });
  assert.throws(() => releaseVersion("0.1.0", "v0.2.0"), /must match/);
  assert.throws(
    () => releaseVersion("0.1.0", "v0.1.0; echo invalid"),
    /must match/,
  );
  for (const version of [
    "01.0.0",
    "1.2",
    "1.2.3-rc.01",
    "1.2.3+build",
    "1.2.3\n",
  ]) {
    assert.throws(() => releaseVersion(version), /Release versions/);
  }
});

test("runtime targets follow the host architecture", () => {
  assert.equal(runtimeTarget("darwin", "arm64"), "aarch64-apple-darwin");
  assert.equal(runtimeTarget("darwin", "x64"), "x86_64-apple-darwin");
  assert.equal(runtimeTarget("linux", "x64"), "x86_64-unknown-linux-gnu");
  assert.throws(
    () => runtimeTarget("linux", "arm64"),
    /Supported desktop platforms/,
  );
  assert.throws(
    () => runtimeTarget("win32", "x64"),
    /Supported desktop platforms/,
  );
});

function runtimeFixture(context, executable = "test runtime\n") {
  const folder = mkdtempSync(join(tmpdir(), "projj-runtime-test-"));
  context.after(() => rmSync(folder, { recursive: true, force: true }));
  const name = `gpui-shell-${runtimeTarget()}`;
  const source = join(folder, "source");
  const cacheDir = join(folder, "cache");
  mkdirSync(join(source, name), { recursive: true });
  mkdirSync(cacheDir);
  writeFileSync(join(source, name, "gpui-shell"), executable, { mode: 0o755 });
  // Other archive entries must not be installed, especially links outside the cache.
  symlinkSync(join(folder, "outside"), join(source, name, "link"));
  const archive = join(cacheDir, `${name}.tar.gz`);
  execFileSync("tar", ["-czf", archive, "-C", source, name]);
  const checksum = createHash("sha256")
    .update(readFileSync(archive))
    .digest("hex");
  writeFileSync(`${archive}.sha256`, `${checksum}  ${name}.tar.gz\n`);
  return { cacheDir, name, archive };
}

test("runtime install checks integrity and preserves the cached executable", (context) => {
  const fixture = runtimeFixture(context);
  const binary = ensureRuntime(fixture);
  assert.equal(readFileSync(binary, "utf8"), "test runtime\n");
  assert.ok(statSync(binary).mode & 0o111);
  assert.equal(existsSync(join(fixture.cacheDir, fixture.name, "link")), false);
  const inode = statSync(binary).ino;
  assert.equal(ensureRuntime(fixture), binary);
  assert.equal(statSync(binary).ino, inode);
  writeFileSync(fixture.archive, "corrupted archive");
  assert.throws(() => ensureRuntime(fixture), /Checksum mismatch/);
  assert.equal(readFileSync(binary, "utf8"), "test runtime\n");
});

test("runtime install rejects an empty executable without leaving a cached binary", (context) => {
  const fixture = runtimeFixture(context, "");
  assert.throws(() => ensureRuntime(fixture), /no executable/);
  assert.equal(existsSync(join(fixture.cacheDir, fixture.name)), false);
});
