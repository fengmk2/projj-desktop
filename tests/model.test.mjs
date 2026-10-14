import { test } from "node:test";
import assert from "node:assert/strict";
import {
  filterRepos,
  parseArgs,
  stripAnsi,
  defaultConfig,
} from "../app/model.js";
const repos = [
  { key: "github.com/team/tiny-projj", host: "github.com", base: "/a" },
  { key: "github.com/team/projj", host: "github.com", base: "/a" },
  { key: "gitlab.com/team/projj", host: "gitlab.com", base: "/b" },
];
test("search ranks exact names first and combines host and base filters", () => {
  assert.equal(filterRepos(repos, "PROJJ")[0].key, "github.com/team/projj");
  assert.equal(filterRepos(repos, "projj", "gitlab.com", "/b").length, 1);
  assert.equal(filterRepos(repos, "", "github.com", "/b").length, 0);
});
test("task arguments retain quoted spaces and literal shell metacharacters", () => {
  assert.deepEqual(
    parseArgs(`--detail 'hello world' "" '$(touch bad)' a\\ b`),
    ["--detail", "hello world", "", "$(touch bad)", "a b"],
  );
  assert.throws(() => parseArgs('"open quote'), /Close the quote/);
  assert.throws(() => parseArgs("trailing\\"), /Close the quote/);
});
test("terminal control sequences are removed from displayed logs", () =>
  assert.equal(stripAnsi("\x1b[32mhello\x1b[0m\rnext"), "hello\nnext"));
test("new configuration quotes paths without losing spaces", () =>
  assert.ok(
    defaultConfig("/tmp/my repositories").includes(
      'base = ["/tmp/my repositories"]',
    ),
  ));
