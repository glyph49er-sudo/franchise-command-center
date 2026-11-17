// Madden 27 PC EA Companion App connection.
// Protocol adapted from the MIT-licensed SnallaBot source supplied by the user.
// EA's endpoints are unofficial and can change without notice.
const https = require('node:https');
const { constants, randomBytes, createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const AUTH_SOURCE = 317239;
const CLIENT_ID = 'MCA_27_COMP_APP';
// This is the public Companion App client credential used by the reference implementation.
const CLIENT_SECRET = process.env.EA_CLIENT_SECRET || 'AmVfGJMTkej18iUCKagWGjm06MMPLDAmNklPPgReXy9ENWxEpb4OnOyYORTYRyJcq_20260727062224';
const REDIRECT_URL = 'http://127.0.0.1/success';
const MACHINE_KEY = '444d362e8e067fe2';
const BLAZE_HOST = 'wal2.tools.gos.bio-iad.ea.com';
const BLAZE_ID = 'madden-2027-pc';
const BLAZE_PRODUCT = 'madden-2027-pc-mca';
const USER_AGENT = 'Dalvik/2.1.0 (Linux; U; Android 13; sdk_gphone_x86_64 Build/TE1A.220922.031)';
const EA_LOGIN_URL = `https://accounts.ea.com/connect/auth?hide_create=true&release_type=prod&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT_URL)}&client_id=${CLIENT_ID}&machineProfileKey=${MACHINE_KEY}&authentication_source=${AUTH_SOURCE}`;

const legacyAgent = new https.Agent({
  rejectUnauthorized: false,
  secureOptions: constants.SSL_OP_LEGACY_SERVER_CONNECT
});

function request(url, { method = 'GET', headers = {}, body, legacyTls = false, redirect = false } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    // Match SnallaBot's fetch behavior: POST string bodies are sent with a
    // concrete Content-Length, not Node's default chunked transfer encoding.
    // EA's legacy Blaze gateway can reject chunked request bodies with HTTP 503.
    const requestHeaders = { ...headers };
    const hasContentLength = Object.keys(requestHeaders).some(k => k.toLowerCase() === 'content-length');
    if (body !== undefined && !hasContentLength) {
      requestHeaders['Content-Length'] = Buffer.byteLength(body);
    }
    const options = {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || 443,
      path: `${target.pathname}${target.search}`,
      method,
      headers: requestHeaders,
      ...(legacyTls ? { agent: legacyAgent } : {})
    };
    const req = https.request(options, res => {
      if (redirect && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve({ status: res.statusCode, headers: res.headers, body: '' });
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode || 0,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8')
      }));
    });
    req.setTimeout(30000, () => req.destroy(new Error('EA request timed out')));
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

function parseJson(response, label) {
  // The Madden gateway sometimes returns a non-JSON maintenance/load-balancer
  // page. Report the HTTP status before trying to parse that page as JSON.
  if ([502, 503, 504].includes(response.status)) {
    throw new Error(`${label}: Madden's EA service is temporarily unavailable (HTTP ${response.status}). This is not an EA password error. Wait a few minutes and retry.`);
  }
  let parsed;
  try { parsed = JSON.parse(response.body.replace(/[\u0000-\u001F\u007F-\u009F]/g, '')); }
  catch {
    const contentType = response.headers?.['content-type'] || 'unknown content type';
    throw new Error(`${label}: EA returned a non-JSON response (HTTP ${response.status}, ${contentType}).`);
  }
  if (response.status < 200 || response.status >= 300) {
    const code = parsed?.error || parsed?.error_description || parsed?.errorCode || `HTTP ${response.status}`;
    throw new Error(`${label}: EA rejected the request (${String(code).slice(0, 180)}).`);
  }
  return parsed;
}

async function postForm(url, fields, label) {
  const body = new URLSearchParams(fields).toString();
  const response = await request(url, {
    method: 'POST',
    headers: {
      'Accept-Charset': 'UTF-8',
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Content-Length': Buffer.byteLength(body)
    },
    body
  });
  return parseJson(response, label);
}

function parseLoginCode(raw) {
  const input = String(raw || '').trim();
  if (!input) throw new Error('Paste the full EA redirect URL from your browser.');
  let code = input;
  try {
    const u = new URL(input.includes('://') ? input : `http://127.0.0.1/success?${input.replace(/^\?/, '')}`);
    code = u.searchParams.get('code') || '';
  } catch { code = ''; }
  if (!code || code.length < 8) throw new Error('I could not find an EA login code in that URL. Copy the entire address-bar URL after EA redirects you.');
  return code;
}

async function exchangeInitialCode(rawUrl) {
  const code = parseLoginCode(rawUrl);
  const token = await postForm('https://accounts.ea.com/connect/token', {
    authentication_source: AUTH_SOURCE,
    client_secret: CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URL,
    release_type: 'prod',
    client_id: CLIENT_ID
  }, 'EA login');

  const pidResponse = await request(`https://accounts.ea.com/connect/tokeninfo?access_token=${encodeURIComponent(token.access_token)}`, {
    headers: {
      'Accept-Charset': 'UTF-8',
      'X-Include-Deviceid': 'true',
      'User-Agent': USER_AGENT,
    }
  });
  const pidInfo = parseJson(pidResponse, 'EA account lookup');
  if (!pidInfo.pid_id) throw new Error('EA did not return an account ID for this login.');

  const entitlementResponse = await request(`https://gateway.ea.com/proxy/identity/pids/${encodeURIComponent(pidInfo.pid_id)}/entitlements/?status=ACTIVE`, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept-Charset': 'UTF-8',
      'X-Expand-Results': 'true',
      Authorization: `Bearer ${token.access_token}`
    }
  });
  const entitlementData = parseJson(entitlementResponse, 'Madden entitlement lookup');
  const entitlements = entitlementData?.entitlements?.entitlement || [];
  const pcEntitlements = entitlements.filter(e =>
    (e.entitlementTag === 'ONLINE_ACCESS' || e.entitlementTag === 'TRIAL_ONLINE_ACCESS') && e.groupName === 'MADDEN_27PC'
  );
  if (!pcEntitlements.length) throw new Error('This EA account does not have an active Madden NFL 27 PC entitlement. Make sure you signed into the EA account linked to your PC copy of Madden.');

  const personas = [];
  for (const entitlement of pcEntitlements) {
    const personaResponse = await request(`https://gateway.ea.com/proxy/identity${entitlement.pidUri}/personas?status=ACTIVE&access_token=${encodeURIComponent(token.access_token)}`, {
      headers: {
        'Accept-Charset': 'UTF-8',
        'X-Expand-Results': 'true',
        'User-Agent': USER_AGENT,
        }
    });
    const personaData = parseJson(personaResponse, 'Madden PC persona lookup');
    for (const persona of (personaData?.personas?.persona || [])) {
      if (persona.namespaceName === 'cem_ea_id') personas.push(persona);
    }
  }
  if (!personas.length) throw new Error('EA did not return an active Madden PC persona for this account.');
  return { accessToken: token.access_token, personas };
}

async function getPersonaToken(accessToken, persona) {
  const authUrl = new URL('https://accounts.ea.com/connect/auth');
  Object.entries({
    hide_create: 'true', release_type: 'prod', response_type: 'code',
    redirect_uri: REDIRECT_URL, client_id: CLIENT_ID, machineProfileKey: MACHINE_KEY,
    authentication_source: AUTH_SOURCE, access_token: accessToken,
    persona_id: persona.personaId, persona_namespace: persona.namespaceName
  }).forEach(([k, v]) => authUrl.searchParams.set(k, String(v)));
  const response = await request(authUrl.toString(), {
    redirect: true,
    headers: {
      'Upgrade-Insecure-Requests': '1',
      'User-Agent': 'Mozilla/5.0 (Linux; Android 13; sdk_gphone_x86_64 Build/TE1A.220922.031; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/103.0.5060.71 Mobile Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'X-Requested-With': 'com.ea.gp.madden19companionapp'
    }
  });
  const location = response.headers.location;
  if (!location) throw new Error('EA did not provide the persona authorization redirect. Try /ea-connect again.');
  const code = new URL(location, REDIRECT_URL).searchParams.get('code');
  if (!code) throw new Error('EA persona authorization did not include a code.');
  const token = await postForm('https://accounts.ea.com/connect/token', {
    authentication_source: AUTH_SOURCE,
    code,
    grant_type: 'authorization_code',
    token_format: 'JWS',
    release_type: 'prod',
    client_secret: CLIENT_SECRET,
    redirect_uri: REDIRECT_URL,
    client_id: CLIENT_ID
  }, 'Madden PC authorization');
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiry: Date.now() + Number(token.expires_in || 3600) * 1000,
    console: 'pc',
    blazeId: String(persona.personaId)
  };
}

async function refreshAccessToken(connection) {
  if (connection.accessToken && Number(connection.expiry) > Date.now() + 120000) return connection;
  const token = await postForm('https://accounts.ea.com/connect/token', {
    grant_type: 'refresh_token',
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    release_type: 'prod',
    refresh_token: connection.refreshToken,
    authentication_source: AUTH_SOURCE,
    token_format: 'JWS'
  }, 'EA token refresh');
  connection.accessToken = token.access_token;
  connection.refreshToken = token.refresh_token || connection.refreshToken;
  connection.expiry = Date.now() + Number(token.expires_in || 3600) * 1000;
  return connection;
}

function blazeHeaders(token) {
  return {
    'Accept-Charset': 'UTF-8',
    Accept: 'application/json',
    'X-BLAZE-ID': BLAZE_ID,
    'X-BLAZE-VOID-RESP': 'XML',
    'X-Application-Key': 'MADDEN-MCA',
    'Content-Type': 'application/json',
    'User-Agent': USER_AGENT
  };
}

async function retrieveBlazeSession(token) {
  const url = `https://${BLAZE_HOST}/wal/authentication/login`;
  const body = JSON.stringify({ accessToken: token.accessToken, productName: BLAZE_PRODUCT });
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await request(url, {
        method: 'POST', legacyTls: true,
        headers: blazeHeaders(token),
        body
      });
      const data = parseJson(response, 'Madden service login');
      const sessionKey = data?.userLoginInfo?.sessionKey;
      const blazeId = data?.userLoginInfo?.personaDetails?.personaId;
      if (!sessionKey || !blazeId) throw new Error('EA accepted the account but did not create a Madden session.');
      return { sessionKey, blazeId, requestId: 1 };
    } catch (err) {
      lastError = err;
      const transient = /temporarily unavailable \(HTTP (502|503|504)\)/i.test(err?.message || '');
      if (!transient || attempt === 2) break;
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
  if (/temporarily unavailable/i.test(lastError?.message || '')) {
    throw new Error(`${lastError.message} Tried 3 times. You can retry the franchise lookup without entering your EA password again.`);
  }
  throw lastError;
}

function makeMessageAuth(blazeId, requestId) {
  const random = randomBytes(4);
  const requestData = JSON.stringify({ staticData: '05e6a7ead5584ab4', requestId, blazeId });
  const staticBytes = Buffer.from('634203362017bf72f70ba900c0aa4e6b', 'hex');
  const xorHash = createHash('md5').update(random).update(staticBytes).digest();
  const requestBytes = Buffer.from(requestData, 'utf8');
  const scrambled = requestBytes.map((b, i) => b ^ xorHash[i % 16]);
  const authBytes = Buffer.concat([random, scrambled]);
  const staticAuthCode = Buffer.from('3a53413521464c3b6531326530705b70203a2900', 'hex');
  return {
    authData: authBytes.toString('base64'),
    authCode: createHash('md5').update(staticAuthCode).update(authBytes).digest('base64'),
    authType: 17039361
  };
}

async function sendBlazeRequest(token, session, requestInfo) {
  const messageAuthData = makeMessageAuth(session.blazeId, session.requestId);
  const body = {
    apiVersion: 2,
    clientDevice: 3,
    requestInfo: JSON.stringify({
      commandName: requestInfo.commandName,
      componentId: requestInfo.componentId,
      commandId: requestInfo.commandId,
      componentName: requestInfo.componentName,
      messageAuthData,
      messageExpirationTime: Math.floor(Date.now() / 1000),
      deviceId: MACHINE_KEY,
      ipAddress: '127.0.0.1',
      requestPayload: JSON.stringify(requestInfo.requestPayload || {})
    })
  };
  const response = await request(`https://${BLAZE_HOST}/wal/mca/Process/${session.sessionKey}`, {
    method: 'POST', legacyTls: true,
    headers: blazeHeaders(token), body: JSON.stringify(body)
  });
  const data = parseJson(response, 'Madden franchise lookup');
  if (data.error) throw new Error(`EA franchise request failed (${data.error.errorname || data.error.errorcode || 'unknown error'}).`);
  return data;
}

async function getLeagues(token) {
  const session = await retrieveBlazeSession(token);
  const data = await sendBlazeRequest(token, session, {
    commandName: 'Mobile_GetMyLeagues', componentId: 2060, commandId: 801,
    componentName: 'franchisemode', requestPayload: {}
  });
  return data?.responseInfo?.value?.leagues || [];
}

async function getLeagueTeams(token, session, leagueId) {
  const response = await request(`https://${BLAZE_HOST}/wal/mca/CareerMode_GetLeagueTeamsExport/${session.sessionKey}`, {
    method: 'POST', legacyTls: true,
    headers: blazeHeaders(token), body: JSON.stringify({ leagueId: Number(leagueId) })
  });
  const data = parseJson(response, 'Madden team ownership lookup');
  if (data.error) throw new Error(`EA roster lookup failed (${data.error.errorname || data.error.errorcode || 'unknown error'}).`);
  if (data.success === false || !Array.isArray(data.leagueTeamInfoList)) throw new Error('EA returned franchise data in an unexpected format; no claims were approved.');
  return data.leagueTeamInfoList.map(t => ({
    teamId: Number(t.teamId),
    abbrName: String(t.abbrName || ''),
    displayName: String(t.displayName || t.nickName || ''),
    userName: String(t.userName || '').trim()
  }));
}

async function syncLeague(connection) {
  await refreshAccessToken(connection);
  const session = await retrieveBlazeSession(connection);
  const teams = await getLeagueTeams(connection, session, connection.leagueId);
  const leagueOwners = teams.filter(t => t.userName).length;
  connection.teams = teams;
  connection.lastSync = Date.now();
  connection.lastSyncOwners = leagueOwners;
  connection.lastSyncError = null;
  return { teams, leagueOwners };
}

function normalizeUsername(value) {
  return String(value || '').trim().toLocaleLowerCase('en-US');
}

function findTeamOwner(teams, teamName, username) {
  const wantedTeam = String(teamName || '').trim().toLocaleLowerCase('en-US');
  const wantedUser = normalizeUsername(username);
  const team = (teams || []).find(t =>
    normalizeUsername(t.displayName) === wantedTeam || normalizeUsername(t.nickName) === wantedTeam
  );
  if (!team) return { ok: false, reason: `I couldn't match **${teamName}** to a team in the connected Madden franchise.` };
  const otherTeam = (teams || []).find(t => normalizeUsername(t.userName) === wantedUser && normalizeUsername(t.displayName) !== wantedTeam);
  if (otherTeam) return { ok: false, reason: `That EA username is currently assigned to **${otherTeam.displayName}**, not **${teamName}**.` };
  if (!team.userName) return { ok: false, reason: `Madden currently shows **${teamName}** as having no assigned EA username. The commissioner may need to refresh the franchise or confirm that the team is occupied.` };
  if (normalizeUsername(team.userName) !== wantedUser) {
    return { ok: false, reason: `That EA username does not match the current Madden owner of **${teamName}**.` };
  }
  return { ok: true, team };
}

module.exports = {
  EA_LOGIN_URL,
  exchangeInitialCode,
  getPersonaToken,
  getLeagues,
  syncLeague,
  findTeamOwner,
  normalizeUsername
};
