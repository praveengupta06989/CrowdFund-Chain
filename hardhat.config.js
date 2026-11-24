require("dotenv").config();
require("@nomicfoundation/hardhat-toolbox");

const { SEPOLIA_RPC_URL, PRIVATE_KEY, ETHERSCAN_API_KEY, RPC_URL, REPORT_GAS } = process.env;

const networks = {
  hardhat: { chainId: 31337 },
  // Inside docker-compose the chain lives in the "node" container.
  docker: { url: RPC_URL || "http://node:8545", chainId: 31337 },
};

// Public testnet is opt-in: only registered when both values are present.
if (SEPOLIA_RPC_URL && PRIVATE_KEY) {
  networks.sepolia = { url: SEPOLIA_RPC_URL, accounts: [PRIVATE_KEY], chainId: 11155111 };
}

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "paris" },
  },
  networks,
  gasReporter: { enabled: REPORT_GAS === "true", currency: "USD" },
  etherscan: { apiKey: ETHERSCAN_API_KEY || "" },
  paths: { sources: "./contracts", tests: "./test" },
};
