export type ContentKind = "profile" | "post" | "reel" | "tv" | "story";

export type ClassifiedUrl = {
  kind: ContentKind;
  canonicalUrl: string;
  username?: string;
  shortcode?: string;
  storyId?: string;
};

const HOSTS = new Set(["instagram.com", "www.instagram.com", "m.instagram.com"]);
const RESERVED = new Set(["p", "reel", "reels", "tv", "stories", "explore", "accounts", "direct", "about"]);

// Normalizes an Instagram URL and classifies it. Throws on anything unsupported.
export function classifyUrl(input: string): ClassifiedUrl {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error(`Invalid URL: ${input}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`Unsupported protocol: ${input}`);
  if (!HOSTS.has(url.hostname.toLowerCase())) throw new Error(`Not an Instagram URL: ${input}`);

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length === 0) throw new Error(`No Instagram content path in URL: ${input}`);

  if (parts[0] === "stories" && parts[1]) {
    const username = parts[1].toLowerCase();
    const storyId = parts[2];
    const canonicalUrl = storyId
      ? `https://www.instagram.com/stories/${username}/${storyId}/`
      : `https://www.instagram.com/stories/${username}/`;
    return { kind: "story", canonicalUrl, username, storyId };
  }

  if ((parts[0] === "p" || parts[0] === "reel" || parts[0] === "tv") && parts[1]) {
    const shortcode = parts[1];
    if (!/^[A-Za-z0-9_-]+$/.test(shortcode)) throw new Error(`Invalid shortcode in URL: ${input}`);
    const kind: ContentKind = parts[0] === "p" ? "post" : parts[0] === "reel" ? "reel" : "tv";
    return {
      kind,
      canonicalUrl: `https://www.instagram.com/${parts[0]}/${shortcode}/`,
      shortcode,
    };
  }

  // /<user>/p/<code>/ and /<user>/reel/<code>/ forms
  if (parts.length >= 3 && (parts[1] === "p" || parts[1] === "reel" || parts[1] === "tv")) {
    const username = parts[0]!.toLowerCase();
    const shortcode = parts[2]!;
    if (!/^[A-Za-z0-9_-]+$/.test(shortcode)) throw new Error(`Invalid shortcode in URL: ${input}`);
    const kind: ContentKind = parts[1] === "p" ? "post" : parts[1] === "reel" ? "reel" : "tv";
    return {
      kind,
      canonicalUrl: `https://www.instagram.com/${parts[1]}/${shortcode}/`,
      username,
      shortcode,
    };
  }

  if (parts.length === 1 && !RESERVED.has(parts[0]!.toLowerCase())) {
    const username = parts[0]!.toLowerCase();
    if (!/^[A-Za-z0-9._]+$/.test(username)) throw new Error(`Invalid username in URL: ${input}`);
    return { kind: "profile", canonicalUrl: `https://www.instagram.com/${username}/`, username };
  }

  throw new Error(`Unsupported Instagram URL: ${input}`);
}
