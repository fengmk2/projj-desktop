# Projj Desktop

A native desktop home for your Git repositories, built with [gpui-shell](https://gpui-kit.com/shell/). The interface is JavaScript rendered by GPUI; the backend and bundled CLI share Projj's Rust core. There is no browser engine or Node.js runtime in the app.

## Run

Requires Git, stable Rust (edition 2024), and Python 3.9+. Node.js is only needed for the JavaScript tests.

```sh
git clone https://github.com/fengmk2/projj-desktop.git
cd projj-desktop
python3 scripts/runtime.py
scripts/dev.sh
```

The downloader pins gpui-shell `0.7.3` and verifies the official archive's SHA-256 checksum. Set `GPUI_SHELL=/absolute/path/to/gpui-shell` to use an existing installation. Supported package targets are macOS (Apple silicon or Intel) and Linux x86-64. Native UI testing was performed on Apple silicon macOS.

Build a standalone app:

```sh
python3 scripts/package.py
```

On macOS, open `dist/Projj.app` or copy it to `~/Applications`. On Linux, run `dist/projj-desktop/projj-desktop`. The bundle includes the runtime, scripts, Rust backend, and full `projj` CLI. Git and any tools your tasks use remain system dependencies. The macOS build uses an ad-hoc signature; distribution with a Developer ID and notarization requires your own Apple signing credentials.

## Features

| Projj command or feature | Desktop access |
| --- | --- |
| `init` | First-run setup creates configuration and installs all five built-in tasks without replacing existing files. |
| `add` | Add repository accepts short names, HTTPS, SSH with ports, and local paths. Choose a base directory and preview the destination. Existing destinations skip hooks. |
| `find` / `list` | Search by repository, owner, or host; exact names rank first. Filter by host and base directory, copy paths, inspect Git status, and open a folder or terminal. The list is virtualized. |
| `remove` | Select a repository and type its full `owner/repo` name to confirm permanent deletion. Both removal hook events run. |
| `run` | Run inline tasks, executable scripts, or raw commands in the selected repository, a custom directory, or all repositories. Apply a regex filter and pass quoted arguments. |
| Interactive tasks | **Run in Terminal** supports prompts, including per-directory cleanup confirmation. Background runs have captured logs and a Stop button. |
| Built-in tasks | `status`, `clean`, `zoxide`, `git-config-user`, and the deprecated `repo-status` alias are included. `status --detail` reports ignored files; `clean` previews first and supports filtered or confirmed cleanup. |
| Hooks | Automation shows `pre_add`, `post_add`, `pre_remove`, and `post_remove`. Edit regex matchers, ordered task lists, and custom environment variables in Settings. Hooks receive the original `PROJJ_*` variables and JSON on stdin. |
| Configuration | Edit the shared TOML, including multiple base directories, default host, tasks, and hooks. Saves validate the file and reject changes if another program edited it in the meantime. Comments are preserved. |
| Task scripts | Create and edit executable files under `~/.projj/tasks` from Tasks & activity. Inline tasks still take precedence. |
| Shell integration | Copy setup or full completion scripts for Bash, Zsh, and Fish. The included CLI provides the `p` navigation function and task completion. |

The [CLI reference](docs/CLI.md) describes the original commands, configuration, built-ins, and environment variables. The repository retains upstream history and its tests.

## Data and permissions

The app reads the same `~/.projj/config.toml` and `~/.projj/tasks/` as the CLI. Repositories remain ordinary directories; no catalog database or migration is required. Refresh picks up external filesystem and configuration changes.

Jobs and their full logs are stored under `~/.projj/desktop/jobs/`. The interface lists the latest 30 jobs and bounds displayed output. Jobs continue if the window closes and appear again after restart. Cancellation stops the worker process group; it does not undo changes already made by a command, clone, move, or hook. A failed post-add hook leaves the newly added repository in place. A failed pre-remove hook preserves the repository.

The manifest grants only:

- Execution of `projj-desktop-backend`, which handles repository files, Git, tasks, and opening local folders or terminals. Task commands and hooks have your normal user privileges.
- Clipboard writes for paths, output, and shell setup.
- App storage for the appearance preference.

The UI itself has no direct filesystem or network access. Git uses your usual config and credential helpers. Since gpui-shell clears child environments, the helper restores a home directory, standard executable paths, UTF-8 locale, and the macOS login SSH agent. It includes Homebrew, `~/.local/bin`, `~/.cargo/bin`, and `~/.vite-plus/bin`. For custom tools, agents, proxies, or environment variables, add a table in Settings:

```toml
[desktop.environment]
PATH = "/my/tools:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
# SSH_AUTH_SOCK = "/path/to/your/agent.sock"
```

Use an interactive terminal task for commands that need password prompts. Background Git operations use configured credentials and fail visibly if authentication is unavailable.

For an isolated development home:

```sh
PROJJ_HOME=/absolute/path/to/test-home scripts/dev.sh
```

This writes an ignored launch module with the explicit home override because gpui-shell does not pass it through to child processes. Packaged builds always use the normal home. Do not set `HOME` or `PROJJ_HOME` inside `[desktop.environment]`.

## Shortcuts

- `⌘N`: add a repository
- `⌘R`: refresh
- `⌘1`–`⌘4`: repositories, tasks, automation, settings
- `⌘S`: save settings
- `Escape`: close a dialog

The platform modifier follows gpui-shell's native keyboard mapping.

## Development and verification

```sh
cargo test --all-features
cargo clippy --all-targets -- -D warnings
cargo fmt --all --check
node --test tests/model.test.mjs
scripts/dev.sh check
python3 scripts/check-ui.py
```

The Rust tests cover the shared core, CLI interactions, and desktop operations against temporary directories and local Git remotes. Desktop tests include clone/move, hook order and failures, typed removal, shell integration, cleanup, literal arguments, batch filtering, job cancellation, stale process IDs, and gpui-shell's empty child environment. The UI checker materializes every screen and dialog with a test view that cannot execute backend operations. Also test behavioral changes in a live window; a one-frame check does not prove interaction or layout behavior.

`app/main.js` contains the view, `app/model.js` contains pure presentation logic, and `src/desktop/main.rs` implements the JSON helper and background workers. Generated declarations, runtime binaries, test homes, and bundles are ignored. Use `gpui-shell types -d app` after changing runtime versions.

## Reference and differences

Based on [popomore/projj](https://github.com/popomore/projj), starting at `1083f8a`. The original CLI remains included. This desktop version adds native selection, background activity, script/configuration editors, nested GitLab namespace discovery under DNS-named host directories, and correct no-op behavior when optional zoxide or Git identity settings are absent. Arguments in the desktop arguments field are passed literally; shell operators belong in the command field. Removal keeps the parent directory available until post-remove hooks finish.

Runtime and packaging follow the [official gpui-shell documentation](https://gpui-kit.com/shell/). [huacnlee/gpui-shell-benchs](https://github.com/huacnlee/gpui-shell-benchs) provided working examples and notes on runtime limitations. The interface and vector icons in this repository were created for Projj; no benchmark application's visual design or sample content is shipped.

## License

[MIT](LICENSE). Original Projj copyright is retained. The bundled gpui-shell runtime uses Apache-2.0; its license is included when packaging.
