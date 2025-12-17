import { describe, it, expect, beforeEach } from "vitest";
import { Blockchain, type SandboxContract, TreasuryContract } from "@ton/sandbox";
import { toNano } from "@ton/core";
import { keyPairFromSeed } from "@ton/crypto";
import { randomBytes } from "crypto";

// eslint-disable-next-line import/no-unresolved
import { CircleContract } from "../build/CircleContract_CircleContract";

import { TON_0_2, buildJoinBody, buildWithdrawBody, deployContract, expectTxFail, sendBody } from "./testUtils";

const ERR_TICKET_EXPIRED = 104;
const ERR_TICKET_SIG_INVALID = 105;
const ERR_TICKET_NONCE_USED = 106;

describe("Attack Pack E — Tickets & replay", () => {
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

  it("E31: Ticket expire is rejected", async () => {
    const memberA = await blockchain.treasury("expA");

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

    const exp = blockchain.now - 1;
    const res = await sendBody(memberA, circle.address, buildJoinBody(circle.address, memberA.address, exp, 1n, guardianKeypair.secretKey), TON_0_2);
    expectTxFail(res, circle.address, ERR_TICKET_EXPIRED);
  });

  it("E32: Ticket nonce replay is rejected (even after Recruiting exit)", async () => {
    const memberA = await blockchain.treasury("replayA");

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

    const exp = blockchain.now + 600;
    const join = buildJoinBody(circle.address, memberA.address, exp, 1n, guardianKeypair.secretKey);
    await sendBody(memberA, circle.address, join, TON_0_2);

    // Exit Recruiting (mode=3), no deposits.
    await sendBody(memberA, circle.address, buildWithdrawBody(3), toNano("0.05"));
    expect(await circle.getGetMembersCount()).toEqual(0n);

    // Replay same nonce/signature should be rejected.
    const replay = await sendBody(memberA, circle.address, join, TON_0_2);
    expectTxFail(replay, circle.address, ERR_TICKET_NONCE_USED);
  });

  it("E33: Ticket domain mismatch (signature for another contract) is rejected", async () => {
    const memberA = await blockchain.treasury("domainA");

    const cfg1 = {
      $$type: "Config" as const,
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
    };

    const cfg2 = { ...cfg1, interval_sec: 1n };

    const circle1 = blockchain.openContract(await CircleContract.fromInit(cfg1));
    const circle2 = blockchain.openContract(await CircleContract.fromInit(cfg2));
    await deployContract(circle1, deployer, toNano("0.5"));
    await deployContract(circle2, deployer, toNano("0.5"));

    const exp = blockchain.now + 600;
    const nonce = 1n;
    const bodySignedForCircle1 = buildJoinBody(circle1.address, memberA.address, exp, nonce, guardianKeypair.secretKey);
    const res = await sendBody(memberA, circle2.address, bodySignedForCircle1, TON_0_2);
    expectTxFail(res, circle2.address, ERR_TICKET_SIG_INVALID);
  });
});
