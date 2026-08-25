// „Position zurücksetzen" am Label: die Beschriftung geht an den Point of Inaccessibility ihrer
// Fläche zurück -- den Punkt mit dem grössten Abstand zu allen Kanten, denselben, den das Anlegen
// einer Landschaftsfläche vergibt (createEcosystemRegionLabel, map-features-ecosystem-draw.js).
// Owner 25.08.2026: „dass es an den point of inaccesiblity zurückverschoben wird".
//
// Geprüft werden die beiden RECHNUNGEN dahinter, jede für sich, dann die Kachel und ihre Verdrahtung:
//   1. der Zielpunkt aus der Geometrie -- samt der Drehung GeoJSON [x,y] -> Leaflet [lat,lng]
//   2. das Ausweichen, wenn dort schon eine andere Beschriftung derselben Fläche liegt
//   3. die Kachel -- nur, wo es eine Fläche gibt
//   4. die Verdrahtung: EIN Weg zur Fläche, EIN Speicherweg, die Rückfrage
//
// ⚠️ map-features-labels.js lässt sich nicht als Ganzes laden (sie fasst beim Laden `map` an).
// Geschnitten werden deshalb genau die beiden Funktionen -- dasselbe Vorgehen wie in
// label-groesse-tiefer-zoom.test.js, und mit derselben Ehrlichkeit: der Test misst diese beiden.
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/label-position-zuruecksetzen.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..", "..", "..");

// 💣 ZEILENENDEN VEREINHEITLICHEN. Das Repo steht unter `text=auto`: auf Windows liegt die Datei
// mit CRLF im Arbeitsbaum, im Deploy-Tor (Linux) mit LF. Ein Test, der auf "\r\n" sucht, misst
// deshalb auf dem Entwicklungsrechner etwas anderes als in der CI -- und genau daran ist der erste
// Anlauf dieses Tests gescheitert: lokal gruen, im Tor rot, Deploy abgebrochen, nichts hochgeladen.
const lies = (...teile) => fs.readFileSync(path.join(ROOT, ...teile), "utf8").replace(/\r\n/g, "\n");
const quelle = lies("js", "map-features", "map-features-labels.js");

// Eine benannte Funktion samt allem, was zwischen ihrem Kopf und ihrer schliessenden Klammer steht.
function schneide(name) {
	const marke = quelle.indexOf("function " + name + "(");
	assert.ok(marke >= 0, `${name} steht in map-features-labels.js`);
	const bis = quelle.indexOf("\n}", marke);
	assert.ok(bis > marke, `${name} hat ein Ende`);
	return quelle.slice(marke, bis + 2);
}

// ---- 1. Der Zielpunkt: der echte polylabel-Wrapper, keine Attrappe ------------------------------
//
// 💣 DIE DREHUNG IST DIE FALLE. GeoJSON speichert [x, y], Leaflet L.CRS.Simple will [lat, lng] =
// [y, x] (AGENTS.md §5). Ein vertauschtes Paar sieht in keiner Konsole falsch aus -- das Label
// landet nur irgendwo anders auf der Karte. Die Fixture ist deshalb bewusst UNSYMMETRISCH: bei
// einem Quadrat um den Ursprung wäre der Tausch unsichtbar.
const drittanbieter = {};
vm.createContext(drittanbieter);
vm.runInContext(lies("js", "third-party", "polylabel.js"), drittanbieter);

const poiLatLng = new Function(
	"avesmapsComputeLabelPoint",
	schneide("avesmapsLabelZurueckPoiLatLng") + "; return avesmapsLabelZurueckPoiLatLng;"
)(drittanbieter.avesmapsComputeLabelPoint);

// Ein Rechteck, das in x von 100,037..500,037 und in y von 20,011..60,011 läuft -- Mitte
// (300,037 | 40,011).
//
// 💣 DIE KRUMMEN NACHKOMMASTELLEN SIND ABSICHT. Auf einem glatten Rechteck fiele nicht auf, dass der
// Zielpunkt durch die Layer-Punkte gerundet wird: Leaflets `latLngToLayerPoint` liefert GANZE Pixel,
// und bei Zoom 4 ist ein Pixel 1/16 Karteneinheit. Live gemessen am Sichelhag (25.08.2026): der Punkt
// lag bei (601,2425 | 569,7005), gespeichert wurde (601,25 | 569,6875). Bei Zoom 0 ist dasselbe Pixel
// eine GANZE Karteneinheit -- dann ist der Fehler sichtbar.
const rechteck = {
	type: "Polygon",
	coordinates: [[[100.037, 20.011], [500.037, 20.011], [500.037, 60.011], [100.037, 60.011], [100.037, 20.011]]],
};
const ziel = poiLatLng(rechteck);
assert.ok(ziel, "für ein gültiges Rechteck gibt es einen Punkt");
assert.ok(Math.abs(ziel.lat - 40) < 1.5, `lat kommt aus der Y-Achse (erwartet ~40, war ${ziel.lat})`);
assert.ok(Math.abs(ziel.lng - 300) < 1.5, `lng kommt aus der X-Achse (erwartet ~300, war ${ziel.lng})`);

// 💣 Ohne Fläche gibt es keinen Punkt -- und dann muss `null` herauskommen, nicht {lat: NaN}. Ein
// NaN-Paar reist bis in `move_label` und schreibt dort eine Beschriftung ins Nirgendwo.
assert.strictEqual(poiLatLng(null), null, "ohne Geometrie kein Punkt");
assert.strictEqual(poiLatLng({ type: "LineString", coordinates: [[0, 0], [1, 1]] }), null,
	"eine Linie ist keine Fläche");

// ---- 2. Das Ausweichen ------------------------------------------------------------------------
//
// 🔴 20 px nach unten UND nach rechts, wie beim Duplizieren (Owner 25.08.2026). Gerechnet wird in
// Layer-Punkten, also Bildschirmpixeln der aktuellen Zoomstufe -- dieselbe Einheit, in der
// duplicateLabelEntry seinen Versatz misst.
const versatz = Number((quelle.match(/const LABEL_ZURUECK_VERSATZ_PX = (\d+)/) || [])[1]);
assert.strictEqual(versatz, 20, "der Versatz steht als Konstante da und ist 20 px");

const freierPunkt = new Function(
	"LABEL_ZURUECK_VERSATZ_PX",
	schneide("avesmapsLabelZurueckFreierPunkt") + "; return avesmapsLabelZurueckFreierPunkt;"
)(versatz);

// Niemand sonst liegt dort: der Point of Inaccessibility SELBST, unverrückt. Das ist der Auftrag --
// ein Versatz „für alle Fälle" verfehlte genau den Punkt, um den es geht.
assert.deepStrictEqual(freierPunkt({ x: 300, y: 40 }, []), { x: 300, y: 40 },
	"allein steht die Beschriftung auf dem Punkt");

// Eine andere Beschriftung derselben Fläche liegt schon genau dort -> 20 px nach rechts unten.
assert.deepStrictEqual(freierPunkt({ x: 300, y: 40 }, [{ x: 300, y: 40 }]), { x: 320, y: 60 },
	"belegt: 20 px nach rechts und nach unten");

// 💣 +y ist UNTEN und +x ist RECHTS (Leaflet-Layer-Punkte). Ein Vorzeichenfehler schöbe die
// Beschriftung nach links oben -- also aus der Fläche heraus, wenn der Punkt am Rand liegt.
const eins = freierPunkt({ x: 300, y: 40 }, [{ x: 300, y: 40 }]);
assert.ok(eins.x > 300 && eins.y > 40, "der Versatz geht nach rechts unten, nicht nach links oben");

// Zwei gestapelte -> zwei Schritte.
assert.deepStrictEqual(freierPunkt({ x: 300, y: 40 }, [{ x: 300, y: 40 }, { x: 320, y: 60 }]), { x: 340, y: 80 },
	"zwei belegte Plätze kosten zwei Schritte");

// Wer weit genug weg liegt, blockiert nicht.
assert.deepStrictEqual(freierPunkt({ x: 300, y: 40 }, [{ x: 500, y: 400 }]), { x: 300, y: 40 },
	"eine Beschriftung anderswo hält den Punkt nicht besetzt");

// 💣 Der Lauf muss ENDEN. Ohne Deckel dreht er sich an einer dicht besetzten Diagonale weiter --
// im Klick-Handler eines Popups wäre das ein eingefrorener Browser, kein Fehler.
const dicht = [];
for (let i = 0; i < 40; i += 1) {
	dicht.push({ x: 300 + i * 20, y: 40 + i * 20 });
}
const ausweg = freierPunkt({ x: 300, y: 40 }, dicht);
assert.ok(Number.isFinite(ausweg.x) && Number.isFinite(ausweg.y), "auch dicht besetzt kommt ein Punkt heraus");

// ---- 3. Die Kachel: nur mit Fläche -------------------------------------------------------------
//
// 🔴 Der Punkt, an den zurückgesetzt wird, ist der Point of Inaccessibility IHRER Fläche. Ein freies
// Label und ein Gipfel haben keine -- dort wäre die Kachel ein Knopf, der nichts tun kann. Dieselbe
// Frage und dieselbe Antwort wie bei „Eigenschaften" und „Fläche bearbeiten"
// (label-flaechen-kacheln.test.js).
function ladePopups({ editMode = true } = {}) {
	const sandbox = {
		IS_EDIT_MODE: editMode,
		CROSSING_LOCATION_TYPE: "kreuzung",
		pendingPathCreationStart: null,
		pendingPowerlineCreationStart: null,
		escapeHtml: (v) => String(v == null ? "" : v)
			.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
		buildHtmlAttributes: (attrs) => Object.entries(attrs || {})
			.filter(([, v]) => v !== undefined && v !== null)
			.map(([k, v]) => ` ${k}="${String(v)}"`).join(""),
		tr: (key, german) => german,
		withAssetVersion: (u) => u,
		findWaypointIdByLocationName: () => "",
		findLocationMarkerByPublicId: () => null,
		findLabelEntryByPublicId: () => null,
		buildSuggestChangeButtonSpec: () => null,
		console,
		window: {},
		document: { querySelector: () => null, querySelectorAll: () => [] },
	};
	sandbox.globalThis = sandbox;
	vm.createContext(sandbox);
	vm.runInContext(lies("js", "ui", "popups.js"), sandbox, { filename: "popups.js" });
	return sandbox;
}

const editor = ladePopups();
const mitFlaeche = editor.labelActionsMarkup("lab-1", "", { hatFlaeche: true });
assert.ok(mitFlaeche.includes('data-popup-action="reset-label-position"'), "mit Fläche steht die Kachel da");
assert.ok(mitFlaeche.includes("Position zurücksetzen"), "und heisst so");
assert.ok(mitFlaeche.includes("↺"), "↺ -- dasselbe Zeichen wie beim Zurückholen einer Wiki-Zeile");

// 💣 Sie ist der Gegenpart zum Verschieben und steht deshalb DANEBEN, nicht unten bei den beiden
// Flächen-Handgriffen: zurückgesetzt wird die BESCHRIFTUNG, nicht die Fläche.
assert.ok(mitFlaeche.indexOf("reset-label-position") < mitFlaeche.indexOf("label-area-properties"),
	"sie steht bei den Label-Kacheln, vor den Flächen-Handgriffen");

const ohneFlaeche = editor.labelActionsMarkup("lab-1", "", { hatFlaeche: false });
assert.ok(!ohneFlaeche.includes("reset-label-position"),
	"💣 ein freies Label bekommt keinen Knopf, der nichts tun kann");
assert.ok(ohneFlaeche.includes("delete-label"), "⚠️ die übrigen Kacheln bleiben aber");
assert.strictEqual(ladePopups({ editMode: false }).labelActionsMarkup("lab-1", "", { hatFlaeche: true }), "",
	"🔴 ohne Bearbeiten-Modus entsteht gar nichts");

// ---- 4. Die Verdrahtung ------------------------------------------------------------------------
const ohneKommentare = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
const routing = ohneKommentare(lies("js", "routing", "routing.js"));
assert.ok(routing.includes('"reset-label-position"'), "💣 der Klick wird behandelt");
assert.ok(routing.includes("avesmapsLabelPositionZuruecksetzen("), "und zwar über den einen Handgriff");

const labels = ohneKommentare(quelle);
assert.ok(labels.includes("async function avesmapsLabelPositionZuruecksetzen"), "es gibt ihn");

// 🔴 DERSELBE Weg zur Fläche wie die beiden Nachbarkacheln, samt Ansichtswechsel -- im Standardmodus
// ist die Fläche gar nicht geladen, und ohne ihre Geometrie gibt es keinen Punkt zu rechnen.
const rumpf = labels.slice(labels.indexOf("async function avesmapsLabelPositionZuruecksetzen"));
const handgriff = rumpf.slice(0, rumpf.indexOf("\n}") + 2);

// 💣 ERST PRUEFEN, DASS DER AUSSCHNITT UEBERHAUPT EINER IST. Geht der Schnitt daneben, liefert er
// ein paar Zeichen -- und jede Zusicherung darunter prueft dann nicht den Handgriff, sondern nichts.
// Die erste Fassung suchte nach "\r\n}" mit `|| "\n}"` als Rueckfall; bei LF ergab `-1 + 3` die 2,
// und die ist wahr, also kam der Rueckfall nie zum Zug: der "Handgriff" war der String "as".
assert.ok(handgriff.length > 500 && handgriff.trimEnd().endsWith("}"),
	`der Ausschnitt ist wirklich der ganze Handgriff (war ${handgriff.length} Zeichen)`);
assert.ok(/avesmapsEcosystemAreaPublicIdOfLabel\([^)]*wechsleAnsicht: true/.test(handgriff),
	"💣 über avesmapsEcosystemAreaPublicIdOfLabel mit Ansichtswechsel, kein zweiter Weg zur Fläche");

// 🪤 Geschrieben wird über den GEMEINSAMEN Speicherweg -- Protokoll, Revision und der Nachzug auf der
// Karte hängen alle dort. Ein eigener submitMapFeatureEdit wäre die zweite Wahrheit.
assert.ok(handgriff.includes("saveLabelPosition(entry)"),
	"💣 gespeichert wird über saveLabelPosition, nicht über einen eigenen Aufruf");
assert.ok(!handgriff.includes("submitMapFeatureEdit("), "und nicht daran vorbei");

// 🔴 Rückfrage, sobald die Fläche mehr als eine Beschriftung trägt (Owner-Entscheid 25.08.2026):
// zurückgesetzt rücken sie zusammen, und eine davon blendet die Kollisionsauflösung aus.
assert.ok(handgriff.includes("countEcosystemRegionLabels("), "die Geschwister werden gezählt");
assert.ok(handgriff.includes("window.confirm("), "💣 und ab zwei kommt die Rückfrage");

console.log("label-position-zuruecksetzen: alle Zusicherungen erfüllt");

// ---- 5. Der ABLAUF ------------------------------------------------------------------------------
//
// 💣 Die Teile einzeln zu prüfen reicht nicht -- die Rechnungen können stimmen und trotzdem in der
// falschen Reihenfolge stehen (Rückfrage NACH dem Ansichtswechsel, Versatz gegen die eigene
// Beschriftung gerechnet, gespeichert vor dem Verschieben). Hier läuft der Handgriff wirklich, mit
// Attrappen für Karte, Regionen und Speicherweg.
//
// Die Attrappen-Karte bildet die echte Beziehung ab: Layer-Punkte zählen y nach UNTEN, Breitengrade
// nach NORDEN. „20 px nach unten" heisst deshalb „lat um 20 kleiner" -- und ein Vorzeichenfehler im
// Versatz fiele genau hier auf.
const handgriffQuelle = "async " + schneide("avesmapsLabelPositionZuruecksetzen");

function baueHandgriff({ geschwisterZahl, flaeche = "area-1", nachbarn = [], antwortAufRueckfrage = true }) {
	const protokoll = { rueckfragen: [], toasts: [], gespeichert: 0, wechsleAnsicht: null };
	const label = { text: "Sichelhag", coordinates: [999, 999], ecosystemRegionPublicId: "reg-1" };
	const marker = {
		latlng: { lat: 999, lng: 999 },
		setLatLng(ll) { this.latlng = ll; },
		getLatLng() { return this.latlng; },
	};
	const entry = { label, marker };
	const fn = new Function(
		"showFeedbackToast", "loadEcosystemRegions", "ECOSYSTEM_KINDS", "ecosystemRegionOfLabel",
		"countEcosystemRegionLabels", "window", "avesmapsEcosystemAreaPublicIdOfLabel", "ecosystemLayers",
		"avesmapsLabelZurueckPoiLatLng", "labelData", "map", "L", "avesmapsLabelZurueckFreierPunkt",
		"saveLabelPosition", "LABEL_ZURUECK_VERSATZ_PX",
		handgriffQuelle + "; return avesmapsLabelPositionZuruecksetzen;"
	)(
		(text, art) => protokoll.toasts.push({ text, art }),
		async () => {},
		["derographisch"],
		() => ({ public_id: "reg-1" }),
		() => geschwisterZahl,
		{ confirm: (frage) => { protokoll.rueckfragen.push(frage); return antwortAufRueckfrage; } },
		async (_label, optionen) => { protokoll.wechsleAnsicht = optionen && optionen.wechsleAnsicht; return flaeche; },
		new Map([["area-1", { _ecosystemArea: { geometry: rechteck } }]]),
		poiLatLng,
		[label].concat(nachbarn),
		// Wie Leaflet bei Zoom 4: 16 Pixel je Karteneinheit, und `latLngToLayerPoint` RUNDET auf ganze
		// Pixel. Ohne die Rundung wäre die Attrappe gnädiger als die echte Karte -- und genau der Fehler,
		// den die Abnahme im Browser gefunden hat, käme im Test nie zum Vorschein.
		{
			latLngToLayerPoint: (ll) => ({ x: Math.round(ll.lng * 16), y: Math.round(-ll.lat * 16) }),
			layerPointToLatLng: (pt) => ({ lat: -pt.y / 16, lng: pt.x / 16 }),
		},
		{ latLng: (lat, lng) => ({ lat, lng }), point: (x, y) => ({ x, y }) },
		freierPunkt,
		async () => { protokoll.gespeichert += 1; },
		versatz
	);

	return { fn, entry, protokoll, marker };
}

(async () => {
	// (a) Eine einzige Beschriftung: keine Rückfrage, und sie landet AUF dem Punkt.
	const allein = baueHandgriff({ geschwisterZahl: 1 });
	await allein.fn(allein.entry);
	assert.deepStrictEqual(allein.protokoll.rueckfragen, [], "bei einer Beschriftung keine Rückfrage");
	assert.strictEqual(allein.protokoll.wechsleAnsicht, true, "💣 die Ansicht wechselt mit -- sonst ist die Fläche gar nicht geladen");
	// 💣 GENAU auf dem Punkt, nicht in seiner Nähe. Ohne Ausweichen darf die Rechnung nicht durch die
	// Layer-Punkte laufen: die runden auf ganze Pixel, und bei Zoom 0 ist ein Pixel eine ganze
	// Karteneinheit. Live gefunden am 25.08.2026, bevor irgendein Test es sah.
	assert.deepStrictEqual(allein.marker.getLatLng(), ziel,
		"sie landet EXAKT auf dem Point of Inaccessibility, nicht auf dem nächsten Bildschirmpixel");
	assert.strictEqual(allein.protokoll.gespeichert, 1, "genau einmal gespeichert");

	// (b) Eine zweite Beschriftung liegt schon genau dort: Rückfrage, und 20 px nach rechts UNTEN.
	const nachbar = { text: "Sichelhag (Süd)", coordinates: [ziel.lat, ziel.lng], ecosystemRegionPublicId: "reg-1" };
	const zuZweit = baueHandgriff({ geschwisterZahl: 2, nachbarn: [nachbar] });
	await zuZweit.fn(zuZweit.entry);
	assert.strictEqual(zuZweit.protokoll.rueckfragen.length, 1, "🔴 ab zwei Beschriftungen kommt die Rückfrage");
	assert.ok(zuZweit.protokoll.rueckfragen[0].includes("2 Beschriftungen"), "sie nennt die Zahl");
	// 20 Pixel bei 16 Pixel je Einheit sind 1,25 Karteneinheiten -- nach rechts (lng grösser) und nach
	// unten (lat kleiner, denn Layer-Punkte zählen y nach unten und Breitengrade nach Norden).
	const wo = zuZweit.marker.getLatLng();
	assert.ok(Math.abs((wo.lng - ziel.lng) - 1.25) < 0.1, `nach RECHTS um 20 px (war lng ${wo.lng})`);
	assert.ok(Math.abs((ziel.lat - wo.lat) - 1.25) < 0.1, `und nach UNTEN um 20 px (war lat ${wo.lat})`);
	assert.strictEqual(zuZweit.protokoll.gespeichert, 1, "einmal gespeichert");

	// (c) Rückfrage verneint: nichts passiert -- weder Verschieben noch Speichern.
	const abgelehnt = baueHandgriff({ geschwisterZahl: 2, nachbarn: [nachbar], antwortAufRueckfrage: false });
	await abgelehnt.fn(abgelehnt.entry);
	assert.strictEqual(abgelehnt.protokoll.gespeichert, 0, "abgelehnt heisst: nichts gespeichert");
	assert.deepStrictEqual(abgelehnt.marker.getLatLng(), { lat: 999, lng: 999 }, "und nichts verschoben");
	assert.strictEqual(abgelehnt.protokoll.wechsleAnsicht, null,
		"💣 die Rückfrage steht VOR dem Ansichtswechsel -- sonst springt die Karte für ein abgelehntes Zurücksetzen");

	// (d) Keine Fläche geladen: es sagt das, statt still zu bleiben oder ins Nirgendwo zu schreiben.
	const ohne = baueHandgriff({ geschwisterZahl: 1, flaeche: "" });
	await ohne.fn(ohne.entry);
	assert.strictEqual(ohne.protokoll.gespeichert, 0, "ohne Fläche wird nichts gespeichert");
	assert.strictEqual(ohne.protokoll.toasts.length, 1, "sondern gemeldet");
	assert.strictEqual(ohne.protokoll.toasts[0].art, "warning", "und zwar als Warnung");

	console.log("label-position-zuruecksetzen: Ablauf ok");
})();
