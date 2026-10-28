import { describe, expect, test } from "bun:test";
import {
  classifyUrl,
  highlightFetchUrls,
  highlightReelsMediaRequest,
  mediaIdToShortcode,
  postMediaInfoRequest,
  shortcodeToMediaId,
  snabrixGatewayUrl,
} from "../src/url.ts";

describe("classifyUrl", () => {
  test("normalizes a profile URL with query and trailing slash", () => {
    const c = classifyUrl("https://WWW.instagram.com/Some.User/?hl=en");
    expect(c.kind).toBe("profile");
    expect(c.username).toBe("some.user");
    expect(c.canonicalUrl).toBe("https://www.instagram.com/some.user/");
  });

  test("classifies post, reel, and tv URLs and keeps the shortcode", () => {
    expect(
      classifyUrl("https://www.instagram.com/p/ABC_12-x/?igsh=1"),
    ).toMatchObject({
      kind: "post",
      shortcode: "ABC_12-x",
      canonicalUrl: "https://www.instagram.com/p/ABC_12-x/",
    });
    expect(classifyUrl("https://instagram.com/reel/XYZ/").kind).toBe("reel");
    expect(classifyUrl("https://instagram.com/tv/XYZ/").kind).toBe("tv");
  });

  test("accepts the user-scoped post form and records the owner", () => {
    const c = classifyUrl("https://www.instagram.com/someone/reel/QWE123/");
    expect(c).toMatchObject({
      kind: "reel",
      shortcode: "QWE123",
      username: "someone",
    });
    expect(c.canonicalUrl).toBe("https://www.instagram.com/reel/QWE123/");
  });

  test("classifies story URLs", () => {
    expect(
      classifyUrl("https://www.instagram.com/stories/alice/3345/"),
    ).toMatchObject({
      kind: "story",
      username: "alice",
      storyId: "3345",
    });
  });

  test("classifies a highlight URL", () => {
    expect(
      classifyUrl("https://www.instagram.com/stories/highlights/1811087760130222/"),
    ).toMatchObject({
      kind: "highlight",
      highlightId: "1811087760130222",
      canonicalUrl:
        "https://www.instagram.com/stories/highlights/1811087760130222/",
    });
  });

  test("classifies a shared highlight token", () => {
    const token = Buffer.from("highlight:1811087760130222").toString("base64");
    expect(
      classifyUrl(`https://www.instagram.com/s/${token}?story_media_id=1`),
    ).toMatchObject({
      kind: "highlight",
      highlightId: "1811087760130222",
      canonicalUrl:
        "https://www.instagram.com/stories/highlights/1811087760130222/",
    });
  });

  test("crawls a stories/highlights URL before the share fallback", () => {
    const input = "https://www.instagram.com/stories/highlights/18118228273512957/";
    const urls = highlightFetchUrls(input, "18118228273512957");
    const token = Buffer.from("highlight:18118228273512957").toString("base64").replace(/=+$/, "");
    expect(urls[0]).toBe(input);
    expect(urls).toContain(`https://www.instagram.com/s/${token}/`);
    expect(urls).toHaveLength(2);
  });

  test("builds FastDl's highlight reels_media request", () => {
    const req = highlightReelsMediaRequest("18118228273512957", "ds_user_id=1; sessionid=abc");
    expect(req.url).toBe(
      "https://i.instagram.com/api/v1/feed/reels_media/?reel_ids=highlight%3A18118228273512957",
    );
    expect(req.headers["X-IG-App-ID"]).toBe("124024574287414");
    expect(req.headers["X-ASBD-ID"]).toBe("359341");
    expect(req.headers.Cookie).toBe("ds_user_id=1; sessionid=abc");
    expect(req.headers["User-Agent"]).toContain("Instagram 275.0.0.27.98");
  });

  test("keeps story_media_id on a shared highlight URL", () => {
    const input =
      "https://www.instagram.com/s/aGlnaGxpZ2h0OjE4MTEwODc3ODYwMTMwMjIy/?story_media_id=3622677443140414407_13131020";
    const urls = highlightFetchUrls(input, "18110877860130222");
    expect(urls[0]).toContain("story_media_id=3622677443140414407_13131020");
    expect(urls.some((u) => u.includes("/stories/highlights/18110877860130222/"))).toBe(true);
  });

  test("rejects other hosts, malformed input, and reserved paths", () => {
    expect(() => classifyUrl("https://example.com/p/abc/")).toThrow(
      "Not an Instagram URL",
    );
    expect(() => classifyUrl("not a url")).toThrow("Invalid URL");
    expect(() => classifyUrl("ftp://www.instagram.com/x/")).toThrow(
      "Unsupported protocol",
    );
    expect(() => classifyUrl("https://www.instagram.com/explore/")).toThrow(
      "Unsupported",
    );
    expect(() => classifyUrl("https://www.instagram.com/p/bad$code/")).toThrow(
      "Invalid shortcode",
    );
    expect(() => classifyUrl("https://www.instagram.com/")).toThrow(
      "No Instagram content path",
    );
  });
});

describe("Instagram Mobile API & Gateway Helpers", () => {
  test("shortcodeToMediaId accurately converts base64 shortcode to 64-bit integer", () => {
    expect(shortcodeToMediaId("CtKBzvqp9RA")).toBe("3119313645828822080");
    expect(mediaIdToShortcode("3119313645828822080")).toBe("CtKBzvqp9RA");
  });

  test("postMediaInfoRequest formats iOS mobile API endpoint with spoofed headers", () => {
    const req = postMediaInfoRequest("3119313645828822080", "sessionid=test_cookie");
    expect(req.url).toBe("https://i.instagram.com/api/v1/media/3119313645828822080/info/");
    expect(req.headers["X-IG-App-ID"]).toBe("124024574287414");
    expect(req.headers["X-ASBD-ID"]).toBe("359341");
    expect(req.headers["X-IG-WWW-Claim"]).toBe("0");
    expect(req.headers["Cookie"]).toBe("sessionid=test_cookie");
  });

  test("snabrixGatewayUrl encodes target url with from_app query params", () => {
    const gateway = snabrixGatewayUrl("https://www.instagram.com/p/ABC_12/");
    expect(gateway).toContain("https://snabrix.com/en?url=");
    expect(gateway).toContain("&from_app=true&utm_source=from_app");
  });
});
