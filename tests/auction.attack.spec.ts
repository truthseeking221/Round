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
  PURPOSE_COLLATERAL,
  PURPOSE_PREFUND,
  buildBidHash,
  buildCommitBody,
  buildFinalizeBody,
  buildJoinBody,
  buildRevealBody,
  buildTakeWalletBody,
  buildTestNotificationBody,
  buildTriggerDebitAllBody,
  deployContract,
  expectTxFail,
  sendBody,
  u256From
} from "./testUtils";

const ERR_HASH_MISMATCH = 149;
const ERR_BID_OUT_OF_BOUNDS = 150;

describe("Attack Pack C — Auction commit/reveal", () => {
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

  it("C20: Reveal with wrong salt/hash mismatch is rejected", async () => {
    const memberA = await blockchain.treasury("hmA");
    const memberB = await blockchain.treasury("hmB");

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

    await sendBody(deployer, jettonWallet.address, buildTestNotificationBody(circle.address, 11, 1_000_000n, memberA.address, PURPOSE_PREFUND), TON_0_2);
    await sendBody(deployer, jettonWallet.address, buildTestNotificationBody(circle.address, 12, 1_000_000n, memberB.address, PURPOSE_PREFUND), TON_0_2);
    expect((await circle.getGetStatus()).phase).toEqual(1n); // Commit

    const payout = 2_000_000n;
    const salt = u256From(randomBytes(32));
    const commitHash = u256From(buildBidHash(circle.address, 1, memberA.address, payout, salt));
    await sendBody(memberA, circle.address, buildCommitBody(commitHash), TON_0_2);

    // Move to Reveal, but reveal with a different salt.
    blockchain.now += 10;
    const wrongSalt = u256From(randomBytes(32));
    const res = await sendBody(memberA, circle.address, buildRevealBody(payout, wrongSalt), TON_0_2);
    expectTxFail(res, circle.address, ERR_HASH_MISMATCH);
  });

  it("C21: Reveal out-of-bounds payoutWanted is rejected", async () => {
    const memberA = await blockchain.treasury("boundsA");
    const memberB = await blockchain.treasury("boundsB");

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

    await sendBody(deployer, jettonWallet.address, buildTestNotificationBody(circle.address, 11, 1_000_000n, memberA.address, PURPOSE_PREFUND), TON_0_2);
    await sendBody(deployer, jettonWallet.address, buildTestNotificationBody(circle.address, 12, 1_000_000n, memberB.address, PURPOSE_PREFUND), TON_0_2);

    const pot = 2_000_000n;
    const minPayout = 1_900_000n;
    const salt = u256From(randomBytes(32));
    const commitHash = u256From(buildBidHash(circle.address, 1, memberA.address, pot, salt));
    await sendBody(memberA, circle.address, buildCommitBody(commitHash), TON_0_2);

    blockchain.now += 10;
    // payoutWanted below minPayout
    const res1 = await sendBody(memberA, circle.address, buildRevealBody(minPayout - 1n, salt), TON_0_2);
    expectTxFail(res1, circle.address, ERR_BID_OUT_OF_BOUNDS);

    // payoutWanted above pot
    const res2 = await sendBody(memberA, circle.address, buildRevealBody(pot + 1n, salt), TON_0_2);
    expectTxFail(res2, circle.address, ERR_BID_OUT_OF_BOUNDS);
  });

  it("C22: Non-reveal is treated as payoutWanted=pot and penalty applies (once)", async () => {
    const nonRevealer = await blockchain.treasury("nrA");
    const winner = await blockchain.treasury("nrB");

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
    await sendBody(nonRevealer, circle.address, buildJoinBody(circle.address, nonRevealer.address, exp, 1n, guardianKeypair.secretKey), TON_0_2);
    await sendBody(winner, circle.address, buildJoinBody(circle.address, winner.address, exp, 2n, guardianKeypair.secretKey), TON_0_2);

    // Give collateral so non-reveal penalty can slash
    await sendBody(deployer, jettonWallet.address, buildTestNotificationBody(circle.address, 10, 1_000_000n, nonRevealer.address, PURPOSE_COLLATERAL), TON_0_2);

    // Fund both
    await sendBody(deployer, jettonWallet.address, buildTestNotificationBody(circle.address, 11, 1_000_000n, nonRevealer.address, PURPOSE_PREFUND), TON_0_2);
    await sendBody(deployer, jettonWallet.address, buildTestNotificationBody(circle.address, 12, 1_000_000n, winner.address, PURPOSE_PREFUND), TON_0_2);

    const pot = 2_000_000n;
    const minPayout = 1_900_000n;

    // Both commit
    const saltA = u256From(randomBytes(32));
    const saltB = u256From(randomBytes(32));
    await sendBody(nonRevealer, circle.address, buildCommitBody(u256From(buildBidHash(circle.address, 1, nonRevealer.address, pot, saltA))), TON_0_2);
    await sendBody(winner, circle.address, buildCommitBody(u256From(buildBidHash(circle.address, 1, winner.address, minPayout, saltB))), TON_0_2);

    // Only winner reveals
    blockchain.now += 10;
    await sendBody(winner, circle.address, buildRevealBody(minPayout, saltB), TON_0_2);

    blockchain.now += 10;
    await sendBody(winner, circle.address, buildFinalizeBody(), TON_0_2);

    // Non-revealer collateral slashed by min(0.1 USDT, 1% collateral) = 10_000 units.
    const aAfter = await circle.getGetMember(nonRevealer.address);
    expect(aAfter.collateral).toEqual(990_000n);
  });

  it("C24: Tie-break is deterministic by commit_order for equal payoutWanted", async () => {
    const memberA = await blockchain.treasury("tieA");
    const memberB = await blockchain.treasury("tieB");

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

    // Fund both
    await sendBody(deployer, jettonWallet.address, buildTestNotificationBody(circle.address, 11, 1_000_000n, memberA.address, PURPOSE_PREFUND), TON_0_2);
    await sendBody(deployer, jettonWallet.address, buildTestNotificationBody(circle.address, 12, 1_000_000n, memberB.address, PURPOSE_PREFUND), TON_0_2);

    const payout = 1_950_000n;
    const saltA = u256From(randomBytes(32));
    const saltB = u256From(randomBytes(32));
    await sendBody(memberA, circle.address, buildCommitBody(u256From(buildBidHash(circle.address, 1, memberA.address, payout, saltA))), TON_0_2);
    await sendBody(memberB, circle.address, buildCommitBody(u256From(buildBidHash(circle.address, 1, memberB.address, payout, saltB))), TON_0_2);

    blockchain.now += 10;
    await sendBody(memberA, circle.address, buildRevealBody(payout, saltA), TON_0_2);
    await sendBody(memberB, circle.address, buildRevealBody(payout, saltB), TON_0_2);

    blockchain.now += 10;
    await sendBody(memberA, circle.address, buildFinalizeBody(), TON_0_2);

    // memberA committed first, so should win.
    const a = await circle.getGetMember(memberA.address);
    const b = await circle.getGetMember(memberB.address);
    expect(a.has_won).toEqual(true);
    expect(b.has_won).toEqual(false);
  });

  it("C25: has_won enforcement blocks winner from committing in later cycles", async () => {
    const winner = await blockchain.treasury("wonA");
    const other = await blockchain.treasury("wonB");

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
    await sendBody(winner, circle.address, buildJoinBody(circle.address, winner.address, exp, 1n, guardianKeypair.secretKey), TON_0_2);
    await sendBody(other, circle.address, buildJoinBody(circle.address, other.address, exp, 2n, guardianKeypair.secretKey), TON_0_2);

    // Cycle 1 fund
    await sendBody(deployer, jettonWallet.address, buildTestNotificationBody(circle.address, 11, 1_000_000n, winner.address, PURPOSE_PREFUND), TON_0_2);
    await sendBody(deployer, jettonWallet.address, buildTestNotificationBody(circle.address, 12, 1_000_000n, other.address, PURPOSE_PREFUND), TON_0_2);

    // Winner bids lower to win
    const payout = 1_900_000n;
    const pot = 2_000_000n;
    const saltW = u256From(randomBytes(32));
    const saltO = u256From(randomBytes(32));
    await sendBody(winner, circle.address, buildCommitBody(u256From(buildBidHash(circle.address, 1, winner.address, payout, saltW))), TON_0_2);
    await sendBody(other, circle.address, buildCommitBody(u256From(buildBidHash(circle.address, 1, other.address, pot, saltO))), TON_0_2);

    blockchain.now += 10;
    await sendBody(winner, circle.address, buildRevealBody(payout, saltW), TON_0_2);
    await sendBody(other, circle.address, buildRevealBody(pot, saltO), TON_0_2);

    blockchain.now += 10;
    await sendBody(winner, circle.address, buildFinalizeBody(), TON_0_2);
    expect((await circle.getGetMember(winner.address)).has_won).toEqual(true);

    // Cycle 2 funding -> open commit
    await sendBody(deployer, jettonWallet.address, buildTestNotificationBody(circle.address, 21, 1_000_000n, winner.address, PURPOSE_PREFUND), TON_0_2);
    await sendBody(deployer, jettonWallet.address, buildTestNotificationBody(circle.address, 22, 1_000_000n, other.address, PURPOSE_PREFUND), TON_0_2);
    await sendBody(other, circle.address, buildTriggerDebitAllBody(), TON_0_2);
    expect((await circle.getGetStatus()).phase).toEqual(1n); // Commit

    // Winner cannot commit now.
    const commitTry = await sendBody(
      winner,
      circle.address,
      buildCommitBody(u256From(buildBidHash(circle.address, 2, winner.address, pot, u256From(randomBytes(32))))),
      TON_0_2
    );
    expectTxFail(commitTry, circle.address);
  });
});
