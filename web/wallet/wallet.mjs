/*
  The browser wallet, for both surfaces: the borrower and the desk sign their own Base
  actions here with the wallet they connect (MetaMask, Coinbase Wallet, any EIP-1193
  wallet). Nothing in this file holds a key. Bundled by build.mjs into
  dist/assets/wallet.js as `window.HypothecWallet`, so the pages load nothing from
  outside at runtime.

  Writes are simulated against the chain first (the public RPC can lag a block, so the
  simulation is retried), then sent, then awaited until mined.
*/
import { createPublicClient, createWalletClient, custom, defineChain, erc20Abi, fallback, getAddress, http, keccak256, parseAbi, parseSignature, toHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import qrcode from 'qrcode-generator'
import artifact from '../../usdc/artifacts/contracts/HypothecLoans.sol/HypothecLoans.json'
import vaultArtifact from '../../usdc/artifacts/contracts/vault/HypothecVault.sol/HypothecVault.json'
import { FIELD, SEED_MESSAGE, Tree, commitmentOf, noteKeys, nullifierOf, seedFrom, spendInput, toSolidity } from '../../shield/lib/notes.mjs'

const LOANS_ABI = artifact.abi
/* The dollar-side chain (Base Sepolia or Robinhood Chain testnet) comes from /api/state:
   its id, name, RPCs, explorer, the stablecoin and its permit domain. Reads go to its public
   RPC providers in turn, so one slow provider does not stop a page. */
let cfg = null // /api/state .chain
let chain = null
let pub = null
let wallet = null
let account = null

const eth = () => {
  if (!window.ethereum) throw new Error('No browser wallet found. Install MetaMask or Coinbase Wallet, then reload.')
  return window.ethereum
}

export function configure(c) {
  const same = cfg && cfg.id === c.id && cfg.loans === c.loans
  cfg = c
  if (same && pub) return
  chain = defineChain({
    id: c.id,
    name: c.label,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: c.rpcs } },
    blockExplorers: { default: { name: 'Explorer', url: c.explorer } },
    testnet: true,
  })
  pub = createPublicClient({ chain, transport: fallback(c.rpcs.map((url) => http(url, { timeout: 20_000, retryCount: 2 }))) })
  if (account) bind(account)
}

const chainHex = () => `0x${cfg.id.toString(16)}`

export const address = () => account

async function ensureChain() {
  if (!cfg) throw new Error('Still loading the network; try again in a moment.')
  const id = await eth().request({ method: 'eth_chainId' })
  if (id?.toLowerCase() === chainHex()) return
  try {
    await eth().request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainHex() }] })
  } catch (e) {
    if (e?.code !== 4902) throw e
    await eth().request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId: chainHex(),
        chainName: cfg.label,
        nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
        rpcUrls: cfg.rpcs,
        blockExplorerUrls: [cfg.explorer],
      }],
    })
  }
}

function bind(a) {
  account = getAddress(a)
  wallet = createWalletClient({ chain: chain ?? undefined, transport: custom(eth()), account })
  return account
}

/** Asks the wallet for an account (a prompt the first time) and moves it to the loan chain. */
export async function connect() {
  const [a] = await eth().request({ method: 'eth_requestAccounts' })
  await ensureChain()
  return bind(a)
}

/** The account already connected on an earlier visit, without prompting; null if none. */
export async function restore() {
  if (!window.ethereum) return null
  const [a] = await window.ethereum.request({ method: 'eth_accounts' })
  return a ? bind(a) : null
}

export function onChange(f) {
  window.ethereum?.on?.('accountsChanged', () => f())
  window.ethereum?.on?.('chainChanged', () => f())
}

async function retry(f, tries = 8) {
  for (let i = 1; ; i++) {
    try {
      return await f()
    } catch (e) {
      if (i >= tries || e?.code === 4001) throw e
      await new Promise((r) => setTimeout(r, 1500))
    }
  }
}

async function call(address, abi, functionName, args) {
  if (!wallet) throw new Error('Connect your wallet first.')
  await ensureChain()
  const { request } = await retry(() => pub.simulateContract({ address, abi, functionName, args, account }))
  // Gas as estimated, with room (a vault deposit inserts into its tree: far above a transfer).
  const est = await pub.estimateContractGas({ address, abi, functionName, args, account }).catch(() => 300_000n)
  const hash = await wallet.writeContract({ ...request, gas: (est * 13n) / 10n + 20_000n })
  const r = await pub.waitForTransactionReceipt({ hash })
  if (r.status !== 'success') throw new Error(`${functionName} failed on Base`)
  return hash
}

const loans = (fn, args) => call(cfg.loans, LOANS_ABI, fn, args)
const approveUsdc = (amount) => call(cfg.usdc, erc20Abi, 'approve', [cfg.loans, amount])

/**
 * What a wallet holds on the loan chain: ETH for fees and the stablecoin, in base units. Read from the
 * public RPC, so the screens can warn before an action would fail. Null when not connected.
 */
export async function balances(a = account) {
  if (!a || !cfg || !pub) return null
  const [eth, usdc] = await Promise.all([
    pub.getBalance({ address: a }),
    pub.readContract({ address: cfg.usdc, abi: erc20Abi, functionName: 'balanceOf', args: [a] }),
  ])
  return { eth, usdc }
}

/** Signs a loanbook entry (EIP-191 personal_sign). */
export const sign = (text) => {
  if (!wallet) throw new Error('Connect your wallet first.')
  return wallet.signMessage({ account, message: text })
}

/**
 * The canonical text of a signed loanbook entry. MUST match services/src/sign.ts
 * message() byte for byte, or the loanbook rejects the signature.
 */
export function message(kind, loanId, fields, idLabel = 'loan') {
  const lines = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
  return [`Hypothec ${kind}`, `${idLabel}=${loanId}`, ...lines].join('\n')
}

/* ---------------------------------------------------------------- desk -- */

/** Posts the desk's terms on Base. `terms` carries decimal strings from the API. */
export const offer = (id, t) =>
  loans('offer', [id, {
    borrower: t.borrower, refereeA: t.refereeA, refereeB: t.refereeB, repayTo: t.repayTo,
    principal: BigInt(t.principal), owed: BigInt(t.owed), dueAt: BigInt(t.dueAt), lockBy: BigInt(t.lockBy),
  }])

/** Moves the principal and both guardians' fees into the contract: an approve, then fund. */
export async function fund(id) {
  const amount = await retry(() => pub.readContract({ address: cfg.loans, abi: LOANS_ABI, functionName: 'fundingAmount', args: [id] }))
  const a = await approveUsdc(amount)
  const f = await loans('fund', [id])
  return { approve: a, fund: f }
}

/** After the lock deadline, with the collateral not all in: the contract refunds the desk. */
export const cancel = (id) => loans('cancel', [id])

/** Test dollars, where the chain's test stablecoin lets anyone mint (Robinhood testnet). */
export const mintTest = (amount) => call(cfg.usdc, parseAbi(['function mint(address to, uint256 amount)']), 'mint', [account, BigInt(amount)])

/* ------------------------------------------------------------ borrower -- */

export const accept = (id, payoutTo) => loans('accept', [id, getAddress(payoutTo)])

/** Repays what is left on one loan: the same single transaction as repayAll. */
export const repay = (id, amount) => repayAll([id], amount)

/**
 * Repays every listed loan in full in ONE transaction: the wallet signs a USDC permit (a
 * signature, no fee) for the total, then sends one repayAllWithPermit, which pays each
 * loan's own lender. `total` is what is left on all of them together.
 */
export async function repayAll(ids, total) {
  if (!wallet) throw new Error('Connect your wallet first.')
  await ensureChain()
  const value = BigInt(total)
  const nonce = await retry(() => pub.readContract({ address: cfg.usdc, abi: parseAbi(['function nonces(address) view returns (uint256)']), functionName: 'nonces', args: [account] }))
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800)
  const sig = await wallet.signTypedData({
    account,
    domain: { name: cfg.permitName, version: cfg.permitVersion, chainId: cfg.id, verifyingContract: getAddress(cfg.usdc) },
    types: { Permit: [
      { name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }, { name: 'value', type: 'uint256' },
      { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' },
    ] },
    primaryType: 'Permit',
    message: { owner: account, spender: getAddress(cfg.loans), value, nonce, deadline },
  })
  const r = `0x${sig.slice(2, 66)}`
  const s = `0x${sig.slice(66, 130)}`
  let v = parseInt(sig.slice(130, 132), 16)
  if (v < 27) v += 27
  return { repay: await loans('repayAllWithPermit', [ids, value, deadline, v, r, s]) }
}

/* ------------------------------------------------------------------ qr -- */

/** A QR code of `text` as an SVG string (for the vault address). */
export function qr(text) {
  const q = qrcode(0, 'M')
  q.addData(text)
  q.make()
  return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true })
}

/* -------------------------------------------------------------- private -- */
/*
  A private borrow (the shielded dollar vault, shield/): the borrower on the loan chain is a
  one-time key, the dollars arrive as a private note in the vault, and repaying spends notes
  with a zero-knowledge proof made here, in the browser. Every key comes from one seed, which
  the wallet's signature of SEED_MESSAGE makes: nothing to back up, signing again finds all.
*/
let seed = null
let seedFor = null
const seedKey = () => `hypothec-seed:${cfg?.id}:${account}`

/** The private seed (asks the wallet to sign once per session). */
export async function privateSeed() {
  if (seed && seedFor === account) return seed
  try {
    const kept = sessionStorage.getItem(seedKey())
    if (kept) {
      seedFor = account
      seed = BigInt(kept)
      return seed
    }
  } catch (e) {}
  if (!wallet) throw new Error('Connect your wallet first.')
  const sig = await wallet.signMessage({ account, message: SEED_MESSAGE })
  seed = seedFrom(sig)
  seedFor = account
  try { sessionStorage.setItem(seedKey(), seed.toString()) } catch (e) {}
  return seed
}
export const hasSeed = () => {
  try { return !!(seed && seedFor === account) || !!sessionStorage.getItem(seedKey()) } catch (e) { return !!seed }
}

const fieldOf = (...parts) => BigInt(keccak256(toHex(parts.join(':')))) % FIELD

/** The k-th one-time borrower key of this seed (a plain Ethereum key, used for one borrow). */
export const oneTimeAccount = (s, k) => privateKeyToAccount(toHex(fieldOf('hypothec-borrower', s, k), { size: 32 }))

/** A fresh one-time borrower: the first of this seed's keys not already used on this site. */
export async function nextOneTime(used) {
  const s = await privateSeed()
  const seen = new Set(used.map((a) => a.toLowerCase()))
  for (let k = 0; k < 1000; k++) {
    const a = oneTimeAccount(s, k)
    if (!seen.has(a.address.toLowerCase())) return { k, address: a.address }
  }
  throw new Error('No free one-time key')
}

/** This seed's one-time key for an address it made (searching its first keys). */
async function oneTimeFor(address) {
  const s = await privateSeed()
  for (let k = 0; k < 1000; k++) {
    const a = oneTimeAccount(s, k)
    if (a.address.toLowerCase() === address.toLowerCase()) return a
  }
  throw new Error('This private borrow was made from another wallet.')
}

/** A loan's payout note keys: one fresh note per loan, found again from the loan id. */
const payoutKeys = (s, loanId) => noteKeys(s, `loan:${loanId}`)

/**
 * Accepts a shielded loan with its one-time key: the signature the contract checks (the
 * relayer submits it) and the signed loanbook entry. Returns what /api/relay/accept takes.
 */
export async function acceptPrivate(loanId, borrower, accept, entryText) {
  const s = await privateSeed()
  const key = await oneTimeFor(borrower)
  const n = payoutKeys(s, loanId)
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
  const digest = await pub.readContract({ address: cfg.loans, abi: LOANS_ABI, functionName: 'shieldedAcceptDigest', args: [loanId, n.owner, n.blinding, deadline] })
  const sig = parseSignature(await key.signMessage({ message: { raw: digest } }))
  const entrySig = await key.signMessage({ message: entryText })
  return {
    loan: loanId, accept, sig: entrySig,
    note: { owner: n.owner.toString(), blinding: n.blinding.toString(), deadline: deadline.toString(), v: Number(sig.v), r: sig.r, s: sig.s },
  }
}

/* Notes this browser made itself (change and deposits) are kept locally; a loan's payout
   note is found again from the seed alone. */
const notesKey = () => `hypothec-notes:${cfg?.id}:${account}`
const keptNotes = () => {
  try { return JSON.parse(localStorage.getItem(notesKey()) || '[]').map((n) => ({ amount: BigInt(n.amount), secret: BigInt(n.secret), blinding: BigInt(n.blinding) })) } catch (e) { return [] }
}
const keepNote = (n) => {
  try {
    const all = JSON.parse(localStorage.getItem(notesKey()) || '[]')
    all.push({ amount: n.amount.toString(), secret: n.secret.toString(), blinding: n.blinding.toString() })
    localStorage.setItem(notesKey(), JSON.stringify(all))
  } catch (e) {}
}

/** The unspent notes of this wallet's private balance, given the vault's record and its loans. */
export async function privateNotes(record, loans) {
  const s = await privateSeed()
  const leaves = record.leaves.map((x) => BigInt(x))
  const spent = new Set(record.nullifiers.map(String))
  const cands = [...loans.map((l) => ({ amount: BigInt(l.principal), ...payoutKeys(s, l.id) })), ...keptNotes()]
  const out = []
  const seen = new Set()
  for (const n of cands) {
    const c = commitmentOf(n)
    const index = leaves.indexOf(c)
    if (index < 0 || seen.has(c) || spent.has(String(nullifierOf(n)))) continue
    seen.add(c)
    out.push({ amount: n.amount, secret: n.secret, blinding: n.blinding, index })
  }
  return out
}

/** Moves dollars from the wallet into the private balance (approve, then the vault deposit). */
export async function shieldIn(amount) {
  const s = await privateSeed()
  const n = noteKeys(s, `deposit:${Date.now()}:${Math.random()}`)
  keepNote({ amount: BigInt(amount), secret: n.secret, blinding: n.blinding })
  await call(cfg.usdc, erc20Abi, 'approve', [cfg.vault, BigInt(amount)])
  return call(cfg.vault, vaultArtifact.abi, 'deposit', [BigInt(amount), n.owner, n.blinding])
}

let snark = null
function loadSnark() {
  if (window.snarkjs) return Promise.resolve(window.snarkjs)
  snark ??= new Promise((ok, fail) => {
    const tag = document.createElement('script')
    tag.src = 'assets/zk/snarkjs.min.js'
    tag.onload = () => ok(window.snarkjs)
    tag.onerror = () => fail(new Error('Could not load the prover'))
    document.head.appendChild(tag)
  })
  return snark
}

/**
 * Proves a spend of up to two notes releasing `amount`: to `recipient`, or repaying `loanId`.
 * Returns the body for /api/relay/transact. The change note is kept before anything is sent.
 */
export async function proveSpend(record, notes, amount, { recipient = '0x0000000000000000000000000000000000000000', loanId = '0x' + '00'.repeat(32) } = {}) {
  const s = await privateSeed()
  const want = BigInt(amount)
  const ins = [...notes].sort((a, b) => (b.amount > a.amount ? 1 : -1)).slice(0, 2)
  if (ins.reduce((a, n) => a + n.amount, 0n) < want) throw new Error('Your private balance is too small for this in one step.')
  const pick = ins[0].amount >= want ? [ins[0]] : ins
  const change = noteKeys(s, `change:${Date.now()}:${Math.random()}`)
  const ext = { recipient, loanId, relayer: '0x0000000000000000000000000000000000000000', fee: 0n }
  const tree = new Tree(record.leaves.map((x) => BigInt(x)))
  const { input, change: out } = spendInput(tree, pick, want, change, ext)
  const snarkjs = await loadSnark()
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, 'assets/zk/spend.wasm', 'assets/zk/spend.zkey')
  const p = toSolidity(proof, publicSignals)
  if (out.amount > 0n) keepNote(out)
  const str = (x) => x.toString()
  return {
    a: p.a.map(str), b: p.b.map((r) => r.map(str)), c: p.c.map(str),
    root: str(p.signals[0]), publicAmount: str(p.signals[1]), nullifiers: [str(p.signals[3]), str(p.signals[4])], outCommitment: str(p.signals[5]),
    ext: { ...ext, fee: '0' },
  }
}
