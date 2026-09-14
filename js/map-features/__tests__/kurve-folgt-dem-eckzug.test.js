// Nach einem Eckzug zeichnet die Karte die NEUE Beschriftungskurve -- ohne Neuladen.
//
// 🔴 DER BEFUND (14.09.2026). Die Handbuch-Routine las im Code: „Nach dem Verschieben von Ecken rechnet
// sich die Kurve NICHT von selbst neu." Die Sitzung vom 07.09.2026 hatte dagegen gebaut, dass der Server
// nach jedem Schreibvorgang nachrechnet. Gemessen im echten Ablauf an „Thasch" (Editor angemeldet, Ecke
// gezogen, gespeichert): beide hatten recht. Der Server trug danach die neue Linie, die KARTE zeichnete
// Zeichen fuer Zeichen die alte weiter -- die Antwort trug die Linie nicht mit, und `label.curveLine`
// entsteht nur beim Laden der Nutzlast.
//
// Jetzt legt der Endpunkt die nachgerechneten Kurven als `curve_labels` in die Antwort
// (avesmapsCurveNachSchreibvorgang), und postEcosystemEdit -- der Trichter aller Landschafts-Schreiber --
// reicht sie an den Sammelweg der Labels.
//
// ZUR LAUFZEIT gefahren, mit den ECHTEN Bauteilen: der Speicherweg des Ecken-Editors
// (flushEcosystemGeometrySave, map-features-ecosystem-edit.js), der echte Schreibkanal
// (map-features-ecosystem-region-store.js) und die echten Label-Funktionen aus map-features-labels.js.
// Nachgebaut ist nur der Server (die Antwort in der Form, die kurve-reist-zur-karte-test.php ausfuehrt).
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/kurve-folgt-dem-eckzug.test.js
"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const wurzel = path.join(__dirname, "..", "..", "..");
// ⭐ Zeilenenden-neutral (AGENTS.md §9): Arbeitskopie CRLF, CI LF.
const lies = (datei) => fs.readFileSync(path.join(wurzel, datei), "utf8").replace(/\r\n/g, "\n");
let checks = 0;

// map-features-labels.js laesst sich nicht als Ganzes laden (sie fasst beim Laden `map` an) -- geschnitten
// wird je Funktion, wie in kurvenlauf-zeichnet-karte-nach.test.js.
function rumpfVon(quelle, name) {
	const von = quelle.indexOf("function " + name + "(");
	assert.ok(von >= 0, name + " fehlt");
	const bis = quelle.indexOf("\n}", von);
	assert.ok(bis > von, name + " hat kein Ende");
	return quelle.slice(von, bis + 2);
}

// 🪤 Arrays aus dem vm-Kontext tragen einen FREMDEN Prototyp -- deepStrictEqual gegen ein Host-Array
// faellt bei gleichem Inhalt. Verglichen wird deshalb als JSON.
const alsJson = (x) => JSON.stringify(x);

const LABELS = lies("js/map-features/map-features-labels.js");

// Die Kurve, die die Karte vor dem Eckzug zeichnet -- Leaflet-Ordnung [lat, lng].
const ALTE_KURVE = [[663.272, 502.343], [651.64, 437.773]];
// Die Linie, die der Server nach dem Eckzug gerechnet hat -- Ablage-Ordnung [x, y], ungedreht.
const NEUE_LINIE = [[502.344, 663.248], [470.5, 655.1], [437.783, 651.578]];
const ALTE_FORM = { type: "Polygon", coordinates: [[[480, 640], [500, 640], [500, 660], [480, 640]]] };
const NEUE_FORM = { type: "Polygon", coordinates: [[[480, 640], [500, 634], [500, 660], [480, 640]]] };

function antwortMitKurve() {
	return {
		ok: true,
		area: { public_id: "a-thasch", geometry_revision: 7 },
		revision: 9,
		curve_labels: { "r-thasch": { line: NEUE_LINIE, max: 2 } },
	};
}

function baueBuehne(antwort) {
	const gesendet = [];
	const toasts = [];
	const warnungen = [];
	const zaehler = { platzierungen: 0, sync: 0, kollision: 0 };
	const eintrag = {
		label: { publicId: "l-thasch", text: "Thasch", curveLine: ALTE_KURVE.map((p) => [...p]), curveMax: 1 },
		marker: { setIcon() {} },
	};

	const kontext = {
		console: { log() {}, error() {}, warn: (...args) => warnungen.push(args) },
		JSON, Math, Number, String, Boolean, Array, Object, Promise, Map, Set, Error,
		document: { addEventListener() {}, removeEventListener() {}, getElementById: () => null },
		// Der Server: nimmt den Rumpf entgegen und antwortet so, wie der Endpunkt es nach
		// avesmapsCurveNachSchreibvorgang tut.
		fetch: async (url, optionen) => {
			gesendet.push({ url, rumpf: JSON.parse(optionen.body) });
			return { ok: true, status: 200, json: async () => antwort };
		},
		readJsonResponse: async (response, fallback) => {
			try { return await response.json(); } catch (fehler) { return fallback; }
		},
		apiErrorMessage: (daten, fallback) => (daten && daten.error && daten.error.message) || fallback,
		showFeedbackToast: (text, art) => { toasts.push({ text, art }); },
		// Die Label-Umgebung: EIN Label an der Region „Thasch".
		avesmapsLabelEntriesForEcosystemRegion: (regionId) => (String(regionId) === "r-thasch" ? [eintrag] : []),
		createLabelIcon: () => "ICON",
		avesmapsKurvenlabelPlatzierungen: () => { zaehler.platzierungen += 1; },
		syncLabelMarkerVisibility: () => { zaehler.sync += 1; },
		scheduleLabelCollisionResolution: () => { zaehler.kollision += 1; },
	};
	kontext.window = { addEventListener() {}, removeEventListener() {}, setTimeout: () => 0, clearTimeout() {} };
	kontext.globalThis = kontext;
	vm.createContext(kontext);

	vm.runInContext('const ECOSYSTEM_EDIT_API_URL = "api/edit/map/ecosystem.php";', kontext);
	vm.runInContext(lies("js/map-features/map-features-ecosystem-region-store.js"), kontext);
	vm.runInContext([
		"readLabelCurveLine",
		"avesmapsCurveDatenAnLabels",
		"avesmapsCurveNachzeichnen",
		"avesmapsCurveBaselinesAufLabelsAnwenden",
	].map((name) => rumpfVon(LABELS, name)).join("\n"), kontext);
	vm.runInContext(lies("js/map-features/map-features-ecosystem-edit.js"), kontext);

	// Eine offene Ecken-Sitzung, deren Geometrie seit dem letzten Speichern gezogen wurde -- genau der
	// Zustand, in dem der 800-ms-Wecker flushEcosystemGeometrySave ausloest.
	const layer = { _ecosystemArea: { public_id: "a-thasch", geometry_revision: 6, geometry: ALTE_FORM } };
	kontext.__sitzung = {
		publicId: "a-thasch",
		layer,
		geometry: JSON.parse(JSON.stringify(NEUE_FORM)),
		savedGeometryJson: JSON.stringify(ALTE_FORM),
		revision: 6,
		handles: [],
		undoStack: [],
		saving: false,
	};
	vm.runInContext("activeEcosystemGeometryEdit = __sitzung;", kontext);

	return { kontext, gesendet, toasts, warnungen, zaehler, eintrag };
}

// ---- 1. Der Eckzug bringt die neue Kurve auf die Karte -- sofort ---------------------------------
(async () => {
	{
		const b = baueBuehne(antwortMitKurve());
		await b.kontext.flushEcosystemGeometrySave();

		assert.strictEqual(b.gesendet.length, 1, "der Eckzug schickt nicht genau EINEN Schreibvorgang");
		assert.strictEqual(b.gesendet[0].rumpf.action, "update_area_geometry");
		assert.strictEqual(alsJson(b.gesendet[0].rumpf.geometry_geojson), alsJson(NEUE_FORM),
			"die gezogene Form geht nicht auf die Leitung");
		checks += 3;

		// 💣 DER BEFUND SELBST: ohne Uebernahme stuende hier weiter ALTE_KURVE.
		assert.strictEqual(alsJson(b.eintrag.label.curveLine), alsJson(NEUE_LINIE.map(([x, y]) => [y, x])),
			"nach dem Eckzug zeichnet die Karte weiter die alte Kurve -- oder die neue ungedreht");
		assert.strictEqual(b.eintrag.label.curveMax, 2, "die Anzahl aus der Antwort kommt nicht an");
		// ⭐ EIN Nachzeichnen, nicht eines je Region oder je Label.
		assert.strictEqual(b.zaehler.platzierungen, 1, "die Platzierung wird " + b.zaehler.platzierungen + "x gerechnet");
		assert.strictEqual(b.zaehler.kollision, 1);
		checks += 4;

		// Und das Speichern selbst laeuft wie vorher.
		assert.strictEqual(b.kontext.__sitzung.revision, 7, "die Sitzung uebernimmt die neue Flaechenrevision nicht");
		assert.strictEqual(b.kontext.__sitzung.savedGeometryJson, JSON.stringify(NEUE_FORM));
		assert.ok(b.toasts.some((t) => t.text === "Fläche gespeichert."), "das Speichern meldet sich nicht");
		checks += 3;
	}

	// ---- 2. Ohne `curve_labels` bleibt die Kurve, und nichts wird nachgezeichnet ------------------
	// Der Normalfall fuer jede Flaeche OHNE Kurvenbeschriftung (live 82 von 1463 Regionen tragen eine):
	// ein Nachzeichnen ueber die ganze Karte je Speichern waere der Preis dieser Aenderung.
	{
		const antwort = antwortMitKurve();
		delete antwort.curve_labels;
		const b = baueBuehne(antwort);
		await b.kontext.flushEcosystemGeometrySave();
		assert.strictEqual(alsJson(b.eintrag.label.curveLine), alsJson(ALTE_KURVE),
			"ohne mitgegebene Kurve wird die vorhandene angefasst");
		assert.strictEqual(b.zaehler.platzierungen, 0, "ohne mitgegebene Kurve wird die Karte nachgezeichnet");
		checks += 2;
	}

	// ---- 3. Ein Wurf beim Nachzeichnen macht aus dem Speichern KEINEN Fehlschlag -------------------
	// 💣 Der Schreibvorgang IST gelungen. Wuerfe der Trichter weiter, meldete der Ecken-Editor „konnte
	// nicht gespeichert werden", liesse die Sitzung auf dem alten Stand und schickte beim naechsten Zug
	// eine veraltete Revision -- 409 mitten im Zeichnen.
	{
		const b = baueBuehne(antwortMitKurve());
		b.kontext.avesmapsCurveBaselinesAufLabelsAnwenden = () => { throw new Error("kaputt"); };
		await b.kontext.flushEcosystemGeometrySave();
		assert.ok(b.toasts.some((t) => t.text === "Fläche gespeichert."), "ein Wurf beim Nachzeichnen verschluckt die Erfolgsmeldung");
		assert.ok(!b.toasts.some((t) => t.art === "warning"), "ein Wurf beim Nachzeichnen wird als Speicherfehler gemeldet");
		assert.strictEqual(b.kontext.__sitzung.revision, 7, "ein Wurf beim Nachzeichnen haelt die Sitzung auf der alten Revision");
		assert.strictEqual(b.warnungen.length, 1, "ein Wurf beim Nachzeichnen bleibt ganz still -- unauffindbar");
		checks += 4;
	}

	// ---- 4. EIN Trichter fuer ALLE Schreiber ----------------------------------------------------------
	// 🔴 Die Uebernahme steht in postEcosystemEdit, nicht an den Aufrufern (Ecken, Pinsel, Vereinfachen,
	// Verrechnen, Anlegen, Loeschen, Rueckgaengig). Das haelt nur, solange es keinen zweiten Schreibkanal
	// zum Landschafts-Endpunkt gibt -- und genau das prueft dieser Abschnitt.
	{
		const quelle = lies("js/map-features/map-features-ecosystem-region-store.js");
		const trichter = rumpfVon(quelle, "postEcosystemEdit");
		assert.ok(/avesmapsEcosystemKurvenAusAntwortAnwenden\(\s*result\s*\)/.test(trichter),
			"postEcosystemEdit reicht die Kurven der Antwort nicht weiter");
		assert.ok(rumpfVon(quelle, "avesmapsEcosystemKurvenAusAntwortAnwenden").includes("result && result.curve_labels"),
			"die Uebernahme liest nicht `curve_labels` -- den Schluessel, den der Server setzt");
		checks += 2;

		// Der Landschaften-Editor schreibt ueber das Elternfenster, nicht selbst.
		const editor = lies("html/landschaften-editor.html");
		const ecoPost = rumpfVon(editor, "ecoPost");
		assert.ok(ecoPost.includes("window.parent.postEcosystemEdit") && !ecoPost.includes("fetch("),
			"der Landschaften-Editor hat einen eigenen Schreibkanal -- seine Speicherungen erreichten die Karte nicht");
		checks += 1;

		// Kein zweiter fetch auf den Endpunkt im Kartencode.
		const treffer = [];
		const laufe = (verzeichnis) => {
			for (const name of fs.readdirSync(path.join(wurzel, verzeichnis))) {
				const relativ = verzeichnis + "/" + name;
				if (name === "__tests__" || name === "third-party") {
					continue;
				}
				if (fs.statSync(path.join(wurzel, relativ)).isDirectory()) {
					laufe(relativ);
				} else if (name.endsWith(".js") && /fetch\(\s*ECOSYSTEM_EDIT_API_URL/.test(lies(relativ))) {
					treffer.push(relativ);
				}
			}
		};
		laufe("js");
		assert.deepStrictEqual(treffer, ["js/map-features/map-features-ecosystem-region-store.js"],
			"ein zweiter Schreibkanal zum Landschafts-Endpunkt -- seine Antworten gingen an der Kurvenuebernahme vorbei: " + treffer.join(", "));
		checks += 1;
	}

	// ---- 5. Die NAHT: der Server setzt denselben Schluessel, den der Browser liest ---------------------
	// Beide Haelften oben sind je fuer sich gruen; ein anders geschriebener Schluessel auf einer Seite
	// liesse sie gruen und die Karte alt.
	{
		const store = lies("api/_internal/app/curve-label-store.php");
		const vonNach = store.indexOf("function avesmapsCurveNachSchreibvorgang(");
		assert.ok(vonNach >= 0, "avesmapsCurveNachSchreibvorgang fehlt");
		const nach = store.slice(vonNach, store.indexOf("\n}", vonNach));
		assert.ok(nach.includes("$result['curve_labels'] = $kurven['linien']"),
			"der Server legt die Kurven nicht unter `curve_labels` in die Antwort");
		const vonStale = store.indexOf("function avesmapsCurveRefreshStale(");
		const stale = store.slice(vonStale, store.indexOf("\n}", vonStale));
		assert.ok(/\$raus\['linien'\]\[\$id\] = \['line' => .+, 'max' => /.test(stale),
			"die Linien tragen nicht die Schluessel `line`/`max`, die der Sammelweg liest");
		checks += 2;
	}

	console.log("kurve-folgt-dem-eckzug: " + checks + " checks passed");
})().catch((fehler) => {
	console.error(fehler);
	process.exit(1);
});
