#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { isMain, packageVersion } from "./tools.mjs";

export function releaseVersion(version, requestedTag = "") {
  const match =
    /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(
      version,
    );
  if (!match || match[4]?.split(".").some((part) => /^0[0-9]+$/.test(part))) {
    throw new Error("Release versions must be X.Y.Z or X.Y.Z-prerelease");
  }
  const tag = `v${version}`;
  if (requestedTag && requestedTag !== tag) {
    throw new Error(`Tag must match Cargo.toml: expected ${tag}`);
  }
  return { tag, prerelease: Boolean(match[4]) };
}

if (isMain(import.meta.url)) {
  const release = releaseVersion(packageVersion(), process.env.RELEASE_TAG);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `tag=${release.tag}\nprerelease=${release.prerelease}\n`,
    );
  } else {
    console.log(JSON.stringify(release));
  }
}
