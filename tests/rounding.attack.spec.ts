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
  buildTakeWalletBody,
  buildTestNotificationBody,
  deployContract,
  sendBody,
  u256From
} from "./testUtils";

describe("Attack Pack G — Rounding & dust (no orphan remainder)", () => {
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

  it("G39: Discount remainder goes to treasury_owed (not orphan dust)", async () => {
    const members = await Promise.all([blockchain.treasury("m1"), blockchain.treasury("m2"), blockchain.treasury("m3"), blockchain.treasury("m4")]);
    const [m1, m2, m3, m4] = members;

    const jettonWallet = blockchain.openContract(await JettonWalletMock.fromInit(false));
    await deployContract(jettonWallet, deployer, toNano("0.2"));

    // Choose values so discount % (N-1) != 0 while max_discount_bps=5%:
    // N=4, C=20 => pot=80. minPayout=76 => discount=4. denom=3 => per=1 rem=1.
    const circle = blockchain.openContract(
      await CircleContract.fromInit({
        $$type: "Config",
        jetton_master: jettonMaster.address,
        guardian_pubkey: BigInt(`0x${Buffer.from(guardianKeypair.publicKey).toString("hex")}`),
        treasury_owner: treasuryOwner.address,
        n_members: 4n,
        contribution: 20n,
        total_cycles: 4n,
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
    for (const [nonce, who] of [
      [1n, m1],
      [2n, m2],
      [3n, m3],
      [4n, m4]
    ] as const) {
      await sendBody(who, circle.address, buildJoinBody(circle.address, who.address, exp, nonce, guardianKeypair.secretKey), TON_0_2);
    }

    // Fund all
    for (const [qid, who] of [
      [11, m1],
      [12, m2],
      [13, m3],
      [14, m4]
    ] as const) {
      await sendBody(deployer, jettonWallet.address, buildTestNotificationBody(circle.address, qid, 20n, who.address, PURPOSE_PREFUND), TON_0_2);
    }
    expect((await circle.getGetStatus()).phase).toEqual(1n); // Commit

    const pot = 80n;
    const payout = 76n;
    const salts = [u256From(randomBytes(32)), u256From(randomBytes(32)), u256From(randomBytes(32)), u256From(randomBytes(32))] as const;
    await sendBody(m1, circle.address, buildCommitBody(u256From(buildBidHash(circle.address, 1, m1.address, payout, salts[0]))), TON_0_2);
    await sendBody(m2, circle.address, buildCommitBody(u256From(buildBidHash(circle.address, 1, m2.address, pot, salts[1]))), TON_0_2);
    await sendBody(m3, circle.address, buildCommitBody(u256From(buildBidHash(circle.address, 1, m3.address, pot, salts[2]))), TON_0_2);
    await sendBody(m4, circle.address, buildCommitBody(u256From(buildBidHash(circle.address, 1, m4.address, pot, salts[3]))), TON_0_2);

    blockchain.now += 10;
    await sendBody(m1, circle.address, buildRevealBody(payout, salts[0]), TON_0_2);
    await sendBody(m2, circle.address, buildRevealBody(pot, salts[1]), TON_0_2);
    await sendBody(m3, circle.address, buildRevealBody(pot, salts[2]), TON_0_2);
    await sendBody(m4, circle.address, buildRevealBody(pot, salts[3]), TON_0_2);

    blockchain.now += 10;
    await sendBody(m1, circle.address, buildFinalizeBody(), TON_0_2);

    // rem=1 goes to treasury_owed, per=1 credit to each non-winner.
    expect(await circle.getGetTreasuryOwed()).toEqual(1n);
    expect((await circle.getGetMember(m2.address)).credit).toEqual(1n);
    expect((await circle.getGetMember(m3.address)).credit).toEqual(1n);
    expect((await circle.getGetMember(m4.address)).credit).toEqual(1n);
  });
});

