pub mod browser_bridge;
pub mod extractor;
pub mod jobs;

use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Json, Response},
    routing::{get, post},
    Router,
};
use browser_bridge::BrowserBridge;
use extractor::ExtractedPost;
use jobs::{JobManager, JobState};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;
use tower_http::cors::CorsLayer;
use tower_http::services::ServeDir;
use wreq::Client;
use wreq_util::Emulation;

#[derive(Clone)]
pub struct AppState {
    pub client: Client,
    pub job_manager: JobManager,
    pub cookie_header: Arc<RwLock<Option<String>>>,
    pub browser_bridge: BrowserBridge,
}

#[derive(Deserialize)]
pub struct StreamParams {
    pub url: String,
    pub filename: Option<String>,
}

#[derive(Deserialize)]
pub struct CreateJobPayload {
    pub url: String,
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
    pipe_stream(&state.client, &params.url, params.filename.as_deref()).await
}

/// Dynamic zero-disk media route matching frontend's `/media/:job_id/:filename` format.
async fn media_route_handler(
    State(state): State<Arc<AppState>>,
    Path((job_id, filename)): Path<(String, String)>,
) -> Result<Response, (StatusCode, Json<ErrorResponse>)> {
    // Parse index from filename (e.g., "0.mp4" -> 0)
    let idx: usize = filename
        .split('.')
        .next()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);

    let source_url = state
        .job_manager
        .find_media_source(&job_id, idx)
        .await
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    error: format!("Media {filename} in job {job_id} not found"),
                }),
            )
        })?;

    pipe_stream(&state.client, &source_url, Some(&filename)).await
}

async fn pipe_stream(
    client: &Client,
    target_url: &str,
    filename: Option<&str>,
) -> Result<Response, (StatusCode, Json<ErrorResponse>)> {
    let upstream = client
        .get(target_url)
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

    let default_name = "media.mp4".to_string();
    let fname = filename.unwrap_or(&default_name);
    let disposition = format!("attachment; filename=\"{fname}\"");
    if let Ok(v) = header::HeaderValue::from_str(&disposition) {
        headers.insert(header::CONTENT_DISPOSITION, v);
    }

    // Zero copy: wreq::Response implements http_body::Body directly.
    let body = Body::new(upstream);
    Ok((status, headers, body).into_response())
}

/// Create a new extraction job (POST /jobs).
async fn create_job_handler(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<CreateJobPayload>,
) -> Result<(StatusCode, Json<JobState>), (StatusCode, Json<ErrorResponse>)> {
    match state.job_manager.create_job(&payload.url).await {
        Ok(job) => Ok((StatusCode::ACCEPTED, Json(job))),
        Err(err) => Err((StatusCode::BAD_REQUEST, Json(ErrorResponse { error: err }))),
    }
}

/// Get job status (GET /jobs/:id).
async fn get_job_handler(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<JobState>, (StatusCode, Json<ErrorResponse>)> {
    match state.job_manager.get_job(&id).await {
        Some(job) => Ok(Json(job)),
        None => Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: format!("Job {id} not found"),
            }),
        )),
    }
}

/// Get job posts (GET /jobs/:id/posts).
async fn get_job_posts_handler(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Vec<ExtractedPost>>, (StatusCode, Json<ErrorResponse>)> {
    match state.job_manager.get_job_posts(&id).await {
        Some(posts) => Ok(Json(posts)),
        None => Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: format!("Job {id} not found"),
            }),
        )),
    }
}

pub fn create_router(state: Arc<AppState>, public_dir: Option<PathBuf>) -> Router {
    let mut router = Router::new()
        .route("/stream", get(stream_handler))
        .route("/media/{job_id}/{filename}", get(media_route_handler))
        .route("/jobs", post(create_job_handler))
        .route("/jobs/{id}", get(get_job_handler))
        .route("/jobs/{id}/posts", get(get_job_posts_handler))
        .layer(CorsLayer::permissive())
        .with_state(state);

    if let Some(dir) = public_dir {
        if dir.exists() {
            router = router.fallback_service(ServeDir::new(dir));
        }
    }

    router
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let client = Client::builder()
        .emulation(Emulation::Chrome142)
        .build()?;

    let cookie_header = Arc::new(RwLock::new(std::env::var("IG_COOKIE_HEADER").ok()));
    let browser_bridge = BrowserBridge::new("ig-session");

    let job_manager = JobManager::new(
        client.clone(),
        cookie_header.clone(),
        browser_bridge.clone(),
    );

    let state = Arc::new(AppState {
        client,
        job_manager,
        cookie_header,
        browser_bridge,
    });

    let port = std::env::var("PORT").unwrap_or_else(|_| "8787".to_string());
    let addr = format!("0.0.0.0:{port}");
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    println!("Axum server running on http://{addr}");

    let public_dir = std::path::Path::new("../public").canonicalize().ok();
    let app = create_router(state, public_dir);

    axum::serve(listener, app).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_full_job_and_stream_flow() -> Result<(), Box<dyn std::error::Error>> {
        let client = Client::builder()
            .emulation(Emulation::Chrome142)
            .build()?;

        let cookie_header = Arc::new(RwLock::new(None));
        let browser_bridge = BrowserBridge::new("test-full-bridge");
        let job_manager = JobManager::new(
            client.clone(),
            cookie_header.clone(),
            browser_bridge.clone(),
        );

        let state = Arc::new(AppState {
            client: client.clone(),
            job_manager,
            cookie_header,
            browser_bridge,
        });

        let app = create_router(state.clone(), None);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
        let addr = listener.local_addr()?;

        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });

        // 1. Create job
        let payload = serde_json::json!({
            "url": "https://www.instagram.com/reel/CtKBzvqp9RA/"
        });
        let res = client
            .post(&format!("http://{addr}/jobs"))
            .header("Content-Type", "application/json")
            .body(payload.to_string())
            .send()
            .await?;
        assert_eq!(res.status().as_u16(), 202);
        let job: JobState = serde_json::from_slice(&res.bytes().await?)?;
        assert_eq!(job.input_url, "https://www.instagram.com/reel/CtKBzvqp9RA/");

        // 2. Poll job status
        let poll_res = client
            .get(&format!("http://{addr}/jobs/{}", job.id))
            .send()
            .await?;
        assert_eq!(poll_res.status().as_u16(), 200);

        // 3. Test direct stream route
        let stream_url = format!(
            "http://{addr}/stream?url=https://httpbin.org/bytes/256&filename=test.mp4"
        );
        let stream_res = client.get(&stream_url).send().await?;
        assert_eq!(stream_res.status().as_u16(), 200);
        assert_eq!(
            stream_res
                .headers()
                .get("content-disposition")
                .and_then(|v| v.to_str().ok()),
            Some("attachment; filename=\"test.mp4\"")
        );
        assert_eq!(stream_res.bytes().await?.len(), 256);

        server.abort();
        Ok(())
    }
}
