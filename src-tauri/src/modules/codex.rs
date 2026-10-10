use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::ffi::OsString;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::ipc::Channel;

use crate::modules::workspace::WorkspaceRegistry;

const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const MIN_CODEX_VERSION: (u32, u32, u32) = (0, 139, 0);
const ALLOWED_METHODS: &[&str] = &[
    "account/read",
    "account/login/start",
    "account/login/cancel",
    "account/logout",
    "account/rateLimits/read",
    "model/list",
    "collaborationMode/list",
    "thread/start",
    "thread/resume",
    "thread/archive",
    "turn/start",
    "turn/interrupt",
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexStatus {
    installed: bool,
    compatible: bool,
    running: bool,
    version: Option<String>,
    error: Option<String>,
}

struct CodexProcess {
    child: Child,
    stdin: ChildStdin,
    generation: u64,
}

struct CodexCore {
    process: Mutex<Option<CodexProcess>>,
    start_lock: Mutex<()>,
    pending: Mutex<HashMap<u64, mpsc::Sender<Result<Value, String>>>>,
    subscribers: Mutex<Vec<Arc<Channel<Value>>>>,
    next_id: AtomicU64,
    generation: AtomicU64,
}

impl Default for CodexCore {
    fn default() -> Self {
        Self {
            process: Mutex::new(None),
            start_lock: Mutex::new(()),
            pending: Mutex::new(HashMap::new()),
            subscribers: Mutex::new(Vec::new()),
            next_id: AtomicU64::new(1),
            generation: AtomicU64::new(1),
        }
    }
}

#[derive(Default)]
pub struct CodexState {
    core: Arc<CodexCore>,
}

impl CodexState {
    fn is_running(&self) -> bool {
        let mut process = self
            .core
            .process
            .lock()
            .expect("codex process mutex poisoned");
        let Some(active) = process.as_mut() else {
            return false;
        };
        match active.child.try_wait() {
            Ok(None) => true,
            Ok(Some(_)) | Err(_) => {
                process.take();
                false
            }
        }
    }

    fn ensure_started(&self) -> Result<(), String> {
        if self.is_running() {
            return Ok(());
        }
        let version = read_codex_version()?;
        if !version_is_compatible(&version) {
            return Err(format!(
                "Codex CLI {version} is too old. Terax requires codex-cli 0.139.0 or newer."
            ));
        }
        let _start = self
            .core
            .start_lock
            .lock()
            .map_err(|_| "codex start mutex poisoned".to_string())?;
        if self.is_running() {
            return Ok(());
        }

        let mut child = codex_command()
            .args(["app-server", "--listen", "stdio://"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| {
                format!(
                    "Could not start Codex CLI. Install or update `codex`, then restart Terax: {e}"
                )
            })?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Codex app-server did not expose stdin".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Codex app-server did not expose stdout".to_string())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "Codex app-server did not expose stderr".to_string())?;
        let generation = self.core.generation.fetch_add(1, Ordering::Relaxed);
        *self
            .core
            .process
            .lock()
            .map_err(|_| "codex process mutex poisoned".to_string())? = Some(CodexProcess {
            child,
            stdin,
            generation,
        });

        spawn_stdout_reader(Arc::clone(&self.core), stdout, generation);
        thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                log::warn!(target: "codex-app-server", "{line}");
            }
        });

        let init = self.request_unchecked(
            "initialize",
            json!({
                "clientInfo": {
                    "name": "terax",
                    "title": "Terax",
                    "version": env!("CARGO_PKG_VERSION")
                },
                "capabilities": {
                    "experimentalApi": true
                }
            }),
        );
        if let Err(error) = init {
            self.stop();
            return Err(format!("Codex app-server initialization failed: {error}"));
        }
        self.notify_unchecked("initialized", None)?;
        Ok(())
    }

    fn request(&self, method: &str, params: Value) -> Result<Value, String> {
        if !ALLOWED_METHODS.contains(&method) {
            return Err(format!("Codex method is not allowed: {method}"));
        }
        self.ensure_started()?;
        self.request_unchecked(method, params)
    }

    fn request_unchecked(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.core.next_id.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = mpsc::channel();
        self.core
            .pending
            .lock()
            .map_err(|_| "codex pending mutex poisoned".to_string())?
            .insert(id, tx);
        let message = json!({ "id": id, "method": method, "params": params });
        if let Err(error) = self.write_message(&message) {
            self.core
                .pending
                .lock()
                .map_err(|_| "codex pending mutex poisoned".to_string())?
                .remove(&id);
            return Err(error);
        }
        match rx.recv_timeout(REQUEST_TIMEOUT) {
            Ok(result) => result,
            Err(_) => {
                self.core
                    .pending
                    .lock()
                    .map_err(|_| "codex pending mutex poisoned".to_string())?
                    .remove(&id);
                Err(format!("Codex request timed out: {method}"))
            }
        }
    }

    fn respond(&self, id: Value, result: Value) -> Result<(), String> {
        self.ensure_started()?;
        if !id.is_string() && !id.is_number() {
            return Err("Invalid Codex request id".into());
        }
        self.write_message(&json!({ "id": id, "result": result }))
    }

    fn notify_unchecked(&self, method: &str, params: Option<Value>) -> Result<(), String> {
        let message = match params {
            Some(params) => json!({ "method": method, "params": params }),
            None => json!({ "method": method }),
        };
        self.write_message(&message)
    }

    fn write_message(&self, message: &Value) -> Result<(), String> {
        let mut process = self
            .core
            .process
            .lock()
            .map_err(|_| "codex process mutex poisoned".to_string())?;
        let active = process
            .as_mut()
            .ok_or_else(|| "Codex app-server is not running".to_string())?;
        serde_json::to_writer(&mut active.stdin, message).map_err(|e| e.to_string())?;
        active.stdin.write_all(b"\n").map_err(|e| e.to_string())?;
        active.stdin.flush().map_err(|e| e.to_string())
    }

    fn subscribe(&self, channel: Channel<Value>) -> Result<(), String> {
        self.ensure_started()?;
        self.core
            .subscribers
            .lock()
            .map_err(|_| "codex subscribers mutex poisoned".to_string())?
            .push(Arc::new(channel));
        Ok(())
    }

    fn stop(&self) {
        if let Ok(mut process) = self.core.process.lock() {
            if let Some(mut active) = process.take() {
                let _ = active.child.kill();
                let _ = active.child.wait();
            }
        }
        fail_pending(&self.core, "Codex app-server stopped");
    }
}

impl Drop for CodexState {
    fn drop(&mut self) {
        self.stop();
    }
}

fn spawn_stdout_reader(core: Arc<CodexCore>, stdout: std::process::ChildStdout, generation: u64) {
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            let line = match line {
                Ok(line) => line,
                Err(error) => {
                    broadcast(
                        &core,
                        json!({
                            "method": "terax/codex/error",
                            "params": { "message": error.to_string() }
                        }),
                    );
                    break;
                }
            };
            let message: Value = match serde_json::from_str(&line) {
                Ok(value) => value,
                Err(error) => {
                    log::warn!(target: "codex-app-server", "invalid JSONL: {error}");
                    continue;
                }
            };
            let response_id = message.get("id").and_then(Value::as_u64);
            let is_response = response_id.is_some()
                && (message.get("result").is_some() || message.get("error").is_some());
            if is_response {
                let id = response_id.expect("checked above");
                let sender = core.pending.lock().ok().and_then(|mut p| p.remove(&id));
                if let Some(sender) = sender {
                    let result = if let Some(error) = message.get("error") {
                        Err(format_rpc_error(error))
                    } else {
                        Ok(message.get("result").cloned().unwrap_or(Value::Null))
                    };
                    let _ = sender.send(result);
                }
                continue;
            }
            broadcast(&core, message);
        }

        if let Ok(mut process) = core.process.lock() {
            if process
                .as_ref()
                .is_some_and(|active| active.generation == generation)
            {
                process.take();
            }
        }
        fail_pending(&core, "Codex app-server exited");
        broadcast(
            &core,
            json!({
                "method": "terax/codex/processExited",
                "params": {}
            }),
        );
    });
}

fn format_rpc_error(error: &Value) -> String {
    let code = error.get("code").and_then(Value::as_i64);
    let message = error
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or("Unknown Codex error");
    match code {
        Some(code) => format!("{message} ({code})"),
        None => message.to_string(),
    }
}

fn fail_pending(core: &CodexCore, message: &str) {
    let pending = match core.pending.lock() {
        Ok(mut pending) => pending
            .drain()
            .map(|(_, sender)| sender)
            .collect::<Vec<_>>(),
        Err(_) => return,
    };
    for sender in pending {
        let _ = sender.send(Err(message.to_string()));
    }
}

fn broadcast(core: &CodexCore, message: Value) {
    let mut subscribers = match core.subscribers.lock() {
        Ok(subscribers) => subscribers,
        Err(_) => return,
    };
    subscribers.retain(|channel| channel.send(message.clone()).is_ok());
}

fn read_codex_version() -> Result<String, String> {
    let output = codex_command()
        .arg("--version")
        .output()
        .map_err(|e| format!("Codex CLI is not installed or is not available on PATH: {e}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok(raw
        .split_whitespace()
        .find(|part| part.chars().next().is_some_and(|c| c.is_ascii_digit()))
        .unwrap_or(&raw)
        .to_string())
}

fn codex_command() -> Command {
    let binary = resolve_codex_binary();
    let mut command = Command::new(&binary);
    if let Some(path) = codex_search_path(&binary) {
        command.env("PATH", path);
    }
    command
}

fn codex_search_path(binary: &Path) -> Option<OsString> {
    let mut directories = Vec::new();
    if let Some(parent) = binary
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        directories.push(parent.to_path_buf());
    }
    #[cfg(target_os = "macos")]
    {
        directories.push(PathBuf::from("/opt/homebrew/bin"));
        directories.push(PathBuf::from("/usr/local/bin"));
    }
    if let Some(home) = dirs::home_dir() {
        directories.push(home.join(".local/bin"));
        directories.push(home.join(".npm-global/bin"));
    }
    if let Some(path) = std::env::var_os("PATH") {
        directories.extend(std::env::split_paths(&path));
    }
    directories.dedup();
    std::env::join_paths(directories).ok()
}

fn resolve_codex_binary() -> PathBuf {
    if let Some(path) = std::env::var_os("TERAX_CODEX_PATH") {
        let path = PathBuf::from(path);
        if path.is_file() {
            return path;
        }
    }
    let mut candidates = Vec::new();
    #[cfg(target_os = "macos")]
    {
        candidates.push(PathBuf::from("/opt/homebrew/bin/codex"));
        candidates.push(PathBuf::from("/usr/local/bin/codex"));
    }
    if let Some(home) = dirs::home_dir() {
        candidates.push(home.join(".local/bin/codex"));
        candidates.push(home.join(".npm-global/bin/codex"));
        #[cfg(target_os = "windows")]
        {
            candidates.push(home.join("AppData/Roaming/npm/codex.cmd"));
            candidates.push(home.join("AppData/Roaming/npm/codex.exe"));
        }
    }
    candidates
        .into_iter()
        .find(|path| path.is_file())
        .unwrap_or_else(|| PathBuf::from("codex"))
}

fn version_is_compatible(version: &str) -> bool {
    let mut parts = version.split('.').take(3).map(|part| {
        part.chars()
            .take_while(|c| c.is_ascii_digit())
            .collect::<String>()
            .parse::<u32>()
            .unwrap_or(0)
    });
    let parsed = (
        parts.next().unwrap_or(0),
        parts.next().unwrap_or(0),
        parts.next().unwrap_or(0),
    );
    parsed >= MIN_CODEX_VERSION
}

fn secure_request_params(
    method: &str,
    params: Value,
    registry: &WorkspaceRegistry,
) -> Result<Value, String> {
    let mut params = params
        .as_object()
        .cloned()
        .ok_or_else(|| "Codex request params must be an object".to_string())?;
    if matches!(method, "thread/start" | "thread/resume" | "turn/start") {
        let allowed: &[&str] = match method {
            "thread/start" => &[
                "cwd",
                "model",
                "approvalPolicy",
                "sandbox",
                "runtimeWorkspaceRoots",
                "developerInstructions",
                "ephemeral",
                "serviceName",
            ],
            "thread/resume" => &[
                "threadId",
                "cwd",
                "model",
                "approvalPolicy",
                "sandbox",
                "runtimeWorkspaceRoots",
                "developerInstructions",
            ],
            "turn/start" => &[
                "threadId",
                "input",
                "cwd",
                "approvalPolicy",
                "model",
                "effort",
                "collaborationMode",
            ],
            _ => &[],
        };
        if let Some(key) = params.keys().find(|key| !allowed.contains(&key.as_str())) {
            return Err(format!("Codex parameter is not allowed: {key}"));
        }
        if let Some(cwd) = params.get("cwd").and_then(Value::as_str) {
            let canonical = authorize_codex_path(cwd, registry)?;
            params.insert("cwd".into(), Value::String(canonical));
        }
        if let Some(roots) = params.get("runtimeWorkspaceRoots") {
            let roots = roots
                .as_array()
                .ok_or_else(|| "runtimeWorkspaceRoots must be an array".to_string())?;
            let canonical = roots
                .iter()
                .map(|root| {
                    root.as_str()
                        .ok_or_else(|| "runtimeWorkspaceRoots entries must be strings".to_string())
                        .and_then(|root| authorize_codex_path(root, registry))
                        .map(Value::String)
                })
                .collect::<Result<Vec<_>, _>>()?;
            params.insert("runtimeWorkspaceRoots".into(), Value::Array(canonical));
        }
        params.insert("approvalPolicy".into(), Value::String("on-request".into()));
        if matches!(method, "thread/start" | "thread/resume") {
            params.insert("sandbox".into(), Value::String("workspace-write".into()));
        }
    }
    Ok(Value::Object(params))
}

fn authorize_codex_path(path: &str, registry: &WorkspaceRegistry) -> Result<String, String> {
    let canonical = registry
        .canonicalize_cached(path)
        .map_err(|error| format!("Codex path is not accessible: {error}"))?;
    if !registry.is_authorized(&canonical) {
        return Err(format!(
            "Codex path is outside the authorized workspace: {}",
            canonical.display()
        ));
    }
    Ok(crate::modules::fs::to_canon(&canonical))
}

fn validate_approval_result(result: &Value) -> Result<(), String> {
    let decision = result
        .get("decision")
        .and_then(Value::as_str)
        .ok_or_else(|| "Codex approval response requires a decision".to_string())?;
    if matches!(decision, "accept" | "decline") {
        Ok(())
    } else {
        Err(format!(
            "Codex approval decision is not allowed: {decision}"
        ))
    }
}

#[tauri::command]
pub fn codex_status(state: tauri::State<CodexState>) -> CodexStatus {
    let running = state.is_running();
    match read_codex_version() {
        Ok(version) => CodexStatus {
            installed: true,
            compatible: version_is_compatible(&version),
            running,
            version: Some(version),
            error: None,
        },
        Err(error) => CodexStatus {
            installed: false,
            compatible: false,
            running: false,
            version: None,
            error: Some(error),
        },
    }
}

#[tauri::command]
pub fn codex_subscribe(
    state: tauri::State<CodexState>,
    on_event: Channel<Value>,
) -> Result<(), String> {
    state.subscribe(on_event)
}

#[tauri::command]
pub fn codex_request(
    state: tauri::State<CodexState>,
    registry: tauri::State<WorkspaceRegistry>,
    method: String,
    params: Option<Value>,
) -> Result<Value, String> {
    if !ALLOWED_METHODS.contains(&method.as_str()) {
        return Err(format!("Codex method is not allowed: {method}"));
    }
    let params = secure_request_params(&method, params.unwrap_or_else(|| json!({})), &registry)?;
    state.request(&method, params)
}

#[tauri::command]
pub fn codex_respond(
    state: tauri::State<CodexState>,
    id: Value,
    result: Value,
) -> Result<(), String> {
    validate_approval_result(&result)?;
    state.respond(id, result)
}

#[tauri::command]
pub fn codex_stop(state: tauri::State<CodexState>) {
    state.stop();
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn formats_rpc_error_with_code() {
        assert_eq!(
            format_rpc_error(&json!({ "code": -32601, "message": "missing" })),
            "missing (-32601)"
        );
    }

    #[test]
    fn rejects_unlisted_method() {
        let state = CodexState::default();
        let error = state.request("config/write", json!({})).unwrap_err();
        assert!(error.contains("not allowed"));
    }

    #[test]
    fn checks_minimum_cli_version() {
        assert!(version_is_compatible("0.139.0"));
        assert!(version_is_compatible("1.0.0"));
        assert!(!version_is_compatible("0.138.9"));
    }

    #[test]
    fn adds_codex_binary_directory_to_child_path() {
        let binary = Path::new("/custom/codex/bin/codex");
        let path = codex_search_path(binary).unwrap();
        assert_eq!(
            std::env::split_paths(&path).next(),
            Some(PathBuf::from("/custom/codex/bin"))
        );
    }

    #[test]
    fn secures_thread_params_to_authorized_workspace() {
        let dir = tempdir().unwrap();
        let registry = WorkspaceRegistry::default();
        registry.authorize(dir.path()).unwrap();
        let params = secure_request_params(
            "thread/start",
            json!({
                "cwd": dir.path(),
                "runtimeWorkspaceRoots": [dir.path()],
                "sandbox": "danger-full-access",
                "approvalPolicy": "never"
            }),
            &registry,
        )
        .unwrap();
        assert_eq!(params["sandbox"], "workspace-write");
        assert_eq!(params["approvalPolicy"], "on-request");
    }

    #[test]
    fn rejects_unapproved_codex_path() {
        let allowed = tempdir().unwrap();
        let denied = tempdir().unwrap();
        let registry = WorkspaceRegistry::default();
        registry.authorize(allowed.path()).unwrap();
        let error = secure_request_params("turn/start", json!({ "cwd": denied.path() }), &registry)
            .unwrap_err();
        assert!(error.contains("outside the authorized workspace"));
    }

    #[test]
    fn rejects_unknown_turn_capability() {
        let registry = WorkspaceRegistry::default();
        let error = secure_request_params(
            "turn/start",
            json!({ "permissions": "danger-full-access" }),
            &registry,
        )
        .unwrap_err();
        assert!(error.contains("parameter is not allowed"));
    }

    #[test]
    fn rejects_persistent_approval_decision() {
        let error = validate_approval_result(&json!({
            "decision": "acceptForSession"
        }))
        .unwrap_err();
        assert!(error.contains("not allowed"));
    }
}
