# /release — Ship a new OpenHelm version

Automates the full release flow: bump version → commit → tag → CI → update website.

## Usage
```
/release small    # patch bump:  0.1.0 → 0.1.1
/release medium   # minor bump:  0.1.0 → 0.2.0
/release large    # major bump:  0.1.0 → 1.0.0
```

## Steps to execute

**Read the current version** from `src-tauri/tauri.conf.json` (`"version"` field).

**Calculate the new version** based on the argument:
- `small` → increment the patch digit (third number): `x.y.Z+1`
- `medium` → increment the minor digit (second number), reset patch to 0: `x.Y+1.0`
- `large` → increment the major digit (first number), reset minor and patch to 0: `X+1.0.0`

If no argument or an unrecognised argument is given, ask the user: "Please specify the release size: small (patch), medium (minor), or large (major). Current version is x.y.z."

Tell the user the calculated new version and confirm before proceeding: "Releasing v<new_version> — shall I proceed?"

---

### 0. Commit any working tree changes

Before doing anything else, check for uncommitted changes:

```bash
git status
```

If there are **any staged or unstaged changes**, commit them first:

```bash
git add -A
git commit -m "chore: pre-release cleanup"
git push origin main
```

If there are **untracked files**, ask the user: "There are untracked files in the working tree. Should I include them in the release commit, or skip them?"

Do not proceed until the working tree is clean.

### 1. Build the agent sidecar

Rebuild the agent so the latest source is bundled into the Tauri binaries:

```bash
cd agent && npm run build
```

Verify the build succeeded (check for `dist/agent.js` and that it was copied to `src-tauri/binaries/`).

### 2. Bump version in the app

Edit `src-tauri/tauri.conf.json` — set `"version"` to the new version.

Edit `agent/package.json` — set `"version"` to the new version.

### 3. Verify and update CHANGELOG.md

Use `git log` to read all commits since the last git tag:
```bash
git log $(git describe --tags --abbrev=0)..HEAD --oneline
```

**Verify** the existing CHANGELOG.md top section accurately reflects those commits. If any significant changes are missing or the section is blank, add them now. Prepend a new section at the top (after the `# Changelog` heading) in this format:
```
## [<version>] - <today's date YYYY-MM-DD>

### Added
- (list key changes from recent commits)

### Fixed
- (list bug fixes from recent commits)
```

The CHANGELOG.md must be accurate before continuing — it is the source of truth used in step 7 to update the website.

### 4. Commit and push to main

```bash
git add src-tauri/tauri.conf.json agent/package.json CHANGELOG.md src-tauri/binaries/
git commit -m "Release v<version>"
git push origin main
```

### 5. Tag and push — this triggers CI

```bash
git tag v<version>
git push origin v<version>
```

Tell the user: "CI is now running. Both DMGs will be built, signed, notarized, and published to https://github.com/maxbeech/OpenHelm/releases/tag/v<version>. This takes ~7 minutes."

### 6. Wait for CI to complete

Poll `gh run list -R maxbeech/OpenHelm --limit 1` every 30 seconds until the run status is `completed`. If it fails, show the failure details from `gh run view --log-failed`.

### 7. Update the website

#### 7a. Update download links

Edit `/Users/maxbeech/Documents/Beech/Development/OpenHelm-Website/src/lib/release-config.ts`:

```ts
export const LATEST_RELEASE = {
  version: '<version>',
  arm64Url: 'https://github.com/maxbeech/OpenHelm/releases/download/v<version>/OpenHelm_<version>_aarch64.dmg',
  x64Url:   'https://github.com/maxbeech/OpenHelm/releases/download/v<version>/OpenHelm_<version>_x64.dmg',
};
```

#### 7b. Update the changelog page

Edit `/Users/maxbeech/Documents/Beech/Development/OpenHelm-Website/src/app/changelog/ChangelogContent.tsx`.

The `releases` array at the top of the file must reflect the current CHANGELOG.md. For each **major or minor** release (x.y.0), ensure there is an entry in the array. The **latest** release must have `latest: true` and all others must not.

To update for the new version:
1. If this is a **patch** release (x.y.Z where Z > 0): update the `patches` field of the existing major/minor card (e.g. add "vX.Y.Z — short summary of what changed").
2. If this is a **minor or major** release (x.y.0 or x.0.0): add a new entry at the **top** of the `releases` array, set `latest: true`, and remove `latest: true` from the previously-latest entry. Pick 4–6 headline highlights from the CHANGELOG.md entry for this version — favour Added items. Choose an appropriate icon from `@heroicons/react/24/outline` and a distinct accent colour class.

After editing, verify the file compiles (no TypeScript errors) before committing.

#### 7c. Commit and deploy

```bash
cd /Users/maxbeech/Documents/Beech/Development/OpenHelm-Website
git add src/lib/release-config.ts src/app/changelog/ChangelogContent.tsx
git commit -m "Bump download links and changelog to v<version>"
git push origin main
```

Then trigger a Vercel deployment manually (git is not connected to the Vercel project):
```bash
cd /Users/maxbeech/Documents/Beech/Development/OpenHelm-Website
npx vercel --prod
```

### 8. Done

Report:
- GitHub release URL: `https://github.com/maxbeech/OpenHelm/releases/tag/v<version>`
- Both DMG assets confirmed present
- Website download links updated, pushed, and deployed via `vercel --prod`
