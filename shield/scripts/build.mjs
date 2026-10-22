// Builds the vault's circuit and its TEST proving keys, and writes the Solidity verifier.
//   node scripts/build.mjs
// Outputs: build/spend.wasm and build/spend.zkey (the browser loads these to prove),
// build/verification_key.json, and ../usdc/contracts/vault/SpendVerifier.sol.
// The keys come from a one-machine setup with random contributions: fine for testnet, never
// for real money (a real deployment needs a multi-party ceremony).
import { execFileSync } from 'node:child_process'
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = join(dirname(fileURLToPath(import.meta.url)), '..')
const build = join(here, 'build')
// Each tool's own script under node (no shell): the repository path has a space in it.
const BIN = { circom2: 'node_modules/circom2/cli.js', snarkjs: 'node_modules/snarkjs/build/cli.cjs' }
const run = (n, args) => execFileSync(process.execPath, [join(here, BIN[n]), ...args], { cwd: here, stdio: 'inherit' })
mkdirSync(build, { recursive: true })

// The compiler cannot write to a path with a space in it: compile in a temporary
// folder (with the circuit and circomlib's circuits) and copy the results back.
const tmp = mkdtempSync(join(tmpdir(), 'hypothec-zk-'))
cpSync(join(here, 'circuits'), join(tmp, 'circuits'), { recursive: true })
cpSync(join(here, 'node_modules', 'circomlib', 'circuits'), join(tmp, 'node_modules', 'circomlib', 'circuits'), { recursive: true })
mkdirSync(join(tmp, 'build'))
// The native compiler (tools/circom.exe on Windows, from iden3's v2.2.2 release; `circom` on
// the PATH elsewhere).
const circom = process.platform === 'win32' ? join(here, 'tools', 'circom.exe') : 'circom'
execFileSync(circom, ['circuits/spend.circom', '--r1cs', '--wasm', '--sym', '-o', 'build'], { cwd: tmp, stdio: 'inherit' })
cpSync(join(tmp, 'build'), build, { recursive: true })

const ptau = join(build, 'pot15_final.ptau')
if (!existsSync(ptau)) {
  run('snarkjs', ['powersoftau', 'new', 'bn128', '15', 'build/pot15_0.ptau'])
  run('snarkjs', ['powersoftau', 'contribute', 'build/pot15_0.ptau', 'build/pot15_1.ptau', '--name=hypothec-test', `-e=${randomBytes(32).toString('hex')}`])
  run('snarkjs', ['powersoftau', 'prepare', 'phase2', 'build/pot15_1.ptau', 'build/pot15_final.ptau'])
}
run('snarkjs', ['groth16', 'setup', 'build/spend.r1cs', 'build/pot15_final.ptau', 'build/spend_0.zkey'])
run('snarkjs', ['zkey', 'contribute', 'build/spend_0.zkey', 'build/spend.zkey', '--name=hypothec-test', `-e=${randomBytes(32).toString('hex')}`])
run('snarkjs', ['zkey', 'export', 'verificationkey', 'build/spend.zkey', 'build/verification_key.json'])
const verifier = join(here, '..', 'usdc', 'contracts', 'vault', 'SpendVerifier.sol')
mkdirSync(dirname(verifier), { recursive: true })
run('snarkjs', ['zkey', 'export', 'solidityverifier', 'build/spend.zkey', verifier])
// snarkjs names it Groth16Verifier; one name per contract in the project.
writeFileSync(verifier, readFileSync(verifier, 'utf8').replace(/contract Groth16Verifier/, 'contract SpendVerifier'))
copyFileSync(join(build, 'spend_js', 'spend.wasm'), join(build, 'spend.wasm'))
console.log('built: build/spend.wasm, build/spend.zkey, contracts/vault/SpendVerifier.sol')
