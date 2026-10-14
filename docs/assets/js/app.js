(function () {
  "use strict";

  // ── State ────────────────────────────────────────────────────────────────────

  // Top-level config is shared across all sections.
  // Leaderboard-specific state is isolated under state.leaderboard so the two
  // concerns do not blur as the file grows.
  const state = {
    config: null,
    leaderboard: { rows: [], sortKey: "", sortDirection: "desc" },
  };

  // ── Utilities ────────────────────────────────────────────────────────────────

  // Shared utilities from config-loader.js (must be loaded before this script)
  const {
    safeLink, applyLinkTarget, applyNavLink, resolveNav,
    normalizeIconName, renderSiteHeader, renderSiteFooter
  } = Brain;

  const qs = (selector, root = document) => root.querySelector(selector);
  const qsa = (selector, root = document) => [...root.querySelectorAll(selector)];
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const setText = (sel, value) => { const n = qs(sel); if (n) n.textContent = value || ""; };

  /**
   * Create an aria-hidden Material Design Icons span element.
   * @param {string} name - Icon name identifier.
   * @param {string} [className=""] - Optional additional CSS class names.
   * @returns {HTMLSpanElement} Icon span element.
   */
  function createIcon(name, className = "") {
    const normalized = normalizeIconName(name);
    const icon = el("span", `mdi mdi-${normalized} ${className}`.trim());
    icon.setAttribute("aria-hidden", "true");
    return icon;
  }

  // ── Hero ─────────────────────────────────────────────────────────────────────

  /**
   * Render the hero section containing headline, actions, and trust items.
   * @param {object} config - Site configuration object.
   */
  function renderHero(config) {
    const hero = config?.hero;
    if (!hero) return;
    const title = qs("#hero-title");
    title.replaceChildren();
    // accentLine is optional; without one the headline is a single plain line.
    title.append(document.createTextNode(hero.headline || ""));
    if (hero.accentLine) title.append(el("br"), el("span", "accent", hero.accentLine));
    qs("#hero-summary").textContent = hero.summary || "";
    const actionsContainer = qs("#hero-actions");
    actionsContainer.replaceChildren();
    (hero.actions || []).forEach((action, index) => {
      const a = el("a", `button ${index === 0 ? "button-primary" : ""}`.trim());
      applyNavLink(a, config?.navigation, action);
      a.append(createIcon(action.icon, "button-icon"), document.createTextNode(action.label));
      actionsContainer.append(a);
    });
    setText("#hero-actions-note", hero.actionsNote);
    setText("#hero-access-note-text", hero.accessNote);
    const trustContainer = qs("#trust-list");
    trustContainer.replaceChildren();
    (hero.trustItems || []).forEach((item) => {
      const li = el("li");
      const icon = createIcon(item.icon, "trust-icon");
      li.append(icon, document.createTextNode(item.label));
      trustContainer.append(li);
    });

  }

  // ── User Guide ────────────────────────────────────────────────────────────────

  /**
   * Build a single interactive or disabled guide list item.
   * @param {object} entry - Guide entry descriptor with label, description, icon, and link.
   * @returns {HTMLLIElement} Rendered list item element.
   */
  function guideRow(entry) {
    // A row is only a link when it has somewhere to go. Without this, an entry
    // with no `link` renders an <a> to safeLink(undefined) - a chevron promising
    // a destination that does not exist.
    const interactive = Boolean(entry.link) && !entry.disabled;
    const item = el("li", entry.disabled ? "guide-item guide-item-disabled" : "guide-item");
    const link = el(interactive ? "a" : "span");
    if (interactive) {
      applyNavLink(link, state.config?.navigation, entry);
    }
    const copy = el("span", "guide-copy");
    copy.append(el("strong", "", entry.label), el("span", "", entry.description));
    const arrow = el("span", "guide-arrow", interactive ? "\u203a" : "");
    arrow.setAttribute("aria-hidden", "true");
    link.append(createIcon(entry.icon, "guide-icon"), copy, arrow);
    item.append(link);
    return item;
  }

  /**
   * Render the user guides list and all-guides destination link.
   * @param {object} userGuides - User guides configuration section.
   */
  function renderGuides(userGuides) {
    if (!userGuides) return;
    setText("#guide-title", userGuides.heading);
    const list = qs("#guide-list");
    if (list) {
      list.replaceChildren();
      (userGuides.entries || []).forEach((entry) => list.append(guideRow(entry)));
    }
    const allGuides = userGuides.allGuides;
    const allGuidesLink = qs("#all-guides-link");
    if (allGuidesLink && allGuides) {
      applyNavLink(allGuidesLink, state.config?.navigation, allGuides);
      allGuidesLink.textContent = allGuides.label || "";
    }
  }

  // ── About ─────────────────────────────────────────────────────────────────────

  /**
   * Expand {token} placeholders in prose text into hyperlink elements.
   * Tokens resolve from navigation items with optional fallback to links.
   * @param {HTMLElement} node - Target container element to populate.
   * @param {string} text - Source template text with token markers.
   * @param {Array<object>} [links] - Optional fallback link descriptors.
   */
  function renderIntro(node, text, links) {
    if (!node) return;
    node.replaceChildren();

    const nav = state.config?.navigation;
    const tokenMap = new Map();
    const addToken = (entry) => {
      if (!entry?.token) return;
      const resolved = resolveNav(nav, entry);
      tokenMap.set(entry.token, {
        label: entry.name || entry.label,
        link: resolved.link,
        linkTarget: resolved.linkTarget,
      });
    };
    (nav?.items || []).forEach(addToken);
    (links || []).forEach(addToken);

    for (const part of String(text || "").split(/(\{[a-zA-Z0-9_-]+\})/)) {
      const token = part.startsWith("{") && part.endsWith("}") ? part.slice(1, -1) : null;
      const target = token && tokenMap.get(token);
      if (target) {
        const a = el("a", "text-link", target.label);
        a.href = safeLink(target.link);
        applyLinkTarget(a, target);
        node.append(a);
      } else if (part) {
        node.append(document.createTextNode(part));
      }
    }
  }

  /**
   * Render the about section, grouped model cards, tooltips, and notices.
   * @param {object} about - About configuration section.
   */
  function renderAbout(about) {
    if (!about) return;
    setText("#about-title", about.heading);
    renderIntro(qs("#about-intro"), about.intro, about.links);

    setText("#models-heading", about.models?.heading);
    const list = qs("#models-list");
    if (list) {
      list.replaceChildren();
      // The flat config list is folded into per-group blocks so each group can be
      // kept whole when the list flows into columns.
      const groups = [];
      (about.models?.items || []).forEach((item) => {
        if (item.group) groups.push({ label: item.group, items: [] });
        else if (groups.length) groups[groups.length - 1].items.push(item);
      });

      // Fill the first column in config order, then the second, switching once
      // the first holds about half the content. Packing by shortest column
      // instead reorders the groups, which splits ones meant to read together
      // (Image generation and Embedding model) across columns.
      const cols = [el("div", "models-col"), el("div", "models-col")];
      const weight = (g) => g.items.length + 1;   // +1 for the group label
      const half = groups.reduce((n, g) => n + weight(g), 0) / 2;
      let filled = 0;
      let colIdx = 0;
      groups.forEach((group) => {
        const block = el("div", "model-group-block");
        const slug = group.label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
        block.append(el("span", `model-group-label model-group-${slug}`, group.label));
        const ul = el("ul", "models-list");
        group.items.forEach((item) => {
          const li = el("li", item.info ? "model-item has-info" : "model-item");
          const copy = el("span", "model-copy");
          const name = el("strong", "", item.label || item.name);
          copy.append(name);
          if (item.detail) copy.append(el("span", "model-detail", item.detail));
          li.append(copy);
          // Optional detail, shown only when the info icon itself is hovered or
          // focused - not the whole row, which made it fire anywhere near the name.
          if (item.info) {
            const id = `model-info-${String(item.name).replace(/[^a-z0-9]+/gi, "-")}`;
            const trigger = el("span", "model-info");
            trigger.tabIndex = 0;
            trigger.setAttribute("role", "button");
            trigger.setAttribute("aria-label", `About ${item.label || item.name}`);
            trigger.setAttribute("aria-describedby", id);
            const tip = el("span", "model-tooltip", item.info);
            tip.id = id;
            tip.setAttribute("role", "tooltip");
            // Tooltip is a child of the trigger so only the icon opens it, but it
            // stays positioned against the row (.model-item is the positioned
            // ancestor), so the existing left/right anchoring still applies.
            trigger.append(createIcon("information-outline", "model-info-icon"), tip);
            name.append(trigger);
          }
          ul.append(li);
        });
        block.append(ul);
        cols[colIdx].append(block);
        filled += weight(group);
        if (filled >= half) colIdx = 1;
      });
      cols.forEach((col) => list.append(col));
    }
    setText("#models-note", about.models?.note);

    const notices = qs("#notices-link");
    if (notices && about.notices) {
      applyNavLink(notices, state.config?.navigation, about.notices);
      notices.replaceChildren(document.createTextNode(about.notices.label || "Notices"));
    } else if (notices) {
      notices.remove();
    }
  }

  // ── Leaderboard — data ──────────────────────────────────────────────────────

  const LeaderboardAdapters = {
    /**
     * Return mock rows from configuration.
     * @param {object} source - Data source configuration.
     * @param {object} config - Full leaderboard configuration.
     * @returns {Promise<Array<object>>} Mock rows list.
     */
    async mock(source, config) {
      return config.mockData || [];
    },
    /**
     * Fetch leaderboard rows from a remote or local JSON endpoint.
     * @param {object} source - Data source configuration containing target URL.
     * @returns {Promise<Array<object>>} Parsed rows array.
     */
    async json(source) {
      if (!source.url) throw new Error("No leaderboard service URL is configured");
      const controller = new AbortController();
      const timeout = source.timeoutMs ?? 60000;
      const timer = timeout > 0 ? setTimeout(() => controller.abort(), timeout) : null;

      const cleanUrl = source.url.replace(/^\.\//, "");
      const candidates = [
        source.url,
        cleanUrl,
        cleanUrl.startsWith("/") ? cleanUrl : "/" + cleanUrl
      ];
      const uniqueCandidates = [...new Set(candidates)];

      let lastError = null;
      try {
        for (const targetUrl of uniqueCandidates) {
          try {
            const response = await fetch(targetUrl, {
              // Always GET — method and headers from config are not used;
              // arbitrary methods/headers are unnecessary attack surface.
              method: "GET",
              signal: controller.signal
            });
            if (response.ok) {
              const payload = await response.json();
              return getByPath(payload, source.responsePath || "") || [];
            }
            lastError = new Error(`HTTP ${response.status} when fetching ${targetUrl}`);
          } catch (err) {
            lastError = err;
          }
        }
        if (window.location.protocol === "file:") {
          throw new Error("Browsers block fetching local JSON files over file:// protocol. Please run a local static server.");
        }
        throw lastError || new Error(`Failed to fetch leaderboard JSON from ${source.url}`);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
  };

  /**
   * Retrieve a nested value from an object using a dot-delimited path.
   * @param {object} value - Source object to traverse.
   * @param {string} path - Dot-separated property path.
   * @returns {*} Value at specified path or undefined.
   */
  function getByPath(value, path) {
    if (!path) return value;
    return path.split(".").reduce((current, key) => current?.[key], value);
  }

  /**
   * Transform raw row properties according to a field mapping definition.
   * @param {object} row - Raw data feed record.
   * @param {object} fieldMap - Mapping of local property names to remote paths.
   * @returns {object} Transformed row object.
   */
  function mapRow(row, fieldMap) {
    if (!fieldMap) return row;
    return Object.fromEntries(Object.entries(fieldMap).map(([local, remote]) => [local, getByPath(row, remote)]));
  }

  /**
   * Fetch and map leaderboard rows using the configured data adapter.
   * @param {object} config - Leaderboard configuration object.
   * @returns {Promise<Array<object>>} Array of adapted row objects.
   */
  async function getLeaderboardRows(config) {
    const source = config.dataSource;
    const adapter = LeaderboardAdapters[source.adapter];
    if (!adapter) throw new Error(`Unknown leaderboard adapter: ${source.adapter}`);
    const rows = await adapter(source, config);
    if (!Array.isArray(rows)) throw new Error("Leaderboard adapter must return an array");
    return rows.map((row) => mapRow(row, source.fieldMap));
  }

  /**
   * Format a cell value according to column formatting rules.
   * @param {*} value - Raw value to format.
   * @param {object} column - Column configuration descriptor.
   * @returns {string} Formatted string representation.
   */
  function formatValue(value, column) {
    if (value === null || value === undefined || value === "") return "-";
    if (column.format === "decimal") return Number(value).toFixed(column.decimals ?? 1);
    if (column.format === "integer") return Math.round(Number(value)).toLocaleString();
    if (column.format === "context") return `${value}K`;
    return String(value);
  }

  /**
   * Compare two values for table sorting, handling numbers and strings.
   * @param {*} a - First value to compare.
   * @param {*} b - Second value to compare.
   * @param {"asc"|"desc"} direction - Sort direction.
   * @returns {number} Negative if a < b, positive if a > b, or 0.
   */
  function compareValues(a, b, direction) {
    const aNumber = Number(a);
    const bNumber = Number(b);
    const numeric = a !== "" && b !== "" && Number.isFinite(aNumber) && Number.isFinite(bNumber);
    const result = numeric ? aNumber - bNumber : String(a ?? "").localeCompare(String(b ?? ""));
    return direction === "asc" ? result : -result;
  }

  /**
   * Look up a model marker descriptor matching the given provider name.
   * @param {object} config - Leaderboard configuration object.
   * @param {string} provider - Model provider identifier.
   * @returns {object|undefined} Matching marker configuration if found.
   */
  function markerFor(config, provider) {
    return (config.markers || []).find((m) => (m.providers || []).includes(provider));
  }

  // ── Leaderboard — render ──────────────────────────────────────────────────────

  /**
   * Render footnote legend explaining symbols displayed in the table.
   * @param {object} config - Leaderboard configuration object.
   */
  function renderLeaderboardLegend(config) {
    const legend = qs("#leaderboard-legend");
    if (!legend) return;
    legend.replaceChildren();
    // Only explain a symbol that actually appears in the rendered table.
    const shown = (config.markers || []).filter((m) =>
      state.leaderboard.rows.some((r) => (m.providers || []).includes(r[config.display?.modelKey])));
    shown.forEach((m) => {
      const li = el("li");
      li.append(el("span", "legend-symbol", m.symbol), document.createTextNode(" " + m.note));
      legend.append(li);
    });
  }

  /**
   * Render the leaderboard table header, sorted body rows, and legend.
   */
  function renderLeaderboard() {
    const config = state.leaderboard.config;
    if (!config) return;
    const columns = (config.columns || []).filter((column) => column.visible !== false);
    const head = qs("#leaderboard-head");
    const body = qs("#leaderboard-body");
    head.replaceChildren();
    body.replaceChildren();

    columns.forEach((column) => {
      const th = el("th");
      const columnLabel = column.displayLabel || column.label;
      if (column.width) th.style.width = column.width;

      const labelContainer = column.sortable ? el("button") : el("span");
      if (column.sortable) {
        labelContainer.type = "button";
        labelContainer.dataset.sortKey = column.key;
        labelContainer.setAttribute("aria-label", `Sort by ${columnLabel}`);
        labelContainer.textContent = columnLabel;
        if (state.leaderboard.sortKey === column.key) labelContainer.append(document.createTextNode(state.leaderboard.sortDirection === "asc" ? " ↑" : " ↓"));
        labelContainer.addEventListener("click", () => setSort(column.key));
      } else {
        labelContainer.textContent = columnLabel;
      }
      th.append(labelContainer);

      if (column.info) {
        th.classList.add("has-info");
        const id = `col-info-${String(column.key).replace(/[^a-z0-9]+/gi, "-")}`;
        const trigger = el("span", "model-info");
        trigger.tabIndex = 0;
        trigger.setAttribute("role", "button");
        trigger.setAttribute("aria-label", `About ${columnLabel}`);
        trigger.setAttribute("aria-describedby", id);
        const tip = el("span", "model-tooltip", column.info);
        tip.id = id;
        tip.setAttribute("role", "tooltip");
        trigger.append(createIcon("information-outline", "model-info-icon"), tip);
        th.append(trigger);
      }

      head.append(th);
    });

    // maxRows caps the table at a top-N slice; 0, absent or non-numeric means
    // "show every model the feed returned".
    const maxRows = Number(config.display?.maxRows);
    const { rows: stateRows, sortKey, sortDirection } = state.leaderboard;
    const sortVal = (row) => sortKey === "vendor"
      ? ((config.vendors || {})[row[config.display?.modelKey]] || "")
      : row[sortKey];
    const sorted = [...stateRows]
      .sort((a, b) => compareValues(sortVal(a), sortVal(b), sortDirection));
    const rows = Number.isFinite(maxRows) && maxRows > 0 ? sorted.slice(0, maxRows) : sorted;

    if (!rows.length) {
      const tr = el("tr", "empty-row");
      const td = el("td", "", config.display?.emptyMessage || "No models");
      td.colSpan = columns.length;
      tr.append(td);
      body.append(tr);
      return;
    }

    const defaultNav = resolveNav(state.config?.navigation, config.fullLeaderboard?.link);

    rows.forEach((row, index) => {
      const tr = el("tr");
      columns.forEach((column) => {
        const td = el("td");
        if (column.key === "rank") {
          const rank = index + 1;
          td.className = "rank-icon";
          if (rank <= 9) {
            td.append(createIcon(`numeric-${rank}-circle`, rank <= 3 ? `rank-${rank}` : ""));
          } else {
            td.textContent = String(rank);
          }
          td.setAttribute("aria-label", `Rank ${rank}`);
        } else if (column.key === config.display?.modelKey) {
          const link = el("a", "model-link", formatValue(row[column.key], column));
          const modelHref = row[config.display?.modelLinkKey];
          link.href = safeLink(modelHref || defaultNav.link);
          applyLinkTarget(link, row.linkTarget || (modelHref ? null : defaultNav.linkTarget));
          td.append(link);
          const marker = markerFor(config, row[column.key]);
          if (marker) {
            const sup = el("sup", "model-marker", marker.symbol);
            sup.title = marker.note;
            td.append(sup);
          }
        } else if (column.key === "vendor") {
          // Not in the feed - looked up by model name from config.
          td.textContent = (config.vendors || {})[row[config.display?.modelKey]] || "-";
        } else {
          td.textContent = formatValue(row[column.key], column);
        }
        tr.append(td);
      });
      body.append(tr);
    });

    renderLeaderboardLegend(config);
  }

  /**
   * Toggle sort order or set new sort column, triggering table re-render.
   * @param {string} key - Column key to sort by.
   */
  function setSort(key) {
    const lb = state.leaderboard;
    if (lb.sortKey === key) lb.sortDirection = lb.sortDirection === "desc" ? "asc" : "desc";
    else {
      lb.sortKey = key;
      lb.sortDirection = "desc";
    }
    renderLeaderboard();
  }

  /**
   * Initialize leaderboard state, fetch data, render table, and set up polling.
   * @param {object} rawConfig - Raw leaderboard configuration section.
   */
  async function initLeaderboard(rawConfig) {
    if (!rawConfig) return;

    // Work on a local copy so we do not mutate the caller's config object.
    const config = Object.assign({}, rawConfig, {
      dataSource: Object.assign({}, rawConfig.dataSource),
    });

    // Expand any nav tokens in the data URL (e.g. "{link-leaderboard}/data/overall.json")
    // before the adapter sees it, so fetch() receives a real path.
    if (config.dataSource?.url) {
      config.dataSource.url = resolveNav(state.config?.navigation, config.dataSource.url).link;
    }

    const lb = state.leaderboard;
    lb.config = config;
    lb.sortKey = config.sorting?.defaultColumn || "score";
    lb.sortDirection = config.sorting?.defaultDirection || "desc";

    setText("#leaderboard-title", config.heading);
    qs("#leaderboard-subtitle").textContent = config.subtitle || "";
    const fullLink = config.fullLeaderboard;
    const fullLeaderboardEl = qs("#full-leaderboard-link");
    if (fullLeaderboardEl && fullLink) {
      applyNavLink(fullLeaderboardEl, state.config?.navigation, fullLink);
      fullLeaderboardEl.textContent = fullLink.label || "";
    }
    try {
      lb.rows = await getLeaderboardRows(config);
      qs("#leaderboard-notice").textContent = config.dataSource?.adapter === "mock" && config.display?.showDevelopmentNotice
        ? config.display?.developmentNotice
        : "";
    } catch (error) {
      if (config.dataSource?.fallbackToMock) {
        lb.rows = config.mockData || [];
        qs("#leaderboard-notice").textContent = config.display?.fallbackNotice || "";
      } else {
        lb.rows = [];
        qs("#leaderboard-notice").textContent = config.display?.errorMessage || "";
      }
      console.warn(error);
    }
    renderLeaderboard();

    if (config.dataSource?.adapter !== "mock" && config.dataSource?.pollIntervalMs > 0) {
      // Enforce bounds: minimum 10 s, maximum 5 min
      // prevent runaway polling from a misconfigured YAML value
      const POLL_MIN_MS = 10_000;
      const POLL_MAX_MS = 300_000;
      const interval = Math.min(
        Math.max(config.dataSource.pollIntervalMs, POLL_MIN_MS),
        POLL_MAX_MS
      );
      window.setInterval(async () => {
        try {
          lb.rows = await getLeaderboardRows(config);
          qs("#leaderboard-notice").textContent = "";
          renderLeaderboard();
        } catch (error) {
          console.warn("Leaderboard refresh failed", error);
        }
      }, interval);
    }
  }

  // ── App init ──────────────────────────────────────────────────────────────────

  /**
   * Display a user-facing error view when site configuration fails to load.
   * @param {Error} error - Configuration loading or parsing error.
   */
  function showConfigError(error) {
    const main = el("main", "config-error");
    main.append(
      el("h1", "", "BRAIN configuration error"),
      el("p", "", error.message)
    );
    const hint = el("p");
    hint.append(
      document.createTextNode("Serve this directory over HTTP and validate "),
      el("code", "", "config.yaml"),
      document.createTextNode(".")
    );
    main.append(hint);
    document.body.replaceChildren(main);
  }

  /**
   * Safely execute a section renderer and log a warning if it throws.
   * @param {string} label - Descriptive name of the component being rendered.
   * @param {Function} fn - Rendering callback function to execute.
   */
  function tryRender(label, fn) {
    try {
      fn();
    } catch (error) {
      console.warn(`[BRAIN] ${label} render failed:`, error);
    }
  }

  /**
   * Initialize portal configuration and render all page sections.
   */
  async function init() {
    try {
      const config = await Brain.loadConfig(["config.yaml"]);
      state.config = config;
      const { name, tagline, description } = config.brand || {};
      if (name) document.title = [name, tagline].filter(Boolean).join(" | ");
      if (description) qs('meta[name="description"]')?.setAttribute("content", description);
      tryRender("Navigation", () => renderSiteHeader(config, { activePath: "/" }));
      tryRender("Hero", () => renderHero(config));
      tryRender("Guides", () => renderGuides(config.userGuides));
      tryRender("Footer", () => renderSiteFooter(config));
      tryRender("About", () => renderAbout(config.about));
      await initLeaderboard(config.leaderboard);
    } catch (error) {
      showConfigError(error);
      console.error(error);
    }
  }

  init();
})();
