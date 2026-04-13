-- ============================================================
-- Plan 13 — Taylor Wessing public demo seed
--
-- Maps directly to the 5 use cases in the Taylor Wessing report:
--   1. Autonomous QA for in-house legal tech (TechSet, LitiumTW,
--      Global Data Hub, Patent Map, SM&CR portal, GDPR hub).
--   2. Regulatory + case-law monitoring for data, cyber and AI.
--   3. Content ops automation for insights + marketing.
--   4. Continuous eval and governance of LitiumTW, Legora, LitiGate.
--   5. Business development research for TMC + life sciences.
--
-- Owner: synthetic UUID 000000d0-0000-0000-0000-0000000000d1
-- Relative timestamps (`now() - interval '…'`) keep the dashboard
-- "last 30 days" window perpetually current.
-- Every INSERT is idempotent via ON CONFLICT.
-- ============================================================

-- ── 1. Demo owner user ──────────────────────────────────────────────

INSERT INTO auth.users (
  id, instance_id, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, role, aud,
  raw_app_meta_data, raw_user_meta_data, is_anonymous
)
VALUES (
  '000000d0-0000-0000-0000-0000000000d1',
  '00000000-0000-0000-0000-000000000000',
  'demo-owner+taylor-wessing@openhelm.ai',
  '',
  now(),
  now(),
  now(),
  'authenticated',
  'authenticated',
  '{"provider":"demo"}'::jsonb,
  '{"name":"Demo Owner (Taylor Wessing)"}'::jsonb,
  false
)
ON CONFLICT (id) DO NOTHING;

-- ── 2. Project ──────────────────────────────────────────────────────

INSERT INTO projects (
  id, user_id, name, description, directory_path, git_url,
  is_demo, demo_slug, created_at, updated_at
)
VALUES (
  'demo-tw-project',
  '000000d0-0000-0000-0000-0000000000d1',
  'Taylor Wessing — Innovation & Legal Tech',
  'OpenHelm workspace for the Taylor Wessing Innovation team — keeps TechSet, LitiumTW, Legora and the client-facing microsites (Global Data Hub, GDPR hub, Patent Map, SM&CR portal) in good health, runs the regulatory radar for data / cyber / AI, and feeds BD research for the TMC and life sciences sectors.',
  '/workspace/taylor-wessing',
  null,
  true,
  'taylor-wessing',
  now() - interval '60 days',
  now() - interval '1 hour'
)
ON CONFLICT (id) DO UPDATE
  SET name          = EXCLUDED.name,
      description   = EXCLUDED.description,
      is_demo       = EXCLUDED.is_demo,
      demo_slug     = EXCLUDED.demo_slug,
      updated_at    = EXCLUDED.updated_at;

-- ── 3. Goals (5 — one per use case) ─────────────────────────────────

INSERT INTO goals (
  id, user_id, project_id, name, description, status,
  icon, sort_order, created_at, updated_at
)
VALUES
  ('demo-tw-goal-1', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-project',
   'Keep client-facing legal tech healthy',
   'Nightly and weekly QA across TechSet, LitiumTW admin and the public microsites — Global Data Hub, Patent Map, SM&CR classifier, GDPR hub. Self-correct flaky tests, escalate real regressions to engineering.',
   'active', 'shield-check', 0, now() - interval '58 days', now() - interval '2 hours'),

  ('demo-tw-goal-2', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-project',
   'Stay ahead of EU data, cyber & AI regulation',
   'Daily crawl of ICO, EDPB, CNIL, EU Commission and national cyber agencies; classify, summarise and feed a weekly radar briefing for the data protection and cyber teams.',
   'active', 'radar', 1, now() - interval '55 days', now() - interval '4 hours'),

  ('demo-tw-goal-3', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-project',
   'Keep the insights library discoverable & repurposed',
   'Weekly SEO audits on the Insights hub, cross-channel repurposing of new briefings into social/email/webinar assets, and cross-link suggestions across sector pages.',
   'active', 'megaphone', 2, now() - interval '40 days', now() - interval '6 hours'),

  ('demo-tw-goal-4', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-project',
   'Govern LitiumTW, Legora & LitiGate output quality',
   'Nightly evaluation suites, weekly red-team probes and regression checks on in-house and vendor AI tools. Surface drift to the Innovation Director and practice AI champions.',
   'active', 'scale', 3, now() - interval '35 days', now() - interval '1 day'),

  ('demo-tw-goal-5', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-project',
   'Supply TMC & life sciences BD with fresh prospects',
   'Weekly funding-round scans, startup watchlists and milestone alerts for the TMC and life sciences sector teams. Curated lists flow into CRM for partner review.',
   'active', 'target', 4, now() - interval '28 days', now() - interval '3 hours')
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description,
      updated_at = EXCLUDED.updated_at;

-- ── 4. Jobs (14 — 2-4 per goal) ─────────────────────────────────────

INSERT INTO jobs (
  id, user_id, goal_id, project_id, name, description, prompt,
  schedule_type, schedule_config, is_enabled, is_archived,
  next_fire_at, model, model_effort, permission_mode,
  source, sort_order, created_at, updated_at
)
VALUES
  -- Goal 1: legal tech QA ------------------------------------------------
  ('demo-tw-job-1a', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-goal-1', 'demo-tw-project',
   'Nightly Global Data Hub smoke tests',
   'End-to-end journey tests across Global Data Hub + GDPR hub, plus 200/3xx status checks for the top 20 pages.',
   'Run the e2e smoke test suite against Global Data Hub and the GDPR hub. Check the top-20 landing pages return 200 or a valid 3xx redirect. If any fail, retry with a 60s backoff; if still failing, create an inbox alert tagging the IT on-call rota.',
   'cron', '{"expression":"0 2 * * *"}'::jsonb, true, false,
   now() + interval '9 hours', 'sonnet', 'medium', 'bypassPermissions',
   'user', 0, now() - interval '58 days', now() - interval '3 hours'),

  ('demo-tw-job-1b', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-goal-1', 'demo-tw-project',
   'Patent Map link + uptime check',
   'Hourly uptime probe and daily broken-link crawl on the Patent Map interactive tool.',
   'Probe the Patent Map homepage and ten deep-link routes (jurisdiction filters, family expansion). On any non-200, retry three times; on persistent failure, create an inbox alert.',
   'interval', '{"minutes":60}'::jsonb, true, false,
   now() + interval '35 minutes', 'sonnet', 'medium', 'bypassPermissions',
   'user', 1, now() - interval '55 days', now() - interval '35 minutes'),

  ('demo-tw-job-1c', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-goal-1', 'demo-tw-project',
   'LitiumTW API latency probe',
   'Every 15 minutes, hit the LitiumTW chat completion endpoint with a canary prompt and record p50/p95 latency.',
   'Call the LitiumTW completions endpoint with the fixed canary prompt "Summarise this clause in one sentence: …". Record latency and completion status. Alert when p95 > 4s for three consecutive runs.',
   'interval', '{"minutes":15}'::jsonb, true, false,
   now() + interval '8 minutes', 'sonnet', 'low', 'bypassPermissions',
   'user', 2, now() - interval '50 days', now() - interval '9 minutes'),

  ('demo-tw-job-1d', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-goal-1', 'demo-tw-project',
   'Weekly dependency + CVE scan: TechSet',
   'Monday scan of TechSet and LitiumTW repos for vulnerable dependencies; opens Azure DevOps tickets for highs.',
   'For each TechSet and LitiumTW repo, run npm audit / pip-audit equivalent and correlate against the CVE database. Open Azure DevOps tickets for any HIGH or CRITICAL findings, tagged to the Engineering team.',
   'cron', '{"expression":"0 5 * * 1"}'::jsonb, true, false,
   now() + interval '4 days', 'sonnet', 'high', 'bypassPermissions',
   'user', 3, now() - interval '53 days', now() - interval '2 days'),

  ('demo-tw-job-1e', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-goal-1', 'demo-tw-project',
   'Quarterly accessibility audit: public microsites',
   'Lighthouse + Axe audit on the six public microsites; diffed against the previous audit; creates a ticket per regression.',
   'Run Lighthouse and Axe scans against Global Data Hub, GDPR hub, Patent Map, SM&CR portal, Online Brand Protection and the Data Exports microsite. Diff against the last audit and log every accessibility regression with WCAG references.',
   'cron', '{"expression":"0 6 1 */3 *"}'::jsonb, true, false,
   now() + interval '40 days', 'sonnet', 'high', 'bypassPermissions',
   'user', 4, now() - interval '45 days', now() - interval '8 days'),

  -- Goal 2: regulatory radar ---------------------------------------------
  ('demo-tw-job-2a', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-goal-2', 'demo-tw-project',
   'Daily ICO / EDPB / CNIL guidance crawl',
   'Morning crawl of major EU data protection regulator feeds. Extract, classify, summarise and store new documents.',
   'Fetch the ICO, EDPB, CNIL, AEPD and Garante news feeds. For every new item since the last run, extract title, date, topic tags (cookies, transfers, AI, breach, children) and write a 3-sentence summary into the regulatory_updates table.',
   'cron', '{"expression":"0 7 * * *"}'::jsonb, true, false,
   now() + interval '14 hours', 'sonnet', 'medium', 'bypassPermissions',
   'user', 5, now() - interval '54 days', now() - interval '4 hours'),

  ('demo-tw-job-2b', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-goal-2', 'demo-tw-project',
   'Weekly EU AI Act tracker',
   'Monday digest of EU AI Act developments — Commission announcements, implementing acts, standards body updates.',
   'Compile a Monday digest of EU AI Act activity over the last 7 days: Commission / Parliament announcements, JRC guidance, CEN-CENELEC standards drafts, national competent authority actions. Write a 400-word radar brief tagged to the AI & Regulation practice group.',
   'cron', '{"expression":"0 9 * * 1"}'::jsonb, true, false,
   now() + interval '4 days', 'sonnet', 'high', 'bypassPermissions',
   'user', 6, now() - interval '50 days', now() - interval '2 days'),

  ('demo-tw-job-2c', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-goal-2', 'demo-tw-project',
   'Monthly Global Data Hub content gap audit',
   'Once a month, cross-check Global Data Hub content against a list of must-cover topics and flag gaps.',
   'For each must-cover topic (transfers, cookies, breach notification, AI Act, NIS2, DPIA, DSA, DMA), check whether Global Data Hub has an article published in the last 90 days referencing current guidance. Create a to-do list of gaps for the content team.',
   'cron', '{"expression":"0 10 1 * *"}'::jsonb, true, false,
   now() + interval '17 days', 'sonnet', 'high', 'bypassPermissions',
   'user', 7, now() - interval '48 days', now() - interval '12 days'),

  -- Goal 3: content ops --------------------------------------------------
  ('demo-tw-job-3a', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-goal-3', 'demo-tw-project',
   'Weekly SEO audit: insights pages',
   'Tuesday audit of the top-100 insights pages for SEO health — broken links, meta, schema, keyword coverage.',
   'Crawl the top-100 insights pages by traffic. Run Lighthouse SEO and an internal heuristic for broken links, missing meta descriptions, missing schema markup and low keyword coverage. Produce a ranked action list for the marketing team.',
   'cron', '{"expression":"0 11 * * 2"}'::jsonb, true, false,
   now() + interval '5 days', 'sonnet', 'medium', 'bypassPermissions',
   'user', 8, now() - interval '39 days', now() - interval '6 days'),

  ('demo-tw-job-3b', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-goal-3', 'demo-tw-project',
   'New briefing → social + email repurpose',
   'When a new insights briefing is published, draft LinkedIn/X posts, a client email teaser and a webinar-script outline.',
   'Poll the insights feed every hour. For any new briefing, draft (a) a LinkedIn post for the authoring partner, (b) a 120-word client email teaser, (c) a 6-bullet webinar script outline. Store drafts under /marketing/repurposed for human review before publishing.',
   'interval', '{"minutes":60}'::jsonb, true, false,
   now() + interval '25 minutes', 'sonnet', 'medium', 'bypassPermissions',
   'user', 9, now() - interval '32 days', now() - interval '28 minutes'),

  -- Goal 4: AI governance ------------------------------------------------
  ('demo-tw-job-4a', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-goal-4', 'demo-tw-project',
   'Nightly LitiumTW contract-clause evaluation',
   'Benchmark LitiumTW against the curated 500-item clause extraction test set each night.',
   'Run the 500-item clause extraction evaluation set against LitiumTW. For each item, compare extracted clauses against the reference using fuzzy match. Record accuracy, consistency and style scores into litiumtw_eval_scores and alert if any metric drops >5% vs the 7-day rolling mean.',
   'cron', '{"expression":"0 1 * * *"}'::jsonb, true, false,
   now() + interval '8 hours', 'sonnet', 'high', 'bypassPermissions',
   'user', 10, now() - interval '34 days', now() - interval '14 hours'),

  ('demo-tw-job-4b', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-goal-4', 'demo-tw-project',
   'Weekly LitiumTW red-team probes',
   'Wednesday red-team: probe LitiumTW with ~40 adversarial prompts targeting hallucination, privilege leakage and jailbreaks.',
   'Execute the curated red-team suite against LitiumTW: prompt injection, privilege leakage, hallucination on fake case law, PII exfiltration. Score each outcome, log any concerning response and push a summary to the AI governance Teams channel.',
   'cron', '{"expression":"0 4 * * 3"}'::jsonb, true, false,
   now() + interval '6 days', 'sonnet', 'high', 'bypassPermissions',
   'user', 11, now() - interval '31 days', now() - interval '7 days'),

  ('demo-tw-job-4c', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-goal-4', 'demo-tw-project',
   'Legora response-quality benchmark',
   'Friday benchmark: compare Legora vs LitiumTW on a drafting test set to track vendor vs in-house performance.',
   'Run a curated drafting prompts benchmark against both Legora and LitiumTW. Rank outputs by accuracy, completeness and style. Record scores and alert if the gap between tools shifts by more than 10% vs last week.',
   'cron', '{"expression":"0 4 * * 5"}'::jsonb, true, false,
   now() + interval '7 days', 'sonnet', 'high', 'bypassPermissions',
   'user', 12, now() - interval '28 days', now() - interval '3 days'),

  -- Goal 5: BD research --------------------------------------------------
  ('demo-tw-job-5a', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-goal-5', 'demo-tw-project',
   'Weekly TMC funding round scan',
   'Monday scan of funding databases + press for new TMC funding rounds in Europe. Enriches + scores prospects.',
   'Pull funding round events from Crunchbase, Dealroom and PitchBook for the past 7 days. Filter to European TMC (SaaS, AI, fintech, healthtech). Enrich with founder, sector, stage and existing-relationship check, then write to bd_prospect_pipeline ranked by score.',
   'cron', '{"expression":"0 12 * * 1"}'::jsonb, true, false,
   now() + interval '4 days', 'sonnet', 'medium', 'bypassPermissions',
   'user', 13, now() - interval '26 days', now() - interval '6 days'),

  ('demo-tw-job-5b', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-goal-5', 'demo-tw-project',
   'Life sciences startup watchlist refresh',
   'Thursday refresh of a curated life-sciences startup watchlist with latest news and milestones.',
   'Refresh the curated life sciences watchlist. For each company, pull recent news, clinical trial updates, regulatory milestones and funding events. Highlight any company that hit a Series B/C event in the past 30 days as a BD priority.',
   'cron', '{"expression":"0 12 * * 4"}'::jsonb, true, false,
   now() + interval '3 days', 'sonnet', 'medium', 'bypassPermissions',
   'user', 14, now() - interval '24 days', now() - interval '4 days')
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description,
      prompt = EXCLUDED.prompt, schedule_config = EXCLUDED.schedule_config,
      next_fire_at = EXCLUDED.next_fire_at, is_enabled = EXCLUDED.is_enabled,
      updated_at = EXCLUDED.updated_at;

-- ── 5. Runs (25 — spread across last 30 days, includes failure + correction) ─

INSERT INTO runs (
  id, user_id, job_id, status, trigger_source,
  started_at, finished_at, exit_code, summary,
  input_tokens, output_tokens, created_at
)
VALUES
  -- Global Data Hub smoke tests
  ('demo-tw-run-1', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-job-1a', 'succeeded', 'scheduled',
   now() - interval '16 hours', now() - interval '15 hours 48 minutes', 0,
   'All 20 top pages returned 200. GDPR hub /transfers returned a 301 (expected). No regressions.',
   22400, 2810, now() - interval '16 hours'),
  ('demo-tw-run-2', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-job-1a', 'succeeded', 'scheduled',
   now() - interval '40 hours', now() - interval '39 hours 47 minutes', 0,
   '20/20 pages healthy. Journey tests passed.',
   22100, 2735, now() - interval '40 hours'),
  ('demo-tw-run-3', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-job-1a', 'failed', 'scheduled',
   now() - interval '4 days', now() - interval '4 days' + interval '3 minutes', 1,
   'GDPR hub /dpia returned a 500 — blob storage connection reset. Self-correcting: scheduled a retry in 2 minutes.',
   8420, 612, now() - interval '4 days'),
  ('demo-tw-run-4', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-job-1a', 'succeeded', 'corrective',
   now() - interval '4 days' + interval '5 minutes', now() - interval '4 days' + interval '18 minutes', 0,
   'Retry after blob storage recovered. 20/20 pages healthy. Root cause documented in memories.',
   21980, 2690, now() - interval '4 days' + interval '5 minutes'),

  -- Patent Map uptime probe
  ('demo-tw-run-5', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-job-1b', 'succeeded', 'scheduled',
   now() - interval '35 minutes', now() - interval '32 minutes', 0,
   'All 10 Patent Map routes returned 200. Average latency 318ms.',
   1820, 214, now() - interval '35 minutes'),
  ('demo-tw-run-6', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-job-1b', 'succeeded', 'scheduled',
   now() - interval '1 hours 35 minutes', now() - interval '1 hours 32 minutes', 0,
   'All routes healthy. Latency 342ms.',
   1800, 212, now() - interval '1 hours 35 minutes'),
  ('demo-tw-run-7', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-job-1b', 'failed', 'scheduled',
   now() - interval '9 days', now() - interval '9 days' + interval '42 seconds', 1,
   'jurisdiction filter endpoint timed out 3/3 retries. Escalated to IT on-call; inbox alert created.',
   3420, 318, now() - interval '9 days'),

  -- LitiumTW latency probe
  ('demo-tw-run-8', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-job-1c', 'succeeded', 'scheduled',
   now() - interval '15 minutes', now() - interval '14 minutes', 0,
   'LitiumTW canary p50 820ms, p95 1.4s — healthy.',
   1240, 180, now() - interval '15 minutes'),
  ('demo-tw-run-9', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-job-1c', 'succeeded', 'scheduled',
   now() - interval '30 minutes', now() - interval '29 minutes', 0,
   'LitiumTW canary p50 790ms, p95 1.3s.',
   1230, 175, now() - interval '30 minutes'),

  -- Dependency scan
  ('demo-tw-run-10', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-job-1d', 'succeeded', 'scheduled',
   now() - interval '3 days', now() - interval '2 days 23 hours 46 minutes', 0,
   'Scanned 14 repos. 2 HIGH CVEs in TW:navigate (lodash 4.17.20 → CVE-2021-23337; xml2js 0.4.19 → CVE-2023-0842). Tickets TW-4821 and TW-4822 opened.',
   42300, 5940, now() - interval '3 days'),

  -- Regulatory radar
  ('demo-tw-run-11', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-job-2a', 'succeeded', 'scheduled',
   now() - interval '10 hours', now() - interval '9 hours 54 minutes', 0,
   'Crawled 5 regulator feeds. 7 new items (2 ICO, 1 EDPB, 3 CNIL, 1 AEPD). Summaries written to regulatory_updates.',
   31200, 4820, now() - interval '10 hours'),
  ('demo-tw-run-12', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-job-2a', 'succeeded', 'scheduled',
   now() - interval '34 hours', now() - interval '33 hours 55 minutes', 0,
   '6 new items classified. Top: EDPB revised guidance on international data transfers.',
   30800, 4690, now() - interval '34 hours'),
  ('demo-tw-run-13', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-job-2b', 'succeeded', 'scheduled',
   now() - interval '7 days', now() - interval '7 days' + interval '14 minutes', 0,
   'Weekly AI Act tracker compiled. Key updates: Commission implementing act on GPAI transparency; CEN-CENELEC draft on risk management; 2 national CA actions.',
   48200, 7320, now() - interval '7 days'),
  ('demo-tw-run-14', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-job-2c', 'succeeded', 'scheduled',
   now() - interval '14 days', now() - interval '14 days' + interval '8 minutes', 0,
   'Monthly Global Data Hub gap audit. 3 gaps: DSA enforcement, UK GDPR reform, pseudonymisation techniques. Assigned to content team.',
   18200, 2840, now() - interval '14 days'),

  -- Content ops
  ('demo-tw-run-15', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-job-3a', 'succeeded', 'scheduled',
   now() - interval '6 days', now() - interval '6 days' + interval '19 minutes', 0,
   'SEO audit across top-100 insights pages. 4 missing meta, 2 broken links, 11 schema suggestions. Action list posted to marketing.',
   52800, 6120, now() - interval '6 days'),
  ('demo-tw-run-16', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-job-3b', 'succeeded', 'scheduled',
   now() - interval '2 days', now() - interval '2 days' + interval '5 minutes', 0,
   'New briefing detected: "DMCCA subscription contracts — what businesses need to do". Drafts ready: LinkedIn (2 variants), email teaser, webinar outline.',
   12400, 3210, now() - interval '2 days'),
  ('demo-tw-run-17', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-job-3b', 'succeeded', 'scheduled',
   now() - interval '5 days', now() - interval '5 days' + interval '4 minutes', 0,
   'New briefing: "CBAM — transitional reporting". Drafts generated; author notified.',
   12100, 3190, now() - interval '5 days'),

  -- AI governance
  ('demo-tw-run-18', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-job-4a', 'succeeded', 'scheduled',
   now() - interval '1 day', now() - interval '1 day' + interval '42 minutes', 0,
   'LitiumTW eval: accuracy 92.4% (▲0.2), consistency 88.9% (▼0.4), style 4.3/5. No drift threshold breached.',
   78000, 9820, now() - interval '1 day'),
  ('demo-tw-run-19', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-job-4a', 'succeeded', 'scheduled',
   now() - interval '2 days', now() - interval '2 days' + interval '41 minutes', 0,
   'LitiumTW eval: accuracy 92.2%, consistency 89.3%, style 4.3/5.',
   77400, 9760, now() - interval '2 days'),
  ('demo-tw-run-20', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-job-4b', 'succeeded', 'scheduled',
   now() - interval '8 days', now() - interval '8 days' + interval '22 minutes', 0,
   'Red-team: 40 probes, 2 borderline outputs on privilege-leakage set. Escalated to governance group for review.',
   39400, 6120, now() - interval '8 days'),
  ('demo-tw-run-21', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-job-4c', 'succeeded', 'scheduled',
   now() - interval '3 days', now() - interval '3 days' + interval '18 minutes', 0,
   'Legora vs LitiumTW drafting benchmark: Legora 4.1/5, LitiumTW 4.3/5. Gap stable within threshold.',
   45200, 6420, now() - interval '3 days'),

  -- BD research
  ('demo-tw-run-22', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-job-5a', 'succeeded', 'scheduled',
   now() - interval '6 days', now() - interval '6 days' + interval '11 minutes', 0,
   'TMC scan: 23 new funding events in Europe. 6 scored ≥8/10 for BD priority. Top: AI legal-tech Series B, £12m.',
   32100, 4920, now() - interval '6 days'),
  ('demo-tw-run-23', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-job-5a', 'succeeded', 'scheduled',
   now() - interval '13 days', now() - interval '13 days' + interval '10 minutes', 0,
   'TMC scan: 19 new funding events. 4 priority matches. Report emailed to TMC partners.',
   31800, 4850, now() - interval '13 days'),
  ('demo-tw-run-24', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-job-5b', 'succeeded', 'scheduled',
   now() - interval '3 days', now() - interval '3 days' + interval '9 minutes', 0,
   'Life sciences watchlist refreshed. 2 Series B events (Sona — $45m), 1 phase-2 trial start. Highlighted for BD.',
   28400, 4360, now() - interval '3 days'),
  ('demo-tw-run-25', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-job-5b', 'succeeded', 'scheduled',
   now() - interval '10 days', now() - interval '10 days' + interval '8 minutes', 0,
   'Life sciences refresh: 14 companies updated. 1 new BD priority (regulatory milestone on biosimilars).',
   28200, 4310, now() - interval '10 days')
ON CONFLICT (id) DO UPDATE
  SET status = EXCLUDED.status, summary = EXCLUDED.summary,
      started_at = EXCLUDED.started_at, finished_at = EXCLUDED.finished_at;

-- ── 6. Run logs (one fleshed-out failure → correction sequence) ─────

INSERT INTO run_logs (id, user_id, run_id, sequence, stream, text, timestamp)
VALUES
  ('demo-tw-log-1', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-run-3', 0, 'stdout',
   '[openhelm] starting job demo-tw-job-1a: Nightly Global Data Hub smoke tests', now() - interval '4 days'),
  ('demo-tw-log-2', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-run-3', 1, 'stdout',
   '[claude] Running e2e smoke suite against https://globaldatahub.taylorwessing.com …', now() - interval '4 days'),
  ('demo-tw-log-3', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-run-3', 2, 'stdout',
   '[claude] 18/20 pages healthy. /dpia returned HTTP 500 — "blob storage connection reset by peer"', now() - interval '4 days'),
  ('demo-tw-log-4', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-run-3', 3, 'stderr',
   '[claude] Retry 1/3 failed after 32s — same blob storage error', now() - interval '4 days'),
  ('demo-tw-log-5', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-run-3', 4, 'stderr',
   '[claude] Retry 2/3 failed after 35s', now() - interval '4 days'),
  ('demo-tw-log-6', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-run-3', 5, 'stdout',
   '[openhelm] Scheduling corrective retry in 5 minutes — recording memory "blob-storage-transient"', now() - interval '4 days'),
  ('demo-tw-log-7', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-run-4', 0, 'stdout',
   '[openhelm] corrective retry of demo-tw-run-3 starting', now() - interval '4 days' + interval '5 minutes'),
  ('demo-tw-log-8', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-run-4', 1, 'stdout',
   '[claude] /dpia now returning 200. Continuing smoke suite.', now() - interval '4 days' + interval '7 minutes'),
  ('demo-tw-log-9', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-run-4', 2, 'stdout',
   '[claude] 20/20 pages healthy. Journey tests passed.', now() - interval '4 days' + interval '16 minutes'),
  ('demo-tw-log-10', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-run-4', 3, 'stdout',
   '[openhelm] run complete in 13 minutes — self-corrected from previous failure.', now() - interval '4 days' + interval '18 minutes')
ON CONFLICT (id) DO NOTHING;

-- ── 7. Data tables ──────────────────────────────────────────────────

INSERT INTO data_tables (
  id, user_id, project_id, name, description, columns, row_count,
  is_system, created_by, created_at, updated_at
)
VALUES
  ('demo-tw-dt-1', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-project',
   'tool_health_status',
   'Current status of every client-facing legal tech product. Updated by the nightly QA jobs.',
   '[
     {"id":"tool","name":"Tool","type":"text"},
     {"id":"platform","name":"Platform","type":"text"},
     {"id":"status","name":"Status","type":"text"},
     {"id":"uptime_pct_30d","name":"Uptime 30d (%)","type":"number"},
     {"id":"last_incident","name":"Last incident","type":"text"},
     {"id":"owner","name":"Owner","type":"text"}
   ]'::jsonb,
   7, false, 'ai', now() - interval '55 days', now() - interval '2 hours'),

  ('demo-tw-dt-2', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-project',
   'regulatory_updates',
   'New regulatory items classified by the daily data + cyber + AI radar. Tagged by jurisdiction and topic.',
   '[
     {"id":"day","name":"Day","type":"date"},
     {"id":"regulator","name":"Regulator","type":"text"},
     {"id":"jurisdiction","name":"Jurisdiction","type":"text"},
     {"id":"topic","name":"Topic","type":"text"},
     {"id":"headline","name":"Headline","type":"text"},
     {"id":"priority","name":"Priority","type":"text"}
   ]'::jsonb,
   12, false, 'ai', now() - interval '50 days', now() - interval '10 hours'),

  ('demo-tw-dt-3', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-project',
   'litiumtw_eval_scores',
   'Nightly LitiumTW evaluation metrics — accuracy, consistency and style across the 500-item clause extraction test set.',
   '[
     {"id":"day","name":"Day","type":"date"},
     {"id":"accuracy_pct","name":"Accuracy (%)","type":"number"},
     {"id":"consistency_pct","name":"Consistency (%)","type":"number"},
     {"id":"style_score","name":"Style (0-5)","type":"number"},
     {"id":"notes","name":"Notes","type":"text"}
   ]'::jsonb,
   14, false, 'ai', now() - interval '34 days', now() - interval '12 hours'),

  ('demo-tw-dt-4', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-project',
   'insights_seo_scores',
   'SEO health scores for the top-100 insights pages. Refreshed weekly by the SEO audit job.',
   '[
     {"id":"slug","name":"Article","type":"text"},
     {"id":"practice","name":"Practice","type":"text"},
     {"id":"lighthouse_seo","name":"Lighthouse SEO","type":"number"},
     {"id":"broken_links","name":"Broken links","type":"number"},
     {"id":"missing_meta","name":"Missing meta","type":"text"},
     {"id":"action","name":"Action","type":"text"}
   ]'::jsonb,
   8, false, 'ai', now() - interval '39 days', now() - interval '6 days'),

  ('demo-tw-dt-5', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-project',
   'bd_prospect_pipeline',
   'TMC and life-sciences BD pipeline — new funding rounds, milestones, existing-relationship flags.',
   '[
     {"id":"company","name":"Company","type":"text"},
     {"id":"sector","name":"Sector","type":"text"},
     {"id":"stage","name":"Stage","type":"text"},
     {"id":"event","name":"Event","type":"text"},
     {"id":"priority","name":"Priority","type":"number"},
     {"id":"existing_client","name":"Existing","type":"text"}
   ]'::jsonb,
   10, false, 'ai', now() - interval '25 days', now() - interval '3 days')
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description,
      columns = EXCLUDED.columns, row_count = EXCLUDED.row_count,
      updated_at = EXCLUDED.updated_at;

-- ── 8. Data table rows ──────────────────────────────────────────────

-- tool_health_status
INSERT INTO data_table_rows (id, user_id, table_id, data, sort_order, created_at, updated_at)
VALUES
  ('demo-tw-dtr-1-1', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-dt-1',
   '{"tool":"Global Data Hub","platform":"Web — TechSet","status":"healthy","uptime_pct_30d":99.87,"last_incident":"Blob storage reset (4 days ago — self-corrected)","owner":"IT / Innovation"}'::jsonb,
   0, now() - interval '50 days', now() - interval '2 hours'),
  ('demo-tw-dtr-1-2', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-dt-1',
   '{"tool":"GDPR Hub","platform":"Web — TechSet","status":"healthy","uptime_pct_30d":99.92,"last_incident":"None in 30d","owner":"IT / Innovation"}'::jsonb,
   1, now() - interval '50 days', now() - interval '2 hours'),
  ('demo-tw-dtr-1-3', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-dt-1',
   '{"tool":"Patent Map","platform":"Web — IP Tools","status":"degraded","uptime_pct_30d":98.41,"last_incident":"Jurisdiction filter endpoint timeouts — 9 days ago","owner":"IP / IT"}'::jsonb,
   2, now() - interval '50 days', now() - interval '2 hours'),
  ('demo-tw-dtr-1-4', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-dt-1',
   '{"tool":"SM&CR Classifier","platform":"Web — TW:navigate","status":"healthy","uptime_pct_30d":99.78,"last_incident":"None in 30d","owner":"Financial Regulation"}'::jsonb,
   3, now() - interval '50 days', now() - interval '2 hours'),
  ('demo-tw-dtr-1-5', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-dt-1',
   '{"tool":"Online Brand Protection","platform":"Web — IP Tools","status":"healthy","uptime_pct_30d":99.94,"last_incident":"None in 30d","owner":"Trade Marks"}'::jsonb,
   4, now() - interval '50 days', now() - interval '2 hours'),
  ('demo-tw-dtr-1-6', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-dt-1',
   '{"tool":"LitiumTW","platform":"Internal — Azure","status":"healthy","uptime_pct_30d":99.98,"last_incident":"Latency spike 12 days ago — transient","owner":"Innovation"}'::jsonb,
   5, now() - interval '50 days', now() - interval '2 hours'),
  ('demo-tw-dtr-1-7', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-dt-1',
   '{"tool":"TW:navigate","platform":"Internal — TechSet","status":"healthy","uptime_pct_30d":99.90,"last_incident":"Dependency CVE — ticket opened","owner":"Innovation"}'::jsonb,
   6, now() - interval '50 days', now() - interval '2 hours')
ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at;

-- regulatory_updates (12 rows across the last 2 weeks)
INSERT INTO data_table_rows (id, user_id, table_id, data, sort_order, created_at, updated_at)
VALUES
  ('demo-tw-dtr-2-1', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-dt-2',
   '{"day":"t-0","regulator":"ICO","jurisdiction":"UK","topic":"AI","headline":"ICO draft guidance on generative AI and employee monitoring","priority":"High"}'::jsonb,
   0, now() - interval '10 hours', now() - interval '10 hours'),
  ('demo-tw-dtr-2-2', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-dt-2',
   '{"day":"t-0","regulator":"EDPB","jurisdiction":"EU","topic":"Transfers","headline":"EDPB revised opinion on SCC clauses after Schrems II follow-up","priority":"High"}'::jsonb,
   1, now() - interval '10 hours', now() - interval '10 hours'),
  ('demo-tw-dtr-2-3', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-dt-2',
   '{"day":"t-0","regulator":"CNIL","jurisdiction":"FR","topic":"Cookies","headline":"CNIL fines retailer €600k for dark-pattern cookie banners","priority":"Medium"}'::jsonb,
   2, now() - interval '10 hours', now() - interval '10 hours'),
  ('demo-tw-dtr-2-4', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-dt-2',
   '{"day":"t-1","regulator":"AEPD","jurisdiction":"ES","topic":"Breach","headline":"AEPD enforcement — hospital data breach fine €220k","priority":"Medium"}'::jsonb,
   3, now() - interval '34 hours', now() - interval '34 hours'),
  ('demo-tw-dtr-2-5', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-dt-2',
   '{"day":"t-2","regulator":"EU Commission","jurisdiction":"EU","topic":"AI","headline":"Commission implementing act on GPAI transparency published","priority":"High"}'::jsonb,
   4, now() - interval '2 days', now() - interval '2 days'),
  ('demo-tw-dtr-2-6', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-dt-2',
   '{"day":"t-2","regulator":"ICO","jurisdiction":"UK","topic":"Children","headline":"ICO extends age-appropriate design code guidance to educational apps","priority":"Medium"}'::jsonb,
   5, now() - interval '2 days', now() - interval '2 days'),
  ('demo-tw-dtr-2-7', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-dt-2',
   '{"day":"t-4","regulator":"CNIL","jurisdiction":"FR","topic":"AI","headline":"CNIL opinion on biometric identification in retail","priority":"Medium"}'::jsonb,
   6, now() - interval '4 days', now() - interval '4 days'),
  ('demo-tw-dtr-2-8', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-dt-2',
   '{"day":"t-5","regulator":"EDPB","jurisdiction":"EU","topic":"Transfers","headline":"EDPB publishes final guidance on EU–UK adequacy follow-up","priority":"High"}'::jsonb,
   7, now() - interval '5 days', now() - interval '5 days'),
  ('demo-tw-dtr-2-9', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-dt-2',
   '{"day":"t-7","regulator":"Garante","jurisdiction":"IT","topic":"AI","headline":"Garante orders temporary suspension of AI HR screening tool","priority":"High"}'::jsonb,
   8, now() - interval '7 days', now() - interval '7 days'),
  ('demo-tw-dtr-2-10', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-dt-2',
   '{"day":"t-9","regulator":"ICO","jurisdiction":"UK","topic":"Breach","headline":"ICO reprimand for health tech start-up — records exposed via unsecured S3","priority":"Medium"}'::jsonb,
   9, now() - interval '9 days', now() - interval '9 days'),
  ('demo-tw-dtr-2-11', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-dt-2',
   '{"day":"t-11","regulator":"EU Commission","jurisdiction":"EU","topic":"DSA","headline":"Commission designates 3 new VLOPs under the DSA","priority":"Medium"}'::jsonb,
   10, now() - interval '11 days', now() - interval '11 days'),
  ('demo-tw-dtr-2-12', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-dt-2',
   '{"day":"t-13","regulator":"EDPB","jurisdiction":"EU","topic":"DPIA","headline":"EDPB updates list of DPIA-mandatory processing operations","priority":"Medium"}'::jsonb,
   11, now() - interval '13 days', now() - interval '13 days')
ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at;

-- litiumtw_eval_scores (14 days)
INSERT INTO data_table_rows (id, user_id, table_id, data, sort_order, created_at, updated_at)
VALUES
  ('demo-tw-dtr-3-1', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-dt-3',
   '{"day":"d-13","accuracy_pct":91.2,"consistency_pct":88.5,"style_score":4.2,"notes":"Baseline after prompt update"}'::jsonb, 0, now() - interval '13 days', now() - interval '13 days'),
  ('demo-tw-dtr-3-2', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-dt-3',
   '{"day":"d-12","accuracy_pct":91.4,"consistency_pct":88.7,"style_score":4.2,"notes":"Stable"}'::jsonb, 1, now() - interval '12 days', now() - interval '12 days'),
  ('demo-tw-dtr-3-3', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-dt-3',
   '{"day":"d-11","accuracy_pct":91.8,"consistency_pct":89.0,"style_score":4.2,"notes":"Slight improvement"}'::jsonb, 2, now() - interval '11 days', now() - interval '11 days'),
  ('demo-tw-dtr-3-4', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-dt-3',
   '{"day":"d-10","accuracy_pct":92.0,"consistency_pct":89.1,"style_score":4.3,"notes":"Style tweak landed"}'::jsonb, 3, now() - interval '10 days', now() - interval '10 days'),
  ('demo-tw-dtr-3-5', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-dt-3',
   '{"day":"d-9","accuracy_pct":92.1,"consistency_pct":89.0,"style_score":4.3,"notes":"-"}'::jsonb, 4, now() - interval '9 days', now() - interval '9 days'),
  ('demo-tw-dtr-3-6', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-dt-3',
   '{"day":"d-8","accuracy_pct":92.3,"consistency_pct":89.2,"style_score":4.3,"notes":"-"}'::jsonb, 5, now() - interval '8 days', now() - interval '8 days'),
  ('demo-tw-dtr-3-7', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-dt-3',
   '{"day":"d-7","accuracy_pct":92.2,"consistency_pct":89.0,"style_score":4.3,"notes":"-"}'::jsonb, 6, now() - interval '7 days', now() - interval '7 days'),
  ('demo-tw-dtr-3-8', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-dt-3',
   '{"day":"d-6","accuracy_pct":92.4,"consistency_pct":89.3,"style_score":4.3,"notes":"-"}'::jsonb, 7, now() - interval '6 days', now() - interval '6 days'),
  ('demo-tw-dtr-3-9', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-dt-3',
   '{"day":"d-5","accuracy_pct":92.5,"consistency_pct":89.4,"style_score":4.3,"notes":"Best week"}'::jsonb, 8, now() - interval '5 days', now() - interval '5 days'),
  ('demo-tw-dtr-3-10', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-dt-3',
   '{"day":"d-4","accuracy_pct":92.3,"consistency_pct":89.1,"style_score":4.3,"notes":"-"}'::jsonb, 9, now() - interval '4 days', now() - interval '4 days'),
  ('demo-tw-dtr-3-11', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-dt-3',
   '{"day":"d-3","accuracy_pct":92.1,"consistency_pct":89.0,"style_score":4.3,"notes":"Minor consistency dip"}'::jsonb, 10, now() - interval '3 days', now() - interval '3 days'),
  ('demo-tw-dtr-3-12', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-dt-3',
   '{"day":"d-2","accuracy_pct":92.2,"consistency_pct":89.3,"style_score":4.3,"notes":"-"}'::jsonb, 11, now() - interval '2 days', now() - interval '2 days'),
  ('demo-tw-dtr-3-13', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-dt-3',
   '{"day":"d-1","accuracy_pct":92.2,"consistency_pct":89.3,"style_score":4.3,"notes":"-"}'::jsonb, 12, now() - interval '1 days', now() - interval '1 days'),
  ('demo-tw-dtr-3-14', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-dt-3',
   '{"day":"d-0","accuracy_pct":92.4,"consistency_pct":88.9,"style_score":4.3,"notes":"Latest run — no drift breach"}'::jsonb, 13, now() - interval '12 hours', now() - interval '12 hours')
ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at;

-- insights_seo_scores (8 rows)
INSERT INTO data_table_rows (id, user_id, table_id, data, sort_order, created_at, updated_at)
VALUES
  ('demo-tw-dtr-4-1', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-dt-4',
   '{"slug":"dmcca-subscription-contracts","practice":"Consumer","lighthouse_seo":88,"broken_links":0,"missing_meta":"No","action":"Add FAQ schema"}'::jsonb, 0, now() - interval '6 days', now() - interval '6 days'),
  ('demo-tw-dtr-4-2', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-dt-4',
   '{"slug":"cbam-transitional-reporting","practice":"Trade & Customs","lighthouse_seo":91,"broken_links":0,"missing_meta":"No","action":"-"}'::jsonb, 1, now() - interval '6 days', now() - interval '6 days'),
  ('demo-tw-dtr-4-3', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-dt-4',
   '{"slug":"digital-accessibility-2025","practice":"Tech & Media","lighthouse_seo":76,"broken_links":2,"missing_meta":"Description","action":"Fix broken links + description"}'::jsonb, 2, now() - interval '6 days', now() - interval '6 days'),
  ('demo-tw-dtr-4-4', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-dt-4',
   '{"slug":"eu-ai-act-gpai-obligations","practice":"AI & Regulation","lighthouse_seo":82,"broken_links":0,"missing_meta":"No","action":"Add Article schema"}'::jsonb, 3, now() - interval '6 days', now() - interval '6 days'),
  ('demo-tw-dtr-4-5', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-dt-4',
   '{"slug":"sccs-post-schrems-ii","practice":"Data & Cyber","lighthouse_seo":94,"broken_links":0,"missing_meta":"No","action":"-"}'::jsonb, 4, now() - interval '6 days', now() - interval '6 days'),
  ('demo-tw-dtr-4-6', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-dt-4',
   '{"slug":"nis2-readiness-checklist","practice":"Data & Cyber","lighthouse_seo":87,"broken_links":1,"missing_meta":"OG image","action":"Fix broken link; add OG image"}'::jsonb, 5, now() - interval '6 days', now() - interval '6 days'),
  ('demo-tw-dtr-4-7', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-dt-4',
   '{"slug":"venture-term-sheets-2026","practice":"TMC / Venture","lighthouse_seo":89,"broken_links":0,"missing_meta":"No","action":"-"}'::jsonb, 6, now() - interval '6 days', now() - interval '6 days'),
  ('demo-tw-dtr-4-8', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-dt-4',
   '{"slug":"private-wealth-sham-trusts","practice":"Private Wealth","lighthouse_seo":78,"broken_links":0,"missing_meta":"Description","action":"Add description + internal links"}'::jsonb, 7, now() - interval '6 days', now() - interval '6 days')
ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at;

-- bd_prospect_pipeline (10 rows)
INSERT INTO data_table_rows (id, user_id, table_id, data, sort_order, created_at, updated_at)
VALUES
  ('demo-tw-dtr-5-1', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-dt-5',
   '{"company":"Sona Labs","sector":"Life Sciences","stage":"Series B","event":"$45m Series B — 3 days ago","priority":9,"existing_client":"Yes"}'::jsonb, 0, now() - interval '3 days', now() - interval '3 days'),
  ('demo-tw-dtr-5-2', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-dt-5',
   '{"company":"Juro","sector":"Legal Tech","stage":"Series B","event":"£12m Series B — 6 days ago","priority":10,"existing_client":"No"}'::jsonb, 1, now() - interval '6 days', now() - interval '6 days'),
  ('demo-tw-dtr-5-3', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-dt-5',
   '{"company":"Harbr","sector":"Data / AI","stage":"Series A","event":"£7m round — 6 days ago","priority":7,"existing_client":"No"}'::jsonb, 2, now() - interval '6 days', now() - interval '6 days'),
  ('demo-tw-dtr-5-4', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-dt-5',
   '{"company":"Causal","sector":"SaaS / Fintech","stage":"Growth","event":"$15m extension — 13 days ago","priority":8,"existing_client":"No"}'::jsonb, 3, now() - interval '13 days', now() - interval '13 days'),
  ('demo-tw-dtr-5-5', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-dt-5',
   '{"company":"Humanloop","sector":"AI tooling","stage":"Series A","event":"$8m Series A","priority":8,"existing_client":"No"}'::jsonb, 4, now() - interval '13 days', now() - interval '13 days'),
  ('demo-tw-dtr-5-6', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-dt-5',
   '{"company":"Cleo AI","sector":"Fintech","stage":"Series C","event":"$80m growth round","priority":7,"existing_client":"Yes"}'::jsonb, 5, now() - interval '13 days', now() - interval '13 days'),
  ('demo-tw-dtr-5-7', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-dt-5',
   '{"company":"Monta","sector":"Climate tech","stage":"Series B","event":"€30m Series B","priority":7,"existing_client":"No"}'::jsonb, 6, now() - interval '13 days', now() - interval '13 days'),
  ('demo-tw-dtr-5-8', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-dt-5',
   '{"company":"CausaLens","sector":"AI / Analytics","stage":"Growth","event":"Acquisition rumour","priority":6,"existing_client":"No"}'::jsonb, 7, now() - interval '10 days', now() - interval '10 days'),
  ('demo-tw-dtr-5-9', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-dt-5',
   '{"company":"ProxyClick","sector":"SaaS","stage":"Series B","event":"$20m Series B","priority":7,"existing_client":"No"}'::jsonb, 8, now() - interval '10 days', now() - interval '10 days'),
  ('demo-tw-dtr-5-10', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-dt-5',
   '{"company":"BenevolentAI","sector":"Life Sciences","stage":"Public","event":"Partnership with major pharma — milestone","priority":8,"existing_client":"Yes"}'::jsonb, 9, now() - interval '10 days', now() - interval '10 days')
ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at;

-- ── 9. Visualizations ───────────────────────────────────────────────

INSERT INTO visualizations (
  id, user_id, project_id, goal_id, data_table_id, name, description,
  chart_type, config, status, source, sort_order, created_at, updated_at
)
VALUES
  ('demo-tw-viz-1', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-project', 'demo-tw-goal-4',
   'demo-tw-dt-3', 'LitiumTW accuracy (14d)',
   'Daily accuracy from the nightly 500-item clause extraction evaluation.',
   'line',
   '{"xColumnId":"day","series":[{"columnId":"accuracy_pct","label":"Accuracy %"}]}'::jsonb,
   'active', 'user', 0, now() - interval '30 days', now() - interval '12 hours'),
  ('demo-tw-viz-2', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-project', 'demo-tw-goal-1',
   'demo-tw-dt-1', 'Legal tech uptime (30d)',
   '30-day uptime by tool. SM&CR Classifier and Patent Map are running below the 99.5% SLO.',
   'bar',
   '{"xColumnId":"tool","series":[{"columnId":"uptime_pct_30d","label":"Uptime %"}]}'::jsonb,
   'active', 'user', 1, now() - interval '28 days', now() - interval '2 hours')
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description,
      config = EXCLUDED.config, updated_at = EXCLUDED.updated_at;

-- ── 10. Memories ────────────────────────────────────────────────────

INSERT INTO memories (
  id, user_id, project_id, goal_id, type, content,
  source_type, importance, tags, created_at, updated_at
)
VALUES
  ('demo-tw-mem-1', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-project', 'demo-tw-goal-1',
   'procedural',
   'Global Data Hub /dpia blob storage connection resets typically resolve within 5 minutes. Recommended self-correction: wait 5 min, retry once, only escalate if the retry also fails.',
   'run', 8, '["global-data-hub","blob-storage","self-correction"]'::jsonb,
   now() - interval '4 days', now() - interval '4 days'),

  ('demo-tw-mem-2', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-project', 'demo-tw-goal-4',
   'semantic',
   'LitiumTW clause extraction accuracy degrades noticeably when input prompts exceed ~8k tokens. Preferred approach: chunk contracts into 6k-token windows with overlap.',
   'run', 9, '["litiumtw","chunking","clause-extraction"]'::jsonb,
   now() - interval '12 days', now() - interval '12 days'),

  ('demo-tw-mem-3', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-project', 'demo-tw-goal-1',
   'semantic',
   'Patent Map jurisdiction filter endpoint flakes under concurrent requests > 20/s. IT have it on the roadmap but in the meantime the probe should retry with jitter rather than marking failure immediately.',
   'run', 7, '["patent-map","flaky","retries"]'::jsonb,
   now() - interval '9 days', now() - interval '9 days'),

  ('demo-tw-mem-4', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-project', 'demo-tw-goal-2',
   'semantic',
   'EDPB tends to publish binding decisions on Thursdays at 09:00 CET. The daily radar cron fires at 07:00 UTC, so the Thursday run reliably picks them up the same day.',
   'run', 6, '["edpb","scheduling","radar"]'::jsonb,
   now() - interval '20 days', now() - interval '20 days'),

  ('demo-tw-mem-5', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-project', 'demo-tw-goal-5',
   'episodic',
   'Sona Labs were advised on their $45m Series B by the TMC team earlier this year. They are an existing client — any BD follow-up should go through the relationship partner, not cold outreach.',
   'user', 9, '["bd","sona","existing-client"]'::jsonb,
   now() - interval '3 days', now() - interval '3 days')
ON CONFLICT (id) DO UPDATE
  SET content = EXCLUDED.content, importance = EXCLUDED.importance, updated_at = EXCLUDED.updated_at;

-- ── 11. Chat conversation + messages ────────────────────────────────

INSERT INTO conversations (id, user_id, project_id, channel, title, sort_order, created_at, updated_at)
VALUES
  ('demo-tw-conv-1', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-project', 'app',
   'Which tool is most at risk right now?', 0,
   now() - interval '1 day', now() - interval '23 hours')
ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, updated_at = EXCLUDED.updated_at;

INSERT INTO messages (id, user_id, conversation_id, role, content, created_at)
VALUES
  ('demo-tw-msg-1', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-conv-1', 'user',
   'Which of our public microsites is most at risk right now, and what should engineering prioritise this week?',
   now() - interval '1 day'),

  ('demo-tw-msg-2', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-conv-1', 'assistant',
   'Based on the tool_health_status data table, Patent Map is the highest-risk tool: 30-day uptime is 98.4%, below the 99.5% SLO, and the jurisdiction filter endpoint timed out 9 days ago with 3/3 retry failures. The memories log notes the endpoint flakes under concurrent requests above ~20/s — IT have it on the roadmap but it is not yet fixed. Everything else is green: Global Data Hub, GDPR Hub, SM&CR Classifier, Online Brand Protection, LitiumTW and TW:navigate are all above 99.7%. Recommended priorities this week: (1) escalate the Patent Map throttling fix with IT, (2) close the open CVE tickets on TW:navigate (CVE-2021-23337 and CVE-2023-0842) from the weekly dependency scan, (3) keep the blob-storage self-correction procedure active for Global Data Hub since it has already triggered once in the last week.',
   now() - interval '23 hours 58 minutes'),

  ('demo-tw-msg-3', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-conv-1', 'user',
   'Has LitiumTW drifted at all this week?',
   now() - interval '23 hours 40 minutes'),

  ('demo-tw-msg-4', '000000d0-0000-0000-0000-0000000000d1', 'demo-tw-conv-1', 'assistant',
   'No meaningful drift. The litiumtw_eval_scores table shows accuracy between 92.1% and 92.5% over the past 7 days, consistency between 88.9% and 89.4%, and style score holding at 4.3/5. Last night is 92.4% / 88.9% / 4.3 — within the 5% alert threshold. The only minor wobble was a 0.4 consistency dip three days ago that recovered the next day, so no action needed. The nightly eval job will continue to watch it.',
   now() - interval '23 hours 38 minutes')
ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content;
