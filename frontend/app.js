(() => {
  "use strict";

  const STATUS = ["Active", "Successful", "Failed", "Cancelled"];
  const FRIENDLY = {
    CreatorCannotDonate: "You can't back your own campaign.",
    CampaignNotActive: "This campaign is no longer accepting changes.",
    CampaignNotSuccessful: "Funds can only be withdrawn after the deadline, once the goal is met.",
    RefundNotAvailable: "Refunds open only if the campaign fails or is cancelled.",
    NothingToRefund: "You have nothing to refund here.",
    AlreadyWithdrawn: "Funds were already withdrawn.",
    ZeroDonation: "Enter an amount above zero.",
    PlatformPaused: "The platform is paused by its owner.",
    InvalidGoal: "Goal must be above zero.",
    InvalidDuration: "Duration must be between 1 and 90 days.",
    EmptyTitle: "Please enter a title.",
    NotCreator: "Only the campaign creator can do that.",
  };

  const $ = (sel) => document.querySelector(sel);
  const state = { cfg: null, read: null, write: null, account: null, campaigns: [], mine: {}, filter: "all", now: 0 };

  function el(tag, props = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "class") n.className = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    for (const kid of kids.flat().filter((x) => x !== null && x !== undefined && x !== false)) {
      n.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return n;
  }

  const short = (a) => a.slice(0, 6) + "…" + a.slice(-4);
  const fmtEth = (w) => Number(ethers.formatEther(w)).toLocaleString(undefined, { maximumFractionDigits: 4 });

  function timeLeft(deadline) {
    const s = Number(deadline) - state.now;
    if (s <= 0) return "ended";
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    return d > 0 ? `${d}d ${h}h left` : h > 0 ? `${h}h ${m}m left` : `${m}m left`;
  }

  function toast(msg, isErr = false) {
    const t = $("#toast");
    t.textContent = msg;
    t.className = "toast" + (isErr ? " err" : "");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.add("hidden"), isErr ? 6000 : 3500);
  }

  function showBanner(msg) {
    const b = $("#banner");
    b.textContent = msg;
    b.classList.remove("hidden");
  }

  function readableError(e) {
    if (e && e.code === "ACTION_REJECTED") return "Transaction rejected in wallet.";
    const name = e?.revert?.name || e?.info?.error?.data?.errorName;
    if (name && FRIENDLY[name]) return FRIENDLY[name];
    return e?.reason || e?.shortMessage || e?.message || "Something went wrong.";
  }

  // ── chain / wallet ────────────────────────────────────────────────
  async function ensureChain() {
    const chainId = "0x" + state.cfg.chainId.toString(16);
    try {
      await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
    } catch (e) {
      if (e.code === 4902) {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId,
            chainName: state.cfg.chainName,
            rpcUrls: [state.cfg.rpcUrl],
            nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          }],
        });
      } else throw e;
    }
  }

  async function connect() {
    if (!window.ethereum) return toast("Install MetaMask (or another wallet) first.", true);
    try {
      await window.ethereum.request({ method: "eth_requestAccounts" });
      await ensureChain();
      const bp = new ethers.BrowserProvider(window.ethereum);
      const signer = await bp.getSigner();
      state.account = await signer.getAddress();
      state.write = new ethers.Contract(state.cfg.address, state.cfg.abi, signer);
      $("#connect").textContent = short(state.account);
      $("#chain-badge").textContent = state.cfg.chainName;
      $("#chain-badge").className = "badge ok";
      await load();
    } catch (e) {
      toast(readableError(e), true);
    }
  }

  // ── data ──────────────────────────────────────────────────────────
  async function load() {
    const block = await state.read.runner.provider.getBlock("latest");
    state.now = block.timestamp;
    const list = await state.read.getCampaigns(0, 100);
    state.campaigns = list.map((c) => ({
      id: Number(c.id), creator: c.creator, title: c.title, description: c.description,
      goal: c.goal, deadline: c.deadline, raised: c.raised, percent: Number(c.percentFunded),
      backers: Number(c.backersCount), status: Number(c.status), withdrawn: c.withdrawn,
    }));
    state.mine = {};
    if (state.account) {
      await Promise.all(state.campaigns.map(async (c) => {
        state.mine[c.id] = await state.read.contributionOf(c.id, state.account);
      }));
    }
    render();
  }

  // ── transactions ──────────────────────────────────────────────────
  async function run(btn, label, fn) {
    if (!state.write) return toast("Connect your wallet first.", true);
    btn.disabled = true;
    try {
      toast("Confirm in your wallet…");
      const tx = await fn(state.write);
      toast("Waiting for confirmation…");
      await tx.wait();
      toast(label + " ✓");
      await load();
    } catch (e) {
      toast(readableError(e), true);
    } finally {
      btn.disabled = false;
    }
  }

  async function showBackers(c) {
    const [addrs, amounts] = await state.read.getBackerDetails(c.id);
    $("#modal-title").textContent = `Backers of “${c.title}”`;
    const body = $("#modal-body");
    body.replaceChildren();
    if (addrs.length === 0) body.append(el("p", { class: "empty" }, "No backers yet."));
    addrs.forEach((a, i) => {
      body.append(el("div", { class: "backer" }, el("span", {}, a), el("span", {}, fmtEth(amounts[i]) + " ETH")));
    });
    $("#modal").classList.remove("hidden");
  }

  // ── rendering ─────────────────────────────────────────────────────
  function card(c) {
    const isCreator = state.account && c.creator.toLowerCase() === state.account.toLowerCase();
    const mine = state.mine[c.id] || 0n;
    const actions = el("div", { class: "actions" });

    if (c.status === 0 && !isCreator) {
      const amt = el("input", { type: "number", min: "0", step: "0.01", value: "0.1", "aria-label": "Amount in ETH" });
      const btn = el("button", { class: "btn primary" }, "Donate");
      btn.addEventListener("click", () => {
        let v;
        try { v = ethers.parseEther(amt.value || "0"); } catch { return toast("Invalid amount.", true); }
        run(btn, "Donation sent", (k) => k.donate(c.id, { value: v }));
      });
      actions.append(amt, btn);
    }
    if (c.status === 0 && isCreator) {
      const b = el("button", { class: "btn danger" }, "Cancel campaign");
      b.addEventListener("click", () => run(b, "Campaign cancelled", (k) => k.cancelCampaign(c.id)));
      actions.append(b);
    }
    if (c.status === 1 && isCreator && !c.withdrawn) {
      const b = el("button", { class: "btn good" }, "Withdraw funds");
      b.addEventListener("click", () => run(b, "Funds withdrawn", (k) => k.withdrawFunds(c.id)));
      actions.append(b);
    }
    if ((c.status === 2 || c.status === 3) && mine > 0n) {
      const b = el("button", { class: "btn good" }, `Claim refund (${fmtEth(mine)} ETH)`);
      b.addEventListener("click", () => run(b, "Refund claimed", (k) => k.claimRefund(c.id)));
      actions.append(b);
    }
    const bk = el("button", { class: "btn" }, `Backers (${c.backers})`);
    bk.addEventListener("click", () => showBackers(c));
    actions.append(bk);

    return el("article", { class: "card" },
      el("div", { class: "meta" },
        el("span", { class: "pill s" + c.status }, STATUS[c.status]),
        el("span", {}, c.status === 0 ? timeLeft(c.deadline) : c.withdrawn ? "paid out" : "")),
      el("h3", {}, c.title),
      el("p", {}, c.description || "No description."),
      el("div", { class: "bar" }, el("i", { class: c.percent >= 100 ? "full" : "", style: `width:${Math.min(c.percent, 100)}%` })),
      el("div", { class: "nums" },
        el("span", {}, el("b", {}, fmtEth(c.raised)), ` / ${fmtEth(c.goal)} ETH`),
        el("span", {}, `${c.percent}% funded`)),
      el("div", { class: "meta" },
        el("span", {}, "by " + short(c.creator) + (isCreator ? " (you)" : "")),
        el("span", {}, mine > 0n ? `you pledged ${fmtEth(mine)} ETH` : "")),
      actions);
  }

  function render() {
    const total = state.campaigns.reduce((s, c) => s + c.raised, 0n);
    $("#stat-count").textContent = state.campaigns.length;
    $("#stat-raised").textContent = fmtEth(total);
    $("#stat-backers").textContent = state.campaigns.reduce((s, c) => s + c.backers, 0);

    const f = state.filter;
    const visible = state.campaigns.filter((c) => {
      if (f === "all") return true;
      if (f === "mine") {
        return state.account && (c.creator.toLowerCase() === state.account.toLowerCase() || (state.mine[c.id] || 0n) > 0n);
      }
      return c.status === Number(f);
    });
    const grid = $("#campaigns");
    grid.replaceChildren();
    if (visible.length === 0) grid.append(el("p", { class: "empty" }, "Nothing here yet."));
    [...visible].reverse().forEach((c) => grid.append(card(c)));
  }

  // ── boot ──────────────────────────────────────────────────────────
  async function boot() {
    $("#connect").addEventListener("click", connect);
    $("#modal-close").addEventListener("click", () => $("#modal").classList.add("hidden"));
    $("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") $("#modal").classList.add("hidden"); });
    $("#filters").addEventListener("click", (e) => {
      if (!e.target.dataset.f) return;
      state.filter = e.target.dataset.f;
      document.querySelectorAll("#filters button").forEach((b) => b.classList.toggle("active", b === e.target));
      render();
    });
    $("#f-submit").addEventListener("click", () => {
      const title = $("#f-title").value.trim();
      let goal;
      try { goal = ethers.parseEther($("#f-goal").value || "0"); } catch { return toast("Invalid goal.", true); }
      const days = Number($("#f-days").value);
      run($("#f-submit"), "Campaign created", (k) => k.createCampaign(title, $("#f-desc").value.trim(), goal, days))
        .then(() => { $("#create-panel").open = false; });
    });

    if (window.ethereum) {
      window.ethereum.on?.("chainChanged", () => location.reload());
      window.ethereum.on?.("accountsChanged", () => location.reload());
    }

    try {
      const res = await fetch("deployed/config.json", { cache: "no-store" });
      if (!res.ok) throw new Error("missing");
      state.cfg = await res.json();
    } catch {
      return showBanner("No deployment found. Start the stack with `docker compose up --build` or run `npm run deploy:local`.");
    }

    const provider = new ethers.JsonRpcProvider(state.cfg.rpcUrl);
    try {
      if ((await provider.getCode(state.cfg.address)) === "0x") throw new Error("no code");
    } catch {
      return showBanner("The contract isn't on the chain at " + state.cfg.rpcUrl + ". Was the local node restarted? Re-run the deploy step.");
    }
    state.read = new ethers.Contract(state.cfg.address, state.cfg.abi, provider);
    await load();
    setInterval(() => load().catch(() => {}), 15000);
  }

  boot();
})();
