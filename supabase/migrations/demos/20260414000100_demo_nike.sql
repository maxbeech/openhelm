-- ============================================================
-- Plan 13 — Nike public demo seed
--
-- Idempotent seed data for the /demo/nike route. Insert-or-update
-- on every row so re-running this migration leaves the DB in an
-- identical state — useful for resetting demo content.
--
-- Ownership: a synthetic "demo owner" auth user with a fixed UUID.
-- All demo data hangs off this user. RLS policies from migration
-- 20260414000002 expose the rows to anonymous visitors via the
-- is_demo_project() check.
--
-- Timestamps are relative (`now() - interval '…'`) so the dashboard's
-- "last 30 days" window always looks current regardless of when the
-- migration ran. No weekly CI re-seed needed.
-- ============================================================

-- ── 1. Demo owner user ──────────────────────────────────────────────

-- Create the owner user via auth.admin-style direct insert. This
-- bypasses the normal signup flow; safe because we control the
-- migration context (service role) and the UUID is well-known.
INSERT INTO auth.users (
  id, instance_id, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, role, aud,
  raw_app_meta_data, raw_user_meta_data, is_anonymous
)
VALUES (
  '000000d0-0000-0000-0000-0000000000d0',
  '00000000-0000-0000-0000-000000000000',
  'demo-owner+nike@openhelm.ai',
  '',
  now(),
  now(),
  now(),
  'authenticated',
  'authenticated',
  '{"provider":"demo"}'::jsonb,
  '{"name":"Demo Owner (Nike)"}'::jsonb,
  false
)
ON CONFLICT (id) DO NOTHING;

-- ── 2. Project ──────────────────────────────────────────────────────

INSERT INTO projects (
  id, user_id, name, description, directory_path, git_url,
  is_demo, demo_slug, created_at, updated_at
)
VALUES (
  'demo-nike-project',
  '000000d0-0000-0000-0000-0000000000d0',
  'Nike Digital Marketing',
  'OpenHelm workspace for the Nike Direct digital marketing team — campaign performance tracking, creative optimization, and weekly outcome reviews across paid social and search.',
  '/workspace/nike-marketing',
  'https://github.com/example/nike-marketing',
  true,
  'nike',
  now() - interval '45 days',
  now() - interval '2 hours'
)
ON CONFLICT (id) DO UPDATE
  SET name          = EXCLUDED.name,
      description   = EXCLUDED.description,
      is_demo       = EXCLUDED.is_demo,
      demo_slug     = EXCLUDED.demo_slug,
      updated_at    = EXCLUDED.updated_at;

-- ── 3. Goals ────────────────────────────────────────────────────────

INSERT INTO goals (
  id, user_id, project_id, name, description, status,
  icon, sort_order, created_at, updated_at
)
VALUES
  ('demo-nike-goal-1', '000000d0-0000-0000-0000-0000000000d0', 'demo-nike-project',
   'Grow paid social ROAS to 4.0', 'Weekly optimisation of Meta + TikTok creatives targeting a 4.0x return-on-ad-spend by the end of Q2.',
   'active', 'target', 0, now() - interval '40 days', now() - interval '1 day'),
  ('demo-nike-goal-2', '000000d0-0000-0000-0000-0000000000d0', 'demo-nike-project',
   'Reduce CAC on new-customer acquisition', 'Lower blended customer acquisition cost across all paid channels by 15% through bid and creative tuning.',
   'active', 'trending-down', 1, now() - interval '38 days', now() - interval '3 days'),
  ('demo-nike-goal-3', '000000d0-0000-0000-0000-0000000000d0', 'demo-nike-project',
   'Launch React Runners campaign', 'Coordinate launch-week execution for the React Runners product drop including creative QA, budget pacing, and same-day performance alerts.',
   'active', 'rocket', 2, now() - interval '15 days', now() - interval '1 day')
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description, updated_at = EXCLUDED.updated_at;

-- ── 4. Jobs ─────────────────────────────────────────────────────────

INSERT INTO jobs (
  id, user_id, goal_id, project_id, name, description, prompt,
  schedule_type, schedule_config, is_enabled, is_archived,
  next_fire_at, model, model_effort, permission_mode,
  source, sort_order, created_at, updated_at
)
VALUES
  ('demo-nike-job-1', '000000d0-0000-0000-0000-0000000000d0', 'demo-nike-goal-1', 'demo-nike-project',
   'Daily ROAS roll-up',
   'Pull ROAS by campaign from Meta Ads and TikTok Ads into the campaign performance table every morning.',
   'Fetch yesterday''s ROAS for each active campaign from Meta Ads Manager and TikTok Ads Manager. Insert or update rows in the campaign_performance data table. Summarise any campaigns whose ROAS dropped >15% vs 7-day average.',
   'cron', '{"expression":"0 8 * * *"}'::jsonb, true, false,
   now() + interval '14 hours', 'sonnet', 'medium', 'bypassPermissions',
   'user', 0, now() - interval '40 days', now() - interval '1 day'),

  ('demo-nike-job-2', '000000d0-0000-0000-0000-0000000000d0', 'demo-nike-goal-1', 'demo-nike-project',
   'Weekly creative performance review',
   'Rank top and bottom 5 creatives by CTR × conversion rate, identify common themes, flag any creative fatigue.',
   'Review last 7 days of creative performance. For each campaign group the top 5 and bottom 5 creatives. Write a short summary naming winners, losers, and any likely cases of creative fatigue (CTR dropping >20% over 3 days).',
   'cron', '{"expression":"0 9 * * 1"}'::jsonb, true, false,
   now() + interval '4 days', 'sonnet', 'high', 'bypassPermissions',
   'user', 1, now() - interval '38 days', now() - interval '2 days'),

  ('demo-nike-job-3', '000000d0-0000-0000-0000-0000000000d0', 'demo-nike-goal-2', 'demo-nike-project',
   'CAC alerting',
   'Alert when blended CAC exceeds the 30-day trailing average by 20% or more.',
   'Compute blended CAC from yesterday''s spend and new customer counts across all paid channels. Compare against the 30-day trailing average. If the spike is ≥20% above baseline, create an inbox alert with the probable culprit channel.',
   'interval', '{"minutes":360}'::jsonb, true, false,
   now() + interval '3 hours', 'sonnet', 'medium', 'bypassPermissions',
   'user', 2, now() - interval '30 days', now() - interval '6 hours'),

  ('demo-nike-job-4', '000000d0-0000-0000-0000-0000000000d0', 'demo-nike-goal-3', 'demo-nike-project',
   'React Runners launch-day pacing',
   'Monitor launch-week hourly spend and conversion pace; alert if ahead/behind plan by >25%.',
   'Every hour during launch week, compare actual ad spend and conversions against the hour-by-hour plan. If the actual vs plan gap exceeds 25% in either direction, create an inbox action with the specific budget adjustments needed.',
   'interval', '{"minutes":60}'::jsonb, true, false,
   now() + interval '20 minutes', 'sonnet', 'high', 'bypassPermissions',
   'user', 3, now() - interval '14 days', now() - interval '45 minutes'),

  ('demo-nike-job-5', '000000d0-0000-0000-0000-0000000000d0', 'demo-nike-goal-2', 'demo-nike-project',
   'Competitor pricing snapshot',
   'Scrape daily competitor pricing on key SKUs and log any meaningful changes.',
   'Open competitor product pages (Adidas, New Balance, Puma) for the top 20 Nike SKUs. Extract current price and promotion flags. Record into the competitor_pricing table and note any changes >5% vs yesterday.',
   'cron', '{"expression":"0 11 * * *"}'::jsonb, false, false,
   null, 'sonnet', 'medium', 'bypassPermissions',
   'user', 4, now() - interval '22 days', now() - interval '5 days'),

  ('demo-nike-job-6', '000000d0-0000-0000-0000-0000000000d0', null, 'demo-nike-project',
   'Weekly stakeholder digest',
   'Compose and send the Friday performance digest covering all active campaigns.',
   'Compile a concise Friday digest of the week: top-level ROAS, CAC, new customers, any significant creative or budget decisions, and next week''s focus. Save to memories and email to the stakeholder list.',
   'cron', '{"expression":"0 16 * * 5"}'::jsonb, true, false,
   now() + interval '2 days', 'sonnet', 'medium', 'bypassPermissions',
   'user', 5, now() - interval '35 days', now() - interval '4 days')
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description,
      prompt = EXCLUDED.prompt, schedule_config = EXCLUDED.schedule_config,
      next_fire_at = EXCLUDED.next_fire_at, is_enabled = EXCLUDED.is_enabled,
      updated_at = EXCLUDED.updated_at;

-- ── 5. Runs ─────────────────────────────────────────────────────────

INSERT INTO runs (
  id, user_id, job_id, status, trigger_source,
  started_at, finished_at, exit_code, summary,
  input_tokens, output_tokens, created_at
)
VALUES
  -- Daily ROAS roll-up — recent successful runs
  ('demo-nike-run-1', '000000d0-0000-0000-0000-0000000000d0', 'demo-nike-job-1', 'succeeded', 'scheduled',
   now() - interval '22 hours', now() - interval '21 hours 52 minutes', 0,
   'Updated 12 campaigns. Summer Vibes ROAS dropped 18% vs 7-day average — flagged.',
   18420, 2341, now() - interval '22 hours'),
  ('demo-nike-run-2', '000000d0-0000-0000-0000-0000000000d0', 'demo-nike-job-1', 'succeeded', 'scheduled',
   now() - interval '46 hours', now() - interval '45 hours 54 minutes', 0,
   'Updated 12 campaigns. No anomalies detected.',
   17980, 1876, now() - interval '46 hours'),
  ('demo-nike-run-3', '000000d0-0000-0000-0000-0000000000d0', 'demo-nike-job-1', 'succeeded', 'scheduled',
   now() - interval '70 hours', now() - interval '69 hours 55 minutes', 0,
   'Updated 11 campaigns (TikTok Summer paused). ROAS trend positive.',
   16210, 1742, now() - interval '70 hours'),
  ('demo-nike-run-4', '000000d0-0000-0000-0000-0000000000d0', 'demo-nike-job-1', 'succeeded', 'scheduled',
   now() - interval '94 hours', now() - interval '93 hours 54 minutes', 0,
   'Updated 11 campaigns. Air Force Always Running hit 4.8x — new weekly high.',
   17022, 1984, now() - interval '94 hours'),
  ('demo-nike-run-5', '000000d0-0000-0000-0000-0000000000d0', 'demo-nike-job-1', 'failed', 'scheduled',
   now() - interval '5 days', now() - interval '5 days' + interval '2 minutes', 1,
   'Meta Ads token expired — unable to fetch ROAS. Self-correcting: requested token refresh via credential MCP.',
   9221, 842, now() - interval '5 days'),
  ('demo-nike-run-6', '000000d0-0000-0000-0000-0000000000d0', 'demo-nike-job-1', 'succeeded', 'corrective',
   now() - interval '5 days' + interval '5 minutes', now() - interval '5 days' + interval '14 minutes', 0,
   'Retried after token refresh. Updated 12 campaigns successfully.',
   17344, 2012, now() - interval '5 days' + interval '5 minutes'),

  -- Weekly creative performance review
  ('demo-nike-run-7', '000000d0-0000-0000-0000-0000000000d0', 'demo-nike-job-2', 'succeeded', 'scheduled',
   now() - interval '3 days', now() - interval '3 days' + interval '11 minutes', 0,
   'Top creatives: ''Hero Shot Air Jordan'' (CTR 4.2%), ''Split Screen Runners''. Bottom: ''Blue Static BG'' — replace candidate. Likely fatigue on Vol.2 carousel.',
   28410, 4120, now() - interval '3 days'),

  -- CAC alerting
  ('demo-nike-run-8', '000000d0-0000-0000-0000-0000000000d0', 'demo-nike-job-3', 'succeeded', 'scheduled',
   now() - interval '4 hours', now() - interval '3 hours 58 minutes', 0,
   'Blended CAC £42.10 — within 2% of trailing 30-day average. No alert.',
   8220, 612, now() - interval '4 hours'),
  ('demo-nike-run-9', '000000d0-0000-0000-0000-0000000000d0', 'demo-nike-job-3', 'succeeded', 'scheduled',
   now() - interval '10 hours', now() - interval '9 hours 58 minutes', 0,
   'Blended CAC £43.80. Trending slightly up but below threshold.',
   8190, 598, now() - interval '10 hours'),
  ('demo-nike-run-10', '000000d0-0000-0000-0000-0000000000d0', 'demo-nike-job-3', 'succeeded', 'scheduled',
   now() - interval '16 hours', now() - interval '15 hours 58 minutes', 0,
   'Blended CAC £41.20. Ad spend reallocation appears to be working.',
   8210, 604, now() - interval '16 hours'),

  -- React Runners launch pacing
  ('demo-nike-run-11', '000000d0-0000-0000-0000-0000000000d0', 'demo-nike-job-4', 'succeeded', 'scheduled',
   now() - interval '1 hour', now() - interval '58 minutes', 0,
   'Hour 8 of launch week: spend £12,400 (plan £11,200). Ahead by 10.7% — within tolerance.',
   6120, 482, now() - interval '1 hour'),
  ('demo-nike-run-12', '000000d0-0000-0000-0000-0000000000d0', 'demo-nike-job-4', 'succeeded', 'scheduled',
   now() - interval '2 hours', now() - interval '1 hours 58 minutes', 0,
   'Hour 7: conversions pacing 34% above plan. Inbox action created: pause the £50 CPC bid on ''Runners NYC''.',
   6098, 512, now() - interval '2 hours'),

  -- Weekly digest
  ('demo-nike-run-13', '000000d0-0000-0000-0000-0000000000d0', 'demo-nike-job-6', 'succeeded', 'scheduled',
   now() - interval '6 days', now() - interval '6 days' + interval '9 minutes', 0,
   'Composed Friday digest. Saved to memories; emailed to stakeholders@example.com.',
   14210, 3840, now() - interval '6 days')
ON CONFLICT (id) DO UPDATE
  SET status = EXCLUDED.status, summary = EXCLUDED.summary,
      started_at = EXCLUDED.started_at, finished_at = EXCLUDED.finished_at;

-- ── 6. Run logs (one fleshed-out example) ──────────────────────────

INSERT INTO run_logs (id, user_id, run_id, sequence, stream, text, timestamp)
VALUES
  ('demo-nike-log-1', '000000d0-0000-0000-0000-0000000000d0', 'demo-nike-run-1', 0, 'stdout',
   '[openhelm] starting job demo-nike-job-1: Daily ROAS roll-up', now() - interval '22 hours'),
  ('demo-nike-log-2', '000000d0-0000-0000-0000-0000000000d0', 'demo-nike-run-1', 1, 'stdout',
   '[claude] Fetching Meta Ads Manager data for 12 active campaigns…', now() - interval '21 hours 59 minutes'),
  ('demo-nike-log-3', '000000d0-0000-0000-0000-0000000000d0', 'demo-nike-run-1', 2, 'stdout',
   '[claude] Fetched 12 campaigns. Total spend: £48,210. Total revenue: £182,440.', now() - interval '21 hours 57 minutes'),
  ('demo-nike-log-4', '000000d0-0000-0000-0000-0000000000d0', 'demo-nike-run-1', 3, 'stdout',
   '[claude] Fetching TikTok Ads data…', now() - interval '21 hours 56 minutes'),
  ('demo-nike-log-5', '000000d0-0000-0000-0000-0000000000d0', 'demo-nike-run-1', 4, 'stdout',
   '[claude] TikTok data retrieved. 4 campaigns, total spend £12,100, revenue £41,300.', now() - interval '21 hours 55 minutes'),
  ('demo-nike-log-6', '000000d0-0000-0000-0000-0000000000d0', 'demo-nike-run-1', 5, 'stdout',
   '[claude] Updating campaign_performance data table with 12 rows…', now() - interval '21 hours 54 minutes'),
  ('demo-nike-log-7', '000000d0-0000-0000-0000-0000000000d0', 'demo-nike-run-1', 6, 'stdout',
   '[claude] Flagging: Summer Vibes ROAS 2.8x (7-day avg 3.4x) — dropped 17.6%', now() - interval '21 hours 53 minutes'),
  ('demo-nike-log-8', '000000d0-0000-0000-0000-0000000000d0', 'demo-nike-run-1', 7, 'stdout',
   '[openhelm] run complete in 7m 48s — 18,420 input tokens, 2,341 output tokens', now() - interval '21 hours 52 minutes')
ON CONFLICT (id) DO NOTHING;

-- ── 7. Data tables ──────────────────────────────────────────────────

INSERT INTO data_tables (
  id, user_id, project_id, name, description, columns, row_count,
  is_system, created_by, created_at, updated_at
)
VALUES
  ('demo-nike-dt-1', '000000d0-0000-0000-0000-0000000000d0', 'demo-nike-project',
   'campaign_performance',
   'Daily ROAS, spend, and conversion metrics per campaign across Meta Ads and TikTok.',
   '[
     {"id":"campaign","name":"Campaign","type":"text"},
     {"id":"platform","name":"Platform","type":"text"},
     {"id":"spend_gbp","name":"Spend (£)","type":"number"},
     {"id":"revenue_gbp","name":"Revenue (£)","type":"number"},
     {"id":"roas","name":"ROAS","type":"number"},
     {"id":"conversions","name":"Conversions","type":"number"},
     {"id":"captured_at","name":"Captured","type":"date"}
   ]'::jsonb,
   12, false, 'ai', now() - interval '40 days', now() - interval '22 hours'),

  ('demo-nike-dt-2', '000000d0-0000-0000-0000-0000000000d0', 'demo-nike-project',
   'creative_performance',
   'Top and bottom creatives by CTR × conversion rate for each weekly review.',
   '[
     {"id":"creative","name":"Creative","type":"text"},
     {"id":"campaign","name":"Campaign","type":"text"},
     {"id":"ctr","name":"CTR (%)","type":"number"},
     {"id":"cvr","name":"CVR (%)","type":"number"},
     {"id":"rank","name":"Rank","type":"text"}
   ]'::jsonb,
   10, false, 'ai', now() - interval '38 days', now() - interval '3 days'),

  ('demo-nike-dt-3', '000000d0-0000-0000-0000-0000000000d0', 'demo-nike-project',
   'cac_daily',
   'Daily blended customer acquisition cost and new-customer volume.',
   '[
     {"id":"day","name":"Day","type":"date"},
     {"id":"cac_gbp","name":"CAC (£)","type":"number"},
     {"id":"new_customers","name":"New customers","type":"number"},
     {"id":"total_spend_gbp","name":"Total spend (£)","type":"number"}
   ]'::jsonb,
   14, false, 'ai', now() - interval '30 days', now() - interval '4 hours')
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description,
      columns = EXCLUDED.columns, row_count = EXCLUDED.row_count,
      updated_at = EXCLUDED.updated_at;

-- ── 8. Data table rows — campaign_performance ───────────────────────

INSERT INTO data_table_rows (id, user_id, table_id, data, sort_order, created_at, updated_at)
VALUES
  ('demo-nike-dtr-1-1', '000000d0-0000-0000-0000-0000000000d0', 'demo-nike-dt-1',
   '{"campaign":"Summer Vibes","platform":"Meta","spend_gbp":6420,"revenue_gbp":17976,"roas":2.8,"conversions":412,"captured_at":"recent"}'::jsonb,
   0, now() - interval '22 hours', now() - interval '22 hours'),
  ('demo-nike-dtr-1-2', '000000d0-0000-0000-0000-0000000000d0', 'demo-nike-dt-1',
   '{"campaign":"Air Force Always Running","platform":"Meta","spend_gbp":5200,"revenue_gbp":24960,"roas":4.8,"conversions":388,"captured_at":"recent"}'::jsonb,
   1, now() - interval '22 hours', now() - interval '22 hours'),
  ('demo-nike-dtr-1-3', '000000d0-0000-0000-0000-0000000000d0', 'demo-nike-dt-1',
   '{"campaign":"React Runners Launch","platform":"Meta","spend_gbp":12400,"revenue_gbp":45880,"roas":3.7,"conversions":612,"captured_at":"recent"}'::jsonb,
   2, now() - interval '22 hours', now() - interval '22 hours'),
  ('demo-nike-dtr-1-4', '000000d0-0000-0000-0000-0000000000d0', 'demo-nike-dt-1',
   '{"campaign":"TikTok Creator Series","platform":"TikTok","spend_gbp":4820,"revenue_gbp":16870,"roas":3.5,"conversions":289,"captured_at":"recent"}'::jsonb,
   3, now() - interval '22 hours', now() - interval '22 hours'),
  ('demo-nike-dtr-1-5', '000000d0-0000-0000-0000-0000000000d0', 'demo-nike-dt-1',
   '{"campaign":"Always-On Retargeting","platform":"Meta","spend_gbp":3100,"revenue_gbp":14570,"roas":4.7,"conversions":354,"captured_at":"recent"}'::jsonb,
   4, now() - interval '22 hours', now() - interval '22 hours')
ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at;

-- cac_daily (last 14 days)
INSERT INTO data_table_rows (id, user_id, table_id, data, sort_order, created_at, updated_at)
VALUES
  ('demo-nike-dtr-3-1', '000000d0-0000-0000-0000-0000000000d0', 'demo-nike-dt-3',
   '{"day":"d-13","cac_gbp":48.20,"new_customers":210,"total_spend_gbp":10122}'::jsonb, 0, now() - interval '13 days', now() - interval '13 days'),
  ('demo-nike-dtr-3-2', '000000d0-0000-0000-0000-0000000000d0', 'demo-nike-dt-3',
   '{"day":"d-12","cac_gbp":47.80,"new_customers":198,"total_spend_gbp":9464}'::jsonb, 1, now() - interval '12 days', now() - interval '12 days'),
  ('demo-nike-dtr-3-3', '000000d0-0000-0000-0000-0000000000d0', 'demo-nike-dt-3',
   '{"day":"d-11","cac_gbp":46.10,"new_customers":224,"total_spend_gbp":10326}'::jsonb, 2, now() - interval '11 days', now() - interval '11 days'),
  ('demo-nike-dtr-3-4', '000000d0-0000-0000-0000-0000000000d0', 'demo-nike-dt-3',
   '{"day":"d-10","cac_gbp":44.90,"new_customers":238,"total_spend_gbp":10686}'::jsonb, 3, now() - interval '10 days', now() - interval '10 days'),
  ('demo-nike-dtr-3-5', '000000d0-0000-0000-0000-0000000000d0', 'demo-nike-dt-3',
   '{"day":"d-9","cac_gbp":45.30,"new_customers":231,"total_spend_gbp":10464}'::jsonb, 4, now() - interval '9 days', now() - interval '9 days'),
  ('demo-nike-dtr-3-6', '000000d0-0000-0000-0000-0000000000d0', 'demo-nike-dt-3',
   '{"day":"d-8","cac_gbp":43.80,"new_customers":247,"total_spend_gbp":10819}'::jsonb, 5, now() - interval '8 days', now() - interval '8 days'),
  ('demo-nike-dtr-3-7', '000000d0-0000-0000-0000-0000000000d0', 'demo-nike-dt-3',
   '{"day":"d-7","cac_gbp":44.20,"new_customers":241,"total_spend_gbp":10652}'::jsonb, 6, now() - interval '7 days', now() - interval '7 days'),
  ('demo-nike-dtr-3-8', '000000d0-0000-0000-0000-0000000000d0', 'demo-nike-dt-3',
   '{"day":"d-6","cac_gbp":42.90,"new_customers":256,"total_spend_gbp":10982}'::jsonb, 7, now() - interval '6 days', now() - interval '6 days'),
  ('demo-nike-dtr-3-9', '000000d0-0000-0000-0000-0000000000d0', 'demo-nike-dt-3',
   '{"day":"d-5","cac_gbp":42.40,"new_customers":262,"total_spend_gbp":11108}'::jsonb, 8, now() - interval '5 days', now() - interval '5 days'),
  ('demo-nike-dtr-3-10','000000d0-0000-0000-0000-0000000000d0', 'demo-nike-dt-3',
   '{"day":"d-4","cac_gbp":42.10,"new_customers":271,"total_spend_gbp":11409}'::jsonb, 9, now() - interval '4 days', now() - interval '4 days'),
  ('demo-nike-dtr-3-11','000000d0-0000-0000-0000-0000000000d0', 'demo-nike-dt-3',
   '{"day":"d-3","cac_gbp":41.80,"new_customers":279,"total_spend_gbp":11662}'::jsonb, 10, now() - interval '3 days', now() - interval '3 days'),
  ('demo-nike-dtr-3-12','000000d0-0000-0000-0000-0000000000d0', 'demo-nike-dt-3',
   '{"day":"d-2","cac_gbp":41.20,"new_customers":288,"total_spend_gbp":11866}'::jsonb, 11, now() - interval '2 days', now() - interval '2 days'),
  ('demo-nike-dtr-3-13','000000d0-0000-0000-0000-0000000000d0', 'demo-nike-dt-3',
   '{"day":"d-1","cac_gbp":41.60,"new_customers":283,"total_spend_gbp":11773}'::jsonb, 12, now() - interval '1 day', now() - interval '1 day'),
  ('demo-nike-dtr-3-14','000000d0-0000-0000-0000-0000000000d0', 'demo-nike-dt-3',
   '{"day":"d-0","cac_gbp":42.10,"new_customers":291,"total_spend_gbp":12251}'::jsonb, 13, now() - interval '4 hours', now() - interval '4 hours')
ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at;

-- ── 9. Visualizations ───────────────────────────────────────────────

INSERT INTO visualizations (
  id, user_id, project_id, goal_id, data_table_id, name, description,
  chart_type, config, status, source, sort_order, created_at, updated_at
)
VALUES
  ('demo-nike-viz-1', '000000d0-0000-0000-0000-0000000000d0', 'demo-nike-project', 'demo-nike-goal-2',
   'demo-nike-dt-3', 'Blended CAC trend',
   'Last 14 days of blended customer acquisition cost — downward trend since the bid recalibration.',
   'line',
   '{"xColumnId":"day","series":[{"columnId":"cac_gbp","label":"CAC (£)"}]}'::jsonb,
   'active', 'user', 0, now() - interval '20 days', now() - interval '1 day'),
  ('demo-nike-viz-2', '000000d0-0000-0000-0000-0000000000d0', 'demo-nike-project', 'demo-nike-goal-1',
   'demo-nike-dt-1', 'Campaign ROAS by platform',
   'Current-day return-on-ad-spend per active campaign grouped by platform.',
   'bar',
   '{"xColumnId":"campaign","series":[{"columnId":"roas","label":"ROAS"}]}'::jsonb,
   'active', 'user', 1, now() - interval '18 days', now() - interval '22 hours')
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description,
      config = EXCLUDED.config, updated_at = EXCLUDED.updated_at;

-- ── 10. Memories ────────────────────────────────────────────────────

INSERT INTO memories (
  id, user_id, project_id, goal_id, type, content,
  source_type, importance, tags, created_at, updated_at
)
VALUES
  ('demo-nike-mem-1', '000000d0-0000-0000-0000-0000000000d0', 'demo-nike-project', 'demo-nike-goal-1',
   'semantic',
   'Summer Vibes creative has shown consistent fatigue after day 4. Refresh cadence should be 3-day rotation.',
   'run', 8, '["creative","meta","fatigue"]'::jsonb,
   now() - interval '12 days', now() - interval '12 days'),
  ('demo-nike-mem-2', '000000d0-0000-0000-0000-0000000000d0', 'demo-nike-project', 'demo-nike-goal-2',
   'semantic',
   'Bid-cap strategy on Meta performs better than cost-cap for new-customer campaigns when daily budget > £3k.',
   'run', 9, '["bidding","meta","cac"]'::jsonb,
   now() - interval '8 days', now() - interval '8 days'),
  ('demo-nike-mem-3', '000000d0-0000-0000-0000-0000000000d0', 'demo-nike-project', null,
   'procedural',
   'Token refresh procedure: invoke credential.refresh on Meta Ads MCP, wait for new token, retry run. Takes ~30 seconds.',
   'run', 7, '["mcp","meta","credentials"]'::jsonb,
   now() - interval '5 days', now() - interval '5 days')
ON CONFLICT (id) DO UPDATE
  SET content = EXCLUDED.content, importance = EXCLUDED.importance, updated_at = EXCLUDED.updated_at;

-- ── 11. Chat conversation + messages ────────────────────────────────

INSERT INTO conversations (id, user_id, project_id, channel, title, sort_order, created_at, updated_at)
VALUES
  ('demo-nike-conv-1', '000000d0-0000-0000-0000-0000000000d0', 'demo-nike-project', 'app',
   'Why did Summer Vibes ROAS drop?', 0,
   now() - interval '22 hours', now() - interval '21 hours')
ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, updated_at = EXCLUDED.updated_at;

INSERT INTO messages (id, user_id, conversation_id, role, content, created_at)
VALUES
  ('demo-nike-msg-1', '000000d0-0000-0000-0000-0000000000d0', 'demo-nike-conv-1', 'user',
   'Why did Summer Vibes ROAS drop 18% yesterday?',
   now() - interval '22 hours'),
  ('demo-nike-msg-2', '000000d0-0000-0000-0000-0000000000d0', 'demo-nike-conv-1', 'assistant',
   'Looking at the campaign_performance table, Summer Vibes ROAS yesterday was 2.8x vs a 7-day average of 3.4x. The drop appears to be driven by the ''Blue Static BG'' creative — its CTR dropped from 3.1% to 1.8% over the last 3 days (classic fatigue). I''d recommend pausing that creative and increasing budget to ''Hero Shot Air Jordan'' which is still holding 4.2% CTR. Want me to draft the Meta Ads changes?',
   now() - interval '21 hours 58 minutes'),
  ('demo-nike-msg-3', '000000d0-0000-0000-0000-0000000000d0', 'demo-nike-conv-1', 'user',
   'Is Blue Static BG what the pattern you flagged in memory #12 days ago predicted?',
   now() - interval '21 hours 30 minutes'),
  ('demo-nike-msg-4', '000000d0-0000-0000-0000-0000000000d0', 'demo-nike-conv-1', 'assistant',
   'Yes — memory ''Summer Vibes creative has shown consistent fatigue after day 4. Refresh cadence should be 3-day rotation.'' It''s been running 6 days now so the drop is exactly on the expected curve. Shall I add a rotation job that auto-swaps creatives in this campaign every 3 days?',
   now() - interval '21 hours 29 minutes')
ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content;
