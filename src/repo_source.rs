use std::path::{Path, PathBuf};

use anyhow::Result;

#[derive(Debug, Clone)]
pub struct Repo {
    pub path: PathBuf,
    pub base: PathBuf,
    pub host: String,
    pub owner: String,
    pub name: String,
}

impl Repo {
    /// owner/repo
    pub fn short_key(&self) -> String {
        format!("{}/{}", self.owner, self.name)
    }

    /// host/owner/repo
    pub fn display_key(&self) -> String {
        format!("{}/{}/{}", self.host, self.owner, self.name)
    }

    /// Construct git URL from path components
    pub fn git_url(&self) -> String {
        format!("git@{}:{}/{}.git", self.host, self.owner, self.name)
    }
}

/// Scan base directories for git repositories.
/// Layout: base/host/owner[/subgroup]/repo/.git. Does not traverse a repository.
pub fn scan(base_dirs: &[PathBuf]) -> Result<Vec<Repo>> {
    let mut repos = Vec::new();
    for base in base_dirs {
        if !base.exists() {
            continue;
        }
        scan_base(base, &mut repos)?;
    }
    repos.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(repos)
}

fn scan_base(base: &Path, repos: &mut Vec<Repo>) -> Result<()> {
    let Ok(hosts) = std::fs::read_dir(base) else {
        return Ok(());
    };
    for entry in hosts {
        let entry = entry?;
        let host = entry.file_name().to_string_lossy().to_string();
        if !entry.file_type()?.is_dir() || host.starts_with('.') {
            continue;
        }
        scan_namespace(base, &host, &entry.path(), "", repos)?;
    }
    Ok(())
}

fn scan_namespace(
    base: &Path,
    host: &str,
    directory: &Path,
    namespace: &str,
    repos: &mut Vec<Repo>,
) -> Result<()> {
    let Ok(entries) = std::fs::read_dir(directory) else {
        return Ok(());
    };
    for entry in entries {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().to_string();
        // Do not follow symbolic links, hidden folders, or nested repositories.
        if !entry.file_type()?.is_dir() || name.starts_with('.') {
            continue;
        }
        let path = entry.path();
        if !namespace.is_empty() && path.join(".git").exists() {
            repos.push(Repo {
                path,
                base: base.to_path_buf(),
                host: host.to_string(),
                owner: namespace.to_string(),
                name,
            });
        } else if namespace.is_empty() || (host.contains('.') && is_namespace(&path)?) {
            let owner = if namespace.is_empty() {
                name
            } else {
                format!("{namespace}/{name}")
            };
            scan_namespace(base, host, &path, &owner, repos)?;
        }
    }
    Ok(())
}

// DNS host directories may contain deeper namespaces. Other top-level
// directories keep the original fixed-depth scan (for example, worktrees).
// A deeper namespace is a container of directories, not a project tree.
// Avoid discovering fixtures inside untracked projects or walking build output.
fn is_namespace(path: &Path) -> Result<bool> {
    if path.join(".git").exists() {
        return Ok(false);
    }
    let name = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
    if ["node_modules", "target", "vendor", "dist", "build"].contains(&name) {
        return Ok(false);
    }
    let Ok(entries) = std::fs::read_dir(path) else {
        return Ok(false);
    };
    for entry in entries {
        let entry = entry?;
        let name = entry.file_name();
        if !name.to_string_lossy().starts_with('.') && !entry.file_type()?.is_dir() {
            return Ok(false);
        }
    }
    Ok(true)
}

/// Find repos matching a keyword (case-insensitive).
///
/// Returns all matches. Exact matches (ends with /keyword) are sorted first,
/// followed by partial matches (contains keyword).
pub fn find(repos: &[Repo], keyword: &str) -> Vec<Repo> {
    let kw_lower = keyword.to_lowercase();
    let keyword_suffix = format!("/{}", kw_lower.trim_start_matches('/'));

    let mut exact = Vec::new();
    let mut partial = Vec::new();

    for repo in repos {
        let key = repo.display_key().to_lowercase();
        if key.ends_with(&keyword_suffix) {
            exact.push(repo.clone());
        } else if key.contains(&kw_lower) {
            partial.push(repo.clone());
        }
    }

    exact.extend(partial);
    exact
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scan_nested_namespaces_without_entering_repositories() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().join("gitlab.com/group/subgroup/project");
        std::fs::create_dir_all(repo.join(".git")).unwrap();
        std::fs::create_dir_all(repo.join("nested/.git")).unwrap();
        let repos = scan(&[dir.path().to_path_buf()]).unwrap();
        assert_eq!(repos.len(), 1);
        assert_eq!(repos[0].owner, "group/subgroup");
        assert_eq!(repos[0].short_key(), "group/subgroup/project");
    }

    #[test]
    fn scan_keeps_conventional_repos_in_an_owner_with_git_metadata() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("github.com/owner/.git")).unwrap();
        std::fs::create_dir_all(dir.path().join("github.com/owner/project/.git")).unwrap();
        std::fs::create_dir_all(
            dir.path()
                .join("github.com/owner/source/tests/fixture/.git"),
        )
        .unwrap();
        std::fs::write(
            dir.path().join("github.com/owner/source/package.json"),
            "{}",
        )
        .unwrap();
        let repos = scan(&[dir.path().to_path_buf()]).unwrap();
        assert_eq!(repos.len(), 1);
        assert_eq!(repos[0].name, "project");
    }

    fn make_repo(host: &str, owner: &str, name: &str) -> Repo {
        Repo {
            path: PathBuf::from(format!("/base/{host}/{owner}/{name}")),
            base: PathBuf::from("/base"),
            host: host.to_string(),
            owner: owner.to_string(),
            name: name.to_string(),
        }
    }

    #[test]
    fn test_repo_display_key() {
        let repo = make_repo("github.com", "popomore", "projj");
        assert_eq!(repo.display_key(), "github.com/popomore/projj");
    }

    #[test]
    fn test_repo_short_key() {
        let repo = make_repo("github.com", "popomore", "projj");
        assert_eq!(repo.short_key(), "popomore/projj");
    }

    #[test]
    fn test_repo_git_url() {
        let repo = make_repo("github.com", "popomore", "projj");
        assert_eq!(repo.git_url(), "git@github.com:popomore/projj.git");
    }

    #[test]
    fn test_find_exact_match() {
        let repos = vec![
            make_repo("github.com", "popomore", "projj"),
            make_repo("github.com", "popomore", "tiny-projj"),
        ];
        let result = find(&repos, "projj");
        // Both match: "projj" exact first, "tiny-projj" partial second
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].name, "projj");
        assert_eq!(result[1].name, "tiny-projj");
    }

    #[test]
    fn test_find_case_insensitive() {
        let repos = vec![make_repo("github.com", "popomore", "Projj")];
        let result = find(&repos, "projj");
        assert_eq!(result.len(), 1);
    }

    #[test]
    fn test_find_owner_repo() {
        let repos = vec![
            make_repo("github.com", "popomore", "projj"),
            make_repo("github.com", "other", "projj"),
        ];
        let result = find(&repos, "popomore/projj");
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].owner, "popomore");
    }

    #[test]
    fn test_find_no_match() {
        let repos = vec![make_repo("github.com", "popomore", "projj")];
        let result = find(&repos, "nonexistent");
        assert!(result.is_empty());
    }

    #[test]
    fn test_find_partial_match() {
        let repos = vec![
            make_repo("github.com", "popomore", "projj"),
            make_repo("github.com", "SeeleAI", "projj-tools"),
        ];
        let result = find(&repos, "projj");
        assert_eq!(result.len(), 2);
        // Exact match first
        assert_eq!(result[0].name, "projj");
        assert_eq!(result[1].name, "projj-tools");
    }

    #[test]
    fn test_scan_empty_dir() {
        let dir = tempfile::tempdir().unwrap();
        let repos = scan(&[dir.path().to_path_buf()]).unwrap();
        assert!(repos.is_empty());
    }

    #[test]
    fn test_scan_with_repos() {
        let dir = tempfile::tempdir().unwrap();
        let repo_path = dir.path().join("github.com/popomore/projj/.git");
        std::fs::create_dir_all(&repo_path).unwrap();
        let repos = scan(&[dir.path().to_path_buf()]).unwrap();
        assert_eq!(repos.len(), 1);
        assert_eq!(repos[0].host, "github.com");
        assert_eq!(repos[0].owner, "popomore");
        assert_eq!(repos[0].name, "projj");
    }

    #[test]
    fn test_scan_skips_hidden_dirs() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join(".hidden/owner/repo/.git")).unwrap();
        std::fs::create_dir_all(dir.path().join("github.com/.hidden/repo/.git")).unwrap();
        std::fs::create_dir_all(dir.path().join("github.com/owner/.hidden/.git")).unwrap();
        let repos = scan(&[dir.path().to_path_buf()]).unwrap();
        assert!(repos.is_empty());
    }

    #[test]
    fn test_scan_skips_non_git_dirs() {
        let dir = tempfile::tempdir().unwrap();
        // No .git directory
        std::fs::create_dir_all(dir.path().join("github.com/owner/repo")).unwrap();
        let repos = scan(&[dir.path().to_path_buf()]).unwrap();
        assert!(repos.is_empty());
    }

    #[test]
    fn test_scan_nonexistent_base() {
        let repos = scan(&[PathBuf::from("/nonexistent/path")]).unwrap();
        assert!(repos.is_empty());
    }

    #[test]
    fn test_scan_multiple_bases() {
        let dir1 = tempfile::tempdir().unwrap();
        let dir2 = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir1.path().join("github.com/a/repo1/.git")).unwrap();
        std::fs::create_dir_all(dir2.path().join("gitlab.com/b/repo2/.git")).unwrap();
        let repos = scan(&[dir1.path().to_path_buf(), dir2.path().to_path_buf()]).unwrap();
        assert_eq!(repos.len(), 2);
    }

    #[test]
    fn test_scan_skips_files_at_host_level() {
        let dir = tempfile::tempdir().unwrap();
        // A file where a host dir should be
        std::fs::write(dir.path().join("not-a-dir"), "").unwrap();
        std::fs::create_dir_all(dir.path().join("github.com/owner/repo/.git")).unwrap();
        let repos = scan(&[dir.path().to_path_buf()]).unwrap();
        assert_eq!(repos.len(), 1);
    }

    #[test]
    fn test_scan_skips_files_at_owner_level() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("github.com")).unwrap();
        std::fs::write(dir.path().join("github.com/not-a-dir"), "").unwrap();
        let repos = scan(&[dir.path().to_path_buf()]).unwrap();
        assert!(repos.is_empty());
    }

    #[test]
    fn test_scan_skips_files_at_repo_level() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("github.com/owner")).unwrap();
        std::fs::write(dir.path().join("github.com/owner/not-a-dir"), "").unwrap();
        let repos = scan(&[dir.path().to_path_buf()]).unwrap();
        assert!(repos.is_empty());
    }

    #[test]
    fn test_scan_sorted_output() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("github.com/z/repo/.git")).unwrap();
        std::fs::create_dir_all(dir.path().join("github.com/a/repo/.git")).unwrap();
        let repos = scan(&[dir.path().to_path_buf()]).unwrap();
        assert_eq!(repos.len(), 2);
        assert!(repos[0].path < repos[1].path);
    }

    #[test]
    fn test_scan_sets_base_field() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("github.com/owner/repo/.git")).unwrap();
        let repos = scan(&[dir.path().to_path_buf()]).unwrap();
        assert_eq!(repos[0].base, dir.path());
    }
}
