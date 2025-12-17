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
  buildJoinBody,
  buildTakeWalletBody,
  buildTestNotificationBody,
  buildTestNotificationMalformedBody,
  deployContract,
  sendBody
} from "./testUtils";

describe("Attack Pack D — Deposit spoofing & payload robustness", () => {
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

  it("D28: Deposit from non-member is ignored (no state change)", async () => {
    const memberA = await blockchain.treasury("memberA");
    const outsider = await blockchain.treasury("outsider");

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

    const before = await circle.getGetMember(memberA.address);
    expect(before.prefund).toEqual(0n);

    // Notification from outsider (not a member) should be ignored.
    await sendBody(deployer, jettonWallet.address, buildTestNotificationBody(circle.address, 11, 1_000_000n, outsider.address, PURPOSE_PREFUND), TON_0_2);

    const after = await circle.getGetMember(memberA.address);
    expect(after.prefund).toEqual(0n);
    expect(after.collateral).toEqual(0n);
  });

  it("D29: Malformed payload defaults to PREFUND and never crashes", async () => {
    const memberA = await blockchain.treasury("memberA");

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
        interval_sec: 100n, // keep outside debit window
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

    await sendBody(deployer, jettonWallet.address, buildTestNotificationMalformedBody(circle.address, 11, 123n, memberA.address, 1), TON_0_2); // missing payload bits
    await sendBody(deployer, jettonWallet.address, buildTestNotificationMalformedBody(circle.address, 12, 7n, memberA.address, 2), TON_0_2); // wrong magic
    await sendBody(deployer, jettonWallet.address, buildTestNotificationMalformedBody(circle.address, 13, 9n, memberA.address, 3), TON_0_2); // wrong purpose

    const after = await circle.getGetMember(memberA.address);
    expect(after.prefund).toEqual(139n);
    expect(after.collateral).toEqual(0n);
  });

  it("D30: amount=0 notifications are ignored", async () => {
    const memberA = await blockchain.treasury("memberA");

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

    const before = await circle.getGetMember(memberA.address);
    expect(before.prefund).toEqual(0n);

    await sendBody(deployer, jettonWallet.address, buildTestNotificationBody(circle.address, 11, 0n, memberA.address, PURPOSE_PREFUND), TON_0_2);

    const after = await circle.getGetMember(memberA.address);
    expect(after.prefund).toEqual(0n);
    expect(after.collateral).toEqual(0n);
  });
});

