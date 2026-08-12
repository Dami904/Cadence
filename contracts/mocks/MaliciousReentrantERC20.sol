// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice A minimal, otherwise-ordinary ERC20 that can be armed to call back into an arbitrary
/// target with arbitrary calldata partway through a transfer. Exists only to prove AjoCircle's
/// nonReentrant guards hold against a genuinely hostile token — every other test in this repo
/// uses the well-behaved MockUSDC, which can never exercise this path since it has no hooks.
contract MaliciousReentrantERC20 is IERC20 {
    string public constant name = "Malicious Token";
    string public constant symbol = "EVIL";

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    address private reentryTarget;
    bytes private reentryCalldata;
    bool private armed;

    function decimals() external pure returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    /// @notice Arms exactly one future transfer/transferFrom to call `target` with `data` right
    /// after balances update but before that transfer call returns — the same point in execution
    /// a real malicious token would use to try to re-enter the caller.
    function arm(address target, bytes calldata data) external {
        reentryTarget = target;
        reentryCalldata = data;
        armed = true;
    }

    /// @dev arm() disarms itself once its reentrant call actually fires — but if that call (and so
    /// the whole enclosing transaction) reverts, every state change made during it, including that
    /// disarm, rolls back too, leaving `armed` true again. Callers that intentionally trigger a
    /// reverting reentrant attempt and then want a clean, unarmed transfer afterward need this.
    function disarm() external {
        armed = false;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "ERC20: insufficient allowance");
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) private {
        require(balanceOf[from] >= amount, "ERC20: insufficient balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);

        if (armed) {
            // One-shot: disarm before calling out, so the test's own assertions about *this*
            // reentrant attempt can't recurse into an infinite loop on a second, accidental call.
            armed = false;
            (bool ok, bytes memory returndata) = reentryTarget.call(reentryCalldata);
            if (!ok) {
                // Bubble the real revert reason up so a failing test shows *why* the reentrant
                // call failed (e.g. ReentrancyGuardReentrantCall), not just "call reverted".
                assembly {
                    revert(add(returndata, 0x20), mload(returndata))
                }
            }
        }
    }
}
