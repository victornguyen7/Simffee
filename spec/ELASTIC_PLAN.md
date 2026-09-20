# Simffee — Elasticsearch plan ("Find the Signal" track)

2026-09-20 · companion to [SPEC.md](./SPEC.md) and [BACKEND_PLAN.md](./BACKEND_PLAN.md)

Decisions taken: **synthetic, labeled raw data · local Docker · plan first, build later.**

## 0. The bar

The prize is *"best use of Elasticsearch to turn complex, messy data into insights, answers or
actions."* The judge's question will be: *what did ES do that the JSON file could not?* Every item
below must answer that on screen, or it is decoration and should be cut.

ES is load-bearing in exactly two places, both of which the current code does by hand or with
keyword lists:

1. **Front — messy → mechanism.** SPEC 3.1 says the four mechanism variables are *derived* from a
   behaviour log and an interview. Today the `mechanism` block in `data/twins/*.json` is typed in.
   ES makes the derivation real: each number becomes a query with a hit you can show.
2. **Back — trajectories → answer.** `confidence.py`'s `DRIVER_KEYWORDS`, `select_evidence`'s
   "longest reasoning", and SPEC 4.3's "3 most relevant transcript lines by keyword" are all
   retrieval problems. ES replaces three hand-rolled rankers with one index, and adds the thing
   a flat file cannot do live: a question typed by a judge, answered across 1,400 rows and 10
   transcripts in one query.

Nothing in the engine changes. `engine/` reads the same `data/twins/*.json`; the difference is
that a `derive` step now *writes* the `mechanism` block from ES instead of a human.

## 1. Architecture

```
raw/ (messy, synthetic, labeled)
  pos_export_*.csv         duplicates, mixed timestamp formats, abandoned rows as blanks
  interviews/*.txt         free text, speaker tags, filler, one interview per twin
  reviews.jsonl            a few hundred short reviews of both shops, noisy ratings
        │  ingest/ingest.py          (bulk, idempotent, --reset)
        ▼
Elasticsearch  (single node, docker compose, port 9200; no auth, demo only)
  idx: pos_events   interviews   reviews   trajectories   agents
        │  derive/derive.py          (queries → data/twins/*.json mechanism + evidence)
        ▼
engine/  (unchanged)  → runs/*.jsonl
        │  index_runs.py             (rows → trajectories idx, after every engine run)
        ▼
analyzer/  (support + evidence become ES queries; --no-es falls back to today's code)
        │
        ▼
public/runs.json  +  a tiny query proxy for the UI search box (SPEC 9 screen 4)
```

Fallback rule: **every ES call has a `--no-es` path that is today's code.** If the container is
down at demo time, the demo still runs; only the search box and the "matched via" footnotes go
dark. This is non-negotiable — infra must never be able to kill the pitch.

## 2. Indices

Five indices. Mappings live in `ingest/mappings/*.json`. `keyword` for anything we aggregate or
filter on, `text` for anything we search, and one `dense_vector` where semantic matching earns it.

### 2.1 `pos_events` — the "what" layer, raw

One document per till line. This is the messy one.

| Field | Type | Mess planted |
| --- | --- | --- |
| `event_id` | keyword | ~3% duplicated with a different `event_id`, same everything else |
| `customer_ref` | keyword | Loyalty id; ~10% of rows missing it (walk-ins), a few typos (`T0l` for `T01`) |
| `shop` | keyword | Written three ways: `simffee`, `Simffee Coffee`, `SIMFFEE` |
| `ts` | date, multiple formats | `2026-08-21T06:45:00`, `21/08/2026 06:45`, epoch seconds — ingest normalises, keeps `ts_raw` |
| `item` | keyword | `latte`, `Latte`, `cafe latte` |
| `amount_vnd` | integer | Blank for abandoned queues; `0` in some exports |
| `abandoned` | boolean | Missing in half the exports — inferred from blank amount |
| `note` | text | Free text from staff: "left, queue too long", "asked if we open earlier" |

Ingest normalises into `shop_norm`, `item_norm`, `ts`, `abandoned` and keeps the raw fields so the
demo can show before/after on one document.

### 2.2 `interviews` — the "why" layer

One document **per utterance**, not per interview, so a hit is a sentence you can put on a card.

| Field | Type |
| --- | --- |
| `twin` | keyword |
| `turn` | integer |
| `speaker` | keyword (`interviewer` / `participant`) |
| `question_key` | keyword — one of the 5 fixed questions in SPEC/PROTOCOL, or `followup` |
| `text` | text (standard analyzer) |
| `text_vec` | dense_vector — optional; see §6 |

Raw transcripts contain filler ("um", "yeah so"), an interviewer, and two or three unscripted
follow-ups per person, so the five scripted answers in `data/twins/*.json` are *inside* a longer
noisy conversation, not the whole thing.

### 2.3 `reviews` — ambient signal

| Field | Type |
| --- | --- |
| `shop` | keyword |
| `rating` | integer 1–5 |
| `text` | text |
| `posted` | date |

Used for two things: shop `quality` (mean rating, so `data/shops.json` `quality` is derived too),
and marketing `reach` proxy (review volume per week). A few reviews are duplicates and a few are
obvious spam, so dedup shows up on screen.

### 2.4 `trajectories` — engine output, indexed

One document per row of `runs/{scenario}/{seed}.jsonl`, exactly the BACKEND_PLAN 2.1 shape plus
`_id = f"{scenario}-{seed}-{day}-{twin}"` for idempotent re-indexing. `reasoning` is `text`;
everything else is `keyword`/`float`/`integer`. `state_before.habit.*` flattened to
`habit_simffee`, `habit_starbucks`, `latent_starbucks` for aggregation.

### 2.5 `agents` — the twins as they stand after derive

The `data/twins/*.json` record minus `what_log`/`why_transcript` (those are in the other two
indices), plus `mechanism` and `evidence` (§3). Lets the search box join a trajectory row to its
person in one `terms` lookup.

## 3. Derive — SPEC 3.1 as queries

`derive/derive.py --twin T01` prints the queries, the hits, and the numbers; `--write` puts them
into `data/twins/T01.json` under `mechanism` and a new sibling block `evidence`. Every number gets
the query that produced it and the top hit, so the UI can show *"this 0.82 came from these 24
receipts"* and *"this 0.4 came from this sentence."*

| Variable | SPEC 3.1 rule | ES query | Evidence stored |
| --- | --- | --- | --- |
| `habit[s]` | count(log where shop == s) / 30 | `pos_events`: filter `customer_ref`, `ts` in last 30 days, `abandoned: false`; `terms` agg on `shop_norm` after a `collapse` on `(customer_ref, ts_rounded_to_minute, shop_norm)` to kill duplicates | `{"visits": 24, "of_days": 30, "duplicates_removed": 2}` |
| `usual_time`, `usual_order` | (profile) | `date_histogram` hourly on `ts` → mode; `terms` on `item_norm` → top | the histogram bucket |
| `disruption_threshold` | long specific answer to "switching is a hassle" → 0.55–0.7; "I switch constantly" → 0.25–0.4 | `interviews`: filter `twin`, `question_key: switching_hassle`; score answer length (tokens) and a `match` against an inertia phrase set (`years`, `still haven't`, `never got round`, `same`) vs a mobility set (`switch`, `try`, `whatever's open`); map to the band | the utterance text + which band it landed in and why |
| `latent_interest[o]` | mentions shop `o` (heard / saw an ad / tried once) → 0.3–0.5; none → 0.05–0.15 | `interviews`: filter `twin`; `multi_match` on `text` for shop `o`'s name and product words, boosted when `question_key: noticed_not_tried`; if `_score` above a threshold → upper band scaled by score, else lower band | top hit sentence, e.g. *"A colleague keeps bringing their cold brew to meetings"* |
| `talkativeness` | the "when did you last tell someone" question | filter `question_key: told_someone`; `match` against a recommender phrase set (`told`, `recommend`, `everyone`, `always say`) vs (`not really`, `never`, `keep to myself`) | the utterance |
| `social_links` | grid adjacency | not ES (geometry) | — |
| `ad_sensitivity` | (not in 3.1) | `match` on marketing words (`ad`, `promo`, `poster`, `saw`, `fall menu`) across the twin's utterances | the utterance |
| `shops.quality` | (new) | `reviews`: `avg` on `rating` per `shop`, after dedup | count + mean |
| `say_do_gap` | SPEC 7.4 | compare the stated claim utterance vs the `pos_events` aggregates: e.g. claims "quality" but 28/30 visits at the nearest shop; claims "frugal" but mean `amount_vnd` is the most expensive item | both sides, side by side |

The band edges (0.55–0.7 etc.) are the SPEC's, so the derived numbers land near today's
hand-typed ones. **Check:** after `derive --write --all`, run `engine.cli --offline` and
`check_determinism.sh`; days 1–3 must still reproduce SPEC 7.1 (8 Simffee / 2 Starbucks, zero
reappraisals). If they don't, tune the band mapping, not the twin files.

## 4. Analyzer changes (B2 files)

| Today | With ES | Fallback |
| --- | --- | --- |
| `confidence.support`: count transcript lines containing any of `DRIVER_KEYWORDS[driver]`, /3, cap 1 | `interviews` `match` query `{twin, text: driver phrase set}`; support = normalised `max_score` (divide by the best score across all twins for that driver, so the scale is 0–1 and comparable) | keyword path stays as `--no-es` |
| `attribution.select_evidence`: switcher with longest reasoning | `trajectories` query: `day = break_day`, `choice != prev`, `primary_driver = actual`; rank by `match` of `reasoning` against the driver phrase set | longest-reasoning path |
| — | new `analyzer/search.py`: `answer(question) → {rows, agents, utterances}` for the UI search box. Not free-form NL→DSL; a small set of query templates keyed by intent (`lost_to`, `why_did`, `who_heard`, `returned_under`) with a `match` fallback across `reasoning` + `interviews.text` | absent |
| — | `index_runs.py`: bulk rows into `trajectories`, idempotent by `_id`; called at the end of `tools/build_demo.sh` | skipped with a note |

`build_runs.py` gains `--es http://localhost:9200` (default from `SIMFFEE_ES`). With it set and
reachable, support and evidence go through ES and `analysis.confidence.detail.support.per_twin[*]`
carries `matched_text` — the sentence that scored. Without it, byte-identical to today.

The number guard in `narrate.py` is unchanged and still applies: ES adds evidence, never numbers
the model can quote.

## 5. Demo moments — where ES is visibly doing the work

Adds ~20 s to the 2-minute script; the rest of the script stands.

| When | Screen | Line |
| --- | --- | --- |
| Setup (before "500 people, 10 we know well") | Left half: a raw `pos_events` doc with the three spellings of the shop and a duplicate flagged. Right half: the Kibana Discover or a tiny in-app panel with the `collapse` + `terms` query and the result `24 / 30` → habit bar filling to 0.80 | "We don't type these people in. We find them in the noise — receipts, an interview, a few hundred reviews." |
| Mechanism panel (T01 card) | Under the reasoning, a footnote: *matched via Elasticsearch: "A colleague keeps bringing their cold brew to meetings"* — the sentence that set `latent_interest` to 0.4 | "The system shows you the sentence that made it believe this." |
| After what-if | Search box: *"who did we lose to opening hours?"* → four rows, day-4 reasoning, and — one hop — what their neighbours told them the day before | "Ask it anything. Every answer is a query over the run, not a guess." |

If Kibana is not running, the in-app panel shows the query JSON and the hit; it is enough.

## 6. Semantic search — only if it buys something

BM25 handles this data: transcripts use the shop names and product words literally. Add a
`dense_vector` on `interviews.text` only if a judge-facing case needs it, e.g. *"who seems
time-pressured?"* matching *"my mornings are tight"* with no shared token. If added: embed at
ingest with any local model (sentence-transformers) so the demo never calls out for embeddings;
`knn` query alongside BM25 with `rank: rrf`. Half a day; decide after §7 step 4 is green.

## 7. Build order

Each step leaves a running demo if you stop there.

| # | Step | Done when | Owner |
| --- | --- | --- | --- |
| 1 | `docker-compose.yml` (ES 8.x single node, security off, 1 GB heap) + `elasticsearch` in `requirements.txt` + `tools/es_up.sh` (waits for green) | `curl :9200` returns cluster info | anyone, 1 h |
| 2 | `raw/` generator: `ingest/make_raw.py` from the existing `data/twins/*.json` → messy CSV/TXT/JSONL with the planted faults in §2. Deterministic seed. **Labelled synthetic in every file header.** | `raw/` exists, faults visible by eye | B2, 2–3 h |
| 3 | `ingest/ingest.py --reset`: mappings + bulk load + normalisation | doc counts match; a dedup query shows the planted duplicates | B2, 2 h |
| 4 | `derive/derive.py --all --write` | `engine.cli --offline` + `check_determinism.sh` still pass; SPEC 7.1 days 1–3 intact | B2 + content, 3–4 h |
| 5 | `index_runs.py` + `analyzer.support`/`select_evidence` via ES, `--no-es` fallback, tests pass both ways | `test_analyzer.py` green with and without `SIMFFEE_ES` | B2, 2–3 h |
| 6 | `analyzer/search.py` + `tools/query_proxy.py` (stdlib `http.server`, one `POST /ask`) + query contract handed to frontend | the three demo questions in §5 return the right rows | B2, 3 h |
| 7 | UI: footnote on evidence cards, search box on screen 4, raw-vs-derived panel on screen 1 | — | frontend |
| 8 | Optional: Kibana container + one saved Discover view; §6 semantic | — | if time |

Steps 1–4 are the story ("messy → people"). Steps 5–6 are the proof ("every answer is a query").
Do not start 7 before 6 has a stable contract.

## 8. Query contract for the frontend (step 6)

```
POST http://localhost:8765/ask
{"question": "who did we lose to opening hours?", "scenario": "baseline", "seed": 0}

200
{"intent": "lost_to",
 "hits": [{"twin": "T01", "name": "Minh", "day": 4, "choice": "starbucks",
           "primary_driver": "hours", "reasoning": "...",
           "heard_yesterday": [{"from": "T02", "shop": "starbucks", "valence": 0.4}],
           "matched_utterance": "Out the door 6:45, latte at Simffee..."}],
 "query": { ...the ES DSL actually run... },
 "took_ms": 7}
```

`query` is returned on purpose: the UI shows it collapsed under the answer, so the judge can see
the answer *is* a query.

## 9. Risks

| Risk | Mitigation |
| --- | --- |
| Infra eats the day; live LLM run still not done | Steps 1–3 are independent of the LLM. Do not start step 4 until B1's live baseline exists — derive changes twin files, which invalidates cache |
| Derived numbers break SPEC 7.1 | Band mapping is tuned to land on today's values; determinism check is the gate. Twin files stay the single source the engine reads, so a bad derive is one `git checkout data/` away from undone |
| Judges see ES as a bolted-on database | The three §5 moments each show a query *producing* a number or an answer. If a moment cannot show that, cut it |
| Docker not on the demo laptop | `--no-es` runs the whole demo minus search; record the ES moments in the backup video |
| Container down mid-pitch | `tools/es_up.sh` on a hotkey; proxy returns `{"error": "search unavailable"}` and the UI hides the box |

## 10. What this does not do

- No pivot to the strategy doc's 500-agent crowd. ES would fit that better (real volume,
  aggregations by grid cell), but it is a second pivot. If the crowd pivot is adopted later,
  `trajectories` already has the mapping for it.
- No NL→Elasticsearch-DSL via LLM. Templates keyed by intent are auditable; generated DSL is not,
  and a wrong query on stage is worse than a missing one.
- No real people's data. `raw/` is generated from the synthetic twins and says so in every file.
