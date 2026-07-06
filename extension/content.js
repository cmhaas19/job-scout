// Job Scout content script: collects LinkedIn job IDs from the logged-in
// search results list, asks the backend for scores on demand, and badges each
// job card. UI follows the Claude Design spec (Job Scout.dc.html): idle
// launcher → scanning/processing panel with animated queue → done summary,
// collapsible to a progress-ring pill. Injected on all of linkedin.com (SPA);
// activates only on /jobs pages.

(() => {
  const VERSION = chrome.runtime.getManifest().version;
  console.log(`[JobScout] content script v${VERSION} loaded on ${location.pathname}`);

  const BATCH_SIZE = 3; // matches the server's schema cap and its 120s budget

  // LinkedIn job IDs are 8+ digit numbers — mirrors linkedInJobId in
  // src/lib/validation.ts, the server-side counterpart.
  const JOB_ID_RE = /^\d{8,}$/;

  // On-card badge colors — Job Scout fit categories (matches the web app).
  const TIER_COLORS = {
    "STRONG FIT": "#10b981",
    "GOOD FIT": "#3b82f6",
    BORDERLINE: "#f59e0b",
    "WEAK FIT": "#ef4444",
  };
  const GRAY = "#9ca3af";
  const SCORING_COLOR = "#6366f1";

  // Panel chip + distribution colors mirror the web app's fit categories
  // (FIT_COLORS / FIT_SCORE_COLORS in src/lib/constants.ts), not raw score
  // bands — a 77 is a GOOD FIT (blue), never "strong".
  const FIT_CHIP_COLORS = {
    "STRONG FIT": { color: "#047857", bg: "#d1fae5" }, // emerald-700 / 100
    "GOOD FIT": { color: "#1d4ed8", bg: "#dbeafe" }, // blue-700 / 100
    BORDERLINE: { color: "#b45309", bg: "#fef3c7" }, // amber-700 / 100
    "WEAK FIT": { color: "#b91c1c", bg: "#fee2e2" }, // red-700 / 100
  };
  const DIST_TIERS = [
    ["STRONG FIT", "strong", "#10b981"],
    ["GOOD FIT", "good", "#3b82f6"],
    ["BORDERLINE", "borderline", "#f59e0b"],
    ["WEAK FIT", "weak", "#ef4444"],
  ];

  const AVATAR_COLORS = [
    "#2f6f4f", "#5b4bc4", "#1a1a1a", "#0a6ed1",
    "#d1553a", "#635bff", "#632ca6", "#b54708",
  ];
  const avatarColor = (name) => {
    let h = 0;
    for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) | 0;
    return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
  };
  const initials = (name) =>
    (name || "?")
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase();

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /**
   * jobId -> backend result. Statuses:
   *   "cached" | "evaluated" | "skipped" | "error"
   *   "queued" / "scoring" — transient (drive on-card pending badges)
   */
  const scores = new Map();
  let scoring = false;
  let runKey = null; // search identity when the last run started
  let doneCardIds = null; // job IDs on the page when the last run finished

  // Identity of the current search results, ignoring currentJobId (which
  // changes every time a card is clicked without the list changing).
  function pageKey() {
    try {
      const u = new URL(location.href);
      u.searchParams.delete("currentJobId");
      u.searchParams.sort();
      return u.pathname + "?" + u.searchParams.toString();
    } catch {
      return location.href;
    }
  }

  // UI state (single source of truth; DOM is rebuilt/patched from this).
  const ui = {
    phase: "idle", // idle | scanning | running | done
    collapsed: false,
    queue: [], // { jobId, title, company, status: queued|active|scored, score }
    found: 0, // new jobs discovered by lookup
    processed: 0, // jobs finished this run (drives progress bar)
    scored: 0, // jobs newly scored this run
    already: 0, // jobs on the page that were already in Job Scout
    dist: {}, // fit_category -> count, all scored jobs on the page
  };

  // ── DOM: job cards ─────────────────────────────────────────────────────────

  function collectCards() {
    const cards = new Map(); // jobId -> element
    for (const li of document.querySelectorAll("li[data-occludable-job-id]")) {
      const id = li.dataset.occludableJobId;
      if (JOB_ID_RE.test(id)) cards.set(id, li);
    }
    if (cards.size === 0) {
      for (const el of document.querySelectorAll("[data-job-id]")) {
        const id = el.getAttribute("data-job-id");
        if (JOB_ID_RE.test(id)) cards.set(id, el);
      }
    }
    if (cards.size === 0) {
      for (const a of document.querySelectorAll('a[href*="/jobs/view/"]')) {
        const match = a.href.match(/\/jobs\/view\/(?:[^/?#]*-)?(\d{8,})/);
        if (match) {
          const card = a.closest("li") || a;
          cards.set(match[1], card);
        }
      }
    }
    return cards;
  }

  function cardMeta(el) {
    const title = el.querySelector(
      ".job-card-list__title--link, .job-card-container__link, a[href*='/jobs/view/']"
    );
    const company = el.querySelector(
      ".artdeco-entity-lockup__subtitle, .job-card-container__primary-description"
    );
    return {
      title: title?.textContent.trim().replace(/\s+/g, " ").slice(0, 300) || undefined,
      company: company?.textContent.trim().replace(/\s+/g, " ").slice(0, 300) || undefined,
    };
  }

  // ── On-card badges (unchanged visual language) ────────────────────────────

  function badgeCard(el, result) {
    // Skip identical re-renders: our own badge writes re-fire the
    // MutationObserver, and without this guard the observer loop would
    // rebuild every badge ~3x/second forever.
    const stateKey = [
      result.jobId ?? "",
      result.status,
      result.total_score ?? "",
      result.fit_category ?? "",
    ].join("|");
    let badge = el.querySelector(".jobscout-badge");
    if (badge && badge.dataset.state === stateKey) return;

    if (!badge) {
      badge = document.createElement("div");
      badge.className = "jobscout-badge";
      if (getComputedStyle(el).position === "static") {
        el.style.position = "relative";
      }
      el.appendChild(badge);
    }
    badge.dataset.state = stateKey;

    badge.classList.remove("jobscout-badge-scoring");
    badge.replaceChildren();

    const hasScore =
      result.total_score !== null && result.total_score !== undefined;

    if (hasScore) {
      badge.append(String(Math.round(result.total_score)));
      badge.style.background = TIER_COLORS[result.fit_category] || GRAY;
      const origin =
        result.status === "evaluated"
          ? "Newly added to Job Scout"
          : "Already in Job Scout";
      badge.title = `${origin} — ${result.fit_category ?? ""} — ${result.summary ?? ""}`;
      if (result.status === "evaluated") {
        const chip = document.createElement("span");
        chip.className = "jobscout-new";
        chip.textContent = "NEW";
        badge.append(chip);
      }
    } else if (result.status === "queued") {
      badge.textContent = "⋯";
      badge.style.background = GRAY;
      badge.title = "Job Scout: queued for scoring";
    } else if (result.status === "scoring") {
      badge.textContent = "…";
      badge.style.background = SCORING_COLOR;
      badge.classList.add("jobscout-badge-scoring");
      badge.title = "Job Scout: scoring now…";
    } else {
      badge.textContent = "—";
      badge.style.background = GRAY;
      badge.title =
        result.status === "error"
          ? "Job Scout: evaluation failed"
          : "Job Scout: no description available, not evaluated";
    }
  }

  function removeBadge(el) {
    el?.querySelector(".jobscout-badge")?.remove();
  }

  function applyKnownBadges(cards) {
    for (const [jobId, el] of cards ?? collectCards()) {
      const result = scores.get(jobId);
      if (result) {
        badgeCard(el, { ...result, jobId });
      } else {
        // LinkedIn's virtualized list recycles <li> nodes — a leftover badge
        // here belongs to whatever job this node previously displayed.
        removeBadge(el);
      }
    }
  }

  // ── SVG helpers (static markup only — never page-derived strings) ─────────

  const SVG_NS = "http://www.w3.org/2000/svg";

  function radarIcon(size) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("width", size);
    svg.setAttribute("height", size);
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "#fff");
    svg.setAttribute("stroke-width", "2");
    const parts = [
      ["circle", { cx: 12, cy: 12, r: 8 }],
      ["circle", { cx: 12, cy: 12, r: 3.4 }],
      ["line", { x1: 12, y1: 1.5, x2: 12, y2: 4.5 }],
      ["line", { x1: 12, y1: 19.5, x2: 12, y2: 22.5 }],
      ["line", { x1: 1.5, y1: 12, x2: 4.5, y2: 12 }],
      ["line", { x1: 19.5, y1: 12, x2: 22.5, y2: 12 }],
    ];
    for (const [tag, attrs] of parts) {
      const el = document.createElementNS(SVG_NS, tag);
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
      svg.appendChild(el);
    }
    return svg;
  }

  function strokePath(d, { size = 16, width = 2.2 } = {}) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("width", size);
    svg.setAttribute("height", size);
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", width);
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
    return svg;
  }

  const RING_CIRC = 2 * Math.PI * 13;

  // ── Shell rendering ────────────────────────────────────────────────────────

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  let shell = null; // current top-level element
  let shellType = null; // launcher | panel | pill
  let panelRefs = null; // { sub, progress, body, phase, rows: Map, listLabel, listCount, fill }
  let pillRefs = null; // { arc, center, sub }
  let launcherSub = null;

  function subtitleText() {
    if (ui.phase === "scanning") return `Scanning page · ${ui.found || "…"} new jobs found`;
    if (ui.phase === "running") return `Scoring ${ui.processed} of ${ui.found}`;
    return `Done · ${ui.already + ui.scored} scored on this page`;
  }

  function pillSubText() {
    return ui.phase === "done"
      ? `${ui.already + ui.scored} jobs scored`
      : `${ui.processed} of ${ui.found} scored`;
  }

  function progressPct() {
    return ui.found ? Math.round((ui.processed / ui.found) * 100) : 0;
  }

  function buildLauncher() {
    const btn = el("button", "js-ui js-launcher");
    const icon = el("span", "js-launcher-icon");
    icon.appendChild(radarIcon(16));
    const text = el("span", "js-launcher-text");
    text.appendChild(el("span", "js-launcher-title", "Score new jobs"));
    launcherSub = el("span", "js-launcher-sub");
    text.appendChild(launcherSub);
    btn.append(icon, text);
    btn.addEventListener("click", scoreAll);
    updateLauncher();
    return btn;
  }

  function updateLauncher(cards) {
    if (!launcherSub) return;
    const count = (cards ?? collectCards()).size;
    const text =
      count > 0 ? `Job Scout · ${count} results on page` : "Job Scout · no jobs detected";
    // Only write on change — a no-op write still re-fires the MutationObserver.
    if (launcherSub.textContent !== text) launcherSub.textContent = text;
  }

  function buildQueueRow(item) {
    const row = el("div", "js-row");
    row.dataset.jobId = item.jobId;
    const inner = el("div", "js-row-inner");

    const avatar = el("span", "js-avatar", initials(item.company || item.title));
    avatar.style.background = avatarColor(item.company || item.title || "?");

    const text = el("div", "js-row-text");
    text.appendChild(el("div", "js-row-title", item.title));
    text.appendChild(el("div", "js-row-company", item.company || ""));

    const slot = el("span", "js-row-slot");
    inner.append(avatar, text, slot);
    row.appendChild(inner);
    applyRowStatus(row, item);
    return row;
  }

  function applyRowStatus(row, item) {
    row.className = `js-row${item.status === "active" ? " js-row-active" : ""}${
      item.status === "scored" ? " js-row-scored" : ""
    }`;
    const inner = row.firstChild;
    const slot = inner.querySelector(".js-row-slot");
    slot.replaceChildren();
    inner.querySelector(".js-rowfill")?.remove();

    if (item.status === "queued") {
      slot.appendChild(el("span", "js-queued-label", "queued"));
    } else if (item.status === "active") {
      slot.appendChild(el("span", "js-spinner"));
      const fill = el("div", "js-rowfill");
      fill.appendChild(el("div"));
      inner.appendChild(fill);
    } else if (item.status === "scored") {
      const chip = el("span", "js-chip");
      const c = FIT_CHIP_COLORS[item.fit];
      if (item.score !== null && item.score !== undefined && c) {
        chip.textContent = String(Math.round(item.score));
        chip.style.color = c.color;
        chip.style.background = c.bg;
      } else {
        chip.textContent = "—";
        chip.style.color = "#6b7280";
        chip.style.background = "#efede8";
      }
      slot.appendChild(chip);
    }
  }

  function buildPanel() {
    const panel = el("div", "js-ui js-panel");
    panelRefs = { rows: new Map(), phase: null };

    const header = el("div", "js-header");
    const icon = el("span", "js-header-icon");
    icon.appendChild(radarIcon(18));
    const text = el("div", "js-header-text");
    text.appendChild(el("div", "js-header-title", "Job Scout"));
    panelRefs.sub = el("div", "js-header-sub");
    text.appendChild(panelRefs.sub);
    const min = el("button", "js-min");
    min.title = "Minimize";
    min.appendChild(strokePath("M6 9l6 6 6-6"));
    min.addEventListener("click", () => {
      ui.collapsed = true;
      renderShell();
    });
    header.append(icon, text, min);

    panelRefs.progress = el("div", "js-progress");
    panelRefs.body = el("div");

    panel.append(header, panelRefs.progress, panelRefs.body);
    setPanelPhase(true);
    return panel;
  }

  function setPanelPhase(force) {
    if (!panelRefs) return;
    if (!force && panelRefs.phase === ui.phase) return;
    panelRefs.phase = ui.phase;

    // Progress bar mode
    panelRefs.progress.replaceChildren();
    panelRefs.fill = null;
    if (ui.phase === "scanning") {
      panelRefs.progress.appendChild(el("div", "js-progress-shimmer"));
    } else {
      panelRefs.fill = el("div", "js-progress-fill");
      panelRefs.progress.appendChild(panelRefs.fill);
    }

    // Body
    panelRefs.body.replaceChildren();
    panelRefs.rows.clear();
    if (ui.phase === "done") {
      panelRefs.body.appendChild(buildDoneBody());
    } else {
      const list = el("div", "js-list");
      const head = el("div", "js-list-head");
      panelRefs.listLabel = el("span", "js-list-label");
      panelRefs.listCount = el("span", "js-list-count");
      head.append(panelRefs.listLabel, panelRefs.listCount);
      const body = el("div", "js-list-body");
      for (const item of ui.queue) {
        const row = buildQueueRow(item);
        panelRefs.rows.set(item.jobId, row);
        body.appendChild(row);
      }
      list.append(head, body);
      panelRefs.body.appendChild(list);
      panelRefs.listBody = body;
    }
    updateDynamic();
  }

  function buildDoneBody() {
    const done = el("div", "js-done");

    const head = el("div", "js-done-head");
    const check = el("span", "js-done-check");
    check.appendChild(strokePath("M5 12.5l4.5 4.5L19 7", { size: 22, width: 2.6 }));
    const headText = el("div");
    headText.appendChild(el("div", "js-done-title", "All caught up"));
    headText.appendChild(
      el(
        "div",
        "js-done-sub",
        ui.scored > 0
          ? "Finished scoring this page"
          : `All ${ui.already} jobs here were already scored`
      )
    );
    head.append(check, headText);

    const tiles = el("div", "js-tiles");
    for (const [num, cap] of [
      [ui.already, "already in Job Scout"],
      [ui.scored, "newly scored"],
    ]) {
      const tile = el("div", "js-tile");
      tile.appendChild(el("div", "js-tile-num", String(num)));
      tile.appendChild(el("div", "js-tile-cap", cap));
      tiles.appendChild(tile);
    }

    const dist = el("div", "js-dist");
    for (const [tier, label, color] of DIST_TIERS) {
      const item = el("span");
      const dot = el("span", "js-dot");
      dot.style.background = color;
      item.append(dot, `${ui.dist[tier] || 0} ${label}`);
      dist.appendChild(item);
    }

    const actions = el("div", "js-actions");
    const dismiss = el("button", "js-dismiss", "Dismiss");
    dismiss.addEventListener("click", () => {
      ui.phase = "idle";
      renderShell();
    });
    actions.appendChild(dismiss);

    done.append(head, tiles, dist, actions);
    return done;
  }

  function buildPill() {
    const pill = el("button", "js-ui js-pill");
    pillRefs = {};

    const wrap = el("span", "js-ring-wrap");
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("width", "34");
    svg.setAttribute("height", "34");
    svg.setAttribute("viewBox", "0 0 34 34");
    const track = document.createElementNS(SVG_NS, "circle");
    for (const [k, v] of Object.entries({
      cx: 17, cy: 17, r: 13, fill: "none", stroke: "#ececec", "stroke-width": 4,
    })) track.setAttribute(k, v);
    const arc = document.createElementNS(SVG_NS, "circle");
    for (const [k, v] of Object.entries({
      cx: 17, cy: 17, r: 13, fill: "none", stroke: "var(--accent)",
      "stroke-width": 4, "stroke-linecap": "round",
      "stroke-dasharray": RING_CIRC, "stroke-dashoffset": RING_CIRC,
    })) arc.setAttribute(k, v);
    arc.classList.add("js-ring-arc");
    svg.append(track, arc);
    pillRefs.arc = arc;
    pillRefs.center = el("span", "js-ring-center");
    pillRefs.check = el("span", "js-ring-check", "✓");
    wrap.append(svg, pillRefs.center, pillRefs.check);

    const text = el("span", "js-pill-text");
    text.appendChild(el("span", "js-pill-title", "Job Scout"));
    pillRefs.sub = el("span", "js-pill-sub");
    text.appendChild(pillRefs.sub);

    pill.append(wrap, text);
    pill.addEventListener("click", () => {
      ui.collapsed = false;
      renderShell();
    });
    updateDynamic();
    return pill;
  }

  function renderShell(cards) {
    const onJobs = location.pathname.startsWith("/jobs");
    const desired =
      ui.phase === "idle"
        ? onJobs
          ? "launcher"
          : null
        : ui.collapsed
        ? "pill"
        : "panel";

    if (desired === shellType && shell && document.body.contains(shell)) {
      if (shellType === "panel") setPanelPhase();
      updateDynamic(cards);
      return;
    }

    shell?.remove();
    shell = null;
    shellType = desired;
    panelRefs = null;
    pillRefs = null;
    launcherSub = null;
    if (!desired) return;

    shell =
      desired === "launcher"
        ? buildLauncher()
        : desired === "pill"
        ? buildPill()
        : buildPanel();
    document.body.appendChild(shell);
  }

  function updateDynamic(cards) {
    if (shellType === "launcher") {
      updateLauncher(cards);
      return;
    }
    if (shellType === "panel" && panelRefs) {
      panelRefs.sub.textContent = subtitleText();
      if (panelRefs.fill) panelRefs.fill.style.width = `${progressPct()}%`;
      if (panelRefs.listLabel && ui.phase !== "done") {
        panelRefs.listLabel.textContent =
          ui.phase === "scanning" ? "Queue" : "In progress";
        const n = ui.queue.length;
        panelRefs.listCount.textContent = `${n} job${n === 1 ? "" : "s"}`;
      }
    }
    if (shellType === "pill" && pillRefs) {
      const done = ui.phase === "done";
      const pct = done ? 100 : progressPct();
      pillRefs.arc.setAttribute(
        "stroke-dashoffset",
        RING_CIRC * (1 - pct / 100)
      );
      pillRefs.center.style.display = done ? "none" : "";
      pillRefs.check.style.display = done ? "" : "none";
      pillRefs.center.textContent = String(ui.processed);
      pillRefs.sub.textContent = pillSubText();
    }
  }

  // Queue mutations — update state, then patch DOM if the panel is visible.

  function setRowStatus(jobId, status, score, fit) {
    const item = ui.queue.find((q) => q.jobId === jobId);
    if (!item) return;
    item.status = status;
    if (score !== undefined) item.score = score;
    if (fit !== undefined) item.fit = fit;
    const row = panelRefs?.rows.get(jobId);
    if (row) applyRowStatus(row, item);
  }

  function dropRow(jobId, delay = 0) {
    setTimeout(() => {
      const row = panelRefs?.rows.get(jobId);
      if (row) {
        row.classList.add("js-row-leaving");
        setTimeout(() => {
          row.remove();
          panelRefs?.rows.delete(jobId);
        }, 320);
      }
      ui.queue = ui.queue.filter((q) => q.jobId !== jobId);
      updateDynamic();
    }, delay);
  }

  // ── Toast ─────────────────────────────────────────────────────────────────

  function toast(message) {
    document.querySelector(".jobscout-toast")?.remove();
    const node = el("div", "jobscout-toast", `Job Scout: ${message}`);
    node.setAttribute("role", "alert");
    if (/options/i.test(message)) {
      node.textContent += " (click here to open)";
      node.style.cursor = "pointer";
      node.addEventListener("click", () => send({ type: "openOptions" }));
    }
    document.body.appendChild(node);
    setTimeout(() => node.remove(), 10000);
  }

  // ── Scoring flow ──────────────────────────────────────────────────────────

  function send(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (response) => {
          if (chrome.runtime.lastError) {
            resolve({ error: chrome.runtime.lastError.message });
          } else {
            resolve(response ?? { error: "No response from extension" });
          }
        });
      } catch (err) {
        resolve({ error: `${err.message} — refresh this tab` });
      }
    });
  }

  // Whole-page rollup for the Done summary: cached hits count as "already in
  // Job Scout", and the distribution covers every scored job on the page —
  // otherwise an all-cached page reads as "0 found · 0 scored" (nothing
  // happened) when in fact every card got a badge.
  function computePageStats(cards) {
    doneCardIds = new Set(cards.keys());
    ui.already = 0;
    ui.dist = {};
    for (const id of cards.keys()) {
      const r = scores.get(id);
      if (!r || r.status === "queued" || r.status === "scoring") continue;
      // Only lookup hits count as previously known — this run's skips and
      // errors are neither "already in Job Scout" nor "newly scored".
      if (r.status === "cached") ui.already++;
      if (r.fit_category && r.total_score !== null && r.total_score !== undefined) {
        ui.dist[r.fit_category] = (ui.dist[r.fit_category] || 0) + 1;
      }
    }
  }

  async function scoreAll() {
    console.log(`[JobScout] score requested (scoring=${scoring})`);
    if (scoring) return;
    if (!location.pathname.startsWith("/jobs")) {
      // The toolbar icon can fire anywhere on linkedin.com; the bare-anchor
      // card fallback would harvest junk job links from feed posts.
      toast("open a LinkedIn jobs page to score results");
      return;
    }
    const cards = collectCards();
    console.log(`[JobScout] ${cards.size} job cards detected`);
    if (cards.size === 0) {
      toast("no job cards detected on this page");
      return;
    }

    scoring = true;
    const fail = (message) => {
      ui.phase = "idle";
      renderShell();
      toast(message);
    };

    try {
      const unknown = [...cards.keys()].filter((id) => !scores.has(id));

      runKey = pageKey();
      ui.phase = "scanning";
      ui.collapsed = false;
      ui.found = 0;
      ui.processed = 0;
      ui.scored = 0;
      ui.already = 0;
      ui.dist = {};
      ui.queue = unknown.map((id) => {
        const m = cardMeta(cards.get(id));
        return {
          jobId: id,
          title: m.title || `Job ${id}`,
          company: m.company || "",
          status: "queued",
          score: null,
        };
      });
      renderShell();

      // Lookup (capped at 50 ids per request server-side).
      const missing = [];
      for (let i = 0; i < unknown.length; i += 50) {
        const res = await send({
          type: "lookup",
          body: { jobIds: unknown.slice(i, i + 50) },
        });
        if (res.error) return fail(res.error);
        for (const r of res.results) {
          scores.set(r.jobId, { ...r, status: "cached" });
        }
        missing.push(...res.missing);
      }
      applyKnownBadges();

      // Cached jobs leave the queue; only genuinely new jobs remain.
      const missingSet = new Set(missing);
      for (const item of [...ui.queue]) {
        if (!missingSet.has(item.jobId)) dropRow(item.jobId);
      }
      ui.found = missing.length;

      if (missing.length === 0) {
        computePageStats(cards);
        ui.phase = "done";
        renderShell();
        return;
      }

      for (const id of missing) scores.set(id, { status: "queued" });
      applyKnownBadges();
      ui.phase = "running";
      renderShell();

      for (let i = 0; i < missing.length; i += BATCH_SIZE) {
        const chunk = missing.slice(i, i + BATCH_SIZE);
        for (const id of chunk) {
          scores.set(id, { status: "scoring" });
          setRowStatus(id, "active");
        }
        applyKnownBadges();
        updateDynamic();

        const res = await send({
          type: "evaluate",
          body: {
            jobs: chunk.map((jobId) => {
              // If the virtualized list dropped the card, send no meta —
              // querying document.body would pick up ANOTHER job's title.
              const card = cards.get(jobId);
              return { jobId, ...(card ? cardMeta(card) : {}) };
            }),
          },
        });

        if (res.error) {
          for (const id of chunk) {
            scores.delete(id);
            setRowStatus(id, "queued");
          }
          return fail(res.error);
        }

        for (const r of res.results) {
          scores.set(r.jobId, r);
          ui.processed++;
          const hasScore = r.total_score !== null && r.total_score !== undefined;
          if (hasScore) ui.scored++;
          setRowStatus(
            r.jobId,
            "scored",
            hasScore ? r.total_score : null,
            r.fit_category ?? null
          );
          dropRow(r.jobId, 700);
        }
        applyKnownBadges();
        updateDynamic();
      }

      await sleep(1000); // let the last score chips play out
      computePageStats(cards);
      ui.phase = "done";
      renderShell();
    } catch (err) {
      console.error("[JobScout]", err);
      fail(err.message || "unexpected error — see console");
    } finally {
      scoring = false;
      // Clear transient on-card markers (e.g. a batch errored out mid-run).
      // "error" results are cleared too so the next run retries them — the
      // server persists nothing for transient failures, and rows it does
      // persist (eval_failed) come back through lookup as skipped hits.
      for (const [id, r] of scores) {
        if (r.status === "queued" || r.status === "scoring" || r.status === "error") {
          scores.delete(id);
          removeBadge(cards.get(id));
        }
      }
      applyKnownBadges();
    }
  }

  // ── Observe SPA navigation + lazy-loaded cards ────────────────────────────

  // If the Done summary is showing but the user changed filters/pagination and
  // the results list was replaced, the summary describes a page that no longer
  // exists — reset to the idle launcher so it reflects the new list.
  function maybeResetStale(cards) {
    if (scoring || ui.phase !== "done") return;
    const current = cards ?? collectCards();
    if (current.size === 0) return; // list mid-render; don't flap
    const searchChanged = runKey !== null && pageKey() !== runKey;
    let overlap = 0;
    let unseen = 0;
    if (doneCardIds) {
      for (const id of current.keys()) {
        if (doneCardIds.has(id)) overlap++;
        else if (!scores.has(id)) unseen++;
      }
    }
    const listReplaced = doneCardIds && overlap / current.size < 0.5;
    // Lazy-loaded results can add unscored jobs without changing the URL —
    // "All caught up" would be a lie, so fall back to the launcher.
    const newJobsAppeared = unseen > 0;
    if (searchChanged || listReplaced || newJobsAppeared) {
      console.log("[JobScout] results list changed — resetting to idle");
      ui.phase = "idle";
      ui.collapsed = false;
      doneCardIds = null;
    }
  }

  let debounce;
  const observer = new MutationObserver(() => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      // Off /jobs with nothing in flight there's nothing to badge or count —
      // skip the card scan entirely so feed/messaging pages don't pay for it.
      if (!location.pathname.startsWith("/jobs") && ui.phase === "idle") {
        renderShell();
        return;
      }
      // One card scan per tick, shared by all three consumers. Combined with
      // the change-guards in badgeCard/updateLauncher this keeps the observer
      // from re-triggering itself in a permanent loop.
      const cards = collectCards();
      maybeResetStale(cards);
      renderShell(cards);
      applyKnownBadges(cards);
    }, 300);
  });

  // Toolbar icon clicks arrive from the background worker.
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "scoreAll") scoreAll();
  });

  observer.observe(document.body, { childList: true, subtree: true });
  renderShell();
})();
