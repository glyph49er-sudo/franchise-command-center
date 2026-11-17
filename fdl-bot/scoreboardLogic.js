'use strict';
// Pure rendering for the Snallabot-style scores channel and the box score view.
// Layout mirrors snallabot-service's formatSchedule/formatGame (src/discord/discord_utils.ts) and
// its game stats view (src/discord/commands/game_stats.ts), MIT, Copyright (c) 2024 snallabot.
const D = require('./franchiseData');
const { pick, num } = D;

const WEEK_NAMES = { 19: 'Wild Card', 20: 'Divisional', 21: 'Conference Championship', 23: 'Super Bowl' };
const weekName = w => WEEK_NAMES[w] || `Week ${w}`;
const SIM_TAG = { FAIR_SIM: 'Fair Sim', FORCE_WIN_AWAY: 'Force Win Away', FORCE_WIN_HOME: 'Force Win Home' };

// games: normalized EA games; records: { teamId: '3-1' }; sims: [{awayId, homeId, week, result}]
// emoji(teamName) -> string ('' when the server has no emoji for the team)
function scoreboardText({ season, week, games, records = {}, sims = [], emoji = () => '' }) {
  const sim = g => sims.find(s => s.week === week && s.awayId === g.awayId && s.homeId === g.homeId);
  const side = (name, id) => `${emoji(name) ? `${emoji(name)} ` : ''}${name}${records[id] ? ` (${records[id]})` : ''}`;
  const lines = [...games].sort((a, b) => (a.scheduleId ?? 0) - (b.scheduleId ?? 0)).map(g => {
    const a = side(g.away, g.awayId), h = side(g.home, g.homeId);
    const tag = sim(g) ? ` (${SIM_TAG[sim(g).result]})` : '';
    if (!g.final && !sim(g)) return `${a} vs ${h}`;
    if (g.awayScore > g.homeScore) return `**${a} ${g.awayScore}** vs ${g.homeScore} ${h}${tag}`;
    if (g.homeScore > g.awayScore) return `${a} ${g.awayScore} vs **${g.homeScore} ${h}**${tag}`;
    return `${a} ${g.awayScore} vs ${g.homeScore} ${h}${tag}`;
  });
  return `# ${season} Season ${weekName(week)} Games\n${lines.join('\n') || 'No games found for this week yet.'}`;
}

// The team that won a finished game (null for a tie / unplayed).
function winnerOf(g) {
  if (!g.final || g.awayScore === g.homeScore) return null;
  return g.awayScore > g.homeScore ? { id: g.awayId, name: g.away, home: false } : { id: g.homeId, name: g.home, home: true };
}

// One "📊 <Winner> box score" button per finished game: customId box:<week>:<awayId>:<homeId>.
// Discord allows 5 rows x 5 buttons; a week has at most 16 games.
function boxButtons(games, week) {
  const out = [];
  for (const g of [...games].sort((a, b) => (a.scheduleId ?? 0) - (b.scheduleId ?? 0))) {
    if (!g.final) continue;
    const w = winnerOf(g) || { name: `${g.away}/${g.home}` };
    out.push({ customId: `box:${week}:${g.awayId}:${g.homeId}`, label: `${w.name} box score`.slice(0, 80) });
  }
  return out.slice(0, 25);
}

// ---- Box score ------------------------------------------------------------------------
const nm = r => D.playerName ? D.playerName(r) : String(pick(r, ['fullName', 'playerName'], '')).trim();
const g = (r, keys) => num(pick(r, keys));
const cell = (v, w) => String(v).padStart(w);
const label = name => name.slice(0, 14).padEnd(14);

function teamRows(stats, teamId, list) {
  return ((stats && stats[list]) || []).filter(r => num(pick(r, ['teamId'])) === teamId && nm(r));
}

// -> { totals: {...}, sections: [{ title, header, rows: ['...'] }] } for one team.
function teamBox(stats, teamId) {
  const pass = teamRows(stats, teamId, 'passing').sort((a, b) => g(b, ['passYds']) - g(a, ['passYds']));
  const rush = teamRows(stats, teamId, 'rushing').filter(r => g(r, ['rushAtt']) || g(r, ['rushYds'])).sort((a, b) => g(b, ['rushYds']) - g(a, ['rushYds']));
  const rec = teamRows(stats, teamId, 'receiving').filter(r => g(r, ['recCatches', 'recCatch']) || g(r, ['recYds'])).sort((a, b) => g(b, ['recYds']) - g(a, ['recYds']));
  const def = teamRows(stats, teamId, 'defense').filter(r => g(r, ['defTotalTackles', 'defTackles']) || g(r, ['defSacks']) || g(r, ['defInts']) || g(r, ['defForcedFum']))
    .sort((a, b) => g(b, ['defTotalTackles', 'defTackles']) - g(a, ['defTotalTackles', 'defTackles']));
  const sum = (rows, keys) => rows.reduce((s, r) => s + g(r, keys), 0);
  const passYds = sum(pass, ['passYds']), rushYds = sum(rush, ['rushYds']);
  const totals = {
    passYds, rushYds, totalYds: passYds + rushYds,
    turnovers: sum(pass, ['passInts']) + sum(rush, ['rushFum', 'rushFumbles']) + sum(rec, ['recFum']),
    sacksMade: sum(def, ['defSacks'])
  };
  const sections = [];
  if (pass.length) sections.push({ title: 'Passing', header: `${'Player'.padEnd(14)} ${cell('C/A', 6)} ${cell('YDS', 4)} ${cell('TD', 2)} ${cell('INT', 3)}`,
    rows: pass.slice(0, 3).map(r => `${label(nm(r))} ${cell(`${g(r, ['passComp'])}/${g(r, ['passAtt'])}`, 6)} ${cell(g(r, ['passYds']), 4)} ${cell(g(r, ['passTDs']), 2)} ${cell(g(r, ['passInts']), 3)}`) });
  if (rush.length) sections.push({ title: 'Rushing', header: `${'Player'.padEnd(14)} ${cell('ATT', 3)} ${cell('YDS', 4)} ${cell('TD', 2)} ${cell('LNG', 3)}`,
    rows: rush.slice(0, 6).map(r => `${label(nm(r))} ${cell(g(r, ['rushAtt']), 3)} ${cell(g(r, ['rushYds']), 4)} ${cell(g(r, ['rushTDs']), 2)} ${cell(g(r, ['rushLongest', 'rushLong']), 3)}`) });
  if (rec.length) sections.push({ title: 'Receiving', header: `${'Player'.padEnd(14)} ${cell('REC', 3)} ${cell('YDS', 4)} ${cell('TD', 2)} ${cell('LNG', 3)}`,
    rows: rec.slice(0, 8).map(r => `${label(nm(r))} ${cell(g(r, ['recCatches', 'recCatch']), 3)} ${cell(g(r, ['recYds']), 4)} ${cell(g(r, ['recTDs']), 2)} ${cell(g(r, ['recLongest', 'recLong']), 3)}`) });
  if (def.length) sections.push({ title: 'Defense', header: `${'Player'.padEnd(14)} ${cell('TKL', 3)} ${cell('SK', 3)} ${cell('INT', 3)} ${cell('FF', 2)}`,
    rows: def.slice(0, 10).map(r => `${label(nm(r))} ${cell(g(r, ['defTotalTackles', 'defTackles']), 3)} ${cell(g(r, ['defSacks']), 3)} ${cell(g(r, ['defInts']), 3)} ${cell(g(r, ['defForcedFum']), 2)}`) });
  return { totals, sections };
}

// -> [{ title, description, fields:[{name,value}] }] one per team (away first).
function boxScore({ game, stats, season, week }) {
  const mk = (name, id, score, won) => {
    const { totals, sections } = teamBox(stats, id);
    const has = sections.length > 0;
    return {
      title: `${won ? '🏆 ' : ''}${name} — ${score}`,
      description: `**Total yards:** ${totals.totalYds} (${totals.passYds} pass, ${totals.rushYds} rush) • **Turnovers:** ${totals.turnovers}` + (has ? '' : '\n_No player stats available for this game yet._'),
      fields: sections.map(s => ({ name: s.title, value: '```\n' + [s.header, ...s.rows].join('\n') + '\n```' }))
    };
  };
  const w = winnerOf(game);
  return {
    header: `${season} Season ${weekName(week)} — ${game.away} ${game.awayScore} @ ${game.home} ${game.homeScore}`,
    teams: [mk(game.away, game.awayId, game.awayScore, w && !w.home), mk(game.home, game.homeId, game.homeScore, w && w.home)]
  };
}

module.exports = { weekName, scoreboardText, winnerOf, boxButtons, teamBox, boxScore };
