import { describe, expect, test } from "bun:test";
import { downloadMedia } from "../src/download.ts";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";

describe("Live Instagram story media verification", () => {
  const liveVideoUrl =
    "https://instagram.fyei6-5.fna.fbcdn.net/o1/v/t2/f2/m78/AQPyy1nSmXOn73Q1QB0NVznCvo1RmXxggQMktLVDCIUMzEKO_6-0Qil9pON54uB0l9mHyflRzzzRAJIhXoDdyiKX2f5h01zsvcDNEWk.mp4?_nc_cat=100&_nc_oc=AdryMFeMCwTtrbmyUlUcnpjtPw4Z3O14Pe8tubShgjRxbXbYnxoO8rCFErv-RdLj_vY&_nc_sid=5e9851&_nc_ht=instagram.fyei6-5.fna.fbcdn.net&_nc_ohc=Qj1RqCJntJAQ7kNvwFSs1wu&efg=eyJ2ZW5jb2RlX3RhZyI6Inhwdl9wcm9ncmVzc2l2ZS5JTlNUQUdSQU0uU1RPUlkuQzMuNzIwLmRhc2hfYmFzZWxpbmVfMV92MSIsInhwdl9hc3NldF9pZCI6MTg3MTAxNDY5MjcwMTkxMzMsImFzc2V0X2FnZV9kYXlzIjowLCJ2aV91c2VjYXNlX2lkIjoxMDEwMCwiZHVyYXRpb25fcyI6OSwidXJsZ2VuX3NvdXJjZSI6Ind3dyJ9&ccb=17-1&vs=cc6fe4c308190f63&_nc_vs=HBksFQIYUWlnX3hwdl9wbGFjZW1lbnRfcGVybWFuZW50X3YyLzg1N0IxRTY3Rjk2QzREODM5RDdGRTdCODFFMkY1OEVBX3ZpZGVvX2Rhc2hpbml0Lm1wNBUAAsgBEgAVAhhRaWdfeHB2X3BsYWNlbWVudF9wZXJtYW5lbnRfdjIvQzAwN0MzRUQ3RTgxNDc1OEJGNEE2RTlFNERENDM1QUFfYXVkaW9fZGFzaGluaXQubXA0FQICyAESACgAGAAbAogHdXNlX29pbAExEnByb2dyZXNzaXZlX3JlY2lwZQExFQAAJvqRvtTxsbxCFQIoAkMzLBdAI92yLQ5WBBgSZGFzaF9iYXNlbGluZV8xX3YxEQB16Adl6J0BAA&_nc_gid=MZFEsuzSmP2EcGW7ziXd7w&_nc_ss=7a22e&_nc_map=urlgen_bucketless&_nc_zt=28&oh=00_AQP4azUPfmuUu9US7D2CY8m-jjiXvYQkqKDVzo_nGmxp-A&oe=6ADA47E1";

  const liveImageUrl =
    "https://instagram.fyei6-1.fna.fbcdn.net/v/t51.82787-15/856966916_18710092675019133_383784696759665978_n.jpg?stp=dst-jpg_e35_tt6&_nc_cat=1&ig_cache_key=NDAxMjAzMTg0NTEyMzM0Nzc3MQ%3D%3D.3-ccb7-5&ccb=7-5&_nc_sid=58cdad&efg=eyJ2ZW5jb2RlX3RhZyI6IlNUT1JZLnhwaWRzLjExNzAuc2RyLnJlZ3VsYXJfcGhvdG8uQzMifQ%3D%3D&_nc_ohc=oBHgwQMRbrMQ7kNvwEldGF0&_nc_oc=Adq_82DP3K4440CtUzU2oIYH60CHNuS5zycFImIN-q63wop6KXYm3bgMuEkf_0LeFtE&_nc_ad=z-m&_nc_cid=0&_nc_zt=23&_nc_ht=instagram.fyei6-1.fna&_nc_gid=MZFEsuzSmP2EcGW7ziXd7w&_nc_ss=7a22e&oh=00_AQP6SMxFENqlmwTTPWCibvpauPq37n40PQqR1ZawHYidxg&oe=6ADE40F0";

  test("downloads real live Instagram story video and verifies MP4 file signature and extension", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "dropclip-live-"));
    try {
      const res = await downloadMedia(
        { index: 0, type: "video", sourceUrl: liveVideoUrl, status: "pending" },
        tmp,
        { timeoutMs: 15000, retries: 1, maxBytes: 50 * 1024 * 1024 },
      );
      expect(res.fileName).toBe("01.mp4");
      expect(res.mimeType).toBe("video/mp4");
      expect(res.bytes).toBeGreaterThan(1000);
      console.log(`Live video story downloaded: ${res.bytes} bytes, file=${res.fileName}, mime=${res.mimeType}`);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }, 20000);

  test("downloads real live Instagram story image and verifies JPEG file signature and extension", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "dropclip-live-img-"));
    try {
      const res = await downloadMedia(
        { index: 0, type: "image", sourceUrl: liveImageUrl, status: "pending" },
        tmp,
        { timeoutMs: 15000, retries: 1, maxBytes: 50 * 1024 * 1024 },
      );
      expect(res.fileName).toBe("01.jpg");
      expect(res.mimeType).toBe("image/jpeg");
      expect(res.bytes).toBeGreaterThan(1000);
      console.log(`Live image story downloaded: ${res.bytes} bytes, file=${res.fileName}, mime=${res.mimeType}`);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }, 20000);
});
