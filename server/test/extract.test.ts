import { describe, expect, test } from "bun:test";
import { extractPost, postLinksFromHrefs, ExtractionError } from "../src/extract.ts";

const base = {
  canonicalUrl: "https://www.instagram.com/p/CAR123/",
  shortcode: "CAR123",
  kind: "post" as const,
  username: "alice",
};

// Embedded page JSON shaped like Instagram's media nodes.
function page(node: unknown, extraScripts = ""): string {
  return `<html><head>
<meta property="og:image" content="https://cdn.example/fallback.jpg?a=1&amp;b=2">
<meta property="og:description" content="fallback caption">
</head><body>
<script type="application/json" data-sjs>${JSON.stringify({ require: [["x", { items: [node] }]] })}</script>
${extraScripts}
</body></html>`;
}

const carousel = {
  code: "CAR123",
  taken_at: 1700000000,
  like_count: 42,
  comment_count: 3,
  caption: { text: "two items" },
  carousel_media: [
    {
      image_versions2: {
        candidates: [
          { url: "https://cdn.example/small.jpg", width: 150, height: 150 },
          { url: "https://cdn.example/big.jpg", width: 1080, height: 1350 },
        ],
      },
    },
    {
      video_versions: [
        { url: "https://cdn.example/clip-low.mp4", width: 360, height: 640 },
        { url: "https://cdn.example/clip-high.mp4", width: 720, height: 1280 },
      ],
    },
  ],
};

describe("extractPost", () => {
  test("extracts every carousel item at the best resolution", () => {
    const r = extractPost({ ...base, html: page(carousel) });
    expect(r.extractionStatus).toBe("complete");
    expect(r.media).toEqual([
      { index: 0, type: "image", sourceUrl: "https://cdn.example/big.jpg", width: 1080, height: 1350, mimeType: "image/jpeg", status: "pending" },
      { index: 1, type: "video", sourceUrl: "https://cdn.example/clip-high.mp4", width: 720, height: 1280, mimeType: "video/mp4", status: "pending" },
    ]);
    expect(r.caption).toBe("two items");
    expect(r.likeCount).toBe(42);
    expect(r.commentCount).toBe(3);
    expect(r.takenAt).toBe(new Date(1700000000 * 1000).toISOString());
  });

  test("extracts a single video node", () => {
    const node = {
      code: "CAR123",
      video_versions: [{ url: "https://cdn.example/reel.mp4", width: 1080, height: 1920 }],
    };
    const r = extractPost({ ...base, kind: "reel", html: page(node) });
    expect(r.media).toHaveLength(1);
    expect(r.media[0]).toMatchObject({ type: "video", sourceUrl: "https://cdn.example/reel.mp4" });
  });

  test("falls back to Open Graph tags and marks the record partial", () => {
    const r = extractPost({ ...base, html: "<html><meta property=\"og:image\" content=\"https://cdn.example/p.jpg?x=1&amp;y=2\"></html>" });
    expect(r.extractionStatus).toBe("partial");
    expect(r.media[0]?.sourceUrl).toBe("https://cdn.example/p.jpg?x=1&y=2");
    expect(r.errors.join(" ")).toContain("Open Graph fallback");
  });

  test("skips malformed carousel items and records an error for each", () => {
    const node = { code: "CAR123", carousel_media: [null, { image_versions2: { candidates: [{ url: "https://cdn.example/ok.jpg", width: 1, height: 1 }] } }, {}] };
    const r = extractPost({ ...base, html: page(node) });
    expect(r.extractionStatus).toBe("partial");
    expect(r.media.map((m) => m.sourceUrl)).toEqual(["https://cdn.example/ok.jpg"]);
    expect(r.errors).toHaveLength(2);
  });

  test("ignores malformed embedded JSON blocks and still uses a valid one", () => {
    const broken = `<script type="application/json">{"shortcode": broken</script>`;
    const r = extractPost({ ...base, html: page(carousel, broken) });
    expect(r.media).toHaveLength(2);
  });

  test("throws a malformed_metadata error when no media exists", () => {
    expect(() => extractPost({ ...base, html: "<html></html>" })).toThrow(ExtractionError);
    try {
      extractPost({ ...base, html: "<html></html>" });
    } catch (err) {
      expect((err as ExtractionError).kind).toBe("malformed_metadata");
    }
  });

  test("drops duplicate media URLs", () => {
    const node = {
      code: "CAR123",
      carousel_media: [
        { image_versions2: { candidates: [{ url: "https://cdn.example/same.jpg", width: 1, height: 1 }] } },
        { image_versions2: { candidates: [{ url: "https://cdn.example/same.jpg", width: 1, height: 1 }] } },
      ],
    };
    const r = extractPost({ ...base, html: page(node) });
    expect(r.media).toHaveLength(1);
  });
});

describe("postLinksFromHrefs", () => {
  test("keeps post, reel, and tv links in order, canonicalized and deduplicated", () => {
    const links = postLinksFromHrefs([
      "/alice/reel/AAA111/",
      "/p/BBB222/?img_index=2",
      "/alice/",
      "/p/BBB222/",
      "/tv/CCC333/",
      "https://www.instagram.com/p/DDD444/",
    ]);
    expect(links).toEqual([
      "https://www.instagram.com/reel/AAA111/",
      "https://www.instagram.com/p/BBB222/",
      "https://www.instagram.com/tv/CCC333/",
      "https://www.instagram.com/p/DDD444/",
    ]);
  });
});
