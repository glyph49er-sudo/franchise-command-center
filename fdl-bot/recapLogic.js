'use strict';
// Pure helpers for automatic game recaps (Franchise Hub style: final score card with records and top
// performers, plus a short written story).
const D = require('./franchiseData');
const { pick, num } = D;
const name = r => D.playerName(r);
const g = (r, k) => num(pick(r, k));

// Best individual lines for one team in one game.
function topPerformers(stats, teamId) {
  const mine = list => ((stats && stats[list]) || []).filter(r => num(pick(r, ['teamId'])) === teamId && name(r));
  const best = (rows, key) => rows.sort((a, b) => g(b, key) - g(a, key))[0];
  const out = [];
  const qb = best(mine('passing'), ['passYds']);
  if (qb && g(qb, ['passAtt'])) out.push({ kind: 'pass', name: name(qb), text: `${g(qb, ['passComp'])}/${g(qb, ['passAtt'])}, ${g(qb, ['passYds'])} YDS, ${g(qb, ['passTDs'])} TD${g(qb, ['passInts']) ? `, ${g(qb, ['passInts'])} INT` : ''}`, yds: g(qb, ['passYds']), td: g(qb, ['passTDs']) });
  const rb = best(mine('rushing'), ['rushYds']);
  if (rb && g(rb, ['rushYds']) > 0) out.push({ kind: 'rush', name: name(rb), text: `${g(rb, ['rushAtt'])} CAR, ${g(rb, ['rushYds'])} YDS${g(rb, ['rushTDs']) ? `, ${g(rb, ['rushTDs'])} TD` : ''}`, yds: g(rb, ['rushYds']), td: g(rb, ['rushTDs']) });
  const wr = best(mine('receiving'), ['recYds']);
  if (wr && g(wr, ['recYds']) > 0) out.push({ kind: 'rec', name: name(wr), text: `${g(wr, ['recCatches', 'recCatch'])} REC, ${g(wr, ['recYds'])} YDS${g(wr, ['recTDs']) ? `, ${g(wr, ['recTDs'])} TD` : ''}`, yds: g(wr, ['recYds']), td: g(wr, ['recTDs']) });
  const df = best(mine('defense'), ['defTotalTackles', 'defTackles']);
  if (df && g(df, ['defTotalTackles', 'defTackles'])) out.push({ kind: 'def', name: name(df), text: `${g(df, ['defTotalTackles', 'defTackles'])} TKL${g(df, ['defSacks']) ? `, ${g(df, ['defSacks'])} SK` : ''}${g(df, ['defInts']) ? `, ${g(df, ['defInts'])} INT` : ''}` });
  return out;
}

const verb = margin => (margin <= 3 ? 'edged' : margin <= 10 ? 'beat' : margin <= 21 ? 'handled' : 'routed');
// A short written story from the numbers (no AI): headline + two or three sentences.
function gameStory({ game, topWinner = [], topLoser = [], records = {} }) {
  if (!game.final || game.awayScore === game.homeScore) {
    return game.final ? `${game.away} and ${game.home} played to a ${game.awayScore}-${game.homeScore} tie.` : '';
  }
  const awayWon = game.awayScore > game.homeScore;
  const [w, l] = awayWon ? [{ name: game.away, id: game.awayId, s: game.awayScore }, { name: game.home, id: game.homeId, s: game.homeScore }] : [{ name: game.home, id: game.homeId, s: game.homeScore }, { name: game.away, id: game.awayId, s: game.awayScore }];
  const margin = w.s - l.s;
  const sentences = [`${w.name} ${verb(margin)} ${l.name}, ${w.s}-${l.s}${awayWon ? ' on the road' : ' at home'}.`];
  const star = [...topWinner].sort((a, b) => (b.yds || 0) + (b.td || 0) * 30 - ((a.yds || 0) + (a.td || 0) * 30))[0];
  if (star) sentences.push(`${star.name} led the way for ${w.name} (${star.text}).`);
  const foil = topLoser.find(p => p.kind === 'pass' || p.kind === 'rush');
  if (foil) sentences.push(`${foil.name} had ${foil.text} for ${l.name} in the loss.`);
  if (records[w.id]) sentences.push(`${w.name} ${margin >= 1 ? 'improve to' : 'sit at'} ${records[w.id]}.`);
  return sentences.join(' ');
}

// Embed-ready recap { title, description, fields } for one finished game.
function recapCard({ game, stats, records = {}, season, weekLabel }) {
  const tw = topPerformers(stats, game.awayScore > game.homeScore ? game.awayId : game.homeId);
  const tl = topPerformers(stats, game.awayScore > game.homeScore ? game.homeId : game.awayId);
  const rec = id => (records[id] ? ` (${records[id]})` : '');
  const line = (n, id, s, won) => `${won ? '**' : ''}${n}${rec(id)} ${s}${won ? '**' : ''}`;
  const awayWon = game.awayScore > game.homeScore, homeWon = game.homeScore > game.awayScore;
  const fields = [];
  const perf = (n, id) => topPerformers(stats, id).map(p => `• **${p.name}** — ${p.text}`).join('\n');
  const pa = perf(game.away, game.awayId), ph = perf(game.home, game.homeId);
  if (pa) fields.push({ name: game.away, value: pa });
  if (ph) fields.push({ name: game.home, value: ph });
  return {
    title: `FINAL • ${season} ${weekLabel}`,
    description: `${line(game.away, game.awayId, game.awayScore, awayWon)}\n${line(game.home, game.homeId, game.homeScore, homeWon)}\n\n${gameStory({ game, topWinner: tw, topLoser: tl, records })}`,
    fields
  };
}

// Upcoming matchups card text for a week.
function matchupLines(games, records = {}, ovrByTeam = {}) {
  return games.filter(x => !x.final).map(x => {
    const side = (n, id) => `${n}${records[id] ? ` (${records[id]})` : ''}${ovrByTeam[id] ? ` • ${ovrByTeam[id]} OVR` : ''}`;
    return `**${side(x.away, x.awayId)}** at **${side(x.home, x.homeId)}**`;
  });
}
module.exports = { topPerformers, gameStory, recapCard, matchupLines };
