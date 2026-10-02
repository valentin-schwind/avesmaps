const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { ecosystemGeometryParts } = require("../map-features-ecosystem-geometry.js");

let zoomScale = 1;
let finished = 0;
let saved = 0;
const context = vm.createContext({
    ecosystemGeometryParts,
    performance: { now: () => 1000 },
    map: { latLngToContainerPoint: ({ lat, lng }) => ({ x: lng * zoomScale, y: lat * zoomScale }) },
    L: { latLng: (lat, lng) => ({ lat, lng }), DomEvent: { stop() {} } },
});
vm.runInContext(fs.readFileSync(require.resolve("../map-features-ecosystem-edit.js"), "utf8"), context);
context.clearEcosystemEditEdgeHover = () => {};
context.applyEcosystemEditGeometryToLayer = () => {};
context.refreshEcosystemEditHandles = () => {};
context.scheduleEcosystemGeometrySave = () => { saved += 1; };
context.closeEcosystemGeometryEdit = () => { finished += 1; };
context.sayEcosystemEdit = () => {};

function startSession() {
    vm.runInContext(`activeEcosystemGeometryEdit = {
        geometry: { type: "Polygon", coordinates: [[[0,0],[100,0],[100,100],[0,100],[0,0]]] },
        undoStack: [], edgeHover: { position: [0, 50], insertAt: 4, partIndex: 0, ringIndex: 0 }
    };`, context);
}

// Auch weit außerhalb bleibt die nächste Kante der aktiven Fläche das Einfügeziel.
for (const scale of [1, 4, 16]) {
    zoomScale = scale;
    startSession();
    context.isEcosystemLayerModeActive = () => true;
    context.getSelectedEcosystemAreaPublicId = () => "active";
    context.setSelectedEcosystemArea = () => { throw new Error("Kantengeste darf Auswahl nicht löschen"); };
    context.handleEcosystemMapClickDeselect({ latlng: { lng: 50, lat: -200 / scale } });
    context.handleEcosystemEditFinishDoubleClick({ latlng: { lng: 50, lat: -200 / scale }, originalEvent: {} });
    assert.equal(finished, 0);
    assert.equal(vm.runInContext("activeEcosystemGeometryEdit.geometry.coordinates[0].length", context), 6);
    assert.equal(vm.runInContext("activeEcosystemGeometryEdit.geometry.coordinates[0][1][0]", context), 50);
    assert.equal(vm.runInContext("activeEcosystemGeometryEdit.geometry.coordinates[0][1][1]", context), -200 / scale);
    assert.equal(vm.runInContext("activeEcosystemGeometryEdit.undoStack.length", context), 1);
    // Ein zweiter Event derselben Geste setzt keinen zweiten Punkt und beendet nichts.
    context.handleEcosystemEditFinishDoubleClick({ latlng: { lng: 50, lat: -200 / scale }, originalEvent: {} });
    assert.equal(finished, 0);
    assert.equal(vm.runInContext("activeEcosystemGeometryEdit.geometry.coordinates[0].length", context), 6);
}
assert.equal(saved, 3);
assert.equal(context.undoEcosystemGeometryStep(), true);
assert.equal(vm.runInContext("activeEcosystemGeometryEdit.geometry.coordinates[0].length", context), 5);
assert.equal(saved, 4, "Rückgängig plant auch die Speicherung der ursprünglichen Geometrie");
startSession();
assert.equal(context.handleEcosystemEditEdgeDoubleClick({ latlng: { lng: 50, lat: 0 }, originalEvent: { ctrlKey: true } }), false);
assert.equal(context.handleEcosystemEditEdgeDoubleClick({ latlng: { lng: 50, lat: 0 }, originalEvent: { target: { closest: () => true } } }), false);
const savesBeforeControlClick = saved;
context.handleEcosystemEditEdgeClick({ latlng: { lng: 50, lat: -1000 }, originalEvent: { ctrlKey: true } });
assert.equal(saved, savesBeforeControlClick, "Strg-Unterteilung ignoriert einen alten unbegrenzten Hover");
context.handleEcosystemEditFinishDoubleClick({ latlng: { lng: 50, lat: -1000 }, originalEvent: {} });
assert.equal(finished, 0, "Keine Abstandsschranke: Auch weit entfernt wird eingefügt");
assert.equal(vm.runInContext("activeEcosystemGeometryEdit.geometry.coordinates[0][1][1]", context), -1000);
console.log("Landschafts-Doppelklick: Klickposition, nächste Kante ohne Abstandsschranke, Zeitriegel und Rückgängig geprüft.");
