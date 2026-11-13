import test from 'node:test';
import assert from 'node:assert/strict';
import { makePkce, buildAuthUrl } from '../src/auth.js';
import { parseEnv } from '../src/config.js';
import { simplifyTrack, formatTracks, validatePlan } from '../src/format.js';
import { chunk } from '../src/api.js';
import crypto from 'node:crypto';

const U = 'spotify:track:' + 'a'.repeat(22);

test('pkce challenge matches verifier', () => {
  const { verifier, challenge } = makePkce();
  assert.equal(challenge, crypto.createHash('sha256').update(verifier).digest('base64url'));
});

test('auth url has required params', () => {
  const u = new URL(buildAuthUrl({ clientId: 'c', redirectUri: 'http://127.0.0.1:8888/callback', challenge: 'x', state: 's' }));
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.match(u.searchParams.get('scope'), /playlist-modify-private/);
});

test('env parsing', () => assert.deepEqual(parseEnv('# c\nA=1\nB="two"\n'), { A: '1', B: 'two' }));

test('simplify skips local files and supports new/old item shapes', () => {
  assert.equal(simplifyTrack({ track: { uri: 'x', is_local: true } }), null);
  const t = simplifyTrack({ added_at: '2024-01-02T00:00:00Z', item: { uri: U, name: 'N', artists: [{ name: 'A', id: '1' }], album: { name: 'Al', release_date: '1999-05-01' }, duration_ms: 61000 } }, { 1: ['rock'] });
  assert.deepEqual([t.year, t.added_at, t.genres, t.duration_s], [1999, '2024-01-02', ['rock'], 61]);
});

test('formats', () => {
  const tr = [{ uri: U, name: 'a,b', artists: ['X', 'Y'] }];
  assert.equal(formatTracks(tr, 'txt'), 'X, Y - a,b\n');
  assert.match(formatTracks(tr, 'csv'), /"a,b"/);
});

test('plan validation', () => {
  assert.deepEqual(validatePlan([{ name: 'p', uris: [U] }], new Set([U])), []);
  assert.equal(validatePlan([{ name: 'p', uris: [U] }], new Set()).length, 1);
  assert.equal(validatePlan([{ name: 'p', uris: ['bad'] }]).length, 1);
});

test('chunk', () => assert.deepEqual(chunk([1, 2, 3], 2), [[1, 2], [3]]));
