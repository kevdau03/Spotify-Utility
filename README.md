# Spotify Utility

A personal CLI for your own Spotify account: export your liked songs, hand the list to an LLM
(e.g. Claude) to plan playlists, then create them with the same CLI.

Uses OAuth Authorization Code + PKCE with your own Spotify dev app. Only a Client ID is needed (no secret).
Node 20+, zero dependencies.

## Setup
1. Create an app at https://developer.spotify.com/dashboard.
2. Add the redirect URI `http://127.0.0.1:8888/callback` to the app.
3. `cp .env.example .env` and set `SPOTIFY_CLIENT_ID`.
4. `npm link` (or run `node bin/spotify.js ...`), then `spotify login`.

Tokens are stored in `~/.config/spotify-utility/tokens.json` (mode 0600) and refreshed automatically.

## Workflow
```
spotify export liked -o likes.json            # add --genres to include artist genres if Spotify allows
# give likes.json to Claude: "make a workout playlist and one per decade, output plan.json"
spotify apply plan.json --library likes.json --dry-run
spotify apply plan.json --library likes.json
```
`plan.json`: `[{ "name": "Workout", "description": "...", "uris": ["spotify:track:..."] }]`

`--library` rejects any URI not in your export, so a hallucinated track can't slip in.

## Commands
See `spotify help`. `spotify delete <id|exact name>...` previews by default; `--yes` unfollows the playlist (Spotify's version of delete, restorable at spotify.com/account/recover-playlists) after saving a track backup to `~/.config/spotify-utility/trash/`. Ambiguous names are refused. Nothing else is ever removed, and tracks are never removed from your liked songs.
Exports and `.env` are gitignored because they contain personal data.
