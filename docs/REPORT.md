# Crowdfunding Platform Using Smart Contracts: Report Skeleton

Fill the bracketed parts with your own results and screenshots.

## 1. Abstract
Short summary: problem (trust and fees in centralised crowdfunding), solution (all-or-nothing smart contracts), result ([N] tests passing, [X]% coverage).

## 2. Problem statement
Centralised platforms hold backers' money, charge fees, and can freeze or misappropriate funds. Backers must trust the intermediary.

## 3. Objectives
1. Campaign creation and donations. 2. Automatic refund if the goal is missed by the deadline. 3. Transparent funding progress and backers list. 4. A tested, containerised, reproducible build.

## 4. Technology choices
Solidity 0.8.24 (built-in overflow checks), Hardhat (compile/test/deploy), ethers.js v6, MetaMask, Docker/Compose, nginx. Justify each against alternatives (Truffle/Foundry, web3.js, etc.).

## 5. System design
- Architecture diagram (see README). 
- Data model: `Campaign`, `contributions[id][address]`, `backers[id]`.
- State machine: Active → Successful | Failed | Cancelled (derived from time, raised, cancelled flag).
- Sequence diagrams to draw: create → donate → withdraw; create → donate → deadline → refund.

## 6. Security analysis
Re-entrancy (CEI + guard, tested), integer overflow (0.8 checked math), access control (`onlyOwner`, creator checks), denial of service (pull payments, paginated reads), front-running/time manipulation (low impact), pause design (never traps funds). Known limitations: unaudited, ETH-only.

## 7. Testing
Method: unit tests per function and per revert path, status-transition tests with `time.increase`, balance-change assertions, an attacker contract. Paste the output of `npm test`, `npm run coverage`, and `npm run test:gas` here. Report: tests passed / total, coverage table, gas table.

## 8. Deployment and operation
Docker Compose services, how to run, how to fast-forward time for demos.

## 9. Results and screenshots
Campaign list, donation, refund, withdrawal, backers modal.

## 10. Limitations and future work
Milestone payouts, ERC-20, IPFS metadata, The Graph indexing, upgradeable contracts, formal verification (Slither/Echidna).

## 11. References
Solidity docs, Hardhat docs, OpenZeppelin ReentrancyGuard, SWC registry, Ethereum.org.
