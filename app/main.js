import { View, div, uniform_list } from "gpui-kit";
import { h_flex, v_flex, InputState, TextareaState } from "gpui-base";
import { TitleBar } from "gpui-component";
import { request } from "./backend.js";
import { applyTheme } from "./theme.js";
import {
  filterRepos,
  parseArgs,
  shortPath,
  stripAnsi,
  defaultConfig,
  hookTemplate,
} from "./model.js";
import {
  icon,
  text,
  muted,
  row,
  button,
  field,
  editor,
  labelField,
  badge,
} from "./ui.js";

export default class Projj extends View {
  init(_props, cx) {
    this.dark = localStorage.getItem("dark") === "true";
    applyTheme(this.dark);
    this.page = "repositories";
    this.host = "";
    this.base = "";
    this.selected = "";
    this.detail = null;
    this.data = null;
    this.busy = false;
    this.error = "";
    this.notice = "";
    this.modal = null;
    this.jobs = [];
    this.activeJob = "";
    this.polling = false;
    this.search = this.input("Search repositories, owners, or hosts…");
    this.source = this.input("owner/repo, Git URL, or /path/to/local/repo");
    this.confirmation = this.input("owner/repo");
    this.newBase = this.input("/path/to/repositories");
    this.taskName = this.input("Task name or shell command", "status");
    this.args = this.input('Arguments, e.g. --detail or "a value"');
    this.pattern = this.input("Filter by regex, e.g. github\\.com/acme");
    this.cwd = this.input("/absolute/path/to/working/directory");
    this.scriptName = this.input("my-task");
    this.scriptEditor = TextareaState.new({
      value: "#!/bin/sh\nset -eu\n\n",
      rows: 12,
    });
    this.scriptPrevious = "";
    this.configEditor = TextareaState.new({ rows: 18 });
    this.configPrevious = "";
    this.configEditor.on("change", (_, cx) => cx.notify());
    this.scope = "selected";
    this.addBase = "";
    this.preview = null;
    this.shell = "zsh";
    this.focus = cx.focus_handle();
    cx.timer.after(0, () => this.focus.focus());
    this.refresh(cx);
    cx.timer.every(1000, (cx) => this.poll(cx));
  }
  input(placeholder, value = "") {
    const state = InputState.new({ placeholder, value });
    state.on("change", (_, cx) => {
      if (state === this.source) this.preview = null;
      cx.notify();
    });
    return state;
  }
  action(cx, work) {
    if (this.busy) return;
    this.busy = true;
    this.error = "";
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        await work(cx);
      } catch (error) {
        this.error = String(error.message || error);
      } finally {
        this.busy = false;
        cx.notify();
      }
    });
  }
  accept(data) {
    this.data = data;
    this.jobs = data.jobs || this.jobs;
    if (
      !this.configPrevious ||
      this.configEditor.value() === this.configPrevious
    ) {
      this.configPrevious = data.configText || "";
      this.configEditor.set_value(this.configPrevious);
    }
    if (!this.addBase || !(data.bases || []).includes(this.addBase))
      this.addBase = data.bases?.[0] || "";
    if (!data.initialized) this.newBase.set_value(data.defaultBase || "");
    if (this.selected && !data.repos.some((r) => r.path === this.selected)) {
      this.selected = "";
      this.detail = null;
    }
  }
  refresh(cx) {
    this.action(cx, async () => {
      this.accept(await request("snapshot"));
    });
  }
  poll(cx) {
    const running = this.jobs.filter((j) => j.state === "running");
    if (this.polling || !running.length) return;
    this.polling = true;
    cx.spawn(async (cx) => {
      try {
        let finished = false;
        for (const old of running) {
          const next = await request("job.poll", { id: old.id });
          this.jobs = this.jobs.map((j) => (j.id === next.id ? next : j));
          if (next.state !== "running") finished = true;
        }
        if (finished) this.accept(await request("snapshot"));
      } catch (error) {
        this.error = `Could not refresh job status: ${error.message || error}`;
      } finally {
        this.polling = false;
        cx.notify();
      }
    });
  }
  navigate(page, cx) {
    this.page = page;
    this.error = "";
    cx.notify();
  }
  selectedRepo() {
    return this.data?.repos.find((r) => r.path === this.selected);
  }
  choose(repo, cx) {
    this.selected = repo.path;
    this.detail = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const detail = await request("repo.status", { path: repo.path });
        if (this.selected === repo.path) this.detail = detail;
      } catch (error) {
        if (this.selected === repo.path)
          this.detail = { status: String(error.message || error) };
      }
      cx.notify();
    });
  }
  copy(value, cx) {
    cx.write_to_clipboard(value);
    this.notice = "Copied to clipboard";
    cx.notify();
    cx.timer.after(2500, (cx) => {
      this.notice = "";
      cx.notify();
    });
  }
  open(repo, terminal, cx) {
    this.action(cx, async () => {
      await request("open", { path: repo.path, terminal });
    });
  }
  showAdd(cx) {
    this.modal = "add";
    this.preview = null;
    this.source.set_value("");
    cx.notify();
  }
  async startJob(req) {
    const job = await request("job.start", req);
    this.jobs = [job, ...this.jobs.filter((j) => j.id !== job.id)];
    this.activeJob = job.id;
    this.page = "tasks";
    this.modal = null;
  }
  runRequest() {
    return {
      operation: "run",
      task: this.taskName.value().trim(),
      args: parseArgs(this.args.value()),
      all: this.scope === "all",
      pattern: this.pattern.value(),
      path: this.selected,
      cwd: this.scope === "directory" ? this.cwd.value() : "",
    };
  }
  runTask(cx, confirmed = false) {
    try {
      const req = this.runRequest();
      if (!req.task) throw new Error("Enter a task or command.");
      if (this.scope === "selected" && !this.selected)
        throw new Error("Select a repository first, or choose another scope.");
      if (!confirmed && req.task === "clean" && req.args.includes("--force")) {
        this.modal = "clean";
        cx.notify();
        return;
      }
      this.action(cx, async () => {
        await this.startJob(req);
      });
    } catch (error) {
      this.error = error.message;
      cx.notify();
    }
  }
  editConfig(cx) {
    this.page = "settings";
    this.action(cx, async () => {
      const data = await request("config.read");
      this.configPrevious = data.content;
      this.configEditor.set_value(data.content);
    });
  }
  saveConfig(cx) {
    this.action(cx, async () => {
      const content = this.configEditor.value();
      const data = await request("config.save", {
        content,
        previous: this.configPrevious,
      });
      this.configPrevious = content;
      this.accept(data);
      this.notice = "Configuration saved";
    });
  }
  editTask(task, cx) {
    if (task.kind === "inline") {
      this.navigate("settings", cx);
      return;
    }
    this.action(cx, async () => {
      const data = await request("task.read", { name: task.name });
      this.scriptName.set_value(task.name);
      this.scriptPrevious = data.content;
      this.scriptEditor.set_value(data.content);
      this.modal = "script";
    });
  }
  newScript(cx) {
    this.scriptName.set_value("");
    this.scriptPrevious = "";
    this.scriptEditor.set_value("#!/bin/sh\nset -eu\n\n");
    this.modal = "script";
    cx.notify();
  }
  key(event, cx) {
    if (event.keystroke === "cmd-r") {
      this.refresh(cx);
      cx.stop_propagation();
    }
    if (event.keystroke === "cmd-n" && this.data?.initialized) {
      this.showAdd(cx);
      cx.stop_propagation();
    }
    if (event.keystroke === "cmd-s" && this.page === "settings") {
      this.saveConfig(cx);
      cx.stop_propagation();
    }
    if (event.keystroke === "escape" && !this.busy) {
      this.modal = null;
      cx.notify();
    }
    for (const [i, page] of [
      "repositories",
      "tasks",
      "hooks",
      "settings",
    ].entries())
      if (event.keystroke === `cmd-${i + 1}`) {
        this.navigate(page, cx);
        cx.stop_propagation();
      }
  }
  /** @returns {import("gpui-kit").NativeElement} */
  render(cx) {
    const c = cx.theme().colors;
    return v_flex()
      .size_full()
      .bg(c.background)
      .text_color(c.foreground)
      .font_family(".AppleSystemUIFont")
      .relative()
      .track_focus(this.focus)
      .on_key_down((e, cx) => this.key(e, cx))
      .child(
        new TitleBar()
          .h(44)
          .bg(c.surface)
          .border_b(1)
          .border_color(c.border)
          .child(
            row()
              .flex_1()
              .justify_between()
              .pr(18)
              .child(muted("Projj  /  A home for every repository", cx))
              .child(muted("DESKTOP", cx, 10)),
          ),
      )
      .child(
        h_flex()
          .items_stretch()
          .flex_1()
          .min_h(0)
          .child(this.sidebar(cx))
          .child(
            v_flex()
              .flex_1()
              .min_w(0)
              .min_h(0)
              .when(!!this.error, (el) =>
                el.child(
                  row()
                    .px(24)
                    .py(10)
                    .bg(c.accent)
                    .child(text(this.error, 12, c.destructive).flex_1())
                    .child(
                      button("dismiss-error", "Dismiss", cx, (cx) => {
                        this.error = "";
                        cx.notify();
                      }),
                    ),
                ),
              )
              .child(
                !this.data
                  ? this.page === "settings"
                    ? this.settingsPage(cx)
                    : this.loading(cx)
                  : !this.data.initialized
                    ? this.onboarding(cx)
                    : this.page === "repositories"
                      ? this.library(cx)
                      : this.page === "tasks"
                        ? this.tasksPage(cx)
                        : this.page === "hooks"
                          ? this.hooksPage(cx)
                          : this.settingsPage(cx),
              ),
          ),
      )
      .child(
        row()
          .h(28)
          .px(16)
          .border_t(1)
          .border_color(c.border)
          .bg(c.surface)
          .justify_between()
          .child(
            muted(
              this.notice ||
                (this.busy
                  ? "Working…"
                  : this.jobs.some((j) => j.state === "running")
                    ? "Task running in the background"
                    : "Your repositories. Your filesystem."),
              cx,
              11,
            ),
          )
          .child(muted("⌘N  Add repository     ⌘R  Refresh", cx, 11)),
      )
      .when(!!this.modal, (el) => el.child(this.dialog(cx)));
  }
  /** @returns {import("gpui-kit").NativeElement} */
  sidebar(cx) {
    const c = cx.theme().colors,
      repos = this.data?.repos || [],
      hosts = [...new Set(repos.map((r) => r.host))].sort();
    const nav = (page, label, glyph) =>
      button(`nav-${page}`, label, cx, (cx) => this.navigate(page, cx), {
        icon: glyph,
      })
        .w_full()
        .justify_start()
        .h(40)
        .bg(this.page === page ? c.accent : c.surface)
        .text_color(this.page === page ? c.primary : c.foreground);
    return v_flex()
      .w(210)
      .flex_shrink_0()
      .p(16)
      .gap(8)
      .bg(c.surface)
      .border_r(1)
      .border_color(c.border)
      .child(
        row()
          .py(14)
          .mb(12)
          .child(
            div()
              .size(34)
              .rounded(9)
              .bg(c.primary)
              .text_color(c.primary_foreground)
              .flex()
              .items_center()
              .justify_center()
              .child(icon("branch", 21)),
          )
          .child(text("projj", 24).font_weight(700)),
      )
      .child(nav("repositories", "Repositories", "grid"))
      .child(nav("tasks", "Tasks & activity", "play"))
      .child(nav("hooks", "Automation", "hook"))
      .child(nav("settings", "Settings", "settings"))
      .child(muted("HOSTS", cx, 10).mt(28).mb(6))
      .child(
        this.filterButton(
          "host-all",
          "All hosts",
          repos.length,
          !this.host,
          cx,
          (cx) => {
            this.host = "";
            this.navigate("repositories", cx);
          },
        ),
      )
      .children(
        hosts.map((host) =>
          this.filterButton(
            `host-${host}`,
            host,
            repos.filter((r) => r.host === host).length,
            this.host === host,
            cx,
            (cx) => {
              this.host = host;
              this.navigate("repositories", cx);
            },
          ),
        ),
      )
      .child(div().flex_1())
      .child(
        row()
          .pt(12)
          .border_t(1)
          .border_color(c.border)
          .child(icon("folder", 15))
          .child(
            muted(`${this.data?.bases?.length || 0} base directories`, cx),
          ),
      )
      .child(
        button(
          "theme",
          this.dark ? "Light appearance" : "Dark appearance",
          cx,
          (cx) => {
            this.dark = !this.dark;
            localStorage.setItem("dark", String(this.dark));
            applyTheme(this.dark);
            cx.notify();
          },
        ),
      );
  }
  /** @returns {import("gpui-kit").NativeElement} */
  filterButton(id, label, count, active, cx, action) {
    return button(id, "", cx, action)
      .w_full()
      .justify_between()
      .bg(active ? cx.theme().colors.secondary : cx.theme().colors.surface)
      .child(text(label, 12).truncate())
      .child(badge(count, cx));
  }
  /** @returns {import("gpui-kit").NativeElement} */
  heading(title, subtitle, cx, action) {
    return row()
      .justify_between()
      .mb(22)
      .child(
        v_flex()
          .gap(6)
          .child(text(title, 27).font_weight(650))
          .child(muted(subtitle, cx, 13)),
      )
      .when(!!action, (el) => el.child(action));
  }
  /** @returns {import("gpui-kit").NativeElement} */
  loading(cx) {
    return v_flex()
      .flex_1()
      .items_center()
      .justify_center()
      .gap(16)
      .child(icon("branch", 40))
      .child(
        text(
          this.busy ? "Opening your workspace…" : "Workspace unavailable",
          22,
        ),
      )
      .child(
        muted(
          "Projj reads repositories directly from your configured directories.",
          cx,
        ),
      )
      .child(
        row()
          .child(button("retry", "Retry", cx, (cx) => this.refresh(cx)))
          .child(
            button("repair", "Edit configuration", cx, (cx) =>
              this.editConfig(cx),
            ),
          ),
      )
      .when(this.page === "settings", (el) => el.child(this.settingsPage(cx)));
  }
  /** @returns {import("gpui-kit").NativeElement} */
  onboarding(cx) {
    return v_flex()
      .flex_1()
      .p(48)
      .justify_center()
      .gap(18)
      .child(
        div().text_color(cx.theme().colors.primary).child(icon("branch", 48)),
      )
      .child(text("Give every repository a home.", 34).font_weight(650))
      .child(
        muted(
          "Clone once. Find instantly. Keep your Git projects in a predictable place.",
          cx,
          15,
        ),
      )
      .child(
        labelField(
          "Base directory",
          this.newBase,
          cx,
          "Repositories are organized as base / host / owner / repository.",
        ).max_w(560),
      )
      .child(
        row().child(
          button(
            "initialize",
            "Set up Projj",
            cx,
            (cx) =>
              this.action(cx, async () => {
                this.accept(
                  await request("init", {
                    content: defaultConfig(this.newBase.value()),
                  }),
                );
              }),
            { primary: true, disabled: this.busy, icon: "plus" },
          ),
        ),
      )
      .child(muted(`Configuration: ${this.data.configPath}`, cx));
  }
  /** @returns {import("gpui-kit").NativeElement} */
  library(cx) {
    const c = cx.theme().colors,
      repos = this.data.repos,
      visible = filterRepos(repos, this.search.value(), this.host, this.base),
      repo = this.selectedRepo();
    const stat = (value, label, glyph) =>
      row()
        .flex_1()
        .p(16)
        .border(1)
        .border_color(c.border)
        .rounded(9)
        .child(
          div()
            .p(9)
            .rounded(7)
            .bg(c.surface)
            .text_color(c.muted_foreground)
            .child(icon(glyph, 20)),
        )
        .child(
          v_flex()
            .gap(3)
            .child(text(value, 23).font_weight(600))
            .child(muted(label, cx)),
        );
    return v_flex()
      .flex_1()
      .min_h(0)
      .p(26)
      .child(
        this.heading(
          "Repositories",
          "All your projects, exactly where they belong.",
          cx,
          button("add-repo", "Add repository", cx, (cx) => this.showAdd(cx), {
            primary: true,
            icon: "plus",
          }),
        ),
      )
      .child(
        row()
          .gap(12)
          .mb(22)
          .child(stat(repos.length, "Repositories", "branch"))
          .child(
            stat(new Set(repos.map((r) => r.host)).size, "Git hosts", "globe"),
          )
          .child(stat(this.data.bases.length, "Base directories", "folder")),
      )
      .child(
        row()
          .mb(12)
          .child(field(this.search, cx).flex_1())
          .child(
            button("refresh", "Refresh", cx, (cx) => this.refresh(cx), {
              icon: "refresh",
              disabled: this.busy,
            }),
          )
          .child(
            button(
              "copy-list",
              "Copy paths",
              cx,
              (cx) => this.copy(visible.map((r) => r.path).join("\n"), cx),
              { icon: "copy" },
            ),
          ),
      )
      .child(
        row()
          .mb(12)
          .child(
            button("base-all", "All directories", cx, (cx) => {
              this.base = "";
              cx.notify();
            }).bg(!this.base ? c.accent : c.secondary),
          )
          .children(
            this.data.bases.map((base, i) =>
              button(`base-${i}`, shortPath(base), cx, (cx) => {
                this.base = base;
                cx.notify();
              }).bg(this.base === base ? c.accent : c.secondary),
            ),
          ),
      )
      .child(
        h_flex()
          .items_stretch()
          .flex_1()
          .min_h(0)
          .gap(16)
          .child(
            v_flex()
              .flex_1()
              .min_w(0)
              .border(1)
              .border_color(c.border)
              .rounded(10)
              .overflow_hidden()
              .child(
                row()
                  .h(36)
                  .px(14)
                  .bg(c.surface)
                  .justify_between()
                  .child(muted(`${visible.length} REPOSITORIES`, cx, 10))
                  .child(muted(this.host || "ALL HOSTS", cx, 10)),
              )
              .child(
                visible.length
                  ? uniform_list(
                      "repo-list",
                      visible.length,
                      (i) => visible[i].path,
                      (range, cx) => {
                        const items = [];
                        for (let i = range.start; i < range.end; i++) {
                          const r = visible[i];
                          items.push(
                            row()
                              .id(`repo-${r.path}`)
                              .role("button")
                              .accessibility_label(r.key)
                              .h(68)
                              .px(14)
                              .gap(12)
                              .border_b(1)
                              .border_color(c.border)
                              .bg(
                                this.selected === r.path
                                  ? c.accent
                                  : c.background,
                              )
                              .cursor_pointer()
                              .hover((el) => el.bg(c.secondary))
                              .child(
                                div()
                                  .text_color(
                                    this.selected === r.path
                                      ? c.primary
                                      : c.muted_foreground,
                                  )
                                  .child(icon("folder", 21)),
                              )
                              .child(
                                v_flex()
                                  .flex_1()
                                  .min_w(0)
                                  .gap(4)
                                  .child(
                                    text(r.name, 14)
                                      .font_weight(600)
                                      .truncate(),
                                  )
                                  .child(
                                    muted(
                                      `${r.owner}  /  ${r.host}`,
                                      cx,
                                      11,
                                    ).truncate(),
                                  ),
                              )
                              .child(icon("chevron", 14)),
                          );
                        }
                        return items;
                      },
                    )
                      .on_item_click((key, cx) => {
                        const r = visible.find((r) => r.path === key);
                        if (r) this.choose(r, cx);
                      })
                      .flex_1()
                      .min_h(0)
                  : v_flex()
                      .flex_1()
                      .items_center()
                      .justify_center()
                      .gap(12)
                      .child(icon("search", 30))
                      .child(
                        text(
                          repos.length
                            ? "No matching repositories"
                            : "Your library is ready",
                          19,
                        ),
                      )
                      .child(
                        muted(
                          repos.length
                            ? "Try another search or directory."
                            : "Add a remote repository or move an existing one.",
                          cx,
                        ),
                      ),
              ),
          )
          .when(!!repo, (el) => el.child(this.repoDetail(repo, cx))),
      );
  }
  /** @returns {import("gpui-kit").NativeElement} */
  repoDetail(repo, cx) {
    const c = cx.theme().colors;
    return v_flex()
      .id("repo-details")
      .overflow_y_scroll()
      .w(286)
      .flex_shrink_0()
      .gap(14)
      .p(18)
      .rounded(10)
      .border(1)
      .border_color(c.border)
      .bg(c.surface)
      .child(
        row()
          .justify_between()
          .child(badge("REPOSITORY", cx, true))
          .child(
            button("close-detail", "×", cx, (cx) => {
              this.selected = "";
              this.detail = null;
              cx.notify();
            }),
          ),
      )
      .child(text(repo.name, 24).font_weight(600))
      .child(muted(repo.owner, cx, 14))
      .child(text("LOCATION", 10, c.muted_foreground).mt(8))
      .child(text(repo.path, 12).whitespace_normal())
      .child(
        row()
          .child(
            button(
              "reveal",
              "Open folder",
              cx,
              (cx) => this.open(repo, false, cx),
              { icon: "folder" },
            ),
          )
          .child(
            button(
              "terminal",
              "Terminal",
              cx,
              (cx) => this.open(repo, true, cx),
              { icon: "terminal" },
            ),
          ),
      )
      .child(
        button("copy-path", "Copy path", cx, (cx) => this.copy(repo.path, cx), {
          icon: "copy",
        }).w_full(),
      )
      .child(text("GIT STATUS", 10, c.muted_foreground).mt(8))
      .child(
        div()
          .id("git-status")
          .flex_1()
          .min_h(70)
          .overflow_y_scroll()
          .text_size(12)
          .font_family("Menlo")
          .child(this.detail?.status?.trim() || "Reading status…"),
      )
      .child(
        button(
          "run-status",
          "Run status task",
          cx,
          (cx) => {
            this.taskName.set_value("status");
            this.args.set_value("");
            this.scope = "selected";
            this.navigate("tasks", cx);
          },
          { icon: "play" },
        ),
      )
      .child(
        button(
          "copy-url",
          "Copy Git URL",
          cx,
          (cx) => this.copy(this.detail?.remote || repo.url, cx),
          { icon: "copy" },
        ),
      )
      .child(
        button(
          "remove-repo",
          "Remove repository",
          cx,
          (cx) => {
            this.confirmation.set_value("");
            this.modal = "remove";
            cx.notify();
          },
          { icon: "trash", danger: true },
        ),
      );
  }
  /** @returns {import("gpui-kit").NativeElement} */
  tasksPage(cx) {
    const c = cx.theme().colors,
      active = this.jobs.find((j) => j.id === this.activeJob) || this.jobs[0],
      repo = this.selectedRepo();
    let targetLabel =
      this.scope === "all"
        ? `${this.data.repos.length} repositories before filtering`
        : this.scope === "directory"
          ? "Custom working directory"
          : repo?.shortKey || "Select a repository in the library";
    return v_flex()
      .flex_1()
      .min_h(0)
      .p(26)
      .child(
        this.heading(
          "Tasks & activity",
          "Run a command in one project, or across your entire workspace.",
          cx,
          button("new-task", "New script", cx, (cx) => this.newScript(cx), {
            icon: "plus",
          }),
        ),
      )
      .child(
        h_flex()
          .items_stretch()
          .flex_1()
          .min_h(0)
          .gap(22)
          .child(
            v_flex()
              .w(330)
              .flex_shrink_0()
              .gap(13)
              .id("runner-scroll")
              .overflow_y_scroll()
              .child(labelField("Task or shell command", this.taskName, cx))
              .child(
                labelField(
                  "Arguments",
                  this.args,
                  cx,
                  "Quotes group arguments. Shell expansion is disabled here.",
                ),
              )
              .child(
                row().children(
                  [
                    ["selected", "Selected"],
                    ["all", "All repos"],
                    ["directory", "Directory"],
                  ].map(([id, label]) =>
                    button(`scope-${id}`, label, cx, (cx) => {
                      this.scope = id;
                      cx.notify();
                    }).bg(this.scope === id ? c.accent : c.secondary),
                  ),
                ),
              )
              .child(muted(targetLabel, cx))
              .when(this.scope === "all", (el) =>
                el.child(
                  labelField("Match repository (regex)", this.pattern, cx),
                ),
              )
              .when(this.scope === "directory", (el) =>
                el.child(labelField("Working directory", this.cwd, cx)),
              )
              .child(
                button("run-task", "Run task", cx, (cx) => this.runTask(cx), {
                  primary: true,
                  icon: "play",
                  disabled: this.busy,
                }),
              )
              .child(
                button(
                  "run-terminal",
                  "Run in Terminal",
                  cx,
                  (cx) => {
                    this.action(cx, async () => {
                      await request("run.terminal", this.runRequest());
                      this.notice = "Task opened in Terminal";
                    });
                  },
                  { icon: "terminal", disabled: this.busy },
                ),
              )
              .child(muted("SAVED TASKS", cx, 10).mt(12))
              .children(
                this.data.tasks.map((t) =>
                  row()
                    .gap(4)
                    .child(
                      button(`task-${t.name}`, t.name, cx, (cx) => {
                        this.taskName.set_value(t.name);
                        this.args.set_value("");
                        cx.notify();
                      })
                        .flex_1()
                        .justify_start(),
                    )
                    .child(badge(t.kind, cx))
                    .child(
                      button(`edit-${t.name}`, "Edit", cx, (cx) =>
                        this.editTask(t, cx),
                      ),
                    ),
                ),
              )
              .child(
                muted(
                  "Resolution: inline task → script file → shell command.",
                  cx,
                ),
              )
              .child(
                muted(
                  "The clean task previews ignored folders by default. Add --force --yes to remove them.",
                  cx,
                ),
              ),
          )
          .child(
            v_flex()
              .flex_1()
              .min_w(0)
              .min_h(0)
              .gap(12)
              .child(
                row()
                  .justify_between()
                  .child(text("Activity", 16).font_weight(600))
                  .when(!!active, (el) =>
                    el.child(
                      button(
                        "copy-output",
                        "Copy output",
                        cx,
                        (cx) => this.copy(stripAnsi(active.log), cx),
                        { icon: "copy" },
                      ),
                    ),
                  ),
              )
              .child(
                div()
                  .id("job-history")
                  .h(this.jobs.length ? 110 : 0)
                  .overflow_y_scroll()
                  .child(
                    v_flex()
                      .gap(5)
                      .children(
                        this.jobs.map((job) =>
                          button(`job-${job.id}`, "", cx, (cx) => {
                            this.activeJob = job.id;
                            cx.notify();
                          })
                            .w_full()
                            .justify_between()
                            .bg(active?.id === job.id ? c.accent : c.secondary)
                            .child(text(job.label, 12).truncate().flex_1())
                            .child(
                              badge(job.state, cx, job.state === "running"),
                            ),
                        ),
                      ),
                  ),
              )
              .when(!!active, (el) =>
                el.child(
                  row()
                    .justify_between()
                    .child(
                      muted(
                        `${active.operation} · ${new Date(active.started).toLocaleString()}`,
                        cx,
                      ),
                    )
                    .when(active.state === "running", (el) =>
                      el.child(
                        button(
                          "cancel-job",
                          "Stop task",
                          cx,
                          (cx) =>
                            this.action(cx, async () => {
                              const job = await request("job.cancel", {
                                id: active.id,
                              });
                              this.jobs = this.jobs.map((j) =>
                                j.id === job.id ? job : j,
                              );
                            }),
                          { danger: true },
                        ),
                      ),
                    ),
                ),
              )
              .child(
                div()
                  .id("job-log")
                  .flex_1()
                  .min_h(120)
                  .overflow_y_scroll()
                  .p(16)
                  .rounded(9)
                  .bg(c.surface)
                  .border(1)
                  .border_color(c.border)
                  .child(
                    v_flex()
                      .gap(4)
                      .children(
                        stripAnsi(
                          active?.log ||
                            "Task output will appear here.\n\nChoose a task and a scope, then press Run task.",
                        )
                          .split("\n")
                          .map((line) =>
                            text(line || " ", 12)
                              .font_family("Menlo")
                              .whitespace_normal(),
                          ),
                      ),
                  ),
              )
              .when(!!active?.error, (el) =>
                el.child(text(active.error, 12, c.destructive)),
              )
              .when(!!active?.truncated, (el) =>
                el.child(
                  muted(
                    "Showing the latest output. Full logs are kept in ~/.projj/desktop/jobs.",
                    cx,
                  ),
                ),
              ),
          ),
      );
  }
  /** @returns {import("gpui-kit").NativeElement} */
  hooksPage(cx) {
    const c = cx.theme().colors,
      hooks = this.data.config?.hooks || [];
    return v_flex()
      .flex_1()
      .min_h(0)
      .p(26)
      .child(
        this.heading(
          "Automation",
          "Let your repositories set themselves up.",
          cx,
          button(
            "edit-hooks",
            "Edit hooks",
            cx,
            (cx) => this.navigate("settings", cx),
            { icon: "settings" },
          ),
        ),
      )
      .child(
        row()
          .gap(12)
          .mb(22)
          .children(
            ["pre_add", "post_add", "pre_remove", "post_remove"].map(
              (event, i) =>
                v_flex()
                  .flex_1()
                  .gap(10)
                  .p(15)
                  .rounded(9)
                  .border(1)
                  .border_color(c.border)
                  .child(badge(`0${i + 1}`, cx, true))
                  .child(text(event, 14).font_weight(600))
                  .child(
                    muted(
                      [
                        "Before clone or move",
                        "After clone or move",
                        "Before deletion",
                        "After deletion",
                      ][i],
                      cx,
                    ),
                  ),
            ),
          ),
      )
      .child(
        v_flex()
          .id("hooks-scroll")
          .flex_1()
          .min_h(0)
          .overflow_y_scroll()
          .gap(12)
          .when(!hooks.length, (el) =>
            el.child(text("No hooks configured yet.", 20).mt(20)),
          )
          .children(
            hooks.map((hook, i) =>
              v_flex()
                .gap(10)
                .p(20)
                .rounded(9)
                .bg(c.surface)
                .border(1)
                .border_color(c.border)
                .child(
                  row()
                    .child(icon("hook", 18))
                    .child(text(hook.event, 16).font_weight(600))
                    .child(badge(hook.matcher || "All repositories", cx)),
                )
                .child(text(hook.tasks.join("  →  ") || "No tasks", 14))
                .child(
                  muted(
                    `${Object.keys(hook.env || {}).length} custom environment variables · Runs in order; stops on failure`,
                    cx,
                  ),
                ),
            ),
          )
          .child(
            v_flex()
              .gap(10)
              .mt(14)
              .child(
                text(
                  "Repository context, ready for your scripts.",
                  17,
                ).font_weight(600),
              )
              .child(
                muted(
                  "Hooks receive PROJJ_EVENT, PROJJ_REPO_PATH, PROJJ_REPO_HOST, PROJJ_REPO_OWNER, PROJJ_REPO_NAME, PROJJ_REPO_URL, and JSON on stdin.",
                  cx,
                  13,
                ),
              ),
          )
          .child(
            row()
              .mt(10)
              .child(
                button(
                  "add-hook",
                  "Add Git identity hook",
                  cx,
                  (cx) => {
                    this.configEditor.set_value(
                      this.configEditor.value() + hookTemplate,
                    );
                    this.navigate("settings", cx);
                  },
                  { icon: "plus" },
                ),
              ),
          ),
      );
  }
  /** @returns {import("gpui-kit").NativeElement} */
  settingsPage(cx) {
    const c = cx.theme().colors,
      dirty = this.configEditor.value() !== this.configPrevious;
    return v_flex()
      .flex_1()
      .min_h(0)
      .p(26)
      .gap(12)
      .child(
        this.heading(
          "Settings",
          "One configuration, shared with the Projj CLI.",
          cx,
          button(
            "save-config",
            dirty ? "Save changes" : "Save configuration",
            cx,
            (cx) => this.saveConfig(cx),
            { primary: true, disabled: this.busy, icon: "check" },
          ),
        ),
      )
      .child(
        row()
          .justify_between()
          .child(muted(this.data?.configPath || "~/.projj/config.toml", cx))
          .child(
            button(
              "reload-config",
              "Reload from disk",
              cx,
              (cx) => this.editConfig(cx),
              { icon: "refresh" },
            ),
          ),
      )
      .child(editor(this.configEditor, cx))
      .child(
        muted(
          "base: one path or an array · platform: default Git host · [tasks]: named commands · [[hooks]]: events, matchers, tasks, env",
          cx,
        ),
      )
      .child(
        row()
          .mt(10)
          .child(text("Shell integration", 16).font_weight(600))
          .child(div().flex_1())
          .children(
            ["zsh", "bash", "fish"].map((shell) =>
              button(`shell-${shell}`, shell, cx, (cx) => {
                this.shell = shell;
                cx.notify();
              }).bg(this.shell === shell ? c.accent : c.secondary),
            ),
          ),
      )
      .child(
        muted(
          "The bundle includes the full CLI. Add its bin directory to PATH, then install completions and the p navigation function in your shell config.",
          cx,
        ),
      )
      .child(
        row()
          .child(
            button(
              "copy-setup",
              "Copy setup command",
              cx,
              (cx) => {
                const path =
                  this.data?.cliPath?.split("/").slice(0, -1).join("/") ||
                  "/path/to/Projj.app/Contents/Resources/app/bin";
                const quote = (value) => `'${value.replace(/'/g, "'\\''")}'`;
                this.copy(
                  this.shell === "fish"
                    ? `fish_add_path ${quote(path)}\nprojj shell-setup fish | source`
                    : `export PATH=${quote(path)}:"$PATH"\neval "$(projj shell-setup ${this.shell})"`,
                  cx,
                );
              },
              { icon: "copy" },
            ),
          )
          .child(
            button(
              "copy-completions",
              "Copy full shell script",
              cx,
              (cx) =>
                this.action(cx, async (cx) => {
                  const result = await request("shell", { shell: this.shell });
                  this.copy(result.content, cx);
                }),
              { icon: "terminal" },
            ),
          ),
      )
      .child(
        muted(
          "Changes are validated before saving. Existing task scripts are preserved when you initialize Projj again.",
          cx,
        ),
      );
  }
  /** @returns {import("gpui-kit").NativeElement} */
  dialog(cx) {
    const c = cx.theme().colors,
      repo = this.selectedRepo();
    let title = "",
      description = "",
      body = v_flex().gap(14),
      confirm = null;
    if (this.modal === "add") {
      title = "Add a repository";
      description =
        "Clone a remote repository, or move a local repository into your workspace.";
      body
        .child(
          labelField(
            "Repository",
            this.source,
            cx,
            "Accepts short names, HTTPS, SSH (including ports), and local paths.",
          ),
        )
        .child(text("Base directory", 12))
        .children(
          (this.data.bases || []).map((base, i) =>
            button(`add-base-${i}`, base, cx, (cx) => {
              this.addBase = base;
              this.preview = null;
              cx.notify();
            })
              .justify_start()
              .bg(this.addBase === base ? c.accent : c.secondary),
          ),
        )
        .child(
          button(
            "preview-add",
            "Preview destination",
            cx,
            (cx) =>
              this.action(cx, async () => {
                this.preview = await request("add.preview", {
                  source: this.source.value(),
                  base: this.addBase,
                });
              }),
            { icon: "folder" },
          ),
        )
        .when(!!this.preview, (el) =>
          el.child(
            v_flex()
              .gap(6)
              .p(14)
              .rounded(8)
              .bg(c.surface)
              .child(
                muted(
                  this.preview.exists
                    ? "Already exists — hooks will be skipped"
                    : "DESTINATION",
                  cx,
                ),
              )
              .child(text(this.preview.target, 13).whitespace_normal()),
          ),
        );
      confirm = button(
        "confirm-add",
        "Add repository",
        cx,
        (cx) =>
          this.action(cx, async () => {
            await this.startJob({
              operation: "add",
              source: this.source.value(),
              base: this.addBase,
            });
          }),
        { primary: true, disabled: this.busy || !this.source.value().trim() },
      );
    } else if (this.modal === "remove") {
      title = "Remove repository";
      description =
        "This permanently deletes the repository and its local files. Removal hooks will run.";
      body
        .child(text(repo?.path || "", 13).whitespace_normal())
        .child(
          labelField(
            `Type ${repo?.shortKey} to confirm`,
            this.confirmation,
            cx,
          ),
        );
      confirm = button(
        "confirm-remove",
        "Permanently remove",
        cx,
        (cx) =>
          this.action(cx, async () => {
            await this.startJob({
              operation: "remove",
              path: repo.path,
              confirmation: this.confirmation.value(),
            });
          }),
        {
          danger: true,
          disabled: this.busy || this.confirmation.value() !== repo?.shortKey,
        },
      );
    } else if (this.modal === "clean") {
      title = "Run cleanup with deletion enabled";
      description =
        "The built-in clean task removes Git-ignored directories. A task named clean in your configuration overrides it.";
      body
        .child(
          text(
            `Scope: ${this.scope === "all" ? "All matching repositories" : this.scope === "directory" ? this.cwd.value() : repo?.path}`,
            13,
          ).whitespace_normal(),
        )
        .child(text(`Arguments: ${this.args.value()}`, 13))
        .child(
          muted(
            "Run clean without --force first to inspect the folders it would remove.",
            cx,
          ),
        );
      confirm = button(
        "confirm-clean",
        "Run cleanup",
        cx,
        (cx) => this.runTask(cx, true),
        { danger: true, disabled: this.busy },
      );
    } else if (this.modal === "script") {
      title = this.scriptPrevious ? "Edit task script" : "Create task script";
      description =
        "Saved as an executable in ~/.projj/tasks. Inline tasks with the same name take precedence.";
      body
        .child(labelField("Task name", this.scriptName, cx))
        .child(editor(this.scriptEditor, cx).h(260));
      confirm = button(
        "save-script",
        "Save task",
        cx,
        (cx) =>
          this.action(cx, async () => {
            this.accept(
              await request("task.save", {
                name: this.scriptName.value().trim(),
                content: this.scriptEditor.value(),
                previous: this.scriptPrevious,
              }),
            );
            this.modal = null;
          }),
        { primary: true, disabled: this.busy },
      );
    }
    return div()
      .absolute()
      .inset_0()
      .bg("#00000055")
      .flex()
      .items_center()
      .justify_center()
      .on_mouse_down("left", (_, cx) => cx.stop_propagation())
      .child(
        v_flex()
          .w(610)
          .max_h("90%")
          .p(28)
          .gap(18)
          .rounded(14)
          .bg(c.background)
          .shadow_lg()
          .border(1)
          .border_color(c.border)
          .child(text(title, 25).font_weight(600))
          .child(muted(description, cx, 13))
          .child(body)
          .when(!!this.error, (el) =>
            el.child(text(this.error, 12, c.destructive)),
          )
          .child(
            row()
              .justify_end()
              .child(
                button(
                  "cancel-dialog",
                  "Cancel",
                  cx,
                  (cx) => {
                    this.modal = null;
                    cx.notify();
                  },
                  { disabled: this.busy },
                ),
              )
              .when(!!confirm, (el) => el.child(confirm)),
          ),
      );
  }
}
