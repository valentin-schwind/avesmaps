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

/**
 * Eine Welt, in der das Modul wirklich laeuft -- Attrappen mit genau den Namen, die es ruft.
 *
 * `auskunft` ist die Rechteauskunft der Sitzung (js/config.js, avesmapsEcosystemAccessBekannt).
 * 🔴 `false` heisst „noch unterwegs", NICHT „nein" -- das ist der ganze Inhalt von Abschnitt 8, und
 * deshalb ist es ein eigener Knopf und nicht aus `editor` abgeleitet.
 * Die Rueckgabe traegt `alsEditor()` / `alsBesucher()`: beide lassen die Auskunft MITTEN in der
 * laufenden Welt eintreffen -- genau der Ablauf, den die Live-Seite faehrt.
 */
function welt({ editor = false, ebene = "vegetation", drin = true, orteVorher = false,
	auskunft = true, mitKarte = false } = {}) {
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

	const zustand = { auskunft: auskunft === true };
	// Eine Attrappe der Kartenflaeche -- nur so viel, dass applyEcosystemUndergroundOpacity wirklich
	// laeuft und man SEHEN kann, ob sie etwas angefasst hat.
	const tilePane = { style: {} };
	const behaelter = { style: {} };
	const kacheln = { bringToBack: () => {} };
	const karte = {
		_drauf: true,
		getPane: (name) => (name === "tilePane" ? tilePane : null),
		getContainer: () => behaelter,
		hasLayer: function () { return this._drauf; },
		removeLayer: function () { this._drauf = false; },
		addLayer: function () { this._drauf = true; }
	};

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
		// Die Rechteauskunft der Sitzung -- in js/config.js definiert, hier gestellt. 🔴 Der Name MUSS
		// derselbe sein; Abschnitt 9 haelt ihn gegen die echte Definition.
		avesmapsEcosystemAccessBekannt: () => zustand.auskunft === true,
		getComputedStyle: () => ({ getPropertyValue: () => "#d3cec2" }),
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
		map: mitKarte ? karte : null,
		baseTileLayer: mitKarte ? kacheln : null
	};
	kontext.globalThis = kontext;
	vm.createContext(kontext);
	vm.runInContext(quelle, kontext);
	return {
		kontext, haken, klassen, zuhoerer, zustand, tilePane, karte,
		/** Liest einen `const` des Moduls -- die stehen im lexikalischen Geltungsbereich des Kontexts
		 *  und sind deshalb KEINE Eigenschaft von `kontext` (anders als eine Funktionsdeklaration). */
		lies: (ausdruck) => vm.runInContext(ausdruck, kontext),
		/** Die Auskunft trifft ein: „Editor mit Recht". */
		alsEditor: () => {
			kontext.IS_EDIT_MODE = true;
			kontext.IS_ECOSYSTEM_ENABLED = true;
			zustand.auskunft = true;
		},
		/** Die Auskunft trifft ein: „anonym". */
		alsBesucher: () => { zustand.auskunft = true; }
	};
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
// 🔴 ABER DAS IST NUR DIE HALBE AUSSAGE, und bis zum 10.09.2026 stand hier nur sie. Die Frage lautet
// nicht „kam das Ereignis vom Browser", sondern „war das der Benutzer" -- und die Tastenkuerzel 1-6
// legen eine Ortsklasse ueber `button.click()` um, also mit `isTrusted: false`. Ohne die zweite Haelfte
// darunter haette diese Zusicherung die FALSCHE Haelfte festgenagelt: sie war gruen, waehrend eine
// gedrueckte Ziffer wirkungslos blieb.
{
	const w = welt({ orteVorher: false });
	w.kontext.syncEcosystemSettlementVisibility(true);
	const knopf = { closest: (wahl) => (wahl === ".location-toggle" ? knopf : null) };
	(w.zuhoerer.click || []).forEach((fn) => fn({ target: knopf, isTrusted: false }));
	assert.strictEqual(w.kontext.ecosystemAnzeigeWahlGesetzt(), false,
		"💣 ein synthetischer Klick (setAllLocationTypesVisible, die URL-Persistenz) ist keine Hand");

	// ...und der ausdrueckliche zweite Weg zaehlt sehr wohl: die Tastatur sagt „hier war der Benutzer".
	w.klassen.metropole = false;
	w.kontext.ecosystemAnzeigeNutzerhand();
	assert.strictEqual(w.kontext.ecosystemAnzeigeWahlGesetzt(), true,
		"🔴 die TASTATUR zaehlt -- eine gedrueckte Taste ist die Hand des Benutzers (10.09.2026)");
	assert.strictEqual(w.kontext.ecosystemAnzeigeSoll().orte.metropole, false,
		"und die so gemerkte Wahl liest denselben Stand wie ein Maus-Klick");
	w.kontext.syncEcosystemSettlementVisibility(true);
	assert.strictEqual(w.klassen.metropole, false,
		"💣 der naechste Ebenenwechsel laesst sie aus -- ohne diesen Weg schriebe er die Vorgabe darueber,"
		+ " und die Ziffer sah wirkungslos aus");
}

// (A''') Und der Weg gehoert dem BESUCHER im Landschaftsmodus -- er ist kein Hintertuerchen.
{
	const imEditor = welt({ editor: true });
	imEditor.kontext.ecosystemAnzeigeNutzerhand();
	assert.strictEqual(imEditor.kontext.ecosystemAnzeigeWahlGesetzt(), false,
		"🔴 im Editor entsteht auch ueber den Tastaturweg keine Besucherwahl");
	const daneben = welt({ drin: false });
	daneben.kontext.ecosystemAnzeigeNutzerhand();
	assert.strictEqual(daneben.kontext.ecosystemAnzeigeWahlGesetzt(), false,
		"💣 und ausserhalb der Landschaften auch nicht -- die Ziffern gehoeren dort der ganzen Karte");
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

// ---- 8. DER UNTERGRUND DER NUTZERWAHL KOMMT AUS DEM PROFIL ----------------------------------------
// 💣 Er stand bis zum 10.09.2026 ZWEIMAL da: als `untergrund: 0` im Profil und als abgeschriebenes
// `untergrund: 0` in ecosystemAnzeigeLesen. Ein gekoppelter Wert an zwei Stellen, von keinem Test
// gehalten -- und `untergrund` ist genau das Feld, das Aufgabe 8 aus dem Soll liest. Ab der ersten
// echten Hand waere ein kuenftiger Profilwert still auf 0 gefallen.
// 🔴 Gefuellt wird er jetzt an EINER Stelle (ecosystemAnzeigeSoll), und die Nutzerwahl traegt ihn gar
// nicht mehr -- der Besucher hat den Regler nicht und KANN ihn nicht gewaehlt haben.
{
	const w = welt();
	const ausDemProfil = w.lies("ECOSYSTEM_FRONTEND_PROFIL.untergrund");
	assert.strictEqual(w.kontext.ecosystemAnzeigeSoll().untergrund, ausDemProfil,
		"ohne Hand kommt der Untergrund aus dem Profil");

	w.haken.togglePaths.checked = true;
	w.haken.togglePaths.dispatchEvent({ type: "change", isTrusted: true });
	assert.strictEqual(w.kontext.ecosystemAnzeigeWahlGesetzt(), true, "Vorbedingung: es gibt eine Wahl");
	assert.strictEqual(w.kontext.ecosystemAnzeigeSoll().untergrund, ausDemProfil,
		"💣 UND MIT HAND AUCH -- sonst faellt der konfigurierbare Wert ab der ersten echten Hand weg"
		+ " (gemessen: " + JSON.stringify(w.kontext.ecosystemAnzeigeSoll()) + ")");
}

// ---- 9. DER ROLLENUMSCHLAG: „Besucher" und „Rechte noch unbekannt" sind ZWEI Zustaende ------------
//
// 💣 DER GEMELDETE FALL (10.09.2026). Ein Editor kommt mit `mapLayerMode=ecosystem` aus dem
// localStorage herein (applyPlannerStateFromUrl, map-features-layer-state.js) -- er steht in der Ebene,
// BEVOR seine Sitzungsantwort da ist. `canOperateEcosystemLayers()` sagte deshalb „nein", der
// BESUCHER-Zweig lief fuer ihn, lieh sich seine Ortsklassen und schaltete alle sechs AN; als die
// Auskunft dann eintraf, stieg der Editor-Zweig an seinem eigenen „nur beim Eintreten leihen" aus und
// nahm nichts mehr zurueck. Seine leere Zeichenflaeche war weg, und nichts daran sah kaputt aus.
//
// 🔴 DIESE ZUSICHERUNG PRUEFT DEN UMSCHLAG, NICHT EINEN ZUSTAND. Die Faelle 1-7 starten jeder mit einer
// festen Rolle; der Fehler lebte ausschliesslich im UEBERGANG, und kein Zustand allein konnte ihn
// zeigen.
{
	const w = welt({ editor: false, auskunft: false, orteVorher: true, ebene: "topographie",
		mitKarte: true });

	// (I) Die Auskunft fehlt. Es wird NICHTS angefasst -- weder geliehen noch gesetzt.
	assert.strictEqual(w.kontext.ecosystemAnzeigeSoll(), null,
		"🔴 ohne Rechteauskunft gibt es kein Soll -- „unbekannt“ ist nicht „Besucher“");
	w.kontext.syncEcosystemFrontendFeatures();
	w.kontext.syncEcosystemSettlementVisibility(true);
	w.kontext.syncEcosystemRiverVisibility();
	w.kontext.applyEcosystemUndergroundOpacity(true);
	assert.ok(ORTSKLASSEN.every((typ) => w.klassen[typ] === true),
		"💣 die Ortsklassen bleiben unangetastet: " + JSON.stringify(w.klassen));
	assert.ok(HAKEN_IDS.every((id) => w.haken[id].checked === false),
		"💣 kein Haken ist angefasst -- auch der Fluss-Haken nicht, obwohl die Editor-Tabelle fuer"
		+ " „topographie“ „an“ sagen wuerde (genau das war der ungeriegelte Zustand)");
	assert.strictEqual(w.tilePane.style.opacity, undefined,
		"💣 und der Untergrund auch nicht -- ungeriegelt stand hier die 0,25 des Rueckfalls");
	assert.strictEqual(w.karte._drauf, true, "die Kachelebene liegt weiter auf der Karte");

	// (II) Und jetzt trifft sie ein: „Editor mit Recht".
	w.alsEditor();
	w.kontext.syncEcosystemSettlementVisibility(true);
	assert.ok(ORTSKLASSEN.every((typ) => w.klassen[typ] === false),
		"🔴 JETZT ist die Zeichenflaeche leer -- der Editor behaelt sie, statt sie an einen Moment zu"
		+ " verlieren, in dem noch niemand wusste, wer er ist: " + JSON.stringify(w.klassen));

	// ...und das Ausleih-Gedaechtnis hat den RICHTIGEN Stand aufgehoben: den von vor der Ebene.
	w.kontext.syncEcosystemSettlementVisibility(false);
	assert.ok(ORTSKLASSEN.every((typ) => w.klassen[typ] === true),
		"💣 beim Verlassen steht wieder da, was er vorher hatte -- geliehen wurde erst, als die Auskunft"
		+ " da war: " + JSON.stringify(w.klassen));
}

// Und die Gegenrichtung: der Riegel ist kein Dauerfrost. Trifft „anonym" ein, wird angewendet.
{
	const w = welt({ editor: false, auskunft: false, orteVorher: false, mitKarte: true });
	w.kontext.syncEcosystemSettlementVisibility(true);
	assert.ok(ORTSKLASSEN.every((typ) => w.klassen[typ] === false), "Vorbedingung: noch nichts angefasst");

	w.alsBesucher();
	w.kontext.syncEcosystemFrontendFeatures();
	w.kontext.syncEcosystemSettlementVisibility(true);
	w.kontext.syncEcosystemRiverVisibility();
	w.kontext.applyEcosystemUndergroundOpacity(true);
	assert.ok(ORTSKLASSEN.every((typ) => w.klassen[typ] === true),
		"🔴 mit der Auskunft „anonym“ bekommt der Besucher sein Profil: " + JSON.stringify(w.klassen));
	assert.ok(HAKEN_IDS.every((id) => w.haken[id].checked === true),
		"und alle vier Haken stehen an");
	assert.strictEqual(w.tilePane.style.opacity, "0", "und der Untergrund auf 0 %");
	assert.strictEqual(w.karte._drauf, false,
		"🔴 samt abgehaengter Kachelebene -- bei 0 % wird sie GENOMMEN, nicht bloss ausgeblendet");
}

// ---- 10. VERDRAHTUNG: der Merker steht dort, wo die Auskunft EINTRIFFT ----------------------------
//
// 🔴 Der Riegel oben haengt an EINEM Namen, den eine FREMDE Datei definiert. Faellt er offen aus (ohne
// js/config.js gilt „bekannt“), und genau deshalb waere ein Tippfehler im Namen still: der Riegel
// verschwaende, alle Faelle 1-7 blieben gruen, und der gemeldete Fehler waere zurueck. Dieselbe Lage
// wie beim Schluessel `avesmaps.kartendaten.etag`, der ebenfalls in zwei Dateien zeichengleich stehen
// muss (AGENTS.md §10).
const quelleOhneZeilenkommentare = (text) => text.replace(/\r\n/g, "\n")
	.split("\n").map((zeile) => zeile.replace(/^\s*\/\/.*$/, "")).join("\n");

const configQuelle = quelleOhneZeilenkommentare(fs.readFileSync(path.join(ROOT, "js/config.js"), "utf8"));
const MERKER_LESER = "avesmapsEcosystemAccessBekannt";
assert.ok(quelle.includes(MERKER_LESER),
	"das Modul fragt " + MERKER_LESER + " -- ohne diese Frage gibt es den Riegel nicht");
assert.ok(new RegExp("function\\s+" + MERKER_LESER + "\\s*\\(").test(configQuelle),
	"🔴 und js/config.js definiert genau diesen Namen; ein Tippfehler hier laesst den Riegel offen"
	+ " ausfallen, ohne dass eine Zusicherung rot wird");

// 💣 UND DER MERKER MUSS VOR JEDEM AUSSTIEG VON applyEcosystemAccess GESETZT WERDEN -- auch bei
// `granted === false`. „Du darfst nicht“ IST die Auskunft, und sie ist die haeufigste: jeder anonyme
// Besucher bekommt sie. Stuende die Zuweisung hinter dem alten `if (granted !== true) return;`, floege
// der Merker fuer ihn NIE hoch, und das Profil, das nur ihm gilt, kaeme nie zur Anwendung.
// 🔴 AUSGEFUEHRT, nicht gelesen: ein Regex sieht die Reihenfolge zweier Anweisungen nicht.
{
	const anfang = configQuelle.indexOf("let AVESMAPS_ECOSYSTEM_ACCESS_BEKANNT");
	assert.ok(anfang > 0, "der Merker steht in js/config.js");
	const funktionsAnfang = configQuelle.indexOf("function applyEcosystemAccess(granted) {", anfang);
	assert.ok(funktionsAnfang > anfang, "und applyEcosystemAccess dahinter");
	// Die Klammern ab der OEFFNENDEN des Funktionsrumpfs zaehlen -- ein festes Zeichenfenster haette die
	// Kommentarlaenge gemessen, nicht den Rumpf.
	let tiefe = 0;
	let ende = configQuelle.indexOf("{", funktionsAnfang);
	for (let i = ende; i < configQuelle.length; i += 1) {
		if (configQuelle[i] === "{") { tiefe += 1; }
		if (configQuelle[i] === "}") { tiefe -= 1; if (tiefe === 0) { ende = i + 1; break; } }
	}
	const rumpf = configQuelle.slice(anfang, ende);
	assert.ok(rumpf.includes("applyEcosystemAccess") && rumpf.length > 200,
		"der ausgeschnittene Block traegt wirklich die Funktion (" + rumpf.length + " Zeichen)");

	const welt2 = {
		console,
		IS_EDIT_MODE: false,
		// ⚠️ Der Riegel selbst steht ueber dem ausgeschnittenen Block (`let IS_ECOSYSTEM_ENABLED` ist die
		// Zeile davor) und wird deshalb hier gestellt -- mit dem echten Startwert.
		IS_ECOSYSTEM_ENABLED: false,
		document: { getElementById: () => null },
		_nachgezogen: 0,
		syncEcosystemControlsVisibility: function () { welt2._nachgezogen += 1; }
	};
	welt2.globalThis = welt2;
	vm.createContext(welt2);
	vm.runInContext(rumpf + "\nglobalThis.merker = () => AVESMAPS_ECOSYSTEM_ACCESS_BEKANNT;", welt2);

	assert.strictEqual(welt2.merker(), false, "Vorbedingung: die Auskunft ist noch unterwegs");
	welt2.applyEcosystemAccess(false);
	assert.strictEqual(welt2.merker(), true,
		"💣 „nein“ IST die Auskunft -- der Merker fliegt auch ohne Freischaltung hoch");
	assert.strictEqual(welt2.IS_ECOSYSTEM_ENABLED, false, "freigeschaltet wird dabei nichts");
	assert.strictEqual(welt2._nachgezogen, 1,
		"🔴 und die Oberflaeche wird nachgezogen -- erst dieser Durchlauf wendet das Besucherprofil an");

	welt2.applyEcosystemAccess(false);
	assert.strictEqual(welt2._nachgezogen, 1,
		"ein zweiter Aufruf mit derselben Antwort hat nichts zu tun -- einbahnig wie bisher");
	welt2.applyEcosystemAccess(true);
	assert.strictEqual(welt2.IS_ECOSYSTEM_ENABLED, true, "und eine spaetere Freischaltung greift noch");
	assert.strictEqual(welt2._nachgezogen, 2, "samt Nachziehen der Oberflaeche");
}

// ---- 11. VERDRAHTUNG: die Tastatur ruft den benannten Weg WIRKLICH -------------------------------
// 🔴 AUSGEFUEHRT, nicht gegreppt: ein `includes("ecosystemAnzeigeNutzerhand")` traefe auch einen
// Kommentar oder eine Zeile ausserhalb von toggleLocationTier.
{
	const tastenQuelle = quelleOhneZeilenkommentare(
		fs.readFileSync(path.join(ROOT, "js/app/keyboard-shortcuts.js"), "utf8"));
	const anfang = tastenQuelle.indexOf("function toggleLocationTier(tier) {");
	assert.ok(anfang > 0, "toggleLocationTier steht in js/app/keyboard-shortcuts.js");
	let tiefe = 0;
	let ende = tastenQuelle.indexOf("{", anfang);
	for (let i = ende; i < tastenQuelle.length; i += 1) {
		if (tastenQuelle[i] === "{") { tiefe += 1; }
		if (tastenQuelle[i] === "}") { tiefe -= 1; if (tiefe === 0) { ende = i + 1; break; } }
	}
	const rumpf = tastenQuelle.slice(anfang, ende);
	assert.ok(rumpf.includes("button.click()") && rumpf.length > 80,
		"der ausgeschnittene Rumpf ist wirklich die Funktion (" + rumpf.length + " Zeichen)");

	const gerufen = [];
	const geklickt = [];
	const knoepfe = [{ click: () => geklickt.push(0) }, { click: () => geklickt.push(1) }];
	const bauen = new Function("document", "LOCATION_TIER_COUNT", "ecosystemAnzeigeNutzerhand",
		rumpf + "; return toggleLocationTier;");
	const fahren = bauen({ querySelectorAll: () => knoepfe }, 6, () => gerufen.push(true));
	fahren(2);
	assert.deepStrictEqual(geklickt, [1], "die Taste klickt den zweiten Ortsklassen-Knopf");
	assert.deepStrictEqual(gerufen, [true],
		"🔴 und sagt danach ausdruecklich „hier war der Benutzer“ -- sonst verwirft die isTrusted-Weiche"
		+ " den synthetischen Klick, und die Ziffer ist keine Wahl");

	// Ohne das Modul (eine Seite ohne Landschaften) faellt der Aufruf offen aus.
	const ohne = bauen({ querySelectorAll: () => knoepfe }, 6, undefined);
	ohne(1);
	assert.deepStrictEqual(geklickt, [1, 0], "und ohne das Modul klickt die Taste trotzdem");
}

console.log("anzeigewahl-schlaegt-vorgabe.test.js: alle Zusicherungen gruen");
