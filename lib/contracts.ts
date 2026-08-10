import { isAddress, zeroAddress } from "viem";

function configuredAddress(value: string | undefined) {
  return value && isAddress(value) ? value : zeroAddress;
}

const usdc = configuredAddress(process.env.NEXT_PUBLIC_USDC_ADDRESS);
const circleFactory = configuredAddress(process.env.NEXT_PUBLIC_CIRCLE_FACTORY_ADDRESS);
const keeperAuthorization = configuredAddress(process.env.NEXT_PUBLIC_KEEPER_AUTHORIZATION_ADDRESS);
const trustScoreRegistry = configuredAddress(process.env.NEXT_PUBLIC_TRUST_SCORE_REGISTRY_ADDRESS);
const factoryDeployBlockEnv = process.env.NEXT_PUBLIC_FACTORY_DEPLOY_BLOCK;
const factoryDeployBlock = factoryDeployBlockEnv && /^\d+$/.test(factoryDeployBlockEnv) ? BigInt(factoryDeployBlockEnv) : 0n;

export const cadenceContracts = {
  isConfigured: usdc !== zeroAddress && circleFactory !== zeroAddress,
  usdc,
  circleFactory,
  keeperAuthorization,
  trustScoreRegistry,
  factoryDeployBlock,
} as const;

export const circleFactoryAbi = [
  { type: "function", name: "circleCount", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "circleAt", stateMutability: "view", inputs: [{ name: "index", type: "uint256" }], outputs: [{ name: "", type: "address" }] },
  {
    type: "function",
    name: "getCircle",
    stateMutability: "view",
    inputs: [{ name: "circle", type: "address" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "circle", type: "address" },
          { name: "targetMemberCount", type: "uint256" },
          { name: "status", type: "uint8" },
        ],
      },
    ],
  },
  {
    type: "event",
    name: "CircleCreated",
    anonymous: false,
    inputs: [
      { name: "circle", type: "address", indexed: true },
      { name: "targetMemberCount", type: "uint256", indexed: false },
      { name: "asset", type: "address", indexed: true },
      { name: "creator", type: "address", indexed: true },
    ],
  },
  {
    type: "function",
    name: "createCircle",
    stateMutability: "nonpayable",
    inputs: [
      { name: "asset", type: "address" },
      { name: "contributionAmount", type: "uint256" },
      { name: "depositAmount", type: "uint256" },
      { name: "targetMemberCount", type: "uint256" },
      { name: "roundDuration", type: "uint256" },
      { name: "firstRoundDeadline", type: "uint256" },
    ],
    outputs: [{ name: "circle", type: "address" }],
  },
] as const;

export const ajoCircleAbi = [
  { type: "function", name: "asset", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "creator", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "contributionAmount", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "depositAmount", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "targetMemberCount", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "roundDuration", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "memberCount", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "status", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint8" }] },
  { type: "function", name: "currentRound", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "currentRoundDeadline", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "currentRoundFunding", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "getMembers", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address[]" }] },
  { type: "function", name: "recipientForRound", stateMutability: "view", inputs: [{ name: "round", type: "uint256" }], outputs: [{ name: "", type: "address" }] },
  {
    type: "function",
    name: "isMember",
    stateMutability: "view",
    inputs: [{ name: "member", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "contributed",
    stateMutability: "view",
    inputs: [{ name: "round", type: "uint256" }, { name: "member", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "defaultCovered",
    stateMutability: "view",
    inputs: [{ name: "round", type: "uint256" }, { name: "member", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "securityDepositBalance",
    stateMutability: "view",
    inputs: [{ name: "member", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  { type: "function", name: "join", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "contribute", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "start", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "replenishDeposit", stateMutability: "nonpayable", inputs: [], outputs: [] },
] as const;

export const ajoCircleEvents = [
  {
    type: "event",
    name: "MemberJoined",
    anonymous: false,
    inputs: [
      { name: "member", type: "address", indexed: true },
      { name: "position", type: "uint256", indexed: true },
      { name: "depositPosted", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "ContributionMade",
    anonymous: false,
    inputs: [
      { name: "round", type: "uint256", indexed: true },
      { name: "member", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "DefaultCovered",
    anonymous: false,
    inputs: [
      { name: "round", type: "uint256", indexed: true },
      { name: "member", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "PayoutExecuted",
    anonymous: false,
    inputs: [
      { name: "round", type: "uint256", indexed: true },
      { name: "recipient", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "CircleCompleted",
    anonymous: false,
    inputs: [{ name: "finalRound", type: "uint256", indexed: true }],
  },
] as const;

export const CircleStatus = { Forming: 0, Active: 1, Completed: 2 } as const;

export const trustScoreRegistryAbi = [
  { type: "function", name: "hasLinkedIdentity", stateMutability: "view", inputs: [{ name: "", type: "address" }], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "memberAgentId", stateMutability: "view", inputs: [{ name: "", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "linkIdentity", stateMutability: "nonpayable", inputs: [{ name: "agentId", type: "uint256" }], outputs: [] },
  { type: "function", name: "unlinkIdentity", stateMutability: "nonpayable", inputs: [], outputs: [] },
  {
    type: "event",
    name: "OutcomeRecorded",
    anonymous: false,
    inputs: [
      { name: "member", type: "address", indexed: true },
      { name: "agentId", type: "uint256", indexed: true },
      { name: "value", type: "int128", indexed: false },
      { name: "tag", type: "string", indexed: false },
    ],
  },
  {
    type: "event",
    name: "OutcomeSkipped",
    anonymous: false,
    inputs: [
      { name: "member", type: "address", indexed: true },
      { name: "reason", type: "string", indexed: false },
    ],
  },
] as const;

export const TRUST_SCORE_TAGS = {
  completion: "cadence-circle-completion",
  default: "cadence-contribution-default",
} as const;

export const erc20Abi = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;
