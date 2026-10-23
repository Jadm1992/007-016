import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadJobPosts, type JobState } from "../src/api.ts";

let tmp: string;

beforeAll(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "dropclip-posts-"));
  const dir = path.join(tmp, "acct", "P1");
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "meta.json"),
    JSON.stringify({
      canonicalUrl: "https://www.instagram.com/p/P1/",
      shortcode: "P1",
      kind: "post",
      media: [{ index: 0, type: "image", status: "saved", localPath: "P1/01.jpg", bytes: 3 }],
      extractionStatus: "complete",
      errors: [],
    }),
  );
});

afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});

const job = (inputUrl: string): JobState => ({
  id: "00000000-0000-4000-8000-000000000000",
  inputUrl,
  status: "succeeded",
  createdAt: "",
  updatedAt: "",
});

describe("loadJobPosts", () => {
  test("reads profile posts and rebases localPath to the output root", async () => {
    const posts = await loadJobPosts(tmp, job("https://www.instagram.com/acct/"));
    expect(posts).toHaveLength(1);
    expect(posts[0]!.media[0]!.localPath).toBe("acct/P1/01.jpg");
  });

  test("returns no records for a job directory that does not exist", async () => {
    expect(await loadJobPosts(tmp, job("https://www.instagram.com/nobody/"))).toEqual([]);
  });
});
