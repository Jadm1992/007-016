use base64::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum MediaType {
    Image,
    Video,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ContentKind {
    Post,
    Reel,
    Tv,
    Story,
    Highlight,
    Profile,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClassifiedUrl {
    pub kind: ContentKind,
    pub canonical_url: String,
    pub shortcode: Option<String>,
    pub highlight_id: Option<String>,
    pub username: Option<String>,
    pub story_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MediaItem {
    pub index: usize,
    #[serde(rename = "type")]
    pub media_type: MediaType,
    #[serde(rename = "sourceUrl")]
    pub source_url: String,
    pub status: String,
    #[serde(rename = "localPath", skip_serializing_if = "Option::is_none")]
    pub local_path: Option<String>,
    pub width: Option<u64>,
    pub height: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ExtractedPost {
    pub shortcode: String,
    #[serde(rename = "canonicalUrl", skip_serializing_if = "Option::is_none")]
    pub canonical_url: Option<String>,
    pub kind: Option<String>,
    pub media: Vec<MediaItem>,
    pub username: Option<String>,
    pub caption: Option<String>,
    #[serde(rename = "likeCount")]
    pub like_count: Option<u64>,
    #[serde(rename = "commentCount")]
    pub comment_count: Option<u64>,
}

/// Helper to decode highlight ID from Instagram /s/{token} share URLs.
fn highlight_id_from_share(token: &str) -> Option<String> {
    let padding_len = (4 - (token.len() % 4)) % 4;
    let padded = format!("{}{}", token, "=".repeat(padding_len));
    let decoded = BASE64_STANDARD.decode(padded.as_bytes()).ok()?;
    let text = String::from_utf8(decoded).ok()?;
    if let Some(stripped) = text.strip_prefix("highlight:") {
        if stripped.chars().all(|c| c.is_ascii_digit()) {
            return Some(stripped.to_string());
        }
    }
    None
}

/// Normalizes and classifies an Instagram URL.
pub fn classify_url(input: &str) -> Result<ClassifiedUrl, String> {
    let raw = input.trim();
    let parsed_url = url::Url::parse(raw).map_err(|e| format!("Invalid URL: {e}"))?;
    let host = parsed_url.host_str().unwrap_or("").to_lowercase();
    if !host.ends_with("instagram.com") {
        return Err(format!("Not an Instagram URL: {raw}"));
    }

    let parts: Vec<&str> = parsed_url
        .path_segments()
        .map(|s| s.filter(|p| !p.is_empty()).collect())
        .unwrap_or_default();

    if parts.is_empty() {
        return Err(format!("No Instagram content path in URL: {raw}"));
    }

    // /stories/highlights/{id}
    if parts.len() >= 3 && parts[0] == "stories" && parts[1] == "highlights" {
        let highlight_id = parts[2].to_string();
        return Ok(ClassifiedUrl {
            kind: ContentKind::Highlight,
            canonical_url: format!("https://www.instagram.com/stories/highlights/{highlight_id}/"),
            shortcode: None,
            highlight_id: Some(highlight_id.clone()),
            username: None,
            story_id: Some(highlight_id),
        });
    }

    // /s/{token} share link
    if parts.len() >= 2 && parts[0] == "s" {
        if let Some(highlight_id) = highlight_id_from_share(parts[1]) {
            return Ok(ClassifiedUrl {
                kind: ContentKind::Highlight,
                canonical_url: format!("https://www.instagram.com/stories/highlights/{highlight_id}/"),
                shortcode: None,
                highlight_id: Some(highlight_id.clone()),
                username: None,
                story_id: Some(highlight_id),
            });
        }
    }

    // /stories/{username}/{story_id?}
    if parts.len() >= 2 && parts[0] == "stories" {
        let username = parts[1].to_lowercase();
        let story_id = parts.get(2).map(|s| s.to_string());
        let canonical_url = if let Some(ref sid) = story_id {
            format!("https://www.instagram.com/stories/{username}/{sid}/")
        } else {
            format!("https://www.instagram.com/stories/{username}/")
        };
        return Ok(ClassifiedUrl {
            kind: ContentKind::Story,
            canonical_url,
            shortcode: None,
            highlight_id: None,
            username: Some(username),
            story_id,
        });
    }

    // /p/{shortcode}, /reel/{shortcode}, /tv/{shortcode}
    if parts.len() >= 2 && (parts[0] == "p" || parts[0] == "reel" || parts[0] == "tv") {
        let kind = match parts[0] {
            "reel" => ContentKind::Reel,
            "tv" => ContentKind::Tv,
            _ => ContentKind::Post,
        };
        let shortcode = parts[1].to_string();
        return Ok(ClassifiedUrl {
            kind,
            canonical_url: format!("https://www.instagram.com/{}/{shortcode}/", parts[0]),
            shortcode: Some(shortcode),
            highlight_id: None,
            username: None,
            story_id: None,
        });
    }

    // /{username}/reel/{shortcode} or /{username}/p/{shortcode}
    if parts.len() >= 3 && (parts[1] == "p" || parts[1] == "reel" || parts[1] == "tv") {
        let username = parts[0].to_lowercase();
        let shortcode = parts[2].to_string();
        let kind = match parts[1] {
            "reel" => ContentKind::Reel,
            "tv" => ContentKind::Tv,
            _ => ContentKind::Post,
        };
        return Ok(ClassifiedUrl {
            kind,
            canonical_url: format!("https://www.instagram.com/{}/{shortcode}/", parts[1]),
            shortcode: Some(shortcode),
            highlight_id: None,
            username: Some(username),
            story_id: None,
        });
    }

    // Profile /{username}
    if parts.len() == 1 {
        let username = parts[0].to_lowercase();
        return Ok(ClassifiedUrl {
            kind: ContentKind::Profile,
            canonical_url: format!("https://www.instagram.com/{username}/"),
            shortcode: None,
            highlight_id: None,
            username: Some(username),
            story_id: None,
        });
    }

    Err(format!("Unsupported Instagram URL: {raw}"))
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

    let username = item.get_str(&["user", "username"]).map(|s| s.to_string());
    let caption = item.get_str(&["caption", "text"]).map(|s| s.to_string());
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
        canonical_url: None,
        kind: Some("post".to_string()),
        media,
        username,
        caption,
        like_count,
        comment_count,
    })
}

fn extract_media_entry(entry: &Value, index: usize) -> Option<MediaItem> {
    if let Some(videos) = entry.get("video_versions").and_then(|v| v.as_array()) {
        if let Some(best) = videos.first() {
            if let Some(url) = best.get_str(&["url"]) {
                return Some(MediaItem {
                    index,
                    media_type: MediaType::Video,
                    source_url: url.to_string(),
                    status: "saved".to_string(),
                    local_path: None,
                    width: best.get_u64(&["width"]),
                    height: best.get_u64(&["height"]),
                });
            }
        }
    }

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
                    status: "saved".to_string(),
                    local_path: None,
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
    fn test_classify_urls() {
        let post = classify_url("https://www.instagram.com/p/CtKBzvqp9RA/").unwrap();
        assert_eq!(post.kind, ContentKind::Post);
        assert_eq!(post.shortcode.as_deref(), Some("CtKBzvqp9RA"));

        let reel = classify_url("https://instagram.com/reel/CtKBzvqp9RA/?igsh=xyz").unwrap();
        assert_eq!(reel.kind, ContentKind::Reel);
        assert_eq!(reel.shortcode.as_deref(), Some("CtKBzvqp9RA"));

        let highlight = classify_url("https://www.instagram.com/stories/highlights/18118228273512957/").unwrap();
        assert_eq!(highlight.kind, ContentKind::Highlight);
        assert_eq!(highlight.highlight_id.as_deref(), Some("18118228273512957"));

        let story = classify_url("https://www.instagram.com/stories/alice/12345/").unwrap();
        assert_eq!(story.kind, ContentKind::Story);
        assert_eq!(story.username.as_deref(), Some("alice"));
        assert_eq!(story.story_id.as_deref(), Some("12345"));
    }

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
                    { "url": "https://cdn.example/video_1080.mp4", "width": 1080, "height": 1920 }
                ]
            }],
            "status": "ok"
        });

        let post = extract_from_media_info(&payload, "CtKBzvqp9RA").expect("Failed to extract");
        assert_eq!(post.shortcode, "CtKBzvqp9RA");
        assert_eq!(post.media.len(), 1);
        assert_eq!(post.media[0].media_type, MediaType::Video);
        assert_eq!(post.media[0].status, "saved");
    }
}
