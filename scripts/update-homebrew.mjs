#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { isMain } from "./tools.mjs";

const repository = "fengmk2/projj-desktop";
const stableVersion = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

export function releaseVersion(release) {
  const version = release.tag_name?.replace(/^v/, "");
  if (release.draft || release.prerelease || !stableVersion.test(version) || release.tag_name !== `v${version}`) {
    throw new Error("Expected a published stable release with a vX.Y.Z tag");
  }
  return version;
}

export function updateCask(current, release, checksums) {
  const version = releaseVersion(release);
  const currentVersion = current.match(/^  version "([^"]+)"$/m)?.[1];
  if (!stableVersion.test(currentVersion)) throw new Error("Cannot read the current cask version");
  const parts = version.split(".").map(BigInt);
  const previous = currentVersion.split(".").map(BigInt);
  const difference = parts.map((part, index) => part - previous[index]).find((part) => part !== 0n);
  // Maintenance releases and workflows that finish out of order must not downgrade the tap.
  if (difference < 0n) return current;

  const entries = new Map();
  for (const line of checksums.trim().split(/\r?\n/)) {
    const match = /^([a-f0-9]{64}) [ *](\S+)$/.exec(line);
    if (!match || entries.has(match[2])) throw new Error("Invalid or duplicate SHA256SUMS entry");
    entries.set(match[2], match[1]);
  }

  const hashes = ["arm64", "x86_64"].map((arch) => {
    const name = `Projj-v${version}-macOS-${arch}.zip`;
    const assets = release.assets.filter((asset) => asset.name === name);
    const hash = entries.get(name);
    const url = `https://github.com/${repository}/releases/download/v${version}/${name}`;
    if (assets.length !== 1 || assets[0].browser_download_url !== url || !hash || assets[0].digest !== `sha256:${hash}`) {
      throw new Error(`Missing asset or inconsistent checksum: ${name}`);
    }
    return hash;
  });

  const checksumPattern = /^  sha256 arm: +"[a-f0-9]{64}",\n +intel: "[a-f0-9]{64}"$/m;
  if (!checksumPattern.test(current)) throw new Error("Cannot read the cask checksums");
  const updated = current
    .replace(/^  version "[^"]+"$/m, `  version "${version}"`)
    .replace(checksumPattern, `  sha256 arm:   "${hashes[0]}",\n         intel: "${hashes[1]}"`);
  if (version === currentVersion && current !== updated) {
    throw new Error("Checksums changed for an existing version; publish a new version instead");
  }
  return updated;
}

async function download(url, headers = {}) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  return response;
}

export async function updateHomebrew(tag) {
  releaseVersion({ tag_name: tag });
  const headers = { Accept: "application/vnd.github+json" };
  if (process.env.GH_TOKEN) headers.Authorization = `Bearer ${process.env.GH_TOKEN}`;
  const release = await (await download(`https://api.github.com/repos/${repository}/releases/tags/${tag}`, headers)).json();
  if (release.tag_name !== tag) throw new Error("Release response does not match the requested tag");
  const version = releaseVersion(release);
  const checksums = await (await download(`https://github.com/${repository}/releases/download/v${version}/SHA256SUMS`)).text();
  const cask = new URL("../Casks/projj-desktop.rb", import.meta.url);
  const current = readFileSync(cask, "utf8");
  const updated = updateCask(current, release, checksums);
  if (updated !== current) writeFileSync(cask, updated);
  console.log(updated === current ? `Cask already contains ${version} or a newer version` : `Updated Projj Desktop to ${version}`);
}

if (isMain(import.meta.url)) await updateHomebrew(process.argv[2]);
