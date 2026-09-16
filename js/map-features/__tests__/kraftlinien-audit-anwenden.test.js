"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../map-features-powerlines.js"), "utf8");
const start = source.indexOf("function applyPowerlineGroupAuditResponse(");
const end = source.indexOf("function applyPowerlineFeatureResponse(", start);
const cacheModule = require("../../review/review-feature-sources.js");
const calls = [];
const feature = (id, name) => ({ type: "Feature", id, geometry: { type: "LineString", coordinates: [[1, 2], [3, 4]] }, properties: { name } });
const context = {
    powerlineData: [feature("alt", "Vorher"), feature("weg", "Entfernt"), feature("fremd", "Unberührt")],
    locationConnectivityIndex: {},
    syncFeatureSourcesToClientCache: (...args) => calls.push(["sources", args]),
    preparePowerlineData: (data) => calls.push(["prepare", data]),
    window: { avesmapsRefreshInfopanel: () => calls.push(["info"]), AvesmapsPathLabelCanvasOverlay: { redraw: () => calls.push(["labels"]) } },
};
vm.createContext(context);
vm.runInContext(source.slice(start, end), context);
const payload = { anchor: "alt", sources: [{ source_id: 7 }], by_entity: { alt: [{ source_id: 7, note: "Notiz" }], neu: [] }, kanon_je_kennung: { alt: { kanon: "inoffiziell" }, neu: null } };
context.applyPowerlineGroupAuditResponse([feature("alt", "Nachher"), { public_id: "weg", deleted: true }, feature("neu", "Neu")], payload);
assert.deepEqual(calls.map((call) => call[0]), ["sources", "prepare", "info", "labels"]);
const applied = calls[1][1].features;
assert.deepEqual(Array.from(applied, (f) => f.id), ["alt", "fremd", "neu"]);
assert.equal(applied[0].properties.name, "Nachher");
assert.equal(applied[1].properties.name, "Unberührt");
assert.equal(context.locationConnectivityIndex, null);
assert.equal(calls[0][1][4], payload.kanon_je_kennung);
// Der vorhandene Cache-Helfer muss auch Notizen aus dem Nachtrag behalten.
global.window = {};
cacheModule.syncFeatureSourcesToClientCache("powerline", "alt", [], payload.by_entity, payload.kanon_je_kennung);
assert.equal(window.__featureSourceRefs["powerline:alt"][0].note, "Notiz");
assert.equal(window.__featureSourceRefsNachgetragen["powerline:alt"], true);
delete global.window;
console.log("OK: Kraftlinien, Quellen und Kanon werden gemeinsam vor einmaligem Neuzeichnen übernommen.");
