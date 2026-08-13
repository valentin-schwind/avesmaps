// Die Community-Dialoge "Karte vorschlagen" und "Neuer Fundort"
// (js/map-features/map-features-citymaps-suggest.js + ihr Block in css/features/place-extras.css).
//
// Geprueft wird, was beim naechsten Anfassen lautlos kippt -- jeder Punkt war bis zum 13.08.2026
// wirklich falsch und ist genau deshalb hier:
//
//   1. Kein Pflichtfeld in einer zugeklappten Gruppe. Die eigene Pruefung fokussiert das erste
//      fehlende Pflichtfeld -- in einem zugeklappten <details> liefe das ins Leere und der Melder
//      saehe eine Fehlermeldung ohne Feld dazu.
//   2. Die sechs Eigenschaften werden ueber den ANGEHAKTEN Radio gelesen, nicht ueber val(). val()
//      liest .value eines Elements mit dieser ID -- bei Radios gibt es das nicht, und der Vorschlag
//      truege still lauter Leerwerte.
//   3. "unbekannt" ist die Vorauswahl (§3.1). Ein voreingestelltes "nein" ist die erfundene Tatsache,
//      die §3.1 verbietet.
//   4. Abbrechen steht LINKS vom gefuellten Hauptknopf (docs/design-language.md).
//   5. Jede benutzte Klasse hat eine Regel. Eine erfundene Klasse faellt sonst nicht auf.
//   6. Der CSS-Block haelt sich an die Token-Regel (AGENTS.md §12): keine eigenen Schriftgroessen,
//      Schriftschnitte, Zeilenhoehen, Radien, Farben oder Abstaende. Genau das war der Befund --
//      11.5px/12.5px gibt es in der Skala gar nicht, font-weight 600 ist verboten.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/map-features/__tests__/citymaps-suggest-form.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (...teile) => fs.readFileSync(path.join(ROOT, ...teile), "utf8");

/** 💣 Die Prosa in diesen Dateien beschreibt genau das, wonach gesucht wird -- ein Treffer im
 *  Kommentar ist deshalb kein Beweis, sondern die haeufigste Art, einen gruenen Test zu bauen,
 *  der nichts haelt. */
function ohneKommentare(quelle) {
	return quelle.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

const js = ohneKommentare(read("js", "map-features", "map-features-citymaps-suggest.js"));
const css = ohneKommentare(read("css", "features", "place-extras.css"));

// ---------------------------------------------------------------------------------------------
// 1. Pflichtfelder stehen VOR der ersten zugeklappten Gruppe.
// ---------------------------------------------------------------------------------------------
const ersteFaltung = js.indexOf("detailsGroup(t(");
assert.ok(ersteFaltung > 0, "es gibt eingeklappte Gruppen");
["citymap-suggest-title-input", "citymap-suggest-map-url", "citymap-suggest-source-label"].forEach((id) => {
	const stelle = js.indexOf('fieldMarkup("' + id + '"');
	assert.ok(stelle > 0, "Pflichtfeld " + id + " wird gebaut");
	assert.ok(stelle < ersteFaltung, "Pflichtfeld " + id + " steht offen, nicht in einer zugeklappten Gruppe");
});
// Und jedes dieser drei traegt wirklich `required` -- sonst prueft nur noch die eigene Liste.
["citymap-suggest-title-input", "citymap-suggest-map-url", "citymap-suggest-source-label"].forEach((id) => {
	const block = js.slice(js.indexOf('fieldMarkup("' + id + '"'), js.indexOf('fieldMarkup("' + id + '"') + 400);
	assert.ok(/\brequired\b/.test(block), id + " ist als required ausgezeichnet");
});
// Das Sternchen kommt aus labelMarkup, nicht aus dem Beschriftungstext -- sonst stuenden zwei da.
assert.ok(/citymap-suggest__req/.test(js), "das Pflicht-Sternchen ist eine eigene Auszeichnung");
assert.ok(!/"(Titel|Quelle|Karten-Link \(extern\)|Bezeichnung|Link) \*"/.test(js),
	"kein '*' mehr im Beschriftungstext -- es kommt aus labelMarkup");

// ---------------------------------------------------------------------------------------------
// 2. + 3. Die Eigenschaften: Dreierschalter, ueber den angehakten Radio gelesen, "unbekannt" vorn.
// ---------------------------------------------------------------------------------------------
assert.ok(/citymap\[p\[0\]\] = triVal\(overlay, p\[0\]\)/.test(js),
	"die Eigenschaften werden mit triVal gelesen");
assert.ok(!/val\(overlay, "citymap-suggest-" \+ p\[0\]\)/.test(js),
	"NICHT mehr mit val() -- das liest bei Radios nichts");
assert.ok(/data-citymap-suggest-tri="/.test(js), "die Radios tragen die Kennung, an der triVal sie sucht");
assert.ok(/querySelector\('\[data-citymap-suggest-tri="' \+ key \+ '"\]:checked'\)/.test(js),
	"triVal fragt genau diese Kennung ab, und zwar den angehakten");
// Vorauswahl: der ERSTE Eintrag von TRI wird angehakt, und der erste Eintrag ist "unbekannt".
assert.ok(/index === 0 \? " checked" : ""/.test(js), "der erste Dreierschalter-Eintrag ist vorausgewaehlt");
const triListe = js.slice(js.indexOf("var TRI = "), js.indexOf("var TRI = ") + 200);
assert.ok(/var TRI = \[\["",/.test(triListe), '"unbekannt" (Wert "") steht als erster Eintrag in TRI');
// Jede Eigenschaft bekommt einen Schalter -- keine faellt beim Umbau still heraus.
assert.ok(/PROPS\.map\(function \(p\) \{ return triMarkup\(p\[0\]/.test(js),
	"jede Eigenschaft aus PROPS bekommt einen Dreierschalter");
const propsListe = js.slice(js.indexOf("var PROPS = "), js.indexOf("];", js.indexOf("var PROPS = ")));
const propKeys = (propsListe.match(/\["(is_[a-z_]+)"/g) || []).map((s) => s.slice(2, -1));
assert.strictEqual(propKeys.length, 6, "sechs Eigenschaften, wie im Entwurf");

// ---------------------------------------------------------------------------------------------
// 4. Abbrechen links, gefuellter Hauptknopf rechts -- in BEIDEN Dialogen.
// ---------------------------------------------------------------------------------------------
const aktionsbloecke = js.split('citymap-suggest__actions').slice(1);
assert.strictEqual(aktionsbloecke.length, 2, "zwei Dialoge, zwei Knopfleisten");
aktionsbloecke.forEach((block, i) => {
	const kopf = block.slice(0, 600);
	const abbrechen = kopf.indexOf("citymap-suggest__cancel");
	const senden = kopf.indexOf("citymap-suggest__submit");
	assert.ok(abbrechen >= 0 && senden >= 0, "Dialog " + (i + 1) + ": beide Knoepfe da");
	assert.ok(abbrechen < senden, "Dialog " + (i + 1) + ": Abbrechen steht links vom gefuellten Hauptknopf");
});

// ---------------------------------------------------------------------------------------------
// 5. Jede benutzte Klasse hat eine Regel.
// ---------------------------------------------------------------------------------------------
const benutzt = new Set((js.match(/citymap-(?:suggest|fundort)__[a-z-]+/g) || []));
assert.ok(benutzt.size > 15, "genug Klassen gefunden (sonst hat die Suche danebengegriffen)");
const fehlend = [...benutzt].filter((klasse) => !new RegExp("\\." + klasse + "\\b").test(css));
assert.deepStrictEqual(fehlend, [], "jede im Haus benutzte Klasse hat eine Regel");

// ---------------------------------------------------------------------------------------------
// 6. Der CSS-Block haelt die Token-Regel ein (AGENTS.md §12).
// ---------------------------------------------------------------------------------------------
/** Alle Regeln, deren Selektor einen der beiden Dialoge nennt. Naiver Klammerlauf -- reicht, weil
 *  dieser Block keine verschachtelten At-Regeln ausser einer Media-Query enthaelt. */
function dialogDeklarationen(quelle) {
	const out = [];
	const re = /([^{}]+)\{([^{}]*)\}/g;
	let m;
	while ((m = re.exec(quelle)) !== null) {
		const selektor = m[1].trim();
		if (!/citymap-(?:suggest|fundort)/.test(selektor)) {
			continue;
		}
		m[2].split(";").forEach((decl) => {
			const teile = decl.split(":");
			if (teile.length < 2) {
				return;
			}
			out.push({ selektor, prop: teile[0].trim(), wert: teile.slice(1).join(":").trim() });
		});
	}
	return out;
}
const decls = dialogDeklarationen(css);
assert.ok(decls.length > 60, "genug Deklarationen gefunden (sonst hat der Klammerlauf danebengegriffen)");

const istToken = (wert, gruppe) => new RegExp("var\\(--" + gruppe + "-").test(wert);
const verstoesse = [];
decls.forEach((d) => {
	const { prop, wert, selektor } = d;
	const melde = (grund) => verstoesse.push(selektor + " { " + prop + ": " + wert + " } -- " + grund);

	if (prop === "font-size" && !istToken(wert, "font-size")) {
		melde("Schriftgroesse ohne Token (die Skala hat 7 Stufen, 11px Boden)");
	}
	if (prop === "font-weight" && !istToken(wert, "font-weight")) {
		melde("Schriftschnitt ohne Token (es gibt nur 400 und 700)");
	}
	// line-height: 1 ist der Pfeil -- ein Glyph, der genau auf seiner Grundlinie sitzen soll.
	if (prop === "line-height" && wert !== "1" && !istToken(wert, "leading")) {
		melde("Zeilenhoehe ohne Token");
	}
	if (prop === "border-radius" && !istToken(wert, "radius")) {
		melde("Radius ohne Token (es gibt drei Stufen)");
	}
	if (/^(color|background|background-color|border-color)$/.test(prop)
		&& !/^(transparent|none|inherit|currentColor)$/.test(wert) && !istToken(wert, "color")) {
		melde("Farbe ohne Token");
	}
	// Abstaende. Ausgenommen ist nur der Chevron-Schlitz der Auswahlboxen: derselbe Literalwert steht
	// aus demselben Grund in css/components/location-report-dialog.css -- er misst das Bild, nicht das
	// Raster, und ein --space-Schritt daneben schnitte den Pfeil an.
	if (/^(margin|padding|gap|row-gap|column-gap)(-top|-right|-bottom|-left)?$/.test(prop)
		&& !(prop === "padding-right" && wert === "22px")) {
		const teile = wert.split(/\s+/);
		teile.forEach((teil) => {
			if (/^(0|auto)$/.test(teil) || /^var\(--space-/.test(teil) || /^calc\(/.test(teil)) {
				return;
			}
			melde("Abstand ohne Token (" + teil + ")");
		});
	}
});
assert.deepStrictEqual(verstoesse, [], "der Dialog-CSS-Block benutzt nur Token");

// Die Auswahlboxen sind keine grauen OS-Controls mehr.
assert.ok(/select\.citymap-fundort__input/.test(css) && /citymap-suggest__field select/.test(css),
	"beide Dialoge behandeln ihre Auswahlboxen");
assert.ok(/--avesmaps-select-chevron/.test(css), "eigener Chevron statt des nativen Dreiecks");
// Felder und Knoepfe haben einen Fokusring (vorher gab es nur eine Randfarbe).
assert.ok((css.match(/citymap-suggest__(field|tri|submit|cancel|summary)[^{}]*\{[^{}]*--focus-ring/g) || []).length >= 4,
	"Felder, Schalter und beide Knoepfe tragen den Fokusring");

console.log("citymaps-suggest-form: alle Zusicherungen gehalten");
