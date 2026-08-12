// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IKeeperAuthorization} from "./interfaces/IKeeperAuthorization.sol";
import {ICircleFactoryRegistry} from "./interfaces/ICircleFactoryRegistry.sol";

/// @notice One immutable rotating-savings circle. The member order is join order and locks at start.
/// @dev ERC2771Context lets a trusted relayer submit member actions on a signer's behalf so gas
/// isn't a blocker for wallets that aren't sponsored by a smart-account paymaster. checkAndCoverDefault
/// and executePayout deliberately keep raw msg.sender (via onlyKeeperOrAfterGrace) — relayed calls can
/// never pass as an authorized keeper, since the forwarder itself is never granted keeper status. Both
/// also become callable by anyone once KEEPER_GRACE_PERIOD elapses past the round deadline, so a
/// stalled or revoked keeper can never block a round indefinitely.
contract AjoCircle is ERC2771Context, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status { Forming, Active, Completed, Cancelled }

    IERC20 public immutable asset;
    IKeeperAuthorization public immutable keeperAuthorization;
    ICircleFactoryRegistry public immutable factory;
    address public immutable creator;
    uint256 public immutable contributionAmount;
    uint256 public immutable depositAmount;
    uint256 public immutable targetMemberCount;
    uint256 public immutable roundDuration;
    uint256 public immutable firstRoundDeadline;
    uint256 public immutable formingDeadline;

    /// @dev How long after a round's deadline the authorized keeper has exclusive first-mover
    /// rights on checkAndCoverDefault/executePayout before anyone becomes able to trigger the
    /// same, already-eligible action themselves. Disclosed, deliberate choice — one day is short
    /// enough that a stalled or revoked keeper never blocks a round for long, and long enough that
    /// it's not a race against the keeper's own ~2-minute schedule under normal operation. This is
    /// what makes "not even us can interfere" true for payout *timing*, not just rotation order:
    /// the eligibility check itself (funding complete, deadline passed) never changes — only who
    /// is allowed to submit the call once the grace window has elapsed.
    uint256 public constant KEEPER_GRACE_PERIOD = 1 days;

    Status public status;
    uint256 public currentRound;
    uint256 public currentRoundDeadline;
    uint256 public currentRoundFunding;

    address[] private members;
    mapping(address => bool) public isMember;
    mapping(address => uint256) public securityDepositBalance;
    /// @dev Who gets a member's deposit balance back. Defaults to the member themselves; becomes
    /// the rescuer's address when coverDeposit() fully tops the balance back up on their behalf,
    /// since replenishDeposit()/coverDeposit() always restore the full missing amount in one call
    /// (no partial top-ups), so exactly one address is ever owed the resulting balance at a time.
    mapping(address => address) public depositOwner;
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
    event CircleCancelled();
    event DefaultUncovered(uint256 indexed round, address indexed member);

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
    error NothingToCover();
    error NothingToWithdraw();
    error NotDepositOwner();

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
        uint256 formingDeadline_,
        address trustedForwarder_
    ) ERC2771Context(trustedForwarder_) {
        // Deposit floor is 2x contributionAmount, not the 1x "one-round deposit" the build spec's
        // prose describes — spec section 10 flagged the exact deposit size as an open question
        // that should be decided explicitly rather than invented, and this is that decision: 2x
        // survives two consecutive missed rounds instead of one before a member's protection runs
        // out, which the frontend's create-circle flow discloses to every creator up front
        // ("posts a security deposit worth two contributions"). Kept as-is rather than silently
        // changed, since it's a disclosed product choice, not a hidden defect.
        if (
            asset_ == address(0) || keeperAuthorization_ == address(0) || factory_ == address(0) || creator_ == address(0) || contributionAmount_ == 0 ||
            depositAmount_ < 2 * contributionAmount_ || targetMemberCount_ < 2 || roundDuration_ == 0 ||
            firstRoundDeadline_ <= block.timestamp || formingDeadline_ <= block.timestamp
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
        formingDeadline = formingDeadline_;
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

    /// @dev Same authorization boundary as onlyKeeper, except after `deadline + KEEPER_GRACE_PERIOD`
    /// any caller passes too. Deliberately still checks raw msg.sender for the keeper branch, same
    /// as onlyKeeper — a relayed meta-transaction can never pass as the keeper here either.
    modifier onlyKeeperOrAfterGrace(uint256 deadline) {
        if (!keeperAuthorization.isKeeper(msg.sender) && block.timestamp < deadline + KEEPER_GRACE_PERIOD) {
            revert KeeperOnly();
        }
        _;
    }

    function join() external nonReentrant {
        address member = _msgSender();
        if (status != Status.Forming) revert InvalidStatus();
        if (isMember[member]) revert AlreadyMember();
        if (members.length == targetMemberCount) revert CircleFull();

        isMember[member] = true;
        members.push(member);
        securityDepositBalance[member] = depositAmount;
        depositOwner[member] = member;
        asset.safeTransferFrom(member, address(this), depositAmount);
        emit MemberJoined(member, members.length, depositAmount);
    }

    /// @notice Exit and reclaim your deposit while the circle is still filling. No lock-in
    /// before rotation order is even set — once `start()` locks it, this is no longer available.
    function leave() external onlyMember nonReentrant {
        address member = _msgSender();
        if (status != Status.Forming) revert InvalidStatus();

        isMember[member] = false;
        uint256 refund = securityDepositBalance[member];
        securityDepositBalance[member] = 0;
        _removeMember(member);
        asset.safeTransfer(member, refund);
        emit MemberLeft(member, refund);
    }

    /// @notice Anyone may cancel a circle stuck Forming past its forming deadline — a fallback
    /// for abandoned circles whose creator vanishes and remaining members never individually
    /// call leave() themselves. Same "anyone may call it" model as start(): no admin role created.
    function cancelIfExpired() external {
        if (status != Status.Forming) revert InvalidStatus();
        if (block.timestamp < formingDeadline) revert DeadlineNotReached();
        status = Status.Cancelled;
        factory.onCircleStatusChanged(uint8(status));
        emit CircleCancelled();
    }

    /// @notice Pull-pattern refund after cancellation or completion — whoever owns a member's
    /// deposit balance (see depositOwner: normally the member, or a rescuer who last covered a
    /// default for them) withdraws it themselves. Callable per-slot rather than looping over all
    /// members in one transaction, so a single blocked/reverting recipient can never hold up
    /// anyone else's refund, or — at completion — the payout itself.
    function withdrawDeposit(address member) external nonReentrant {
        if (status != Status.Cancelled && status != Status.Completed) revert InvalidStatus();
        if (depositOwner[member] != _msgSender()) revert NotDepositOwner();
        uint256 amount = securityDepositBalance[member];
        if (amount == 0) revert NothingToWithdraw();
        securityDepositBalance[member] = 0;
        asset.safeTransfer(_msgSender(), amount);
        emit DepositReturned(member, amount);
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

    function contribute() external onlyMember nonReentrant {
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
    /// Reclaims deposit ownership for themselves, even if a rescuer had most recently funded it.
    function replenishDeposit() external onlyMember nonReentrant {
        address member = _msgSender();
        if (status != Status.Active) revert InvalidStatus();
        uint256 missing = depositAmount - securityDepositBalance[member];
        if (missing == 0) revert NothingToCover();
        securityDepositBalance[member] = depositAmount;
        depositOwner[member] = member;
        asset.safeTransferFrom(member, address(this), missing);
        emit DepositReplenished(member, missing);
    }

    /// @notice Lets any member cover a fellow member's depleted deposit, funded from the
    /// payer's own wallet. Exists so one member missing two rounds in a row (deposit drawn to
    /// zero, then defaulting again with nothing left to draw) doesn't permanently stall every
    /// other member's payouts — without granting any single address unilateral override power.
    /// The payer becomes the owner of that deposit balance (see depositOwner) and reclaims it
    /// via withdrawDeposit() once the circle finishes if it's never drawn down again — they are
    /// never left permanently out of pocket for rescuing another member's protection.
    function coverDeposit(address member) external onlyMember nonReentrant {
        address payer = _msgSender();
        if (status != Status.Active) revert InvalidStatus();
        if (!isMember[member]) revert MemberOnly();
        uint256 missing = depositAmount - securityDepositBalance[member];
        if (missing == 0) revert NothingToCover();
        securityDepositBalance[member] = depositAmount;
        depositOwner[member] = payer;
        asset.safeTransferFrom(payer, address(this), missing);
        emit DepositCovered(payer, member, missing);
    }

    function checkAndCoverDefault(uint256 round, address member) external onlyKeeperOrAfterGrace(currentRoundDeadline) {
        if (status != Status.Active || round != currentRound || !isMember[member]) revert InvalidStatus();
        if (block.timestamp < currentRoundDeadline) revert DeadlineNotReached();
        if (contributed[round][member]) return;
        if (defaultCovered[round][member]) revert DefaultAlreadyCovered();
        if (securityDepositBalance[member] < contributionAmount) {
            emit DefaultUncovered(round, member);
            return;
        }

        defaultCovered[round][member] = true;
        securityDepositBalance[member] -= contributionAmount;
        currentRoundFunding += contributionAmount;
        emit DefaultCovered(round, member, contributionAmount);
    }

    function executePayout(uint256 round) external onlyKeeperOrAfterGrace(currentRoundDeadline) nonReentrant {
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
