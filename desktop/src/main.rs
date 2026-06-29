// MDesign desktop — a self-contained native Mac app.
//
// It embeds the built web frontend (../dist) and runs a tiny local HTTP server
// that reproduces what the Vite dev server did:
//   * /api/*  -> SQLite persistence (rusqlite), same schema as server/apiPlugin.ts
//   * /llm/*  -> reverse proxy to Anthropic / OpenAI / Volcengine Ark
//   * everything else -> the embedded SPA
// A native window (tao + wry / WKWebView) points at http://127.0.0.1:<port>/.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use rusqlite::{params, Connection};
use rust_embed::RustEmbed;
use serde_json::{json, Value};
use tiny_http::{Header, Response, Server, StatusCode};

#[derive(RustEmbed)]
#[folder = "../dist"]
struct Dist;

fn support_dir() -> std::path::PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    let dir = std::path::Path::new(&home).join("Library/Application Support/MDesign");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

fn db_path() -> std::path::PathBuf {
    support_dir().join("app.db")
}

fn open_db() -> Connection {
    let conn = Connection::open(db_path()).expect("open db");
    let _ = conn.pragma_update(None, "journal_mode", "WAL");
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER);
         CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);",
    )
    .expect("init schema");
    conn
}

fn json_header() -> Header {
    Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap()
}

fn content_type(path: &str) -> &'static str {
    match path.rsplit('.').next().unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "svg" => "image/svg+xml",
        "json" => "application/json",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "ttf" => "font/ttf",
        "map" => "application/json",
        _ => "application/octet-stream",
    }
}

// ---- /api state assembly (matches server/apiPlugin.ts) ----
fn get_state(conn: &Connection) -> String {
    let mut projects: Vec<Value> = Vec::new();
    if let Ok(mut stmt) = conn.prepare("SELECT data FROM projects ORDER BY updated_at DESC") {
        if let Ok(rows) = stmt.query_map([], |r| r.get::<_, String>(0)) {
            for s in rows.flatten() {
                if let Ok(v) = serde_json::from_str::<Value>(&s) {
                    projects.push(v);
                }
            }
        }
    }
    let mut settings = Value::Null;
    let mut user = Value::Null;
    let mut tutorial = Value::Bool(false);
    let mut design_system = Value::Null;
    if let Ok(mut stmt) = conn.prepare("SELECT key, value FROM meta") {
        if let Ok(rows) = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))) {
            for (k, v) in rows.flatten() {
                let val = serde_json::from_str::<Value>(&v).unwrap_or(Value::Null);
                match k.as_str() {
                    "settings" => settings = val,
                    "user" => user = val,
                    "tutorialDismissed" => tutorial = val,
                    "designSystem" => design_system = val,
                    _ => {}
                }
            }
        }
    }
    json!({ "projects": projects, "settings": settings, "user": user, "tutorialDismissed": tutorial, "designSystem": design_system })
        .to_string()
}

fn put_project(conn: &Connection, id: &str, body: &[u8]) {
    let project: Value = serde_json::from_slice(body).unwrap_or(Value::Null);
    let updated_at = project.get("updatedAt").and_then(|v| v.as_i64()).unwrap_or(0);
    let data = serde_json::to_string(&project).unwrap_or_else(|_| "null".into());
    let _ = conn.execute(
        "INSERT INTO projects (id, data, updated_at) VALUES (?1, ?2, ?3) \
         ON CONFLICT(id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at",
        params![id, data, updated_at],
    );
}

fn put_meta(conn: &Connection, body: &[u8]) {
    let patch: Value = serde_json::from_slice(body).unwrap_or(Value::Null);
    if let Some(obj) = patch.as_object() {
        for k in ["settings", "user", "tutorialDismissed", "designSystem"] {
            if let Some(v) = obj.get(k) {
                let _ = conn.execute(
                    "INSERT INTO meta (key, value) VALUES (?1, ?2) \
                     ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                    params![k, serde_json::to_string(v).unwrap_or_else(|_| "null".into())],
                );
            }
        }
    }
}

fn hex_nibble(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(a), Some(b)) = (hex_nibble(bytes[i + 1]), hex_nibble(bytes[i + 2])) {
                out.push(a * 16 + b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

// Write a downloaded blob to ~/Downloads (de-duplicating the name) and reveal it
// in Finder. Returns the saved absolute path.
fn save_download(name_encoded: &str, bytes: &[u8]) -> Option<String> {
    let decoded = percent_decode(name_encoded);
    let base = decoded.rsplit(|c| c == '/' || c == '\\').next().unwrap_or("").trim();
    let mut filename: String = base.chars().filter(|c| !c.is_control() && *c != ':').collect();
    if filename.is_empty() {
        filename = "download".into();
    }

    let home = std::env::var("HOME").ok()?;
    let dir = std::path::Path::new(&home).join("Downloads");
    std::fs::create_dir_all(&dir).ok()?;

    let mut target = dir.join(&filename);
    if target.exists() {
        let p = std::path::Path::new(&filename);
        let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or(&filename);
        let ext = p.extension().and_then(|s| s.to_str());
        for n in 1..=9999 {
            let candidate = match ext {
                Some(e) => format!("{stem} ({n}).{e}"),
                None => format!("{stem} ({n})"),
            };
            let p = dir.join(&candidate);
            if !p.exists() {
                target = p;
                break;
            }
        }
    }

    std::fs::write(&target, bytes).ok()?;
    let _ = std::process::Command::new("open").arg("-R").arg(&target).spawn();
    Some(target.to_string_lossy().into_owned())
}

fn ext_for_ct(ct: &str) -> &'static str {
    match ct.split(';').next().unwrap_or("").trim() {
        "text/html" => "html",
        "text/css" => "css",
        "text/javascript" | "application/javascript" => "js",
        "application/json" => "json",
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/svg+xml" => "svg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "application/pdf" => "pdf",
        "text/plain" => "txt",
        _ => "html",
    }
}

static PREVIEW_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

// Emulate window.open() for the webview: write the previewed content to a temp file
// and open it with the default app (a .html opens in the default browser).
fn open_preview(content_type: &str, bytes: &[u8]) -> Option<String> {
    let dir = support_dir().join("preview");
    std::fs::create_dir_all(&dir).ok()?;
    let n = PREVIEW_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let path = dir.join(format!("preview-{n}.{}", ext_for_ct(content_type)));
    std::fs::write(&path, bytes).ok()?;
    let _ = std::process::Command::new("open").arg(&path).spawn();
    Some(path.to_string_lossy().into_owned())
}

fn clear_preview_dir() {
    let _ = std::fs::remove_dir_all(support_dir().join("preview"));
}

// Native PDF text extraction via the system PDFKit (the same parser Preview.app
// uses) — immune to webview JS-engine quirks, Apple-grade CJK support.
fn extract_pdf(bytes: &[u8]) -> Result<(String, usize), &'static str> {
    use objc2::AllocAnyThread;
    use objc2_foundation::NSData;
    use objc2_pdf_kit::PDFDocument;
    objc2::rc::autoreleasepool(|_| {
        let data = NSData::with_bytes(bytes);
        let doc =
            unsafe { PDFDocument::initWithData(PDFDocument::alloc(), &data) }.ok_or("not_pdf")?;
        if unsafe { doc.isLocked() } {
            return Err("encrypted");
        }
        let n = unsafe { doc.pageCount() } as usize;
        let mut out = String::new();
        for i in 0..n {
            if let Some(page) = unsafe { doc.pageAtIndex(i) } {
                if let Some(s) = unsafe { page.string() } {
                    let t = s.to_string();
                    let t = t.trim();
                    if !t.is_empty() {
                        out.push_str(&format!("— 第 {} 页 —\n{}\n\n", i + 1, t));
                    }
                }
            }
        }
        Ok((out, n))
    })
}

fn forward_header(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "content-type"
            | "authorization"
            | "x-api-key"
            | "anthropic-version"
            | "anthropic-beta"
            | "anthropic-dangerous-direct-browser-access"
            | "accept"
    )
}

fn llm_target(url: &str) -> Option<String> {
    let (host, rest) = if let Some(r) = url.strip_prefix("/llm/anthropic") {
        ("https://api.anthropic.com", r)
    } else if let Some(r) = url.strip_prefix("/llm/openai") {
        ("https://api.openai.com", r)
    } else if let Some(r) = url.strip_prefix("/llm/ark") {
        ("https://ark.cn-beijing.volces.com", r)
    } else {
        return None;
    };
    Some(format!("{host}{rest}"))
}

// Build an HTTP client that honors a system/env proxy if one is configured
// (HTTPS_PROXY / HTTP_PROXY / ALL_PROXY). With none set it connects directly.
fn build_agent() -> ureq::Agent {
    let proxy = [
        "HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy",
    ]
    .iter()
    .find_map(|k| std::env::var(k).ok())
    .filter(|v| !v.is_empty())
    .and_then(|u| ureq::Proxy::new(&u).ok());
    match proxy {
        Some(p) => ureq::AgentBuilder::new().proxy(p).build(),
        None => ureq::AgentBuilder::new().build(),
    }
}

fn serve(server: std::sync::Arc<Server>) {
    let conn = open_db();
    let _ = conn.busy_timeout(std::time::Duration::from_secs(10));
    let agent = build_agent();
    let log = std::env::var("MDESIGN_LOG").is_ok();
    loop {
        let mut request = match server.recv() {
            Ok(r) => r,
            Err(_) => break,
        };
        let method = request.method().as_str().to_uppercase();
        let url = request.url().to_string();
        let path = url.split('?').next().unwrap_or("/").to_string();
        if log {
            eprintln!("[mdesign] {method} {path}");
        }
        let headers: Vec<(String, String)> = request
            .headers()
            .iter()
            .map(|h| (h.field.as_str().as_str().to_owned(), h.value.as_str().to_owned()))
            .collect();
        let mut body = Vec::new();
        let _ = request.as_reader().read_to_end(&mut body);

        // ---- /api ----
        if path == "/api/state" && method == "GET" {
            let r = Response::from_string(get_state(&conn)).with_header(json_header());
            let _ = request.respond(r);
            continue;
        }
        if let Some(id) = path.strip_prefix("/api/projects/") {
            let id = id.to_string();
            if method == "PUT" {
                put_project(&conn, &id, &body);
            } else if method == "DELETE" {
                let _ = conn.execute("DELETE FROM projects WHERE id=?1", params![id]);
            }
            let r = Response::from_string("{\"ok\":true}").with_header(json_header());
            let _ = request.respond(r);
            continue;
        }
        if path == "/api/meta" && method == "PUT" {
            put_meta(&conn, &body);
            let r = Response::from_string("{\"ok\":true}").with_header(json_header());
            let _ = request.respond(r);
            continue;
        }

        // ---- download: save bytes to ~/Downloads and reveal in Finder ----
        if path == "/__save" && method == "POST" {
            let name = headers
                .iter()
                .find(|(k, _)| k.eq_ignore_ascii_case("x-mdesign-filename"))
                .map(|(_, v)| v.clone())
                .unwrap_or_default();
            let r = match save_download(&name, &body) {
                Some(p) => Response::from_string(format!(
                    "{{\"path\":{}}}",
                    serde_json::to_string(&p).unwrap_or_else(|_| "\"\"".into())
                ))
                .with_header(json_header()),
                None => Response::from_string("{\"error\":\"save failed\"}")
                    .with_status_code(StatusCode(500))
                    .with_header(json_header()),
            };
            let _ = request.respond(r);
            continue;
        }

        // ---- native PDF text extraction (PDFKit) ----
        if path == "/__pdf" && method == "POST" {
            let r = match extract_pdf(&body) {
                Ok((text, pages)) => Response::from_string(
                    serde_json::json!({ "text": text, "pages": pages }).to_string(),
                )
                .with_header(json_header()),
                Err(kind) => Response::from_string(format!("{{\"error\":\"{kind}\"}}"))
                    .with_status_code(StatusCode(422))
                    .with_header(json_header()),
            };
            let _ = request.respond(r);
            continue;
        }

        // ---- window.open emulation: preview a blob in the default browser, or open a link ----
        if path == "/__open" {
            if method == "GET" {
                let target = url
                    .split_once('?')
                    .map(|(_, q)| q)
                    .unwrap_or("")
                    .split('&')
                    .find_map(|kv| kv.strip_prefix("url="))
                    .map(percent_decode);
                if let Some(t) = target {
                    let _ = std::process::Command::new("open").arg(&t).spawn();
                }
            } else if method == "POST" {
                let ct = headers
                    .iter()
                    .find(|(k, _)| k.eq_ignore_ascii_case("content-type"))
                    .map(|(_, v)| v.clone())
                    .unwrap_or_default();
                open_preview(&ct, &body);
            }
            let r = Response::from_string("{\"ok\":true}").with_header(json_header());
            let _ = request.respond(r);
            continue;
        }

        // ---- proxy: /llm/<provider>/... (relative) or /__proxy (absolute via header) ----
        if path.starts_with("/llm/") || path == "/__proxy" {
            let target = if path == "/__proxy" {
                headers
                    .iter()
                    .find(|(k, _)| k.eq_ignore_ascii_case("x-mdesign-target"))
                    .map(|(_, v)| v.clone())
            } else {
                llm_target(&url)
            };
            if let Some(target) = target {
                let mut req = agent.request(&method, &target);
                for (k, v) in &headers {
                    if forward_header(k) {
                        req = req.set(k, v);
                    }
                }
                req = req.set("Accept-Encoding", "identity");
                let result = if body.is_empty() { req.call() } else { req.send_bytes(&body) };
                match result {
                    Ok(resp) | Err(ureq::Error::Status(_, resp)) => {
                        let status = resp.status();
                        let ctype =
                            resp.header("content-type").unwrap_or("application/octet-stream").to_string();
                        let reader = resp.into_reader();
                        let header = Header::from_bytes(&b"Content-Type"[..], ctype.as_bytes())
                            .unwrap_or_else(|_| json_header());
                        let r = Response::new(StatusCode(status), vec![header], reader, None, None);
                        let _ = request.respond(r);
                    }
                    Err(e) => {
                        let r = Response::from_string(format!("{{\"error\":\"proxy: {e}\"}}"))
                            .with_status_code(StatusCode(502))
                            .with_header(json_header());
                        let _ = request.respond(r);
                    }
                }
                continue;
            }
            let r = Response::from_string("{\"error\":\"no proxy target\"}")
                .with_status_code(StatusCode(404))
                .with_header(json_header());
            let _ = request.respond(r);
            continue;
        }

        // ---- static SPA ----
        let rel = if path == "/" { "index.html".to_string() } else { path.trim_start_matches('/').to_string() };
        let (bytes, ctype) = match Dist::get(&rel) {
            Some(f) => (f.data.into_owned(), content_type(&rel)),
            None => (
                Dist::get("index.html").map(|f| f.data.into_owned()).unwrap_or_default(),
                "text/html; charset=utf-8",
            ),
        };
        let r = Response::from_data(bytes)
            .with_header(Header::from_bytes(&b"Content-Type"[..], ctype.as_bytes()).unwrap());
        let _ = request.respond(r);
    }
}

fn start_server() -> u16 {
    clear_preview_dir();
    let bind = std::env::var("MDESIGN_PORT")
        .ok()
        .map(|p| format!("127.0.0.1:{p}"))
        .unwrap_or_else(|| "127.0.0.1:0".into());
    let server = std::sync::Arc::new(Server::http(&bind).expect("bind local server"));
    let port = server.server_addr().to_ip().expect("addr").port();
    // A small pool so a long streaming /llm request never blocks /api saves or
    // static loads handled on the other threads.
    for _ in 0..6 {
        let s = server.clone();
        std::thread::spawn(move || serve(s));
    }
    port
}

fn main() {
    let port = start_server();
    let url = format!("http://127.0.0.1:{port}/");

    // Headless mode: run the embedded server only (used for tests / no display).
    if std::env::var("MDESIGN_HEADLESS").is_ok() {
        eprintln!("MDesign server on {url}");
        loop {
            std::thread::park();
        }
    }

    open_window(&url);
}

// Whether the webview may perform a full-frame navigation to `uri`. Allow non-http
// (about:srcdoc / data: / blob:) and the app root only; open external links in the
// default browser; cancel any other same-origin navigation (stray prototype links,
// target=_top, JS location, iframe link escapes) so the SPA is never navigated away.
fn nav_policy(uri: &str, origin: &str) -> bool {
    if !(uri.starts_with("http://") || uri.starts_with("https://")) {
        return true;
    }
    if let Some(rest) = uri.strip_prefix(origin) {
        let r = rest.trim_start_matches('/');
        return r.is_empty() || r.starts_with('?') || r.starts_with('#');
    }
    let _ = std::process::Command::new("open").arg(uri).spawn();
    false
}

fn open_window(url: &str) {
    use tao::dpi::LogicalSize;
    use tao::event::{Event, WindowEvent};
    use tao::event_loop::{ControlFlow, EventLoop};
    use tao::window::WindowBuilder;
    use wry::WebViewBuilder;

    let event_loop = EventLoop::new();
    let window = WindowBuilder::new()
        .with_title("MDesign")
        .with_inner_size(LogicalSize::new(1320.0, 860.0))
        .build(&event_loop)
        .expect("build window");

    // macOS menu — gives the webview the standard Edit shortcuts (⌘C/⌘V/⌘X/⌘A/⌘Z)
    // and a real app menu (Quit). Predefined items are handled by the system, so no
    // event wiring is needed. Must run after the event loop has created NSApp.
    {
        use muda::{Menu, PredefinedMenuItem, Submenu};
        let app = Submenu::with_items(
            "MDesign",
            true,
            &[
                &PredefinedMenuItem::about(Some("MDesign"), None),
                &PredefinedMenuItem::separator(),
                &PredefinedMenuItem::services(None),
                &PredefinedMenuItem::separator(),
                &PredefinedMenuItem::quit(None),
            ],
        )
        .expect("app menu");
        let edit = Submenu::with_items(
            "Edit",
            true,
            &[
                &PredefinedMenuItem::undo(None),
                &PredefinedMenuItem::redo(None),
                &PredefinedMenuItem::separator(),
                &PredefinedMenuItem::cut(None),
                &PredefinedMenuItem::copy(None),
                &PredefinedMenuItem::paste(None),
                &PredefinedMenuItem::separator(),
                &PredefinedMenuItem::select_all(None),
            ],
        )
        .expect("edit menu");
        let menu = Menu::new();
        let _ = menu.append(&app);
        let _ = menu.append(&edit);
        menu.init_for_nsapp();
    }

    // Injected before page load:
    //  1. fetch shim — route any cross-origin request (e.g. an absolute LLM Base URL
    //     like https://ark.cn-beijing.volces.com/...) through the local proxy so it is
    //     same-origin and never hits CORS. Same-origin calls pass through untouched.
    //  2. download interceptor — WKWebView ignores blob `<a download>` clicks, so reroute
    //     them to the local /__save endpoint, which writes to ~/Downloads and reveals it.
    const INIT_JS: &str = r#"
(function () {
  var origin = location.origin;
  var nativeFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    try {
      var url = (typeof input === 'string') ? input : (input && input.url);
      if (typeof url === 'string' && /^https?:\/\//i.test(url) && url.indexOf(origin) !== 0) {
        var opts = Object.assign({}, init);
        if (typeof input !== 'string') {
          opts.method = opts.method || input.method;
          if (opts.body == null && input.body != null) opts.body = input.body;
          if (!opts.headers) opts.headers = input.headers;
        }
        var h = new Headers(opts.headers || {});
        h.set('x-mdesign-target', url);
        opts.headers = h;
        return nativeFetch(origin + '/__proxy', opts);
      }
    } catch (e) {}
    return nativeFetch(input, init);
  };

  var nativeClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    try {
      if (this.download && /^(blob:|data:)/i.test(this.href || '')) {
        var name = this.download, href = this.href;
        nativeFetch(href)
          .then(function (r) { return r.arrayBuffer(); })
          .then(function (buf) {
            return nativeFetch('/__save', {
              method: 'POST',
              headers: { 'x-mdesign-filename': encodeURIComponent(name) },
              body: buf,
            });
          })
          .catch(function () {});
        return;
      }
    } catch (e) {}
    return nativeClick.apply(this, arguments);
  };

  var nativeOpen = window.open.bind(window);
  window.open = function (u, target, features) {
    try {
      if (typeof u === 'string' && /^(blob:|data:)/i.test(u)) {
        nativeFetch(u)
          .then(function (r) {
            var ct = r.headers.get('content-type') || 'text/html';
            return r.arrayBuffer().then(function (buf) {
              return nativeFetch('/__open', { method: 'POST', headers: { 'content-type': ct }, body: buf });
            });
          })
          .catch(function () {});
        return null;
      }
      if (typeof u === 'string' && /^https?:\/\//i.test(u) && u.indexOf(origin) !== 0) {
        nativeFetch('/__open?url=' + encodeURIComponent(u)).catch(function () {});
        return null;
      }
    } catch (e) {}
    return nativeOpen(u, target, features);
  };
})();
"#;

    // Hard backstop against the "This project doesn't exist" crash. The SPA navigates
    // only via history.pushState (react-router), so the ONLY legitimate full-frame
    // navigation is the initial load of the app root. nav_policy cancels everything else.
    // It must be wired to BOTH handlers: wry routes main-frame navigations through
    // navigation_handler and sub-frame (iframe) / new-window navigations through
    // new_window_req_handler — a stray prototype link in a preview iframe goes through
    // the latter.
    let origin = url.trim_end_matches('/').to_string();
    let (o_main, o_sub) = (origin.clone(), origin.clone());
    let _webview = WebViewBuilder::new()
        .with_initialization_script(INIT_JS)
        .with_devtools(true)
        .with_navigation_handler(move |uri: String| nav_policy(&uri, &o_main))
        .with_new_window_req_handler(move |uri: String| nav_policy(&uri, &o_sub))
        .with_url(url)
        .build(&window)
        .expect("build webview");

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;
        if let Event::WindowEvent { event: WindowEvent::CloseRequested, .. } = event {
            *control_flow = ControlFlow::Exit;
        }
    });
}
