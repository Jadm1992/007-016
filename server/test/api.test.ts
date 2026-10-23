import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildHandler, loadJob } from "../src/api.ts";
import type { CrawlOptions } from "../src/crawler.ts";

let tmp: string;
let base: string;
let server: ReturnType<typeof Bun.serve>;

beforeAll(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "dropclip-api-"));
  const handle = buildHandler(tmp, (inputUrl) => ({ inputUrl, outDir: tmp } as CrawlOptions));
  server = Bun.serve({ port: 0, fetch: handle });
  base = server.url.href;
});

afterAll(async () => {
  server.stop(true);
  await rm(tmp, { recursive: true, force: true });
});

describe("backend API", () => {
  test("rejects a non-Instagram URL with 400 and creates no job", async () => {
    const r = await fetch(`${base}jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/x" }),
    });
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: string }).error).toContain("Not an Instagram URL");
  });

  test("rejects a body that is not JSON", async () => {
    const r = await fetch(`${base}jobs`, { method: "POST", body: "nope" });
    expect(r.status).toBe(400);
  });

  test("accepts a valid URL with 202 and returns a queued job that can be fetched", async () => {
    const r = await fetch(`${base}jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://www.instagram.com/p/ABC123/" }),
    });
    expect(r.status).toBe(202);
    const job = (await r.json()) as { id: string; status: string; inputUrl: string };
    expect(job.inputUrl).toBe("https://www.instagram.com/p/ABC123/");
    expect(["queued", "running", "failed", "succeeded"]).toContain(job.status);
    const got = await fetch(`${base}jobs/${job.id}`);
    expect(got.status).toBe(200);
    expect(((await got.json()) as { id: string }).id).toBe(job.id);
  });

  test("returns 404 for an unknown or malformed job id", async () => {
    expect((await fetch(`${base}jobs/00000000-0000-4000-8000-000000000000`)).status).toBe(404);
    expect((await fetch(`${base}jobs/not-a-uuid`)).status).toBe(404);
  });

  test("loadJob rejects path-like ids", async () => {
    expect(await loadJob(path.join(tmp, "jobs"), "../../etc/passwd")).toBeNull();
  });

  test("serves a saved media file and refuses traversal or job files", async () => {
    await mkdir(path.join(tmp, "acct", "ABC"), { recursive: true });
    await writeFile(path.join(tmp, "acct", "ABC", "01.jpg"), "jpegbytes");
    const ok = await fetch(`${base}media/acct/ABC/01.jpg`);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("jpegbytes");
    expect((await fetch(`${base}media/..%2F..%2Fetc%2Fpasswd`)).status).toBe(404);
    expect((await fetch(`${base}media/acct/missing.jpg`)).status).toBe(404);
    expect((await fetch(`${base}media/jobs/x.json`)).status).toBe(404);
  });
});
