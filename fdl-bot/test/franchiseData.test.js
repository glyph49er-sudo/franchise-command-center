const test = require('node:test'), assert = require('node:assert');
const D = require('../franchiseData');

const rawTeams = [
  { teamId: 1, displayName: 'Cowboys', abbrName: 'DAL', userName: 'DakFan', ovrRating: 84 },
  { teamId: 2, displayName: 'Giants', abbrName: 'NYG', userName: 'BigBlue', ovrRating: 78 },
  { teamId: 3, displayName: 'Eagles', abbrName: 'PHI', userName: 'Birds', ovrRating: 82 },
  { teamId: 4, displayName: 'Commanders', abbrName: 'WAS', userName: '', ovrRating: 70 },
  { teamId: 5, displayName: 'Chiefs', abbrName: 'KC', userName: 'Pat', ovrRating: 90 },
  { teamId: 6, displayName: '49ers', abbrName: 'SF', userName: 'Gold', ovrRating: 88 }
];
const teams = D.normalizeTeams(rawTeams);
const byId = D.teamsById(teams);

test('all 32 NFL teams have a division and every division has 4 teams', () => {
  assert.strictEqual(D.NFL.length, 32);
  const counts = {};
  for (const [, , div] of D.NFL) counts[div] = (counts[div] || 0) + 1;
  assert.deepStrictEqual(Object.keys(counts).sort(), [...D.DIVISION_ORDER].sort());
  for (const n of Object.values(counts)) assert.strictEqual(n, 4);
});

test('standings group by division, sorted by record then point differential', () => {
  const raw = [
    { teamId: 1, totalWins: 8, totalLosses: 3, totalTies: 0, ptsFor: 300, ptsAgainst: 250 },
    { teamId: 2, totalWins: 4, totalLosses: 7, totalTies: 0, ptsFor: 200, ptsAgainst: 260 },
    { teamId: 3, totalWins: 8, totalLosses: 3, totalTies: 0, ptsFor: 310, ptsAgainst: 240 },
    { teamId: 4, totalWins: 2, totalLosses: 9, totalTies: 0, ptsFor: 150, ptsAgainst: 330 },
    { teamId: 5, totalWins: 10, totalLosses: 1, totalTies: 0, ptsFor: 330, ptsAgainst: 200 }
  ];
  const rows = D.normalizeStandings(raw, teams);
  const groups = D.groupStandings(rows);
  assert.deepStrictEqual(groups.map(g => g.division), ['AFC West', 'NFC East']);
  const nfcEast = groups[1].teams.map(t => t.name);
  assert.deepStrictEqual(nfcEast, ['Eagles', 'Cowboys', 'Giants', 'Commanders']); // Eagles beat Cowboys on diff
  assert.deepStrictEqual(D.groupStandings(rows, 'AFC').map(g => g.division), ['AFC West']);
  assert.strictEqual(D.recordText(rows[0]), '8-3');
  assert.strictEqual(rows[0].diff, 50);
});

test('power rankings: record/differential/OVR, and OVR-only before any games', () => {
  const rows = D.normalizeStandings([
    { teamId: 1, totalWins: 9, totalLosses: 2, ptsFor: 320, ptsAgainst: 200 },
    { teamId: 5, totalWins: 3, totalLosses: 8, ptsFor: 180, ptsAgainst: 300 },
    { teamId: 6, totalWins: 6, totalLosses: 5, ptsFor: 250, ptsAgainst: 240 }
  ], teams);
  const ranked = D.powerRankings(rows).map(r => r.name);
  assert.deepStrictEqual(ranked, ['Cowboys', '49ers', 'Chiefs']);
  const preseason = D.normalizeStandings([{ teamId: 1 }, { teamId: 5 }, { teamId: 2 }], teams);
  assert.deepStrictEqual(D.powerRankings(preseason).map(r => r.name), ['Chiefs', 'Cowboys', 'Giants']);
});

test('games: final detection and team names', () => {
  const games = D.normalizeGames([
    { awayTeamId: 2, homeTeamId: 1, awayScore: 17, homeScore: 24, status: 3, weekIndex: 4 },
    { awayTeamId: 3, homeTeamId: 4, awayScore: 0, homeScore: 0, status: 1, weekIndex: 4 }
  ], teams);
  assert.strictEqual(games[0].final, true);
  assert.strictEqual(games[1].final, false);
  assert.strictEqual(games[0].week, 5);
  assert.strictEqual(D.gameLine(games[0]), '**Giants** 17 @ 24 **Cowboys** ✅');
  assert.strictEqual(D.gameLine(games[1]), '**Eagles** @ **Commanders**');
});

test('players: dev trait labels, rating extraction, position groups', () => {
  const p = D.normalizePlayer({
    firstName: 'Micah', lastName: 'Parsons', position: 'LOLB', playerBestOvr: 96, teamId: 1, age: 27, jerseyNum: 11,
    devTrait: 3, speedRating: 88, strengthRating: 85, powerMovesRating: 95, overallRating: 96, awareRating: 80, notARating: 'x'
  }, byId);
  assert.strictEqual(p.name, 'Micah Parsons');
  assert.strictEqual(p.ovr, 96);
  assert.strictEqual(p.dev, 'X-Factor');
  assert.strictEqual(p.team, 'Cowboys');
  assert.deepStrictEqual(p.ratings, { Speed: 88, Strength: 85, 'Power Moves': 95, Aware: 80 }); // overall excluded
  assert.deepStrictEqual(D.topRatings(p, 2), [['Power Moves', 95], ['Speed', 88]]);
  assert.strictEqual(D.devLabel('XFactor'), 'X-Factor');
  assert.strictEqual(D.devLabel(undefined), null);
  assert.ok(D.matchesPosition('FS', 'DB') && D.matchesPosition('LT', 'OL') && D.matchesPosition('HB', 'RB'));
  assert.ok(!D.matchesPosition('QB', 'DB') && D.matchesPosition('QB', ''));
});

test('weekly leaders sort by the category and skip zeros', () => {
  const stats = {
    passing: [{ fullName: 'A QB', teamId: 1, passYds: 250, passTDs: 2, passInts: 1, passComp: 20, passAtt: 30 },
              { fullName: 'B QB', teamId: 2, passYds: 310, passTDs: 3, passInts: 0, passComp: 25, passAtt: 33 }],
    defense: [{ fullName: 'C DE', teamId: 3, defSacks: 0, defTotalTackles: 5 }, { fullName: 'D DE', teamId: 5, defSacks: 2.5, defTotalTackles: 6 }]
  };
  const pass = D.weeklyLeaders(stats, 'passing', byId);
  assert.deepStrictEqual(pass.map(r => r.name), ['B QB', 'A QB']);
  assert.strictEqual(pass[0].detail, '25/33, 3 TD, 0 INT');
  assert.deepStrictEqual(D.weeklyLeaders(stats, 'sacks', byId).map(r => r.name), ['D DE']);
  assert.deepStrictEqual(D.weeklyLeaders(stats, 'nope', byId), []);
});

test('Players of the Week: best player per DIFFERENT owner, unclaimed teams skipped', () => {
  const stats = {
    passing: [{ fullName: 'Dak', teamId: 1, passYds: 400, passTDs: 4, passInts: 0 }],
    rushing: [{ fullName: 'Dak', teamId: 1, rushYds: 30, rushTDs: 1 }, { fullName: 'Saquon', teamId: 3, rushYds: 180, rushTDs: 2 }],
    receiving: [{ fullName: 'CeeDee', teamId: 1, recYds: 150, recTDs: 1, recCatches: 9 }, { fullName: 'Nobody', teamId: 4, recYds: 300, recTDs: 3, recCatches: 12 }],
    defense: [{ fullName: 'Micah', teamId: 6, defSacks: 3, defTotalTackles: 7, defForcedFum: 1 }, { fullName: 'Chris', teamId: 5, defInts: 2, defTotalTackles: 4 }]
  };
  const perf = D.playerPerformances(stats, byId);
  assert.strictEqual(perf.find(p => p.name === 'Dak').summary, '400 PASS YDS, 4 TD • 30 RUSH YDS, 1 TD'); // merged QB line
  const owners = { Cowboys: 'u1', Eagles: 'u2', '49ers': 'u3', Chiefs: 'u1' }; // Commanders unclaimed; u1 owns two teams
  const picked = D.selectPlayersOfWeek(perf, name => owners[name] || null, 4);
  assert.ok(picked.length >= 3 && picked.length <= 4);
  assert.strictEqual(new Set(picked.map(p => p.userId)).size, picked.length, 'recipients are distinct');
  assert.ok(!picked.some(p => p.name === 'Nobody'), 'unclaimed team skipped');
  assert.ok(picked.every(p => p.line.includes(p.name) && p.line.includes(p.team)));
});

test('findDeep / current week from the league hub', () => {
  assert.deepStrictEqual(D.currentWeekFromHub({ a: { b: { weekIndex: 4 } }, seasonInfo: { seasonIndex: 2 } }), { week: 5, season: 2 });
  assert.deepStrictEqual(D.currentWeekFromHub({ currentWeek: '9' }), { week: 9, season: null });
  assert.deepStrictEqual(D.currentWeekFromHub({ nothing: 'here' }), { week: null, season: null });
});

test('playoff picture: division winners are seeds 1-4, then wild cards, then the bubble', () => {
  // Build a fake 16-team AFC from real division names so divisions line up.
  const afc = D.NFL.filter(([, , d]) => d.startsWith('AFC'));
  const ts = D.normalizeTeams(afc.map(([displayName, abbrName], i) => ({ teamId: 100 + i, displayName, abbrName, ovrRating: 80 })));
  const wins = [11, 5, 4, 3, 10, 9, 2, 1, 8, 7, 6, 5, 9, 4, 3, 2]; // index = team order
  const rows = D.normalizeStandings(ts.map((t, i) => ({ teamId: t.id, totalWins: wins[i], totalLosses: 17 - wins[i], ptsFor: 300 + wins[i], ptsAgainst: 300 })), ts);
  const pic = D.playoffPicture(rows).AFC;
  assert.strictEqual(pic.seeds.length, 7);
  assert.ok(pic.seeds.slice(0, 4).every(s => s.divisionWinner) && pic.seeds.slice(4).every(s => !s.divisionWinner));
  assert.deepStrictEqual(pic.seeds.slice(0, 4).map(s => s.team.name), ['Bills', 'Ravens', 'Broncos', 'Texans']); // 11, 10, 9, 8 wins
  assert.strictEqual(pic.bubble.length, 2);
  assert.deepStrictEqual(D.playoffPicture(rows).NFC.seeds, []); // no NFC teams in this fixture
});

test('team profile: division and power rank', () => {
  const rows = D.normalizeStandings([
    { teamId: 1, totalWins: 8, totalLosses: 3, ptsFor: 300, ptsAgainst: 250 },
    { teamId: 3, totalWins: 9, totalLosses: 2, ptsFor: 310, ptsAgainst: 240 },
    { teamId: 5, totalWins: 10, totalLosses: 1, ptsFor: 330, ptsAgainst: 200 }
  ], teams);
  const prof = D.teamProfile(byId[1], rows, D.powerRankings(rows));
  assert.strictEqual(prof.divisionRank, 2);
  assert.strictEqual(prof.divisionSize, 2);
  assert.strictEqual(prof.powerRank, 3);
  assert.strictEqual(D.teamProfile({ id: 99 }, rows, []), null);
  assert.deepStrictEqual([1, 2, 3, 4, 11, 12, 21, 22].map(D.ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '21st', '22nd']);
});

test('small helpers', () => {
  assert.strictEqual(D.bar(91, 10), '▰▰▰▰▰▰▰▰▰▱');
  assert.strictEqual(D.bar(0, 4), '▱▱▱▱');
  assert.strictEqual(D.slug('San Francisco 49ers!'), 'san-francisco-49ers');
  assert.strictEqual(D.clip('abcdef', 4), 'abc…');
  assert.strictEqual(D.signed(7), '+7');
  assert.strictEqual(D.signed(-3), '-3');
});
