const test = require('node:test'), assert = require('node:assert');
const R = require('../recapLogic');
const stats = {
  passing: [{ fullName: 'Dak P', teamId: 1, passComp: 22, passAtt: 30, passYds: 300, passTDs: 3, passInts: 1 }, { fullName: 'Jayden D', teamId: 2, passComp: 15, passAtt: 28, passYds: 150, passTDs: 0, passInts: 2 }],
  rushing: [{ fullName: 'Rico D', teamId: 1, rushAtt: 20, rushYds: 110, rushTDs: 1 }],
  receiving: [{ fullName: 'CeeDee L', teamId: 1, recCatches: 9, recYds: 150, recTDs: 2 }],
  defense: [{ fullName: 'Micah P', teamId: 1, defTotalTackles: 7, defSacks: 2 }]
};
const game = { awayId: 1, homeId: 2, away: 'Cowboys', home: 'Commanders', awayScore: 31, homeScore: 10, final: true };

test('top performers per team', () => {
  const t = R.topPerformers(stats, 1);
  assert.deepStrictEqual(t.map(p => p.kind), ['pass', 'rush', 'rec', 'def']);
  assert.match(t[0].text, /22\/30, 300 YDS, 3 TD, 1 INT/);
  assert.strictEqual(R.topPerformers(stats, 2).length, 1);
});
test('story: verb by margin, star, loser line, record', () => {
  const s = R.gameStory({ game, topWinner: R.topPerformers(stats, 1), topLoser: R.topPerformers(stats, 2), records: { 1: '3-0' } });
  assert.match(s, /^Cowboys handled Commanders, 31-10 on the road\./);
  assert.match(s, /CeeDee L led the way|Dak P led the way/);
  assert.match(s, /Jayden D had 15\/28, 150 YDS, 0 TD, 2 INT for Commanders in the loss\./);
  assert.match(s, /Cowboys improve to 3-0\./);
  assert.match(R.gameStory({ game: { ...game, awayScore: 20, homeScore: 21 } }), /^Commanders edged Cowboys, 21-20 at home\./);
  assert.match(R.gameStory({ game: { ...game, awayScore: 7, homeScore: 7 } }), /tie/);
  assert.strictEqual(R.gameStory({ game: { ...game, final: false } }), '');
});
test('recap card bolds the winner and lists performers for both teams', () => {
  const c = R.recapCard({ game, stats, records: { 1: '3-0', 2: '0-3' }, season: 2026, weekLabel: 'Week 3' });
  assert.strictEqual(c.title, 'FINAL • 2026 Week 3');
  assert.match(c.description, /^\*\*Cowboys \(3-0\) 31\*\*\nCommanders \(0-3\) 10/);
  assert.deepStrictEqual(c.fields.map(f => f.name), ['Cowboys', 'Commanders']);
});
test('matchup lines only for unplayed games', () => {
  const l = R.matchupLines([{ awayId: 1, homeId: 2, away: 'A', home: 'B', final: false }, { ...game }], { 1: '1-0' }, { 2: 80 });
  assert.deepStrictEqual(l, ['**A (1-0)** at **B • 80 OVR**']);
});
