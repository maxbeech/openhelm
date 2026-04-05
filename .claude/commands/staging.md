# /staging — Build and install OpenHelm locally for testing

Builds a production Tauri bundle from the current source and installs it to `/Applications`, replacing the running app. App data in `~/.openhelm/` is untouched.

## Usage
```
/staging
```

No arguments needed.

---

## Steps to execute

### 0. Quit the running app (if open)

Check whether OpenHelm is currently running and quit it gracefully so the install can overwrite the binary:

```bash
osascript -e 'quit app "OpenHelm"' 2>/dev/null; sleep 1
```

If it won't quit, kill it:

```bash
pkill -x OpenHelm 2>/dev/null; true
```

### 1. Build the agent sidecar

Rebuild the agent so the latest source is bundled:

```bash
cd /Users/maxbeech/Documents/Beech/Development/OpenHelm/agent && npm run build
```

Verify `dist/agent.js` exists and was copied to `src-tauri/binaries/`.

### 2. Build the Tauri app (production bundle)

```bash
cd /Users/maxbeech/Documents/Beech/Development/OpenHelm && npm run tauri build
```

This produces the `.app` bundle at:
```
src-tauri/target/release/bundle/macos/OpenHelm.app
```

If the build fails, show the last 40 lines of output and stop.

### 3. Install to /Applications

Remove the old app and copy the freshly built one in its place:

```bash
rm -rf "/Applications/OpenHelm.app"
cp -R "/Users/maxbeech/Documents/Beech/Development/OpenHelm/src-tauri/target/release/bundle/macos/OpenHelm.app" "/Applications/OpenHelm.app"
```

### 4. Launch the newly installed app

```bash
open "/Applications/OpenHelm.app"
```

### 5. Done

Report:
- Build source: current working tree (no version bump, no git changes)
- Installed to: `/Applications/OpenHelm.app`
- App data: `~/.openhelm/` untouched
- Launched: yes
