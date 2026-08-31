use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};
use directories::ProjectDirs;
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct Paths {
    pub root: PathBuf,
    pub token: PathBuf,
    pub state: PathBuf,
    pub occupancy: PathBuf,
    pub lease: PathBuf,
}

impl Paths {
    pub fn discover() -> Result<Self> {
        if let Some(root) = std::env::var_os("WRKPAD_HOME") {
            return Ok(Self::under(PathBuf::from(root)));
        }
        let project = ProjectDirs::from("dev", "wrkpad", "wrkpad")
            .context("could not determine a per-user wrkpad data directory")?;
        Ok(Self::under(project.data_local_dir().to_path_buf()))
    }

    #[must_use]
    pub fn under(root: PathBuf) -> Self {
        Self {
            token: root.join("auth.token"),
            state: root.join("state.json"),
            occupancy: root.join("occupancy.json"),
            lease: root.join("writer.lease"),
            root,
        }
    }

    pub fn ensure(&self) -> Result<()> {
        fs::create_dir_all(&self.root)
            .with_context(|| format!("failed to create {}", self.root.display()))?;
        #[cfg(unix)]
        set_private_directory(&self.root)?;
        Ok(())
    }

    pub fn ensure_token(&self) -> Result<String> {
        self.ensure()?;
        if self.token.exists() {
            return self.read_token();
        }
        let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
        write_private_new(&self.token, format!("{token}\n").as_bytes())?;
        Ok(token)
    }

    pub fn read_token(&self) -> Result<String> {
        refuse_symlink(&self.token)?;
        let token = fs::read_to_string(&self.token)
            .with_context(|| format!("failed to read {}", self.token.display()))?;
        let token = token.trim().to_owned();
        if token.len() < 32 {
            bail!("wrkpad authentication token is missing or invalid; run `wrkpad init`");
        }
        Ok(token)
    }
}

fn refuse_symlink(path: &Path) -> Result<()> {
    let metadata = fs::symlink_metadata(path)
        .with_context(|| format!("failed to inspect {}", path.display()))?;
    if metadata.file_type().is_symlink() {
        bail!("refusing to follow symlink at {}", path.display());
    }
    Ok(())
}

fn write_private_new(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut options = OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(path)
        .with_context(|| format!("failed to securely create {}", path.display()))?;
    file.write_all(bytes)?;
    file.sync_all()?;
    Ok(())
}

#[cfg(unix)]
fn set_private_directory(path: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;

    fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    Ok(())
}

#[cfg(all(test, unix))]
mod tests {
    use std::os::unix::fs::symlink;

    use tempfile::tempdir;

    use super::Paths;

    #[test]
    fn token_reader_refuses_symlinks() -> anyhow::Result<()> {
        let directory = tempdir()?;
        let target = directory.path().join("target");
        std::fs::write(&target, "sensitive")?;
        let paths = Paths::under(directory.path().join("wrkpad"));
        std::fs::create_dir_all(&paths.root)?;
        symlink(target, &paths.token)?;
        assert!(paths.read_token().is_err());
        Ok(())
    }
}
