/**
 * Main controller for guides/index.html.
 * Loads configuration and renders the list of user guide entries.
 */
async function main() {
  const {
    safeLink, resolveNav, applyLinkTarget, normalizeIconName
  } = window.Brain;

  /**
   * Create an HTML element with optional class name and text content.
   * @param {string} tag - HTML tag name to create.
   * @param {string} [className] - Optional CSS class name.
   * @param {string} [text] - Optional text content.
   * @returns {HTMLElement} Created DOM element.
   */
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /**
   * Create an aria-hidden Material Design Icons span element.
   * @param {string} name - Icon name identifier.
   * @param {string} [className] - Optional additional CSS class names.
   * @returns {HTMLSpanElement} Icon span element.
   */
  function createIcon(name, className) {
    const normalized = normalizeIconName(name);
    const icon = el("span", `mdi mdi-${normalized} ${className || ""}`.trim());
    icon.setAttribute("aria-hidden", "true");
    return icon;
  }

  /**
   * Build a single interactive or disabled guide table row.
   * Adjusts links targeting the current guides directory.
   * @param {object} entry - Guide entry descriptor with label, description, icon, and link.
   * @param {object} nav - Site navigation configuration.
   * @returns {HTMLTableRowElement} Rendered table row element.
   */
  function guideRow(entry, nav) {
    const interactive = Boolean(entry.link) && !entry.disabled;
    const tr = el("tr", entry.disabled ? "guide-row-disabled" : "");

    // 1. Guide name
    const tdName = el("td", "guide-col-name");
    const nameWrap = el("div", "guides-name-wrapper");
    if (entry.icon) {
      nameWrap.append(createIcon(entry.icon, "guide-entry-icon"));
    }
    nameWrap.append(el("span", "guide-name-text", entry.label));
    tdName.append(nameWrap);

    // 2. Guide description
    const tdDesc = el("td", "guide-col-desc", entry.description || "");

    // 3. Link to the guide (or unavailable icon if disabled)
    const tdLink = el("td", "guide-col-link");
    if (interactive) {
      const resolved = resolveNav(nav, entry);
      let dest = resolved.link;
      // When inside guides/ directory, adjust relative link to target file in this directory
      if (dest.startsWith("guides/")) {
        dest = dest.replace(/^guides\//, "");
      }
      const link = el("a", "guide-link-action");
      link.href = safeLink(dest);
      applyLinkTarget(link, resolved.linkTarget);
      link.setAttribute("aria-label", `Open ${entry.label}`);
      const linkText = el("span", "", "Open guide");
      const arrowIcon = createIcon("arrow-right", "guide-arrow-icon");
      link.append(linkText, arrowIcon);
      tdLink.append(link);
    } else {
      const disabledWrap = el("span", "guide-link-disabled");
      disabledWrap.title = "Link not available";
      disabledWrap.setAttribute("aria-label", "Link not available");
      const disabledIcon = createIcon("link-off", "disabled-icon");
      const srOnly = el("span", "sr-only", "Link not available");
      disabledWrap.append(disabledIcon, srOnly);
      tdLink.append(disabledWrap);
    }

    tr.append(tdName, tdDesc, tdLink);
    return tr;
  }

  try {
    const config = await Brain.configPromise;
    const guides = config.userGuides || {};
    const title = document.getElementById("guide-page-title");
    if (title && guides.heading) title.textContent = guides.heading;

    const tableBody = document.getElementById("guide-table-body");
    if (tableBody) {
      tableBody.replaceChildren();
      (guides.entries || []).forEach(entry => {
        tableBody.append(guideRow(entry, config.navigation));
      });
    }

    // Fallback support if legacy list container is present
    const list = document.getElementById("guide-list");
    if (list) {
      list.replaceChildren();
      (guides.entries || []).forEach(entry => {
        list.append(guideRow(entry, config.navigation));
      });
    }
  } catch (err) {
    console.warn("Could not load guides page:", err);
  }
}

main();
