use std::{env, fs};

use zed_extension_api::{self as zed, LanguageServerId, LanguageServerInstallationStatus, Result};

const REPO: &str = "elsamrafisptr/smarty-zed-support";
const ASSET: &str = "smarty-language-server.js";
/// The server is released under the same tag as the extension (`v<version>`),
/// so an extension version always runs the server it was tested with.
const VERSION: &str = env!("CARGO_PKG_VERSION");

struct SmartyExtension;

/// Downloads the server for this extension version into the work directory
/// once, then reuses it (also offline).
fn server_script(id: &LanguageServerId) -> Result<String> {
    let dir = format!("smarty-language-server-{VERSION}");
    let path = format!("{dir}/{ASSET}");
    if fs::metadata(&path).is_ok_and(|m| m.is_file()) {
        return Ok(path);
    }

    zed::set_language_server_installation_status(id, &LanguageServerInstallationStatus::Downloading);
    let result = (|| {
        let release = zed::github_release_by_tag_name(REPO, &format!("v{VERSION}"))?;
        let asset = release
            .assets
            .iter()
            .find(|a| a.name == ASSET)
            .ok_or_else(|| format!("release v{VERSION} has no asset {ASSET}"))?;
        fs::create_dir_all(&dir).map_err(|e| format!("failed to create {dir}: {e}"))?;
        zed::download_file(&asset.download_url, &path, zed::DownloadedFileType::Uncompressed)
            .map_err(|e| format!("failed to download {ASSET}: {e}"))
    })();
    if let Err(e) = result {
        zed::set_language_server_installation_status(id, &LanguageServerInstallationStatus::Failed(e.clone()));
        return Err(e);
    }

    // Remove servers downloaded for older extension versions.
    for entry in fs::read_dir(".").into_iter().flatten().flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with("smarty-language-server") && name != dir {
            let _ = fs::remove_dir_all(entry.path()).or_else(|_| fs::remove_file(entry.path()));
        }
    }
    zed::set_language_server_installation_status(id, &LanguageServerInstallationStatus::None);
    Ok(path)
}

impl zed::Extension for SmartyExtension {
    fn new() -> Self {
        SmartyExtension
    }

    fn language_server_command(
        &mut self,
        language_server_id: &LanguageServerId,
        _worktree: &zed::Worktree,
    ) -> Result<zed::Command> {
        let script = env::current_dir()
            .map_err(|e| e.to_string())?
            .join(server_script(language_server_id)?);
        Ok(zed::Command {
            command: zed::node_binary_path()?,
            args: vec![script.to_string_lossy().into_owned()],
            env: Default::default(),
        })
    }
}

zed::register_extension!(SmartyExtension);
