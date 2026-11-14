import { getAccessToken } from './auth.js';

const BASE = 'https://api.spotify.com/v1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function api(path, { method = 'GET', body, query } = {}, retries = 5) {
  const url = path.startsWith('http') ? path : BASE + path + (query ? '?' + new URLSearchParams(query) : '');
  // Pagination follows server-supplied `next` URLs; never send the bearer token anywhere but Spotify's API.
  if (new URL(url).origin !== 'https://api.spotify.com') throw new Error(`Refusing to send credentials to ${new URL(url).origin}`);
  for (let attempt = 0; ; attempt++) {
    const token = await getAccessToken();
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429 && attempt < retries) {
      await sleep(Math.min(Number(res.headers.get('retry-after')) || 1, 60) * 1000 + 250);
      continue;
    }
    if (res.status >= 500 && attempt < retries) { await sleep(500 * 2 ** attempt); continue; }
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const e = new Error(`Spotify API ${method} ${path} -> ${res.status}: ${data?.error?.message || text}`);
      e.status = res.status;
      throw e;
    }
    return data;
  }
}

export async function paginate(path, query = {}, onPage) {
  const items = [];
  let next = null;
  let first = true;
  while (first || next) {
    const page = await api(first ? path : next, first ? { query: { limit: 50, ...query } } : {});
    first = false;
    items.push(...page.items);
    next = page.next;
    onPage?.(items.length, page.total);
  }
  return items;
}

export const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

export const me = () => api('/me');

export async function getLikedTracks(onPage) {
  return paginate('/me/tracks', {}, onPage);
}

export async function getPlaylists() {
  return paginate('/me/playlists');
}

export async function getPlaylistTracks(id, onPage) {
  try {
    return await paginate(`/playlists/${id}/items`, {}, onPage);
  } catch (e) {
    if (e.status !== 404) throw e;
    return paginate(`/playlists/${id}/tracks`, {}, onPage);
  }
}

export async function getArtistGenres(artistIds) {
  const genres = {};
  for (const ids of chunk([...new Set(artistIds)], 50)) {
    try {
      const r = await api('/artists', { query: { ids: ids.join(',') } });
      for (const a of r.artists || []) if (a) genres[a.id] = a.genres || [];
    } catch {
      return null; // endpoint restricted for this app; caller continues without genres
    }
  }
  return genres;
}

export function createPlaylist({ name, description = '', isPublic = false }) {
  return api('/me/playlists', { method: 'POST', body: { name, description, public: isPublic } });
}

export async function addTracks(playlistId, uris) {
  for (const batch of chunk(uris, 100)) {
    try {
      await api(`/playlists/${playlistId}/items`, { method: 'POST', body: { uris: batch } });
    } catch (e) {
      if (e.status !== 404) throw e;
      await api(`/playlists/${playlistId}/tracks`, { method: 'POST', body: { uris: batch } });
    }
  }
}

// Spotify's "delete playlist" is unfollow: it leaves your library, and can be restored from spotify.com/account/recover-playlists.
export async function deletePlaylist(id) {
  try {
    await api(`/playlists/${id}/followers`, { method: 'DELETE' });
  } catch (e) {
    if (![404, 405, 410].includes(e.status)) throw e;
    // Newer library endpoint (may need the user-library-modify scope: re-run `spotify login` after adding it).
    await api('/me/library', { method: 'DELETE', query: { uris: `spotify:playlist:${id}` } });
  }
}
