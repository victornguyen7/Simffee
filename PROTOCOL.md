# Replacing synthetic twins with real people

Every twin in this demo is synthetic. This document is what the *"Protocol for replacing twins with
real people"* link in the conclusion panel opens, and it exists so the claim being made is a
falsifiable one.

## What the demo does and does not claim

**Claims.** Given a behaviour log and an interview for each person, the simulation produces a
mechanism attribution — which lever moved which customer, and why — that a static reading of the
same data does not produce. On the seeded scenario the obvious reading is the price rise, and the
mechanism is the later opening.

**Does not claim.** That any particular number forecasts a real shop's sales. The population is
synthetic and hand-tuned to make a mechanism legible. Results are a pre-testing signal, not a
prediction, and the UI says so on every screen.

The protocol below is how the claim would be tested against people.

## 1. Recruit and instrument

Recruit 15 regulars of a single shop, screened only for visiting at least three times a week. No
screening on attitudes: the say-do gap is the thing being measured, so selecting for
self-descriptions would destroy the sample.

Each participant contributes the same two layers the synthetic twins carry:

- **What** — 30 days of purchase history, taken from the shop's point-of-sale record rather than
  self-report. Date, time, item, amount, and whether they left without buying.
- **Why** — a 15-minute semi-structured interview, recorded and transcribed. The five questions in
  `data/twins/*.json` stay fixed across participants, because varying them varies the support score
  in SPEC 6.5 for reasons that have nothing to do with the participant.

The mechanism variables are derived from those two layers by the rules in SPEC 3.1. Nobody hand-sets
a twin's `habit` or `disruption_threshold`. If a number cannot be derived from the log or the
transcript, it does not go in.

## 2. Seal the quiz before running anything

Write the outcome quiz **before** the simulation runs, and seal it. A quiz written afterwards is a
description of whatever the model produced.

The quiz asks, for each participant, a question the model must answer in advance:

> On the day the shop opened 30 minutes late, did this person buy here, buy from a competitor, or
> go without?

Three outcomes, so chance is 33%. Fifteen participants gives 15 paired predictions.

**Different domain.** The quiz must not be about coffee. Ask the same 15 people to predict a choice
in a domain the interview never touched — a lunch spot, a pharmacy, a transit route — and have the
model predict those too. A model that only reproduces coffee behaviour it was fed has learned the
log, not the person. This is the single most important control here, and the easiest to skip.

## 3. Run the intervention for real

Coordinate one genuine operational change with the shop: a 30-minute delay to opening on a single
weekday, announced no more differently than such a change normally would be. Record what each of the
15 participants actually did that morning, from the point-of-sale record and a one-line follow-up
for anyone who did not appear.

Do not tell participants which day, or that a change is coming. Do tell them, at recruitment, that
the study involves an operational change at some point in the month, and obtain consent on that
basis.

## 4. Score it as a paired sign test

For each participant there are two predictions of the same real outcome:

- **Model** — the simulation's `choice` for that person on the intervention day.
- **Baseline** — what a reasonable analyst predicts from the 30-day log alone, with no interview.
  Pre-register the baseline rule; "they go where they usually go" is the honest one.

The sign test counts only the participants where the two disagree. If the model beats the log-only
baseline on 11 or more of 15, that is p < 0.05 one-tailed. State the number of discordant pairs
alongside the p-value — a significant result on four discordant pairs is not a result.

Report the mechanism attribution separately and descriptively. It is the interesting output, but
it is not what the sign test tests, and presenting it as though it were would be the same error the
demo exists to criticise.

## 5. What would falsify this

Written down in advance, so it cannot be renegotiated afterwards:

- The model does not beat the log-only baseline on the sealed quiz.
- It beats the baseline on coffee but not on the out-of-domain questions, which means it learned the
  log rather than the person.
- Removing the interview layer entirely does not degrade accuracy, which means the *why* layer is
  decoration and the whole two-layer premise is wrong.
- The attributed mechanism does not match what participants say happened when asked afterwards,
  unprompted and without seeing the model's answer.

Any of these outcomes is worth more than the demo, and none of them have been run. Everything in
this repository is the synthetic rehearsal that comes first.

## 6. Handling people's data

- Consent covers the purchase history, the interview recording, and the intervention day.
- Transcripts are pseudonymised at ingestion. The mapping from participant to twin id lives outside
  this repository.
- Participants can withdraw and have their twin and transcript deleted, including after the run.
- No transcript, log, or recording from a real participant is ever committed here. This repository
  contains synthetic data only, and that is a property to preserve rather than a current accident.
