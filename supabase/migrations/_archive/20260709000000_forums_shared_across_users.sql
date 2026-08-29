-- Forums is a shared team resource, not per-tenant data.
--
-- The distribution board, team comment drafts, Reddit roster, and answer posts
-- hold no per-user secrets, and Wrenchlane runs this CRM as a single team. So
-- every forum API now resolves to one shared workspace (see
-- SHARED_FORUMS_WORKSPACE_ID in src/lib/forums/server.ts), and the forum tables'
-- RLS is opened to ANY authenticated user so that a login sitting in a different
-- workspace (or a future teammate like Francis) can still read/write the shared
-- board. Without this the app-level shared-workspace switch alone would be
-- blocked by the old workspace-scoped policies.

do $$
declare
  t text;
begin
  foreach t in array array[
    'forum_distribution',
    'forum_comment_assignments',
    'forum_posts',
    'forum_replies',
    'forum_thread_replies',
    'reddit_accounts'
  ]
  loop
    execute format('drop policy if exists "workspace members can access %s" on public.%I', t, t);
    execute format('drop policy if exists "any authenticated user can access %s" on public.%I', t, t);
    execute format(
      'create policy "any authenticated user can access %s" on public.%I '
      || 'for all to authenticated using (true) with check (true)', t, t);
  end loop;
end $$;

-- Clean up the duplicate empty distribution seed rows that other workspaces
-- picked up on first visit. All real forum data lives in the shared workspace;
-- these strays would otherwise be invisible orphans after the switch.
delete from public.forum_distribution
where workspace_id <> 'd946ea1f-74b4-492e-ae6a-d50f59ff04f0';
