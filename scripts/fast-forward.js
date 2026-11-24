// Moves the local chain clock forward so you can watch deadlines pass.
// Usage: DAYS=31 npm run forward
const { network } = require("hardhat");

async function main() {
  const days = Number(process.env.DAYS || 31);
  await network.provider.send("evm_increaseTime", [days * 24 * 60 * 60]);
  await network.provider.send("evm_mine");
  console.log(`Chain time advanced by ${days} day(s).`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
