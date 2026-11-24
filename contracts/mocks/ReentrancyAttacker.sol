// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface ICrowdfunding {
    function donate(uint256 id) external payable;
    function claimRefund(uint256 id) external;
}

/// @dev Test-only. Tries to re-enter claimRefund from its receive() hook.
contract ReentrancyAttacker {
    ICrowdfunding public immutable target;
    uint256 public campaignId;
    uint256 public reentryAttempts;
    bool public reentryBlocked;

    constructor(address platform) {
        target = ICrowdfunding(platform);
    }

    function attack(uint256 id) external payable {
        campaignId = id;
        target.donate{value: msg.value}(id);
    }

    function pull() external {
        target.claimRefund(campaignId);
    }

    receive() external payable {
        reentryAttempts++;
        try target.claimRefund(campaignId) {} catch {
            reentryBlocked = true;
        }
    }
}
