// The shielded dollar vault, client side: notes, the vault's Merkle tree and the proof's
// inputs. Shared by the contract tests (Node) and the browser (bundled by web/build.mjs).
//
//   note        { amount, secret, blinding }          (amount in the stablecoin's 6 decimals)
//   owner       Poseidon(secret)
//   commitment  Poseidon(amount, owner, blinding)       (the leaf in the vault's tree)
//   nullifier   Poseidon(secret, blinding)              (published when the note is spent)
//
// Every note has its own secret, so two notes of one person share nothing on chain. All of a
// person's notes come from one seed, which their wallet's signature makes (seedFrom): losing
// the browser loses nothing, signing again finds every note.
import { poseidon1, poseidon2, poseidon3 } from 'poseidon-lite'
import { encodeAbiParameters, keccak256, toHex } from 'viem'

export const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n
export const LEVELS = 20

const mod = (x) => ((x % FIELD) + FIELD) % FIELD
const h = (...parts) => mod(BigInt(keccak256(toHex(parts.join(':')))))

/** A person's note seed, from a wallet signature of a fixed message (see SEED_MESSAGE). */
export const SEED_MESSAGE = 'Hypothec private balance\n\nSign to open your private balance on this site. It creates the keys of your private notes; it costs nothing and moves no money.'
export const seedFrom = (signature) => h('hypothec-seed', signature)

/** The k-th note keys of a seed: a fresh owner and blinding for every note. */
export function noteKeys(seed, k) {
  const secret = h('secret', seed, k)
  const blinding = h('blinding', seed, k)
  return { secret, blinding, owner: poseidon1([secret]) }
}

export const ownerOf = (secret) => poseidon1([secret])
export const commitmentOf = (n) => poseidon3([n.amount, ownerOf(n.secret), n.blinding])
export const nullifierOf = (n) => poseidon2([n.secret, n.blinding])

/** The vault's tree, rebuilt from its leaves in order (as the contract inserts them). */
export class Tree {
  constructor(leaves = []) {
    this.zeros = [0n]
    for (let i = 0; i < LEVELS; i++) this.zeros.push(poseidon2([this.zeros[i], this.zeros[i]]))
    this.layers = [leaves.map(BigInt)]
    this.rebuild()
  }
  insert(leaf) {
    this.layers[0].push(BigInt(leaf))
    this.rebuild()
  }
  rebuild() {
    for (let l = 0; l < LEVELS; l++) {
      const cur = this.layers[l]
      const next = []
      for (let i = 0; i < cur.length; i += 2) next.push(poseidon2([cur[i], i + 1 < cur.length ? cur[i + 1] : this.zeros[l]]))
      this.layers[l + 1] = next
    }
  }
  get root() {
    return this.layers[LEVELS][0] ?? this.zeros[LEVELS]
  }
  indexOf(leaf) {
    return this.layers[0].indexOf(BigInt(leaf))
  }
  path(index) {
    const pathElements = []
    const pathIndices = []
    let i = index
    for (let l = 0; l < LEVELS; l++) {
      const sib = i ^ 1
      pathElements.push(sib < this.layers[l].length ? this.layers[l][sib] : this.zeros[l])
      pathIndices.push(i & 1)
      i >>= 1
    }
    return { pathElements, pathIndices }
  }
}

/** What a spend does outside the vault, hashed into the proof so a relayer cannot change it. */
export function extDataHash(ext) {
  const enc = encodeAbiParameters(
    [{ type: 'tuple', components: [{ name: 'recipient', type: 'address' }, { name: 'loanId', type: 'bytes32' }, { name: 'relayer', type: 'address' }, { name: 'fee', type: 'uint256' }] }],
    [ext],
  )
  return mod(BigInt(keccak256(enc)))
}

/**
 * The circuit's input for spending `ins` (one or two notes in the tree), releasing
 * `publicAmount` and keeping the rest as the change note `change` ({ secret, blinding }).
 */
export function spendInput(tree, ins, publicAmount, change, ext) {
  const total = ins.reduce((a, n) => a + n.amount, 0n)
  if (publicAmount > total) throw new Error('the notes hold less than that')
  const padded = [...ins]
  // An empty second input: amount 0, a random secret so its nullifier is unique.
  while (padded.length < 2) padded.push({ amount: 0n, secret: h('dummy', Date.now(), Math.random()), blinding: h('dummyb', Math.random()), index: 0 })
  const paths = padded.map((n) => (n.amount > 0n ? tree.path(n.index) : { pathElements: Array(LEVELS).fill(0n), pathIndices: Array(LEVELS).fill(0) }))
  const outAmount = total - publicAmount
  const outCommitment = poseidon3([outAmount, ownerOf(change.secret), change.blinding])
  return {
    input: {
      root: tree.root,
      publicAmount,
      extDataHash: extDataHash(ext),
      inputNullifier: padded.map(nullifierOf),
      outputCommitment: outCommitment,
      inAmount: padded.map((n) => n.amount),
      inSecret: padded.map((n) => n.secret),
      inBlinding: padded.map((n) => n.blinding),
      inPathElements: paths.map((p) => p.pathElements),
      inPathIndices: paths.map((p) => p.pathIndices),
      outAmount,
      outOwner: ownerOf(change.secret),
      outBlinding: change.blinding,
    },
    change: { amount: outAmount, secret: change.secret, blinding: change.blinding, commitment: outCommitment },
  }
}

/** snarkjs's proof, in the order the Solidity verifier takes it. */
export function toSolidity(proof, publicSignals) {
  return {
    a: [BigInt(proof.pi_a[0]), BigInt(proof.pi_a[1])],
    b: [[BigInt(proof.pi_b[0][1]), BigInt(proof.pi_b[0][0])], [BigInt(proof.pi_b[1][1]), BigInt(proof.pi_b[1][0])]],
    c: [BigInt(proof.pi_c[0]), BigInt(proof.pi_c[1])],
    signals: publicSignals.map(BigInt),
  }
}
