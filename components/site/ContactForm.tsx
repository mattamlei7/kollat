"use client";

import { useState, type FormEvent } from "react";

const TO = "mattamlei7@gmail.com";

/**
 * Opens the visitor's mail client with the message pre-filled. No backend,
 * no keys, nothing stored. ponytail: swap for an API route + Resend if
 * mailto turns out to lose messages from people without a mail client.
 */
export function ContactForm() {
  const [sent, setSent] = useState(false);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const name = String(f.get("name") ?? "").trim();
    const from = String(f.get("email") ?? "").trim();
    const message = String(f.get("message") ?? "").trim();
    const subject = `Borrow Router: ${name || "contact"}`;
    const body = `${message}\n\n— ${name}${from ? ` <${from}>` : ""}`;
    window.location.href = `mailto:${TO}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    setSent(true);
  }

  return (
    <form className="contact-form" onSubmit={submit}>
      <label>
        <span>Name</span>
        <input id="contact-name" name="name" required autoComplete="name" />
      </label>
      <label>
        <span>Email</span>
        <input id="contact-email" name="email" type="email" required autoComplete="email" />
      </label>
      <label>
        <span>Message</span>
        <textarea id="contact-message" name="message" rows={6} required />
      </label>
      <button type="submit" className="pill">Send message</button>
      <p className="faint">
        {sent ? "Your mail app should have opened with the message. " : "Opens your mail app. "}
        Or write directly to <a href={`mailto:${TO}`}>{TO}</a>.
      </p>
    </form>
  );
}
