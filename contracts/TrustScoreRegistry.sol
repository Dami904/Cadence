// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IKeeperAuthorization} from "./interfaces/IKeeperAuthorization.sol";
import {IERC8004IdentityRegistry, IERC8004ReputationRegistry} from "./interfaces/IERC8004.sol";

/// @notice Cadence outcome adapter for the ERC-8004 reputation standard.
/// @dev ERC-8004 feedback belongs to an identity (`agentId`), not an arbitrary EOA.
///      Members link an identity they own; KeeperHub then posts public outcome signals.
contract TrustScoreRegistry {
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

    constructor(address identityRegistry_, address reputationRegistry_, address keeperAuthorization_) {
        identityRegistry = IERC8004IdentityRegistry(identityRegistry_);
        reputationRegistry = IERC8004ReputationRegistry(reputationRegistry_);
        keeperAuthorization = IKeeperAuthorization(keeperAuthorization_);
    }

    modifier onlyKeeper() {
        if (!keeperAuthorization.isKeeper(msg.sender)) revert KeeperOnly();
        _;
    }

    function linkIdentity(uint256 agentId) external {
        if (identityRegistry.ownerOf(agentId) != msg.sender) revert IdentityOwnerMismatch();
        memberAgentId[msg.sender] = agentId;
        hasLinkedIdentity[msg.sender] = true;
        emit IdentityLinked(msg.sender, agentId);
    }

    function unlinkIdentity() external {
        uint256 agentId = memberAgentId[msg.sender];
        delete memberAgentId[msg.sender];
        delete hasLinkedIdentity[msg.sender];
        emit IdentityUnlinked(msg.sender, agentId);
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
