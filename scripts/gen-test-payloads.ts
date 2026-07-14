// Manual smoke-test helper: generates ready-to-run curl commands against a
// live VAPOR deployment, using a freshly generated throwaway wallet (zero
// funds, zero history — safe to print/share, and re-run any time since it
// generates a new one on every invocation). Not wired into CI — this is
// for exercising a real deployment by hand. Run with
// `npx tsx scripts/gen-test-payloads.ts`.
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { NETWORKS } from "../src/config/networks.js";

const network = NETWORKS["eip155:8453"];
const API_BASE = "https://x402.duckdns.org";

const privateKey = generatePrivateKey();
const account = privateKeyToAccount(privateKey);

const payTo = "0x000000000000000000000000000000000000dEaD" as const; // burn address — fine, this test never has enough balance to settle anyway

const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

function randomNonce(): `0x${string}` {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `0x${Buffer.from(bytes).toString("hex")}`;
}

async function signAuth(opts: { value: string; validAfter: bigint; validBefore: bigint; nonce: `0x${string}` }) {
  const signature = await account.signTypedData({
    domain: {
      name: network.usdc.name,
      version: network.usdc.version,
      chainId: network.chain.id,
      verifyingContract: network.usdc.address,
    },
    types: TRANSFER_WITH_AUTHORIZATION_TYPES,
    primaryType: "TransferWithAuthorization",
    message: {
      from: account.address,
      to: payTo,
      value: BigInt(opts.value),
      validAfter: opts.validAfter,
      validBefore: opts.validBefore,
      nonce: opts.nonce,
    },
  });
  return signature;
}

function buildRequestBody(authorization: {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
}, signature: string, requiredAmount: string) {
  return {
    x402Version: 1,
    paymentPayload: {
      x402Version: 1,
      scheme: "exact",
      network: network.caip2,
      payload: { signature, authorization },
    },
    paymentRequirements: {
      scheme: "exact",
      network: network.caip2,
      maxAmountRequired: requiredAmount,
      resource: "https://example.com/test-resource",
      payTo,
      asset: network.usdc.address,
      maxTimeoutSeconds: 300,
    },
  };
}

async function main() {
  const now = BigInt(Math.floor(Date.now() / 1000));

  console.log("=== Throwaway test wallet (zero funds, safe to share) ===");
  console.log("address:   ", account.address);
  console.log("privateKey:", privateKey);
  console.log();

  // 1. Structurally valid, but zero balance — should fail balance check
  // after passing every earlier real check (signature, time window, amount).
  {
    const nonce = randomNonce();
    const validAfter = now - 60n;
    const validBefore = now + 300n;
    const value = "10000"; // 0.01 USDC
    const signature = await signAuth({ value, validAfter, validBefore, nonce });
    const body = buildRequestBody(
      {
        from: account.address,
        to: payTo,
        value,
        validAfter: validAfter.toString(),
        validBefore: validBefore.toString(),
        nonce,
      },
      signature,
      value
    );
    console.log("=== TEST 1: valid signature, insufficient balance ===");
    console.log("Expect: isValid=false, invalidReason='payer balance is insufficient'");
    console.log(`curl -sS -X POST ${API_BASE}/verify -H "Content-Type: application/json" -d '${JSON.stringify(body)}'`);
    console.log();
  }

  // 2. Expired authorization (validBefore in the past)
  {
    const nonce = randomNonce();
    const validAfter = now - 600n;
    const validBefore = now - 60n;
    const value = "10000";
    const signature = await signAuth({ value, validAfter, validBefore, nonce });
    const body = buildRequestBody(
      {
        from: account.address,
        to: payTo,
        value,
        validAfter: validAfter.toString(),
        validBefore: validBefore.toString(),
        nonce,
      },
      signature,
      value
    );
    console.log("=== TEST 2: expired authorization ===");
    console.log("Expect: isValid=false, invalidReason='authorization outside its valid time window'");
    console.log(`curl -sS -X POST ${API_BASE}/verify -H "Content-Type: application/json" -d '${JSON.stringify(body)}'`);
    console.log();
  }

  // 3. Wrong amount (signed for 10000, but requirements ask for 20000)
  {
    const nonce = randomNonce();
    const validAfter = now - 60n;
    const validBefore = now + 300n;
    const signedValue = "10000";
    const requiredValue = "20000";
    const signature = await signAuth({ value: signedValue, validAfter, validBefore, nonce });
    const body = buildRequestBody(
      {
        from: account.address,
        to: payTo,
        value: signedValue,
        validAfter: validAfter.toString(),
        validBefore: validBefore.toString(),
        nonce,
      },
      signature,
      requiredValue
    );
    console.log("=== TEST 3: signed value does not match required amount ===");
    console.log("Expect: isValid=false, invalidReason='authorization value does not match required amount'");
    console.log(`curl -sS -X POST ${API_BASE}/verify -H "Content-Type: application/json" -d '${JSON.stringify(body)}'`);
    console.log();
  }

  // 4. Tampered signature (flip one hex character)
  {
    const nonce = randomNonce();
    const validAfter = now - 60n;
    const validBefore = now + 300n;
    const value = "10000";
    const signature = await signAuth({ value, validAfter, validBefore, nonce });
    const tampered = (signature.slice(0, -1) + (signature.slice(-1) === "0" ? "1" : "0")) as `0x${string}`;
    const body = buildRequestBody(
      {
        from: account.address,
        to: payTo,
        value,
        validAfter: validAfter.toString(),
        validBefore: validBefore.toString(),
        nonce,
      },
      tampered,
      value
    );
    console.log("=== TEST 4: tampered signature ===");
    console.log("Expect: isValid=false, invalidReason='signature was not signed by the claimed payer' (or 'invalid signature')");
    console.log(`curl -sS -X POST ${API_BASE}/verify -H "Content-Type: application/json" -d '${JSON.stringify(body)}'`);
    console.log();
  }

  console.log("=== TEST 5: live risk-scan on the throwaway address (real RPC read) ===");
  console.log("Expect: transactionCount=0, isContract=false, elevated (non-zero) risk score");
  console.log(`curl -sS "${API_BASE}/risk-scan/${account.address}?network=eip155:8453"`);
  console.log();

  console.log("=== TEST 6: live payee-reputation on the test payTo (burn address) ===");
  console.log("Expect: score=0, band='new' (no settlement history yet)");
  console.log(`curl -sS "${API_BASE}/payee-reputation/${payTo}?network=eip155:8453"`);
}

main();
