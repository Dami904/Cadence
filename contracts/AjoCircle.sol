// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import {IKeeperAuthorization} from "./interfaces/IKeeperAuthorization.sol";
import {ICircleFactoryRegistry} from "./interfaces/ICircleFactoryRegistry.sol";

/// @notice One immutable rotating-savings circle. The member order is join order and locks at start.
/// @dev ERC2771Context lets a trusted relayer submit member actions on a signer's behalf so gas
/// isn't a blocker for wallets that aren't sponsored by a smart-account paymaster. checkAndCoverDefault
/// and executePayout deliberately keep raw msg.sender (via onlyKeeper) — relayed calls can never pass
/// as an authorized keeper, since the forwarder itself is never granted keeper status.
contract AjoCircle is ERC2771Context {
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
    event MemberLeft(address indexed member, uint256 depositReturned);
    event CircleStarted(uint256 indexed firstRound, uint256 deadline);
    event ContributionMade(uint256 indexed round, address indexed member, uint256 amount);
    event DefaultCovered(uint256 indexed round, address indexed member, uint256 amount);
    event PayoutExecuted(uint256 indexed round, address indexed recipient, uint256 amount);
    event CircleCompleted(uint256 indexed finalRound);
    event DepositReplenished(address indexed member, uint256 amount);
    event DepositCovered(address indexed payer, address indexed member, uint256 amount);
    event DepositReturned(address indexed member, uint256 amount);

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
    error NothingToCover();

    constructor(
        address asset_,
        address keeperAuthorization_,
        address factory_,
        address creator_,
        uint256 contributionAmount_,
        uint256 depositAmount_,
        uint256 targetMemberCount_,
        uint256 roundDuration_,
        uint256 firstRoundDeadline_,
        address trustedForwarder_
    ) ERC2771Context(trustedForwarder_) {
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
        if (!isMember[_msgSender()]) revert MemberOnly();
        _;
    }

    modifier onlyKeeper() {
        if (!keeperAuthorization.isKeeper(msg.sender)) revert KeeperOnly();
        _;
    }

    function join() external {
        address member = _msgSender();
        if (status != Status.Forming) revert InvalidStatus();
        if (isMember[member]) revert AlreadyMember();
        if (members.length == targetMemberCount) revert CircleFull();

        isMember[member] = true;
        members.push(member);
        securityDepositBalance[member] = depositAmount;
        asset.safeTransferFrom(member, address(this), depositAmount);
        emit MemberJoined(member, members.length, depositAmount);
    }

    /// @notice Exit and reclaim your deposit while the circle is still filling. No lock-in
    /// before rotation order is even set — once `start()` locks it, this is no longer available.
    function leave() external onlyMember {
        address member = _msgSender();
        if (status != Status.Forming) revert InvalidStatus();

        isMember[member] = false;
        uint256 refund = securityDepositBalance[member];
        securityDepositBalance[member] = 0;
        _removeMember(member);
        asset.safeTransfer(member, refund);
        emit MemberLeft(member, refund);
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
        address member = _msgSender();
        if (status != Status.Active) revert InvalidStatus();
        if (block.timestamp >= currentRoundDeadline) revert ContributionWindowClosed();
        if (contributed[currentRound][member]) revert AlreadyContributed();

        contributed[currentRound][member] = true;
        currentRoundFunding += contributionAmount;
        asset.safeTransferFrom(member, address(this), contributionAmount);
        emit ContributionMade(currentRound, member, contributionAmount);
    }

    /// @notice Allows a member to restore their own one-round protection after it was used.
    function replenishDeposit() external onlyMember {
        address member = _msgSender();
        uint256 missing = depositAmount - securityDepositBalance[member];
        if (missing == 0) revert NothingToCover();
        securityDepositBalance[member] = depositAmount;
        asset.safeTransferFrom(member, address(this), missing);
        emit DepositReplenished(member, missing);
    }

    /// @notice Lets any member cover a fellow member's depleted deposit, funded from the
    /// payer's own wallet. Exists so one member missing two rounds in a row (deposit drawn to
    /// zero, then defaulting again with nothing left to draw) doesn't permanently stall every
    /// other member's payouts — without granting any single address unilateral override power.
    function coverDeposit(address member) external onlyMember {
        address payer = _msgSender();
        if (!isMember[member]) revert MemberOnly();
        uint256 missing = depositAmount - securityDepositBalance[member];
        if (missing == 0) revert NothingToCover();
        securityDepositBalance[member] = depositAmount;
        asset.safeTransferFrom(payer, address(this), missing);
        emit DepositCovered(payer, member, missing);
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
            _returnAllDeposits();
            emit CircleCompleted(round);
            return;
        }

        currentRound = round + 1;
        currentRoundDeadline += roundDuration;
    }

    function _removeMember(address member) private {
        uint256 len = members.length;
        for (uint256 i = 0; i < len; i++) {
            if (members[i] == member) {
                members[i] = members[len - 1];
                members.pop();
                return;
            }
        }
    }

    /// @notice Every member's remaining deposit is only ever needed to protect rounds still to
    /// come — once the final payout ships there are none left, so it goes back to its owner.
    function _returnAllDeposits() private {
        uint256 len = members.length;
        for (uint256 i = 0; i < len; i++) {
            address member = members[i];
            uint256 balance = securityDepositBalance[member];
            if (balance == 0) continue;
            securityDepositBalance[member] = 0;
            asset.safeTransfer(member, balance);
            emit DepositReturned(member, balance);
        }
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
