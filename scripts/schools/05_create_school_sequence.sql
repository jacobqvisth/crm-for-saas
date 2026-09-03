-- Swedish outreach sequence for the vehicle-education directory.
--
-- Audience: rektorer, programansvariga and yrkeslärare on Sweden's fordonsprogram,
-- imported by scripts/schools/04_import_to_crm.mts.
--
-- Shape: 4 emails over 21 days, created as a DRAFT and enrolling nobody. Enrollment
-- goes through /api/sequences/enroll, never SQL, because only that path applies
-- suppressions and exclusions.
--
-- Copy decisions:
--   * No sign-off name in the bodies. include_signature is true and Jacob's
--     user_profiles.signature_html already renders "Jacob" plus his contact card,
--     so a written "Jacob" would appear twice. Bodies end at "Vänliga hälsningar,".
--   * No "AI" in any subject line (house rule: spam-filter trigger).
--   * Email 1 asks a question instead of requesting a meeting. A teacher will answer
--     "how do you teach fault codes today"; they will not book a call with a stranger.
--   * The motive is stated outright in email 1. A cold offer of free software reads as
--     a trap unless you say what you get out of it, and "your students become the
--     mechanics who use this" is both true and the actual reason.
--   * {{first_name_optional}} renders " Anna" or nothing, so
--     "Hej{{first_name_optional}}," degrades to "Hej," rather than "Hej there,".
--     That matters: a third of these contacts have no first name.

BEGIN;

WITH seq AS (
  INSERT INTO sequences (workspace_id, name, status, settings)
  VALUES (
    'd946ea1f-74b4-492e-ae6a-d50f59ff04f0',
    -- No long dash in the name either: src/lib/ai/no-long-dash.ts names sequence
    -- steps as in-scope, and a name that breaks the rule is the one a human copies.
    'Skolor SE: fordonsprogram, gratis för lärare och elever',
    'draft',
    jsonb_build_object(
      'timezone', 'Europe/Stockholm',
      -- Schools read mail inside the school day, not at 06:00 like workshop owners.
      'send_days', jsonb_build_array(1,2,3,4,5),
      'send_start_hour', 8,
      'send_end_hour', 16,
      'stop_on_reply', true,
      'stop_on_company_reply', true,
      'sender_rotation', false,
      'daily_limit_total', 40,
      'daily_limit_per_sender', 40,
      -- jacob@wrenchlane.com. The copy is first-person from Jacob and his profile
      -- carries the signature the bodies are written around.
      'rotation_account_ids', jsonb_build_array('fef8f54e-b990-4317-96ee-fe2258984291')
    )
  )
  RETURNING id
)
INSERT INTO sequence_steps
  (sequence_id, step_order, type, delay_days, delay_hours, include_signature, subject_override, body_override)
SELECT seq.id, s.step_order, s.type, s.delay_days, s.delay_hours, s.include_signature, s.subject_override, s.body_override
FROM seq,
(VALUES
  -- 1. Introduce, make the offer, state the motive, end on a question. ------------
  (0, 'email', NULL::int, NULL::int, true,
   -- Deliberately NOT '...på {{company_name}}'. Skolverket's school-unit names carry
   -- registry suffixes ('Sundsvalls Gymn. Västermalm 5', 'Ystad Gymnasium, Område 4'),
   -- and 116 of the 342 first-wave contacts would have got a subject line that reads
   -- like a mail merge. The name stays out of the subject and the email earns its
   -- personal tone from the body instead.
   'En fråga om ert fordonsprogram',
   '<p>Hej{{first_name_optional}},</p>
<p>Jag heter Jacob och jobbar på Wrenchlane. Vi bygger ett diagnosverktyg för bilverkstäder. Idag använder över 200 verkstäder det för att tolka felkoder och hitta rätt i tillverkarnas servicedata.</p>
<p>Nu vill vi öppna upp det för fordonsutbildningar, kostnadsfritt för dig som lärare och för dina elever.</p>
<p>Jag ska vara ärlig med varför vi gör det: eleverna ni utbildar är de mekaniker som sitter i verkstaden om några år. Lär de sig verktyget redan i skolan vinner både de och vi på det.</p>
<p>Men innan jag berättar mer är jag mest nyfiken på hur ni har det idag. Hur jobbar ni med felkoder och tillverkarnas servicedata i undervisningen?</p>
<p>Vänliga hälsningar,</p>'),

  (1, 'delay', 4, 0, true, NULL, NULL),

  -- 2. Make it concrete, remove the friction, offer a look instead of a meeting. ---
  (2, 'email', NULL, NULL, true,
   'Så skulle det se ut hos er',
   '<p>Hej{{first_name_optional}},</p>
<p>En kort uppföljning på mitt förra mejl.</p>
<p>Rent praktiskt fungerar det så här: eleverna fotar felkoderna rakt av från den felkodsläsare ni redan har, och får tillbaka en strukturerad felsökning med servicedata, kopplingsscheman, åtdragningsmoment och mätvärden från tillverkaren. Ingen ny hårdvara och inget att installera.</p>
<p>Vill du se det innan du tar ställning finns en kort genomgång på svenska här:</p>
<p>https://www.youtube.com/watch?v=By2jQDyOJqE</p>
<p>Ska jag lägga upp ett konto åt dig så får du klicka runt själv i lugn och ro?</p>
<p>Vänliga hälsningar,</p>'),

  (3, 'delay', 6, 0, true, NULL, NULL),

  -- 3. The APL angle, and a CTA small enough to answer with one word. -------------
  (4, 'email', NULL, NULL, true,
   'Eleverna möter det ändå på APL',
   '<p>Hej{{first_name_optional}},</p>
<p>Jag vet att det är fullt upp så här års, så jag gör det här enkelt.</p>
<p>Oavsett vad ni landar i kommer eleverna möta den här typen av verktyg när de kommer ut på APL, och sedan varje dag i yrket. Vår tanke är att de lika gärna kan ha sett det innan de står där.</p>
<p>Du behöver inte boka något möte för att testa. Svara bara ja, så ordnar jag konton till dig och din klass, och så får ni använda det under terminen och själva avgöra om det tillför något.</p>
<p>Vänliga hälsningar,</p>'),

  (5, 'delay', 11, 0, true, NULL, NULL),

  -- 4. Close politely, leave the door open, and ask for the right person. Many of
  --    these addresses are a school''s general inbox, so the referral ask is the
  --    single most useful thing the last email can do.
  (6, 'email', NULL, NULL, true,
   'Sista mejlet från mig',
   '<p>Hej{{first_name_optional}},</p>
<p>Det här är sista gången jag hör av mig i den här frågan, jag vill inte fylla din inkorg.</p>
<p>Erbjudandet står kvar: kostnadsfria konton till dig och dina elever på fordonsprogrammet. Hör av dig när det passar er, det är lika välkommet om ett år som idag.</p>
<p>En sak till, om någon annan hos er är rätt person att prata om det här med, tipsa gärna om vem så tar jag kontakt med hen istället.</p>
<p>Lycka till med terminen.</p>
<p>Vänliga hälsningar,</p>')
) AS s(step_order, type, delay_days, delay_hours, include_signature, subject_override, body_override);

COMMIT;
