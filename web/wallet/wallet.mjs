/*
  The browser wallet, for both surfaces: the borrower and the desk sign their own Base
  actions here with the wallet they connect (MetaMask, Coinbase Wallet, any EIP-1193
  wallet). Nothing in this file holds a key. Bundled by build.mjs into
  dist/assets/wallet.js as `window.HypothecWallet`, so the pages load nothing from
  outside at runtime.

  Writes are simulated against the chain first (the public RPC can lag a block, so the
  simulation is retried), then sent, then awaited until mined.
*/
import { createPublicClient, createWalletClient, custom, erc20Abi, fallback, getAddress, http, parseAbi } from 'viem'
import { baseSepolia } from 'viem/chains'
import qrcode from 'qrcode-generator'
import artifact from '../../usdc/artifacts/contracts/HypothecLoans.sol/HypothecLoans.json'

const LOANS_ABI = artifact.abi
const BASE_SEPOLIA_HEX = '0x14a34' // 84532
// Reads go to two public RPC providers in turn, so one slow provider does not stop a page.
const pub = createPublicClient({
  chain: baseSepolia,
  transport: fallback([
    http('https://sepolia.base.org', { timeout: 20_000, retryCount: 2 }),
    http('https://base-sepolia-rpc.publicnode.com', { timeout: 20_000, retryCount: 2 }),
  ]),
})

let cfg = null // { loans, usdc } from /api/state
let wallet = null
let account = null

const eth = () => {
  if (!window.ethereum) throw new Error('No browser wallet found. Install MetaMask or Coinbase Wallet, then reload.')
  return window.ethereum
}

export function configure(c) {
  cfg = c
}

export const address = () => account

async function ensureChain() {
  const id = await eth().request({ method: 'eth_chainId' })
  if (id === BASE_SEPOLIA_HEX) return
  try {
    await eth().request({ method: 'wallet_switchEthereumChain', params: [{ chainId: BASE_SEPOLIA_HEX }] })
  } catch (e) {
    if (e?.code !== 4902) throw e
    await eth().request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId: BASE_SEPOLIA_HEX,
        chainName: 'Base Sepolia',
        nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
        rpcUrls: ['https://sepolia.base.org'],
        blockExplorerUrls: ['https://sepolia.basescan.org'],
      }],
    })
  }
}

function bind(a) {
  account = getAddress(a)
  wallet = createWalletClient({ chain: baseSepolia, transport: custom(eth()), account })
  return account
}

/** Asks the wallet for an account (a prompt the first time) and moves it to Base Sepolia. */
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
  const hash = await wallet.writeContract({ ...request, gas: 300_000n })
  const r = await pub.waitForTransactionReceipt({ hash })
  if (r.status !== 'success') throw new Error(`${functionName} failed on Base`)
  return hash
}

const loans = (fn, args) => call(cfg.loans, LOANS_ABI, fn, args)
const approveUsdc = (amount) => call(cfg.usdc, erc20Abi, 'approve', [cfg.loans, amount])

/**
 * What a wallet holds on Base Sepolia: ETH for fees and USDC, in base units. Read from the
 * public RPC, so the screens can warn before an action would fail. Null when not connected.
 */
export async function balances(a = account) {
  if (!a || !cfg) return null
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
    domain: { name: 'USDC', version: '2', chainId: 84532, verifyingContract: getAddress(cfg.usdc) },
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
