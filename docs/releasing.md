# Releasing

Cut a new release of `eval-bench`. Maintainer-only.

## One-time setup

- `npm whoami` should print `derberg`. If not, `npm login`.
- `gh auth status` should be authenticated. If not, `gh auth login`.
- **npm automation token** in `~/.npmrc` so publish skips the 2FA OTP prompt:
  - Generate at https://www.npmjs.com/settings/~/tokens → **Generate New Token → Classic → Automation**.
  - Append to `~/.npmrc`: `//registry.npmjs.org/:_authToken=npm_xxxx...` then `chmod 600 ~/.npmrc`.
  - Don't commit this file. User-level `~/.npmrc` is the right home.

## Cut a release

Pick the bump (`patch` for fixes, `minor` for features, `major` for breaking) and run from `main` with a clean tree:

```bash
# 1. Bump package.json + lockfile. Captures the new version into $V.
V=$(npm version patch --no-git-tag-version | tr -d 'v')
echo "Releasing v$V"

# 2. Add a "## $V — YYYY-MM-DD" entry to CHANGELOG.md describing user-visible
#    changes (Features / Fixes / Docs / Breaking) — open it in your editor.
#    Read the diff before moving on.

# 3. Verify.
npm run build && npm test && npm run lint
npm publish --dry-run    # optional: see exactly what would ship

# 4. Commit, tag, push both.
git add CHANGELOG.md package.json package-lock.json
git commit -m "release: v$V"
git tag -a "v$V" -m "v$V"
git push origin main "v$V"

# 5. GitHub release. Body is the CHANGELOG section you just wrote.
gh release create "v$V" --title "v$V" --notes-file <(awk -v v="$V" '
  $0 ~ "^## " v " " {f=1; next} f && /^## / {exit} f {print}
' CHANGELOG.md)

# 6. npm.
npm publish

# 7. Confirm.
npm view eval-bench version    # should print $V
```

If you already know the exact version (e.g. you're skipping versions or doing a `0.x.0`), replace step 1 with:

```bash
V=0.3.0
npm version "$V" --no-git-tag-version
```

## Recovering from mistakes

- **Tag created locally, not pushed:** `git tag -d v$V`, fix, redo.
- **Tag pushed but not yet published to npm:** `git push origin :refs/tags/v$V` and `git tag -d v$V`, fix, redo. GitHub release (if created) → `gh release delete v$V`.
- **Already on npm, recoverable:** `npm unpublish eval-bench@$V` works only within 72 hours and only if nothing depends on it.
- **Already on npm, non-recoverable:** cut a new patch with the fix. Don't try to retroactively rewrite a published version.
- **GitHub release notes wrong:** `gh release edit v$V --notes "..."`.
