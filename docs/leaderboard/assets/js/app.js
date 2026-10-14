// Shared helpers for the benchmark leaderboard site.
// No build step: plain ES modules, loaded directly by the browser.

/**
 * Fetch and return benchmark catalog definitions from manifest.json.
 * @returns {Promise<Array<object>>} List of benchmark catalog entries.
 */
export async function loadManifest() {
  const res = await fetch("data/manifest.json");
  if (!res.ok) throw new Error(`manifest.json: ${res.status}`);
  const manifest = await res.json();
  return manifest.benchmarks || [];
}

/**
 * Fetch detailed task dataset for a specific benchmark file.
 * @param {string} file - Filename of benchmark JSON in data directory.
 * @returns {Promise<object>} Parsed benchmark dataset.
 */
export async function loadBenchmark(file) {
  const res = await fetch(`data/${file}`);
  if (!res.ok) throw new Error(`${file}: ${res.status}`);
  return res.json();
}

/**
 * Format a decimal ratio as a localized percentage string.
 * @param {number} x - Numeric value between 0 and 1.
 * @param {number} [digits=0] - Number of fraction digits.
 * @returns {string} Formatted percentage or em-dash if missing.
 */
export function pct(x, digits = 0) {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  return (x * 100).toFixed(digits) + "%";
}

/**
 * Format a number with fixed decimal precision.
 * @param {number} x - Numeric value to format.
 * @param {number} [digits=1] - Number of fraction digits.
 * @returns {string} Formatted number string or em-dash if missing.
 */
export function num(x, digits = 1) {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  return Number(x).toFixed(digits);
}

/**
 * Format milliseconds into human-readable milliseconds or seconds.
 * @param {number} x - Duration in milliseconds.
 * @returns {string} Formatted duration string or em-dash if missing.
 */
export function ms(x) {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  return x >= 1000 ? (x / 1000).toFixed(1) + "s" : Math.round(x) + "ms";
}

/**
 * Format an ISO date string into a localized UTC short date.
 * Formatted in UTC to match how it was parsed to avoid local time offset issues.
 * @param {string} d - ISO date string (YYYY-MM-DD).
 * @returns {string} Formatted date (e.g. "Sep 1, 2026") or em-dash if missing.
 */
export function fmtDate(d) {
  if (!d) return "—";
  return new Date(d + "T00:00:00Z").toLocaleDateString("en-US", {
    year: "numeric", month: "short", day: "numeric", timeZone: "UTC"
  });
}

/**
 * Return inline background tint style based on score performance thresholds.
 * @param {number} score - Score value between 0 and 1.
 * @returns {string} Inline CSS style string or empty string.
 */
export function scoreTint(score) {
  if (score === null || score === undefined) return "";
  if (score >= 0.9) return "background: var(--pass-dim);";
  if (score < 0.6) return "background: var(--fail-dim);";
  return "";
}

/**
 * Serialize an object of key-value pairs into a URL query parameter string.
 * @param {object} params - Key-value map of parameters.
 * @returns {string} Serialized query string.
 */
export function qs(params) {
  return new URLSearchParams(params).toString();
}

/**
 * Retrieve a query parameter value from the current window URL.
 * @param {string} name - Parameter name to lookup.
 * @returns {string|null} Parameter value or null if not present.
 */
export function getParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

/**
 * Create an HTML element with attributes, event listeners, and children.
 * @param {string} tag - HTML tag name.
 * @param {object} [attrs={}] - Attribute key-value map or event handlers.
 * @param {Array<Node|string>|Node|string} [children=[]] - Child nodes or text strings.
 * @returns {HTMLElement} Created DOM element.
 */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined) continue;
    node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
}
