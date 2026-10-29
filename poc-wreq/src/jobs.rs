use crate::browser_bridge::BrowserBridge;
use crate::extractor::{
    classify_url, extract_from_media_info, shortcode_to_media_id, ClassifiedUrl, ContentKind,
    ExtractedPost, MediaType,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use uuid::Uuid;
use wreq::Client;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum JobStatus {
    Queued,
    Running,
    Succeeded,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobProgress {
    pub stage: String,
    pub message: String,
    pub count: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobState {
    pub id: String,
    #[serde(rename = "inputUrl")]
    pub input_url: String,
    pub status: JobStatus,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
    pub progress: Option<JobProgress>,
    pub error: Option<String>,
    #[serde(default, skip_serializing)]
    pub posts: Vec<ExtractedPost>,
}

#[derive(Clone)]
pub struct JobManager {
    jobs: Arc<RwLock<HashMap<String, JobState>>>,
    client: Client,
    cookie_header: Arc<RwLock<Option<String>>>,
    browser_bridge: BrowserBridge,
}

impl JobManager {
    pub fn new(
        client: Client,
        cookie_header: Arc<RwLock<Option<String>>>,
        browser_bridge: BrowserBridge,
    ) -> Self {
        Self {
            jobs: Arc::new(RwLock::new(HashMap::new())),
            client,
            cookie_header,
            browser_bridge,
        }
    }

    pub async fn create_job(&self, input_url: &str) -> Result<JobState, String> {
        let classified = classify_url(input_url)?;
        let id = Uuid::new_v4().to_string();
        let now = chrono_now_iso();

        let job = JobState {
            id: id.clone(),
            input_url: input_url.to_string(),
            status: JobStatus::Queued,
            created_at: now.clone(),
            updated_at: now,
            progress: Some(JobProgress {
                stage: "listing".to_string(),
                message: "Starting job...".to_string(),
                count: None,
            }),
            error: None,
            posts: Vec::new(),
        };

        {
            let mut guard = self.jobs.write().await;
            guard.insert(id.clone(), job.clone());
        }

        // Spawn background task
        let manager = self.clone();
        tokio::spawn(async move {
            manager.run_job(id, classified).await;
        });

        Ok(job)
    }

    pub async fn get_job(&self, id: &str) -> Option<JobState> {
        let guard = self.jobs.read().await;
        guard.get(id).cloned()
    }

    pub async fn get_job_posts(&self, id: &str) -> Option<Vec<ExtractedPost>> {
        let guard = self.jobs.read().await;
        guard.get(id).map(|j| j.posts.clone())
    }

    pub async fn find_media_source(&self, job_id: &str, media_idx: usize) -> Option<String> {
        let guard = self.jobs.read().await;
        let job = guard.get(job_id)?;
        for post in &job.posts {
            for m in &post.media {
                if m.index == media_idx {
                    return Some(m.source_url.clone());
                }
            }
        }
        None
    }

    async fn run_job(&self, id: String, classified: ClassifiedUrl) {
        self.update_job(&id, |j| {
            j.status = JobStatus::Running;
            j.updated_at = chrono_now_iso();
            j.progress = Some(JobProgress {
                stage: "listing".to_string(),
                message: "Fetching metadata...".to_string(),
                count: None,
            });
        })
        .await;

        match self.extract_target(&id, &classified).await {
            Ok(mut posts) => {
                // Populate virtual local_path so React UI can construct media URLs
                for post in &mut posts {
                    for m in &mut post.media {
                        let ext = match m.media_type {
                            MediaType::Video => "mp4",
                            MediaType::Image => "jpg",
                        };
                        m.local_path = Some(format!("{}/{}.{}", id, m.index, ext));
                        m.status = "saved".to_string();
                    }
                }

                self.update_job(&id, |j| {
                    j.status = JobStatus::Succeeded;
                    j.updated_at = chrono_now_iso();
                    j.progress = Some(JobProgress {
                        stage: "downloading".to_string(),
                        message: "Media ready".to_string(),
                        count: Some(posts.iter().map(|p| p.media.len()).sum()),
                    });
                    j.posts = posts;
                })
                .await;
            }
            Err(err) => {
                self.update_job(&id, |j| {
                    j.status = JobStatus::Failed;
                    j.updated_at = chrono_now_iso();
                    j.error = Some(err);
                })
                .await;
            }
        }
    }

    async fn extract_target(
        &self,
        _job_id: &str,
        classified: &ClassifiedUrl,
    ) -> Result<Vec<ExtractedPost>, String> {
        match classified.kind {
            ContentKind::Post | ContentKind::Reel | ContentKind::Tv => {
                let shortcode = classified
                    .shortcode
                    .as_deref()
                    .ok_or_else(|| "Missing shortcode".to_string())?;

                let media_id = shortcode_to_media_id(shortcode)
                    .ok_or_else(|| format!("Invalid shortcode: {shortcode}"))?;

                // Attempt with cached cookies
                let cookies = self.get_cookie_header().await;
                let post = match self
                    .fetch_post_info(media_id, shortcode, cookies.as_deref())
                    .await
                {
                    Ok(p) => p,
                    Err(err) if err.contains("login_required") || err.contains("401") || err.contains("403") => {
                        // Fallback to agent-browser warmup
                        let target_url = format!("https://www.instagram.com/p/{shortcode}/");
                        let new_cookies = self.browser_bridge.warm_up_session(&target_url).await?;
                        {
                            let mut guard = self.cookie_header.write().await;
                            *guard = Some(new_cookies.clone());
                        }
                        self.fetch_post_info(media_id, shortcode, Some(&new_cookies))
                            .await?
                    }
                    Err(e) => return Err(e),
                };

                Ok(vec![post])
            }
            _ => Err("Profile and Story extraction via web info in progress".to_string()),
        }
    }

    async fn get_cookie_header(&self) -> Option<String> {
        let guard = self.cookie_header.read().await;
        if guard.is_some() {
            return guard.clone();
        }
        self.browser_bridge.get_cached().await
    }

    async fn fetch_post_info(
        &self,
        media_id: u64,
        shortcode: &str,
        cookies: Option<&str>,
    ) -> Result<ExtractedPost, String> {
        let url = format!("https://i.instagram.com/api/v1/media/{media_id}/info/");
        let mut req = self
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

        if let Some(c) = cookies {
            req = req.header("Cookie", c);
        }

        let resp = req.send().await.map_err(|e| format!("Request failed: {e}"))?;
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();

        if !status.is_success() {
            return Err(format!("HTTP {status}: {body}"));
        }

        let val: Value = serde_json::from_str(&body)
            .map_err(|e| format!("JSON parse failed: {e}"))?;

        extract_from_media_info(&val, shortcode)
            .ok_or_else(|| "No media found in post response".to_string())
    }

    async fn update_job<F>(&self, id: &str, f: F)
    where
        F: FnOnce(&mut JobState),
    {
        let mut guard = self.jobs.write().await;
        if let Some(job) = guard.get_mut(id) {
            f(job);
        }
    }
}

fn chrono_now_iso() -> String {
    use std::time::SystemTime;
    let now = SystemTime::now();
    let duration = now.duration_since(SystemTime::UNIX_EPOCH).unwrap_or_default();
    format!("{}.{:03}Z", duration.as_secs(), duration.subsec_millis())
}

#[cfg(test)]
mod tests {
    use super::*;
    use wreq_util::Emulation;

    #[tokio::test]
    async fn test_in_memory_job_flow() {
        let client = Client::builder()
            .emulation(Emulation::Chrome142)
            .build()
            .unwrap();

        let bridge = BrowserBridge::new("test-jobs-bridge");
        let manager = JobManager::new(
            client,
            Arc::new(RwLock::new(None)),
            bridge,
        );

        let job = manager
            .create_job("https://www.instagram.com/reel/CtKBzvqp9RA/")
            .await
            .expect("Failed to create job");

        assert_eq!(job.status, JobStatus::Queued);
        assert_eq!(job.input_url, "https://www.instagram.com/reel/CtKBzvqp9RA/");

        let retrieved = manager.get_job(&job.id).await;
        assert!(retrieved.is_some());
    }
}
