const test = require('node:test'), assert = require('node:assert');
const T = require('../tradeLogic');

const base = () => ({
  id: 't1', submittedBy: 'sub', requiredApprovals: 2, status: 'PENDING', votes: {},
  teamA: { id: 1, name: 'Cowboys', receives: [{ type: 'PLAYER', name: 'Star Guy', pos: 'WR', ovr: 90, age: 25, dev: 'Superstar', yearsPro: 3 }] },
  teamB: { id: 2, name: 'Giants', receives: [{ type: 'PICK', label: '2027 1st-Round Pick' }, { type: 'PLAYER', name: 'Rook', pos: 'QB', ovr: 75, age: 21, dev: 'X-Factor', yearsPro: 0 }] }
});

test('trade passes at the required approvals and fails at the same number of rejections', () => {
  let r = T.applyVote(base(), 'a', 'APPROVE');
  assert.strictEqual(r.trade.status, 'PENDING');
  r = T.applyVote(r.trade, 'b', 'APPROVE');
  assert.strictEqual(r.trade.status, 'APPROVED');
  let f = T.applyVote(base(), 'a', 'REJECT'); f = T.applyVote(f.trade, 'b', 'REJECT');
  assert.strictEqual(f.trade.status, 'REJECTED');
});

test('a voter can change their vote; votes are not double counted', () => {
  let r = T.applyVote(base(), 'a', 'APPROVE');
  r = T.applyVote(r.trade, 'a', 'REJECT');
  assert.strictEqual(T.countVotes(r.trade.votes, 'APPROVE'), 0);
  assert.strictEqual(T.countVotes(r.trade.votes, 'REJECT'), 1);
});

test('submitter cannot vote, finished trades are locked, input is not mutated', () => {
  const t = base();
  assert.match(T.applyVote(t, 'sub', 'APPROVE').error, /own trade/);
  const done = T.applyVote(T.applyVote(t, 'a', 'APPROVE').trade, 'b', 'APPROVE').trade;
  assert.match(T.applyVote(done, 'c', 'REJECT').error, /already approved/);
  assert.deepStrictEqual(t.votes, {});
  assert.ok(T.applyVote(null, 'a', 'APPROVE').error);
  assert.ok(T.applyVote(t, 'a', 'MAYBE').error);
});

test('trade text: both sides, hidden rookie dev, coaches, votes and status', () => {
  const t = T.applyVote(base(), 'a', 'APPROVE').trade;
  const text = T.tradeText(t, 'ROLE', { coachOf: n => (n === 'Cowboys' ? 'c1' : null) });
  assert.match(text, /# Trade Submission/);
  assert.match(text, /## Cowboys Receives\n\n> 🌟 \*\*WR Star Guy\*\* — 90 OVR \| Age 25/);
  assert.match(text, /> \*\*2027 1st-Round Pick\*\*/);
  assert.match(text, /> ❔ \*\*QB Rook\*\*/); // 0-years-pro X-Factor is hidden
  assert.match(text, /\*\*Coaches:\*\* <@c1>/);
  assert.match(text, /<@&ROLE> votes:\*\* ✅ 1 Approve \| ❌ 0 Reject/);
  assert.match(text, /✅ \*\*Approved:\*\* <@a>/);
  assert.match(text, /Status:\*\* ⏳ PENDING/);
  assert.match(T.tradeText(t, 'ROLE', { hiddenDevs: false }), /🔥 \*\*QB Rook\*\*/);
});

test('pick labels: three drafts x seven rounds, filterable, capped at 25', () => {
  assert.strictEqual(T.pickLabels(2027, '', 100).length, 21);
  assert.deepStrictEqual(T.pickLabels(2027, '2028 3rd'), ['2028 3rd-Round Pick']);
  assert.strictEqual(T.pickLabels(2027, '', 25).length, 21);
  assert.deepStrictEqual(T.pickLabels(2027, '', 2), ['2027 1st-Round Pick', '2027 2nd-Round Pick']);
  assert.strictEqual(T.roundWord(7), '7th');
});
