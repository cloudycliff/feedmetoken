use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Manager, State};
use walkdir::WalkDir;

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileStamp {
    len: u64,
    modified_ms: u128,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GameState {
    activated_at: DateTime<Utc>,
    session_highwater: HashMap<String, u64>,
    file_stamps: HashMap<String, FileStamp>,
    total_tokens: u64,
    token_remainder: u64,
    energy_bars: u64,
    coins: u64,
    xp: u64,
    level: u64,
    attack_power: u64,
    wave: u64,
    enemy_hp: u64,
    last_refresh: Option<DateTime<Utc>>,
    last_error: Option<String>,
    #[serde(default = "default_true")]
    always_on_top: bool,
    #[serde(default = "default_true")]
    muted: bool,
    #[serde(default)]
    window_position: Option<(i32, i32)>,
}

fn default_true() -> bool { true }

impl Default for GameState {
    fn default() -> Self {
        Self {
            activated_at: Utc::now(),
            session_highwater: HashMap::new(),
            file_stamps: HashMap::new(),
            total_tokens: 0,
            token_remainder: 0,
            energy_bars: 0,
            coins: 0,
            xp: 0,
            level: 1,
            attack_power: 1,
            wave: 1,
            enemy_hp: 3,
            last_refresh: None,
            last_error: None,
            always_on_top: true,
            muted: true,
            window_position: None,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PublicState {
    total_tokens: u64,
    token_remainder: u64,
    energy_bars: u64,
    coins: u64,
    xp: u64,
    level: u64,
    attack_power: u64,
    wave: u64,
    enemy_hp: u64,
    last_refresh: Option<DateTime<Utc>>,
    last_error: Option<String>,
    connected: bool,
    always_on_top: bool,
    muted: bool,
}

struct SharedGame {
    state: Mutex<GameState>,
    save_path: PathBuf,
}

fn codex_root() -> Option<PathBuf> {
    std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|home| home.join(".codex")))
}

fn connected() -> bool {
    codex_root().is_some_and(|root| root.join("sessions").is_dir() || root.join("archived_sessions").is_dir())
}

fn public_state(game: &GameState) -> PublicState {
    PublicState {
        total_tokens: game.total_tokens,
        token_remainder: game.token_remainder,
        energy_bars: game.energy_bars,
        coins: game.coins,
        xp: game.xp,
        level: game.level,
        attack_power: game.attack_power,
        wave: game.wave,
        enemy_hp: game.enemy_hp,
        last_refresh: game.last_refresh,
        last_error: game.last_error.clone(),
        connected: connected(),
        always_on_top: game.always_on_top,
        muted: game.muted,
    }
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, bytes).map_err(|error| error.to_string())?;
    fs::rename(&temporary, path).map_err(|error| error.to_string())
}

fn save_game(path: &Path, game: &GameState) -> Result<(), String> {
    let bytes = serde_json::to_vec(game).map_err(|error| error.to_string())?;
    if path.exists() {
        fs::copy(path, path.with_extension("json.bak")).map_err(|error| error.to_string())?;
    }
    write_atomic(path, &bytes)
}

fn load_game(path: &Path, legacy_path: &Path) -> Result<GameState, String> {
    if path.exists() {
        let bytes = fs::read(path).map_err(|error| error.to_string())?;
        if let Ok(game) = serde_json::from_slice(&bytes) { return Ok(game) }
        let backup = fs::read(path.with_extension("json.bak"))
            .map_err(|error| format!("存档损坏且无法读取备份：{error}"))?;
        let game = serde_json::from_slice(&backup)
            .map_err(|error| format!("存档与备份均损坏：{error}"))?;
        write_atomic(path, &backup)?;
        return Ok(game);
    }
    if legacy_path.exists() {
        let bytes = fs::read(legacy_path).map_err(|error| error.to_string())?;
        let game = serde_json::from_slice(&bytes).map_err(|error| error.to_string())?;
        write_atomic(path, &bytes)?;
        return Ok(game);
    }
    Ok(GameState::default())
}

fn update<F>(shared: &SharedGame, change: F) -> Result<PublicState, String>
where
    F: FnOnce(&mut GameState),
{
    let mut current = shared.state.lock().map_err(|error| error.to_string())?;
    let mut next = current.clone();
    change(&mut next);
    save_game(&shared.save_path, &next)?;
    let snapshot = public_state(&next);
    *current = next;
    Ok(snapshot)
}

fn file_stamp(path: &Path) -> Result<FileStamp, String> {
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    let modified_ms = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |duration| duration.as_millis());
    Ok(FileStamp { len: metadata.len(), modified_ms })
}

fn scan_file(path: &Path, activated_at: DateTime<Utc>) -> Result<(u64, u64, u64), String> {
    let reader = BufReader::new(File::open(path).map_err(|error| error.to_string())?);
    let mut before = 0_u64;
    let mut after = 0_u64;
    let mut overall = 0_u64;
    for line in reader.lines() {
        let line = line.map_err(|error| error.to_string())?;
        let Ok(record) = serde_json::from_str::<serde_json::Value>(&line) else { continue };
        if record.get("type").and_then(|value| value.as_str()) != Some("event_msg")
            || record.pointer("/payload/type").and_then(|value| value.as_str()) != Some("token_count")
        { continue }
        let Some(tokens) = record.pointer("/payload/info/total_token_usage/total_tokens")
            .and_then(|value| value.as_u64()) else { continue };
        let Some(timestamp) = record.get("timestamp")
            .and_then(|value| value.as_str())
            .and_then(|value| DateTime::parse_from_rfc3339(value).ok()) else { continue };
        overall = overall.max(tokens);
        if timestamp.with_timezone(&Utc) < activated_at {
            before = before.max(tokens);
        } else {
            after = after.max(tokens);
        }
    }
    Ok((before, after, overall))
}

fn scan_codex(root: &Path, game: &mut GameState) -> Result<u64, String> {
    let mut new_tokens = 0_u64;
    let mut found = false;
    for folder in ["sessions", "archived_sessions"] {
        let directory = root.join(folder);
        if !directory.is_dir() { continue }
        found = true;
        for entry in WalkDir::new(directory).follow_links(false) {
            let entry = entry.map_err(|error| error.to_string())?;
            let path = entry.path();
            if !entry.file_type().is_file() || path.extension().and_then(|value| value.to_str()) != Some("jsonl") { continue }
            let stamp = file_stamp(path)?;
            let path_key = path.to_string_lossy().to_string();
            if game.file_stamps.get(&path_key).is_some_and(|old| old.len == stamp.len && old.modified_ms == stamp.modified_ms) { continue }
            let session = path.file_stem().and_then(|value| value.to_str()).ok_or("无效的会话文件名")?.to_string();
            let (before, after, overall) = scan_file(path, game.activated_at)?;
            let previous = game.session_highwater.get(&session).copied().unwrap_or(0);
            new_tokens = new_tokens.saturating_add(after.saturating_sub(previous.max(before)));
            game.session_highwater.insert(session, previous.max(overall));
            game.file_stamps.insert(path_key, stamp);
        }
    }
    if !found { return Err("没有发现 Codex 会话记录".to_string()) }
    Ok(new_tokens)
}

#[tauri::command]
fn get_game_state(shared: State<'_, SharedGame>) -> Result<PublicState, String> {
    let current = shared.state.lock().map_err(|error| error.to_string())?;
    Ok(public_state(&current))
}

#[tauri::command]
fn refresh_usage(shared: State<'_, SharedGame>) -> Result<PublicState, String> {
    update(&shared, |next| {
        let mut scanned = next.clone();
        match codex_root().ok_or("无法定位用户目录".to_string()).and_then(|root| scan_codex(&root, &mut scanned)) {
            Ok(tokens) => {
                next.session_highwater = scanned.session_highwater;
                next.file_stamps = scanned.file_stamps;
                next.total_tokens = next.total_tokens.saturating_add(tokens);
                let convertible = next.token_remainder.saturating_add(tokens);
                next.energy_bars = next.energy_bars.saturating_add(convertible / 1000);
                next.token_remainder = convertible % 1000;
                next.last_error = None;
            }
            Err(error) => next.last_error = Some(error),
        }
        next.last_refresh = Some(Utc::now());
    })
}

#[tauri::command]
fn perform_attack(shared: State<'_, SharedGame>) -> Result<PublicState, String> {
    update(&shared, |next| {
        if next.energy_bars == 0 { return }
        next.energy_bars -= 1;
        next.enemy_hp = next.enemy_hp.saturating_sub(next.attack_power);
        if next.enemy_hp == 0 {
            next.coins += 1;
            next.xp += 3;
            while next.xp >= next.level * 10 {
                next.xp -= next.level * 10;
                next.level += 1;
            }
            next.wave += 1;
            next.enemy_hp = 3 + (next.wave - 1) / 10;
        }
    })
}

#[tauri::command]
fn purchase_upgrade(shared: State<'_, SharedGame>) -> Result<PublicState, String> {
    update(&shared, |next| {
        let price = next.attack_power * 5;
        if next.coins >= price {
            next.coins -= price;
            next.attack_power += 1;
        }
    })
}

#[tauri::command]
fn begin_drag(window: tauri::Window) -> Result<(), String> {
    window.start_dragging().map_err(|error| error.to_string())
}

#[tauri::command]
fn toggle_always_on_top(window: tauri::Window, shared: State<'_, SharedGame>) -> Result<PublicState, String> {
    let previous = shared.state.lock().map_err(|error| error.to_string())?.always_on_top;
    window.set_always_on_top(!previous).map_err(|error| error.to_string())?;
    match update(&shared, |next| next.always_on_top = !previous) {
        Ok(state) => Ok(state),
        Err(error) => { let _ = window.set_always_on_top(previous); Err(error) }
    }
}

#[tauri::command]
fn toggle_mute(shared: State<'_, SharedGame>) -> Result<PublicState, String> {
    update(&shared, |next| next.muted = !next.muted)
}

#[tauri::command]
fn save_window_position(window: tauri::Window, shared: State<'_, SharedGame>) -> Result<(), String> {
    let position = window.outer_position().map_err(|error| error.to_string())?;
    update(&shared, |next| next.window_position = Some((position.x, position.y)))?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let save_path = app.path().app_data_dir()?.join("state.json");
            let legacy_path = save_path.parent().and_then(|directory| directory.parent())
                .map(|base| base.join("com.feedmetoken.app").join("state.json"))
                .ok_or("无法定位旧版存档目录")?;
            let state = load_game(&save_path, &legacy_path)?;
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_always_on_top(state.always_on_top);
                if let Some((x, y)) = state.window_position {
                    let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
                }
            }
            app.manage(SharedGame { state: Mutex::new(state), save_path });
            let show = MenuItem::with_id(app, "show", "显示", true, None::<&str>)?;
            let hide = MenuItem::with_id(app, "hide", "隐藏", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &hide, &quit])?;
            let mut tray = TrayIconBuilder::new().menu(&menu).on_menu_event(|app, event| {
                if let Some(window) = app.get_webview_window("main") {
                    match event.id().as_ref() {
                        "show" => { let _ = window.show(); let _ = window.set_focus(); }
                        "hide" => { let _ = window.hide(); }
                        "quit" => app.exit(0),
                        _ => {}
                    }
                }
            });
            if let Some(icon) = app.default_window_icon() { tray = tray.icon(icon.clone()); }
            tray.build(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_game_state, refresh_usage, perform_attack, purchase_upgrade, begin_drag, toggle_always_on_top, toggle_mute, save_window_position])
        .run(tauri::generate_context!())
        .expect("Feed Me Token failed to start");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temporary_path(name: &str) -> PathBuf {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("feed-me-token-{name}-{nonce}.json"))
    }

    #[test]
    fn separates_existing_usage_from_new_usage() {
        let path = temporary_path("usage");
        fs::write(
            &path,
            concat!(
                "{\"timestamp\":\"2026-09-28T10:00:00Z\",\"type\":\"event_msg\",\"payload\":{\"type\":\"token_count\",\"info\":{\"total_token_usage\":{\"total_tokens\":1200}}}}\n",
                "{\"timestamp\":\"2026-09-28T10:10:00Z\",\"type\":\"event_msg\",\"payload\":{\"type\":\"token_count\",\"info\":{\"total_token_usage\":{\"total_tokens\":1700}}}}\n",
                "{\"timestamp\":\"2026-09-28T10:11:00Z\",\"type\":\"response_item\",\"payload\":{\"text\":\"private\"}}\n"
            ),
        )
        .unwrap();
        let activation = DateTime::parse_from_rfc3339("2026-09-28T10:05:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let usage = scan_file(&path, activation).unwrap();
        assert_eq!(usage, (1200, 1700, 1700));
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn save_replaces_previous_state() {
        let path = temporary_path("save");
        let mut game = GameState::default();
        save_game(&path, &game).unwrap();
        game.coins = 4;
        save_game(&path, &game).unwrap();
        let loaded: GameState = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(loaded.coins, 4);
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn codex_baseline_refresh_and_archive_are_idempotent() {
        use std::io::Write;
        let root = temporary_path("codex-root");
        let sessions = root.join("sessions");
        let archived = root.join("archived_sessions");
        fs::create_dir_all(&sessions).unwrap();
        fs::create_dir_all(&archived).unwrap();
        let active = sessions.join("rollout-example.jsonl");
        let old = "{\"timestamp\":\"2026-09-28T10:00:00Z\",\"type\":\"event_msg\",\"payload\":{\"type\":\"token_count\",\"info\":{\"total_token_usage\":{\"total_tokens\":1200}}}}\n";
        let new = "{\"timestamp\":\"2026-09-28T10:10:00Z\",\"type\":\"event_msg\",\"payload\":{\"type\":\"token_count\",\"info\":{\"total_token_usage\":{\"total_tokens\":1700}}}}\n";
        fs::write(&active, old).unwrap();
        let mut game = GameState::default();
        game.activated_at = DateTime::parse_from_rfc3339("2026-09-28T10:05:00Z").unwrap().with_timezone(&Utc);
        assert_eq!(scan_codex(&root, &mut game).unwrap(), 0);
        File::options().append(true).open(&active).unwrap().write_all(new.as_bytes()).unwrap();
        assert_eq!(scan_codex(&root, &mut game).unwrap(), 500);
        assert_eq!(scan_codex(&root, &mut game).unwrap(), 0);
        fs::rename(&active, archived.join("rollout-example.jsonl")).unwrap();
        assert_eq!(scan_codex(&root, &mut game).unwrap(), 0);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn migrates_old_identifier_and_recovers_backup() {
        let root = temporary_path("migration-root");
        let legacy = root.join("com.feedmetoken.app").join("state.json");
        let current = root.join("com.feedmetoken.game").join("state.json");
        let mut game = GameState::default();
        game.coins = 7;
        save_game(&legacy, &game).unwrap();
        assert_eq!(load_game(&current, &legacy).unwrap().coins, 7);
        game.coins = 8;
        save_game(&current, &game).unwrap();
        fs::write(&current, "broken").unwrap();
        assert_eq!(load_game(&current, &legacy).unwrap().coins, 7);
        assert_eq!(load_game(&current, &legacy).unwrap().coins, 7);
        fs::remove_dir_all(root).unwrap();
    }
}
