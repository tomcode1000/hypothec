// The API behind the borrower app and the lending desks (web/), and the static server for
// them. Any wallet can open a desk and post an order (D14). A borrower fills one borrow from
// several desks' orders on one page (D16): each piece becomes its own loan, with its own
// vault and that desk's terms, and the pieces are locked together.
//
// Base actions are signed in the browser by the wallet each person connects: a desk posts
// and signs its terms and funds; the borrower accepts, signs and repays. This process
// holds no Base key for them. It prepares what they sign, checks each claim against the
// chain before recording it, relays signed entries to the loanbook, and drives the Zcash
// side through each loan's party services (the borrower's and the desk's key shares; the
// referees run on their own, serve.ts).
//   ts-node src/api.ts          -> http://127.0.0.1:7910
// Needs e2e/stack.sh and serve.ts running.
import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { existsSync, readFileSync, statSync } from "fs";
import { extname, join, normalize, sep } from "path";
import { getAddress, isAddress, type Hex } from "viem";
import { chainNow, getLoan, isOverdue, usdcBalance } from "./base";
import { BASE_ADDRESS, baseAddress, EXPLORER, LOANS, TEST_ZEC_ADDRESS, USDC } from "./config";
import { CHAIN } from "./chains";
import {
  borrowerRelease, buildOffer, keySetup, lenderCancel, lenderFund, lenderLiquidate, lenderOffer, loanbook,
  lockManyFromTestWallet, setPriceOverride, testLenderOf, topUpFromTestWallet,
} from "./actions";
import { DEMO_TERMS, MIN_TERM_SECONDS, quote, topUpToStartZat, type DeskTerms } from "./desks";
import { ONLINE_MS, offerDigest, type Accept, type LoanDoc, type Offer } from "./loanbook";
import { partyFor } from "./party";
import { MAX_FEE_ZAT, lenderShareZat, liquidationReason, ltvBps } from "./policy";
import { zecPrice } from "./price";
import { termsOf } from "./referee";
import { ZEC_ADDRESS, ZEC_PREFIX } from "./zec";

const PORT = Number(process.env.HYPOTHEC_API_PORT ?? 7910);
/// Localhost unless told otherwise (the hosted demo binds every interface behind HTTPS).
const HOST = process.env.HYPOTHEC_API_HOST ?? "127.0.0.1";
/// On the public site the demo price override needs this token: without it any visitor
/// could crash the price and liquidate other people's loans.
const PUBLIC = process.env.HYPOTHEC_PUBLIC === "1";
const DEMO_TOKEN = process.env.HYPOTHEC_DEMO_TOKEN ?? "";
const WEB = join(__dirname, "..", "..", "web", "dist");
/// Testnet faucet limits: at most this much in one borrow, in at most this many pieces.
const MAX_BORROW_USDC = 15_000_000n;
const MAX_PIECES = 4;

/// One borrow, filled from several desks. A piece has a loan once its desk posted an offer.
interface Basket {
  id: string;
  borrower: Hex;
  usdcAddress: Hex;
  at: number;
  pieces: { desk: Hex; principalUsdc: bigint; loan?: Hex }[];
}
const baskets: Basket[] = [];
/// Offers a desk's wallet is about to post and sign, by loan id.
const prepared = new Map<Hex, { offer: Offer; basket: string; piece: number }>();

/*
  Zcash-side work (making a vault, locking, releasing, liquidating) runs as jobs, one at a
  time in order: each takes minutes and drives several party services. Screens poll
  /api/state for each job's outcome.
*/
interface Job { id: number; name: string; loans: Hex[]; running: boolean; done: boolean; error?: string; result?: unknown; at: number }
const jobs: Job[] = [];
let queue: Promise<unknown> = Promise.resolve();

function run(name: string, loans: Hex[], f: () => Promise<unknown>) {
  const clash = jobs.find((j) => !j.done && j.name === name && j.loans.some((l) => loans.includes(l)));
  if (clash) throw new Error(`${name} is already under way for this loan`);
  const job: Job = { id: jobs.length + 1, name, loans, running: false, done: false, at: Date.now() };
  jobs.push(job);
  queue = queue.then(async () => {
    job.running = true;
    try {
      job.result = await f();
    } catch (e) {
      job.error = (e as Error).message;
    } finally {
      Object.assign(job, { running: false, done: true });
    }
  });
  return { started: name, job: job.id };
}

const big = (_: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const deskOf = <D extends { owner: string }>(desks: D[], owner?: string) => (owner ? desks.find((d) => same(d.owner, owner)) ?? null : null);
const OPEN = ["Offered", "Accepted", "Funded", "Active", "Repaid"];

/// A loan is over once its ZEC went back (released) or was liquidated, or it was cancelled
/// with an empty vault. A cancelled loan whose vault holds ZEC (a lock that never completed)
/// stays open until the borrower takes the ZEC back.
const ended = (doc: LoanDoc, onchain: string, vaultZat: bigint) =>
  doc.status === "Released" || onchain === "Liquidated" || (onchain === "Cancelled" && vaultZat === 0n);
/// The contract states in which the vault's ZEC goes back to the borrower.
const RELEASABLE = ["Repaid", "Cancelled"];

/// Baskets survive an API restart through the loanbook: each loan names its basket.
async function recoverBaskets() {
  for (const doc of await loanbook.all().catch(() => [] as LoanDoc[])) {
    if (!doc.basket) continue;
    let b = baskets.find((x) => x.id === doc.basket);
    if (!b) {
      b = { id: doc.basket, borrower: doc.offer.borrower, usdcAddress: doc.offer.borrower, at: doc.updatedAt, pieces: [] };
      baskets.push(b);
    }
    if (!b.pieces.some((p) => p.loan === doc.id)) b.pieces.push({ desk: doc.offer.lender, principalUsdc: BigInt(doc.offer.principalUsdc), loan: doc.id });
  }
}

/* --------------------------------------------------------------- state -- */

type Price = Awaited<ReturnType<typeof zecPrice>> | { error: string };

/// The guardians accept a lock once it has this many confirmations (the wallet's spendable rule).
const LOCK_CONFIRMATIONS = 10;
const firstSeen = new Map<string, number>();

async function loanView(doc: LoanDoc, desks: DeskTerms[], price: Price) {
  const onchain = await getLoan(doc.id);
  const overdue = onchain.statusName === "Active" ? await isOverdue(doc.id) : false;
  // The borrower's own key share reads the vault through the viewing key.
  const balance = doc.vault ? await (await partyFor(doc.id, "borrower")).balance().catch(() => null) : null;
  const events = await loanbook.events(doc.id);
  const checks = doc.vault ? await guardianChecks(doc, onchain, price, overdue).catch(() => null) : null;
  const vaultZat = balance ? BigInt(balance.total_zat) : 0n;
  // Confirmations of the lock, for the lock screen: the chain height when the vault first
  // showed a balance is (within a block, as this runs every few seconds) the height it was
  // mined at. Full once the whole collateral is spendable (the guardians' 10).
  const height = balance ? Number(balance.height) : 0;
  if (vaultZat > 0n && height && !firstSeen.has(doc.id)) firstSeen.set(doc.id, height);
  const required = BigInt(doc.offer.collateralZat);
  const spendable = balance ? BigInt(balance.spendable_zat) : 0n;
  const confirmations = spendable >= required ? LOCK_CONFIRMATIONS
    : vaultZat > 0n && firstSeen.has(doc.id) ? Math.max(1, Math.min(LOCK_CONFIRMATIONS - 1, height - firstSeen.get(doc.id)! + 1)) : 0;
  const owed = BigInt(doc.offer.owedUsdc) - onchain.repaid;
  let risk = null;
  if ("microUsd" in price) {
    // The levels are in the lender's signed offer, so they show before acceptance too.
    const t = termsOf({ ...doc, accept: doc.accept ?? { offerDigest: "0x", borrowerZec: "" } });
    const zat = vaultZat > 0n ? vaultZat : t.collateralZat;
    const atLtv = (bps: bigint) => Number((owed * 100_000_000n * 10_000n) / (zat * bps)) / 1e6; // price where LTV = bps
    // Back to the desk's start LTV: the offer does not carry it, so use the desk's
    // published one (the borrower can add any amount; this is the suggestion).
    const startLtvBps = BigInt(deskOf(desks, doc.offer.lender)?.startLtvBps ?? DEMO_TERMS.startLtvBps);
    risk = {
      ltvBps: Number(ltvBps(owed, zat, price.microUsd)),
      marginPriceUsd: atLtv(t.marginLtvBps),
      liquidationPriceUsd: atLtv(t.liquidationLtvBps),
      liquidationRule: onchain.statusName === "Active" && vaultZat > 0n ? liquidationReason(t, vaultZat, price.microUsd, overdue) : null,
      topUpZat: vaultZat > 0n ? topUpToStartZat(owed, vaultZat, price.microUsd, startLtvBps) : 0n,
    };
  }
  return {
    id: doc.id,
    basket: doc.basket ?? null,
    desk: doc.offer.lender,
    deskName: deskOf(desks, doc.offer.lender)?.name ?? "Desk",
    offer: doc.offer,
    offerDigest: offerDigest(doc.id, doc.offer),
    accepted: !!doc.accept,
    borrowerZec: doc.accept?.borrowerZec ?? null,
    vault: doc.vault?.address ?? null,
    loanbookStatus: doc.status,
    onchain: { status: onchain.statusName, repaid: onchain.repaid, payoutTo: onchain.payoutTo, lockA: onchain.lockA, lockB: onchain.lockB, liqA: onchain.liqA, liqB: onchain.liqB },
    ended: ended(doc, onchain.statusName, vaultZat),
    vaultZat,
    spendableZat: balance?.spendable_zat ?? 0,
    confirmations,
    confirmationsNeeded: LOCK_CONFIRMATIONS,
    overdue,
    risk,
    checks,
    events,
  };
}

async function state() {
  const price = await zecPrice().catch((e: Error) => ({ error: e.message }));
  const terms = (await loanbook.desks()).map((d) => d.terms);
  // The operator list: each guardian as it registered, and whether its heartbeat is recent.
  const guardians = (await loanbook.guardians()).map((g) => ({ ...g.info, lastSeen: g.lastSeen, online: Date.now() - g.lastSeen < ONLINE_MS }));
  const docs = (await loanbook.all()).sort((a, b) => a.updatedAt - b.updatedAt);
  const loans = await Promise.all(docs.map((d) => loanView(d, terms, price)));
  const sizing = "microUsd" in price ? Number(price.microUsd) / 1e6 : null;

  // What is left of each desk's order: its size less its open loans and the pieces
  // borrowers asked of it that it has not answered yet. A desk lends no more than its
  // wallet holds either.
  const desks = await Promise.all(
    terms.map(async (t) => {
      const wallet = await usdcBalance(t.owner).catch(() => null);
      const lent = loans.filter((l) => same(l.desk, t.owner) && OPEN.includes(l.onchain.status) && !l.ended).reduce((a, l) => a + BigInt(l.offer.principalUsdc), 0n);
      const asked = baskets.flatMap((b) => b.pieces).filter((p) => !p.loan && same(p.desk, t.owner)).reduce((a, p) => a + p.principalUsdc, 0n);
      let remaining = BigInt(t.maxUsdc) - lent - asked;
      if (remaining < 0n) remaining = 0n;
      const availableUsdc = wallet === null ? remaining : wallet < remaining ? wallet : remaining;
      return { ...t, walletUsdc: wallet, lentUsdc: lent, askedUsdc: asked, availableUsdc, instant: AGENTS && testLenderOf(t.owner) !== null };
    }),
  );

  const basketViews = baskets.map((b) => ({
    id: b.id,
    borrower: b.borrower,
    usdcAddress: b.usdcAddress,
    at: b.at,
    pieces: b.pieces.map((p, i) => {
      const d = deskOf(desks, p.desk);
      return {
        index: i,
        desk: p.desk,
        deskName: d?.name ?? "Desk",
        principalUsdc: p.principalUsdc,
        loan: p.loan ?? null,
        quote: d && sizing !== null ? quote(p.principalUsdc, sizing, d) : null,
        aprBps: d?.aprBps ?? null,
        termSeconds: d?.termSeconds ?? null,
      };
    }),
  }));

  return {
    desks,
    guardians,
    guardianFeeBps: 10,
    baskets: basketViews,
    loans,
    jobs: jobs.slice(-20),
    minTermSeconds: MIN_TERM_SECONDS,
    maxBorrowUsdc: MAX_BORROW_USDC,
    maxPieces: MAX_PIECES,
    sizingPriceUsd: sizing,
    price,
    explorer: EXPLORER,
    // The dollar side's chain: the browser wallet builds its client from this.
    chain: {
      id: CHAIN.chain.id, key: CHAIN.key, label: CHAIN.label, short: CHAIN.short, rpcs: CHAIN.rpcs, explorer: CHAIN.explorer,
      symbol: CHAIN.stable.symbol, permitName: CHAIN.stable.permitName, permitVersion: CHAIN.stable.permitVersion, faucets: CHAIN.faucets,
      mintable: !!CHAIN.stable.mintable,
      loans: LOANS, usdc: USDC, zecPrefix: ZEC_PREFIX,
    },
    addresses: BASE_ADDRESS,
    // On this test chain the parties may not have Zcash wallets that reach it; these are
    // the test wallets' addresses, offered on screen and labelled as such.
    testnet: {
      borrowerZec: TEST_ZEC_ADDRESS.borrower,
      lenderZec: TEST_ZEC_ADDRESS.lender,
      lenderZecByWallet: { [BASE_ADDRESS.lender.toLowerCase()]: TEST_ZEC_ADDRESS.lender },
      lender2Zec: TEST_ZEC_ADDRESS.lender2,
      lender2Address: baseAddress("lender2"),
      deskTerms: DEMO_TERMS,
    },
  };
}

/*
  What the guardians check, stage by stage, with the same rule functions they run
  (policy.ts), and what each of them actually signed (their signed log entries). Each
  check is ok (true), failed (false) or not yet decidable (null), with a plain detail.
  Read from Guardian A's own party service for this loan, as Guardian A sees the vault.
*/
type Check = { label: string; ok: boolean | null; detail: string };
async function guardianChecks(doc: LoanDoc, onchain: Awaited<ReturnType<typeof getLoan>>, price: Price, overdue: boolean) {
  const on = onchain.statusName;
  const zec = (z: bigint | number) => `${Number(z) / 1e8} ZEC`;
  const guardian = await partyFor(doc.id, "refereeA");
  const view = await guardian.vault().catch(() => null);
  const bal = view ? await guardian.balance().catch(() => null) : null;
  const spends = view ? await guardian.spends().catch(() => []) : [];
  const required = BigInt(doc.offer.collateralZat);
  const spendable = bal ? BigInt(bal.spendable_zat) : 0n;
  const total = bal ? BigInt(bal.total_zat) : 0n;

  const lock: Check[] = [
    { label: "It is the vault all four made", ok: view && doc.vault ? view.address === doc.vault.address : null, detail: doc.vault ? `${doc.vault.address.slice(0, 14)}…` : "not made yet" },
    { label: "Any 3 of the 4 keys move it", ok: view ? view.threshold === 3 && view.members === 4 : null, detail: view ? `${view.threshold} of ${view.members}` : "not made yet" },
    { label: "The desk funded the contract", ok: ["Funded", "Active", "Repaid", "Liquidated"].includes(on) ? true : null, detail: on },
    { label: "The full collateral is in the vault", ok: view ? (total >= required ? true : null) : null, detail: `${zec(total)} of ${zec(required)}` },
    { label: "Confirmed on the chain, not pending", ok: view ? (spendable >= required ? true : null) : null, detail: `${zec(spendable)} confirmed` },
  ];

  const open = spends.find((x) => x.status === "Open" || x.status === "Approved") ?? spends.find((x) => x.txid);
  const borrowerZec = doc.accept?.borrowerZec;
  const isLiq = open ? open.outputs.some((o) => o.address === doc.offer.lenderZec) : false;

  const release: Check[] = [
    on === "Cancelled"
      ? { label: "The contract says cancelled", ok: true, detail: "the lock never completed; no USDC was paid out" }
      : { label: "The contract says repaid", ok: on === "Repaid" ? true : on === "Liquidated" ? false : null, detail: `${Number(onchain.repaid) / 1e6} of ${Number(doc.offer.owedUsdc) / 1e6} USDC repaid` },
  ];
  if (open && !isLiq) {
    const o = open.outputs;
    release.push(
      { label: "It pays only the borrower's signed address", ok: o.length === 1 && o[0].address === borrowerZec, detail: o.length === 1 ? `${o[0].address.slice(0, 14)}…` : `${o.length} outputs` },
      { label: "It returns everything but the fee", ok: o.length === 1 && BigInt(o[0].amount_zat) >= total - MAX_FEE_ZAT, detail: o.length === 1 ? zec(o[0].amount_zat) : "—" },
    );
  } else {
    release.push({ label: "The borrower asked for the ZEC back", ok: null, detail: "no release proposed yet" });
  }

  const liquidation: Check[] = [];
  if ("microUsd" in price) {
    const why = on === "Active" && total > 0n ? liquidationReason(termsOf({ ...doc, accept: doc.accept ?? { offerDigest: "0x", borrowerZec: "" } }), total, price.microUsd, overdue) : null;
    const lev = Number(doc.offer.liquidationLtvBps) / 100;
    // Not met is the normal state of a healthy loan: shown as waiting, not as a failure.
    const priceNote = `$${(Number(price.microUsd) / 1e6).toFixed(2)} (${price.source === "override" ? "demo override" : "live"})`;
    liquidation.push({ label: `A published rule is met (LTV at ${lev}% or past the deadline)`, ok: why ? true : null, detail: why ? `${why} at ${priceNote}` : `not met: the loan is healthy at ${priceNote}` });
    if (open && isLiq) {
      const owedNow = BigInt(doc.offer.owedUsdc) - onchain.repaid;
      const maxShare = lenderShareZat(owedNow, price.microUsd, BigInt(doc.offer.slippageBps));
      const toDesk = open.outputs.filter((x) => x.address === doc.offer.lenderZec).reduce((a, x) => a + BigInt(x.amount_zat), 0n);
      const toBorrower = open.outputs.filter((x) => x.address === borrowerZec).reduce((a, x) => a + BigInt(x.amount_zat), 0n);
      liquidation.push(
        { label: "The desk gets at most what it is owed", ok: toDesk <= maxShare, detail: `${zec(toDesk)} (max ${zec(maxShare)})` },
        { label: "The rest goes to the borrower, in the same transaction", ok: toDesk + toBorrower >= total - MAX_FEE_ZAT, detail: `${zec(toBorrower)} back to the borrower's signed address` },
      );
    } else {
      liquidation.push({ label: "The desk proposed a liquidation", ok: null, detail: "none proposed" });
    }
  } else {
    liquidation.push({ label: "A price from at least 3 exchanges", ok: false, detail: price.error });
  }
  return { lock, release, liquidation };
}

/*
  One state refresh at a time. Base's public RPC and the exchanges can take tens of
  seconds to answer; rather than let every 2-second poll start another slow read, the
  API serves the last good snapshot at once (with its age) and refreshes behind it.
*/
let snap: { at: number; state: unknown } | null = null;
let inflight: Promise<unknown> | null = null;

function refreshState() {
  inflight ??= state()
    .then((s) => (snap = { at: Date.now(), state: s }))
    .finally(() => (inflight = null));
  return inflight;
}

async function snapshot() {
  if (!snap) await refreshState();
  else refreshState().catch(() => undefined);
  return { ...(snap!.state as object), asOf: snap!.at };
}

/// The public RPC can lag a block behind the wallet's: wait until it shows the status.
async function onchainStatus(id: Hex, want: string) {
  for (let i = 0; i < 10; i++) {
    const l = await getLoan(id);
    if (l.statusName === want) return l;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`the loan is not ${want} on Base`);
}

/* ------------------------------------------------------------- actions -- */

async function loanDoc(body: Record<string, unknown>) {
  const id = String(body.loan ?? "") as Hex;
  if (!/^0x[0-9a-fA-F]{64}$/.test(id)) throw new Error("which loan?");
  return loanbook.get(id);
}

/// A borrower's borrow that is still going: a piece not yet offered, or a loan not over.
async function openBasketOf(borrower: string) {
  const docs = await loanbook.all();
  for (const b of baskets.filter((x) => same(x.borrower, borrower))) {
    for (const p of b.pieces) {
      if (!p.loan) return b;
      const doc = docs.find((d) => d.id === p.loan);
      if (!doc) continue;
      const on = (await getLoan(doc.id)).statusName;
      // A cancelled loan still holding ZEC keeps its borrow open until the ZEC goes back.
      const zat = on === "Cancelled" && doc.vault ? BigInt((await (await partyFor(doc.id, "borrower")).balance().catch(() => ({ total_zat: 0 }))).total_zat) : 0n;
      if (!ended(doc, on, zat)) return b;
    }
  }
  return null;
}

async function act(path: string, body: Record<string, unknown>) {
  switch (path) {
    /* ---------------------------------------------------------- borrower -- */
    case "/api/borrower/request": {
      // One borrow, split across the desks the borrower picked (D16).
      const borrower = String(body.borrower ?? "");
      if (!isAddress(borrower)) throw new Error("connect your wallet first");
      const to = String(body.usdcAddress || borrower);
      if (!isAddress(to)) throw new Error("the USDC address is not a Base address");
      const asked = (Array.isArray(body.pieces) ? body.pieces : []) as { desk?: string; amountUsdc?: number | string }[];
      if (!asked.length) throw new Error("pick at least one desk's order");
      if (asked.length > MAX_PIECES) throw new Error(`at most ${MAX_PIECES} desks in one borrow`);
      if (await openBasketOf(borrower)) throw new Error("finish your current borrow first");
      // Against the last snapshot (seconds old), less what was asked of each desk since:
      // quick, and two requests still cannot both take what is left.
      const s = (await snapshot()) as Awaited<ReturnType<typeof state>> & { asOf: number };
      const askedSince = (owner: string) =>
        baskets.filter((x) => x.at > s.asOf).flatMap((x) => x.pieces).filter((p) => !p.loan && same(p.desk, owner)).reduce((a, p) => a + p.principalUsdc, 0n);
      const pieces: Basket["pieces"] = [];
      for (const a of asked) {
        const desk = deskOf(s.desks, String(a.desk ?? ""));
        if (!desk) throw new Error("one of those desks is no longer listed");
        if (pieces.some((p) => same(p.desk, desk.owner))) throw new Error(`${desk.name} is in the borrow twice`);
        if (same(borrower, desk.owner)) throw new Error(`${desk.name} is your own desk; a desk cannot borrow from itself`);
        const amount = BigInt(Math.round(Number(a.amountUsdc) * 1e6));
        if (!(amount > 0n)) throw new Error(`the amount from ${desk.name} must be positive`);
        const left = BigInt(desk.availableUsdc) - askedSince(desk.owner);
        if (amount > left) throw new Error(`${desk.name} has only ${Number(left > 0n ? left : 0n) / 1e6} USDC left on its order`);
        pieces.push({ desk: getAddress(desk.owner), principalUsdc: amount });
      }
      const total = pieces.reduce((t, p) => t + p.principalUsdc, 0n);
      if (total > MAX_BORROW_USDC) throw new Error(`at most ${Number(MAX_BORROW_USDC) / 1e6} USDC in one borrow (testnet faucet limits)`);
      const basket: Basket = { id: `b${Date.now().toString(36)}`, borrower: getAddress(borrower), usdcAddress: getAddress(to), at: Date.now(), pieces };
      baskets.push(basket);
      return { basket: basket.id };
    }
    case "/api/borrower/cancel": {
      // Drops the pieces no desk has answered yet, which frees those desks' orders. A
      // piece already offered on Base stays: the borrower can accept it or leave it.
      const b = baskets.find((x) => x.id === body.basket);
      if (!b || !same(b.borrower, String(body.borrower ?? ""))) throw new Error("no such borrow of yours");
      const before = b.pieces.length;
      b.pieces = b.pieces.filter((p) => p.loan);
      if (!b.pieces.length) baskets.splice(baskets.indexOf(b), 1);
      return { dropped: before - b.pieces.length };
    }
    case "/api/borrower/accept": {
      // The borrower's wallet has already accepted this loan on Base and signed this entry.
      const doc = await loanDoc(body);
      if (doc.accept) throw new Error("already accepted");
      const accept = body.accept as Accept;
      if (!ZEC_ADDRESS.test(String(accept?.borrowerZec ?? ""))) throw new Error(`the ZEC payout address must be a shielded address on this chain (${ZEC_PREFIX}…)`);
      if (accept.offerDigest !== offerDigest(doc.id, doc.offer)) throw new Error("the acceptance is for different terms");
      const onchain = await onchainStatus(doc.id, "Accepted");
      if (!same(onchain.borrower, doc.offer.borrower)) throw new Error("accepted by someone else");
      await loanbook.accept(doc.id, { offerDigest: accept.offerDigest, borrowerZec: accept.borrowerZec }, body.sig as Hex);
      return run("keys", [doc.id], () => keySetup(doc.id));
    }
    case "/api/borrower/lock": {
      // Every funded piece of the borrow whose vault still waits for its ZEC, in one go.
      const b = baskets.find((x) => x.id === body.basket);
      if (!b) throw new Error("no such borrow");
      const locks: { id: Hex; vault: string; zat: bigint }[] = [];
      for (const p of b.pieces) {
        if (!p.loan) continue;
        const doc = await loanbook.get(p.loan);
        if (!doc.vault || (await getLoan(doc.id)).statusName !== "Funded") continue;
        const bal = await (await partyFor(doc.id, "borrower")).balance().catch(() => null);
        if (bal && BigInt(bal.total_zat) >= BigInt(doc.offer.collateralZat)) continue;
        locks.push({ id: doc.id, vault: doc.vault.address, zat: BigInt(doc.offer.collateralZat) });
      }
      if (!locks.length) throw new Error("no vault is waiting for ZEC yet (each desk funds first)");
      return run("lock", locks.map((l) => l.id), () => lockManyFromTestWallet(locks));
    }
    case "/api/borrower/release": {
      const doc = await loanDoc(body);
      if (doc.status === "Released") throw new Error("this vault was already released");
      if (!RELEASABLE.includes((await getLoan(doc.id)).statusName)) throw new Error("the ZEC comes back once the loan is repaid (or cancelled before it started)");
      return run("release", [doc.id], () => borrowerRelease(doc.id));
    }
    case "/api/borrower/release-all": {
      // Every repaid vault of the borrow back to the borrower's signed addresses, one job.
      // Repaying a whole borrow ends here, so the ZEC comes back without another click.
      const ids = (Array.isArray(body.loans) ? body.loans : []).map(String) as Hex[];
      const ready: Hex[] = [];
      for (const id of ids) {
        const doc = await loanbook.get(id).catch(() => null);
        if (!doc || doc.status === "Released") continue;
        if (!RELEASABLE.includes((await getLoan(id).catch(() => null))?.statusName ?? "")) continue;
        if (jobs.some((j) => !j.done && j.name === "release" && j.loans.includes(id))) continue;
        ready.push(id);
      }
      if (!ready.length) throw new Error("no repaid vault is waiting to be released");
      return run("release", ready, async () => {
        const out = [];
        for (const id of ready) out.push(await borrowerRelease(id));
        return out;
      });
    }
    case "/api/borrower/topup": {
      const doc = await loanDoc(body);
      if (!doc.vault) throw new Error("no vault yet");
      if ((await getLoan(doc.id)).statusName !== "Active") throw new Error("collateral can be added while the loan is running");
      const zat = BigInt(Math.round(Number(body.zec) * 1e8));
      if (!(zat > 0n && zat <= 100_000_000n)) throw new Error("add between 0 and 1 ZEC (the test wallet's limit)");
      return run("topup", [doc.id], () => topUpFromTestWallet(doc.id, doc.vault!.address, zat));
    }

    /* -------------------------------------------------------------- desk -- */
    case "/api/lender/desk": {
      // The desk's wallet signed its terms; the loanbook checks the signature and the rules.
      const terms = body.terms as DeskTerms;
      return loanbook.openDesk(terms, body.sig as Hex);
    }
    case "/api/lender/prepare": {
      // What the desk's wallet will post on Base and sign for the loanbook: its piece of a borrow.
      const lender = String(body.lender ?? "");
      const b = baskets.find((x) => x.id === body.basket);
      const piece = b?.pieces[Number(body.piece)];
      if (!b || !piece || piece.loan) throw new Error("no request waiting there");
      if (!isAddress(lender) || !same(lender, piece.desk)) throw new Error(`this request is for the desk of ${piece.desk}: connect that wallet`);
      const desk = deskOf((await loanbook.desks()).map((d) => d.terms), piece.desk);
      if (!desk) throw new Error("that desk is no longer listed");
      const built = await buildOffer(piece.principalUsdc, desk, b.borrower);
      prepared.set(built.id, { offer: built.offer, basket: b.id, piece: Number(body.piece) });
      return built;
    }
    case "/api/lender/offer": {
      // The desk's wallet has posted the offer on Base; record its signed entry.
      const id = String(body.id ?? "") as Hex;
      const p = prepared.get(id);
      if (!p) throw new Error("no prepared offer with that id");
      const o = p.offer;
      const onchain = await onchainStatus(id, "Offered");
      if (!same(onchain.lender, o.lender) || !same(onchain.borrower, o.borrower) || onchain.principal !== BigInt(o.principalUsdc) || onchain.owed !== BigInt(o.owedUsdc)) {
        throw new Error("the offer on Base does not match the prepared terms");
      }
      await loanbook.offer(id, o, body.sig as Hex, p.basket);
      const piece = baskets.find((x) => x.id === p.basket)?.pieces[p.piece];
      if (piece) piece.loan = id;
      prepared.delete(id);
      return { offered: true };
    }
    case "/api/lender/funded": {
      const doc = await loanDoc(body);
      await onchainStatus(doc.id, "Funded");
      await loanbook.event(doc.id, { actor: "lender", kind: "funded", data: { status: "Funded" } });
      return { funded: true };
    }
    case "/api/lender/cancelled": {
      const doc = await loanDoc(body);
      await onchainStatus(doc.id, "Cancelled");
      await loanbook.event(doc.id, { actor: "lender", kind: "cancelled", data: { status: "Cancelled" } });
      return { cancelled: true };
    }
    case "/api/lender/price": {
      if (PUBLIC && (!DEMO_TOKEN || body.token !== DEMO_TOKEN)) throw new Error("The demo price controls are off on the public site.");
      const usd = body.usd === null ? null : Number(body.usd);
      if (usd !== null && !(usd > 0)) throw new Error("price must be positive");
      setPriceOverride(usd);
      return { override: usd };
    }
    case "/api/lender/liquidate": {
      // The desk's agent proposes with the desk's Zcash key share; the guardians decide.
      const doc = await loanDoc(body);
      const price = await zecPrice();
      const balance = await (await partyFor(doc.id, "lender")).balance();
      const owed = BigInt(doc.offer.owedUsdc) - (await getLoan(doc.id)).repaid;
      const reason = liquidationReason({ ...termsOf(doc), owedUsdc: owed }, BigInt(balance.total_zat), price.microUsd, await isOverdue(doc.id));
      if (!reason) throw new Error("no liquidation rule is met: the referees would refuse");
      return run("liquidate", [doc.id], () => lenderLiquidate(doc.id, owed, price.microUsd));
    }
  }
  throw new Error("unknown action");
}

/* --------------------------------------------------------- desk agents -- */

/*
  A desk can run an agent that answers requests and funds its loans on its own, so a
  borrower is not left waiting for a person at the desk (D18). An agent holds the desk's
  Base key; here the demo's test desks run theirs in this process (their keys are in
  ~/.hypothec/testnet-wallets.json). A desk run from a browser wallet reviews by hand on
  its Lending tab. HYPOTHEC_DESK_AGENTS=0 turns them off (the screen tests click through
  every desk step themselves).
*/
const AGENTS = process.env.HYPOTHEC_DESK_AGENTS !== "0";
const agentBusy = new Set<string>();

async function agentTick() {
  const desks = (await loanbook.desks()).map((d) => d.terms);
  // Answer: post and sign an offer for each piece asked of an agent's desk.
  for (const b of baskets) {
    for (const p of b.pieces) {
      const who = testLenderOf(p.desk);
      const key = `offer:${b.id}:${p.desk}`;
      if (p.loan || !who || agentBusy.has(key)) continue;
      const desk = deskOf(desks, p.desk);
      if (!desk) continue;
      agentBusy.add(key);
      try {
        const { id } = await lenderOffer(p.principalUsdc, desk, who, b.id, b.borrower);
        p.loan = id;
        console.log(`[agent] ${desk.name} offered ${Number(p.principalUsdc) / 1e6} USDC: ${id}`);
      } catch (e) {
        console.log(`[agent] ${desk.name} could not offer: ${(e as Error).message.split("\n")[0]}`);
      } finally {
        agentBusy.delete(key);
      }
    }
  }
  // Fund: once the borrower accepted and the vault is made.
  for (const doc of await loanbook.all()) {
    const who = testLenderOf(doc.offer.lender);
    const key = `fund:${doc.id}`;
    if (!who || !doc.vault || doc.status !== "Accepted" || agentBusy.has(key)) continue;
    if ((await getLoan(doc.id)).statusName !== "Accepted") continue;
    agentBusy.add(key);
    try {
      await lenderFund(doc.id, BigInt(doc.offer.principalUsdc), who);
      console.log(`[agent] ${deskOf(desks, doc.offer.lender)?.name} funded ${doc.id}`);
    } catch (e) {
      console.log(`[agent] funding ${doc.id} failed: ${(e as Error).message.split("\n")[0]}`);
    } finally {
      agentBusy.delete(key);
    }
  }
  // Cancel: the lock deadline passed without the full collateral. The desk takes its USDC
  // back; any ZEC the borrower sent goes back to the borrower.
  const now = await chainNow().catch(() => 0);
  for (const doc of await loanbook.all()) {
    const who = testLenderOf(doc.offer.lender);
    const key = `cancel:${doc.id}`;
    if (!who || doc.status !== "Funded" || now <= Number(doc.offer.lockBy) || agentBusy.has(key)) continue;
    if ((await getLoan(doc.id)).statusName !== "Funded") continue;
    agentBusy.add(key);
    try {
      await lenderCancel(doc.id, who);
      console.log(`[agent] ${deskOf(desks, doc.offer.lender)?.name} cancelled ${doc.id}: not locked by the deadline`);
    } catch (e) {
      console.log(`[agent] cancelling ${doc.id} failed: ${(e as Error).message.split("\n")[0]}`);
    } finally {
      agentBusy.delete(key);
    }
  }
}

if (AGENTS) {
  let ticking = false;
  setInterval(async () => {
    if (ticking) return;
    ticking = true;
    await agentTick().catch((e) => console.log(`[agent] ${(e as Error).message}`));
    ticking = false;
  }, 2000);
}

/* -------------------------------------------------------------- server -- */

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".mp4": "video/mp4",
};

/// Link previews need absolute addresses: pages carry __SITE__ in their share tags, and it
/// becomes this server's own address as the visitor (or a link scraper) reached it.
function serveStatic(path: string, req: IncomingMessage, res: ServerResponse) {
  const file = normalize(join(WEB, path === "/" ? "index.html" : path));
  if (!file.startsWith(WEB) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404).end("not found");
    return;
  }
  const type = TYPES[extname(file)] ?? "application/octet-stream";
  const cache = file.includes(`${sep}media${sep}`) ? { "cache-control": "public, max-age=86400" } : {};
  if (extname(file) === ".mp4") {
    // Video players ask for byte ranges (Safari will not play without them).
    const data = readFileSync(file);
    const m = /bytes=(\d*)-(\d*)/.exec(String(req.headers.range ?? ""));
    if (!m) return void res.writeHead(200, { "content-type": type, "content-length": data.length, "accept-ranges": "bytes", ...cache }).end(data);
    const start = m[1] ? Number(m[1]) : Math.max(0, data.length - Number(m[2]));
    const end = m[1] && m[2] ? Math.min(Number(m[2]), data.length - 1) : data.length - 1;
    return void res.writeHead(206, { "content-type": type, "content-length": end - start + 1, "content-range": `bytes ${start}-${end}/${data.length}`, "accept-ranges": "bytes", ...cache }).end(data.subarray(start, end + 1));
  }
  if (extname(file) !== ".html") return void res.writeHead(200, { "content-type": type, ...cache }).end(readFileSync(file));
  const proto = String(req.headers["x-forwarded-proto"] ?? "http").split(",")[0];
  const site = `${proto}://${req.headers["x-forwarded-host"] ?? req.headers.host ?? "127.0.0.1"}`;
  res.writeHead(200, { "content-type": type }).end(readFileSync(file, "utf8").replaceAll("__SITE__", site));
}

async function body(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

recoverBaskets().finally(() =>
  createServer(async (req, res) => {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    try {
      if (!path.startsWith("/api/")) return serveStatic(path, req, res);
      const out = req.method === "GET" && path === "/api/state" ? await snapshot() : await act(path, await body(req));
      if (path !== "/api/state") refreshState().catch(() => undefined); // show the action's effect promptly
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(out, big));
    } catch (e) {
      res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: (e as Error).message }));
    }
  }).listen(PORT, HOST, () => console.log(`[api] http://${HOST}:${PORT}`)),
);
