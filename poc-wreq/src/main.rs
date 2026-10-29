
use wreq::Client;
use wreq_util::Emulation;

fn shortcode_to_media_id(shortcode: &str) -> u64 {
    let alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut media_id: u64 = 0;
    for c in shortcode.chars() {
        if let Some(idx) = alphabet.find(c) {
            media_id = media_id * 64 + (idx as u64);
        }
    }
    media_id
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Test shortcode conversion
    let shortcode = "DFb-0q_M26f";
    let media_id = shortcode_to_media_id(shortcode);
    println!("Shortcode: {} -> Media ID: {}", shortcode, media_id);

    // Let's test with wreq
    let client = Client::builder()
        .emulation(Emulation::Safari26) // Safari / iOS profile
        .build()?;

    let url = format!("https://i.instagram.com/api/v1/media/{}/info/", media_id);
    println!("Calling URL: {}", url);

    let resp = client.get(&url)
        .header("User-Agent", "Instagram 275.0.0.27.98 (iPhone14,3; iOS 15_5; en_US; en-US; scale=3.00; 1284x2778; 458234631) AppleWebKit/420+")
        .header("x-asbd-id", "359341")
        .header("x-ig-app-id", "124024574287414")
        .header("x-ig-www-claim", "0")
        .header("Accept", "*/*")
        .send()
        .await?;

    println!("Status: {}", resp.status());
    let body = resp.text().await?;
    println!("Body length: {}", body.len());
    println!("Body preview (first 400 chars):
{}", &body[..std::cmp::min(400, body.len())]);

    Ok(())
}
