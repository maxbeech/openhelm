# OpenHelm — Product Plan
### A YC-informed revision | March 2026

---

## 0. The One-Liner

**OpenHelm is an open-source autonomous agent platform for technical founders that turns high-level goals into scheduled, self-correcting Claude Code jobs — so you can wake up to done.**

---

## 1. The Problem

Technical founders and indie hackers building with AI have a consistent frustration: Claude Code is extraordinarily capable, but it's a tool you have to sit with. Every task requires you to open a terminal, write a prompt, babysit the output, and run it again tomorrow. The moment you close your laptop, nothing happens.

The result is that most of the leverage AI should be providing — continuous background work on SEO, testing, documentation, data analysis, growth experiments — simply doesn't happen. Not because the capability doesn't exist, but because nobody has built the layer between "I have a goal" and "Claude Code is relentlessly working on it."

There are three problems in one:

1. **The scheduling problem**: Claude Code has no native scheduler. If you want a task to recur, you're writing cron jobs.
2. **The planning problem**: Even if you could schedule it, translating a goal like "improve our SEO" into a set of concrete, recurring Claude Code tasks requires time and expertise most founders don't have to spare.
3. **The oversight problem**: Once tasks are running, there's no unified place to see what's happening, what succeeded, what failed, and what needs human attention.

runCLAUDErun solves problem 1 for macOS only, and nothing else. Nobody solves problems 2 and 3. That's the gap.

---

## 2. The Solution

OpenHelm is a local-first desktop application (macOS first, with Linux and Windows to follow) that sits on top of Claude Code and provides:

- **Goal-to-job planning**: Type a goal in plain English. The system generates a structured plan of one-off and recurring Claude Code jobs, which you review and approve before anything runs.
- **Scheduling and execution**: Jobs run on a schedule via a persistent background agent. No cron knowledge required.
- **Run monitoring and triage**: Every run has a status, a log, and an outcome. Failures are automatically triaged and either self-corrected or escalated to your dashboard with suggested actions.
- **A memory system**: The platform maintains a structured, project-aware memory so that every future job benefits from what past jobs have learned.

The project hierarchy mirrors how founders actually think:

- **Projects** → a codebase or business context (e.g. "My SaaS app")
- **Goals** → what you want to achieve (e.g. "Grow organic traffic")
- **Jobs** → the actual Claude Code tasks, one-off or recurring (e.g. "Weekly: audit and fix broken internal links")
- **Runs** → individual executions of a job, with full logs and status

Everything is open source. The hosted version handles setup, infrastructure, and team features for those who don't want to self-host.

---

## 3. Target Customer

### Primary ICP (v1)

**Solo technical founders and indie hackers building micro-SaaS, content businesses, or developer tools.**

Specifically:

- Comfortable with Claude Code — have used it at least a few times
- Running a project where there is ongoing, repeatable work (SEO, testing, content, monitoring, data pipelines)
- Time-poor and frustrated by how much of their Claude Code leverage disappears when they close their laptop
- Not afraid of a local app — comfortable with macOS, terminals, and installing software

This is the right starting ICP because:
- They have a Claude Code subscription already (removes the biggest adoption barrier)
- They have genuine recurring tasks with clear value (makes the job planning step obviously useful)
- They're vocal online and will spread the word if it works
- They don't require enterprise security, SSO, or procurement

### Secondary ICP (v2, 6-12 months in)

**Small technical teams (2–5 people)** at early-stage startups who want shared visibility into what their AI agents are doing. This opens up the team/collaboration features and justifies a higher per-seat price on the hosted tier.

### Who this is NOT for (v1)

- Non-technical users who have never used Claude Code (wrong product; requires too much hand-holding around Claude Code itself)
- Enterprise teams requiring SOC 2, SSO, or on-premise guarantees (wrong stage)
- Users who want to build one-off automations without a goal-oriented framing (runCLAUDErun serves them fine)

---

## 4. Competitive Positioning

| | runCLAUDErun | OpenClaw | IdeaBrowser | OpenHelm |
|---|---|---|---|---|
| Uses Claude Code subscription | ✅ | ❌ | ❌ | ✅ |
| Open source | ✅ | ✅ | ❌ | ✅ |
| Goal → job planning | ❌ | ❌ | Partial | ✅ |
| Self-correcting failures | ❌ | ❌ | ❌ | ✅ |
| Memory system | ❌ | Partial | Partial | ✅ |
| Cross-platform | ❌ (macOS) | ✅ | ✅ | ✅ (macOS first) |
| Hosted tier | ❌ | ❌ | ✅ (expensive) | ✅ |

**Positioning statement**: OpenHelm is the only open-source agent platform built around your existing Claude Code subscription that turns goals into autonomous, self-correcting background work — not just scheduled prompts.

The key differentiator isn't scheduling (runCLAUDErun does that). It's the **goal layer** and the **self-correction loop**. Those two features together are what makes this feel like you have an AI teammate rather than a fancy cron job.

---

## 5. MVP — What to Build First

### The YC principle at work here

The temptation with this product is to build everything in the plan before shipping. That is the most likely way to fail. The right approach is to find the thinnest slice that proves the core value, ship it to 20–30 people you know personally, and iterate.

The core value hypothesis is: **"If I tell OpenHelm what I want to achieve, it will generate a sensible set of Claude Code jobs, and running them will produce real value."**

Everything else — memory, dashboard, self-correction, audio, templates — is in service of that. Ship it without those things first.

### MVP Feature Set (6–8 weeks)

**What's in:**

1. **Create a project** — point at a local directory, give it a name and description
2. **Type a goal** — free text input, e.g. "Improve test coverage across the codebase"
3. **AI generates a job plan** — one-off and recurring jobs are proposed, with plain-English descriptions of what each will do
4. **Review and approve** — user sees the plan before anything runs; can edit, remove, or add jobs
5. **Jobs run on a schedule** — persistent background agent executes Claude Code jobs as scheduled
6. **Runs have status and logs** — succeeded / failed / running, with full Claude Code output captured
7. **Manual job creation** — create a job from scratch without going through goal planning
8. **Basic prompt improvement** — before generating a plan, assess if the goal is too vague and ask 1–2 clarifying questions

**What's explicitly NOT in the MVP:**

- Memory system
- Self-correction on failure
- Dashboard / notification system
- Audio
- Templates
- Team/collaboration features
- Windows/Linux support

### The Plan Review Step is Non-Negotiable

Before any job runs for the first time, the user must see and approve the generated plan. This is not just a UX nicety — it's the single most important trust-building moment in the product. Users who approve a plan feel ownership over it. Users who watch Claude do unexpected things to their codebase without warning will churn immediately and tell people.

The review screen should show:
- Each proposed job with a plain-English summary of what it will do
- Whether it's one-off or recurring, and the proposed schedule
- An estimate of how much of the user's Claude Code quota it might use
- Edit, remove, and "add another job" controls

---

## 6. Full Product Roadmap

### v1 — Foundation (0–3 months): Trust and the core loop

**Goal**: Get 50 active users who run at least 3 jobs per week reliably.

- Project / goal / job / run hierarchy
- Goal-to-job AI planning with plan review step
- Claude Code execution engine with background scheduling agent
- Run logs and status (succeeded / failed / running)
- Basic prompt clarification (1–2 questions if goal is too vague)
- macOS only
- SQLite local database
- Open source under MIT licence

### v2 — Intelligence (3–6 months): The system gets smarter over time

**Goal**: Reduce churn caused by failed runs and context-free jobs. Reach 200 active users.

- **Memory system** (see Section 9 for full design)
- **Failure triage**: at end of each run, automatically classify as success / fixable failure / permanent failure. For fixable failures, generate and run a corrective job automatically. For permanent failures, escalate.
- **Dashboard tab**: cards for permanent failures with actions — Try again, Ignore, Do something different (free text)
- **Human-in-the-loop prompts**: if Claude Code gets stuck mid-run (needs credentials, is uncertain), surface this in the dashboard immediately rather than letting the run hang
- **Prompt assistance**: 1–4 clarifying questions with multiple-choice + free-text answers for goals and manually-created jobs
- **Run timeout and watchdog**: automatically detect and kill hung Claude Code processes
- **Notifications**: macOS native notifications for permanent failures and human-in-the-loop requests

### v3 — Growth (6–12 months): Team features and hosted tier

**Goal**: First £5k MRR. Expand ICP to small teams.

- **Hosted tier launch** (see Section 8 for pricing)
- **Team workspaces**: shared projects, goals, and run visibility across multiple users
- **Linux and Windows support**
- **Templates library**: curated goal templates with pre-written job plans (SEO audit, weekly test coverage report, dependency security scan, etc.)
- **Brainstorming mode**: lightweight chat interface (using local model where available, Claude otherwise) for exploring ideas that can be converted directly into goals
- **Usage dashboard**: Claude Code quota estimates and consumption per project

### v4 — Platform (12–18 months): The network effects phase

- **Community template marketplace**: users publish and fork goal templates
- **MCP server auto-installation**: when a job requires a tool that isn't installed, the system detects this and installs it with user approval
- **Audio input**: voice-to-goal using local Whisper model
- **API**: allow external systems (Slack, GitHub webhooks) to trigger job creation or runs

---

## 7. Technical Architecture

### Design Philosophy

- **Local-first, open source, minimal dependencies**: the OSS version should run entirely on the user's machine with no external services required
- **Thin abstraction over Claude Code**: never try to parse or deeply interpret Claude Code's output. Treat it as a black box and capture its exit code, stdout, and stderr
- **Schema stability**: resist the urge to add tables for every new feature; keep the data model as flat and generalised as possible
- **Fault tolerance from day one**: the scheduler, executor, and UI are separate processes; a UI crash must never interrupt a running job

### Technology Choices

| Layer | Choice | Rationale |
|---|---|---|
| Desktop framework | Tauri (Rust + WebView) | Lighter than Electron, cross-platform, good local process control |
| Frontend | React + TypeScript | Familiar ecosystem, good component libraries |
| Styling | Tailwind CSS | Fast iteration, consistent design tokens |
| Local database | SQLite via better-sqlite3 | Zero-config, file-based, fast, open source |
| Background agent | Node.js process managed by the desktop app | Keeps stack consistent, easy IPC via local socket |
| IPC (UI ↔ agent) | Local Unix socket or named pipe | Simple, low-latency, no network required |
| Claude Code integration | Spawned child process via Node `child_process` | Thin, doesn't require understanding internals |

**Why Tauri over Electron?** Tauri produces significantly smaller binaries, uses the OS's native WebView (reducing attack surface), and has better access to native macOS APIs for background processes and notifications. The Rust core also gives us fine-grained process management without a Node.js overhead in the critical execution path.

**Why SQLite?** It is genuinely local, zero-config, and has a battle-tested ecosystem. The alternative (local Supabase) introduces Docker as a dependency, which is a meaningful barrier for non-technical users and an overhead that isn't justified at this stage.

### Data Model

```
Project
  id, name, description, directory_path, created_at

Goal
  id, project_id, description, status (active | paused | archived), created_at

Job
  id, goal_id (nullable — jobs can exist without a goal), name, description,
  prompt, schedule_type (once | interval | cron), schedule_config (JSON),
  is_enabled, created_at, updated_at

Run
  id, job_id, status (queued | running | succeeded | failed | permanent_failure),
  trigger_source (scheduled | manual | corrective),
  started_at, finished_at, exit_code, summary

RunLog
  id, run_id, sequence, stream (stdout | stderr), text, timestamp

Memory
  id, project_id, goal_id (nullable), job_id (nullable), content,
  tags (JSON), created_at, updated_at, last_accessed_at

DashboardItem
  id, run_id, type (permanent_failure | human_in_loop), status (open | resolved | ignored),
  message, created_at, resolved_at
```

### Background Agent Architecture

The background agent is a persistent Node.js process launched at app startup and kept alive by the Tauri shell. It owns:

1. **Scheduler**: a priority queue of upcoming job fires, checked on a 1-minute tick. On each tick, any job whose `next_fire_time <= now` is enqueued as a Run with `status=queued`.
2. **Executor**: a worker pool (configurable max concurrency, defaulting to 1) that dequeues runs, performs pre-flight checks, spawns Claude Code as a child process, streams logs to the DB, and updates run status on completion.
3. **Watchdog**: a per-run timeout (configurable, default 30 minutes) that SIGTERMs a hung Claude Code process and marks the run as failed.
4. **IPC server**: a local socket server that the UI connects to for real-time log streaming, status updates, and sending commands (create job, trigger run, etc.).

### Claude Code Integration

```
// Pre-flight checks before spawning
- Verify `claude` binary exists at configured path
- Verify working directory exists and is accessible
- Verify no other run for this job is currently active

// Spawn
child_process.spawn('claude', [...args], {
  cwd: job.working_directory,
  env: { ...process.env, ...job.environment_overrides }
})

// Capture output in chunks → RunLog rows
// On exit: exit_code === 0 → succeeded, else → failed
// Run failure classification job fires automatically on failure
```

**Critical**: pin a minimum supported Claude Code CLI version on startup and warn the user if their installed version is below it. This mitigates the risk of Anthropic CLI changes breaking the integration silently.

### Claude Code CLI Abstraction Layer

Never call Claude Code CLI flags directly from the scheduler. All CLI invocations must go through a single `ClaudeCodeRunner` module. This means that when Anthropic changes the CLI interface (and they will), there is exactly one file to update.

### Handling Claude Code Interactive Prompts

Claude Code may pause mid-run waiting for interactive input (e.g. asking for credentials, or seeking confirmation before a destructive action). Detect this by monitoring for:
- Stdout containing a `?` character followed by no further output for 60 seconds
- Known interactive prompt patterns (maintain a small list)

When detected: pause the run, create a DashboardItem of type `human_in_loop`, and notify the user. The run is held open (not timed out) until the user responds or explicitly cancels.

---

## 8. Business Model

### The YC Framing

The OSS version is your distribution, not your product. It does two things: it builds trust (open source means people can audit what's running on their machine), and it drives discovery (GitHub stars, forks, and contributions are your top-of-funnel). The hosted tier is your business.

The common mistake is making the hosted tier too weak so as not to "cannibalise" the OSS version. Do the opposite: make the OSS version genuinely excellent (it'll spread faster), and make the hosted tier solve real friction that power users will pay to avoid.

### Hosted Tier Value Proposition

The hosted tier should offer things that are genuinely hard to do yourself:

- **Managed infrastructure**: no need to keep your own machine running for scheduled jobs — OpenHelm's cloud runs your jobs even when your laptop is closed
- **Team workspaces**: shared projects, goals, run history, and dashboard across multiple collaborators
- **Run history retention**: the OSS version stores logs locally; the hosted tier retains them for 90 days with search
- **Priority support**: response within 24 hours
- **Usage analytics**: per-project Claude Code quota consumption, run success rates, time saved estimates

### Pricing

| Tier | Price | What you get |
|---|---|---|
| OSS / Self-hosted | Free | Full feature set, runs locally, community support |
| Solo | £12/month | Cloud-hosted agent (runs when laptop is off), 90-day log retention, email support |
| Team | £35/month per seat (min 2) | Solo + shared team workspace, team dashboard, usage analytics |
| Enterprise | Custom | Team + SSO, audit logs, SLA, dedicated support |

**Why £12 and not £19?** Impulse-purchase territory. The decision to try the paid tier should take less than 10 seconds. Friction at the pricing decision kills conversion from a product with a good free tier.

### Revenue Timeline

- **Month 1–3 (v1)**: £0. This is correct. Focus entirely on getting 50 people to use the OSS version and use them to validate the core loop. Do not launch the hosted tier until you've seen at least 20 people successfully run recurring jobs for 2+ weeks.
- **Month 4–6 (v2)**: Soft-launch the hosted Solo tier to existing OSS users. Target: £1k MRR.
- **Month 7–12 (v3)**: Full public launch with Team tier. Target: £5k MRR.
- **Month 13–18 (v4)**: Enterprise conversations begin. Target: £15k MRR.

---

## 9. Memory System Design

The memory system is high-leverage but easy to get wrong. Here is a concrete design rather than a set of aspirations.

### What memory is

A memory is a short, structured piece of information the system has learned that should influence future behaviour. Examples:

- "This project uses Webflow, not WordPress — do not generate WordPress-specific SEO jobs"
- "The user's preferred test framework is Vitest"
- "SEO jobs for this project have consistently failed due to rate limiting on the target API — space them at least 48 hours apart"
- "Goal 'Grow organic traffic' has been running for 6 weeks. Pages indexed have increased by 12%."

### When memory is created

A lightweight "memory review" job runs automatically after:
- A goal plan is approved (captures what the user wanted and any corrections they made)
- A run completes (captures outcomes, errors, and any patterns worth noting)
- The user answers a clarifying question during prompt improvement (captures user preferences)

This job calls Claude (not Claude Code — this is a simple completion, not an agentic task) with a structured prompt:
```
Given the following [goal / run outcome / user answer], identify any facts,
preferences, constraints, or outcomes that should be remembered to improve
future jobs in this project. Return a JSON array of memory objects, or an
empty array if nothing is worth storing. Each memory should have:
  - content: a single plain-English sentence
  - tags: array of relevant tags (e.g. ["seo", "technology", "constraint"])
  - confidence: low | medium | high
```

Only `confidence: medium` and above are stored automatically. Low-confidence memories are discarded.

### When memory is used

At the start of goal planning and at the start of each job execution, retrieve memories relevant to the current project and goal. Use semantic similarity (via a lightweight local embedding model, such as `nomic-embed-text` via Ollama) to find the most relevant memories, capped at the top 10 to avoid context bloat.

These are prepended to the system prompt as a "What I know about this project" block.

### Memory maintenance

Over time, memories can become stale or contradictory. Monthly (or when the user requests it), a maintenance job runs that:
- Identifies memories that contradict each other and resolves them (keeping the most recent)
- Marks memories not accessed in 90 days as archived (still stored, not included in future prompts)
- Generates a short summary per project of what the memory system knows

### Memory transparency

Users can see, edit, and delete all memories in a dedicated Memory tab per project. This is critical for trust — users should never feel like the system is hiding information from them.

---

## 10. Onboarding Flow

This is the most important UX to get right. YC companies that fail at onboarding rarely recover because they never figure out what their actual activation metric is.

**Activation metric**: User approves a generated job plan and at least one run completes successfully.

### First-run onboarding (target: under 5 minutes from install to first run queued)

1. **Welcome screen**: "OpenHelm runs Claude Code jobs in the background so you can focus on building. Let's get you set up." One button: "Get started."

2. **Claude Code detection**: automatically scan common install locations for the `claude` binary. If found, show confirmation. If not, show a friendly step-by-step install guide with a single copyable command. Test button to verify.

3. **Create your first project**: name, directory (file picker), optional one-line description. The directory picker shows recently accessed folders first.

4. **Set your first goal**: large text input, placeholder "What do you want to achieve? e.g. 'Improve test coverage' or 'Reduce bundle size'". Underneath, three example goals as clickable chips for inspiration.

5. **Prompt clarification** (if needed): if the AI determines the goal is too vague, ask 1–2 targeted questions with multiple-choice options. Skip entirely if the goal is clear.

6. **Plan review**: show the generated job plan. Explain each job in plain English. "This plan will run 3 jobs: 1 immediately and 2 on a weekly schedule. Review and edit before anything runs." Approve button is prominent; Edit and Remove are available per job.

7. **First run**: the one-off job fires immediately. A real-time log view shows Claude Code's output as it runs. When it completes, show a summary: "Done. Here's what Claude Code did."

8. **Recurring jobs confirmed**: "Your 2 recurring jobs are now scheduled. They'll run automatically in the background, even when OpenHelm isn't open." Show the next scheduled fire times.

### What the onboarding must NOT do

- Ask for an email address or account creation before the user has seen value
- Show a blank dashboard with no guidance
- Run any job without explicit user approval
- Open a terminal window or show raw CLI output to the user without context

---

## 11. UX Design Principles

### Core screen layout

```
Sidebar:
  [Project selector — dropdown at top]
  
  Navigation:
  · Dashboard        (badge for unread items)
  · Goals
  · Jobs
  · Runs
  · Memory
  
  Settings (bottom)

Main area: context-dependent
```

### Key screens

**Home / Goals view**: a card-based view of active goals, each showing last run status, next scheduled run, and a one-line status summary. The "New goal" input is always visible at the top — not hidden behind a button.

**Job detail**: shows the job description, schedule, and a timeline of all runs. Each run shows status, duration, and a one-line summary. Click to expand logs.

**Run detail**: full log output (stdout/stderr, colour-coded), start/end time, exit code, and — crucially — an AI-generated plain-English summary of what Claude Code did and what the outcome means. This summary is generated automatically after each run and stored.

**Dashboard**: a card feed. Each card has a type badge, a description, and 2–3 action buttons. Cards are never automatically dismissed — the user must act on them. Unresolved cards show a count in the sidebar.

**Memory view**: a searchable, filterable list of all memories for the current project. Inline edit and delete. Tags shown as chips.

### Design tone

Clean, calm, and trustworthy. The product is doing things autonomously in the background — the UI must communicate "everything is under control" at all times. Use a muted, professional colour palette. Reserve red exclusively for genuine failures that need attention. Green for success. Amber for warnings. Never use bright, high-saturation colours for decorative purposes.

Dark mode by default (technical audience preference).

---

## 12. Go-to-Market Strategy

### Phase 1: Closed beta (weeks 1–6)

Do not launch publicly. Find 20–30 people personally — Twitter/X DMs, Indie Hackers, your own network. They must be technical founders with a Claude Code subscription and an active project. Give them access, set up a Discord, and talk to every single one of them within their first week.

What to learn:
- Did the onboarding get them to a first successful run?
- Did the generated job plans make sense for their projects?
- What types of goals produced the most valuable jobs?
- What broke?

Manually review every run log for the first cohort. You should know your early users' projects better than they do.

### Phase 2: Public OSS launch (month 2–3)

Launch on GitHub with a strong README, a 2-minute demo video, and a live example (ideally showing a real project with real runs). Submit to:
- Product Hunt
- Hacker News (Show HN)
- Indie Hackers
- r/SideProject
- r/ClaudeAI

The messaging should not lead with "it's open source". Lead with the outcome: "Wake up to finished work." Open source is a trust signal, not a headline.

### Phase 3: Content-led growth (ongoing from month 3)

The product's natural content strategy is "goals that worked". Publish regular posts structured as: "Here's a goal a founder typed into OpenHelm, here's the job plan it generated, and here's what happened after 4 weeks of running."

This content:
- Demonstrates real value with real evidence
- Drives SEO for terms like "automate Claude Code" and "schedule AI tasks"
- Builds a template library organically (each published goal becomes a template)
- Is uniquely ownable — competitors can't replicate your run data

### Phase 4: Community flywheel (from month 6)

Once there are 500+ active users, the community becomes a distribution channel. Templates published by power users, shared goal plans, and "what worked for my project" posts create organic reach that no paid channel can replicate at this stage.

---

## 13. Risks and Mitigations

### Risk 1: Anthropic changes the Claude Code CLI and breaks the integration
**Likelihood**: High (Claude Code is actively developed)
**Impact**: High (core product stops working)
**Mitigation**: All CLI interactions go through a single abstraction layer (`ClaudeCodeRunner`). The project maintains a compatibility matrix of tested CLI versions. Follow Anthropic's release notes and test against release candidates. Pin a minimum version in the app with a graceful upgrade prompt.

### Risk 2: Users don't trust autonomous execution enough to activate
**Likelihood**: High (this is a real psychological barrier)
**Impact**: High (activation metric never reached)
**Mitigation**: The plan review step is the primary mitigation. Additionally: start users with read-only tasks first (audits, reports) rather than tasks that modify files; show clear before/after summaries; never suppress Claude Code's output. Every user should feel in control.

### Risk 3: Goal-to-job quality is inconsistent
**Likelihood**: Medium (LLM planning is inherently variable)
**Impact**: High (one bad plan destroys trust)
**Mitigation**: Rate job plans in the UI (thumbs up/down per job). Use feedback to improve the planning prompt over time. Add a confidence indicator to each generated job — if the AI is uncertain, surface that explicitly. Consider requiring 2-step confirmation for jobs that modify files rather than just generating reports.

### Risk 4: The hosted tier doesn't convert enough OSS users
**Likelihood**: Medium
**Impact**: High (no revenue)
**Mitigation**: Design the hosted tier's value proposition around the "laptop closed" use case from day one — this is a genuine pain point that the OSS version cannot solve without running your own server. Make this the very first thing the hosted tier landing page explains.

### Risk 5: Claude Code subscription terms change
**Likelihood**: Low-Medium (Anthropic may restrict automated/headless use)
**Impact**: Very high (existential)
**Mitigation**: Monitor Anthropic's terms of service closely. Maintain a relationship with Anthropic if possible (YC can help with this). Design the executor layer to support alternative backends (API-based fallback) so that a terms change doesn't require a full re-architecture.

### Risk 6: The product tries to do too much before finding PMF
**Likelihood**: High (this is the default failure mode for ambitious products)
**Impact**: High (18 months of building, no users)
**Mitigation**: The roadmap above is explicitly phased. v1 ships without memory, dashboard, self-correction, or audio. Treat any feature that isn't in v1 as a hypothesis, not a commitment.

---

## 14. Success Metrics

### Activation
- **Target**: 60% of users who install the app reach activation (first successful run) within 7 days
- **Leading indicator**: % of users who complete onboarding and approve a plan on day 1

### Retention
- **Target**: 40% of activated users run at least 3 jobs per week at day 30
- **Leading indicator**: number of scheduled jobs per user (a user with 3+ active recurring jobs is very unlikely to churn)

### Growth
- **Target**: 20% week-over-week new installs for the first 8 weeks post-launch
- **Leading indicator**: GitHub stars, inbound from content posts

### Revenue (post-v3)
- **Target**: £5k MRR by month 12
- **Leading indicator**: OSS-to-hosted conversion rate (target: 8%)

### Quality
- **Target**: run success rate > 70% (Claude Code jobs succeed more often than they fail)
- **Leading indicator**: failure classification distribution (if >30% of failures are "permanent", the job generation quality needs work)

---

## 15. What to Build vs. Borrow

A critical decision this plan defers to the implementation phase is whether to build the agentic orchestration layer from scratch or build on top of an existing framework like OpenAI Agents SDK or LangGraph.

**Recommendation**: Build it yourself, but keep it thin.

The reason: the orchestration in this product is not complex. It's essentially a job queue with LLM calls at the planning and triage steps. Importing a full agentic framework for this would add significant complexity, dependencies, and a steep learning curve for contributors — all of which conflict with the "open source, lightweight" principle.

What to borrow:
- SQLite ORM (better-sqlite3 or Drizzle)
- Job queue (simple in-process implementation is fine for v1; Bull or BullMQ if you need persistence across restarts)
- A local embedding model runner (Ollama) for the memory system
- A lightweight local model (via Ollama) for the memory review job, to avoid using Claude quota on operational overhead

---

## 16. Branding

### Name options

The product needs a name that:
- Suggests coordination, planning, or oversight rather than pure automation
- Hints at open source ("Open" prefix is a strong signal)
- Works as a .com or .ai domain
- Doesn't sound like yet another AI startup

**Top candidates:**

- **OpenHelm** — suggests coordinating many things toward a unified outcome; the "Open" prefix signals open source; has good visual potential (conductor imagery); `openhelm.ai`
- **Foreman** — a foreman coordinates workers and is accountable for outcomes; hints at the "you are the overlord" framing; `foremanapp.com` or `getforeman.dev`
- **OpenMaestro** — similar to Orchestra but more personal; suggests expertise and direction
- **Groundwork** — suggests laying the foundation for ongoing work; less AI-specific which is a differentiator

**Recommended**: **OpenHelm** (or simply **Orchestra** for the hosted tier, with the OSS project named OpenHelm). It's distinctive, memorable, and communicates exactly what the product does without overusing AI terminology.

Using domain: **OpenHelm.ai**

### Visual direction

- Dark-mode-first; a deep navy or near-black background with a clean white/light sans-serif type
- A single accent colour — suggest a warm amber or copper tone (suggests something being orchestrated and brought to life, without being "another blue SaaS")
- Minimal iconography; no robot or AI imagery
- The logo should work as a small icon — consider an abstract "O" with subtle wave or rhythm lines suggesting coordination

---

## 17. What You Need to Execute This

### To get to v1

- **1 full-stack developer** (you, ideally) who knows TypeScript, React, and is comfortable with Tauri or Electron. Node.js process management experience is important.
- **~6–8 weeks** of focused building, no part-time hedging
- **20–30 beta users** lined up before you start building (talk to them first — validate the job planning UX with paper prototypes before writing code)
- **A Claude Code subscription** for testing

### What you should do before writing a single line of code

1. Write a fake product page describing the final product
2. Show it to 20 technical founders and ask: "Would you use this? What would make you pay for it?"
3. Do a single manual "concierge run" — take someone's goal, manually generate a job plan in Claude, run it yourself, and show them the output. Did they find it valuable? This will tell you more about the product than any amount of architecture planning.

---

## Appendix: Rejected Decisions and Why

**Rejected: Supabase local for the database**
Supabase requires Docker. Docker is a meaningful install barrier for a tool that should work out-of-the-box. SQLite is the right choice for v1–v3.

**Rejected: Building on OpenAI Agents SDK**
Adds a significant dependency and opinionated architecture to what is fundamentally a thin orchestration layer. Build it yourself and keep it simple.

**Rejected: Launching on all platforms simultaneously**
macOS first, because that's where the ICP lives. Windows and Linux support adds real testing and packaging overhead that will slow down the critical early iteration cycle.

**Rejected: No plan review step before jobs run**
Considered building a "just run it" mode for power users. Rejected because the first impression of an autonomous system is irreversible. You can add a "trust mode" (skip review) as a later power-user option, but it should never be the default.

**Rejected: Using the Claude API directly instead of Claude Code**
The entire value proposition is built on users' existing Claude Code subscriptions. Using the API separately would require users to manage API keys, incur per-token costs, and lose the Claude Code-specific capabilities (file access, shell commands, MCP tools). This constraint is a feature, not a limitation.