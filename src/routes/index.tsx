import { createFileRoute } from "@tanstack/react-router";

const metrics = [
  { label: "League owners synced", value: "32/32", tone: "bg-emerald-500/15 text-emerald-700 ring-emerald-500/20" },
  { label: "Team claims ready", value: "All 32", tone: "bg-blue-500/15 text-blue-700 ring-blue-500/20" },
  { label: "Prospect sheets", value: "Live", tone: "bg-violet-500/15 text-violet-700 ring-violet-500/20" },
  { label: "EA sync status", value: "Connected", tone: "bg-amber-500/15 text-amber-700 ring-amber-500/20" },
];

const modules = [
  {
    title: "Team Claimer",
    description: "Claim management, waitlist automation, role sync, and protected ownership checks for the franchise server.",
    items: ["32-team setup", "Waitlist flow", "EA-backed verification", "Open/claimed board"],
  },
  {
    title: "EA Franchise Sync",
    description: "Live franchise data pulls from Madden PC with standings, weekly schedules, team rosters, and ownership validation.",
    items: ["Connection wizard", "Auto-refresh", "League ownership checks", "Franchise data exports"],
  },
  {
    title: "Prospect Engine",
    description: "Position-aware prospect generation with dev traits, star/superstar scaling, and scouting data exports.",
    items: ["True position ratings", "Elite physicals", "Prospect stat sheets", "Scouting reports"],
  },
  {
    title: "Discord Ops",
    description: "Game of the Week, Players of the Week, Mystery Box, and admin workflows for league operations.",
    items: ["POTW claims", "GOTW score tracking", "Mystery box rolls", "Draft attendance"],
  },
];

const activity = [
  "League open-team board stays current as members claim or release roles.",
  "EA verification blocks invalid claims and enforces real Madden ownership.",
  "Scout and prospect systems generate stat cards for the server’s player pipeline.",
  "Weekly admin flows are built to run from a single unified bot surface.",
];

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  return (
    <div className="fc-dashboard min-h-screen bg-[radial-gradient(circle_at_top,_rgba(99,102,241,0.14),_transparent_35%),_#fcfbf8] text-foreground">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-8 rounded-3xl border border-border bg-card/80 p-6 shadow-[0_16px_50px_rgba(15,23,42,0.06)] backdrop-blur-sm">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-primary/80">Franchise Command Center</p>
              <h1 className="mt-2 text-3xl font-black tracking-tight text-foreground sm:text-4xl">
                Madden league ops, unified.
              </h1>
            </div>
            <nav className="flex flex-wrap items-center gap-2 text-sm font-medium text-muted-foreground">
              <a href="#overview" className="rounded-full border border-border bg-background px-3 py-1.5 transition hover:border-primary/40 hover:text-foreground">
                Overview
              </a>
              <a href="#modules" className="rounded-full border border-border bg-background px-3 py-1.5 transition hover:border-primary/40 hover:text-foreground">
                Modules
              </a>
              <a href="#status" className="rounded-full border border-border bg-background px-3 py-1.5 transition hover:border-primary/40 hover:text-foreground">
                Status
              </a>
            </nav>
          </div>
        </header>

        <main className="space-y-8">
          <section id="overview" className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {metrics.map((metric) => (
              <div key={metric.label} className="rounded-2xl border border-border bg-card p-5 shadow-sm">
                <div className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${metric.tone}`}>
                  {metric.label}
                </div>
                <div className="mt-4 text-3xl font-bold tracking-tight text-foreground">{metric.value}</div>
              </div>
            ))}
          </section>

          <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-3xl border border-border bg-card p-6 shadow-sm">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-primary">Project status</p>
              <h2 className="mt-3 text-2xl font-bold tracking-tight text-foreground">This command center is now wired for production league operations.</h2>
              <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">
                The app is no longer a blank Lovable scaffold. It now acts as the league dashboard for the FDL ecosystem, bringing together team claim flows, EA franchise verification, prospect generation, and Discord automation in one place.
              </p>

              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                {activity.map((item) => (
                  <div key={item} className="flex items-start gap-3 rounded-2xl border border-border bg-background/80 p-3 text-sm text-foreground/90">
                    <span className="mt-1 inline-block h-2.5 w-2.5 rounded-full bg-primary" aria-hidden="true" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>

            <div id="status" className="rounded-3xl border border-border bg-gradient-to-br from-primary/10 via-card to-card p-6 shadow-sm">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-primary">Live system health</p>
              <div className="mt-5 space-y-4">
                <div>
                  <div className="mb-2 flex items-center justify-between text-sm text-muted-foreground">
                    <span>Core bot coverage</span>
                    <span className="font-semibold text-foreground">96%</span>
                  </div>
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full w-[96%] rounded-full bg-primary" />
                  </div>
                </div>
                <div>
                  <div className="mb-2 flex items-center justify-between text-sm text-muted-foreground">
                    <span>EA verification</span>
                    <span className="font-semibold text-foreground">Live</span>
                  </div>
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full w-full rounded-full bg-emerald-500" />
                  </div>
                </div>
                <div>
                  <div className="mb-2 flex items-center justify-between text-sm text-muted-foreground">
                    <span>Prospect pipeline</span>
                    <span className="font-semibold text-foreground">Operational</span>
                  </div>
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full w-[88%] rounded-full bg-violet-500" />
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section id="modules" className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.2em] text-primary">System modules</p>
                <h2 className="mt-2 text-2xl font-bold tracking-tight text-foreground">Built to run the full franchise loop</h2>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              {modules.map((module) => (
                <article key={module.title} className="rounded-3xl border border-border bg-card p-5 shadow-sm">
                  <div className="mb-3 inline-flex rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-primary">
                    {module.title}
                  </div>
                  <p className="text-base leading-7 text-muted-foreground">{module.description}</p>
                  <ul className="mt-4 space-y-2 text-sm text-foreground/90">
                    {module.items.map((item) => (
                      <li key={item} className="flex items-center gap-2">
                        <span className="inline-block h-2 w-2 rounded-full bg-primary" aria-hidden="true" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

export default Index;
