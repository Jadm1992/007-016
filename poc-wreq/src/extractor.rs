use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum MediaType {
    Image,
    Video,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MediaItem {
    pub index: usize,
    #[serde(rename = "type")]
    pub media_type: MediaType,
    #[serde(rename = "sourceUrl")]
    pub source_url: String,
    pub width: Option<u64>,
    pub height: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ExtractedPost {
    pub shortcode: String,
    pub media: Vec<MediaItem>,
    pub username: Option<String>,
    pub caption: Option<String>,
    #[serde(rename = "likeCount")]
    pub like_count: Option<u64>,
    #[serde(rename = "commentCount")]
    pub comment_count: Option<u64>,
}

/// Converts an Instagram base64 shortcode to a 64-bit integer media ID.
pub fn shortcode_to_media_id(shortcode: &str) -> Option<u64> {
    let alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut media_id: u64 = 0;
    for c in shortcode.chars() {
        let idx = alphabet.find(c)? as u64;
        media_id = media_id.checked_mul(64)?.checked_add(idx)?;
    }
    Some(media_id)
}

/// Helper trait for safe, loose navigation through dynamic JSON payloads.
pub trait JsonExt {
    fn get_path<'a>(&'a self, path: &[&str]) -> Option<&'a Value>;
    fn get_str(&self, path: &[&str]) -> Option<&str>;
    fn get_u64(&self, path: &[&str]) -> Option<u64>;
}

impl JsonExt for Value {
    fn get_path<'a>(&'a self, path: &[&str]) -> Option<&'a Value> {
        let mut cur = self;
        for &k in path {
            cur = cur.get(k)?;
        }
        Some(cur)
    }

    fn get_str(&self, path: &[&str]) -> Option<&str> {
        self.get_path(path)?.as_str()
    }

    fn get_u64(&self, path: &[&str]) -> Option<u64> {
        self.get_path(path)?.as_u64()
    }
}

/// Extracts media items and metadata from a Mobile API response (`/api/v1/media/{id}/info/`).
pub fn extract_from_media_info(val: &Value, fallback_shortcode: &str) -> Option<ExtractedPost> {
    let items = val.get("items")?.as_array()?;
    let item = items.first()?;

    let shortcode = item
        .get_str(&["code"])
        .unwrap_or(fallback_shortcode)
        .to_string();

    let username = item
        .get_str(&["user", "username"])
        .map(|s| s.to_string());

    let caption = item
        .get_str(&["caption", "text"])
        .map(|s| s.to_string());

    let like_count = item.get_u64(&["like_count"]);
    let comment_count = item.get_u64(&["comment_count"]);

    let mut media = Vec::new();

    // Check if it is a carousel
    if let Some(carousel) = item.get("carousel_media").and_then(|v| v.as_array()) {
        for (i, entry) in carousel.iter().enumerate() {
            if let Some(m) = extract_media_entry(entry, i) {
                media.push(m);
            }
        }
    } else if let Some(m) = extract_media_entry(item, 0) {
        media.push(m);
    }

    Some(ExtractedPost {
        shortcode,
        media,
        username,
        caption,
        like_count,
        comment_count,
    })
}

fn extract_media_entry(entry: &Value, index: usize) -> Option<MediaItem> {
    // If video_versions exists, prefer highest resolution video
    if let Some(videos) = entry.get("video_versions").and_then(|v| v.as_array()) {
        if let Some(best) = videos.first() {
            if let Some(url) = best.get_str(&["url"]) {
                return Some(MediaItem {
                    index,
                    media_type: MediaType::Video,
                    source_url: url.to_string(),
                    width: best.get_u64(&["width"]),
                    height: best.get_u64(&["height"]),
                });
            }
        }
    }

    // Fallback to image_versions2
    if let Some(candidates) = entry
        .get_path(&["image_versions2", "candidates"])
        .and_then(|v| v.as_array())
    {
        if let Some(best) = candidates.first() {
            if let Some(url) = best.get_str(&["url"]) {
                return Some(MediaItem {
                    index,
                    media_type: MediaType::Image,
                    source_url: url.to_string(),
                    width: best.get_u64(&["width"]),
                    height: best.get_u64(&["height"]),
                });
            }
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_shortcode_to_media_id() {
        assert_eq!(shortcode_to_media_id("CtKBzvqp9RA"), Some(3119313645828822080));
        assert_eq!(shortcode_to_media_id("DFb-0q_M26f"), Some(3556712629193109151));
    }

    #[test]
    fn test_extract_video_post() {
        let payload = json!({
            "items": [{
                "code": "CtKBzvqp9RA",
                "like_count": 500,
                "comment_count": 25,
                "caption": { "text": "Cool video" },
                "user": { "username": "bob" },
                "video_versions": [
                    { "url": "https://cdn.example/video_1080.mp4", "width": 1080, "height": 1920 },
                    { "url": "https://cdn.example/video_720.mp4", "width": 720, "height": 1280 }
                ]
            }],
            "status": "ok"
        });

        let post = extract_from_media_info(&payload, "CtKBzvqp9RA").expect("Failed to extract");
        assert_eq!(post.shortcode, "CtKBzvqp9RA");
        assert_eq!(post.username.as_deref(), Some("bob"));
        assert_eq!(post.caption.as_deref(), Some("Cool video"));
        assert_eq!(post.like_count, Some(500));
        assert_eq!(post.media.len(), 1);
        assert_eq!(post.media[0].media_type, MediaType::Video);
        assert_eq!(post.media[0].source_url, "https://cdn.example/video_1080.mp4");
        assert_eq!(post.media[0].width, Some(1080));
    }

    #[test]
    fn test_extract_carousel() {
        let payload = json!({
            "items": [{
                "code": "CAROUSEL1",
                "carousel_media": [
                    {
                        "image_versions2": {
                            "candidates": [{ "url": "https://cdn.example/img1.jpg", "width": 1080, "height": 1080 }]
                        }
                    },
                    {
                        "video_versions": [{ "url": "https://cdn.example/vid2.mp4", "width": 1080, "height": 1920 }]
                    }
                ]
            }],
            "status": "ok"
        });

        let post = extract_from_media_info(&payload, "CAROUSEL1").expect("Failed to extract");
        assert_eq!(post.media.len(), 2);
        assert_eq!(post.media[0].media_type, MediaType::Image);
        assert_eq!(post.media[0].source_url, "https://cdn.example/img1.jpg");
        assert_eq!(post.media[1].media_type, MediaType::Video);
        assert_eq!(post.media[1].source_url, "https://cdn.example/vid2.mp4");
    }
}
