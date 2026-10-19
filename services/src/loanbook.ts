// The loanbook: the shared record linking a loan on Base to its vault on Zcash, for that
// loan's four parties. It holds no keys or viewing keys. Entries that matter are signed by
// the party they belong to (sign.ts) and verified here and again by the referees, so the
// operator of the loanbook cannot change them. Events form a log; referee events are
// signed too (BRIEF 4c). Development only: no access control yet, localhost only.
import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { DatabaseSync } from "node:sqlite";
import type { Address, Hex } from "viem";
import { checkDesk, type Desk, type DeskTerms } from "./desks";
import { digest, verify, type Fields } from "./sign";
import { ZEC_ADDRESS } from "./zec";

/// What the lender signs (kind "offer"). Amounts as decimal strings in base units.
export interface Offer extends Fields {
  contract: Address;
  lender: Address;
  borrower: Address;
  refereeA: Address;
  refereeB: Address;
  principalUsdc: string;
  owedUsdc: string;
  dueAt: number;
  lockBy: number;
  collateralZat: string;
  marginLtvBps: number;
  liquidationLtvBps: number;
  slippageBps: number;
  /// The lender's Zcash address for its liquidation share.
  lenderZec: string;
}

/// What the borrower signs (kind "accept"): the exact offer, and its fresh payout address.
export interface Accept extends Fields {
  offerDigest: Hex;
  borrowerZec: string;
}

export interface LoanDoc {
  id: Hex;
  /// The borrow this loan is one piece of (D16): one request filled from several desks.
  basket?: string;
  offer: Offer;
  lenderSig: Hex;
  accept?: Accept;
  borrowerSig?: Hex;
  vault?: { address: string; invite: string };
  status: string;
  updatedAt: number;
}

export interface LoanEvent {
  loan: Hex;
  at: number;
  actor: string;
  kind: string;
  data: Fields;
  sig?: Hex;
}

export const offerDigest = (id: Hex, o: Offer) => digest("offer", id, o);

export class LoanStore {
  private db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS loans (id TEXT PRIMARY KEY, doc TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, loan TEXT NOT NULL, ev TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS desks (owner TEXT PRIMARY KEY, desk TEXT NOT NULL);`);
  }
  get(id: string): LoanDoc | undefined {
    const row = this.db.prepare("SELECT doc FROM loans WHERE id = ?").get(id) as { doc: string } | undefined;
    return row ? JSON.parse(row.doc) : undefined;
  }
  all(): LoanDoc[] {
    return (this.db.prepare("SELECT doc FROM loans").all() as { doc: string }[]).map((r) => JSON.parse(r.doc));
  }
  put(doc: LoanDoc) {
    doc.updatedAt = Date.now();
    this.db.prepare("INSERT INTO loans (id, doc) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET doc = excluded.doc").run(doc.id, JSON.stringify(doc));
  }
  addEvent(ev: LoanEvent) {
    this.db.prepare("INSERT INTO events (loan, ev) VALUES (?, ?)").run(ev.loan, JSON.stringify(ev));
  }
  desks(): Desk[] {
    return (this.db.prepare("SELECT desk FROM desks").all() as { desk: string }[]).map((r) => JSON.parse(r.desk));
  }
  putDesk(d: Desk) {
    this.db.prepare("INSERT INTO desks (owner, desk) VALUES (?, ?) ON CONFLICT(owner) DO UPDATE SET desk = excluded.desk").run(d.terms.owner.toLowerCase(), JSON.stringify(d));
  }
  events(loan: string): LoanEvent[] {
    return (this.db.prepare("SELECT ev FROM events WHERE loan = ? ORDER BY seq").all(loan) as { ev: string }[]).map((r) => JSON.parse(r.ev));
  }
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

/// Handles one request against the store. Exported for tests.
export async function handle(store: LoanStore, method: string, path: string, b: Record<string, unknown>): Promise<unknown> {
  const parts = path.split("/").filter(Boolean); // loans/:id/... or desks
  if (parts[0] === "desks" && parts.length === 1) {
    if (method === "GET") return store.desks();
    if (method === "POST") {
      // A desk's terms, signed by the wallet that will lend from it (D14).
      const { terms, sig } = b as { terms: DeskTerms; sig: Hex };
      const why = checkDesk(terms, ZEC_ADDRESS);
      if (why) throw new HttpError(400, why);
      if (!(await verify(terms.owner, "desk", terms.owner, terms, sig, "desk"))) throw new HttpError(400, "the desk's signature does not match its terms");
      const taken = store.desks().find((d) => d.terms.name.toLowerCase() === terms.name.toLowerCase() && d.terms.owner.toLowerCase() !== terms.owner.toLowerCase());
      if (taken) throw new HttpError(409, "another desk has that name");
      store.putDesk({ terms, sig });
      return { terms, sig };
    }
  }
  if (parts[0] !== "loans") throw new HttpError(404, "not found");
  if (parts.length === 1) {
    if (method === "GET") return store.all();
    if (method === "POST") {
      const { id, offer, lenderSig, basket } = b as { id: Hex; offer: Offer; lenderSig: Hex; basket?: string };
      if (store.get(id)) throw new HttpError(409, "loan exists");
      if (!(await verify(offer.lender, "offer", id, offer, lenderSig))) throw new HttpError(400, "lender signature does not match the offer");
      const doc: LoanDoc = { id, basket: typeof basket === "string" ? basket.slice(0, 64) : undefined, offer, lenderSig, status: "Offered", updatedAt: 0 };
      store.put(doc);
      store.addEvent({ loan: id, at: Date.now(), actor: "lender", kind: "offer", data: {}, sig: lenderSig });
      return doc;
    }
  }
  const id = parts[1] as Hex;
  const doc = store.get(id);
  if (!doc) throw new HttpError(404, "no such loan");
  if (parts.length === 2 && method === "GET") return doc;
  const action = parts[2];
  if (method === "GET" && action === "events") return store.events(id);
  if (method !== "POST") throw new HttpError(405, "method not allowed");
  switch (action) {
    case "accept": {
      const { accept, borrowerSig } = b as { accept: Accept; borrowerSig: Hex };
      if (doc.accept) throw new HttpError(409, "already accepted");
      if (accept.offerDigest !== offerDigest(id, doc.offer)) throw new HttpError(400, "accept does not refer to this offer");
      if (!(await verify(doc.offer.borrower, "accept", id, accept, borrowerSig))) throw new HttpError(400, "borrower signature does not match");
      doc.accept = accept;
      doc.borrowerSig = borrowerSig;
      doc.status = "Accepted";
      store.put(doc);
      store.addEvent({ loan: id, at: Date.now(), actor: "borrower", kind: "accept", data: {}, sig: borrowerSig });
      return doc;
    }
    case "vault": {
      // Not trusted on its own: each referee checks it against its own party service.
      const { address, invite } = b as { address: string; invite: string };
      doc.vault = { address, invite };
      store.put(doc);
      store.addEvent({ loan: id, at: Date.now(), actor: String(b.actor ?? "borrower"), kind: "vault", data: { address } });
      return doc;
    }
    case "events": {
      const ev = b as unknown as LoanEvent;
      store.addEvent({ ...ev, loan: id, at: Date.now() });
      if (typeof ev.data?.status === "string") {
        doc.status = ev.data.status;
        store.put(doc);
      }
      return { ok: true };
    }
  }
  throw new HttpError(404, "not found");
}

export function serveLoanbook(port: number, dbPath: string) {
  const store = new LoanStore(dbPath);
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const out = await handle(store, req.method ?? "GET", new URL(req.url ?? "/", "http://x").pathname, await body(req));
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(out));
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify({ error: (e as Error).message }));
    }
  });
  server.listen(port, "127.0.0.1");
  return server;
}

export class LoanbookClient {
  constructor(readonly url: string) {}
  private async call<T>(method: string, path: string, b?: unknown): Promise<T> {
    const res = await fetch(this.url + path, {
      method,
      headers: b === undefined ? undefined : { "content-type": "application/json" },
      body: b === undefined ? undefined : JSON.stringify(b),
    });
    const json = (await res.json()) as T & { error?: string };
    if (!res.ok) throw new Error(`loanbook ${method} ${path}: ${json.error ?? res.status}`);
    return json;
  }
  all() { return this.call<LoanDoc[]>("GET", "/loans"); }
  desks() { return this.call<Desk[]>("GET", "/desks"); }
  openDesk(terms: DeskTerms, sig: Hex) { return this.call<Desk>("POST", "/desks", { terms, sig }); }
  get(id: Hex) { return this.call<LoanDoc>("GET", `/loans/${id}`); }
  offer(id: Hex, offer: Offer, lenderSig: Hex, basket?: string) { return this.call<LoanDoc>("POST", "/loans", { id, offer, lenderSig, basket }); }
  accept(id: Hex, accept: Accept, borrowerSig: Hex) { return this.call<LoanDoc>("POST", `/loans/${id}/accept`, { accept, borrowerSig }); }
  vault(id: Hex, address: string, invite: string) { return this.call<LoanDoc>("POST", `/loans/${id}/vault`, { address, invite }); }
  event(id: Hex, ev: Omit<LoanEvent, "loan" | "at">) { return this.call<{ ok: boolean }>("POST", `/loans/${id}/events`, ev); }
  events(id: Hex) { return this.call<LoanEvent[]>("GET", `/loans/${id}/events`); }
}
