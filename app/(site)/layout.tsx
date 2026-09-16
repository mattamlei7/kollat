import { SceneCanvas } from "@/components/scene/SceneCanvas";
import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";
import { Reveal } from "@/components/site/Reveal";
import "@/lib/tokens.css";

/** Marketing pages: one persistent canvas behind everything, content at z-index 1. */
export default function SiteLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <div className="site-ground" aria-hidden="true" />
      <SceneCanvas />
      <div className="site">
        <Header />
        <main>{children}</main>
        <Footer />
        <Reveal />
      </div>
    </>
  );
}
