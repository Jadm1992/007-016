import { describe, expect, test } from "bun:test";
import { classifyUrl } from "../src/url.ts";

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
