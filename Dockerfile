# Image for the local blockchain, the deploy job and the test runner.
FROM node:20-slim
WORKDIR /app

COPY package.json ./
RUN npm install --no-audit --no-fund

COPY hardhat.config.js ./
COPY contracts ./contracts
COPY scripts ./scripts
COPY test ./test

# Compile at build time so the Solidity compiler is cached in the image.
RUN npx hardhat compile

EXPOSE 8545
CMD ["npx", "hardhat", "test"]
