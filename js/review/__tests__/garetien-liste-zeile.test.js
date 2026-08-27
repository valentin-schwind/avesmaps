// Aufgabe 11 des Garetien Importers -- die Arbeitsliste: Zeilen, Bilanz, Reiter.
// Auftrag: docs/superpowers/specs/2026-08-27-garetien-importer-fenster-auftrag.md
// Brief:   .superpowers/sdd/2026-08-27-garetien-importer-fenster/task-11-brief.md
// Mockup:  docs/garetien-importer-mockup.html §4
//
// Ausfuehren, vom Repo-Wurzelverzeichnis: node js/review/__tests__/garetien-liste-zeile.test.js
//
// 🔴 Geprueft wird ausschliesslich die PURE Haelfte -- garetienZeileMarkup baut nur einen String
// (kein DOM-Zugriff), und der Sender/die DOM-Verdrahtung braucht einen Browser (siehe die
// Abnahme im Bericht). module.exports gibt die echten Funktionen zurueck, kein Nachbau.

"use strict";

const path = require("path");
const assert = require("assert");

const mod = require(path.resolve(__dirname, "..", "review-garetien-importer.js"));

let checks = 0;
function gleich(ist, soll, warum) {
	assert.strictEqual(ist, soll, warum || "");
	checks++;
}
function wahr(bedingung, warum) {
	assert.ok(bedingung, warum || "");
	checks++;
}

const { garetienZeileMarkup, avesmapsGaretienCheckboxZustand, avesmapsGaretienHatAuswahl } = mod;

wahr(typeof garetienZeileMarkup === "function", "garetienZeileMarkup fehlt im Export");
wahr(typeof avesmapsGaretienCheckboxZustand === "function", "avesmapsGaretienCheckboxZustand fehlt im Export");
wahr(typeof mod.avesmapsGaretienAngehakt === "function", "avesmapsGaretienAngehakt fehlt im Export");

// ---- Grundstruktur: genau die sechs Klassen, keine eigene Zeilenklasse ------------------------

const basis = {
	key: "wiki:Gewaesser:Bach:1", name: "Alke", typ: "Bach", urteil: "ergaenzung",
	grund: "1 Abschnitt, ohne Namen",
	abschnitte: [{ public_id: "w-1", name: "", punkte: 1 }],
	items: [{ id: 1, selected: 1 }],
};

const markupBasis = garetienZeileMarkup(basis);
["avm-row", "avm-row__text", "avm-row__l1", "avm-row__name", "avm-row__kind", "avm-row__l2"].forEach((klasse) => {
	wahr(markupBasis.includes(klasse), `Klasse ${klasse} fehlt im Zeilenmarkup`);
});
// 🪤 Nicht abschreiben (AGENTS.md §11): keine ZWEITE, eigene Zeilenklasse (z.B. "gi-row") daneben.
wahr(!/class="[^"]*\bgi-row\b/.test(markupBasis),
	"Es darf keine eigene Zeilenklasse geben -- .avm-row ist die einzige Rezeptur (AGENTS.md §11)");
wahr(markupBasis.includes("Alke"), "der Name muss im Markup stehen");
wahr(markupBasis.includes("Bach"), "der Typ muss im Markup stehen");
wahr(markupBasis.includes("1 Abschnitt, ohne Namen"), "der Grund muss im Markup stehen");

// ---- Das Urteil ist Farbe -- die sechs Klassen aus dem Brief ----------------------------------

const urteilFaelle = [
	["ergaenzung", "u--erg"],
	["neu", "u--neu"],
	["zweifel", "u--zweif"],
	["widerspruch", "u--wider"],
	["deckt_sich", "u--deckt"],
	["uebersprungen", "u--deckt"],
];
urteilFaelle.forEach(([urteil, klasse]) => {
	const markup = garetienZeileMarkup(Object.assign({}, basis, { urteil }));
	wahr(markup.includes(klasse), `Urteil "${urteil}" muss die Klasse ${klasse} tragen`);
});

// ---- Das dreiwertige Haekchen ------------------------------------------------------------------
// 🔴 5 Abschnitte, 2 angehakte Items -> dreiwertig. Die Items tragen `selected` als 0/1-ZAHL, so
// wie der echte Server sie schickt (`(int) $roh['selected']`) -- NICHT als Bool. Ein Code, der nur
// `=== true` prueft, liest das live als "nichts angehakt".

const fuenfAbschnitteZweiAngehakt = Object.assign({}, basis, {
	abschnitte: [1, 2, 3, 4, 5].map((n) => ({ public_id: "w-" + n, name: "x", punkte: 1 })),
	items: [
		{ id: 1, selected: 1 }, { id: 2, selected: 1 }, { id: 3, selected: 0 },
		{ id: 4, selected: 0 }, { id: 5, selected: 0 },
	],
});
const zustandGemischt = avesmapsGaretienCheckboxZustand(fuenfAbschnitteZweiAngehakt);
gleich(zustandGemischt.dreiwertig, true, "5 Abschnitte, 2 angehakte Items -> dreiwertig === true");
gleich(zustandGemischt.checked, false, "dreiwertig ist NICHT checked");
gleich(zustandGemischt.disabled, false);

const alleAngehakt = avesmapsGaretienCheckboxZustand(
	Object.assign({}, basis, { items: [{ id: 1, selected: 1 }, { id: 2, selected: 1 }] })
);
gleich(alleAngehakt.checked, true, "alle Items angehakt -> checked");
gleich(alleAngehakt.dreiwertig, false);

const keinsAngehakt = avesmapsGaretienCheckboxZustand(
	Object.assign({}, basis, { items: [{ id: 1, selected: 0 }, { id: 2, selected: 0 }] })
);
gleich(keinsAngehakt.checked, false, "keins angehakt -> weder checked noch dreiwertig");
gleich(keinsAngehakt.dreiwertig, false);
gleich(keinsAngehakt.disabled, false);

// Ein Objekt OHNE Items (deckt sich / uebersprungen): deaktiviertes Haekchen -- "es gibt nichts
// zu tun; die Zeile steht nur da, damit die Zahl nachpruefbar bleibt" (Mockup §5).
const ohneItems = avesmapsGaretienCheckboxZustand(Object.assign({}, basis, { items: [] }));
gleich(ohneItems.disabled, true, "ohne Items -> deaktiviertes Haekchen");
gleich(ohneItems.checked, false);
gleich(ohneItems.dreiwertig, false);

// Und im MARKUP: die drei Zustaende muessen als Attribut/Marker auftauchen.
// 💣 `indeterminate` ist eine JS-EIGENSCHAFT, kein HTML-Attribut -- ein `indeterminate=""` im
// Markup taete nichts. Der dreiwertige Zustand kommt deshalb ueber einen MARKER (`data-part`,
// wie im Mockup-Script vorgemacht), den die Renderfunktion nach dem Einfuegen ins DOM per
// `el.indeterminate = true` einloest.
wahr(/<input type="checkbox"[^>]*\bdisabled\b/.test(
	garetienZeileMarkup(Object.assign({}, basis, { urteil: "deckt_sich", items: [] }))
), "ohne Items muss das Haekchen im Markup disabled sein");
wahr(/<input type="checkbox"[^>]*\bdata-part\b/.test(garetienZeileMarkup(fuenfAbschnitteZweiAngehakt)),
	"dreiwertig muss ueber einen Marker (data-part) erkennbar sein, NICHT ueber ein indeterminate-Attribut");
wahr(!/<input type="checkbox"[^>]*\bdata-part\b/.test(
	garetienZeileMarkup(Object.assign({}, basis, { items: [{ id: 1, selected: 1 }] }))
), "voll angehakt darf KEINEN dreiwertig-Marker tragen");
wahr(/<input type="checkbox"[^>]*\bchecked\b/.test(
	garetienZeileMarkup(Object.assign({}, basis, { items: [{ id: 1, selected: 1 }] }))
), "voll angehakt -> checked im Markup");
wahr(!/<input type="checkbox"[^>]*\bchecked\b/.test(
	garetienZeileMarkup(Object.assign({}, basis, { items: [{ id: 1, selected: 0 }] }))
), "keins angehakt -> KEIN checked im Markup");

// avesmapsGaretienHatAuswahl treibt das ✦ ("leuchtet") -- schon EIN angehaktes Item genuegt,
// auch bei einem sonst dreiwertigen Objekt.
gleich(avesmapsGaretienHatAuswahl(fuenfAbschnitteZweiAngehakt), true, "2 von 5 angehakt -> leuchtet");
gleich(avesmapsGaretienHatAuswahl(Object.assign({}, basis, { items: [{ id: 1, selected: 0 }] })), false);
wahr(garetienZeileMarkup(fuenfAbschnitteZweiAngehakt).includes("lit-dot"),
	"ein Objekt mit >=1 angehaktem Item traegt das ✦ hinter dem Namen");
wahr(!garetienZeileMarkup(Object.assign({}, basis, { items: [{ id: 1, selected: 0 }] })).includes("lit-dot"),
	"ohne Auswahl darf kein ✦ stehen");

// ---- Die Bilanz ruft avesmapsListBalanceText WIRKLICH auf (Spion) -----------------------------
// 🔴 js/review/review-list-balance.js ist der EINE Erzeuger -- nicht nachbauen. Ein Test, der nur
// das Markup liest, sieht eine handgeschriebene Kopie nicht von einem echten Aufruf unterschieden;
// der Spion prueft die LAUFZEIT.

const aufrufe = [];
global.avesmapsListBalanceText = function () {
	aufrufe.push(Array.prototype.slice.call(arguments));
	return "SPION-ERGEBNIS";
};
wahr(typeof mod.avesmapsGaretienBalanceZeileText === "function", "avesmapsGaretienBalanceZeileText fehlt");
const balanceText = mod.avesmapsGaretienBalanceZeileText(10, 289);
gleich(balanceText, "SPION-ERGEBNIS",
	"die Bilanzzeile muss den RUECKGABEWERT von avesmapsListBalanceText verwenden, nicht selbst formulieren");
gleich(aufrufe.length, 1, "avesmapsListBalanceText muss GENAU EINMAL wirklich aufgerufen werden");
gleich(aufrufe[0][1], 10, "sichtbar (gefiltert) muss durchgereicht werden");
gleich(aufrufe[0][2], 289, "gesamt (der aktiven Ansicht) muss durchgereicht werden");
delete global.avesmapsListBalanceText;

// ---- Die stille Laufzeile (.gi-runline) -- Bilanz des LAUFS, unabhaengig vom Filter -----------

wahr(typeof mod.avesmapsGaretienRunlineMarkup === "function", "avesmapsGaretienRunlineMarkup fehlt");
const runline = mod.avesmapsGaretienRunlineMarkup({
	neu: 199, ergaenzung: 25, zweifel: 32, widerspruch: 3, deckt_sich: 24, uebersprungen: 6,
});
gleich(/(\D|^)289(\D|$)/.test(runline), true, "289 Zeilen insgesamt (Summe aller Urteile) muss vorkommen");
["199", "25", "32", "3", "24", "6"].forEach((zahl) => {
	wahr(runline.includes(zahl), `Runline muss die Zahl ${zahl} enthalten`);
});

// ---- Die Reiter zeigen den BEARBEITUNGSSTAND, nicht das Urteil --------------------------------

wahr(typeof mod.avesmapsGaretienTabsMarkup === "function", "avesmapsGaretienTabsMarkup fehlt");
const tabs = mod.avesmapsGaretienTabsMarkup(
	{ offen: 259, vorgemerkt: 14, abgelehnt: 3, uebernommen: 0 }, "offen"
);
["Offen", "Vorgemerkt", "Abgelehnt", "Übernommen"].forEach((label) => {
	wahr(tabs.includes(label), `Reiter "${label}" fehlt`);
});
wahr(tabs.includes("avm-tab"), "die Reiter muessen .avm-tab tragen (Hausform, editor-body.css)");
wahr(/data-stand="offen"[^>]*>|class="avm-tab is-active"/.test(tabs) && tabs.includes("is-active"),
	"der aktive Reiter (hier: offen) muss is-active tragen");
// Kein zweiter aktiver Reiter:
gleich((tabs.match(/is-active/g) || []).length, 1, "genau EIN Reiter ist aktiv");

console.log(`garetien-liste-zeile: ${checks} Pruefungen bestanden.`);
