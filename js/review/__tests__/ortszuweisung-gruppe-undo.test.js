const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

let fetches = 0;
let revisions = 0;
let fail = false;
let incomplete = false;
let newer = false;
let panels = 0;
const popups = [];
const messages = [];
const locations = ["a", "b"].map(publicId => ({ publicId, name: "Ort " + publicId, political: { name: "Alt" }, territoryWikiKey: "alt", revision: 4 }));
const markers = locations.map(location => ({ location, marker: { isPopupOpen: () => false } }));
const group = { revision: 10, feature_type: "location", features: [{ public_id: "a", revision: 10 }, { public_id: "b", revision: 10 }] };
const sandbox = {
    console: { error() {} }, URL, Map,
    document: undefined,
    window: { location: { href: "https://example.test/" }, avesmapsRefreshInfopanel: () => panels++ },
    MAP_FEATURES_API_URL: "/api/app/map-features.php",
    isChangeUndoPending: false,
    locationData: locations,
    findLocationMarkerByPublicId: id => markers.find(item => item.location.publicId === id),
    refreshLocationMarkerPopup: marker => {
        assert.strictEqual(locations[0].political.name, "Neu");
        assert.strictEqual(locations[1].political, null, "Alle Zuordnungen vor dem ersten Popup übernehmen");
        popups.push(marker.location.publicId);
    },
    fetch: async url => {
        fetches++;
        assert.strictEqual(new URL(url).searchParams.get("since_revision"), "9");
        assert.strictEqual(new URL(url).searchParams.get("edit_mode"), "1");
        if (fail) throw new Error("Netzfehler");
        return { ok: true, json: async () => ({ ok: true, features: incomplete ? [] : [
            { id: "a", properties: { revision: newer ? 11 : 10, territory_wiki_key: "neu", territory_public_id: "gebiet", territory_source: "manual", political: { name: "Neu" } } },
            { id: "b", properties: { revision: 10 } },
        ] }) };
    },
    undoMapAuditChange: async () => ({ ok: true, feature: group }),
    updateRevisionFromEditResponse: () => revisions++,
    showFeedbackToast: text => messages.push(text),
    loadReviewReports: async () => {},
    loadWikiSyncCases: async () => {},
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, "../review-panels-change-log.js"), "utf8"), sandbox);
sandbox.loadChangeLog = async () => {};
(async () => {
    await sandbox.undoChangeLogEntry({ id: 4, action: "set_territory_location_group", can_undo: true });
    assert.strictEqual(fetches, 1);
    assert.strictEqual(revisions, 1);
    assert.strictEqual(panels, 1);
    assert.deepStrictEqual(popups, ["a", "b"]);
    assert.strictEqual(locations[0].territoryWikiKey, "neu");
    assert.strictEqual(locations[1].territoryWikiKey, null, "Entfernte Zuordnung bleibt nicht lokal stehen");
    assert.strictEqual(locations[0].name, "Ort a");
    assert.strictEqual(sandbox.formatChangeAction("undo_set_territory_location_group"), "Ortszuweisungen zurückgenommen");
    assert.strictEqual(sandbox.formatChangeAction("undo_undo_set_territory_location_group"), "Ortszuweisungen wiederhergestellt");
    fail = true;
    await sandbox.undoChangeLogEntry({ id: 5, action: "undo_set_territory_location_group", can_undo: true });
    assert(messages.at(-1).includes("wurde gespeichert"));
    assert.strictEqual(revisions, 1, "Fehlgeschlagener Anzeigenabruf darf den Live-Abgleich nicht überspringen");
    fail = false;
    incomplete = true;
    await sandbox.undoChangeLogEntry({ id: 6, action: "set_territory_location_group", can_undo: true });
    assert(messages.at(-1).includes("Nicht alle Orte"));
    assert.deepStrictEqual(popups, ["a", "b"], "Keine halbe lokale Aktualisierung bei unvollständiger Antwort");
    incomplete = false;
    newer = true;
    await sandbox.undoChangeLogEntry({ id: 7, action: "set_territory_location_group", can_undo: true });
    assert(messages.at(-1).includes("danach erneut geändert"));
    assert.strictEqual(revisions, 1);
    assert.strictEqual(panels, 1);
    assert.deepStrictEqual(popups, ["a", "b"]);
    assert.strictEqual(sandbox.isChangeUndoPending, false);
    console.log("OK: Ortsgruppen erhalten politische Infoboxen in einem gemeinsamen Abruf.");
})().catch(error => { console.error(error); process.exitCode = 1; });
