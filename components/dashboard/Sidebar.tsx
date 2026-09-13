import { LayoutGrid, CreditCard, Wallet, Receipt, Plug, Settings, LineChart, LogOut } from "lucide-react";
import Logo from "./Logo";
import BrandLogo from "./BrandLogo";
import type { AnalyzedSubscription, DashboardUser } from "@/lib/dashboard-types";
import type { PageId } from "./DashboardShell";

const nav: { id: PageId; label: string; icon: typeof LayoutGrid }[] = [
  { id: "overview", label: "Overview", icon: LayoutGrid },
  { id: "cards", label: "Cards", icon: CreditCard },
  { id: "budget", label: "Budget", icon: Wallet },
  { id: "analysis", label: "Analysis", icon: LineChart },
  { id: "transactions", label: "Transactions", icon: Receipt },
  { id: "connectors", label: "Connectors", icon: Plug },
  { id: "settings", label: "Settings", icon: Settings },
];

export default function Sidebar({
  page,
  setPage,
  onOpen,
  subscriptions,
  user,
  onLogout,
}: {
  page: PageId;
  setPage: (p: PageId) => void;
  onOpen: (s: AnalyzedSubscription) => void;
  subscriptions: AnalyzedSubscription[];
  user: DashboardUser;
  onLogout?: () => void;
}) {
  const activeCards = subscriptions.filter((s) => s.card !== "closed").length;

  return (
    <aside className="sidebar">
      <div className="brand">
        <Logo size={30} />
        <div className="brand-name">Vouch</div>
      </div>

      <nav className="nav">
        {nav.map(({ id, label, icon: Icon }) => (
          <button key={id} className={`nav-item ${page === id ? "active" : ""}`} onClick={() => setPage(id)}>
            <Icon size={18} strokeWidth={2} />
            <span>{label}</span>
            {id === "cards" && activeCards > 0 && <span className="badge">{activeCards}</span>}
          </button>
        ))}

        <div className="nav-subs">
          <div className="nav-section-label">Your subscriptions</div>
          {subscriptions.length === 0 && <div className="nav-empty">None detected yet</div>}
          {subscriptions.map((s) => (
            <button key={s.id} className="nav-sub" onClick={() => onOpen(s)}>
              <BrandLogo name={s.name} initial={s.initial} color={s.color} logo={s.logo} size={24} radius={7} />
              <span className="nav-sub-name">{s.name}</span>
              <span className={`nav-sub-dot dot ${s.status === "ask" ? "hold" : s.status}`} />
            </button>
          ))}
        </div>
      </nav>

      <div className="nav-user">
        <div className="avatar">{user.initials}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="nav-user-name">{user.name}</div>
          <div className="nav-user-role">{user.role}</div>
        </div>
        {onLogout && (
          <button className="nav-logout" onClick={onLogout} aria-label="Log out" title="Log out">
            <LogOut size={15} />
          </button>
        )}
      </div>
    </aside>
  );
}
