// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IKeeperAuthorization} from "./interfaces/IKeeperAuthorization.sol";
import {ICircleFactoryRegistry} from "./interfaces/ICircleFactoryRegistry.sol";

/// @notice One immutable rotating-savings circle. The member order is join order and locks at start.
contract AjoCircle {
    using SafeERC20 for IERC20;

    enum Status { Forming, Active, Completed }

    IERC20 public immutable asset;
    IKeeperAuthorization public immutable keeperAuthorization;
    ICircleFactoryRegistry public immutable factory;
    address public immutable creator;
    uint256 public immutable contributionAmount;
    uint256 public immutable depositAmount;
    uint256 public immutable targetMemberCount;
    uint256 public immutable roundDuration;
    uint256 public immutable firstRoundDeadline;

    Status public status;
    uint256 public currentRound;
    uint256 public currentRoundDeadline;
    uint256 public currentRoundFunding;

    address[] private members;
    mapping(address => bool) public isMember;
    mapping(address => uint256) public securityDepositBalance;
    mapping(uint256 => mapping(address => bool)) public contributed;
    mapping(uint256 => mapping(address => bool)) public defaultCovered;

    event MemberJoined(address indexed member, uint256 indexed position, uint256 depositPosted);
    event CircleStarted(uint256 indexed firstRound, uint256 deadline);
    event ContributionMade(uint256 indexed round, address indexed member, uint256 amount);
    event DefaultCovered(uint256 indexed round, address indexed member, uint256 amount);
    event PayoutExecuted(uint256 indexed round, address indexed recipient, uint256 amount);
    event CircleCompleted(uint256 indexed finalRound);
    event DepositReplenished(address indexed member, uint256 amount);

    error InvalidConfiguration();
    error InvalidStatus();
    error MemberOnly();
    error KeeperOnly();
    error AlreadyMember();
    error CircleFull();
    error AlreadyContributed();
    error ContributionWindowClosed();
    error DeadlineNotReached();
    error DefaultAlreadyCovered();
    error FundingIncomplete();
    error DepositInsufficient();

    constructor(
        address asset_,
        address keeperAuthorization_,
        address factory_,
        address creator_,
        uint256 contributionAmount_,
        uint256 depositAmount_,
        uint256 targetMemberCount_,
        uint256 roundDuration_,
        uint256 firstRoundDeadline_
    ) {
        if (
            asset_ == address(0) || keeperAuthorization_ == address(0) || factory_ == address(0) || creator_ == address(0) || contributionAmount_ == 0 ||
            depositAmount_ < contributionAmount_ || targetMemberCount_ < 2 || roundDuration_ == 0 ||
            firstRoundDeadline_ <= block.timestamp
        ) revert InvalidConfiguration();

        asset = IERC20(asset_);
        keeperAuthorization = IKeeperAuthorization(keeperAuthorization_);
        factory = ICircleFactoryRegistry(factory_);
        creator = creator_;
        contributionAmount = contributionAmount_;
        depositAmount = depositAmount_;
        targetMemberCount = targetMemberCount_;
        roundDuration = roundDuration_;
        firstRoundDeadline = firstRoundDeadline_;
        status = Status.Forming;
    }

    modifier onlyMember() {
        if (!isMember[msg.sender]) revert MemberOnly();
        _;
    }

    modifier onlyKeeper() {
        if (!keeperAuthorization.isKeeper(msg.sender)) revert KeeperOnly();
        _;
    }

    function join() external {
        if (status != Status.Forming) revert InvalidStatus();
        if (isMember[msg.sender]) revert AlreadyMember();
        if (members.length == targetMemberCount) revert CircleFull();

        isMember[msg.sender] = true;
        members.push(msg.sender);
        securityDepositBalance[msg.sender] = depositAmount;
        asset.safeTransferFrom(msg.sender, address(this), depositAmount);
        emit MemberJoined(msg.sender, members.length, depositAmount);
    }

    /// @notice Anyone may start a full circle. This does not create an admin role.
    function start() external {
        if (status != Status.Forming || members.length != targetMemberCount) revert InvalidStatus();
        status = Status.Active;
        currentRound = 1;
        currentRoundDeadline = firstRoundDeadline;
        factory.onCircleStatusChanged(uint8(status));
        emit CircleStarted(currentRound, currentRoundDeadline);
    }

    function contribute() external onlyMember {
        if (status != Status.Active) revert InvalidStatus();
        if (block.timestamp >= currentRoundDeadline) revert ContributionWindowClosed();
        if (contributed[currentRound][msg.sender]) revert AlreadyContributed();

        contributed[currentRound][msg.sender] = true;
        currentRoundFunding += contributionAmount;
        asset.safeTransferFrom(msg.sender, address(this), contributionAmount);
        emit ContributionMade(currentRound, msg.sender, contributionAmount);
    }

    /// @notice Allows a member to restore their one-round protection after it was used.
    function replenishDeposit() external onlyMember {
        uint256 missing = depositAmount - securityDepositBalance[msg.sender];
        if (missing == 0) revert InvalidConfiguration();
        securityDepositBalance[msg.sender] = depositAmount;
        asset.safeTransferFrom(msg.sender, address(this), missing);
        emit DepositReplenished(msg.sender, missing);
    }

    function checkAndCoverDefault(uint256 round, address member) external onlyKeeper {
        if (status != Status.Active || round != currentRound || !isMember[member]) revert InvalidStatus();
        if (block.timestamp < currentRoundDeadline) revert DeadlineNotReached();
        if (contributed[round][member]) return;
        if (defaultCovered[round][member]) revert DefaultAlreadyCovered();
        if (securityDepositBalance[member] < contributionAmount) revert DepositInsufficient();

        defaultCovered[round][member] = true;
        securityDepositBalance[member] -= contributionAmount;
        currentRoundFunding += contributionAmount;
        emit DefaultCovered(round, member, contributionAmount);
    }

    function executePayout(uint256 round) external onlyKeeper {
        if (status != Status.Active || round != currentRound) revert InvalidStatus();
        if (block.timestamp < currentRoundDeadline) revert DeadlineNotReached();
        uint256 pot = contributionAmount * targetMemberCount;
        if (currentRoundFunding != pot) revert FundingIncomplete();

        address recipient = members[round - 1];
        currentRoundFunding = 0;
        asset.safeTransfer(recipient, pot);
        emit PayoutExecuted(round, recipient, pot);

        if (round == targetMemberCount) {
            status = Status.Completed;
            factory.onCircleStatusChanged(uint8(status));
            emit CircleCompleted(round);
            return;
        }

        currentRound = round + 1;
        currentRoundDeadline += roundDuration;
    }

    function getMembers() external view returns (address[] memory) {
        return members;
    }

    function memberAt(uint256 index) external view returns (address) {
        return members[index];
    }

    function memberCount() external view returns (uint256) {
        return members.length;
    }

    function recipientForRound(uint256 round) external view returns (address) {
        return members[round - 1];
    }

    function roundIsFullyFunded(uint256 round) external view returns (bool) {
        return round == currentRound && currentRoundFunding == contributionAmount * targetMemberCount;
    }
}
