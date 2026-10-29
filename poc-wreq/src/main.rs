pub mod browser_bridge;
pub mod extractor;

use axum::{
    body::Body,
    extract::{Query, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Json, Response},
    routing::{get, post},
    Router,
};
use browser_bridge::BrowserBridge;
use extractor::{extract_from_media_info, shortcode_to_media_id, ExtractedPost};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;
use tokio::sync::RwLock;
use wreq::Client;
use wreq_util::Emulation;

#[derive(Clone)]
pub struct AppState {
    pub client: Client,
    pub cookie_header: Arc<RwLock<Option<String>>>,
    pub browser_bridge: BrowserBridge,
}

#[derive(Deserialize)]
pub struct StreamParams {
    pub url: String,
    pub filename: Option<String>,
}

#[derive(Deserialize)]
pub struct InfoParams {
    pub shortcode: String,
}

#[derive(Deserialize)]
pub struct WarmupPayload {
    pub url: Option<String>,
}

#[derive(Serialize)]
pub struct ErrorResponse {
    pub error: String,
}

#[derive(Serialize, Deserialize)]
pub struct SessionStatusResponse {
    pub has_cookies: bool,
    pub session_name: String,
}

/// Zero-disk streaming pass-through: pipes media directly from CDN to visitor's browser.
async fn stream_handler(
    State(state): State<Arc<AppState>>,
    Query(params): Query<StreamParams>,
) -> Result<Response, (StatusCode, Json<ErrorResponse>)> {
    let upstream = state
        .client
        .get(&params.url)
        .header("Referer", "https://www.instagram.com/")
        .send()
        .await
        .map_err(|e| {
            (
                StatusCode::BAD_GATEWAY,
                Json(ErrorResponse {
                    error: format!("Upstream CDN fetch failed: {e}"),
                }),
            )
        })?;

    let status = StatusCode::from_u16(upstream.status().as_u16())
        .unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);

    let mut headers = HeaderMap::new();
    if let Some(ct) = upstream.headers().get("content-type") {
        if let Ok(v) = header::HeaderValue::from_bytes(ct.as_bytes()) {
            headers.insert(header::CONTENT_TYPE, v);
        }
    }
    if let Some(cl) = upstream.headers().get("content-length") {
        if let Ok(v) = header::HeaderValue::from_bytes(cl.as_bytes()) {
            headers.insert(header::CONTENT_LENGTH, v);
        }
    }

    let filename = params.filename.unwrap_or_else(|| "media.mp4".to_string());
    let disposition = format!("attachment; filename=\"{filename}\"");
    if let Ok(v) = header::HeaderValue::from_str(&disposition) {
        headers.insert(header::CONTENT_DISPOSITION, v);
    }

    // Zero copy: wreq::Response implements http_body::Body directly.
    let body = Body::new(upstream);
    Ok((status, headers, body).into_response())
}

/// Helper to query Instagram Private Mobile API.
async fn fetch_media_info(
    client: &Client,
    media_id: u64,
    shortcode: &str,
    cookies: Option<&str>,
) -> Result<ExtractedPost, (StatusCode, String)> {
    let url = format!("https://i.instagram.com/api/v1/media/{media_id}/info/");
    let mut req = client
        .get(&url)
        .header(
            "User-Agent",
            "Instagram 275.0.0.27.98 (iPhone14,3; iOS 15_5; en_US; en-US; scale=3.00; 1284x2778; 458234631) AppleWebKit/420+",
        )
        .header("x-asbd-id", "359341")
        .header("x-ig-app-id", "124024574287414")
        .header("x-ig-www-claim", "0")
        .header("Accept", "*/*");

    if let Some(c) = cookies {
        req = req.header("Cookie", c);
    }

    let resp = req.send().await.map_err(|e| {
        (
            StatusCode::BAD_GATEWAY,
            format!("Instagram API request failed: {e}"),
        )
    })?;

    let status = resp.status();
    let body_text = resp.text().await.unwrap_or_default();

    if !status.is_success() {
        return Err((
            StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::BAD_GATEWAY),
            format!("Instagram returned HTTP {status}: {body_text}"),
        ));
    }

    let val: Value = serde_json::from_str(&body_text).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to parse Instagram response: {e}"),
        )
    })?;

    extract_from_media_info(&val, shortcode)
        .ok_or_else(|| (StatusCode::NOT_FOUND, "No media items found in post".to_string()))
}

/// Query Instagram for post info using shortcode -> media_id with automatic browser fallback.
async fn info_handler(
    State(state): State<Arc<AppState>>,
    Query(params): Query<InfoParams>,
) -> Result<Json<ExtractedPost>, (StatusCode, Json<ErrorResponse>)> {
    let media_id = shortcode_to_media_id(&params.shortcode).ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: format!("Invalid shortcode: {}", params.shortcode),
            }),
        )
    })?;

    // Attempt 1: Fast path with current cached cookies
    let mut cookies = {
        let guard = state.cookie_header.read().await;
        guard.clone()
    };
    if cookies.is_none() {
        cookies = state.browser_bridge.get_cached().await;
    }

    let result = fetch_media_info(
        &state.client,
        media_id,
        &params.shortcode,
        cookies.as_deref(),
    )
    .await;

    // Check if Tier 2 (agent-browser fallback) is needed
    let final_post = match result {
        Ok(post) => post,
        Err((status, msg))
            if status == StatusCode::FORBIDDEN
                || status == StatusCode::UNAUTHORIZED
                || msg.contains("login_required") =>
        {
            // Trigger agent-browser warmup to harvest fresh edge cookies
            let target_url = format!("https://www.instagram.com/p/{}/", params.shortcode);
            match state.browser_bridge.warm_up_session(&target_url).await {
                Ok(new_cookies) => {
                    let mut guard = state.cookie_header.write().await;
                    *guard = Some(new_cookies.clone());

                    // Retry fast path with hydrated cookies
                    fetch_media_info(
                        &state.client,
                        media_id,
                        &params.shortcode,
                        Some(&new_cookies),
                    )
                    .await
                    .map_err(|(code, err)| (code, Json(ErrorResponse { error: err })))?
                }
                Err(bridge_err) => {
                    return Err((
                        StatusCode::BAD_GATEWAY,
                        Json(ErrorResponse {
                            error: format!(
                                "Instagram requires session and agent-browser warmup failed: {bridge_err}"
                            ),
                        }),
                    ));
                }
            }
        }
        Err((status, msg)) => {
            return Err((status, Json(ErrorResponse { error: msg })));
        }
    };

    Ok(Json(final_post))
}

/// Explicit warmup route to pre-seed cookies from agent-browser.
async fn warmup_handler(
    State(state): State<Arc<AppState>>,
    body: Option<Json<WarmupPayload>>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    let target = body
        .and_then(|b| b.url.clone())
        .unwrap_or_else(|| "https://www.instagram.com/".to_string());

    match state.browser_bridge.warm_up_session(&target).await {
        Ok(cookies) => {
            let mut guard = state.cookie_header.write().await;
            *guard = Some(cookies);
            Ok(Json(serde_json::json!({
                "status": "warmed_up",
                "session_name": state.browser_bridge.session_name,
            })))
        }
        Err(err) => Err((
            StatusCode::BAD_GATEWAY,
            Json(ErrorResponse {
                error: format!("Warmup failed: {err}"),
            }),
        )),
    }
}

/// Status check for current in-memory session.
async fn session_status_handler(
    State(state): State<Arc<AppState>>,
) -> Json<SessionStatusResponse> {
    let guard = state.cookie_header.read().await;
    let has_cookies = guard.is_some() || state.browser_bridge.get_cached().await.is_some();
    Json(SessionStatusResponse {
        has_cookies,
        session_name: state.browser_bridge.session_name.clone(),
    })
}

pub fn create_router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/stream", get(stream_handler))
        .route("/api/info", get(info_handler))
        .route("/api/session/warmup", post(warmup_handler))
        .route("/api/session/status", get(session_status_handler))
        .with_state(state)
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let client = Client::builder()
        .emulation(Emulation::Chrome142)
        .build()?;

    let initial_cookies = std::env::var("IG_COOKIE_HEADER").ok();
    let browser_bridge = BrowserBridge::new("ig-session");

    let state = Arc::new(AppState {
        client: client.clone(),
        cookie_header: Arc::new(RwLock::new(initial_cookies)),
        browser_bridge,
    });

    let port = std::env::var("PORT").unwrap_or_else(|_| "8787".to_string());
    let addr = format!("0.0.0.0:{port}");
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    println!("Axum server running on http://{addr}");

    let app = create_router(state);
    axum::serve(listener, app).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_stream_pass_through() -> Result<(), Box<dyn std::error::Error>> {
        let client = Client::builder()
            .emulation(Emulation::Chrome142)
            .build()?;

        let state = Arc::new(AppState {
            client: client.clone(),
            cookie_header: Arc::new(RwLock::new(None)),
            browser_bridge: BrowserBridge::new("test-stream-bridge"),
        });

        let app = create_router(state);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
        let addr = listener.local_addr()?;

        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });

        let target = format!(
            "http://{addr}/stream?url=https://httpbin.org/bytes/512&filename=clip.mp4"
        );
        let resp = client.get(&target).send().await?;
        assert_eq!(resp.status().as_u16(), 200);
        assert_eq!(
            resp.headers()
                .get("content-disposition")
                .and_then(|v| v.to_str().ok()),
            Some("attachment; filename=\"clip.mp4\"")
        );

        let body = resp.bytes().await?;
        assert_eq!(body.len(), 512);

        server.abort();
        Ok(())
    }

    #[tokio::test]
    async fn test_session_status_endpoint() -> Result<(), Box<dyn std::error::Error>> {
        let client = Client::builder()
            .emulation(Emulation::Chrome142)
            .build()?;

        let state = Arc::new(AppState {
            client: client.clone(),
            cookie_header: Arc::new(RwLock::new(Some("sessionid=test123".to_string()))),
            browser_bridge: BrowserBridge::new("test-status-bridge"),
        });

        let app = create_router(state);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
        let addr = listener.local_addr()?;

        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });

        let target = format!("http://{addr}/api/session/status");
        let resp = client.get(&target).send().await?;
        assert_eq!(resp.status().as_u16(), 200);

        let json_body: SessionStatusResponse =
            serde_json::from_slice(&resp.bytes().await?)?;
        assert!(json_body.has_cookies);
        assert_eq!(json_body.session_name, "test-status-bridge");

        server.abort();
        Ok(())
    }
}
