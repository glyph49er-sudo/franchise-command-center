const test = require('node:test'); const assert = require('node:assert');
const N = require('../newswireLogic');
test('diffMoves finds signings, releases, trades and ignores low ovr', () => {
  const prev = { a: { n: 'A', pos: 'QB', ovr: 80, team: 'Free Agent' }, b: { n: 'B', pos: 'WR', ovr: 80, team: 'Bears' }, c: { n: 'C', pos: 'TE', ovr: 80, team: 'Bears' }, d: { n: 'D', pos: 'K', ovr: 60, team: 'Free Agent' } };
  const curr = { a: { ...prev.a, team: 'Cowboys' }, b: { ...prev.b, team: 'Free Agent' }, c: { ...prev.c, team: 'Jets' }, d: { ...prev.d, team: 'Jets' } };
  const m = N.diffMoves(prev, curr, 75);
  assert.deepStrictEqual(m.map(x => x.kind), ['signing', 'release', 'trade']);
});
test('streaks and headlines', () => {
  const g = (aw, hm, as, hs) => ({ awayId: aw, homeId: hm, away: 'T' + aw, home: 'T' + hm, awayScore: as, homeScore: hs, final: true });
  const s = N.streaks([{ games: [g(1, 2, 10, 3)] }, { games: [g(1, 3, 7, 0)] }, { games: [g(4, 1, 0, 9)] }]);
  assert.strictEqual(s[1].n, 3); assert.strictEqual(s[2].n, -1);
  assert.ok(N.streakHeadline('T1', 3).includes('3')); assert.strictEqual(N.streakHeadline('T1', 2), null);
});
test('upset needs a rating gap', () => {
  const g = { final: true, awayId: 1, homeId: 2, away: 'A', home: 'H', awayScore: 17, homeScore: 10 };
  assert.ok(N.upset(g, { 1: 70, 2: 80 }).includes('UPSET')); assert.strictEqual(N.upset(g, { 1: 78, 2: 80 }), null);
});
