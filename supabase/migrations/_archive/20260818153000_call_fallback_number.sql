-- Final fallback leg for inbound callbacks: after the owner and their failover
-- agent both miss the call, connect to this number before voicemail. Meant for
-- the AI receptionist (switchboard "Mark", +46766867161) but any E.164 works.
alter table user_profiles
  add column if not exists call_fallback_number text;

comment on column user_profiles.call_fallback_number is
  'E.164 number rung last on inbound callbacks (after owner + failover agent, before voicemail). Typically the switchboard AI receptionist.';
