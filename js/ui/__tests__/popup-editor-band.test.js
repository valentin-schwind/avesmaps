// Das Editor-Band im Kachelband der Infobox: die Kacheln, die nur ein Editor sieht, stehen unter
// einer Trennlinie und unter der Ueberschrift „Bearbeiten — nur Editoren".
// Entwurf/Mockup: docs/editor-kennzeichnung-mockup.html
//
// popups.js ist ein globales Skript ohne module.exports -- es wird hier in einer vm-Umgebung mit
// Attrappen ausgefuehrt, damit der Test das ECHTE Markup sieht und nicht den Quelltext danach
// absucht. Ein Textvergleich haette die Kopplung in Punkt 3 nicht finden koennen.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/ui/__tests__/popup-editor-band.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");

function ladePopups({ editMode }) {
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
		// Deutsch ist der Vorgabewert -- tr() gibt ihn unveraendert zurueck (js/app/i18n.js).
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
	vm.runInContext(read("js", "ui", "popups.js"), sandbox, { filename: "popups.js" });
	return sandbox;
}

// ---- Ohne Bearbeiten-Modus entsteht KEIN Band ------------------------------------------------
//
// 💣 Faengt die haesslichste Form des Fehlers: eine goldene Ueberschrift „nur Editoren" ueber einer
// Trennlinie ueber nichts -- und zwar auf der oeffentlichen Karte, wo sie einem Besucher erzaehlt,
// dass ihm etwas vorenthalten wird, das es gar nicht gibt.
const besucher = ladePopups({ editMode: false });
const besucherMarkup = besucher.locationActionsMarkup("Fährstation", "loc-1", { coordinates: [1, 2] });
assert.ok(!besucherMarkup.includes("location-popup__editor-band"),
	"ohne Bearbeiten-Modus gibt es kein Band");
assert.ok(!besucherMarkup.includes("nur Editoren"),
	"und auch das Merkmal nicht");
assert.ok(besucherMarkup.includes("location-popup__actions"),
	"die gewoehnlichen Kacheln stehen trotzdem da");

// ---- Im Bearbeiten-Modus trennt das Band ------------------------------------------------------
const editor = ladePopups({ editMode: true });
const editorMarkup = editor.locationActionsMarkup("Fährstation", "loc-1", { coordinates: [1, 2] });

const bandAt = editorMarkup.indexOf('class="location-popup__editor-band"');
assert.ok(bandAt > -1, "im Bearbeiten-Modus gibt es das Band");

// 💣 Faengt: jemand schiebt eine Editor-Kachel zurueck in die obere Reihe -- dann steht sie wieder
// ununterscheidbar neben „Link teilen". Geprueft wird an der Stelle im Markup, nicht am Vorkommen.
["Ort verschieben", "Bearbeiten", "Ort löschen", "Neuer Weg"].forEach((label) => {
	const at = editorMarkup.indexOf(">" + label + "<");
	assert.ok(at > -1, `die Kachel „${label}" gibt es`);
	assert.ok(at > bandAt, `und sie steht IM Band, nicht in der oberen Reihe: „${label}"`);
});
const reiseziel = editorMarkup.indexOf("Reiseziel hinzufügen");
assert.ok(reiseziel > -1 && reiseziel < bandAt,
	"und die Besucher-Kacheln stehen davor, nicht darin");

// ---- Die Ueberschrift traegt das gemeinsame Merkmal in EIGENEM <span> --------------------------
//
// 💣 `data-i18n` setzt `textContent` und loescht am Elternelement die Kinder mit (js/app/i18n.js).
// Hier baut zwar JS, aber die Form muss dieselbe sein wie in index.html -- sonst faellt der
// naechste, der sie uebersetzbar macht, genau dort hinein.
const titel = editorMarkup.match(/<p class="location-popup__editor-band-title">[\s\S]*?<\/p>/);
assert.ok(titel, "das Band hat eine Ueberschrift");
assert.ok(/<span>Bearbeiten<\/span>/.test(titel[0]), "ihr eigener Text steckt in einem <span>");
assert.ok(/<span class="avesmaps-scope-hint">nur Editoren<\/span>/.test(titel[0]),
	"und das Merkmal in einem zweiten -- mit der hausweiten Klasse, nicht einer eigenen");

// ---- Jede Editor-Kachel traegt ein Symbol -----------------------------------------------------
//
// 💣 Genau das war der Ausgangszustand: vier illustrierte Kacheln oben, vier nackte Textkacheln
// darunter. Eine neue Editor-Aktion ohne Symbol stellt ihn Stueck fuer Stueck wieder her.
const bandMarkup = editorMarkup.slice(bandAt);
const kacheln = bandMarkup.match(/<button[\s\S]*?<\/button>/g) || [];
assert.ok(kacheln.length >= 4, `das Band traegt Kacheln (gefunden: ${kacheln.length})`);
kacheln.forEach((kachel) => {
	assert.ok(kachel.includes("location-popup__action-img"),
		`jede Kachel im Band traegt ein Symbol: ${kachel.slice(0, 120)}`);
});

// ---- 💣 DIE KOPPLUNG: die Vier-Spalten-Regel muss das Band MITNENNEN ---------------------------
//
// Die Regel verlangt ein DIREKTES Kind von .location-popup. Die Editor-Kacheln haengen eine Ebene
// tiefer. Wer die Selektorliste anfasst und das Band vergisst, bekommt starre 90px zurueck:
// 4x90 + 24px Luecke = 384 > 380 verfuegbar -- es passen nur noch DREI, waehrend die Reihe darueber
// vier zeigt. Sichtbar sofort, aber leicht als „ist halt so" abgetan. Genau so gemessen, bevor die
// zweite Selektorzeile da war.
const css = read("css", "features", "location-popups-markers.css")
	.replace(/\/\*[\s\S]*?\*\//g, "");
const regeln = css.match(/[^{}]+\{[^}]*\}/g) || [];
const direktKind = regeln.filter((r) => r.includes(".location-popup > .location-popup__actions > .location-popup__action-button"));
assert.ok(direktKind.length >= 2,
	`es gibt die Direkt-Kind-Regeln der Kachelbreite (gefunden: ${direktKind.length})`);
direktKind.forEach((regel) => {
	const kopf = regel.slice(0, regel.indexOf("{")).trim();
	assert.ok(regel.includes(".location-popup__editor-band > .location-popup__actions > .location-popup__action-button"),
		`diese Breitenregel nennt das Editor-Band mit, sonst bricht es auf drei Kacheln um:\n  ${kopf}`);
});

// Und das Band selbst hat seine Trennlinie.
assert.ok(/\.location-popup__editor-band\s*\{[^}]*border-top:\s*1px solid var\(--color-divider\)/.test(css),
	"das Band traegt den Trenner aus dem Token, nicht aus einem Literal");

console.log("popup-editor-band ok");
