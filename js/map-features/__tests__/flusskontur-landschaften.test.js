"use strict";

// Die weisse Kontur der Fluesse im Landschaftsmodus (Owner 27.08.2026).
//
// 🔴 DIE ANWEISUNG WAR ZWEITEILIG, und der zweite Teil ist die eigentliche Regel: „die fluesse in der
// topographischen ansicht fuer das front end (nicht im editmode) keine weisse kontur (konturen soll
// dann angezeigt werden wenn auch die pfeilchen angezeigt werden)". Die Fliessrichtungs-Pfeile gibt
// es NUR im Editor (map-features-river-flow-arrows.js steigt in start() bei !IS_EDIT_MODE aus) --
// die Kontur ist damit als WERKZEUG erklaert, nicht als Kartenbild, und folgt derselben Frage.
//
// ⭐ Ausgefuehrt, nicht im Quelltext gelesen: getPathStyleColors wird mit seinen Nachbarn in eine
// vm gestellt und wirklich gerufen. Ein `includes("outlineOpacity = 0")` waere gruen geblieben,
// egal wo im Rumpf die Zeile steht -- und WO sie steht, ist hier die halbe Regel (siehe Abschnitt C).

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const quelle = fs.readFileSync(
	path.join(__dirname, "..", "map-features.js"),
	"utf8"
);

function schneide(name) {
	const anfang = quelle.indexOf(`function ${name}(`);
	assert.ok(anfang >= 0, `${name} steht als eigene Funktion da`);
	// ⚠️ Zeilenendenneutral: die Arbeitskopie traegt CRLF, das Deploy-Tor LF (AGENTS.md §9).
	const ende = quelle.indexOf("\n}", anfang);
	assert.ok(ende > anfang, `${name} hat ein Ende`);
	return quelle.slice(anfang, ende + 2);
}

function welt({ landschaftsmodus, editmodus, pruefhaken = false }) {
	const context = {
		console,
		IS_EDIT_MODE: editmodus,
		isEcosystemLayerModeActive: () => landschaftsmodus,
		normalizePathSubtype: (wert) => String(wert || ""),
		map: { getZoom: () => 5 },
		PATH_RENDER_CONFIG: { simplifiedMaxZoom: 3, simplifiedOutlineOpacity: 0.5, simplifiedCenterWeightScale: 1 },
		PATH_CENTER_WEIGHTS: { Weg: 3, Flussweg: 3, Reichsstrasse: 4 },
		getPathOutlineWidthOverride: () => null,
		getDefaultPathOutlineWidth: () => 6,
		getPathWidthScale: () => 1,
		avesmapsIsOpenPathEndCheckActive: () => pruefhaken,
		avesmapsPathHasOpenEnd: () => pruefhaken,
		avesmapsOpenPathEndStyle: (breite) => ({ farbe: "#c0392b", breite: breite + 1 }),
	};
	context.globalThis = context;
	vm.createContext(context);
	vm.runInContext(schneide("avesmapsFlussKonturSichtbar"), context);
	vm.runInContext(schneide("getPathStyleColors"), context);
	return context;
}

const fluss = { properties: { feature_subtype: "Flussweg" } };
const strasse = { properties: { feature_subtype: "Strasse" } };
const reichsstrasse = { properties: { feature_subtype: "Reichsstrasse" } };

// ---- A. Der Befund: im Landschaftsmodus ohne Editor traegt der Fluss keine Kontur --------------
const besucherInLandschaften = welt({ landschaftsmodus: true, editmodus: false });
assert.strictEqual(besucherInLandschaften.getPathStyleColors(fluss).outlineOpacity, 0,
	"🔴 der Besucher sieht im Landschaftsmodus keine weisse Flusskontur");

// ⚠️ Die FARBE bleibt stehen und die BREITE auch -- nur die Deckkraft faellt. Die Konturlinie ist der
// Klickfaenger des Weges (`interactive` in createPathLayer); sie auf Breite 0 zu ziehen naehme dem
// Fluss seine Anfassflaeche, und ein Fluss, den man nicht mehr anklicken kann, waere ein teurerer
// Fehler als eine weisse Linie.
assert.strictEqual(besucherInLandschaften.getPathStyleColors(fluss).outline, "#ffffff",
	"die Konturfarbe bleibt -- nur ihre Deckkraft faellt");
assert.ok(besucherInLandschaften.getPathStyleColors(fluss).outlineWeight > 0,
	"💣 und ihre Breite auch: die Konturlinie ist der Klickfaenger des Weges");

// ---- B. Die drei Gegenproben --------------------------------------------------------------------
const editorInLandschaften = welt({ landschaftsmodus: true, editmodus: true });
assert.strictEqual(editorInLandschaften.getPathStyleColors(fluss).outlineOpacity, 1,
	"🔴 der EDITOR behaelt sie -- genau dann, wenn auch die Pfeilchen laufen");

const besucherAufDerKarte = welt({ landschaftsmodus: false, editmodus: false });
assert.strictEqual(besucherAufDerKarte.getPathStyleColors(fluss).outlineOpacity, 1,
	"💣 auf der gewoehnlichen Karte bleibt die Kontur -- dort ist sie das gewohnte Kartenbild");

assert.strictEqual(besucherInLandschaften.getPathStyleColors(strasse).outlineOpacity, 1,
	"⚠️ und sie gilt nur den FLUESSEN: eine Strasse behaelt ihre Kontur auch dort");
assert.strictEqual(besucherInLandschaften.getPathStyleColors(reichsstrasse).outline, "#9a9a9a",
	"die Reichsstrasse behaelt ihren grauen Rand");

// ---- C. Die Reihenfolge, und sie ist tragend ----------------------------------------------------
// 💣 Der Pruefhaken „Offene Wegenden" setzt die Kontur ausdruecklich auf 1 zurueck, weil sein Rot
// ohne sie auf dem Kartenbraun verschwindet (Kommentar an avesmapsOpenPathEndStyle). Stuende die
// neue Regel HINTER ihm, loeschte sie diesen Befund fuer jeden Fluss -- ein Pruefhaken, der bei
// Fluessen nichts anzeigt, sieht aus wie „keine offenen Enden" und nicht wie ein Fehler.
const mitPruefhaken = welt({ landschaftsmodus: true, editmodus: false, pruefhaken: true });
assert.strictEqual(mitPruefhaken.getPathStyleColors(fluss).outlineOpacity, 1,
	"🔴 der Pruefhaken sticht die neue Regel -- sein Befund braucht die weisse Kontur");

// ---- D. Der Riegel faellt offen aus ---------------------------------------------------------------
// ⚠️ Ohne den Landschaftsmodus-Nachbarn (fremde Seite, halber Deploy) gilt „nicht im Landschaftsmodus",
// also die Kontur wie bisher. Die sichere Richtung: lieber eine weisse Linie zu viel als ein Fluss,
// der sich vom Untergrund nicht mehr abhebt.
const ohneNachbarn = (() => {
	const context = {
		console,
		IS_EDIT_MODE: false,
		normalizePathSubtype: (wert) => String(wert || ""),
		map: { getZoom: () => 5 },
		PATH_RENDER_CONFIG: { simplifiedMaxZoom: 3, simplifiedOutlineOpacity: 0.5, simplifiedCenterWeightScale: 1 },
		PATH_CENTER_WEIGHTS: { Weg: 3, Flussweg: 3 },
		getPathOutlineWidthOverride: () => null,
		getDefaultPathOutlineWidth: () => 6,
		getPathWidthScale: () => 1,
		avesmapsIsOpenPathEndCheckActive: () => false,
	};
	context.globalThis = context;
	vm.createContext(context);
	vm.runInContext(schneide("avesmapsFlussKonturSichtbar"), context);
	vm.runInContext(schneide("getPathStyleColors"), context);
	return context;
})();
assert.strictEqual(ohneNachbarn.getPathStyleColors(fluss).outlineOpacity, 1,
	"ohne den Landschaftsmodus-Nachbarn bleibt alles wie bisher, statt zu werfen");

// ---- E. Die Kopplung an die Pfeilchen ist eine ECHTE, keine behauptete ---------------------------
// 🔴 „Konturen sollen dann angezeigt werden, wenn auch die Pfeilchen angezeigt werden." Die Pfeile
// steigen in start() bei !IS_EDIT_MODE aus -- wer diesen Riegel dort je lockert (etwa: Pfeile auch
// fuer Besucher), muss die Kontur mitnehmen, sonst zerfaellt die Zusage stillschweigend.
const pfeilQuelle = fs.readFileSync(
	path.join(__dirname, "..", "map-features-river-flow-arrows.js"),
	"utf8"
).replace(/\r\n/g, "\n");
assert.ok(/function start\(\)[\s\S]{0,400}if \(!IS_EDIT_MODE\) \{\s*\n\s*return;/.test(pfeilQuelle),
	"💣 die Pfeilchen haengen weiterhin an IS_EDIT_MODE -- sonst stimmt die Begruendung der Kontur nicht mehr");

// ---- F. Der Nachzieher -- und er ist der eigentliche Befund --------------------------------------
// 💣 DIE REGEL ALLEIN TUT NICHTS. Live gemessen (27.08.2026, Landschaften/Topographie als Besucher):
// getPathStyleColors rechnete für den Fluss bereits `outlineOpacity: 0`, und alle 223 gezeichneten
// Flüsse trugen unverändert `stroke-opacity: 1`. Ein Stil, der von einem Zustand abhängt, braucht
// einen Anstoss, wenn dieser Zustand wandert -- der Moduswechsel zeichnet die Wege nicht neu.
// Wäre nur die Regel gebaut worden, hätte jeder Test gegrünt und auf der Karte nichts geändert.
const schalterQuelle = fs.readFileSync(
	path.join(__dirname, "..", "map-features-ecosystem-layer-switch.js"),
	"utf8"
);

function nachzieherWelt({ konturSichtbar }) {
	const nachgezogen = [];
	const fluesse = [
		{ properties: { feature_subtype: "Flussweg", name: "Rakula" }, _pathLines: [{}, {}] },
		{ properties: { feature_subtype: "Flussweg", name: "Darpat" }, _pathLines: [{}, {}] },
		{ properties: { feature_subtype: "Flussweg", name: "Nie gebaut" } },
		{ properties: { feature_subtype: "Strasse", name: "Reichsstrasse 2" }, _pathLines: [{}, {}] },
	];
	const context = {
		console,
		pathData: fluesse,
		normalizePathSubtype: (wert) => String(wert || ""),
		avesmapsFlussKonturSichtbar: () => konturSichtbar.wert,
		updatePathLayerStyle: (pfad) => nachgezogen.push(pfad.properties.name),
	};
	context.globalThis = context;
	vm.createContext(context);
	const anfangZ = schalterQuelle.indexOf("let ecosystemFlussKonturZuletzt");
	assert.ok(anfangZ >= 0, "der Nachzieher hat sein Gedaechtnis");
	const anfangF = schalterQuelle.indexOf("function syncEcosystemFlussKontur(");
	const endeF = schalterQuelle.indexOf("\n}", anfangF);
	vm.runInContext(schalterQuelle.slice(anfangZ, schalterQuelle.indexOf("\n", anfangZ)), context);
	vm.runInContext(schalterQuelle.slice(anfangF, endeF + 2), context);
	return { context, nachgezogen };
}

const versteckt = { wert: false };
const lauf = nachzieherWelt({ konturSichtbar: versteckt });
lauf.context.syncEcosystemFlussKontur();
assert.deepStrictEqual(lauf.nachgezogen, ["Rakula", "Darpat"],
	"🔴 der Wechsel zieht die gebauten FLUSS-Linien nach -- und nur sie");

// ⚠️ Und kein zweites Mal. Diese Wege laufen bei jedem Ebenenwechsel; ohne das Gedaechtnis zoege
// jeder Kachelklick ueber tausend Fluesse neu.
lauf.context.syncEcosystemFlussKontur();
assert.deepStrictEqual(lauf.nachgezogen, ["Rakula", "Darpat"],
	"💣 ohne Aenderung wird nichts noch einmal gezeichnet");

// Und beim Verlassen wieder zurueck.
versteckt.wert = true;
lauf.context.syncEcosystemFlussKontur();
assert.deepStrictEqual(lauf.nachgezogen, ["Rakula", "Darpat", "Rakula", "Darpat"],
	"beim Verlassen holt derselbe Weg die Kontur zurueck");

// 🔴 UND ER HAENGT AM TRICHTER, nicht an syncEcosystemRiverVisibility. Jene Funktion steigt bei
// `haken.checked === soll` vorzeitig aus -- und genau das ist der haeufigste Fall (wer die Fluesse
// ohnehin anhat, betritt die Topographie ohne jede Aenderung am Haken). Ein Nachzieher in ihrem
// Rumpf liefe dann nie.
const ohneKommentare = schalterQuelle
	.replace(/\r\n/g, "\n")
	.replace(/\/\*[\s\S]*?\*\//g, "")
	.replace(/^[\t ]*\/\/.*$/gm, "");
const paneAnfang = ohneKommentare.indexOf("function syncEcosystemPaneStates(");
const paneEnde = ohneKommentare.indexOf("\n}", paneAnfang);
assert.ok(ohneKommentare.slice(paneAnfang, paneEnde).includes("syncEcosystemFlussKontur();"),
	"💣 der Nachzieher haengt in syncEcosystemPaneStates -- dem einen Trichter fuer Eintreten, Wechsel und Verlassen");
const riverAnfang = ohneKommentare.indexOf("function syncEcosystemRiverVisibility(");
const riverEnde = ohneKommentare.indexOf("\n}", riverAnfang);
assert.ok(!ohneKommentare.slice(riverAnfang, riverEnde).includes("syncEcosystemFlussKontur"),
	"🪤 und NICHT in syncEcosystemRiverVisibility, die drei fruehe Ausstiege hat");

console.log("flusskontur-landschaften: alle Zusicherungen gruen");
