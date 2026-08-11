// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC2771Forwarder} from "@openzeppelin/contracts/metatx/ERC2771Forwarder.sol";

/// @notice Stock OpenZeppelin ERC-2771 forwarder, named for discoverability. Verifies EIP-712
/// signed requests and forwards them to any AjoCircle/CircleFactory that trusts this address —
/// it never holds funds or decides which calls are worth sponsoring; the relayer backend that
/// submits to it is the one applying an allowlist and paying gas.
contract CadenceForwarder is ERC2771Forwarder {
    constructor() ERC2771Forwarder("Cadence") {}
}
