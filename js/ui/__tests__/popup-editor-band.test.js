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

/** Das Blatt ohne Kommentare -- in dieser Datei erklaert die Prosa genau das, wonach gesucht wird,
 *  ein Treffer im Kommentar waere also kein Beweis. */
const css = read("css", "features", "location-popups-markers.css")
	.replace(/\/\*[\s\S]*?\*\//g, "");

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
// darunter. Eine neue Editor-Aktion ohne Zeichen stellt ihn Stueck fuer Stueck wieder her.
//
// 🔴 Und es ist ein ZEICHEN, kein Bild (Owner 13.08.2026: „nimm die monochromen icons"). Der
// Zweiklang des Hauses: farbiges Bild fuer das, was jeden angeht -- mageres Zeichen fuers Werkzeug.
// Faengt den Rueckfall auf `.location-popup__action-img`, der fuer sich voellig richtig aussieht.
const bandMarkup = editorMarkup.slice(bandAt);
const kacheln = bandMarkup.match(/<button[\s\S]*?<\/button>/g) || [];
assert.ok(kacheln.length >= 4, `das Band traegt Kacheln (gefunden: ${kacheln.length})`);
kacheln.forEach((kachel) => {
	assert.ok(kachel.includes("location-popup__action-glyph"),
		`jede Kachel im Band traegt ein Zeichen: ${kachel.slice(0, 120)}`);
	assert.ok(!kachel.includes("location-popup__action-img"),
		`und KEIN farbiges Bild: ${kachel.slice(0, 120)}`);
});

// 💣 Das Zeichen erbt die Schriftfarbe des Knopfes. `.location-popup__action-icon` nebenan tut das
// NICHT -- es traegt `var(--color-button-text)`, die helle Schrift des GEFUELLTEN Knopfes, und auf
// einem weichen Knopf ergibt das Weiss auf Beige. Genau so stand die monochrome Variante im
// Entwurf, und genau das hat der Owner gesehen: „den monochromen seh ich nix, weil die weiss sind".
const glyphRegel = css.match(/\.location-popup__action-glyph\s*\{[^}]*\}/);
assert.ok(glyphRegel, "es gibt die Regel fuer das Editor-Zeichen");
assert.ok(/color:\s*currentColor/.test(glyphRegel[0]),
	"das Zeichen erbt die Schriftfarbe des Knopfes (currentColor), nicht --color-button-text");
assert.ok(!/--color-button-text/.test(glyphRegel[0]),
	"und greift ausdruecklich NICHT zum Token des gefuellten Knopfes");

// ---- 💣 DIE KOPPLUNG: die Vier-Spalten-Regel muss das Band MITNENNEN ---------------------------
//
// Die Regel verlangt ein DIREKTES Kind von .location-popup. Die Editor-Kacheln haengen eine Ebene
// tiefer. Wer die Selektorliste anfasst und das Band vergisst, bekommt starre 90px zurueck:
// 4x90 + 24px Luecke = 384 > 380 verfuegbar -- es passen nur noch DREI, waehrend die Reihe darueber
// vier zeigt. Sichtbar sofort, aber leicht als „ist halt so" abgetan. Genau so gemessen, bevor die
// zweite Selektorzeile da war.
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

// ---- Weg und Kraftlinie benutzen DASSELBE Band ------------------------------------------------
//
// 💣 Faengt die Divergenz, bevor sie entsteht: diese beiden bauen ihre Aktionsleiste selbst
// zusammen (eigene IIFE im Popup-Aufruf) und koennten sich jederzeit ein eigenes Band schnitzen
// oder ihre Editier-Kacheln wieder in die obere Reihe schieben. Beide Fehler sehen fuer sich
// richtig aus -- auffallen wuerde erst, dass drei Infoboxen drei verschiedene Sprachen sprechen.
[
	["js/map-features/map-features-path-rendering.js", "der Weg"],
	["js/map-features/map-features-powerlines.js", "die Kraftlinie"],
].forEach(([rel, wer]) => {
	const quelle = fs.readFileSync(path.join(ROOT, rel), "utf8");
	assert.ok(quelle.includes("locationPopupEditorBandMarkup("),
		`${wer} benutzt das gemeinsame Band, statt sich eins zu bauen (${rel})`);
	// Der IS_EDIT_MODE-Block darf nur noch in die Editor-Liste schieben.
	const block = quelle.match(/if \(IS_EDIT_MODE\) \{[\s\S]*?\n\t{3}\}/);
	assert.ok(block, `${wer} hat den erwarteten IS_EDIT_MODE-Block (${rel})`);
	assert.ok(!/\bbuttons\.push\(/.test(block[0]),
		`${wer} schiebt im Bearbeiten-Zweig NICHTS mehr in die obere Reihe (${rel})`);
	assert.ok(/\beditorButtons\.push\(/.test(block[0]),
		`${wer} sammelt sie stattdessen in editorButtons (${rel})`);
});

// ---- Das Kreuzungs-Popup bekommt KEIN Merkmal -------------------------------------------------
//
// 🔴 Absicht, kein Versaeumnis: die Leiste existiert ausserhalb des Bearbeiten-Modus gar nicht
// (crossingActionsMarkup gibt "" zurueck). Ein Schild ueber einer Liste, die ein Besucher nie
// sieht, ist eine Auskunft an niemanden -- das Merkmal traegt nur, wo es auch fehlen kann.
// Faengt: jemand „vervollstaendigt" die Kennzeichnung und haengt es ueberall hin.
const kreuzung = editor.crossingActionsMarkup("Kreuzung-1482", "cr-1");
assert.ok(kreuzung.includes("location-popup__action-button"), "die Kreuzung hat ihre Kacheln");
assert.ok(!kreuzung.includes("avesmaps-scope-hint"),
	"aber KEIN Merkmal -- ein Besucher sieht diese Leiste ohnehin nie");
assert.strictEqual(besucher.crossingActionsMarkup("Kreuzung-1482", "cr-1"), "",
	"und ausserhalb des Bearbeiten-Modus entsteht sie gar nicht erst");
(kreuzung.match(/<button[\s\S]*?<\/button>/g) || []).forEach((kachel) => {
	assert.ok(kachel.includes("location-popup__action-glyph"),
		`jede Kreuzungs-Kachel traegt ein Zeichen: ${kachel.slice(0, 120)}`);
});

console.log("popup-editor-band ok");
