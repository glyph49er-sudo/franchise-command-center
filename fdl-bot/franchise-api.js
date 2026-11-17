'use strict';

// Read-only HTTP bridge for the Franchise Hub. EA credentials remain on the
// bot host; API responses expose franchise exports only. Bind to loopback by
// default and put an authenticated reverse proxy in front of it when remote.
require('dotenv').config();
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const EA = require('./ea-connector');

const CONNECTION_FILE = path.join(__dirname, 'data', 'ea-connection.json');
const MAX_CACHE_MS = 60_000;

function sendJson(res, status, value, extraHeaders = {}) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...extraHeaders,
  });
  res.end(body);
}

function createFranchiseApiServer({ connectionFile = CONNECTION_FILE, connector = EA, origins = process.env.FRANCHISE_API_ORIGINS || '' } = {}) {
  const allowedOrigins = new Set(origins.split(',').map(x => x.trim()).filter(Boolean));
  const cache = new Map();
  const inFlight = new Map();

  function loadConnection() {
    try {
      const connection = JSON.parse(fs.readFileSync(connectionFile, 'utf8'));
      if (!connection?.leagueId || !connection?.refreshToken) return null;
      return connection;
    } catch { return null; }
  }

  function persistConnection(connection) {
    const dir = path.dirname(connectionFile);
    fs.mkdirSync(dir, { recursive: true });
    const temp = `${connectionFile}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(connection, null, 2), { mode: 0o600 });
    fs.renameSync(temp, connectionFile);
    try { fs.chmodSync(connectionFile, 0o600); } catch { /* permissions vary on Windows */ }
  }

  async function getConnection() {
    const connection = loadConnection();
    if (!connection) throw Object.assign(new Error('The EA franchise connection is not configured. Run /ea-connect in Discord first.'), { status: 503 });
    return connection;
  }

  async function route(url) {
    const connection = await getConnection();
    const weekRaw = url.searchParams.get('week');
    const week = weekRaw === null ? 0 : Number(weekRaw);
    if (!Number.isInteger(week) || week < 0 || week > 30) {
      throw Object.assign(new Error('week must be a whole number from 0 to 30.'), { status: 400 });
    }
    const stageRaw = url.searchParams.get('stage');
    const stage = stageRaw === null ? 1 : Number(stageRaw);
    if (!Number.isInteger(stage) || stage < 0 || stage > 10) {
      throw Object.assign(new Error('stage must be a whole number from 0 to 10.'), { status: 400 });
    }

    let data;
    switch (url.pathname) {
      case '/api/teams': data = await connector.getTeams(connection); break;
      case '/api/standings': data = await connector.getStandings(connection); break;
      case '/api/schedule': data = await connector.getSchedule(connection, week, stage); break;
      case '/api/roster': {
        const teamId = Number(url.searchParams.get('teamId'));
        const teamIndex = Number(url.searchParams.get('teamIndex'));
        if (!Number.isSafeInteger(teamId) || teamId <= 0 || !Number.isInteger(teamIndex) || teamIndex < 0 || teamIndex > 32) {
          throw Object.assign(new Error('Provide a valid positive teamId and teamIndex from 0 to 32.'), { status: 400 });
        }
        data = await connector.getTeamRoster(connection, teamId, teamIndex);
        break;
      }
      case '/api/free-agents': data = await connector.getFreeAgents(connection); break;
      case '/api/leaders': data = await connector.getWeeklyStats(connection, week, stage); break;
      case '/api/league-info': data = await connector.getLeagueInfo(connection); break;
      default: throw Object.assign(new Error('Route not found.'), { status: 404 });
    }
    // EA can rotate refresh credentials during an export. Keep the durable
    // connection current without ever returning it in an API response.
    persistConnection(connection);
    return { data, fetchedAt: new Date().toISOString(), league: connection.leagueName || null };
  }

  async function getCached(url) {
    const key = `${url.pathname}?${url.searchParams.toString()}`;
    const previous = cache.get(key);
    if (previous && Date.now() - previous.at < MAX_CACHE_MS) return previous.body;
    if (inFlight.has(key)) return inFlight.get(key);
    const promise = route(url).then(body => {
      cache.set(key, { at: Date.now(), body });
      return body;
    }).finally(() => inFlight.delete(key));
    inFlight.set(key, promise);
    return promise;
  }

  return http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    const cors = origin && allowedOrigins.has(origin)
      ? { 'access-control-allow-origin': origin, vary: 'Origin' }
      : {};
    if (req.method === 'OPTIONS') {
      if (origin && !allowedOrigins.has(origin)) return sendJson(res, 403, { error: 'Origin is not allowed.' });
      res.writeHead(204, { ...cors, 'access-control-allow-methods': 'GET, OPTIONS', 'access-control-allow-headers': 'content-type' });
      return res.end();
    }
    if (req.method !== 'GET') return sendJson(res, 405, { error: 'Only GET requests are supported.' }, { allow: 'GET, OPTIONS', ...cors });
    let url;
    try { url = new URL(req.url, 'http://localhost'); }
    catch { return sendJson(res, 400, { error: 'Invalid request URL.' }, cors); }
    if (url.pathname === '/health') {
      const configured = Boolean(loadConnection());
      return sendJson(res, 200, { ok: true, connected: configured }, cors);
    }
    try {
      const result = await getCached(url);
      return sendJson(res, 200, result, cors);
    } catch (error) {
      const status = Number(error?.status) || 502;
      console.error(`[Franchise API] ${url.pathname}:`, error?.message || error);
      return sendJson(res, status, { error: error?.message || 'Franchise data request failed.' }, cors);
    }
  });
}

if (require.main === module) {
  const port = Number(process.env.FRANCHISE_API_PORT || 8787);
  const host = process.env.FRANCHISE_API_HOST || '127.0.0.1';
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('FRANCHISE_API_PORT must be between 1 and 65535.');
  const server = createFranchiseApiServer();
  server.listen(port, host, () => console.log(`Franchise read API listening on http://${host}:${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
}

module.exports = { createFranchiseApiServer };
