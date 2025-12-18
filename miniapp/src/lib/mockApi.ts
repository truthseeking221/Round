import { Circle, CirclesListResponse, CircleStatusResponse, CreateCircleRequest, JoinCircleRequest, DepositIntentResponse, DepositIntentRequest } from "./api";

// Helper to simulate network delay
const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

const STORAGE_KEY = "mc_dev_db";

function getDb() {
  const s = localStorage.getItem(STORAGE_KEY);
  return s ? JSON.parse(s) : { circles: [], members: {} };
}

function saveDb(db: any) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
}

// Initial dummy data
if (!localStorage.getItem(STORAGE_KEY)) {
  saveDb({
    circles: [
      {
        circle_id: "1001",
        name: "Demo Circle - Active",
        status: "Active",
        contribution_units: "100000000", // 100 USDT (6 decimals?) Assuming 6 for USDT usually, but check codebase.
        n_members: 5,
        collateral_rate_bps: 15000,
        round_id: 1,
        contract_address: "EQ_MOCK_CONTRACT_ADDRESS_DEMO_1",
        onchain_phase: 0,
      }
    ],
    members: {}
  });
}

export const mockApi = {
  listCircles: async (): Promise<CirclesListResponse> => {
    await delay(500);
    const db = getDb();
    return { circles: db.circles };
  },

  getCircleStatus: async (circleId: string): Promise<CircleStatusResponse> => {
    await delay(500);
    const db = getDb();
    const circle = db.circles.find((c: any) => c.circle_id === circleId);
    if (!circle) throw new Error("Circle not found");

    // Mock member status
    const memberKey = `${circleId}_me`;
    const member = db.members[memberKey] || null;

    return {
      circle,
      member: member || undefined,
      events: []
    };
  },

  createCircle: async (req: CreateCircleRequest): Promise<{ circle_id: string }> => {
    await delay(1000);
    const db = getDb();
    const newId = String(Date.now());
    const newCircle = {
      circle_id: newId,
      name: req.name || `Circle #${newId}`,
      status: "Recruiting",
      contribution_units: req.contribution_units,
      n_members: req.n_members,
      collateral_rate_bps: req.collateral_rate_bps,
      created_at: new Date().toISOString(),
    };
    db.circles.unshift(newCircle);
    saveDb(db);
    return { circle_id: newId };
  },

  joinCircle: async (req: JoinCircleRequest): Promise<{ status: string }> => {
    await delay(800);
    const db = getDb();
    const circle = db.circles.find((c: any) => c.circle_id === req.circle_id);
    if (!circle) throw new Error("Circle not found");

    const memberKey = `${req.circle_id}_me`;
    db.members[memberKey] = {
      circle_id: req.circle_id,
      wallet_address: req.wallet_address,
      join_status: "joined", // Backend status
      collateral: "0",
      prefund: "0",
      withdrawable: "0"
    };
    saveDb(db);
    return { status: "joined" };
  },

  depositIntent: async (req: DepositIntentRequest): Promise<DepositIntentResponse> => {
    await delay(600);
    // Return a fake intent to trigger the wallet signing flow (it will fail on chain if contract doesn't exist, but UI flow works)
    return {
      jetton_wallet: "EQ_MOCK_JETTON_WALLET",
      tx_value_nano: "50000000", // 0.05 TON
      payload_base64: "te6cckEBAQEAAgAAAEysuc0=" // Empty cell
    };
  },

  // Mock specific actions to update local state for testing UI
  _forceUpdateStatus: (circleId: string, updates: any) => {
    const db = getDb();
    const idx = db.circles.findIndex((c: any) => c.circle_id === circleId);
    if (idx !== -1) {
      db.circles[idx] = { ...db.circles[idx], ...updates };
      saveDb(db);
    }
  },
  
  _reset: () => localStorage.removeItem(STORAGE_KEY)
};
