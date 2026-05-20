# Release Checklist

Use this checklist before publishing a MangoTL release.

## Local Verification

```sh
bun install
bun run release:check
PORT=8787 bun run start
curl http://localhost:8787/health
```

Expected result:

- Formatting passes.
- Extension fallback config is synced from `server/config`.
- `web-ext` reports zero errors, notices, and warnings.
- `dist/mangotl-extension.zip` is created.
- `/health` returns `ok: true`.

## Extension Store Notes

- Firefox/AMO: the bundled extension is Manifest V2 and can be packaged with `bun run release:extension`.
- Chrome Web Store: Manifest V2 publishing is no longer supported, so Chrome release requires a Manifest V3 migration before submission.

## Manual Pre-Submission Checks

- Confirm `extension/manifest.json` still has the intended stable add-on ID before the first public upload.
- Confirm the extension listing has screenshots, a support URL, and privacy policy text.
- Confirm the project license before publishing source archives.
- Confirm `.env` is not included in the release package.
- Test translation on a real Pixiv image with the production provider API key.
