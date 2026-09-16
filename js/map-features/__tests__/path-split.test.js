const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Der echte Client-Ablauf: ein Schreibaufruf, Quellen vor dem ersten Popup, Fehler ohne Teilzustand.
const source = fs.readFileSync(path.join(__dirname, "../map-features-path-geometry-editing.js"), "utf8");
const stateSource = fs.readFileSync(path.join(__dirname, "../map-features-feature-state.js"), "utf8");
const popupSource = fs.readFileSync(path.join(__dirname, "../../ui/popups.js"), "utf8");

async function run() {
    for (const fail of [false, true]) {
        const original = { id: "original", geometry: { coordinates: [[10, 20], [15, 27], [30, 40]] }, properties: { revision: 7, is_bach: true } };
        const requests = [];
        const effects = [];
        const response = { feature: { revision: 8, crossing: { public_id: "crossing" }, paths: [
            { id: "first", properties: { is_bach: true } }, { id: "second", properties: { is_bach: true } },
        ] } };
        const context = vm.createContext({
            console: { error() {} },
            window: {
                __featureSourceRefs: { "path:original": [{ source_id: 42, pages: "17", origin: "manual" }] },
                __sourceCatalog: { 42: { label: "Testquelle", url: "https://example.org", official: false } },
                __featureKanon: { abweichungen: { "path:original": { kanon: "inoffiziell", bezeichner: "Briefspiel" } } },
            },
            L: { latLng: (lat, lng) => typeof lat === "object" ? lat : { lat, lng } },
            pathData: [original], activePathGeometryEdit: null,
            getPathPublicId: (item) => item.id,
            findLocationMarkerByPublicId: () => null,
            findPathByPublicId: (id) => id === "original" ? original : null,
            mapDataSourceStatus: { revision: 7 },
            updateMapDataStatus: () => {},
            showFeedbackToast: (message, type) => effects.push(type),
            removePathFeature: () => effects.push("remove"),
            addCreatedCrossingMarker: () => effects.push("crossing"),
            ensureCrossingsEnabled: () => effects.push("enable"),
            addCreatedPathFeature: (feature) => {
                // Das Popup benutzt die echten Resolver und muss ohne Neuladen stimmen.
                assert.equal(context.resolveFeatureSourceList("path", feature.id)[0].label, "Testquelle");
                assert.equal(context.resolveFeatureKanon("path", feature.id).kanon, "inoffiziell");
                assert.equal(feature.properties.is_bach, true);
                effects.push(feature.id);
            },
        });
        vm.runInContext(stateSource, context);
        vm.runInContext(popupSource, context);
        vm.runInContext(source, context);
        context.submitMapFeatureEdit = async (payload) => {
            requests.push(context.withExpectedRevision(payload));
            if (fail) { throw new Error("Speichern fehlgeschlagen"); }
            return response;
        };
        await context.splitPathAtNode({ path: original, nodeIndex: 1 });
        assert.equal(requests.length, 1);
        assert.equal(requests[0].action, "split_path");
        assert.equal(requests[0].expected_revision, 7);
        assert.equal(requests[0].node_index, 1);
        assert.deepEqual(requests[0].expected_coordinates, original.geometry.coordinates);
        if (fail) {
            assert.deepEqual(effects, ["warning"]);
            assert.equal(context.window.__featureSourceRefs["path:first"], undefined);
        } else {
            assert.deepEqual(effects, ["remove", "crossing", "enable", "first", "second", "success"]);
            assert.equal(context.mapDataSourceStatus.revision, 8);
            assert.notEqual(context.window.__featureSourceRefs["path:first"], context.window.__featureSourceRefs["path:second"]);
        }
        requests.length = 0;
        await context.splitPathAtNode({ path: original, nodeIndex: 0 });
        assert.equal(requests.length, 0, "Endknoten loest keinen Schreibaufruf aus");
    }
    console.log("OK: Teilungsablauf, Bach, sofortige Quellen/Kanon-Anzeige, Fehler und Revision");
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
