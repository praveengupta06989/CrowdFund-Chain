// Used by docker-compose to know when the JSON-RPC node is ready.
fetch("http://127.0.0.1:8545", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", method: "eth_chainId", params: [], id: 1 }),
})
  .then((r) => process.exit(r.ok ? 0 : 1))
  .catch(() => process.exit(1));
