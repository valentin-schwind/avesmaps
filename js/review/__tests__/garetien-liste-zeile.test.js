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

// ---- Aufgabe 2 (29.08.2026): das Haekchen der ZEILE wird zum reinen MARKER ----------------------
// 🔴 RULING (Aufgabe 2, Entwurf §3.2): `checked` kommt jetzt aus einem zweiten Argument (dem
// Markierungsstand aus `zustand.markiert`), NICHT mehr aus dem Item-Zustand -- „Markieren aendert
// nichts" (Owner 29.08.2026). Damit faellt weg, was hier VORHER stand: KEIN `disabled` mehr (ein
// Objekt OHNE Items -- 7930 von 8213, Entwurf §3 -- muss sich GENAUSO markieren lassen wie eines
// mit Vorschlag) und KEIN dreiwertiger Zustand mehr (Markieren ist ein Bool, kein Item-Mix).
// `garetienZeileMarkup` bleibt dabei REIN: der Markierungsstand wird als zweites Argument
// hereingereicht, nicht aus dem Modulzustand gelesen.
wahr(/<input type="checkbox" checked>/.test(garetienZeileMarkup(basis, true)),
	"markiert -> checked im Markup");
wahr(!/checked/.test(garetienZeileMarkup(basis, false)),
	"unmarkiert -> kein checked im Markup, UNABHAENGIG vom Item-Zustand");
// Die DIFFERENZ zur alten Regel: genau das Objekt, das vorher deaktiviert war (kein Item), ist
// jetzt anhakbar -- das war der Konstruktionsfehler, den Aufgabe 2 behebt.
wahr(!/<input type="checkbox"[^>]*\bdisabled\b/.test(
	garetienZeileMarkup(Object.assign({}, basis, { urteil: "deckt_sich", items: [] }), false)
), "auch OHNE Items bleibt das Haekchen bedienbar -- genau diese 7930 von 8213 Objekte hatten "
	+ "vorher gar keine Chance auf ein Haekchen");
wahr(/<input type="checkbox" checked>/.test(
	garetienZeileMarkup(Object.assign({}, basis, { urteil: "deckt_sich", items: [] }), true)
), "und genau so ein Objekt laesst sich auch wirklich markieren");
[true, false].forEach((markiert) => {
	wahr(!/data-part/.test(garetienZeileMarkup(fuenfAbschnitteZweiAngehakt, markiert)),
		`kein dreiwertiger Zustand mehr (markiert=${markiert}) -- Markieren kennt nur an/aus, `
		+ "kein Item-Mix");
});

// avesmapsGaretienHatAuswahl treibt das ✦ ("leuchtet") -- schon EIN angehaktes Item genuegt,
// auch bei einem sonst dreiwertigen Objekt. ⚠️ UNVERAENDERT und UNABHAENGIG von der Markierung:
// ein vorgemerkter Geometrie-Ersatz IST eine Vormerkung und gehoert auf die Karte, markiert oder
// nicht (Aufgabe 2).
gleich(avesmapsGaretienHatAuswahl(fuenfAbschnitteZweiAngehakt), true, "2 von 5 angehakt -> leuchtet");
gleich(avesmapsGaretienHatAuswahl(Object.assign({}, basis, { items: [{ id: 1, selected: 0 }] })), false);
wahr(garetienZeileMarkup(fuenfAbschnitteZweiAngehakt, false).includes("lit-dot"),
	"ein Objekt mit >=1 angehaktem Item traegt das ✦ hinter dem Namen -- auch UNMARKIERT");
wahr(!garetienZeileMarkup(Object.assign({}, basis, { items: [{ id: 1, selected: 0 }] }), true)
	.includes("lit-dot"),
	"ohne Auswahl darf kein ✦ stehen -- auch MARKIERT nicht");

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
// 🔴 RULING R1 (Aufgabe 1, 29.08.2026): „Vorgemerkt" ist an dieser Stelle durch „Anzeigen"
// ersetzt -- die client-seitige Anzeige-Menge (garetien-anzeige-menge.test.js), nicht mehr ein
// aus `selected` abgeleiteter Bearbeitungsstand.
["Offen", "Anzeigen", "Abgelehnt", "Übernommen"].forEach((label) => {
	wahr(tabs.includes(label), `Reiter "${label}" fehlt`);
});
wahr(tabs.includes("avm-tab"), "die Reiter muessen .avm-tab tragen (Hausform, editor-body.css)");
wahr(/data-stand="offen"[^>]*>|class="avm-tab is-active"/.test(tabs) && tabs.includes("is-active"),
	"der aktive Reiter (hier: offen) muss is-active tragen");
// Kein zweiter aktiver Reiter:
gleich((tabs.match(/is-active/g) || []).length, 1, "genau EIN Reiter ist aktiv");

// ---- Die Fusszeile: BEARBEITUNGSSTAND (Mockup §1), NICHT die Item-Ebene aus `angehakt.*` ------
// 🔴 Review I1 (28.08.2026): der erste Bau zeigte "X angehakt · Y im Lauf" aus `angehakt.new`/
// `angehakt.changed` -- das ist Aufgabe 16s Kennzahl (die truncated-Angabe im Uebernahme-Blatt),
// nicht diese Fusszeile. Das Mockup verlangt fuer #garetien-foot-count wortgleich
// "<b>14</b> vorgemerkt · <b>3</b> abgelehnt · <b>0</b> übernommen" -- aus a.reiter, derselben
// Quelle wie die vier Reiter oben.
wahr(typeof mod.avesmapsGaretienFussZeileMarkup === "function", "avesmapsGaretienFussZeileMarkup fehlt");
const fusszeile = mod.avesmapsGaretienFussZeileMarkup(
	{ offen: 259, vorgemerkt: 14, abgelehnt: 3, uebernommen: 0 }
);
gleich(fusszeile, "<b>14</b> vorgemerkt · <b>3</b> abgelehnt · <b>0</b> übernommen",
	"die Fusszeile muss wortgleich mit dem Mockup sein -- vorgemerkt/abgelehnt/uebernommen aus a.reiter");
wahr(!/angehakt|im Lauf/.test(fusszeile),
	"die Fusszeile darf NICHT die Item-Ebene aus angehakt.* zeigen -- das ist Aufgabe 16s Kennzahl");


// ---- Das Skelett der linken Spalte: GEPARST, nicht durchsucht ---------------------------------
//
// 🔴 WARUM ES DIESEN ABSCHNITT GIBT. Am 29.08.2026 fehlte in `garetienListeSkelettMarkup` EIN
// `</div>` -- das der `.gi-searchrow`. Der Browser haengte daraufhin Chips, Bilanz und die ganze
// Liste IN die Suchzeile, und die ist `display: flex` (eine Reihe): alles stand NEBENEINANDER
// statt untereinander. Der Owner sah es sofort („irgendwas ist komisch/verrutscht"), live
// gemessen: die Spalte hatte ZWEI Kinder statt fuenf, und `.gi-searchrow` war 527px hoch.
//
// 🪤 KEIN Test hat es gesehen, und der Grund ist die Lehre: alle pruefen den Skelett-STRING
// (`includes("gi-balance")` und dergleichen) oder bauen sich im Pruefstand ihr EIGENES,
// wohlgeformtes Markup. Ein `includes` findet ein Element auch dann, wenn es drei Ebenen zu tief
// haengt. Gemessen wird deshalb die STRUKTUR: die Zahl der Kinder und wo jedes sitzt.
const skelett = mod.garetienListeSkelettMarkup();

// 💣 Die Ausgeglichenheit zuerst -- sie ist die Ursache, alles andere ist ihre Wirkung.
gleich((skelett.match(/<div/g) || []).length, (skelett.match(/<\/div>/g) || []).length,
	"das Skelett muss ausgeglichen sein: jedes <div> braucht sein </div>, sonst verschluckt das "
	+ "erste offene Element alle folgenden Geschwister");
checks++;

// Und die Wirkung, an der Struktur gemessen: SECHS Geschwister auf der obersten Ebene (RULING R7,
// Fix-Runde 1, haengt den Hinweis `.gi-anzeigehinweis` zwischen Suchzeile und Chips an).
// 🔴 Regression 29.08.2026 (Owner-Meldung): `.gi-anzeigebar` mit den zwei Anzeige-Knoepfen stand
// hier vorher an SIEBTER Stelle (zwischen Hinweis und Chips) -- sie ist jetzt aus dem Skelett
// verschwunden, weil die zwei Knoepfe in die Fusszeile umgezogen sind (statisch in index.html,
// `.gi-foot`, links von „Alle angezeigten einfuegen"). Ihre IDs (garetien-mark-show,
// garetien-anzeige-clear) bleiben unveraendert, nur ihre Verdrahtung wanderte von
// garetienListeSkelettVerdrahten() nach bindFenster().
// ⚠️ Ein winziger Parser statt einer DOM-Nachbildung -- er zaehlt nur die Verschachtelungstiefe,
// und genau die war der Fehler.
function obersteEbene(html) {
	const raus = [];
	let tiefe = 0;
	const muster = /<(\/?)(div|p|input|button)\b([^>]*)>/g;
	let treffer;
	while ((treffer = muster.exec(html)) !== null) {
		const zu = treffer[1] === "/";
		const leer = treffer[2] === "input" || /\/>$/.test(treffer[0]);
		if (!zu && tiefe === 0) {
			const klasse = /class="([^"]*)"/.exec(treffer[3]);
			raus.push(klasse ? klasse[1].split(" ")[0] : treffer[2]);
		}
		if (leer) { continue; }
		tiefe += zu ? -1 : 1;
	}
	return raus;
}
const oben = obersteEbene(skelett);
gleich(oben.join(","), "avm-tabs,gi-searchrow,gi-anzeigehinweis,gi-chips,gi-balance,avm-scroll",
	"die linke Spalte hat SECHS Geschwister in dieser Reihenfolge -- stehen Chips, Bilanz oder "
	+ "Liste IN der `.gi-searchrow`, legt deren `display: flex` sie nebeneinander");
checks++;

// Und die DIFFERENZ zur Regression: die zwei Anzeige-Knoepfe stehen NICHT MEHR in diesem Skelett --
// sie sind in die Fusszeile umgezogen (index.html, `.gi-foot`) und werden dort statisch geladen.
wahr(!skelett.includes("gi-anzeigebar"),
	"'.gi-anzeigebar' darf nicht mehr im dynamischen Skelett stehen -- die zwei Knoepfe leben jetzt "
	+ "im Fuss von index.html");
wahr(!skelett.includes('id="garetien-mark-show"') && !skelett.includes('id="garetien-anzeige-clear"'),
	"die zwei Anzeige-Knoepfe duerfen nicht ZWEIMAL entstehen -- einmal hier UND einmal in "
	+ "index.html waere eine Doppelanmeldung mit zwei Klick-Zuhoerern (AGENTS.md §11)");

console.log(`garetien-liste-zeile: ${checks} Pruefungen bestanden.`);
