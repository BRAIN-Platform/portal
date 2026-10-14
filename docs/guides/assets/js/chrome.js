// Shared site chrome loader for guides pages.
// Renders the portal header and footer from the shared config.yaml.
(function () {
  "use strict";
  Brain.configPromise = Brain.loadConfig(["../config.yaml", "config.yaml"]);
  Brain.configPromise.then(function (cfg) {
    Brain.state = { config: cfg };
    Brain.renderSiteHeader(cfg, { activePath: "guides", basePath: "../" });
    Brain.renderSiteFooter(cfg, { basePath: "../" });
  }).catch(function (e) {
    console.warn("Site chrome unavailable (portal config not reachable):", e);
  });
})();
