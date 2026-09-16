const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

let calls = 0;
let network = false;
const sandbox = {
    URL, window: { location: { href: "https://example.test/" } },
    fetch: async (_url, options) => {
        calls++;
        assert(JSON.parse(options.body).pairs.length <= 200);
        if (calls === 1) return { ok: true, json: async () => ({ ok: true, applied: 198 }) };
        if (network) throw new Error("Verbindung weg");
        return { ok: false, status: 409, json: async () => ({ ok: false, error: { message: "Ort gesperrt" } }) };
    },
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, "../map-features-settlement-territory-assign.js"), "utf8"), sandbox);
(async () => {
    const pairs = Array.from({ length: 401 }, (_, i) => ({ public_id: String(i), wiki_key: "wiki:test" }));
    await assert.rejects(sandbox.apply(pairs, { confirm: "apply" }), /198 Zuordnungen.*Änderungsverlauf.*Ort gesperrt/);
    assert.strictEqual(calls, 2, "Nach dem Paketfehler keine weiteren Pakete senden");
    calls = 0;
    network = true;
    await assert.rejects(sandbox.apply(pairs, { confirm: "apply" }), /198 Zuordnungen.*Serverantwort fehlt/);
    assert.strictEqual(calls, 2);
    console.log("OK: Bereits abgeschlossene Ortszuweisungen bleiben bei Paketfehler sichtbar.");
})().catch(error => { console.error(error); process.exitCode = 1; });
