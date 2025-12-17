import { describe, it, expect, beforeEach } from "vitest";
import { Blockchain, type SandboxContract, TreasuryContract } from "@ton/sandbox";
import { toNano } from "@ton/core";
import { keyPairFromSeed } from "@ton/crypto";
import { randomBytes } from "crypto";

// eslint-disable-next-line import/no-unresolved
import { CircleContract } from "../build/CircleContract_CircleContract";

import { TON_0_2, buildJoinBody, buildWithdrawBody, deployContract, sendBody } from "./testUtils";

describe("Attack Pack H — Recruiting join/exit churn", () => {
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

  it("H44: join-exit churn preserves members_count and member_list integrity", async () => {
    const a = await blockchain.treasury("a");
    const b = await blockchain.treasury("b");
    const c = await blockchain.treasury("c");

    const circle = blockchain.openContract(
      await CircleContract.fromInit({
        $$type: "Config",
        jetton_master: jettonMaster.address,
        guardian_pubkey: BigInt(`0x${Buffer.from(guardianKeypair.publicKey).toString("hex")}`),
        treasury_owner: treasuryOwner.address,
        n_members: 4n, // keep Recruiting during churn
        contribution: 1_000_000n,
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

    const exp = blockchain.now + 600;

    // Join A,B,C (members_count=3)
    await sendBody(a, circle.address, buildJoinBody(circle.address, a.address, exp, 1n, guardianKeypair.secretKey), TON_0_2);
    await sendBody(b, circle.address, buildJoinBody(circle.address, b.address, exp, 2n, guardianKeypair.secretKey), TON_0_2);
    await sendBody(c, circle.address, buildJoinBody(circle.address, c.address, exp, 3n, guardianKeypair.secretKey), TON_0_2);
    expect(await circle.getGetMembersCount()).toEqual(3n);

    // Exit B (swap-with-last should bring C into index 1)
    await sendBody(b, circle.address, buildWithdrawBody(3), toNano("0.05"));
    expect(await circle.getGetMembersCount()).toEqual(2n);
    expect((await circle.getGetMember(b.address)).active).toEqual(false);

    const at0 = await circle.getGetMemberAt(0n);
    const at1 = await circle.getGetMemberAt(1n);
    expect(at0.toString()).toEqual(a.address.toString());
    expect(at1.toString()).toEqual(c.address.toString());

    // Re-join B (new nonce) -> appended at index 2
    await sendBody(b, circle.address, buildJoinBody(circle.address, b.address, exp, 4n, guardianKeypair.secretKey), TON_0_2);
    expect(await circle.getGetMembersCount()).toEqual(3n);
    expect((await circle.getGetMember(b.address)).active).toEqual(true);
    expect((await circle.getGetMemberAt(2n)).toString()).toEqual(b.address.toString());

    // Exit A (swap-with-last should bring B into index 0)
    await sendBody(a, circle.address, buildWithdrawBody(3), toNano("0.05"));
    expect(await circle.getGetMembersCount()).toEqual(2n);
    expect((await circle.getGetMember(a.address)).active).toEqual(false);

    const at0b = await circle.getGetMemberAt(0n);
    const at1c = await circle.getGetMemberAt(1n);
    expect(at0b.toString()).toEqual(b.address.toString());
    expect(at1c.toString()).toEqual(c.address.toString());

    // Re-join A -> appended at index 2 again, list should be [B,C,A]
    await sendBody(a, circle.address, buildJoinBody(circle.address, a.address, exp, 5n, guardianKeypair.secretKey), TON_0_2);
    expect(await circle.getGetMembersCount()).toEqual(3n);
    expect((await circle.getGetMemberAt(2n)).toString()).toEqual(a.address.toString());
  });
});

