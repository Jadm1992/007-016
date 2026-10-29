pub mod extractor;

use axum::{
    body::Body,
    extract::{Query, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Json, Response},
    routing::get,
    Router,
};
use extractor::{extract_from_media_info, shortcode_to_media_id, ExtractedPost};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;
use wreq::Client;
use wreq_util::Emulation;

#[derive(Clone)]
pub struct AppState {
    pub client: Client,
    pub cookie_header: Option<String>,
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

#[derive(Serialize)]
pub struct ErrorResponse {
    pub error: String,
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

/// Query Instagram Private Mobile API for post info using shortcode -> media_id.
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

    let url = format!("https://i.instagram.com/api/v1/media/{media_id}/info/");
    let mut req = state
        .client
        .get(&url)
        .header(
            "User-Agent",
            "Instagram 275.0.0.27.98 (iPhone14,3; iOS 15_5; en_US; en-US; scale=3.00; 1284x2778; 458234631) AppleWebKit/420+",
        )
        .header("x-asbd-id", "359341")
        .header("x-ig-app-id", "124024574287414")
        .header("x-ig-www-claim", "0")
        .header("Accept", "*/*");

    if let Some(cookies) = &state.cookie_header {
        req = req.header("Cookie", cookies.as_str());
    }

    let resp = req.send().await.map_err(|e| {
        (
            StatusCode::BAD_GATEWAY,
            Json(ErrorResponse {
                error: format!("Instagram API request failed: {e}"),
            }),
        )
    })?;

    let status = resp.status();
    let body_text = resp.text().await.unwrap_or_default();

    if !status.is_success() {
        return Err((
            StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::BAD_GATEWAY),
            Json(ErrorResponse {
                error: format!("Instagram returned HTTP {status}: {body_text}"),
            }),
        ));
    }

    let val: Value = serde_json::from_str(&body_text).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: format!("Failed to parse Instagram response: {e}"),
            }),
        )
    })?;

    let post = extract_from_media_info(&val, &params.shortcode).ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "No media items found in post".to_string(),
            }),
        )
    })?;

    Ok(Json(post))
}

pub fn create_router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/stream", get(stream_handler))
        .route("/api/info", get(info_handler))
        .with_state(state)
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let client = Client::builder()
        .emulation(Emulation::Chrome142)
        .build()?;

    let cookie_header = std::env::var("IG_COOKIE_HEADER").ok();
    let state = Arc::new(AppState {
        client: client.clone(),
        cookie_header,
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
            cookie_header: None,
        });

        let app = create_router(state);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
        let addr = listener.local_addr()?;

        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });

        let target = format!("http://{addr}/stream?url=https://httpbin.org/bytes/512&filename=clip.mp4");
        let resp = client.get(&target).send().await?;
        assert_eq!(resp.status().as_u16(), 200);
        assert_eq!(
            resp.headers().get("content-disposition").and_then(|v| v.to_str().ok()),
            Some("attachment; filename=\"clip.mp4\"")
        );

        let body = resp.bytes().await?;
        assert_eq!(body.len(), 512);

        server.abort();
        Ok(())
    }
}
