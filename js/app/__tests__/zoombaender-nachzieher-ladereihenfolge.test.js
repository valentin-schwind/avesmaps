const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Der Nachzieher der Zoombänder in js/config.js darf NICHT laufen, solange noch keine Marker stehen.
//
// Der Fall, der ihn nötig gemacht hat: die Antwort von api/app/zoom-bands.php ist wenige hundert
// Byte gross und kann eintreffen, BEVOR js/app/bootstrap.js gelaufen ist -- das steht in index.html
// als vorletztes von ~117 Skripten, js/config.js schon bei 2984. In diesem Fenster existiert
// `syncLocationMarkerVisibility` bereits (seine eigene Datei ist durch), aber seine erste Zeile ruft
// `syncLocationToggleButtons` aus bootstrap.js. Live gemessen:
//   Uncaught (in promise) ReferenceError: syncLocationToggleButtons is not defined
//       at syncLocationMarkerVisibility (map-features-location-marker-rendering.js:281)
//       at config.js:429
//
// 💣 Der Block wird AUS DER ECHTEN DATEI geschnitten, nicht abgeschrieben -- ein hier abgetippter
// Riegel wäre grün, während die Auslieferung längst wieder ohne ihn fährt.
//
// Aus der Wurzel des Repos:  node js/app/__tests__/zoombaender-nachzieher-ladereihenfolge.test.js

// 💣 ZEILENENDEN NORMALISIEREN. `.gitattributes` setzt `text=auto`; auf Windows liefert ein
// frischer Checkout (auch ein `git stash pop`) diese Datei mit CRLF, waehrend sie im Arbeitsbaum
// daneben LF haben kann. Ein Test, der auf ein rohes LF-Muster schneidet, ist dann in dem einen
// Baum gruen und im anderen rot -- ohne dass sich am Code irgendetwas geaendert haette. Genau das
// ist beim Bau dieses Tests passiert.
const quelle = fs.readFileSync(path.join(__dirname, "../../config.js"), "utf8")
	.replace(new RegExp(String.fromCharCode(13) + String.fromCharCode(10), "g"), String.fromCharCode(10));
const anfang = quelle.indexOf('if (typeof avesmapsLoadLocationZoomBands === "function") {');
assert.ok(anfang >= 0, "Der Zoomband-Block steht nicht mehr in js/config.js -- Test nachziehen.");
const ende = quelle.indexOf("\n}\n", anfang);
assert.ok(ende > anfang, "Ende des Zoomband-Blocks nicht gefunden.");
const block = quelle.slice(anfang, ende + 3);

// Ein Lauf des Blocks. `marker` === undefined bedeutet: `locationMarkers` ist gar nicht deklariert
// (so laden drei verify-Prüfseiten js/config.js -- ohne js/app/runtime-state.js).
// `bootstrapGeladen: false` stellt das Zeitfenster nach: js/app/bootstrap.js ist noch nicht durch,
// also gibt es `syncLocationToggleButtons` nicht.
function laufen({ marker, changed = true, bootstrapGeladen = true }) {
	const gerufen = [];
	const sandbox = {
		Promise,
		avesmapsLoadLocationZoomBands: () => Promise.resolve(changed),
		bumpLocationNameLabelStyleRevision: () => gerufen.push("bumpLabel"),
		bumpLocationMarkerStyleRevision: () => gerufen.push("bumpMarker"),
		// Bildet die echte Datei nach: erste Zeile ruft die Funktion aus bootstrap.js.
		syncLocationMarkerVisibility: () => {
			sandbox.syncLocationToggleButtons();
			gerufen.push("syncMarker");
		},
		syncLocationNameLabelVisibility: () => gerufen.push("syncLabel"),
	};
	if (marker !== undefined) {
		sandbox.locationMarkers = marker;
	}
	if (bootstrapGeladen) {
		sandbox.syncLocationToggleButtons = () => gerufen.push("toggleButtons");
	}
	vm.createContext(sandbox);
	vm.runInContext(block, sandbox, { filename: "js/config.js (Ausschnitt)" });
	// Auf die Mikrotasks des .then warten.
	return Promise.resolve().then(() => Promise.resolve()).then(() => gerufen);
}

(async () => {
	// 1) DER REGRESSIONSFALL. bootstrap.js ist noch nicht gelaufen: `syncLocationToggleButtons`
	//    existiert nicht. Vor der Reparatur warf genau das hier.
	const ohneBootstrap = await laufen({ marker: [], bootstrapGeladen: false });
	assert.deepStrictEqual(ohneBootstrap, [],
		"Ohne gezeichnete Marker darf KEIN Nachzieher laufen (sonst der ReferenceError aus dem Kopf).");

	// 2) Derselbe Fall auf einer Seite ohne js/app/runtime-state.js: `locationMarkers` ist
	//    UNdeklariert. `typeof` liefert dort "undefined" statt zu werfen -- anders als bei einer
	//    noch uninitialisierten let/const-Bindung.
	const ohneRuntimeState = await laufen({ marker: undefined, bootstrapGeladen: false });
	assert.deepStrictEqual(ohneRuntimeState, [],
		"Ohne deklariertes locationMarkers darf der Block still aussteigen, nicht werfen.");

	// 3) Stehen Marker, wird nachgezogen -- alle vier, in dieser Reihenfolge. Die beiden bump-Rufe
	//    sind nicht schmückend: die Icon-Schlüssel kennen Zoomstufe und Warnring, aber NICHT die
	//    Größe (AGENTS.md §11, Zoombänder).
	const mitMarkern = await laufen({ marker: [{}] });
	assert.deepStrictEqual(mitMarkern, ["bumpLabel", "bumpMarker", "toggleButtons", "syncMarker", "syncLabel"],
		"Mit gezeichneten Markern müssen alle vier Nachzieher laufen.");

	// 4) Unveränderte Bänder kosten keinen Sichtbarkeits-Pass.
	const unveraendert = await laufen({ marker: [{}], changed: false });
	assert.deepStrictEqual(unveraendert, [],
		"Ohne Abweichung von der Vorgabe darf nichts nachgezogen werden.");

	console.log("OK zoombaender-nachzieher-ladereihenfolge (4 Fälle)");
})();
