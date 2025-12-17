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
  buildTerminateDefaultBody,
  buildTestNotificationBody,
  buildTriggerDebitAllBody,
  buildWithdrawBody,
  deployContract,
  expectTxFail,
  expectTxSuccess,
  sendBody
} from "./testUtils";

const ERR_NOT_DEFAULT_ELIGIBLE = 170;

describe("Attack Pack B — Terminate & Default", () => {
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

  it("B8: TERMINATE_DEFAULT before grace_end is rejected", async () => {
    const memberA = await blockchain.treasury("termEarlyA");
    const memberB = await blockchain.treasury("termEarlyB");

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
        grace_sec: 100n,
        take_rate_bps: 0n,
        collateral_rate_bps: 1000n,
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

    const res = await sendBody(memberA, circle.address, buildTerminateDefaultBody(), TON_0_2);
    expectTxFail(res, circle.address, ERR_NOT_DEFAULT_ELIGIBLE);
  });

  it("B9/B10: At now==grace_end, phase sync allows TERMINATE_DEFAULT (status=Terminated)", async () => {
    const memberA = await blockchain.treasury("termAtGraceA");
    const memberB = await blockchain.treasury("termAtGraceB");

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
        grace_sec: 1n,
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

    const st = await circle.getGetStatus();
    blockchain.now = Number(st.grace_end_at);

    const res = await sendBody(memberA, circle.address, buildTerminateDefaultBody(), TON_0_2);
    expectTxSuccess(res, circle.address);
    expect((await circle.getGetStatus()).status).toEqual(4n); // Terminated
  });

  it("B11: Terminate refunds paid_this_cycle back to prefund and pot_pool resets", async () => {
    const payer = await blockchain.treasury("payer");
    const defaulter = await blockchain.treasury("defaulter");

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
        grace_sec: 5n,
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
    await sendBody(payer, circle.address, buildJoinBody(circle.address, payer.address, exp, 1n, guardianKeypair.secretKey), TON_0_2);
    await sendBody(defaulter, circle.address, buildJoinBody(circle.address, defaulter.address, exp, 2n, guardianKeypair.secretKey), TON_0_2);

    // Fund only payer and debit once to create paid_this_cycle.
    await sendBody(deployer, jettonWallet.address, buildTestNotificationBody(circle.address, 11, 1_000_000n, payer.address, PURPOSE_PREFUND), TON_0_2);
    await sendBody(payer, circle.address, buildTriggerDebitAllBody(), TON_0_2);
    expect((await circle.getGetMember(payer.address)).prefund).toEqual(0n);

    // Terminate at grace_end -> paid_this_cycle refunded back to prefund
    const st = await circle.getGetStatus();
    blockchain.now = Number(st.grace_end_at);
    await sendBody(payer, circle.address, buildTerminateDefaultBody(), TON_0_2);

    const after = await circle.getGetMember(payer.address);
    expect(after.prefund).toEqual(1_000_000n);
    expect(after.due_remaining).toEqual(0n);
  });

  it("B12/B15: Seize cap + deterministic distribution; remainder goes to treasury_owed", async () => {
    const recipient1 = await blockchain.treasury("rcpt1");
    const recipient2 = await blockchain.treasury("rcpt2");
    const defaulter = await blockchain.treasury("defcap");

    const jettonWallet = blockchain.openContract(await JettonWalletMock.fromInit(false));
    await deployContract(jettonWallet, deployer, toNano("0.2"));

    // Use tiny numbers to make expected remainder obvious.
    // N=3, C=1 => pot=3. collateral_required = 100% pot = 3.
    const circle = blockchain.openContract(
      await CircleContract.fromInit({
        $$type: "Config",
        jetton_master: jettonMaster.address,
        guardian_pubkey: BigInt(`0x${Buffer.from(guardianKeypair.publicKey).toString("hex")}`),
        treasury_owner: treasuryOwner.address,
        n_members: 3n,
        contribution: 1n,
        total_cycles: 3n,
        interval_sec: 0n,
        grace_sec: 1n,
        take_rate_bps: 0n,
        collateral_rate_bps: 10000n,
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
    await sendBody(recipient1, circle.address, buildJoinBody(circle.address, recipient1.address, exp, 1n, guardianKeypair.secretKey), TON_0_2);
    await sendBody(recipient2, circle.address, buildJoinBody(circle.address, recipient2.address, exp, 2n, guardianKeypair.secretKey), TON_0_2);
    await sendBody(defaulter, circle.address, buildJoinBody(circle.address, defaulter.address, exp, 3n, guardianKeypair.secretKey), TON_0_2);

    // Deposit collateral for all so recipients can pass the collateral gate.
    for (const [qid, who] of [
      [11, recipient1],
      [12, recipient2],
      [13, defaulter]
    ] as const) {
      await sendBody(deployer, jettonWallet.address, buildTestNotificationBody(circle.address, qid, 3n, who.address, PURPOSE_COLLATERAL), TON_0_2);
    }

    // Fund only the two recipients (defaulter remains underfunded).
    await sendBody(deployer, jettonWallet.address, buildTestNotificationBody(circle.address, 21, 1n, recipient1.address, PURPOSE_PREFUND), TON_0_2);
    await sendBody(deployer, jettonWallet.address, buildTestNotificationBody(circle.address, 22, 1n, recipient2.address, PURPOSE_PREFUND), TON_0_2);
    await sendBody(recipient1, circle.address, buildTriggerDebitAllBody(), TON_0_2);

    const st = await circle.getGetStatus();
    blockchain.now = Number(st.grace_end_at);

    await sendBody(recipient1, circle.address, buildTerminateDefaultBody(), TON_0_2);

    // Recipients had paid_this_cycle=1 refunded, then received +1 from penalty distribution => prefund=2.
    expect((await circle.getGetMember(recipient1.address)).prefund).toEqual(2n);
    expect((await circle.getGetMember(recipient2.address)).prefund).toEqual(2n);
    expect((await circle.getGetMember(defaulter.address)).collateral).toEqual(0n);
    expect(await circle.getGetTreasuryOwed()).toEqual(1n);
  });

  it("B16: rc==0 does not revert; penalty_pool goes to treasury_owed", async () => {
    const def1 = await blockchain.treasury("rc0a");
    const def2 = await blockchain.treasury("rc0b");

    const jettonWallet = blockchain.openContract(await JettonWalletMock.fromInit(false));
    await deployContract(jettonWallet, deployer, toNano("0.2"));

    // N=2, C=1 => pot=2. collateral_required = 100% pot = 2.
    const circle = blockchain.openContract(
      await CircleContract.fromInit({
        $$type: "Config",
        jetton_master: jettonMaster.address,
        guardian_pubkey: BigInt(`0x${Buffer.from(guardianKeypair.publicKey).toString("hex")}`),
        treasury_owner: treasuryOwner.address,
        n_members: 2n,
        contribution: 1n,
        total_cycles: 2n,
        interval_sec: 0n,
        grace_sec: 1n,
        take_rate_bps: 0n,
        collateral_rate_bps: 10000n,
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
    await sendBody(def1, circle.address, buildJoinBody(circle.address, def1.address, exp, 1n, guardianKeypair.secretKey), TON_0_2);
    await sendBody(def2, circle.address, buildJoinBody(circle.address, def2.address, exp, 2n, guardianKeypair.secretKey), TON_0_2);

    // Both defaulters deposit collateral=2 each -> penalty_pool = 4, rc==0.
    await sendBody(deployer, jettonWallet.address, buildTestNotificationBody(circle.address, 11, 2n, def1.address, PURPOSE_COLLATERAL), TON_0_2);
    await sendBody(deployer, jettonWallet.address, buildTestNotificationBody(circle.address, 12, 2n, def2.address, PURPOSE_COLLATERAL), TON_0_2);

    const st = await circle.getGetStatus();
    blockchain.now = Number(st.grace_end_at);
    await sendBody(def1, circle.address, buildTerminateDefaultBody(), TON_0_2);

    expect(await circle.getGetTreasuryOwed()).toEqual(4n);
    expect((await circle.getGetStatus()).status).toEqual(4n);
  });

  it("B17: WITHDRAW_ALL after terminate is allowed and cannot be double-withdrawn", async () => {
    const payer = await blockchain.treasury("wdPayer");
    const defaulter = await blockchain.treasury("wdDefaulter");

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
        grace_sec: 1n,
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
    await sendBody(payer, circle.address, buildJoinBody(circle.address, payer.address, exp, 1n, guardianKeypair.secretKey), TON_0_2);
    await sendBody(defaulter, circle.address, buildJoinBody(circle.address, defaulter.address, exp, 2n, guardianKeypair.secretKey), TON_0_2);

    // Give payer some prefund that will remain withdrawable after terminate.
    await sendBody(deployer, jettonWallet.address, buildTestNotificationBody(circle.address, 11, 1_000_000n, payer.address, PURPOSE_PREFUND), TON_0_2);
    const st = await circle.getGetStatus();
    blockchain.now = Number(st.grace_end_at);
    await sendBody(payer, circle.address, buildTerminateDefaultBody(), TON_0_2);

    // Withdraw all (mode=2)
    const wd1 = await sendBody(payer, circle.address, buildWithdrawBody(2), toNano("0.2"));
    expectTxSuccess(wd1, circle.address);
    const after1 = await circle.getGetMember(payer.address);
    expect(after1.prefund).toEqual(0n);
    expect(after1.withdrawable).toEqual(0n);
    expect(after1.credit).toEqual(0n);
    expect(after1.collateral).toEqual(0n);

    // Second withdraw should fail (empty)
    const wd2 = await sendBody(payer, circle.address, buildWithdrawBody(2), toNano("0.2"));
    expectTxFail(wd2, circle.address);
  });
});
