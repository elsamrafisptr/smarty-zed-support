use std::{env, fs};

use zed_extension_api as zed;

/// The bundled language server, embedded at build time. At runtime an extension
/// can only touch its own work directory, not the files it was installed from,
/// so the script is written there before launch.
const SERVER_JS: &str = include_str!("../language-server/dist/smarty-language-server.js");
const SERVER_FILE: &str = "smarty-language-server.js";

struct SmartyExtension;

impl zed::Extension for SmartyExtension {
    fn new() -> Self {
        SmartyExtension
    }

    fn language_server_command(
        &mut self,
        _language_server_id: &zed::LanguageServerId,
        _worktree: &zed::Worktree,
    ) -> zed::Result<zed::Command> {
        // Rewrite only when the embedded copy differs (first run or extension update).
        if fs::read_to_string(SERVER_FILE).ok().as_deref() != Some(SERVER_JS) {
            fs::write(SERVER_FILE, SERVER_JS)
                .map_err(|e| format!("failed to write {SERVER_FILE}: {e}"))?;
        }
        let script = env::current_dir().map_err(|e| e.to_string())?.join(SERVER_FILE);
        Ok(zed::Command {
            command: zed::node_binary_path()?,
            args: vec![script.to_string_lossy().into_owned()],
            env: Default::default(),
        })
    }
}

zed::register_extension!(SmartyExtension);
