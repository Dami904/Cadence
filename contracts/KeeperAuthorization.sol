// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Global, minimal authorization boundary for KeeperHub-managed wallets.
contract KeeperAuthorization is Ownable {
    mapping(address => bool) private keepers;

    event KeeperAuthorizationUpdated(address indexed keeper, bool authorized);

    error ZeroAddress();

    constructor(address initialOwner) Ownable(initialOwner) {}

    function setKeeper(address keeper, bool authorized) external onlyOwner {
        if (keeper == address(0)) revert ZeroAddress();
        keepers[keeper] = authorized;
        emit KeeperAuthorizationUpdated(keeper, authorized);
    }

    function isKeeper(address account) external view returns (bool) {
        return keepers[account];
    }
}
