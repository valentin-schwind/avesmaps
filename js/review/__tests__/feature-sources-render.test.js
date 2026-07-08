const assert = require("assert");
const { renderFeatureSourceEditorHtml } = require("../review-feature-sources.js");
const html = renderFeatureSourceEditorHtml(
  { wiki_url: "https://wiki/x", sources: [
    { source_id: 7, url: "https://f-shop.de/a", label: "F-Shop", type: "sonstiges", official: true },
    { source_id: 8, url: "https://bp/x", label: "Briefspiel", type: "briefspiel", official: false } ] },
  { escape: (s) => String(s == null ? "" : s) }
);
assert.ok(html.includes("Wiki Aventurica"), "wiki read-only row");
assert.ok(html.includes("F-Shop") && html.includes("Briefspiel"), "both sources listed");
assert.ok(html.includes('data-remove-source-id="7"') && html.includes('data-remove-source-id="8"'), "delete buttons carry source_id");
assert.ok(/data-fs-add/.test(html), "add row present");
console.log("feature-sources-render tests passed");
