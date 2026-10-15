use anyhow::{Context, Result, bail};
use projj::{
    config::{self, Config},
    git, hook,
    repo_source::{self, Repo},
    task,
};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    fs::{self, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    path::{Component, Path, PathBuf},
    process::{Command, Stdio},
    time::{SystemTime, UNIX_EPOCH},
};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).is_some_and(|s| s == "terminal-worker") {
        let result = (|| -> Result<Value> {
            prepare_environment(true)?;
            perform(&serde_json::from_str(args.get(2).context("request")?)?)
        })();
        if let Err(error) = result {
            eprintln!("Error: {error:#}");
            std::process::exit(1);
        }
        return;
    }
    if args.get(1).is_some_and(|s| s == "worker") {
        let id = args.get(2).expect("job id");
        let result = (|| -> Result<Value> {
            let req: Value = serde_json::from_str(args.get(3).context("request")?)?;
            perform(&req)
        })();
        let value = match result {
            Ok(data) => json!({"state":"completed", "data":data}),
            Err(e) => {
                eprintln!("Error: {e:#}");
                json!({"state":"failed", "error":format!("{e:#}")})
            }
        };
        if let Ok(dir) = job_dir(id) {
            let _ = write_json(&dir.join("result.json"), &value);
        }
        return;
    }
    let result = (|| -> Result<Value> {
        let req: Value = serde_json::from_str(args.get(1).context("Expected a JSON request")?)?;
        if let Some(home) = req["home"].as_str() {
            if !Path::new(home).is_absolute() {
                bail!("PROJJ_HOME must be an absolute directory");
            }
            // The helper is still single-threaded here. gpui-shell deliberately
            // filters its child environment; the launcher passes the override.
            unsafe {
                std::env::set_var("PROJJ_HOME", home);
            }
        }
        prepare_environment(matches!(
            req["method"].as_str(),
            Some("job.start" | "run.terminal" | "repo.status" | "open" | "shell")
        ))?;
        dispatch(&req)
    })();
    match result {
        Ok(data) => println!("{}", json!({"ok":true,"data":data})),
        Err(e) => {
            println!("{}", json!({"ok":false,"error":format!("{e:#}")}));
            std::process::exit(1);
        }
    }
}
fn prepare_environment(with_overrides: bool) -> Result<()> {
    // gpui-shell grants this helper execution with an empty environment.
    // Restore only the home, executable search path, locale and SSH agent.
    let home = std::env::var_os("PROJJ_HOME")
        .map(PathBuf::from)
        .or_else(dirs::home_dir)
        .context("Home directory is unavailable")?;
    let exe = std::env::current_exe()?;
    let bin = exe.parent().context("Executable directory")?;
    let path = format!(
        "{}:{}/.local/bin:{}/.cargo/bin:{}/.vite-plus/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
        bin.display(),
        home.display(),
        home.display(),
        home.display()
    );
    // This executable has not started any threads. Environment mutations are
    // completed before creating child processes.
    unsafe {
        if std::env::var_os("HOME").is_none() {
            std::env::set_var("HOME", &home);
        }
        if std::env::var_os("PATH").is_none() {
            std::env::set_var("PATH", path);
        }
        if std::env::var_os("LANG").is_none() {
            std::env::set_var("LANG", "en_US.UTF-8");
        }
    }
    #[cfg(target_os = "macos")]
    if std::env::var_os("SSH_AUTH_SOCK").is_none() && std::env::var_os("PROJJ_HOME").is_none() {
        let output = Command::new("/bin/launchctl")
            .args(["getenv", "SSH_AUTH_SOCK"])
            .output()?;
        let socket = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if output.status.success() && !socket.is_empty() {
            unsafe {
                std::env::set_var("SSH_AUTH_SOCK", socket);
            }
        }
    }
    // Optional desktop-specific environment overrides leave the CLI schema intact.
    if with_overrides
        && let Ok(content) = fs::read_to_string(config::config_path())
        && let Ok(value) = content.parse::<toml::Value>()
        && let Some(env) = value
            .get("desktop")
            .and_then(|v| v.get("environment"))
            .and_then(toml::Value::as_table)
    {
        for (name, value) in env {
            if name.is_empty() || name.contains(['=', '\0']) {
                bail!("Invalid environment variable name");
            }
            let value = value
                .as_str()
                .context("Desktop environment values must be strings")?;
            if value.contains('\0') {
                bail!("Environment values cannot contain null characters");
            }
            if matches!(name.as_str(), "PROJJ_HOME" | "HOME") {
                bail!("Set home overrides through the launcher, not the configuration");
            }
            unsafe {
                std::env::set_var(name, value);
            }
        }
    }
    Ok(())
}
fn string<'a>(req: &'a Value, key: &str) -> Result<&'a str> {
    req[key].as_str().with_context(|| format!("Missing {key}"))
}
fn load() -> Result<Config> {
    Config::load()
}
fn read(path: &Path) -> Result<String> {
    fs::read_to_string(path).with_context(|| format!("Cannot read {}", path.display()))
}
fn write_json(path: &Path, value: &Value) -> Result<()> {
    atomic_write(path, &serde_json::to_string(value)?)
}
fn atomic_write(path: &Path, text: &str) -> Result<()> {
    let tmp = path.with_extension(format!("tmp-{}", std::process::id()));
    let mut file = OpenOptions::new().write(true).create_new(true).open(&tmp)?;
    file.write_all(text.as_bytes())?;
    file.sync_all()?;
    fs::rename(tmp, path)?;
    Ok(())
}
fn safe_name(s: &str) -> Result<()> {
    if s.is_empty()
        || s.starts_with('.')
        || !s.chars().all(|c| c.is_alphanumeric() || "-_.".contains(c))
    {
        bail!("Invalid name: {s}");
    }
    Ok(())
}
fn validate_config(text: &str) -> Result<Config> {
    let cfg: Config = toml::from_str(text).context("Invalid TOML configuration")?;
    let value: toml::Value = toml::from_str(text)?;
    if let Some(env) = value.get("desktop").and_then(|v| v.get("environment")) {
        let env = env
            .as_table()
            .context("desktop.environment must be a table")?;
        for (name, value) in env {
            if name.is_empty()
                || name.contains(['=', '\0'])
                || matches!(name.as_str(), "HOME" | "PROJJ_HOME")
            {
                bail!("Invalid or reserved desktop environment key: {name}");
            }
            if value.as_str().is_none_or(|s| s.contains('\0')) {
                bail!("Desktop environment values must be strings without null characters");
            }
        }
    }
    if cfg.base_dirs().is_empty() || cfg.base_dirs().iter().any(|p| p.as_os_str().is_empty()) {
        bail!("Add at least one base directory");
    }
    safe_name(&cfg.platform)?;
    for h in &cfg.hooks {
        if !["pre_add", "post_add", "pre_remove", "post_remove"].contains(&h.event.as_str()) {
            bail!("Unknown hook event: {}", h.event);
        }
        if let Some(pattern) = &h.matcher
            && !pattern.is_empty()
            && pattern != "*"
        {
            regex_lite::Regex::new(pattern).context("Invalid hook matcher")?;
        }
    }
    Ok(cfg)
}
fn repo_value(r: &Repo) -> Value {
    json!({"path":r.path,"base":r.base,"host":r.host,"owner":r.owner,"name":r.name,"key":r.display_key(),"shortKey":r.short_key(),"url":r.git_url()})
}
fn repos(cfg: &Config) -> Result<Vec<Repo>> {
    repo_source::scan(&cfg.base_dirs())
}
fn selected(req: &Value, cfg: &Config) -> Result<Repo> {
    let path = PathBuf::from(string(req, "path")?);
    let r = repos(cfg)?
        .into_iter()
        .find(|r| r.path == path)
        .context("Repository is no longer in a configured base directory. Refresh the library.")?;
    let base = r.base.canonicalize()?;
    let real = r.path.canonicalize()?;
    if !real.starts_with(&base) || real == base {
        bail!("Repository resolves outside its base directory");
    }
    if fs::symlink_metadata(&r.path)?.file_type().is_symlink() {
        bail!("Refusing to modify a repository symlink");
    }
    Ok(r)
}
fn task_list(cfg: &Config) -> Result<Vec<Value>> {
    let mut all = BTreeMap::new();
    if task::tasks_dir().exists() {
        for entry in fs::read_dir(task::tasks_dir())? {
            let e = entry?;
            if e.file_type()?.is_file() {
                let name = e.file_name().to_string_lossy().to_string();
                all.insert(
                    name.clone(),
                    json!({"name":name,"kind":"script","command":e.path()}),
                );
            }
        }
    }
    for (name, command) in &cfg.tasks {
        all.insert(
            name.clone(),
            json!({"name":name,"kind":"inline","command":command}),
        );
    }
    Ok(all.into_values().collect())
}
fn snapshot() -> Result<Value> {
    let path = config::config_path();
    let default_base = std::env::var("PROJJ_HOME")
        .map_or_else(|_| dirs::home_dir().unwrap_or_default(), PathBuf::from)
        .join("projj");
    if !path.exists() {
        return Ok(
            json!({"initialized":false,"configPath":path,"defaultBase":default_base,"repos":[],"tasks":[],"jobs":[]}),
        );
    }
    let cfg = load()?;
    Ok(
        json!({"initialized":true,"configPath":path,"configText":read(&path)?,"config":cfg,"bases":cfg.base_dirs(),"repos":repos(&cfg)?.iter().map(repo_value).collect::<Vec<_>>(),"tasks":task_list(&cfg)?,"jobs":list_jobs()?,"cliPath":cli_path()?}),
    )
}
fn dispatch(req: &Value) -> Result<Value> {
    match string(req, "method")? {
        "snapshot" => snapshot(),
        "init" => {
            let content = string(req, "content")?;
            validate_config(content)?;
            fs::create_dir_all(config::config_dir())?;
            if !config::config_path().exists() {
                let mut f = OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(config::config_path())?;
                f.write_all(content.as_bytes())?;
            }
            task::install_builtins()?;
            snapshot()
        }
        "config.read" => {
            Ok(json!({"content":read(&config::config_path())?,"path":config::config_path()}))
        }
        "config.save" => {
            let content = string(req, "content")?;
            validate_config(content)?;
            if read(&config::config_path())? != string(req, "previous")? {
                bail!("Configuration changed on disk. Reload before saving.");
            }
            atomic_write(&config::config_path(), content)?;
            snapshot()
        }
        "task.read" => {
            let name = string(req, "name")?;
            safe_name(name)?;
            Ok(json!({"content":read(&task::tasks_dir().join(name))?}))
        }
        "task.save" => {
            let name = string(req, "name")?;
            safe_name(name)?;
            let path = task::tasks_dir().join(name);
            if path.exists() && read(&path)? != string(req, "previous")? {
                bail!("Task changed on disk. Reload before saving.");
            }
            fs::create_dir_all(task::tasks_dir())?;
            atomic_write(&path, string(req, "content")?)?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&path, fs::Permissions::from_mode(0o755))?;
            }
            snapshot()
        }
        "add.preview" => {
            let cfg = load()?;
            let (_, target, info) = add_target(req, &cfg)?;
            Ok(
                json!({"target":target,"key":info.rel_path(),"url":info.clone_url,"exists":target.exists()}),
            )
        }
        "job.start" => start_job(req),
        "run.preview" => preview_run(req),
        "run.terminal" => run_in_terminal(req),
        "job.poll" => poll_job(string(req, "id")?),
        "job.cancel" => cancel_job(string(req, "id")?),
        "repo.status" => {
            let r = selected(req, &load()?)?;
            let out = Command::new("git")
                .args(["status", "--short", "--branch"])
                .current_dir(&r.path)
                .output()?;
            if !out.status.success() {
                bail!("{}", String::from_utf8_lossy(&out.stderr));
            }
            let remote = Command::new("git")
                .args(["remote", "get-url", "origin"])
                .current_dir(&r.path)
                .output()?;
            Ok(
                json!({"status":String::from_utf8_lossy(&out.stdout),"remote":String::from_utf8_lossy(&remote.stdout).trim()}),
            )
        }
        "open" => {
            let r = selected(req, &load()?)?;
            open_repo(&r.path, req["terminal"].as_bool().unwrap_or(false))?;
            Ok(json!({}))
        }
        "shell" => {
            let shell = string(req, "shell")?;
            if !["zsh", "bash", "fish"].contains(&shell) {
                bail!("Unsupported shell");
            }
            let out = Command::new(cli_path()?)
                .args(["shell-setup", shell])
                .output()?;
            if !out.status.success() {
                bail!("Cannot generate shell integration");
            }
            Ok(json!({"content":String::from_utf8_lossy(&out.stdout)}))
        }
        other => bail!("Unknown method: {other}"),
    }
}
fn run_in_terminal(req: &Value) -> Result<Value> {
    let cfg = load()?;
    validate_run(req, &cfg)?;
    let dir = config::config_dir().join("desktop/terminal");
    fs::create_dir_all(&dir)?;
    let path = dir.join(format!(
        "task-{}.command",
        SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis()
    ));
    let home = config::config_dir()
        .parent()
        .context("Home")?
        .to_string_lossy()
        .to_string();
    let script = format!(
        "#!/bin/sh\nexport PROJJ_HOME={}\n{} terminal-worker {}\nresult=$?\nprintf '\\nTask finished (exit %s). Press Enter to close.\\n' \"$result\"\nread -r answer\nexit \"$result\"\n",
        shell_quote(&home),
        shell_quote(&std::env::current_exe()?.to_string_lossy()),
        shell_quote(&req.to_string())
    );
    fs::write(&path, script)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o700))?;
    }
    #[cfg(target_os = "macos")]
    let status = Command::new("open")
        .args(["-a", "Terminal"])
        .arg(&path)
        .status()?;
    #[cfg(not(target_os = "macos"))]
    let status = Command::new("x-terminal-emulator")
        .arg("-e")
        .arg(&path)
        .status()?;
    if !status.success() {
        bail!("Could not open a terminal");
    }
    Ok(json!({"path":path}))
}
fn cli_path() -> Result<PathBuf> {
    Ok(std::env::current_exe()?
        .parent()
        .context("Executable directory")?
        .join("projj"))
}
fn add_target(req: &Value, cfg: &Config) -> Result<(String, PathBuf, git::RepoInfo)> {
    let raw = string(req, "source")?.trim();
    if raw.is_empty() || raw.starts_with('-') {
        bail!("Enter a repository URL or local path");
    }
    let source = if let Some(rest) = raw.strip_prefix("~/") {
        dirs::home_dir()
            .context("Home directory")?
            .join(rest)
            .to_string_lossy()
            .to_string()
    } else {
        raw.to_string()
    };
    let info = git::parse_repo(&source, &cfg.platform)?;
    let rel = info.rel_path();
    if rel.split('/').any(|p| {
        p.is_empty() || p.starts_with('.') || p.contains('\\') || p.chars().any(char::is_control)
    }) || Path::new(&rel)
        .components()
        .any(|p| !matches!(p, Component::Normal(_)))
    {
        bail!("Repository URL contains an unsafe path");
    }
    let bases = cfg.base_dirs();
    let base = PathBuf::from(string(req, "base")?);
    if !bases.contains(&base) {
        bail!("Choose a configured base directory");
    }
    let target = base.join(rel);
    // Existing ancestors must not redirect a clone or move outside the selected root.
    let mut ancestor = target.as_path();
    while ancestor != base {
        if ancestor.exists() && fs::symlink_metadata(ancestor)?.file_type().is_symlink() {
            bail!("Target contains a symbolic link");
        }
        ancestor = ancestor.parent().context("Invalid target")?;
    }
    Ok((source, target, info))
}
fn jobs_dir() -> PathBuf {
    config::config_dir().join("desktop/jobs")
}
fn job_dir(id: &str) -> Result<PathBuf> {
    safe_name(id)?;
    Ok(jobs_dir().join(id))
}
fn list_jobs() -> Result<Vec<Value>> {
    if !jobs_dir().exists() {
        return Ok(vec![]);
    }
    let mut dirs: Vec<_> = fs::read_dir(jobs_dir())?
        .filter_map(Result::ok)
        .filter(|e| e.path().is_dir())
        .collect();
    dirs.sort_by_key(|e| std::cmp::Reverse(e.file_name()));
    Ok(dirs
        .iter()
        .take(30)
        .filter_map(|e| poll_job(&e.file_name().to_string_lossy()).ok())
        .map(|mut job| {
            if let Some(log) = job["log"].as_str()
                && log.len() > 8192
            {
                let mut start = log.len() - 8192;
                while !log.is_char_boundary(start) {
                    start += 1;
                }
                job["log"] = json!(&log[start..]);
                job["truncated"] = json!(true);
            }
            job
        })
        .collect())
}
fn start_job(req: &Value) -> Result<Value> {
    let cfg = load()?;
    match string(req, "operation")? {
        "add" => {
            add_target(req, &cfg)?;
        }
        "remove" => {
            let r = selected(req, &cfg)?;
            if string(req, "confirmation")? != r.short_key() {
                bail!("Type {} to confirm permanent removal", r.short_key());
            }
        }
        "run" => {
            validate_run(req, &cfg)?;
        }
        _ => bail!("Unsupported operation"),
    }
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis();
    let id = format!("{stamp}-{}", std::process::id());
    let dir = job_dir(&id)?;
    fs::create_dir_all(&dir)?;
    let log = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(dir.join("output.log"))?;
    let mut cmd = Command::new(std::env::current_exe()?);
    cmd.args(["worker", &id, &req.to_string()])
        .stdin(Stdio::null())
        .stdout(log.try_clone()?)
        .stderr(log)
        .env("NO_COLOR", "1")
        .env("GIT_TERMINAL_PROMPT", "0");
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    let child = cmd.spawn()?;
    write_json(
        &dir.join("meta.json"),
        &json!({"id":id,"pid":child.id(),"started":stamp,"operation":req["operation"],"request":req,"label":req["task"].as_str().or(req["source"].as_str()).or(req["path"].as_str()).unwrap_or("Operation")}),
    )?;
    poll_job(&id)
}
fn poll_job(id: &str) -> Result<Value> {
    let dir = job_dir(id)?;
    let mut meta: Value = serde_json::from_str(&read(&dir.join("meta.json"))?)?;
    let result = dir.join("result.json");
    let mut state = if result.exists() {
        serde_json::from_str::<Value>(&read(&result)?)?
    } else {
        json!({"state":"running"})
    };
    #[cfg(unix)]
    if state["state"] == "running" {
        let pid: i32 = meta["pid"].as_i64().context("Job PID")?.try_into()?;
        if !worker_alive(pid, id)? {
            state = if result.exists() {
                serde_json::from_str(&read(&result)?)?
            } else {
                json!({"state":"interrupted","error":"The worker stopped before it reported a result. Inspect the log and repository before retrying."})
            };
        }
    }
    let mut file = fs::File::open(dir.join("output.log"))?;
    let size = file.metadata()?.len();
    file.seek(SeekFrom::Start(size.saturating_sub(256 * 1024)))?;
    let mut bytes = vec![];
    file.read_to_end(&mut bytes)?;
    meta["state"] = state["state"].clone();
    meta["error"] = state["error"].clone();
    meta["data"] = state["data"].clone();
    meta["log"] = json!(String::from_utf8_lossy(&bytes));
    meta["truncated"] = json!(size > 256 * 1024);
    Ok(meta)
}
#[cfg(unix)]
fn worker_alive(pid: i32, id: &str) -> Result<bool> {
    // A persisted PID alone is insufficient: the OS can reuse it after a crash.
    let output = Command::new("ps")
        .args(["-ww", "-p", &pid.to_string(), "-o", "command="])
        .output()?;
    let command = String::from_utf8_lossy(&output.stdout);
    Ok(output.status.success()
        && command.contains("projj-desktop-backend")
        && command.contains(&format!(" worker {id} ")))
}
fn cancel_job(id: &str) -> Result<Value> {
    let value = poll_job(id)?;
    if value["state"] != "running" {
        return Ok(value);
    }
    #[cfg(unix)]
    {
        let pid: i32 = value["pid"].as_i64().context("PID")?.try_into()?;
        if unsafe { libc::kill(-pid, libc::SIGTERM) } != 0 {
            let current = poll_job(id)?;
            if current["state"] != "running" {
                return Ok(current);
            }
            bail!("Cannot stop worker");
        }
    }
    #[cfg(not(unix))]
    {
        bail!("Cancellation is not supported on this platform");
    }
    write_json(
        &job_dir(id)?.join("result.json"),
        &json!({"state":"cancelled"}),
    )?;
    poll_job(id)
}
fn run_targets(req: &Value, cfg: &Config) -> Result<Vec<PathBuf>> {
    if req["all"].as_bool().unwrap_or(false) {
        let pattern = req["pattern"].as_str().unwrap_or("");
        let re = regex_lite::Regex::new(pattern).context("Invalid match expression")?;
        Ok(repos(cfg)?
            .into_iter()
            .filter(|r| re.is_match(&r.display_key()))
            .map(|r| r.path)
            .collect())
    } else if req["cwd"].as_str().is_some_and(|s| !s.is_empty()) {
        let path = PathBuf::from(string(req, "cwd")?);
        if !path.is_absolute() {
            bail!("Enter an absolute working directory");
        }
        if !path.is_dir() {
            bail!("Working directory does not exist");
        }
        Ok(vec![path])
    } else {
        Ok(vec![selected(req, cfg)?.path])
    }
}
fn preview_run(req: &Value) -> Result<Value> {
    let targets = run_targets(req, &load()?)?;
    Ok(json!({"total":targets.len(),"paths":targets.iter().take(3).collect::<Vec<_>>()}))
}
fn validate_run(req: &Value, cfg: &Config) -> Result<()> {
    if run_targets(req, cfg)?.is_empty() {
        bail!("No repositories match this filter");
    }
    task_script(req, cfg)?;
    Ok(())
}
fn perform(req: &Value) -> Result<Value> {
    let cfg = load()?;
    match string(req, "operation")? {
        "add" => {
            let (source, target, info) = add_target(req, &cfg)?;
            if target.exists() {
                println!("Already exists: {}. Hooks skipped.", target.display());
                return Ok(json!({"path":target,"existed":true}));
            }
            hook::run_hooks(&cfg, "pre_add", &info.rel_path(), &target)?;
            if source.starts_with('.') || Path::new(&source).is_absolute() {
                git::move_local(&source, &target)?;
            } else {
                git::clone_remote(&info.clone_url, &target)?;
            }
            hook::run_hooks(&cfg, "post_add", &info.rel_path(), &target)?;
            println!("Added {}", target.display());
            Ok(json!({"path":target}))
        }
        "remove" => {
            let r = selected(req, &cfg)?;
            if string(req, "confirmation")? != r.short_key() {
                bail!("Confirmation does not match");
            }
            hook::run_hooks(&cfg, "pre_remove", &r.display_key(), &r.path)?;
            fs::remove_dir_all(&r.path)?;
            let parent = r.path.parent().context("Parent directory")?;
            // Keep the parent until post_remove finishes so hooks have a real cwd.
            hook::run_hooks(&cfg, "post_remove", &r.display_key(), parent)?;
            if parent.read_dir()?.next().is_none() {
                let _ = fs::remove_dir(parent);
            }
            println!("Removed {}", r.display_key());
            Ok(json!({"path":r.path}))
        }
        "run" => {
            let targets = run_targets(req, &cfg)?;
            let script = task_script(req, &cfg)?;
            let mut failures = 0;
            for (i, path) in targets.iter().enumerate() {
                println!(
                    "[{}/{}] {}\n$ {}",
                    i + 1,
                    targets.len(),
                    path.display(),
                    script
                );
                std::io::stdout().flush()?;
                if let Err(e) = task::run(&script, path) {
                    failures += 1;
                    eprintln!("{e:#}");
                }
            }
            println!(
                "Finished {} repositories; {failures} failed.",
                targets.len()
            );
            if failures > 0 {
                bail!("{failures} of {} task runs failed", targets.len());
            }
            Ok(json!({"total":targets.len(),"failed":failures}))
        }
        _ => bail!("Unknown operation"),
    }
}
fn task_script(req: &Value, cfg: &Config) -> Result<String> {
    let name = string(req, "task")?;
    if name.trim().is_empty() {
        bail!("Enter a task or command");
    }
    let resolved = task::resolve(cfg, name);
    let mut script = if task::tasks_dir().join(name).is_file() && !cfg.tasks.contains_key(name) {
        shell_quote(&resolved)
    } else {
        resolved
    };
    if let Some(args) = req["args"].as_array() {
        for arg in args {
            script.push(' ');
            script.push_str(&shell_quote(
                arg.as_str().context("Arguments must be strings")?,
            ));
        }
    }
    Ok(script)
}
fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}
fn open_repo(path: &Path, terminal: bool) -> Result<()> {
    #[cfg(target_os = "macos")]
    {
        let mut cmd = Command::new("open");
        if terminal {
            cmd.args(["-a", "Terminal"]);
        }
        cmd.arg(path);
        if !cmd.status()?.success() {
            bail!("Could not open {}", path.display());
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let mut cmd = Command::new(if terminal {
            "x-terminal-emulator"
        } else {
            "xdg-open"
        });
        if terminal {
            cmd.current_dir(path);
        } else {
            cmd.arg(path);
        }
        if !cmd.status()?.success() {
            bail!("Could not open {}", path.display());
        }
    }
    Ok(())
}
