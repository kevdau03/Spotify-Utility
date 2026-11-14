// Compact track shape: small enough to paste a few thousand songs into an LLM.
export function simplifyTrack(item, genresByArtist) {
  const t = item.track || item.item || item;
  if (!t || !t.uri || t.type === 'episode' || t.is_local) return null;
  const artists = (t.artists || []).map((a) => a.name);
  const out = {
    uri: t.uri,
    name: t.name,
    artists,
    album: t.album?.name,
    year: Number((t.album?.release_date || '').slice(0, 4)) || undefined,
    added_at: item.added_at?.slice(0, 10),
    duration_s: t.duration_ms ? Math.round(t.duration_ms / 1000) : undefined,
  };
  if (genresByArtist) {
    out.genres = [...new Set((t.artists || []).flatMap((a) => genresByArtist[a.id] || []))];
  }
  return out;
}

const csvCell = (v) => {
  const s = Array.isArray(v) ? v.join('; ') : v ?? '';
  return /[",\n]/.test(String(s)) ? `"${String(s).replace(/"/g, '""')}"` : String(s);
};

export function formatTracks(tracks, format) {
  if (format === 'json') return JSON.stringify(tracks, null, 1);
  if (format === 'txt') return tracks.map((t) => `${t.artists.join(', ')} - ${t.name}`).join('\n') + '\n';
  if (format === 'csv') {
    const cols = ['uri', 'name', 'artists', 'album', 'year', 'added_at', 'duration_s', 'genres'];
    return [cols.join(','), ...tracks.map((t) => cols.map((c) => csvCell(t[c])).join(','))].join('\n') + '\n';
  }
  throw new Error(`Unknown format "${format}" (use json, txt or csv)`);
}

export function validatePlan(plan, knownUris) {
  const problems = [];
  if (!Array.isArray(plan)) return ['Plan must be a JSON array of { name, description?, uris[] }'];
  plan.forEach((p, i) => {
    if (!p.name || typeof p.name !== 'string') problems.push(`#${i}: missing name`);
    if (!Array.isArray(p.uris) || !p.uris.length) problems.push(`#${i} (${p.name}): uris must be a non-empty array`);
    else {
      const bad = p.uris.filter((u) => !/^spotify:track:[A-Za-z0-9]{22}$/.test(u));
      if (bad.length) problems.push(`#${i} (${p.name}): ${bad.length} malformed URI(s), e.g. ${bad[0]}`);
      if (knownUris) {
        const unk = p.uris.filter((u) => !knownUris.has(u));
        if (unk.length) problems.push(`#${i} (${p.name}): ${unk.length} URI(s) not in the export, e.g. ${unk[0]}`);
      }
    }
  });
  return problems;
}
