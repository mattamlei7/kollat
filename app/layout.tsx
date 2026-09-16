import type { Metadata } from "next";
import { IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Borrow Router",
  description:
    "Read-only DeFi borrow router: what an address can borrow against its holdings on Aave, Spark, Compound and Morpho, at what rate, and where it gets liquidated.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${plexSans.variable} h-full`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
