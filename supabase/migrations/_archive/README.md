# Archived migrations

These 129 files are the historical record of how the Wrenchlane database was built
between 2026-03-23 and 2026-08-27. **Nothing applies them any more** and they must not be
moved back into `supabase/migrations/`.

They are kept because they are the only written explanation of *why* a number of columns
and constraints exist. Read them; do not run them.

## Why they were archived

They did not reproduce the live schema, and had not for months. The scale of the drift is
worth stating precisely, because "the history is a bit out of date" undersells it:

| | |
|---|---|
| Local `.sql` files | 129 |
| Distinct version prefixes among them | 122 |
| Rows in `supabase_migrations.schema_migrations` on the remote | 68 |
| **Versions present both locally and remotely** | **2** |
| Local versions with no remote row | 120 |
| Remote rows with no local file | 66 |

Two of sixty-eight. The local directory and the remote history had almost nothing to do
with each other. The only two versions they agreed on were `20260630140000` and
`20260630160000`.

Two independent causes:

1. **Migrations were routinely applied by hand.** This project's documented workaround for
   a desynced history was to run SQL straight through the Management API or psql, which
   applies the change without ever writing the history row. Every such fix widened the gap
   that made the workaround necessary.
2. **Seven timestamp prefixes are shared by two files each.** Supabase keys migration
   history on the version prefix alone, so only one file per prefix could ever be recorded:

   ```
   20260401000000  20260630120000  20260630140000  20260709000000
   20260710120000  20260710160000  20260825140000
   ```

The drift is visible in the most recent entry on each side. The remote records version
`20260827131632` for `mailbox_sync_sender_and_multi_recipient`; the local file for that
same change is `20260827100000_mailbox_sync_sender_and_multi_recipient.sql`. Same
migration, two different versions, recorded nowhere as the same thing.

The consequence: `supabase db push --linked` refused to run, there was no way to bring a
new database up to the current schema, and no way to keep several databases in step. That
is tolerable debt with one database and a blocker with four.

## What replaced them

`supabase/migrations/00000000000000_baseline.sql`, generated from the live database and
verified by applying it to an empty Supabase project and diffing that project's schema
against production. The two dumps contain an identical multiset of lines and an identical
inventory of 1014 objects; the only difference is the order in which pg_dump emits four
tables. See `docs/plans/productisation/01-migration-baseline.md`.

## The remote history at the moment of the switch

Phase 01 replaced these 68 rows with a single `00000000000000` baseline row. This listing
is the only remaining copy of what was there before.

```
20260323132735  001_core_crm_tables
20260323132753  002_gmail_accounts
20260323132814  003_email_sequencing
20260323132833  004_indexes
20260323132853  005_rls_policies
20260323132918  006_helper_functions
20260324090301  add_insert_policy_for_workspaces_and_workspace_members
20260331124127  add_contacts_source
20260331130947  inbox_messages
20260401102141  workspace_ai_settings
20260401112931  phase15_sequence_reliability
20260401122818  phase16_smart_throttling
20260401125420  phase17_suppressions_ddl
20260401125446  phase17_suppressions_migrate_unsubscribes
20260401132526  phase18_data_model_upgrade
20260401140603  phase20_prospector_upgrade
20260401154738  phase21_templates_snippets
20260401160523  phase22_ai_email_writer
20260402064614  phase24_tasks
20260402092437  create_discovered_shops_staging_table
20260402095544  phase25_extend_contacts_companies_schema
20260402162820  phase11_warmup
20260414122921  discovered_shops_all_categories
20260415190851  email_queue_allow_pending
20260424084353  email_images_storage
20260521131525  activities_outcome
20260521132134  activities_allow_email_logged
20260522075153  company_matching_attribution
20260522075349  company_fuzzy_match_rpc
20260522080934  merge_companies_rpc
20260522081633  get_sequence_conversions_rpc
20260630140000  per_user_call_settings
20260630160000  call_failover
20260708080422  forum_distribution
20260708080520  forum_posts_traction
20260708085958  forum_distribution_body
20260708091159  forum_slack_comment
20260708141522  forum_replies
20260708145134  reddit_accounts
20260708154943  forum_distribution_posted_by
20260709075447  forum_comment_assignments
20260709124252  forum_contributor_tracking
20260709134958  forum_thread_replies
20260709140440  forums_shared_across_users
20260709151406  ai_failure_stories
20260709172651  forums_shared_thread_replies
20260710090235  forum_replies_traction
20260710094545  reddit_mentions
20260710102315  subreddit_access
20260710113446  forum_posts_posted_by
20260710125832  forum_generation_options
20260710155045  forum_gap_candidates
20260804131719  organic_analysis_rpc
20260805071954  forum_candidates
20260810075057  engaged_prospects_rpc
20260810075131  engaged_prospects_rpc_fix_country_cast
20260810092951  active_days_and_auto_enroll
20260813071208  dashboard_user_attribution
20260818092021  switchboard
20260818105323  security_findings
20260818120644  per_user_webrtc
20260818134045  switchboard_bridge_number
20260818145409  switchboard_knowledge
20260819080438  switchboard_gaps
20260819092246  company_is_partner
20260825092305  dashboard_promo_grants
20260825100439  sequence_call_task_steps
20260827131632  mailbox_sync_sender_and_multi_recipient
```
