#!/usr/bin/env node
// Materialize every screen and dialog without executing backend operations.
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { ensureRuntime } from "./runtime.mjs";
import { root } from "./tools.mjs";

const runtime = resolve(process.env.GPUI_SHELL || ensureRuntime());
const repo = {
  path: "/test/github.com/acme/projj",
  base: "/test",
  host: "github.com",
  owner: "acme",
  name: "projj",
  key: "github.com/acme/projj",
  shortKey: "acme/projj",
  url: "git@github.com:acme/projj.git",
};
const data = {
  initialized: true,
  configPath: "/test/.projj/config.toml",
  configText: 'base = "/test"',
  config: { hooks: [{ event: "post_add", tasks: ["zoxide"], env: {} }] },
  repos: [repo],
  bases: ["/test"],
  tasks: [{ name: "status", kind: "script", command: "/test/status" }],
  jobs: [],
};
const states = {
  loading: "this.data=null;",
  onboarding:
    'this.data.initialized=false;this.data.defaultBase="/test/repos";',
  empty: "this.data.repos=[];",
  library: "",
  details: `this.selected=${JSON.stringify(repo.path)};this.detail={status:"## main\\n M README.md"};`,
  tasks: 'this.page="tasks";',
  "active-job":
    'this.page="tasks";this.jobs=[{id:"example",state:"running",started:1,operation:"run",label:"status",log:"Hello\\nWorld"}];',
  "failed-job":
    'this.page="tasks";this.jobs=[{id:"example",state:"failed",started:1,operation:"run",label:"status",log:"Error",error:"Command failed",truncated:true}];',
  hooks: 'this.page="hooks";',
  settings: 'this.page="settings";',
  repair: 'this.data=null;this.page="settings";this.error="Invalid TOML";',
  add: 'this.modal="add";',
  preview:
    'this.modal="add";this.preview={target:"/test/github.com/acme/project",exists:false};',
  remove: `this.modal="remove";this.selected=${JSON.stringify(repo.path)};`,
  script: 'this.modal="script";',
  clean: 'this.modal="clean";this.scope="all";',
  dark: "this.dark=true;applyTheme(true);",
};
const temporary = mkdtempSync(join(tmpdir(), "projj-ui-"));
try {
  const app = join(temporary, "app");
  cpSync(join(root, "app"), app, {
    recursive: true,
    filter: (source) =>
      !["bin", "gpui-kit.d.ts", "node_modules"].includes(basename(source)),
  });
  writeFileSync(
    join(app, "environment.js"),
    `export const projjHome=${JSON.stringify(join(temporary, "home"))};\n`,
  );
  const manifestPath = join(app, "gpui-shell.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.entry = "check.js";
  writeFileSync(manifestPath, JSON.stringify(manifest));
  for (const [name, setup] of Object.entries(states)) {
    writeFileSync(
      join(app, "check.js"),
      `import Projj from "./main.js";
import {applyTheme} from "./theme.js";
export default class Check extends Projj {
  refresh() {}
  poll() {}
  init(props,cx) { super.init(props,cx); this.accept(${JSON.stringify(data)}); ${setup} }
}
`,
    );
    const result = spawnSync(runtime, ["check", "-d", app], {
      encoding: "utf8",
    });
    if (result.error) throw result.error;
    if (result.status !== 0)
      throw new Error(`${name}:\n${result.stdout}\n${result.stderr}`);
    console.log(`PASS ${name}`);
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
