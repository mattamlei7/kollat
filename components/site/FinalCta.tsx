import { AddressInput } from "./Hero";

export function FinalCta() {
  return (
    <section className="section" aria-labelledby="final">
      <div className="wrap">
        <div className="final" data-reveal>
          <h1 id="final">Find out what your address can borrow</h1>
          <AddressInput id="final-address" note="Read-only. Nothing is stored." />
        </div>
      </div>
    </section>
  );
}
