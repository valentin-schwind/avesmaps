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
	"ein vorhandener Name „fehlt\" nicht -- er wuerde ersetzt");
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
wahr(luecke.includes("Name + Quelle"), "kein Name + keine Quelle heisst „Name + Quelle\"");
wahr(/gi-seg__name is-empty[^>]*>ohne Namen/.test(luecke),
	"ein namenloser Abschnitt heisst „ohne Namen\" und traegt is-empty");
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
	"ohne 'name' in `felder` darf kein „→ neuer Name\" dastehen");

// Die fuenfte erreichbare Beschriftung, und sie fehlte: `felder: ['name']` OHNE 'quelle'.
// Erreichbar ueber garetien-plan.php (`$nameLeer && $hatQuelle`) -- die Quelle liegt schon an
// unserem Abschnitt, nur der Name fehlt. Bis zur Fixrunde stand sie nur NEGATIV im Test
// (`!m2.includes("Name fehlt")`), also nirgends als eigener Fall.
const nurName = segFall({ public_id: "w-2b", name: "", punkte: 4 },
	[{ id: 3, anlass: "ergaenzung", felder: ["name"], selected: 1,
		abschnitt: { public_id: "w-2b", name: "" } }]);
wahr(nurName.includes("Name fehlt"), "liegt die Quelle schon, fehlt nur der Name");
wahr(!nurName.includes("Name + Quelle"),
	"und dann steht NICHT „Name + Quelle\" da -- die Quelle waere sonst doppelt versprochen");
wahr(nurName.includes("gi-seg__to"),
	"ein Namens-Item zeigt sein „→ neuer Name\", auch ohne Quelle");

const nichts = segFall({ public_id: "w-3", name: "Gardel", punkte: 6 }, []);
wahr(nichts.includes("nichts zu ersetzen"), "ein Abschnitt ohne Item sagt „nichts zu ersetzen\"");
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
	"bei einem einzigen Objekt steht auch keine „verschiedene\"-Zahl in der Ueberschrift");
wahr(einObjekt.includes("1 Abschnitt<") || /1 Abschnitt[^e]/.test(einObjekt),
	"Einzahl: „1 Abschnitt\", nicht „1 Abschnitte\"");

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
// 🔴 Fuenf-Punkte-Brief 30.08.2026, Punkt 4: die Typ-Zuordnung steht NICHT mehr im Kopf -- sie
// steht weiterhin, wortgleich, im Kasten „Eingefügt wird" (siehe garetien-eingefuegt-wird.test.js).
wahr(!markup.includes("gi-detail__kind"), "die Typ-Zuordnung ist aus dem Kopf entfernt, keine leere Huelle");
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
	"das ↗ gehoert in die CSS-Regel, nicht ins Markup (AGENTS.md §12: „automatisch\")");
// Ohne Adresse gar kein Link -- ein <a href=""> fuehrt auf die Karte zurueck und wirft den Editor
// aus dem Fenster.
wahr(!/<a /.test(garetienDetailMarkup(Object.assign({}, natter, { wiki_url: "" }))),
	"ohne wiki_url steht kein leerer Link da");

// ---- Der Grund: er kommt fertig vom Server, und eine leere Ueberschrift kommt gar nicht --------

wahr(markup.includes('Geometrie liegt 0.84 Einheiten von &quot;Natter&quot; (anderer Name)'),
	"der Grund steht im Klartext da -- escaped, aber ungekuerzt");
wahr(markup.includes("Der Grund"), "die Ueberschrift „Der Grund\" steht da, wenn es einen gibt");
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

// ---- Aufgabe 13b: die Felder, die der Server seit dem 28.08.2026 mitschickt -------------------
//
// 🔴 Alle SECHS kommen fertig aus `action:'liste'`. Der Browser leitet keins davon her -- weder
// die Lizenzform aus dem Wiki-Kuerzel noch den Artikelnamen aus der Adresse noch den Nenner aus
// `objekt.geometrie`. Genau diese drei Ableitungen waeren zweite Fassungen (Auftrag §5.4).

const { garetienTypText, garetienPunkteText, garetienQuellenMarkup } = mod;

const voll = {
	key: "ggp:Gewaesser:Fluss:Garetien:Natter", name: "Natter", typ: "Fluss", subtyp: "Flussweg",
	seite: "Garetien:Natter", urteil: "ergaenzung", grund: "Geometrie deckt sich",
	wiki: "ggp", ebene: "Gewaesser", lodmin: "5", lodmax: "14", extra: "",
	wiki_url: "https://www.garetien.de/index.php?title=Garetien:Natter",
	quelle: { label: "Briefspiel (Garetien)", attribution: "VolkoV / garetien.de",
		license: "cc-by-nc-sa-3.0", source_type: "briefspiel" },
	deckung: 0.84, probepunkte: 16,
	geometrie: new Array(294).fill([0, 0]),
	abschnitte: [
		{ public_id: "w-4471", name: "Natter", punkte: 9, name_gleich: true },
		{ public_id: "w-5008", name: "Gardel", punkte: 6, name_gleich: false },
	],
	// 🔴 „Eingefügt wird" (30.08.2026): ZWEI Items, wie ein echter 'ergaenzung'-Fall sie heute
	// traegt (avesmapsGaretienErgaenzungsEintraege haengt IMMER ein Zusatz-Item an, sobald
	// ueberhaupt ein Abschnitt getroffen wurde -- ein 'ergaenzung'-Objekt OHNE Zusatz-Item kommt
	// in der Produktion gar nicht vor). Ohne das Zusatz-Item (change_type 'new') zeigte diese
	// Fixture "Eingefügt wird" gar nicht, und der Test unten prüfte eine Stelle, die es fuer ein
	// echtes 'ergaenzung'-Objekt nie gibt.
	items: [
		{ id: 11, anlass: "ergaenzung", felder: ["quelle"], change_type: "changed", selected: 1,
			abschnitt: { public_id: "w-4471", name: "Natter" } },
		{ id: 12, anlass: "zusatz", change_type: "new", selected: 0 },
	],
};
const mv = garetienDetailMarkup(voll);

// 1. Der Kopf sagt, als WAS wir es anlegen wuerden -- UND wessen Vokabular welche Seite spricht
// (Owner-Meldung 30.08.2026: bei "Gebirge → gebirge" sieht man dem Pfeil sonst nicht an, was
// welche Seite meint).
wahr(mv.includes("Fluss (garetien.de) → Flussweg (Avesmaps)"),
	"der Kopf nennt ihren Typ samt IHRER Quelle UND unseren Zielsubtyp samt UNSEREM Namen -- sonst "
	+ "steht nicht da, was entstuende, und nicht, wessen Vokabular welche Seite spricht");
gleich(garetienTypText({ typ: "Fluss", subtyp: "" }), "Fluss",
	"ohne Zielsubtyp faellt der Pfeil weg, statt ins Leere zu zeigen -- und ohne Pfeil auch keine "
	+ "Klammer: ein leeres \"(Avesmaps)\" darf nie stehenbleiben");
gleich(garetienTypText({ typ: "See", subtyp: "See" }), "See",
	"gleicher Typ auf beiden Seiten wird nicht doppelt geschrieben, auch nicht mit Klammern");
// Die Quelle ist NICHT immer "Garetien": kosch-Objekte tragen koschwiki.de, sonst stuende bei
// jedem von ihnen die falsche Quelle da (Owner-Meldung 30.08.2026).
gleich(garetienTypText({ typ: "Gebirge", subtyp: "gebirge", wiki: "kosch" }),
	"Gebirge (koschwiki.de) → gebirge (Avesmaps)",
	"koschwiki.de-Objekte tragen ihre EIGENE Quelle, nicht ein festgeschriebenes \"Garetien\"");
gleich(garetienTypText({ typ: "Gebirge", subtyp: "gebirge", wiki: "ggp" }),
	"Gebirge (garetien.de) → gebirge (Avesmaps)",
	"…und ggp-Objekte ihre -- derselbe Wechsel wie bei Fluss/Natter oben, nur mit einem Buchstaben "
	+ "Unterschied zwischen ihrem Typ und unserem Zielsubtyp");

// 2. Der Link traegt den ARTIKELNAMEN, nicht das Wort „Wiki-Artikel".
wahr(/>Garetien:Natter<\/a>/.test(mv), "der auswaertige Link heisst wie der Artikel");
wahr(!garetienDetailMarkup(voll).includes(">Wiki-Artikel<"),
	"mit Artikelnamen darf das allgemeine Wort nicht mehr dastehen");
// Gegenprobe: OHNE `seite` bleibt das allgemeine Wort -- ein Link ohne Beschriftung waere
// schlechter als ein allgemeiner (alter Lauf, Sammelquelle ohne Artikel).
wahr(garetienDetailMarkup(Object.assign({}, voll, { seite: "" })).includes(">Wiki-Artikel<"),
	"ohne Artikelnamen faellt der Link auf das allgemeine Wort zurueck");

// 3. Der Deckungsgrad in der Notiz -- vom Server, in Hausform mit Komma.
wahr(mv.includes("Deckung Median 0,84"), "der Deckungsgrad steht unter der Ueberschrift");
// 🪤 `null` heisst „nicht gemessen" und ist NICHT dasselbe wie 0. Beide Faelle einzeln, sonst
// belegt die Zeile darueber nur, dass irgendein Text durchkommt.
wahr(!garetienDetailMarkup(Object.assign({}, voll, { deckung: null })).includes("Deckung Median"),
	"ohne gemessene Deckung faellt die Angabe weg statt 0,00 zu behaupten");
wahr(garetienDetailMarkup(Object.assign({}, voll, { deckung: 0 })).includes("Deckung Median 0,00"),
	"eine Deckung von 0 ist eine Auskunft (liegt genau darauf) und muss dastehen");

// 4. 💣 DER NENNER KOMMT VOM SERVER, NICHT AUS `objekt.geometrie`. Diese Fixture traegt
// ABSICHTLICH 294 Stuetzpunkte bei 16 Probepunkten -- genau die Spanne ihres Grossen Flusses.
// ⚠️ Die 294 ist eine ABSCHRIFT der Messung im Kopf von avesmapsGaretienDeckung
// (api/_internal/import/garetien-abgleich.php, live gemessen 27.08.2026), keine eigene Messung.
// Fuer diesen Test traegt sie nichts als "deutlich mehr als 16" -- jede groessere Zahl taete es.
// Ein Browser, der `geometrie.length` ablaese, schriebe „9 von 294".
wahr(mv.includes("9 von 16 Punkten"), "die Punktzahl nennt Zaehler UND Nenner");
wahr(!mv.includes("294"), "der Nenner darf NICHT ihre Stuetzpunktzahl sein");
gleich(garetienPunkteText(9, 0), "9 Punkte",
	"ohne bekannten Nenner steht die nackte Zahl da (Mockup §6a), keine erfundene");
gleich(garetienPunkteText(1, 0), "1 Punkt", "und die Einzahl bleibt Einzahl");

// 5. Der Vergleichsbefund je Abschnitt -- NUR bei `true`.
wahr(/w-4471[\s\S]{0,200}Name gleich/.test(mv), "der Abschnitt mit gleichem Namen sagt es");
// 🪤 Eine Zusicherung „hinter w-5008 steht es NICHT" waere hier wertlos: der einzige Treffer
// steht ohnehin DAVOR, sie waere durch die Reihenfolge wahr und nicht durch die Regel. Gezaehlt
// wird deshalb -- GENAU EINE der beiden Zeilen traegt den Befund.
gleich((mv.match(/Name gleich/g) || []).length, 1,
	"genau EIN Abschnitt traegt den Namensbefund -- der Gardel heisst anders");
wahr(!garetienDetailMarkup(Object.assign({}, voll, {
	abschnitte: [{ public_id: "w-4471", name: "Natter", punkte: 9 }],
})).includes("Name gleich"),
	"ein fehlendes Feld (alter Lauf) ist keine Auskunft und erfindet keine");

// 5b. DIE KAPPUNG WIRD GENANNT (30.08.2026, Ringstruktur). Der Server schickt hoechstens
// AVESMAPS_GARETIEN_ABSCHNITT_TEILE Teile einer mehrteiligen Flaeche mit; was er weglaesst, steht
// als Zahl am Abschnitt. AGENTS.md §9: eine stille Kappung liest sich wie „das ist alles".
const mitKappung = garetienDetailMarkup(Object.assign({}, voll, {
	abschnitte: [{ public_id: "w-4471", name: "Natter", punkte: 9, verworfene_teile: 4 }],
}));
wahr(/w-4471[\s\S]{0,300}4 Teile nicht gezeichnet/.test(mitKappung),
	"ein gekappter Abschnitt sagt, wie viele Teile fehlen: " + mitKappung.slice(0, 400));
// 🪤 Die zwei Gegenproben, ohne die die Zeile darueber Vakuum waere: 0 ist die Regel und stuende
// sonst an fast jeder Zeile, und ein fehlendes Feld (alter Lauf) ist ueberhaupt keine Auskunft.
wahr(!garetienDetailMarkup(Object.assign({}, voll, {
	abschnitte: [{ public_id: "w-4471", name: "Natter", punkte: 9, verworfene_teile: 0 }],
})).includes("nicht gezeichnet"),
	"ohne Kappung steht nichts da -- 0 ist der Normalfall");
wahr(!garetienDetailMarkup(Object.assign({}, voll, {
	abschnitte: [{ public_id: "w-4471", name: "Natter", punkte: 9 }],
})).includes("nicht gezeichnet"),
	"und ein alter Lauf ohne das Feld erfindet keine Kappung");
// Einzahl bleibt Einzahl -- dieselbe Sorgfalt wie bei „1 Punkt" darueber.
wahr(garetienDetailMarkup(Object.assign({}, voll, {
	abschnitte: [{ public_id: "w-4471", name: "Natter", punkte: 9, verworfene_teile: 1 }],
})).includes("1 Teil nicht gezeichnet"), "ein einzelnes Teil steht in der Einzahl da");

// 6. Der Abschnitt „Die Quelle, die mitreist" -- Mockup §3.
wahr(mv.includes("Die Quelle, die mitreist"), "der Quellenabschnitt fehlt");
wahr(mv.includes("Briefspiel (Garetien)") && mv.includes("VolkoV / garetien.de"),
	"Beschriftung und Namensnennung stehen da");
// 💣 Die LIZENZFORM kommt aus js/ui/feature-source-markup.js -- der einen Stelle, an der ein
// Schluessel zu seiner Beschriftung wird. Der Schluessel selbst darf NICHT im Text stehen.
wahr(mv.includes("CC BY-NC-SA 3.0"), "die Lizenz steht in ihrer Hausbeschriftung");
wahr(!mv.includes("cc-by-nc-sa-3.0"), "der rohe Lizenzschluessel gehoert nicht in die Anzeige");
// Und zur LAUFZEIT belegt, dass wirklich die geteilte Fassung ruft: wird sie ersetzt, aendert
// sich die Anzeige. Ohne diese Probe waere „die Datei ist eingebunden" erfuellt, auch wenn
// niemand sie ruft (dieselbe Zusicherung wie in quellen-kuerzung-eine-quelle.test.js).
const geteilteQuelle = require(path.resolve(WURZEL, "js/ui/feature-source-markup.js"));
const echt = geteilteQuelle.featureSourceLicenseText;
geteilteQuelle.featureSourceLicenseText = () => ({ text: "SPION", url: "" });
wahr(garetienDetailMarkup(voll).includes("SPION"),
	"die Lizenzangabe wird wirklich aus feature-source-markup.js geholt, nicht hier nachgebaut");
geteilteQuelle.featureSourceLicenseText = echt;
wahr(garetienDetailMarkup(voll).includes("CC BY-NC-SA 3.0"), "und der Spion ist wieder abgeraeumt");
// 💣 UND DIE REIHENFOLGE IN index.html IST TRAGEND. Der Weiterreicher wirft LAUT, wenn die
// geteilte Datei fehlt -- und der Wurf reisst die GANZE Einzelansicht mit (live gemessen: der Kopf
// blieb leer, die Auswahl war gesetzt, die Konsole nannte den Grund). Dieselbe Reihenfolgezusage,
// die die fuenf Seiten mit dem Quellen-Editor schon tragen (AGENTS.md §11, Quellenliste).
// ⚠️ Zeilenendenneutral: die Arbeitskopie traegt CRLF, im Tor liegt LF (AGENTS.md §9).
const indexHtml = fs.readFileSync(path.join(WURZEL, "index.html"), "utf8").replace(/\r\n/g, "\n");
// 🪤 MIT `src="` gesucht, nicht nur nach dem Dateinamen: sonst erfuellte schon ein Kommentar,
// der die Datei erwaehnt, die Zusicherung -- und das `<script>` koennte fehlen. Der Anker fuer
// den Importer darunter macht es mit dem Anfuehrungszeichen schon richtig.
const posMarkup = indexHtml.indexOf('src="js/ui/feature-source-markup.js"');
const posImporter = indexHtml.indexOf("js/review/review-garetien-importer.js\"");
wahr(posMarkup > -1 && posImporter > -1,
	"die Gegenprobe findet eines der beiden Skripte in index.html selbst nicht mehr");
wahr(posMarkup < posImporter,
	"feature-source-markup.js muss VOR review-garetien-importer.js stehen -- sonst wirft die "
	+ "Einzelansicht beim ersten Klick und bleibt leer");

// ⚠️ Ohne Quelle faellt der GANZE Abschnitt weg -- eine Ueberschrift ueber nichts ist keine
// Auskunft (item-lose Objekte tragen keine Quelle).
// 💣 UND DER LAUTE WURF IST DIE ZUSICHERUNG, nicht nur eine Vorsichtsmassnahme. Ein spaeterer,
// "defensiver" Rueckfall (`|| (() => ({ text: "", url: "" }))`) waere im ganzen Feld GRUEN und
// liesse die Lizenzzeile still verschwinden -- niemand saehe, dass die geteilte Datei fehlt, nur
// dass es keine Lizenz gibt. Genau die Bauform, die AGENTS.md §11 fuer die Quellenliste verbietet.
// ⚠️ Gemessen wird der ABLAUF: die geteilte Funktion wird weggenommen, und der Aufruf MUSS werfen.
const ohneDatei = geteilteQuelle.featureSourceLicenseText;
delete geteilteQuelle.featureSourceLicenseText;
let geworfen = null;
try { garetienDetailMarkup(voll); } catch (fehler) { geworfen = String(fehler.message || fehler); }
geteilteQuelle.featureSourceLicenseText = ohneDatei;
wahr(geworfen !== null,
	"fehlt feature-source-markup.js, MUSS es einen lauten Fehler geben -- ein stiller Rueckfall"
	+ " liesse die Lizenzzeile verschwinden, ohne dass es jemand merkt");
wahr(/feature-source-markup/.test(geworfen || ""),
	"und der Fehler muss die fehlende Datei NENNEN, sonst sucht der naechste Leser an der falschen"
	+ " Stelle: " + geworfen);
wahr(garetienDetailMarkup(voll).includes("CC BY-NC-SA 3.0"),
	"und nach dem Zuruecklegen baut die Ansicht wieder normal");
gleich(garetienQuellenMarkup({ quelle: {} }), "", "ohne Quelle gibt es den Abschnitt nicht");
wahr(!garetienDetailMarkup(natter).includes("Die Quelle, die mitreist"),
	"ein Objekt ohne Quellenfeld zeigt den Abschnitt nicht");

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

// 💣 DER KOPF IST EIN FLEX-KIND, und ein Flex-Kind traegt `min-width: auto` -- es schrumpft nie
// unter seine min-content-Breite. `overflow-wrap: break-word` senkt diese Breite NICHT (das tun
// nur `anywhere` und `word-break`), der Bruch kam also gar nicht zustande: live gemessen stand ein
// 54-Zeichen-Kompositum EINZEILIG mit 428px in einem 344px-Kasten, 147px waagerechter Ueberlauf.
// ⚠️ DIESE ZUSICHERUNG IST NICHT DER BELEG -- Node hat keine Layoutmaschine, sie kann nur die
// Deklaration sehen. Der Beleg ist die Messung im Bericht (Fixrunde 1: 428px/1 Zeile/147px Ueberlauf
// ohne, 267px/2 Zeilen/0 mit). Sie steht hier, damit die Zeile nicht wieder verschwindet.
const nameBlock = (css.match(/\.gi-detail__name\s*\{[^}]*\}/) || [""])[0];
wahr(nameBlock !== "", "der .gi-detail__name-Block fehlt -- die Gegenprobe misst sonst nichts");
wahr(/min-width:\s*0/.test(nameBlock),
	"ohne `min-width: 0` bricht der Kopf NICHT -- overflow-wrap allein reicht am Flex-Kind nicht");

// Dieselbe Familie eine Etage tiefer: die Zellen der Abschnittszeile. Ohne einen Umbruchwert lief
// ein unteilbarer 70-Zeichen-Bezeichner um 105px ueber (live gemessen).
// ⚠️ `anywhere`, nicht `break-word`: gemessen heilen hier BEIDE, weil `minmax(0, 1fr)` den Track
// schon deckelt -- aber nur `anywhere` senkt die min-content-Breite und haengt damit nicht daran,
// dass der Deckel bleibt. Genau diese Abhaengigkeit war der Fehler eine Etage hoeher.
// 🪤 Zwei ausgeschriebene Muster statt eines gebauten: `new RegExp("\s*")` liest die
// Zeichenkette ZUERST als JS-Literal, dort ist `\s` schlicht `s` -- das Muster traf dann nichts
// und meldete „Block fehlt" (hier live passiert).
// 💣 Und dieselbe Familie eine Etage HOEHER, seit Aufgabe 13b: in `.gi-why` steht jetzt auch die
// NAMENSNENNUNG der Quelle, und die ist ein Datenwert (`sources.attribution`), kein Satz. Live
// gemessen mit 83 Zeichen ohne Leerzeichen: OHNE `overflow-wrap` lief die Ansicht 139px waagerecht
// ueber, MIT `anywhere` 0 (und die Zeile wuchs von 28 auf 55px, statt auszubrechen).
[[".gi-seg__name", /\.gi-seg__name\s*\{[^}]*\}/], [".gi-seg__id", /\.gi-seg__id\s*\{[^}]*\}/],
	[".gi-why", /\.gi-why\s*\{[^}]*\}/]]
	.forEach(([auswahl, muster]) => {
		const block = (css.match(muster) || [""])[0];
		wahr(block !== "", "der " + auswahl + "-Block fehlt -- die Gegenprobe misst sonst nichts");
		wahr(/overflow-wrap:\s*anywhere/.test(block),
			auswahl + " braucht `anywhere`, sonst laeuft ein unteilbarer Bezeichner aus der Zeile");
	});

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


// ---- Das ANGEKLICKTE Objekt liegt auf der Karte, auch OHNE Haekchen UND OHNE Anzeige -----------
//
// 🔴 Owner-Meldung 29.08.2026 am Beispiel „Perz": „ich seh nur UNSER perz, das perz von
// garetien.de seh ich nicht, wenn ich auf karte anzeigen klicke".
// 💣 Die Ursache war ein Fehler des AUFTRAGS, nicht des Baus: der Brief zu Aufgabe 14 band IHRE
// gestrichelte Geometrie ans HAEKCHEN. Das freigegebene Mockup §2 nennt beide Faelle nebeneinander:
//   „Natter -- das ANGEKLICKTE Objekt: gestrichelt, benannt, die Ansicht folgt ihm."
//   „Alke -- angehakt, aber nicht angeklickt: gestrichelt, ohne Namensschild."
// ⚠️ Und die Folge traf den HAEUFIGSTEN Fall: ein uebersprungenes Objekt hat gar kein Haekchen --
// 7930 von 8213 sind uebersprungen. Seine Geometrie war auf KEINE Weise sichtbar zu machen.
//
// 🔴 Aufgabe 2 (Entwurf §3): die Karte zeigt seither die ANZEIGE-MENGE, nicht mehr das
// „angehakte" -- `avesmapsGaretienAufDerKarte` liest `items[].selected` gar nicht mehr (das war
// der zweite Konstruktionsfehler: 7930 von 8213 Objekten haben ueberhaupt kein Item). Dieser Block
// misst deshalb gegen `avesmapsGaretienAnzeigeHinzufuegen`/`-Leeren`, nicht mehr gegen ein
// `selected: 1`-Item.
wahr(typeof mod.avesmapsGaretienAufDerKarte === "function",
	"avesmapsGaretienAufDerKarte fehlt im Export");
checks++;

const perz = { key: "perz", name: "Perz", typ: "Stadt", urteil: "uebersprungen",
	grund: "Sammelartikel", geometrie: [[512, 480]], abschnitte: [], items: [] };
const inAnzeige = { key: "inAnzeige", name: "Alke", typ: "Bach", urteil: "neu",
	geometrie: [[100, 200], [110, 210]], abschnitte: [], items: [] };
const kartenObjekte = [perz, inAnzeige];

// Vorher: die Anzeige-Menge traegt genau EIN Objekt, keine Zeile ist angeklickt.
mod.avesmapsGaretienAnzeigeLeeren();
mod.avesmapsGaretienAnzeigeHinzufuegen([inAnzeige]);
mod.garetienDetailWaehlen(null, kartenObjekte);
gleich(mod.avesmapsGaretienAufDerKarte(kartenObjekte).map((o) => o.key).join(","), "inAnzeige",
	"ohne angeklickte Zeile liegt genau die ANZEIGE-MENGE auf der Karte");
checks++;

// Jetzt Perz anklicken -- es liegt WEDER in der Anzeige NOCH hat es ein Item, und trotzdem muss
// es dabei sein.
garetienListeKlick({ target: zielAttrappe("SPAN", "perz") }, kartenObjekte);
const nachKlick = mod.avesmapsGaretienAufDerKarte(kartenObjekte).map((o) => o.key);
wahr(nachKlick.indexOf("perz") !== -1,
	"das ANGEKLICKTE Objekt gehoert auf die Karte, auch wenn es weder ein Haekchen noch einen "
	+ "Platz in der Anzeige-Menge hat -- sonst ist ein uebersprungenes Objekt (7930 von 8213) auf "
	+ "keine Weise sichtbar");
checks++;

// 🔴 DIE GEGENPROBE, ohne die die Zeile darueber nichts filtert: ein NICHT angeklicktes und NICHT
// in der Anzeige liegendes Objekt bleibt draussen -- auch wenn es (anders als bisher) wirklich in
// der uebergebenen Liste steht.
const drittes = { key: "drittes", name: "Fern", urteil: "uebersprungen", geometrie: [[1, 1]], abschnitte: [], items: [] };
gleich(mod.avesmapsGaretienAufDerKarte([perz, inAnzeige, drittes]).map((o) => o.key).indexOf("drittes"), -1,
	"ein weder angeklicktes noch in der Anzeige liegendes Objekt bleibt von der Karte weg");
checks++;

// ⚠️ Und es wird nicht DOPPELT gezeichnet, wenn das Angeklickte auch schon in der Anzeige liegt.
garetienListeKlick({ target: zielAttrappe("SPAN", "inAnzeige") }, kartenObjekte);
const doppelt = mod.avesmapsGaretienAufDerKarte(kartenObjekte).map((o) => o.key);
gleich(doppelt.filter((k) => k === "inAnzeige").length, 1,
	"das angeklickte UND bereits in der Anzeige liegende Objekt steht genau einmal auf der Karte");
checks++;

mod.avesmapsGaretienAnzeigeLeeren();

console.log(`garetien-einzelansicht: ${checks} Pruefungen bestanden.`);
