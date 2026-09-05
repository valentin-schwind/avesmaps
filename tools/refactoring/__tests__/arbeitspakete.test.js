// Der Waechter des Rueckgrats: docs/refactoring-arbeitspakete.md darf nicht zur Luege werden.
//
// 💣 Liegt bewusst unter tools/, nicht unter docs/ -- das Deploy-Tor faehrt nur js und tools.
// Er prueft die FORM jedes Pakets (Kennung, Status, Stand + Blob, Verfahren) und bei `erledigt`,
// dass die Geschwisterdatei wirklich im Baum steht. Ob ein Paket noch GILT, sagt nicht er,
// sondern der Frischelauf (tools/refactoring/frischelauf.mjs) -- gegen origin/master, jeden Tag.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node tools/refactoring/__tests__/arbeitspakete.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const ROOT = path.join(__dirname, "..", "..", "..");

const BEISPIEL = `# Refactoring-Arbeitspakete

<!-- Sperre: -->

## Pakete

### P-001 · js/review/review-wiki-sync.js · Verfahren A
- Status: offen
- Stand: 70beda3bf · Blob: 0a4d6b2601234567890abcdef1234567890abcde
- Block: „Lore-Liste“ — loadLoreList … renderLoreDetail (6 Funktionen, ~220 Zeilen ab Z. 3169)
- Ziel: js/review/review-wiki-sync-lore-list.js
- Vorprüfung (05.09.2026): Ladezeit-Bezug 0 · Register 1 (nachziehen) · Quelltext-Tests 0 · vm-Bindung 0
- Fallen: keine bekannt
- Verlauf: 05.09. angelegt (Analyse)

### P-002 · api/_internal/app/citymaps.php · Verfahren C
- Status: erledigt (1d163b75b)
- Stand: 266cde7ae · Blob: 1234567890abcdef1234567890abcdef12345678
- Block: „Autoget“ — avesmapsCitymapAutogetResolveUrl … avesmapsCitymapParsePlainPage
- Ziel: api/_internal/app/citymaps-autoget.php, require_once an der Blockstelle
- Verlauf: 04.09. angelegt · 04.09. erledigt (1d163b75b)

### P-003 · api/_internal/political/territories-layer.php · Verfahren D
- Status: GO nötig
- Stand: 70beda3bf · Blob: abcdef1234567890abcdef1234567890abcdef12
- Block: „Wappen-Unterabfragen“ — avesmapsPoliticalLayerRows … avesmapsPoliticalLayerRows
- Ziel: drei korrelierte Unterabfragen je Zeile durch EINEN Join ersetzen
- Messskript: tools/perf/wappen-unterabfragen.php (zu schreiben)
- Verlauf: 05.09. angelegt (Perf-Geruch)
`;

(async () => {
	const m = await import(pathToFileURL(path.join(__dirname, "..", "arbeitspakete.mjs")).href);

	// 1) Parser: drei Pakete, Felder richtig, Sperre leer
	const p = m.parseArbeitspakete(BEISPIEL);
	assert.strictEqual(p.sperre, null);
	assert.strictEqual(p.pakete.length, 3);
	assert.deepStrictEqual([p.pakete[0].id, p.pakete[0].datei, p.pakete[0].verfahren, p.pakete[0].status, p.pakete[0].stand, p.pakete[0].blob],
		["P-001", "js/review/review-wiki-sync.js", "A", "offen", "70beda3bf", "0a4d6b2601234567890abcdef1234567890abcde"]);
	assert.strictEqual(p.pakete[1].status, "erledigt");
	assert.strictEqual(p.pakete[1].statusRoh, "erledigt (1d163b75b)");
	assert.strictEqual(p.pakete[1].ziel, "api/_internal/app/citymaps-autoget.php", "Ziel ist der Pfad, nicht der Nachsatz");
	assert.strictEqual(p.pakete[0].ziel, "js/review/review-wiki-sync-lore-list.js");
	assert.strictEqual(p.pakete[2].status, "GO nötig");
	assert.strictEqual(p.pakete[2].messskript, "tools/perf/wappen-unterabfragen.php (zu schreiben)");
	assert.deepStrictEqual(p.pakete[1].verlauf, ["04.09. angelegt", "04.09. erledigt (1d163b75b)"]);
	assert.strictEqual(p.pakete[0].zeile, 7);

	// 2) Sperre wird gelesen -- und nur als eigene Zeile, nicht im HTML-Kommentar
	const mitSperre = BEISPIEL.replace("<!-- Sperre: -->", "Sperre: 2026-09-05 Deploy-Sturm");
	assert.deepStrictEqual(m.parseArbeitspakete(mitSperre).sperre, { datum: "2026-09-05", grund: "Deploy-Sturm" });

	// 3) Mutationsprobe: ein unbekannter Status bleibt als Rohwert stehen und ist NICHT in STATUS
	const kaputt = BEISPIEL.replace("- Status: offen", "- Status: fertig");
	const k = m.parseArbeitspakete(kaputt).pakete[0];
	assert.strictEqual(k.status, "fertig");
	assert.ok(!m.STATUS.includes(k.status));

	// 4) Das ECHTE Dokument: jede Form stimmt
	const echt = m.ladeArbeitspakete(ROOT);
	const ids = new Set();
	for (const pk of echt.pakete) {
		assert.ok(/^P-\d{3}$/.test(pk.id), pk.id + ": Kennung");
		assert.ok(!ids.has(pk.id), pk.id + ": doppelt"); ids.add(pk.id);
		assert.ok(m.STATUS.includes(pk.status), pk.id + ": Status '" + pk.statusRoh + "'");
		assert.ok(/^[0-9a-f]{7,40}$/.test(pk.stand), pk.id + ": Stand fehlt");
		assert.ok(/^[0-9a-f]{40}$/.test(pk.blob), pk.id + ": Blob fehlt");
		assert.ok(["A", "B", "C", "D"].includes(pk.verfahren), pk.id + ": Verfahren");
		assert.ok(pk.block, pk.id + ": Block fehlt");
		assert.ok(pk.verlauf.length >= 1, pk.id + ": Verlauf fehlt");
		if (pk.status === "erledigt") {
			assert.ok(/\([0-9a-f]{7,}\)/.test(pk.statusRoh), pk.id + ": erledigt ohne SHA");
			// Ein Doppelungs-Paket „eine ist tot" hat als Ziel eine LOESCHUNG („gelöscht in <sha>") -- dann darf
			// die Datei gerade nicht mehr da sein. Nur ein Ziel mit Dateiendung ist eine Geschwisterdatei.
			if (pk.verfahren !== "D" && /\.(js|mjs|php)$/.test(pk.ziel)) assert.ok(fs.existsSync(path.join(ROOT, pk.ziel)), pk.id + ": Geschwisterdatei " + pk.ziel + " fehlt");
		}
		if (pk.verfahren === "D") assert.ok(/tools\/perf\//.test(pk.messskript), pk.id + ": Perf-Paket ohne Messskript unter tools/perf/");
	}
	console.log("arbeitspakete: ok (" + echt.pakete.length + " Pakete)");
})().catch((e) => { console.error(e); process.exit(1); });
