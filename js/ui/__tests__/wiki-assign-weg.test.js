// Der Weg als erste Objektart mit SERVER-Suche und ZWEI Oberflaechen (Aufgabe 4).
//
// 🔴 Drei Dinge werden hier festgenagelt, und jedes davon ist einmal danebengegangen oder haette
// es koennen:
//   1. `laden` LEHNT AB, statt etwas Leeres zu liefern -- der Vertrag aus dem Kopf von
//      js/ui/wiki-assign.js. Beim Weg traefe die stille Loeschung ALLE gleichnamigen Segmente.
//   2. Der Server sagt sein Nein zum Typriegel mit HTTP 200 und `type_ok:false`. Wer nur `ok`
//      prueft, malt eine Zuweisung, die es nicht gibt.
//   3. Die Wiki-Art ist freier Text, `feature_subtype` ein Schluessel. Roh verglichen meldete die
//      Sync-Vorschau bei JEDEM Weg einen Unterschied und boete an, freien Text hineinzuschreiben.
//
// Run: node js/ui/__tests__/wiki-assign-weg.test.js
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const { AVESMAPS_WIKI_ASSIGN_REGISTRY } = require("../wiki-assign-registry.js");
const { avesmapsWikiAssignDiff } = require("../wiki-assign-diff.js");
const {
	AVESMAPS_WIKI_ASSIGN_SKINS,
	avesmapsWikiAssignSkin,
	avesmapsWikiAssignModell,
	avesmapsWikiAssignMarkup,
	avesmapsWikiAssignTrefferMeta,
	avesmapsWikiAssignTrefferAusZeile,
	avesmapsWikiAssignMount,
} = require("../wiki-assign.js");
const {
	avesmapsWikiAssignWegKindLabel,
	avesmapsWikiAssignWegWegtyp,
	avesmapsWikiAssignWegKanonischerName,
	avesmapsWikiAssignWegTreffer,
	avesmapsWikiAssignWegArtikel,
	avesmapsWikiAssignWegZustand,
	avesmapsWikiAssignWegZuweisungsKoerper,
	avesmapsWikiAssignWegAntwortPruefen,
	avesmapsWikiAssignWegSyncWegtyp,
} = require("../wiki-assign-weg.js");

// Im Browser sind das Globale, die die drei `<script>`-Zeilen anlegen; `avesmapsWikiAssignMount`
// prueft BEIDE und liefert sonst einen Blindgaenger (bereit === false). In Node muessen sie von
// Hand gesetzt werden -- sonst prueft unten jede Mount-Probe nur den Blindgaenger-Zweig.
global.avesmapsWikiAssignSubject = require("../wiki-assign-registry.js").avesmapsWikiAssignSubject;
global.avesmapsWikiAssignDiff = avesmapsWikiAssignDiff;

const weg = AVESMAPS_WIKI_ASSIGN_REGISTRY.weg;
const wurzel = path.resolve(__dirname, "..", "..", "..");
let checks = 0;
function zaehl() { checks++; }

// ── 1) DIE ABBILDUNG WIKI-ART -> WEGTYP ───────────────────────────────────────────────────────
// 💣 DIE ORDNUNG IST BEDEUTUNG: „Reichsstraße" traegt „straße" in sich, „Wüstenpfad" traegt
// „pfad". Wer die Musterliste umsortiert, macht aus jeder Reichsstrasse eine Strasse.
assert.strictEqual(avesmapsWikiAssignWegWegtyp("Reichsstraße", "strasse"), "Reichsstrasse",
	"„Reichsstraße“ faellt in das allgemeinere Strassen-Muster -- die Reihenfolge stimmt nicht mehr");
assert.strictEqual(avesmapsWikiAssignWegWegtyp("Wüstenpfad", "strasse"), "Wuestenpfad",
	"„Wüstenpfad“ faellt in das allgemeinere Pfad-Muster");
assert.strictEqual(avesmapsWikiAssignWegWegtyp("Straße", "strasse"), "Strasse");
assert.strictEqual(avesmapsWikiAssignWegWegtyp("Pfad", "strasse"), "Pfad");
assert.strictEqual(avesmapsWikiAssignWegWegtyp("Gebirgspass", "strasse"), "Gebirgspass");
zaehl(); zaehl(); zaehl(); zaehl(); zaehl();

// 💣 KEIN RUECKFALL. pathWikiGuessWegtyp gab bei unbekannter Art „Strasse" zurueck -- als
// Vorbelegung eines Auswahlfelds vertretbar, als SYNC-Vorschlag eine Vermutung, die echte Daten
// schreibt: aus einer gepflegten Reichsstrasse wuerde kommentarlos eine Strasse.
assert.strictEqual(avesmapsWikiAssignWegWegtyp("Handelsweg", "strasse"), "",
	"eine unbekannte Wiki-Art faellt auf einen geratenen Wegtyp zurueck");
assert.strictEqual(avesmapsWikiAssignWegWegtyp("", "strasse"), "");
assert.strictEqual(avesmapsWikiAssignWegWegtyp(null, "strasse"), "");
zaehl(); zaehl(); zaehl();

// 💣 EIN WIKI-FLUSS SAGT UEBER FLUSSWEG/SEEWEG NICHTS. Der alte Rueckfall auf „Flussweg" haette
// jeden zugewiesenen SEEWEG heruntergestuft.
assert.strictEqual(avesmapsWikiAssignWegWegtyp("Fluss", "fluss"), "",
	"ein Wiki-Fluss schlaegt einen Wegtyp vor -- er kennt unsere Unterscheidung Flussweg/Seeweg nicht");
assert.strictEqual(avesmapsWikiAssignWegWegtyp("Reichsstraße", "fluss"), "",
	"bei kind=fluss entscheidet die Art trotzdem mit");
assert.strictEqual(avesmapsWikiAssignWegKindLabel("fluss"), "Fluss");
assert.strictEqual(avesmapsWikiAssignWegKindLabel("strasse"), "Straße/Weg");
assert.strictEqual(avesmapsWikiAssignWegKindLabel(""), "");
zaehl(); zaehl(); zaehl(); zaehl(); zaehl();

// ── 2) DER NAME, DEN DER SERVER VERGIBT ───────────────────────────────────────────────────────
// Spiegel von avesmapsWikiPathCanonicalName: Staging-Name, sonst das /wiki/<Seite>-Stueck.
assert.strictEqual(avesmapsWikiAssignWegKanonischerName({ name: "Aguera", wiki_url: "https://x/wiki/Egal" }), "Aguera");
assert.strictEqual(avesmapsWikiAssignWegKanonischerName({ name: "", wiki_url: "https://x/wiki/Gro%C3%9Fer_Fluss" }), "Großer Fluss");
assert.strictEqual(avesmapsWikiAssignWegKanonischerName({ name: "", wiki_url: "https://x/wiki/Kap_%E9" }), "Kap %E9",
	"eine kaputte Prozentfolge darf nicht werfen -- das rohe Stueck ist der Rueckfall");
assert.strictEqual(avesmapsWikiAssignWegKanonischerName(null), "");
zaehl(); zaehl(); zaehl(); zaehl();

// ── 3) DER VERTRAG: `laden` LEHNT AB, STATT ETWAS LEERES ZU LIEFERN ───────────────────────────
// 🔴 Das ist die Zeile, um die diese Aufgabe gebeten wurde. Ein `laden`, das im Fehlerfall
// aufloest, ist vom Zustand „nichts zugewiesen" nicht zu unterscheiden -- und beim Weg schreibt
// der Speicherweg auf ALLE gleichnamigen Segmente zugleich.
[null, undefined, [], 5, "x"].forEach((kaputt) => {
	assert.throws(() => avesmapsWikiAssignWegZustand(kaputt),
		"avesmapsWikiAssignWegZustand(" + JSON.stringify(kaputt) + ") liefert einen Zustand, statt zu werfen");
	zaehl();
});

// Ohne Zuweisung ist `artikel` null -- das ist ein GUELTIGER Zustand, kein Fehler.
const ohne = avesmapsWikiAssignWegZustand({ wiki_path: null, feature_subtype: "Strasse" });
assert.strictEqual(ohne.artikel, null);
assert.strictEqual(ohne.kartenwerte.feature_subtype, "Strasse");
zaehl(); zaehl();

// ── 4) DIE HTTP-ANTWORT: WIRFT BEI JEDEM NEIN ─────────────────────────────────────────────────
// 💣 Der Typriegel kommt mit HTTP 200. Wer nur `ok` prueft, loest auf.
assert.throws(() => avesmapsWikiAssignWegAntwortPruefen({ ok: true, type_ok: false, applied: 0, message: "ist ein Fluss" }),
	/Fluss/,
	"`type_ok:false` gilt als Erfolg -- das Bauteil malte danach eine Zuweisung, die der Server nie geschrieben hat");
assert.throws(() => avesmapsWikiAssignWegAntwortPruefen({ ok: false, error: { message: "forbidden" } }), /forbidden/);
assert.throws(() => avesmapsWikiAssignWegAntwortPruefen(null));
assert.throws(() => avesmapsWikiAssignWegAntwortPruefen([]));
assert.throws(() => avesmapsWikiAssignWegAntwortPruefen(undefined));
const gut = { ok: true, type_ok: true, applied: 3 };
assert.strictEqual(avesmapsWikiAssignWegAntwortPruefen(gut), gut);
zaehl(); zaehl(); zaehl(); zaehl(); zaehl(); zaehl();

// Der Rumpf traegt BEIDE Riegel des Endpunkts -- ohne `confirm:"apply"` rechnet er nur probeweise.
const koerper = avesmapsWikiAssignWegZuweisungsKoerper("wiki:aguera", "path-1");
assert.strictEqual(koerper.action, "assign_to");
assert.strictEqual(koerper.dry_run, false);
assert.strictEqual(koerper.confirm, "apply");
zaehl(); zaehl(); zaehl();

// ── 5) DIE FLACHE SUCHZEILE WIRD EIN TREFFER ──────────────────────────────────────────────────
// 💣 DER SERVER-ZWEIG WAR UNVOLLSTAENDIG: `?action=search` antwortet mit flachen Zeilen, das
// Bauteil liest `treffer.werte[<wikiFeld>]`. Ohne Umformung bliebe nicht nur die Meta-Zeile leer
// -- `trefferWaehlen` uebernimmt `treffer.werte` in den Artikel, der ZUWEISUNGSKASTEN staende
// danach ohne eine einzige Angabe da.
const zeile = {
	wiki_key: "wiki:reichsstrasse-kosch", name: "Kosch-Reichsstraße", kind: "strasse",
	art: "Reichsstraße", lage: "Kosch · Almada", laenge: "180 Meilen",
	verlauf: "A → B", description: "langer Text", image_license_status: "unknown",
	wiki_url: "https://wiki/wiki/Kosch-Reichsstra%C3%9Fe",
};
const treffer = avesmapsWikiAssignWegTreffer(zeile);
assert.strictEqual(treffer.name, "Kosch-Reichsstraße");
assert.strictEqual(treffer.wiki_key, "wiki:reichsstrasse-kosch");
assert.deepStrictEqual(Object.keys(treffer.werte).sort(), ["art", "kind", "laenge", "lage", "wegtyp"]);
assert.strictEqual(treffer.werte.wegtyp, "Reichsstrasse");
assert.strictEqual(treffer.werte.kind, "Straße/Weg");
assert.strictEqual(treffer.roh, zeile, "die rohe Zeile reist nicht mit -- `zuweisen` braucht sie fuer das oertliche Nest");
zaehl(); zaehl(); zaehl(); zaehl(); zaehl(); zaehl();

// Die Meta-Zeile ist die des bisherigen Pickers: Fluss/Straße · Art · Lage.
assert.strictEqual(avesmapsWikiAssignTrefferMeta(weg, treffer), "Straße/Weg · Reichsstraße · Kosch · Almada");
zaehl();

// Und der Rueckfall des Bauteils (ohne eigenen Bauer) hebt wenigstens die erklaerten Felder heraus.
const roh = avesmapsWikiAssignTrefferAusZeile(weg, zeile);
assert.strictEqual(roh.werte.art, "Reichsstraße");
assert.strictEqual(roh.werte.lage, "Kosch · Almada");
assert.ok(!("verlauf" in roh.werte), "nicht erklaerte Felder wandern in die Anzeige");
// ⚠️ Eine bereits aufbereitete Zeile darf NICHT ein zweites Mal umgeformt werden (die Listen-Suche
// der Kraftlinien liefert die Treffer fertig).
assert.strictEqual(avesmapsWikiAssignTrefferAusZeile(weg, treffer), treffer);
zaehl(); zaehl(); zaehl(); zaehl();

// ── 6) DER ZUWEISUNGSKASTEN IST VOLLSTAENDIG (Entwurf §10) ────────────────────────────────────
const zugewiesen = avesmapsWikiAssignModell(weg, { artikel: avesmapsWikiAssignWegArtikel({
	wiki_key: "wiki:reichsstrasse-kosch", name: "Kosch-Reichsstraße", kind: "strasse",
	art: "Reichsstraße", lage: "Kosch", laenge: "180 Meilen", wiki_url: "https://wiki/wiki/X",
}) }, {});
assert.deepStrictEqual(zugewiesen.knoepfe.map((k) => k.aktion), ["aendern", "sync", "entfernen"],
	"der Weg hat ein Kartenziel (feature_subtype) -- also gehoert ein Sync-Knopf dazu");
assert.deepStrictEqual(zugewiesen.felder.map((f) => f.label),
	["Artikel", "Schlüssel", "Art", "Wegtyp", "Lage", "Länge"]);
zaehl(); zaehl();

// 💣 LEERE FELDER FALLEN WEG: ein Wiki-Weg ohne Laenge zeigt keine leere Zeile „Länge".
const duenn = avesmapsWikiAssignModell(weg, { artikel: avesmapsWikiAssignWegArtikel({
	wiki_key: "k", name: "Namenloser Pfad", kind: "strasse", art: "", lage: "", laenge: "",
	wiki_url: "https://wiki/wiki/Y",
}) }, {});
assert.deepStrictEqual(duenn.felder.map((f) => f.label), ["Artikel", "Schlüssel"]);
zaehl();

// ── 7) DIE SYNC-VORSCHAU VERGLEICHT SCHLUESSEL, NICHT FREIEN TEXT ─────────────────────────────
// 🔴 DAS IST DER GRUND FUER DAS ZWEITE FELD `wegtyp`. Verglichen wird der Wert, der GESCHRIEBEN
// wuerde -- sonst meldete die Vorschau „Strasse → Reichsstraße" (mit ß) und schriebe freien Text
// in ein Schluesselfeld.
const wikiWerte = avesmapsWikiAssignWegTreffer(zeile).werte;
const diffAnders = avesmapsWikiAssignDiff(weg.felder, { feature_subtype: "Strasse" }, wikiWerte, []);
assert.strictEqual(diffAnders.length, 1, "genau eine Angabe ist veraenderbar: " + JSON.stringify(diffAnders));
assert.strictEqual(diffAnders[0].karte, "feature_subtype");
assert.strictEqual(diffAnders[0].alt, "Strasse");
assert.strictEqual(diffAnders[0].neu, "Reichsstrasse", "die Vorschau bietet freien Wikitext statt eines Schluessels an");
assert.strictEqual(diffAnders[0].gehakt, true);
zaehl(); zaehl(); zaehl(); zaehl(); zaehl();

// Stimmt der Typ ueberein, steht GAR NICHTS in der Liste.
assert.deepStrictEqual(avesmapsWikiAssignDiff(weg.felder, { feature_subtype: "Reichsstrasse" }, wikiWerte, []), []);
zaehl();

// 🔴 Sagt das Wiki nichts (unbekannte Art), ist die Zeile gelistet, aber NIE vorangehakt.
const stumm = avesmapsWikiAssignWegTreffer({ art: "Handelsweg", kind: "strasse" }).werte;
const diffLeer = avesmapsWikiAssignDiff(weg.felder, { feature_subtype: "Reichsstrasse" }, stumm, []);
assert.strictEqual(diffLeer.length, 1);
assert.strictEqual(diffLeer[0].gehakt, false,
	"eine leerende Angabe ist vorangehakt -- ein unbedachter Klick stufte die Reichsstrasse herunter");
assert.ok(/Wiki sagt nichts/.test(diffLeer[0].grund), diffLeer[0].grund);
zaehl(); zaehl(); zaehl();

// ⚠️ ZWEI Mehrzahlen in einem Satz, und sie haengen an VERSCHIEDENEN Zahlen. Der Weg ist die
// erste Objektart, die den Satz ueberhaupt zu sehen bekommt -- mit seiner EINEN veraenderbaren
// Angabe stand dort „1 von 1 Angaben würden sich ändern“. Gefunden im Ablauf, nicht im Test.
const satzEins = avesmapsWikiAssignModell(weg, {}, { modus: "sync", syncZeilen: diffAnders });
assert.ok(/1 von 1 Angabe würde sich ändern/.test(satzEins.hinweis), satzEins.hinweis);
const vieleFelder = { felder: [
	{ wiki: "a", karte: "a" }, { wiki: "b", karte: "b" }, { wiki: "c", karte: "c" },
	{ wiki: "d", karte: "d" }, { wiki: "e", karte: "e" }, { wiki: "f", karte: "f" },
] };
const satzViele = avesmapsWikiAssignModell(vieleFelder, {}, { modus: "sync", syncZeilen: [diffAnders[0], diffAnders[0]] });
assert.ok(/2 von 6 Angaben würden sich ändern/.test(satzViele.hinweis), satzViele.hinweis);
const satzEinsVonSechs = avesmapsWikiAssignModell(vieleFelder, {}, { modus: "sync", syncZeilen: diffAnders });
assert.ok(/1 von 6 Angaben würde sich ändern/.test(satzEinsVonSechs.hinweis), satzEinsVonSechs.hinweis);
zaehl(); zaehl(); zaehl();

// Was die Oberflaechen aus den angehakten Zeilen lesen.
assert.strictEqual(avesmapsWikiAssignWegSyncWegtyp(diffAnders), "Reichsstrasse");
assert.strictEqual(avesmapsWikiAssignWegSyncWegtyp([]), null);
assert.strictEqual(avesmapsWikiAssignWegSyncWegtyp([{ karte: "feature_subtype", neu: "" }]), null,
	"eine leerende Zeile setzt den Wegtyp auf nichts");
zaehl(); zaehl(); zaehl();

// ── 7b) DER KARTENWERT WIRD ERST BEIM LESEN GEHOLT ──────────────────────────────
// 💣 `laden` laeuft EINMAL, die Sync-Vorschau entsteht erst beim Druck auf „Sync“ -- und
// dazwischen liegt in BEIDEN Oberflaechen die Wegtyp-Auswahl, gleich ueber dem Kasten. Eingefroren
// verglichen boete die Vorschau „Strasse → Reichsstrasse“ an, waehrend dort laengst
// „Reichsstrasse“ steht. Eine Eigenschaft mit Lesefunktion loest das, ohne das Bauteil anzufassen.
let formularWert = "Strasse";
const beweglich = avesmapsWikiAssignWegZustand({ wiki_path: null, feature_subtype: () => formularWert });
assert.strictEqual(beweglich.kartenwerte.feature_subtype, "Strasse");
formularWert = "Reichsstrasse";
assert.strictEqual(beweglich.kartenwerte.feature_subtype, "Reichsstrasse",
	"der Kartenwert ist eingefroren -- die Sync-Vorschau vergliche gegen einen Stand, den das Formular nicht mehr zeigt");
// Und die Diff-Rechnung liest ihn ganz normal: kein Unterschied mehr, sobald das Formular passt.
assert.deepStrictEqual(
	avesmapsWikiAssignDiff(weg.felder, beweglich.kartenwerte, avesmapsWikiAssignWegTreffer(zeile).werte, []), [],
	"die Diff-Rechnung sieht den nachgezogenen Formularwert nicht");
// ⚠️ Ein einfacher Wert bleibt weiterhin erlaubt (die Proben oben benutzen ihn).
assert.strictEqual(avesmapsWikiAssignWegZustand({ feature_subtype: "Pfad" }).kartenwerte.feature_subtype, "Pfad");
zaehl(); zaehl(); zaehl(); zaehl();

// 🔴 UND BEIDE OBERFLAECHEN MUESSEN SIE BENUTZEN -- ein Wert statt einer Funktion faellt
// nicht auf, er wird nur alt.
[["Kartendialog", "review-path-wiki.js"], ["Wege-Editor", "wege-editor.js"]].forEach(([name, datei]) => {
	const text = datei === "wege-editor.js"
		? fs.readFileSync(path.join(wurzel, "js", "pages", datei), "utf8")
		: fs.readFileSync(path.join(wurzel, "js", "review", datei), "utf8");
	assert.ok(/feature_subtype:\s*(\(\)\s*=>|function\s*\(\))/.test(text),
		name + ": reicht den Wegtyp als festen Wert statt als Lesefunktion weiter");
	zaehl();
});

// 🔴 UND DER WEGTYP-WECHSEL IM EDITORFENSTER WIRFT DEN KASTEN NICHT MEHR WEG ───────────
// 💣 `renderDetail()` baut die ganze Eigenschaften-Spalte per innerHTML neu und zerstoert dabei
// das Bauteil samt offener Suche oder gesetzter Haken. Solange der Block dort reiner Lesetext war,
// kostete das nichts; seit dem 16.08.2026 traegt er Zustand. Neu gebaut wird deshalb nur noch, wenn
// sich die VERKEHRSDOMAENE aendert -- nur sie entscheidet ueber die Transportliste.
const wegeEditorText = fs.readFileSync(path.join(wurzel, "js", "pages", "wege-editor.js"), "utf8");
const wechsel = wegeEditorText.slice(wegeEditorText.indexOf('subtype.addEventListener("change"'));
const rumpfWechsel = wechsel.slice(0, wechsel.indexOf("\n\t\t}"));
assert.ok(/wpVerkehrsdomaene\(subtype\.value\) !== domaeneVorher/.test(rumpfWechsel),
	"der Wegtyp-Wechsel zeichnet die Spalte wieder bedingungslos neu -- eine offene Suche im Zuweisungskasten geht dabei wortlos verloren");
assert.ok(/wpStroemungsart/.test(rumpfWechsel),
	"bei gleicher Domaene wird die Textstelle mit der Wegart nicht nachgezogen -- sie bliebe stehen");
zaehl(); zaehl();

// ── 8) DIE HUELLE `label-wiki` HAT FUER JEDE ERZEUGTE KLASSE EINE REGEL ───────────────────────
// 💣 Genau hier fehlten am 16.08.2026 elf Namen -- darunter `.is-active`, ohne die die
// Tastaturauswahl ↑ ↓ in dieser Huelle UNSICHTBAR ist, und die ganze Sync-Vorschau. Eine
// Aufzaehlung im Kommentar hatte das nicht verhindert (sie stand mit einer falschen ZAHL da);
// diese Probe zaehlt selbst nach.
const cssTexte = [];
(function sammle(verzeichnis) {
	fs.readdirSync(verzeichnis, { withFileTypes: true }).forEach((eintrag) => {
		const voll = path.join(verzeichnis, eintrag.name);
		if (eintrag.isDirectory()) { sammle(voll); return; }
		if (eintrag.name.endsWith(".css")) { cssTexte.push(fs.readFileSync(voll, "utf8")); }
	});
})(path.join(wurzel, "css"));
// 🪤 KOMMENTARE FLIEGEN RAUS, und auch das hat erst der Mutationslauf gezeigt: die Regeln der
// einen Huelle nennen ihr Gegenstueck in der anderen im Kommentar („Gegenstueck:
// .dt-picker-list__item.is-active"). Eine Probe, die den eigenen Kommentar findet, prueft nichts
// -- die Mutation, die genau diese Regel entfernte, blieb damit gruen.
const allesCss = cssTexte.join("\n").replace(/\/\*[\s\S]*?\*\//g, " ");

Object.keys(AVESMAPS_WIKI_ASSIGN_SKINS).forEach((huelle) => {
	const tabelle = AVESMAPS_WIKI_ASSIGN_SKINS[huelle];
	Object.keys(tabelle).forEach((rolle) => {
		if (/Tag$/.test(rolle)) { return; } // Elementname, keine Klasse
		String(tabelle[rolle] || "").split(/\s+/).forEach((klasse) => {
			if (klasse === "") { return; }
			const regel = new RegExp("\\." + klasse.replace(/[-[\]{}()*+?.,\\^$|#]/g, "\\$&") + "(?![\\w-])");
			assert.ok(regel.test(allesCss),
				"Huelle „" + huelle + "“, Rolle „" + rolle + "“: die Klasse ." + klasse + " wird erzeugt, hat aber in keiner CSS-Datei eine Regel");
			zaehl();
		});
	});
});

// 🪤 UND DIE PROBE DARUEBER REICHT NICHT AN IHREN GEGENSTAND. Beim ersten Mutationslauf blieb sie
// gruen, als ich genau die Regel entfernte, um die es geht: `trefferAktiv` heisst in BEIDEN
// Huellen `is-active`, und `.is-active` steht in editor-page.css. Die fehlende Regel war aber die
// KOMBINATION `.label-wiki-picker-list__item.is-active` -- die generische Klasse allein faerbt
// nichts. Genau die Fehlerform, die in Aufgabe 3 dreimal zuschlug: eine Zusicherung, die richtig
// aussieht und ihren Gegenstand nicht erreicht. Deshalb wird die Kombination eigens geprueft.
Object.keys(AVESMAPS_WIKI_ASSIGN_SKINS).forEach((huelle) => {
	const tabelle = AVESMAPS_WIKI_ASSIGN_SKINS[huelle];
	const kombination = new RegExp("\\." + tabelle.treffer.replace(/[-[\]{}()*+?.,\\^$|#]/g, "\\$&")
		+ "\\." + tabelle.trefferAktiv.replace(/[-[\]{}()*+?.,\\^$|#]/g, "\\$&") + "(?![\\w-])");
	assert.ok(kombination.test(allesCss),
		"Huelle „" + huelle + "“: fuer den mit ↑ ↓ gewaehlten Treffer gibt es keine Regel ("
		+ "." + tabelle.treffer + "." + tabelle.trefferAktiv + ") -- die Tastaturauswahl ist unsichtbar");
	zaehl();
});

// Und die Gegenrichtung dieser Aufgabe: das erzeugte Markup der Huelle `label-wiki` traegt
// wirklich die Namen, die vorher keine Regel hatten.
const labelWiki = avesmapsWikiAssignSkin("label-wiki");
const syncMarkup = avesmapsWikiAssignMarkup(
	avesmapsWikiAssignModell(weg, {}, { modus: "sync", syncZeilen: diffAnders }), labelWiki);
["label-wiki-sync-rows", "label-wiki-sync-row__alt", "label-wiki-sync-row__neu", "label-wiki-reference__hint"]
	.forEach((klasse) => {
		assert.ok(syncMarkup.indexOf(klasse) !== -1, "die Sync-Vorschau erzeugt " + klasse + " nicht mehr");
		zaehl();
	});

// 🔴 DER KOPF DES BAUTEILS IST IM WEG-DIALOG DIE ABSCHNITTSUEBERSCHRIFT -- und seine sechs
// typografischen Werte sind eine ABSCHRIFT von `.label-edit-section-title`. Genau so laufen zwei
// Regeln auseinander; diese Probe vergleicht sie Zeichen fuer Zeichen. (Die Abschrift ist noetig,
// weil die Basisregel zusaetzlich margin/padding/border fuer eine alleinstehende Ueberschrift
// setzt -- der Titel hier ist ein Flex-Kind neben den Knoepfen.)
const regionSyncCss = fs.readFileSync(path.join(wurzel, "css", "components", "region-sync.css"), "utf8");
function deklarationen(css, selektor) {
	const start = css.indexOf(selektor + " {");
	assert.ok(start !== -1, "Regel nicht gefunden: " + selektor);
	const rumpf = css.slice(start + selektor.length + 2, css.indexOf("}", start));
	const werte = {};
	rumpf.split(";").forEach((zeile) => {
		const teil = zeile.replace(/\/\*[\s\S]*?\*\//g, " ").trim();
		const doppel = teil.indexOf(":");
		if (doppel > 0) { werte[teil.slice(0, doppel).trim()] = teil.slice(doppel + 1).trim(); }
	});
	return werte;
}
const kopfRegel = deklarationen(regionSyncCss, "#path-edit-dialog .label-wiki-reference__title");
const nachbarRegel = deklarationen(regionSyncCss, ".label-edit-section-title");
["font-family", "font-size", "text-transform", "letter-spacing", "color"].forEach((eigenschaft) => {
	assert.strictEqual(kopfRegel[eigenschaft], nachbarRegel[eigenschaft],
		"Der Kopf der Wiki-Zuweisung und die Abschnittsueberschriften daneben sind bei „"
		+ eigenschaft + "“ auseinandergelaufen: „" + kopfRegel[eigenschaft] + "“ gegen „"
		+ nachbarRegel[eigenschaft] + "“");
	zaehl();
});
// ⚠️ `font-weight` steht nur in der EINGEENGTEN Regel: die Basisregel setzt keins (sie erbt 400),
// aber `.label-wiki-reference__title` setzt 600 -- das muss ausdruecklich zurueckgenommen werden.
assert.strictEqual(kopfRegel["font-weight"], "400",
	"der Kopf traegt wieder das Gewicht 600 aus .label-wiki-reference__title und faellt aus der Rangfolge");
assert.ok(nachbarRegel["font-weight"] === undefined);
zaehl(); zaehl();

// ── 9) BEIDE OBERFLAECHEN HAENGEN AM SELBEN BAUTEIL, JEDE IN IHRER HUELLE ─────────────────────
// ⚠️ Eine Zusicherung am Modell saehe das nicht: hier bricht die VERDRAHTUNG, nicht der Bauer.
// Genau diese Fehlerform hat in Aufgabe 3 dreimal zugeschlagen.
const kartenDialog = fs.readFileSync(path.join(wurzel, "js", "review", "review-path-wiki.js"), "utf8");
const wegeEditor = fs.readFileSync(path.join(wurzel, "js", "pages", "wege-editor.js"), "utf8");

[["Kartendialog", kartenDialog, "label-wiki"], ["Wege-Editor", wegeEditor, "dt"]].forEach(([name, text, huelle]) => {
	assert.ok(/avesmapsWikiAssignMount\(/.test(text), name + ": haengt nicht am gemeinsamen Bauteil");
	assert.ok(new RegExp('skin:\\s*"' + huelle + '"').test(text), name + ": benutzt nicht die Huelle " + huelle);
	assert.ok(/subject:\s*"weg"/.test(text), name + ": nennt nicht die Objektart weg");
	// 💣 Ohne eigenen Trefferbauer bliebe der Zuweisungskasten nach einer Serversuche leer.
	assert.ok(/trefferAufbereiten:\s*avesmapsWikiAssignWegTreffer/.test(text),
		name + ": reicht die flachen Suchzeilen unaufbereitet ans Bauteil");
	// 🔴 Und der Riegel gegen die stille Loeschung: der Stand kommt aus dem geteilten Zustandsbauer,
	// der wirft, statt etwas Leeres zu liefern.
	assert.ok(/avesmapsWikiAssignWegZustand\(/.test(text), name + ": baut den Stand selbst statt ueber den geteilten Bauer");
	// 🔴 Und jede Antwort geht durch die Pruefung, die auch `type_ok:false` als Nein liest.
	assert.ok(/avesmapsWikiAssignWegAntwortPruefen\(/.test(text), name + ": prueft die Serverantwort nicht");
	checks += 6;
});

// 🔴 KEIN DRITTER SKIN (Entwurf §4a). Die Zahl steht hier, weil sie die Obergrenze IST.
assert.strictEqual(Object.keys(AVESMAPS_WIKI_ASSIGN_SKINS).length, 2);
zaehl();

// 🔴 Der alte Weg-Picker ist WEG, nicht daneben stehengeblieben -- sonst gaebe es die Zuweisung
// zweimal, und die eine wuesste nichts von der anderen.
// ⚠️ Gesucht wird die DEFINITION, nicht das Wort: die abgeloesten Namen stehen weiterhin in den
// Kommentaren, die erklaeren, was an ihre Stelle getreten ist.
["renderPathWikiPickerList", "syncPathTypeFromWiki", "selectPathWikiResult", "setPathWikiPickerOpen"]
	.forEach((rest) => {
		assert.ok(kartenDialog.indexOf("function " + rest) === -1, "der alte Weg-Picker lebt weiter: " + rest);
		zaehl();
	});
['getElementById("path-wiki-picker', 'getElementById("path-wiki-remove'].forEach((rest) => {
	assert.ok(kartenDialog.indexOf(rest) === -1, "der Kartendialog greift noch nach dem alten Picker: " + rest);
	zaehl();
});
const indexHtml = fs.readFileSync(path.join(wurzel, "index.html"), "utf8");
["path-wiki-picker", 'id="path-wiki-remove"', "path-edit-wiki-sync-type"].forEach((rest) => {
	assert.ok(indexHtml.indexOf(rest) === -1, "index.html traegt noch Reste des alten Weg-Pickers: " + rest);
	zaehl();
});
// 💣 Der Behaelter ist ein BLANKES div -- traegt er selbst die Huelle, steht der Kasten doppelt
// geschachtelt da (Rahmen im Rahmen, Polsterung doppelt).
assert.ok(/<div id="path-wiki-assign-host"><\/div>/.test(indexHtml),
	"der Behaelter der Wiki-Zuweisung fehlt oder traegt selbst eine Klasse");
zaehl();
// Und die drei Dateien des Bauteils MUESSEN in beiden Dokumenten stehen -- fehlt eine, liefert
// `mount` einen Blindgaenger, und der Kasten sagt nur, welche Datei fehlt.
["wiki-assign-registry.js", "wiki-assign-diff.js", "wiki-assign.js", "wiki-assign-weg.js"].forEach((datei) => {
	assert.ok(indexHtml.indexOf("js/ui/" + datei) !== -1, "index.html laedt " + datei + " nicht");
	zaehl();
});
const wegeEditorHtml = fs.readFileSync(path.join(wurzel, "html", "wege-editor.html"), "utf8");
["wiki-assign-registry.js", "wiki-assign-diff.js", "wiki-assign.js", "wiki-assign-weg.js"].forEach((datei) => {
	assert.ok(wegeEditorHtml.indexOf("/js/ui/" + datei) !== -1, "html/wege-editor.html laedt " + datei + " nicht");
	zaehl();
});

// ── 10) DER SUCHFEHLER IST NICHT „KEINE TREFFER" ──────────────────────────────────────────────
// 🔴 Bis zum 16.08.2026 schluckte der Server-Zweig jeden Fehler (`.catch(() => [])`): eine
// abgelaufene Sitzung sah aus wie „diesen Artikel gibt es nicht", und der Editor haette im Wiki
// gesucht statt sich neu anzumelden.
const gescheitert = avesmapsWikiAssignModell(weg, {}, { modus: "suche", treffer: [], suchFehler: "Der Server antwortete mit 403." });
assert.ok(/Suche fehlgeschlagen/.test(gescheitert.hinweis), gescheitert.hinweis);
assert.ok(/403/.test(gescheitert.hinweis), gescheitert.hinweis);
assert.ok(!/Keine Treffer/.test(gescheitert.hinweis), gescheitert.hinweis);
assert.ok(/Suche fehlgeschlagen/.test(gescheitert.trefferLeerText), gescheitert.trefferLeerText);
// Gegenprobe: ohne Fehler bleibt es bei der alten Auskunft.
const leer = avesmapsWikiAssignModell(weg, {}, { modus: "suche", treffer: [] });
assert.ok(/^Keine Treffer · /.test(leer.hinweis), leer.hinweis);
checks += 5;

// ── 11) DER SERVER-ZWEIG, WIRKLICH GEFAHREN ───────────────────────────────────────────────────
// 🔴 Bis hierher war jede Probe eine Probe am BAUER. Die Fehler dieser Aufgabe sassen aber in der
// VERDRAHTUNG -- genau die Fehlerform, die in Aufgabe 3 dreimal zuschlug. Also wird der Suchzweig
// ab hier echt gefahren: `fetch` wird untergeschoben, und die Klicks laufen ueber die Zuhoerer,
// die `mount` selbst angehaengt hat.
//
// 🪤 Die erste Fassung dieser Stelle las statt dessen den QUELLTEXT des Bauteils nach einem
// zweiten `.then`-Zweig ab. Zwei von vier Mutationen liefen dagegen gruen durch bzw. scheiterten
// nur an einem Syntaxfehler -- eine Textprobe misst die FORM des Codes, nicht sein Verhalten.

// Ein Behaelter, der gerade genug kann: Zuhoerer merken, Ereignisse ausloesen, Auszeichnung
// aufnehmen. `zeichneTreffer` faellt ohne echtes `querySelector` auf das volle Zeichnen zurueck --
// der Zustand steht deshalb immer vollstaendig in `innerHTML`.
function scheinBehaelter() {
	const zuhoerer = {};
	return {
		textContent: "", innerHTML: "",
		addEventListener(typ, fn) { zuhoerer[typ] = fn; },
		removeEventListener(typ) { delete zuhoerer[typ]; },
		querySelector() { return null; },
		contains() { return true; },
		feuere(typ, ziel) { if (zuhoerer[typ]) { zuhoerer[typ]({ target: ziel, preventDefault() {} }); } },
	};
}

// Ein Ziel, das genau EIN Merkmal traegt -- `aufKlick` fragt nacheinander nach zwei Selektoren.
function scheinZiel(merkmal, wert) {
	const element = {
		getAttribute: (name) => (name === merkmal ? wert : null),
		hasAttribute: (name) => name === merkmal,
	};
	element.closest = (selektor) => (selektor === "[" + merkmal + "]" ? element : null);
	return element;
}

const ruhe = () => new Promise((fertig) => setTimeout(fertig, 0));

(async () => {
	// Der Vertrag, mit dem ECHTEN Zustandsbauer des Wegs: was seine Quelle nicht hergibt, wird
	// geworfen -- und das Bauteil verweigert daraufhin jeden Schreibwert.
	const kasten = scheinBehaelter();
	let quelle = null;
	const st = avesmapsWikiAssignMount(kasten, {
		subject: "weg", skin: "dt",
		laden: () => avesmapsWikiAssignWegZustand(quelle),
	});
	await st.neuLaden();
	assert.strictEqual(st.bereit, false, "ein geworfener Zustand macht das Bauteil trotzdem bereit");
	assert.strictEqual(st.lies(), null, "lies() liefert einen Schreibwert, obwohl der Stand unbekannt ist");
	checks += 2;

	// ⚠️ Und die Form, die ein Server-`laden` benutzt: eine ABGELEHNTE Zusage.
	const kasten2 = scheinBehaelter();
	const st2 = avesmapsWikiAssignMount(kasten2, {
		subject: "weg", skin: "dt",
		laden: () => Promise.reject(new Error("HTTP 500")),
	});
	await st2.neuLaden();
	assert.strictEqual(st2.bereit, false);
	assert.strictEqual(st2.lies(), null);
	assert.ok(/konnte nicht gelesen werden/.test(kasten2.textContent), kasten2.textContent);
	checks += 3;

	// ---- 11a) Eine GEGLUECKTE Serversuche fuellt den Zuweisungskasten -------------------------
	// 💣 Das ist der Fehler, den nur der erste echte Nutzer findet: die Antwortzeilen sind flach,
	// das Bauteil liest `treffer.werte`. Ohne Aufbereitung waere `lies()` zwar richtig, der Kasten
	// aber leer -- also wird BEIDES geprueft.
	const echtesFetch = global.fetch;
	let letzteUrl = "";
	global.fetch = (url) => {
		letzteUrl = String(url);
		return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, count: 1, rows: [zeile] }) });
	};
	quelle = { wiki_path: null, feature_subtype: "Strasse" };
	const kastenS = scheinBehaelter();
	const stS = avesmapsWikiAssignMount(kastenS, {
		subject: "weg", skin: "dt",
		laden: () => avesmapsWikiAssignWegZustand(quelle),
		trefferAufbereiten: avesmapsWikiAssignWegTreffer,
		zuweisen: () => Promise.resolve(),
	});
	await stS.neuLaden();
	kastenS.feuere("click", scheinZiel("data-wa-aktion", "zuweisen"));
	await ruhe();
	assert.ok(/action=search&q=&limit=40/.test(letzteUrl), "die Suche fragt nicht die gemessene Adresse ab: " + letzteUrl);
	assert.ok(/\/api\/edit\/wiki\/paths\.php/.test(letzteUrl), letzteUrl);
	// Die Trefferzeile traegt Name UND Meta -- ohne Aufbereitung waere die zweite Zeile leer.
	assert.ok(kastenS.innerHTML.indexOf("Kosch-Reichsstra") !== -1, kastenS.innerHTML);
	assert.ok(kastenS.innerHTML.indexOf("Reichsstra") !== -1 && kastenS.innerHTML.indexOf("Kosch · Almada") !== -1,
		"die Meta-Zeile des Treffers ist leer -- die flachen Antwortzeilen kommen unaufbereitet an");
	checks += 4;

	// Jetzt den Treffer waehlen -- und der Kasten muss die Angaben zeigen, nicht nur den Namen.
	kastenS.feuere("click", scheinZiel("data-wa-treffer", "0"));
	await ruhe();
	assert.strictEqual(stS.lies().wiki_key, "wiki:reichsstrasse-kosch");
	assert.ok(kastenS.innerHTML.indexOf("Wegtyp") !== -1,
		"der Zuweisungskasten zeigt nach der Wahl keine Felder -- `treffer.werte` kam nicht an: " + kastenS.innerHTML);
	assert.ok(kastenS.innerHTML.indexOf("180 Meilen") !== -1, kastenS.innerHTML);
	// Und der Sync-Knopf ist da, weil die Erklaerung ein Kartenziel fuehrt.
	assert.ok(kastenS.innerHTML.indexOf('data-wa-aktion="sync"') !== -1, kastenS.innerHTML);
	checks += 4;

	// ---- 11b) Eine GESCHEITERTE Serversuche sagt es -------------------------------------------
	// 🔴 `fetch` loest auch bei 403 auf. Bis zum 16.08.2026 endete das in `.catch(() => [])`, und
	// eine abgelaufene Sitzung sah aus wie „diesen Artikel gibt es nicht".
	global.fetch = () => Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({}) });
	const kastenF = scheinBehaelter();
	const stF = avesmapsWikiAssignMount(kastenF, {
		subject: "weg", skin: "dt",
		laden: () => avesmapsWikiAssignWegZustand(quelle),
		trefferAufbereiten: avesmapsWikiAssignWegTreffer,
	});
	await stF.neuLaden();
	kastenF.feuere("click", scheinZiel("data-wa-aktion", "zuweisen"));
	await ruhe();
	assert.ok(kastenF.innerHTML.indexOf("Suche fehlgeschlagen") !== -1, kastenF.innerHTML);
	assert.ok(kastenF.innerHTML.indexOf("403") !== -1, kastenF.innerHTML);
	assert.ok(kastenF.innerHTML.indexOf("Keine Treffer") === -1,
		"ein Fehlschlag meldet sich weiterhin als Leerergebnis: " + kastenF.innerHTML);
	checks += 3;

	// Und eine Antwort in der falschen FORM (HTTP 200, aber kein `rows`) gilt genauso als Fehler.
	global.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: false, error: { message: "kaputt" } }) });
	const kastenG = scheinBehaelter();
	const stG = avesmapsWikiAssignMount(kastenG, {
		subject: "weg", skin: "dt",
		laden: () => avesmapsWikiAssignWegZustand(quelle),
		trefferAufbereiten: avesmapsWikiAssignWegTreffer,
	});
	await stG.neuLaden();
	kastenG.feuere("click", scheinZiel("data-wa-aktion", "zuweisen"));
	await ruhe();
	assert.ok(kastenG.innerHTML.indexOf("Suche fehlgeschlagen") !== -1, kastenG.innerHTML);
	assert.ok(kastenG.innerHTML.indexOf("kaputt") !== -1, kastenG.innerHTML);
	checks += 2;

	// ---- 11c) EIN NEIN DES SERVERS MALT NICHTS ------------------------------------------------
	// 🔴 Der Fall, den der Typriegel taeglich liefert (HTTP 200, `type_ok:false`, nichts
	// geschrieben): das Bauteil darf danach NICHT „zugewiesen" zeigen.
	global.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, rows: [zeile] }) });
	const kastenN = scheinBehaelter();
	let versuche = 0;
	const stN = avesmapsWikiAssignMount(kastenN, {
		subject: "weg", skin: "dt",
		laden: () => avesmapsWikiAssignWegZustand(quelle),
		trefferAufbereiten: avesmapsWikiAssignWegTreffer,
		zuweisen: () => { versuche++; return Promise.reject(new Error("type_ok:false")); },
	});
	await stN.neuLaden();
	kastenN.feuere("click", scheinZiel("data-wa-aktion", "zuweisen"));
	await ruhe();
	kastenN.feuere("click", scheinZiel("data-wa-treffer", "0"));
	await ruhe();
	assert.strictEqual(versuche, 1, "der Zuweisungsversuch hat den Datenweg gar nicht erreicht");
	assert.strictEqual(stN.lies().wiki_key, "",
		"nach einem Nein des Servers steht die Zuweisung trotzdem im Schreibwert -- beim naechsten Oeffnen waere sie spurlos weg");
	assert.strictEqual(stN.bereit, true, "ein abgelehntes Zuweisen darf den geladenen Stand nicht entwerten");
	checks += 3;

	// ---- 11d) EIN ABGEBROCHENES ENTFERNEN LAESST DIE ZUWEISUNG STEHEN -------------------------
	// 💣 Beim Weg ist das der Regelfall, nicht der Rand: „Entfernen" fragt erst zurueck, ob nur
	// dieser Abschnitt oder der GANZE Weg gemeint ist -- ein Abbruch dort ist eine Ablehnung.
	quelle = {
		wiki_path: { wiki_key: "wiki:aguera", name: "Aguera", kind: "fluss", wiki_url: "https://wiki/wiki/Aguera" },
		feature_subtype: "Flussweg",
	};
	const kastenL = scheinBehaelter();
	let loesVersuche = 0;
	const stL = avesmapsWikiAssignMount(kastenL, {
		subject: "weg", skin: "dt",
		laden: () => avesmapsWikiAssignWegZustand(quelle),
		loesen: () => { loesVersuche++; return Promise.reject(new Error("Abgebrochen.")); },
	});
	await stL.neuLaden();
	assert.strictEqual(stL.lies().wiki_key, "wiki:aguera");
	kastenL.feuere("click", scheinZiel("data-wa-aktion", "entfernen"));
	await ruhe();
	assert.strictEqual(loesVersuche, 1);
	assert.strictEqual(stL.lies().wiki_key, "wiki:aguera",
		"ein abgebrochenes Entfernen loescht die Zuweisung trotzdem -- der Kasten zeigte den offenen Zustand, waehrend auf dem Server alles steht");
	assert.ok(kastenL.innerHTML.indexOf("Aguera") !== -1, kastenL.innerHTML);
	checks += 4;

	// Gegenprobe: ein GEGLUECKTES Entfernen loest wirklich.
	const kastenE = scheinBehaelter();
	const stE = avesmapsWikiAssignMount(kastenE, {
		subject: "weg", skin: "dt",
		laden: () => avesmapsWikiAssignWegZustand(quelle),
		loesen: () => Promise.resolve(),
	});
	await stE.neuLaden();
	kastenE.feuere("click", scheinZiel("data-wa-aktion", "entfernen"));
	await ruhe();
	assert.strictEqual(stE.lies().wiki_key, "", "ein gegluecktes Entfernen laesst die Zuweisung stehen");
	checks += 1;

	if (echtesFetch) { global.fetch = echtesFetch; } else { delete global.fetch; }
	console.log("wiki-assign-weg: " + checks + " Zusicherungen erfuellt");
})();
