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
      awayId, homeId,
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
    teamId, team: byId[teamId]?.name || (teamId ? `Team ${teamId}` : 'Free Agent'),
    portraitId: pick(p, ['portraitId']),
    ratings
  };
}
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
    out.push({ name: e.name, team: e.team, pos: e.pos, score, summary: parts.join(' • ') });
  }
  return out.sort((a, b) => b.score - a.score);
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

module.exports = {
  NFL, DIVISION_OF, DIVISION_ORDER, DEV_LABELS, LEADER_CATEGORIES,
  pick, num, clip, slug, bar, findDeep, currentWeekFromHub,
  normalizeTeams, teamsById, divisionOf, normalizeStandings, groupStandings, recordText, signed, byRecord, powerRankings,
  isFinalGame, normalizeGames, gameLine, playerName, devLabel, labelFromKey, normalizePlayer, topRatings, matchesPosition,
  weeklyLeaders, playerPerformances, selectPlayersOfWeek
};
