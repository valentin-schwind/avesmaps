// Owner-Meldung 29.08.2026 (Garetien Importer): Objekttypen, aus denen der Server ohnehin nichts
// liefert, werden im Filter-Trichter blasser dargestellt -- "Blasser, nicht versteckt", die Option
// bleibt waehlbar. Die Entscheidung, WELCHE Option das ist, liegt in
// js/review/review-garetien-importer.js (garetienFacettenOptionen, siehe garetien-filtertrichter.test.js);
// DIESE Datei prueft die andere Haelfte -- dass der GETEILTE Trichter (js/ui/filter-menu.js,
// avmFilterMenuAttach) eine Option mit `option.muted`/`option.title` auch WIRKLICH als solche
// zeichnet. Der Trichter bedient nicht nur den Garetien Importer (review-wiki-sync.js, wege-editor.js,
// …) -- eine Aenderung hier wirkt auf alle.
//
// 🔴 GEPRUEFT WIRD DIE ECHTE DATEI. `js/ui/filter-menu.js` exportiert fuer `require()` nur die
// REINEN Teile (siehe ihr eigener Kommentar am Dateiende); die rendernden Funktionen leben nur als
// Globale eines Skripts. Deshalb -- wie js/pages/__tests__/wege-gruppe-ablauf.test.js -- ueber
// `vm.runInContext` mit einer schlanken DOM-Attrappe, statt die Rendering-Regel hier abzuschreiben.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis: node js/ui/__tests__/filter-menu-muted-option.test.js

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

let checks = 0;
function wahr(bedingung, warum) {
	assert.ok(bedingung, warum || "");
	checks++;
}
function gleich(ist, soll, warum) {
	assert.strictEqual(ist, soll, warum || "");
	checks++;
}

/** Ein DOM-Element, so weit avmRenderCheckboxSection/avmRenderRadioSection eines brauchen. */
function attrappe(id) {
	return { id, innerHTML: "" };
}

function sandkasten() {
	const elemente = {};
	const dokument = {
		getElementById(id) {
			if (!elemente[id]) { elemente[id] = attrappe(id); }

			return elemente[id];
		},
	};
	const kasten = { console, document: dokument };
	kasten.window = kasten;
	vm.createContext(kasten);
	const quelle = fs.readFileSync(path.resolve(__dirname, "..", "filter-menu.js"), "utf8");
	vm.runInContext(quelle, kasten, { filename: "filter-menu.js" });

	return { kasten, elemente };
}

/** Das einzelne `<label ...>…</label>`, dessen Wert `value="<wert>"` traegt -- oder null. */
function labelFuerWert(markup, wert) {
	const labels = markup.split("</label>");
	const treffer = labels.find((stueck) => stueck.includes('value="' + wert + '"'));

	return treffer ? treffer + "</label>" : null;
}

const { kasten, elemente } = sandkasten();
wahr(typeof kasten.avmRenderCheckboxSection === "function", "avmRenderCheckboxSection fehlt im Skript");
wahr(typeof kasten.avmRenderRadioSection === "function", "avmRenderRadioSection fehlt im Skript");

// ---- Checkbox-Abschnitt (der, den der Garetien-Objekttyp-Filter benutzt: kind:"multi") --------

const optionen = [
	{ value: "Bach", label: "Bach", count: 143 },
	{ value: "BurgKlein", label: "BurgKlein", count: 5, muted: true, title: "Kein Gegenstück bei uns" },
];
kasten.avmRenderCheckboxSection("cb-menu", optionen, new Set());
const cbMarkup = elemente["cb-menu"].innerHTML;

const bachLabel = labelFuerWert(cbMarkup, "Bach");
const burgKleinLabel = labelFuerWert(cbMarkup, "BurgKlein");
wahr(bachLabel !== null, "Bach muss ueberhaupt im Markup stehen");
wahr(burgKleinLabel !== null, "BurgKlein muss ueberhaupt im Markup stehen");

// 🪤 Vakuum-Zusicherung vermeiden: die DIFFERENZ zaehlt. Die gewoehnliche Option (Bach) darf die
// Modifier-Klasse NICHT tragen, die gedaempfte (BurgKlein) MUSS sie tragen.
wahr(!/type-filter__opt--muted/.test(bachLabel), "Bach (importierbar) darf NICHT gedaempft sein");
wahr(!/\stitle="/.test(bachLabel), "Bach (importierbar) braucht keine Erklaerung");
wahr(/class="type-filter__opt type-filter__opt--muted"/.test(burgKleinLabel),
	"BurgKlein muss die Modifier-Klasse type-filter__opt--muted tragen");
wahr(/title="Kein Gegenstück bei uns"/.test(burgKleinLabel),
	"die Erklaerung muss als title-Attribut an der Option stehen");
// Die Zahl bleibt, wie sie ist -- unveraendert von `muted`.
wahr(/<span class="type-filter__count">5<\/span>/.test(burgKleinLabel),
	"die Zahl neben einer gedaempften Option bleibt unangetastet");
// Die Option bleibt WAEHLBAR -- "blasser, nicht versteckt": kein disabled am Kontrollkaestchen.
wahr(!/disabled/.test(burgKleinLabel), "eine gedaempfte Option darf NICHT disabled sein");

// ---- Radio-Abschnitt: dieselbe Regel gilt fuer BEIDE Abschnittsarten --------------------------
// (ein Trichter, der nur die Checkbox-Haelfte pflegt, waere in jedem "single"-Abschnitt lautlos
// wirkungslos -- derselbe Fehler, den der geteilte Trichter an anderer Stelle schon vermeidet.)

kasten.avmRenderRadioSection("radio-menu", optionen, { value: "" });
const radioMarkup = elemente["radio-menu"].innerHTML;
const burgKleinRadioLabel = labelFuerWert(radioMarkup, "BurgKlein");
wahr(burgKleinRadioLabel !== null, "BurgKlein muss auch in der Radio-Fassung stehen");
wahr(/class="type-filter__opt type-filter__opt--muted"/.test(burgKleinRadioLabel),
	"die Radio-Fassung muss dieselbe Modifier-Klasse tragen");
wahr(/title="Kein Gegenstück bei uns"/.test(burgKleinRadioLabel),
	"die Radio-Fassung muss denselben title tragen");

// ---- Rueckwaertskompatibel: eine Option OHNE `muted` sieht aus wie vor dieser Aenderung --------

kasten.avmRenderCheckboxSection("cb-menu-2", [{ value: "See", label: "See", count: 96 }], new Set());
const ohneMuted = elemente["cb-menu-2"].innerHTML;
gleich(/type-filter__opt--muted/.test(ohneMuted), false, "ohne `muted` darf die Klasse nirgends auftauchen");
gleich(/\stitle="/.test(ohneMuted), false, "ohne `title` darf gar kein title-Attribut entstehen");

console.log(`filter-menu-muted-option: ${checks} Pruefungen bestanden.`);
