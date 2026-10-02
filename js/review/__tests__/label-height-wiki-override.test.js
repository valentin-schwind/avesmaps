"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const inputListeners = [];
const elements = {
    "label-edit-height": { value: "900" },
    "label-edit-height-range": { value: "900" },
};
const context = {
    window: {},
    document: {
        readyState: "complete",
        getElementById: (id) => elements[id] || null,
        addEventListener: (name, listener) => {
            if (name === "input") {
                inputListeners.push(listener);
            }
        },
    },
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, "../review-label-wiki.js"), "utf8"), context);

for (const id of Object.keys(elements)) {
    context.labelWikiFeldZuruecksetzen("height_schritt", "1100");
    assert.deepEqual(Array.from(context.getLabelWikiUebernommenPayload()), ["height_schritt"]);
    elements[id].value = "900";
    inputListeners.forEach((listener) => listener({ target: { id } }));
    assert.deepEqual(Array.from(context.getLabelWikiUebernommenPayload()), [],
        "Eine eigene Eingabe nach der Wiki-Übernahme bleibt ein manueller Override: " + id);
}
console.log("Berghöhe: Wiki übernehmen und anschließend selbst ändern geprüft.");
