// Token Launch Radar — the valuation and farming model (radar-2).
//
// Idea in one paragraph: a pre-token protocol has no market price, but the
// snapshot itself contains the market's answer for its peers. Protocols that
// already trade reveal, category by category, what one dollar of TVL is
// worth (their market-cap / TVL ratio). This model reads that multiple out
// of the snapshot on every run — nothing is hardcoded per protocol and no
// name is ever special-cased — then adjusts it for the protocol's own
// seven-day TVL momentum, for how long it has operated with no token
// recorded, and for how widely it is deployed across chains. The result is
// an implied fully-diluted value: what a launch would be worth if the
// protocol's record stayed exactly as the snapshot shows it.
//
// Board selection: every watchlist slug (the floor), plus every other
// rankable pre-token protocol below the floor (the early radar). A protocol
// counts as pre-token only when DefiLlama records no token for it at all:
// no market cap, no CoinGecko id and no symbol. Protocols whose token
// already trades are never ranked; they are carried separately as the
// live comparison set that also calibrates the category multiples.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface ModelConstants {
  /** Weight of the category peer multiple vs the all-market median. */
  category_weight: number;
  /** Peer multiples are clamped into this band before blending. */
  multiple_floor: number;
  multiple_cap: number;
  /** Minimum live peers before a category multiple is trusted. */
  min_peers: number;
  /** Momentum: implied scales by 1 + clamped change * this weight. */
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  /** Maturity: from maturity_floor up by maturity_range over maturity_days. */
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  /** Breadth: each extra chain adds this, capped at breadth_cap. */
  breadth_per_chain: number;
  breadth_cap: number;
}

export const MODEL: ModelConstants = {
  category_weight: 0.65,
  multiple_floor: 0.04,
  multiple_cap: 1.3,
  min_peers: 3,
  growth_weight: 0.6,
  growth_floor: -50,
  growth_cap: 60,
  maturity_floor: 0.65,
  maturity_range: 0.35,
  maturity_days: 1095,
  unknown_age_days: 300,
  breadth_per_chain: 0.03,
  breadth_cap: 1.15,
};

export const MODEL_VERSION = 'radar-2';

export interface CategoryStat {
  category: string;
  peers: number;
  median_multiple: number;
  blended_multiple: number;
}

export interface Breakdown {
  peer_multiple: number;
  category_peers: number;
  growth_pct: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  age_days: number | null;
}

export type Tier = 'Prime' | 'Promising' | 'Speculative' | 'Watch';

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  on_watchlist: boolean;
  farm_capital_usd: number;
  age_days: number | null;
  implied_value_usd: number;
  signal_score: number;
  tier: Tier;
  risk_flags: string[];
  model: Breakdown;
  farm_steps: string[];
}

export interface RadarRow extends BoardRow {}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  symbol: string | null;
  multiple: number | null;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  scanned_size: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  total_implied_usd: number;
  global_multiple: number;
  categories: CategoryStat[];
  rows: RadarRow[];
  live: LiveRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const end = Date.parse(`${asOf}T00:00:00Z`);
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(end) || !Number.isFinite(start)) return null;
  return Math.max(0, Math.floor((end - start) / DAY_MS));
}

/** True when the snapshot records no token at all for the protocol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Rankable pre-token subjects: no exchange itself, no versioned pool of another protocol. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * The market's own pricing, read from the snapshot: for every category with
 * enough live-token peers, the median market-cap / TVL of those peers,
 * blended toward the all-market median so thin categories stay honest.
 */
export function categoryMultiples(snapshot: Snapshot, model: ModelConstants = MODEL): { global: number; stats: Map<string, CategoryStat> } {
  const live = snapshot.protocols.filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const global = live.length > 0 ? median(live.map((p) => p.mcap_usd! / p.tvl_usd)) : 0.2;
  const byCategory = new Map<string, number[]>();
  for (const p of live) {
    const key = p.category ?? 'Uncategorised';
    const list = byCategory.get(key) ?? [];
    list.push(p.mcap_usd! / p.tvl_usd);
    byCategory.set(key, list);
  }
  const stats = new Map<string, CategoryStat>();
  for (const [category, ratios] of byCategory) {
    const med = median(ratios);
    const trusted = ratios.length >= model.min_peers;
    const blended = trusted
      ? clamp(model.category_weight * clamp(med, model.multiple_floor, model.multiple_cap) + (1 - model.category_weight) * global, model.multiple_floor, model.multiple_cap)
      : clamp(global, model.multiple_floor, model.multiple_cap);
    stats.set(category, { category, peers: ratios.length, median_multiple: round4(med), blended_multiple: round4(blended) });
  }
  return { global: round4(global), stats };
}

/** One protocol's implied value and the exact multipliers that produced it. */
export function impliedValue(
  p: SnapshotProtocol,
  asOf: string,
  stats: Map<string, CategoryStat>,
  globalMultiple: number,
  model: ModelConstants = MODEL,
): { implied: number; breakdown: Breakdown } {
  const stat = stats.get(p.category ?? 'Uncategorised');
  const peerMultiple = stat !== undefined ? stat.blended_multiple : clamp(globalMultiple, model.multiple_floor, model.multiple_cap);
  const growthPct = p.change_7d === null ? 0 : clamp(p.change_7d, model.growth_floor, model.growth_cap);
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const age = ageDays(asOf, p.listed_at);
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (clamp(ageForModel, 0, model.maturity_days) / model.maturity_days) * model.maturity_range;
  const breadthMult = Math.min(model.breadth_cap, 1 + Math.max(0, p.chains.length - 1) * model.breadth_per_chain);
  const implied = Math.max(1, Math.round(p.tvl_usd * peerMultiple * growthMult * maturityMult * breadthMult));
  return {
    implied,
    breakdown: {
      peer_multiple: peerMultiple,
      category_peers: stat !== undefined ? stat.peers : 0,
      growth_pct: round4(growthPct),
      growth_multiplier: round4(growthMult),
      maturity_multiplier: round4(maturityMult),
      breadth_multiplier: round4(breadthMult),
      age_days: age,
    },
  };
}

/** Plain-language risks a farmer should see before spending anything. */
export function riskFlags(p: SnapshotProtocol, age: number | null): string[] {
  const flags: string[] = [];
  if (p.change_7d !== null && p.change_7d <= -10) flags.push(`TVL fell ${Math.abs(p.change_7d).toFixed(1)}% in 7 days — momentum is against it; size down or wait for a green week.`);
  if (p.change_7d === null) flags.push('No 7-day TVL change is reported, so momentum is unverified — recheck TVL on DefiLlama before adding capital.');
  if (age !== null && age < 90) flags.push(`Only ${age} days tracked — a very young record; keep the position small until it survives a full quarter.`);
  if (age === null) flags.push('No listing date is recorded, so its age and maturity are estimated, not measured.');
  if (p.chains.length <= 1) flags.push('Live on a single chain — one bridge or chain incident can strand the whole position.');
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('bridge')) flags.push('Bridge category — bridge contracts are a top exploit target; never park more than the farm needs.');
  if (c.includes('staking') || c.includes('restaking')) flags.push('Staking category — the position can carry slashing and lock-up risk on top of smart-contract risk.');
  if (c.includes('leverage') || c.includes('derivative') || c.includes('perpetual')) flags.push('Leverage is available here — farm with spot deposits only; leveraged positions can be liquidated before any launch.');
  if (flags.length === 0) flags.push('No structural flag from the snapshot: established record, reported momentum and more than one chain. Contract risk still applies.');
  return flags;
}

/**
 * A 0–100 opportunity signal, separate from value: it blends scale (log TVL),
 * momentum, maturity and breadth so the dashboard can tier rows without
 * disturbing the value ranking.
 */
export function signalScore(p: SnapshotProtocol, age: number | null): number {
  const scale = clamp((Math.log10(Math.max(p.tvl_usd, 1)) - 6.7) / 2.6, 0, 1) * 40;
  const momentum = clamp(((p.change_7d ?? 0) + 15) / 40, 0, 1) * 25;
  const maturity = clamp((age ?? 300) / 1095, 0, 1) * 20;
  const breadth = clamp(p.chains.length / 6, 0, 1) * 15;
  return Math.round(scale + momentum + maturity + breadth);
}

export function tierFor(score: number): Tier {
  if (score >= 72) return 'Prime';
  if (score >= 55) return 'Promising';
  if (score >= 38) return 'Speculative';
  return 'Watch';
}

/** Gas for one transaction, by the family of the protocol's first chain. */
function gasProfile(chain: string): { label: string; setup: number; weekly: number } {
  const cheap = ['Solana', 'Base', 'Arbitrum', 'Optimism', 'Polygon', 'Avalanche', 'Binance', 'Stellar', 'Algorand', 'Ripple', 'Sui', 'Aptos', 'Near', 'Tron'];
  if (cheap.includes(chain)) return { label: chain, setup: 1, weekly: 1 };
  if (chain === 'Ethereum') return { label: chain, setup: 12, weekly: 6 };
  return { label: chain, setup: 3, weekly: 2 };
}

function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 250_000_000) return 200;
  if (p.tvl_usd >= 50_000_000) return 150;
  if (p.tvl_usd >= 15_000_000) return 100;
  return 50;
}

function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 540) return 45;
  return 30;
}

/** The category's core farming action, phrased so a reader can do it today. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${n} on ${chain}; if it offers borrowing, borrow at most 30% against it once so the account shows two-sided use`;
  if (c.includes('dex') || c.includes('liquidity')) return `Add $${capital} as balanced liquidity to ${n}'s highest-TVL pool on ${chain} and leave the LP position untouched`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC from Ethereum to ${chain} through ${n}, then make one swap with the bridged funds at the destination`;
  if (c.includes('staking') || c.includes('restaking')) return `Stake $${capital} worth of the chain's native staking asset through ${n} and keep the liquid receipt token in the same wallet`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${n} and trade one small hedged pair (long and short of equal size) so volume is real but risk stays flat`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('yield')) return `Deposit $${capital} into the largest ${n} vault on ${chain} and keep the vault shares; do not chase the highest-APY vault`;
  if (c.includes('rwa')) return `Mint $${capital} of ${n}'s yield-bearing asset on ${chain} after its eligibility check, and hold the asset in the farming wallet`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${n} on ${chain} and park it in the protocol's own earn vault if one exists`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${n} on ${chain} for the longest term offered and keep the policy NFT in the wallet`;
  if (c.includes('chain')) return `Bridge $${capital} to ${chain}, hold a native balance, and use two native apps on ${n} so the wallet reads as a real chain user`;
  if (c.includes('payment')) return `Route one real payment of about $${capital} through ${n} and keep a small working balance on it afterwards`;
  return `Deposit $${capital} of USDC into ${n}'s main product on ${chain} and keep the position open and untouched`;
}

/**
 * Seven concrete steps per protocol: wallet hygiene, the core action, a
 * weekly cadence, a hold window, governance/community presence, a safety
 * check, and a log-and-exit step — each with its cost and its time.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const gas = gasProfile(chain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const weeklyTotal = Math.ceil(hold / 7);
  const steps = [
    `Set up one fresh wallet for ${p.name} only, back its seed phrase up offline, and fund it with $${capital + gas.setup * 2} on ${chain}. Cost: about $${gas.setup} of gas to fund and approve. Time: 10 minutes, once.`,
    `${actionFor(p, capital, chain)}. Cost: $${capital} of capital plus about $${gas.setup} of gas. Time: 15 minutes to set up.`,
    `Repeat one small qualifying action every week — a deposit top-up, a swap, a vote or a claim — for ${weeklyTotal} weeks. Cost: about $${gas.weekly} of gas a week. Time: 10 minutes a week.`,
    `Hold the position for at least ${hold} days without withdrawing, so the wallet appears in several weekly snapshots instead of one. Cost: the $${capital} stays deployed and exposed to the protocol. Time: ${hold} days.`,
    `Join ${p.name}'s official community channels from its own website, complete any public testnet, points or governance tasks it lists there. Cost: free; never pay a third party for tasks. Time: 20 minutes a week.`,
    `Once a month, verify on the protocol's own site and DefiLlama that it still records no token and TVL has not halved; if either changes, stop adding and reassess. Cost: nothing. Time: 10 minutes a month.`,
    `Keep a farm log (wallet, dates, amounts, transaction hashes) and, if a token launches, claim only from the link the protocol itself publishes. Cost: nothing; unofficial claim links are the main scam. Time: 5 minutes per entry.`,
  ];
  return steps.map((s) => (s.length > 600 ? `${s.slice(0, 596)}...` : s));
}

export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const { global, stats } = categoryMultiples(snapshot, model);
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1));
  for (const p of early) chosen.set(p.slug, p);

  const watch = new Set(snapshot.watchlist);
  const scored = [...chosen.values()].map((p) => {
    const { implied, breakdown } = impliedValue(p, snapshot.as_of, stats, global, model);
    const score = signalScore(p, breakdown.age_days);
    return { p, implied, breakdown, score };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : 1));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    on_watchlist: watch.has(s.p.slug),
    farm_capital_usd: capitalFor(s.p),
    age_days: s.breakdown.age_days,
    implied_value_usd: s.implied,
    signal_score: s.score,
    tier: tierFor(s.score),
    risk_flags: riskFlags(s.p, s.breakdown.age_days),
    model: s.breakdown,
    farm_steps: farmSteps(s.p, s.breakdown.age_days),
  }));
}

/** The live comparison set: tokens that already trade, by market cap, never ranked. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, 30)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      symbol: p.symbol,
      multiple: p.tvl_usd > 0 && p.mcap_usd !== null ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const { global, stats } = categoryMultiples(snapshot, model);
  const categories = [...stats.values()]
    .filter((s) => s.peers >= model.min_peers)
    .sort((a, b) => b.peers - a.peers || (a.category < b.category ? -1 : 1))
    .slice(0, 14);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    scanned_size: snapshot.protocols.length,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !r.on_watchlist).length,
    live_size: live.length,
    total_implied_usd: board.reduce((sum, r) => sum + r.implied_value_usd, 0),
    global_multiple: global,
    categories,
    rows: board,
    live,
  };
  return { board, radar };
}

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100) return `the board holds ${board.length} rows, under the 100-row floor`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return 'all rows share one implied value';
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
