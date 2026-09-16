const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const angewendet = [];
const meldungen = [];
let antwort;
let abrufe = 0;
let revisionen = 0;
const sandbox = {
    console: { error() {} },
    document: undefined,
    window: undefined,
    isChangeUndoPending: false,
    undoMapAuditChange: async () => { abrufe++; return antwort; },
    applyMapFeatureEditResult: (result) => angewendet.push(result.feature),
    applyPathGroupAuditResponse: (features) => angewendet.push(...features),
    updateRevisionFromEditResponse: () => revisionen++,
    showFeedbackToast: (text) => meldungen.push(text),
    loadReviewReports: async () => {},
    loadWikiSyncCases: async () => {},
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, "../review-panels-change-log.js"), "utf8"), sandbox);
sandbox.loadChangeLog = async () => {};

(async () => {
    antwort = { ok: true, feature: { revision: 42, features: [{ id: "a" }, { id: "b" }] } };
    await sandbox.undoChangeLogEntry({ id: 12, action: "update_path_group_details", can_undo: true });
    assert.strictEqual(abrufe, 1, "eine gemeinsame Rücknahme-Anfrage");
    assert.deepStrictEqual(angewendet, antwort.feature.features, "jeder zurückgenommene Abschnitt erreicht die Karte");
    assert.strictEqual(revisionen, 1, "eine gemeinsame Revision");
    assert.strictEqual(meldungen[0], "Wegegruppe geändert rückgängig gemacht.");

    await sandbox.undoChangeLogEntry({ id: 13, action: "undo_update_path_group_details", can_undo: true });
    assert.strictEqual(meldungen[1], "Wegegruppe geändert wiederhergestellt.");
    assert.strictEqual(sandbox.isChangeUndoPending, false);
    assert.strictEqual(sandbox.formatChangeAction("undo_update_path_group_details"), "Wegegruppe zurückgenommen");
    assert.strictEqual(sandbox.formatChangeAction("undo_undo_update_path_group_details"), "Wegegruppe wiederhergestellt");

    antwort = { ok: true, feature: { id: "einzeln" } };
    await sandbox.undoChangeLogEntry({ id: 14, action: "update_path_details", can_undo: true });
    assert.strictEqual(angewendet.at(-1).id, "einzeln", "Einzel-Undo bleibt erhalten");

    const vorher = angewendet.length;
    sandbox.undoMapAuditChange = async () => { throw new Error("Abschnitt inzwischen geändert"); };
    await sandbox.undoChangeLogEntry({ id: 15, action: "update_path_group_details", can_undo: true });
    assert.strictEqual(angewendet.length, vorher, "bei Konflikt bleibt auch die lokale Karte unverändert");
    assert.strictEqual(meldungen.at(-1), "Abschnitt inzwischen geändert");
    assert.strictEqual(sandbox.isChangeUndoPending, false);
    console.log("OK: Sammel-Undo und Redo aktualisieren alle Abschnitte.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
