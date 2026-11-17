const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { createFranchiseApiServer } = require('../franchise-api');

async function withServer(run, options) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fdl-franchise-api-'));
  const connectionFile = path.join(dir, 'ea-connection.json');
  fs.writeFileSync(connectionFile, JSON.stringify({ leagueId: 456, refreshToken: 'test-token', leagueName: 'Test League' }));
  const server = createFranchiseApiServer({ connectionFile, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try { await run(`http://127.0.0.1:${address.port}`); }
  finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function request(url, method = 'GET', headers = {}) {
  return new Promise((resolve, reject) => {
    http.request(url, { method, headers }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString() }));
    }).on('error', reject).end();
  });
}

test('health reports connection presence without returning credentials', async () => {
  await withServer(async base => {
    const result = await request(`${base}/health`);
    assert.equal(result.status, 200);
    assert.deepEqual(JSON.parse(result.body), { ok: true, connected: true });
    assert.equal(result.body.includes('test-token'), false);
  }, { connector: {} });
});

test('standings return connector data and do not leak refresh token', async () => {
  await withServer(async base => {
    const result = await request(`${base}/api/standings`);
    assert.equal(result.status, 200);
    const body = JSON.parse(result.body);
    assert.deepEqual(body.data, [{ teamId: 3, wins: 9 }]);
    assert.equal(result.body.includes('test-token'), false);
  }, { connector: { getStandings: async connection => {
    assert.equal(connection.leagueId, 456);
    return [{ teamId: 3, wins: 9 }];
  } } });
});

test('invalid query and non-GET requests are rejected', async () => {
  await withServer(async base => {
    assert.equal((await request(`${base}/api/schedule?week=nope`)).status, 400);
    assert.equal((await request(`${base}/api/standings`, 'POST')).status, 405);
  }, { connector: {} });
});

test('CORS only reflects configured origins', async () => {
  await withServer(async base => {
    const allowed = await request(`${base}/health`, 'GET', { origin: 'https://league.example' });
    const denied = await request(`${base}/health`, 'GET', { origin: 'https://other.example' });
    assert.equal(allowed.headers['access-control-allow-origin'], 'https://league.example');
    assert.equal(denied.headers['access-control-allow-origin'], undefined);
  }, { connector: {}, origins: 'https://league.example' });
});
