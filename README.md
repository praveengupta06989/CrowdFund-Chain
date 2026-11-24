# CrowdFund Chain

An all-or-nothing crowdfunding platform on Ethereum. Anyone can start a campaign with a goal and a deadline; backers pledge ETH; if the goal is met the creator is paid, otherwise every backer can claim a full refund. No middleman holds the money, the contract does.

## Objective

Build a crowdfunding platform where trust comes from code instead of an intermediary:

1. **Campaign creation**: title, description, goal (ETH), duration (1-90 days).
2. **Donations**: any wallet except the creator can back a campaign until its deadline.
3. **Refund if the target is not met by the deadline**: backers pull their money back themselves.
4. **Funding progress and backers list**: percent funded, amount raised, and every backer with their amount, readable on-chain and shown in the UI.

Extras: creator cancellation (with refunds), a platform fee capped at 5%, owner pause switch (refunds stay open), re-entrancy protection, custom errors, paginated reads, and a Docker one-command setup.

## How it works

```
 Browser (index.html + ethers.js)  ──JSON-RPC──▶  Hardhat node (chain 31337)
        │  MetaMask signs txs                          │
        └──────────────────────────────────────────────┴──▶ CrowdfundingPlatform.sol
```

Campaign status is **derived**, never stored, so it can't go stale:

| Condition | Status |
|---|---|
| cancelled by creator | Cancelled (refunds open) |
| now < deadline | Active (donations open) |
| deadline passed, raised >= goal | Successful (creator can withdraw) |
| deadline passed, raised < goal | Failed (refunds open) |

Design decisions worth knowing for a viva:
- **Pull payments**: the contract never sends money to backers; each backer calls `claimRefund`. One bad receiver can't block others.
- **Checks-Effects-Interactions + `nonReentrant`** on every function that moves ETH. `ReentrancyAttacker.sol` (in `contracts/mocks`) proves it.
- **Pausing never traps funds**: it stops new campaigns/donations only.
- **Creator can't donate to their own campaign**, to block self-funding to fake momentum.
- Fee is taken only on successful withdrawals; the owner collects it with `withdrawFees`.

## Project layout

```
contracts/CrowdfundingPlatform.sol   main contract
contracts/mocks/ReentrancyAttacker.sol  test-only attacker
test/CrowdfundingPlatform.test.js    50 test cases
scripts/deploy.js                    deploys, writes frontend/deployed/config.json, optional demo data
scripts/fast-forward.js              advances chain time to pass deadlines
frontend/                            static web DApp (nginx in Docker)
Dockerfile, docker-compose.yml       node + deployer + frontend (+ test profile)
docs/REPORT.md                       report skeleton for the university submission
```

## Run it with Docker (recommended)

Requires Docker Desktop (or Docker Engine + Compose v2).

```bash
docker compose up --build
```

This starts a local blockchain on `localhost:8545`, deploys the contract and seeds three demo campaigns, then serves the app at **http://localhost:3000**.

### Connect MetaMask
1. Install the MetaMask browser extension.
2. Open http://localhost:3000 and click **Connect wallet**; it will offer to add the "Hardhat Local" network (chain ID 31337, RPC `http://127.0.0.1:8545`).
3. Import a test account: MetaMask → Import account → paste a private key printed in the `node` container logs (`docker compose logs node`). These Hardhat keys are public, so **never use them on a real network**.
4. Account #0 is the deployer/owner. Seeded campaigns are created by accounts #1 and #2; use account #3, #4 or #5 to donate, or #1 to see creator buttons.

### Watch a deadline pass
```bash
docker compose exec node sh -c "DAYS=31 npx hardhat run scripts/fast-forward.js --network localhost"
```
Reload the page: the 2-of-5 ETH campaign is now **Failed** and its backers see **Claim refund**; the fully-funded one is **Successful** and its creator sees **Withdraw funds**. MetaMask may cache nonces after restarting the chain: Settings → Advanced → Clear activity tab data.

### Stop / reset
```bash
docker compose down -v      # -v also drops the deployed-config volume
```

## Run without Docker

Requires Node.js 18+ (20 recommended).

```bash
npm install
npm run compile
npm test
npx hardhat node            # terminal 1
npm run deploy:local        # terminal 2 (add SEED=true for demo data)
npm run frontend            # terminal 2, then open http://localhost:3000
```

## Tests and results

```bash
npm test                                   # prints "N passing", "N failing"
npm run coverage                           # statement/branch/function/line coverage table
npm run test:gas                           # gas per function
docker compose --profile test run --rm tests   # same, inside Docker
```

The suite contains **50 test cases** covering deployment, creation validation, donations, progress/backers views, status transitions, withdrawals and fees, refunds, cancellation, admin functions, and a re-entrancy attack. Mocha prints the real pass count (`50 passing` is the expectation) and `npm run coverage` prints the coverage percentages; copy both from your own terminal into your report.

## Debugging

- **Read the revert**: the contract uses custom errors, so failures read like `reverted with custom error 'CampaignNotActive()'`. Search the name in `CrowdfundingPlatform.sol` to find the condition.
- **One test only**: `npx hardhat test --grep "refund"`.
- **Print from Solidity**: `import "hardhat/console.sol";` then `console.log("raised", c.raised);` (remove before deploying).
- **Stack traces**: `npx hardhat test --show-stack-traces`.
- **Docker logs**: `docker compose logs -f node` shows every RPC call and revert from the UI; `docker compose logs deployer` shows the deploy output.
- **Frontend**: browser DevTools → Console/Network. A yellow banner means `deployed/config.json` is missing or the chain was restarted (re-run `docker compose up deployer`).
- **Clean slate**: `npx hardhat clean`, delete `node_modules`, reinstall.

## APIs and external services

None are required. The app talks to the chain over JSON-RPC (the Hardhat node, or MetaMask's provider), and `ethers.js` is loaded from the jsDelivr CDN with a pinned version. For an optional public testnet deployment you would need an RPC provider key (Infura/Alchemy) and optionally an Etherscan key for verification: copy `.env.example` to `.env`, fill it in, get Sepolia test ETH from a faucet, and run `npx hardhat run scripts/deploy.js --network sepolia`.

## Security notes and limitations

- Educational project, **not audited**; don't use with real funds.
- Campaigns are all-or-nothing; there are no milestones or partial releases.
- Donations are in native ETH only (no stablecoins/ERC-20).
- Deadlines use `block.timestamp`, which miners can nudge by seconds, which is irrelevant for day-scale deadlines.
- Possible extensions: milestone-based payouts with backer voting, ERC-20 support, IPFS for images, subgraph indexing, upgradeable proxy.

## Licence

MIT.
