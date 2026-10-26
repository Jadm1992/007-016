import { createWriteStream } from "node:fs";
import { mkdir, open, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { MediaItem } from "./types.ts";

export const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

export type DownloadOptions = {
  timeoutMs: number;
  retries: number;
  maxBytes: number;
  cookieHeader?: string;
};

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mp4",
};

export function detectFileSignature(
  buf: Buffer,
): { type: "image" | "video"; mimeType: string; ext: string } | null {
  if (
    buf.length >= 3 &&
    buf[0] === 0xff &&
    buf[1] === 0xd8 &&
    buf[2] === 0xff
  ) {
    return { type: "image", mimeType: "image/jpeg", ext: "jpg" };
  }
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return { type: "image", mimeType: "image/png", ext: "png" };
  }
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString("ascii") === "RIFF" &&
    buf.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return { type: "image", mimeType: "image/webp", ext: "webp" };
  }
  if (
    buf.length >= 6 &&
    (buf.subarray(0, 6).toString("ascii") === "GIF87a" ||
      buf.subarray(0, 6).toString("ascii") === "GIF89a")
  ) {
    return { type: "image", mimeType: "image/gif", ext: "gif" };
  }
  // MP4 / QuickTime / ISO Base Media: check for 'ftyp' or 'moov' in first 32 bytes
  for (let offset = 4; offset <= Math.min(32, buf.length - 4); offset += 4) {
    const box = buf.subarray(offset, offset + 4).toString("ascii");
    if (box === "ftyp" || box === "moov") {
      return { type: "video", mimeType: "video/mp4", ext: "mp4" };
    }
  }
  // WebM / Matroska
  if (
    buf.length >= 4 &&
    buf[0] === 0x1a &&
    buf[1] === 0x45 &&
    buf[2] === 0xdf &&
    buf[3] === 0xa3
  ) {
    return { type: "video", mimeType: "video/webm", ext: "webm" };
  }
  return null;
}

export function extensionFor(
  contentType: string | null,
  type: MediaItem["type"],
): string {
  const mime = (contentType ?? "").split(";")[0]!.trim().toLowerCase();
  if (EXT_BY_MIME[mime]) return EXT_BY_MIME[mime];
  return type === "video" ? "mp4" : "jpg";
}

export function isAcceptableMime(
  contentType: string | null,
  type: MediaItem["type"],
): boolean {
  if (!contentType) return true;
  const mime = contentType.split(";")[0]!.trim().toLowerCase();
  if (mime === "application/octet-stream" || mime === "binary/octet-stream")
    return true;
  if (type === "video") {
    return (
      mime === "video/mp4" ||
      mime === "video/webm" ||
      mime === "video/quicktime"
    );
  }
  return mime.startsWith("image/");
}

// Filenames come from the item index and extension only, so nothing from the remote URL reaches the disk path.
export function mediaFileName(index: number, ext: string): string {
  return `${String(index + 1).padStart(2, "0")}.${ext}`;
}

export class DownloadError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "DownloadError";
  }
}

async function fetchOnce(
  url: string,
  opts: DownloadOptions,
  dest: string,
  type: MediaItem["type"],
) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
  const headers: Record<string, string> = {
    "User-Agent": UA,
    Referer: "https://www.instagram.com/",
  };
  if (opts.cookieHeader) headers.Cookie = opts.cookieHeader;
  try {
    const res = await fetch(url, {
      headers,
      signal: ctrl.signal,
      redirect: "follow",
    });
    if (res.status === 429)
      throw new DownloadError("HTTP 429 while downloading media", true);
    if (res.status >= 500)
      throw new DownloadError(
        `HTTP ${res.status} while downloading media`,
        true,
      );
    if (!res.ok)
      throw new DownloadError(
        `HTTP ${res.status} while downloading media`,
        false,
      );
    const contentType = res.headers.get("content-type");
    if (!isAcceptableMime(contentType, type)) {
      throw new DownloadError(
        `Unexpected content-type ${contentType} for ${type}`,
        false,
      );
    }
    const declared = Number(res.headers.get("content-length") ?? NaN);
    if (Number.isFinite(declared) && declared > opts.maxBytes) {
      throw new DownloadError(`Declared size ${declared} exceeds limit`, false);
    }
    if (!res.body) throw new DownloadError("Empty response body", true);

    let ext = extensionFor(contentType, type);
    let verifiedMime = (contentType ?? "").split(";")[0]!.trim().toLowerCase();
    const tmpPath = `${dest}.part`;
    let written = 0;
    let headerBytes = Buffer.alloc(0);

    const limit = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        written += chunk.byteLength;
        if (headerBytes.length < 64) {
          headerBytes = Buffer.concat([headerBytes, chunk]).subarray(0, 64);
          const sig = detectFileSignature(headerBytes);
          if (sig && sig.type !== type) {
            cb(
              new DownloadError(
                `Downloaded bytes have ${sig.type} file signature (${sig.mimeType}) but expected ${type}`,
                false,
              ),
            );
            return;
          }
        }
        if (written > opts.maxBytes)
          cb(new DownloadError("Download exceeds size limit", false));
        else cb(null, chunk);
      },
    });

    try {
      await pipeline(
        Readable.fromWeb(res.body as never),
        limit,
        createWriteStream(tmpPath),
      );
      if (written === 0) throw new DownloadError("Downloaded zero bytes", true);

      // Verify file signature from saved disk bytes
      const fd = await open(tmpPath, "r");
      const readBuf = Buffer.alloc(64);
      const { bytesRead } = await fd.read(readBuf, 0, 64, 0);
      await fd.close();
      const detected = detectFileSignature(readBuf.subarray(0, bytesRead));
      if (detected) {
        if (detected.type !== type) {
          throw new DownloadError(
            `Downloaded file signature is ${detected.type} (${detected.mimeType}) but expected ${type}`,
            false,
          );
        }
        ext = detected.ext;
        verifiedMime = detected.mimeType;
      } else {
        // Enforce extension and MIME type match the requested media type
        if (type === "video" && ext !== "mp4" && ext !== "webm") ext = "mp4";
        if (type === "image" && ext === "mp4") ext = "jpg";
        if (!verifiedMime || verifiedMime === "application/octet-stream") {
          verifiedMime = type === "video" ? "video/mp4" : "image/jpeg";
        }
      }

      const finalPath = dest.replace(/\.[^.]+$/, `.${ext}`);
      await rename(tmpPath, finalPath);
      return { path: finalPath, bytes: written, mimeType: verifiedMime };
    } catch (err) {
      await unlink(tmpPath).catch(() => {});
      throw err;
    }
  } catch (err) {
    if (err instanceof DownloadError) throw err;
    if ((err as Error).name === "AbortError")
      throw new DownloadError(`Timed out after ${opts.timeoutMs} ms`, true);
    throw new DownloadError(`Network error: ${(err as Error).message}`, true);
  } finally {
    clearTimeout(timer);
  }
}

// Downloads one media item into dir. Returns the file name (relative to dir) and its size.
export async function downloadMedia(
  item: MediaItem,
  dir: string,
  opts: DownloadOptions,
): Promise<{ fileName: string; bytes: number; mimeType: string }> {
  await mkdir(dir, { recursive: true });
  const dest = path.join(
    dir,
    mediaFileName(item.index, item.type === "video" ? "mp4" : "jpg"),
  );
  let lastErr: unknown;
  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    try {
      const r = await fetchOnce(item.sourceUrl, opts, dest, item.type);
      return {
        fileName: path.basename(r.path),
        bytes: r.bytes,
        mimeType: r.mimeType,
      };
    } catch (err) {
      lastErr = err;
      if (
        !(err instanceof DownloadError) ||
        !err.retryable ||
        attempt === opts.retries
      )
        break;
      await new Promise((r) =>
        setTimeout(r, Math.min(30_000, 1000 * 2 ** attempt)),
      );
    }
  }
  throw lastErr;
}

export async function fileMatches(
  localPath: string,
  bytes: number,
): Promise<boolean> {
  try {
    const s = await stat(localPath);
    return s.isFile() && s.size === bytes;
  } catch {
    return false;
  }
}
