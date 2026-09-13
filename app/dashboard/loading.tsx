// Next.js App Router shows this automatically while page.tsx's async data
// fetch (getRealDashboardData) is in flight -- no client JS or Suspense
// wiring needed. Mirrors the real shell's grid so there's no layout shift
// when the real content swaps in.
const NAV_ROWS = 7;
const STAT_CARDS = 4;
const LIST_ROWS = 4;

export default function DashboardLoading() {
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="skeleton" style={{ width: 30, height: 30, borderRadius: 8 }} />
          <div className="skeleton" style={{ width: 64, height: 18 }} />
        </div>
        <nav className="nav">
          {Array.from({ length: NAV_ROWS }).map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 34, margin: "2px 0" }} />
          ))}
        </nav>
        <div className="nav-user">
          <div className="skeleton" style={{ width: 34, height: 34, borderRadius: "50%" }} />
          <div style={{ flex: 1 }}>
            <div className="skeleton" style={{ width: "70%", height: 12, marginBottom: 6 }} />
            <div className="skeleton" style={{ width: "45%", height: 10 }} />
          </div>
        </div>
      </aside>

      <main className="main">
        <div className="page-head">
          <div className="skeleton" style={{ width: 180, height: 26, marginBottom: 10 }} />
          <div className="skeleton" style={{ width: 340, height: 14 }} />
        </div>

        <div className="stat-grid">
          {Array.from({ length: STAT_CARDS }).map((_, i) => (
            <div className="stat" key={i}>
              <div className="stat-top">
                <div className="skeleton" style={{ width: "55%", height: 11 }} />
                <div className="skeleton" style={{ width: 34, height: 34, borderRadius: 10 }} />
              </div>
              <div className="skeleton" style={{ width: "45%", height: 24, marginTop: 14, marginBottom: 8 }} />
              <div className="skeleton" style={{ width: "75%", height: 11 }} />
            </div>
          ))}
        </div>

        <div className="panel">
          <div className="panel-head">
            <div>
              <div className="skeleton" style={{ width: 150, height: 15, marginBottom: 6 }} />
              <div className="skeleton" style={{ width: 220, height: 11 }} />
            </div>
          </div>
          <div className="panel-pad" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {Array.from({ length: LIST_ROWS }).map((_, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div className="skeleton" style={{ width: 42, height: 42, borderRadius: 12, flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div className="skeleton" style={{ width: "35%", height: 13, marginBottom: 6 }} />
                  <div className="skeleton" style={{ width: "55%", height: 11 }} />
                </div>
                <div className="skeleton" style={{ width: 70, height: 22, borderRadius: 20 }} />
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
