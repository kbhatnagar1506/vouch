import { ArrowDownLeft, ArrowUpRight, Ban } from "lucide-react";
import type { Transaction } from "@/lib/dashboard-types";

const icons = { in: ArrowDownLeft, out: ArrowUpRight, declined: Ban };

export default function Transactions({ transactions, mode }: { transactions: Transaction[]; mode: "demo" | "real" }) {
  return (
    <>
      <div className="page-head">
        <div className="page-title">Transactions</div>
        <div className="page-sub">Every charge, decline, and refund as Vouch sees it happen.</div>
      </div>

      {mode === "demo" ? (
        <div className="mcp-banner">
          <span className="pulse" />
          Live feed via Claude MCP — transactions stream in as your issuer authorizes them.
        </div>
      ) : (
        <div className="mcp-banner">
          <span className="pulse" />
          Live feed from Stripe Issuing — posts here the moment a card is charged.
        </div>
      )}

      <div className="panel">
        <div className="panel-head">
          <div>
            <div className="panel-title">Activity</div>
            <div className="panel-note">Newest first.</div>
          </div>
          {mode === "demo" && <span className="mcp-tag">● mcp: lithic</span>}
        </div>
        {transactions.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-body">No transactions yet — they&rsquo;ll show up here once a minted card gets charged.</div>
          </div>
        ) : (
          <div className="tx-feed">
            {transactions.map((t) => {
              const Icon = icons[t.kind];
              return (
                <div className="tx-row" key={t.id}>
                  <div className={`tx-icon ${t.kind}`}>
                    <Icon size={16} />
                  </div>
                  <div>
                    <div className="tx-merchant">{t.merchant}</div>
                    <div className="tx-time">
                      {t.time} · {t.note}
                    </div>
                  </div>
                  <span />
                  <div className={`tx-amt ${t.kind === "declined" ? "declined" : ""}`}>
                    {t.kind === "in" ? "+" : t.kind === "declined" ? "" : "−"}${t.amount.toFixed(2)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
