const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

const DAY = 24 * 60 * 60;
const eth = (v) => ethers.parseEther(String(v));
const Status = { Active: 0n, Successful: 1n, Failed: 2n, Cancelled: 3n };
const FEE_BPS = 250; // 2.5 %

async function deployFixture() {
  const [owner, creator, alice, bob, carol] = await ethers.getSigners();
  const Platform = await ethers.getContractFactory("CrowdfundingPlatform");
  const platform = await Platform.deploy(FEE_BPS);
  await platform.waitForDeployment();
  return { Platform, platform, owner, creator, alice, bob, carol };
}

// Campaign #0: goal 10 ETH, 30 days, created by `creator`.
async function campaignFixture() {
  const ctx = await deployFixture();
  await ctx.platform
    .connect(ctx.creator)
    .createCampaign("Solar Library", "Solar panels for the village library", eth(10), 30);
  return ctx;
}

describe("CrowdfundingPlatform", () => {
  describe("deployment", () => {
    it("sets the deployer as owner and stores the fee", async () => {
      const { platform, owner } = await loadFixture(deployFixture);
      expect(await platform.owner()).to.equal(owner.address);
      expect(await platform.feeBps()).to.equal(FEE_BPS);
    });

    it("starts with no campaigns", async () => {
      const { platform } = await loadFixture(deployFixture);
      expect(await platform.campaignCount()).to.equal(0);
    });

    it("rejects a fee above the 5% cap at deploy time", async () => {
      const { Platform } = await loadFixture(deployFixture);
      await expect(Platform.deploy(501)).to.be.revertedWithCustomError(Platform, "FeeTooHigh");
    });

    it("does not accept plain ETH transfers", async () => {
      const { platform, alice } = await loadFixture(deployFixture);
      await expect(alice.sendTransaction({ to: platform.target, value: 1 })).to.be.reverted;
    });
  });

  describe("campaign creation", () => {
    it("creates a campaign and emits CampaignCreated", async () => {
      const { platform, creator } = await loadFixture(deployFixture);
      await expect(platform.connect(creator).createCampaign("T", "D", eth(1), 30))
        .to.emit(platform, "CampaignCreated")
        .withArgs(0, creator.address, "T", eth(1), anyValue);
      expect(await platform.campaignCount()).to.equal(1);
    });

    it("stores all fields correctly", async () => {
      const { platform, creator } = await loadFixture(campaignFixture);
      const c = await platform.getCampaign(0);
      expect(c.creator).to.equal(creator.address);
      expect(c.title).to.equal("Solar Library");
      expect(c.goal).to.equal(eth(10));
      expect(c.raised).to.equal(0);
      expect(c.backersCount).to.equal(0);
      expect(c.status).to.equal(Status.Active);
      expect(c.deadline).to.be.gt(await time.latest());
    });

    it("rejects an empty title", async () => {
      const { platform, creator } = await loadFixture(deployFixture);
      await expect(platform.connect(creator).createCampaign("", "D", eth(1), 30)).to.be.revertedWithCustomError(
        platform,
        "EmptyTitle"
      );
    });

    it("rejects an over-long title", async () => {
      const { platform, creator } = await loadFixture(deployFixture);
      await expect(
        platform.connect(creator).createCampaign("x".repeat(101), "D", eth(1), 30)
      ).to.be.revertedWithCustomError(platform, "TitleTooLong");
    });

    it("rejects a zero goal", async () => {
      const { platform, creator } = await loadFixture(deployFixture);
      await expect(platform.connect(creator).createCampaign("T", "D", 0, 30)).to.be.revertedWithCustomError(
        platform,
        "InvalidGoal"
      );
    });

    it("rejects durations outside 1-90 days", async () => {
      const { platform, creator } = await loadFixture(deployFixture);
      await expect(platform.connect(creator).createCampaign("T", "D", eth(1), 0)).to.be.revertedWithCustomError(
        platform,
        "InvalidDuration"
      );
      await expect(platform.connect(creator).createCampaign("T", "D", eth(1), 91)).to.be.revertedWithCustomError(
        platform,
        "InvalidDuration"
      );
    });
  });

  describe("donations", () => {
    it("records a donation and emits DonationReceived", async () => {
      const { platform, alice } = await loadFixture(campaignFixture);
      await expect(platform.connect(alice).donate(0, { value: eth(1) }))
        .to.emit(platform, "DonationReceived")
        .withArgs(0, alice.address, eth(1), eth(1));
      expect(await platform.contributionOf(0, alice.address)).to.equal(eth(1));
      expect((await platform.getCampaign(0)).raised).to.equal(eth(1));
    });

    it("accumulates repeat donations without duplicating the backer", async () => {
      const { platform, alice, bob } = await loadFixture(campaignFixture);
      await platform.connect(alice).donate(0, { value: eth(1) });
      await platform.connect(alice).donate(0, { value: eth(2) });
      await platform.connect(bob).donate(0, { value: eth(1) });
      expect(await platform.contributionOf(0, alice.address)).to.equal(eth(3));
      expect((await platform.getCampaign(0)).backersCount).to.equal(2);
    });

    it("rejects a zero-value donation", async () => {
      const { platform, alice } = await loadFixture(campaignFixture);
      await expect(platform.connect(alice).donate(0, { value: 0 })).to.be.revertedWithCustomError(
        platform,
        "ZeroDonation"
      );
    });

    it("blocks the creator from donating to their own campaign", async () => {
      const { platform, creator } = await loadFixture(campaignFixture);
      await expect(platform.connect(creator).donate(0, { value: eth(1) })).to.be.revertedWithCustomError(
        platform,
        "CreatorCannotDonate"
      );
    });

    it("rejects donations after the deadline", async () => {
      const { platform, alice } = await loadFixture(campaignFixture);
      await time.increase(31 * DAY);
      await expect(platform.connect(alice).donate(0, { value: eth(1) })).to.be.revertedWithCustomError(
        platform,
        "CampaignNotActive"
      );
    });

    it("rejects donations to a campaign that does not exist", async () => {
      const { platform, alice } = await loadFixture(campaignFixture);
      await expect(platform.connect(alice).donate(99, { value: eth(1) })).to.be.revertedWithCustomError(
        platform,
        "CampaignNotFound"
      );
    });

    it("rejects donations while the platform is paused", async () => {
      const { platform, alice } = await loadFixture(campaignFixture);
      await platform.setPaused(true);
      await expect(platform.connect(alice).donate(0, { value: eth(1) })).to.be.revertedWithCustomError(
        platform,
        "PlatformPaused"
      );
    });

    it("rejects donations to a cancelled campaign", async () => {
      const { platform, creator, alice } = await loadFixture(campaignFixture);
      await platform.connect(creator).cancelCampaign(0);
      await expect(platform.connect(alice).donate(0, { value: eth(1) })).to.be.revertedWithCustomError(
        platform,
        "CampaignNotActive"
      );
    });
  });

  describe("funding progress and backers", () => {
    it("reports percentFunded", async () => {
      const { platform, alice } = await loadFixture(campaignFixture);
      await platform.connect(alice).donate(0, { value: eth(5) });
      expect((await platform.getCampaign(0)).percentFunded).to.equal(50);
    });

    it("can report more than 100% when over-funded", async () => {
      const { platform, alice } = await loadFixture(campaignFixture);
      await platform.connect(alice).donate(0, { value: eth(15) });
      expect((await platform.getCampaign(0)).percentFunded).to.equal(150);
    });

    it("lists backers with their amounts", async () => {
      const { platform, alice, bob } = await loadFixture(campaignFixture);
      await platform.connect(alice).donate(0, { value: eth(1) });
      await platform.connect(bob).donate(0, { value: eth(2) });
      const [addrs, amounts] = await platform.getBackerDetails(0);
      expect([...addrs]).to.deep.equal([alice.address, bob.address]);
      expect([...amounts]).to.deep.equal([eth(1), eth(2)]);
      expect([...(await platform.getBackers(0))]).to.deep.equal([alice.address, bob.address]);
    });

    it("paginates getCampaigns", async () => {
      const { platform, creator } = await loadFixture(campaignFixture);
      await platform.connect(creator).createCampaign("Second", "D", eth(1), 5);
      expect((await platform.getCampaigns(0, 1)).length).to.equal(1);
      expect((await platform.getCampaigns(1, 5)).length).to.equal(1);
      expect((await platform.getCampaigns(0, 100)).length).to.equal(2);
      expect((await platform.getCampaigns(5, 5)).length).to.equal(0);
    });
  });

  describe("campaign status", () => {
    it("is Active before the deadline", async () => {
      const { platform } = await loadFixture(campaignFixture);
      expect((await platform.getCampaign(0)).status).to.equal(Status.Active);
    });

    it("is Successful after the deadline when the goal was met", async () => {
      const { platform, alice } = await loadFixture(campaignFixture);
      await platform.connect(alice).donate(0, { value: eth(10) });
      await time.increase(31 * DAY);
      expect((await platform.getCampaign(0)).status).to.equal(Status.Successful);
    });

    it("is Failed after the deadline when the goal was missed", async () => {
      const { platform, alice } = await loadFixture(campaignFixture);
      await platform.connect(alice).donate(0, { value: eth(9) });
      await time.increase(31 * DAY);
      expect((await platform.getCampaign(0)).status).to.equal(Status.Failed);
    });
  });

  describe("withdrawing funds", () => {
    async function successful() {
      const ctx = await loadFixture(campaignFixture);
      await ctx.platform.connect(ctx.alice).donate(0, { value: eth(6) });
      await ctx.platform.connect(ctx.bob).donate(0, { value: eth(4) });
      await time.increase(31 * DAY);
      return ctx;
    }

    it("pays the creator raised funds minus the platform fee", async () => {
      const { platform, creator } = await successful();
      await expect(platform.connect(creator).withdrawFunds(0)).to.changeEtherBalances(
        [creator, platform],
        [eth("9.75"), -eth("9.75")]
      );
      expect(await platform.feesAccrued()).to.equal(eth("0.25"));
    });

    it("emits FundsWithdrawn", async () => {
      const { platform, creator } = await successful();
      await expect(platform.connect(creator).withdrawFunds(0))
        .to.emit(platform, "FundsWithdrawn")
        .withArgs(0, creator.address, eth("9.75"), eth("0.25"));
    });

    it("rejects anyone but the creator", async () => {
      const { platform, alice } = await successful();
      await expect(platform.connect(alice).withdrawFunds(0)).to.be.revertedWithCustomError(platform, "NotCreator");
    });

    it("rejects withdrawal before the deadline", async () => {
      const { platform, creator, alice } = await loadFixture(campaignFixture);
      await platform.connect(alice).donate(0, { value: eth(10) });
      await expect(platform.connect(creator).withdrawFunds(0)).to.be.revertedWithCustomError(
        platform,
        "CampaignNotSuccessful"
      );
    });

    it("rejects withdrawal when the goal was missed", async () => {
      const { platform, creator, alice } = await loadFixture(campaignFixture);
      await platform.connect(alice).donate(0, { value: eth(1) });
      await time.increase(31 * DAY);
      await expect(platform.connect(creator).withdrawFunds(0)).to.be.revertedWithCustomError(
        platform,
        "CampaignNotSuccessful"
      );
    });

    it("rejects a second withdrawal", async () => {
      const { platform, creator } = await successful();
      await platform.connect(creator).withdrawFunds(0);
      await expect(platform.connect(creator).withdrawFunds(0)).to.be.revertedWithCustomError(
        platform,
        "AlreadyWithdrawn"
      );
    });

    it("keeps only the accrued fee in the contract afterwards", async () => {
      const { platform, creator } = await successful();
      await platform.connect(creator).withdrawFunds(0);
      expect(await ethers.provider.getBalance(platform.target)).to.equal(await platform.feesAccrued());
    });
  });

  describe("refunds", () => {
    async function failed() {
      const ctx = await loadFixture(campaignFixture);
      await ctx.platform.connect(ctx.alice).donate(0, { value: eth(1) });
      await ctx.platform.connect(ctx.bob).donate(0, { value: eth(2) });
      await time.increase(31 * DAY);
      return ctx;
    }

    it("refunds a backer when the target is missed by the deadline", async () => {
      const { platform, alice, bob } = await failed();
      await expect(platform.connect(alice).claimRefund(0)).to.changeEtherBalance(alice, eth(1));
      await expect(platform.connect(bob).claimRefund(0)).to.changeEtherBalance(bob, eth(2));
      expect(await ethers.provider.getBalance(platform.target)).to.equal(0);
    });

    it("emits RefundClaimed, zeroes the contribution and blocks a second claim", async () => {
      const { platform, alice } = await failed();
      await expect(platform.connect(alice).claimRefund(0))
        .to.emit(platform, "RefundClaimed")
        .withArgs(0, alice.address, eth(1));
      expect(await platform.contributionOf(0, alice.address)).to.equal(0);
      await expect(platform.connect(alice).claimRefund(0)).to.be.revertedWithCustomError(platform, "NothingToRefund");
    });

    it("rejects a refund while the campaign is still active", async () => {
      const { platform, alice } = await loadFixture(campaignFixture);
      await platform.connect(alice).donate(0, { value: eth(1) });
      await expect(platform.connect(alice).claimRefund(0)).to.be.revertedWithCustomError(
        platform,
        "RefundNotAvailable"
      );
    });

    it("rejects a refund on a successful campaign", async () => {
      const { platform, alice } = await loadFixture(campaignFixture);
      await platform.connect(alice).donate(0, { value: eth(10) });
      await time.increase(31 * DAY);
      await expect(platform.connect(alice).claimRefund(0)).to.be.revertedWithCustomError(
        platform,
        "RefundNotAvailable"
      );
    });

    it("rejects a refund for someone who never donated", async () => {
      const { platform, carol } = await failed();
      await expect(platform.connect(carol).claimRefund(0)).to.be.revertedWithCustomError(platform, "NothingToRefund");
    });

    it("refunds immediately after the creator cancels", async () => {
      const { platform, creator, alice } = await loadFixture(campaignFixture);
      await platform.connect(alice).donate(0, { value: eth(3) });
      await platform.connect(creator).cancelCampaign(0);
      await expect(platform.connect(alice).claimRefund(0)).to.changeEtherBalance(alice, eth(3));
    });

    it("still allows refunds while the platform is paused", async () => {
      const { platform, alice } = await failed();
      await platform.setPaused(true);
      await expect(platform.connect(alice).claimRefund(0)).to.changeEtherBalance(alice, eth(1));
    });
  });

  describe("cancelling", () => {
    it("lets the creator cancel an active campaign", async () => {
      const { platform, creator } = await loadFixture(campaignFixture);
      await expect(platform.connect(creator).cancelCampaign(0)).to.emit(platform, "CampaignCancelled").withArgs(0);
      expect((await platform.getCampaign(0)).status).to.equal(Status.Cancelled);
    });

    it("rejects cancellation by anyone else", async () => {
      const { platform, alice } = await loadFixture(campaignFixture);
      await expect(platform.connect(alice).cancelCampaign(0)).to.be.revertedWithCustomError(platform, "NotCreator");
    });

    it("rejects cancellation after the deadline", async () => {
      const { platform, creator } = await loadFixture(campaignFixture);
      await time.increase(31 * DAY);
      await expect(platform.connect(creator).cancelCampaign(0)).to.be.revertedWithCustomError(
        platform,
        "CampaignNotActive"
      );
    });
  });

  describe("administration", () => {
    it("lets the owner change the fee and emits FeeUpdated", async () => {
      const { platform } = await loadFixture(deployFixture);
      await expect(platform.setFeeBps(100)).to.emit(platform, "FeeUpdated").withArgs(FEE_BPS, 100);
      expect(await platform.feeBps()).to.equal(100);
    });

    it("rejects a fee above the cap", async () => {
      const { platform } = await loadFixture(deployFixture);
      await expect(platform.setFeeBps(501)).to.be.revertedWithCustomError(platform, "FeeTooHigh");
    });

    it("rejects admin calls from non-owners", async () => {
      const { platform, alice } = await loadFixture(deployFixture);
      await expect(platform.connect(alice).setFeeBps(1)).to.be.revertedWithCustomError(platform, "NotOwner");
      await expect(platform.connect(alice).setPaused(true)).to.be.revertedWithCustomError(platform, "NotOwner");
      await expect(platform.connect(alice).withdrawFees()).to.be.revertedWithCustomError(platform, "NotOwner");
    });

    it("lets the owner withdraw accrued fees", async () => {
      const { platform, owner, creator, alice } = await loadFixture(campaignFixture);
      await platform.connect(alice).donate(0, { value: eth(10) });
      await time.increase(31 * DAY);
      await platform.connect(creator).withdrawFunds(0);
      await expect(platform.withdrawFees()).to.changeEtherBalance(owner, eth("0.25"));
      expect(await platform.feesAccrued()).to.equal(0);
    });

    it("reverts when there are no fees to withdraw", async () => {
      const { platform } = await loadFixture(deployFixture);
      await expect(platform.withdrawFees()).to.be.revertedWithCustomError(platform, "NoFeesToWithdraw");
    });

    it("pauses and unpauses campaign creation", async () => {
      const { platform, creator } = await loadFixture(deployFixture);
      await platform.setPaused(true);
      await expect(platform.connect(creator).createCampaign("T", "D", eth(1), 5)).to.be.revertedWithCustomError(
        platform,
        "PlatformPaused"
      );
      await platform.setPaused(false);
      await expect(platform.connect(creator).createCampaign("T", "D", eth(1), 5)).to.not.be.reverted;
    });

    it("transfers ownership and rejects the zero address", async () => {
      const { platform, alice } = await loadFixture(deployFixture);
      await expect(platform.transferOwnership(ethers.ZeroAddress)).to.be.revertedWithCustomError(
        platform,
        "ZeroAddress"
      );
      await platform.transferOwnership(alice.address);
      expect(await platform.owner()).to.equal(alice.address);
    });
  });

  describe("security", () => {
    it("blocks re-entrancy during a refund", async () => {
      const { platform, alice } = await loadFixture(campaignFixture);
      const Attacker = await ethers.getContractFactory("ReentrancyAttacker");
      const attacker = await Attacker.deploy(platform.target);

      await attacker.attack(0, { value: eth(1) });
      await platform.connect(alice).donate(0, { value: eth(2) });
      await time.increase(31 * DAY);

      await expect(attacker.pull()).to.changeEtherBalance(attacker, eth(1));
      expect(await attacker.reentryAttempts()).to.equal(1);
      expect(await attacker.reentryBlocked()).to.equal(true);
      // The honest backer's money is untouched.
      expect(await platform.contributionOf(0, alice.address)).to.equal(eth(2));
      expect(await ethers.provider.getBalance(platform.target)).to.equal(eth(2));
    });
  });
});
