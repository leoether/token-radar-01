// Token Radar, scoring model radar-2. A frozen snapshot goes in; a ranked board
// comes out. The board is built in two layers: the watchlist layer, which holds
// every protocol with at least $50M of locked value and no token yet, and the
// early layer, which pulls in the strongest tokenless protocols under that floor
// — the rows this radar is built to surface. A protocol is tokenless when its
// DefiLlama entry lists no market cap, no CoinGecko id and no symbol. Protocols
// that already trade are kept separate and are shown at their market price;
// they never enter the ranking.
//
// Every row's implied value comes from one formula over the snapshot's own
// numbers, applied the same way to every protocol, with no name ever given
// special treatment:
//
//   base      = tvl_usd x 0.25
//   growthPct = clamp(change_7d, -60, 120)
//   growth    = 1 + (growthPct / 100) x 0.5
//   maturity  = 0.6 + min(age_days, 1095) / 1095 x 0.4   (age unknown: 365 days)
//   reach     = 1 + 0.03 x min(chains - 1, 5)            (1.00 on one chain, 1.15 on six or more)
//   implied   = max(1, round(base x growth x maturity x reach))
//
// The reach term is radar-2's addition to the house model: the same locked value
// spread across more chains touches more wallets and more launch venues, so the
// launch is worth a little more — no more than +15% — taken from the snapshot's
// own `chains` list.

/** A single protocol as the sealed snapshot records it: ten fields, no more. */
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

/** A whole snapshot document, exactly as the sealed file carries it. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's numbers, printed in the dashboard so anyone can re-run them. */
export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  chain_step: number;
  chain_cap_steps: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.25,
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  chain_step: 0.03,
  chain_cap_steps: 5,
};

/** The version the dashboard prints and the rules cite. */
export const MODEL_VERSION = 'radar-2';

/** Early rows the radar adds under the watchlist floor, strongest TVL first. */
export const EARLY_ROWS = 160;

/** Live rows the dashboard's Live view shows, largest market cap first. */
export const LIVE_ROWS = 24;

/** A farm step before flattening: what to do, what it costs, how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json, with its model breakdown and farm plan. */
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
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** A board row slimmed down for data.js; the page rebuilds the plan from it. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
}

/** A protocol whose token already trades: the market sets its price, not the model. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** All the dashboard needs, derived from a single snapshot. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Thrown when a snapshot cannot be scored at all. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const MS_PER_DAY = 86_400_000;

/** The value when it is a finite number, `fallback` for anything else. */
function numOrFallback(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return fallback;
}

/** Full days from `listedAt` up to `asOf`, floored at zero; null if either date is missing. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const asOfMs = Date.parse(`${asOf}T00:00:00Z`);
  const listedMs = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(asOfMs) || !Number.isFinite(listedMs)) return null;
  const span = Math.floor((asOfMs - listedMs) / MS_PER_DAY);
  return span < 0 ? 0 : span;
}

/** Reach: 1.00 on one chain, +0.03 for each further chain, stopping at +0.15. */
export function chainMultiplier(chainCount: number, model: ModelConstants): number {
  const steps = Math.min(Math.max(chainCount - 1, 0), model.chain_cap_steps);
  return 1 + steps * model.chain_step;
}

/** The multipliers and implied value of one protocol under `model`. */
export function scoreProtocol(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; chainMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const reportedGrowth = numOrFallback(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, reportedGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageUsed = age === null ? model.unknown_age_days : age;
  const ageCapped = Math.min(Math.max(ageUsed, 0), model.maturity_days);
  const maturityMult = model.maturity_floor + (ageCapped / model.maturity_days) * model.maturity_range;
  const chainMult = chainMultiplier(protocol.chains.length, model);
  const base = protocol.tvl_usd * model.base_multiple;
  const raw = base * growthMult * maturityMult * chainMult;
  const implied = Math.max(1, Math.round(raw));
  return { implied, growthPct, growthMult, maturityMult, chainMult, age };
}

/** A name trailing off in a release marker is one protocol's versioned pool. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** True when the record shows no token anywhere: no cap, no id, no symbol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** True when the board may rank a protocol: tokenless, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category === 'CEX') return false;
  return !VERSIONED.test(p.name);
}

const round4dp = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The first chain the protocol lists, or a neutral phrase when it lists none. */
function leadingChain(p: SnapshotProtocol): string {
  if (p.chains.length === 0) return 'its main chain';
  return p.chains[0]!;
}

/** The size of one farm position, stepped from the protocol's own TVL. */
function farmCapital(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** The hold window: younger protocols need longer to qualify. */
function holdWindow(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** One category's farm action, matched by keywords in the category name. */
interface FarmAction {
  keys: string[];
  make: (name: string, capital: number, chain: string) => string;
}

const FARM_ACTIONS: FarmAction[] = [
  {
    keys: ['lend', 'cdp', 'collateral'],
    make: (name, capital, chain) => `Lend $${capital} of USDC into ${name} on ${chain} and leave the deposit earning.`,
  },
  {
    keys: ['dex', 'yield', 'leveraged farm'],
    make: (name, capital, chain) => `Add $${capital} of liquidity to ${name}'s main pool on ${chain} and hold the LP position.`,
  },
  {
    keys: ['bridge'],
    make: (name, capital, chain) => `Bridge $${capital} of USDC onto ${chain} with ${name}, then put the bridged funds to work in its app.`,
  },
  {
    keys: ['staking', 'restak'],
    make: (name, capital, chain) => `Stake $${capital} of the chain's staking asset via ${name} and hold the receipt token.`,
  },
  {
    keys: ['perpetual', 'derivative'],
    make: (name, capital, chain) => `Post $${capital} of USDC as margin on ${name} and open one small hedged position.`,
  },
  {
    keys: ['prediction'],
    make: (name, capital, chain) => `Fund ${name} with $${capital} and take one position in an open market.`,
  },
  {
    keys: ['curator', 'allocator'],
    make: (name, capital, chain) => `Place $${capital} into a ${name} vault on ${chain} and hold the vault shares.`,
  },
  {
    keys: ['stable'],
    make: (name, capital, chain) => `Mint or hold $${capital} of the stable asset that ${name} issues on ${chain}.`,
  },
  {
    keys: ['rwa'],
    make: (name, capital, chain) => `Buy $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it.`,
  },
  {
    keys: ['insurance'],
    make: (name, capital, chain) => `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`,
  },
];

/** The farm action for a protocol's category; the generic one when nothing matches. */
function farmAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const category = (p.category ?? '').toLowerCase();
  for (const action of FARM_ACTIONS) {
    const hits = action.keys.some((key) => category.includes(key));
    if (hits) return action.make(p.name, capital, chain);
  }
  return `Put $${capital} of USDC to work in ${p.name} on ${chain} and keep the position open.`;
}

/**
 * Six farm steps for a protocol, built only from its own record — category,
 * chains, TVL and age. No protocol name is ever hand-listed.
 */
export function planFor(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = leadingChain(p);
  const capital = farmCapital(p);
  const hold = holdWindow(age);
  const setupGas = capital >= 150 ? 8 : 4;
  return [
    {
      text: 'Open a fresh wallet for this farm only, fund it with just the capital you plan to use, and store its seed phrase offline.',
      cost: 'under $3 of gas to fund and prepare',
      time: '5 minutes',
    },
    {
      text: farmAction(p, capital, chain),
      cost: `$${capital} of capital and about $${setupGas} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Return once a week and make one qualifying move on ${chain} — a deposit, a borrow, a swap or a vote — so the wallet stays active.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Keep the position open for at least ${hold} days so it spans more than one snapshot of activity.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `When ${p.name} opens a points or rewards page, claim only from the link on its own site, and never pay anyone to claim for you.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: 'Record the wallet address, the dates and every transaction hash in a farm log, so you can repeat the farm or unwind it cleanly.',
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** One step as a single line — action, cost, time — inside the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The ranked board: the watchlist first, early rows added, scored and ordered by value. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const picked = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: each slug on it joins the board, even one the
  // snapshot no longer carries — it cannot, but coverage is the gate's row and
  // is never left to chance.
  for (const slug of snapshot.watchlist) {
    const found = bySlug.get(slug);
    if (found !== undefined) picked.set(slug, found);
  }
  // The early radar: tokenless protocols under the floor, strongest TVL first,
  // capped. A picked protocol stays picked; early rows only ever add.
  const earlyPicks = snapshot.protocols
    .filter((p) => !picked.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => {
      if (b.tvl_usd !== a.tvl_usd) return b.tvl_usd - a.tvl_usd;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    })
    .slice(0, EARLY_ROWS);
  for (const p of earlyPicks) picked.set(p.slug, p);

  const scored = [...picked.values()].map((p) => ({ p, ...scoreProtocol(p, snapshot.as_of, model) }));
  scored.sort((a, b) => {
    if (b.implied !== a.implied) return b.implied - a.implied;
    return a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0;
  });
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
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      base_multiple: model.base_multiple,
      growth_pct: s.growthPct,
      growth_multiplier: round4dp(s.growthMult),
      maturity_multiplier: round4dp(s.maturityMult),
      chain_multiplier: round4dp(s.chainMult),
      age_days: s.age,
    },
    farm_steps: planFor(s.p, s.age).map(stepText),
  }));
}

/** The live-token protocols, largest market cap first, for the Live view. */
export function liveSet(snapshot: Snapshot): LiveRow[] {
  const trading = snapshot.protocols.filter((p) => !isPreToken(p) && p.category !== 'CEX');
  trading.sort((a, b) => {
    const capA = a.mcap_usd ?? 0;
    const capB = b.mcap_usd ?? 0;
    if (capB !== capA) return capB - capA;
    return b.tvl_usd - a.tvl_usd;
  });
  return trading.slice(0, LIVE_ROWS).map((p) => ({
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    mcap_usd: p.mcap_usd,
    change_7d: p.change_7d,
  }));
}

/** A board row slimmed down for data.js; the page rebuilds the farm plan from it. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    chain_multiplier: row.model.chain_multiplier,
  };
}

/** Everything the dashboard renders, from one snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveSet(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** A snapshot out of a file's text, refused unless it has the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new SnapshotError('snapshot.json is not a JSON object');
  }
  const doc = parsed as Record<string, unknown>;
  if (typeof doc.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(doc.as_of)) {
    throw new SnapshotError('snapshot.json has no as_of date');
  }
  if (typeof doc.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  const floor = doc.floor_usd;
  if (typeof floor !== 'number' || !Number.isSafeInteger(floor) || floor <= 0) {
    throw new SnapshotError('snapshot.json has no floor_usd');
  }
  if (!Array.isArray(doc.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(doc.watchlist) || doc.watchlist.some((s) => typeof s !== 'string')) {
    throw new SnapshotError('snapshot.json has no watchlist of slugs');
  }
  const protocols = doc.protocols.map((item, index) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new SnapshotError(`snapshot.json's protocol ${index} is not an object`);
    }
    const entry = item as Record<string, unknown>;
    const slug = entry.slug;
    const name = entry.name;
    const tvl = entry.tvl_usd;
    if (typeof slug !== 'string' || typeof name !== 'string' || typeof tvl !== 'number' || !Number.isFinite(tvl)) {
      throw new SnapshotError(`snapshot.json's protocol ${index} lacks a slug, a name or a TVL`);
    }
    const change = entry.change_7d;
    const mcap = entry.mcap_usd;
    return {
      slug,
      name,
      category: typeof entry.category === 'string' ? entry.category : null,
      chains: Array.isArray(entry.chains) ? entry.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: tvl,
      change_7d: typeof change === 'number' && Number.isFinite(change) ? change : null,
      mcap_usd: typeof mcap === 'number' && Number.isFinite(mcap) ? mcap : null,
      listed_at: typeof entry.listed_at === 'string' ? entry.listed_at : null,
      gecko_id: typeof entry.gecko_id === 'string' ? entry.gecko_id : null,
      symbol: typeof entry.symbol === 'string' ? entry.symbol : null,
    };
  });
  return {
    as_of: doc.as_of,
    source: doc.source,
    floor_usd: floor,
    protocols,
    watchlist: doc.watchlist as string[],
  };
}

/**
 * Why a board is not one the gate will take, or null: coverage, ranks, order, one
 * shared implied value, and farm steps.
 */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) {
    return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  }
  const ranks = board.map((r) => r.rank);
  ranks.sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  }
  for (let i = 1; i < board.length; i++) {
    const prev = board[i - 1]!;
    const curr = board[i]!;
    if (curr.implied_value_usd > prev.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  }
  const first = board[0];
  const last = board[board.length - 1];
  if (board.length >= 2 && first !== undefined && last !== undefined && first.implied_value_usd === last.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${first.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch, no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
