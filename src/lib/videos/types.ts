// Types for the Videos page (/videos).

// A curated YouTube car-diagnosis video. Rows live in the diagnostic_videos
// table; `marked`, `summary` and `veo3_prompt` are the mutable, user-facing
// fields (everything else is seed data).
export interface DiagnosticVideo {
  id: string;
  youtube_id: string;
  title: string;
  channel: string;
  url: string;
  category: string | null;
  description: string | null;
  sort_order: number;
  marked: boolean;
  summary: string | null;
  veo3_prompt: string | null;
  created_at: string;
  updated_at: string;
}

// A "top YouTuber" in the car-diagnosis niche. Reference data only (no DB row,
// nothing markable) — rendered as a link chip at the top of the page.
export interface TopChannel {
  name: string;
  handle: string; // e.g. "@southmainauto"
  url: string;
  blurb: string;
}
