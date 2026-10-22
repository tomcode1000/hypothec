import hre from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import chai, { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import { join } from "path";
import { keccak256, toHex, getAddress, parseSignature, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

chai.use(chaiAsPromised);

// The shielded dollar vault with real proofs (shield/build: run `node scripts/build.mjs` there
// first). Each proof takes a couple of seconds.
const SHIELD = join(__dirname, "..", "..", "shield");
const WASM = join(SHIELD, "build", "spend.wasm");
const ZKEY = join(SHIELD, "build", "spend.zkey");
const ZERO = "0x0000000000000000000000000000000000000000" as const;
const NO_LOAN = ("0x" + "00".repeat(32)) as Hex;
const USDC = (n: number) => BigInt(Math.round(n * 1_000_000));
const DAY = 86_400n;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const load = async (): Promise<any[]> => Promise.all([
  import(join(SHIELD, "lib", "notes.mjs")),
  import(join(SHIELD, "node_modules", "snarkjs", "main.js")),
  import(join(SHIELD, "node_modules", "circomlibjs", "main.js")),
]);

async function setup() {
  const [notes, snarkjs, circomlibjs] = await load();
  const [deployer, lender, refA, refB, relayer, outsider, recipient] = await hre.viem.getWalletClients();
  const pub = await hre.viem.getPublicClient();
  const usdc = await hre.viem.deployContract("TestUSDC");
  const verifier = await hre.viem.deployContract("SpendVerifier");
  // Poseidon on chain: circomlib's own generated contracts, so the hashes match the circuit.
  const deployRaw = async (n: number) => {
    const hash = await deployer.deployContract({ abi: circomlibjs.poseidonContract.generateABI(n), bytecode: circomlibjs.poseidonContract.createCode(n) as Hex });
    return (await pub.waitForTransactionReceipt({ hash })).contractAddress!;
  };
  const p2 = await deployRaw(2);
  const p3 = await deployRaw(3);
  const vault = await hre.viem.deployContract("HypothecVault", [usdc.address, verifier.address, p2, p3]);
  const loans = await hre.viem.deployContract("HypothecLoans", [usdc.address, vault.address]);
  await vault.write.setLoans([loans.address]);
  for (const w of [lender, outsider]) await usdc.write.mint([w.account.address, USDC(50)]);
  const as = (w: typeof lender) => ({
    loans: hre.viem.getContractAt("HypothecLoans", loans.address, { client: { wallet: w } }),
    usdc: hre.viem.getContractAt("TestUSDC", usdc.address, { client: { wallet: w } }),
    vault: hre.viem.getContractAt("HypothecVault", vault.address, { client: { wallet: w } }),
  });
  // The vault's tree, read from its events, as the browser does.
  const tree = async () => {
    const logs = await vault.getEvents.NewCommitment({ fromBlock: 0n });
    return new notes.Tree(logs.sort((a, b) => Number(a.args.index! - b.args.index!)).map((l) => l.args.commitment!));
  };
  // Proves a spend and sends it through the relayer.
  const spend = async (ins: { amount: bigint; secret: bigint; blinding: bigint }[], publicAmount: bigint, change: { secret: bigint; blinding: bigint }, ext: { recipient: Hex; loanId: Hex; relayer: Hex; fee: bigint }) => {
    const t = await tree();
    const withIndex = ins.map((n) => ({ ...n, index: t.indexOf(notes.commitmentOf(n)) }));
    for (const n of withIndex) if (n.index < 0) throw new Error("note not in the tree");
    const { input } = notes.spendInput(t, withIndex, publicAmount, change, ext);
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM, ZKEY);
    const p = notes.toSolidity(proof, publicSignals);
    return (await as(relayer).vault).write.transact([
      { a: p.a, b: p.b, c: p.c }, p.signals[0], p.signals[1], [p.signals[3], p.signals[4]], p.signals[5], ext,
    ]);
  };
  return { notes, deployer, lender, refA, refB, relayer, outsider, recipient, usdc, vault, loans, as, tree, spend };
}

describe("HypothecVault", function () {
  this.timeout(180_000);

  it("a deposit becomes a private note; a proof withdraws part of it to any wallet", async () => {
    const s = await setup();
    const seed = s.notes.seedFrom("0xseed-a");
    const k0 = s.notes.noteKeys(seed, 0);
    await (await s.as(s.outsider).usdc).write.approve([s.vault.address, USDC(10)]);
    await (await s.as(s.outsider).vault).write.deposit([USDC(10), k0.owner, k0.blinding]);
    expect(await s.usdc.read.balanceOf([s.vault.address])).to.equal(USDC(10));

    // Withdraw 4 to a fresh wallet through the relayer; 6 stays as the change note.
    await s.spend([{ amount: USDC(10), secret: k0.secret, blinding: k0.blinding }], USDC(4), s.notes.noteKeys(seed, 1), { recipient: s.recipient.account.address, loanId: NO_LOAN, relayer: ZERO, fee: 0n });
    expect(await s.usdc.read.balanceOf([s.recipient.account.address])).to.equal(USDC(4));
    expect(await s.usdc.read.balanceOf([s.vault.address])).to.equal(USDC(6));

    // The same note again: its nullifier is spent.
    await expect(s.spend([{ amount: USDC(10), secret: k0.secret, blinding: k0.blinding }], USDC(1), s.notes.noteKeys(seed, 2), { recipient: s.recipient.account.address, loanId: NO_LOAN, relayer: ZERO, fee: 0n })).to.be.rejectedWith("Spent");
  });

  it("a relayer cannot redirect a withdrawal (the recipient is bound into the proof)", async () => {
    const s = await setup();
    const seed = s.notes.seedFrom("0xseed-b");
    const k0 = s.notes.noteKeys(seed, 0);
    await (await s.as(s.outsider).usdc).write.approve([s.vault.address, USDC(5)]);
    await (await s.as(s.outsider).vault).write.deposit([USDC(5), k0.owner, k0.blinding]);
    const t = await s.tree();
    const note = { amount: USDC(5), secret: k0.secret, blinding: k0.blinding, index: 0 };
    const ext = { recipient: s.recipient.account.address, loanId: NO_LOAN, relayer: ZERO, fee: 0n };
    const { input } = s.notes.spendInput(t, [note], USDC(5), s.notes.noteKeys(seed, 1), ext);
    const [, snarkjs] = await load();
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM, ZKEY);
    const p = s.notes.toSolidity(proof, publicSignals);
    const stolen = { ...ext, recipient: s.relayer.account.address };
    await expect((await s.as(s.relayer).vault).write.transact([{ a: p.a, b: p.b, c: p.c }, p.signals[0], p.signals[1], [p.signals[3], p.signals[4]], p.signals[5], stolen])).to.be.rejectedWith("BadProof");
  });

  it("a shielded loan: one-time key accepts by signature, the payout is a private note, repaid from inside the vault", async () => {
    const s = await setup();
    const now = BigInt(await time.latest());
    const oneTime = privateKeyToAccount(generatePrivateKey());
    const id = keccak256(toHex("shielded-1"));
    const terms = { borrower: oneTime.address, refereeA: s.refA.account.address, refereeB: s.refB.account.address, repayTo: s.lender.account.address, principal: USDC(5), owed: USDC(5.15), dueAt: now + 90n * DAY, lockBy: now + DAY };
    await (await s.as(s.lender).loans).write.offer([id, terms]);

    // The one-time key signs; the relayer submits. The key never holds gas.
    const seed = s.notes.seedFrom("0xseed-borrower");
    const payout = s.notes.noteKeys(seed, 0);
    const deadline = now + 3600n;
    const digest = await s.loans.read.shieldedAcceptDigest([id, payout.owner, payout.blinding, deadline]);
    const sig = parseSignature(await oneTime.signMessage({ message: { raw: digest } }));
    await (await s.as(s.relayer).loans).write.acceptShielded([id, payout.owner, payout.blinding, deadline, Number(sig.v), sig.r, sig.s]);
    expect(getAddress((await s.loans.read.getLoan([id])).payoutTo)).to.equal(getAddress(s.vault.address));

    const funding = await s.loans.read.fundingAmount([id]);
    await (await s.as(s.lender).usdc).write.approve([s.loans.address, funding]);
    await (await s.as(s.lender).loans).write.fund([id]);
    await (await s.as(s.refA).loans).write.confirmLock([id]);
    await (await s.as(s.refB).loans).write.confirmLock([id]);
    expect(await s.usdc.read.balanceOf([s.vault.address])).to.equal(USDC(5));

    // The interest comes from elsewhere: someone shields 1 more to a second note of the same seed.
    const extra = s.notes.noteKeys(seed, 1);
    await (await s.as(s.outsider).usdc).write.approve([s.vault.address, USDC(1)]);
    await (await s.as(s.outsider).vault).write.deposit([USDC(1), extra.owner, extra.blinding]);

    // Repay 5.15 from both notes; 0.85 stays as change. No wallet of the borrower appears.
    const lenderBefore = await s.usdc.read.balanceOf([s.lender.account.address]);
    await s.spend(
      [{ amount: USDC(5), secret: payout.secret, blinding: payout.blinding }, { amount: USDC(1), secret: extra.secret, blinding: extra.blinding }],
      USDC(5.15), s.notes.noteKeys(seed, 2), { recipient: ZERO, loanId: id, relayer: ZERO, fee: 0n },
    );
    expect((await s.loans.read.getLoan([id])).status).to.equal(5); // Repaid
    expect((await s.usdc.read.balanceOf([s.lender.account.address])) - lenderBefore).to.equal(USDC(5.15));
    expect(await s.usdc.read.balanceOf([s.vault.address])).to.equal(USDC(0.85));
  });

  it("only the loan's one-time key can accept it shielded", async () => {
    const s = await setup();
    const now = BigInt(await time.latest());
    const oneTime = privateKeyToAccount(generatePrivateKey());
    const impostor = privateKeyToAccount(generatePrivateKey());
    const id = keccak256(toHex("shielded-2"));
    await (await s.as(s.lender).loans).write.offer([id, { borrower: oneTime.address, refereeA: s.refA.account.address, refereeB: s.refB.account.address, repayTo: s.lender.account.address, principal: USDC(5), owed: USDC(5.15), dueAt: now + 90n * DAY, lockBy: now + DAY }]);
    const digest = await s.loans.read.shieldedAcceptDigest([id, 7n, 9n, now + 3600n]);
    const sig = parseSignature(await impostor.signMessage({ message: { raw: digest } }));
    await expect((await s.as(s.relayer).loans).write.acceptShielded([id, 7n, 9n, now + 3600n, Number(sig.v), sig.r, sig.s])).to.be.rejectedWith("NotAllowed");
  });
  // A private desk's offer: its one-time key signs, the relayer submits.
  async function privateOffer(s: Awaited<ReturnType<typeof setup>>, id: Hex, desk: ReturnType<typeof privateKeyToAccount>, borrower: Hex, note: { owner: bigint; blinding: bigint }) {
    const now = BigInt(await time.latest());
    const terms = { borrower, refereeA: s.refA.account.address, refereeB: s.refB.account.address, repayTo: desk.address, principal: USDC(5), owed: USDC(5.15), dueAt: now + 90n * DAY, lockBy: now + DAY };
    const deadline = now + 3600n;
    const digest = await s.loans.read.shieldedOfferDigest([id, terms, note.owner, note.blinding, deadline]);
    const sig = parseSignature(await desk.signMessage({ message: { raw: digest } }));
    await (await s.as(s.relayer).loans).write.offerShielded([id, terms, note.owner, note.blinding, deadline, Number(sig.v), sig.r, sig.s]);
  }

  it("private on both sides: a private desk funds from the vault and is repaid into it", async () => {
    const s = await setup();
    const id = keccak256(toHex("private-both"));
    const deskKey = privateKeyToAccount(generatePrivateKey());
    const borrowerKey = privateKeyToAccount(generatePrivateKey());
    const dseed = s.notes.seedFrom("0xseed-desk");
    const bseed = s.notes.seedFrom("0xseed-borrower-2");

    // The desk shields its lending money first (public: someone put 10 in the vault).
    const bank = s.notes.noteKeys(dseed, "bank");
    await (await s.as(s.lender).usdc).write.approve([s.vault.address, USDC(10)]);
    await (await s.as(s.lender).vault).write.deposit([USDC(10), bank.owner, bank.blinding]);

    const back = s.notes.noteKeys(dseed, `lend:${id}`);
    await privateOffer(s, id, deskKey, borrowerKey.address, back);
    const l0 = await s.loans.read.getLoan([id]);
    expect(getAddress(l0.lender)).to.equal(getAddress(deskKey.address));
    expect(getAddress(l0.repayTo)).to.equal(getAddress(s.loans.address));
    expect(await s.loans.read.privateLender([id])).to.equal(true);

    const now = BigInt(await time.latest());
    const payout = s.notes.noteKeys(bseed, 0);
    const adig = await s.loans.read.shieldedAcceptDigest([id, payout.owner, payout.blinding, now + 3600n]);
    const asig = parseSignature(await borrowerKey.signMessage({ message: { raw: adig } }));
    await (await s.as(s.relayer).loans).write.acceptShielded([id, payout.owner, payout.blinding, now + 3600n, Number(asig.v), asig.r, asig.s]);

    // Funding: a proven spend of the desk's note, straight into the loan contract.
    const funding = await s.loans.read.fundingAmount([id]);
    await s.spend([{ amount: USDC(10), secret: bank.secret, blinding: bank.blinding }], funding, s.notes.noteKeys(dseed, "change-1"), { recipient: s.loans.address, loanId: id, relayer: ZERO, fee: 0n });
    expect((await s.loans.read.getLoan([id])).status).to.equal(3); // Funded
    await (await s.as(s.refA).loans).write.confirmLock([id]);
    await (await s.as(s.refB).loans).write.confirmLock([id]);

    // The borrower repays from the vault (payout + an extra note); the desk's note appears.
    const extra = s.notes.noteKeys(bseed, 1);
    await (await s.as(s.outsider).usdc).write.approve([s.vault.address, USDC(1)]);
    await (await s.as(s.outsider).vault).write.deposit([USDC(1), extra.owner, extra.blinding]);
    await s.spend(
      [{ amount: USDC(5), secret: payout.secret, blinding: payout.blinding }, { amount: USDC(1), secret: extra.secret, blinding: extra.blinding }],
      USDC(5.15), s.notes.noteKeys(bseed, 2), { recipient: ZERO, loanId: id, relayer: ZERO, fee: 0n },
    );
    expect((await s.loans.read.getLoan([id])).status).to.equal(5); // Repaid
    const t = await s.tree();
    expect(t.indexOf(s.notes.commitmentOf({ amount: USDC(5.15), ...back }))).to.be.greaterThan(-1);
    expect(await s.usdc.read.balanceOf([s.loans.address])).to.equal(0n);

    // The desk takes its 5.15 out to a fresh wallet: neither side's wallet ever touched the loan.
    await s.spend([{ amount: USDC(5.15), secret: back.secret, blinding: back.blinding }], USDC(5.15), s.notes.noteKeys(dseed, "change-2"), { recipient: s.recipient.account.address, loanId: NO_LOAN, relayer: ZERO, fee: 0n });
    expect(await s.usdc.read.balanceOf([s.recipient.account.address])).to.equal(USDC(5.15));
  });

  it("a private desk cancels by signature after the lock deadline; the funding comes back as its note", async () => {
    const s = await setup();
    const id = keccak256(toHex("private-cancel"));
    const deskKey = privateKeyToAccount(generatePrivateKey());
    const dseed = s.notes.seedFrom("0xseed-desk-2");
    const bank = s.notes.noteKeys(dseed, "bank");
    await (await s.as(s.lender).usdc).write.approve([s.vault.address, USDC(10)]);
    await (await s.as(s.lender).vault).write.deposit([USDC(10), bank.owner, bank.blinding]);
    const back = s.notes.noteKeys(dseed, `lend:${id}`);
    await privateOffer(s, id, deskKey, s.outsider.account.address, back);
    await (await s.as(s.outsider).loans).write.accept([id, s.outsider.account.address]);
    const funding = await s.loans.read.fundingAmount([id]);
    await s.spend([{ amount: USDC(10), secret: bank.secret, blinding: bank.blinding }], funding, s.notes.noteKeys(dseed, "c"), { recipient: s.loans.address, loanId: id, relayer: ZERO, fee: 0n });

    await time.increase(Number(DAY) + 10);
    const deadline = BigInt(await time.latest()) + 3600n;
    const impostor = privateKeyToAccount(generatePrivateKey());
    const bad = parseSignature(await impostor.signMessage({ message: { raw: await s.loans.read.cancelDigest([id, deadline]) } }));
    await expect((await s.as(s.relayer).loans).write.cancelSigned([id, deadline, Number(bad.v), bad.r, bad.s])).to.be.rejectedWith("NotAllowed");
    const sig = parseSignature(await deskKey.signMessage({ message: { raw: await s.loans.read.cancelDigest([id, deadline]) } }));
    await (await s.as(s.relayer).loans).write.cancelSigned([id, deadline, Number(sig.v), sig.r, sig.s]);
    expect((await s.loans.read.getLoan([id])).status).to.equal(7); // Cancelled
    const t = await s.tree();
    expect(t.indexOf(s.notes.commitmentOf({ amount: funding, ...back }))).to.be.greaterThan(-1);
  });

  it("only the vault funds a private desk's loan", async () => {
    const s = await setup();
    const id = keccak256(toHex("private-direct"));
    const deskKey = privateKeyToAccount(generatePrivateKey());
    await privateOffer(s, id, deskKey, s.outsider.account.address, s.notes.noteKeys(s.notes.seedFrom("0xd3"), "x"));
    await (await s.as(s.outsider).loans).write.accept([id, s.outsider.account.address]);
    await expect((await s.as(s.outsider).loans).write.fundFromVault([id])).to.be.rejectedWith("NotAllowed");
  });
});
