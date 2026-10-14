/** Shared, runtime-independent presentation logic. */
export function filterRepos(repos, query = "", host = "", base = "") {
  const q = query.trim().toLowerCase();
  return repos
    .filter(
      (r) =>
        (!host || r.host === host) &&
        (!base || r.base === base) &&
        r.key.toLowerCase().includes(q),
    )
    .sort(
      (a, b) =>
        Number(b.key.toLowerCase().endsWith("/" + q)) -
          Number(a.key.toLowerCase().endsWith("/" + q)) ||
        a.key.localeCompare(b.key),
    );
}
export function parseArgs(source) {
  const args = [];
  let token = "",
    quote = "",
    escaped = false,
    started = false;
  for (const c of source) {
    if (escaped) {
      token += c;
      escaped = false;
      started = true;
    } else if (c === "\\" && quote !== "'") {
      escaped = true;
      started = true;
    } else if (quote) {
      if (c === quote) quote = "";
      else token += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      started = true;
    } else if (/\s/.test(c)) {
      if (started) {
        args.push(token);
        token = "";
        started = false;
      }
    } else {
      token += c;
      started = true;
    }
  }
  if (quote || escaped)
    throw new Error("Close the quote or escape in the arguments field.");
  if (started) args.push(token);
  return args;
}
export const shortPath = (path) =>
  path.split("/").filter(Boolean).slice(-2).join("/");
export const stripAnsi = (text) =>
  String(text || "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\r/g, "\n");
export const defaultConfig = (base) =>
  `base = [${JSON.stringify(base)}]\nplatform = "github.com"\n\n[tasks]\nupdate = "git fetch --all --prune && git pull --ff-only"\n\n[[hooks]]\nevent = "post_add"\ntasks = ["zoxide"]\n`;
export const hookTemplate =
  '\n[[hooks]]\nevent = "post_add"\nmatcher = "github\\\\.com"\ntasks = ["git-config-user"]\nenv = { GIT_USER_NAME = "Your name", GIT_USER_EMAIL = "you@example.com" }\n';
