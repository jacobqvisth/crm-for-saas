import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveWorkspace } from "@/lib/forums/server";
import { ACCOUNT_SEED, type RedditAccount } from "@/lib/forums/accounts";

// GET /api/forums/accounts → { accounts: RedditAccount[] }
// The workspace's Reddit account roster, owner A→Z. Seeds one placeholder per
// team member on first visit (mirrors the distribution board), so the roster
// isn't empty; from then on the rows carry the real handles + tracking state.
export async function GET() {
  const ws = await resolveWorkspace();
  if (ws.error) return ws.error;
  const { supabase, workspaceId } = ws;

  const { data: existing, error } = await supabase
    .from("reddit_accounts")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("owner_label", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (existing && existing.length > 0) {
    return NextResponse.json({ accounts: existing as unknown as RedditAccount[] });
  }

  const seed = ACCOUNT_SEED.map((a) => ({ ...a, workspace_id: workspaceId }));
  const { data: inserted, error: insertErr } = await supabase
    .from("reddit_accounts")
    .insert(seed)
    .select();
  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });

  const accounts = ((inserted ?? []) as unknown as RedditAccount[]).sort((a, b) =>
    a.owner_label.localeCompare(b.owner_label),
  );
  return NextResponse.json({ accounts });
}

const createSchema = z.object({
  owner_label: z.string().min(1).max(100),
  username: z.string().max(100).nullable().optional(),
  subreddits: z.array(z.string().max(100)).max(50).optional(),
  notes: z.string().max(2000).nullable().optional(),
  active: z.boolean().optional(),
  turns_wrenches: z.boolean().optional(),
  uses_ai_tools: z.boolean().optional(),
  can_mention_wrenchlane: z.boolean().optional(),
  persona_note: z.string().max(2000).nullable().optional(),
});

// POST /api/forums/accounts → { account }
export async function POST(request: NextRequest) {
  const ws = await resolveWorkspace();
  if (ws.error) return ws.error;
  const { supabase, workspaceId } = ws;

  const parsed = createSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("reddit_accounts")
    .insert({ ...parsed.data, workspace_id: workspaceId })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ account: data as unknown as RedditAccount });
}
