import { isAddress, isHex, toFunctionSelector, type Address, type Hex } from "viem";

// Pure request-shape and policy validation for /api/relay, pulled out of the route handler so it
// can be exercised directly in tests — no Next.js request object, no database, no network call.
// The route handler is the only thing that should ever import this alongside I/O; nothing here
// touches Postgres, the KeeperHub webhook, or an RPC client.

export const CREATE_CIRCLE_SIGNATURE = "createCircle(address,uint256,uint256,uint256,uint256,uint256,uint256)";

export const TRUST_SCORE_SELECTORS = new Set([toFunctionSelector("linkIdentity(uint256)"), toFunctionSelector("unlinkIdentity()")]);

// Only these calls are ever sponsored — even against a trusted target, arbitrary calldata isn't
// forwarded. Selectors are derived from the same signatures the contracts actually expose, not
// hardcoded hex, so this list can't silently drift from what's really callable.
export const SPONSORED_SELECTORS = new Set([
  toFunctionSelector(CREATE_CIRCLE_SIGNATURE),
  toFunctionSelector("join()"),
  toFunctionSelector("leave()"),
  toFunctionSelector("cancelIfExpired()"),
  toFunctionSelector("withdrawDeposit(address)"),
  toFunctionSelector("contribute()"),
  toFunctionSelector("start()"),
  toFunctionSelector("replenishDeposit()"),
  toFunctionSelector("coverDeposit(address)"),
  ...TRUST_SCORE_SELECTORS,
]);

export const MAX_REQUEST_GAS = 500_000n;

export type RawRelayBody = {
  from?: unknown;
  to?: unknown;
  value?: unknown;
  gas?: unknown;
  deadline?: unknown;
  data?: unknown;
  signature?: unknown;
};

export type ParsedRelayRequest = {
  from: Address;
  to: Address;
  value: bigint;
  gas: bigint;
  deadline: bigint;
  data: Hex;
  signature: Hex;
  selector: Hex;
};

export type RelayValidationError = { error: string; status: number };

export function isRelayValidationError(result: ParsedRelayRequest | RelayValidationError): result is RelayValidationError {
  return "error" in result;
}

// Shape, bounds, and allowlist checks — everything that can be decided without reading chain
// state or hitting the database. Identical logic to what the route handler ran inline before;
// moved here only so it can be unit tested on its own.
export function validateRelayRequest(body: RawRelayBody): ParsedRelayRequest | RelayValidationError {
  const { from, to, value, gas, deadline, data, signature } = body;

  if (
    typeof from !== "string" ||
    typeof to !== "string" ||
    typeof data !== "string" ||
    typeof signature !== "string" ||
    !isAddress(from) ||
    !isAddress(to) ||
    !isHex(data) ||
    !isHex(signature)
  ) {
    return { error: "Malformed request", status: 400 };
  }

  let valueBig: bigint, gasBig: bigint, deadlineBig: bigint;
  try {
    valueBig = BigInt(value as never);
    gasBig = BigInt(gas as never);
    deadlineBig = BigInt(deadline as never);
  } catch {
    return { error: "Malformed request", status: 400 };
  }

  if (valueBig !== 0n) {
    return { error: "Only zero-value calls are relayed", status: 400 };
  }
  if (gasBig <= 0n || gasBig > MAX_REQUEST_GAS) {
    return { error: "Requested gas out of bounds", status: 400 };
  }

  const selector = data.slice(0, 10) as Hex;
  if (!SPONSORED_SELECTORS.has(selector)) {
    return { error: "This action isn't eligible for gas sponsorship", status: 400 };
  }

  return { from, to, value: valueBig, gas: gasBig, deadline: deadlineBig, data, signature, selector };
}

// Given which kind of contract the request targets (resolved by the caller via an on-chain
// isCircle() read, which does need I/O and so stays out of this pure module), decides whether the
// selector is actually allowed on that specific target: the factory only accepts createCircle,
// the trust score registry only accepts the two identity-link selectors, and a circle accepts
// everything in SPONSORED_SELECTORS except those two.
export function validateTargetSelector(params: {
  selector: Hex;
  isFactory: boolean;
  isTrustScoreRegistry: boolean;
  isCircle: boolean;
}): RelayValidationError | null {
  const { selector, isFactory, isTrustScoreRegistry, isCircle } = params;

  if (isFactory) {
    if (selector !== toFunctionSelector(CREATE_CIRCLE_SIGNATURE)) {
      return { error: "That action isn't valid on the factory", status: 400 };
    }
    return null;
  }

  if (isTrustScoreRegistry) {
    if (!TRUST_SCORE_SELECTORS.has(selector)) {
      return { error: "That action isn't valid on the trust score registry", status: 400 };
    }
    return null;
  }

  if (!isCircle) {
    return { error: "Target isn't a Cadence contract", status: 400 };
  }
  if (TRUST_SCORE_SELECTORS.has(selector)) {
    return { error: "That action isn't valid on a circle", status: 400 };
  }
  return null;
}
