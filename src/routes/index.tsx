import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  Bot,
  CalendarDays,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  Search,
  ShieldCheck,
  Users,
} from "lucide-react";

const teams = [
  ["Arizona Cardinals", "NFC", "West"], ["Atlanta Falcons", "NFC", "South"],
  ["Baltimore Ravens", "AFC", "North"], ["Buffalo Bills", "AFC", "East"],
  ["Carolina Panthers", "NFC", "South"], ["Chicago Bears", "NFC", "North"],
  ["Cincinnati Bengals", "AFC", "North"], ["Cleveland Browns", "AFC", "North"],
  ["Dallas Cowboys", "NFC", "East"], ["Denver Broncos", "AFC", "West"],
  ["Detroit Lions", "NFC", "North"], ["Green Bay Packers", "NFC", "North"],
  ["Houston Texans", "AFC", "South"], ["Indianapolis Colts", "AFC", "South"],
  ["Jacksonville Jaguars", "AFC", "South"], ["Kansas City Chiefs", "AFC", "West"],
  ["Las Vegas Raiders", "AFC", "West"], ["Los Angeles Chargers", "AFC", "West"],
  ["Los Angeles Rams", "NFC", "West"], ["Miami Dolphins", "AFC", "East"],
  ["Minnesota Vikings", "NFC", "North"], ["New England Patriots", "AFC", "East"],
  ["New Orleans Saints", "NFC", "South"], ["New York Giants", "NFC", "East"],
  ["New York Jets", "AFC", "East"], ["Philadelphia Eagles", "NFC", "East"],
  ["Pittsburgh Steelers", "AFC", "North"], ["San Francisco 49ers", "NFC", "West"],
  ["Seattle Seahawks", "NFC", "West"], ["Tampa Bay Buccaneers", "NFC", "South"],
  ["Tennessee Titans", "AFC", "South"], ["Washington Commanders", "NFC", "East"],
] as const;

const hubFeatures = [
  { icon: BarChart3, title: "Standings & power rankings", description: "Division records, conference seeds, and sortable league rankings from the connected franchise." },
  { icon: CalendarDays, title: "Schedule & game channels", description: "Weekly matchups, scores, and the league's game-day channel information." },
  { icon: Users, title: "Rosters & free agents", description: "Browse team rosters and the available free-agent pool." },
  { icon: Activity, title: "Leaders & player cards", description: "Passing, rushing, receiving, and defensive leaders with player details." },
];

type Section = "overview" | "teams" | "franchise";

export const Route = createFileRoute("/")({ component: Index });

function Index() {
  const [section, setSection] = useState<Section>("overview");
  const [conference, setConference] = useState("All");
  const [search, setSearch] = useState("");
  const filteredTeams = useMemo(() => teams.filter(([name, conf]) =>
    (conference === "All" || conf === conference) && name.toLowerCase().includes(search.toLowerCase()),
  ), [conference, search]);

  return (
    <div className="min-h-screen bg-[#f5f6fa] text-slate-950">
      <div className="mx-auto flex min-h-screen max-w-[1440px]">
        <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white p-5 md:flex md:flex-col">
          <a href="#home" className="flex items-center gap-3 px-2 py-3" aria-label="Franchise Command Center home">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-lg text-white">🏈</span>
            <span><span className="block text-sm font-bold">FDL Command</span><span className="text-xs text-slate-500">FRANCHISE HUB</span></span>
          </a>
          <p className="mb-2 mt-9 px-3 text-[10px] font-bold uppercase tracking-[.18em] text-slate-400">Workspace</p>
          <div className="space-y-1">
            <NavButton active={section === "overview"} onClick={() => setSection("overview")} icon={<Activity size={17} />}>Overview</NavButton>
            <NavButton active={section === "teams"} onClick={() => setSection("teams")} icon={<Users size={17} />}>Team directory</NavButton>
            <NavButton active={section === "franchise"} onClick={() => setSection("franchise")} icon={<BarChart3 size={17} />}>Franchise Hub</NavButton>
          </div>
          <div className="mt-auto rounded-2xl bg-slate-50 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold"><Bot size={16} className="text-indigo-600" /> FDL Discord bot</div>
            <p className="mt-2 text-xs leading-5 text-slate-500">The bot is the source for EA connection and league operations.</p>
            <a className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-indigo-700 hover:text-indigo-900" href="https://github.com/glyph49er-sudo/franchise-command-center/tree/main/fdl-bot">Bot setup <ArrowUpRight size={13} /></a>
          </div>
        </aside>

        <main className="min-w-0 flex-1 p-4 sm:p-7 lg:p-10">
          <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[.2em] text-indigo-700">Franchise Command Center</div>
              <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">{sectionTitle(section)}</h1>
              <p className="mt-2 text-sm text-slate-500">League tools and franchise data, organized in one place.</p>
            </div>
            <span className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800"><span className="h-2 w-2 rounded-full bg-amber-500" /> EA dashboard connection not configured</span>
          </header>

          <div className="mb-6 flex gap-2 overflow-x-auto md:hidden">
            <MobileTab active={section === "overview"} onClick={() => setSection("overview")}>Overview</MobileTab>
            <MobileTab active={section === "teams"} onClick={() => setSection("teams")}>Teams</MobileTab>
            <MobileTab active={section === "franchise"} onClick={() => setSection("franchise")}>Franchise Hub</MobileTab>
          </div>

          {section === "overview" && <Overview onTeams={() => setSection("teams")} onHub={() => setSection("franchise")} />}
          {section === "teams" && (
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
                <div><h2 className="text-lg font-bold">NFL team directory</h2><p className="mt-1 text-sm text-slate-500">Directory only. Claim status is not shown until the bot supplies live role data.</p></div>
                <label className="flex h-10 items-center gap-2 rounded-lg border border-slate-200 px-3 sm:w-64"><Search size={16} className="text-slate-400" /><input className="min-w-0 flex-1 bg-transparent text-sm outline-none" placeholder="Find a team" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
              </div>
              <div className="mt-5 flex gap-2">
                {["All", "AFC", "NFC"].map((value) => <button key={value} onClick={() => setConference(value)} className={`rounded-lg px-4 py-2 text-sm font-semibold ${conference === value ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{value}</button>)}
              </div>
              <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {filteredTeams.map(([name, conf, division]) => <div key={name} className="flex items-center justify-between rounded-xl border border-slate-200 p-3"><div><div className="text-sm font-semibold">{name}</div><div className="mt-1 text-xs text-slate-500">{conf} {division}</div></div><ChevronRight size={16} className="text-slate-300" /></div>)}
                {filteredTeams.length === 0 && <p className="col-span-full py-8 text-center text-sm text-slate-500">No teams match that search.</p>}
              </div>
            </section>
          )}
          {section === "franchise" && <FranchiseHub />}

          <footer className="mt-8 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-5 text-xs text-slate-500">
            <span>Franchise Command Center · FDL league operations</span>
            <a className="inline-flex items-center gap-1 hover:text-indigo-700" href="https://github.com/glyph49er-sudo/franchise-command-center">Repository <ArrowUpRight size={12} /></a>
          </footer>
        </main>
      </div>
    </div>
  );
}

function Overview({ onTeams, onHub }: { onTeams: () => void; onHub: () => void }) {
  return <>
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Metric icon={<Users size={18} />} title="NFL teams" value="32" note="Directory available" />
      <Metric icon={<ShieldCheck size={18} />} title="EA verification" value="Bot managed" note="Requires bot connection" />
      <Metric icon={<ClipboardList size={18} />} title="League status" value="Not synced" note="No live dashboard feed" />
      <Metric icon={<Bot size={18} />} title="Operations" value="Discord" note="Use slash commands" />
    </section>
    <section className="mt-6 grid gap-5 xl:grid-cols-[1.4fr_.8fr]">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <p className="text-xs font-bold uppercase tracking-[.18em] text-indigo-700">Welcome to the hub</p>
        <h2 className="mt-3 max-w-2xl text-2xl font-bold leading-tight">Everything your league needs to run its franchise season.</h2>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">Browse the team directory and explore the Franchise Hub modules. To show live standings, schedules, rosters, and player data here, the web app still needs a secure connection to the bot’s EA data service. No live values are fabricated or displayed as connected.</p>
        <div className="mt-6 flex flex-wrap gap-3"><button onClick={onTeams} className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700">Browse teams</button><button onClick={onHub} className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold hover:bg-slate-50">Open Franchise Hub</button></div>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-2"><CircleHelp size={18} className="text-indigo-600" /><h2 className="font-bold">Connect your league</h2></div>
        <ol className="mt-4 space-y-4 text-sm text-slate-600">
          <li className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-xs font-bold text-indigo-700">1</span><span>Configure and run the FDL bot using the setup guide.</span></li>
          <li className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-xs font-bold text-indigo-700">2</span><span>An administrator connects the Madden franchise with <code className="rounded bg-slate-100 px-1.5 py-0.5">/ea-connect</code>.</span></li>
          <li className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-xs font-bold text-indigo-700">3</span><span>League data in this web app will require an authenticated bot-to-web API; it is not configured yet.</span></li>
        </ol>
        <a href="https://github.com/glyph49er-sudo/franchise-command-center/tree/main/fdl-bot" className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-indigo-700 hover:text-indigo-900">Read bot setup <ArrowUpRight size={14} /></a>
      </div>
    </section>
  </>;
}

function FranchiseHub() {
  return <section className="space-y-5">
    <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-5 sm:p-7"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-indigo-700">Franchise Hub</p><h2 className="mt-2 text-xl font-bold">Your league data belongs here.</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">The EA connector in the bot contains franchise export helpers, but the web app has no authenticated data endpoint yet. This screen describes the planned Hub and clearly marks live data unavailable.</p></div><span className="rounded-full border border-amber-200 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800">Waiting for secure data API</span></div></div>
    <div className="grid gap-4 sm:grid-cols-2">{hubFeatures.map(({ icon: Icon, title, description }) => <article key={title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700"><Icon size={19} /></div><h3 className="mt-4 font-bold">{title}</h3><p className="mt-2 text-sm leading-6 text-slate-600">{description}</p><div className="mt-4 border-t border-slate-100 pt-3 text-xs font-medium text-slate-400">Live data unavailable · EA connection is bot-side</div></article>)}</div>
    <div className="rounded-2xl border border-slate-200 bg-white p-5"><h3 className="font-bold">Data safety</h3><p className="mt-2 text-sm leading-6 text-slate-600">EA refresh tokens must remain on the bot server. Do not expose them to the browser or commit them to the repository. The web dashboard should consume only a separately authenticated, read-only API.</p></div>
  </section>;
}

function Metric({ icon, title, value, note }: { icon: React.ReactNode; title: string; value: string; note: string }) {
  return <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between text-slate-500"><span className="text-xs font-semibold uppercase tracking-wide">{title}</span><span className="text-indigo-600">{icon}</span></div><div className="mt-4 text-xl font-bold">{value}</div><p className="mt-1 text-xs text-slate-500">{note}</p></article>;
}

function NavButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return <button onClick={onClick} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition ${active ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"}`}>{icon}{children}</button>;
}

function MobileTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} className={`shrink-0 rounded-lg px-3 py-2 text-sm font-semibold ${active ? "bg-indigo-600 text-white" : "bg-white text-slate-600"}`}>{children}</button>;
}

function sectionTitle(section: Section) {
  if (section === "teams") return "Team directory";
  if (section === "franchise") return "Franchise Hub";
  return "League overview";
}

export default Index;
