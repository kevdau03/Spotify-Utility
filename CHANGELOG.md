# Changelog

## v1.0.0 — 2026-11-14

Initial stable release.

- OAuth Authorization Code + PKCE login (`spotify login`/`logout`/`status`); loopback-only redirect, tokens stored at `0600` and refreshed automatically.
- `spotify export liked|playlist` to json/txt/csv, optionally with artist genres.
- `spotify create`/`apply` to build playlists from a plan file, with `--library` validation against a known-track export.
- `spotify add`/`remove` to add or remove tracks from an existing playlist by id or name.
- `spotify edit` to rename, redescribe, or change the visibility of a playlist.
- `spotify delete` to unfollow playlists, previewing by default and backing up tracks before removal with `--yes`.
- Bare filenames for `-o`/`--uris`/`--library`/`apply` resolve to a gitignored `work/` directory.
