// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AjoCircle} from "./AjoCircle.sol";

/// @notice Deploys circles and exposes discovery metadata only.
/// @dev It never reads contribution, deposit, default, or payout state.
contract CircleFactory {
    struct CircleRecord {
        address circle;
        uint256 targetMemberCount;
        uint8 status;
    }

    address public immutable keeperAuthorization;
    address[] private circles;
    mapping(address => bool) public isCircle;
    mapping(address => CircleRecord) private records;

    event CircleCreated(address indexed circle, uint256 targetMemberCount, address indexed asset, address indexed creator);
    event CircleStatusUpdated(address indexed circle, uint8 status);

    error CircleOnly();

    constructor(address keeperAuthorization_) {
        keeperAuthorization = keeperAuthorization_;
    }

    function createCircle(
        address asset,
        uint256 contributionAmount,
        uint256 depositAmount,
        uint256 targetMemberCount,
        uint256 roundDuration,
        uint256 firstRoundDeadline
    ) external returns (address circle) {
        circle = address(
            new AjoCircle(
                asset,
                keeperAuthorization,
                address(this),
                msg.sender,
                contributionAmount,
                depositAmount,
                targetMemberCount,
                roundDuration,
                firstRoundDeadline
            )
        );
        circles.push(circle);
        isCircle[circle] = true;
        records[circle] = CircleRecord({circle: circle, targetMemberCount: targetMemberCount, status: 0});
        emit CircleCreated(circle, targetMemberCount, asset, msg.sender);
    }

    function onCircleStatusChanged(uint8 status) external {
        if (!isCircle[msg.sender]) revert CircleOnly();
        records[msg.sender].status = status;
        emit CircleStatusUpdated(msg.sender, status);
    }

    function circleCount() external view returns (uint256) {
        return circles.length;
    }

    function circleAt(uint256 index) external view returns (address) {
        return circles[index];
    }

    function getCircle(address circle) external view returns (CircleRecord memory) {
        return records[circle];
    }
}
