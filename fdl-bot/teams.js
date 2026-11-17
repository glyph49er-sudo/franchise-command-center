// All 32 NFL teams, grouped by conference.
// Category is used for the panel grouping (AFC / NFC).
//
// `emoji` is the NAME of a custom emoji installed in your server, e.g. :49ers:.
// The bot resolves the name to the real custom emoji (with its id) at runtime,
// so you don't have to paste `<:49ers:1234567890>` strings here.

const TEAMS = [
  // ---------- AFC ----------
  { name: "Ravens", conference: "AFC", emoji: ":ravens:" },
  { name: "Bengals", conference: "AFC", emoji: ":bengals:" },
  { name: "Browns", conference: "AFC", emoji: ":browns:" },
  { name: "Steelers", conference: "AFC", emoji: ":steelers:" },
  { name: "Bills", conference: "AFC", emoji: ":bills:" },
  { name: "Dolphins", conference: "AFC", emoji: ":dolphins:" },
  { name: "Patriots", conference: "AFC", emoji: ":patriots:" },
  { name: "Jets", conference: "AFC", emoji: ":jets:" },
  { name: "Texans", conference: "AFC", emoji: ":texans:" },
  { name: "Colts", conference: "AFC", emoji: ":colts:" },
  { name: "Jaguars", conference: "AFC", emoji: ":jaguars:" },
  { name: "Titans", conference: "AFC", emoji: ":titans:" },
  { name: "Broncos", conference: "AFC", emoji: ":broncos:" },
  { name: "Chiefs", conference: "AFC", emoji: ":chiefs:" },
  { name: "Raiders", conference: "AFC", emoji: ":raiders:" },
  { name: "Chargers", conference: "AFC", emoji: ":chargers:" },

  // ---------- NFC ----------
  { name: "Cowboys", conference: "NFC", emoji: ":cowboys:" },
  { name: "Giants", conference: "NFC", emoji: ":giants:" },
  { name: "Eagles", conference: "NFC", emoji: ":eagles:" },
  { name: "Commanders", conference: "NFC", emoji: ":commanders:" },
  { name: "Bears", conference: "NFC", emoji: ":bears:" },
  { name: "Lions", conference: "NFC", emoji: ":lions:" },
  { name: "Packers", conference: "NFC", emoji: ":packers:" },
  { name: "Vikings", conference: "NFC", emoji: ":vikings:" },
  { name: "Falcons", conference: "NFC", emoji: ":falcons:" },
  { name: "Panthers", conference: "NFC", emoji: ":panthers:" },
  { name: "Saints", conference: "NFC", emoji: ":saints:" },
  { name: "Buccaneers", conference: "NFC", emoji: ":buccaneers:" },
  { name: "Cardinals", conference: "NFC", emoji: ":cardinals:" },
  { name: "Rams", conference: "NFC", emoji: ":rams:" },
  { name: "49ers", conference: "NFC", emoji: ":49ers:" },
  { name: "Seahawks", conference: "NFC", emoji: ":seahawks:" }
];

module.exports = { TEAMS };
