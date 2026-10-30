use serde::Deserialize;
use std::sync::Arc;
use tokio::process::Command;
use tokio::sync::{RwLock, Semaphore};

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct CookieEntry {
    pub name: String,
    pub value: String,
    #[serde(default)]
    pub domain: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CookiesData {
    #[serde(default)]
    pub cookies: Vec<CookieEntry>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CookiesResponse {
    #[serde(default)]
    pub success: bool,
    pub data: Option<CookiesData>,
}

/// Parses the JSON output from `agent-browser cookies get --json` into an HTTP Cookie header string.
pub fn parse_cookies_json(raw_json: &str) -> Option<String> {
    let parsed: CookiesResponse = serde_json::from_str(raw_json).ok()?;
    let cookies = parsed.data?.cookies;
    if cookies.is_empty() {
        return None;
    }
    let pairs: Vec<String> = cookies
        .into_iter()
        .map(|c| format!("{}={}", c.name, c.value))
        .collect();
    Some(pairs.join("; "))
}

#[derive(Clone)]
pub struct BrowserBridge {
    pub session_name: String,
    pub cached_cookies: Arc<RwLock<Option<String>>>,
    pub semaphore: Arc<Semaphore>,
}

impl BrowserBridge {
    pub fn new(session_name: &str) -> Self {
        Self {
            session_name: session_name.to_string(),
            cached_cookies: Arc::new(RwLock::new(None)),
            semaphore: Arc::new(Semaphore::new(1)),
        }
    }

    /// Read the currently cached cookie string without launching the browser.
    pub async fn get_cached(&self) -> Option<String> {
        let guard = self.cached_cookies.read().await;
        guard.clone()
    }

    /// Manually set or update the cached cookie string.
    pub async fn set_cached(&self, cookies: String) {
        let mut guard = self.cached_cookies.write().await;
        *guard = Some(cookies);
    }

    /// Solves / warms up an Instagram session via agent-browser and extracts cookies into memory.
    /// Thread-safe and concurrency-limited via Semaphore.
    pub async fn warm_up_session(&self, target_url: &str) -> Result<String, String> {
        // Limit to 1 concurrent browser session warmup to prevent Chrome memory spikes
        let _permit = self
            .semaphore
            .acquire()
            .await
            .map_err(|e| format!("Failed to acquire browser permit: {e}"))?;

        // Double check cache after acquiring permit
        if let Some(cached) = self.get_cached().await {
            return Ok(cached);
        }

        // 1. Open the page with agent-browser
        let open_status = Command::new("agent-browser")
            .arg("--session")
            .arg(&self.session_name)
            .arg("open")
            .arg(target_url)
            .output()
            .await
            .map_err(|e| format!("Failed to run agent-browser open: {e}"))?;

        if !open_status.status.success() {
            let stderr = String::from_utf8_lossy(&open_status.stderr);
            return Err(format!("agent-browser open failed: {stderr}"));
        }

        // 2. Fetch cookies in JSON format
        let cookies_output = Command::new("agent-browser")
            .arg("--session")
            .arg(&self.session_name)
            .arg("cookies")
            .arg("get")
            .arg("--json")
            .output()
            .await
            .map_err(|e| format!("Failed to run agent-browser cookies get: {e}"))?;

        let stdout = String::from_utf8_lossy(&cookies_output.stdout);
        let cookie_header = parse_cookies_json(&stdout)
            .ok_or_else(|| format!("No cookies extracted from agent-browser: {stdout}"))?;

        // 3. Cache the cookie header in memory
        self.set_cached(cookie_header.clone()).await;

        // 4. Close the browser context to release Chrome RAM
        let _ = Command::new("agent-browser")
            .arg("--session")
            .arg(&self.session_name)
            .arg("close")
            .output()
            .await;

        Ok(cookie_header)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_cookies_json() {
        let json_str = r#"{
            "success": true,
            "data": {
                "cookies": [
                    {"name": "mid", "value": "auLTbg", "domain": ".instagram.com"},
                    {"name": "csrftoken", "value": "xyz123", "domain": ".instagram.com"},
                    {"name": "ds_user_id", "value": "999999", "domain": ".instagram.com"}
                ]
            }
        }"#;

        let parsed = parse_cookies_json(json_str).expect("Failed to parse");
        assert_eq!(parsed, "mid=auLTbg; csrftoken=xyz123; ds_user_id=999999");
    }

    #[test]
    fn test_parse_empty_cookies() {
        let json_str = r#"{"success": true, "data": {"cookies": []}}"#;
        assert_eq!(parse_cookies_json(json_str), None);

        let invalid_json = "not json";
        assert_eq!(parse_cookies_json(invalid_json), None);
    }

    #[tokio::test]
    async fn test_browser_bridge_cache() {
        let bridge = BrowserBridge::new("test-bridge");
        assert_eq!(bridge.get_cached().await, None);

        bridge.set_cached("foo=bar; baz=qux".to_string()).await;
        assert_eq!(bridge.get_cached().await, Some("foo=bar; baz=qux".to_string()));
    }
}
