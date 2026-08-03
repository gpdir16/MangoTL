# Contributing to MangoTL

Thank you for your interest in MangoTL.

## License

By contributing, you agree that your contributions will be licensed under the same terms as the project: **GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later)**.

## Development setup

```sh
bun install
bun run dev
```

Load the `extension/` directory as a temporary add-on in Firefox for manual testing.

## Before opening a pull request

```sh
bun run release:check
```

This syncs public config, checks formatting, lints the extension, and builds `dist/mangotl-extension.zip`.

## Code style

- Match existing formatting (`bun run format` uses Prettier).
- Keep changes focused; avoid unrelated refactors in the same PR.

## Issues and features

Use GitHub issues for bugs and feature discussion. Include browser version, server logs (redact API keys), and steps to reproduce when reporting bugs.
