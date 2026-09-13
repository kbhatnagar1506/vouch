import BrandLogo from "./BrandLogo";
import type { AnalyzedSubscription } from "@/lib/dashboard-types";

const statusLabel: Record<string, string> = { renew: "Auto-renew", hold: "Held", cancel: "Cancelled", ask: "Needs you" };

export default function SubList({ subs, onOpen }: { subs: AnalyzedSubscription[]; onOpen: (s: AnalyzedSubscription) => void }) {
  return (
    <div className="sub-list">
      {subs.map((s) => (
        <button key={s.id} className="sub-row" onClick={() => onOpen(s)}>
          <BrandLogo name={s.name} initial={s.initial} color={s.color} logo={s.logo} size={42} />
          <div>
            <div className="sub-name">{s.name}</div>
            <div className="sub-meta">
              {s.usage30 !== undefined ? `${s.usage30} ${s.usageUnit} · last 30 days` : `Last charge · $${s.price.toFixed(2)}`}
            </div>
          </div>
          <div className="sub-col hide-sm">
            <div className="sub-col-label">Price</div>
            <div className="sub-col-value">${s.price.toFixed(2)}/mo</div>
          </div>
          <div className="sub-col hide-sm">
            <div className="sub-col-label">Card</div>
            <div className="sub-col-value card-ghost">
              {s.card === "closed" ? (
                <span className="card-state">
                  <span className="card-x">✕</span> closed
                </span>
              ) : (
                s.card
              )}
            </div>
          </div>
          <div className={`chip ${s.status === "ask" ? "ask" : s.status}`}>
            <span className={`dot ${s.status === "ask" ? "hold" : s.status}`} />
            {statusLabel[s.status]}
          </div>
        </button>
      ))}
    </div>
  );
}
