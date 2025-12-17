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
  PURPOSE_COLLATERAL,
  buildJoinBody,
  buildTakeWalletBody,
  buildTestNotificationBody,
  buildTriggerDebitAllBody,
  deployContract,
  expectTxFail,
  sendBody
} from "./testUtils";

const ERR_DEBIT_OUTSIDE_WINDOW = 141;

describe("Attack Pack A — Funding & Debit", () => {
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

  it("A1: Double debit spam is idempotent (TRIGGER_DEBIT_ALL x100 does not overcharge)", async () => {
    const memberA = await blockchain.treasury("spamA");
    const memberB = await blockchain.treasury("spamB");

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
        grace_sec: 10_000n,
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

    // Prefund only memberA, leave memberB underfunded so phase stays Funding.
    await sendBody(
      deployer,
      jettonWallet.address,
      buildTestNotificationBody(circle.address, 11, 2_000_000n, memberA.address, PURPOSE_PREFUND),
      TON_0_2
    );

    // Spam triggerDebitAll 100 times.
    for (let i = 0; i < 100; i += 1) {
      await sendBody(memberA, circle.address, buildTriggerDebitAllBody(), TON_0_2);
    }

    const a = await circle.getGetMember(memberA.address);
    const b = await circle.getGetMember(memberB.address);
    expect(a.due_remaining).toEqual(0n);
    expect(b.due_remaining).toEqual(1_000_000n);
    expect(a.prefund).toEqual(1_000_000n);
    expect(b.prefund).toEqual(0n);
  });

  it("A2: Many tiny deposits accumulate correctly and debit still matches contribution", async () => {
    const memberA = await blockchain.treasury("tinyA");
    const memberB = await blockchain.treasury("tinyB");

    const jettonWallet = blockchain.openContract(await JettonWalletMock.fromInit(false));
    await deployContract(jettonWallet, deployer, toNano("0.2"));

    const contribution = 200_000n; // 0.2 USDT
    const tiny = 1_000n; // 0.001 USDT

    const circle = blockchain.openContract(
      await CircleContract.fromInit({
        $$type: "Config",
        jetton_master: jettonMaster.address,
        guardian_pubkey: BigInt(`0x${Buffer.from(guardianKeypair.publicKey).toString("hex")}`),
        treasury_owner: treasuryOwner.address,
        n_members: 2n,
        contribution,
        total_cycles: 2n,
        interval_sec: 100n, // deposit BEFORE due_at -> no auto-debit
        grace_sec: 10_000n,
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

    // 0.001 USDT x 200 = 0.2 USDT
    for (let i = 0; i < 200; i += 1) {
      await sendBody(deployer, jettonWallet.address, buildTestNotificationBody(circle.address, 1000 + i, tiny, memberA.address, PURPOSE_PREFUND), TON_0_2);
    }
    await sendBody(deployer, jettonWallet.address, buildTestNotificationBody(circle.address, 11, contribution, memberB.address, PURPOSE_PREFUND), TON_0_2);

    // Before due: no debit occurred.
    const aBefore = await circle.getGetMember(memberA.address);
    expect(aBefore.prefund).toEqual(contribution);
    expect(aBefore.due_remaining).toEqual(contribution);

    const st = await circle.getGetStatus();
    blockchain.now = Number(st.due_at);
    await sendBody(memberA, circle.address, buildTriggerDebitAllBody(), TON_0_2);

    const aAfter = await circle.getGetMember(memberA.address);
    const bAfter = await circle.getGetMember(memberB.address);
    expect(aAfter.due_remaining).toEqual(0n);
    expect(bAfter.due_remaining).toEqual(0n);
    expect(aAfter.prefund).toEqual(0n);
    expect(bAfter.prefund).toEqual(0n);
  });

  it("A3: Topup in grace triggers auto-debit-on-deposit and does not double-charge", async () => {
    const memberA = await blockchain.treasury("graceA");
    const memberB = await blockchain.treasury("graceB");

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
        grace_sec: 500n,
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

    // Prefund before due_at: A full, B partial
    await sendBody(deployer, jettonWallet.address, buildTestNotificationBody(circle.address, 11, 1_000_000n, memberA.address, PURPOSE_PREFUND), TON_0_2);
    await sendBody(deployer, jettonWallet.address, buildTestNotificationBody(circle.address, 12, 500_000n, memberB.address, PURPOSE_PREFUND), TON_0_2);

    const st = await circle.getGetStatus();
    blockchain.now = Number(st.due_at);

    // Debit at due -> B remains underfunded
    await sendBody(memberA, circle.address, buildTriggerDebitAllBody(), TON_0_2);
    expect((await circle.getGetMember(memberB.address)).due_remaining).toEqual(500_000n);

    // Topup during grace -> should auto-debit immediately and complete funding
    blockchain.now = Number(st.due_at) + 1;
    await sendBody(deployer, jettonWallet.address, buildTestNotificationBody(circle.address, 13, 500_000n, memberB.address, PURPOSE_PREFUND), TON_0_2);

    const bAfter = await circle.getGetMember(memberB.address);
    expect(bAfter.due_remaining).toEqual(0n);
    expect(bAfter.prefund).toEqual(0n);
  });

  it("A4: TRIGGER_DEBIT_ALL before due_at is rejected; at/after grace_end is not allowed", async () => {
    const memberA = await blockchain.treasury("windowA");
    const memberB = await blockchain.treasury("windowB");

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
        grace_sec: 10n,
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

    // now < due_at
    const st = await circle.getGetStatus();
    expect(Number(st.due_at)).toBeGreaterThan(blockchain.now);
    const before = await sendBody(memberA, circle.address, buildTriggerDebitAllBody(), TON_0_2);
    expectTxFail(before, circle.address, ERR_DEBIT_OUTSIDE_WINDOW);

    // at/after grace_end is never allowed (phase sync may move to DefaultEligible)
    blockchain.now = Number(st.grace_end_at);
    const after = await sendBody(memberA, circle.address, buildTriggerDebitAllBody(), TON_0_2);
    expectTxFail(after, circle.address);
  });

  it("A5: Late penalty applies at most once even if debit is spammed", async () => {
    const memberA = await blockchain.treasury("lateA");
    const memberB = await blockchain.treasury("lateB");

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
        grace_sec: 10_000n,
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

    // Give collateral so late penalty can slash.
    await sendBody(deployer, jettonWallet.address, buildTestNotificationBody(circle.address, 11, 100_000n, memberA.address, PURPOSE_COLLATERAL), TON_0_2);

    const st = await circle.getGetStatus();
    blockchain.now = Number(st.due_at) + 1; // late but inside grace

    await sendBody(deployer, jettonWallet.address, buildTestNotificationBody(circle.address, 12, 1_000_000n, memberA.address, PURPOSE_PREFUND), TON_0_2);
    const afterFirst = await circle.getGetMember(memberA.address);
    expect(afterFirst.due_remaining).toEqual(0n);
    expect(afterFirst.collateral).toEqual(90_000n); // 1% of C = 10_000 units penalty

    for (let i = 0; i < 10; i += 1) {
      await sendBody(memberA, circle.address, buildTriggerDebitAllBody(), TON_0_2);
    }

    const afterSpam = await circle.getGetMember(memberA.address);
    expect(afterSpam.collateral).toEqual(90_000n);
  });
});
