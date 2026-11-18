'use strict';
// Pure helpers for the EA franchise exports. No Discord dependency, so everything
// here is unit-tested (test/franchiseData.test.js).
//
// EA's Companion App endpoints are unofficial and their field names are not
// documented. Every read goes through pick() with several candidate field names,
// and anything that can be known without EA (NFL divisions, dev-trait labels) is
// built in. If a value ever shows up blank in Discord, an admin can run
// /franchise-debug to see the exact field names EA is sending.

// short name, abbreviation, division
const NFL = [
  ['Bills','BUF','AFC East'],['Dolphins','MIA','AFC East'],['Patriots','NE','AFC East'],['Jets','NYJ','AFC East'],
  ['Ravens','BAL','AFC North'],['Bengals','CIN','AFC North'],['Browns','CLE','AFC North'],['Steelers','PIT','AFC North'],
  ['Texans','HOU','AFC South'],['Colts','IND','AFC South'],['Jaguars','JAX','AFC South'],['Titans','TEN','AFC South'],
  ['Broncos','DEN','AFC West'],['Chiefs','KC','AFC West'],['Raiders','LV','AFC West'],['Chargers','LAC','AFC West'],
  ['Cowboys','DAL','NFC East'],['Giants','NYG','NFC East'],['Eagles','PHI','NFC East'],['Commanders','WAS','NFC East'],
  ['Bears','CHI','NFC North'],['Lions','DET','NFC North'],['Packers','GB','NFC North'],['Vikings','MIN','NFC North'],
  ['Falcons','ATL','NFC South'],['Panthers','CAR','NFC South'],['Saints','NO','NFC South'],['Buccaneers','TB','NFC South'],
  ['Cardinals','ARI','NFC West'],['Rams','LAR','NFC West'],['49ers','SF','NFC West'],['Seahawks','SEA','NFC West']
];
const DIVISION_ORDER = ['AFC East','AFC North','AFC South','AFC West','NFC East','NFC North','NFC South','NFC West'];
const DIVISION_OF = {};
for (const [name, abbr, div] of NFL) { DIVISION_OF[name.toLowerCase()] = div; DIVISION_OF[abbr.toLowerCase()] = div; }

const DEV_LABELS = { 0: 'Normal', 1: 'Star', 2: 'Superstar', 3: 'X-Factor' };

const pick = (obj, keys, fallback) => {
  for (const k of keys) { const v = obj?.[k]; if (v !== undefined && v !== null && v !== '') return v; }
  return fallback;
};
const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const clip = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
// ▰▰▰▰▰▰▰▱▱▱ — rating bar for 0-99 values
const bar = (value, width = 10) => {
  const filled = Math.max(0, Math.min(width, Math.round(num(value) / 100 * width)));
  return '▰'.repeat(filled) + '▱'.repeat(width - filled);
};

// Breadth-first search for the first numeric value stored under any of `keys`.
function findDeep(obj, keys, maxDepth = 6) {
  const wanted = new Set(keys);
  let level = [obj];
  for (let depth = 0; depth <= maxDepth && level.length; depth++) {
    const next = [];
    for (const node of level) {
      if (!node || typeof node !== 'object') continue;
      for (const [k, v] of Object.entries(node)) {
        if (wanted.has(k) && v !== '' && v !== null && Number.isFinite(Number(v))) return Number(v);
        if (v && typeof v === 'object') next.push(v);
      }
    }
    level = next;
  }
  return null;
}

// Current week (1-based) and season from the league hub response.
function currentWeekFromHub(info) {
  const idx = findDeep(info, ['weekIndex']);
  const week = idx !== null ? idx + 1 : findDeep(info, ['currentWeek', 'week']);
  const season = findDeep(info, ['seasonIndex', 'calendarYear', 'seasonYear']);
  return { week, season };
}

function normalizeTeams(list) {
  return (list || []).map((t, index) => ({
    id: num(pick(t, ['teamId'])),
    index,
    name: String(pick(t, ['displayName', 'nickName', 'teamName', 'abbrName'], '')).trim(),
    nick: String(pick(t, ['nickName', 'displayName'], '')).trim(),
    abbr: String(pick(t, ['abbrName'], '')).trim(),
    user: String(pick(t, ['userName'], '')).trim(),
    ovr: num(pick(t, ['ovrRating', 'teamOvr', 'ovr', 'overallRating']), 0)
  }));
}
const teamsById = teams => Object.fromEntries((teams || []).map(t => [t.id, t]));
const divisionOf = team => DIVISION_OF[String(team?.name || '').toLowerCase()] || DIVISION_OF[String(team?.abbr || '').toLowerCase()] || null;

function normalizeStandings(raw, teams) {
  const byId = teamsById(teams);
  return (raw || []).map(s => {
    const id = num(pick(s, ['teamId']));
    const t = byId[id] || {};
    const w = num(pick(s, ['totalWins', 'wins', 'overallWins']));
    const l = num(pick(s, ['totalLosses', 'losses', 'overallLosses']));
    const ties = num(pick(s, ['totalTies', 'ties', 'overallTies']));
    const pf = num(pick(s, ['ptsFor', 'pointsFor', 'totalPtsFor']));
    const pa = num(pick(s, ['ptsAgainst', 'pointsAgainst', 'totalPtsAgainst']));
    const games = w + l + ties;
    const name = t.name || String(pick(s, ['teamName', 'displayName', 'nickName'], `Team ${id}`));
    return {
      teamId: id, name, abbr: t.abbr || '', division: divisionOf({ name, abbr: t.abbr }),
      w, l, t: ties, pf, pa, games,
      diff: num(pick(s, ['netPts', 'pointDiff']), pf - pa),
      winPct: games ? (w + ties / 2) / games : 0,
      ovr: num(pick(s, ['teamOvr', 'ovrRating']), t.ovr || 0)
    };
  });
}
const byRecord = (a, b) => b.winPct - a.winPct || b.diff - a.diff || a.name.localeCompare(b.name);
const recordText = r => `${r.w}-${r.l}${r.t ? `-${r.t}` : ''}`;
const signed = n => (n > 0 ? `+${n}` : String(n));

// -> [{ division, teams: [row...] }] in standard NFL order, optionally one conference.
function groupStandings(rows, conference = null) {
  const groups = new Map();
  for (const r of rows) {
    const key = r.division || 'Other';
    if (conference && !key.startsWith(conference)) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const order = [...DIVISION_ORDER, 'Other'];
  return order.filter(d => groups.has(d)).map(d => ({ division: d, teams: groups.get(d).sort(byRecord) }));
}

// Transparent formula (shown in the embed footer):
//   score = 60 x win% + 1.5 x points-per-game differential + 0.8 x (team OVR - 75)
// With no games played yet, teams are ranked by OVR alone.
function powerRankings(rows) {
  const played = rows.some(r => r.games > 0);
  return rows.map(r => ({
    ...r,
    score: played
      ? 60 * r.winPct + 1.5 * (r.games ? r.diff / r.games : 0) + 0.8 * ((r.ovr || 75) - 75)
      : r.ovr
  })).sort((a, b) => b.score - a.score || byRecord(a, b));
}

const isFinalGame = g => {
  const status = pick(g, ['status', 'gameStatus']);
  if (status === 3 || status === '3' || String(status).toLowerCase() === 'final') return true;
  if (g?.isGamePlayed === true || g?.played === true) return true;
  return false;
};
function normalizeGames(raw, teams) {
  const byId = teamsById(teams);
  return (raw || []).map(g => {
    const awayId = num(pick(g, ['awayTeamId']));
    const homeId = num(pick(g, ['homeTeamId']));
    const final = isFinalGame(g);
    return {
      awayId, homeId, scheduleId: num(pick(g, ['scheduleId']), 0),
      away: byId[awayId]?.name || `Team ${awayId}`,
      home: byId[homeId]?.name || `Team ${homeId}`,
      awayScore: num(pick(g, ['awayScore'])), homeScore: num(pick(g, ['homeScore'])),
      final, week: num(pick(g, ['weekIndex']), -1) + 1
    };
  }).filter(g => g.awayId || g.homeId);
}
const gameLine = g => g.final
  ? `**${g.away}** ${g.awayScore} @ ${g.homeScore} **${g.home}** ✅`
  : `**${g.away}** @ **${g.home}**`;

const playerName = row => String(pick(row, ['fullName', 'playerName'], `${pick(row, ['firstName'], '')} ${pick(row, ['lastName'], '')}`)).trim();

function devLabel(value) {
  if (value === undefined || value === null || value === '') return null;
  if (DEV_LABELS[value] !== undefined) return DEV_LABELS[value];
  const s = String(value).toLowerCase().replace(/[^a-z]/g, '');
  return s === 'xfactor' ? 'X-Factor' : s === 'superstar' ? 'Superstar' : s === 'star' ? 'Star' : s === 'normal' ? 'Normal' : String(value);
}
const labelFromKey = key => {
  const words = String(key).replace(/Rating$/, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};
function normalizePlayer(p, byId = {}) {
  const ratings = {};
  for (const [k, v] of Object.entries(p || {})) {
    if (k.endsWith('Rating') && !/overall|best|ovr/i.test(k) && typeof v === 'number') ratings[labelFromKey(k)] = v;
  }
  const teamId = num(pick(p, ['teamId']), 0);
  return {
    id: String(pick(p, ['rosterId', 'playerId', 'presentationId'], playerName(p))),
    name: playerName(p),
    pos: String(pick(p, ['position', 'pos'], '')).toUpperCase(),
    ovr: num(pick(p, ['playerBestOvr', 'overallRating', 'ovr', 'playerOvr'])),
    age: pick(p, ['age']),
    jersey: pick(p, ['jerseyNum', 'jerseyNumber']),
    dev: devLabel(pick(p, ['devTrait', 'dev', 'developmentTrait'])),
    yearsPro: num(pick(p, ['yearsPro', 'yearsInLeague']), 1),
    teamId, team: byId[teamId]?.name || (teamId ? `Team ${teamId}` : 'Free Agent'),
    portraitId: pick(p, ['portraitId']),
    ratings,
    awards: awardFields(p)
  };
}
// Ported from Snallabot's "hidden devs" setting: a rookie (0 years pro) with a non-Normal
// development trait shows as Hidden instead of giving the trait away.
const isHiddenDev = (p, hidden = true) => Boolean(hidden && p && p.yearsPro === 0 && p.dev && p.dev !== 'Normal');
const devShown = (p, hidden = true) => (isHiddenDev(p, hidden) ? 'Hidden' : (p?.dev || null));
const DEV_EMOJI = { Normal: '⚪', Star: '⭐', Superstar: '🌟', 'X-Factor': '🔥', Hidden: '❔' };
const devEmoji = (p, hidden = true) => DEV_EMOJI[devShown(p, hidden)] || '❔';
const topRatings = (player, n = 8) => Object.entries(player.ratings).sort((a, b) => b[1] - a[1]).slice(0, n);

const POSITION_GROUPS = {
  OL: ['LT', 'LG', 'C', 'RG', 'RT'], DL: ['LE', 'RE', 'DT'], EDGE: ['LE', 'RE'], LB: ['LOLB', 'MLB', 'ROLB'],
  DB: ['CB', 'FS', 'SS'], S: ['FS', 'SS'], RB: ['HB'], DE: ['LE', 'RE']
};
function matchesPosition(playerPos, wanted) {
  const w = String(wanted || '').toUpperCase().trim();
  if (!w) return true;
  const p = String(playerPos || '').toUpperCase();
  return p === w || (POSITION_GROUPS[w] || []).includes(p);
}

// ---- Weekly stat leaders ----------------------------------------------------------
const LEADER_CATEGORIES = {
  passing: { list: 'passing', label: 'Passing Yards', value: ['passYds', 'passingYards'],
    detail: r => `${num(pick(r, ['passComp']))}/${num(pick(r, ['passAtt']))}, ${num(pick(r, ['passTDs']))} TD, ${num(pick(r, ['passInts']))} INT` },
  rushing: { list: 'rushing', label: 'Rushing Yards', value: ['rushYds', 'rushingYards'],
    detail: r => `${num(pick(r, ['rushAtt']))} ATT, ${num(pick(r, ['rushTDs']))} TD` },
  receiving: { list: 'receiving', label: 'Receiving Yards', value: ['recYds', 'receivingYards'],
    detail: r => `${num(pick(r, ['recCatches', 'recCatch']))} REC, ${num(pick(r, ['recTDs']))} TD` },
  tackles: { list: 'defense', label: 'Tackles', value: ['defTotalTackles', 'defTackles', 'tackles'],
    detail: r => `${num(pick(r, ['defSacks']))} SK, ${num(pick(r, ['defInts']))} INT` },
  sacks: { list: 'defense', label: 'Sacks', value: ['defSacks'],
    detail: r => `${num(pick(r, ['defTotalTackles', 'defTackles']))} TKL` },
  interceptions: { list: 'defense', label: 'Interceptions', value: ['defInts'],
    detail: r => `${num(pick(r, ['defTotalTackles', 'defTackles']))} TKL` }
};
function weeklyLeaders(stats, category, byId, limit = 10) {
  const cat = LEADER_CATEGORIES[category];
  if (!cat) return [];
  return (stats?.[cat.list] || [])
    .map(r => ({ name: playerName(r), team: byId[num(pick(r, ['teamId']))]?.name || '', value: num(pick(r, cat.value)), detail: cat.detail(r) }))
    .filter(r => r.name && r.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

// ---- Players of the Week ----------------------------------------------------------
// One combined performance score per player (a QB's rushing counts too).
function playerPerformances(stats, byId) {
  const merged = new Map();
  const add = (row, kind) => {
    const name = playerName(row);
    if (!name) return;
    const teamId = num(pick(row, ['teamId']));
    const key = `${teamId}|${pick(row, ['playerId', 'rosterId'], name)}`;
    const e = merged.get(key) || { name, teamId, team: byId[teamId]?.name || '', pos: String(pick(row, ['position', 'pos'], '')).toUpperCase() };
    e[kind] = row;
    merged.set(key, e);
  };
  for (const r of stats?.passing || []) add(r, 'pass');
  for (const r of stats?.rushing || []) add(r, 'rush');
  for (const r of stats?.receiving || []) add(r, 'rec');
  for (const r of stats?.defense || []) add(r, 'def');

  const out = [];
  for (const e of merged.values()) {
    const g = (row, keys) => num(pick(row || {}, keys));
    const passYds = g(e.pass, ['passYds']), passTD = g(e.pass, ['passTDs']), passInt = g(e.pass, ['passInts']);
    const rushYds = g(e.rush, ['rushYds']), rushTD = g(e.rush, ['rushTDs']);
    const recYds = g(e.rec, ['recYds']), recTD = g(e.rec, ['recTDs']), rec = g(e.rec, ['recCatches', 'recCatch']);
    const tkl = g(e.def, ['defTotalTackles', 'defTackles']), sacks = g(e.def, ['defSacks']), ints = g(e.def, ['defInts']),
      ff = g(e.def, ['defForcedFum']), defTD = g(e.def, ['defTDs']);
    const score = passYds / 25 + passTD * 4 - passInt * 2 + rushYds / 10 + rushTD * 6 + recYds / 10 + recTD * 6 + rec * 0.5
      + tkl + sacks * 4 + ints * 6 + ff * 3 + defTD * 6;
    const parts = [];
    if (passYds) parts.push(`${passYds} PASS YDS, ${passTD} TD${passInt ? `, ${passInt} INT` : ''}`);
    if (rushYds || rushTD) parts.push(`${rushYds} RUSH YDS${rushTD ? `, ${rushTD} TD` : ''}`);
    if (recYds || rec) parts.push(`${rec} REC, ${recYds} YDS${recTD ? `, ${recTD} TD` : ''}`);
    if (tkl || sacks || ints || ff || defTD) {
      parts.push([tkl && `${tkl} TKL`, sacks && `${sacks} SK`, ints && `${ints} INT`, ff && `${ff} FF`, defTD && `${defTD} TD`].filter(Boolean).join(', '));
    }
    if (!parts.length) continue;
    const offScore = score - (tkl + sacks * 4 + ints * 6 + ff * 3 + defTD * 6), defScore = tkl + sacks * 4 + ints * 6 + ff * 3 + defTD * 6;
    out.push({ name: e.name, team: e.team, teamId: e.teamId, pos: e.pos, score, offScore, defScore, summary: parts.join(' • '), statLine: maddenLine(e) });
  }
  return out.sort((a, b) => b.score - a.score);
}
// The stat line the way Madden's Players of the Week screen shows it, e.g.
// "11-20, 234 PASS YDS, 4 PASS TD, 1 INT, 11 CAR, 201 RUSH YDS, 2 RUSH TD" or "5 TKL, 3 INT".
function maddenLine(e) {
  const g = (row, keys) => num(pick(row || {}, keys));
  const out = [];
  if (e.pass && g(e.pass, ['passAtt'])) {
    out.push(`${g(e.pass, ['passComp'])}-${g(e.pass, ['passAtt'])}`, `${g(e.pass, ['passYds'])} PASS YDS`, `${g(e.pass, ['passTDs'])} PASS TD`);
    if (g(e.pass, ['passInts'])) out.push(`${g(e.pass, ['passInts'])} INT`);
  }
  if (e.rush && (g(e.rush, ['rushAtt']) || g(e.rush, ['rushYds']))) {
    out.push(`${g(e.rush, ['rushAtt'])} CAR`, `${g(e.rush, ['rushYds'])} RUSH YDS`);
    if (g(e.rush, ['rushTDs'])) out.push(`${g(e.rush, ['rushTDs'])} RUSH TD`);
  }
  if (e.rec && (g(e.rec, ['recCatches', 'recCatch']) || g(e.rec, ['recYds']))) {
    out.push(`${g(e.rec, ['recCatches', 'recCatch'])} REC`, `${g(e.rec, ['recYds'])} REC YDS`);
    if (g(e.rec, ['recTDs'])) out.push(`${g(e.rec, ['recTDs'])} REC TD`);
  }
  if (e.def) {
    const t = g(e.def, ['defTotalTackles', 'defTackles']), sk = g(e.def, ['defSacks']), it = g(e.def, ['defInts']), ff = g(e.def, ['defForcedFum']), td = g(e.def, ['defTDs']);
    if (t) out.push(`${t} TKL`);
    if (sk) out.push(`${sk} SK`);
    if (it) out.push(`${it} INT`);
    if (ff) out.push(`${ff} FF`);
    if (td) out.push(`${td} TD`);
  }
  return out.join(', ');
}

// Madden's four weekly awards: AFC/NFC Offense and AFC/NFC Defense. confOf(teamId) -> 'AFC' | 'NFC' | null.
// Used when the EA export doesn't carry the awards themselves: the best performer per slot from that week's stats.
function conferenceAwards(performances, confOf) {
  const out = [];
  for (const side of ['Offense', 'Defense']) for (const conf of ['AFC', 'NFC']) {
    const key = side === 'Offense' ? 'offScore' : 'defScore';
    const pool = performances.filter(p => confOf(p.teamId) === conf && p[key] > 0 && (side === 'Defense' ? p.defScore > p.offScore : p.offScore >= p.defScore));
    const best = pool.sort((a, b) => b[key] - a[key])[0];
    if (best) out.push({ category: `${conf} ${side}`, name: best.name, pos: best.pos, team: best.team, teamId: best.teamId, statLine: best.statLine, source: 'stats' });
  }
  return out;
}

// Pick up to `count` standout players whose teams have DIFFERENT Discord owners.
// ownerOf(teamName) -> Discord user id or null (unclaimed teams are skipped).
function selectPlayersOfWeek(performances, ownerOf, count = 4) {
  const used = new Set(), picked = [];
  for (const p of performances) {
    if (picked.length >= count) break;
    const userId = ownerOf(p.team);
    if (!userId || used.has(userId)) continue;
    used.add(userId);
    picked.push({
      userId, name: p.name, team: p.team, score: p.score,
      line: `**${p.name}** (${p.pos ? `${p.pos}, ` : ''}${p.team}) — ${p.summary}`
    });
  }
  return picked;
}

// ---- Franchise Hub style: team lineup (starters) and team compare ----------------------
const LINEUP = [['QB', ['QB'], 1], ['HB', ['HB', 'RB'], 1], ['FB', ['FB'], 1], ['WR', ['WR'], 3], ['TE', ['TE'], 1], ['OL', ['LT', 'LG', 'C', 'RG', 'RT'], 5],
  ['DL', ['LE', 'RE', 'DT', 'DE'], 4], ['LB', ['LOLB', 'MLB', 'ROLB'], 3], ['CB', ['CB'], 3], ['S', ['FS', 'SS'], 2], ['K', ['K'], 1], ['P', ['P'], 1]];
// roster: normalizePlayer[] -> [{ group, players: [top N by ovr] }] (groups with nobody are dropped)
function lineup(roster) {
  return LINEUP.map(([group, positions, n]) => ({ group, players: roster.filter(p => positions.includes(p.pos)).sort((a, b) => b.ovr - a.ovr).slice(0, n) })).filter(g => g.players.length);
}
const avgOvr = ps => (ps.length ? ps.reduce((s, p) => s + p.ovr, 0) / ps.length : 0);
// Head-to-head numbers for two teams. rows: normalizeStandings output; rosters: normalizePlayer[] per team.
function teamCompare(a, b, rows, rosterA, rosterB) {
  const side = (team, roster) => {
    const r = rows.find(x => x.teamId === team.id) || {};
    const lu = lineup(roster), flat = lu.flatMap(g => g.players);
    const unit = names => avgOvr(lu.filter(g => names.includes(g.group)).flatMap(g => g.players));
    return {
      name: team.name, record: r.name ? recordText(r) : '—', pf: r.pf ?? 0, pa: r.pa ?? 0, diff: r.diff ?? 0,
      ovr: team.ovr || r.ovr || Math.round(avgOvr(flat)), offense: unit(['QB', 'HB', 'FB', 'WR', 'TE', 'OL']), defense: unit(['DL', 'LB', 'CB', 'S']),
      best: [...roster].sort((x, y) => y.ovr - x.ovr).slice(0, 3)
    };
  };
  return { a: side(a, rosterA), b: side(b, rosterB) };
}

// ---- Weekly awards (Players of the Week) ----------------------------------------------
// Madden decides the weekly awards itself after each sim. The unofficial EA export doesn't document where
// they live, so this looks for award-shaped fields on player rows and award-shaped entries in the league hub.
// Use `/franchise-debug awards` to see exactly what EA sends; set AWARD_FIELDS=field1,field2 to add fields.
const AWARD_KEY = /player.?of.?the.?week|potw|weekly.?award|week.?award|(offensive|defensive|special.?teams?).?(player|award)|award.?type/i;
const EXTRA_AWARD_KEYS = String(process.env.AWARD_FIELDS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const isAwardKey = k => AWARD_KEY.test(k) || EXTRA_AWARD_KEYS.includes(String(k).toLowerCase());
const truthyAward = v => (Array.isArray(v) ? v.length > 0 : v && typeof v === 'object' ? Object.keys(v).length > 0 : typeof v === 'string' ? v !== '' && v !== '0' : Boolean(v));
function awardFields(p) {
  const out = {};
  for (const [k, v] of Object.entries(p || {})) if (isAwardKey(k) && truthyAward(v)) out[k] = v;
  return Object.keys(out).length ? out : undefined;
}
const OFF_POS = /^(QB|HB|RB|FB|WR|TE|LT|LG|C|RG|RT|OL)$/, DEF_POS = /^(LE|RE|DT|DE|DL|LOLB|MLB|ROLB|LB|CB|FS|SS|S|DB)$/, ST_POS = /^(K|P|KR|PR)$/;
function awardCategory(text, pos = '') {
  const t = String(text || '');
  if (/special|kick|punt|return|\bst\b/i.test(t)) return 'Special Teams';
  if (/defens/i.test(t)) return 'Defensive';
  if (/offens/i.test(t)) return 'Offensive';
  if (ST_POS.test(pos)) return 'Special Teams';
  if (DEF_POS.test(pos)) return 'Defensive';
  if (OFF_POS.test(pos)) return 'Offensive';
  return 'Player';
}
// Does this award value belong to `week` (1-based)? Flags/strings count as "this week's"; arrays/objects with a week field must match.
function awardMatchesWeek(v, week) {
  const items = Array.isArray(v) ? v : [v];
  return items.some(it => {
    if (it && typeof it === 'object') {
      const w = pick(it, ['weekIndex', 'week', 'weekNumber']);
      return w === undefined || w === null || Number(w) === week || Number(w) === week - 1;
    }
    return truthyAward(it);
  });
}
// players: normalizePlayer output (with .awards). hub: Mobile_Career_GetLeagueHub payload.
// -> [{ category, name, pos, team, teamId, source }] (one per award, de-duplicated by player+category)
function extractWeeklyAwards({ players = [], hub = null, week }) {
  const found = new Map();
  const add = (category, p, source) => { const key = `${p.id || p.name}|${category}`; if (p.name && !found.has(key)) found.set(key, { category, name: p.name, pos: p.pos || '', team: p.team || '', teamId: p.teamId || 0, source }); };
  for (const p of players) {
    for (const [k, v] of Object.entries(p.awards || {})) if (awardMatchesWeek(v, week)) add(awardCategory(`${k} ${typeof v === 'string' ? v : ''}`, p.pos), p, `player.${k}`);
  }
  if (hub) {
    const byId = new Map(players.map(p => [String(p.id), p]));
    const walk = node => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (!node || typeof node !== 'object') return;
      const label = ['title', 'type', 'description', 'name'].map(k => (typeof node[k] === 'string' ? node[k] : '')).join(' ');
      if (/player.?of.?the.?week|weekly award/i.test(label)) {
        const id = pick(node, ['playerId', 'rosterId', 'presentationId']);
        const hit = id !== undefined ? byId.get(String(id)) : players.find(p => p.name && label.toLowerCase().includes(p.name.toLowerCase()));
        if (hit) add(awardCategory(label, hit.pos), hit, 'hub');
      }
      Object.values(node).forEach(walk);
    };
    walk(hub);
  }
  const order = { Offensive: 0, Defensive: 1, 'Special Teams': 2, Player: 3 };
  return [...found.values()].sort((a, b) => order[a.category] - order[b.category]);
}
// For /franchise-debug awards: every award-looking key in the hub and on players.
function describeAwardData(hub, players) {
  const hubKeys = new Set();
  const walk = (n, p = '') => { if (Array.isArray(n)) return n.slice(0, 50).forEach(x => walk(x, p)); if (n && typeof n === 'object') for (const [k, v] of Object.entries(n)) { if (/award|week.?of|potw/i.test(k)) hubKeys.add(`${p}${k}`); walk(v, `${p}${k}.`); } };
  walk(hub);
  const flagged = (players || []).filter(p => p.awards).slice(0, 5).map(p => `${p.name}: ${JSON.stringify(p.awards).slice(0, 120)}`);
  return { hubKeys: [...hubKeys].slice(0, 25), playersWithAwardFields: (players || []).filter(p => p.awards).length, sample: flagged, weeklyAwardsActive: findDeep(hub || {}, ['isWeeklyAwardsPeriodActive']) };
}

// ---- Playoff picture ----------------------------------------------------------------
// Seeds 1-4 are the four division winners (best record first); seeds 5-7 are the best
// remaining records in the conference ("wild cards"); `bubble` is the next two teams out.
// Tiebreaks are simply record, then point differential (not the full NFL tiebreaker list).
function playoffPicture(rows, spots = 7) {
  const out = {};
  for (const conf of ['AFC', 'NFC']) {
    const inConf = rows.filter(r => r.division && r.division.startsWith(conf));
    const winners = [];
    for (const g of groupStandings(inConf)) winners.push(g.teams[0]);
    winners.sort(byRecord);
    const winnerIds = new Set(winners.map(w => w.teamId));
    const rest = inConf.filter(r => !winnerIds.has(r.teamId)).sort(byRecord);
    const wildCards = rest.slice(0, Math.max(0, spots - winners.length));
    out[conf] = {
      seeds: [...winners, ...wildCards].map((t, n) => ({ seed: n + 1, divisionWinner: n < winners.length, team: t })),
      bubble: rest.slice(wildCards.length, wildCards.length + 2)
    };
  }
  return out;
}

// Everything the /team profile needs, from already-normalized data.
function teamProfile(team, standingsRows, ranked) {
  const row = standingsRows.find(r => r.teamId === team.id);
  if (!row) return null;
  const division = standingsRows.filter(r => r.division && r.division === row.division).sort(byRecord);
  const powerRank = ranked.findIndex(r => r.teamId === team.id) + 1;
  return { row, divisionRank: division.findIndex(r => r.teamId === team.id) + 1, divisionSize: division.length, powerRank: powerRank || null, powerTotal: ranked.length };
}
const ordinal = n => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };

// ---- Ported from Snallabot (bracket.ts / schedule.ts), MIT, see SNALLABOT_LICENSE.md ----
// Playoff weeks as the bot numbers them (EA weekIndex + 1): 19 wild card, 20 divisional, 21 conference, 23 Super Bowl.
const PLAYOFF_ROUNDS = [
  { week: 19, name: 'Wild Card' }, { week: 20, name: 'Divisional' },
  { week: 21, name: 'Conference Championship' }, { week: 23, name: 'Super Bowl' }
];
// Projected wild-card round from the current seeds: 2v7, 3v6, 4v5, seed 1 has a bye.
function projectedWildCard(pic) {
  const out = {};
  for (const conf of ['AFC', 'NFC']) {
    const s = (pic[conf] && pic[conf].seeds) || [];
    const at = n => s.find(x => x.seed === n);
    out[conf] = { bye: at(1) || null, games: [[2, 7], [3, 6], [4, 5]].map(([h, a]) => ({ home: at(h) || null, away: at(a) || null })).filter(g => g.home && g.away) };
  }
  return out;
}
// Season log for one team across already-normalized games grouped by week: { [week]: games[] }.
function teamSeasonLog(teamId, gamesByWeek) {
  const rows = [];
  for (const week of Object.keys(gamesByWeek).map(Number).sort((a, b) => a - b)) {
    const g = (gamesByWeek[week] || []).find(x => x.awayId === teamId || x.homeId === teamId);
    if (!g) { rows.push({ week, bye: true }); continue; }
    const home = g.homeId === teamId;
    const opp = home ? g.away : g.home;
    const my = home ? g.homeScore : g.awayScore, their = home ? g.awayScore : g.homeScore;
    rows.push({ week, home, opp, final: g.final, my, their, result: !g.final ? null : my > their ? 'W' : my < their ? 'L' : 'T' });
  }
  return rows;
}
const seasonLogLine = r => r.bye ? `Wk ${String(r.week).padStart(2)}  BYE`
  : `Wk ${String(r.week).padStart(2)}  ${r.home ? 'vs' : '@ '} ${r.opp.slice(0, 14).padEnd(14)} ${r.final ? `${r.result} ${r.my}-${r.their}` : '—'}`;

// ---- Ideas from Franchise Hub (franchisehub.gg): /stat-leaders, /compare, /schedule-difficulty ----
// Season leaders: sums each player's weekly rows. Rows are merged by teamId + player id/name.
function seasonLeaders(statsList, category, byId, limit = 10) {
  const cat = LEADER_CATEGORIES[category];
  if (!cat) return [];
  const merged = new Map();
  for (const stats of statsList || []) {
    for (const r of (stats && stats[cat.list]) || []) {
      const name = playerName(r);
      if (!name) continue;
      const teamId = num(pick(r, ['teamId']));
      const key = `${teamId}|${pick(r, ['playerId', 'rosterId'], name)}`;
      const e = merged.get(key) || { name, team: (byId[teamId] && byId[teamId].name) || '', value: 0, games: 0 };
      e.value += num(pick(r, cat.value)); e.games += 1;
      merged.set(key, e);
    }
  }
  return [...merged.values()].filter(e => e.value > 0).sort((a, b) => b.value - a.value).slice(0, limit);
}

// Side-by-side rows for two normalized players. Winner per row: 'a' | 'b' | null (tie).
function comparePlayers(a, b, devOpts = true) {
  const cmp = (x, y) => (x === y || x == null || y == null ? null : x > y ? 'a' : 'b');
  const rows = [
    { label: 'Overall', a: a.ovr, b: b.ovr, win: cmp(a.ovr, b.ovr) },
    { label: 'Age', a: a.age || '—', b: b.age || '—', win: a.age && b.age && a.age !== b.age ? (a.age < b.age ? 'a' : 'b') : null },
    { label: 'Dev', a: devShown(a, devOpts) || '—', b: devShown(b, devOpts) || '—', win: null }
  ];
  const shared = Object.keys(a.ratings || {}).filter(k => k in (b.ratings || {}));
  shared.sort((x, y) => Math.abs(b.ratings[y] - a.ratings[y]) - Math.abs(b.ratings[x] - a.ratings[x]) || Math.max(b.ratings[y], a.ratings[y]) - Math.max(b.ratings[x], a.ratings[x]));
  for (const k of shared.slice(0, 6)) rows.push({ label: k, a: a.ratings[k], b: b.ratings[k], win: cmp(a.ratings[k], b.ratings[k]) });
  return rows;
}

// Strength of schedule for one team: average win% of opponents, split into played and remaining.
// gamesByWeek: { [week]: normalizedGames[] }, standingsRows: normalizeStandings output.
function scheduleDifficulty(teamId, gamesByWeek, standingsRows) {
  const pct = Object.fromEntries(standingsRows.map(r => [r.teamId, r.winPct]));
  const ovr = Object.fromEntries(standingsRows.map(r => [r.teamId, r.ovr]));
  const out = { played: [], remaining: [] };
  for (const week of Object.keys(gamesByWeek).map(Number).sort((a, b) => a - b)) {
    const g = (gamesByWeek[week] || []).find(x => x.awayId === teamId || x.homeId === teamId);
    if (!g) continue;
    const home = g.homeId === teamId, oppId = home ? g.awayId : g.homeId;
    (g.final ? out.played : out.remaining).push({ week, home, oppId, opp: home ? g.away : g.home, winPct: pct[oppId] || 0, ovr: ovr[oppId] || 0 });
  }
  const avg = (rows, k) => (rows.length ? rows.reduce((s, r) => s + r[k], 0) / rows.length : null);
  return { ...out, remainingWinPct: avg(out.remaining, 'winPct'), remainingOvr: avg(out.remaining, 'ovr'), playedWinPct: avg(out.played, 'winPct') };
}

module.exports = {
  LINEUP, lineup, teamCompare,
  extractWeeklyAwards, describeAwardData, awardCategory, awardFields,
  seasonLeaders, comparePlayers, scheduleDifficulty,
  PLAYOFF_ROUNDS, projectedWildCard, teamSeasonLog, seasonLogLine,
  playoffPicture, teamProfile, ordinal, isHiddenDev, devShown, devEmoji,
  NFL, DIVISION_OF, DIVISION_ORDER, DEV_LABELS, LEADER_CATEGORIES,
  pick, num, clip, slug, bar, findDeep, currentWeekFromHub,
  normalizeTeams, teamsById, divisionOf, normalizeStandings, groupStandings, recordText, signed, byRecord, powerRankings,
  isFinalGame, normalizeGames, gameLine, playerName, devLabel, labelFromKey, normalizePlayer, topRatings, matchesPosition,
  weeklyLeaders, playerPerformances, selectPlayersOfWeek, conferenceAwards, maddenLine
};
