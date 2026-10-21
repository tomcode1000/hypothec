// TEST ONLY. A stand-in for the browser wallet, so the screens can be driven end to end
// without MetaMask: it answers EIP-1193 requests for the test borrower or the test desk
// (?as=borrower|lender|lender2) with their keys from ~/.hypothec/testnet-wallets.json, and passes
// read calls through to the dollar-side chain (HYPOTHEC_CHAIN). Paired with test/e2e-web.mjs, which injects a
// window.ethereum that forwards here. Never part of the app.
//   ts-node test/signer.ts            -> http://127.0.0.1:7920
import { createServer } from "http";
import { createWalletClient, fallback, http, nonceManager, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseKey, type BaseWallet } from "../src/config";
import { CHAIN } from "../src/chains";

// The nonce manager counts this process's own sends, so an approve followed at once by the
// next call does not reuse a nonce when the public RPC lags a block (a real wallet does this).
const client = (r: BaseWallet) => {
  const account = privateKeyToAccount(baseKey(r), { nonceManager });
  const transport = fallback(CHAIN.rpcs.map((url) => http(url, { timeout: 30_000, retryCount: 3 })));
  return { account, wallet: createWalletClient({ chain: CHAIN.chain, transport, account }) };
};
const clients = { borrower: client("borrower"), lender: client("lender"), lender2: client("lender2") };
type As = keyof typeof clients;

async function answer(role: As, method: string, params: unknown[]) {
  const { account, wallet } = clients[role];
  switch (method) {
    case "eth_requestAccounts":
    case "eth_accounts":
      return [account.address];
    case "eth_chainId":
      return `0x${CHAIN.chain.id.toString(16)}`;
    case "wallet_switchEthereumChain":
    case "wallet_addEthereumChain":
      return null;
    case "personal_sign":
      return account.signMessage({ message: { raw: params[0] as Hex } });
    case "eth_signTypedData_v4": {
      // The USDC permit for repaying (EIP-712); viem wants the domain type left out.
      const data = JSON.parse(params[1] as string);
      delete data.types.EIP712Domain;
      return account.signTypedData(data);
    }
    case "eth_sendTransaction": {
      const tx = params[0] as { to: Hex; data?: Hex; value?: Hex; gas?: Hex };
      return wallet.sendTransaction({
        account, chain: CHAIN.chain, to: tx.to, data: tx.data,
        value: tx.value ? BigInt(tx.value) : undefined, gas: tx.gas ? BigInt(tx.gas) : undefined,
      });
    }
    default: {
      const res = await fetch(CHAIN.rpcs[0], { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
      const j = (await res.json()) as { result?: unknown; error?: { message: string } };
      if (j.error) throw new Error(j.error.message);
      return j.result;
    }
  }
}

createServer(async (req, res) => {
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type" };
  if (req.method === "OPTIONS") return res.writeHead(204, cors).end();
  const asked = new URL(req.url ?? "/", "http://x").searchParams.get("as");
  const role: As = asked === "lender" || asked === "lender2" ? asked : "borrower";
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const { method, params = [] } = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  try {
    const result = await answer(role, method, params);
    console.log(`[signer] ${role} ${method}`);
    res.writeHead(200, { ...cors, "content-type": "application/json" }).end(JSON.stringify({ result }));
  } catch (e) {
    console.log(`[signer] ${role} ${method} FAILED: ${(e as Error).message.split("\n")[0]}`);
    res.writeHead(200, { ...cors, "content-type": "application/json" }).end(JSON.stringify({ error: { code: -32000, message: (e as Error).message } }));
  }
}).listen(7920, "127.0.0.1", () => console.log("[signer] TEST wallet stand-in on http://127.0.0.1:7920"));
