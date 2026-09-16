const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

let planner = 0;
let index = 0;
let rendered = 0;
const paths = Array.from({ length: 249 }, (_, i) => ({
    id: String(i), geometry: { type: "LineString", coordinates: [[1, 2], [3, 4]] },
    properties: { public_id: String(i), id: `path-${i}`, name: "Neu", show_label: true, allowed_transports: ["groupFoot"] },
}));
const sandbox = {
    pathData: paths, pathLayers: [],
    getPathPublicId: (p) => p.id,
    getPathDisplayName: (p) => p.properties.name,
    normalizePathSubtype: (s) => s,
    getNextLocalPathId: () => 250,
    createPathLayer: (p) => ({ path: p }),
    avesmapsWegEinschraenkungNeuRechnen: () => index++,
    updatePathLayerGeometry: () => rendered++,
    updatePathLayerStyle: () => {},
    refreshPathLayerPopup: () => {
        assert(paths.every((p) => p.properties.name === "Alt"), "vor dem ersten Popup muss die ganze Gruppe aktuell sein");
    },
    syncPathVisibility: () => {},
    refreshPlannerAfterFeatureChange: () => planner++,
};
vm.createContext(sandbox);
for (const file of ["map-features-path-prepare.js", "map-features-path-lifecycle.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), sandbox);
}
const features = Array.from({ length: 250 }, (_, i) => ({
    type: "Feature", id: String(i), geometry: { type: "LineString", coordinates: [[5, 6], [7, 8]] },
    properties: { public_id: String(i), name: "Alt", feature_subtype: "Weg", revision: 99 },
    removed_properties: ["show_label", "allowed_transports"],
}));
// Der letzte Abschnitt fehlt lokal und wird aus der Serverantwort ergänzt.
sandbox.refreshPathLayerPopup = () => {
    assert(paths.slice(0, 249).every((p) => p.properties.name === "Alt"));
    assert(paths.length === 250);
};
sandbox.applyPathGroupAuditResponse(features);
assert.strictEqual(planner, 1);
assert.strictEqual(index, 1);
assert.strictEqual(rendered, 249);
assert.strictEqual(paths.length, 250);
for (const p of paths) {
    assert.strictEqual(Object.hasOwn(p.properties, "show_label"), false);
    assert.strictEqual(Object.hasOwn(p.properties, "allowed_transports"), false);
    assert.strictEqual(p.properties.display_name, "Alt");
}
assert.strictEqual(paths[0].properties.id, "path-0", "lokale Routing-Kennung bleibt erhalten");
assert.strictEqual(sandbox.pathLayers.length, 1);
console.log("OK: entfernte Eigenschaften verschwinden, 250 Abschnitte aktualisieren den Planer einmal.");
