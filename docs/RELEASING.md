# Release preparation

**English** | [Русский](RELEASING.ru.md)

The plugin is distributed as source and a local-marketplace archive. `private: true`
in `package.json` prevents accidental `npm publish`; Apache-2.0 distribution is permitted.

## Prepare

The package name and version in `package.json` determine the archive name. For a version
change, align `package-lock.json` (root and `packages[""]`), both plugin manifests,
`runtime/version.mjs` and current-version statements in both READMEs. Preserve attribution
and modification notices in [NOTICE](../NOTICE).

English documents use paths without a language suffix; Russian translations use `*.ru.md`.
Update both versions when behavior changes. Put runnable configuration examples in `examples/`.

```bash
npm ci --ignore-scripts --bin-links=false
npm run scan:secrets
npm test
npm run doctor
npm run pack:release
```

Secret scanning requires Gitleaks 8.30.1 in PATH or `GITLEAKS_PATH`. See [TESTING.md](TESTING.md)
for check scope and limitations.

## Verify the archive

`pack:release` creates `dist/<package-name>-<package-version>.tar.gz` and `.sha256`.
Contents follow `package.json`'s `files` list, plus the package manifest, root lockfile and
README. Both documentation languages are included. Credentials, symlinks, local dependencies
and IDE files are excluded; ustar headers omit personal owner and filesystem metadata.

```bash
release_name=$(node -p "const p = require('./package.json'); p.name + '-' + p.version")
cd dist
# Linux:
sha256sum --check "$release_name.sha256"
# macOS:
shasum -a 256 --check "$release_name.sha256"
tar -tzf "$release_name.tar.gz"
```

Extract into a separate directory, then run `npm ci --ignore-scripts --bin-links=false`,
`npm run check`, `npm test` and `npm run doctor` there. Ordinary `npm pack` omits the root
lockfile and does not replace this distribution archive.

CI runs tests on Linux with Node 20/22/24/26 and macOS with Node 24. Its packaging job
verifies the checksum, installs/tests the extracted copy, and saves `verified-release-archive`.
The secret-scan job checks source and full Git history. CI makes no live model calls.

## Publish

Wait for all CI jobs to pass on the commit being published. Enable and verify private
vulnerability reporting as described in [SECURITY.md](../.github/SECURITY.md).

Source publication does not require a release. If creating one, choose the tag explicitly
on the verified commit and attach the archive/checksum from its CI run. CI does not create
tags or releases automatically. Keep repository URLs and contact details accurate.

Exclude `dist/`, raw logs, personal configuration and modernization workspaces from source.
Distribute LICENSE, NOTICE and `assets/vendor/` licenses with the package.
