import { CheckCircle2, AlertCircle } from "lucide-react";
import BrandLogo from "./BrandLogo";
import type { Connector } from "@/lib/dashboard-types";

export default function Connectors({ connectors }: { connectors: Connector[] }) {
  return (
    <>
      <div className="page-head">
        <div className="page-title">Connectors</div>
        <div className="page-sub">The services Vouch reads from to make each decision.</div>
      </div>

      <div className="conn-grid">
        {connectors.map((c) => (
          <div className="conn-card" key={c.id}>
            <BrandLogo name={c.name} initial={c.initial} color={c.color} logo={c.logo} size={42} radius={11} />
            <div style={{ flex: 1 }}>
              <div className="conn-name">{c.name}</div>
              <div className="conn-state">
                {c.state === "connected" ? (
                  <>
                    <CheckCircle2 size={13} color="var(--renew)" /> {c.detail}
                  </>
                ) : (
                  <>
                    <AlertCircle size={13} color="var(--hold)" /> {c.detail}
                  </>
                )}
              </div>
            </div>
            {c.state === "connected" ? <span className="chip renew">Connected</span> : <button className="btn btn-ghost btn-sm">Connect</button>}
          </div>
        ))}
      </div>
    </>
  );
}
