export type MediaType = "image" | "video";

export type MediaItem = {
  index: number;
  type: MediaType;
  sourceUrl: string;
  width?: number;
  height?: number;
  mimeType?: string;
  // Filled in after a successful download. Relative to the job output directory.
  localPath?: string;
  bytes?: number;
  status: "pending" | "saved" | "failed";
  error?: string;
};

export type ExtractionStatus = "complete" | "partial" | "failed";

export type PostRecord = {
  canonicalUrl: string;
  shortcode: string;
  kind: "post" | "reel" | "tv" | "story";
  username?: string;
  caption?: string | null;
  takenAt?: string | null;
  likeCount?: number | null;
  commentCount?: number | null;
  media: MediaItem[];
  extractionStatus: ExtractionStatus;
  errors: string[];
  fetchedAt: string;
};

export type FailureKind =
  | "login_required"
  | "rate_limited"
  | "challenge"
  | "blocked"
  | "not_found"
  | "timeout"
  | "malformed_metadata"
  | "download_failed"
  | "unknown";

export type RequestFailure = {
  url: string;
  kind: FailureKind;
  message: string;
  at: string;
};
