// Der Kandidaten-Abgleich hinter dem Listensymbol „Ist hier ein Wiki-Artikel zu holen?“
//
// 🔴 DIESER TEST IST DIE ABNAHMELISTE AUS DEM MOCKUP, UND SIE HAT ZWEI SEITEN. Die eine ist
// leicht zu erfüllen (irgendetwas finden), die andere ist der eigentliche Nutzen:
// **ein Symbol, das überall leuchtet, ist so nutzlos wie keins.** Deshalb steht hier neben den
// vier Namen, die einen Kandidaten bekommen MÜSSEN, die vollständige Liste der 16 automatisch
// benannten Ortspaare, von denen KEINES einen bekommen darf.
//
// Die Namen sind echt: 62 Namensgruppen aus 165 Segmenten, am 17.08.2026 aus der Live-Nutzlast
// (GET /api/app/map-features.php) gezogen. Öffentliche Kartendaten, keine Betriebsdaten.
//
// ⚠️ DER KATALOG IST UNVOLLSTÄNDIG, UND DAS IST BEWUSST SO. Der echte trägt 23 Artikel; ohne
// angemeldete Sitzung sind hier 21 rekonstruierbar — 18 aus den `wiki_powerline`-Nestern der
// Live-Nutzlast, 3 aus dem vom Owner abgenommenen Mockup. Die zwei fehlenden können einen der
// hier als „ohne Treffer“ gezählten Namen zu einem exakten Treffer machen (der Entwurf erwartet
// 17 statt der hier gemessenen 16 „zuweisbar“). Für die Abnahmeliste ändert das nichts: sie
// verlangt vier bestimmte Kandidaten und null falsche, und beides ist mit 21 Artikeln prüfbar.
//
// Entwurf/Mockup: docs/listensymbol-wiki-mockup.html (Variante A, Owner-Abnahme 17.08.2026).
//
// Run: node js/review/__tests__/wikistatus-abgleich.test.js

"use strict";

const assert = require("assert");
const path = require("path");

const {
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

// Zwei Linien tragen bereits eine Zuweisung (properties.wiki_url), gemessen am selben Tag.
const ZUGEWIESEN = new Set(["Elementares Hexagramm", "Hexenband"]);

const zustand = (name) => avesmapsWikistatusZustand(name, KATALOG, { zugewiesen: ZUGEWIESEN.has(name) });

// ---- 1. MUSS gefunden werden: die vier gemessenen Kandidaten -----------------------------------
// 💣 Der Fall, an dem der ganze dritte Zustand hängt: „Brücke nach Akrabaal“ hätte ohne ihn leer
// dagestanden, obwohl das Wiki „Brücke VON Akrabaal“ führt — und die Abwesenheit des Symbols
// heisst „wir haben nichts gefunden“, nicht „es gibt keinen Artikel“.
const MUSS = [
	["Brücke nach Akrabaal", "Brücke von Akrabaal"],
	["Satinavs Kette I", "Satinavs Ketten"],
	["Satinavs Kette II", "Satinavs Ketten"],
	// ⚠️ In UNSEREM Namen steckt ein Tippfehler („Zwölfseitige“ statt „Zwölfsaitige“), und der
	// Treffer steht in der KLAMMER, nicht davor. Wer die Klammer abschneidet — wie es bei
	// Wiki-Titeln richtig ist (Begriffsklärung) — verliert genau diesen Fall.
	["Klirrfrostsaite (Zwölfseitige Götterharfe)", "Zwölfsaitige Götterharfe"],
];
for (const [name, artikel] of MUSS) {
	const ergebnis = zustand(name);
	const gemeldet = ergebnis.zustand === "" ? "nichts" : ergebnis.zustand;
	assert.strictEqual(ergebnis.zustand, "kandidat",
		`„${name}“ muss als Kandidat erscheinen (erwartet der Artikel „${artikel}“), gemeldet wurde `
		+ `„${gemeldet}“. Ohne diesen Zustand behauptet die leere Zeile das `
		+ "Gegenteil der Wahrheit.");
	assert.strictEqual(ergebnis.artikel, artikel,
		`„${name}“ muss auf „${artikel}“ zeigen — der Tooltip nennt den Fund, und ein falscher Name `
		+ `schickt den Editor auf die falsche Wiki-Seite. Gemeldet: „${ergebnis.artikel}“.`);
	checks += 2;
}

// ---- 1b. Derselbe Fall mit dem SEITENTITEL statt dem Infobox-Namen ------------------------------
// 💣 Der Katalog nennt „name“ — und das ist das Infobox-Feld `Name`, das aber auf den Seitentitel
// zurückfällt, wenn die Infobox keinen Namen führt (avesmapsWikiPowerlineParsePage). Die Seite
// heisst „Satinavs Ketten (Kraftlinien)“; ob im Katalog der kurze oder der lange Name landet, hängt
// also am Wikitext EINER Seite. Beide Formen müssen denselben Kandidaten ergeben, sonst kippt das
// Symbol beim nächsten Wiki-Edit lautlos um.
// ⚠️ Dies ist zugleich der einzige Fall, der die Deckung UNSERER Seite braucht: hier hat der
// ARTIKEL ein Wort mehr („Kraftlinien“), bei der Götterharfe haben WIR eines mehr. Eine einseitige
// Deckungsregel verlöre je einen der beiden.
const KATALOG_MIT_TITEL = KATALOG.map((eintrag) => (eintrag.name === "Satinavs Ketten"
	? { ...eintrag, name: "Satinavs Ketten (Kraftlinien)" }
	: eintrag));
for (const name of ["Satinavs Kette I", "Satinavs Kette II"]) {
	const ergebnis = avesmapsWikistatusZustand(name, KATALOG_MIT_TITEL, {});
	assert.deepStrictEqual(ergebnis, { zustand: "kandidat", artikel: "Satinavs Ketten (Kraftlinien)" },
		`„${name}“ muss den Artikel auch dann finden, wenn er unter seinem Seitentitel mit `
		+ "Begriffsklärung im Katalog steht.");
	checks++;
}

// ---- 2. DARF NICHT gefunden werden: die 16 automatisch benannten Paare --------------------------
// 🔴 Die andere Hälfte der Abnahmeliste, und die wichtigere. Ein Abgleich, der grosszügiger wird,
// besteht Prüfung 1 weiterhin und macht das Symbol trotzdem wertlos.
const leuchtendePaare = PAARE
	.map((name) => ({ name, ...zustand(name) }))
	.filter((eintrag) => eintrag.zustand !== "");
assert.deepStrictEqual(leuchtendePaare, [],
	"Automatisch benannte Ortspaare dürfen kein Symbol bekommen. Diese hier haben eines:\n  "
	+ leuchtendePaare.map((e) => `${e.name} -> ${e.zustand} (${e.artikel})`).join("\n  ")
	+ "\nEin Symbol, das überall leuchtet, ist so nutzlos wie keins.");
checks++;

// ---- 3. Der exakte Treffer ist „zuweisbar“, nicht „Kandidat“ -----------------------------------
assert.deepStrictEqual(zustand("Basiliuslinie"), { zustand: "zuweisbar", artikel: "Basiliuslinie" },
	'„Basiliuslinie“ steht wortgleich im Katalog und ist damit mit einem Klick zuweisbar.');
checks++;
// „Bann-Linie“ gegen den Katalogeintrag „Bann-Linie“: der Bindestrich darf keine Rolle spielen.
assert.strictEqual(zustand("Bann-Linie").zustand, "zuweisbar",
	"Satz- und Trennzeichen dürfen den exakten Treffer nicht verhindern.");
checks++;

// ---- 4. Eine bestehende Zuweisung schlägt alles ------------------------------------------------
// ⚠️ „Elementares Hexagramm“ trifft den Katalog AUSSERDEM wortgleich. Stünde die Reihenfolge
// andersherum, meldete die Zeile „zuweisbar“ für etwas, das längst zugewiesen ist.
assert.strictEqual(zustand("Elementares Hexagramm").zustand, "zugewiesen",
	'Eine gesetzte Zuweisung geht vor. „Elementares Hexagramm“ trifft den Katalog zusätzlich '
	+ "wortgleich — die Rangfolge muss trotzdem „zugewiesen“ ergeben.");
checks++;

// ---- 5. Ein einzelnes gemeinsames Wort reicht NICHT ---------------------------------------------
// 🔴 Bewusste Strenge, gemessen an „Hexenband(-schleife)“: der Artikel „Hexenband“ existiert, aber
// er hängt bereits an der Linie „Hexenband“. Ein Kandidatensymbol schickte den Editor zu einem
// Artikel, der schon vergeben ist — das ist kein Fund, sondern eine Dublette in spe.
assert.strictEqual(zustand("Hexenband(-schleife)").zustand, "",
	'„Hexenband(-schleife)“ darf kein Kandidat sein: ein einziges gemeinsames Wort ist bei Namen '
	+ "aus einer Welt voller „Linie“, „Band“ und „Pfad“ Zufall, kein Fund.");
checks++;
assert.strictEqual(zustand("Bann der Tiefe").zustand, "",
	'„Bann der Tiefe“ teilt genau ein Wort mit „Bann-Linie“ und darf deshalb nichts melden.');
checks++;

// ---- 5b. Die zwei Längenschranken, einzeln --------------------------------------------------------
// 💣 Sie sind der Grund, warum das Symbol nicht überall leuchtet, und ihr Wert ist am echten
// Bestand NICHT ablesbar: eine gelockerte Schranke ändert dort heute nichts und schliche sich
// deshalb unbemerkt ein. Der nächste Wiki-Dump bringt neue Artikel — dann entscheidet sie.
const { avesmapsWikistatusWortGleich, avesmapsWikistatusWorte } = require(
	path.resolve(__dirname, "..", "review-list-wikistatus.js"));
assert.ok(avesmapsWikistatusWortGleich("kette", "ketten"),
	'„Kette" und „Ketten" sind dasselbe Wort — daran hängt der Abnahmefall Satinavs.');
assert.ok(!avesmapsWikistatusWortGleich("kel", "kelch"),
	'„kel" und „Kelch" sind NICHT dasselbe Wort. Eine Endungsregel ab drei Zeichen macht aus jeder '
	+ "gemeinsamen Silbe einen Treffer.");
assert.ok(!avesmapsWikistatusWortGleich("kette", "kettenband"),
	"Ein Wort ist keine Endung von drei Zeichen mehr — sonst wird jedes Kompositum zum Treffer.");
assert.ok(!avesmapsWikistatusWortGleich("bann", "band"),
	'„Bann" und „Band" unterscheiden sich um einen Buchstaben, sind aber zu kurz für die '
	+ "Tippfehlerregel — sonst verschmelzen die halben Kraftlinien-Namen dieser Welt.");
checks += 4;
assert.deepStrictEqual(avesmapsWikistatusWorte("Gareth - Reichsabtei St. Praiodan"),
	["gareth", "reichsabtei", "praiodan"],
	'Wörter unter drei Zeichen tragen keine Identität und fallen weg („St."). Bleiben sie drin, '
	+ "zählen sie als Treffer und heben die Zwei-Wort-Schwelle für jeden Namen mit Kürzel aus.");
checks++;

// ---- 6. Die Bilanz über alle 62 ------------------------------------------------------------------
const bilanz = { zugewiesen: 0, zuweisbar: 0, kandidat: 0, nichts: 0 };
const kandidaten = [];
for (const name of KRAFTLINIEN) {
	const ergebnis = zustand(name);
	bilanz[ergebnis.zustand === "" ? "nichts" : ergebnis.zustand]++;
	if (ergebnis.zustand === "kandidat") { kandidaten.push([name, ergebnis.artikel]); }
}
// Die Kandidatenliste ist AUFGEZÄHLT, nicht gezählt: eine blosse Zahl bliebe grün, wenn der
// Abgleich einen echten Fall verliert und dafür einen falschen dazugewinnt.
assert.deepStrictEqual(kandidaten.slice().sort(), MUSS.slice().sort(),
	"Über alle 62 Namen dürfen GENAU die vier gemessenen Kandidaten herauskommen. Gefunden:\n  "
	+ kandidaten.map(([n, a]) => `${n} -> ${a}`).join("\n  "));
checks++;
assert.strictEqual(bilanz.zugewiesen, 2, "Zwei Linien tragen eine Zuweisung (gemessen 17.08.2026).");
checks++;
assert.strictEqual(bilanz.zuweisbar, 16,
	"16 der 62 Namen treffen einen der 21 rekonstruierbaren Katalogeinträge wortgleich. ⚠️ Der "
	+ "Entwurf nennt 17 — die Differenz ist genau einer der zwei Artikel, die ohne angemeldete "
	+ "Sitzung nicht rekonstruierbar sind, nicht ein Fehler des Abgleichs.");
checks++;
assert.strictEqual(bilanz.nichts, 40,
	"40 Namen bleiben ohne Symbol: 16 automatisch benannte Paare und 24 echte Namen, zu denen der "
	+ "(unvollständige) Katalog nichts hergibt.");
checks++;

// ---- 7. Die Reihenfolge des Katalogs darf nichts ändern -----------------------------------------
// 💣 Der Katalog kommt aus einer Antwort; seine Reihenfolge ist nicht garantiert. Ohne den
// Stichentscheid in avesmapsWikistatusZustand hinge der Tooltip einer Zeile davon ab, welcher
// Artikel zufällig zuerst im Payload stand.
const rueckwaerts = KATALOG.slice().reverse();
for (const name of KRAFTLINIEN) {
	const a = avesmapsWikistatusZustand(name, KATALOG, { zugewiesen: ZUGEWIESEN.has(name) });
	const b = avesmapsWikistatusZustand(name, rueckwaerts, { zugewiesen: ZUGEWIESEN.has(name) });
	assert.deepStrictEqual(b, a,
		`„${name}" bekommt je nach Reihenfolge des Katalogs ein anderes Ergebnis `
		+ `(${JSON.stringify(a)} gegen ${JSON.stringify(b)}).`);
}
checks++;
// ⚠️ Der Livebestand kennt heute KEINEN Gleichstand — die Prüfung darüber liefe also auch mit
// „der erste gewinnt" grün und bewiese nichts. Deshalb ein gestellter Gleichstand: zwei Artikel,
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

// ---- 8. Ohne Katalog wird nichts behauptet ------------------------------------------------------
// 💣 Der Rückfall MUSS der leere Zustand sein. Ein Abgleich, der bei leerem Katalog irgendetwas
// meldet, verwandelt „wir konnten nicht suchen“ in eine Aussage über das Wiki.
assert.strictEqual(avesmapsWikistatusZustand("Basiliuslinie", [], {}).zustand, "",
	"Ohne Katalog darf nichts gemeldet werden.");
assert.strictEqual(avesmapsWikistatusZustand("Basiliuslinie", null, {}).zustand, "",
	"Auch eine fehlende Liste (null) darf nichts melden und nicht werfen.");
assert.strictEqual(avesmapsWikistatusZustand("", KATALOG, {}).zustand, "",
	"Ein leerer Name darf nichts melden.");
checks += 3;

// ---- 9. Das Markup ------------------------------------------------------------------------------
const markupKandidat = avesmapsWikistatusMarkup("kandidat", "Brücke von Akrabaal");
assert.ok(/class="wiki-state wiki-state--kandidat"/.test(markupKandidat),
	"Das Kandidaten-Markup muss die Klasse .wiki-state--kandidat tragen — ohne sie fällt die "
	+ "Raute auf die Grundform zurück und ist von „zuweisbar“ nicht zu unterscheiden.");
checks++;
assert.ok(/title="[^"]*Brücke von Akrabaal[^"]*"/.test(markupKandidat),
	"Der Tooltip muss den gefundenen Artikel NENNEN. Ein Symbol ohne Namen zwingt zum Öffnen "
	+ "genau der Zeile, die es einem ersparen sollte.");
checks++;
assert.strictEqual(avesmapsWikistatusMarkup("", ""), "",
	"Der leere Zustand erzeugt KEIN Element — kein Platzhalter, keine leere Raute. Das Raster hält "
	+ "die Spalte offen, die Zeilenhöhe bleibt gleich.");
checks++;
assert.strictEqual(avesmapsWikistatusMarkup("erfunden", "x"), "",
	"Ein unbekannter Zustand erzeugt nichts, statt eine vierte Form zu erfinden.");
checks++;

console.log(`wikistatus-abgleich: ${checks} Pruefungen bestanden `
	+ `(62 Kraftlinien: ${bilanz.zugewiesen} zugewiesen, ${bilanz.zuweisbar} zuweisbar, `
	+ `${bilanz.kandidat} Kandidaten, ${bilanz.nichts} ohne Symbol; 0 von 16 Paaren).`);
