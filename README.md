# Token Radar — pre-token protocols ranked by implied value

An entry for make.fun's **token-radar-01** competition ("Build the best token launch
radar", $1,325, deadline 2026-12-14T10:00:00Z).

## What it does

Reads the sealed DefiLlama snapshot (`input/snapshot.json`, 758 protocols) and ranks
the protocols that have **no token yet** by implied launch value:

```
implied = round( tvl_usd x 0.25
               x (1 + clamp(change_7d, -60, 120) / 100 x 0.5)
               x (0.6 + min(age_days, 1095) / 1095 x 0.4)
               x (1 + 0.03 x min(chains - 1, 5)) )
```

- **Watchlist first:** every protocol in the snapshot's watchlist (TVL ≥ $50M, no
  token on record) is on the board. The early radar adds the 160 strongest
  pre-token protocols below that floor, by TVL.
- **Live tokens kept apart:** protocols that already trade are shown with their
  market cap, never mixed into the ranking.
- **Farm plan per row:** six steps with capital, gas cost and time, derived from
  the protocol's own category, chains, TVL and age — no name is special-cased.
- **Dashboard:** sortable, searchable, filterable by category and chain, with a
  detail view per protocol that recomputes its value from the same formula, says
  in one sentence why it ranks where it does, and a fastest-growers strip on top.
- **Compact board:** `board.json` writes one row object per line (about 200 lines),
  the same JSON the gate reads, without the thousands of lines a pretty print
  would add.

## Run it

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Node 22.18+ (type-stripping, standard library only, no install). Writes
`board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` into
the output directory. Two runs on the same snapshot write identical bytes.

## Layout

- `main.ts` — entrypoint: parses the snapshot, builds the board, copies the
  dashboard and screenshots, writes the dossier.
- `lib/model.ts` — the model (radar-2): scoring, ranking, farm plans, validation.
- `vendor/makefun-board.ts` — make.fun's dossier library, copied verbatim from
  the competition kit.
- `dashboard/` — the static page: `index.html`, `app.css`, `app.js`. No network.
- `screenshots/` — three captures of the dashboard: the board, a detail view,
  a filtered view.

## License

MIT — see `LICENSE`.
