import "@stdlib/deploy";

// Test-only mock for a Jetton Wallet:
// - Can emit transfer_notification to a target contract (simulating deposits)
// - On receiving a jetton `transfer`, either:
//   - bounce (to test outbox restore), or
//   - send `excesses` callback to response_destination (to clear pending_out)

const OP_JETTON_TRANSFER: Int = 0x0f8a7ea5;
const OP_JETTON_TRANSFER_NOTIFICATION: Int = 0x7362d09c;
const OP_JETTON_EXCESSES: Int = 0xd53276db;

const OP_TEST_SEND_NOTIFICATION: Int = 0xAA01;
const OP_TEST_SET_BOUNCE: Int = 0xAA02;
const OP_TEST_SEND_NOTIFICATION_MALFORMED: Int = 0xAA03;

const DEPOSIT_MAGIC: Int = 0xC0FFEE01;
const PURPOSE_COLLATERAL: Int = 1;
const PURPOSE_PREFUND: Int = 2;

contract JettonWalletMock with Deployable {
  should_bounce: Bool;

  init(shouldBounce: Bool) {
    self.should_bounce = shouldBounce;
  }

  receive(msg: Slice) {
    let op = msg.loadUint(32);

    if (op == OP_TEST_SET_BOUNCE) {
      let b = msg.loadUint(1);
      self.should_bounce = (b == 1);
      return;
    }

    if (op == OP_TEST_SEND_NOTIFICATION) {
      // Body: target:Address query_id:uint64 amount:coins from_owner:Address purpose:uint8
      let target = msg.loadAddress();
      let qid = msg.loadUint(64);
      let amount = msg.loadCoins();
      let fromOwner = msg.loadAddress();
      let purpose = msg.loadUint(8);

      let body = beginCell()
        .storeUint(OP_JETTON_TRANSFER_NOTIFICATION, 32)
        .storeUint(qid, 64)
        .storeCoins(amount)
        .storeAddress(fromOwner)
        // forward_payload: Either Cell ^Cell — inline
        .storeBit(false)
        .storeUint(DEPOSIT_MAGIC, 32)
        .storeUint(purpose, 8)
        .endCell();

      send(SendParameters{
        to: target,
        // Give the target enough gas to process maps/logic in tests.
        value: 50_000_000, // 0.05 TON
        bounce: true,
        body: body
      });
      return;
    }

    if (op == OP_TEST_SEND_NOTIFICATION_MALFORMED) {
      // Body: target:Address query_id:uint64 amount:coins from_owner:Address malformed_kind:uint8
      // malformed_kind:
      // 1 = missing payload bits (only the Either discriminant)
      // 2 = wrong magic (40 bits present, but magic mismatch)
      // 3 = wrong purpose (magic ok, purpose invalid)
      let target = msg.loadAddress();
      let qid = msg.loadUint(64);
      let amount = msg.loadCoins();
      let fromOwner = msg.loadAddress();
      let kind = msg.loadUint(8);

      let b = beginCell()
        .storeUint(OP_JETTON_TRANSFER_NOTIFICATION, 32)
        .storeUint(qid, 64)
        .storeCoins(amount)
        .storeAddress(fromOwner)
        // forward_payload: Either Cell ^Cell — inline
        .storeBit(false);

      if (kind == 2) {
        b = b.storeUint(0xDEADBEEF, 32).storeUint(PURPOSE_PREFUND, 8);
      } else if (kind == 3) {
        b = b.storeUint(DEPOSIT_MAGIC, 32).storeUint(99, 8);
      }

      send(SendParameters{
        to: target,
        value: 50_000_000, // 0.05 TON
        bounce: true,
        body: b.endCell()
      });
      return;
    }

    if (op == OP_JETTON_TRANSFER) {
      // transfer#0f8a7ea5 query_id:uint64 amount:coins destination:Address response_destination:Address ...
      let qid = msg.loadUint(64);
      let _amount = msg.loadCoins();
      let _dest = msg.loadAddress();
      let response = msg.loadAddress();

      if (self.should_bounce) {
        throw(777);
      }

      // Send excesses back to response_destination (so CircleContract clears pending_out)
      let excess = beginCell()
        .storeUint(OP_JETTON_EXCESSES, 32)
        .storeUint(qid, 64)
        .endCell();

      send(SendParameters{
        to: response,
        value: 10_000_000, // 0.01 TON
        bounce: true,
        body: excess
      });
      return;
    }
  }

  get fun get_should_bounce(): Bool {
    return self.should_bounce;
  }
}
