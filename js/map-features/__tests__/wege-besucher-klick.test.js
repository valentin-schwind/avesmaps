"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "map-features-path-rendering.js"), "utf8");
const start = source.indexOf("function createPathLayer(");
const end = source.indexOf("\n}", start);
assert.ok(start >= 0 && end > start);

function createWorld(editMode, wikiLinked) {
    const calls = { popup: 0, panel: 0, edit: 0, settlement: false, selection: 0 };
    const feature = {
        properties: wikiLinked ? { wiki_path: { wiki_key: "wiki:test" } } : {},
        geometry: { coordinates: [[0, 0], [1, 1]] },
    };
    const context = {
        IS_EDIT_MODE: editMode,
        avesmapsWegAuswahlKlick: (selected) => { assert.equal(selected, feature); calls.selection += 1; },
        map: {},
        window: {
            avesmapsTryOpenLocationAtContainerPoint: () => calls.settlement,
        },
        L: {
            polyline: (coordinates, options) => ({
                options,
                handlers: {},
                on(event, handler) { this.handlers[event] = handler; },
            }),
            layerGroup: (lines) => lines,
            DomEvent: { stop() {}, stopPropagation() {} },
            popup: () => ({
                setLatLng() { return this; },
                setContent(markup) {
                    assert.equal(markup, feature._popupMarkup);
                    return this;
                },
                openOn() { calls.popup += 1; },
            }),
        },
        pathHasWiki: () => wikiLinked,
        getPathVisualLatLngCoordinates: (coordinates) => coordinates,
        getPathLabelVisualLatLngCoordinates: (coordinates) => coordinates,
        getReadablePathLabelLatLngCoordinates: (coordinates) => coordinates,
        getVectorRenderer: () => null,
        getPathStyleColors: () => ({ outlineWeight: 4, centerWeight: 2.5 }),
        refreshPathLayerPopup: (feature) => { feature._popupMarkup = "Weg-Infobox"; },
        updatePathLayerStyle() {},
        handleEditablePathDoubleClick: () => { calls.edit += 1; },
    };
    vm.createContext(context);
    vm.runInContext(source.slice(start, end + 2), context);
    context.createPathLayer(feature);
    return { feature, calls, context };
}

for (const editMode of [false, true]) {
    for (const wikiLinked of [false, true]) {
        const { feature, calls, context } = createWorld(editMode, wikiLinked);
        for (const line of feature._pathLines) {
            assert.equal(line.options.interactive, true, "Auch ohne Wiki muss die Linie Klicks annehmen.");
            assert.equal(line.options.bubblingMouseEvents, false, "Der Klick darf keine Kartenaktion auslösen.");
            const event = { containerPoint: { x: 10, y: 10 }, latlng: [0, 0] };
            const previousSelection = calls.selection;
            line.handlers.click(event);
            assert.equal(calls.selection, previousSelection + 1, "Jeder Linienklick aktiviert die Markierung, auch fuer Besucher.");
            assert.equal(calls.popup, 1, "Der Linienklick öffnet die Infobox.");
            calls.popup = 0;

            context.window.avesmapsShowPathInInfopanel = (selected) => {
                assert.equal(selected, feature);
                calls.panel += 1;
                return true;
            };
            line.handlers.click(event);
            assert.equal(calls.panel, 1);
            assert.equal(calls.popup, 0, "Im Panel-Modus öffnet kein zweites Popup.");
            calls.panel = 0;

            calls.settlement = true;
            line.handlers.click(event);
            assert.equal(calls.panel, 0, "Eine Siedlung auf dem Weg behält Vorrang.");
            assert.equal(calls.popup, 0);
            calls.settlement = false;
            delete context.window.avesmapsShowPathInInfopanel;

            assert.equal(typeof line.handlers.dblclick, editMode ? "function" : "undefined",
                "Die Geometriebearbeitung bleibt auf den Edit-Modus beschränkt.");
        }
        assert.equal(feature._pathLabelLine.options.interactive, false);
    }
}

console.log("Wegeklick: Besucher und Editoren, mit und ohne Wiki, Popup/Panel und Siedlungsvorrang grün.");
