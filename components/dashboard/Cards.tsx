import { CheckCircle2, XCircle } from "lucide-react";
import Logo from "./Logo";
import type { AnalyzedSubscription } from "@/lib/dashboard-types";

function VouchCard({ s, onOpen }: { s: AnalyzedSubscription; onOpen: (s: AnalyzedSubscription) => void }) {
  const dead = s.card === "closed";
  return (
    <button className="vcard-btn" onClick={() => onOpen(s)}>
      <div className={`vcard ${dead ? "dead" : ""}`} style={{ margin: 0, ["--card-tint" as string]: s.tint }}>
        <div className="vcard-chip" />
        {s.logo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="vcard-brand"
            src={s.logo}
            alt={s.name}
            style={{ filter: dead ? "grayscale(1) opacity(.5)" : "brightness(0) invert(1)" }}
          />
        )}
        <div className="vcard-top">
          <div className="vcard-issuer">
            <Logo size={15} color={dead ? "#6b6a64" : "#fff"} /> VOUCH
          </div>
          <div className="vcard-status">{dead ? "Spent" : "Active"}</div>
        </div>
        <div className="vcard-num">{dead ? "•••• •••• •••• ✕✕✕✕" : `•••• •••• •••• ${s.card.replace("•••• ", "")}`}</div>
        <div className="vcard-foot">
          <div>
            <span>Merchant</span>
            <strong>{s.name}</strong>
          </div>
          <div>
            <span>{dead ? "Closed after" : "Renews in"}</span>
            <strong>{dead ? "1 charge" : s.renewsIn === null ? "—" : `${s.renewsIn}d`}</strong>
          </div>
        </div>
        {dead && <div className="vcard-stamp">Single use spent</div>}
      </div>
    </button>
  );
}

export default function Cards({ subscriptions, onOpen }: { subscriptions: AnalyzedSubscription[]; onOpen: (s: AnalyzedSubscription) => void }) {
  const active = subscriptions.filter((s) => s.card !== "closed");
  const spent = subscriptions.filter((s) => s.card === "closed");

  return (
    <>
      <div className="page-head">
        <div className="page-title">Cards</div>
        <div className="page-sub">One single-use card per subscription. It dies after a single charge — tap any card for its next decision.</div>
      </div>

      {subscriptions.length === 0 ? (
        <div className="panel">
          <div className="empty-state">
            <div className="empty-state-title">No cards yet</div>
            <div className="empty-state-body">Mint your first single-use card from a subscription&rsquo;s decision popup.</div>
          </div>
        </div>
      ) : (
        <>
          <div className="cards-section-label">
            <CheckCircle2 size={15} color="var(--renew)" /> Active · {active.length}
          </div>
          <div className="cards-grid">
            {active.length === 0 && <div className="empty-state-inline">Nothing active right now.</div>}
            {active.map((s) => (
              <VouchCard key={s.id} s={s} onOpen={onOpen} />
            ))}
          </div>

          <div className="cards-section-label" style={{ marginTop: 28 }}>
            <XCircle size={15} color="var(--ink-3)" /> Spent & closed · {spent.length}
          </div>
          <div className="cards-grid">
            {spent.length === 0 && <div className="empty-state-inline">Nothing closed yet.</div>}
            {spent.map((s) => (
              <VouchCard key={s.id} s={s} onOpen={onOpen} />
            ))}
          </div>
        </>
      )}
    </>
  );
}
