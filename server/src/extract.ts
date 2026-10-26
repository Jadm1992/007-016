import type { FailureKind, MediaItem, PostRecord } from "./types.ts";

export type ExtractionInput = {
  html: string;
  canonicalUrl: string;
  shortcode: string;
  kind: PostRecord["kind"];
  username?: string;
};

export class ExtractionError extends Error {
  constructor(
    message: string,
    readonly kind: FailureKind,
  ) {
    super(message);
    this.name = "ExtractionError";
  }
}

export function decodeHtml(s: string): string {
  return s
    .replace(/&/g, "&")
    .replace(/"/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/</g, "<")
    .replace(/>/g, ">");
}

export function metaContent(
  html: string,
  attr: "property" | "name",
  key: string,
): string | null {
  const re = new RegExp(`<meta[^>]*${attr}="${key}"[^>]*>`, "i");
  const tag = html.match(re)?.[0];
  if (!tag) return null;
  const content = tag.match(/content="([^"]*)"/i)?.[1];
  return content === undefined ? null : decodeHtml(content);
}

export function jsonLdBlocks(
  html: string,
): { value: unknown; malformed: boolean }[] {
  const out: { value: unknown; malformed: boolean }[] = [];
  const re =
    /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    try {
      out.push({ value: JSON.parse(m[1] ?? ""), malformed: false });
    } catch {
      out.push({ value: null, malformed: true });
    }
  }
  return out;
}

type AnyObj = Record<string, unknown>;
const isObj = (v: unknown): v is AnyObj =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function bestCandidate(
  versions: unknown,
): { url: string; width?: number; height?: number } | null {
  if (!Array.isArray(versions)) return null;
  let best: { url: string; width?: number; height?: number } | null = null;
  for (const v of versions) {
    if (!isObj(v) || typeof v.url !== "string") continue;
    const width = typeof v.width === "number" ? v.width : undefined;
    const height = typeof v.height === "number" ? v.height : undefined;
    if (
      !best ||
      (width ?? 0) * (height ?? 0) > (best.width ?? 0) * (best.height ?? 0)
    ) {
      best = { url: v.url, width, height };
    }
  }
  return best;
}

export function mediaFromNode(node: AnyObj, index: number): MediaItem | null {
  const isVideo =
    node.is_video === true ||
    node.media_type === 2 ||
    (Array.isArray(node.video_versions) && node.video_versions.length > 0) ||
    typeof node.video_url === "string" ||
    typeof node.video_duration === "number";

  if (isVideo) {
    const video = bestCandidate(node.video_versions);
    if (video) {
      return {
        index,
        type: "video",
        sourceUrl: video.url,
        width: video.width,
        height: video.height,
        mimeType: "video/mp4",
        status: "pending",
      };
    }
    if (typeof node.video_url === "string") {
      return {
        index,
        type: "video",
        sourceUrl: node.video_url,
        mimeType: "video/mp4",
        status: "pending",
      };
    }
    return null;
  }

  const imageCandidates = isObj(node.image_versions2)
    ? node.image_versions2.candidates
    : undefined;
  const image = bestCandidate(imageCandidates);
  if (image) {
    return {
      index,
      type: "image",
      sourceUrl: image.url,
      width: image.width,
      height: image.height,
      mimeType: "image/jpeg",
      status: "pending",
    };
  }
  if (Array.isArray(node.display_resources)) {
    const res = bestCandidate(
      node.display_resources.map((r: unknown) =>
        isObj(r)
          ? { url: r.src, width: r.config_width, height: r.config_height }
          : null,
      ),
    );
    if (res)
      return {
        index,
        type: "image",
        sourceUrl: res.url,
        width: res.width,
        height: res.height,
        mimeType: "image/jpeg",
        status: "pending",
      };
  }
  if (typeof node.display_url === "string") {
    return {
      index,
      type: "image",
      sourceUrl: node.display_url,
      mimeType: "image/jpeg",
      status: "pending",
    };
  }
  return null;
}

export function findShortcodeNode(
  root: unknown,
  shortcode: string,
): AnyObj | null {
  const stack: unknown[] = [root];
  let seen = 0;
  while (stack.length && seen < 200_000) {
    const cur = stack.pop();
    seen++;
    if (Array.isArray(cur)) {
      for (const v of cur) stack.push(v);
      continue;
    }
    if (!isObj(cur)) continue;
    const matchesCode =
      cur.code === shortcode ||
      cur.shortcode === shortcode ||
      String(cur.id ?? "") === shortcode ||
      String(cur.pk ?? "") === shortcode ||
      (typeof cur.id === "string" && cur.id.startsWith(`${shortcode}_`));
    if (matchesCode) {
      if (
        cur.video_versions !== undefined ||
        cur.image_versions2 !== undefined ||
        cur.carousel_media !== undefined ||
        cur.edge_sidecar_to_children !== undefined ||
        typeof cur.video_url === "string" ||
        typeof cur.display_url === "string"
      ) {
        return cur;
      }
    }
    for (const v of Object.values(cur)) stack.push(v);
  }
  return null;
}

function parseEmbeddedJson(html: string): unknown[] {
  const out: unknown[] = [];
  const re = /<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    const body = m[1] ?? "";
    if (
      !body.includes("shortcode") &&
      !body.includes('"code"') &&
      !body.includes('"pk"') &&
      !body.includes('"video_versions"') &&
      !body.includes('"image_versions2"') &&
      !body.includes('"edge_sidecar_to_children"') &&
      !body.includes("highlight")
    )
      continue;
    try {
      out.push(JSON.parse(body));
    } catch {
      // Malformed embedded blocks are skipped.
    }
  }
  return out;
}

function captionFrom(node: AnyObj): string | null {
  const cap = node.caption;
  if (isObj(cap) && typeof cap.text === "string") return cap.text;
  return null;
}

function numberOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function takenAtFrom(node: AnyObj): string | null {
  const ts = numberOrNull(node.taken_at ?? node.taken_at_timestamp);
  return ts === null ? null : new Date(ts * 1000).toISOString();
}

export function extractPost(input: ExtractionInput): PostRecord {
  const errors: string[] = [];
  const fetchedAt = new Date().toISOString();
  const base = {
    canonicalUrl: input.canonicalUrl,
    shortcode: input.shortcode,
    kind: input.kind,
    username: input.username,
    fetchedAt,
  };

  let node: AnyObj | null = null;
  for (const root of parseEmbeddedJson(input.html)) {
    node = findShortcodeNode(root, input.shortcode);
    if (node) break;
  }

  let media: MediaItem[] = [];
  let caption: string | null = null;
  let takenAt: string | null = null;
  let likeCount: number | null = null;
  let commentCount: number | null = null;

  if (node) {
    caption = captionFrom(node);
    takenAt = takenAtFrom(node);
    likeCount = numberOrNull(node.like_count);
    commentCount = numberOrNull(node.comment_count);
    const carousel =
      node.carousel_media ??
      (isObj(node.edge_sidecar_to_children) &&
      Array.isArray(node.edge_sidecar_to_children.edges)
        ? node.edge_sidecar_to_children.edges.map((e: unknown) =>
            isObj(e) && isObj(e.node) ? e.node : e,
          )
        : undefined);
    if (Array.isArray(carousel)) {
      carousel.forEach((child, i) => {
        if (!isObj(child)) {
          errors.push(`carousel item ${i} is malformed`);
          return;
        }
        const item = mediaFromNode(child, i);
        if (item) media.push(item);
        else errors.push(`carousel item ${i} has no media URL`);
      });
    } else {
      const item = mediaFromNode(node, 0);
      if (item) media.push(item);
    }
  }

  const isKnownVideo =
    (node &&
      (node.is_video === true ||
        node.media_type === 2 ||
        Array.isArray(node.video_versions))) ||
    input.kind === "reel";

  if (media.length === 0) {
    const ogVideo = metaContent(input.html, "property", "og:video");
    const ogImage = metaContent(input.html, "property", "og:image");
    if (ogVideo) {
      media.push({
        index: 0,
        type: "video",
        sourceUrl: ogVideo,
        mimeType: "video/mp4",
        status: "pending",
      });
      errors.push("media taken from Open Graph fallback");
    } else if (ogImage && !isKnownVideo && input.kind !== "reel") {
      media.push({
        index: 0,
        type: "image",
        sourceUrl: ogImage,
        mimeType: "image/jpeg",
        status: "pending",
      });
      errors.push(
        "media taken from Open Graph fallback; carousel items may be missing",
      );
    }
  }

  if (media.length === 0) {
    const domVideo =
      input.html.match(/<video[^>]*src="([^"]+)"[^>]*>/i)?.[1] ??
      input.html.match(
        /<video[^>]*>[\s\S]*?<source[^>]*src="([^"]+)"[^>]*>/i,
      )?.[1];
    const domImage =
      input.html.match(
        /<img[^>]*class="[^"]*(?:story|media|post)[^"]*"[^>]*src="([^"]+)"[^>]*>/i,
      )?.[1] ??
      input.html.match(
        /<img[^>]*src="([^"]+)"[^>]*style="[^"]*object-fit:\s*cover[^"]*"[^>]*>/i,
      )?.[1];

    if (domVideo) {
      media.push({
        index: 0,
        type: "video",
        sourceUrl: decodeHtml(domVideo),
        mimeType: "video/mp4",
        status: "pending",
      });
      errors.push("media extracted from rendered DOM video element");
    } else if (domImage && !isKnownVideo && input.kind !== "reel") {
      media.push({
        index: 0,
        type: "image",
        sourceUrl: decodeHtml(domImage),
        mimeType: "image/jpeg",
        status: "pending",
      });
      errors.push("media extracted from rendered DOM img element");
    }
  }

  if (!caption) caption = metaContent(input.html, "property", "og:description");

  if (media.length === 0) {
    if (isKnownVideo) {
      throw new ExtractionError(
        `No video URL found for video ${input.canonicalUrl} (poster thumbnail cannot be substituted)`,
        "malformed_metadata",
      );
    }
    throw new ExtractionError(
      `No media found for ${input.canonicalUrl}`,
      "malformed_metadata",
    );
  }
  const dedup = new Map<string, MediaItem>();
  for (const m of media) if (!dedup.has(m.sourceUrl)) dedup.set(m.sourceUrl, m);
  media = [...dedup.values()].map((m, i) => ({ ...m, index: i }));

  return {
    ...base,
    caption,
    takenAt,
    likeCount,
    commentCount,
    media,
    extractionStatus: errors.length ? "partial" : "complete",
    errors,
  };
}

export function extractStorySequenceFromHtml(
  html: string,
  canonicalUrl: string,
  username: string,
): PostRecord[] {
  const records: PostRecord[] = [];
  const fetchedAt = new Date().toISOString();

  for (const root of parseEmbeddedJson(html)) {
    const stack: unknown[] = [root];
    let seen = 0;
    while (stack.length && seen < 200_000) {
      const cur = stack.pop();
      seen++;
      if (Array.isArray(cur)) {
        for (const v of cur) stack.push(v);
        continue;
      }
      if (!isObj(cur)) continue;
      const items = Array.isArray(cur.items) ? cur.items : undefined;
      if (
        items &&
        items.length > 0 &&
        isObj(items[0]) &&
        (items[0].media_type !== undefined ||
          items[0].video_versions !== undefined ||
          items[0].image_versions2 !== undefined)
      ) {
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (!isObj(item)) continue;
          const shortcode = String(item.pk ?? item.id ?? `story_${i + 1}`).split("_")[0]!;
          const mediaItem = mediaFromNode(item, 0);
          if (mediaItem) {
            records.push({
              canonicalUrl: `https://www.instagram.com/stories/${username}/${shortcode}/`,
              shortcode,
              kind: "story",
              username,
              caption: captionFrom(item),
              takenAt: takenAtFrom(item),
              likeCount: numberOrNull(item.like_count),
              commentCount: numberOrNull(item.comment_count),
              media: [mediaItem],
              extractionStatus: "complete",
              errors: [],
              fetchedAt,
            });
          }
        }
        if (records.length > 0) return records;
      }
      for (const v of Object.values(cur)) stack.push(v);
    }
  }
  return records;
}

function matchesHighlight(node: AnyObj, highlightId: string): boolean {
  const id = String(node.id ?? node.pk ?? node.highlight_id ?? "");
  return (
    id === highlightId ||
    id === `highlight:${highlightId}` ||
    id.endsWith(`:${highlightId}`) ||
    id.includes(highlightId)
  );
}

function itemsOf(node: AnyObj): AnyObj[] | null {
  const raw = node.items ?? node.media_items ?? node.reel_items;
  if (!Array.isArray(raw)) return null;
  return raw.filter(isObj);
}

function recordsFromItems(
  items: AnyObj[],
  highlightId: string,
  canonicalUrl: string,
): PostRecord[] {
  const fetchedAt = new Date().toISOString();
  const records: PostRecord[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const mediaItem = mediaFromNode(item, 0);
    if (!mediaItem) continue;
    const shortcode = String(item.pk ?? item.id ?? `${highlightId}_${i + 1}`).split("_")[0]!;
    records.push({
      canonicalUrl,
      shortcode,
      kind: "highlight",
      caption: captionFrom(item),
      takenAt: takenAtFrom(item),
      likeCount: numberOrNull(item.like_count),
      commentCount: numberOrNull(item.comment_count),
      media: [mediaItem],
      extractionStatus: "complete",
      errors: [],
      fetchedAt,
    });
  }
  return records;
}

function highlightItemsIn(root: unknown, highlightId: string): AnyObj[] | null {
  const stack: unknown[] = [root];
  let seen = 0;
  let fallback: AnyObj[] | null = null;
  while (stack.length && seen < 200_000) {
    const cur = stack.pop();
    seen++;
    if (Array.isArray(cur)) {
      for (const v of cur) stack.push(v);
      continue;
    }
    if (!isObj(cur)) continue;
    const items = itemsOf(cur);
    if (items && items.length && items.some((item) => mediaFromNode(item, 0))) {
      if (matchesHighlight(cur, highlightId)) return items;
      fallback ??= items;
    }
    for (const v of Object.values(cur)) stack.push(v);
  }
  return fallback;
}

export function extractHighlightFromHtml(
  html: string,
  highlightId: string,
  canonicalUrl: string,
): PostRecord[] {
  for (const root of parseEmbeddedJson(html)) {
    const items = highlightItemsIn(root, highlightId);
    if (items) {
      const records = recordsFromItems(items, highlightId, canonicalUrl);
      if (records.length) return records;
    }
  }
  return [];
}

// Reads highlight items from captured API or GraphQL response bodies.
export function extractHighlightFromPayloads(
  payloads: string[],
  highlightId: string,
  canonicalUrl: string,
): PostRecord[] {
  for (const payload of payloads) {
    if (!payload.includes(highlightId) && !payload.includes("video_versions") && !payload.includes("image_versions2"))
      continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      continue;
    }
    const items = highlightItemsIn(parsed, highlightId);
    if (!items) continue;
    const records = recordsFromItems(items, highlightId, canonicalUrl);
    if (records.length) return records;
  }
  return [];
}

export function postLinksFromHrefs(
  hrefs: string[],
  origin = "https://www.instagram.com",
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /^\/(?:[^/]+\/)?(p|reel|tv)\/([A-Za-z0-9_-]+)\/?$/;
  for (const href of hrefs) {
    let path: string;
    try {
      path = new URL(href, origin).pathname;
    } catch {
      continue;
    }
    const m = path.match(re);
    if (!m) continue;
    const url = `${origin}/${m[1]}/${m[2]}/`;
    if (!seen.has(url)) {
      seen.add(url);
      out.push(url);
    }
  }
  return out;
}
