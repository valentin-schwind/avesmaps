const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

async function pruefeGipfelVerschieben() {
    const events = new Map();
    let beweglich = false;
    let speichernAbschliessen;
    let reliefAktualisiert = 0;
    const marker = {
        on(name, handler) { events.set(name, handler); },
        dragging: {
            enable() { beweglich = true; },
            disable() { beweglich = false; },
        },
        closePopup() {},
    };
    const context = {
        window: {},
        L: { marker: () => marker },
        IS_EDIT_MODE: true,
        IS_INFOPANEL_MODE: false,
        avesmapsLabelBedarfAktiv: () => false,
        createLabelIcon: () => ({}),
        refreshLabelMarkerPopup() {},
        syncLabelMarkerVisibility() {},
        isEcosystemPeakActive: () => true,
        isEcosystemPeakLabel: () => true,
        selectEcosystemAreaOfLabel() {},
        acquireFeatureSoftLock() {},
        releaseFeatureSoftLock() {},
        showFeedbackToast() {},
        saveLabelPosition: () => new Promise((resolve) => { speichernAbschliessen = resolve; }),
        invalidateEcosystemHeightForPeak: () => { reliefAktualisiert++; },
    };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "map-features-labels.js"), "utf8"), context);
    context.createLabelIcon = () => ({});
    context.refreshLabelMarkerPopup = () => {};
    context.syncLabelMarkerVisibility = () => {};
    context.saveLabelPosition = () => new Promise((resolve) => { speichernAbschliessen = resolve; });
    const entry = context.createLabelMarkerEntry({ publicId: "gipfel-1", text: "Berg", coordinates: [1, 2] });
    assert.strictEqual(beweglich, false, "Nachladen aktiviert kein Ziehen");
    events.get("click")();
    assert.strictEqual(beweglich, false, "Anklicken aktiviert kein Ziehen");
    context.setLabelMoveActive(entry, true);
    assert.strictEqual(beweglich, true, "Label verschieben aktiviert Ziehen");
    events.get("dragend")();
    assert.strictEqual(beweglich, false, "Loslassen beendet den Verschiebemodus auch beim Gipfel");
    assert.strictEqual(reliefAktualisiert, 0, "Relief wartet auf gespeicherte Position");
    speichernAbschliessen();
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(reliefAktualisiert, 1, "Gespeicherte Gipfelposition aktualisiert das Relief");
    console.log("gipfel-verschieben-menue.test: OK");
}

pruefeGipfelVerschieben().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
