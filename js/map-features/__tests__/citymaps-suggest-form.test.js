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
["citymap-suggest-title-input", "citymap-suggest-map-url", "citymap-suggest-source-ref"].forEach((id) => {
	const stelle = js.indexOf('fieldMarkup("' + id + '"');
	assert.ok(stelle > 0, "Pflichtfeld " + id + " wird gebaut");
	assert.ok(stelle < ersteFaltung, "Pflichtfeld " + id + " steht offen, nicht in einer zugeklappten Gruppe");
});
// Und jedes dieser drei traegt wirklich `required` -- sonst prueft nur noch die eigene Liste.
["citymap-suggest-title-input", "citymap-suggest-map-url", "citymap-suggest-source-ref"].forEach((id) => {
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

// ---------------------------------------------------------------------------------------------
// 7. "kostenpflichtig" im Fundort-Dialog ist derselbe Dreierschalter -- und jede Zeile hat ihre
//    EIGENE Radiogruppe. Mit einem gemeinsamen Namen loeschte die zweite Zeile die Antwort der
//    ersten; das sieht man erst beim zweiten Fundort und nie beim ersten.
// ---------------------------------------------------------------------------------------------
const rowFn = js.slice(js.indexOf("function fundortRowMarkup()"), js.indexOf("function ensureFundortDialog()"));
assert.ok(rowFn.includes("citymap-suggest__tri"), "die Fundort-Zeile benutzt den Dreierschalter");
assert.ok(!/<select[^>]*data-fundort-field="is_paid"/.test(rowFn) && !rowFn.includes("<select"),
	"keine Auswahlbox mehr fuer kostenpflichtig");
// 💣 Der Zaehler muss in den NAMEN wandern. Nur zu pruefen, dass er hochgezaehlt wird, waere gruen,
//    auch wenn der Name daneben eine Konstante ist -- und genau dann teilen sich alle Zeilen eine
//    Gruppe. Also die Ableitung selbst behaupten.
assert.ok(/fundortRowSeq \+= 1/.test(rowFn), "der Zaehler wird je Zeile hochgezaehlt");
assert.ok(/var name = "[^"]*" \+ fundortRowSeq;/.test(rowFn), "und der Radio-Name wird AUS ihm gebildet");
assert.ok(/name="' \+ esc\(name\)/.test(rowFn), "und dieser Name landet am Radio");
assert.ok(/var fundortRowSeq = 0/.test(js), "der Zaehler wohnt AUSSERHALB der Funktion (sonst zaehlt er nie hoch)");
assert.ok(/field === "is_paid" \? ":checked" : ""/.test(js),
	"der Leser holt is_paid vom angehakten Radio, die anderen beiden vom Feld");
assert.ok(/index === 0 \? " checked" : ""/.test(rowFn), "auch hier ist 'unbekannt' vorausgewaehlt");

// ---------------------------------------------------------------------------------------------
// 8. Ein Hinweis, der auf einen BLOCK folgt, braucht Luft nach oben. Stand im Entwurf, fiel beim
//    Einbau heraus und wurde vom Owner gesehen (13.08.2026) -- deshalb hier festgenagelt.
// ---------------------------------------------------------------------------------------------
["citymap-suggest__props", "citymap-suggest__types", "citymap-fundort__add"].forEach((block) => {
	assert.ok(new RegExp("\\." + block + " \\+ \\.citymap-suggest__hint").test(css),
		"Hinweis nach ." + block + " bekommt Abstand nach oben");
});
// ---------------------------------------------------------------------------------------------
// 9. Das Zeichen folgt dem, was der Knopf TUT (Owner 2026-08-13): die Feder an „… vorschlagen",
//    der Brief an „… senden". Und beide kommen aus EINER Stelle -- vier Abschriften desselben <img>
//    laufen auseinander, genau so sind seinerzeit die nachgebauten Kachel-Regeln entstanden.
// ---------------------------------------------------------------------------------------------
const dialogJs = ohneKommentare(read("js", "map-features", "map-features-citymaps-dialog.js"));
const extrasJs = ohneKommentare(read("js", "map-features", "map-features-place-extras.js"));
assert.ok(/function avesmapsCitymapActionIconMarkup\(src, className\)/.test(extrasJs),
	"es gibt genau eine Stelle, die so ein <img> baut");
// 💣 Der Bauer darf KEIN Bild fest verdrahten -- sonst tragen alle Knoepfe wieder dasselbe Zeichen.
const bauer = extrasJs.slice(extrasJs.indexOf("function avesmapsCitymapActionIconMarkup"),
	extrasJs.indexOf("function cityMapSafeUrl"));
assert.ok(!/\.webp/.test(bauer), "der Bauer nennt kein Bild -- das tut der Aufrufer");
[["map-features-place-extras.js", extrasJs], ["map-features-citymaps-dialog.js", dialogJs],
	["map-features-citymaps-suggest.js", js]].forEach(([name, quelle]) => {
	assert.strictEqual((quelle.match(/<img[^>]*(feder|brief)\.webp/g) || []).length, 0,
		name + ": kein handgeschriebenes <img> neben dem Bauer");
});
// „senden" traegt den Brief -- beide Male.
assert.strictEqual((js.match(/sendIcon\(\) \+ esc\(t\("cityMaps\.suggestSubmit"/g) || []).length, 2,
	"beide 'Vorschlag senden' rufen sendIcon()");
assert.ok(/avesmapsCitymapActionIconMarkup\("img\/menu\/brief\.webp/.test(js),
	"und sendIcon() zeigt auf den Brief");
assert.ok(!/feder\.webp/.test(js), "an 'senden' haengt KEINE Feder mehr");
// „vorschlagen" traegt die Feder -- in der Sektion wie in der Dialog-Fusszeile.
assert.ok(/avesmapsCitymapActionIconMarkup\("icons\/feder\.webp"\) \+ esc\(tr\("cityMaps\.suggest"/.test(dialogJs),
	"'Karte vorschlagen' in der Dialog-Fusszeile traegt die Feder");
assert.ok(/avesmapsCitymapActionIconMarkup\("icons\/feder\.webp", "location-popup__action-img"\)/.test(extrasJs),
	"'Karte vorschlagen' in der Sektion traegt die Feder");
// Und die Bilder gibt es wirklich -- ein Tippfehler im Pfad faellt sonst erst live auf.
[["icons", "feder.webp"], ["img", "menu", "brief.webp"]].forEach((teile) => {
	assert.ok(fs.existsSync(path.join(ROOT, ...teile)), teile.join("/") + " liegt im Repo");
});
const federRegel = (css.match(/\.citymap-suggest__icon \{([^}]*)\}/) || [])[1];
assert.ok(federRegel !== undefined, "die Feder hat eine eigene Regel");
assert.ok(/width:\s*var\(--icon-/.test(federRegel) && /height:\s*var\(--icon-/.test(federRegel),
	"ihre Groesse kommt aus der Icon-Skala, nicht aus einer Zahl");
// 💣 16px, nicht 20: der Absende-Knopf steht neben "Abbrechen" und war mit 20 drei Pixel hoeher als
//    sein Nachbar (align-items: stretch hilft nicht, ein <button> dehnt sich nicht mit). Gemessen.
assert.ok(/--icon-sm/.test(federRegel), "und zwar --icon-sm, sonst wird der Knopf hoeher als sein Nachbar");

// 💣 Die dritte Spur der Fundort-Zeile ist eine FESTE Laenge. Kopfzeile und Datenzeile sind zwei
//    getrennte Gitter mit derselben Vorlage -- mit `auto` misst jedes seinen eigenen Inhalt (111px
//    Ueberschrift gegen 137px Schalter) und die Spaltenbeschriftung wandert von ihrer Spalte weg.
//    Genau das passierte beim Umbau auf den Dreierschalter und wurde in der Abnahme gemessen.
const spur = (css.match(/\.citymap-fundort__head,\s*\.citymap-fundort__row \{[^}]*grid-template-columns:([^;]+);/) || [])[1];
assert.ok(spur !== undefined, "die Rasterspalten der Fundort-Zeile stehen im CSS");
assert.ok(/\b\d+px\s*$/.test(spur.trim()), "die dritte Spur ist eine feste Laenge, kein auto/fr", spur);

// Und der andere Fall bleibt dicht: der Grundregel des Hinweises darf keine margin-top wachsen.
// 💣 Am ZEILENANFANG verankert: ".citymap-suggest__hint {" steckt als Teilkette auch in der
//    Nachbarschaftsregel darueber, und ein indexOf() greift dann die falsche Regel ab (und behauptet
//    das Gegenteil).
const hintRegel = (css.match(/^\.citymap-suggest__hint \{([^}]*)\}/m) || [])[1];
assert.ok(hintRegel !== undefined, "die Grundregel des Hinweises steht auf einer eigenen Zeile");
assert.ok(!/margin-top/.test(hintRegel), "der Hinweis UNTER einem Feld bleibt an seinem Feld");

// ---- 7. Jeder Knopf im Markup hat einen ZUHOERER -------------------------------------------------
// 💣 WARUM ES DIESEN ABSCHNITT GIBT. Am 04.09.2026 wurde ein Klick-Handler dieses Fensters
//    aufgespalten -- der Hintergrundklick sollte ans geteilte Bauteil. Das Skript nahm ZWEI Zweige
//    an; es waren DREI. Der dritte („+ weiterer Fundort" haengt eine Zeile an) verschwand ersatzlos.
//    Der Knopf stand danach im Markup und tat beim Klicken sichtbar NICHTS.
// 🪤 Das Testfeld war gruen: Abschnitt 1 prueft `fundortRowMarkup()` isoliert und hat nie gefragt,
//    ob irgendjemand die Funktion RUFT. Ein Bauer ohne Aufrufer ist genau die Luecke, die ein
//    Quelltexttest gerne uebersieht -- er sieht die Funktion, also glaubt er an sie.
// 🔴 Die Zusicherung ist deshalb eine MENGENGLEICHHEIT, kein Einzelname: jedes `data-…`-Attribut,
//    das im Markup an einem Knopf haengt, muss irgendwo in dieser Datei auch GELESEN werden.
//    Ein neuer Knopf ohne Verdrahtung faellt damit von selbst auf.
{
	const knopfMarken = new Set();
	// Attribute an <button>-Stellen des Markups: data-foo (ohne Wert) oder data-foo="…"
	const buttonRe = /<button[^>]*?>/g;
	let m;
	while ((m = buttonRe.exec(js))) {
		const marken = m[0].match(/data-[a-z-]+/g) || [];
		marken.forEach((marke) => {
			// data-…-field sind DATEN-Felder, die beim Absenden ausgelesen werden, keine Knopfmarken.
			if (/-field$/.test(marke)) { return; }
			knopfMarken.add(marke);
		});
	}
	assert.ok(knopfMarken.size >= 2,
		"Der Sucher findet keine Knopfmarken mehr (" + knopfMarken.size + ") -- er misst sich selbst kaputt");
	const ohneZuhoerer = [];
	for (const marke of knopfMarken) {
		// Gelesen wird ueber closest("[data-…]") oder querySelector("[data-…]")
		const gelesen = js.includes('closest("[' + marke + ']")')
			|| js.includes("closest('[" + marke + "]')")
			|| js.includes('querySelector("[' + marke + ']")')
			|| js.includes('querySelectorAll("[' + marke + ']")')
			|| js.includes('matches("[' + marke + ']")');
		if (!gelesen) { ohneZuhoerer.push(marke); }
	}
	assert.deepStrictEqual(ohneZuhoerer, [],
		"Knopfmarken im Markup, die NIRGENDS gelesen werden -- der Knopf tut beim Klicken nichts:\n   "
		+ ohneZuhoerer.join("\n   "));
}


console.log("citymaps-suggest-form: alle Zusicherungen gehalten");
