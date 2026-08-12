// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import {IKeeperAuthorization} from "./interfaces/IKeeperAuthorization.sol";
import {IERC8004IdentityRegistry, IERC8004ReputationRegistry} from "./interfaces/IERC8004.sol";

/// @notice Cadence outcome adapter for the ERC-8004 reputation standard.
/// @dev ERC-8004 feedback belongs to an identity (`agentId`), not an arbitrary EOA.
///      Members link an identity they own; KeeperHub then posts public outcome signals.
///      ERC2771Context so linkIdentity/unlinkIdentity are gas-abstracted like every other
///      member-facing action in the system (spec 2.5) — recordCompletion/recordDefault
///      deliberately keep raw msg.sender via onlyKeeper, same reasoning as AjoCircle.
contract TrustScoreRegistry is ERC2771Context {
    string public constant COMPLETION_TAG = "cadence-circle-completion";
    string public constant DEFAULT_TAG = "cadence-contribution-default";

    IERC8004IdentityRegistry public immutable identityRegistry;
    IERC8004ReputationRegistry public immutable reputationRegistry;
    IKeeperAuthorization public immutable keeperAuthorization;

    mapping(address => uint256) public memberAgentId;
    mapping(address => bool) public hasLinkedIdentity;

    event IdentityLinked(address indexed member, uint256 indexed agentId);
    event IdentityUnlinked(address indexed member, uint256 indexed agentId);
    event OutcomeRecorded(address indexed member, uint256 indexed agentId, int128 value, string tag);
    event OutcomeSkipped(address indexed member, string reason);

    error KeeperOnly();
    error IdentityOwnerMismatch();

    constructor(
        address identityRegistry_,
        address reputationRegistry_,
        address keeperAuthorization_,
        address trustedForwarder_
    ) ERC2771Context(trustedForwarder_) {
        identityRegistry = IERC8004IdentityRegistry(identityRegistry_);
        reputationRegistry = IERC8004ReputationRegistry(reputationRegistry_);
        keeperAuthorization = IKeeperAuthorization(keeperAuthorization_);
    }

    modifier onlyKeeper() {
        if (!keeperAuthorization.isKeeper(msg.sender)) revert KeeperOnly();
        _;
    }

    function linkIdentity(uint256 agentId) external {
        address member = _msgSender();
        if (identityRegistry.ownerOf(agentId) != member) revert IdentityOwnerMismatch();
        memberAgentId[member] = agentId;
        hasLinkedIdentity[member] = true;
        emit IdentityLinked(member, agentId);
    }

    function unlinkIdentity() external {
        address member = _msgSender();
        uint256 agentId = memberAgentId[member];
        delete memberAgentId[member];
        delete hasLinkedIdentity[member];
        emit IdentityUnlinked(member, agentId);
    }

    function recordCompletion(address member) external onlyKeeper {
        _record(member, int128(100), COMPLETION_TAG);
    }

    function recordDefault(address member) external onlyKeeper {
        _record(member, int128(-100), DEFAULT_TAG);
    }

    function _record(address member, int128 value, string memory tag) internal {
        if (!hasLinkedIdentity[member]) {
            emit OutcomeSkipped(member, "ERC-8004 identity not linked");
            return;
        }

        uint256 agentId = memberAgentId[member];
        // valueDecimals = 0; the tag gives the value its application-specific meaning.
        reputationRegistry.giveFeedback(agentId, value, 0, tag, "cadence", "", "", bytes32(0));
        emit OutcomeRecorded(member, agentId, value, tag);
    }
}
