'use strict';
// Pure helpers for the league newswire: roster moves, upsets and streaks, written as short headlines.
const FA = 'Free Agent';

// prev/curr: { [playerId]: { n, pos, ovr, team } }. Only players at/above minOvr make the news.
function diffMoves(prev, curr, minOvr = 75) {
  const out = [];
  for (const [id, p] of Object.entries(curr)) {
    const q = prev[id];
    if (!q || q.team === p.team || (p.ovr || 0) < minOvr) continue;
    const who = `**${p.pos} ${p.n}** (${p.ovr} OVR)`;
    if (q.team === FA) out.push({ kind: 'signing', id, text: `✍️ **SIGNED:** ${who} signs with the **${p.team}**.` });
    else if (p.team === FA) out.push({ kind: 'release', id, text: `✂️ **RELEASED:** the **${q.team}** release ${who}.` });
    else out.push({ kind: 'trade', id, text: `🔁 **TRADE:** ${who} moves from the **${q.team}** to the **${p.team}**.` });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

// weeks: [{ week, games:[{awayId,homeId,away,home,awayScore,homeScore,final}] }] in order.
// Returns current win(+)/loss(-) streak per team id with a name.
function streaks(weeks) {
  const cur = {};
  for (const { games } of weeks) for (const g of games) {
    if (!g.final || g.awayScore === g.homeScore) continue;
    for (const [id, name, won] of [[g.awayId, g.away, g.awayScore > g.homeScore], [g.homeId, g.home, g.homeScore > g.awayScore]]) {
      const c = cur[id] || { name, n: 0 };
      c.n = won ? (c.n > 0 ? c.n + 1 : 1) : (c.n < 0 ? c.n - 1 : -1); c.name = name; cur[id] = c;
    }
  }
  return cur;
}
const streakHeadline = (name, n) => (n >= 3 ? `🔥 **${name}** have now won **${n}** straight.` : n <= -3 ? `🥶 **${name}** have now lost **${-n}** in a row.` : null);

// A finished game where the lower-rated team won by enough rating gap.
function upset(g, ovr, minGap = 5) {
  if (!g.final || g.awayScore === g.homeScore) return null;
  const awayWon = g.awayScore > g.homeScore;
  const wId = awayWon ? g.awayId : g.homeId, lId = awayWon ? g.homeId : g.awayId;
  const gap = (ovr[lId] || 0) - (ovr[wId] || 0);
  if (gap < minGap) return null;
  const [w, l, ws, ls] = awayWon ? [g.away, g.home, g.awayScore, g.homeScore] : [g.home, g.away, g.homeScore, g.awayScore];
  return `🚨 **UPSET:** **${w}** (${ovr[wId]} OVR) stun **${l}** (${ovr[lId]} OVR), ${ws}-${ls}.`;
}

module.exports = { FA, diffMoves, streaks, streakHeadline, upset };
