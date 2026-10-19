import hre from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import chai, { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import { keccak256, toHex, getAddress } from "viem";

chai.use(chaiAsPromised);

// Small real-USDC-sized numbers, as the demo uses (6 decimals): borrow 5 USDC, owe 5.15.
const USDC = (n: number) => BigInt(Math.round(n * 1_000_000));
const PRINCIPAL = USDC(5);
const OWED = USDC(5.15);
/// Each guardian's fee is 0.10% of the principal; the lender funds both with the principal.
const FEE = (PRINCIPAL * 10n) / 10_000n;
const FUNDING = PRINCIPAL + 2n * FEE;
const DAY = 86_400n;

enum Status { None, Offered, Accepted, Funded, Active, Repaid, Liquidated, Cancelled }

async function setup() {
  const [lender, borrower, refA, refB, payout, repayTo, stranger] = await hre.viem.getWalletClients();
  const usdc = await hre.viem.deployContract("TestUSDC");
  const loans = await hre.viem.deployContract("HypothecLoans", [usdc.address]);
  await usdc.write.mint([lender.account.address, USDC(20)]);
  await usdc.write.mint([borrower.account.address, USDC(20)]);
  // The contracts as seen by one wallet (each a promise: `await (await s.as(w).loans)`).
  const as = (w: typeof lender) => ({
    loans: hre.viem.getContractAt("HypothecLoans", loans.address, { client: { wallet: w } }),
    usdc: hre.viem.getContractAt("TestUSDC", usdc.address, { client: { wallet: w } }),
  });
  const now = BigInt(await time.latest());
  const id = keccak256(toHex("loan-001"));
  const terms = {
    borrower: borrower.account.address,
    refereeA: refA.account.address,
    refereeB: refB.account.address,
    repayTo: repayTo.account.address,
    principal: PRINCIPAL,
    owed: OWED,
    dueAt: now + 90n * DAY,
    lockBy: now + 1n * DAY,
  };
  return { lender, borrower, refA, refB, payout, repayTo, stranger, usdc, loans, as, id, terms, now };
}

async function balance(usdc: { read: { balanceOf: (a: [`0x${string}`]) => Promise<bigint> } }, who: { account: { address: `0x${string}` } }) {
  return usdc.read.balanceOf([who.account.address]);
}

/// offer -> accept -> fund -> both referees confirm the lock.
async function activate(s: Awaited<ReturnType<typeof setup>>) {
  await (await s.as(s.lender).loans).write.offer([s.id, s.terms]);
  await (await s.as(s.borrower).loans).write.accept([s.id, s.payout.account.address]);
  await (await s.as(s.lender).usdc).write.approve([s.loans.address, FUNDING]);
  await (await s.as(s.lender).loans).write.fund([s.id]);
  await (await s.as(s.refA).loans).write.confirmLock([s.id]);
  await (await s.as(s.refB).loans).write.confirmLock([s.id]);
}

describe("HypothecLoans", () => {
  it("pays the borrower only after both referees confirm the lock", async () => {
    const s = await setup();
    await (await s.as(s.lender).loans).write.offer([s.id, s.terms]);
    await (await s.as(s.borrower).loans).write.accept([s.id, s.payout.account.address]);
    await (await s.as(s.lender).usdc).write.approve([s.loans.address, FUNDING]);
    await (await s.as(s.lender).loans).write.fund([s.id]);
    expect(await balance(s.usdc, s.payout)).to.equal(0n);
    expect(await s.usdc.read.balanceOf([s.loans.address])).to.equal(FUNDING); // principal + both fees

    await (await s.as(s.refA).loans).write.confirmLock([s.id]);
    expect(await balance(s.usdc, s.payout)).to.equal(0n); // one referee is not enough
    expect((await s.loans.read.getLoan([s.id])).status).to.equal(Status.Funded);

    await (await s.as(s.refB).loans).write.confirmLock([s.id]);
    expect(await balance(s.usdc, s.payout)).to.equal(PRINCIPAL);
    expect(await s.usdc.read.balanceOf([s.loans.address])).to.equal(0n);
    expect((await s.loans.read.getLoan([s.id])).status).to.equal(Status.Active);
  });

  it("forwards repayments to the lender and marks the loan repaid when paid in full", async () => {
    const s = await setup();
    await activate(s);
    const borrowerLoans = await s.as(s.borrower).loans;
    await (await s.as(s.borrower).usdc).write.approve([s.loans.address, USDC(10)]);

    await borrowerLoans.write.repay([s.id, USDC(2)]);
    expect(await balance(s.usdc, s.repayTo)).to.equal(USDC(2));
    expect((await s.loans.read.getLoan([s.id])).status).to.equal(Status.Active);

    // Overpaying takes only what is still owed.
    await borrowerLoans.write.repay([s.id, USDC(9)]);
    expect(await balance(s.usdc, s.repayTo)).to.equal(OWED);
    expect(await balance(s.usdc, s.borrower)).to.equal(USDC(20) - OWED);
    const loan = await s.loans.read.getLoan([s.id]);
    expect(loan.status).to.equal(Status.Repaid);
    expect(loan.repaid).to.equal(OWED);
    await expect(borrowerLoans.write.repay([s.id, 1n])).to.be.rejectedWith("WrongStatus");
  });

  it("emits Repaid, the event the referees release the ZEC on", async () => {
    const s = await setup();
    await activate(s);
    await (await s.as(s.borrower).usdc).write.approve([s.loans.address, OWED]);
    await (await s.as(s.borrower).loans).write.repay([s.id, OWED]);
    const events = await s.loans.getEvents.Repaid();
    expect(events).to.have.length(1);
    expect(events[0].args.id).to.equal(s.id);
  });

  it("lets only the referees confirm the lock or a liquidation, and needs both", async () => {
    const s = await setup();
    await (await s.as(s.lender).loans).write.offer([s.id, s.terms]);
    await (await s.as(s.borrower).loans).write.accept([s.id, s.payout.account.address]);
    await (await s.as(s.lender).usdc).write.approve([s.loans.address, FUNDING]);
    await (await s.as(s.lender).loans).write.fund([s.id]);
    for (const w of [s.lender, s.borrower, s.stranger]) {
      await expect((await s.as(w).loans).write.confirmLock([s.id])).to.be.rejectedWith("NotAllowed");
    }
    await (await s.as(s.refA).loans).write.confirmLock([s.id]);
    await (await s.as(s.refB).loans).write.confirmLock([s.id]);

    await expect((await s.as(s.lender).loans).write.confirmLiquidation([s.id])).to.be.rejectedWith("NotAllowed");
    await (await s.as(s.refA).loans).write.confirmLiquidation([s.id]);
    expect((await s.loans.read.getLoan([s.id])).status).to.equal(Status.Active);
    await (await s.as(s.refB).loans).write.confirmLiquidation([s.id]);
    expect((await s.loans.read.getLoan([s.id])).status).to.equal(Status.Liquidated);
  });

  it("lets only the named borrower accept, which is where they agree to the referees", async () => {
    const s = await setup();
    await (await s.as(s.lender).loans).write.offer([s.id, s.terms]);
    await expect((await s.as(s.stranger).loans).write.accept([s.id, s.stranger.account.address])).to.be.rejectedWith("NotAllowed");
    await (await s.as(s.borrower).loans).write.accept([s.id, s.payout.account.address]);
    const loan = await s.loans.read.getLoan([s.id]);
    expect(getAddress(loan.payoutTo)).to.equal(getAddress(s.payout.account.address));
    expect(getAddress(loan.refereeA)).to.equal(getAddress(s.refA.account.address));
  });

  it("refuses terms where the lender or borrower is also a referee, or the referees repeat", async () => {
    const s = await setup();
    const lenderLoans = await s.as(s.lender).loans;
    const bad = [
      { ...s.terms, refereeA: s.lender.account.address },
      { ...s.terms, refereeB: s.borrower.account.address },
      { ...s.terms, refereeB: s.terms.refereeA },
      { ...s.terms, owed: PRINCIPAL - 1n },
      { ...s.terms, lockBy: s.terms.dueAt },
    ];
    for (const t of bad) {
      await expect(lenderLoans.write.offer([s.id, t])).to.be.rejectedWith("BadTerms");
    }
  });

  it("returns the funded principal to the lender if the lock is never confirmed", async () => {
    const s = await setup();
    await (await s.as(s.lender).loans).write.offer([s.id, s.terms]);
    await (await s.as(s.borrower).loans).write.accept([s.id, s.payout.account.address]);
    await (await s.as(s.lender).usdc).write.approve([s.loans.address, FUNDING]);
    await (await s.as(s.lender).loans).write.fund([s.id]);
    const lenderLoans = await s.as(s.lender).loans;
    await expect(lenderLoans.write.cancel([s.id])).to.be.rejectedWith("WrongStatus"); // too early
    await expect((await s.as(s.borrower).loans).write.cancel([s.id])).to.be.rejectedWith("NotAllowed");
    await time.increaseTo(s.terms.lockBy + 1n);
    await lenderLoans.write.cancel([s.id]);
    expect(await balance(s.usdc, s.lender)).to.equal(USDC(20));
    expect((await s.loans.read.getLoan([s.id])).status).to.equal(Status.Cancelled);
  });

  it("flags an active loan as overdue after the deadline, never before", async () => {
    const s = await setup();
    await activate(s);
    expect(await s.loans.read.isOverdue([s.id])).to.equal(false);
    await time.increaseTo(s.terms.dueAt + 1n);
    expect(await s.loans.read.isOverdue([s.id])).to.equal(true);
  });

  it("stores nothing about the ZEC collateral", async () => {
    const s = await setup();
    await activate(s);
    const fields = Object.keys(await s.loans.read.getLoan([s.id]));
    for (const f of fields) expect(f.toLowerCase()).to.not.match(/zec|vault|collateral/);
  });
});

/* --------------------------------------------------------- repay all at once -- */

/// A second loan for the same borrower from another lender (`stranger`), as when one
/// borrow is filled from two desks (docs/DECISIONS.md D16).
async function secondLoan(s: Awaited<ReturnType<typeof setup>>, owed = USDC(2.06)) {
  const id2 = keccak256(toHex("loan-002"));
  await s.usdc.write.mint([s.stranger.account.address, USDC(20)]);
  const terms2 = { ...s.terms, repayTo: s.stranger.account.address, principal: USDC(2), owed };
  await (await s.as(s.stranger).loans).write.offer([id2, terms2]);
  await (await s.as(s.borrower).loans).write.accept([id2, s.payout.account.address]);
  await (await s.as(s.stranger).usdc).write.approve([s.loans.address, USDC(2) + 2n * (USDC(2) * 10n) / 10_000n]);
  await (await s.as(s.stranger).loans).write.fund([id2]);
  await (await s.as(s.refA).loans).write.confirmLock([id2]);
  await (await s.as(s.refB).loans).write.confirmLock([id2]);
  return { id2, owed2: owed };
}

async function permitSig(s: Awaited<ReturnType<typeof setup>>, value: bigint, deadline: bigint) {
  const nonce = await s.usdc.read.nonces([s.borrower.account.address]);
  const sig = await s.borrower.signTypedData({
    domain: { name: "USDC", version: "2", chainId: await s.borrower.getChainId(), verifyingContract: s.usdc.address },
    types: { Permit: [
      { name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" },
      { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" },
    ] },
    primaryType: "Permit",
    message: { owner: s.borrower.account.address, spender: s.loans.address, value, nonce, deadline },
  });
  return { v: Number(BigInt("0x" + sig.slice(130, 132))), r: ("0x" + sig.slice(2, 66)) as `0x${string}`, s: ("0x" + sig.slice(66, 130)) as `0x${string}` };
}

describe("HypothecLoans: repay all at once", () => {
  it("repays loans from two lenders in one transaction, each lender paid its own", async () => {
    const s = await setup();
    await activate(s);
    const { id2, owed2 } = await secondLoan(s);
    const before = await balance(s.usdc, s.borrower);
    await (await s.as(s.borrower).usdc).write.approve([s.loans.address, OWED + owed2]);
    await (await s.as(s.borrower).loans).write.repayAll([[s.id, id2]]);
    expect(await balance(s.usdc, s.repayTo)).to.equal(OWED);
    // The second lender funded 2 USDC plus both guardians' fees, and got its owed back.
    expect(await balance(s.usdc, s.stranger)).to.equal(USDC(20) - USDC(2) - 2n * ((USDC(2) * 10n) / 10_000n) + owed2);
    expect(await balance(s.usdc, s.borrower)).to.equal(before - OWED - owed2);
    for (const id of [s.id, id2]) {
      const l = await s.loans.read.getLoan([id]);
      expect(l.status).to.equal(Status.Repaid);
      expect(l.repaid).to.equal(l.owed);
    }
    // Each loan emits Repaid, the event the referees release on.
    const events = await s.loans.getEvents.Repaid();
    expect(events.map((e) => e.args.id)).to.include.members([s.id, id2]);
  });

  it("pays only what is left on a partly repaid loan", async () => {
    const s = await setup();
    await activate(s);
    const { id2, owed2 } = await secondLoan(s);
    await (await s.as(s.borrower).usdc).write.approve([s.loans.address, USDC(20)]);
    await (await s.as(s.borrower).loans).write.repay([s.id, USDC(1)]);
    const before = await balance(s.usdc, s.borrower);
    await (await s.as(s.borrower).loans).write.repayAll([[s.id, id2]]);
    expect(await balance(s.usdc, s.borrower)).to.equal(before - (OWED - USDC(1)) - owed2);
    expect(await balance(s.usdc, s.repayTo)).to.equal(OWED);
  });

  it("is all or nothing: a loan that is not running, or listed twice, stops the whole payment", async () => {
    const s = await setup();
    await activate(s);
    const { id2 } = await secondLoan(s);
    await (await s.as(s.borrower).usdc).write.approve([s.loans.address, USDC(20)]);
    const before = await balance(s.usdc, s.borrower);
    // Liquidated piece: both referees record it.
    await (await s.as(s.refA).loans).write.confirmLiquidation([id2]);
    await (await s.as(s.refB).loans).write.confirmLiquidation([id2]);
    await expect((await s.as(s.borrower).loans).write.repayAll([[s.id, id2]])).to.be.rejectedWith("WrongStatus");
    await expect((await s.as(s.borrower).loans).write.repayAll([[s.id, s.id]])).to.be.rejectedWith("WrongStatus");
    await expect((await s.as(s.borrower).loans).write.repayAll([[]])).to.be.rejectedWith("BadTerms");
    expect(await balance(s.usdc, s.borrower)).to.equal(before);
    expect((await s.loans.read.getLoan([s.id])).status).to.equal(Status.Active);
  });

  it("with a permit: one signature and one transaction, no separate approve", async () => {
    const s = await setup();
    await activate(s);
    const { id2, owed2 } = await secondLoan(s);
    const total = OWED + owed2;
    const deadline = BigInt(await time.latest()) + 600n;
    const p = await permitSig(s, total, deadline);
    expect(await s.usdc.read.allowance([s.borrower.account.address, s.loans.address])).to.equal(0n);
    await (await s.as(s.borrower).loans).write.repayAllWithPermit([[s.id, id2], total, deadline, p.v, p.r, p.s]);
    expect((await s.loans.read.getLoan([s.id])).status).to.equal(Status.Repaid);
    expect((await s.loans.read.getLoan([id2])).status).to.equal(Status.Repaid);
  });

  it("with a permit someone else already submitted: still repays, from that allowance", async () => {
    const s = await setup();
    await activate(s);
    const deadline = BigInt(await time.latest()) + 600n;
    const p = await permitSig(s, OWED, deadline);
    // A third party front-runs the permit; the borrower's call must still go through.
    await (await s.as(s.stranger).usdc).write.permit([s.borrower.account.address, s.loans.address, OWED, deadline, p.v, p.r, p.s]);
    await (await s.as(s.borrower).loans).write.repayAllWithPermit([[s.id], OWED, deadline, p.v, p.r, p.s]);
    expect((await s.loans.read.getLoan([s.id])).status).to.equal(Status.Repaid);
  });
});

describe("HypothecLoans: guardian fees", () => {
  it("pays each guardian 0.10% of the principal when the lock is confirmed, from the lender's funding", async () => {
    const s = await setup();
    const lenderBefore = await balance(s.usdc, s.lender);
    await activate(s);
    expect(await balance(s.usdc, s.payout)).to.equal(PRINCIPAL); // the borrower gets exactly the principal
    expect(await balance(s.usdc, s.refA)).to.equal(FEE);
    expect(await balance(s.usdc, s.refB)).to.equal(FEE);
    expect(lenderBefore - (await balance(s.usdc, s.lender))).to.equal(FUNDING);
    expect(await s.usdc.read.balanceOf([s.loans.address])).to.equal(0n);
    expect(await s.loans.read.fundingAmount([s.id])).to.equal(FUNDING);
  });

  it("pays the same fee whatever happens next: repaid or liquidated", async () => {
    for (const end of ["repay", "liquidate"]) {
      const s = await setup();
      await activate(s);
      if (end === "repay") {
        await (await s.as(s.borrower).usdc).write.approve([s.loans.address, OWED]);
        await (await s.as(s.borrower).loans).write.repay([s.id, OWED]);
      } else {
        await (await s.as(s.refA).loans).write.confirmLiquidation([s.id]);
        await (await s.as(s.refB).loans).write.confirmLiquidation([s.id]);
      }
      expect(await balance(s.usdc, s.refA)).to.equal(FEE);
      expect(await balance(s.usdc, s.refB)).to.equal(FEE);
    }
  });

  it("returns the fees with the principal if the lock is never confirmed", async () => {
    const s = await setup();
    const lenderBefore = await balance(s.usdc, s.lender);
    await (await s.as(s.lender).loans).write.offer([s.id, s.terms]);
    await (await s.as(s.borrower).loans).write.accept([s.id, s.payout.account.address]);
    await (await s.as(s.lender).usdc).write.approve([s.loans.address, FUNDING]);
    await (await s.as(s.lender).loans).write.fund([s.id]);
    await time.increaseTo(s.terms.lockBy + 1n);
    await (await s.as(s.lender).loans).write.cancel([s.id]);
    expect(await balance(s.usdc, s.lender)).to.equal(lenderBefore);
    expect(await balance(s.usdc, s.refA)).to.equal(0n);
  });
});
