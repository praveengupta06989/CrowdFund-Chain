// Deploys CrowdfundingPlatform and publishes address + ABI for the web frontend.
// Optional demo data: SEED=true
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

const outDir = process.env.DEPLOY_OUT_DIR || path.join(__dirname, "..", "frontend", "deployed");

async function seedDemoData(platform, signers) {
  const [, alice, bruno, clara, dev, eli] = signers;
  const eth = hre.ethers.parseEther;

  await platform.connect(alice).createCampaign(
    "Community Solar Library",
    "Rooftop solar panels so the Riverside branch library can stay open after dark and run its free coding evenings.",
    eth("5"), 30
  );
  await platform.connect(bruno).createCampaign(
    "Open-Source Braille Printer",
    "A low-cost embosser for schools. Hardware designs and firmware will be published under a permissive licence.",
    eth("3"), 14
  );
  await platform.connect(alice).createCampaign(
    "Riverside Clean-up Drive",
    "Gloves, bags and a skip hire for the spring clean-up of the riverbank.",
    eth("1"), 7
  );

  await platform.connect(clara).donate(0, { value: eth("2") });
  await platform.connect(dev).donate(0, { value: eth("1.5") });
  await platform.connect(clara).donate(1, { value: eth("2") });
  await platform.connect(eli).donate(1, { value: eth("1") });
  await platform.connect(dev).donate(2, { value: eth("0.25") });
  console.log("Seeded 3 demo campaigns");
}

async function main() {
  const { ethers } = hre;
  const signers = await ethers.getSigners();
  const feeBps = Number(process.env.PLATFORM_FEE_BPS || 250);

  const Platform = await ethers.getContractFactory("CrowdfundingPlatform");
  const platform = await Platform.deploy(feeBps);
  await platform.waitForDeployment();
  const address = await platform.getAddress();
  const network = await ethers.provider.getNetwork();
  console.log(`CrowdfundingPlatform deployed to ${address} (chain ${network.chainId}, fee ${feeBps} bps)`);

  const artifact = await hre.artifacts.readArtifact("CrowdfundingPlatform");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, "config.json"),
    JSON.stringify(
      {
        address,
        abi: artifact.abi,
        chainId: Number(network.chainId),
        chainName: Number(network.chainId) === 31337 ? "Hardhat Local" : network.name,
        rpcUrl: process.env.PUBLIC_RPC_URL || "http://127.0.0.1:8545",
      },
      null,
      2
    )
  );
  console.log(`Frontend config written to ${path.join(outDir, "config.json")}`);

  if (process.env.SEED === "true" && signers.length >= 6) {
    await seedDemoData(platform, signers);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
