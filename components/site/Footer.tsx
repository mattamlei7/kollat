import { Mark } from "./Header";

const README = "https://github.com/mattamlei7/borrow-router#readme";

const COLS: { title: string; links: [string, string][] }[] = [
  { title: "Protocols", links: [["Aave v3", "https://app.aave.com"], ["Spark", "https://app.spark.fi"], ["Compound v3", "https://app.compound.finance"], ["Morpho Blue", "https://app.morpho.org"], ["Fluid", "https://fluid.io"], ["Euler v2", "https://app.euler.finance"], ["Moonwell", "https://moonwell.fi"]] },
  { title: "Networks", links: [["Ethereum", "/borrow?chain=1"], ["Base", "/borrow?chain=8453"], ["Arbitrum", "/borrow?chain=42161"], ["Optimism", "/borrow?chain=10"], ["Polygon", "/borrow?chain=137"], ["Avalanche", "/borrow?chain=43114"]] },
  { title: "Resources", links: [["How it works", "#how-it-works"], ["Data sources", "#read-only"], ["Methodology", README], ["FAQ", README], ["Contact", "/contact"]] },
  { title: "Legal", links: [["Terms", "#legal"], ["Privacy", "#legal"], ["Disclaimer — not financial advice", "#legal"]] },
];

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="wrap">
        <div className="grid">
          <div><Mark /></div>
          {COLS.map((c) => (
            <div key={c.title}>
              <h4>{c.title}</h4>
              <ul>
                {c.links.map(([label, href]) => (
                  <li key={label}>
                    <a href={href} {...(href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{label}</a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="legal" id="legal">
          Borrow Router is informational only and is not financial advice. Figures are estimates derived from public chain data and the protocols&apos; own contracts at the time of reading; they can change at any moment. Nothing here is stored, signed or transmitted on your behalf.
        </p>
      </div>
    </footer>
  );
}
