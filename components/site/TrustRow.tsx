const COLS = [
  { title: "You sign every step", body: "No wallet to browse. Loans need your OK", logos: ["MM", "WC", "CB"] },
  { title: "No custody of keys or funds", body: "Collateral goes to the lender, USDC to you", logos: ["TX", "SIG"] },
  { title: "Transparent data sources", body: "Onchain reads and lender APIs, cached briefly", logos: ["ETH", "BASE"] },
];

export function TrustRow() {
  return (
    <div className="wrap">
      <div className="trust" data-reveal>
        {COLS.map((c) => (
          <div key={c.title}>
            <h3 style={{ fontWeight: 300 }}>{c.title}</h3>
            <p>{c.body}</p>
            <div className="logos" aria-hidden="true">
              {c.logos.map((l) => <span key={l}>{l}</span>)}
            </div>
            <a className="more" href="#read-only">Read More →</a>
          </div>
        ))}
      </div>
    </div>
  );
}
