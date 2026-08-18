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

// ── 3b) DER DRITTE ZUSTAND REIST IM ZUSTAND MIT (Aufgabe 5c) ──────────────────────────────────
// 🔴 Er ist NICHT aus der Zuweisung ableitbar: „keine Zuweisung" heisst „noch niemand hat
// nachgesehen", der Merker heisst „jemand HAT nachgesehen und es gibt keinen". Ohne ihn hatte der
// Weg zwei Leser (Anreicherung + Konfliktregel) und keinen Schreiber -- gemessen in Aufgabe 5b.
assert.strictEqual(ohne.keinArtikel, false,
	"ohne Merker meldet der Zustand den dritten Zustand als gesetzt");
assert.strictEqual(
	avesmapsWikiAssignWegZustand({ wiki_path: null, kein_artikel: true, feature_subtype: "Strasse" }).keinArtikel,
	true,
	"der gespeicherte Merker erreicht den Zustand nicht -- das Haekchen startete immer leer");
// ⚠️ Nur ein echtes `true`. Beide Oberflaechen liefern einen Boolean; ein weicher Vergleich machte
// aus einem versehentlichen `"false"` (String) ein gesetztes Haekchen. Dieselbe Strenge wie beim Ort.
[1, "1", "true", "on", {}].forEach((weich) => {
	assert.strictEqual(
		avesmapsWikiAssignWegZustand({ wiki_path: null, kein_artikel: weich }).keinArtikel, false,
		"ein weicher Wert (" + JSON.stringify(weich) + ") gilt als gesetzter Merker");
	zaehl();
});
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

// ── 6b) DER DRITTE ZUSTAND STEHT IN DER ERKLAERUNG UND IN BEIDEN HUELLEN (Aufgabe 5c) ─────────
// 🔴 Entwurf §2 Punkt 7: „Der dritte Zustand gilt fuer ALLE Objektarten." Beim Weg fehlte er bis
// zum 16.08.2026 -- und die Begruendung im Register war messbar falsch (Aufgabe 5b hat gemessen:
// die LESESEITE trug ihn laengst, nur der Schreibweg fehlte).
// 🔴 KEIN Bedienelement fuer den dritten Zustand -- gefallen am 16.08.2026 (Owner-Entscheid nach dem
// Durchklicken aller Oberflaechen). Hier stand bis dahin `true`.
// 💣 BEIM WEG IST DIE BEGRUENDUNG DIE STAERKSTE DER VIER: die Entscheidung wirkt ueber den ganzen
// NAMENSVERBUND (avesmapsApplyPathWikiNoArticleToNameGroup) -- genau so weit wie die Reparatur-Verben
// des Konfliktzentrums (avesmapsConflictRepairSpansNameGroup). Das Haekchen konnte diese Reichweite
// nur NACHBAUEN; zwei Knoepfe mit derselben Reichweite an zwei Orten warten auf ihren ersten
// Unterschied. Der MERKER, sein Schreibweg und die Verbund-Reichweite bleiben unangetastet.
assert.strictEqual(weg.extra && weg.extra.keinArtikelHaken, false,
	"das Haekchen ist zurueck -- der Owner hat es am 16.08.2026 abgewaehlt, die Begruendung steht im "
	+ "Feldregister. Wer es wieder einbaut, braucht einen neuen Entscheid.");
// 🪤 UND DER HINWEISTEXT IST MITGEFALLEN: ohne Haekchen liest das Bauteil `keinArtikelHinweis` nie,
// und ein Text, den niemand sieht, kann nur veralten. Er nannte die Verbund-Reichweite („Gilt fuer
// alle Abschnitte dieses Wegs") -- die steht jetzt im Register, wo sie gebraucht wird.
assert.strictEqual((weg.extra || {}).keinArtikelHinweis, undefined,
	"ein Hinweistext ohne Haekchen -- das Bauteil zeigt ihn nie, er kann nur noch veralten");
zaehl(); zaehl(); zaehl();

// Und das Haekchen erscheint in KEINEM Zustand -- in BEIDEN Huellen.
// 💣 Eine Probe nur an der Erklaerung saehe nicht, ob der Bauer sie liest.
["dt", "label-wiki"].forEach((huelle) => {
	const offenerKasten = avesmapsWikiAssignMarkup(
		avesmapsWikiAssignModell(weg, { artikel: null, keinArtikel: false, kartenwerte: {} }, { modus: "offen" }),
		avesmapsWikiAssignSkin(huelle));
	assert.strictEqual(offenerKasten.indexOf("data-wa-kein-artikel"), -1,
		huelle + ": der offene Zustand zeigt weiter ein Haekchen „Kein Wiki-Artikel vorhanden“");
	assert.strictEqual(offenerKasten.indexOf("Kein Wiki-Artikel vorhanden"), -1, huelle + ": " + offenerKasten);
	// 🔴 UND AUCH NICHT BEI GESETZTEM MERKER. Das ist der schaerfere Zweig: `hakenZeigen` im Bauteil
	// hat fuer den gesetzten Merker eine eigene Ausnahme (den „Ausweg" aus dem Widerspruch), und die
	// haengt allein an `extra.keinArtikelHaken`. Eine Probe nur am offenen Zustand saehe sie nicht --
	// und ein Weg, dem das Konfliktzentrum den Merker gesetzt hat, ist der Normalfall.
	const zugewiesenerKasten = (keinArtikel) => avesmapsWikiAssignMarkup(
		avesmapsWikiAssignModell(weg, {
			artikel: avesmapsWikiAssignWegArtikel({ wiki_key: "k", name: "N", kind: "strasse", wiki_url: "https://w/wiki/N" }),
			keinArtikel: keinArtikel, kartenwerte: {},
		}, {}), avesmapsWikiAssignSkin(huelle));
	assert.ok(zugewiesenerKasten(false).indexOf("data-wa-kein-artikel") === -1,
		huelle + ": neben einer Zuweisung steht ein leeres Haekchen");
	assert.strictEqual(zugewiesenerKasten(true).indexOf("data-wa-kein-artikel"), -1,
		huelle + ": ein GESETZTER Merker zeichnet neben einer Zuweisung doch ein Kaestchen -- der "
		+ "„Ausweg\"-Zweig von `hakenZeigen` fragt `extra.keinArtikelHaken` nicht");
	checks += 4;
});

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
// 🔴 SEIT DEM 16.08.2026 UNGEHAKT (Owner-Entscheid): der Kartenwert „Strasse" ist GEFUELLT, und ihn
// zu ersetzen ist eine Entscheidung, kein Vorschlag. Hier stand `true` -- die Zusicherung ist
// MITGEWANDERT, nicht geloescht. ⚠️ Die Regel wohnt in der Diff-Rechnung und gilt fuer ALLE
// Objektarten; der Weg ist nicht der Sonderfall, er ist der zweite Zeuge.
assert.strictEqual(diffAnders[0].gehakt, false,
	"ein gefuellter Kartenwert (feature_subtype) wird wieder vorangehakt");
assert.strictEqual(diffAnders[0].grund, "auf der Karte steht bereits ein Wert", diffAnders[0].grund);
// ⭐ Und die Gegenprobe, die die Regel von „gar nichts ist mehr gehakt" unterscheidet: ein LEERER
// Kartenwert (ein frisch gezeichneter Weg ohne Art) bleibt vorangehakt.
const diffLuecke = avesmapsWikiAssignDiff(weg.felder, { feature_subtype: "" }, wikiWerte, []);
assert.strictEqual(diffLuecke.length, 1);
assert.strictEqual(diffLuecke[0].gehakt, true, "das Fuellen einer Luecke ist nicht mehr vorangehakt");
assert.strictEqual(diffLuecke[0].grund, "");
zaehl(); zaehl(); zaehl(); zaehl(); zaehl(); zaehl(); zaehl(); zaehl(); zaehl();

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

// 🔴 KEIN BLAU (AGENTS.md §12), UND DAS IST BEI EINEM KONTROLLKAESTCHEN EINE EIGENE REGEL: ohne
// `accent-color` faerbt der Browser es in seiner Standardfarbe -- unter Windows blau. Die
// Rollenprobe darueber sieht das nicht (sie fragt nur, ob die Klasse IRGENDEINE Regel hat), und die
// zwei Huellen hatten es bis zum 16.08.2026 verschieden: `label-wiki` accent seit Aufgabe 4, `dt`
// browserblau. Aufgabe 5c hat den Haken in der `dt`-Huelle erst sichtbar gemacht -- also gehoert
// die Zusicherung hierher.
// ⚠️ Gesucht wird die Regel des BAUTEILS, nicht irgendeine Fundstelle von `accent-color`: der
// Selektor muss den Haken dieser Huelle nennen und der Wert ein Token sein.
[
	["label-wiki", "\\.label-wiki-reference__check\\s+input\\s*\\{[^}]*accent-color:\\s*var\\(--"],
	["dt", "\\.avm-wiki-assign\\s+\\.dt-check\\s+input\\s*\\{[^}]*accent-color:\\s*var\\(--"],
].forEach(([huelle, muster]) => {
	assert.ok(new RegExp(muster).test(allesCss),
		"Huelle „" + huelle + "“: das Kaestchen „Kein Wiki-Artikel vorhanden“ hat keine token-basierte "
		+ "`accent-color` -- der Browser faerbt es dann selbst, unter Windows BLAU (AGENTS.md §12)");
	zaehl();
});

// ── 8c) DIE ROLLE OHNE KLASSE — GENAU DIE, DIE DIE PROBE AUS 8) UEBERSPRINGT ──────────────────
// 💣 `skin.knopf` ist in der Huelle `dt` die LEERE Zeichenkette, und die Rollenprobe oben steigt
// bei einer leeren Klasse aus (`if (klasse === "") { return; }`). Genau dort lag der Befund vom
// 16.08.2026: der Kommentar bei `knopf: ""` versprach „die Editorseiten stylen den blanken
// <button> bereits weich" -- nachgezaehlt galt das fuer VIER der SECHS Wirte. Literatur und Karten
// stylen ausschliesslich ihre eigenen Knopfklassen; dort fiel der Knopf auf die Browservorgabe
// zurueck. Gemessen im Browser (Chrome, 16.08.2026): 21px hoch statt var(--avm-control-h) = 32px,
// Arial 13,3px statt `font: inherit`, 2px-Kantenrelief statt 1px var(--color-button-soft-border),
// Radius 0 statt var(--radius-md) -- im Dunkelbild ein WEISSER Systemknopf im dunklen Panel.
// ⚠️ EHRLICH GESAGT: diese Probe misst die REGEL, nicht das Bild -- eine Kaskade gibt es ohne
// Browser nicht. Sie haelt aber genau das fest, was gefehlt hat, und sie faellt, sobald jemand die
// Regel wieder in die Wirte zurueckverlagert („die Editorseiten koennen das doch selbst").
const editorPageCss = fs.readFileSync(path.join(wurzel, "css", "components", "editor-page.css"), "utf8");
const knopfRegel = /\.avm-wiki-assign\s+button\s*\{([^}]*)\}/.exec(allesCss);

// ZUERST DIE WIRTE, DANN DIE REGEL — die Reihenfolge ist Absicht. Nimmt jemand die geteilte Regel
// weg, soll die Probe die Oberflaechen BEIM NAMEN nennen, die dann nackt dastehen, statt nur
// „Regel fehlt" zu sagen. Ein Wirt ist eine
// html/*.html samt der Skripte, die sie einbindet (der Wege-Editor haengt das Bauteil aus
// js/pages/wege-editor.js ein, seine <body>-Klasse steht in der HTML-Seite).
// 💣 Diese Schleife ist der Grund, warum die Probe nicht bloss Form misst: nimmt man die geteilte
// Regel weg, nennt sie die Wirte BEIM NAMEN, die dann nackt dastehen.
const dtWirte = fs.readdirSync(path.join(wurzel, "html"))
	.filter((name) => name.endsWith(".html"))
	.map((name) => {
		const datei = path.join(wurzel, "html", name);
		const html = fs.readFileSync(datei, "utf8");
		let gesamt = html;
		(html.match(/<script src="\/js\/[^"]+"/g) || []).forEach((treffer) => {
			const rel = treffer.slice('<script src="/'.length, -1).split("?")[0];
			const skript = path.join(wurzel, rel);
			if (fs.existsSync(skript)) { gesamt += "\n" + fs.readFileSync(skript, "utf8"); }
		});
		return { name, html, gesamt };
	})
	.filter((wirt) => /skin:\s*"dt"/.test(wirt.gesamt));
assert.ok(dtWirte.length >= 6,
	"nur " + dtWirte.length + " Wirte der Huelle `dt` gefunden -- die Suche greift nicht mehr");
zaehl();
dtWirte.forEach((wirt) => {
	// 🔴 `^button {` am Zeilenanfang ist die Form, in der die zwei gesunden Wirte ihn fuehren
	// (html/wiki-sync-powerline-editor.html:43, html/wiki-sync-settlement-editor.html:55).
	const eigeneRegel = /^\s{0,4}button\s*\{/m.test(wirt.html)
		|| /<body[^>]*class="[^"]*avm-editor-body/.test(wirt.html);
	assert.ok(knopfRegel || eigeneRegel,
		"html/" + wirt.name + " haengt die Huelle `dt` ein, bringt aber keine Regel fuer deren "
		+ "klassenlose <button> mit -- und die geteilte `.avm-wiki-assign button` fehlt auch");
	zaehl();
});
assert.ok(knopfRegel,
	"keine CSS-Datei gibt `.avm-wiki-assign button` eine Regel -- die Huelle haengt damit wieder an "
	+ "den Wirten, und zwei von sechs haben keine");
zaehl();
["font: inherit", "min-height: var(--avm-control-h)"].forEach((pflicht) => {
	assert.ok(knopfRegel[1].replace(/\s+/g, " ").indexOf(pflicht) !== -1,
		"`.avm-wiki-assign button` fuehrt `" + pflicht + "` nicht -- genau die zwei Eigenschaften, "
		+ "deren Fehlen am 16.08.2026 als Arial 13,3px und 21px Hoehe gemessen wurde");
	zaehl();
});
// 🔴 UND SIE IST AUF DIE HUELLE EINGEENGT: ein Selektor, der in einer GETEILTEN Datei am Zeilenanfang
// mit `button` beginnt, traefe jede Editorseite -- die Fehlerklasse aus AGENTS.md §9 (eine
// erweiterte Selektorliste in legal-dialog.css liess fuenf Deploys hintereinander ausfallen).
assert.ok(!/^button\s*[,{]/m.test(editorPageCss.replace(/\/\*[\s\S]*?\*\//g, " ")),
	"css/components/editor-page.css traegt einen ungebundenen `button`-Selektor -- der trifft jede "
	+ "Editorseite, nicht nur den Zuweisungskasten");
zaehl();

// Und die zweite Kante desselben Befundes: die zwei Wirte, deren eigene Gruppenmarke (.ae-grp /
// .ce-grp) NUR einen unteren Aussenrand fuehrt, geben ihn dem Behaelter des Kastens selbst.
// 🔴 Er darf NICHT an die Huelle -- beim Kraftlinien-Editor folgt unmittelbar `.pl-hint`, dort
// verschoebe ein Aussenrand eine Oberflaeche, die in Ordnung ist.
[["game-literature-editor.html", "aeWikiAssign"], ["citymap-editor.html", "ceWikiAssign"]]
	.forEach(([datei, behaelter]) => {
		const text = fs.readFileSync(path.join(wurzel, "html", datei), "utf8");
		assert.ok(new RegExp("#" + behaelter + "\\s*\\{[^}]*margin-bottom:\\s*var\\(--space-").test(text),
			"html/" + datei + ": #" + behaelter + " fuehrt keinen unteren Aussenrand -- die naechste "
			+ "Gruppenueberschrift klebt an der letzten Zeile des Zuweisungskastens");
		zaehl();
	});
assert.ok(!/\.avm-wiki-assign\s*\{[^}]*margin-bottom/.test(allesCss),
	"die Huelle selbst traegt einen unteren Aussenrand -- das verschiebt die vier uebrigen "
	+ "dt-Editorfenster (im Kraftlinien-Editor folgt direkt `.pl-hint`)");
zaehl();

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
// typografischen Werte stehen deshalb in EINER Regel mit `.label-edit-section-title`, nicht
// daneben abgeschrieben. Bis zum 16.08.2026 waren es zwei Regeln mit denselben Werten; die
// Zusicherung verglich sie Zeichen fuer Zeichen. Jetzt gibt es nichts mehr zu vergleichen -- also
// wacht sie ueber das, was an die Stelle getreten ist: die GEMEINSAME Selektorliste.
// ⚠️ Was hier NICHT hingehoert: margin/padding/border-top. Die gehoeren einer alleinstehenden
// Ueberschrift; der Titel im Bauteil ist ein Flex-Kind neben den Knoepfen und bekaeme sonst eine
// Linie mitten in den Kasten.
const regionSyncCss = fs.readFileSync(path.join(wurzel, "css", "components", "region-sync.css"), "utf8");
function regelRumpf(css, selektorZeile) {
	const start = css.indexOf(selektorZeile + " {");
	assert.ok(start !== -1, "Regel nicht gefunden: " + selektorZeile);
	const rumpf = css.slice(start + selektorZeile.length + 2, css.indexOf("}", start));
	const werte = {};
	rumpf.split(";").forEach((zeile) => {
		const teil = zeile.replace(/\/\*[\s\S]*?\*\//g, " ").trim();
		const doppel = teil.indexOf(":");
		if (doppel > 0) { werte[teil.slice(0, doppel).trim()] = teil.slice(doppel + 1).trim(); }
	});
	return werte;
}
// ⚠️ Zeilenenden vereinheitlichen: die Datei liegt mit CRLF im Baum, der Selektor steht auf zwei
// Zeilen, und ein `indexOf` mit "\n" faende ihn sonst nie (gruene Probe, die nichts prueft).
const gemeinsam = ".label-edit-section-title,\n#path-edit-dialog .label-wiki-reference__title";
const gemeinsameWerte = regelRumpf(regionSyncCss.replace(/\r\n/g, "\n"), gemeinsam);
["font-family", "font-size", "text-transform", "letter-spacing", "color"].forEach((eigenschaft) => {
	assert.ok(Object.prototype.hasOwnProperty.call(gemeinsameWerte, eigenschaft),
		"Die gemeinsame Ueberschriften-Regel fuehrt „" + eigenschaft + "“ nicht mehr -- der Kopf der "
		+ "Wiki-Zuweisung und die Abschnittsueberschriften daneben koennen wieder auseinanderlaufen");
	zaehl();
});
// ⚠️ Und die Werte sind Token, keine Literale (AGENTS.md §12).
assert.strictEqual(gemeinsameWerte["font-family"], "var(--font-ui)");
assert.strictEqual(gemeinsameWerte["font-size"], "var(--font-size-small)");
assert.strictEqual(gemeinsameWerte["letter-spacing"], "var(--letter-spacing-caps)");
assert.strictEqual(gemeinsameWerte["color"], "var(--color-accent-brown)");
zaehl(); zaehl(); zaehl(); zaehl();
// Der Kastenteil bleibt der alleinstehenden Ueberschrift.
const nurUeberschrift = regelRumpf(regionSyncCss, ".label-edit-section-title");
assert.ok(nurUeberschrift["border-top"] !== undefined, "die Trennlinie der Abschnittsueberschrift ist weg");
assert.ok(gemeinsameWerte["border-top"] === undefined,
	"die gemeinsame Regel setzt eine Trennlinie -- der Kopf im Bauteil bekaeme eine Linie mitten in den Kasten");
zaehl(); zaehl();
// ⚠️ `font-weight` steht in einer EIGENEN, eingeengten Regel: die gemeinsame setzt keins (sie
// erbt 400), aber `.label-wiki-reference__title` setzt 600 -- das muss zurueckgenommen werden.
// ⚠️ Geprueft wird der TOKEN, nicht die Zahl. Eine Zusicherung auf `"400"` machte das spaetere
// Tokenisieren rot -- sie haette also genau die Aufraeumarbeit bestraft, die §12 verlangt.
const tokens = fs.readFileSync(path.join(wurzel, "css", "base", "tokens.css"), "utf8");
const kopfEigen = regelRumpf(regionSyncCss, "#path-edit-dialog .label-wiki-reference__title");
assert.strictEqual(kopfEigen["font-weight"], "var(--font-weight-regular)",
	"der Kopf traegt wieder das Gewicht 600 aus .label-wiki-reference__title und faellt aus der Rangfolge");
// Die benutzten Token sind wirklich angelegt, nicht nur benutzt.
assert.ok(/--font-weight-regular:\s*400;/.test(tokens), "der Token --font-weight-regular fehlt");
assert.ok(/--letter-spacing-caps:\s*0\.08em;/.test(tokens), "der Token --letter-spacing-caps fehlt");
zaehl(); zaehl(); zaehl();

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
	// 🪤 HIER STANDEN ZWEI WEITERE TEXTPROBEN -- „im Quelltext kommt `…WegZustand(` vor" und
	// „… `…WegAntwortPruefen(` vor". Beide waren BLIND: ein `try { … } catch { return {}; }` um
	// den Aufruf erfuellt sie, und genau diese Mutation lief bei der Pruefung von Aufgabe 4 gruen
	// durch. Ersetzt durch Verhaltensproben in Abschnitt 12 (der Bauer wird zum Werfen gebracht
	// und muss durch die Oberflaeche hindurch; `type_ok:false` muss beide Oberflaechen ablehnen
	// lassen). Was hier bleibt, ist nur, was eine Textprobe wirklich beantworten kann: WELCHES
	// Bauteil mit WELCHER Huelle und WELCHER Objektart angehaengt wird.
	checks += 4;
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
// ⚠️ `extras` traegt das, was ein Ereignis-Ziel ausser seinem Merkmal noch mitbringt -- beim
// Haekchen des dritten Zustands ist das `checked`, und `aufAenderung` liest es direkt.
function scheinZiel(merkmal, wert, extras) {
	const element = Object.assign({
		getAttribute: (name) => (name === merkmal ? wert : null),
		hasAttribute: (name) => name === merkmal,
	}, extras || {});
	element.closest = (selektor) => (selektor === "[" + merkmal + "]" ? element : null);
	return element;
}

const ruhe = () => new Promise((fertig) => setTimeout(fertig, 0));


// ── 12) DIE ZWEI OBERFLAECHEN, WIRKLICH GEFAHREN ──────────────────────────────────────────────
// 🪤 DIESER ABSCHNITT ERSETZT ZWEI ZUSICHERUNGEN, DIE BLIND WAREN. Die Pruefung von Aufgabe 4 hat
// beide mutiert und beide blieben gruen:
//   · `koerper.single_segment = true` im Wege-Editor (also die Zuweisung auf das EINE gewaehlte
//     Wegstueck eingeengt) -- geprueft wurde nur der BAUER (action/dry_run/confirm) und dass die
//     Oberflaeche ihn RUFT, nicht, dass sie sein Ergebnis unveraendert absendet. Damit war die
//     tragende Zusage dieser Aufgabe („ein Wiki-Weg haengt an ALLEN Segmenten zugleich") von
//     nichts gedeckt.
//   · `pathWikiZustand` im Kartendialog mit `try { … } catch { return {}; }` umbaut -- die Probe
//     fragte nur, ob `avesmapsWikiAssignWegZustand(` im QUELLTEXT vorkommt, und das tut es dann ja.
// ⭐ Beides sind Textproben, und eine Textprobe misst die FORM des Codes, nicht sein Verhalten.
// Ab hier werden die echten Rueckrufe der echten Oberflaechen gefahren.

const vm = require("vm");

// Eine Attrappe, die gerade genug kann: jedes Element beantwortet alles, Zuhoerer werden gemerkt.
function attrappe(name) {
	return {
		id: name, tagName: "DIV", value: "", checked: false, disabled: false, hidden: false,
		textContent: "", innerHTML: "", className: "", dataset: {}, style: {}, options: [],
		classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
		zuhoerer: {},
		addEventListener(typ, fn) { this.zuhoerer[typ] = fn; },
		removeEventListener() {},
		appendChild() {}, remove() {}, setAttribute() {}, getAttribute() { return null; },
		hasAttribute() { return false; },
		closest() { return null; },
		querySelector() { return attrappe("q"); },
		querySelectorAll() { return []; },
		getBoundingClientRect() { return { width: 100, height: 20, top: 0, left: 0 }; },
		focus() {}, dispatchEvent() { return true; }, contains() { return true; },
	};
}

/** Ein Sandkasten mit Dokument-Attrappe und aufgezeichnetem `fetch`. */
function sandkastenBauen(fetchAntwort) {
	const elemente = {};
	const gesendet = [];
	const dokument = {
		readyState: "complete",
		getElementById(id) { if (!elemente[id]) { elemente[id] = attrappe(id); } return elemente[id]; },
		querySelector() { return attrappe("q"); },
		querySelectorAll() { return []; },
		createElement(t) { return attrappe(t); },
		addEventListener() {},
		body: attrappe("body"), documentElement: attrappe("html"),
	};
	const kasten = {
		console, setTimeout, clearTimeout, setInterval, clearInterval, JSON, Math, Date, Number,
		String, Array, Object, Boolean, RegExp, Error, isFinite, isNaN, parseInt, parseFloat,
		encodeURIComponent, decodeURIComponent, Promise, Event: function () {},
		document: dokument,
		localStorage: { getItem() { return null; }, setItem() {} },
		matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
		confirm: () => true,
		fetch(url, opt) {
			const rumpf = opt && opt.body ? JSON.parse(opt.body) : null;
			gesendet.push({ url: String(url), rumpf: rumpf });
			return Promise.resolve({
				ok: true, status: 200,
				json: () => Promise.resolve(fetchAntwort(String(url), rumpf)),
			});
		},
		gemounted: [],
	};
	kasten.window = kasten;
	kasten.globalThis = kasten;
	vm.createContext(kasten);
	[
		"js/ui/filter-menu.js", "js/routing/travel-calendar.js", "js/pages/wege-editor-model.js",
		// ⚠️ Der geteilte Statuskreis-Bauer, seit 18.08.2026: `segmentRow` ruft ihn an jeder Zeile,
		// die einen Weg darstellt. Ohne ihn wirft `renderList` -- und zwar erst beim KLICK weiter
		// unten, also weit weg von der Ursache. ECHT geladen, keine Attrappe.
		"js/ui/listen-statuskreis.js",
		"js/ui/wiki-assign-registry.js", "js/ui/wiki-assign-diff.js", "js/ui/wiki-assign.js",
		"js/ui/wiki-assign-weg.js",
	].forEach((datei) => {
		vm.runInContext(fs.readFileSync(path.join(wurzel, datei), "utf8"), kasten, { filename: datei });
	});
	// Das Bauteil abfangen: so kommen wir an die Rueckrufe, die die Oberflaeche wirklich uebergibt.
	vm.runInContext("var echterMount = avesmapsWikiAssignMount;"
		+ "avesmapsWikiAssignMount = function (b, o) { gemounted.push(o); return echterMount(b, o); };", kasten);
	return { kasten: kasten, elemente: elemente, gesendet: gesendet };
}

// Ein Behaelter, der Klicks WIRKLICH ausloest -- `scheinBehaelter` aus Abschnitt 11 kann das
// bereits; hier steht nur der Name, unter dem Abschnitt 12 ihn benutzt.
const klickfaehigerBehaelter = scheinBehaelter;
const ruhe2 = () => new Promise((fertig) => setTimeout(fertig, 20));
const trefferProbe = avesmapsWikiAssignWegTreffer(zeile);

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

	// ---- 12a) DER WEGE-EDITOR: der Rumpf, den er WIRKLICH absendet ---------------------------
	// 💣 Hier sass die Mutation des Pruefers. Gefahren wird die echte Oberflaece: booten, einen Weg
	// in der Liste anklicken, den vom Bauteil eingesammelten `zuweisen`-Rueckruf rufen -- und dann
	// den abgesetzten POST-Rumpf ansehen.
	const w = sandkastenBauen((url) => {
		if (url.indexOf("action=list") !== -1) {
			return { ok: true, ways: [{
				public_id: "path-1", name: "Reichsstrasse-7", feature_subtype: "Strasse",
				show_label: true, allowed_transports: ["caravan"], transport_seasons: {},
				wiki_path: null, other_source: null, flow_direction: "", has_profile: true,
			}], summary: { total: 1 }, calibration: null };
		}
		if (url.indexOf("action=detail") !== -1) { return { ok: true, length_units: 10, terrain: null, landscapes: [] }; }
		if (url.indexOf("paths.php") !== -1) {
			return { ok: true, type_ok: true, applied: 3, segments: 3, wiki_name: "Kosch-Reichsstraße",
				wiki_display_name: "Kosch-Reichsstraße", segments_updated: [] };
		}
		return { ok: true };
	});
	vm.runInContext(fs.readFileSync(path.join(wurzel, "js/pages/wege-editor.js"), "utf8"), w.kasten,
		{ filename: "wege-editor.js" });
	await ruhe2();
	const liste = w.elemente.wpList;
	assert.ok(liste && liste.zuhoerer.click, "der Wege-Editor haengt keinen Klickzuhoerer an die Liste");
	const zeilenZiel = attrappe("row");
	zeilenZiel.dataset.id = "path-1";
	zeilenZiel.closest = () => zeilenZiel;
	zeilenZiel.getAttribute = (n) => (n === "data-id" ? "path-1" : null);
	liste.zuhoerer.click({ target: zeilenZiel, preventDefault() {} });
	await ruhe2();
	assert.ok(w.kasten.gemounted.length > 0, "der Wege-Editor haengt das Bauteil nicht an");
	const wOpt = w.kasten.gemounted[w.kasten.gemounted.length - 1];
	assert.strictEqual(wOpt.subject, "weg");
	assert.strictEqual(wOpt.skin, "dt");
	checks += 3;

	w.gesendet.length = 0;
	await wOpt.zuweisen(trefferProbe);
	const zuweisungen = w.gesendet.filter((s) => s.url.indexOf("/api/edit/wiki/paths.php") !== -1);
	assert.strictEqual(zuweisungen.length, 1, "der Wege-Editor schickt keine oder mehrere Zuweisungen: "
		+ JSON.stringify(w.gesendet.map((s) => s.url)));
	const rumpf = zuweisungen[0].rumpf;
	assert.strictEqual(rumpf.action, "assign_to");
	assert.strictEqual(rumpf.wiki_key, "wiki:reichsstrasse-kosch");
	assert.strictEqual(rumpf.public_id, "path-1");
	assert.strictEqual(rumpf.dry_run, false);
	assert.strictEqual(rumpf.confirm, "apply");
	// 🔴 DIE ZUSICHERUNG, UM DIE ES GEHT: der Weg haengt an ALLEN gleichnamigen Segmenten zugleich.
	// `single_segment: true` engte das auf das eine gewaehlte Wegstueck ein -- der Weg behielte auf
	// allen anderen seinen generischen Namen, und der Editor saehe erst beim naechsten Oeffnen,
	// dass nur ein Drittel verknuepft ist (api/edit/wiki/paths.php:83,
	// avesmapsWikiPathAssignTo :1047).
	assert.notStrictEqual(rumpf.single_segment, true,
		"der Wege-Editor engt die Zuweisung auf EIN Wegstueck ein -- der Wiki-Weg haengt an allen gleichnamigen Segmenten zugleich");
	checks += 7;

	// Und die Gegenprobe, dass diese Probe ueberhaupt etwas sieht: der Rumpf ist wirklich da.
	assert.ok(Object.keys(rumpf).length >= 5, JSON.stringify(rumpf));
	checks += 1;

	// ---- 12b) Ein NEIN des Servers erreicht den Wege-Editor als Ablehnung ---------------------
	const wNein = sandkastenBauen((url) => {
		if (url.indexOf("action=list") !== -1) {
			return { ok: true, ways: [{
				public_id: "path-1", name: "Aguera", feature_subtype: "Flussweg",
				show_label: true, allowed_transports: [], transport_seasons: {},
				wiki_path: null, other_source: null, flow_direction: "", has_profile: false,
			}], summary: { total: 1 }, calibration: null };
		}
		if (url.indexOf("action=detail") !== -1) { return { ok: true, length_units: 5, terrain: null, landscapes: [] }; }
		// 💣 Der Typriegel: HTTP 200, `ok:true`, aber NICHTS geschrieben.
		if (url.indexOf("paths.php") !== -1) {
			return { ok: true, type_ok: false, applied: 0, message: "Der Artikel ist ein Fluss, das Ziel eine Straße." };
		}
		return { ok: true };
	});
	vm.runInContext(fs.readFileSync(path.join(wurzel, "js/pages/wege-editor.js"), "utf8"), wNein.kasten,
		{ filename: "wege-editor.js" });
	await ruhe2();
	const liste2 = wNein.elemente.wpList;
	const ziel2 = attrappe("row2");
	ziel2.dataset.id = "path-1";
	ziel2.closest = () => ziel2;
	ziel2.getAttribute = (n) => (n === "data-id" ? "path-1" : null);
	liste2.zuhoerer.click({ target: ziel2, preventDefault() {} });
	await ruhe2();
	const wNeinOpt = wNein.kasten.gemounted[wNein.kasten.gemounted.length - 1];
	let abgelehnt = false;
	await wNeinOpt.zuweisen(trefferProbe).then(() => {}, () => { abgelehnt = true; });
	assert.ok(abgelehnt,
		"der Wege-Editor loest bei `type_ok:false` auf -- das Bauteil malte danach eine Zuweisung, die der Server nie geschrieben hat");
	checks += 1;

	// ---- 12c) Und `syncUebernehmen` lehnt ab, wenn es nichts tun kann ------------------------
	// 🔴 Derselbe Vertrag wie bei `zuweisen`/`loesen`. Ein stilles Aufloesen schloesse die Vorschau,
	// als sei uebernommen worden.
	//
	// 🪤 DIESE PROBE RIEF DEN RUECKRUF BIS ZUM 16.08.2026 DIREKT (`wNeinOpt.syncUebernehmen([])`)
	// und sah damit genau das nicht, worum es geht: die Oberflaeche wirft SYNCHRON, und
	// `Promise.resolve(opt.x())` fing das nicht -- der Fehler verliess den Klick-Zuhoerer
	// ungefangen. Wieder der Bauer statt der Verdrahtung, in derselben Nachbesserung, in der es um
	// genau diesen Unterschied ging. Gefahren wird deshalb der KLICKPFAD des echten Bauteils, mit
	// dem echten Rueckruf der echten Oberflaeche.
	const kastenSy = klickfaehigerBehaelter();
	const stSy = avesmapsWikiAssignMount(kastenSy, {
		subject: "weg", skin: "dt",
		laden: () => avesmapsWikiAssignWegZustand({
			wiki_path: { wiki_key: "wiki:x", name: "X", kind: "strasse", wiki_url: "https://w/wiki/X" },
			feature_subtype: "Strasse",
		}),
		syncUebernehmen: wNeinOpt.syncUebernehmen,
	});
	await stSy.neuLaden();
	let syncDurchschlag = null;
	try {
		kastenSy.feuere("click", scheinZiel("data-wa-aktion", "sync-uebernehmen"));
	} catch (fehler) {
		syncDurchschlag = fehler;
	}
	await ruhe();
	assert.strictEqual(syncDurchschlag, null,
		"der synchrone Wurf aus `syncUebernehmen` der Oberflaeche verlaesst den Klick-Zuhoerer ungefangen: "
		+ (syncDurchschlag && syncDurchschlag.message));
	// Und die Vorschau ist NICHT geschlossen worden -- „nichts passiert" heisst: der Kasten bleibt.
	assert.ok(kastenSy.innerHTML.indexOf('data-wa-aktion="sync-uebernehmen"') === -1
		|| kastenSy.innerHTML.indexOf("Aus dem Wiki übernehmen") !== -1,
		"nach einer abgelehnten Uebernahme ist der Kasten in einen anderen Zustand gesprungen");
	checks += 2;

	// Gegenprobe am Rueckruf selbst: er WIRFT, statt still aufzuloesen.
	let syncAbgelehnt = false;
	try { wNeinOpt.syncUebernehmen([]); } catch (fehler) { syncAbgelehnt = true; }
	assert.ok(syncAbgelehnt, "`syncUebernehmen` loest still auf, wenn es nichts uebernehmen kann");
	checks += 1;

	// ---- 12d) DER KARTENDIALOG: `laden` LEHNT AB, statt etwas Leeres zu liefern ---------------
	// 💣 Hier sass die zweite Mutation des Pruefers. Gefahren wird der echte Rueckruf der echten
	// Oberflaeche -- ein `try { … } catch { return {}; }` um den Zustandsbauer faellt hier auf,
	// waehrend die alte Textprobe gruen blieb.
	const k = sandkastenBauen((url) => {
		if (url.indexOf("clear_assign") !== -1) { return { ok: true, segments: 1, generic_name: "Strasse-9", segments_updated: [] }; }
		return { ok: true, type_ok: true, applied: 3, wiki_name: "Kosch-Reichsstraße", segments_updated: [] };
	});
	// Die Globalen, die der Kartendialog von seinen Nachbarn erwartet.
	vm.runInContext("var pathEditFeature = null;"
		+ "function apiErrorMessage(d, f) { return (d && d.error && d.error.message) || f; }"
		+ "function showFeedbackToast() {}"
		+ "function findPathByPublicId() { return null; }"
		+ "function toggleOtherSourceSection() {}"
		+ "function syncPathAutoNameControls() {}"
		+ "function renderPathFlowSection() {}"
		+ "function setPathEditStatus() {}"
		+ "function syncPathLabels() {}"
		+ "function refreshPathLayerPopup() {}", k.kasten);
	vm.runInContext(fs.readFileSync(path.join(wurzel, "js/review/review-path-wiki.js"), "utf8"), k.kasten,
		{ filename: "review-path-wiki.js" });

	// (1) Ohne Weg im Dialog MUSS der Rueckruf werfen -- nicht `{}` liefern.
	assert.throws(() => k.kasten.pathWikiZustand(),
		"der Kartendialog liefert ohne Weg im Dialog einen Zustand, statt zu werfen -- das Bauteil "
		+ "hielte sich fuer geladen und ein Speichern loeschte die Zuweisung auf allen Segmenten");
	checks += 1;

	// (2) Und die Folge daraus, ueber das echte Bauteil: kein Schreibwert.
	const kastenLeer = { textContent: "", innerHTML: "", addEventListener() {}, removeEventListener() {}, querySelector() { return null; } };
	const stLeer = k.kasten.avesmapsWikiAssignMount(kastenLeer, {
		subject: "weg", skin: "label-wiki", laden: k.kasten.pathWikiZustand,
	});
	await stLeer.neuLaden();
	assert.strictEqual(stLeer.bereit, false, "ohne lesbaren Stand meldet sich das Bauteil trotzdem bereit");
	assert.strictEqual(stLeer.lies(), null, "ohne lesbaren Stand liefert lies() einen Schreibwert");
	checks += 2;

	// 🪤 (2b) UND DIE HALBE FASSUNG DERSELBEN MUTATION. Beim Nachspielen fiel auf: ein
	// `try { … } catch { return {}; }` um NUR den unteren Teil der Funktion laesst (1) gruen --
	// die fruehe Wache wirft ja weiter. Geschluckt wuerde dann alles, was der geteilte Bauer
	// meldet. Also wird er selbst zum Werfen gebracht: was er sagt, MUSS durch die Oberflaeche
	// hindurch. Das faengt ein `catch` an JEDER Stelle der Funktion, ohne den Quelltext zu lesen.
	const echterBauer = k.kasten.avesmapsWikiAssignWegZustand;
	k.kasten.avesmapsWikiAssignWegZustand = () => { throw new Error("Bauer sagt nein"); };
	vm.runInContext("pathEditFeature = { properties: { public_id: 'path-7', feature_subtype: 'Strasse' } };", k.kasten);
	assert.throws(() => k.kasten.pathWikiZustand(), /Bauer sagt nein/,
		"der Kartendialog schluckt einen Fehler des geteilten Zustandsbauers");
	k.kasten.avesmapsWikiAssignWegZustand = echterBauer;
	checks += 1;

	// Dasselbe im Wege-Editor -- und das ist zugleich die einzige Art, dort an den Fehlerpfad zu
	// kommen: `state.draft` ist nach der ersten Auswahl nie wieder leer, die Wache davor also
	// Tiefenstaffelung. Der Bauer dagegen ist von aussen erreichbar.
	const echterBauerW = w.kasten.avesmapsWikiAssignWegZustand;
	w.kasten.avesmapsWikiAssignWegZustand = () => { throw new Error("Bauer sagt nein"); };
	assert.throws(() => wOpt.laden(), /Bauer sagt nein/,
		"der Wege-Editor schluckt einen Fehler des geteilten Zustandsbauers");
	w.kasten.avesmapsWikiAssignWegZustand = echterBauerW;
	checks += 1;

	// (3) Mit einem Weg im Dialog liefert derselbe Rueckruf einen gueltigen Zustand.
	vm.runInContext("pathEditFeature = { properties: { public_id: 'path-7', feature_subtype: 'Strasse',"
		+ " wiki_path: { wiki_key: 'wiki:aguera', name: 'Aguera', kind: 'fluss', wiki_url: 'https://w/wiki/Aguera' } } };", k.kasten);
	const zustand = k.kasten.pathWikiZustand();
	assert.strictEqual(zustand.artikel.wiki_key, "wiki:aguera");
	checks += 1;

	// ---- 12e) DER KARTENDIALOG: der Rumpf, den er WIRKLICH absendet --------------------------
	k.gesendet.length = 0;
	await k.kasten.pathWikiZuweisen(trefferProbe);
	const kZuweisungen = k.gesendet.filter((s) => s.url.indexOf("/api/edit/wiki/paths.php") !== -1);
	assert.strictEqual(kZuweisungen.length, 1, JSON.stringify(k.gesendet.map((s) => s.url)));
	const kRumpf = kZuweisungen[0].rumpf;
	assert.strictEqual(kRumpf.action, "assign_to");
	assert.strictEqual(kRumpf.wiki_key, "wiki:reichsstrasse-kosch");
	assert.strictEqual(kRumpf.public_id, "path-7");
	assert.strictEqual(kRumpf.dry_run, false);
	assert.strictEqual(kRumpf.confirm, "apply");
	// 🔴 Dieselbe Zusicherung wie beim Wege-Editor: die Zuweisung gilt dem GANZEN Weg.
	assert.notStrictEqual(kRumpf.single_segment, true,
		"der Kartendialog engt die Zuweisung auf EIN Segment ein -- der Wiki-Weg haengt an allen gleichnamigen Segmenten zugleich");
	checks += 7;

	// Und auch im Kartendialog ist `type_ok:false` ein NEIN -- HTTP 200, `ok:true`, nichts
	// geschrieben. Eigener Sandkasten, weil die Antwort eine andere ist.
	const kNein = sandkastenBauen(() => ({ ok: true, type_ok: false, applied: 0, message: "Typ passt nicht." }));
	vm.runInContext("var pathEditFeature = { properties: { public_id: 'path-7', feature_subtype: 'Strasse' } };"
		+ "function apiErrorMessage(d, f) { return f; } function showFeedbackToast() {}"
		+ "function findPathByPublicId() { return null; } function toggleOtherSourceSection() {}"
		+ "function syncPathAutoNameControls() {} function renderPathFlowSection() {}"
		+ "function setPathEditStatus() {} function syncPathLabels() {} function refreshPathLayerPopup() {}", kNein.kasten);
	vm.runInContext(fs.readFileSync(path.join(wurzel, "js/review/review-path-wiki.js"), "utf8"), kNein.kasten,
		{ filename: "review-path-wiki.js" });
	let kAbgelehnt = false;
	await kNein.kasten.pathWikiZuweisen(trefferProbe).then(() => {}, () => { kAbgelehnt = true; });
	assert.ok(kAbgelehnt,
		"der Kartendialog loest bei `type_ok:false` auf -- das Bauteil malte danach eine Zuweisung, die der Server nie geschrieben hat");
	checks += 1;

	// ---- 12f) Und das Entfernen fragt ZUERST, bevor es den ganzen Weg loest -------------------
	// 🔴 Owner-Regel vom 05.07.2026: „Entfernen" darf nie ungefragt den ganzen Weg abraeumen. Der
	// erste Ruf ist deshalb ein `dry_run`, der die Reichweite misst.
	k.gesendet.length = 0;
	await k.kasten.pathWikiLoesen();
	const loesRufe = k.gesendet.filter((s) => s.rumpf && s.rumpf.action === "clear_assign");
	assert.strictEqual(loesRufe.length, 2, "das Entfernen misst seine Reichweite nicht vorher: "
		+ JSON.stringify(loesRufe.map((r) => r.rumpf)));
	assert.strictEqual(loesRufe[0].rumpf.dry_run, true, "der erste Ruf schreibt schon");
	assert.strictEqual(loesRufe[1].rumpf.dry_run, false);
	assert.strictEqual(loesRufe[1].rumpf.confirm, "apply");
	checks += 4;

	// ── 13) DER MERKER UEBERLEBT EIN SPEICHERN -- DURCH BEIDE OBERFLAECHEN GEFAHREN ────────────
	// 🔴 SEIT DEM 16.08.2026 IST DAS DIE GANZE FRAGE. Hier standen die zwei Richtungen des Haekchens
	// (setzen / abwaehlen); das Bedienelement ist mit dem Owner-Entscheid gefallen, der Merker nicht.
	// Was bleibt, ist der EINE Ablauf, auf dem diese Aenderung Daten zerstoeren koennte: ein Weg, dem
	// das Konfliktzentrum `wiki_no_article` gesetzt hat, wird in einem Editor geoeffnet und
	// gespeichert -- der Schluessel darf im Rumpf NICHT auftauchen, denn jeder Wert dort (auch `true`)
	// waere ein Schreibvorgang auf eine fremde Entscheidung. Nur die ABWESENHEIT laesst sie stehen
	// (avesmapsApplyPathWikiNoArticle liest sie als „nicht geaendert").
	//
	// 🪤 DIE LEHRE AUS 5b GILT WEITER, nur andersherum: eine Fixture OHNE Merker kann diesen Ablauf
	// gar nicht pruefen -- dort ist „nicht geschrieben" von „es war ohnehin false" nicht zu
	// unterscheiden. Es gibt deshalb je Oberflaeche weiter ZWEI Fixtures, und die Zusicherung, auf
	// die es ankommt, haengt an der MIT Merker.

	/** Ein Wege-Editor-Sandkasten, dessen EINZIGER Weg den Merker im gewaehlten Stand traegt. */
	async function wegeEditorMitMerker(merker) {
		const s = sandkastenBauen((url) => {
			if (url.indexOf("action=list") !== -1) {
				return { ok: true, ways: [{
					public_id: "path-1", name: "Reichsstrasse-7", feature_subtype: "Strasse",
					show_label: true, allowed_transports: ["caravan"], transport_seasons: {},
					wiki_path: null, other_source: null, flow_direction: "", has_profile: true,
					// 🔴 GENAU DAS FELD, das api/edit/map/paths-editor.php seit dem 16.08.2026 mitgibt.
					// Seine Liste ist eine WEISSE LISTE -- ohne die Zeile dort kaeme hier `undefined` an
					// und das Haekchen startete bei JEDEM Weg leer.
					wiki_no_article: merker,
				}], summary: { total: 1 }, calibration: null };
			}
			if (url.indexOf("action=detail") !== -1) { return { ok: true, length_units: 10, terrain: null, landscapes: [] }; }
			return { ok: true };
		});
		vm.runInContext(fs.readFileSync(path.join(wurzel, "js/pages/wege-editor.js"), "utf8"), s.kasten,
			{ filename: "wege-editor.js" });
		await ruhe2();
		const ziel = attrappe("row");
		ziel.dataset.id = "path-1";
		ziel.closest = () => ziel;
		ziel.getAttribute = (n) => (n === "data-id" ? "path-1" : null);
		s.elemente.wpList.zuhoerer.click({ target: ziel, preventDefault() {} });
		await ruhe2();
		return s;
	}

	/** „Speichern" wirklich druecken und den abgesetzten Rumpf holen. */
	async function wegeEditorSpeichern(s) {
		s.gesendet.length = 0;
		s.elemente.wpSave.zuhoerer.click({ target: s.elemente.wpSave, preventDefault() {} });
		await ruhe2();
		const rufe = s.gesendet.filter((g) => g.rumpf && g.rumpf.action === "update_path_details");
		assert.strictEqual(rufe.length, 1, "der Wege-Editor hat nicht genau einmal gespeichert: "
			+ JSON.stringify(s.gesendet.map((g) => g.url)));
		return rufe[0].rumpf;
	}

	// ---- 13a) WEGE-EDITOR, Fixture OHNE Merker: kein Bedienelement, kein Schluessel ------------
	const wOhne = await wegeEditorMitMerker(false);
	const hostOhne = wOhne.elemente.wpWikiAssign;
	assert.strictEqual(hostOhne.innerHTML.indexOf("Kein Wiki-Artikel vorhanden"), -1,
		"der Wege-Editor zeigt den dritten Zustand weiter: " + hostOhne.innerHTML);
	assert.strictEqual(hostOhne.innerHTML.indexOf("data-wa-kein-artikel"), -1,
		"der Wege-Editor zeichnet das Kaestchen weiter: " + hostOhne.innerHTML);
	const rumpfOhneAnfassen = await wegeEditorSpeichern(wOhne);
	assert.ok(!("wiki_no_article" in rumpfOhneAnfassen),
		"der Merker steht im Speicher-Rumpf: " + JSON.stringify(rumpfOhneAnfassen));
	checks += 3;

	// ---- 13b) 🔴 WEGE-EDITOR, Fixture MIT Merker: DER ABLAUF, DER DATEN ZERSTOEREN KOENNTE -----
	const wMit = await wegeEditorMitMerker(true);
	const hostMit = wMit.elemente.wpWikiAssign;
	// 💣 Der ganze LESEWEG steckt weiter in der Fixture: paths-editor.php → Liste → Entwurf →
	// avesmapsWikiAssignWegZustand. Er bleibt gebaut, auch ohne Bedienelement -- eine Zuweisung muss
	// den Merker weiterhin beantworten koennen.
	// 🔴 Und der GESETZTE Merker zeichnet trotzdem kein Kaestchen: das ist der schaerfere Zweig
	// (`hakenZeigen` hat fuer ihn eine eigene Ausnahme).
	assert.strictEqual(hostMit.innerHTML.indexOf("data-wa-kein-artikel"), -1,
		"ein GESETZTER Merker zeichnet das Haekchen doch: " + hostMit.innerHTML);
	// 🔴 DIE ZUSICHERUNG, AUF DIE ES ANKOMMT: speichern, ohne die Zuweisung anzufassen -- der
	// Schluessel darf NICHT im Rumpf stehen, sonst nimmt dieser Editor die Entscheidung des
	// Konfliktzentrums still zurueck.
	const rumpfMitUnberuehrt = await wegeEditorSpeichern(wMit);
	assert.ok(!("wiki_no_article" in rumpfMitUnberuehrt),
		"der gespeicherte Merker wird ueberschrieben -- die Entscheidung des Konfliktzentrums geht "
		+ "verloren: " + JSON.stringify(rumpfMitUnberuehrt));
	// Und auch ein zweites Speichern aendert daran nichts (kein Zustand, der beim ersten Mal kippt).
	assert.ok(!("wiki_no_article" in await wegeEditorSpeichern(wMit)),
		"beim zweiten Speichern reist der Merker doch mit");
	checks += 3;

	// ---- 13c) KARTENDIALOG: derselbe Ablauf an `buildPathEditPayload` -------------------------
	// 🔴 NICHT der Bauer allein, sondern die VERDRAHTUNG: der Payload-Bauer wohnt in
	// js/review/review-paths.js, das Haekchen im Bauteil, und dazwischen steht
	// pathWikiKeinArtikelFuerPayload (js/review/review-path-wiki.js).
	// ⚠️ `FormData` ist nachgebaut, und zwar mit der EINEN Eigenschaft, auf der die Regel steht: ein
	// Feld, das es nicht gibt, liefert `null` -- nicht "".
	const KARTEN_NACHBARN = "var pathEditFeature = null;"
		+ "function apiErrorMessage(d, f) { return f; }"
		+ "function showFeedbackToast() {}"
		+ "function findPathByPublicId() { return null; }"
		+ "function toggleOtherSourceSection() {}"
		+ "function syncPathAutoNameControls() {}"
		+ "function renderPathFlowSection() {}"
		+ "var letzterStatus = '';"
		+ "function setPathEditStatus(t) { letzterStatus = String(t || ''); }"
		+ "function syncPathLabels() {}"
		+ "function refreshPathLayerPopup() {}"
		+ "function getPathDisplayName() { return 'Reichsstrasse-7'; }"
		+ "function getPathDisplayNameOrGenerated(n) { return String(n || ''); }"
		+ "function getNextPathDisplayName() { return 'Strasse-1'; }"
		+ "function getDefaultTransportDomainForPathSubtype() { return 'land'; }"
		+ "function normalizePathSubtype(v) { return String(v || 'Weg'); }"
		+ "function readPathSeasonsFromForm() { return {}; }"
		+ "function readOtherSourceFromForm() { return { url: '', label: '' }; }"
		+ "function shouldPathNameBeDisplayed() { return true; }"
		+ "function getPathEditFormElement() { return null; }"
		+ "function acquireFeatureSoftLock() {}"
		+ "var lastPathEditSettings = null;"
		+ "function FormData(el) { this._w = (el && el.werte) || {}; }"
		+ "FormData.prototype.get = function (n) {"
		+ "  return Object.prototype.hasOwnProperty.call(this._w, n) ? this._w[n] : null; };";
	const KARTEN_FORMULAR = { public_id: "path-7", name: "Reichsstrasse-7", feature_subtype: "Strasse", autoname: "on" };

	async function kartendialogMitMerker(merker, zeichnen) {
		const s = sandkastenBauen(() => ({ ok: true, rows: [] }));
		vm.runInContext(KARTEN_NACHBARN, s.kasten);
		vm.runInContext(fs.readFileSync(path.join(wurzel, "js/review/review-path-wiki.js"), "utf8"), s.kasten,
			{ filename: "review-path-wiki.js" });
		vm.runInContext(fs.readFileSync(path.join(wurzel, "js/review/review-paths.js"), "utf8"), s.kasten,
			{ filename: "review-paths.js" });
		vm.runInContext("pathEditFeature = { id: 'path-7', properties: { public_id: 'path-7',"
			+ " feature_subtype: 'Strasse', wiki_no_article: " + (merker ? "true" : "false") + " } };", s.kasten);
		if (zeichnen !== false) {
			vm.runInContext("renderPathWikiReference();", s.kasten);
			await ruhe();
		}
		s.baue = () => JSON.parse(vm.runInContext(
			"JSON.stringify(buildPathEditPayload({ werte: " + JSON.stringify(KARTEN_FORMULAR)
			+ ", querySelectorAll: function () { return []; } }))", s.kasten));
		return s;
	}

	// Fixture OHNE Merker: kein Bedienelement, kein Schluessel.
	const kOhne = await kartendialogMitMerker(false);
	const kHostOhne = kOhne.elemente["path-wiki-assign-host"];
	assert.strictEqual(kHostOhne.innerHTML.indexOf("Kein Wiki-Artikel vorhanden"), -1,
		"der Kartendialog zeigt den dritten Zustand weiter: " + kHostOhne.innerHTML);
	assert.strictEqual(kHostOhne.innerHTML.indexOf("data-wa-kein-artikel"), -1,
		"der Kartendialog zeichnet das Kaestchen weiter: " + kHostOhne.innerHTML);
	assert.ok(!("wiki_no_article" in kOhne.baue()),
		"der Merker steht im Speicher-Payload des Kartendialogs");
	checks += 3;

	// 🔴 Fixture MIT Merker: DER ABLAUF, DER DATEN ZERSTOEREN KOENNTE -- derselbe wie im Editor.
	const kMit = await kartendialogMitMerker(true);
	const kHostMit = kMit.elemente["path-wiki-assign-host"];
	// 💣 Der Leseweg des Kartendialogs bleibt gebaut: Kartenpayload → pathEditFeature.properties →
	// pathWikiZustand. Nur zeichnet er kein Kaestchen mehr -- auch nicht bei GESETZTEM Merker.
	assert.strictEqual(kHostMit.innerHTML.indexOf("data-wa-kein-artikel"), -1,
		"ein GESETZTER Merker zeichnet das Haekchen doch: " + kHostMit.innerHTML);
	assert.ok(!("wiki_no_article" in kMit.baue()),
		"der gespeicherte Merker wird ueberschrieben -- die Entscheidung des Konfliktzentrums geht verloren");
	assert.ok(!("wiki_no_article" in kMit.baue()),
		"beim zweiten Bauen reist der Merker doch mit");
	checks += 3;

	// ---- 13d) 🔴 UND DER PAYLOAD-BAUER KENNT DEN SCHLUESSEL GAR NICHT MEHR --------------------
	// 💣 Hier stand die Blindgaenger-Probe (`pathWikiKeinArtikelFuerPayload() === null`). Die Funktion
	// ist am 16.08.2026 mit dem Haekchen gefallen -- an ihre Stelle tritt die schaerfere Zusicherung:
	// AUCH ohne angehaengtes Bauteil steht der Merker nicht im Payload, und zwar weil ihn niemand mehr
	// hineinschreibt. Ein Rueckbau, der die drei Zeilen wieder einbaut, faellt hier auf.
	const kBlind = await kartendialogMitMerker(true, false);
	assert.strictEqual(vm.runInContext("typeof pathWikiKeinArtikelFuerPayload", kBlind.kasten), "undefined",
		"pathWikiKeinArtikelFuerPayload ist zurueck -- der Kartendialog schriebe den Merker wieder");
	assert.ok(!("wiki_no_article" in kBlind.baue()),
		"ohne angehaengtes Bauteil steht der Merker trotzdem im Payload");
	checks += 2;

	console.log("wiki-assign-weg: " + checks + " Zusicherungen erfuellt");
})();
