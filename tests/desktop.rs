//! End-to-end tests use isolated `PROJJ_HOME` directories and local Git remotes.
use serde_json::{Value, json};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    thread,
    time::Duration,
};
use tempfile::TempDir;

struct App {
    temp: TempDir,
    base: PathBuf,
}
impl App {
    fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let base = temp.path().join("repos with spaces");
        Self { temp, base }
    }
    #[allow(clippy::needless_pass_by_value)]
    fn call(&self, req: Value) -> Value {
        let out = Command::new(env!("CARGO_BIN_EXE_projj-desktop-backend"))
            .arg(req.to_string())
            .env("PROJJ_HOME", self.temp.path())
            .env("GIT_CONFIG_GLOBAL", self.temp.path().join("gitconfig"))
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .output()
            .unwrap();
        serde_json::from_slice(&out.stdout).unwrap_or_else(|_| {
            panic!(
                "{} {}",
                String::from_utf8_lossy(&out.stdout),
                String::from_utf8_lossy(&out.stderr)
            )
        })
    }
    fn ok(&self, req: Value) -> Value {
        let v = self.call(req);
        assert_eq!(v["ok"], true, "{v}");
        v["data"].clone()
    }
    fn init(&self) -> Value {
        self.ok(json!({"method":"init","content":format!("base = {:?}\nplatform = \"github.com\"\n",self.base.to_str().unwrap())}))
    }
    fn repo(&self, name: &str) -> PathBuf {
        let p = self.base.join("github.com/acme").join(name);
        git(&p, &["init", "-q"]);
        p
    }
    fn job(&self, mut req: Value) -> Value {
        req["method"] = json!("job.start");
        let job = self.ok(req);
        self.wait(&job["id"])
    }
    fn wait(&self, id: &Value) -> Value {
        for _ in 0..300 {
            let j = self.ok(json!({"method":"job.poll","id":id}));
            if j["state"] != "running" {
                return j;
            }
            thread::sleep(Duration::from_millis(20));
        }
        panic!("job timed out")
    }
}
fn git(path: &Path, args: &[&str]) {
    fs::create_dir_all(path).unwrap();
    let out = Command::new("git")
        .current_dir(path)
        .args(args)
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
}
#[test]
fn configuration_init_preserves_existing_files_and_validates_edits() {
    let app = App::new();
    assert_eq!(app.ok(json!({"method":"snapshot"}))["initialized"], false);
    let first = app.init();
    assert!(app.temp.path().join(".projj/tasks/clean").is_file());
    let again = app.ok(json!({"method":"init","content":"base = '/ignored'"}));
    assert_eq!(first["configText"], again["configText"]);
    let invalid = app
        .call(json!({"method":"config.save","content":"base = []","previous":first["configText"]}));
    assert_eq!(invalid["ok"], false);
    let conflict =
        app.call(json!({"method":"config.save","content":"base = '/tmp/x'","previous":"stale"}));
    assert_eq!(conflict["ok"], false);
    let content = format!(
        "{}\n[tasks]\nhello = 'printf hello'\n\n[[hooks]]\nevent = 'post_add'\nmatcher = 'github\\.com'\ntasks = ['hello']\nenv = {{ NAME = 'test' }}\n",
        first["configText"].as_str().unwrap()
    );
    let saved =
        app.ok(json!({"method":"config.save","content":content,"previous":first["configText"]}));
    assert_eq!(saved["config"]["hooks"][0]["env"]["NAME"], "test");
    let custom = "#!/bin/sh\necho custom\n";
    app.ok(json!({"method":"task.save","name":"hello-world","content":custom,"previous":""}));
    assert_eq!(
        app.ok(json!({"method":"task.read","name":"hello-world"}))["content"],
        custom
    );
    assert_eq!(
        app.call(json!({"method":"task.save","name":"../escape","content":"bad","previous":""}))["ok"],
        false
    );
}
#[test]
fn task_arguments_batch_filter_failures_and_cancel() {
    let app = App::new();
    app.init();
    let one = app.repo("one");
    let two = app.repo("two");
    let result=app.job(json!({"operation":"run","path":one,"task":"printf '%s\\n'","args":["hello world","$(touch HACKED)","it's quoted"]}));
    assert_eq!(result["state"], "completed", "{result}");
    assert!(
        result["log"]
            .as_str()
            .unwrap()
            .contains("hello world\n$(touch HACKED)\nit's quoted")
    );
    assert!(!one.join("HACKED").exists());
    let result =
        app.job(json!({"operation":"run","all":true,"pattern":"/one$","task":"touch matched"}));
    assert_eq!(result["data"]["total"], 1);
    assert!(one.join("matched").exists());
    assert!(!two.join("matched").exists());
    let result = app.job(json!({"operation":"run","all":true,"task":"exit 7"}));
    assert_eq!(result["state"], "failed");
    assert!(result["error"].as_str().unwrap().contains("2 of 2"));
    assert_eq!(app.call(json!({"method":"job.start","operation":"run","all":true,"pattern":"[","task":"echo bad"}))["ok"],false);
    let job=app.ok(json!({"method":"job.start","operation":"run","path":one,"task":"sleep 30; touch SHOULD_NOT_EXIST"}));
    thread::sleep(Duration::from_millis(100));
    assert_eq!(
        app.ok(json!({"method":"job.cancel","id":job["id"]}))["state"],
        "cancelled"
    );
    assert!(!one.join("SHOULD_NOT_EXIST").exists());
}
#[test]
fn batch_preview_and_execution_match_cli_across_roots_and_namespaces() {
    let app = App::new();
    let second = app.temp.path().join("second root");
    app.ok(json!({"method":"init","content":format!("base = [{:?}, {:?}]\n[tasks]\nrecord = 'touch inline-task'\n", app.base, second)}));
    let paths = [
        app.repo("first"),
        app.base.join("gitlab.com/team/nested/one"),
        second.join("gitlab.com/team/two"),
        second.join("gitlab.com/team/three"),
    ];
    for path in &paths[1..] {
        git(path, &["init", "-q"]);
    }
    let preview = app.ok(json!({"method":"run.preview","all":true}));
    assert_eq!(preview["total"], 4);
    assert_eq!(preview["paths"].as_array().unwrap().len(), 3);

    // Inline flags and nested namespaces must use the CLI's Rust regex syntax.
    let pattern = r"(?i)^GITLAB\.COM/team/";
    let preview = app.ok(json!({"method":"run.preview","all":true,"pattern":pattern}));
    let mut expected = paths[1..].to_vec();
    expected.sort();
    assert_eq!(preview, json!({"total":3,"paths":expected}));
    let cli = Command::new(env!("CARGO_BIN_EXE_projj"))
        .args(["run", "touch cli-matched", "--all", "--match", pattern])
        .env("PROJJ_HOME", app.temp.path())
        .output()
        .unwrap();
    assert!(cli.status.success(), "{cli:?}");
    let job = app.job(
        json!({"operation":"run","all":true,"pattern":pattern,"task":"touch desktop-matched"}),
    );
    assert_eq!(job["data"], json!({"total":3,"failed":0}));
    for (index, path) in paths.iter().enumerate() {
        assert_eq!(path.join("cli-matched").exists(), index > 0);
        assert_eq!(path.join("desktop-matched").exists(), index > 0);
    }

    // The config task takes precedence over a task file with the same name.
    app.ok(json!({"method":"task.save","name":"record","content":"#!/bin/sh\ntouch file-task\n","previous":""}));
    let job = app.job(json!({"operation":"run","all":true,"task":"record"}));
    assert_eq!(job["data"], json!({"total":4,"failed":0}));
    for path in &paths {
        assert!(path.join("inline-task").exists());
        assert!(!path.join("file-task").exists());
    }

    // Terminal execution uses the same targets and executable task files.
    app.ok(json!({"method":"task.save","name":"record-file","content":"#!/bin/sh\nprintf '%s\\n' \"$@\" > terminal-args\n","previous":""}));
    let terminal = Command::new(env!("CARGO_BIN_EXE_projj-desktop-backend"))
        .arg("terminal-worker")
        .arg(json!({"operation":"run","all":true,"pattern":pattern,"task":"record-file","args":["hello world","$(touch HACKED)"]}).to_string())
        .env("PROJJ_HOME", app.temp.path())
        .output()
        .unwrap();
    assert!(terminal.status.success(), "{terminal:?}");
    assert!(!paths[0].join("terminal-args").exists());
    for path in &paths[1..] {
        assert_eq!(
            fs::read_to_string(path.join("terminal-args")).unwrap(),
            "hello world\n$(touch HACKED)\n"
        );
        assert!(!path.join("HACKED").exists());
    }

    fs::write(paths[0].join("fail"), "").unwrap();
    let job = app.job(json!({"operation":"run","all":true,"task":"if [ -f fail ]; then exit 7; fi; touch continued"}));
    assert_eq!(job["state"], "failed");
    assert!(
        job["log"]
            .as_str()
            .unwrap()
            .contains("Finished 4 repositories; 1 failed.")
    );
    assert!(!paths[0].join("continued").exists());
    for path in &paths[1..] {
        assert!(path.join("continued").exists());
    }
}
#[test]
fn invalid_batch_targets_are_rejected_before_starting_jobs_or_terminal() {
    let app = App::new();
    app.init();
    let repo = app.repo("one");
    assert_eq!(
        app.ok(json!({"method":"run.preview","all":true,"pattern":"/missing$"})),
        json!({"total":0,"paths":[]})
    );
    assert_eq!(
        app.call(json!({"method":"run.preview","all":true,"pattern":"["}))["ok"],
        false
    );
    for method in ["job.start", "run.terminal"] {
        for (pattern, message) in [
            ("[", "Invalid match expression"),
            ("/missing$", "No repositories match"),
        ] {
            let result = app.call(json!({"method":method,"operation":"run","all":true,"pattern":pattern,"task":"touch SHOULD_NOT_EXIST"}));
            assert_eq!(result["ok"], false);
            assert!(result["error"].as_str().unwrap().contains(message));
        }
        let result = app.call(json!({"method":method,"operation":"run","cwd":"relative/path","path":repo,"task":"touch SHOULD_NOT_EXIST"}));
        assert_eq!(result["ok"], false);
        assert!(
            result["error"]
                .as_str()
                .unwrap()
                .contains("absolute working directory")
        );
    }
    assert!(!repo.join("SHOULD_NOT_EXIST").exists());
    assert_eq!(app.ok(json!({"method":"snapshot"}))["jobs"], json!([]));
    assert!(!app.temp.path().join(".projj/desktop/terminal").exists());
}
#[test]
#[allow(clippy::format_push_string)]
fn local_move_hooks_and_confirmed_removal() {
    let app = App::new();
    let cfg = app.init();
    let source = app.temp.path().join("incoming");
    git(&source, &["init", "-q"]);
    git(
        &source,
        &["remote", "add", "origin", "git@github.com:acme/moved.git"],
    );
    let marker = app.temp.path().join("events");
    let mut content = cfg["configText"].as_str().unwrap().to_string();
    for event in ["pre_add", "post_add", "pre_remove", "post_remove"] {
        content += &format!(
            "\n[[hooks]]\nevent = '{event}'\nmatcher = 'github\\.com/acme'\ntasks = [\"printf '%s:%s:%s\\\\n' \\\"$PROJJ_EVENT\\\" \\\"$PROJJ_REPO_NAME\\\" \\\"$CUSTOM\\\" >> '{}'\"]\nenv = {{ CUSTOM = 'present' }}\n",
            marker.display()
        );
    }
    app.ok(json!({"method":"config.save","content":content,"previous":cfg["configText"]}));
    let preview = app.ok(json!({"method":"add.preview","source":source,"base":app.base}));
    assert_eq!(preview["key"], "github.com/acme/moved");
    let job = app.job(json!({"operation":"add","source":source,"base":app.base}));
    assert_eq!(job["state"], "completed", "{job}");
    assert!(!source.exists());
    let path = PathBuf::from(preview["target"].as_str().unwrap());
    assert!(path.join(".git").is_dir());
    let snapshot = app.ok(json!({"method":"snapshot"}));
    assert_eq!(snapshot["repos"].as_array().unwrap().len(), 1);
    let skip = app.job(json!({"operation":"add","source":"acme/moved","base":app.base}));
    assert_eq!(skip["data"]["existed"], true);
    assert_eq!(
        app.call(
            json!({"method":"job.start","operation":"remove","path":path,"confirmation":"wrong"})
        )["ok"],
        false
    );
    assert!(path.exists());
    let removed = app.job(json!({"operation":"remove","path":path,"confirmation":"acme/moved"}));
    assert_eq!(removed["state"], "completed", "{removed}");
    assert!(!path.exists());
    let events = fs::read_to_string(marker).unwrap();
    assert_eq!(
        events.lines().collect::<Vec<_>>(),
        vec![
            "pre_add:moved:present",
            "post_add:moved:present",
            "pre_remove:moved:present",
            "post_remove:moved:present"
        ]
    );
}
#[test]
fn clone_remote_and_reject_traversal() {
    let app = App::new();
    app.init();
    let origin = app.temp.path().join("origin");
    git(&origin, &["init", "-q"]);
    git(
        &origin,
        &[
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.com",
            "commit",
            "--allow-empty",
            "-qm",
            "Initial",
        ],
    );
    fs::write(
        app.temp.path().join("gitconfig"),
        format!(
            "[url \"file://{}\"]\n  insteadOf = https://example.test/acme/remote.git\n",
            origin.display()
        ),
    )
    .unwrap();
    let job = app.job(
        json!({"operation":"add","source":"https://example.test/acme/remote.git","base":app.base}),
    );
    assert_eq!(job["state"], "completed", "{job}");
    assert!(app.base.join("example.test/acme/remote/.git").is_dir());
    for source in [
        "https://github.com/../../escaped",
        "acme/../../escaped",
        "--upload-pack=bad",
    ] {
        assert_eq!(
            app.call(json!({"method":"add.preview","source":source,"base":app.base}))["ok"],
            false
        );
    }
}
#[test]
fn built_in_clean_preserves_tracked_and_untracked_files() {
    let app = App::new();
    app.init();
    let repo = app.repo("clean-test");
    fs::write(repo.join(".gitignore"), "target/\n").unwrap();
    fs::write(repo.join("keep.txt"), "keep").unwrap();
    fs::create_dir(repo.join("target")).unwrap();
    fs::write(repo.join("target/cache"), "cache").unwrap();
    let dry = app.job(json!({"operation":"run","path":repo,"task":"clean"}));
    assert_eq!(dry["state"], "completed", "{dry}");
    assert!(repo.join("target/cache").exists());
    let clean =
        app.job(json!({"operation":"run","path":repo,"task":"clean","args":["--force","--yes"]}));
    assert_eq!(clean["state"], "completed", "{clean}");
    assert!(!repo.join("target").exists());
    assert!(repo.join("keep.txt").exists());
}
#[test]
fn shell_integration_and_status_use_bundled_cli() {
    let app = App::new();
    app.init();
    let repo = app.repo("status");
    assert!(
        app.ok(json!({"method":"repo.status","path":repo}))["status"]
            .as_str()
            .unwrap()
            .contains("No commits")
    );
    for shell in ["zsh", "bash", "fish"] {
        let script = app.ok(json!({"method":"shell","shell":shell}));
        assert!(script["content"].as_str().unwrap().contains("projj find"));
    }
}

#[test]
fn empty_runtime_environment_restores_home_path_and_optional_tasks() {
    let app = App::new();
    app.init();
    let repo = app.repo("environment");
    let out = Command::new(env!("CARGO_BIN_EXE_projj-desktop-backend"))
        .env_clear()
        .arg(json!({"method":"job.start", "home":app.temp.path(), "operation":"run", "path":repo, "task":"printf '%s\\n' \"$HOME\"; command -v git"}).to_string())
        .output().unwrap();
    let response: Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(response["ok"], true, "{response}");
    let job = app.wait(&response["data"]["id"]);
    assert_eq!(job["state"], "completed", "{job}");
    assert!(
        job["log"]
            .as_str()
            .unwrap()
            .contains(app.temp.path().to_str().unwrap())
    );
    // Missing optional tools and optional identity fields must be successful no-ops.
    let zoxide = Command::new("/bin/bash")
        .arg(app.temp.path().join(".projj/tasks/zoxide"))
        .env_clear()
        .env("PATH", "/nonexistent")
        .status()
        .unwrap();
    assert!(zoxide.success());
    let identity = Command::new("/bin/bash")
        .arg(app.temp.path().join(".projj/tasks/git-config-user"))
        .env_clear()
        .status()
        .unwrap();
    assert!(identity.success());
}

#[test]
fn a_failed_pre_remove_hook_preserves_the_repository() {
    let app = App::new();
    let config = app.init();
    let repo = app.repo("protected");
    let content = format!(
        "{}\n[[hooks]]\nevent = 'pre_remove'\ntasks = ['exit 3']\n",
        config["configText"].as_str().unwrap()
    );
    app.ok(json!({"method":"config.save","previous":config["configText"],"content":content}));
    let result = app.job(json!({"operation":"remove","path":repo,"confirmation":"acme/protected"}));
    assert_eq!(result["state"], "failed");
    assert!(repo.join(".git").exists());
}

#[test]
fn stale_pid_does_not_cancel_an_unrelated_process() {
    let app = App::new();
    app.init();
    let dir = app.temp.path().join(".projj/desktop/jobs/stale");
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("meta.json"), json!({"id":"stale","pid":std::process::id(),"started":0,"label":"stale","operation":"run"}).to_string()).unwrap();
    fs::write(dir.join("output.log"), "interrupted").unwrap();
    assert_eq!(
        app.ok(json!({"method":"job.cancel","id":"stale"}))["state"],
        "interrupted"
    );
}
