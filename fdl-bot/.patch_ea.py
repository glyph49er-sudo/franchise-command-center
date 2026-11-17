p='ea-connector.js';s=open(p).read()
s=s.replace("module.exports = {","""// ---------------------------------------------------------------------------
// League data exports (same endpoints the Companion App / SnallaBot use).
// ---------------------------------------------------------------------------
const LeagueData = {
  TEAMS: 'CareerMode_GetLeagueTeamsExport', STANDINGS: 'CareerMode_GetStandingsExport',
  SCHEDULE: 'CareerMode_GetWeeklySchedulesExport', RUSHING: 'CareerMode_GetWeeklyRushingStatsExport',
  RECEIVING: 'CareerMode_GetWeeklyReceivingStatsExport', DEFENSE: 'CareerMode_GetWeeklyDefensiveStatsExport',
  PASSING: 'CareerMode_GetWeeklyPassingStatsExport', ROSTER: 'CareerMode_GetTeamRostersExport'
};
let cachedSession = null;
async function getSession(connection, force = false) {
  await refreshAccessToken(connection);
  if (!force && cachedSession && cachedSession.accessToken === connection.accessToken && Date.now() - cachedSession.at < 10 * 60 * 1000) return cachedSession.session;
  const session = await retrieveBlazeSession(connection);
  cachedSession = { session, accessToken: connection.accessToken, at: Date.now() };
  return session;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function exportData(connection, exportType, body) {
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const session = await getSession(connection, attempt > 0);
      const response = await request(`https://${BLAZE_HOST}/wal/mca/${exportType}/${session.sessionKey}`, {
        method: 'POST', legacyTls: true, headers: blazeHeaders(connection), body: JSON.stringify(body)
      });
      const data = parseJson(response, `Madden ${exportType}`);
      if (data.error) {
        lastErr = new Error(`EA ${exportType} failed (${data.error.errorname || data.error.errorcode || 'unknown'})`);
        await sleep(1000 * 2 ** attempt); continue;
      }
      return data;
    } catch (err) {
      lastErr = err;
      if (!/temporarily unavailable|timed out/i.test(err.message || '')) throw err;
      await sleep(1000 * 2 ** attempt);
    }
  }
  throw lastErr;
}
async function getLeagueInfo(connection) {
  const session = await getSession(connection);
  session.requestId = (session.requestId || 1) + 1;
  const data = await sendBlazeRequest(connection, session, {
    commandName: 'Mobile_Career_GetLeagueHub', componentId: 2060, commandId: 811,
    componentName: 'franchisemode', requestPayload: { leagueId: Number(connection.leagueId) }
  });
  return data?.responseInfo?.value || {};
}
const L = c => Number(c.leagueId);
const getTeams = async c => (await exportData(c, LeagueData.TEAMS, { leagueId: L(c) })).leagueTeamInfoList || [];
const getStandings = async c => (await exportData(c, LeagueData.STANDINGS, { leagueId: L(c) })).teamStandingInfoList || [];
const getSchedule = async (c, weekIndex, stage = 1) => (await exportData(c, LeagueData.SCHEDULE, { leagueId: L(c), stageIndex: stage, weekIndex })).gameScheduleInfoList || [];
async function getWeeklyStats(c, weekIndex, stage = 1) {
  const body = { leagueId: L(c), stageIndex: stage, weekIndex };
  const get = (t, k) => exportData(c, t, body).then(d => d[k] || []).catch(() => []);
  const [passing, rushing, receiving, defense] = await Promise.all([
    get(LeagueData.PASSING, 'playerPassingStatInfoList'), get(LeagueData.RUSHING, 'playerRushingStatInfoList'),
    get(LeagueData.RECEIVING, 'playerReceivingStatInfoList'), get(LeagueData.DEFENSE, 'playerDefensiveStatInfoList')]);
  return { passing, rushing, receiving, defense };
}
const getTeamRoster = async (c, teamId, teamIndex) => (await exportData(c, LeagueData.ROSTER, { leagueId: L(c), listIndex: teamIndex, returnFreeAgents: false, teamId })).rosterInfoList || [];
const getFreeAgents = async c => (await exportData(c, LeagueData.ROSTER, { leagueId: L(c), listIndex: -1, returnFreeAgents: true, teamId: 0 })).rosterInfoList || [];

module.exports = {
  LeagueData, exportData, getLeagueInfo, getTeams, getStandings, getSchedule, getWeeklyStats, getTeamRoster, getFreeAgents,""")
a="""  await refreshAccessToken(connection);
  const session = await retrieveBlazeSession(connection);
  const teams = await getLeagueTeams(connection, session, connection.leagueId);"""
assert a in s
s=s.replace(a,"""  let session = await getSession(connection);
  let teams;
  try { teams = await getLeagueTeams(connection, session, connection.leagueId); }
  catch (e) { session = await getSession(connection, true); teams = await getLeagueTeams(connection, session, connection.leagueId); }""")
open(p,'w').write(s)
