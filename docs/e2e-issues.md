# E2E Issues Log

Dated entries for issues discovered during end-to-end testing that could not be automatically fixed.

---

## 2026-03-25 — Jobs & Scheduling Flow

**Test session:** Automated browser E2E test covering create / toggle / edit / delete job flow.

### Issue 1 — Missing `favicon.ico` (404)

**Severity:** Low (cosmetic)

**Symptom:** Every page load triggers a 404 in the browser console:
```
Failed to load resource: the server responded with a status of 404 (Not Found)
http://localhost:1420/favicon.ico
```

**Root cause:** No `favicon.ico` (or `<link rel="icon">` tag pointing to an alternative) exists in `public/`. The browser falls back to requesting `/favicon.ico` by default.

**Reproduction:** Open any page of the app; observe network tab / console.

**Suggested fix:** Add a `public/favicon.ico` (or place an SVG/PNG favicon in `public/` and reference it in `index.html` with `<link rel="icon">`).

---

### Issue 2 — No raw cron expression input in UI (missing feature)

**Severity:** Medium (feature gap)

**Symptom:** The "Calendar (scheduled)" schedule type in the Create/Edit Job sheets only exposes three presets — **Daily**, **Weekly**, **Monthly** — with a time picker. There is no free-text cron expression field.

The shared data model (`ScheduleConfig`) supports `expression` (cron string) and the planner/scheduler in the agent layer can consume it, but no UI surface exposes it.

**Reproduction:** Open Create Job → set Schedule to "Calendar (scheduled)" → observe the sub-type dropdown only contains Daily / Weekly / Monthly.

**Suggested fix:** Add a fourth "Custom (cron)" option to the calendar sub-type dropdown that renders a validated text input accepting a standard 5-field cron expression (e.g. `0 9 * * 1-5`). Validate with a cron-parser library and show a human-readable preview (e.g. "Every weekday at 9 AM").

---

### Issue 3 — Dev server requires Homebrew Node (environment note)

**Severity:** Low (developer environment)

**Symptom:** Running `npm run dev` with the bundled Node.js from the signed `OpenHelm.app` (Team ID `E353LGUVGH`) fails because macOS library validation prevents it from loading the ad-hoc-signed `@rollup/rollup-darwin-arm64` native module:
```
Error: dlopen(...rollup.darwin-arm64.node): code signature not valid for use in process:
mapping process and mapped file (non-platform) have different Team IDs
```

**Root cause:** The bundled Node binary is hardened-runtime signed with the Maxed Labs team certificate, which rejects ad-hoc (no-team) `.node` modules at dlopen time.

**Workaround:** Run the dev server with Homebrew Node (`/opt/homebrew/bin/node`), which is ad-hoc signed and has no team ID restriction:
```bash
PATH=/opt/homebrew/bin:$PATH npm run dev
```

**Suggested fix:** Either ensure the dev NPM scripts use the system/Homebrew Node (via `#!/usr/bin/env node` shebang resolution outside the app bundle), or add a `predev` step that re-signs rollup's native module with the project's developer identity.

---

*Issues automatically fixed in the same session (not logged here):*
- *Radix UI `DialogContent` accessibility warnings — replaced plain `<p>` tags with `<SheetDescription>` in `job-creation-sheet.tsx`, `job-edit-sheet.tsx`, and `goal-creation-sheet.tsx`. Verified with `typecheck` and `lint`.*

---

## 2026-03-25 — Navigation, Settings & Memory Flow

**Test session:** Automated browser E2E test covering full sidebar navigation, Settings sections, Memory CRUD, and window resize at 1280×800 and 1920×1080.

### Fixed: `favicon.ico` 404 (Issue 1 above)

Added `<link rel="icon" href="data:," />` to `index.html` to suppress the browser's automatic `/favicon.ico` request. No `public/` dir needed.

---

### Issue 4 — Radix UI `DialogOverlay` ref warning (known version mismatch)

**Severity:** Low (console noise, no functional impact)

**Symptom:** Opening any `Dialog` (e.g. Create Memory) logs the following to the browser console:
```
Warning: Function components cannot be given refs. Attempts to access this ref will fail.
Did you mean to use React.forwardRef()?
Check the render method of `Primitive.div.SlotClone`.
    at DialogOverlay (src/components/ui/dialog.tsx)
```
Two additional warnings also appear:
```
Warning: Missing `Description` or `aria-describedby={undefined}` for {DialogContent}.
```

**Root cause:** `radix-ui@1.4.3` ships Slot/SlotClone code that uses React 19-style ref passing (`element.props.ref`) while the project runs React 18.3.1. When `Presence` inside `DialogPortal` wraps children and tries to attach a ref via `SlotClone`, it conflicts with React 18's ref handling for function components. The `forwardRef` wrapper on `DialogOverlay` propagates the ref to the Radix primitive correctly, but the SlotClone path still emits the warning.

The `aria-describedby` warnings are because `MemoryCreateDialog` (and other dialogs) don't include a `<DialogDescription>`, which is optional but expected for screen-reader accessibility.

**Reproduction:** Open the Memory view → click "New Memory" → observe console.

**Suggested fix:**
1. Upgrade to React 19 (resolves the ref-passing mismatch with Radix 1.4.x).
2. Or add `<DialogDescription className="sr-only">...</DialogDescription>` inside each `DialogContent` to silence the aria warning.
3. The SlotClone ref warning requires the React 19 upgrade to fully resolve; it is cosmetic on React 18.

---

*Issues automatically fixed in the same session (not logged here):*
- *favicon.ico 404 — added `<link rel="icon" href="data:," />` to `index.html`.*
