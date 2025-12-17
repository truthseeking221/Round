import { describe, it, expect, beforeEach } from "vitest";
import { Blockchain, type SandboxContract, TreasuryContract } from "@ton/sandbox";
import { toNano } from "@ton/core";
import { keyPairFromSeed } from "@ton/crypto";
import { randomBytes } from "crypto";

// eslint-disable-next-line import/no-unresolved
import { CircleContract } from "../build/CircleContract_CircleContract";
// eslint-disable-next-line import/no-unresolved
import { JettonWalletMock } from "../build/JettonWalletMock_JettonWalletMock";

import {
  TON_0_2,
  PURPOSE_PREFUND,
  buildBidHash,
  buildCommitBody,
  buildFinalizeBody,
  buildJoinBody,
  buildRevealBody,
  buildStopBody,
  buildTakeWalletBody,
  buildTestNotificationBody,
  buildTriggerDebitAllBody,
  buildWithdrawBody,
  deployContract,
  expectTxFail,
  expectTxSuccess,
  sendBody,
  u256From
} from "./testUtils";

describe("Attack Pack F/I — Settlement safety locks & EmergencyStop withdrawals", () => {
  let blockchain: Blockchain;
  let deployer: SandboxContract<TreasuryContract>;
  let jettonMaster: SandboxContract<TreasuryContract>;
  let treasuryOwner: SandboxContract<TreasuryContract>;
  let guardianKeypair: ReturnType<typeof keyPairFromSeed>;

  beforeEach(async () => {
    blockchain = await Blockchain.create();
    blockchain.now = 1_700_000_000;
    deployer = await blockchain.treasury("deployer");
    jettonMaster = await blockchain.treasury("jettonMaster");
    treasuryOwner = await blockchain.treasury("treasuryOwner");
    guardianKeypair = keyPairFromSeed(randomBytes(32));
  });

  it("F35: Cycle 1 settlement math (fee + vesting + safety lock + immediate) is correct", async () => {
    const winner = await blockchain.treasury("mathA");
    const other = await blockchain.treasury("mathB");

    const jettonWallet = blockchain.openContract(await JettonWalletMock.fromInit(false));
    await deployContract(jettonWallet, deployer, toNano("0.2"));

    const circle = blockchain.openContract(
      await CircleContract.fromInit({
        $$type: "Config",
        jetton_master: jettonMaster.address,
        guardian_pubkey: BigInt(`0x${Buffer.from(guardianKeypair.publicKey).toString("hex")}`),
        treasury_owner: treasuryOwner.address,
        n_members: 2n,
        contribution: 1_000_000n,
        total_cycles: 2n,
        interval_sec: 0n,
        grace_sec: 3600n,
        take_rate_bps: 100n, // 1%
        collateral_rate_bps: 0n,
        max_discount_bps: 500n, // 5%
        vesting_bps_cycle1: 2000n, // 20%
        early_lock_rate_bps_cycle1: 3000n, // 30%
        commit_duration_sec: 10n,
        reveal_duration_sec: 10n,
        max_pot_cap: 10_000_000n,
        min_deposit_units: 1n
      })
    );
    await deployContract(circle, deployer, toNano("0.5"));
    await sendBody(jettonMaster, circle.address, buildTakeWalletBody(jettonWallet.address), TON_0_2);

    const exp = blockchain.now + 600;
    await sendBody(winner, circle.address, buildJoinBody(circle.address, winner.address, exp, 1n, guardianKeypair.secretKey), TON_0_2);
    await sendBody(other, circle.address, buildJoinBody(circle.address, other.address, exp, 2n, guardianKeypair.secretKey), TON_0_2);

    // Fund both
    await sendBody(deployer, jettonWallet.address, buildTestNotificationBody(circle.address, 11, 1_000_000n, winner.address, PURPOSE_PREFUND), TON_0_2);
    await sendBody(deployer, jettonWallet.address, buildTestNotificationBody(circle.address, 12, 1_000_000n, other.address, PURPOSE_PREFUND), TON_0_2);

    const pot = 2_000_000n;
    const payoutGross = 1_900_000n; // min payout
    const saltW = u256From(randomBytes(32));
    const saltO = u256From(randomBytes(32));
    await sendBody(winner, circle.address, buildCommitBody(u256From(buildBidHash(circle.address, 1, winner.address, payoutGross, saltW))), TON_0_2);
    await sendBody(other, circle.address, buildCommitBody(u256From(buildBidHash(circle.address, 1, other.address, pot, saltO))), TON_0_2);

    blockchain.now += 10;
    await sendBody(winner, circle.address, buildRevealBody(payoutGross, saltW), TON_0_2);
    await sendBody(other, circle.address, buildRevealBody(pot, saltO), TON_0_2);

    blockchain.now += 10;
    await sendBody(winner, circle.address, buildFinalizeBody(), TON_0_2);

    const w = await circle.getGetMember(winner.address);
    const o = await circle.getGetMember(other.address);

    // Expected math:
    // fee = 1_900_000 * 1% = 19_000
    // payoutNet = 1_881_000
    // vesting (20%) = 376_200
    // afterVesting = 1_504_800
    // safety lock = min(300_000, afterVesting) = 300_000
    // immediate = 1_204_800
    expect(w.withdrawable).toEqual(1_204_800n);
    expect(w.vesting_locked).toEqual(376_200n);
    expect(w.future_locked).toEqual(300_000n);
    expect(w.has_won).toEqual(true);

    // discount = pot - payoutGross = 100_000 => credit to other (N-1=1)
    expect(o.credit).toEqual(100_000n);
    expect(await circle.getGetTreasuryOwed()).toEqual(19_000n);
  });

  it("A6/F38: Funding uses credit -> future_locked -> prefund (and future_locked auto-debits)", async () => {
    const memberA = await blockchain.treasury("orderA");
    const memberB = await blockchain.treasury("orderB");
    const memberC = await blockchain.treasury("orderC");

    const jettonWallet = blockchain.openContract(await JettonWalletMock.fromInit(false));
    await deployContract(jettonWallet, deployer, toNano("0.2"));

    const circle = blockchain.openContract(
      await CircleContract.fromInit({
        $$type: "Config",
        jetton_master: jettonMaster.address,
        guardian_pubkey: BigInt(`0x${Buffer.from(guardianKeypair.publicKey).toString("hex")}`),
        treasury_owner: treasuryOwner.address,
        n_members: 3n,
        contribution: 1_000_000n,
        total_cycles: 3n,
        interval_sec: 0n,
        grace_sec: 3600n,
        take_rate_bps: 0n,
        collateral_rate_bps: 0n,
        max_discount_bps: 500n,
        vesting_bps_cycle1: 0n,
        early_lock_rate_bps_cycle1: 10_000n, // lock 100% remaining obligation to make future_locked large enough
        commit_duration_sec: 10n,
        reveal_duration_sec: 10n,
        max_pot_cap: 10_000_000n,
        min_deposit_units: 1n
      })
    );
    await deployContract(circle, deployer, toNano("0.5"));
    await sendBody(jettonMaster, circle.address, buildTakeWalletBody(jettonWallet.address), TON_0_2);

    const exp = blockchain.now + 600;
    for (const [nonce, who] of [
      [1n, memberA],
      [2n, memberB],
      [3n, memberC]
    ] as const) {
      await sendBody(who, circle.address, buildJoinBody(circle.address, who.address, exp, nonce, guardianKeypair.secretKey), TON_0_2);
    }

    // Cycle 1 fund all.
    for (const [qid, who] of [
      [11, memberA],
      [12, memberB],
      [13, memberC]
    ] as const) {
      await sendBody(deployer, jettonWallet.address, buildTestNotificationBody(circle.address, qid, 1_000_000n, who.address, PURPOSE_PREFUND), TON_0_2);
    }
    expect((await circle.getGetStatus()).phase).toEqual(1n); // Commit

    // No bids -> fallback winner = memberA, payoutGross = pot (3_000_000)
    const st1 = await circle.getGetStatus();
    blockchain.now = Number(st1.reveal_end_at);
    await sendBody(memberA, circle.address, buildFinalizeBody(), TON_0_2);
    const aAfterC1 = await circle.getGetMember(memberA.address);
    expect(aAfterC1.has_won).toEqual(true);
    expect(aAfterC1.future_locked).toEqual(2_000_000n); // remaining obligation 2*C, locked 100%

    // Cycle 2 funding: A should pay from future_locked, B/C from prefund.
    await sendBody(deployer, jettonWallet.address, buildTestNotificationBody(circle.address, 21, 1_000_000n, memberB.address, PURPOSE_PREFUND), TON_0_2);
    await sendBody(deployer, jettonWallet.address, buildTestNotificationBody(circle.address, 22, 1_000_000n, memberC.address, PURPOSE_PREFUND), TON_0_2);
    await sendBody(memberB, circle.address, buildTriggerDebitAllBody(), TON_0_2);
    const aAfterC2Funding = await circle.getGetMember(memberA.address);
    expect(aAfterC2Funding.due_remaining).toEqual(0n);
    expect(aAfterC2Funding.future_locked).toEqual(1_000_000n); // spent 1*C from future_locked

    // Cycle 2 auction: B wins with max discount (min payout) -> A gets credit.
    const pot = 3_000_000n;
    const minPayout = 2_850_000n;
    const saltB = u256From(randomBytes(32));
    const saltC = u256From(randomBytes(32));
    await sendBody(memberB, circle.address, buildCommitBody(u256From(buildBidHash(circle.address, 2, memberB.address, minPayout, saltB))), TON_0_2);
    await sendBody(memberC, circle.address, buildCommitBody(u256From(buildBidHash(circle.address, 2, memberC.address, pot, saltC))), TON_0_2);

    blockchain.now += 10;
    await sendBody(memberB, circle.address, buildRevealBody(minPayout, saltB), TON_0_2);
    await sendBody(memberC, circle.address, buildRevealBody(pot, saltC), TON_0_2);

    blockchain.now += 10;
    await sendBody(memberB, circle.address, buildFinalizeBody(), TON_0_2);

    // Cycle 3 funding: A should pay using credit first, then future_locked.
    const aBeforeC3 = await circle.getGetMember(memberA.address);
    expect(aBeforeC3.credit).toEqual(75_000n);
    expect(aBeforeC3.future_locked).toEqual(1_000_000n);

    await sendBody(memberC, circle.address, buildTriggerDebitAllBody(), TON_0_2);
    const aAfterC3 = await circle.getGetMember(memberA.address);
    expect(aAfterC3.due_remaining).toEqual(0n);
    expect(aAfterC3.credit).toEqual(0n);
    expect(aAfterC3.future_locked).toEqual(75_000n);
    expect(aAfterC3.prefund).toEqual(0n);
  });

  it("I47: Withdraw in EmergencyStop works (mode=2) and cannot be double-withdrawn", async () => {
    const memberA = await blockchain.treasury("esA");
    const memberB = await blockchain.treasury("esB");

    const jettonWallet = blockchain.openContract(await JettonWalletMock.fromInit(false));
    await deployContract(jettonWallet, deployer, toNano("0.2"));

    const circle = blockchain.openContract(
      await CircleContract.fromInit({
        $$type: "Config",
        jetton_master: jettonMaster.address,
        guardian_pubkey: BigInt(`0x${Buffer.from(guardianKeypair.publicKey).toString("hex")}`),
        treasury_owner: treasuryOwner.address,
        n_members: 2n,
        contribution: 1_000_000n,
        total_cycles: 2n,
        interval_sec: 100n,
        grace_sec: 3600n,
        take_rate_bps: 0n,
        collateral_rate_bps: 0n,
        max_discount_bps: 500n,
        vesting_bps_cycle1: 0n,
        early_lock_rate_bps_cycle1: 0n,
        commit_duration_sec: 10n,
        reveal_duration_sec: 10n,
        max_pot_cap: 10_000_000n,
        min_deposit_units: 1n
      })
    );
    await deployContract(circle, deployer, toNano("0.5"));
    await sendBody(jettonMaster, circle.address, buildTakeWalletBody(jettonWallet.address), TON_0_2);

    const exp = blockchain.now + 600;
    await sendBody(memberA, circle.address, buildJoinBody(circle.address, memberA.address, exp, 1n, guardianKeypair.secretKey), TON_0_2);
    await sendBody(memberB, circle.address, buildJoinBody(circle.address, memberB.address, exp, 2n, guardianKeypair.secretKey), TON_0_2);

    // Give A some prefund balance so withdrawAll has something.
    await sendBody(deployer, jettonWallet.address, buildTestNotificationBody(circle.address, 11, 1_234_567n, memberA.address, PURPOSE_PREFUND), TON_0_2);

    // EmergencyStop by guardian
    const stop = buildStopBody(circle.address, 1, blockchain.now + 10_000, 1n, guardianKeypair.secretKey);
    const stopRes = await sendBody(deployer, circle.address, stop, TON_0_2);
    expectTxSuccess(stopRes, circle.address);
    expect((await circle.getGetStatus()).status).toEqual(5n);

    const before = await circle.getGetMember(memberA.address);
    expect(before.prefund).toEqual(1_234_567n);

    const wd1 = await sendBody(memberA, circle.address, buildWithdrawBody(2), toNano("0.2"));
    expectTxSuccess(wd1, circle.address);
    const after1 = await circle.getGetMember(memberA.address);
    expect(after1.prefund).toEqual(0n);
    expect(after1.withdrawable).toEqual(0n);

    const wd2 = await sendBody(memberA, circle.address, buildWithdrawBody(2), toNano("0.2"));
    expectTxFail(wd2, circle.address);
  });
});
