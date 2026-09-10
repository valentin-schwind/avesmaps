// Owner-Meldung 09.09.2026: „ich möchte meine auswahl wieder von der stage nehmen, aber die
// optionen aus ‚offen' stehen mir in ‚stage' nicht zur verfügung." Und kurz darauf: „aber auch bei
// ‚offen' kommt das nur manchmal (wenn ich den importer neu öffne)."
//
// 🔴 DIE LEISTE HING NUR AM LISTENLAUF. Ein Häkchen ändert die Auswahl, aber NICHT die Liste (die
// neu zu bauen hiesse, sie unter dem Zeiger auszutauschen) -- also blieb die Leiste stehen, wie sie
// war, und erschien erst beim nächsten Reiter-, Filter- oder Fensterwechsel. Der Knopf
// „“ existierte die ganze Zeit
// (AVESMAPS_GARETIEN_AUSWAHL_KNOEPFE_JE_REITER.stage), er wurde nur nie gezeichnet.
//
// 🔴 ANGESCHLOSSEN SIND DIE ZUSTANDSÄNDERER, nicht die Klickwege: umschalten, alle wählen,
// aufheben -- und seit Fixrunde 1 zu Aufgabe 10 (Befund 1, Garetien-Fragmente-Verbund) auch der
// Verbund-Umschalter der gefalteten Zeile (garetienUebernommenAuswahlUmschalten). Die Klickwege
// dorthin werden mehr, wie der Kommentar hier von Anfang an vorhersagt.
//
// Ausführen: node js/review/__tests__/garetien-auswahlleiste-folgt.test.js

"use strict";
const assert = require("assert");
const { ladeImporter } = require("./helfer/garetien-testumgebung.js");

// ⭐ Die Leiste braucht ihren Wirt -- `ladeImporter` nimmt genau dafuer zusaetzliche Ids.
const { api, dom } = ladeImporter(["garetien-auswahlleiste"]);
let n = 0;
function pruefe(b, was) { n++; assert.ok(b, was); }

function sichtbar() {
	const el = dom.el("#garetien-auswahlleiste");
	return !!el && el.hidden === false && String(el.innerHTML || "") !== "";
}
function text() { return String((dom.el("#garetien-auswahlleiste") || {}).innerHTML || ""); }

const A = { key: "a", stand: "offen", urteil: "neu", items: [{ id: 1, change_type: "new" }] };
const B = { key: "b", stand: "offen", urteil: "neu", items: [{ id: 2, change_type: "new" }] };

// --- 1. Das erste Häkchen HOLT die Leiste, ohne dass die Liste neu läuft ------------------------
api.avesmapsGaretienAuswahlAufheben();
pruefe(!sichtbar(), "ohne Auswahl keine Leiste");
api.avesmapsGaretienAuswahlUmschalten("a", A);
pruefe(sichtbar(), "das erste Häkchen holt die Leiste SOFORT -- ohne Listenlauf");
pruefe(text().includes("Auswahl"), "und sie trägt ihre Knöpfe: " + text().slice(0, 120));

// --- 2. Das Abwählen des letzten nimmt sie wieder weg -------------------------------------------
// ⚠️ BEIDE Ausgänge des Umschalters: ohne den zweiten bliebe die Leiste über einer leeren Auswahl
// stehen und böte Handlungen für null Objekte an.
api.avesmapsGaretienAuswahlUmschalten("a", A);
pruefe(!sichtbar(), "das Abwählen des letzten Häkchens nimmt sie wieder weg");

// --- 3. „“ ebenso ---------------------------------------------------------------------
api.avesmapsGaretienAlleWaehlen([A, B]);
pruefe(sichtbar(), "„“ holt sie auch");
pruefe(/2 Objekte/.test(text()), "mit der richtigen Zahl: " + text().slice(0, 160));

// --- 4. „“ -----------------------------------------------------------------------
api.avesmapsGaretienAuswahlAufheben();
pruefe(!sichtbar(), "und „“ nimmt sie weg");

// --- 5. 🔴 AUF DER STAGE steht der Weg zurück ----------------------------------------------------
// Das ist die eigentliche Meldung: der Reiter „“ hat seinen eigenen Knopfsatz, und ohne die
// Auffrischung bekam ihn nie jemand zu sehen.
api.avesmapsGaretienStandSetzen ? api.avesmapsGaretienStandSetzen("stage") : null;
const stand = api.garetienAuswahlleisteZustand("stage", 2, [A, B]);
pruefe(stand.sichtbar, "die Stage-Leiste ist sichtbar");
const namen = stand.knoepfe.map(function (k) { return k.name; });
pruefe(namen.indexOf("auswahl_entstagen") !== -1,
	"und trägt „“: " + namen.join(", "));
pruefe(namen.indexOf("auswahl_aufheben") !== -1, "sowie „“");

// --- 6. Die Naht: alle Änderer rufen wirklich auf --------------------------------------------
// 💣 1 bis 5 könnten grün sein, während ein weiterer Änderer dazukommt und es niemand merkt. Gezählt
// wird deshalb der AUFRUF, nicht die Definition.
// 🔴 5, seit Fixrunde 1 zu Aufgabe 10 (Befund 1): der Verbund-Umschalter der gefalteten Zeile
// (garetienUebernommenAuswahlUmschalten) mutiert `zustand.auswahl` genauso wie die drei
// ursprünglichen Änderer und muss darum ebenso die Leiste auffrischen -- vorher zwei Ausgänge des
// Umschalters + „alle wählen" + „aufheben".
const fs = require("fs");
const quelle = fs.readFileSync(require("path").join(__dirname, "..", "review-garetien-importer.js"), "utf8");
const rufe = (quelle.match(/garetienAuswahlleisteAuffrischen\(\);/g) || []).length;
pruefe(rufe === 5,
	"fünf Aufrufe -- zwei Ausgänge des Umschalters, alle wählen, aufheben, Verbund-Umschalter: " + rufe);

console.log("OK -- " + n + " Zusicherungen");
