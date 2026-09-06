// 💣 ACHTZEHN GLEICHE ANFRAGEN IN DERSELBEN SEKUNDE SIND EINE ANFRAGE.
//
// ANLASS (Zugriffsprotokoll 30.08.–06.09.2026). `regions.php?action=staging_sample&wiki_keys=…`
// steht dort mit bis zu 18 ZEICHENGLEICHEN Aufrufen in einer Sekunde, immer derselbe Schluessel
// („archipel-der-perlen"), 558 Stueck in einer Viertelstunde. Jeder davon ist eine PHP-Anfrage mit
// eigener Datenbankverbindung -- auf STRATOs geteiltem Hosting genau die Last, vor der AGENTS.md
// §9 warnt („never loop expensive endpoints").
//
// 🔴 GEBUENDELT WIRD NUR, WAS GERADE LAEUFT -- kein Ergebnis-Zwischenspeicher. Wer denselben
// Schnappschuss zweimal NACHEINANDER holt, bekommt zweimal frische Daten; nur wer ihn zwoelfmal
// GLEICHZEITIG holt, bekommt eine Anfrage. Damit aendert sich am Inhalt nichts, was ein Editor je
// sehen koennte -- ein Ergebnis-Cache haette dagegen die Frage „wie lange gilt er?" aufgeworfen,
// und die falsche Antwort waere ein Editor, der seine eigene Aenderung nicht sieht.
//
// Run: node js/map-features/__tests__/wiki-schnappschuss-buendeln.test.js
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const wurzel = path.resolve(__dirname, "..", "..", "..");
const quelle = fs.readFileSync(
	path.join(wurzel, "js", "map-features", "map-features-ecosystem-draw.js"),
	"utf8"
);

// Die Funktion samt ihrer Buendelungs-Ablage ausschneiden und WIRKLICH fahren -- die Datei als
// Ganzes braucht Leaflet und ein Dokument, die Funktion braucht nur `fetch`.
// ⚠️ Die Laenge ist die Wache gegen einen Schnitt, der ins Leere greift: `indexOf` liefert -1, und
// eine winzige (oder riesige) Scheibe pruefte nichts.
const von = quelle.indexOf("const ecosystemWikiRegionSnapshotLaufend");
assert.ok(von >= 0, "die Buendelungs-Ablage steht vor der Funktion");
const nachFn = quelle.indexOf("async function createEcosystemRegionLabel(");
assert.ok(nachFn > von, "und die Funktion davor endet vor dem naechsten Erzeuger");
const scheibe = quelle.slice(von, nachFn);
assert.ok(
	scheibe.length > 300 && scheibe.length < 6000,
	"die Scheibe ist wirklich der Schnappschuss-Weg (" + scheibe.length + " Zeichen)"
);

let abrufe = 0;
let antworten = [];
const kasten = vm.createContext({
	console: { warn() {} },
	// Jeder Abruf haengt an einem Zuegel, den der Test selbst loest -- so laufen mehrere
	// nachweislich GLEICHZEITIG.
	fetch: (url) => {
		abrufe++;
		return new Promise((fertig) => {
			antworten.push(() => fertig({ json: () => Promise.resolve({ rows: [{ wiki_key: "k" }] }) }));
		});
	},
	labelWikiRegionFromRow: (zeile) => ({ wiki_key: String(zeile.wiki_key || ""), aus: "zeile" }),
});
vm.runInContext(scheibe + "\nglobalThis.__schnappschuss = ecosystemWikiRegionSnapshot;", kasten);
const schnappschuss = kasten.__schnappschuss;

const alleLoesen = () => {
	const offen = antworten;
	antworten = [];
	offen.forEach((loesen) => loesen());
};

(async () => {
	let checks = 3;
	const zaehl = () => { checks++; };

	// ── 1) ACHTZEHN GLEICHZEITIGE, EIN ABRUF ──────────────────────────────────────────────────
	const zusagen = [];
	for (let i = 0; i < 18; i++) {
		zusagen.push(schnappschuss("archipel-der-perlen", "https://x/A"));
	}
	await new Promise((f) => setTimeout(f, 0));
	assert.strictEqual(
		abrufe,
		1,
		"achtzehn gleichzeitige Schnappschuesse desselben Schluessels schicken " + abrufe
			+ " Anfragen -- genau die Buendel aus dem Zugriffsprotokoll"
	);
	zaehl();

	alleLoesen();
	const ergebnisse = await Promise.all(zusagen);
	// 💣 ALLE bekommen dasselbe Ergebnis -- ein Buendel, das nur dem ersten antwortet, waere
	// schlimmer als das Buendel selbst.
	ergebnisse.forEach((wert, i) => {
		assert.ok(wert && wert.wiki_key === "k", "Aufrufer " + i + " bekam kein Ergebnis: " + JSON.stringify(wert));
	});
	zaehl();

	// ── 2) VERSCHIEDENE SCHLUESSEL BLEIBEN VERSCHIEDENE ANFRAGEN ──────────────────────────────
	abrufe = 0;
	const a = schnappschuss("aaa", "https://x/a");
	const b = schnappschuss("bbb", "https://x/b");
	await new Promise((f) => setTimeout(f, 0));
	assert.strictEqual(abrufe, 2, "zwei verschiedene Schluessel brauchen zwei Anfragen");
	zaehl();
	alleLoesen();
	await Promise.all([a, b]);

	// ── 3) NACH DEM ENDE WIRD WIEDER FRISCH GEHOLT ────────────────────────────────────────────
	// 🔴 Der wichtigste Gegentest: gebuendelt wird das LAUFENDE, nicht das Ergebnis. Bliebe der
	// Eintrag stehen, saehe ein Editor seine eigene Aenderung am Wiki-Datensatz nie -- und das
	// waere ein schlimmerer Fehler als die Last, die hier behoben wird.
	abrufe = 0;
	const nochmal = schnappschuss("archipel-der-perlen", "https://x/A");
	await new Promise((f) => setTimeout(f, 0));
	assert.strictEqual(abrufe, 1, "nach dem Abschluss wird derselbe Schluessel wieder frisch geholt");
	zaehl();
	alleLoesen();
	await nochmal;

	// ── 4) EIN FEHLSCHLAG GIBT DEN SCHLUESSEL FREI ────────────────────────────────────────────
	// ⚠️ Sonst bliebe ein einmal gescheiterter Schluessel fuer immer blockiert -- und der
	// Rueckfall der Funktion („mager verknuepfen") gaebe still immer dasselbe zurueck.
	abrufe = 0;
	const kaputt = vm.createContext({
		console: { warn() {} },
		fetch: () => Promise.reject(new Error("Netz weg")),
		labelWikiRegionFromRow: (zeile) => ({ wiki_key: String(zeile.wiki_key || "") }),
	});
	vm.runInContext(scheibe + "\nglobalThis.__s = ecosystemWikiRegionSnapshot;", kaputt);
	const ersteAbsage = await kaputt.__s("kaputt", "https://x/k");
	assert.strictEqual(ersteAbsage.wiki_key, "kaputt", "der magere Rueckfall greift weiterhin");
	zaehl();
	let zweiterAbruf = 0;
	kaputt.fetch = () => { zweiterAbruf++; return Promise.reject(new Error("Netz weg")); };
	await kaputt.__s("kaputt", "https://x/k");
	assert.strictEqual(
		zweiterAbruf,
		1,
		"nach einem Fehlschlag bleibt der Schluessel blockiert -- der naechste Versuch fragt nie wieder"
	);
	zaehl();

	console.log("OK - gleichzeitige Wiki-Schnappschuesse werden gebuendelt (" + checks + " Zusicherungen)");
})().catch((fehler) => {
	console.error(fehler);
	process.exit(1);
});
