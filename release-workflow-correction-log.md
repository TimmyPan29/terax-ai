# Correction Log: Release Workflow Packaging Failures → Fix

## Session Digest

### Problems & Resolutions

| # | Problem | Root cause | Fix that worked | Status | Ref |
| :-- | :--- | :--- | :--- | :--- | :--- |
| 1 | All 4 CI platforms fail with "public key found, no private key" | `tauri-action` never received `TAURI_SIGNING_PRIVATE_KEY` env var even though the secret existed in GitHub | Add `env:` mapping on the `tauri-action` step | Resolved | Correction 1 |
| 2 | Build now reaches signing step but errors `Invalid symbol 10, offset 44` (base64 decode) | GitHub Secret was pasted as the *whole* markdown file (14 lines, real newlines) instead of just the single-line base64 from line 6 | Re-set the secret using `gh secret set` with stdin piped through `tr -d '\n'` | Resolved | Corrections 2–3 |
| 3 | Manual UI paste kept leaving the secret multi-line (still 8 `***` lines in workflow log after "update") | GitHub's secret textbox preserved newlines from clipboard or user pasted the wrong region of the .md file | Bypass the UI entirely — pipe the value via `gh` CLI | Resolved | Correction 3 |
| 4 | macOS aarch64 returned `Not Found` from release-asset API at the very end | Race condition: 4 parallel jobs uploading to the same draft release | None needed — artifacts still uploaded before the error; only the job status went red | Resolved | — |
| 5 | Release ships 17 files (msi, rpm, AppImage, .sig, .tar.gz, x64 dmg…) — too noisy | tauri-action defaults to bundling every supported target on each platform | Per-platform `--bundles <type>` arg + drop x86_64 macOS from matrix + unconditional updater-artifact disable | Resolved | Correction 4 |

### Key Takeaways — Commands & Concepts to Learn

| Key point / command | What it does | When to use | Pitfall to avoid |
| :--- | :--- | :--- | :--- |
| `gh secret set NAME -R owner/repo` (with stdin) | Writes a repo secret from stdin — guarantees the exact byte sequence | Any secret that must be single-line (base64 keys, tokens) | UI paste can silently keep trailing `\n` or whole-file contents; CLI + `tr -d '\n'` is the only reliable path |
| `\|` then `tr -d '\n'` before `gh secret set` | Strips every newline from the value before sending | Pasting base64 keys from a file that wraps lines | Without stripping, base64 decode fails with `Invalid symbol 10` (LF) at the wrap column |
| `${{ secrets.X }}` substitution in workflow | Inlines the secret value where the expression sits | When a secret must travel to a sub-action | Setting the secret in repo settings is *not enough* — the workflow step's `env:` block must also forward it |
| `--bundles dmg,deb,nsis` Tauri CLI arg | Restricts which installer formats get produced | Any release where you don't need msi/rpm/AppImage | Without it, tauri builds every bundle target in `tauri.conf.json.bundle.targets: "all"` |
| `createUpdaterArtifacts: false` (in `tauri.conf.json`) | Skips `.sig` files, `.app.tar.gz`, and `latest.json` | When you don't ship in-app auto-updates | Leaving it `true` requires a valid signing key, otherwise build fails late after compilation completes |
| `gh release delete-asset TAG NAME --yes` | Removes one file from a release | Trimming over-bundled releases after the fact | The release stays a Draft; if you delete after publish, mirrors and update-checkers may have already fetched the asset |
| `gh release edit TAG --draft=false` | Promotes a Draft to a published release | Final step of CI-built releases | A Draft is invisible to non-collaborators — easy to think "release done" while the world can't see it |
| GitHub log shows secrets as `***` per line | Multi-line `***` ≠ empty; it means the secret contains newlines | Debugging "is my secret set right?" | A bash `[ -z "$SECRET" ]` check returns false for *any* non-empty value, including a value full of garbage newlines |

---

## Correction 1: Wire the signing key to `tauri-action`

**Category**: Code
**Context**: All 4 platforms fail on `Run tauri-apps/tauri-action@v0` with `A public key has been found, but no private key. Make sure to set TAURI_SIGNING_PRIVATE_KEY environment variable.` even though the secret exists in the fork.
**Pitfall**: Setting a repo secret only makes it available to `${{ secrets.X }}` — a downstream action still needs an explicit `env:` mapping.

### Before → After

```diff
       - uses: tauri-apps/tauri-action@v0
         env:
           GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
+          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
+          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
         with:
           tagName: ${{ github.ref_name }}
```

### Why
Flow: secret exists in repo → workflow log shows `***` so we know it's there → tauri-action's process env doesn't include it → tauri sees `pubkey` in conf and demands a matching private key → build fails post-compile.

A GitHub secret is only readable via the `${{ secrets.NAME }}` expression at runtime, and that expression has to be referenced somewhere in the step (typically inside `env:`) for the value to enter the child process's environment.

**Status**: Resolved

---

## Correction 2: Secret value must be single-line base64

**Category**: Code
**Context**: After Correction 1, the build reaches the signing step and errors `failed to decode base64 secret key: Invalid symbol 10, offset 44`. The workflow log shows the secret rendered as 8 separate `***` lines.
**Pitfall**: Pasting the *entire* `private_key.md` (14-line markdown with comments, headers, and the key) as the secret value, instead of the single base64 line generated by `tauri signer generate -w`.
**Superseded by**: Correction 3

### Before → After

| Before (GitHub Secret content) | After (GitHub Secret content) |
| :--- | :--- |
| 14 lines of markdown including `Your keys were generated…`, `Private:`, the 348-char base64 line, then `Public:`, blank lines, and `Environment variable` notes | The 348-char base64 line only, no trailing newline |

### Detailed Math

Symbol 10 in the base64 alphabet is `\n` (LF). Standard base64 uses 64 symbols (A–Z, a–z, 0–9, `+`, `/`, `=`); a newline at offset 44 means the decoder hit a raw LF where a base64 character should be, at the boundary where the markdown formatting wrapped or where another line began.

### Why
Flow: `tauri signer generate -w` prints a markdown report → user copies the whole report into the secret → tauri parses the env var as a single base64 blob → first newline at column 44 trips the decoder.

The minisign-style private key Tauri emits is already base64-encoded as a single line (348 chars). The surrounding markdown is informational — it's not part of the key.

**Status**: Superseded

---

## Correction 3: Set the secret via `gh` CLI, not the UI

**Category**: Code
**Context**: User updated the secret through GitHub's web UI twice, but the workflow log still showed 8 lines of `***` — the value remained multi-line. Manual paste was unreliable.
**Pitfall**: GitHub's secret textbox accepts multi-line input silently; if the clipboard ever contains stray newlines (e.g., a different copy operation overwrote the clean value), the UI saves them.
**Supersedes**: Correction 2

### Before → After

```diff
- # Manual flow: copy line 6 of private_key.md, paste into GitHub UI, hope no newlines slipped in
+ sed -n '6p' /Users/29timmy/Documents/terax-ai/private_key.md \
+   | tr -d '\n' \
+   | gh secret set TAURI_SIGNING_PRIVATE_KEY -R TimmyPan29/terax-ai
```

### Why
Flow: `sed -n '6p'` extracts exactly line 6 → `tr -d '\n'` strips the trailing LF that `sed` always appends → `gh secret set` reads stdin verbatim → secret stored as a single 348-byte string, no newlines.

The CLI path eliminates two failure modes: (a) clipboard contamination between copy and paste, (b) GitHub UI accepting embedded newlines without complaint. The combination of `sed`, `tr`, and stdin piping makes the byte sequence reproducible.

**Status**: Resolved

---

## Correction 4: Slim CI output to only the three installers

**Category**: Code
**Context**: First successful release ships 17 files (msi, rpm, AppImage, x64 dmg, all `.sig`, all `.app.tar.gz`, `latest.json`). User only wants `Terax_0.9.4_aarch64.dmg`, `Terax_0.9.4_amd64.deb`, `Terax_0.9.4_x64-setup.exe`.
**Pitfall**: tauri-action defaults to building every bundle target the platform supports; `createUpdaterArtifacts: true` adds `.sig` and `.tar.gz` on top.

### Before → After

```diff
     strategy:
       fail-fast: false
       matrix:
         include:
           - platform: macos-latest
-            args: --target aarch64-apple-darwin
+            args: --target aarch64-apple-darwin --bundles dmg
             rust-target: aarch64-apple-darwin
-          - platform: macos-latest
-            args: --target x86_64-apple-darwin
-            rust-target: x86_64-apple-darwin
           - platform: ubuntu-22.04
-            args: ""
+            args: --bundles deb
             rust-target: ""
           - platform: windows-latest
-            args: ""
+            args: --bundles nsis
             rust-target: ""
```

```diff
-      - name: Disable updater artifacts if signing key is missing
+      - name: Disable updater artifacts (only ship installers)
         shell: bash
         run: |
-          if [ -z "${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}" ]; then
-            echo "TAURI_SIGNING_PRIVATE_KEY is missing, disabling updater artifacts..."
-            node -e '
-              ...
-            '
-          fi
+          node -e '
+            const fs = require("fs");
+            const config = JSON.parse(fs.readFileSync("src-tauri/tauri.conf.json", "utf8"));
+            config.bundle.createUpdaterArtifacts = false;
+            fs.writeFileSync("src-tauri/tauri.conf.json", JSON.stringify(config, null, 2), "utf8");
+          '

       - uses: tauri-apps/tauri-action@v0
         env:
           GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
-          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
-          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
```

### Why
Flow: drop `macos-latest x86_64` from the matrix → one less DMG → add `--bundles <type>` per platform → tauri only emits the requested format → force `createUpdaterArtifacts: false` → no `.sig`, no `.tar.gz`, no `latest.json` → secrets become unnecessary → remove env wiring.

`--bundles` is the `tauri build` CLI flag that overrides `bundle.targets` from `tauri.conf.json`. Combining it with `createUpdaterArtifacts: false` collapses tauri-action's output surface to one installer per platform.

**Status**: Resolved

---

**Note on the canceled run**: The CI run that was bundling `Terax_0.9.3_amd64.AppImage` got canceled mid-flight while pivoting strategy. Linux was already producing artifacts, meaning Correction 1 + Correction 3 were both working — only macOS still needed the password secret. Lesson: read the running build state before canceling, since `failure` on one matrix entry doesn't mean the others aren't succeeding.
