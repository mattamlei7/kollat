import type { Metadata } from "next";
import { ContactForm } from "@/components/site/ContactForm";

export const metadata: Metadata = { title: "Contact · Kollat" };

export default function Contact() {
  return (
    <section className="section contact" aria-labelledby="contact">
      <div className="wrap">
        <div className="section-head">
          <h1 id="contact">Get in touch</h1>
          <p>Exchanges, integrations, questions about the numbers. Messages go straight to the founder.</p>
        </div>
        <ContactForm />
      </div>
    </section>
  );
}
