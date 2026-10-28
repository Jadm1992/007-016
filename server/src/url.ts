export type ContentKind =
  | "profile"
  | "post"
  | "reel"
  | "tv"
  | "story"
  | "highlight";

export type ClassifiedUrl = {
  kind: ContentKind;
  canonicalUrl: string;
  username?: string;
  shortcode?: string;
  storyId?: string;
  highlightId?: string;
};

const HOSTS = new Set([
  "instagram.com",
  "www.instagram.com",
  "m.instagram.com",
]);
const RESERVED = new Set([
  "p",
  "reel",
  "reels",
  "tv",
  "stories",
  "explore",
  "accounts",
  "direct",
  "about",
]);

function highlightIdFromShare(token: string): string | null {
  try {
    const decoded = Buffer.from(token, "base64").toString("utf8");
    const m = decoded.match(/highlight:?(\d+)/i);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

// Pages to open for a highlight, in order. The pasted URL stays first so a
// stories/highlights link is crawled as itself, and a share link keeps
// story_media_id. The canonical page and the synthetic share form are fallbacks.
export function highlightFetchUrls(inputUrl: string, highlightId: string): string[] {
  const canonical = `https://www.instagram.com/stories/highlights/${highlightId}/`;
  const token = Buffer.from(`highlight:${highlightId}`, "utf8").toString("base64").replace(/=+$/, "");
  const share = `https://www.instagram.com/s/${token}/`;
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const raw of [inputUrl.trim(), canonical, share]) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      continue;
    }
    url.hash = "";
    const key = `${url.origin}${url.pathname.replace(/\/+$/, "")}${url.search}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!url.pathname.endsWith("/")) url.pathname += "/";
    urls.push(url.toString());
  }
  return urls;
}

// FastDl's highlight fetch: i.instagram.com reels_media with the iOS app id.
// A WebView cookie containing ds_user_id is required for gated highlights.
export function highlightReelsMediaRequest(
  highlightId: string,
  cookieHeader = "",
): { url: string; headers: Record<string, string> } {
  const headers: Record<string, string> = {
    "User-Agent":
      "Instagram 275.0.0.27.98 (iPhone14,3; iOS 15_5; en_US; en-US; scale=3.00; 1284x2778; 458234631) AppleWebKit/420+",
    "X-IG-App-ID": "124024574287414",
    "X-ASBD-ID": "359341",
    "X-IG-WWW-Claim": "0",
    Origin: "https://www.instagram.com",
    Accept: "*/*",
  };
  if (cookieHeader) headers.Cookie = cookieHeader;
  return {
    url: `https://i.instagram.com/api/v1/feed/reels_media/?reel_ids=${encodeURIComponent(`highlight:${highlightId}`)}`,
    headers,
  };
}

const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/**
 * Converts an Instagram base64 shortcode to a 64-bit numeric media ID.
 * e.g. CtKBzvqp9RA -> 3119313645828822080
 */
export function shortcodeToMediaId(shortcode: string): string {
  let id = 0n;
  for (let i = 0; i < shortcode.length; i++) {
    const idx = B64_ALPHABET.indexOf(shortcode[i]!);
    if (idx === -1) throw new Error(`Invalid shortcode character: ${shortcode[i]}`);
    id = id * 64n + BigInt(idx);
  }
  return id.toString();
}

/**
 * Converts a 64-bit numeric media ID back to an Instagram base64 shortcode.
 */
export function mediaIdToShortcode(mediaId: string): string {
  let id = BigInt(mediaId);
  if (id === 0n) return B64_ALPHABET[0]!;
  let res = "";
  while (id > 0n) {
    const rem = Number(id % 64n);
    res = B64_ALPHABET[rem]! + res;
    id = id / 64n;
  }
  return res;
}

/**
 * FastDl's post/reel fetch: i.instagram.com media info with the iOS app id.
 */
export function postMediaInfoRequest(
  mediaId: string,
  cookieHeader = "",
): { url: string; headers: Record<string, string> } {
  const headers: Record<string, string> = {
    "User-Agent":
      "Instagram 275.0.0.27.98 (iPhone14,3; iOS 15_5; en_US; en-US; scale=3.00; 1284x2778; 458234631) AppleWebKit/420+",
    "X-IG-App-ID": "124024574287414",
    "X-ASBD-ID": "359341",
    "X-IG-WWW-Claim": "0",
    Accept: "*/*",
  };
  if (cookieHeader) headers.Cookie = cookieHeader;
  return {
    url: `https://i.instagram.com/api/v1/media/${encodeURIComponent(mediaId)}/info/`,
    headers,
  };
}

/**
 * FastDl's Snabrix fallback gateway URL.
 */
export function snabrixGatewayUrl(targetUrl: string, lang = "en"): string {
  return `https://snabrix.com/${lang}?url=${encodeURIComponent(targetUrl)}&from_app=true&utm_source=from_app`;
}

// Normalizes an Instagram URL and classifies it. Throws on anything unsupported.
export function classifyUrl(input: string): ClassifiedUrl {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error(`Invalid URL: ${input}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new Error(`Unsupported protocol: ${input}`);
  if (!HOSTS.has(url.hostname.toLowerCase()))
    throw new Error(`Not an Instagram URL: ${input}`);

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length === 0)
    throw new Error(`No Instagram content path in URL: ${input}`);

  if (parts[0] === "stories" && parts[1] === "highlights" && parts[2]) {
    const highlightId = parts[2];
    if (!/^[A-Za-z0-9_-]+$/.test(highlightId))
      throw new Error(`Invalid highlight id in URL: ${input}`);
    return {
      kind: "highlight",
      canonicalUrl: `https://www.instagram.com/stories/highlights/${highlightId}/`,
      highlightId,
      storyId: highlightId,
    };
  }

  if (parts[0] === "s" && parts[1]) {
    const highlightId = highlightIdFromShare(parts[1]);
    if (highlightId) {
      return {
        kind: "highlight",
        canonicalUrl: `https://www.instagram.com/stories/highlights/${highlightId}/`,
        highlightId,
        storyId: highlightId,
      };
    }
  }

  if (parts[0] === "stories" && parts[1]) {
    const username = parts[1].toLowerCase();
    const storyId = parts[2];
    const canonicalUrl = storyId
      ? `https://www.instagram.com/stories/${username}/${storyId}/`
      : `https://www.instagram.com/stories/${username}/`;
    return { kind: "story", canonicalUrl, username, storyId };
  }

  if (
    (parts[0] === "p" || parts[0] === "reel" || parts[0] === "tv") &&
    parts[1]
  ) {
    const shortcode = parts[1];
    if (!/^[A-Za-z0-9_-]+$/.test(shortcode))
      throw new Error(`Invalid shortcode in URL: ${input}`);
    const kind: ContentKind =
      parts[0] === "p" ? "post" : parts[0] === "reel" ? "reel" : "tv";
    return {
      kind,
      canonicalUrl: `https://www.instagram.com/${parts[0]}/${shortcode}/`,
      shortcode,
    };
  }

  if (
    parts.length >= 3 &&
    (parts[1] === "p" || parts[1] === "reel" || parts[1] === "tv")
  ) {
    const username = parts[0]!.toLowerCase();
    const shortcode = parts[2]!;
    if (!/^[A-Za-z0-9_-]+$/.test(shortcode))
      throw new Error(`Invalid shortcode in URL: ${input}`);
    const kind: ContentKind =
      parts[1] === "p" ? "post" : parts[1] === "reel" ? "reel" : "tv";
    return {
      kind,
      canonicalUrl: `https://www.instagram.com/${parts[1]}/${shortcode}/`,
      username,
      shortcode,
    };
  }

  if (parts.length === 1 && !RESERVED.has(parts[0]!.toLowerCase())) {
    const username = parts[0]!.toLowerCase();
    if (!/^[A-Za-z0-9._]+$/.test(username))
      throw new Error(`Invalid username in URL: ${input}`);
    return {
      kind: "profile",
      canonicalUrl: `https://www.instagram.com/${username}/`,
      username,
    };
  }

  throw new Error(`Unsupported Instagram URL: ${input}`);
}
