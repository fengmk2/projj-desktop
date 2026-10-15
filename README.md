# Projj Desktop

A native desktop home for your Git repositories, built with [gpui-shell](https://gpui-kit.com/shell/). The interface is JavaScript rendered by GPUI; the backend and bundled CLI share Projj's Rust core. There is no browser engine or Node.js runtime in the app.

## Quick tour

https://github.com/user-attachments/assets/eccb68a9-6c8a-4b78-aa13-6d59894cb68c

This 51-second captioned walkthrough uses example repositories and soft instrumental background music. Unmute the player to hear the music. It shows repository search and details, tasks for one or all repositories, adding a local repository with a destination preview, automation hooks, and the shared CLI configuration.

[Animated preview](docs/media/projj-demo.gif) · [Download MP4](https://github.com/fengmk2/projj-desktop/raw/refs/heads/main/docs/media/projj-demo.mp4)

## Install

### Homebrew (macOS)

On macOS 12 or later, with Apple silicon or Intel:

```sh
brew tap fengmk2/projj-desktop https://github.com/fengmk2/projj-desktop.git
brew install --cask fengmk2/projj-desktop/app
```

The `fengmk2/projj-desktop` tap is hosted in this repository.

This installs `Projj.app` in `/Applications` and adds the bundled `projj` CLI to Homebrew's `bin` directory. Open **Projj** from Applications or run `open -a Projj`. Git must be available on your system; Node.js and Rust are not required. To keep an existing CLI installation, add `--no-binaries` to the install command.

To update:

```sh
brew update
brew upgrade --cask fengmk2/projj-desktop/app
```

To uninstall, run `brew uninstall --cask fengmk2/projj-desktop/app`. Your `~/.projj` configuration and repositories are preserved. The cask is maintained in [`Casks/app.rb`](Casks/app.rb).

### Release downloads

Download a package for macOS or Linux from [GitHub Releases](https://github.com/fengmk2/projj-desktop/releases/latest). The macOS app uses an ad-hoc signature and is not notarized. If macOS blocks the first launch, use **System Settings → Privacy & Security → Open Anyway** after reviewing the downloaded app. This also applies to Homebrew installs.

To view the installed version in the desktop app, click **About Projj** at the bottom of the sidebar. Use **Copy version** to include it in a bug report.

## Run from source

Requires Git, stable Rust (edition 2024), and Node.js 22+. Development and packaging scripts use Node.js built-ins and the platform's `curl` and `tar` tools; no npm dependencies need to be installed. Node.js is not needed to run a packaged app.

```sh
git clone https://github.com/fengmk2/projj-desktop.git
cd projj-desktop
npm run runtime
scripts/dev.sh
```

The downloader pins gpui-shell `0.7.3` and verifies the official archive's SHA-256 checksum. Set `GPUI_SHELL=/absolute/path/to/gpui-shell` to use an existing installation. Supported package targets are macOS (Apple silicon or Intel) and Linux x86-64. Native UI testing was performed on Apple silicon macOS.

Build a standalone app:

```sh
npm run package
```

On macOS, open `dist/Projj.app` or copy it to `~/Applications`. On Linux, run `dist/projj-desktop/projj-desktop`. The bundle includes the runtime, scripts, Rust backend, and full `projj` CLI. Git and any tools your tasks use remain system dependencies. The macOS build uses an ad-hoc signature; distribution with a Developer ID and notarization requires your own Apple signing credentials.

## Releases

The [Release workflow](.github/workflows/release.yml) publishes a GitHub Release when a `v*` tag is pushed. The tag must match the package version in `Cargo.toml`. For example, with version `1.0.0`:

```sh
git tag -a v1.0.0 -m "Release v1.0.0"
git push origin v1.0.0
```

For a new version, update `Cargo.toml`, run `cargo check` to update `Cargo.lock`, and commit both files before tagging. Packaging reads the Cargo version for the CLI, About dialog, app manifest, and macOS bundle metadata. Tags such as `v0.2.0-rc.1` create prereleases.

The workflow tests and builds on each target before publishing:

- `Projj-vX.Y.Z-macOS-arm64.zip`
- `Projj-vX.Y.Z-macOS-x86_64.zip`
- `Projj-vX.Y.Z-Linux-x86_64.tar.gz`
- `SHA256SUMS`

Release notes are generated automatically. The workflow uses the repository's `GITHUB_TOKEN`; no additional publishing secret is required. macOS packages use ad-hoc signing. Select **Run workflow** in GitHub Actions for a build-only check: it uploads workflow artifacts and does not create a release.

After publishing a stable release, the same workflow calls [Update Homebrew cask](.github/workflows/homebrew.yml). It verifies both macOS checksums against `SHA256SUMS` and GitHub's asset digests, then commits the cask version and checksums to `main` using this repository's `GITHUB_TOKEN`. Prereleases do not change the cask, and older maintenance releases cannot downgrade it. No second repository or scheduled sync is required.

If the cask update fails after a release is published, retry it without rebuilding the packages:

```sh
gh workflow run homebrew.yml --repo fengmk2/projj-desktop -f tag=v1.0.0
```

## Features

| Projj command or feature | Desktop access |
| --- | --- |
| `init` | First-run setup creates configuration and installs all four built-in tasks without replacing existing files. |
| `add` | Add repository accepts short names, HTTPS, SSH with ports, and local paths. Choose a base directory and preview the destination. Existing destinations skip hooks. |
| `find` / `list` | Search by repository, owner, or host; exact names rank first. Filter by host and base directory, copy paths, inspect Git status, and open a folder or terminal. The list is virtualized. |
| `remove` | Select a repository and type its full `owner/repo` name to confirm permanent deletion. Both removal hook events run. |
| `run` | Run inline tasks, executable scripts, or raw commands in the selected repository, a custom directory, or all repositories. Apply a regex filter and pass quoted arguments. |
| Interactive tasks | **Run in Terminal** supports prompts, including per-directory cleanup confirmation. Background runs have captured logs and a Stop button. |
| Built-in tasks | `status`, `clean`, `zoxide`, and `git-config-user` are included. `status --detail` reports ignored files; `clean` previews first and supports filtered or confirmed cleanup. |
| Hooks | Automation shows `pre_add`, `post_add`, `pre_remove`, and `post_remove`. Edit regex matchers, ordered task lists, and custom environment variables in Settings. Hooks receive the original `PROJJ_*` variables and JSON on stdin. |
| Configuration | Edit the shared TOML, including multiple base directories, default host, tasks, and hooks. Saves validate the file and reject changes if another program edited it in the meantime. Comments are preserved. |
| Task scripts | Create and edit executable files under `~/.projj/tasks` from Tasks & activity. Inline tasks still take precedence. |
| Shell integration | Copy setup or full completion scripts for Bash, Zsh, and Fish. The included CLI provides the `p` navigation function and task completion. |

The [CLI reference](docs/CLI.md) describes the original commands, configuration, built-ins, and environment variables. The repository retains upstream history and its tests.

### Run a command in all repositories

1. In **Repositories**, click **Run on all repositories**. You can also open **Tasks & activity** and choose **All repositories** under **Run in**.
2. Enter a saved task name, such as `status`, or a shell command, such as `git status --short`.
3. Leave the repository filter empty to include every configured base directory, or enter a regex to match `host/owner/repo`, as with CLI `--match`. The preview shows the matching count and sample repositories.
4. Click **Run in N repositories**. Use **Run in Terminal** for commands that need interactive input.

This provides the desktop equivalent of `projj run 'git status --short' --all`. Each repository runs the command in its own working directory. Output identifies each repository, failures do not stop the remaining runs, and the final status reports failures. Library search, host, and base-directory filters do not restrict **All repositories**.

Use **Arguments** for extra arguments (the CLI's `--` arguments). Choose **Selected repo** for one repository, or **Directory** for a custom working directory. Invalid regexes and filters with no matches prevent execution.

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
npm test
scripts/dev.sh check
npm run check:ui
```

The Rust tests cover the shared core, CLI interactions, and desktop operations against temporary directories and local Git remotes. Desktop tests include clone/move, hook order and failures, typed removal, shell integration, cleanup, literal arguments, batch filtering, job cancellation, stale process IDs, and gpui-shell's empty child environment. The UI checker materializes every screen and dialog with a test view that cannot execute backend operations. Also test behavioral changes in a live window; a one-frame check does not prove interaction or layout behavior.

`app/main.js` contains the view, `app/model.js` contains pure presentation logic, and `src/desktop/main.rs` implements the JSON helper and background workers. Generated declarations, runtime binaries, test homes, and bundles are ignored. Use `gpui-shell types -d app` after changing runtime versions.

## Reference and differences

Based on [popomore/projj](https://github.com/popomore/projj), starting at `1083f8a`. The original CLI remains included. This desktop version adds native selection, background activity, script/configuration editors, nested GitLab namespace discovery under DNS-named host directories, and correct no-op behavior when optional zoxide or Git identity settings are absent. Arguments in the desktop arguments field are passed literally; shell operators belong in the command field. Removal keeps the parent directory available until post-remove hooks finish.

Runtime and packaging follow the [official gpui-shell documentation](https://gpui-kit.com/shell/). [huacnlee/gpui-shell-benchs](https://github.com/huacnlee/gpui-shell-benchs) provided working examples and notes on runtime limitations. The interface and vector icons in this repository were created for Projj; no benchmark application's visual design or sample content is shipped.

## License

[MIT](LICENSE). Original Projj copyright is retained. The bundled gpui-shell runtime uses Apache-2.0; its license is included when packaging.
