# /release — Ship a new OpenHelm version

Automates the full release flow: bump version → commit → tag → CI → update website.

## Usage
```
/release 0.2.0
```

## Steps to execute

**Read the version argument** from the command invocation (e.g. `0.2.0`). If no version is provided, ask the user for one before proceeding.

---

### 1. Bump version in the app

Edit `src-tauri/tauri.conf.json` — set `"version"` to the new version.

Edit `agent/package.json` — set `"version"` to the new version.

### 2. Update CHANGELOG.md

Prepend a new section at the top (after the `# Changelog` heading) in this format:
```
## [<version>] - <today's date YYYY-MM-DD>

### Added
- (list key changes from recent commits)

### Fixed
- (list bug fixes from recent commits)
```

Use `git log` to read the recent commits since the last tag to generate the changelog entries.

### 3. Commit and push to main

```bash
git add src-tauri/tauri.conf.json agent/package.json CHANGELOG.md
git commit -m "Release v<version>"
git push origin main
```

### 4. Tag and push — this triggers CI

```bash
git tag v<version>
git push origin v<version>
```

Tell the user: "CI is now running. Both DMGs will be built, signed, notarized, and published to https://github.com/maxbeech/openhelm/releases/tag/v<version>. This takes ~7 minutes."

### 5. Wait for CI to complete

Poll `gh run list -R maxbeech/openhelm --limit 1` every 30 seconds until the run status is `completed`. If it fails, show the failure details from `gh run view --log-failed`.

### 6. Update the website download links

Edit `/Users/maxbeech/Documents/Beech/Development/OpenHelm-Website/src/lib/release-config.ts`:

```ts
export const LATEST_RELEASE = {
  version: '<version>',
  arm64Url: 'https://github.com/maxbeech/openhelm/releases/download/v<version>/OpenHelm_<version>_aarch64.dmg',
  x64Url:   'https://github.com/maxbeech/openhelm/releases/download/v<version>/OpenHelm_<version>_x64.dmg',
};
```

Then commit and push the website:
```bash
cd /Users/maxbeech/Documents/Beech/Development/OpenHelm-Website
git add src/lib/release-config.ts
git commit -m "Bump download links to v<version>"
git push origin main
```

### 7. Done

Report:
- GitHub release URL: `https://github.com/maxbeech/openhelm/releases/tag/v<version>`
- Both DMG assets confirmed present
- Website download links updated and pushed (Vercel deploys automatically)
