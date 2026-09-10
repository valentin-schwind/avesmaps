// „Alles an in den Landschaften -- ausser der Nutzer will es anders" (Owner 09.09.2026).
//
//   node js/map-features/__tests__/anzeigewahl-schlaegt-vorgabe.test.js
//
// 🪤 ATTRAPPEN OHNE PROXY. Ein Proxy, der jeden Bezeichner beantwortet, verschluckt genau den Fehler,
// den dieser Test finden soll -- die Lehre vom 03.09.2026, zwei Stunden ohne Beschriftungen auf der
// Live-Karte.
//
// 🪤 UND DIE ATTRAPPEN STEHEN EINE ETAGE TIEFER, ALS MAN ZUERST SCHREIBT. `isEcosystemLayerModeActive`,
// `canOperateEcosystemLayers`, `isEcosystemShowAllLayers` und `getActiveEcosystemLayerKind` sind
// FUNKTIONEN DIESER DATEI -- eine gleichnamige Attrappe im Kontext wird beim Ausfuehren des Skripts
// ueberschrieben und ist damit wirkungslos. Gestellt werden deshalb die Namen, die das Modul selbst
// liest: `getSelectedMapLayerMode`, `IS_EDIT_MODE`, `IS_ECOSYSTEM_ENABLED`, `activeEcosystemLayerKind`
// und der localStorage-Schluessel fuer „Alle". (Dieselbe Buehne wie in ecosystem-frontend-profil.)

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..", "..", "..");
const quelle = fs.readFileSync(
	path.join(ROOT, "js/map-features/map-features-ecosystem-layer-switch.js"), "utf8");

const ORTSKLASSEN = ["metropole", "grossstadt", "stadt", "kleinstadt", "dorf", "gebaeude"];
const HAKEN_IDS = ["togglePaths", "toggleMapLabels", "toggleTerritoryBorders", "toggleRivers"];
const SHOW_ALL_SCHLUESSEL = "avesmaps.ecosystem.showAllLayers";

/** Eine Welt, in der das Modul wirklich laeuft -- Attrappen mit genau den Namen, die es ruft. */
function welt({ editor = false, ebene = "vegetation", drin = true, orteVorher = false } = {}) {
	const haken = {};
	HAKEN_IDS.forEach((id) => {
		haken[id] = {
			id, checked: false, _hoerer: [],
			addEventListener(art, fn) { if (art === "change") { this._hoerer.push(fn); } },
			dispatchEvent(ereignis) { this._hoerer.forEach((fn) => fn(ereignis)); return true; }
		};
	});
	const klassen = {};
	ORTSKLASSEN.forEach((typ) => { klassen[typ] = orteVorher === true; });

	const zuhoerer = {};
	const kontext = {
		console,
		document: {
			getElementById: (id) => haken[id] || null,
			addEventListener: (art, fn) => { (zuhoerer[art] = zuhoerer[art] || []).push(fn); },
			querySelector: () => null,
			querySelectorAll: () => [],
			documentElement: {}
		},
		window: {
			localStorage: {
				getItem: (schluessel) => (schluessel === SHOW_ALL_SCHLUESSEL
					? (ebene === "alle" ? "1" : "0") : null),
				setItem: () => {}
			}
		},
		// ⚠️ Synchron, damit der Nachlauf des Ortsklassen-Klicks messbar ist. Der Grund fuer den
		// setTimeout im Modul (der eigene Handler des Knopfes setzt die Klasse erst) bleibt davon
		// unberuehrt -- hier setzt der Test die Klasse vor dem Ausloesen.
		setTimeout: (fn) => { fn(); return 0; },
		Event: function (art, o) { this.type = art; this.bubbles = Boolean(o && o.bubbles); this.isTrusted = false; },
		// Die Namen, die das Modul WIRKLICH liest -- siehe der Kopf dieser Datei.
		getSelectedMapLayerMode: () => (drin ? "ecosystem" : "deregraphic"),
		IS_EDIT_MODE: editor,
		IS_ECOSYSTEM_ENABLED: editor,
		isKnownEcosystemKind: () => true,
		activeEcosystemLayerKind: ebene === "alle" ? "vegetation" : ebene,
		ECOSYSTEM_KINDS: ["derographisch", "vegetation", "topographie", "klima"],
		ECOSYSTEM_KIND_PANES: {},
		LOCATION_TYPE_VISIBILITY_ORDER: ORTSKLASSEN,
		getLocationToggleButton: (typ) => ({
			hasClass: () => klassen[typ] === true,
			removeClass: () => { klassen[typ] = false; },
			toggleClass: (_k, an) => { klassen[typ] = an === true; }
		}),
		syncLocationMarkerVisibility: () => {},
		syncLocationToggleButtons: () => {},
		syncPathVisibility: () => {},
		map: null, baseTileLayer: null
	};
	kontext.globalThis = kontext;
	vm.createContext(kontext);
	vm.runInContext(quelle, kontext);
	return { kontext, haken, klassen, zuhoerer };
}

// ---- 1. Ein Profil, und es steht auf ALLES AN ----------------------------------------------------
const besucher = welt();
const soll = besucher.kontext.ecosystemAnzeigeSoll();
assert.ok(soll, "der Besucher bekommt ein Soll");
assert.strictEqual(soll.wege, true, "Wege an");
assert.strictEqual(soll.labels, true, "Labels an");
assert.strictEqual(soll.grenzen, true, "Grenzen an");
assert.strictEqual(soll.fluesse, true, "Fluesse und Seen an");
assert.strictEqual(soll.untergrund, 0, "Untergrund aus");
ORTSKLASSEN.forEach((typ) => {
	assert.strictEqual(soll.orte[typ], true, "Ortsklasse " + typ + " an -- bis hinunter zu"
		+ " „Besondere Bauwerke/Staetten\" (gebaeude), das ist die letzte der sechs.");
});

// ---- 2. Und zwar in JEDER Ebene -- die „ruhige Zeichenflaeche" ist gefallen -----------------------
["alle", "derographisch", "vegetation", "topographie", "klima"].forEach((ebene) => {
	const s = welt({ ebene }).kontext.ecosystemAnzeigeSoll();
	assert.strictEqual(s.wege, true, "auch in " + ebene + " sind die Wege an");
	assert.strictEqual(s.untergrund, 0, "und der Untergrund aus");
});

// ---- 3. Der Editor bekommt KEIN Profil -----------------------------------------------------------
assert.strictEqual(welt({ editor: true }).kontext.ecosystemAnzeigeSoll(), null,
	"der Editor behaelt seine leere Zeichenflaeche und seine Haken (Owner 09.09.2026)");
assert.strictEqual(welt({ drin: false }).kontext.ecosystemAnzeigeSoll(), null,
	"und ausserhalb der Landschaften wird gar nichts angefasst");

// ---- 4. DIE TRAGENDE ZUSICHERUNG: unser eigenes Setzen ist KEINE Nutzerwahl -----------------------
// 💣 Ohne sie schreibt das Anwenden der Vorgabe die Vorgabe als „Wahl" fest, und das Profil ist fuer
// den Rest des Besuchs wirkungslos -- waehrend die Karte genau das zeigt, was die Vorgabe wollte.
{
	const w = welt();
	w.kontext.syncEcosystemFrontendFeatures();
	assert.strictEqual(w.kontext.ecosystemAnzeigeWahlGesetzt(), false,
		"nach dem Anwenden der Vorgabe gibt es KEINE Nutzerwahl -- unsere eigenen Ereignisse"
		+ " tragen isTrusted === false.");
}

// ---- 5. Eine echte Hand schon -- und sie schlaegt die Vorgabe ------------------------------------
{
	const w = welt();
	w.kontext.syncEcosystemFrontendFeatures();
	assert.strictEqual(w.haken.togglePaths.checked, true, "die Vorgabe hat die Wege angeschaltet");
	w.haken.togglePaths.checked = false;
	w.haken.togglePaths.dispatchEvent({ type: "change", isTrusted: true });
	assert.strictEqual(w.kontext.ecosystemAnzeigeWahlGesetzt(), true, "jetzt gibt es eine Wahl");
	assert.strictEqual(w.kontext.ecosystemAnzeigeSoll().wege, false, "und sie sagt: Wege aus");

	// ...und ein Ebenenwechsel macht sie NICHT platt. Er wendet das Soll erneut an -- das IST
	// seine Wahl, also ein Leerlauf.
	w.kontext.syncEcosystemFrontendFeatures();
	assert.strictEqual(w.haken.togglePaths.checked, false,
		"der Ebenenwechsel laesst die Wege aus -- genau das war der Auftrag");
}

// ---- 5b. Auch die Labels haengen am Soll ---------------------------------------------------------
// 💣 `toggleMapLabels` ist der Haken, der bis zum 09.09.2026 GAR NICHT im Profil stand. Ohne diesen
// Fall koennte er aus dem Profil fallen, ohne dass ein Test rot wird.
{
	const w = welt();
	w.kontext.syncEcosystemFrontendFeatures();
	assert.strictEqual(w.haken.toggleMapLabels.checked, true, "die Vorgabe schaltet die Labels an");
	assert.strictEqual(w.haken.toggleTerritoryBorders.checked, true, "und die Grenzen");
}

// ---- 6. DIE DREI FAELLE DER ORTSKLASSEN, durch den ausgefuehrten Applier -------------------------
//
// 💣 Sie sind der Grund, warum syncEcosystemSettlementVisibility beim Umbau NICHT auf „soll oder
// nicht" verkuerzt werden darf: `ecosystemAnzeigeSoll()` gibt dem Editor `null`, und er faellt damit
// in den Rueckgabe-Zweig -- er bekaeme seine Ortsknoepfe zurueck, statt die leere Zeichenflaeche zu
// behalten. Das waere ein Verhaltenswechsel, den niemand bestellt hat.

// (A) Besucher DRIN: die Orte werden aktiv EINGESCHALTET, nicht bloss „nicht weggenommen".
{
	const w = welt({ orteVorher: false });
	w.kontext.syncEcosystemSettlementVisibility(true);
	assert.ok(ORTSKLASSEN.every((typ) => w.klassen[typ] === true),
		"🔴 der Besucher bekommt in den Landschaften ALLE sechs Ortsklassen -- „default aktiviert und"
		+ " sichtbar\" (Owner 09.09.2026): " + JSON.stringify(w.klassen));

	// Und beim Verlassen bekommt er den Stand von VOR den Landschaften zurueck (hier: alle aus).
	w.kontext.syncEcosystemSettlementVisibility(false);
	assert.ok(ORTSKLASSEN.every((typ) => w.klassen[typ] === false),
		"💣 das Ausleih-Gedaechtnis lebt weiter -- beim Verlassen steht wieder da, was vorher war: "
		+ JSON.stringify(w.klassen));
}

// (B) Editor DRIN: die leere Zeichenflaeche bleibt.
{
	const w = welt({ editor: true, orteVorher: true });
	w.kontext.syncEcosystemSettlementVisibility(true);
	assert.ok(ORTSKLASSEN.every((typ) => w.klassen[typ] === false),
		"🔴 der Editor behaelt die leere Zeichenflaeche (Owner 04.08.2026, bestaetigt 09.09.2026): "
		+ JSON.stringify(w.klassen));
	w.kontext.syncEcosystemSettlementVisibility(false);
	assert.ok(ORTSKLASSEN.every((typ) => w.klassen[typ] === true),
		"und auch er bekommt seine Lage beim Verlassen zurueck: " + JSON.stringify(w.klassen));
}

// (C) DRAUSSEN, ohne je drin gewesen zu sein: es wird nichts angefasst.
{
	const w = welt({ drin: false, orteVorher: true });
	w.kontext.syncEcosystemSettlementVisibility(false);
	assert.ok(ORTSKLASSEN.every((typ) => w.klassen[typ] === true),
		"💣 ohne Eintritt gibt es nichts zurueckzugeben -- hier wird nichts angefasst: "
		+ JSON.stringify(w.klassen));
}

// (D) UND WENN `inLayer` UND DER MODUS SICH WIDERSPRECHEN, WIRD NICHTS ANGEFASST.
// 💣 Der Parameter kommt von aussen. Beide Aufrufer reichen heute `isEcosystemLayerModeActive()`
// herein, aber die Funktion glaubt ihm nicht blind: der Editor-Zweig fragt `canOperateEcosystemLayers()`
// ausdruecklich und nicht bloss „kein Soll". Ohne diese Frage naehme ein widerspruechlicher Aufruf
// einem BESUCHER seine Ortsknoepfe weg -- ausserhalb der Landschaften, also in „Politisch" oder
// „Standard", wo diese Ebene nichts anzufassen hat.
// ⚠️ Der Fall ist ueber die heutigen Aufrufer nicht erreichbar; genau deshalb steht er hier. Ohne ihn
// waere die Frage im Editor-Zweig streichbar, ohne dass ein Test rot wird (gemessen 10.09.2026).
{
	const w = welt({ drin: false, orteVorher: true });
	w.kontext.syncEcosystemSettlementVisibility(true);
	assert.ok(ORTSKLASSEN.every((typ) => w.klassen[typ] === true),
		"💣 ein `inLayer`, dem der Modus widerspricht, darf einem Besucher nichts wegnehmen: "
		+ JSON.stringify(w.klassen));
}

// (A') Und die WAHL schlaegt auch hier die Vorgabe: wer die Orte in den Landschaften abschaltet,
// bekommt sie beim naechsten Ebenenwechsel nicht wieder aufgedraengt.
{
	const w = welt({ orteVorher: false });
	w.kontext.syncEcosystemSettlementVisibility(true);
	assert.ok(ORTSKLASSEN.every((typ) => w.klassen[typ] === true), "Vorbedingung: alle sechs an");

	// Eine echte Hand am Ortsklassen-Knopf -- der Zuhoerer haengt am `click` des Dokuments, weil ein
	// programmatisches toggleClass an einem jQuery-Knopf ohnehin nichts feuert.
	w.klassen.metropole = false;
	const knopf = { closest: (wahl) => (wahl === ".location-toggle" ? knopf : null) };
	(w.zuhoerer.click || []).forEach((fn) => fn({ target: knopf, isTrusted: true }));
	assert.strictEqual(w.kontext.ecosystemAnzeigeWahlGesetzt(), true,
		"ein echter Klick auf eine Ortsklasse ist eine Wahl");
	assert.strictEqual(w.kontext.ecosystemAnzeigeSoll().orte.metropole, false,
		"und sie sagt: Metropolen aus");

	w.kontext.syncEcosystemSettlementVisibility(true);
	assert.strictEqual(w.klassen.metropole, false,
		"der naechste Ebenenwechsel laesst die Metropolen aus -- genau das war der Auftrag");
	assert.strictEqual(w.klassen.dorf, true, "und die uebrigen fuenf bleiben an");
}

// (A'') Ein PROGRAMMATISCHER Klick ist keine Wahl -- dieselbe Weiche wie bei den Haken.
{
	const w = welt({ orteVorher: false });
	w.kontext.syncEcosystemSettlementVisibility(true);
	const knopf = { closest: (wahl) => (wahl === ".location-toggle" ? knopf : null) };
	(w.zuhoerer.click || []).forEach((fn) => fn({ target: knopf, isTrusted: false }));
	assert.strictEqual(w.kontext.ecosystemAnzeigeWahlGesetzt(), false,
		"💣 ein synthetischer Klick (setAllLocationTypesVisible, die URL-Persistenz) ist keine Hand");
}

// ---- 7. Der EDITOR schreibt keine Wahl -----------------------------------------------------------
// Die Wahl gehoert dem Besucher; der Editor hat seine eigenen Haken gleich daneben.
{
	const w = welt({ editor: true });
	w.haken.togglePaths.checked = false;
	w.haken.togglePaths.dispatchEvent({ type: "change", isTrusted: true });
	assert.strictEqual(w.kontext.ecosystemAnzeigeWahlGesetzt(), false,
		"🔴 im Editor entsteht keine Besucherwahl");
}
// Und ausserhalb der Landschaften auch nicht -- dort gehoert das Anzeige-Menue der ganzen Karte.
{
	const w = welt({ drin: false });
	w.haken.togglePaths.checked = true;
	w.haken.togglePaths.dispatchEvent({ type: "change", isTrusted: true });
	assert.strictEqual(w.kontext.ecosystemAnzeigeWahlGesetzt(), false,
		"💣 ein Haken, der ausserhalb der Landschaften umgelegt wird, ist keine Landschaftswahl");
}

console.log("anzeigewahl-schlaegt-vorgabe.test.js: alle Zusicherungen gruen");
