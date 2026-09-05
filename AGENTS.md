# Working on Still

Still is an offline Electron Pomodoro app. Keep changes small and use the existing plain HTML/CSS/JavaScript implementation; no frontend build step is needed.

- Read `README.md`, `package.json`, and the affected code before changing behavior. Release automation lives in `.github/workflows/build.yml`.
- Use the fff MCP tools for file searches. Run Python utilities through a uv environment when needed.
- Preserve unrelated worktree changes. Keep generated `dist/`, `artifacts/`, and `node_modules/` out of Git.
- Git author configuration is repository-local: `Shreyansh Singh <shreyansh.pettswood@gmail.com>`. Keep Git configuration details out of the README.

## Check changes

- Use Node.js 24 or newer; run `npm ci` when dependencies need installing.
- Run `npm test` for timer logic and `npm run test:app` for desktop/UI changes. On headless Linux, use `xvfb-run --auto-servernum npm run test:app`.
- The desktop test uses isolated temporary user data and writes screenshots to `artifacts/`. Inspect relevant screenshots, including compact and maximized layouts for responsive changes.
- For workflow changes, run `uv tool run --from actionlint-py actionlint .github/workflows/build.yml`.
- Documentation-only edits need a diff check, not an app rebuild.

## Publish an app update

When the task includes releasing an app update, carry it through to verified release assets. An ordinary code or documentation push does not require a version bump or publish a release.

1. Finish the implementation and relevant checks. Commit the intended changes on `main`, leaving a clean working tree before running `npm version`. Check the remote state first and reconcile any divergence without force-pushing or discarding other work.
2. For the next patch release, run:

   ```sh
   npm version patch
   git push origin main --follow-tags
   ```

   `npm version patch` updates both package files, commits the version bump, and creates an annotated `vX.Y.Z` tag. The push sends the commit and reachable annotated tags. Inspect pending tags so unrelated release tags are not pushed accidentally. Use `minor` or `major` when the requested release calls for it.

3. If the intended version was already bumped and committed, do not bump it again. Read the version from `package.json`, check whether its tag exists locally or remotely, and create/push it only if absent:

   ```sh
   version=$(node -p "require('./package.json').version")
   git tag -a "v$version" -m "Still $version"
   git push origin main "v$version"
   ```

   These commands assume the intended version's commit is checked out. Never move or replace an existing release tag. If the tag already exists, inspect its commit and workflow/release status first.

## What GitHub Actions does

- Pushes to `main` and pull requests build/test the apps and retain Actions artifacts; they do not publish releases.
- A pushed `v*` tag triggers the same builds and the final release job. The tag must exactly match `v` plus `package.json`'s version.
- All macOS, Windows, and Linux builds/tests must pass before the release job runs.
- The release job downloads only `Still-*` artifacts and publishes their installer files to GitHub Releases with generated notes. `Screenshots-*` remain Actions artifacts.
- Publishing uses the built-in `GITHUB_TOKEN` with `contents: write` scoped to the release job. No additional publishing secret is needed.
- Current automation targets ordinary stable releases; it does not explicitly mark beta/RC tags as prereleases.

## Verify publication before reporting completion

Select the **tag-triggered** run for the intended commit, not the separate `main` build:

```sh
gh run list --repo shreyansh26/pomodoro-app --workflow build.yml --branch vX.Y.Z --event push --limit 5 --json databaseId,headSha,status,conclusion
gh run view RUN_ID --repo shreyansh26/pomodoro-app --json status,conclusion,jobs
gh release view vX.Y.Z --repo shreyansh26/pomodoro-app --json url,tagName,isDraft,assets
```

Wait for the run and release job to succeed, then confirm the release is published (`isDraft: false`) and contains all six nonempty assets for the intended version: Apple Silicon DMG and ZIP, Intel Mac DMG and ZIP, Windows x64 EXE, and Linux x86_64 AppImage. Report the release URL and actual validation status.

If a job fails, inspect its logs. A pushed tag or uploaded Actions artifact is not evidence of a published release. Do not overwrite a published release; changed installers need a new version. If an upload left an incomplete draft, inspect that state before retrying—release creation is not an overwrite operation.

macOS builds currently have ad-hoc signatures and are not Developer ID signed or notarized; Windows builds are unsigned. Publishing to Releases does not change signing or establish that every installer was manually tested on its target OS.

Repository: https://github.com/shreyansh26/pomodoro-app

Downloads: https://github.com/shreyansh26/pomodoro-app/releases/latest
