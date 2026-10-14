// Externalized module for leaderboard/index.html.
import { loadManifest, pct, scoreTint, fmtDate } from "./app.js";

/**
 * Initialize leaderboard matrix view, aggregate scores, and render table and glossary.
 */
async function main() {
  const matrixTable = document.getElementById("matrix");
  const statStrip = document.getElementById("stat-strip");

  // Detail views are not deployed in this build — default to false.
  let detailEnabled = false;
  try {
    const cfg = await Brain.configPromise;
    const flCfg = cfg?.leaderboard?.fullLeaderboard ?? {};
    if (Object.prototype.hasOwnProperty.call(flCfg, "detailEnabled")) {
      detailEnabled = flCfg.detailEnabled === true;
    }
  } catch (_) {
    detailEnabled = false;
  }

  let benchmarks;
  try {
    benchmarks = await loadManifest();
  } catch (err) {
    const tbody = matrixTable.querySelector("tbody");
    tbody.replaceChildren();
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.className = "empty-state";
    td.append(
      "Couldn\u2019t load data/manifest.json (" + err.message +
      "). If you\u2019re opening this file directly, serve it over http:// instead \u2014 e.g. "
    );
    const code = document.createElement("code");
    code.textContent = "python3 -m http.server";
    td.append(code, ".");
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  if (benchmarks.length === 0) {
    const tbody = matrixTable.querySelector("tbody");
    tbody.replaceChildren();
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.className = "empty-state";
    td.textContent = "No benchmarks yet.";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  // Summaries ride along in the manifest, so the matrix costs one small fetch
  // rather than downloading every benchmark's per-task detail.
  // providerScores[provider][benchmarkId] = summary row
  const providerScores = {};
  benchmarks.forEach(b => {
    for (const s of b.summary || []) {
      providerScores[s.provider] ??= {};
      providerScores[s.provider][b.id] = s;
    }
  });

  const providers = Object.keys(providerScores).map(name => {
    const perBenchmark = benchmarks.map(b => providerScores[name][b.id]?.passRate ?? null);
    const covered = perBenchmark.filter(v => v !== null);
    const overall = covered.length ? covered.reduce((a, v) => a + v, 0) / covered.length : null;
    return { name, perBenchmark, overall };
  }).sort((a, b) => (b.overall ?? -1) - (a.overall ?? -1));

  // headline stats
  const latestUpdate = benchmarks.reduce((max, b) => (b.lastUpdated > max ? b.lastUpdated : max), "");
  statStrip.append(
    statBlock(benchmarks.length, "benchmarks tracked"),
    statBlock(providers.length, "models evaluated"),
    statBlock(fmtDate(latestUpdate), "last updated")
  );

  // header row
  const thead = matrixTable.querySelector("thead tr");
  benchmarks.forEach(b => {
    const th = document.createElement("th");
    th.className = "bench-col";
    const el = document.createElement(detailEnabled ? "a" : "span");
    if (detailEnabled) el.href = `detail.html?benchmark=${encodeURIComponent(b.id)}`;
    el.textContent = b.displayName;
    el.title = [b.fullName || b.displayName, b.description, b.format]
      .filter(Boolean).join(" — ");
    th.appendChild(el);
    thead.appendChild(th);
  });
  const overallTh = document.createElement("th");
  overallTh.className = "bench-col";
  overallTh.textContent = "Overall";
  thead.appendChild(overallTh);

  // body rows
  const tbody = matrixTable.querySelector("tbody");
  tbody.replaceChildren();
  providers.forEach((p, i) => {
    const tr = document.createElement("tr");
    const nameCell = document.createElement("td");
    nameCell.className = "model-col";
    const rank = document.createElement("span");
    rank.className = "rank-num";
    rank.textContent = i + 1;
    const name = document.createElement("span");
    name.className = "model-name";
    name.textContent = p.name;
    nameCell.append(rank, name);
    tr.appendChild(nameCell);

    benchmarks.forEach((b, bi) => {
      const td = document.createElement("td");
      td.className = "score-cell";
      const v = p.perBenchmark[bi];
      if (v === null) {
        td.classList.add("na");
        td.textContent = "—";
      } else {
        const el = document.createElement(detailEnabled ? "a" : "span");
        if (detailEnabled) el.href = `detail.html?benchmark=${encodeURIComponent(b.id)}`;
        el.setAttribute("style", scoreTint(v));
        el.textContent = pct(v);
        td.appendChild(el);
      }
      tr.appendChild(td);
    });

    const overallTd = document.createElement("td");
    overallTd.className = "overall-cell";
    overallTd.textContent = pct(p.overall);
    tr.appendChild(overallTd);

    tbody.appendChild(tr);
  });

  renderGlossary(benchmarks, detailEnabled);
}

/**
 * Render glossary cards describing each tracked benchmark in column order.
 * @param {Array<object>} benchmarks - List of benchmark definition objects.
 * @param {boolean} detailEnabled - Whether links to detailed views should be active.
 */
function renderGlossary(benchmarks, detailEnabled) {
  const glossary = document.getElementById("glossary");
  glossary.replaceChildren();
  benchmarks.forEach(b => {
    // Use an anchor when detail is enabled, a plain div otherwise.
    const card = document.createElement(detailEnabled ? "a" : "div");
    card.className = "glossary-card";
    if (detailEnabled) {
      card.href = `detail.html?benchmark=${encodeURIComponent(b.id)}`;
    }

    const name = document.createElement("span");
    name.className = "glossary-name";
    name.textContent = b.displayName;

    const count = document.createElement("span");
    count.className = "glossary-count";
    count.textContent = `${b.taskCount.toLocaleString()} questions`;

    const head = document.createElement("div");
    head.className = "glossary-head";
    head.append(name, count);

    const desc = document.createElement("p");
    desc.className = "glossary-desc";
    desc.textContent = b.description || b.fullName || "";

    card.append(head, desc);
    if (b.format) {
      const fmt = document.createElement("span");
      fmt.className = "glossary-format";
      fmt.textContent = b.format;
      card.appendChild(fmt);
    }
    glossary.appendChild(card);
  });
}

/**
 * Create a stat summary card element with value and label.
 * @param {string|number} value - Highlighted stat value.
 * @param {string} label - Descriptive label for the stat.
 * @returns {HTMLDivElement} Rendered stat container element.
 */
function statBlock(value, label) {
  const wrap = document.createElement("div");
  wrap.className = "stat";
  const v = document.createElement("span");
  v.className = "stat-value";
  v.textContent = value;
  const l = document.createElement("span");
  l.className = "stat-label";
  l.textContent = label;
  wrap.append(v, l);
  return wrap;
}

main();
