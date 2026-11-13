import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { getConfig, SCOPES } from './config.js';

const AUTH_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';

const b64url = (buf) => buf.toString('base64url');

export function makePkce() {
  const verifier = b64url(crypto.randomBytes(64));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

export function buildAuthUrl({ clientId, redirectUri, challenge, state }) {
  const u = new URL(AUTH_URL);
  u.search = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: SCOPES.join(' '),
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state,
  }).toString();
  return u.toString();
}

function saveTokens(cfg, t) {
  fs.mkdirSync(cfg.dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(cfg.tokenFile, JSON.stringify(t, null, 2), { mode: 0o600 });
  fs.chmodSync(cfg.tokenFile, 0o600);
}

export function loadTokens(cfg = getConfig()) {
  try {
    return JSON.parse(fs.readFileSync(cfg.tokenFile, 'utf8'));
  } catch {
    return null;
  }
}

async function tokenRequest(params) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Token request failed: ${body.error_description || body.error || res.status}`);
  return body;
}

function openBrowser(url) {
  const [cmd, args] =
    process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : ['xdg-open', [url]];
  execFile(cmd, args, () => {});
}

export async function login({ noOpen = false } = {}) {
  const cfg = getConfig();
  const redirect = new URL(cfg.redirectUri);
  const { verifier, challenge } = makePkce();
  const state = b64url(crypto.randomBytes(16));
  const url = buildAuthUrl({ clientId: cfg.clientId, redirectUri: cfg.redirectUri, challenge, state });

  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, cfg.redirectUri);
      if (u.pathname !== redirect.pathname) { res.writeHead(404).end(); return; }
      const err = u.searchParams.get('error');
      const ok = !err && u.searchParams.get('state') === state && u.searchParams.get('code');
      res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/plain' });
      res.end(ok ? 'Spotify login complete. You can close this tab.' : `Login failed: ${err || 'state mismatch'}`);
      server.close();
      ok ? resolve(u.searchParams.get('code')) : reject(new Error(`Login failed: ${err || 'state mismatch'}`));
    });
    server.on('error', reject);
    server.listen(Number(redirect.port) || 80, redirect.hostname, () => {
      console.log('Open this URL to authorize (opening automatically):\n\n' + url + '\n');
      if (!noOpen) openBrowser(url);
    });
    setTimeout(() => { server.close(); reject(new Error('Login timed out after 5 minutes.')); }, 300000).unref();
  });

  const t = await tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: cfg.redirectUri,
    client_id: cfg.clientId,
    code_verifier: verifier,
  });
  saveTokens(cfg, toStored(t));
  return true;
}

function toStored(t, prev) {
  return {
    access_token: t.access_token,
    refresh_token: t.refresh_token || prev?.refresh_token,
    expires_at: Date.now() + (t.expires_in - 60) * 1000,
    scope: t.scope || prev?.scope,
  };
}

export async function getAccessToken() {
  const cfg = getConfig();
  const t = loadTokens(cfg);
  if (!t) throw new Error('Not logged in. Run: spotify login');
  if (Date.now() < t.expires_at) return t.access_token;
  const fresh = await tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: t.refresh_token,
    client_id: cfg.clientId,
  });
  const stored = toStored(fresh, t);
  saveTokens(cfg, stored);
  return stored.access_token;
}

export function logout() {
  const cfg = getConfig();
  fs.rmSync(cfg.tokenFile, { force: true });
}
