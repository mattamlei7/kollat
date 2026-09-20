# First ten customer interviews

Internal working kit for `plan3.0.md` §§9, 10, and 14. These are drafts; no outreach has been sent. The objective is ten completed discovery interviews and evidence of a buying process, not ten positive reactions to the demo.

## Primary email

**Subject:** Who owns borrowing risk at [Company]?

Hi [First name],

[One verified sentence about their borrowing product or a public plan to build one. Omit if you cannot verify it.]

I'm building Kollat. There's a working read-only borrowing demo; I'm now testing whether wallet teams would pay for policy checks, risk alerts, and a record explaining each borrowing decision.

When a borrowing user needs help, who owns the support ticket, and what can that person see about the position and earlier decisions?

Would you be open to a 20-minute call about how your team handles this today? I'd like to understand your workflow before proposing an integration. If someone else owns it, a pointer would help.

[Name]
[Kollat demo](https://borrow-router.vercel.app/borrow)

## Short DM

Hi [First name] — I'm building Kollat and interviewing wallet teams about borrowing policy and support. When a user has a borrowing problem, who investigates it, and what evidence do they have? Open to a 20-minute conversation about your current workflow, or is someone else at [Company] the right person?

## Follow-up: after 4–5 business days

Hi [First name] — following up on borrowing operations at [Company]. I'm trying to learn whether policy checks and post-borrow monitoring are problems your team already spends time on. Would a short call be useful? If borrowing isn't a priority, that is useful to know too.

[Name]

## Final follow-up: roughly a week later

Hi [First name] — last note from me. Is there someone who owns borrowing integrations or related support at [Company] whom I should contact? If this isn't relevant, I'll leave it here. Thanks either way.

[Name]

Stop on a decline or opt-out. Personalize from verified public information or an existing relationship; never imply a launch, incident, introduction, or customer relationship you have not verified.

## Who to interview

Start with self-custody wallet teams offering borrowing or actively evaluating a specific launch. Suggested mix across the ten calls:

- Four product owners: demand, launch blockers, roadmap priority, and budget ownership.
- Four engineering owners: integration maintenance, data failures, policy enforcement, and reconciliation.
- Two risk, operations, or support owners: incidents, alert response, and evidence needs. In a small team, ask who actually performs this work.

Cover several companies. Multiple roles at one company help validate a workflow but do not count as independent customer demand. Track distinct companies as well as completed calls. Start with warm introductions where available; track outreach attempts separately from interviews.

## The 20-minute interview

Ask about actual experience before showing the pitch or demo. Do not ask for private keys, credentials, or customer-identifying records. Ask permission before recording; written notes are sufficient.

**Minutes 0–3: establish context.** What is your role in borrowing? Is it live, planned with an owner and date, or exploratory? What user demand led you here?

**Minutes 3–9: reconstruct a real case.** Walk me through the most recent borrowing integration issue or support case. What happened, who worked on it, what systems did they check, and how much time did it take? What happens when protocol data disagrees with your records? If pre-launch, ask about the last concrete blocker and their current implementation approach.

**Minutes 9–13: understand constraints.** Who signs and submits transactions? Which chains, assets, and protocols would be in scope? Where are risk limits checked? Which alerts would cause someone to act, and who is that person? What freshness, audit, security, or procurement requirements would block adoption?

**Minutes 13–16: test relevance.** With permission, show the existing read-only demo briefly. Explain that persistent decisions, ongoing monitoring, signed webhooks, and operational reconciliation are proposed pilot capabilities. Which part would replace real work for their team? What would they keep in-house or buy elsewhere? What is missing?

**Minutes 16–20: test commercial intent.** Ask the roadmap's question:

> Would you pay us to keep lending integrations correct, enforce your policies, monitor customer risk, and give your operations team an audit trail?

Then ask: Who owns that budget? What do you spend in engineering time or tooling today? What would a pilot need to prove? Could we schedule a scoping call with the engineering owner and budget holder? Treat a hypothetical yes as interest, not a commitment.

## Copy these notes for each interview

- Interview number / date / company / role:
- Borrowing live, committed launch, or exploratory:
- Recent problem and direct quote (separate observations from your interpretation):
- Current workaround / tools / people / time or cost:
- Required workflow, chains, assets, protocols, and signing owner:
- Policy / freshness / alert / reconciliation / evidence requirements:
- Why they would buy, build internally, or do nothing:
- Budget holder / approval process / timeline:
- Commitment and evidence: introduction, scheduled scoping call, written requirements, allocated engineering time, LOI, or paid pilot:
- Next action / owner / date:

## After the ten calls

Group the repeated problems, contradictory requirements, and reasons to decline. Count independent companies with a concrete problem and record how many offered a specific next step. Do not turn compliments, demo clicks, or willingness to take a call into willingness to pay.

The target is one design partner with a named owner, written requirements, and committed integration time, ideally attached to a paid pilot. A conditional LOI is evidence of intent, not revenue. If interest stays hypothetical, revise the buyer/problem hypothesis before expanding the build. Reassess preflight and transaction construction only against a committed partner's actual workflow.
