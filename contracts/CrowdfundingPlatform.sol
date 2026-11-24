// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title CrowdfundingPlatform
/// @notice Many independent all-or-nothing crowdfunding campaigns in one contract.
///         Backers can only be refunded if a campaign misses its goal by the
///         deadline (or is cancelled); creators can only withdraw if it hits it.
/// @dev    Funds are never pushed to backers. Every payout is a pull-style call
///         that zeroes state before the external transfer and is nonReentrant.
contract CrowdfundingPlatform {
    // ───────────────────────────── types ─────────────────────────────
    enum Status { Active, Successful, Failed, Cancelled }

    struct Campaign {
        address creator;
        string title;
        string description;
        uint256 goal;       // wei
        uint256 deadline;   // unix seconds
        uint256 raised;     // wei, total ever donated
        bool withdrawn;
        bool cancelled;
    }

    /// @dev Read-only shape returned to the UI, with derived fields filled in.
    struct CampaignView {
        uint256 id;
        address creator;
        string title;
        string description;
        uint256 goal;
        uint256 deadline;
        uint256 raised;
        uint256 percentFunded;
        uint256 backersCount;
        Status status;
        bool withdrawn;
    }

    // ──────────────────────────── constants ──────────────────────────
    uint256 public constant MAX_FEE_BPS = 500; // 5 %
    uint256 public constant MIN_DURATION_DAYS = 1;
    uint256 public constant MAX_DURATION_DAYS = 90;
    uint256 public constant MAX_TITLE_BYTES = 100;
    uint256 public constant MAX_DESCRIPTION_BYTES = 1000;

    // ───────────────────────────── storage ───────────────────────────
    address public owner;
    uint256 public feeBps;
    uint256 public feesAccrued;
    bool public paused;

    uint256 private _lock = 1;
    Campaign[] private _campaigns;
    mapping(uint256 => address[]) private _backers;
    mapping(uint256 => mapping(address => uint256)) private _contributions;

    // ───────────────────────────── events ────────────────────────────
    event CampaignCreated(uint256 indexed id, address indexed creator, string title, uint256 goal, uint256 deadline);
    event DonationReceived(uint256 indexed id, address indexed backer, uint256 amount, uint256 totalRaised);
    event FundsWithdrawn(uint256 indexed id, address indexed creator, uint256 amount, uint256 fee);
    event RefundClaimed(uint256 indexed id, address indexed backer, uint256 amount);
    event CampaignCancelled(uint256 indexed id);
    event FeeUpdated(uint256 oldFeeBps, uint256 newFeeBps);
    event FeesWithdrawn(address indexed to, uint256 amount);
    event PauseChanged(bool paused);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // ───────────────────────────── errors ────────────────────────────
    error NotOwner();
    error NotCreator();
    error PlatformPaused();
    error Reentrancy();
    error CampaignNotFound();
    error EmptyTitle();
    error TitleTooLong();
    error DescriptionTooLong();
    error InvalidGoal();
    error InvalidDuration();
    error ZeroDonation();
    error CreatorCannotDonate();
    error CampaignNotActive();
    error CampaignNotSuccessful();
    error AlreadyWithdrawn();
    error RefundNotAvailable();
    error NothingToRefund();
    error FeeTooHigh();
    error NoFeesToWithdraw();
    error TransferFailed();
    error ZeroAddress();

    // ──────────────────────────── modifiers ──────────────────────────
    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    modifier campaignExists(uint256 id) {
        if (id >= _campaigns.length) revert CampaignNotFound();
        _;
    }

    constructor(uint256 initialFeeBps) {
        if (initialFeeBps > MAX_FEE_BPS) revert FeeTooHigh();
        owner = msg.sender;
        feeBps = initialFeeBps;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    // ───────────────────────── campaign lifecycle ────────────────────
    function createCampaign(
        string calldata title,
        string calldata description,
        uint256 goal,
        uint256 durationDays
    ) external returns (uint256 id) {
        if (paused) revert PlatformPaused();
        uint256 titleLen = bytes(title).length;
        if (titleLen == 0) revert EmptyTitle();
        if (titleLen > MAX_TITLE_BYTES) revert TitleTooLong();
        if (bytes(description).length > MAX_DESCRIPTION_BYTES) revert DescriptionTooLong();
        if (goal == 0) revert InvalidGoal();
        if (durationDays < MIN_DURATION_DAYS || durationDays > MAX_DURATION_DAYS) revert InvalidDuration();

        uint256 deadline = block.timestamp + durationDays * 1 days;
        id = _campaigns.length;
        _campaigns.push(
            Campaign({
                creator: msg.sender,
                title: title,
                description: description,
                goal: goal,
                deadline: deadline,
                raised: 0,
                withdrawn: false,
                cancelled: false
            })
        );
        emit CampaignCreated(id, msg.sender, title, goal, deadline);
    }

    function donate(uint256 id) external payable nonReentrant campaignExists(id) {
        if (paused) revert PlatformPaused();
        if (msg.value == 0) revert ZeroDonation();
        Campaign storage c = _campaigns[id];
        if (msg.sender == c.creator) revert CreatorCannotDonate();
        if (_status(c) != Status.Active) revert CampaignNotActive();

        if (_contributions[id][msg.sender] == 0) {
            _backers[id].push(msg.sender);
        }
        _contributions[id][msg.sender] += msg.value;
        c.raised += msg.value;
        emit DonationReceived(id, msg.sender, msg.value, c.raised);
    }

    /// @notice Creator collects the funds of a campaign that reached its goal.
    function withdrawFunds(uint256 id) external nonReentrant campaignExists(id) {
        Campaign storage c = _campaigns[id];
        if (msg.sender != c.creator) revert NotCreator();
        if (c.withdrawn) revert AlreadyWithdrawn();
        if (_status(c) != Status.Successful) revert CampaignNotSuccessful();

        c.withdrawn = true;
        uint256 fee = (c.raised * feeBps) / 10_000;
        uint256 payout = c.raised - fee;
        feesAccrued += fee;

        _send(msg.sender, payout);
        emit FundsWithdrawn(id, msg.sender, payout, fee);
    }

    /// @notice Backer takes their money back from a failed or cancelled campaign.
    function claimRefund(uint256 id) external nonReentrant campaignExists(id) {
        Status s = _status(_campaigns[id]);
        if (s != Status.Failed && s != Status.Cancelled) revert RefundNotAvailable();

        uint256 amount = _contributions[id][msg.sender];
        if (amount == 0) revert NothingToRefund();

        _contributions[id][msg.sender] = 0; // effects before interaction
        _send(msg.sender, amount);
        emit RefundClaimed(id, msg.sender, amount);
    }

    /// @notice Creator may call a campaign off while it is still running; backers can then refund.
    function cancelCampaign(uint256 id) external campaignExists(id) {
        Campaign storage c = _campaigns[id];
        if (msg.sender != c.creator) revert NotCreator();
        if (_status(c) != Status.Active) revert CampaignNotActive();
        c.cancelled = true;
        emit CampaignCancelled(id);
    }

    // ──────────────────────────── admin ──────────────────────────────
    function setFeeBps(uint256 newFeeBps) external onlyOwner {
        if (newFeeBps > MAX_FEE_BPS) revert FeeTooHigh();
        emit FeeUpdated(feeBps, newFeeBps);
        feeBps = newFeeBps;
    }

    function withdrawFees() external onlyOwner nonReentrant {
        uint256 amount = feesAccrued;
        if (amount == 0) revert NoFeesToWithdraw();
        feesAccrued = 0;
        _send(owner, amount);
        emit FeesWithdrawn(owner, amount);
    }

    /// @dev Pausing only stops new campaigns and new donations. Refunds and
    ///      withdrawals stay open so nobody's money can be trapped.
    function setPaused(bool value) external onlyOwner {
        paused = value;
        emit PauseChanged(value);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    // ───────────────────────────── views ─────────────────────────────
    function campaignCount() external view returns (uint256) {
        return _campaigns.length;
    }

    function getCampaign(uint256 id) external view campaignExists(id) returns (CampaignView memory) {
        return _view(id);
    }

    /// @notice Paginated list so the UI never has to loop over the whole array on-chain.
    function getCampaigns(uint256 offset, uint256 limit) external view returns (CampaignView[] memory list) {
        uint256 total = _campaigns.length;
        if (offset >= total) return new CampaignView[](0);
        uint256 end = offset + limit;
        if (end > total) end = total;
        list = new CampaignView[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            list[i - offset] = _view(i);
        }
    }

    function getBackers(uint256 id) external view campaignExists(id) returns (address[] memory) {
        return _backers[id];
    }

    function getBackerDetails(uint256 id)
        external
        view
        campaignExists(id)
        returns (address[] memory addrs, uint256[] memory amounts)
    {
        addrs = _backers[id];
        amounts = new uint256[](addrs.length);
        for (uint256 i = 0; i < addrs.length; i++) {
            amounts[i] = _contributions[id][addrs[i]];
        }
    }

    function contributionOf(uint256 id, address backer) external view campaignExists(id) returns (uint256) {
        return _contributions[id][backer];
    }

    // ──────────────────────────── internals ──────────────────────────
    function _status(Campaign storage c) private view returns (Status) {
        if (c.cancelled) return Status.Cancelled;
        if (block.timestamp < c.deadline) return Status.Active;
        return c.raised >= c.goal ? Status.Successful : Status.Failed;
    }

    function _view(uint256 id) private view returns (CampaignView memory v) {
        Campaign storage c = _campaigns[id];
        v.id = id;
        v.creator = c.creator;
        v.title = c.title;
        v.description = c.description;
        v.goal = c.goal;
        v.deadline = c.deadline;
        v.raised = c.raised;
        v.percentFunded = (c.raised * 100) / c.goal;
        v.backersCount = _backers[id].length;
        v.status = _status(c);
        v.withdrawn = c.withdrawn;
    }

    function _send(address to, uint256 amount) private {
        (bool ok, ) = payable(to).call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
