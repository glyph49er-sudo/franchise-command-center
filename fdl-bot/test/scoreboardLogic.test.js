const test = require('node:test'), assert = require('node:assert');
const S = require('../scoreboardLogic');

const games = [
  { scheduleId: 2, awayId: 3, homeId: 4, away: 'Eagles', home: 'Giants', awayScore: 17, homeScore: 24, final: true },
  { scheduleId: 1, awayId: 1, homeId: 2, away: 'Cowboys', home: 'Commanders', awayScore: 31, homeScore: 10, final: true },
  { scheduleId: 3, awayId: 5, homeId: 6, away: 'Jets', home: 'Bills', awayScore: 0, homeScore: 0, final: false },
  { scheduleId: 4, awayId: 7, homeId: 8, away: 'Bears', home: 'Lions', awayScore: 20, homeScore: 20, final: true }
];

test('scoreboard matches the Snallabot layout: header, bold winner, records, sims, unplayed', () => {
  const t = S.scoreboardText({ season: 2026, week: 3, games, records: { 1: '3-0', 2: '1-2' }, sims: [{ week: 3, awayId: 5, homeId: 6, result: 'FORCE_WIN_HOME' }], emoji: n => (n === 'Cowboys' ? '<:dal:1>' : '') });
  const lines = t.split('\n');
  assert.strictEqual(lines[0], '# 2026 Season Week 3 Games');
  assert.strictEqual(lines[1], '**<:dal:1> Cowboys (3-0) 31** vs 10 Commanders (1-2)');   // scheduleId 1 first, away winner bold
  assert.strictEqual(lines[2], 'Eagles 17 vs **24 Giants**');                              // home winner bold
  assert.match(lines[3], /^Jets 0 vs 0 Bills \(Force Win Home\)$/);                        // sim shows
  assert.strictEqual(lines[4], 'Bears 20 vs 20 Lions');                                    // tie: no bold
  assert.strictEqual(S.scoreboardText({ season: 2026, week: 19, games: [] }).split('\n')[0], '# 2026 Season Wild Card Games');
  assert.match(S.scoreboardText({ season: 2026, week: 3, games: [] }), /No games found/);
});

test('unplayed game is plain "A vs H"', () => {
  const t = S.scoreboardText({ season: 2026, week: 1, games: [games[2]] });
  assert.strictEqual(t.split('\n')[1], 'Jets vs Bills');
});

test('box score buttons: one per finished game, labelled with the winner', () => {
  const b = S.boxButtons(games, 3);
  assert.deepStrictEqual(b.map(x => x.label), ['Cowboys box score', 'Giants box score', 'Bears/Lions box score']);
  assert.strictEqual(b[0].customId, 'box:3:1:2');
  assert.strictEqual(S.winnerOf(games[0]).name, 'Giants');
  assert.strictEqual(S.winnerOf(games[3]), null);
});

test('box score lists every player for both teams with totals', () => {
  const stats = {
    passing: [{ fullName: 'Dak Prescott', teamId: 1, passComp: 22, passAtt: 30, passYds: 300, passTDs: 3, passInts: 1 }, { fullName: 'Jayden Daniels', teamId: 2, passComp: 10, passAtt: 20, passYds: 90, passTDs: 0, passInts: 2 }],
    rushing: [{ fullName: 'Rico Dowdle', teamId: 1, rushAtt: 20, rushYds: 110, rushTDs: 1 }],
    receiving: [{ fullName: 'CeeDee Lamb', teamId: 1, recCatches: 9, recYds: 150, recTDs: 2 }],
    defense: [{ fullName: 'Micah Parsons', teamId: 1, defTotalTackles: 7, defSacks: 2, defInts: 0, defForcedFum: 1 }, { fullName: 'Other Guy', teamId: 2, defTotalTackles: 0 }]
  };
  const box = S.boxScore({ game: games[1], stats, season: 2026, week: 3 });
  assert.match(box.header, /Week 3 — Cowboys 31 @ Commanders 10/);
  const [away, home] = box.teams;
  assert.match(away.title, /🏆 Cowboys — 31/);
  assert.match(away.description, /Total yards:\*\* 410 \(300 pass, 110 rush\)/);
  assert.deepStrictEqual(away.fields.map(f => f.name), ['Passing', 'Rushing', 'Receiving', 'Defense']);
  assert.match(away.fields[0].value, /Dak Prescott\s+22\/30\s+300\s+3\s+1/);
  assert.match(away.fields[3].value, /Micah Parsons\s+7\s+2\s+0\s+1/);
  assert.match(home.description, /Turnovers:\*\* 2/);
  assert.ok(!home.title.includes('🏆'));
  assert.ok(!home.fields.some(f => f.name === 'Defense')); // zero-stat defender filtered
  const empty = S.boxScore({ game: games[1], stats: {}, season: 2026, week: 3 });
  assert.match(empty.teams[0].description, /No player stats available/);
});
