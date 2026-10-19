// Client for one hypothec-party service (core/README.md). Each role talks only to its own.
// A party service holds one vault, so every loan has its own four; a role's party host
// (e2e/control.py in the demo) starts that loan's service and says where it is.
import { CONTROL_URL, type Role } from "./config";
export interface Output {
  address: string;
  amount_zat: number;
}
export interface Spend {
  id: string;
  status: string;
  outputs: Output[];
  approvals: number;
  threshold: number;
  rejections: number;
  txid: string | null;
}
export interface Approval {
  outputs: number;
  fee_zat: number;
  change_zat: number;
  signed: boolean;
  complete: boolean;
}

export class PartyError extends Error {}

export class Party {
  constructor(readonly url: string) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(this.url + path, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await res.json()) as T & { error?: string };
    if (!res.ok) throw new PartyError(`${method} ${path}: ${json.error ?? res.status}`);
    return json;
  }

  identity() { return this.call<{ identity: string }>("POST", "/identity"); }
  createVault(name: string, threshold: number, members: number) {
    return this.call<{ invite: string }>("POST", "/vault/create", { name, threshold, members });
  }
  join(invite: string) { return this.call<{ joined: string }>("POST", "/vault/join", { invite }); }
  seal() { return this.call<{ sealed: boolean }>("POST", "/vault/seal"); }
  members() { return this.call<{ members: string[]; sealed: boolean; safety_number: string }>("GET", "/vault/members"); }
  keygen(safetyNumber: string) {
    return this.call<{ address: string }>("POST", "/vault/keygen", { safety_number: safetyNumber });
  }
  vault() {
    return this.call<{ name: string; threshold: number; members: number; address: string; ufvk: string; birthday: number }>("GET", "/vault");
  }
  balance() { return this.call<{ height: number; spendable_zat: number; ironwood_zat: number; total_zat: number }>("GET", "/balance"); }
  propose(outputs: Output[], memo?: string) { return this.call<{ id: string }>("POST", "/spends", { outputs, memo }); }
  async spends() { return (await this.call<{ spends: Spend[] }>("GET", "/spends")).spends; }
  approve(id: string) { return this.call<Approval>("POST", `/spends/${id}/approve`); }
  send(id: string) { return this.call<{ txid: string }>("POST", `/spends/${id}/send`); }
}

const hosted = new Map<string, Party>();

/// This role's party service for this loan, started by the host on first use.
export async function partyFor(loan: string, role: Role): Promise<Party> {
  const key = `${loan.toLowerCase()}:${role}`;
  const known = hosted.get(key);
  if (known) return known;
  const res = await fetch(`${CONTROL_URL}/party`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ loan: loan.toLowerCase(), role }),
  });
  const json = (await res.json()) as { url?: string; error?: string };
  if (!res.ok || !json.url) throw new PartyError(`party host: ${json.error ?? res.status}`);
  // The host sees the port open inside WSL a moment before Windows can reach it through
  // WSL's localhost forwarding: wait until the service answers from here.
  for (let i = 0; ; i++) {
    const answered = await fetch(`${json.url}/vault/members`).then(() => true, () => false);
    if (answered) break;
    if (i >= 60) throw new PartyError(`party ${role} for ${loan} does not answer at ${json.url}`);
    await new Promise((r) => setTimeout(r, 250));
  }
  const p = new Party(json.url);
  hosted.set(key, p);
  return p;
}
