'use strict';
// Pure trade-committee logic (no Discord dependency, unit-tested in test/tradeLogic.test.js).
//
// Ported from snallabot-service (src/discord/trade_db.ts and src/discord/commands/trade.ts),
// MIT License, Copyright (c) 2024 snallabot. See SNALLABOT_LICENSE.md.
const D = require('./franchiseData');

const STATUS = { PENDING: 'PENDING', APPROVED: 'APPROVED', REJECTED: 'REJECTED' };
const VOTE = { APPROVE: 'APPROVE', REJECT: 'REJECT' };
const STATUS_EMOJI = { APPROVED: '✅', PENDING: '⏳', REJECTED: '❌' };
const HEADER = { APPROVED: 'Trade Approved', PENDING: 'Trade Submission', REJECTED: 'Trade Rejected' };

const countVotes = (votes, kind) => Object.values(votes || {}).filter(v => v === kind).length;

// Applies one committee vote. Mirrors Snallabot's rules:
//  - a finished trade can't be voted on
//  - the submitter's own vote is ignored
//  - the trade passes at `requiredApprovals` approvals and fails at that many rejections
// Returns { trade, error } where `trade` is a new object (the input is not mutated).
function applyVote(trade, userId, vote) {
  if (!trade) return { error: 'This trade no longer exists.' };
  if (!Object.values(VOTE).includes(vote)) return { error: 'Invalid vote.' };
  if (trade.status !== STATUS.PENDING) return { error: `This trade is already ${trade.status.toLowerCase()}.` };
  if (userId === trade.submittedBy) return { error: "You can't vote on your own trade." };
  const votes = { ...trade.votes, [userId]: vote };
  const approvals = countVotes(votes, VOTE.APPROVE), rejections = countVotes(votes, VOTE.REJECT);
  const status = approvals >= trade.requiredApprovals ? STATUS.APPROVED
    : rejections >= trade.requiredApprovals ? STATUS.REJECTED : STATUS.PENDING;
  return { trade: { ...trade, votes, status } };
}

function assetLine(asset, hiddenDevs = true) {
  if (asset.type === 'PICK') return `> **${asset.label}**`;
  return `> ${D.devEmoji(asset, hiddenDevs)} **${asset.pos} ${asset.name}** — ${asset.ovr} OVR | Age ${asset.age ?? '?'}`;
}

function formatVotes(votes) {
  const who = kind => Object.entries(votes || {}).filter(([, v]) => v === kind).map(([id]) => `<@${id}>`).join(', ') || 'None';
  return `✅ **Approved:** ${who(VOTE.APPROVE)}\n❌ **Rejected:** ${who(VOTE.REJECT)}`;
}

// teamA "receives" what team B sends and vice versa (same convention as Snallabot).
// coachOf(teamName) -> Discord user id | null
function tradeText(trade, roleId, { hiddenDevs = true, coachOf = () => null } = {}) {
  const coaches = [trade.teamA.name, trade.teamB.name].map(coachOf).filter(Boolean);
  return [
    `# ${HEADER[trade.status]}`,
    `## ${trade.teamA.name} Receives`,
    trade.teamA.receives.map(a => assetLine(a, hiddenDevs)).join('\n'),
    `## ${trade.teamB.name} Receives`,
    trade.teamB.receives.map(a => assetLine(a, hiddenDevs)).join('\n'),
    `**Submitted by:** <@${trade.submittedBy}>${coaches.length ? `\n**Coaches:** ${coaches.map(id => `<@${id}>`).join(' ')}` : ''}`,
    `**<@&${roleId}> votes:** ✅ ${countVotes(trade.votes, VOTE.APPROVE)} Approve | ❌ ${countVotes(trade.votes, VOTE.REJECT)} Reject`,
    `**Required approvals:** ${trade.requiredApprovals}`,
    formatVotes(trade.votes),
    `**Status:** ${STATUS_EMOJI[trade.status]} ${trade.status}`
  ].join('\n\n');
}

const roundWord = n => (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`);
// "2027 3rd-Round Pick" labels for the next three drafts, filtered by what the user typed.
function pickLabels(startYear, query = '', limit = 25) {
  const q = String(query || '').toLowerCase();
  return [0, 1, 2].flatMap(y => Array.from({ length: 7 }, (_, r) => `${startYear + y} ${roundWord(r + 1)}-Round Pick`))
    .filter(label => label.toLowerCase().includes(q)).slice(0, limit);
}

const newTradeId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

module.exports = { STATUS, VOTE, countVotes, applyVote, assetLine, formatVotes, tradeText, pickLabels, roundWord, newTradeId };
