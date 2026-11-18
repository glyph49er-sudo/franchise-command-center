'use strict';
// Pure helpers for extras.js (streams, logger, broadcasts). Ported from snallabot-service
// (streams.ts, logger.ts, broadcasts.ts), MIT, Copyright (c) 2024 snallabot. See SNALLABOT_LICENSE.md.

// ---- /streams: how many games each member has streamed -------------------------------------
function streamBoard(counts) {
  const rows = Object.entries(counts || {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (!rows.length) return '# Stream Counts\nNo streams counted yet.';
  return `# Stream Counts\n${rows.map(([id, n], i) => `**${i + 1}.** <@${id}> — ${n}`).join('\n')}`;
}
// delta may be negative; counts never go below 0; zero entries are dropped
function bumpStream(counts, userId, delta) {
  const next = { ...(counts || {}) };
  next[userId] = Math.max(0, (next[userId] || 0) + delta);
  if (!next[userId]) delete next[userId];
  return next;
}

// ---- /logger: archive a finished game channel into a thread ---------------------------------
// messages: [{ author: 'name', content, createdAt: ms, attachments:[url] }] oldest first
function transcript(messages, maxLen = 1900) {
  const lines = messages.filter(m => m.content || (m.attachments || []).length).map(m => {
    const t = new Date(m.createdAt).toISOString().slice(0, 16).replace('T', ' ');
    return `[${t}] ${m.author}: ${m.content || ''}${(m.attachments || []).map(u => ` ${u}`).join('')}`.trim();
  });
  const chunks = [];
  let cur = '';
  for (const raw of lines) {
    const line = raw.length > maxLen ? raw.slice(0, maxLen - 1) + '…' : raw;
    if (cur && cur.length + line.length + 1 > maxLen) { chunks.push(cur); cur = ''; }
    cur += (cur ? '\n' : '') + line;
  }
  if (cur) chunks.push(cur);
  return chunks;
}

// ---- /broadcasts -----------------------------------------------------------------------------
// Accepts a channel id (UC...), a youtube.com/channel/UC... URL, or an @handle / youtube.com/@handle URL.
function parseYoutubeChannel(input) {
  const s = String(input || '').trim();
  const id = s.match(/(UC[0-9A-Za-z_-]{22})/);
  if (id) return { id: id[1] };
  const handle = s.match(/@([A-Za-z0-9._-]+)/);
  if (handle) return { handle: handle[1] };
  return null;
}
const parseTwitchLogin = input => {
  const s = String(input || '').trim().replace(/^https?:\/\/(www\.)?twitch\.tv\//i, '').replace(/[/?#].*$/, '').toLowerCase();
  return /^[a-z0-9_]{3,25}$/.test(s) ? s : null;
};
// keyword filter: empty keyword allows everything
const matchesKeyword = (title, keyword) => !keyword || String(title || '').toLowerCase().includes(String(keyword).toLowerCase());
module.exports = { streamBoard, bumpStream, transcript, parseYoutubeChannel, parseTwitchLogin, matchesKeyword };
