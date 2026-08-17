// Der Zustandsrechner hinter dem Listensymbol „Wie steht diese Zeile zum Wiki?“
//
// 🔴 DIESER TEST IST DIE ABNAHMELISTE, UND SIE HAT ZWEI SEITEN. Die eine ist leicht zu erfüllen
// (irgendetwas finden), die andere ist der eigentliche Nutzen: **ein Symbol, das überall
// dasselbe sagt, ist so nutzlos wie keins.** Deshalb steht hier neben den vier Namen, die einen
// Kandidaten bekommen MÜSSEN, die vollständige Liste der 16 automatisch benannten Ortspaare, von
// denen KEINES einen bekommen darf.
//
// 🔴 FÜNF FORMEN (Owner-Entscheid 17.08.2026), und die Leitidee dahinter ist
// **durchgezogen = erledigt, gestrichelt = offen**:
//
//   ① zugewiesen ............ gefüllt
//   ② teilweise zugewiesen .. halb gefüllt
//   ③ kein Wiki-Artikel ..... durchgezogene Kontur, leer   (erledigt, aber ohne Artikel)
//   ④ offen, Kandidat da .... gestrichelte Kontur mit Punkt
//   ⑥ offen, nichts gefunden  gestrichelte Kontur, leer
//
// ⚠️ ④ deckt den wortgleichen Treffer UND den unscharfen Kandidaten. Der Unterschied wird nicht
// weggeworfen — er lebt als Befund weiter und steht im Tooltip; er bekommt nur keine eigene Form.
//
// Die Namen sind echt: 62 Namensgruppen aus 165 Segmenten, am 17.08.2026 aus der Live-Nutzlast
// (GET /api/app/map-features.php) gezogen. Öffentliche Kartendaten, keine Betriebsdaten. Ebenso
// gemessen (zweiter Abruf desselben Tages) sind die vier Gruppen, die eine Zuweisung oder den
// Merker „kein Artikel“ tragen — samt ihrer Segmentzahl.
//
// ⚠️ DER KATALOG DIESER FIXTURE IST UNVOLLSTÄNDIG, UND DAS IST BEWUSST SO. Der echte trägt 23
// Artikel; ohne angemeldete Sitzung waren 21 rekonstruierbar — 18 aus den `wiki_powerline`-Nestern
// der Live-Nutzlast, 3 aus dem Mockup. 🪤 **Die wortgleichen Treffer sind live 17, nicht 16**;
// mit den 21 Artikeln dieser Fixture kommen 16 heraus. Die Zahl 16 gehört also der FIXTURE, nicht
// dem Projekt — wer sie irgendwo als Projektzahl abschreibt, schreibt sie falsch ab. Dieselbe
// Vorsicht gilt für die Verteilung unten: hier 20 Kandidatenformen, live 21.
//
// Entwurf/Mockup: docs/listensymbol-wiki-mockup.html (Owner-Abnahme 17.08.2026).
//
// Run: node js/review/__tests__/wikistatus-abgleich.test.js

"use strict";

const assert = require("assert");
const path = require("path");

const {
	avesmapsWikistatusForm,
	avesmapsWikistatusZustand,
	avesmapsWikistatusMarkup,
} = require(path.resolve(__dirname, "..", "review-list-wikistatus.js"));

let checks = 0;

// ---- Die Wirklichkeit, gemessen 17.08.2026 -----------------------------------------------------
const KRAFTLINIEN = [
	"Akrabaal - Kreuzung",
	"Aldyra - Kuslik",
	"Altoum-Linie",
	"Arteria Magica",
	"Astralrisslinie",
	"Atem der Äonen",
	"Bann der Tiefe",
	"Bann-Linie",
	"Basiliuslinie",
	"Brig-Lo - Oberfels",
	"Brücke nach Akrabaal",
	"Bymazars Spiegelpfad",
	"Chalwens Griff",
	"Drachenblick",
	"Elementares Hexagramm",
	"Elementarlinie",
	"Fächer der Macht",
	"Feenflügel",
	"Gareth - Reichsabtei St. Praiodan",
	"Greifenfurt - Reichsabtei St. Praiodan",
	"Heilige Quellen zu Ilsur - Warunk",
	"Hexenband",
	"Hexenband(-schleife)",
	"Hursachquelle",
	"Kette der Zyklopen",
	"Khezzara - Arras de Mott",
	"Klirrfrostsaite (Zwölfseitige Götterharfe)",
	"Knochenpfad",
	"Konzilslinie",
	"Kreuzung - Akrabaal",
	"Kreuzung - Despiona",
	"Kreuzung - Heilige Quellen zu Ilsur",
	"Kreuzung - Kreuzung",
	"Kreuzung - Olat",
	"Kreuzung - Warunk",
	"Leidensband",
	"Lichtfinderlinie",
	"Madas Kelch",
	"Maraskanstachel",
	"Mittellandlinie",
	"Nelkra-Linie",
	"Neunaugensee-Ader I",
	"Pfade des Lichts",
	"Punin - Then",
	"Runenpfad der Hjaldinger",
	"Satinavs Kette I",
	"Satinavs Kette II",
	"Schlüssellinie des Eises",
	"Septima",
	"Strick des Schwarzen Mannes",
	"Szepter der Macht",
	"Temporalline der Sündenpfühle",
	"Thalusische Liniea",
	"Tobrische Linie I",
	"Tobrische Linie II",
	"Torweg",
	"Unsichtbarer Turm - Punin",
	"Vayafendur - Zitadelle des Eises",
	"Wandelband",
	"Wasserscheide",
	"Weg des Diskus",
	"Yaquirlinie",
];

// Die 16 automatisch benannten Paare („<Knoten A> - <Knoten B>“). Ausgeschrieben statt über ein
// Muster erkannt: ein Muster im Test wäre dieselbe Vermutung, die der Abgleich treffen soll.
const PAARE = [
	"Akrabaal - Kreuzung",
	"Aldyra - Kuslik",
	"Brig-Lo - Oberfels",
	"Gareth - Reichsabtei St. Praiodan",
	"Greifenfurt - Reichsabtei St. Praiodan",
	"Heilige Quellen zu Ilsur - Warunk",
	"Khezzara - Arras de Mott",
	"Kreuzung - Akrabaal",
	"Kreuzung - Despiona",
	"Kreuzung - Heilige Quellen zu Ilsur",
	"Kreuzung - Kreuzung",
	"Kreuzung - Olat",
	"Kreuzung - Warunk",
	"Punin - Then",
	"Unsichtbarer Turm - Punin",
	"Vayafendur - Zitadelle des Eises",
];

const KATALOG = [
	// 18 aus den wiki_powerline-Nestern der Live-Nutzlast
	"Arteria Magica",
	"Bann-Linie",
	"Basiliuslinie",
	"Elementares Hexagramm",
	"Fächer der Macht",
	"Hexenband",
	"Kette der Zyklopen",
	"Konzilslinie",
	"Madas Kelch",
	"Schlüssellinie des Eises",
	"Septima",
	"Strick des Schwarzen Mannes",
	"Szepter der Macht",
	"Torweg",
	"Wandelband",
	"Wasserscheide",
	"Weg des Diskus",
	"Yaquirlinie",
	// 3 aus dem Mockup — die Zielartikel der vier Kandidatenfälle
	"Brücke von Akrabaal",
	"Satinavs Ketten",
	"Zwölfsaitige Götterharfe",
].map((name) => ({ name, wiki_url: "https://de.wiki-aventurica.de/wiki/" + name, wiki_key: name }));

// Die vier Gruppen, die etwas anderes als einen Katalogfund tragen — gemessen 17.08.2026 aus der
// Live-Nutzlast, Zähler und Nenner aus DERSELBEN Zählung. Alle übrigen 58 Gruppen tragen weder
// eine Zuweisung noch den Merker; ihr Eintrag wäre `{}` und steht deshalb nicht hier.
// 🪤 Live gibt es KEINE teilweise zugewiesene Gruppe. Der Zustand ② wird darum weiter unten an
// einer gestellten Bilanz geprüft — am echten Bestand wäre er unprüfbar, und eine unprüfbare
// Zusicherung ist eine, die niemand bemerkt, wenn sie bricht.
const BILANZ = {
	"Elementares Hexagramm": { teile: 6, zugewieseneTeile: 6, keinArtikel: false },
	"Hexenband": { teile: 6, zugewieseneTeile: 6, keinArtikel: false },
	"Hursachquelle": { teile: 1, zugewieseneTeile: 0, keinArtikel: true },
	"Drachenblick": { teile: 4, zugewieseneTeile: 0, keinArtikel: true },
};
const OHNE_BEFUND = { teile: 0, zugewieseneTeile: 0, keinArtikel: false };

const zustand = (name) => avesmapsWikistatusZustand(name, KATALOG, BILANZ[name] || OHNE_BEFUND);

// ---- 0. Die zwei Vokabulare sind DISJUNKT --------------------------------------------------------
// 💣 Der Befund sagt, was gefunden wurde; die Form sagt, was gezeichnet wird. Teilte ein Wort
// beide Ebenen, wäre an keiner Fundstelle mehr zu erkennen, welche gemeint ist — und genau davon
// hängt ab, dass „treffer“ und „aehnlich“ in EINER Form zusammenfallen dürfen, ohne dass die
// Auskunft verlorengeht.
const BEFUNDE = ["zuweisung", "teilzuweisung", "kein_artikel", "treffer", "aehnlich", "nichts"];
const FORMEN = ["zugewiesen", "teilweise", "ohne-artikel", "kandidat", "offen"];
const doppelt = BEFUNDE.filter((wort) => FORMEN.indexOf(wort) >= 0);
assert.deepStrictEqual(doppelt, [],
	"Kein Wort darf Befund UND Form sein. Diese hier sind es: " + doppelt.join(", "));
checks++;
assert.deepStrictEqual(BEFUNDE.map(avesmapsWikistatusForm),
	["zugewiesen", "teilweise", "ohne-artikel", "kandidat", "kandidat", "offen"],
	"Die Zuordnung Befund -> Form ist die Belegung des Owners. 🔴 durchgezogen = erledigt, "
	+ "gestrichelt = offen: „zuweisung“ und „kein_artikel“ sind BEIDE abgeschlossen, „treffer“ und "
	+ "„aehnlich“ teilen die Kandidatenform, „nichts“ ist offen.");
checks++;

// ---- 1. MUSS gefunden werden: die vier gemessenen ähnlichen Treffer ----------------------------
// 💣 Der Fall, an dem der Nutzen des Symbols hängt: „Brücke nach Akrabaal“ trüge ohne ihn die
// leere gestrichelte Raute — also die ausdrückliche Auskunft „offen, kein Kandidat gefunden“ —,
// obwohl das Wiki „Brücke VON Akrabaal“ führt. Das Symbol sagte dem Leser dann nicht nichts,
// sondern das Gegenteil der Wahrheit.
const MUSS = [
	["Brücke nach Akrabaal", "Brücke von Akrabaal"],
	["Satinavs Kette I", "Satinavs Ketten"],
	["Satinavs Kette II", "Satinavs Ketten"],
	// Unser Name trägt einen Tippfehler („seitige“ statt „saitige“) UND ein Wort mehr. Beide
	// Schranken des Abgleichs — die Tippfehlerregel und die einseitige Deckung — hängen an ihm.
	["Klirrfrostsaite (Zwölfseitige Götterharfe)", "Zwölfsaitige Götterharfe"],
];
for (const [name, artikel] of MUSS) {
	const ergebnis = zustand(name);
	assert.strictEqual(ergebnis.befund, "aehnlich",
		`„${name}“ muss einen ähnlichen Treffer melden (erwartet der Artikel „${artikel}“), `
		+ `gemeldet wurde der Befund „${ergebnis.befund}“. Sonst trägt die Zeile die LEERE `
		+ "gestrichelte Raute und behauptet „nichts gefunden“, obwohl das Wiki den Artikel führt.");
	assert.strictEqual(ergebnis.form, "kandidat",
		`„${name}“ muss die gestrichelte Raute MIT PUNKT tragen, gemeldet wurde „${ergebnis.form}“.`);
	assert.strictEqual(ergebnis.artikel, artikel,
		`„${name}“ muss auf „${artikel}“ zeigen — der Tooltip nennt den Fund, und ein falscher Name `
		+ `schickt den Editor auf die falsche Wiki-Seite. Gemeldet: „${ergebnis.artikel}“.`);
	checks += 3;
}

// ---- 1b. Derselbe Fall mit dem SEITENTITEL statt dem Infobox-Namen ------------------------------
// 💣 Die zweite Richtung der Deckungsregel. Steht der Artikel unter seinem Seitentitel mit
// Begriffsklärung im Katalog, hat der ARTIKEL ein Wort mehr statt unser Name — eine einseitige
// Regel verlöre genau hier den Abnahmefall. Die Klammer wird NICHT abgeschnitten (das wäre bei
// einem Wiki-Titel richtig, siehe avesmapsWikiSyncStripParentheticalSuffix), sie trennt nur wie
// ein Leerzeichen; das Wort „Kraftlinien“ bleibt Überschuss und schadet nicht.
const KATALOG_MIT_TITEL = KATALOG.map((eintrag) => (eintrag.name === "Satinavs Ketten"
	? { ...eintrag, name: "Satinavs Ketten (Kraftlinien)" }
	: eintrag));
for (const name of ["Satinavs Kette I", "Satinavs Kette II"]) {
	const ergebnis = avesmapsWikistatusZustand(name, KATALOG_MIT_TITEL, {});
	assert.deepStrictEqual(ergebnis,
		{
			befund: "aehnlich", form: "kandidat", artikel: "Satinavs Ketten (Kraftlinien)",
			teile: 0, zugewieseneTeile: 0,
		},
		`„${name}“ muss den Artikel auch dann finden, wenn er unter seinem Seitentitel mit `
		+ "Begriffsklärung im Katalog steht.");
	checks++;
}

// ---- 2. DARF NICHT gefunden werden: die 16 automatisch benannten Paare --------------------------
// 🔴 Die andere Hälfte der Abnahmeliste, und die wichtigere. Ein Abgleich, der grosszügiger wird,
// besteht Prüfung 1 weiterhin und macht das Symbol trotzdem wertlos.
// ⚠️ Seit dem Owner-Entscheid trägt auch ein Paar ein Symbol — die LEERE gestrichelte Raute.
// Geprüft wird deshalb nicht „kein Symbol“, sondern: kein Paar darf die Kandidatenform bekommen.
// Ein Test, der weiter auf die leere Zeichenkette prüfte, wäre grün geblieben und hätte nach dem
// Umbau das Gegenteil gemessen.
const leuchtendePaare = PAARE
	.map((name) => ({ name, ...zustand(name) }))
	.filter((eintrag) => eintrag.form !== "offen");
assert.deepStrictEqual(leuchtendePaare, [],
	"Automatisch benannte Ortspaare müssen ALLE die leere gestrichelte Raute tragen (Form "
	+ "„offen“). Diese hier nicht:\n  "
	+ leuchtendePaare.map((e) => `${e.name} -> ${e.form}/${e.befund} (${e.artikel})`).join("\n  ")
	+ "\nEin Symbol, das überall dasselbe sagt, ist so nutzlos wie keins.");
checks++;

// ---- 3. Der wortgleiche Treffer -----------------------------------------------------------------
// ⚠️ Er trägt DIESELBE Form wie der ähnliche, aber einen eigenen Befund — der Tooltip sagt, ob der
// Name wortgleich passt oder nur ähnlich.
assert.deepStrictEqual(zustand("Basiliuslinie"),
	{ befund: "treffer", form: "kandidat", artikel: "Basiliuslinie", teile: 0, zugewieseneTeile: 0 },
	"„Basiliuslinie“ steht wortgleich im Katalog: Befund „treffer“, Form „kandidat“.");
checks++;
// „Bann-Linie“ gegen den Katalogeintrag „Bann-Linie“: der Bindestrich darf keine Rolle spielen.
assert.strictEqual(zustand("Bann-Linie").befund, "treffer",
	"Satz- und Trennzeichen dürfen den wortgleichen Treffer nicht verhindern.");
checks++;

// ---- 4. Die Rangfolge: Zuweisung > Merker > Katalogfund -----------------------------------------
// ⚠️ „Elementares Hexagramm“ trifft den Katalog AUSSERDEM wortgleich (6 von 6 Segmenten tragen die
// Zuweisung, gemessen). Stünde die Reihenfolge andersherum, zeigte die Zeile die Kandidatenform
// für etwas, das längst zugewiesen ist.
assert.deepStrictEqual(zustand("Elementares Hexagramm"),
	{ befund: "zuweisung", form: "zugewiesen", artikel: "", teile: 6, zugewieseneTeile: 6 },
	"Eine gesetzte Zuweisung geht vor. „Elementares Hexagramm“ trifft den Katalog zusätzlich "
	+ "wortgleich — die Rangfolge muss trotzdem die gefüllte Raute ergeben.");
checks++;
// „Drachenblick“ trägt den Merker auf allen 4 Segmenten und findet im Katalog nichts.
assert.deepStrictEqual(zustand("Drachenblick"),
	{ befund: "kein_artikel", form: "ohne-artikel", artikel: "", teile: 4, zugewieseneTeile: 0 },
	"Der Merker „kein Wiki-Artikel vorhanden“ ergibt die durchgezogene, leere Kontur — erledigt, "
	+ "aber ohne Artikel.");
checks++;
// 💣 Der Merker schlägt den KATALOGFUND: er ist die Entscheidung eines Editors, der Fund nur eine
// Vermutung des Abgleichs. Andersherum bekäme eine bewusst leer gelassene Zeile wieder ihr
// „hier ist etwas zu holen“ — genau die Sorte Wiedergänger, an der Discord #38 hing.
assert.strictEqual(
	avesmapsWikistatusZustand("Basiliuslinie", KATALOG, { teile: 1, keinArtikel: true }).befund,
	"kein_artikel",
	"Der Merker „kein Artikel“ muss den wortgleichen Katalogtreffer schlagen: eine Feststellung "
	+ "schlägt eine Vermutung.");
checks++;
// 💣 …und die Zuweisung schlägt den Merker. Beides zugleich sollte es nicht geben (der Schreibweg
// verbietet es je Segment, avesmapsAssertPowerlineWikiClaimNotContradictory), aber über eine
// Namensgruppe hinweg ist es denkbar — und dann ist der gesetzte Link die härtere Tatsache.
assert.strictEqual(
	avesmapsWikistatusZustand("Basiliuslinie", KATALOG,
		{ teile: 2, zugewieseneTeile: 2, keinArtikel: true }).befund,
	"zuweisung",
	"Ein gesetzter Link schlägt den Merker „kein Artikel“ — er ist die härtere Tatsache.");
checks++;

// ---- 4b. Die halbe Raute: teilweise zugewiesen --------------------------------------------------
// 🪤 Am Livebestand gibt es diesen Zustand heute NICHT (0 von 62). Er wird deshalb gestellt
// geprüft — sonst stünde eine Form im Code, die kein Test je betritt.
assert.deepStrictEqual(
	avesmapsWikistatusZustand("Drachenblick", KATALOG, { teile: 4, zugewieseneTeile: 1 }),
	{ befund: "teilzuweisung", form: "teilweise", artikel: "", teile: 4, zugewieseneTeile: 1 },
	"Trägt nur ein Teil der Gruppe den Artikel, ist die Raute halb gefüllt.");
checks++;
assert.strictEqual(
	avesmapsWikistatusZustand("Drachenblick", KATALOG, { teile: 4, zugewieseneTeile: 4 }).form,
	"zugewiesen",
	"Vollzählig heißt voll gefüllt — die Grenze liegt bei „alle“, nicht bei „mehr als die Hälfte“.");
checks++;
// 💣 …und die Gegenprobe eine Stufe UNTER vollzählig. Ohne sie besteht auch die Regel „mehr als die
// Hälfte ist voll“ diesen Test: 1 von 4 wäre weiterhin halb, 4 von 4 weiterhin voll — und drei von
// vier zugewiesenen Segmenten meldeten „fertig“, obwohl eines fehlt.
assert.strictEqual(
	avesmapsWikistatusZustand("Drachenblick", KATALOG, { teile: 4, zugewieseneTeile: 3 }).form,
	"teilweise",
	"Drei von vier ist NICHT vollzählig. Die Grenze liegt bei „alle“.");
checks++;
// 💣 Fehlt der Nenner, gilt „alles zugewiesen“. Eine Liste, die nur „ja/nein“ weiß, übergibt
// {zugewieseneTeile: 1} und bekommt die volle Raute — nicht eine halbe für eine vollständige
// Zuweisung. Andersherum wäre der stille Fehler: die Zeile sähe unfertig aus, ohne es zu sein.
assert.strictEqual(avesmapsWikistatusZustand("Drachenblick", KATALOG, { zugewieseneTeile: 1 }).form,
	"zugewiesen",
	"Ohne `teile` gilt die Zuweisung als vollständig.");
checks++;
// Ein Nenner kleiner als der Zähler kann nur ein Rechenfehler des Aufrufers sein; er darf keine
// dritte Bedeutung erzeugen.
assert.strictEqual(
	avesmapsWikistatusZustand("Drachenblick", KATALOG, { teile: 1, zugewieseneTeile: 3 }).teile, 3,
	"Ein Nenner unter dem Zähler wird auf den Zähler gehoben — im Tooltip darf nie „3 von 1“ stehen.");
checks++;
// 💣 DIE ALTE SCHNITTSTELLE IST WIRKUNGSLOS, UND ZWAR SICHTBAR. Bis zum 17.08.2026 hieß das Feld
// `zugewiesen` und war ein Wahrheitswert. Bliebe es gültig, läse `true` sich als „1 Teil“ — und
// aus einer vollständigen Zuweisung würde je nach Nenner eine halbe. Deshalb heißen die Felder
// anders; ein alter Aufrufer bekommt den Katalogfund, nicht eine falsche Zuweisung.
assert.strictEqual(avesmapsWikistatusZustand("Basiliuslinie", KATALOG, { zugewiesen: true }).befund,
	"treffer",
	"Die alte Option `zugewiesen: true` darf keine Zuweisung mehr erzeugen — sonst schleicht sich "
	+ "eine halbe Raute für eine ganze Zuweisung ein.");
checks++;
// 💣 Und derselbe Wahrheitswert IM ZÄHLFELD zählt nicht als „1 Teil“. Genau so sieht die Umstellung
// eines Aufrufers aus, der den alten Namen ersetzt und den alten Wert stehen lässt — `true` würde
// aus einer vollständigen Zuweisung eine halbe machen, und niemand sähe einen Fehler.
assert.strictEqual(
	avesmapsWikistatusZustand("Basiliuslinie", KATALOG, { teile: 3, zugewieseneTeile: true }).befund,
	"treffer",
	"Ein Wahrheitswert im Zählfeld ist keine Zahl und darf nicht als „1 von 3“ gelesen werden.");
checks++;

// ---- 4c. Der ÜBERGEBENE Befund `kandidat` -------------------------------------------------------
// 🔴 Eine Liste, die ihren Kandidaten schon kennt, ÜBERGIBT ihn — sie lässt ihn nicht nachrechnen.
// Gebaut für die Ortsliste (17.08.2026): dort findet der SERVER den Kandidaten, weil der Katalog
// 7.740 Titel hat und weder in den Browser passt noch ein zweites Mal in PHP nachgebaut werden darf.
//
// 💣 DER ZEUGE, UND ER IST DER GRUND FÜR DIE GANZE OPTION. Die Regel des Servers
// (avesmapsWikiSettlementBaseKey) streift „(Siedlung)" ab, avesmapsWikistatusSchluessel hier nicht.
// Ein serverseitig bestätigter Kandidat, als Ein-Eintrag-Katalog übergeben, fiele deshalb durch den
// exakten UND den unscharfen Test und stünde still als „nichts“ da: ein Wert, den man durch eine
// zweite, leicht andere Rechnung schickt, verliert dabei lautlos seine Aussage.
// ⚠️ Diese Zusicherung hält den FEHLZUSTAND fest, damit niemand die Option für Bequemlichkeit hält.
// Wer die Schlüsselregel hier je an die des Servers angleicht, bricht sie — und muss dann an dieser
// Stelle nachlesen, dass das eine Entscheidung ist und kein Aufräumen (die JS-Regel gilt allen acht
// Listen, die Server-Regel gilt den Orten).
assert.strictEqual(
	avesmapsWikistatusZustand("Abagund", [{ name: "Abagund (Siedlung)" }], {}).befund,
	"nichts",
	"ZEUGE: der Ein-Eintrag-Katalog-Weg verliert den serverseitig bestätigten Kandidaten. Genau "
	+ "deshalb gibt es die Option `kandidat` — sie reicht den Befund durch, statt ihn nachzurechnen.");
checks++;
// …und mit der Option kommt er an.
assert.deepStrictEqual(
	avesmapsWikistatusZustand("Abagund", [], { kandidat: "Abagund (Siedlung)" }),
	{ befund: "treffer", form: "kandidat", artikel: "Abagund (Siedlung)", teile: 0, zugewieseneTeile: 0 },
	"Ein übergebener Kandidat ergibt den Befund „treffer“ (der Server gleicht gefaltete Namen ab und "
	+ "verlangt Eindeutigkeit — das ist die strengere Auskunft) und die gestrichelte Raute mit Punkt.");
checks++;
// 💣 Die Rangfolge, beide Richtungen einzeln. Der Merker ist die ENTSCHEIDUNG eines Editors und
// schlägt das Suchergebnis des Servers — dieselbe Regel wie beim Katalogfund darüber.
assert.strictEqual(
	avesmapsWikistatusZustand("Abagund", [], { kandidat: "Abagund (Siedlung)", keinArtikel: true }).befund,
	"kein_artikel",
	"Der Merker „kein Artikel“ schlägt den übergebenen Kandidaten — sonst bekäme eine bewusst leer "
	+ "gelassene Zeile ihr „hier ist etwas zu holen“ zurück (die Wiedergänger-Klasse aus Discord #38).");
checks++;
assert.strictEqual(
	avesmapsWikistatusZustand("Abagund", [], { kandidat: "Abagund (Siedlung)", zugewieseneTeile: 1 }).befund,
	"zuweisung",
	"Eine gesetzte Zuweisung schlägt den übergebenen Kandidaten.");
checks++;
// 💣 …und er schlägt den Katalog. Andersherum bekäme die Ortsliste den Fund einer Rechnung, die
// sie gar nicht fährt — sie übergibt `[]`, aber ein späterer Aufrufer könnte beides mitgeben.
assert.strictEqual(
	avesmapsWikistatusZustand("Basiliuslinie", KATALOG, { kandidat: "Ein anderer Artikel" }).artikel,
	"Ein anderer Artikel",
	"Der übergebene Befund schlägt den Katalogfund: wer ihn übergibt, hat bereits gerechnet.");
checks++;
// 💣 Nur eine nicht-leere Zeichenkette zählt. `true`, eine Zahl oder ein Objekt sind kein
// Artikelname und dürften nie als Tooltip „Kandidat im Wiki: „true““ herauskommen — dieselbe
// Strenge wie bei avesmapsWikistatusZahl. Ein leeres Feld ist der NORMALFALL: der Server schickt
// `wiki_candidate: ""` für jede Zeile ohne Fund, und 843 solche Zeilen dürfen nicht leuchten.
for (const wert of ["", "   ", true, 1, {}, [], null, undefined]) {
	assert.strictEqual(avesmapsWikistatusZustand("Basiliuslinie", [], { kandidat: wert }).befund,
		"nichts",
		`Ein \`kandidat\` vom Wert ${JSON.stringify(wert)} ist kein Artikelname und darf keinen Fund `
		+ "erzeugen. Der leere String ist dabei der Normalfall, nicht der Sonderfall.");
	checks++;
}

// ---- 5. Ein einzelnes gemeinsames Wort reicht NICHT ---------------------------------------------
// 🔴 Bewusste Strenge, gemessen an „Hexenband(-schleife)“: der Artikel „Hexenband“ existiert, aber
// er hängt bereits an der Linie „Hexenband“. Ein Kandidatensymbol schickte den Editor zu einem
// Artikel, der schon vergeben ist — das ist kein Fund, sondern eine Dublette in spe.
assert.strictEqual(zustand("Hexenband(-schleife)").form, "offen",
	"„Hexenband(-schleife)“ darf kein Kandidat sein: ein einziges gemeinsames Wort ist bei Namen "
	+ "aus einer Welt voller „Linie“, „Band“ und „Pfad“ Zufall, kein Fund.");
checks++;
assert.strictEqual(zustand("Bann der Tiefe").form, "offen",
	"„Bann der Tiefe“ teilt genau ein Wort mit „Bann-Linie“ und darf deshalb keinen Kandidaten melden.");
checks++;

// ---- 5b. Die zwei Längenschranken, einzeln --------------------------------------------------------
// 💣 Sie sind der Grund, warum das Symbol nicht überall leuchtet, und ihr Wert ist am echten
// Bestand NICHT ablesbar: eine gelockerte Schranke ändert dort heute nichts und schliche sich
// deshalb unbemerkt ein. Der nächste Wiki-Dump bringt neue Artikel — dann entscheidet sie.
const { avesmapsWikistatusWortGleich, avesmapsWikistatusWorte } = require(
	path.resolve(__dirname, "..", "review-list-wikistatus.js"));
assert.ok(avesmapsWikistatusWortGleich("kette", "ketten"),
	"„Kette“ und „Ketten“ sind dasselbe Wort — daran hängt der Abnahmefall Satinavs.");
assert.ok(!avesmapsWikistatusWortGleich("kel", "kelch"),
	"„kel“ und „Kelch“ sind NICHT dasselbe Wort. Eine Endungsregel ab drei Zeichen macht aus jeder "
	+ "gemeinsamen Silbe einen Treffer.");
assert.ok(!avesmapsWikistatusWortGleich("kette", "kettenband"),
	"Ein Wort ist keine Endung von drei Zeichen mehr — sonst wird jedes Kompositum zum Treffer.");
assert.ok(!avesmapsWikistatusWortGleich("bann", "band"),
	"„Bann“ und „Band“ unterscheiden sich um einen Buchstaben, sind aber zu kurz für die "
	+ "Tippfehlerregel — sonst verschmelzen die halben Kraftlinien-Namen dieser Welt.");
checks += 4;
assert.deepStrictEqual(avesmapsWikistatusWorte("Gareth - Reichsabtei St. Praiodan"),
	["gareth", "reichsabtei", "praiodan"],
	"Wörter unter drei Zeichen tragen keine Identität und fallen weg („St.“). Bleiben sie drin, "
	+ "zählen sie als Treffer und heben die Zwei-Wort-Schwelle für jeden Namen mit Kürzel aus.");
checks++;

// ---- 6. Die Bilanz über alle 62 ------------------------------------------------------------------
const formen = { zugewiesen: 0, teilweise: 0, "ohne-artikel": 0, kandidat: 0, offen: 0 };
const befunde = { zuweisung: 0, teilzuweisung: 0, kein_artikel: 0, treffer: 0, aehnlich: 0, nichts: 0 };
const aehnliche = [];
for (const name of KRAFTLINIEN) {
	const ergebnis = zustand(name);
	formen[ergebnis.form]++;
	befunde[ergebnis.befund]++;
	if (ergebnis.befund === "aehnlich") { aehnliche.push([name, ergebnis.artikel]); }
}
// Die Liste der ähnlichen Treffer ist AUFGEZÄHLT, nicht gezählt: eine blosse Zahl bliebe grün,
// wenn der Abgleich einen echten Fall verliert und dafür einen falschen dazugewinnt.
assert.deepStrictEqual(aehnliche.slice().sort(), MUSS.slice().sort(),
	"Über alle 62 Namen dürfen GENAU die vier gemessenen ähnlichen Treffer herauskommen. "
	+ "Gefunden:\n  " + aehnliche.map(([n, a]) => `${n} -> ${a}`).join("\n  "));
checks++;
// 🔴 Die Erwartung des Owners steht auf den FORMEN, denn die sieht er.
// 🪤 Live: 2 gefüllt · 0 halb · 2 Kontur · 21 gestrichelt-mit-Punkt · 37 gestrichelt. Hier steht
// 20/38 statt 21/37, weil dieser Fixture zwei der 23 Katalogartikel fehlen (siehe Kopf). Die
// Differenz gehört dem Katalog, nicht der Belegung.
assert.deepStrictEqual(formen,
	{ zugewiesen: 2, teilweise: 0, "ohne-artikel": 2, kandidat: 20, offen: 38 },
	"Die Verteilung der fünf Formen über die 62 Kraftlinien muss 2 zugewiesen / 0 teilweise / "
	+ "2 ohne-artikel / 20 kandidat / 38 offen sein (live: 2/0/2/21/37).");
checks++;
// 🔴 DIE KRAFTLINIEN BLEIBEN UNBERÜHRT, und das ist eine eigene Zusicherung, keine Folgerung.
// Seit dem 17.08.2026 teilt sich die Kraftlinienliste den Zustandsrechner mit der Ortsliste; jede
// Erweiterung für die zweite Liste kann die erste verstellen, ohne dass es dort jemandem auffällt
// (sie ist live und trägt 2 · 0 · 2 · 21 · 37). Geprüft wird derselbe Durchlauf noch einmal mit den
// Optionen, die ein Aufrufer versehentlich mitschleppt: eine `kandidat`-Eigenschaft, die es gibt,
// aber leer ist — genau die Form, in der ein Server-Objekt hereingereicht wird.
const formenMitLeeremFeld = { zugewiesen: 0, teilweise: 0, "ohne-artikel": 0, kandidat: 0, offen: 0 };
for (const name of KRAFTLINIEN) {
	const bilanz = { ...(BILANZ[name] || OHNE_BEFUND), kandidat: undefined };
	formenMitLeeremFeld[avesmapsWikistatusZustand(name, KATALOG, bilanz).form]++;
}
assert.deepStrictEqual(formenMitLeeremFeld, formen,
	"Eine leere `kandidat`-Eigenschaft in den Optionen darf die Verteilung der Kraftlinien um keine "
	+ "einzige Zeile verschieben. Ohne diese Zusicherung verstellt die zweite Liste die erste, und "
	+ "gesehen würde es erst live.");
checks++;
assert.strictEqual(befunde.zuweisung, 2,
	"Zwei Linien tragen eine Zuweisung auf allen ihren Segmenten (gemessen 17.08.2026: "
	+ "Elementares Hexagramm 6/6, Hexenband 6/6).");
checks++;
assert.strictEqual(befunde.kein_artikel, 2,
	"Zwei Linien tragen den Merker „kein Wiki-Artikel vorhanden“ (gemessen 17.08.2026: "
	+ "Hursachquelle 1/1, Drachenblick 4/4).");
checks++;
// 🪤 16, NICHT 17 — eine Eigenschaft dieser FIXTURE, keine Projektzahl.
assert.strictEqual(befunde.treffer, 16,
	"16 der 62 Namen treffen einen der 21 Katalogeinträge DIESER FIXTURE wortgleich (live sind es "
	+ "17 von 23 — die Differenz sind die zwei ohne Sitzung nicht rekonstruierbaren Artikel, kein "
	+ "Fehler des Abgleichs).");
checks++;
assert.strictEqual(befunde.nichts, 38,
	"38 Namen melden „nichts“ und tragen damit die LEERE gestrichelte Raute: 16 automatisch "
	+ "benannte Paare und 22 echte Namen, zu denen der (unvollständige) Katalog nichts hergibt.");
checks++;

// ---- 7. Die Reihenfolge des Katalogs darf nichts ändern -----------------------------------------
// 💣 Der Katalog kommt aus einer Antwort; seine Reihenfolge ist nicht garantiert. Ohne den
// Stichentscheid in avesmapsWikistatusZustand hinge der Tooltip einer Zeile davon ab, welcher
// Artikel zufällig zuerst im Payload stand.
const rueckwaerts = KATALOG.slice().reverse();
for (const name of KRAFTLINIEN) {
	const a = avesmapsWikistatusZustand(name, KATALOG, BILANZ[name] || OHNE_BEFUND);
	const b = avesmapsWikistatusZustand(name, rueckwaerts, BILANZ[name] || OHNE_BEFUND);
	assert.deepStrictEqual(b, a,
		`„${name}“ bekommt je nach Reihenfolge des Katalogs ein anderes Ergebnis `
		+ `(${JSON.stringify(a)} gegen ${JSON.stringify(b)}).`);
}
checks++;
// ⚠️ Der Livebestand kennt heute KEINEN Gleichstand — die Prüfung darüber liefe also auch mit
// „der erste gewinnt“ grün und bewiese nichts. Deshalb ein gestellter Gleichstand: zwei Artikel,
// die gleich gut passen. Der Stichentscheid ist alphabetisch, damit dieselbe Zeile morgen
// dasselbe sagt wie heute.
const GLEICHSTAND = [{ name: "Zwote Linie des Nordens" }, { name: "Erste Linie des Nordens" }];
assert.strictEqual(avesmapsWikistatusZustand("Linie des Nordens", GLEICHSTAND, {}).artikel,
	"Erste Linie des Nordens",
	"Bei gleich guten Treffern muss der alphabetisch erste gewinnen — sonst hängt der Tooltip "
	+ "daran, in welcher Reihenfolge der Katalog eintrifft.");
assert.strictEqual(avesmapsWikistatusZustand("Linie des Nordens", GLEICHSTAND.slice().reverse(), {}).artikel,
	"Erste Linie des Nordens",
	"…und zwar aus beiden Richtungen.");
checks += 2;

// ---- 8. Ohne Katalog wird kein Kandidat behauptet ------------------------------------------------
// 💣 Der Rückfall MUSS „nichts“ sein. Ein Abgleich, der bei leerem Katalog irgendetwas meldet,
// verwandelt „wir konnten nicht suchen“ in eine Aussage über das Wiki.
// ⚠️ Dass dieser Rückfall als „offen“ GEZEICHNET würde, ist kein Widerspruch: die Liste setzt das
// Opt-in gar nicht erst, wenn der Katalog fehlt (siehe wikistatus-spalte.test.js) — diese Antwort
// erreicht in dem Fall also nie eine Zeile.
assert.strictEqual(avesmapsWikistatusZustand("Basiliuslinie", [], {}).befund, "nichts",
	"Ohne Katalog darf kein Fund gemeldet werden.");
assert.strictEqual(avesmapsWikistatusZustand("Basiliuslinie", null, {}).befund, "nichts",
	"Auch eine fehlende Liste (null) darf nichts melden und nicht werfen.");
assert.strictEqual(avesmapsWikistatusZustand("", KATALOG, {}).befund, "nichts",
	"Ein leerer Name darf nichts melden.");
checks += 3;
// 🔴 …aber eine Zuweisung und der Merker gelten OHNE Katalog weiter: sie sind Tatsachen über die
// Zeile, keine Suchergebnisse.
assert.strictEqual(avesmapsWikistatusZustand("Basiliuslinie", null, { zugewieseneTeile: 2 }).form,
	"zugewiesen", "Eine Zuweisung braucht keinen Katalog.");
assert.strictEqual(avesmapsWikistatusZustand("Basiliuslinie", null, { keinArtikel: true }).form,
	"ohne-artikel", "Der Merker braucht keinen Katalog.");
checks += 2;

// ---- 9. Das Markup ------------------------------------------------------------------------------
// 🔴 JEDE der sechs Antworten erzeugt ein Symbol. Die Aufzählung ist der Riegel gegen den Zustand,
// den jemand hinzufügt und im Markup vergisst — er fiele sonst auf die leere Zeichenkette zurück,
// und eine Zeile ohne Symbol ist seit dem 17.08.2026 keine gültige Zeile mehr.
for (const befund of BEFUNDE) {
	const markup = avesmapsWikistatusMarkup({ befund, artikel: "X", teile: 3, zugewieseneTeile: 1 });
	assert.ok(markup.indexOf('class="wiki-state wiki-state--' + avesmapsWikistatusForm(befund) + '"') >= 0,
		`Der Befund „${befund}“ muss ein Symbol mit seiner Form erzeugen. Erhalten: ${markup || "(nichts)"}`);
	assert.ok(/title="[^"]+"/.test(markup),
		`Der Befund „${befund}“ muss einen Tooltip tragen — ein Symbol ohne Erklärung zwingt zum `
		+ "Öffnen genau der Zeile, die es einem ersparen sollte.");
	checks += 2;
}
const markupKandidat = avesmapsWikistatusMarkup(zustand("Brücke nach Akrabaal"));
assert.ok(/title="[^"]*Brücke von Akrabaal[^"]*"/.test(markupKandidat),
	"Der Tooltip muss den gefundenen Artikel NENNEN.");
checks++;
// 💣 Der wortgleiche und der ähnliche Treffer teilen die FORM, nicht die Auskunft.
const tooltip = (befund) => (avesmapsWikistatusMarkup({ befund, artikel: "A" }).match(/title="([^"]*)"/) || [])[1];
assert.notStrictEqual(tooltip("treffer"), tooltip("aehnlich"),
	"Wortgleich und ähnlich tragen dieselbe Raute — im Tooltip müssen sie sich unterscheiden, "
	+ "sonst ist der Unterschied wirklich weg.");
checks++;
assert.ok(tooltip("teilzuweisung").indexOf("von") >= 0,
	"Der Tooltip der halben Raute muss sagen, WIE VIEL zugewiesen ist.");
checks++;
assert.ok(
	avesmapsWikistatusMarkup({ befund: "teilzuweisung", teile: 6, zugewieseneTeile: 2 })
		.indexOf("2 von 6") >= 0,
	"…und zwar mit den echten Zahlen der Zeile.");
checks++;
assert.strictEqual(avesmapsWikistatusMarkup({ befund: "erfunden" }), "",
	"Ein unbekannter Befund erzeugt nichts, statt eine sechste Form zu erfinden.");
checks++;
assert.strictEqual(avesmapsWikistatusMarkup(null), "", "Ohne Zustand entsteht kein Element.");
checks++;
// 💣 Der Erzeuger nimmt den GANZEN Zustand, nicht seine Felder einzeln — zwei Zeichenketten
// nebeneinander lassen sich vertauschen, und vertauscht käme ein plausibles Symbol mit falschem
// Tooltip heraus. Die alte Zwei-Argument-Form liefert deshalb nichts statt irgendetwas.
assert.strictEqual(avesmapsWikistatusMarkup("treffer", "Basiliuslinie"), "",
	"Die alte Aufrufform (befund, artikel) darf kein Symbol mehr erzeugen.");
checks++;

console.log(`wikistatus-abgleich: ${checks} Pruefungen bestanden `
	+ `(62 Kraftlinien: ${formen.zugewiesen} gefuellt, ${formen.teilweise} halb, `
	+ `${formen["ohne-artikel"]} Kontur, ${formen.kandidat} gestrichelt-mit-Punkt, `
	+ `${formen.offen} gestrichelt; 0 von 16 Paaren mit Kandidat).`);
