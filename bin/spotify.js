#!/usr/bin/env node
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { login, logout, loadTokens } from '../src/auth.js';
import * as sp from '../src/api.js';
import { getConfig } from '../src/config.js';
import path from 'node:path';
import { simplifyTrack, formatTracks, validatePlan } from '../src/format.js';

const HELP = `spotify - personal Spotify CLI

  spotify login [--no-open]            Authorize with your Spotify dev app (PKCE)
  spotify status                       Show login state
  spotify logout                       Delete stored tokens

  spotify export liked   [-f json|txt|csv] [-o file] [--genres]
  spotify export playlist <id|name> [same options]
  spotify playlists                    List your playlists

  spotify create <name> --uris file.json [--description d] [--public] [--dry-run]
  spotify apply plan.json [--library likes.json] [--public] [--dry-run]
  spotify add <playlist-id> --uris file.json
  spotify delete <id|exact name>... [--yes]   Preview by default; --yes to remove (backs up tracks first)

Plan file (apply): [ { "name": "...", "description": "...", "uris": ["spotify:track:..."] } ]
--uris accepts a JSON array of URIs, a JSON array of export objects, or one URI per line.
`;

const opts = {
  format: { type: 'string', short: 'f', default: 'json' },
  output: { type: 'string', short: 'o' },
  genres: { type: 'boolean', default: false },
  uris: { type: 'string' },
  library: { type: 'string' },
  description: { type: 'string', default: '' },
  public: { type: 'boolean', default: false },
  yes: { type: 'boolean', default: false },
  'dry-run': { type: 'boolean', default: false },
  'no-open': { type: 'boolean', default: false },
  help: { type: 'boolean', short: 'h', default: false },
};

const log = (...a) => console.error(...a); // keep stdout clean for piping

function readUris(file) {
  const raw = fs.readFileSync(file, 'utf8').trim();
  if (raw.startsWith('[')) {
    return JSON.parse(raw).map((x) => (typeof x === 'string' ? x : x.uri)).filter(Boolean);
  }
  return raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

function emit(text, output) {
  if (output) { fs.writeFileSync(output, text, { mode: 0o600 }); log(`Wrote ${output}`); } // 0600: personal library data
  else process.stdout.write(text);
}

async function exportTracks(items, { genres, format, output }) {
  let genreMap;
  if (genres) {
    const ids = items.flatMap((i) => (i.track || i.item || {}).artists?.map((a) => a.id) || []);
    genreMap = await sp.getArtistGenres(ids);
    if (!genreMap) log('Note: Spotify did not return artist genres for this app; exporting without them.');
  }
  const tracks = items.map((i) => simplifyTrack(i, genreMap || undefined)).filter(Boolean);
  log(`${tracks.length} tracks (skipped ${items.length - tracks.length} local/episode items)`);
  emit(formatTracks(tracks, format), output);
}

async function createOne({ name, description, uris }, { isPublic, dry }) {
  if (dry) { log(`[dry-run] would create "${name}" (${uris.length} tracks, ${isPublic ? 'public' : 'private'})`); return; }
  const pl = await sp.createPlaylist({ name, description, isPublic });
  await sp.addTracks(pl.id, uris);
  log(`Created "${name}" (${uris.length} tracks): ${pl.external_urls?.spotify || pl.id}`);
}

async function main() {
  const { values: v, positionals: [cmd, sub, ...rest] } = parseArgs({ options: opts, allowPositionals: true });
  if (!cmd || v.help || cmd === 'help') return console.log(HELP);

  switch (cmd) {
    case 'login':
      await login({ noOpen: v['no-open'] });
      log('Logged in. Tokens saved.');
      break;
    case 'logout':
      logout();
      log('Logged out.');
      break;
    case 'status': {
      const t = loadTokens();
      if (!t) return log('Not logged in.');
      const who = await sp.me();
      log(`Logged in as ${who.display_name || who.id}`);
      break;
    }
    case 'playlists': {
      for (const p of await sp.getPlaylists()) if (p) console.log(`${p.id}\t${p.items?.total ?? p.tracks?.total ?? '?'}\t${p.name}`);
      break;
    }
    case 'export': {
      const progress = (n, total) => process.stderr.write(`\rFetched ${n}/${total}`);
      let items;
      if (sub === 'liked') items = await sp.getLikedTracks(progress);
      else if (sub === 'playlist') {
        const key = rest.join(' ');
        if (!key) throw new Error('Usage: spotify export playlist <id|name>');
        let id = key;
        if (!/^[A-Za-z0-9]{22}$/.test(key)) {
          const found = (await sp.getPlaylists()).find((p) => p?.name.toLowerCase() === key.toLowerCase());
          if (!found) throw new Error(`No playlist named "${key}"`);
          id = found.id;
        }
        items = await sp.getPlaylistTracks(id, progress);
      } else throw new Error('Usage: spotify export liked|playlist');
      process.stderr.write('\n');
      await exportTracks(items, v);
      break;
    }
    case 'create': {
      if (!sub || !v.uris) throw new Error('Usage: spotify create <name> --uris file');
      const uris = readUris(v.uris);
      const problems = validatePlan([{ name: sub, uris }]);
      if (problems.length) throw new Error(problems.join('\n'));
      await createOne({ name: [sub, ...rest].join(' '), description: v.description, uris }, { isPublic: v.public, dry: v['dry-run'] });
      break;
    }
    case 'apply': {
      if (!sub) throw new Error('Usage: spotify apply plan.json');
      const plan = JSON.parse(fs.readFileSync(sub, 'utf8'));
      const known = v.library ? new Set(readUris(v.library)) : null;
      const problems = validatePlan(plan, known);
      if (problems.length) throw new Error('Plan rejected:\n' + problems.join('\n'));
      for (const p of plan) await createOne({ ...p, uris: [...new Set(p.uris)] }, { isPublic: v.public, dry: v['dry-run'] });
      break;
    }
    case 'delete': {
      const keys = [sub, ...rest].filter(Boolean);
      if (!keys.length) throw new Error('Usage: spotify delete <id|exact name>... [--yes]');
      const all = (await sp.getPlaylists()).filter(Boolean);
      const targets = [];
      for (const key of keys) {
        const hits = all.filter((p) => p.id === key || p.name === key);
        if (hits.length !== 1) throw new Error(hits.length ? `"${key}" matches ${hits.length} playlists; use the id (spotify playlists)` : `No playlist matching "${key}"`);
        targets.push(hits[0]);
      }
      for (const p of targets) log(`${v.yes ? 'Deleting' : '[preview] would delete'} "${p.name}" (${p.id}, ${p.items?.total ?? p.tracks?.total ?? '?'} tracks)`);
      if (!v.yes) return log('Nothing changed. Re-run with --yes to delete.');
      const dir = path.join(getConfig().dir, 'trash');
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      for (const p of targets) {
        const tracks = (await sp.getPlaylistTracks(p.id)).map((i) => simplifyTrack(i)).filter(Boolean);
        const file = path.join(dir, `${p.id}-${Date.now()}.json`);
        fs.writeFileSync(file, JSON.stringify({ name: p.name, description: p.description, tracks }, null, 1), { mode: 0o600 });
        await sp.deletePlaylist(p.id);
        log(`Deleted "${p.name}". Backup: ${file}`);
      }
      break;
    }
    case 'add': {
      if (!sub || !v.uris) throw new Error('Usage: spotify add <playlist-id> --uris file');
      const uris = readUris(v.uris);
      await sp.addTracks(sub, uris);
      log(`Added ${uris.length} tracks.`);
      break;
    }
    default:
      console.log(HELP);
      process.exitCode = 1;
  }
}

main().catch((e) => { console.error(`Error: ${e.message}`); process.exit(1); });
