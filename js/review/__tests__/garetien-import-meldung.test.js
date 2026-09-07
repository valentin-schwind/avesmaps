// Aufgabe 3 des Garetien-Importer-Stage-Umbaus: das Import-Ergebnis in der Statuszeile.
// Brief: .superpowers/sdd/2026-09-06-garetien-importer-stage/task-3-brief.md
//
// Ausfuehren, vom Repo-Wurzelverzeichnis: node js/review/__tests__/garetien-import-meldung.test.js
//
// Geprueft werden die REINEN Funktionen (kein DOM, kein Modulzustand) ueber `require(...).__test`
// -- seit der Prüfrunde 06.09.2026 der EINZIGE Weg dorthin (vorher lagen zwei von vier flach
// daneben; siehe die Erklärung an ihrem Export im Modul).
//
// 🔴 Die VERDRAHTUNG (welche Statuszeile am Ende wirklich steht, was der "Rückgängig"-Link
// sendet) prüft diese Datei NICHT -- das übernimmt garetien-import-verdrahtung.test.js, das die
// beiden Klickverteiler mit einer fetch-Attrappe wirklich ausführt.

"use strict";

const path = require("path");
const fs = require("fs");
const assert = require("assert");

const mod = require(path.resolve(__dirname, "..", "review-garetien-importer.js"));
const {
	garetienImportMeldung, garetienImportFormenText,
	garetienStageNeuIds, garetienOhneFehlgeschlagene,
	AVESMAPS_GARETIEN_JE_FORM_LEER,
} = mod.__test;

let checks = 0;
function wahr(bedingung, warum) {
	assert.ok(bedingung, warum || "");
	checks++;
}
function gleich(ist, soll, warum) {
	assert.strictEqual(ist, soll, warum || "");
	checks++;
}
function tief(ist, soll, warum) {
	assert.deepStrictEqual(ist, soll, warum || "");
	checks++;
}

["garetienImportMeldung", "garetienImportFormenText", "garetienStageNeuIds",
	"garetienOhneFehlgeschlagene", "AVESMAPS_GARETIEN_JE_FORM_LEER",
].forEach(function (name) {
	wahr(mod.__test[name] !== undefined, name + " fehlt in __test");
});

// =================================================================================================
// 1. Voller Erfolg: die Formen stehen da, nicht nur eine Zahl.
// =================================================================================================

let m = garetienImportMeldung({
	applied: 5, fehler: [],
	angelegt_je_form: { path: 3, bach: 2, region: 1, label: 0, location: 0, settlement_place: 1, quelle: 0 },
});
gleich(m.ton, "ok", "voller Erfolg -> Ton ok");
wahr(m.text.includes("5 Objekte importiert"), "die Gesamtzahl steht da: " + m.text);
wahr(m.text.includes("3 Wege (2 Bäche)"), "die Bach-Zahl steht in Klammern beim Weg: " + m.text);
// 🪤 Mutationsprobe (Auftrag, Prüfrunde 06.09.2026): `bach` zusätzlich als eigener Wortschlüssel
// in die Formtafel aufgenommen (die inline-Klammer bleibt daneben stehen) überlebt die
// Zusicherung darüber, weil „3 Wege (2 Bäche)" als TEILSTRING weiter vorkommt -- „Bäche" darf
// deshalb nur EINMAL im Satz stehen, nie ein zweites Mal als eigener, zusätzlicher Posten.
gleich((m.text.match(/Bäche/g) || []).length, 1,
	"„Bäche\" kommt genau einmal vor -- nie ein zweites Mal als eigener Posten neben der Klammer: " + m.text);
wahr(m.text.includes("1 Fläche"), "die Fläche steht da: " + m.text);
wahr(m.text.includes("1 Stätte"), "die Stätte steht da: " + m.text);
wahr(!m.text.includes("0 "), "eine Form mit null wird gar nicht genannt: " + m.text);

// =================================================================================================
// 2. Teilerfolg: der GRUND steht da, nicht nur die Zahl -- und es ist eine WARNUNG.
// =================================================================================================

m = garetienImportMeldung({
	applied: 4,
	fehler: [{ item: 9, grund: 'Aus 1 Punkten laesst sich kein Ziel der Art "path" bauen.' }],
	angelegt_je_form: { path: 4, bach: 0, region: 0, label: 0, location: 0, settlement_place: 0, quelle: 0 },
});
gleich(m.ton, "bad", "ein Teilerfolg ist eine Warnung, keine Erfolgsmeldung");
wahr(m.text.includes("1 von 5 nicht importiert"), "genannt wird n von GESAMT: " + m.text);
wahr(m.text.includes("kein Ziel der Art"), "der Servergrund reist mit, nicht nachgebaut: " + m.text);

// =================================================================================================
// 2b. 🔴 Prüfrunde 06.09.2026, Befund 2 (Koordinator): der Nenner zählt auch die reinen
// Quellen-Ergänzungen -- der Fußknopf erzeugt Mischläufe (angelegt + ergänzt + gescheitert) als
// Normalfall, und der Nenner ist die Zahl, die WIRKLICH versucht wurde.
// =================================================================================================

m = garetienImportMeldung({
	applied: 2,
	fehler: [{ item: 9, grund: "X" }],
	angelegt_je_form: { path: 2, bach: 0, region: 0, label: 0, location: 0, settlement_place: 0, quelle: 1 },
});
wahr(m.text.includes("1 von 4 nicht importiert"),
	"🔴 der Nenner ist angelegt(2) + quellen(1) + fehler(1) = 4, NICHT angelegt + fehler = 3: " + m.text);

// =================================================================================================
// 3. Nichts durchgekommen: die Zeile besteht NUR aus dem Fehlschlag.
// =================================================================================================
//
// 🔴 Prüfrunde 06.09.2026, Befund 7 (Koordinator): `!m.text.includes("importiert —")` allein ist
// wertlos -- sie hält auch, wenn der `angelegt > 0`-Riegel in garetienImportMeldung komplett
// entfernt wird (dann stünde "✓ 0 Objekte importiert" da, ohne "—", weil `formen` bei lauter
// Nullen leer bleibt). Der exakte Vergleich prüft wirklich, dass NICHTS Erfundenes davorsteht.

m = garetienImportMeldung({
	applied: 0, fehler: [{ item: 9, grund: "X" }],
	angelegt_je_form: { path: 0, bach: 0, region: 0, label: 0, location: 0, settlement_place: 0, quelle: 0 },
});
gleich(m.ton, "bad", "nichts angelegt, aber ein Fehlschlag -> bad");
gleich(m.text, "✕ 1 von 1 nicht importiert: X",
	'🔴 die Zeile besteht NUR aus dem Fehlschlag -- kein „0 Objekte importiert" davor');

// =================================================================================================
// 4. Eine reine Quellen-Ergänzung ist KEIN angelegtes Objekt und wird EIGENS genannt.
// =================================================================================================

m = garetienImportMeldung({
	applied: 0, fehler: [],
	angelegt_je_form: { path: 0, bach: 0, region: 0, label: 0, location: 0, settlement_place: 0, quelle: 3 },
});
gleich(m.ton, "ok", "eine reine Ergänzung ohne Fehler bleibt ein Erfolg");
wahr(m.text.includes("3 Quellen ergänzt"), "die Quellen-Ergänzung steht für sich: " + m.text);
wahr(!m.text.includes("Objekte importiert"),
	"🔴 KEIN erfundenes Kartenobjekt -- eine reine Ergänzung zählt nicht in `applied`: " + m.text);

// =================================================================================================
// 5. Rand: gar nichts zu tun -- weder Erfolg noch Fehlschlag.
// =================================================================================================

m = garetienImportMeldung({ applied: 0, fehler: [], angelegt_je_form: {} });
gleich(m.ton, "", "kein Erfolg, kein Fehler -> neutraler Ton, keine gruene ODER rote Faerbung");
gleich(m.text, "Es war nichts zu importieren.", "der leere Rand bekommt einen eigenen Satz");

// =================================================================================================
// 6. 🔴 Prüfrunde 06.09.2026, Befund 3 (Koordinator): die zwei reinen Helfer hinter dem
// „Rückgängig"-Link -- sie entscheiden, WAS gelöscht werden darf, und hatten bislang KEINE
// Zusicherung.
// =================================================================================================

const objektNeu = { key: "n:1", items: [{ id: 701, change_type: "new", selected: 0 }] };
const objektGeaendert = {
	key: "c:1",
	items: [{ id: 702, anlass: "ergaenzung", felder: ["quelle"], change_type: "changed", selected: 0 }],
};
const objektGeometrie = {
	key: "g:1",
	items: [{ id: 703, anlass: "geometrie", change_type: "new", selected: 0 }],
};
const objektZusatz = {
	key: "z:1",
	items: [{ id: 704, anlass: "zusatz", felder: [], change_type: "new", selected: 0 }],
};

tief(garetienStageNeuIds([objektNeu]), [701], "ein 'new'-Item zählt");
tief(garetienStageNeuIds([objektGeaendert]), [],
	"🔴 ein 'changed'-Item (Ergänzung an einem BESTEHENDEN Objekt) zählt NIE -- es hat kein "
	+ "neues Kartenobjekt angelegt");
tief(garetienStageNeuIds([objektGeometrie]), [],
	"das Geometrie-Item bleibt draußen -- garetienHakenItems schließt es aus");
// 🔴 FIXRUNDE 1 (B3, 07.09.2026) HAT DIESE ZUSICHERUNG UMGEDREHT. Bis dahin stand hier „und
// ebenso das Zusatz-Item ('trotzdem neu anlegen')" mit `[]` -- richtig, solange „Neu einfügen" der
// EINZIGE Weg zu diesem Item war und der Stage-Import es nie anlegte. Seit dem Wegfall dieses
// Knopfes traegt die STAGE es (garetienStageVorhaben === "zusatz"), und dann MUSS es hier
// auftauchen: `garetienStageNeuIds` speist „Rückgängig" nach dem Einfügen -- fehlte es, staende das
// gerade angelegte Objekt auf der Karte OHNE Rueckweg.
tief(garetienStageNeuIds([objektZusatz]), [704],
	"🔴 das Zusatz-Item zaehlt, WENN es der einzige Weg nach vorn ist -- sonst gaebe es fuer das "
	+ "angelegte Objekt kein „Rückgängig\"");
// ⚠️ Die GEGENPROBE: traegt dasselbe Objekt daneben ein legitimes Item, bleibt das Zusatz-Item
// draussen -- sonst legte ein Import Ergaenzung UND Dublette an (Schadensfall 30.08.2026).
tief(garetienStageNeuIds([{ key: "z:2", items: [
	{ id: 711, anlass: "ergaenzung", felder: ["quelle"], change_type: "changed", selected: 0 },
	{ id: 712, anlass: "zusatz", felder: [], change_type: "new", selected: 0 },
] }]), [],
	"💣 gemischtes Objekt: das Zusatz-Item bleibt draussen, und das 'changed'-Item ist kein 'new'");
tief(garetienStageNeuIds([objektNeu, objektGeaendert]), [701], "gemischt: nur das new-Item zählt");
tief(garetienStageNeuIds([]), [], "leere Anzeige -> leere Liste");
tief(garetienStageNeuIds(null), [], "ohne Anzeige -> leere Liste, kein Wurf");

tief(garetienOhneFehlgeschlagene([701, 702, 703], []), [701, 702, 703], "ohne Fehler bleibt alles");
tief(garetienOhneFehlgeschlagene([701, 702, 703], [{ item: 702, grund: "X" }]), [701, 703],
	'🔴 ein gemeldeter Fehlschlag fällt HERAUS -- er wurde nicht angelegt und darf nicht über '
	+ '„Rückgängig" angeboten werden');
tief(garetienOhneFehlgeschlagene([701], [{ item: 701, grund: "X" }]), [],
	"alle gescheitert -> leere Liste");
tief(garetienOhneFehlgeschlagene([701], null), [701], "ohne Fehlerliste bleibt alles (kein Wurf)");
tief(garetienOhneFehlgeschlagene(null, []), [], "ohne ids -> leere Liste");

// =================================================================================================
// 7. 🔴 Prüfrunde 06.09.2026, Befund 6 (Koordinator): die sieben Formschlüssel stehen doppelt --
// einmal in dieser Datei, einmal serverseitig in garetien-uebernahme.php. Ein neuer Serverschlüssel
// würde von garetienEinfuegenAusfuehren still verschluckt (die Summierung läuft über die
// JS-Schlüssel). Diese Zusicherung hält beide Listen gegeneinander.
// =================================================================================================

const uebernahmePhp = fs.readFileSync(
	path.resolve(__dirname, "..", "..", "..", "api", "_internal", "import", "garetien-uebernahme.php"),
	"utf8"
).replace(/\r\n/g, "\n");
const phpKonstante = uebernahmePhp.match(
	/const AVESMAPS_GARETIEN_JE_FORM_LEER = \[([\s\S]*?)\];/
);
wahr(phpKonstante !== null, "AVESMAPS_GARETIEN_JE_FORM_LEER wird in garetien-uebernahme.php gefunden");
const phpSchluessel = (phpKonstante[1].match(/'([a-z_]+)'\s*=>/g) || [])
	.map(function (stueck) { return stueck.match(/'([a-z_]+)'/)[1]; })
	.sort();
const jsSchluessel = Object.keys(AVESMAPS_GARETIEN_JE_FORM_LEER).sort();
tief(jsSchluessel, phpSchluessel,
	"🔴 die sieben Formschlüssel stimmen ZEICHENGLEICH überein -- ein neuer Schlüssel auf einer "
	+ "Seite ohne die andere wäre eine stille Lücke: " + jsSchluessel + " vs " + phpSchluessel);

console.log(`garetien-import-meldung ok -- ${checks} Zusicherungen`);
