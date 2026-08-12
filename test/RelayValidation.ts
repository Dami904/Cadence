import { expect } from "chai";
import { encodeFunctionData, toFunctionSelector, type Address } from "viem";
import {
  MAX_REQUEST_GAS,
  SPONSORED_SELECTORS,
  isRelayValidationError,
  validateRelayRequest,
  validateTargetSelector,
  type RawRelayBody,
} from "../lib/relayValidation.ts";

// Unlike the rest of test/, this file exercises pure request-validation logic with no Hardhat
// network, no contracts, and no database — it runs the exact allowlist/bounds checks
// /api/relay applies before ever touching Postgres or the KeeperHub webhook, so the security
// claims those checks are supposed to enforce ("only these selectors," "gas is capped," "only
// zero-value calls") have real coverage instead of none.

const ADDR_A: Address = "0x1111111111111111111111111111111111111111";
const ADDR_B: Address = "0x2222222222222222222222222222222222222222";
const JOIN_CALLDATA = encodeFunctionData({
  abi: [{ type: "function", name: "join", stateMutability: "nonpayable", inputs: [], outputs: [] }],
  functionName: "join",
});
const SOME_HEX_SIGNATURE = ("0x" + "11".repeat(65)) as `0x${string}`;

function baseBody(overrides: Partial<RawRelayBody> = {}): RawRelayBody {
  return {
    from: ADDR_A,
    to: ADDR_B,
    value: "0",
    gas: "300000",
    deadline: String(Math.floor(Date.now() / 1000) + 3600),
    data: JOIN_CALLDATA,
    signature: SOME_HEX_SIGNATURE,
    ...overrides,
  };
}

describe("relayValidation.validateRelayRequest", function () {
  it("accepts a well-formed request for an allowlisted selector", function () {
    const result = validateRelayRequest(baseBody());
    expect(isRelayValidationError(result)).to.equal(false);
    if (!isRelayValidationError(result)) {
      expect(result.selector).to.equal(toFunctionSelector("join()"));
      expect(result.value).to.equal(0n);
    }
  });

  it("rejects a malformed address", function () {
    const result = validateRelayRequest(baseBody({ from: "not-an-address" }));
    expect(isRelayValidationError(result)).to.equal(true);
    if (isRelayValidationError(result)) expect(result.error).to.equal("Malformed request");
  });

  it("rejects non-hex data or signature", function () {
    expect(isRelayValidationError(validateRelayRequest(baseBody({ data: "0xzz" })))).to.equal(true);
    expect(isRelayValidationError(validateRelayRequest(baseBody({ signature: "not-hex" })))).to.equal(true);
  });

  it("rejects a value that isn't a valid bigint literal", function () {
    const result = validateRelayRequest(baseBody({ value: "not-a-number" }));
    expect(isRelayValidationError(result)).to.equal(true);
    if (isRelayValidationError(result)) expect(result.error).to.equal("Malformed request");
  });

  it("rejects any nonzero value — the relay only ever forwards zero-value calls", function () {
    const result = validateRelayRequest(baseBody({ value: "1" }));
    expect(isRelayValidationError(result)).to.equal(true);
    if (isRelayValidationError(result)) expect(result.error).to.equal("Only zero-value calls are relayed");
  });

  it("rejects zero or negative gas", function () {
    const result = validateRelayRequest(baseBody({ gas: "0" }));
    expect(isRelayValidationError(result)).to.equal(true);
    if (isRelayValidationError(result)) expect(result.error).to.equal("Requested gas out of bounds");
  });

  it("rejects gas above the hard cap", function () {
    const result = validateRelayRequest(baseBody({ gas: (MAX_REQUEST_GAS + 1n).toString() }));
    expect(isRelayValidationError(result)).to.equal(true);
    if (isRelayValidationError(result)) expect(result.error).to.equal("Requested gas out of bounds");
  });

  it("accepts gas exactly at the cap — the boundary itself isn't rejected", function () {
    const result = validateRelayRequest(baseBody({ gas: MAX_REQUEST_GAS.toString() }));
    expect(isRelayValidationError(result)).to.equal(false);
  });

  it("rejects calldata whose selector isn't on the sponsored allowlist", function () {
    const arbitraryCalldata = ("0x" + "deadbeef" + "00".repeat(32)) as `0x${string}`;
    const result = validateRelayRequest(baseBody({ data: arbitraryCalldata }));
    expect(isRelayValidationError(result)).to.equal(true);
    if (isRelayValidationError(result)) expect(result.error).to.equal("This action isn't eligible for gas sponsorship");
  });

  it("the allowlist covers exactly the member-facing actions the product actually exposes — no more, no less", function () {
    const expectedSignatures = [
      "createCircle(address,uint256,uint256,uint256,uint256,uint256,uint256)",
      "join()",
      "leave()",
      "cancelIfExpired()",
      "withdrawDeposit(address)",
      "contribute()",
      "start()",
      "replenishDeposit()",
      "coverDeposit(address)",
      "linkIdentity(uint256)",
      "unlinkIdentity()",
    ];
    const expectedSelectors = new Set(expectedSignatures.map((sig) => toFunctionSelector(sig)));
    expect(SPONSORED_SELECTORS.size).to.equal(expectedSelectors.size);
    for (const selector of expectedSelectors) expect(SPONSORED_SELECTORS.has(selector)).to.equal(true);
  });
});

describe("relayValidation.validateTargetSelector", function () {
  const createCircleSelector = toFunctionSelector("createCircle(address,uint256,uint256,uint256,uint256,uint256,uint256)");
  const joinSelector = toFunctionSelector("join()");
  const linkIdentitySelector = toFunctionSelector("linkIdentity(uint256)");

  it("only allows createCircle on the factory", function () {
    expect(validateTargetSelector({ selector: createCircleSelector, isFactory: true, isTrustScoreRegistry: false, isCircle: false })).to.equal(null);
    const rejected = validateTargetSelector({ selector: joinSelector, isFactory: true, isTrustScoreRegistry: false, isCircle: false });
    expect(rejected?.error).to.equal("That action isn't valid on the factory");
  });

  it("only allows the identity-link selectors on the trust score registry", function () {
    expect(validateTargetSelector({ selector: linkIdentitySelector, isFactory: false, isTrustScoreRegistry: true, isCircle: false })).to.equal(null);
    const rejected = validateTargetSelector({ selector: joinSelector, isFactory: false, isTrustScoreRegistry: true, isCircle: false });
    expect(rejected?.error).to.equal("That action isn't valid on the trust score registry");
  });

  it("rejects a target that isn't the factory, the registry, or a real circle", function () {
    const rejected = validateTargetSelector({ selector: joinSelector, isFactory: false, isTrustScoreRegistry: false, isCircle: false });
    expect(rejected?.error).to.equal("Target isn't a Cadence contract");
  });

  it("allows circle-facing selectors on a real circle, but not the identity-link selectors", function () {
    expect(validateTargetSelector({ selector: joinSelector, isFactory: false, isTrustScoreRegistry: false, isCircle: true })).to.equal(null);
    const rejected = validateTargetSelector({ selector: linkIdentitySelector, isFactory: false, isTrustScoreRegistry: false, isCircle: true });
    expect(rejected?.error).to.equal("That action isn't valid on a circle");
  });

  it("rejects every target flag being false at once, rather than defaulting to allow", function () {
    const rejected = validateTargetSelector({ selector: createCircleSelector, isFactory: false, isTrustScoreRegistry: false, isCircle: false });
    expect(rejected?.error).to.equal("Target isn't a Cadence contract");
  });
});
