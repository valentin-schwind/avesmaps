// Der Filtertrichter des Garetien-Importers zaehlt JE REITER -- und den Lauf daneben (Owner 15.09.2026).
//
// Owner, woertlich: „dass die filter nur für die ansichten/listen gelten und mitzählen, für die sie gerade
// zuständig sind" und „du kannst auch Grenzen 0/3052 anzeigen 0 = aktuelle liste / 3052 = gesamte liste".
//
// Ausfuehren, vom Repo-Wurzelverzeichnis: node js/review/__tests__/garetien-facetten-je-reiter.test.js

"use strict";
const assert = require("assert");
const { ladeImporter } = require("./helfer/garetien-testumgebung.js");

// ⚠️ Dieselben Elemente wie garetien-auswahlleiste.test.js: ohne `garetien-listcol` kehrt der Renderer vor
// den Facetten zurueck (garetienListeSkelettSicherstellen), und Abschnitt 4 mäße nichts.
const { api } = ladeImporter(["garetien-auswahlleiste", "garetien-alle", "garetien-alle-text", "garetien-alle-zahl",
	"garetien-listcol", "garetien-tabs", "garetien-search", "garetien-chips",
	"garetien-neutral-hinweis", "garetien-anzeige-hinweis", "garetien-detailcol",
	"garetien-apply", "garetien-apply-hint", "garetien-zentrieren-alle", "garetien-anzeige-clear",
	"garetien-filter-toggle", "garetien-filter-menu"]);
const { garetienStageFacetten, garetienFacettenOptionen, garetienStageAntwortBauen } = api;

let checks = 0;
const wahr = (b, w) => { assert.ok(b, w || ""); checks++; };
const gleich = (i, s, w) => { assert.strictEqual(i, s, w || ""); checks++; };
const tief = (i, s, w) => { assert.deepStrictEqual(i, s, w || ""); checks++; };

[["garetienStageFacetten", garetienStageFacetten], ["garetienFacettenOptionen", garetienFacettenOptionen],
	["garetienStageAntwortBauen", garetienStageAntwortBauen]].forEach(([n, f]) => {
	wahr(typeof f === "function", n + " fehlt im Export");
});

// =================================================================================================
// 1. Die Optionen zeigen „Reiter/Lauf".
// =================================================================================================
const reiter = { ebene: { Grenzen: 0, Gewaesser: 280 } };
const lauf = { ebene: { Grenzen: 3052, Gewaesser: 289 } };
tief(garetienFacettenOptionen(reiter, "ebene", null, lauf).map((o) => [o.value, o.count]),
	[["Gewaesser", "280/289"], ["Grenzen", "0/3052"]],
	"🔴 der Owner-Wortlaut: „Grenzen 0/3052\" -- vorn der Reiter, hinten der ganze Lauf");
gleich(garetienFacettenOptionen(reiter, "ebene", null, lauf).length, 2,
	"eine 0 vorn bleibt als Option stehen -- sonst liesse sich ein gewaehlter Wert nicht mehr abwaehlen");
// Ohne Laufzahlen (alter Aufrufer, alte Antwort) bleibt die blosse Zahl -- auch die 0.
gleich(garetienFacettenOptionen(reiter, "ebene")[1].count, 0, "ohne `gesamt` bleibt die Zahl eine Zahl");
gleich(garetienFacettenOptionen(reiter, "ebene", null, null)[0].count, 280, "…auch bei `null`");
// Fehlt ein Wert in den Laufzahlen, steht er als „n/n" da -- nie „n/undefined".
gleich(garetienFacettenOptionen({ ebene: { X: 2 } }, "ebene", null, { ebene: {} })[0].count, "2/2",
	"ein Wert, den der Lauf nicht kennt, zaehlt sich selbst");
gleich(garetienFacettenOptionen({ ebene: { X: 2 } }, "ebene", null, { typ: { Y: 1 } })[0].count, 2,
	"ohne Laufzahlen fuer DIESES Feld bleibt die blosse Zahl");

// =================================================================================================
// 2. Die Stage zaehlt sich selbst -- ueber den Wertevorrat des Laufs.
// =================================================================================================
const laufFacetten = {
	ebene: { Grenzen: 3052, Gewaesser: 289 }, typ: { Reichsgrenze: 3052 }, urteil: { uebersprungen: 4144 },
	wiki: { ggp: 9000 }, typ_kategorie: { Reichsgrenze: "unbekannt" },
};
const stage = [
	{ key: "s1", ebene: "Gewaesser", typ: "Fluss", urteil: "neu", wiki: "ggp", items: [] },
	{ key: "s2", ebene: "Gewaesser", typ: "Fluss", urteil: "neu", wiki: "kosch", items: [] },
	null,
];
const sf = garetienStageFacetten(stage, laufFacetten);
tief(sf.ebene, { Grenzen: 0, Gewaesser: 2 }, "Ebene: nur die Stage zaehlt, jeder Wert des Laufs bleibt stehen");
tief(sf.typ, { Reichsgrenze: 0, Fluss: 2 }, "Typ: ein Wert der Stage, den der Vorrat nicht kennt, kommt dazu");
tief(sf.urteil, { uebersprungen: 0, neu: 2 }, "Urteil");
tief(sf.wiki, { ggp: 1, kosch: 1 }, "Wiki");
tief(sf.typ_kategorie, { Reichsgrenze: "unbekannt" }, "die Typ-Kategorie wird durchgereicht, nie nachgebaut");
wahr(sf.typ_kategorie !== laufFacetten.typ_kategorie, "…als Kopie, nicht als geteiltes Objekt");
gleich(laufFacetten.ebene.Grenzen, 3052, "die Laufzahlen bleiben unberuehrt");
tief(garetienStageFacetten([], null), { typ_kategorie: {}, ebene: {}, typ: {}, urteil: {}, wiki: {} },
	"ohne Stage und ohne Lauf leere Facetten in der gewohnten Form");

// =================================================================================================
// 3. Die Stage-Antwort: eigene Facetten, Laufzahlen durchgereicht.
// =================================================================================================
api.avesmapsGaretienStageLeeren();
api.avesmapsGaretienStageHinzufuegen([stage[0], stage[1]]);
const antwort = garetienStageAntwortBauen({
	facetten: { ebene: { Grenzen: 0, Gewaesser: 280 } }, facetten_gesamt: laufFacetten, reiter: { offen: 5000 },
});
tief(antwort.facetten.ebene, { Grenzen: 0, Gewaesser: 2 },
	"🔴 die Stage zaehlt sich selbst -- bis zum 15.09.2026 stand hier die Zahl des Reiters, von dem man kam");
gleich(antwort.facetten_gesamt, laufFacetten, "…und reicht die Laufzahlen durch");
// Eine alte Antwort ohne `facetten_gesamt`: ihre Facetten sind der Wertevorrat.
const alt = garetienStageAntwortBauen({ facetten: laufFacetten });
tief(alt.facetten.ebene, { Grenzen: 0, Gewaesser: 2 }, "ohne `facetten_gesamt` gilt der Vorrat der alten Facetten");
gleich(alt.facetten_gesamt, undefined, "…und es werden keine Laufzahlen erfunden");
api.avesmapsGaretienStageLeeren();

// =================================================================================================
// 4. Die VERDRAHTUNG: eine Listenantwort mit Laufzahlen landet wirklich im Trichter.
//    💣 Ohne diesen Abschnitt waere die Optionsfunktion gebaut und unerreichbar -- der Renderer muss
//    `facetten_gesamt` weiterreichen, und die Abschnitte des Trichters muessen es lesen.
// =================================================================================================
wahr(typeof api.garetienFilterSections === "function", "garetienFilterSections fehlt im Export");
api.avesmapsGaretienListeRendern({
	objekte: [], reiter: {}, bilanz: {}, gesamt: 0, facetten: reiter, facetten_gesamt: lauf,
});
const ebeneAbschnitt = api.garetienFilterSections().filter((s) => s.menuId === "garetien-filter-ebene-menu")[0];
tief(ebeneAbschnitt.getOptions().map((o) => o.count), ["280/289", "0/3052"],
	"🔴 der Trichter zeigt nach einem echten Listenlauf „Reiter/Lauf\"");
api.avesmapsGaretienListeRendern({ objekte: [], reiter: {}, bilanz: {}, gesamt: 0, facetten: reiter });
tief(ebeneAbschnitt.getOptions().map((o) => o.count), [280, 0],
	"eine Antwort ohne Laufzahlen setzt sie zurueck -- keine Zahlen eines frueheren Laufs");

console.log("garetien-facetten-je-reiter: " + checks + " Pruefungen bestanden.");
