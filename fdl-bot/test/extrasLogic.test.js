const test = require('node:test'), assert = require('node:assert');
const X = require('../extrasLogic');

test('stream board sorts by count and drops zeros', () => {
  let c = X.bumpStream({}, 'a', 1); c = X.bumpStream(c, 'b', 3); c = X.bumpStream(c, 'a', 1);
  assert.strictEqual(X.streamBoard(c), '# Stream Counts\n**1.** <@b> — 3\n**2.** <@a> — 2');
  assert.deepStrictEqual(X.bumpStream({ a: 1 }, 'a', -5), {});
  assert.match(X.streamBoard({}), /No streams counted/);
});
test('transcript is oldest-first, chunked under the limit, attachments kept', () => {
  const msgs = [{ author: 'A', content: 'hi', createdAt: Date.UTC(2026, 0, 2, 3, 4) }, { author: 'B', content: '', createdAt: 0, attachments: ['http://x/y.png'] }, { author: 'C', content: 'z'.repeat(50), createdAt: 0 }];
  const t = X.transcript(msgs, 80);
  assert.strictEqual(t[0].split('\n')[0], '[2026-01-02 03:04] A: hi');
  assert.ok(t.every(c => c.length <= 80));
  assert.ok(t.join('\n').includes('http://x/y.png'));
  assert.deepStrictEqual(X.transcript([]), []);
});
test('youtube / twitch input parsing and keyword filter', () => {
  assert.deepStrictEqual(X.parseYoutubeChannel('https://youtube.com/channel/UCabcdefghijklmnopqrstuv'), { id: 'UCabcdefghijklmnopqrstuv' });
  assert.deepStrictEqual(X.parseYoutubeChannel('https://www.youtube.com/@FDLMadden'), { handle: 'FDLMadden' });
  assert.strictEqual(X.parseYoutubeChannel('nope'), null);
  assert.strictEqual(X.parseTwitchLogin('https://twitch.tv/SomeUser?x=1'), 'someuser');
  assert.strictEqual(X.parseTwitchLogin('a'), null);
  assert.strictEqual(X.matchesKeyword('FDL Week 3 stream', 'fdl'), true);
  assert.strictEqual(X.matchesKeyword('random', 'fdl'), false);
  assert.strictEqual(X.matchesKeyword('anything', ''), true);
});
