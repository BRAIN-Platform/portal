/**
 * config-loader.js — Shared site utilities for BRAIN Portal.
 * Exposes `window.Brain` with:
 *   - YAML parsing helpers (`parseYaml`, `safeLink`, `normalizeIconName`)
 *   - Link helpers (`setExternalRel`, `applyLinkTarget`)
 *   - Navigation token resolver (`resolveNav`, `applyNavLink`)
 *   - Config fetcher (`loadConfig`)
 *   - Shared page renderers (`renderSiteHeader`, `renderSiteFooter`)
 *
 * Must be loaded before any page script that reads from `window.Brain`.
 */
(function () {
  "use strict";

  // ── Private helpers ──────────────────────────────────────────────────────────

  /**
   * Validate and return a safe Material Design Icons name.
   * Falls back to "help-circle-outline" if the name contains invalid characters.
   * @param {string} name - Icon slug to normalize.
   * @returns {string} Normalized icon slug.
   */
  function normalizeIconName(name) {
    return /^[a-z0-9-]+$/.test(String(name || "")) ? name : "help-circle-outline";
  }

  /**
   * Return the link if it is a safe, recognized scheme; otherwise "#".
   * Uses an allow-list so dangerous schemes are rejected by default.
   * @param {string} link - URL or path to validate.
   * @returns {string} The original link if safe, or "#".
   */
  function safeLink(link) {
    if (typeof link !== "string") return "#";
    const trimmed = link.trim();
    if (trimmed === "") return trimmed;
    // Reject protocol-relative URLs and dangerous pseudo-protocols.
    if (/^(?:\/\/[a-z0-9]|javascript:|data:|vbscript:)/i.test(trimmed)) return "#";
    // Allow relative paths, fragment-only, nav tokens, https, http, mailto.
    if (/^(?:https?:|mailto:|[\/\#\.\{]|[a-zA-Z0-9_-])/i.test(trimmed)) return trimmed;
    return "#";
  }

  /**
   * Set rel="noopener noreferrer" on an anchor element when its destination
   * is cross-origin (i.e. not a relative path and not same-origin).
   * Call after setting href.
   * @param {HTMLAnchorElement} anchor - The anchor element to update.
   */
  function setExternalRel(anchor) {
    const href = anchor.getAttribute("href") || "";
    if (href.startsWith("/") || href.startsWith("#") || href === "") {
      if (anchor.target === "_blank") anchor.rel = "noopener noreferrer";
      return;
    }
    try {
      const url = new URL(href, window.location.href);
      if (url.origin !== window.location.origin || anchor.target === "_blank") {
        anchor.rel = "noopener noreferrer";
      }
    } catch (_) {
      if (anchor.target === "_blank") anchor.rel = "noopener noreferrer";
    }
  }

  /**
   * Read the target (e.g. "_blank") declared on a config descriptor.
   * @param {object|null} [descriptor] - Object with linkTarget or target.
   * @returns {string|null} Declared target, or null when absent.
   */
  function getLinkTarget(descriptor) {
    return descriptor?.linkTarget || descriptor?.target || null;
  }

  /**
   * Apply an optional target (e.g. "_blank") to an anchor and refresh its rel.
   * Call after setting href.
   * @param {HTMLAnchorElement} anchor - The anchor element to update.
   * @param {string|object} [target] - Target window/tab, or a descriptor
   *   carrying linkTarget/target; ignored if empty.
   */
  function applyLinkTarget(anchor, target) {
    const value = typeof target === "string" ? target : getLinkTarget(target);
    if (value) anchor.target = value;
    setExternalRel(anchor);
  }

  // ── YAML parser ──────────────────────────────────────────────────────────────

  /**
   * Parse a scalar YAML string into its primitive JS representation.
   * Handles booleans, nulls, numbers, inline arrays, and quoted strings.
   * @param {*} v - Raw value or string to parse.
   * @returns {*} Parsed scalar value, array, object, or string.
   */
  function parseYamlVal(v) {
    if (v === undefined || v === null) return "";
    v = String(v).trim();
    if (v === "true") return true;
    if (v === "false") return false;
    if (v === "null" || v === "~") return null;
    if (v === "{}" || (v.startsWith("{") && v.endsWith("}"))) {
      try { return JSON.parse(v); } catch (e) {
        if (/^\{[a-zA-Z0-9_.-]+\}$/.test(v)) return v;
        return {};
      }
    }
    if (v === "[]" || (v.startsWith("[") && v.endsWith("]"))) {
      try { return JSON.parse(v); } catch (e) { return []; }
    }
    if (!isNaN(v) && v !== "") return Number(v);
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      return v.slice(1, -1);
    }
    return v;
  }

  /**
   * Find the character index where an unquoted comment starts in a line.
   * Ignores '#' characters enclosed in single or double quotes.
   * @param {string} line - Source line to inspect.
   * @returns {number} 0-based index of comment delimiter, or -1 if none.
   */
  function findCommentStart(line) {
    let inSingle = false, inDouble = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === "'" && !inDouble) inSingle = !inSingle;
      else if (ch === '"' && !inSingle) inDouble = !inDouble;
      else if (ch === "#" && !inSingle && !inDouble && (i === 0 || /\s/.test(line[i - 1]))) return i;
    }
    return -1;
  }

  /**
   * Minimal indented YAML parser supporting nested objects, lists, and anchors.
   * Strips unquoted comments and ignores prototype pollution keys.
   * @param {string} str - Raw YAML document text.
   * @returns {object} Parsed JavaScript object hierarchy.
   */
  function parseYaml(str) {
    const lines = str.split(/\r?\n/);
    const root = {};
    const stack = [{ indent: -1, container: root, type: "object" }];
    const anchors = {};

    function parseVal(v) {
      if (typeof v === "string") {
        const trimmed = v.trim();
        if (trimmed.startsWith("*")) {
          const alias = trimmed.slice(1).trim();
          if (Object.prototype.hasOwnProperty.call(anchors, alias)) {
            return anchors[alias];
          }
        }
        if (trimmed.startsWith("&")) {
          const match = trimmed.match(/^&([a-zA-Z0-9_-]+)\s*(.*)$/);
          if (match) {
            const anchorName = match[1];
            const parsed = parseYamlVal(match[2]);
            anchors[anchorName] = parsed;
            return parsed;
          }
        }
      }
      return parseYamlVal(v);
    }

    const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);
    for (let i = 0; i < lines.length; i++) {
      let rawLine = lines[i];
      // `#` only starts a comment when it is outside quotes and at a word
      // boundary. Stripping from the first `#` unconditionally silently
      // truncated any value containing one (a literal "#", a URL fragment, C#).
      const commentIdx = findCommentStart(rawLine);
      if (commentIdx !== -1) rawLine = rawLine.slice(0, commentIdx);
      if (!rawLine.trim()) continue;

      const indent = rawLine.search(/\S/);
      const line = rawLine.trim();

      while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
        stack.pop();
      }
      const current = stack[stack.length - 1];

      if (line.startsWith("- ")) {
        const itemText = line.slice(2).trim();
        let targetArray;

        if (current.type === "array") {
          targetArray = current.container;
        } else {
          const parentObj = current.container;
          const lastKey = current.lastKey;
          if (!Array.isArray(parentObj[lastKey])) {
            parentObj[lastKey] = [];
          }
          targetArray = parentObj[lastKey];
          stack.push({ indent: indent, container: targetArray, type: "array" });
        }

        if (itemText.includes(":")) {
          const colonIdx = itemText.indexOf(":");
          const k = itemText.slice(0, colonIdx).trim();
          if (UNSAFE_KEYS.has(k)) continue;
          const v = itemText.slice(colonIdx + 1).trim();
          const newItemObj = {};
          if (v !== "") {
            newItemObj[k] = parseVal(v);
          }
          targetArray.push(newItemObj);
          stack.push({ indent: indent + 2, container: newItemObj, type: "object", lastKey: k });
        } else {
          targetArray.push(parseVal(itemText));
        }
      } else if (line.includes(":")) {
        const colonIdx = line.indexOf(":");
        const k = line.slice(0, colonIdx).trim();
        if (UNSAFE_KEYS.has(k)) continue;
        const v = line.slice(colonIdx + 1).trim();

        let targetObj = current.container;
        if (current.type === "array") {
          targetObj = current.container[current.container.length - 1];
        }

        if (v === "") {
          targetObj[k] = {};
          current.lastKey = k;
          stack.push({ indent: indent, container: targetObj[k], type: "object" });
        } else {
          targetObj[k] = parseVal(v);
          current.lastKey = k;
        }
      } else {
        if (current.type === "array" && current.container.length > 0) {
          const lastIdx = current.container.length - 1;
          const prev = current.container[lastIdx];
          if (typeof prev === "string") {
            current.container[lastIdx] = prev + " " + line;
          } else if (typeof prev === "object" && prev !== null && current.lastKey) {
            // A wrapped value inside a list item, e.g.
            //   - label: API
            //     description: a long line that
            //       continues here
            // Without this the continuation was silently dropped and the value
            // was truncated at the first line.
            const p = prev[current.lastKey] || "";
            prev[current.lastKey] = (p ? p + " " : "") + line;
          }
        } else if (current.lastKey && current.container) {
          const prev = current.container[current.lastKey] || "";
          current.container[current.lastKey] = (prev ? prev + " " : "") + line;
        }
      }
    }

    return root;
  }

  // ── Navigation resolver ──────────────────────────────────────────────────────

  /**
   * Normalize a navigation target (descriptor or string) to { id, suffix, raw }.
   * String forms: "{token}", "{token}/suffix" (suffix is preserved and
   * appended to the resolved base path, e.g. "{link-guide}/chat"), or a bare
   * token/label/link.
   * Descriptor forms: { link } (preferred), { token } or { label }.
   * `raw` is the original trimmed string (null for token/label descriptors).
   * @param {object|string} target
   * @returns {{id: string, suffix: string, raw: string|null}|null}
   */
  function parseNavTarget(target) {
    if (!target) return null;
    if (typeof target === "object") {
      if (target.link) return parseNavTarget(String(target.link));
      const t = target.token || target.label;
      if (!t) return null;
      const id = String(t).replace(/^\{|\}$/g, "").trim();
      return { id, suffix: "", raw: null };
    }
    const raw = String(target).trim();
    const m = raw.match(/^\{([a-zA-Z0-9_-]+)\}(.*)$/);
    return m ? { id: m[1], suffix: m[2], raw } : { id: raw, suffix: "", raw };
  }

  /**
   * Match a parsed target against navigation.items[].token, label, or link.
   * Label/link (case-insensitive) matches apply only without a suffix, since a
   * compound "{token}/suffix" must reference a token.
   * @param {object} nav - config.navigation object
   * @param {{id: string, suffix: string}} parsed - result of parseNavTarget
   * @returns {object|null} matching navigation item or null
   */
  function matchNavItem(nav, { id, suffix }) {
    const lower = id.toLowerCase();
    return (nav?.items || []).find((item) =>
      item.token === id ||
      (!suffix && (
        (item.label && item.label.toLowerCase() === lower) ||
        (item.link && item.link.toLowerCase() === lower)
      ))
    ) || null;
  }

  /**
   * Resolve both the destination link and the target window/tab (e.g.
   * "_blank") for a navigation target with a single parse and lookup.
   * Accepts an item descriptor ({ link, token, label, linkTarget }) or a
   * string identifier (e.g. "{link-chat}").
   * Link falls back to the original identifier, or "#" for unresolvable
   * token/label descriptors. Target is the descriptor's own linkTarget/target,
   * else the matching navigation item's, else null.
   * @param {object} nav - config.navigation object
   * @param {object|string} target - descriptor object or identifier string
   * @returns {{link: string, linkTarget: string|null}}
   */
  function resolveNav(nav, target) {
    const ownLinkTarget = getLinkTarget(target);
    const parsed = parseNavTarget(target);
    if (!parsed) return { link: "#", linkTarget: ownLinkTarget };
    const item = matchNavItem(nav, parsed);
    if (!item) return { link: parsed.raw ?? "#", linkTarget: ownLinkTarget };
    const { suffix } = parsed;
    const link = suffix
      ? item.link.replace(/\/$/, "") +
      (suffix.startsWith("/") ? suffix : "/" + suffix)
      : item.link;
    return { link, linkTarget: ownLinkTarget || getLinkTarget(item) };
  }

  /**
   * Resolve a navigation target and apply its href, target and rel to an
   * anchor in one step.
   * @param {HTMLAnchorElement} anchor - The anchor element to update.
   * @param {object} nav - config.navigation object
   * @param {object|string} target - descriptor object or identifier string
   */
  function applyNavLink(anchor, nav, target) {
    const resolved = resolveNav(nav, target);
    anchor.href = safeLink(resolved.link);
    applyLinkTarget(anchor, resolved.linkTarget);
  }

  // ── Config loader ────────────────────────────────────────────────────────────

  /**
   * Fetch and parse config.yaml, trying each URL in candidates in order.
   * @param {string|string[]} candidates - URL or ordered array of URLs to try
   * @returns {Promise<object>} parsed config object
   */
  async function loadConfig(candidates) {
    const urls = Array.isArray(candidates) ? candidates : [candidates];
    let lastError;
    for (const url of urls) {
      try {
        const response = await fetch(url);
        if (!response.ok) {
          lastError = new Error("Configuration request failed (" + response.status + "): " + url);
          continue;
        }
        const text = await response.text();
        try {
          return JSON.parse(text);
        } catch (_) {
          try {
            return parseYaml(text);
          } catch (yamlErr) {
            throw new Error("config.yaml could not be parsed. Verify YAML syntax. See README.md.");
          }
        }
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new Error("config.yaml could not be loaded.");
  }

  // ── Header renderer ──────────────────────────────────────────────────────────

  /**
   * Render the shared site header: brand, nav items, sign-in item, mobile toggle.
   * Builds and injects the full header structure into .header-inner so no
   * hardcoded markup is required in the HTML beyond the empty container.
   * @param {object} config - full parsed config object
   * @param {object} [options]
   * @param {string} [options.activePath="/"] - URL path of the current page
   */
  function renderSiteHeader(config, options) {
    const activePath = (options && options.activePath) ? options.activePath : "/";
    const basePath = (options && options.basePath) ? options.basePath : "";
    const brand = config.brand || {};
    const nav = config.navigation || {};

    /**
     * Prepend basePath to relative URLs that do not have special schemes.
     * @param {string} url - Destination URL or path.
     * @returns {string} Qualified URL.
     */
    function qualifyUrl(url) {
      if (!basePath || typeof url !== "string") return url;
      if (/^(?:https?:|mailto:|[\/\#\{])/i.test(url)) return url;
      return basePath + url.replace(/^\.\//, "");
    }

    const headerInner = document.querySelector(".header-inner");
    if (!headerInner) return;
    headerInner.replaceChildren();

    // --- Brand ---
    const brandEl = document.createElement("a");
    brandEl.className = "brand";
    brandEl.href = safeLink(qualifyUrl(brand.homeLink || "./"));
    brandEl.setAttribute("aria-label", (brand.name || "BRAIN") + " home");
    const brandCopy = document.createElement("span");
    brandCopy.className = "brand-copy";
    const brandName = document.createElement("strong");
    brandName.id = "brand-name";
    brandName.textContent = brand.name || "BRAIN";
    const brandTagline = document.createElement("small");
    brandTagline.id = "brand-tagline";
    brandTagline.textContent = brand.tagline || "";
    brandCopy.append(brandName, brandTagline);
    brandEl.append(brandCopy);
    headerInner.append(brandEl);

    // --- Mobile toggle ---
    const toggle = document.createElement("button");
    toggle.className = "nav-toggle";
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-controls", "primary-nav");
    const srOnly = document.createElement("span");
    srOnly.className = "sr-only";
    srOnly.textContent = "Toggle navigation";
    toggle.append(srOnly);
    for (let i = 0; i < 3; i++) toggle.append(document.createElement("span"));
    headerInner.append(toggle);

    // --- Primary nav ---
    const navEl = document.createElement("nav");
    navEl.id = "primary-nav";
    navEl.className = "primary-nav";
    navEl.setAttribute("aria-label", "Primary navigation");
    const navList = document.createElement("ul");
    navList.id = "nav-list";

    const normalizedActive = String(activePath).replace(/^\.\//, "").replace(/\/$/, "");
    (nav.items || []).forEach(function (item) {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = safeLink(qualifyUrl(item.link));
      a.textContent = item.label || "";
      applyLinkTarget(a, item);
      const itemPath = String(item.link || "").replace(/^\.\//, "").replace(/\/$/, "");
      if (itemPath === normalizedActive) {
        a.setAttribute("aria-current", "page");
      }
      li.append(a);
      navList.append(li);
    });

    if (nav.signInLink) {
      const li = document.createElement("li");
      li.className = "nav-sign-in";
      const a = document.createElement("a");
      a.id = "sign-in-link";
      a.href = safeLink(qualifyUrl(nav.signInLink));
      applyLinkTarget(a, nav.signInLinkTarget || nav.signInTarget);
      const icon = document.createElement("span");
      icon.id = "sign-in-icon";
      icon.setAttribute("aria-hidden", "true");
      const iconName = normalizeIconName(nav.signInIcon || "account-circle-outline");
      icon.className = "mdi mdi-" + iconName + " button-icon";
      a.append(icon, document.createTextNode(" Sign In"));
      li.append(a);
      navList.append(li);
    }

    navEl.append(navList);
    headerInner.append(navEl);

    // --- Mobile toggle wiring ---
    toggle.addEventListener("click", function () {
      const open = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!open));
      navEl.classList.toggle("open", !open);
    });
    navList.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () {
        toggle.setAttribute("aria-expanded", "false");
        navEl.classList.remove("open");
      });
    });
  }

  // ── Footer renderer ──────────────────────────────────────────────────────────

  /**
   * Render the shared site footer: security note, legal links, support link, copyright.
   * Builds and injects the full footer structure into .footer-inner so no
   * hardcoded markup is required in the HTML beyond the empty container.
   * @param {object} config - full parsed config object
   */
  function renderSiteFooter(config, options) {
    const basePath = (options && options.basePath) ? options.basePath : "";
    const footer = config.footer || {};

    /**
     * Prepend basePath to relative URLs that do not have special schemes.
     * @param {string} url - Destination URL or path.
     * @returns {string} Qualified URL.
     */
    function qualifyUrl(url) {
      if (!basePath || typeof url !== "string") return url;
      if (/^(?:https?:|mailto:|[\/\#\{])/i.test(url)) return url;
      return basePath + url.replace(/^\.\//, "");
    }

    const footerInner = document.querySelector(".footer-inner");
    if (!footerInner) return;
    footerInner.replaceChildren();

    // --- Security note ---
    const secNote = document.createElement("p");
    secNote.className = "security-note";
    const secIcon = document.createElement("span");
    secIcon.className = "mdi mdi-shield-lock-outline";
    secIcon.setAttribute("aria-hidden", "true");
    const secText = document.createElement("span");
    secText.id = "footer-security";
    secText.textContent = footer.securityText || "";
    secNote.append(secIcon, document.createTextNode(" "), secText);
    footerInner.append(secNote);

    // --- Legal nav ---
    const navEl = document.createElement("nav");
    navEl.setAttribute("aria-label", "Legal");
    const linksList = document.createElement("ul");
    linksList.id = "footer-links";
    (footer.links || []).forEach(function (item) {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = safeLink(qualifyUrl(item.link));
      a.textContent = item.label || "";
      applyLinkTarget(a, item);
      li.append(a);
      linksList.append(li);
    });
    navEl.append(linksList);
    footerInner.append(navEl);

    // --- Footer bottom: support + copyright ---
    const bottomDiv = document.createElement("div");
    bottomDiv.className = "footer-bottom";

    const supportNote = document.createElement("p");
    supportNote.className = "support-note";
    supportNote.append(document.createTextNode("Need help? "));
    const supportLink = document.createElement("a");
    supportLink.id = "support-link";
    supportLink.href = safeLink(qualifyUrl(footer.supportLink || "support"));
    supportLink.textContent = "Contact Support";
    applyLinkTarget(
      supportLink,
      footer.supportLinkTarget || footer.supportTarget
    );
    supportNote.append(supportLink);
    bottomDiv.append(supportNote);

    if (footer.copyright) {
      const copyrightEl = document.createElement("p");
      copyrightEl.id = "copyright";
      copyrightEl.textContent = footer.copyright.replace("{year}", String(new Date().getFullYear()));
      bottomDiv.append(copyrightEl);
    }

    footerInner.append(bottomDiv);
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  window.Brain = Object.assign(window.Brain || {}, {
    parseYaml: parseYaml,
    safeLink: safeLink,
    setExternalRel: setExternalRel,
    applyLinkTarget: applyLinkTarget,
    resolveNav: resolveNav,
    applyNavLink: applyNavLink,
    normalizeIconName: normalizeIconName,
    loadConfig: loadConfig,
    renderSiteHeader: renderSiteHeader,
    renderSiteFooter: renderSiteFooter,
  });
})();
