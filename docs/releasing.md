# Releasing

How to cut a new release of `eval-bench`. Maintainer-only.

## Prerequisites (one-time)

- npm account with publish access to `eval-bench`. Verify: `npm whoami` → `derberg`.
- **npm automation token** configured (see below) so publish doesn't prompt for an OTP.
- `gh` CLI authenticated. Verify: `gh auth status`.
- Working tree on `main`, clean, pulled, all tests passing.

### Set up an npm automation token (one-time, then never again)

Account 2FA (`auth-and-writes`) blocks `npm publish` unless you pass `--otp`. To skip the OTP forever, generate an **automation** token — these are designed for CI and bypass 2FA on writes.

1. Go to https://www.npmjs.com/settings/~/tokens and click **Generate New Token → Classic Token**.
2. Pick **Automation** (not "Publish" and not "Read-only").
3. Copy the token (starts with `npm_`). You'll only see it once.
4. Save it to your user `~/.npmrc`:

   ```bash
   echo "//registry.npmjs.org/:_authToken=npm_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" >> ~/.npmrc
   chmod 600 ~/.npmrc
   ```

After this, `npm publish` works without `--otp`. The token is tied to your account and revocable from the same npm settings page if it ever leaks.

> Don't commit `.npmrc` to the repo. The user-level `~/.npmrc` is the right home for the token.

## Decide the version

Follow [SemVer](https://semver.org/):

- **patch** (`0.2.0` → `0.2.1`): bugfixes only, no behavior change for working code
- **minor** (`0.2.1` → `0.3.0`): new features, backwards-compatible
- **major** (`0.3.0` → `1.0.0`): breaking changes

Set the version you're cutting:

```bash
export VERSION=0.2.2     # change me
```

## Step 1 — Update files

```bash
# Bump package.json + sync lockfile
npm version "$VERSION" --no-git-tag-version
npm install --package-lock-only

# Add CHANGELOG entry — open and write under a new "## $VERSION — YYYY-MM-DD" heading
$EDITOR CHANGELOG.md
```

Stop and re-read the CHANGELOG diff before continuing. Notes should describe user-visible changes only (Features, Fixes, Docs, Breaking).

## Step 2 — Build and verify

```bash
npm run build
npm test
npm run lint
```

All three must pass before you tag. If anything fails, fix it and re-run — never tag a broken commit.

Optional sanity check on what would actually ship:

```bash
npm publish --dry-run
```

## Step 3 — Commit, tag, push

```bash
git add CHANGELOG.md package.json package-lock.json
# plus any code/docs changes that belong in this release
git commit -m "release: v$VERSION"

git tag -a "v$VERSION" -m "v$VERSION"

git push origin main
git push origin "v$VERSION"
```

## Step 4 — GitHub release

```bash
gh release create "v$VERSION" \
  --title "v$VERSION" \
  --notes "$(awk -v ver="$VERSION" '
    $0 ~ "^## " ver " " { found=1; next }
    found && /^## / { exit }
    found { print }
  ' CHANGELOG.md)"
```

That extracts the section you just wrote in CHANGELOG.md and uses it as the release body. Confirm the URL it prints.

## Step 5 — npm publish

With the automation token set up (see prerequisites), this just works:

```bash
npm publish
```

Verify it went live:

```bash
npm view eval-bench version
# should print $VERSION
```

## If something goes wrong

- **Tagged but didn't push the tag yet:** `git tag -d v$VERSION` and start over.
- **Pushed the tag but haven't published:** delete remote tag with `git push origin :refs/tags/v$VERSION`, delete local with `git tag -d v$VERSION`, fix, retag, repush.
- **Already published to npm:** you can `npm unpublish eval-bench@$VERSION` only within 72 hours and only if no other package depends on it. Otherwise, cut a new patch version with the fix.
- **GitHub release wrong:** `gh release edit v$VERSION --notes "..."` or `gh release delete v$VERSION` and re-create.

## Quick reference (single block)

```bash
export VERSION=0.2.2

npm version "$VERSION" --no-git-tag-version
npm install --package-lock-only
$EDITOR CHANGELOG.md

npm run build && npm test && npm run lint

git add CHANGELOG.md package.json package-lock.json
git commit -m "release: v$VERSION"
git tag -a "v$VERSION" -m "v$VERSION"
git push origin main
git push origin "v$VERSION"

gh release create "v$VERSION" \
  --title "v$VERSION" \
  --notes "$(awk -v ver="$VERSION" '$0 ~ "^## " ver " " {found=1; next} found && /^## / {exit} found {print}' CHANGELOG.md)"

npm publish

npm view eval-bench version
```
