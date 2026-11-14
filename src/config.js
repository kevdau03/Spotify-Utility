import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

function loadDotenv() {
  // Only the repo's own .env: reading ./.env from the cwd would let an untrusted directory swap in another client ID.
  const p = path.join(root, '.env');
  return fs.existsSync(p) ? parseEnv(fs.readFileSync(p, 'utf8')) : {};
}

export function getConfig() {
  const env = { ...loadDotenv(), ...process.env };
  const clientId = env.SPOTIFY_CLIENT_ID;
  if (!clientId || clientId === 'your_client_id_here') {
    throw new Error('SPOTIFY_CLIENT_ID is not set. Copy .env.example to .env and fill it in.');
  }
  const redirectUri = env.SPOTIFY_REDIRECT_URI || 'http://127.0.0.1:8888/callback';
  const ru = new URL(redirectUri);
  if (ru.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(ru.hostname)) {
    throw new Error('SPOTIFY_REDIRECT_URI must be an http loopback address (e.g. http://127.0.0.1:8888/callback).');
  }
  const dir = env.SPOTIFY_UTILITY_HOME || path.join(os.homedir(), '.config', 'spotify-utility');
  return { clientId, redirectUri, dir, tokenFile: path.join(dir, 'tokens.json') };
}

export const SCOPES = [
  'user-library-read',
  'playlist-read-private',
  'playlist-modify-private',
  'playlist-modify-public',
];
