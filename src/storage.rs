use std::fs::{self, OpenOptions};
use std::io::Write;
use std::marker::PhantomData;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use serde::Serialize;
use serde::de::DeserializeOwned;
use uuid::Uuid;

const MAX_PERSISTED_JSON_BYTES: u64 = 4 * 1024 * 1024;

#[derive(Debug, Clone)]
pub struct JsonStore<T> {
    path: PathBuf,
    marker: PhantomData<T>,
}

impl<T> JsonStore<T>
where
    T: Serialize + DeserializeOwned + Default,
{
    #[must_use]
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            marker: PhantomData,
        }
    }

    pub fn load(&self) -> Result<T> {
        if !self.path.exists() {
            return Ok(T::default());
        }
        refuse_symlink(&self.path)?;
        let length = fs::metadata(&self.path)?.len();
        anyhow::ensure!(
            length <= MAX_PERSISTED_JSON_BYTES,
            "refusing to load oversized JSON state from {}",
            self.path.display()
        );
        let bytes = fs::read(&self.path)
            .with_context(|| format!("failed to read {}", self.path.display()))?;
        serde_json::from_slice(&bytes)
            .with_context(|| format!("failed to parse {}", self.path.display()))
    }

    pub fn save(&self, value: &T) -> Result<()> {
        let parent = self
            .path
            .parent()
            .context("JSON store path has no parent")?;
        fs::create_dir_all(parent)?;
        if self.path.exists() {
            refuse_symlink(&self.path)?;
        }
        let temporary = parent.join(format!(".wrkpad-{}.tmp", Uuid::new_v4()));
        let bytes = serde_json::to_vec_pretty(value)?;
        write_private(&temporary, &bytes)?;
        fs::rename(&temporary, &self.path).with_context(|| {
            format!(
                "failed to atomically replace {} with {}",
                self.path.display(),
                temporary.display()
            )
        })?;
        #[cfg(unix)]
        sync_directory(parent)?;
        Ok(())
    }

    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }
}

fn refuse_symlink(path: &Path) -> Result<()> {
    let metadata = fs::symlink_metadata(path)
        .with_context(|| format!("failed to inspect {}", path.display()))?;
    anyhow::ensure!(
        !metadata.file_type().is_symlink(),
        "refusing to follow symlink at {}",
        path.display()
    );
    Ok(())
}

#[cfg(unix)]
fn sync_directory(path: &Path) -> Result<()> {
    fs::File::open(path)?.sync_all()?;
    Ok(())
}

fn write_private(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut options = OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    file.write_all(bytes)?;
    file.write_all(b"\n")?;
    file.sync_all()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use serde::{Deserialize, Serialize};
    use tempfile::tempdir;

    use super::JsonStore;

    #[derive(Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
    struct Example {
        value: u8,
    }

    #[test]
    fn atomically_round_trips_json() -> anyhow::Result<()> {
        let directory = tempdir()?;
        let store = JsonStore::new(directory.path().join("state.json"));
        store.save(&Example { value: 7 })?;
        assert_eq!(store.load()?, Example { value: 7 });
        Ok(())
    }

    #[cfg(unix)]
    #[test]
    fn refuses_symlinked_state_files() -> anyhow::Result<()> {
        use std::os::unix::fs::symlink;

        let directory = tempdir()?;
        let target = directory.path().join("target.json");
        std::fs::write(&target, r#"{"value":7}"#)?;
        let path = directory.path().join("state.json");
        symlink(target, &path)?;
        let store = JsonStore::<Example>::new(path);
        assert!(store.load().is_err());
        assert!(store.save(&Example { value: 9 }).is_err());
        Ok(())
    }

    #[test]
    fn refuses_oversized_state_files() -> anyhow::Result<()> {
        let directory = tempdir()?;
        let path = directory.path().join("state.json");
        let file = std::fs::File::create(&path)?;
        file.set_len(super::MAX_PERSISTED_JSON_BYTES + 1)?;
        drop(file);
        let store = JsonStore::<Example>::new(path);
        assert!(store.load().is_err());
        Ok(())
    }
}
