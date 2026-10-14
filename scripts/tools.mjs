import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("../", import.meta.url));

export function run(program, args, options = {}) {
  return execFileSync(program, args, {
    cwd: root,
    stdio: "inherit",
    ...options,
  });
}

export function packageVersion() {
  const metadata = JSON.parse(
    run(
      "cargo",
      ["metadata", "--no-deps", "--format-version", "1", "--locked"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "inherit"],
      },
    ),
  );
  return metadata.packages.find((pkg) => pkg.name === "projj").version;
}

export function isMain(url) {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(url);
}
