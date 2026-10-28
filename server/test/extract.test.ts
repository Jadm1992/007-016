import { describe, expect, test } from "bun:test";
import {
  ExtractionError,
  extractHighlightFromHtml,
  extractHighlightFromPayloads,
  extractPost,
  extractPostFromMediaInfo,
  extractFromSnabrixPayload,
  postLinksFromHrefs,
} from "../src/extract.ts";

const base = {
  canonicalUrl: "https://www.instagram.com/p/CAR123/",
  shortcode: "CAR123",
  kind: "post" as const,
  username: "alice",
};

function page(node: unknown, extraScripts = ""): string {
  return `<html><head>
<meta property="og:image" content="https://cdn.example/fallback.jpg?a=1&b=2">
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
      {
        index: 0,
        type: "image",
        sourceUrl: "https://cdn.example/big.jpg",
        width: 1080,
        height: 1350,
        mimeType: "image/jpeg",
        status: "pending",
      },
      {
        index: 1,
        type: "video",
        sourceUrl: "https://cdn.example/clip-high.mp4",
        width: 720,
        height: 1280,
        mimeType: "video/mp4",
        status: "pending",
      },
    ]);
    expect(r.caption).toBe("two items");
    expect(r.likeCount).toBe(42);
    expect(r.commentCount).toBe(3);
    expect(r.takenAt).toBe(new Date(1700000000 * 1000).toISOString());
  });

  test("extracts a single video node", () => {
    const node = {
      code: "CAR123",
      video_versions: [
        { url: "https://cdn.example/reel.mp4", width: 1080, height: 1920 },
      ],
    };
    const r = extractPost({ ...base, kind: "reel", html: page(node) });
    expect(r.media).toHaveLength(1);
    expect(r.media[0]).toMatchObject({
      type: "video",
      sourceUrl: "https://cdn.example/reel.mp4",
    });
  });

  test("falls back to Open Graph tags and marks the record partial", () => {
    const r = extractPost({
      ...base,
      html: '<html><meta property="og:image" content="https://cdn.example/p.jpg?x=1&y=2"></html>',
    });
    expect(r.extractionStatus).toBe("partial");
    expect(r.media[0]?.sourceUrl).toBe("https://cdn.example/p.jpg?x=1&y=2");
    expect(r.errors.join(" ")).toContain("Open Graph fallback");
  });

  test("skips malformed carousel items and records an error for each", () => {
    const node = {
      code: "CAR123",
      carousel_media: [
        null,
        {
          image_versions2: {
            candidates: [
              { url: "https://cdn.example/ok.jpg", width: 1, height: 1 },
            ],
          },
        },
        {},
      ],
    };
    const r = extractPost({ ...base, html: page(node) });
    expect(r.extractionStatus).toBe("partial");
    expect(r.media.map((m) => m.sourceUrl)).toEqual([
      "https://cdn.example/ok.jpg",
    ]);
    expect(r.errors).toHaveLength(2);
  });

  test("ignores malformed embedded JSON blocks and still uses a valid one", () => {
    const broken = `<script type="application/json">{"shortcode": broken</script>`;
    const r = extractPost({ ...base, html: page(carousel, broken) });
    expect(r.media).toHaveLength(2);
  });

  test("throws a malformed_metadata error when no media exists", () => {
    expect(() => extractPost({ ...base, html: "<html></html>" })).toThrow(
      ExtractionError,
    );
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
        {
          image_versions2: {
            candidates: [
              { url: "https://cdn.example/same.jpg", width: 1, height: 1 },
            ],
          },
        },
        {
          image_versions2: {
            candidates: [
              { url: "https://cdn.example/same.jpg", width: 1, height: 1 },
            ],
          },
        },
      ],
    };
    const r = extractPost({ ...base, html: page(node) });
    expect(r.media).toHaveLength(1);
  });
});

describe("extractHighlightFromHtml", () => {
  test("reads every item from the matching highlight", () => {
    const highlight = {
      id: "highlight:1811087760130222",
      items: [
        {
          pk: "111",
          image_versions2: {
            candidates: [
              { url: "https://cdn.example/h-small.jpg", width: 150, height: 150 },
              { url: "https://cdn.example/h-big.jpg", width: 1080, height: 1920 },
            ],
          },
        },
        {
          pk: "222",
          video_versions: [
            { url: "https://cdn.example/h-low.mp4", width: 360, height: 640 },
            { url: "https://cdn.example/h-high.mp4", width: 720, height: 1280 },
          ],
        },
      ],
    };
    const html = `<html><body><script type="application/json">${JSON.stringify({ highlight })}</script></body></html>`;
    const records = extractHighlightFromHtml(
      html,
      "1811087760130222",
      "https://www.instagram.com/stories/highlights/1811087760130222/",
    );
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      kind: "highlight",
      shortcode: "111",
      media: [{ type: "image", sourceUrl: "https://cdn.example/h-big.jpg" }],
    });
    expect(records[1]).toMatchObject({
      kind: "highlight",
      shortcode: "222",
      media: [{ type: "video", sourceUrl: "https://cdn.example/h-high.mp4" }],
    });
  });
});

describe("extractHighlightFromPayloads", () => {
  test("reads items from FastDl's reels_media response", () => {
    const body = JSON.stringify({
      reels: {
        "highlight:18118228273512957": {
          id: "highlight:18118228273512957",
          items: [
            {
              pk: "3622677443140414407",
              video_versions: [{ url: "https://cdn.example/story.mp4", width: 720, height: 1280 }],
            },
          ],
        },
      },
      status: "ok",
    });
    const records = extractHighlightFromPayloads(
      [body],
      "18118228273512957",
      "https://www.instagram.com/stories/highlights/18118228273512957/",
    );
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      kind: "highlight",
      shortcode: "3622677443140414407",
      media: [{ type: "video", sourceUrl: "https://cdn.example/story.mp4" }],
    });
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

describe("extractPostFromMediaInfo", () => {
  test("parses mobile API response with video post", () => {
    const apiResponse = {
      items: [
        {
          id: "3119313645828822080_12345",
          code: "CtKBzvqp9RA",
          media_type: 2,
          taken_at: 1710000000,
          like_count: 500,
          comment_count: 25,
          caption: { text: "Cool video" },
          user: { username: "bob" },
          video_versions: [
            { url: "https://cdn.example/video_1080.mp4", width: 1080, height: 1920 },
            { url: "https://cdn.example/video_720.mp4", width: 720, height: 1280 },
          ],
        },
      ],
      status: "ok",
    };

    const record = extractPostFromMediaInfo(
      apiResponse,
      "https://www.instagram.com/reel/CtKBzvqp9RA/",
      "CtKBzvqp9RA",
    );

    expect(record.shortcode).toBe("CtKBzvqp9RA");
    expect(record.kind).toBe("reel");
    expect(record.username).toBe("bob");
    expect(record.caption).toBe("Cool video");
    expect(record.likeCount).toBe(500);
    expect(record.media).toHaveLength(1);
    expect(record.media[0]!.type).toBe("video");
    expect(record.media[0]!.sourceUrl).toBe("https://cdn.example/video_1080.mp4");
  });

  test("parses mobile API response with carousel", () => {
    const apiResponse = {
      items: [
        {
          id: "1234567_89",
          code: "CAROUSEL1",
          media_type: 8,
          carousel_media: [
            {
              media_type: 1,
              image_versions2: {
                candidates: [{ url: "https://cdn.example/img1.jpg", width: 1080, height: 1080 }],
              },
            },
            {
              media_type: 2,
              video_versions: [{ url: "https://cdn.example/vid2.mp4", width: 1080, height: 1920 }],
            },
          ],
        },
      ],
      status: "ok",
    };

    const record = extractPostFromMediaInfo(
      apiResponse,
      "https://www.instagram.com/p/CAROUSEL1/",
      "CAROUSEL1",
    );

    expect(record.media).toHaveLength(2);
    expect(record.media[0]!.type).toBe("image");
    expect(record.media[0]!.sourceUrl).toBe("https://cdn.example/img1.jpg");
    expect(record.media[1]!.type).toBe("video");
    expect(record.media[1]!.sourceUrl).toBe("https://cdn.example/vid2.mp4");
  });
});

describe("extractFromSnabrixPayload", () => {
  test("extracts signed media.snabrix.com relay URL from gateway HTML", () => {
    const html = `
      <div class="result">
        <a href="https://media.snabrix.com/get?__sig=TEST_SIG&amp;__expires=1793071293&amp;uri=https%3A%2F%2Ffbcdn.net%2Fvid.mp4">Download</a>
      </div>
    `;
    const record = extractFromSnabrixPayload(
      html,
      "https://www.instagram.com/reel/XYZ123/",
      "XYZ123",
      "charlie",
    );

    expect(record).not.toBeNull();
    expect(record!.media[0]!.sourceUrl).toBe(
      "https://media.snabrix.com/get?__sig=TEST_SIG&__expires=1793071293&uri=https%3A%2F%2Ffbcdn.net%2Fvid.mp4",
    );
    expect(record!.media[0]!.type).toBe("video");
  });
});
