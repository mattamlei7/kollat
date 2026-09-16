const COLS = [
  { title: "No wallet connection", body: "Nothing to connect, nothing to approve", logos: ["MM", "WC", "CB"] },
  { title: "No signing, no write path", body: "The app cannot move funds, by construction", logos: ["TX", "SIG"] },
  { title: "Straight from the contracts", body: "Server-side RPC reads, no cached middleman", logos: ["ETH", "BASE"] },
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
