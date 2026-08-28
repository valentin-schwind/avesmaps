// Aufgabe 13 des Garetien Importers -- die Einzelansicht: was bei uns an derselben Stelle liegt.
// Auftrag: docs/superpowers/specs/2026-08-27-garetien-importer-fenster-auftrag.md §5.3
// Brief:   .superpowers/sdd/2026-08-27-garetien-importer-fenster/task-13-brief.md
// Mockup:  docs/garetien-importer-mockup.html §3 und §6
//
// Ausfuehren, vom Repo-Wurzelverzeichnis: node js/review/__tests__/garetien-einzelansicht.test.js
//
// 🔴 Geprueft wird die PURE Haelfte (garetienDetailMarkup baut nur einen String) UND der
// Klickverteiler -- der nimmt sein Ereignis und seine Objektliste HEREIN und laesst sich deshalb
// ohne Browser am ERGEBNIS messen, genau wie garetienLaufStarten aus Aufgabe 12b. Die Optik
// (Rollen, Bildlaufleiste, hell/dunkel) steht in der Abnahme des Berichts.

"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const WURZEL = path.resolve(__dirname, "..", "..", "..");
const mod = require(path.resolve(__dirname, "..", "review-garetien-importer.js"));

let checks = 0;
function wahr(bedingung, warum) {
	assert.ok(bedingung, warum || "");
	checks++;
}
function gleich(ist, soll, warum) {
	assert.strictEqual(ist, soll, warum || "");
	checks++;
}

const { garetienDetailMarkup, garetienListeKlick, garetienAbschnittsGruppen } = mod;

wahr(typeof garetienDetailMarkup === "function", "garetienDetailMarkup fehlt im Export");
wahr(typeof garetienListeKlick === "function", "garetienListeKlick fehlt im Export");

// ---- Der Fall aus dem Brief: ihre EINE Natter laeuft ueber drei unserer Fluesse ---------------
//
// Die Einzelansicht zeigt, WAS BEI UNS an derselben Stelle liegt -- und je Abschnitt ein Haekchen.

const natter = {
	key: "ggp:Gewaesser:Fluss:Natter",
	name: "Natter", typ: "Fluss", urteil: "ergaenzung",
	grund: 'Geometrie liegt 0.84 Einheiten von "Natter" (anderer Name)',
	wiki: "ggp", ebene: "Gewaesser", lodmin: "5", lodmax: "14", extra: "",
	wiki_url: "https://www.garetien.de/index.php?title=Garetien:Natter",
	abschnitte: [
		{ public_id: "w-4471", name: "Natter", punkte: 9 },
		{ public_id: "w-5008", name: "Gardel", punkte: 6 },
		{ public_id: "w-6120", name: "", punkte: 1 },
	],
	items: [
		{ id: 11, anlass: "ergaenzung", felder: ["quelle"], selected: 1,
		  abschnitt: { public_id: "w-4471", name: "Natter" } },
		{ id: 12, anlass: "ergaenzung", felder: ["name", "quelle"], selected: 1,
		  abschnitt: { public_id: "w-6120", name: "" } },
	],
};
const markup = garetienDetailMarkup(natter);

// 💣 JEDER getroffene Abschnitt steht da -- auch der, an dem sich nichts aendert. Wer nur die
// Items zeichnet, verschweigt den Gardel, und dann sieht der Fall aus wie ein zweiteiliger.
wahr(markup.includes("w-4471") && markup.includes("w-5008") && markup.includes("w-6120"),
	"alle drei getroffenen Abschnitte gehoeren in die Einzelansicht");
wahr(/gi-seg[^"]*is-full[^"]*"[\s\S]{0,400}Gardel/.test(markup),
	"der Gardel bekommt kein Item und muss als `is-full` dastehen: nichts zu ersetzen");
wahr(markup.includes("is-empty"), "ein namenloser Abschnitt wird als Luecke gekennzeichnet");

// Die Zahl im Kasten ist die der ABSCHNITTE, nicht der Items.
wahr(/3 Abschnitte/.test(markup), "die Ueberschrift zaehlt die Abschnitte");
wahr(/3 verschiedene Flüsse|3 verschiedene/.test(markup),
	"💣 Ihr EINES Objekt laeuft ueber drei unserer Fluesse -- das ist die Auskunft, wegen der es "
	+ "die Einzelansicht ueberhaupt gibt. Ohne sie haelt ein Editor den Fall fuer einteilig.");

// 🔴 Der Browser rechnet NICHTS nach: Grund und Deckung kommen fertig vom Server.
// ⚠️ Kommentare zuerst strippen -- die Moduldatei erklaert in Prosa, warum sie NICHT rechnet, und
// ein ungestrippter Test schlaegt an seiner eigenen Warnung an (Aufgabe 11, Review I2).
const quelleRoh = fs.readFileSync(path.join(WURZEL, "js/review/review-garetien-importer.js"), "utf8");
const quelle = quelleRoh.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
wahr(!/Math\.sqrt|Math\.hypot/.test(quelle),
	"Ein Abstand im Browser ist die zweite Rechnung, die Auftrag §5.4 verbietet.");
// Gegenprobe, damit die Zeile darueber kein Nulltest ist: an einer Zeichenkette, die es wirklich
// gibt, muss dasselbe Muster ANSCHLAGEN -- sonst misst der Riegel eine leergestrippte Datei.
wahr(/avesmapsGaretienRufe/.test(quelle),
	"die Gegenprobe findet den gestrippten Quelltext selbst nicht mehr -- der Riegel misst nichts");

// Ein Ueberschreiben zeigt alt -> neu im KLARTEXT und startet ungehakt.
const strasse = {
	key: "ggp:Wege:Reichsstrasse:Angbarer", name: "Angbarer Reichsstraße", typ: "Reichsstrasse",
	urteil: "ergaenzung", grund: "", wiki: "ggp", ebene: "Wege",
	abschnitte: [{ public_id: "w-2210", name: "Reichsstraße 3", punkte: 3 }],
	items: [{ id: 21, anlass: "umbenennung", felder: ["name"], selected: 0,
		abschnitt: { public_id: "w-2210", name: "Reichsstraße 3" } }],
};
const m2 = garetienDetailMarkup(strasse);
wahr(m2.includes("is-overwrite"), "ein vorhandener Name traegt den Warnton");
// 🪤 Von der Mutationsprobe gefunden: die Klasse allein war gepruefet, die BESCHRIFTUNG nicht --
// die Lage „ueberschreiben" konnte auf „Name fehlt" durchfallen (denn `felder` traegt dort nur
// 'name'), und der Test blieb gruen. Ein Abschnitt, der „Name fehlt" sagt, wo ein vorhandener
// Name ersetzt wuerde, ist genau die stillschweigende Ueberschreibung, die der Brief verbietet.
wahr(m2.includes("⚠ Name weicht ab"),
	"das Ueberschreiben sagt es auch im TEXT, nicht nur in einer Klasse");
wahr(!m2.includes("Name fehlt"),
	"ein vorhandener Name „fehlt” nicht -- er wuerde ersetzt");
wahr(m2.includes("Reichsstraße 3") && m2.includes("Angbarer Reichsstraße"),
	"alt -> neu steht im Klartext -- nichts wird stillschweigend ueberschrieben");
wahr(!/is-overwrite[\s\S]{0,200}checked/.test(m2),
	"ein Ueberschreiben startet UNGEHAKT (Owner: vorangehakt ist nur das Fuellen einer Luecke)");

// ---- Die vier Lagen einer .gi-seg, jede an ihrer Beschriftung gemessen ------------------------
//
// 🔴 Sie kommen aus `after.felder` des Items, nicht aus einer Rechnung im Browser. Gepruefet wird
// die BESCHRIFTUNG, nicht die Anwesenheit der Klasse -- eine Klasse ohne Text sagt dem Editor
// nichts, und genau der Text ist der Unterschied zwischen "Luecke fuellen" und "ersetzen".

function segFall(abschnitt, items) {
	return garetienDetailMarkup({
		key: "k", name: "Ihr Name", typ: "Fluss", urteil: "ergaenzung", grund: "g",
		abschnitte: [abschnitt], items: items,
	});
}

const luecke = segFall({ public_id: "w-1", name: "", punkte: 12 },
	[{ id: 1, anlass: "ergaenzung", felder: ["name", "quelle"], selected: 1,
		abschnitt: { public_id: "w-1", name: "" } }]);
wahr(luecke.includes("Name + Quelle"), "kein Name + keine Quelle heisst „Name + Quelle”");
wahr(/gi-seg__name is-empty[^>]*>ohne Namen/.test(luecke),
	"ein namenloser Abschnitt heisst „ohne Namen” und traegt is-empty");
wahr(/<input type="checkbox" checked>/.test(luecke),
	"das Fuellen einer Luecke startet VORANGEHAKT (Owner 16.08.2026)");

const nurQuelle = segFall({ public_id: "w-2", name: "Natter", punkte: 9 },
	[{ id: 2, anlass: "ergaenzung", felder: ["quelle"], selected: 1,
		abschnitt: { public_id: "w-2", name: "Natter" } }]);
wahr(nurQuelle.includes("Quelle fehlt"), "fehlt nur die Quelle, steht genau das da");
wahr(!nurQuelle.includes("Name + Quelle"),
	"eine vorhandene Beschriftung darf nicht in die andere rutschen");
// 💣 Kein „→ ‚Ihr Name'": dieses Item schreibt keinen Namen. Ein Pfeil hier behauptete eine
// Umbenennung, die gar nicht ausgefuehrt wird -- dieselbe Falle, die garetien-plan.php mit
// `unset($eintrag['after']['name'])` schon einmal geschlossen hat (Review I1, Aufgabe 3).
wahr(!nurQuelle.includes("gi-seg__to"),
	"ohne 'name' in `felder` darf kein „→ neuer Name” dastehen");

const nichts = segFall({ public_id: "w-3", name: "Gardel", punkte: 6 }, []);
wahr(nichts.includes("nichts zu ersetzen"), "ein Abschnitt ohne Item sagt „nichts zu ersetzen”");
wahr(/<input type="checkbox" disabled>/.test(nichts),
	"ein Abschnitt ohne Item ist nicht anhakbar");

// Dreiwertig: EIN Abschnitt, zwei Items, eines angehakt. Der Marker ist `data-part` -- die
// Eigenschaft `indeterminate` gibt es im Markup nicht (dieselbe Loesung wie in der Listenzeile).
const gemischt = segFall({ public_id: "w-4", name: "Reichsstraße 3", punkte: 3 }, [
	{ id: 4, anlass: "ergaenzung", felder: ["quelle"], selected: 1,
		abschnitt: { public_id: "w-4", name: "Reichsstraße 3" } },
	{ id: 5, anlass: "umbenennung", felder: ["name"], selected: 0,
		abschnitt: { public_id: "w-4", name: "Reichsstraße 3" } },
]);
wahr(/<input type="checkbox" data-part>/.test(gemischt),
	"ein Abschnitt mit halber Auswahl ist DREIWERTIG, nicht angehakt und nicht leer");
wahr(gemischt.includes("is-overwrite"),
	"eine Umbenennung neben einer Quellen-Ergaenzung bleibt ein Ueberschreiben");

// 💣 Das Geometrie-Item gehoert NICHT in das Haekchen des Abschnitts: es hat seinen eigenen Knopf
// („Geometrie ersetzen …", Aufgabe 15), und die Alke des Mockups (§6a) steht dort mit VOLLEM
// Haken, obwohl ihr ungehaktes Geometrie-Item danebenliegt. Zaehlte es mit, staende sie
// dreiwertig da und der Editor liest „halb ausgewaehlt", wo nichts halb ist.
const mitGeometrie = segFall({ public_id: "w-5", name: "", punkte: 12 }, [
	{ id: 6, anlass: "ergaenzung", felder: ["name", "quelle"], selected: 1,
		abschnitt: { public_id: "w-5", name: "" } },
	{ id: 7, anlass: "geometrie", felder: ["geometrie"], selected: 0,
		abschnitt: { public_id: "w-5", name: "" } },
]);
wahr(/<input type="checkbox" checked>/.test(mitGeometrie),
	"das Geometrie-Item zaehlt nicht in das Abschnitts-Haekchen (Mockup §6a: Alke steht voll)");

// ---- Der 💣-Kasten: er kommt bei MEHREREN, und er kommt bei EINEM nicht ------------------------
//
// ⚠️ Das ist die DIFFERENZ -- ein Kasten, der immer da ist, sagt nichts. Barun-Ulah (Mockup §6b)
// ist EIN Fluss mit einer Luecke und darf ihn nicht bekommen.

wahr(markup.includes("gi-bomb"), "drei verschiedene Objekte bekommen den 💣-Kasten");
const einObjekt = garetienDetailMarkup({
	key: "k", name: "Alke", typ: "Bach", urteil: "ergaenzung", grund: "g",
	abschnitte: [{ public_id: "w-9", name: "Alke", punkte: 12 }],
	items: [{ id: 9, anlass: "ergaenzung", felder: ["quelle"], selected: 1,
		abschnitt: { public_id: "w-9", name: "Alke" } }],
});
wahr(!einObjekt.includes("gi-bomb"),
	"EIN Abschnitt, EIN Name -- kein 💣-Kasten. Ein Kasten, der immer kommt, ist keine Warnung.");
wahr(!/verschiedene/.test(einObjekt),
	"bei einem einzigen Objekt steht auch keine „verschiedene”-Zahl in der Ueberschrift");
wahr(einObjekt.includes("1 Abschnitt<") || /1 Abschnitt[^e]/.test(einObjekt),
	"Einzahl: „1 Abschnitt”, nicht „1 Abschnitte”");

// 🔴 Die Gruppenzahl: gleiche Namen sind EIN Objekt, ein NAMENLOSER Abschnitt zaehlt fuer sich.
// Beides ist gemessen: Barun-Ulah traegt seinen Namen siebenmal (= ein Objekt), und der namenlose
// 6120 der Natter liegt auf dem Darpat -- ihn stillschweigend dazuzuzaehlen waere genau der
// Fehler, den die Einzelansicht verhindern soll.
gleich(garetienAbschnittsGruppen([
	{ public_id: "a", name: "Barun-Ulah" }, { public_id: "b", name: "Barun-Ulah" },
	{ public_id: "c", name: "Barun-Ulah" },
]).gesamt, 1, "derselbe Name ist EIN Objekt, egal in wie vielen Abschnitten er liegt");
gleich(garetienAbschnittsGruppen([
	{ public_id: "a", name: "Barun-Ulah" }, { public_id: "b", name: "" },
]).gesamt, 2, "ein namenloser Abschnitt ist eine eigene Gruppe -- er ist nicht nachweislich ihrer");
gleich(garetienAbschnittsGruppen([
	{ public_id: "a", name: "" }, { public_id: "b", name: "" },
]).gesamt, 2, "zwei namenlose Abschnitte sind zwei Gruppen (die vorsichtige Richtung)");
gleich(garetienAbschnittsGruppen([]).gesamt, 0, "keine Abschnitte, keine Gruppen");

// ---- Kopf und Metazeile ------------------------------------------------------------------------

wahr(/<h4 class="gi-detail__name">Natter<\/h4>/.test(markup), "der Name steht im Kopf");
wahr(/gi-detail__kind">Fluss</.test(markup), "ihr Typ steht daneben");
wahr(markup.includes("LOD 5–14"), "die LOD-Spanne steht in der Metazeile");
wahr(markup.includes("ggp / Gewaesser"), "Wiki und Ebene stehen in der Metazeile");
wahr(/ohne&nbsp;<code>extra<\/code>/.test(markup), "ein leeres `extra` wird benannt, nicht verschwiegen");
wahr(garetienDetailMarkup(Object.assign({}, natter, { extra: "pop=1200" })).includes("pop=1200"),
	"ein gefuelltes `extra` steht im Klartext da");

// ⚠️ Der Wiki-Link ist auswaerts: target=_blank + rel=noopener. Das ↗ kommt aus der GETEILTEN
// CSS-Regel (dieselbe Bauform wie im Fenster „Hinweise" und im Fenster „Neuigkeiten") -- ein von
// Hand getipptes ↗ steht doppelt da, sobald jemand die Regel ergaenzt.
wahr(/<a href="https:\/\/www\.garetien\.de[^"]*" target="_blank" rel="noopener"/.test(markup),
	"der Wiki-Link oeffnet auswaerts, mit rel=noopener");
wahr(!markup.includes("↗"),
	"das ↗ gehoert in die CSS-Regel, nicht ins Markup (AGENTS.md §12: „automatisch”)");
// Ohne Adresse gar kein Link -- ein <a href=""> fuehrt auf die Karte zurueck und wirft den Editor
// aus dem Fenster.
wahr(!/<a /.test(garetienDetailMarkup(Object.assign({}, natter, { wiki_url: "" }))),
	"ohne wiki_url steht kein leerer Link da");

// ---- Der Grund: er kommt fertig vom Server, und eine leere Ueberschrift kommt gar nicht --------

wahr(markup.includes('Geometrie liegt 0.84 Einheiten von &quot;Natter&quot; (anderer Name)'),
	"der Grund steht im Klartext da -- escaped, aber ungekuerzt");
wahr(markup.includes("Der Grund"), "die Ueberschrift „Der Grund” steht da, wenn es einen gibt");
wahr(!garetienDetailMarkup(Object.assign({}, natter, { grund: "" })).includes("Der Grund"),
	"ohne Grund keine leere Ueberschrift -- ein Abschnitt, der nur leer sein kann, luegt");

// ---- Ohne Auswahl steht ein Satz da, kein leerer Kasten ----------------------------------------

const leer = garetienDetailMarkup(null);
wahr(/avm-empty/.test(leer) && /Wähle links eine Zeile/.test(leer),
	"ohne Auswahl steht der Hinweissatz da, nicht nichts");
wahr(!leer.includes("gi-seg"), "ohne Auswahl gibt es keine Abschnittszeilen");

// ---- Escaping ----------------------------------------------------------------------------------

const boese = garetienDetailMarkup({
	key: "k", name: '<img src=x onerror=alert(1)>', typ: "Fluss", urteil: "neu",
	grund: "<b>roh</b>", abschnitte: [], items: [],
});
wahr(!boese.includes("<img"), "der Name wird escaped");
wahr(!boese.includes("<b>roh</b>"), "auch der Grund wird escaped");

// Kein Abschnitt: die Ueberschrift steht trotzdem da und sagt, dass nichts da ist.
wahr(boese.includes("Was bei uns an derselben Stelle liegt"),
	"die Ueberschrift steht auch dann, wenn nichts getroffen wurde");
wahr(!boese.includes("gi-seg"), "ohne getroffenen Abschnitt gibt es keine .gi-seg");

// ---- Der Klickverteiler: die ZEILE waehlt aus, das HAEKCHEN nicht -------------------------------
//
// 🔴 Gemessen am ERGEBNIS (dem zurueckgegebenen Schluessel UND dem Zustand), nicht an der
// Anwesenheit eines `if` im Quelltext. Der Verteiler nimmt Ereignis und Objektliste HEREIN --
// dieselbe Bauform wie garetienLaufStarten, und nur so laeuft er ohne Browser.

function zielAttrappe(tagName, zeilenSchluessel) {
	const zeile = zeilenSchluessel === null ? null : {
		getAttribute: (name) => (name === "data-key" ? zeilenSchluessel : null),
		classList: { toggle: () => {} },
	};
	return {
		tagName: tagName,
		closest: function (auswahl) {
			if (auswahl === ".avm-row") { return zeile; }
			if (auswahl.indexOf("checkbox") !== -1) { return tagName === "INPUT" ? this : null; }
			return null;
		},
	};
}

const objekte = [natter, strasse];

gleich(garetienListeKlick({ target: zielAttrappe("SPAN", "ggp:Gewaesser:Fluss:Natter") }, objekte),
	"ggp:Gewaesser:Fluss:Natter", "ein Klick auf die Zeile waehlt sie aus");
gleich(mod.avesmapsGaretienFensterZustand().detailKey, "ggp:Gewaesser:Fluss:Natter",
	"und der Zustand traegt die Auswahl");

// 💣 DER KERN: das Haekchen gehoert Aufgabe 15. Ein Klick darauf darf die Einzelansicht NICHT
// umschalten -- sonst kann ein Editor keine Zeile ansehen, ohne sie im selben Klick anzuhaken
// (genau deshalb ist die Zeile ein <div> und kein <label>, Aufgabe 11 Review M3).
gleich(garetienListeKlick({ target: zielAttrappe("INPUT", "ggp:Wege:Reichsstrasse:Angbarer") }, objekte),
	null, "ein Klick auf das Haekchen waehlt NICHTS aus");
gleich(mod.avesmapsGaretienFensterZustand().detailKey, "ggp:Gewaesser:Fluss:Natter",
	"und die vorher gewaehlte Zeile bleibt stehen -- die Ansicht wechselt nicht");

gleich(garetienListeKlick({ target: zielAttrappe("SPAN", null) }, objekte), null,
	"ein Klick neben jede Zeile waehlt nichts aus");
gleich(garetienListeKlick({ target: null }, objekte), null, "ein Ereignis ohne Ziel faellt durch");

// ---- Das CSS haelt die zwei Fallen, die beim Zeichnen des Mockups gemessen wurden --------------

const cssRoh = fs.readFileSync(path.join(WURZEL, "css/components/garetien-importer.css"), "utf8");
const css = cssRoh.replace(/\/\*[\s\S]*?\*\//g, "");

wahr(/scrollbar-gutter:\s*stable\s+both-edges/.test(css),
	"Ohne `both-edges` nimmt die Bildlaufleiste ihre 15px nur rechts -- gemessen 12 links gegen 27 rechts.");
wahr(/\.gi-seg\s*\{[^}]*display:\s*grid/.test(css),
	"Die Abschnittszeile ist ein Raster, kein Flex -- ein border-box-Kind schrumpft nicht unter seine Polsterung.");

// ⚠️ Die Trennlinien HIER laufen nicht vollflaechig: die Ansicht rollt, und ein negativer
// Seitenrand liefe unter die Bildlaufleiste. `.gi-sec` darf deshalb keinen negativen Rand tragen.
const secBlock = (css.match(/\.gi-sec\s*\{[^}]*\}/) || [""])[0];
wahr(secBlock !== "", "der .gi-sec-Block fehlt -- die Gegenprobe misst sonst eine leere Zeichenkette");
wahr(/border-top:\s*1px solid var\(--color-divider\)/.test(secBlock),
	"gruppiert wird durch TRENNLINIE + Ueberschrift, nicht durch Kaesten");
// 🪤 Die Tokennamen zuerst wegnehmen: `var(--space-2)` traegt selbst zwei Bindestriche, und ein
// nacktes /margin[^;]*-/ schlaegt daran an -- der Test waere von Anfang an rot gewesen und haette
// nach der Ursache in der falschen Datei suchen lassen (hier live aufgetreten).
const secOhneTokens = secBlock.replace(/var\(--[a-z0-9-]+\)/g, "T");
wahr(!/margin[a-z-]*:[^;]*-/.test(secOhneTokens),
	"kein negativer Seitenrand -- er liefe unter die Bildlaufleiste des Rollkastens");

// Das ↗ steht in der geteilten Regel (Bauform aus legal-dialog.css / changelog-dialog.css).
wahr(/\.gi-detail a\[target="_blank"\]::after\s*\{[^}]*content:\s*" ↗"/.test(css),
	"der auswaertige Link bekommt sein ↗ aus der CSS-Regel");

// 💣 Keine Farbe, kein Radius, kein Abstand hartkodiert (AGENTS.md §12). Gemessen wird der NEUE
// Block; die Gegenprobe darunter belegt, dass das Muster ueberhaupt etwas findet.
const neueRegeln = (css.match(/\.gi-(detail|sec|seg|why|bomb)[^{]*\{[^}]*\}/g) || []).join("\n");
wahr(neueRegeln.length > 0, "die Gegenprobe findet die neuen Regeln selbst nicht");
wahr(!/#[0-9a-fA-F]{3,8}\b/.test(neueRegeln), "kein hartkodierter Farbwert im neuen Block");
wahr(!/\brgba?\(/.test(neueRegeln), "kein hartkodiertes rgb()/rgba() im neuen Block");
// Schriftgroessen: keine unter 11px, und keine nackte px-Zahl statt eines Tokens.
const schriftgroessen = neueRegeln.match(/font-size:\s*([^;]+);/g) || [];
wahr(schriftgroessen.length > 0, "die Gegenprobe findet keine einzige font-size im neuen Block");
schriftgroessen.forEach((zeile) => {
	wahr(/var\(--font-size-/.test(zeile), "Schriftgroessen kommen aus Tokens: " + zeile);
});

console.log(`garetien-einzelansicht: ${checks} Pruefungen bestanden.`);
