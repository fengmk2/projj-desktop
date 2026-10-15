import { test } from "node:test";
import assert from "node:assert/strict";
import {
  filterRepos,
  parseArgs,
  buildRunRequest,
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
test("command scopes exclude stale targets and preserve literal arguments", () => {
  const input = {
    task: " printf '%s\\n' ",
    args: "'hello world' '$(touch bad)'",
    scope: "all",
    selected: "/repos/previous",
    cwd: "/previous/directory",
    pattern: "(?i)github\\.com/team/",
  };
  const all = buildRunRequest(input);
  assert.deepEqual(all, {
    operation: "run",
    task: "printf '%s\\n'",
    args: ["hello world", "$(touch bad)"],
    all: true,
    pattern: input.pattern,
  });
  const directory = buildRunRequest({ ...input, scope: "directory" });
  assert.equal(directory.cwd, input.cwd);
  assert.equal(directory.path, undefined);
  assert.equal(directory.all, undefined);
  assert.equal(directory.pattern, undefined);
  const selected = buildRunRequest({ ...input, scope: "selected" });
  assert.equal(selected.path, input.selected);
  assert.equal(selected.cwd, undefined);
  assert.equal(selected.pattern, undefined);
  assert.equal(buildRunRequest({ ...input, selected: "", cwd: "" }).all, true);
  assert.throws(
    () => buildRunRequest({ ...input, scope: "directory", cwd: "" }),
    /absolute working directory/,
  );
  assert.throws(
    () =>
      buildRunRequest({ ...input, scope: "directory", cwd: "relative/path" }),
    /absolute working directory/,
  );
  assert.throws(
    () => buildRunRequest({ ...input, scope: "selected", selected: "" }),
    /Select a repository/,
  );
  assert.throws(() => buildRunRequest({ ...input, task: " " }), /Enter a task/);
});
test("new configuration quotes paths without losing spaces", () =>
  assert.ok(
    defaultConfig("/tmp/my repositories").includes(
      'base = ["/tmp/my repositories"]',
    ),
  ));
