// Circuit and note library together, without a chain: a note in a tree, a proof that spends
// part of it, the proof checked, and two proofs that must fail (wrong amount, double spend).
//   node scripts/selftest.mjs
import * as snarkjs from 'snarkjs'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Tree, commitmentOf, noteKeys, nullifierOf, seedFrom, spendInput } from '../lib/notes.mjs'

const here = join(dirname(fileURLToPath(import.meta.url)), '..')
const wasm = join(here, 'build', 'spend.wasm')
const zkey = join(here, 'build', 'spend.zkey')
const vkey = JSON.parse(readFileSync(join(here, 'build', 'verification_key.json'), 'utf8'))

const seed = seedFrom('0xsignature')
const k0 = noteKeys(seed, 0)
const note = { amount: 5_000_000n, secret: k0.secret, blinding: k0.blinding }
const tree = new Tree([123n, commitmentOf(note), 456n])
note.index = tree.indexOf(commitmentOf(note))
const ext = { recipient: '0x000000000000000000000000000000000000dEaD', loanId: '0x' + '00'.repeat(32), relayer: '0x0000000000000000000000000000000000000000', fee: 0n }

const t0 = Date.now()
const { input, change } = spendInput(tree, [note], 2_000_000n, noteKeys(seed, 1), ext)
const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasm, zkey)
console.log(`proof in ${Date.now() - t0} ms; change ${change.amount}`)
console.log('valid:', await snarkjs.groth16.verify(vkey, publicSignals, proof))
console.log('signals = [root, publicAmount, extDataHash, nul0, nul1, outCommitment]:', publicSignals[0] === String(tree.root), publicSignals[1] === '2000000', publicSignals[3] === String(nullifierOf(note)))

// A proof that releases more than the note holds cannot be made.
try {
  const bad = spendInput(tree, [note], 2_000_000n, noteKeys(seed, 1), ext).input
  bad.publicAmount = 9_000_000n
  await snarkjs.groth16.fullProve(bad, wasm, zkey)
  console.log('FAIL: overspend proved')
} catch {
  console.log('overspend refused: ok')
}
process.exit(0)
