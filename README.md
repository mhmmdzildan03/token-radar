# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/mhmmdzildan03/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/mhmmdzildan03/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it scans all 758 protocols in the sealed DefiLlama snapshot, finds the ones that record no token yet, and ranks 226 of them by implied launch value — all 40 house-watchlist protocols plus 186 early finds below the $50M floor. The value model (radar-2, in lib/model.ts) prices each protocol from the snapshot's own live-token peers: implied = TVL × category peer multiple (median market cap ÷ TVL of live protocols in the same category, blended with the all-market median) × 7-day momentum × maturity (days tracked with no token) × chain breadth. Nothing is hardcoded per protocol, so a future snapshot reprices itself. The static dashboard (no network, no framework) is sortable and filterable by category, chain, tier and watchlist, with a detail view per protocol showing the full value breakdown, risk flags and a 7-step farm plan with costs and times; protocols whose token already trades are shown separately as the comparison set that calibrates the multiples.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
# then open out/dashboard/index.html in a browser
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=n8m845w8&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
