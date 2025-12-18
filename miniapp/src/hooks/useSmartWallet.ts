import { useTonConnectUI, useTonWallet } from "@tonconnect/ui-react";
import type { SendTransactionRequest, Wallet } from "@tonconnect/ui-react";
import { env } from "../lib/env";
import { useState } from "react";

// Mock Wallet Object matching the shape needed by the app
const MOCK_WALLET_ADDRESS = "0:1234567890123456789012345678901234567890123456789012345678901234"; // EQ... format in raw
const MOCK_WALLET_USER_FRIENDLY = "EQD__________________________________________0vo"; 

const mockWallet: Wallet = {
  account: {
    address: MOCK_WALLET_ADDRESS,
    chain: "-239",
    walletStateInit: "",
    publicKey: "mock_pub_key"
  },
  device: {
    appName: "MockWallet",
    appVersion: "1.0.0",
    platform: "browser",
    features: ["SendTransaction"]
  },
  provider: "mock",
  connectItems: {
    tonProof: { name: "ton_proof", proof: { timestamp: 123, domain: { lengthBytes: 0, value: "" }, signature: "", payload: "" } }
  }
};

export function useSmartWallet() {
  const realWallet = useTonWallet();
  const [tonConnectUI] = useTonConnectUI();
  
  // State to simulate "connecting" the mock wallet (optional, for now strictly auto-connect in dev)
  const isMockMode = env.IS_MOCK;

  // Use Real Wallet if connected, otherwise fallback to Mock if in Mock Mode
  const wallet = realWallet || (isMockMode ? mockWallet : null);
  
  const connected = !!wallet;
  const address = wallet?.account.address 
    ? (isMockMode && !realWallet ? MOCK_WALLET_USER_FRIENDLY : wallet.account.address) // Use user-friendly for display in mock
    : null;

  const sendTransaction = async (tx: SendTransactionRequest) => {
    if (realWallet) {
      return await tonConnectUI.sendTransaction(tx);
    }
    if (isMockMode) {
      console.log("[MOCK WALLET] Sending Transaction:", tx);
      console.log("...Simulating network delay...");
      await new Promise(resolve => setTimeout(resolve, 1500));
      console.log("[MOCK WALLET] Transaction confirmed!");
      return { boc: "mock_boc_data" };
    }
    throw new Error("No wallet connected");
  };

  return {
    wallet,
    connected,
    address,
    sendTransaction,
    isMock: isMockMode && !realWallet
  };
}
