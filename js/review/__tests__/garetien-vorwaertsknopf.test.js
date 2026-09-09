// Aufgabe 9+10 des Garetien Importers (07.09.2026) -- ein Vorwaertsknopf je Zustand, und die
// Rueckmeldung, die „Ablehnen" bisher gefehlt hat.
// Brief: .superpowers/sdd/2026-09-06-garetien-importer-stage/task-9-10-brief.md
//
// Ausfuehren, vom Repo-Wurzelverzeichnis: node js/review/__tests__/garetien-vorwaertsknopf.test.js
//
// 💣 DER FEHLER, DEN DIESE DATEI FESTNAGELT: „Ablehnen" gehoert dem Objekt der EINZELANSICHT.
// Ein Klick auf ein HAEKCHEN wechselt sie nicht -- der Owner hakte „Gramfeldermoor" an, rechts
// stand „Briskenmoor", und abgelehnt wurde Briskenmoor. Der Knopf tat etwas, nur am falschen
// Objekt. Deshalb sagt die Leiste jetzt, FUER WEN sie gilt, und der stille Ausgang meldet
// seinen Grund.

"use strict";
const assert = require("assert");
const { ladeImporter } = require("./helfer/garetien-testumgebung.js");

const { api, dom } = ladeImporter();
const {
	garetienHandlungen, garetienHandlungsMarkup, garetienHandlungsRumpf,
	garetienHandlungKlick, garetienStatusSetzen,
} = api;

let checks = 0;
const wahr = (b, w) => { assert.ok(b, w || ""); checks++; };
const gleich = (i, s, w) => { assert.strictEqual(i, s, w || ""); checks++; };
const tief = (i, s, w) => { assert.deepStrictEqual(i, s, w || ""); checks++; };

const namen = (o) => garetienHandlungen(o).map((k) => k.name);
const knopf = (o, n) => garetienHandlungen(o).filter((k) => k.name === n)[0];

// Kommentare aus einem Markup schneiden -- die Zusicherung „kein Neu einfuegen" darf nicht an
// einem Kommentar anschlagen, der genau davor warnt.
const ohneKommentare = (s) => String(s).replace(/<!--[\s\S]*?-->/g, "");

const offenMitVorschlag = {
	key: "a", stand: "offen", urteil: "neu", name: "Gramfeldermoor",
	items: [{ id: 1, change_type: "new" }],
};
const offenOhneVorschlag = { key: "b", stand: "offen", urteil: "uebersprungen", name: "Perz", items: [] };
const ergaenzung = {
	key: "c", stand: "offen", urteil: "ergaenzung", name: "Natter",
	abschnitte: [{ public_id: "Flussweg-4471", name: "Natter" }],
	items: [{ id: 7, change_type: "changed", felder: ["quelle"], abschnitt: { public_id: "Flussweg-4471" } }],
};

// =================================================================================================
// 1. „Neu einfügen" ist WEG -- im Modul und im kommentarfreien Markup (Owner-Punkt 12).
//    🔴 Angelegt wird ab jetzt ueber „Stage importieren"; ein Knopf, der die Stage umgeht,
//       widerspricht dem Weg, den dieses Fenster erzwingen soll.
// =================================================================================================
[offenMitVorschlag, offenOhneVorschlag, ergaenzung].forEach((o) => {
	gleich(namen(o).includes("neu"), false, "kein „neu\" bei " + o.urteil);
	gleich(ohneKommentare(garetienHandlungsMarkup(o)).includes('data-handlung="neu"'), false,
		"kein neu-Knopf im Markup bei " + o.urteil);
	// 🔴 SEIT 09.09.2026 STEHT „Neu einfügen“ WIEDER IM MARKUP -- aber als HAEKCHEN, nicht
	// als Knopf (Owner: „sollten das häkchen sein“). Der Unterschied ist der ganze Grund, warum
	// der Knopf am 07.09.2026 fiel: er legte SOFORT an und umging die Stage. Das Häkchen
	// entscheidet nur, was die Stage mitnimmt -- der Weg ueber „Stage importieren“ bleibt
	// erzwungen. ⚠️ Geprueft wird deshalb das HANDLUNGSATTRIBUT, nicht mehr die Zeichenkette.
	gleich(ohneKommentare(garetienHandlungsMarkup(o)).includes('data-handlung="neu"'), false,
		"und kein Knopf mit dieser Handlung (" + o.urteil + ")");
});
// Und die Tuer bleibt auch dann zu, wenn jemand den Namen von Hand schickt.
gleich(garetienHandlungsRumpf("neu", offenMitVorschlag, 5), null,
	"ein von Hand geschickter „neu\"-Rumpf kommt nicht mehr durch");

// 🪤 UND DER RIEGEL FUER DEN VORWAERTSKNOPF WIRD AM QUELLTEXT GEMESSEN, nicht am Ergebnis.
//    Er ist HEUTE redundant (der Knopf traegt `ids: []` und faellt ohnehin durch die
//    Laengenpruefung) -- eine Zusicherung ueber ein Verhalten, das es gar nicht geben kann, waere
//    Vakuum. Gaebe jemand dem Knopf je Items, schickte er ohne diese Zeile still ein `select` an
//    die geteilte Tuer; genau deshalb steht sie da und wird hier festgehalten.
const rumpfQuelltext = String(garetienHandlungsRumpf);
["stage", "entstagen"].forEach((verb) => {
	wahr(rumpfQuelltext.indexOf('name === "' + verb + '"') !== -1,
		"garetienHandlungsRumpf nennt „" + verb + "\" ausdruecklich als client-seitiges Verb");
});

// =================================================================================================
// 2. „Bei X Quelle + Artikel einfügen" ist WEG -- gemessen: der Stage-Import traegt die
//    Ergaenzung genauso durch (garetienStageUebernahmeIds liefert das quelle-Item).
// =================================================================================================
gleich(namen(ergaenzung).includes("quelle"), false, "kein „quelle\"-Knopf mehr");
tief(api.garetienStageUebernahmeIds([ergaenzung]), [7],
	"…weil der Stage-Import genau dieses Item schreibt -- sonst waere die Handlung unerreichbar");

// =================================================================================================
// 3. Je Zustand genau EIN Vorwaertsknopf, nach der Tafel des Briefs.
// =================================================================================================
tief(namen(offenMitVorschlag), ["stage", "ablehnen"], "Offen, mit Vorschlag");
tief(namen(offenOhneVorschlag), ["stage", "ablehnen"], "Offen, ohne Vorschlag");
tief(namen(ergaenzung), ["stage", "ablehnen"], "Offen, Ergaenzung");
tief(namen({ key: "d", stand: "abgelehnt", items: [{ id: 9, change_type: "new" }] }), ["wieder"],
	"Abgelehnt hat GENAU EINEN Ausgang zurueck");

// Die zweite Zeile sagt, was auf der Stage laege bzw. dass es nur Ansicht ist.
// ⚠️ Sie liest die GEWAEHLTE Form (garetienUnserBeschriftung), nicht den rohen Vorschlag --
//    sonst versprach der Knopf etwas anderes als der Kasten „Eingefügt wird" darueber.
const wegObjekt = {
	key: "w", stand: "offen", urteil: "neu", name: "Schattenbach",
	ziel: "path", subtyp: "Flussweg", is_bach: true,
	items: [{ id: 4, change_type: "new" }],
};
// 🔴 SEIT 09.09.2026 OHNE ZWEITE ZEILE. Form und Art stehen im Kasten „Eingefuegt wird“
// darueber, und WAS der Import tut, sagen die zwei Haekchen -- der Knopf behauptet nichts mehr.
gleich(knopf(wegObjekt, "stage").zeile2, "",
	"der Knopf traegt keine zweite Zeile mehr");
gleich(/\d/.test(knopf(wegObjekt, "stage").beschriftung), false,
	"und die erste traegt keine Zahl");
// 🔴 SEIT 09.09.2026 SAGT ES DER KASTEN, NICHT DER KNOPF (garetienEinfuegeHakenMarkup).
// Der Satz durfte nicht ersatzlos fallen: ohne ihn sieht ein Objekt ohne Vorschlag aus wie eines
// mit, nur ohne Haekchen -- und das liest sich wie ein Fehler.
// 🔴 UND ERST AUF DER STAGE (Owner 09.09.2026). Davor steht im Kasten gar nichts: die Frage
// „was soll eingefuegt werden" stellt sich erst, wenn das Objekt aufliegt.
wahr(api.garetienEinfuegeHakenMarkup(offenOhneVorschlag) === "",
	"vor der Stage zeigt der Kasten nichts");
api.avesmapsGaretienStageHinzufuegen([offenOhneVorschlag]);
wahr(api.garetienEinfuegeHakenMarkup(offenOhneVorschlag).includes("nur Ansicht"),
	"auf der Stage sagt der Kasten „nur Ansicht\"");
api.avesmapsGaretienStageLeeren();
gleich(knopf(offenOhneVorschlag, "stage").disabled, false,
	"…und der Knopf geht trotzdem: ansehen darf man alles");
wahr(knopf(offenOhneVorschlag, "ablehnen").disabled,
	"„Ablehnen\" ohne Item bleibt gesperrt -- mit Grund");
wahr(knopf(offenOhneVorschlag, "ablehnen").grund !== "", "und der Grund steht da");

// =================================================================================================
// 4. Auf der Stage kehrt sich der Vorwaertsknopf um.
// =================================================================================================
api.avesmapsGaretienStageHinzufuegen([offenMitVorschlag]);
tief(namen(offenMitVorschlag), ["entstagen", "ablehnen"], "auf der Stage: der Rueckweg");
// ⚠️ AUCH HIER OHNE ZWEITE ZEILE (09.09.2026). „Von der Stage nehmen“ sagt schon alles; was
// dort liegt, sagen die Haekchen darueber.
gleich(knopf(offenMitVorschlag, "entstagen").beschriftung, "Von der Stage nehmen",
	"auf der Stage kehrt sich der Knopf um");
gleich(knopf(offenMitVorschlag, "entstagen").zeile2, "", "und traegt keine zweite Zeile");
api.avesmapsGaretienStageLeeren();
tief(namen(offenMitVorschlag), ["stage", "ablehnen"], "und wieder zurueck");

// =================================================================================================
// 5. 🔴 „Innerorts einfügen (Stadt)" BLEIBT -- und das ist eine gemessene Abweichung vom Brief.
//    Der Stage-Import schickt KEINE `einstellungen`; `avesmapsGaretienInnerortsGewuenscht`
//    (garetien-uebernahme.php) entscheidet ausschliesslich daraus. Gestrichen waere die Staette
//    unerreichbar -- genau der Schaden, den dieser Schritt beseitigen soll.
// =================================================================================================
const innerorts = {
	key: "e", stand: "offen", urteil: "neu", name: "Tempel des Praios",
	innerorts: { name: "Wandleth", public_id: "Ort-9" },
	items: [{ id: 3, change_type: "new" }],
};
tief(namen(innerorts), ["stage", "innerorts", "ablehnen"],
	"„Innerorts einfügen\" steht NEBEN dem Vorwaertsknopf, nicht statt seiner");
wahr(knopf(innerorts, "innerorts").beschriftung.includes("Wandleth"),
	"und nennt die Stadt weiterhin im Knopf");

// =================================================================================================
// 6. Die Knopfleiste sagt, FUER WEN sie gilt (Owner-Meldung „ablehnen geht generell nicht").
// =================================================================================================
// ⚠️ Im Markup steht „Dieses Objekt" in Satzschreibung -- die Versalien macht `.gi-sec`
//    (text-transform: uppercase), genau wie bei „Der Grund" und „Was bei uns … liegt" darueber.
//    Ein Test, der hier „DIESES OBJEKT" suchte, verlangte eine zweite, abweichende Schreibweise.
const markup = garetienHandlungsMarkup(offenMitVorschlag);
wahr(markup.includes("Dieses Objekt"), "die Ueberschrift steht ueber der Leiste");
wahr(markup.indexOf("Dieses Objekt") < markup.indexOf("data-handlung"),
	"…und zwar VOR dem ersten Knopf");
wahr(markup.includes('class="gi-sec gi-acts__titel"'),
	"in derselben Form wie „Der Grund\" darueber");

// =================================================================================================
// 7. 💣 DER STILLE AUSGANG MELDET SEINEN GRUND (Owner-Punkt 15, dritter Erzeuger).
//    Rund 4.700 der 8.329 offenen Zeilen tragen gar kein Item -- dort verwarf der Verteiler
//    wortlos, und „nix passiert" war von einem kaputten Knopf nicht zu unterscheiden.
// =================================================================================================
let gesendet = 0;
const senden = () => { gesendet++; return Promise.resolve(null); };
const ereignis = (name, key) => ({
	target: {
		closest(sel) {
			if (sel === "[data-handlung]") {
				return { disabled: false, getAttribute: (a) => (a === "data-handlung" ? name : key) };
			}
			return null;
		},
	},
});

garetienStatusSetzen("Ruhe", "", null);
const ergebnis = garetienHandlungKlick(ereignis("ablehnen", "b"), [offenOhneVorschlag], 5, senden, () => true);
gleich(gesendet, 0, "es geht nichts hinaus");
gleich(ergebnis, null, "und der Verteiler meldet „nicht uebernommen\"");
wahr(dom.text("#garetien-status-text").includes("Perz"),
	"aber die Statuszeile nennt das Objekt: " + dom.text("#garetien-status-text"));
wahr(dom.text("#garetien-status-text").includes("keinen Vorschlag"),
	"und den Grund des Knopfes");
wahr(dom.klassen("#garetien-status-text").includes("bad"), "im Ton „bad\"");

// Gegenprobe: mit Item geht es hinaus, OHNE Statusmeldung an dieser Stelle (die kommt erst
// nach dem Listenlauf).
garetienStatusSetzen("Ruhe", "", null);
const raus = garetienHandlungKlick(ereignis("ablehnen", "a"), [offenMitVorschlag], 5, senden, () => true);
gleich(gesendet, 1, "mit Item geht der Rumpf hinaus");
wahr(raus !== null, "und der Verteiler meldet „uebernommen\"");

// =================================================================================================
// 8. 💣 EIN GEGLUECKTES ABLEHNEN WIRD GENANNT -- und zwar NACH dem Listenlauf.
//    Davor gesetzt ueberschriebe der Renderer die Meldung sofort mit der neutralen Bilanz;
//    genau daran war ein gegluecktes Ablehnen bisher unsichtbar.
//    ⚠️ Gemessen wird der ABLAUF, nicht die Reihenfolge im Quelltext.
// =================================================================================================
// =================================================================================================
// 9. Die Designsprache des Akzentknopfs -- SCHRIFT UND RAHMEN, KEINE FUELLUNG.
//    💣 Gemessen am Stylesheet, denn nur dort steht sie: die eine gefuellte Handlung dieses
//    Fensters ist „Stage importieren" im Fuss (AGENTS.md §12). Ein `background` in `.btn--accent`
//    machte den Vorwaertsknopf zur zweiten Haupthandlung -- und zwar lautlos.
// =================================================================================================
const fs = require("fs");
const path = require("path");
const cssRoh = fs.readFileSync(
	path.resolve(__dirname, "..", "..", "..", "css", "components", "garetien-importer.css"), "utf8");
const cssOhneKommentare = cssRoh.replace(/\/\*[\s\S]*?\*\//g, "");
const regelAccent = (cssOhneKommentare.match(/\.gi-win \.btn--accent\s*\{([^}]*)\}/) || [])[1];
wahr(typeof regelAccent === "string", "es gibt eine Regel .gi-win .btn--accent");
wahr(!/background/.test(regelAccent),
	"💣 btn--accent setzt KEINE Fuellung -- die eine gefuellte Handlung steht im Fuss: " + regelAccent);
// ⚠️ Die Schrift ist `--color-accent-brown`, NICHT `--color-accent` -- ein MESSERGEBNIS: das Gold
//    ergibt auf dem weichen Knopfgrund im hellen Thema 2,09:1 und liegt weit unter den 4,5, die AA
//    fuer 12px verlangt. Der RAHMEN darf das Gold tragen (Nicht-Text, Schwelle 3,0).
wahr(/color:\s*var\(--color-accent-brown\)/.test(regelAccent),
	"die Schrift kommt aus --color-accent-brown (5,18 hell / 5,42 dunkel): " + regelAccent);
wahr(!/color:\s*var\(--color-accent\)/.test(regelAccent),
	"💣 und NICHT aus --color-accent -- das misst hell 2,09:1: " + regelAccent);
wahr(/border-color:\s*var\(--color-accent-strong\)/.test(regelAccent),
	"der Rahmen traegt das Gold: " + regelAccent);
// 💣 Und keine hartkodierte Farbe im ganzen neuen Block (AGENTS.md §12).
const zweiZeiler = (cssOhneKommentare.match(/\.gi-win \.gi-act--zwei\s*\{([^}]*)\}/) || [])[1] || "";
wahr(zweiZeiler.length > 0, "es gibt eine Regel .gi-win .gi-act--zwei");
wahr(!/#[0-9a-fA-F]{3,8}\b/.test(zweiZeiler + regelAccent),
	"keine hartkodierte Farbe -- nur Tokens aus css/base/tokens.css");
const leisteCss = (cssOhneKommentare.match(/\.gi-auswahlleiste\s*\{([^}]*)\}/) || [])[1] || "";
wahr(leisteCss.length > 0, "es gibt eine Regel .gi-auswahlleiste");
wahr(!/#[0-9a-fA-F]{3,8}\b/.test(leisteCss) && !/\b\d+px\b/.test(leisteCss.replace(/1px solid/g, "")),
	"und die Auswahlleiste ebenso wenig -- Abstaende nur als --space-*: " + leisteCss);

const ablauf = [];
const rufeAttrappe = () => { ablauf.push("tuer"); return Promise.resolve({ ok: true }); };
const listeAttrappe = () => {
	ablauf.push("liste");
	// Genau das tut der echte Renderer: er setzt die Statuszeile auf die neutrale Bilanz zurueck.
	garetienStatusSetzen("Lauf … · 8 213 Objekte", "", null);
	return Promise.resolve(null);
};

api.garetienHandlungSendenMitMeldung(
	{ action: "decline", ids: [1] }, "„Gramfeldermoor\" abgelehnt.", rufeAttrappe, listeAttrappe
).then(() => {
	tief(ablauf, ["tuer", "liste"], "erst die Tuer, dann der Listenlauf");
	wahr(dom.text("#garetien-status-text").includes("Gramfeldermoor"),
		"und DANACH steht die Meldung da: " + dom.text("#garetien-status-text"));
	wahr(dom.klassen("#garetien-status-text").includes("ok"), "im Ton „ok\"");
	console.log("OK -- " + checks + " Zusicherungen");
});
