# Phase 3 Distribution

Phase 3 turns the verified harness bundle into a release candidate with macOS distribution evidence.

## Local Unsigned Release Candidate

```sh
npm run build:release-local
```

This creates an unsigned internal `.app`/DMG release candidate plus `release/` evidence. It is suitable for engineering review, not external distribution.

## Apple Signing Inputs

For local signing, install a valid Developer ID Application certificate and set:

```sh
export APPLE_SIGNING_IDENTITY="Developer ID Application: ..."
```

For CI signing, configure these GitHub Actions secrets:

```text
APPLE_CERTIFICATE
APPLE_CERTIFICATE_PASSWORD
KEYCHAIN_PASSWORD
APPLE_INSTALLER_SIGNING_IDENTITY
```

`APPLE_INSTALLER_SIGNING_IDENTITY` is optional for local/internal pkg creation, but should be set to a Developer ID Installer identity for externally distributed signed pkg artifacts.

For notarization, configure either App Store Connect API credentials:

```text
APPLE_API_ISSUER
APPLE_API_KEY
APPLE_API_KEY_PATH
```

In GitHub Actions, `APPLE_API_PRIVATE_KEY` may be used instead of `APPLE_API_KEY_PATH`; the workflow writes it to a temporary `.p8` file and exports `APPLE_API_KEY_PATH` for Tauri.

or Apple ID credentials:

```text
APPLE_ID
APPLE_PASSWORD
APPLE_TEAM_ID
```

These names follow Tauri's macOS signing/notarization environment contract.

## Commands

```sh
npm run phase3:preflight
npm run tauri:build:dmg
npm run phase3:package
npm run phase3:release-draft
```

`phase3:preflight` writes `reports/phase3-preflight.json` and `docs/generated/phase3-readiness.md`. Without credentials, it reports the missing inputs while still allowing local unsigned packaging through `npm run build:release-local`.

## Release Contents

`npm run phase3:package` writes:

- macOS app zip
- DMG when Tauri generated one
- pkg generated with `pkgbuild`
- `RELEASE_NOTES.md`
- `SHA256SUMS`
- bundle manifest and dist checksums
- SBOM seed and license inventory
- `validation-pack/`
- `validation-pack.zip`

## GitHub Release

`npm run phase3:release-draft` creates a draft prerelease using `gh release create`. Set `RELEASE_TAG` to override the default `v<project.version>`.

The GitHub Actions release workflow uploads `release/` as an artifact on every manual run and creates a draft release on `v*` tags.

## Boundary

The harness can assemble evidence and automate the signed build path, but it cannot assert production approval by itself. Final external distribution requires:

- Apple Developer account ownership and valid Developer ID certificate
- successful notarization and stapling
- organization review of the validation pack
- release approval recorded in the organization's quality system
