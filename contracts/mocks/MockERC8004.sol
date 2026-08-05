// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockERC8004IdentityRegistry {
    mapping(uint256 => address) private owners;

    function setOwner(uint256 agentId, address owner) external {
        owners[agentId] = owner;
    }

    function ownerOf(uint256 agentId) external view returns (address) {
        address owner = owners[agentId];
        require(owner != address(0), "unknown agent");
        return owner;
    }
}

contract MockERC8004ReputationRegistry {
    struct Feedback {
        uint256 agentId;
        int128 value;
        uint8 valueDecimals;
        string tag1;
        string tag2;
    }

    Feedback[] public feedback;

    function giveFeedback(
        uint256 agentId,
        int128 value,
        uint8 valueDecimals,
        string calldata tag1,
        string calldata tag2,
        string calldata,
        string calldata,
        bytes32
    ) external {
        feedback.push(Feedback(agentId, value, valueDecimals, tag1, tag2));
    }

    function feedbackCount() external view returns (uint256) {
        return feedback.length;
    }
}
