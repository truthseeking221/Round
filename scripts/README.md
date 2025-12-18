# Scripts

Deployment and verification scripts for CircleContract.

## Prerequisites

Set environment variables:

```bash
export DEPLOY_WALLET_MNEMONIC="word1 word2 ... word24"
export GUARDIAN_PUBLIC_KEY="hex_pubkey_64_chars"   # or set GUARDIAN_PRIVATE_KEY (32-byte hex seed) to derive pubkey
export TREASURY_OWNER="EQ..."
export USDT_JETTON_MASTER="EQ..."
export TONCENTER_KEY="..." # optional
```

## Deploy

```bash
# Testnet
npx tsx scripts/deploy.ts --network testnet --n 10 --contribution-usdt 10 --interval weekly

# Mainnet (⚠️ use with caution)
npx tsx scripts/deploy.ts --network mainnet --n 10 --contribution-usdt 10 --interval weekly
```

## Init Jetton Wallet (TEP-89)

After deploy, run INIT once to set `jetton_wallet` on-chain:

```bash
npx tsx scripts/init.ts --network testnet EQ...contract_address
```

## Verify

```bash
npx tsx scripts/verify.ts --network testnet EQ...contract_address
```

## Manual Deployment

For step-by-step manual deployment, see `docs/BUILD_GUIDE.md`.

