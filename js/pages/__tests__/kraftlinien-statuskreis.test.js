// Der Statuskreis in der Kraftlinienliste des Editors.
//
// Owner 18.08.2026: „kannst du die grünen kreise bzw. die kraftliniendarstellung auf die liste im
// kraftlinieneditor übertragen?" — und früher schon: „wir werden ihn bei kraftlinien noch richtig
// füllen."
//
// 🔴 ZWEI Zustaende, nicht drei. Die geteilte Bedeutung (settlementStatusMarker,
// js/review/review-settlement-list.js) lautet: voll = auf der Karte UND verbunden · halb = auf der
// Karte ohne Wiki · leer = nicht auf der Karte. Eine Kraftlinie IST eine Menge gezeichneter
// Kartensegmente — ohne Segment gaebe es die Zeile nicht. Der dritte Zustand entfaellt deshalb
// BEGRUENDET, und diese Begruendung steht auch an der Codestelle.
//
// 💣 Gemessen wird `wiki_url`, NIE `wiki_powerline` (Katalogabzug des Abgleichs: Staerke,
// Affinitaet, Laenge, Regionen). Dieselbe Verwechslung hat hier schon eine Messung um den Faktor
// 17 danebenliegen lassen — deshalb hat sie unten einen eigenen Gegenbeweis.
//
// ⭐ Die Funktion wird AUS DER AUSGELIEFERTEN SEITE gezogen, nicht abgeschrieben.
//
// Run (aus dem Repo-Wurzelverzeichnis):  node js/pages/__tests__/kraftlinien-statuskreis.test.js

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const wurzel = path.join(__dirname, "..", "..", "..");
const html = fs.readFileSync(path.join(wurzel, "html", "wiki-sync-powerline-editor.html"), "utf8");

const treffer = html.match(/\nfunction lineStatusMarker\([\s\S]*?\n\}/);
assert.ok(treffer, "lineStatusMarker() steht nicht mehr in html/wiki-sync-powerline-editor.html.");
// 🔴 Der ECHTE geteilte Bauer wandert in die Sandbox, keine Attrappe: lineStatusMarker delegiert
// seit 18.08.2026 an ihn, und eine freundliche Attrappe wuerde genau die Delegation verstecken,
// die hier geprueft werden soll.
const topo = require("../../map-features/powerline-topology.js");
const lineStatusMarker = vm.runInNewContext("(" + treffer[0].trim() + ")",
	{ avesmapsPowerlineStatusMarker: topo.avesmapsPowerlineStatusMarker });

const seg = (wikiUrl) => ({ wiki_url: wikiUrl });
let checks = 0;

// ---- Voll = jedes Segment der Namensgruppe zeigt auf einen Artikel ------------------------------
assert.ok(/tree-map-status--all/.test(lineStatusMarker({ segments: [seg("https://de.wiki-aventurica.de/wiki/Konzilslinie")] })),
	"Eine vollstaendig zugewiesene Kraftlinie muss den VOLLEN Kreis (--all) tragen.");
checks++;

// ---- Halb = gar nicht zugewiesen ----------------------------------------------------------------
assert.ok(/tree-map-status--own-only/.test(lineStatusMarker({ segments: [seg(""), seg("")] })),
	"Eine Kraftlinie ohne jede Zuweisung muss den HALBEN Kreis (--own-only) tragen — sie liegt auf "
	+ "der Karte, hat aber kein Wiki.");
checks++;

// ---- 💣 Halb = TEILWEISE zugewiesen. Eine Kraftlinie ist eine NAMENSGRUPPE ----------------------
// Genau der Fall, fuer den es den Halb-Zustand gibt. Ein `some` statt `every` meldete hier „voll"
// und behauptete damit, die ganze Linie haenge am Artikel.
assert.ok(/tree-map-status--own-only/.test(lineStatusMarker({
	segments: [seg("https://de.wiki-aventurica.de/wiki/Drachenblick"), seg("")],
})), "Eine Kraftlinie, deren Segmente nur TEILWEISE zugewiesen sind, muss halb sein, nicht voll.");
checks++;

// ---- 💣 Die Verwechslung, die schon einmal Faktor 17 gekostet hat --------------------------------
// `wiki_powerline` ist der Katalogabzug des Abgleichs und sagt NICHTS ueber eine Zuweisung.
assert.ok(/tree-map-status--own-only/.test(lineStatusMarker({
	segments: [{ wiki_url: "", wiki_powerline: { staerke: "stark", regionen: "Kosch" } }],
})), "Ein gefuelltes `wiki_powerline` faerbt den Kreis voll. Gemessen werden muss `wiki_url` — "
	+ "`wiki_powerline` sind Katalogdaten (Staerke, Affinitaet, Laenge, Regionen).");
checks++;

// ---- Leerraum ist keine Zuweisung ---------------------------------------------------------------
assert.ok(/tree-map-status--own-only/.test(lineStatusMarker({ segments: [seg("   ")] })),
	"Eine Adresse aus lauter Leerzeichen gilt als Zuweisung.");
checks++;

// ---- Kein drittes Zeichen, und der Marker bleibt unsichtbar --------------------------------------
// 🪤 Am 17.08.2026 wurde fuer DIESELBE Liste ein Rauten-Symbol gebaut und auf Owner-Entscheid
// vollstaendig zurueckgebaut (94889119) — genau weil der gruene Kreis die Aussage schon traegt.
const markup = lineStatusMarker({ segments: [seg("")] });
assert.ok(/^<span class="tree-map-status tree-map-status--[a-z-]+" aria-hidden="true"><\/span>$/.test(markup),
	"Der Marker ist nicht mehr genau EIN unsichtbarer <span> der geteilten Rezeptur. Ein zweites "
	+ `Zeichen ist hier ausdruecklich unerwuenscht. Erhalten: ${markup}`);
checks++;

// ---- Die Zeile traegt die Klasse, an der die geteilte Regel haengt --------------------------------
// 💣 Ohne `has-map-status` an der Zeile greift KEINE der Regeln in map-status-circle.css — der
// Marker steht dann unsichtbar im DOM und der Kreis fehlt, ohne dass irgendetwas wirft.
assert.ok(/'<div class="avm-row has-map-status'/.test(html),
	'Die Zeile der Kraftlinienliste setzt "has-map-status" nicht mehr. Dann bleibt der Kreis aus, '
	+ "lautlos.");
checks++;
assert.ok(/\+ lineStatusMarker\(l\)/.test(html),
	"renderList() haengt den Marker nicht mehr in die Zeile. Die Klasse allein ergibt nur den "
	+ "leeren Ring — also 'nicht auf der Karte', und das ist fuer eine Kraftlinie unmoeglich.");
checks++;

// ---- Und der Kreis wird geteilt, nicht abgeschrieben ---------------------------------------------
// 🔴 Es gibt im Projekt ZWEI Listenzeilen-Rezepturen und das ist die Obergrenze (AGENTS.md §11).
// Fuer den Kreis gilt dasselbe: eine dritte Fassung im lokalen <style>-Block dieser Seite waere
// ein Fehlschlag, kein Ergebnis. Genau so sind hier schon .se-row und die .dt-*-Regeln entstanden.
const lokalerStil = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));
assert.ok(!/tree-map-status|has-map-status/.test(lokalerStil),
	"Der lokale <style>-Block der Seite definiert wieder eigene Statuskreis-Regeln. Die Rezeptur "
	+ "steht in css/components/map-status-circle.css, das editor-page.css bereits bindet.");
checks++;

// ⚠️ Und die Seite muss editor-page.css ueberhaupt laden — ohne sie kommt der @import nie an.
assert.ok(/<link rel="stylesheet" href="\/css\/components\/editor-page\.css">/.test(html),
	"Die Seite bindet css/components/editor-page.css nicht mehr — damit faellt der ganze "
	+ "@import-Weg zu map-status-circle.css weg.");
checks++;

// ── EIN Bauer fuer BEIDE Oberflaechen ────────────────────────────────────────────────────────
// 🪤 Die Panel-Liste trug `has-map-status` seit jeher und emittierte NIE einen Marker: ihr Ring
// war fuer jede Kraftlinie leer -- ein unmoeglicher Zustand, denn eine Kraftlinie liegt per
// Definition auf der Karte. Gesehen hat es niemand, bis der Editor daneben einen richtigen zeigte.
assert.strictEqual(typeof topo.avesmapsPowerlineStatusMarker, "function",
	"powerline-topology.js muss den geteilten Markierungsbauer ausfuehren -- er ist das EINZIGE"
	+ " Modul, das Panel (index.html) und Editor (eigenes Dokument) beide laden.");
checks++;

// 💣 `every`, nicht `some`: teilweise zugewiesen ist HALB, nicht voll.
assert.ok(/tree-map-status--all/.test(topo.avesmapsPowerlineStatusMarker([{ wiki_url: "a" }, { wiki_url: "b" }])),
	"Alle Segmente zugewiesen muss den vollen Kreis liefern.");
assert.ok(/tree-map-status--own-only/.test(topo.avesmapsPowerlineStatusMarker([{ wiki_url: "a" }, { wiki_url: "" }])),
	"Nur ein Teil zugewiesen muss den HALBEN Kreis liefern -- sonst meldet eine halb gepflegte"
	+ " Linie sich als fertig.");
assert.ok(/tree-map-status--own-only/.test(topo.avesmapsPowerlineStatusMarker([])),
	"Ohne Segmente darf nicht 'zugewiesen' herauskommen.");
checks += 3;

// 🔴 DIE VERDRAHTUNG. Eine getestete Funktion, die niemand aufruft, ist der Fehler, den dieses
// Projekt schon einmal sechs Code-Reviews lang uebersehen hat.
const panel = fs.readFileSync(path.join(wurzel, "js/review/review-powerline-list.js"), "utf8");
assert.ok(/avesmapsPowerlineStatusMarker\(/.test(panel),
	"Die Panel-Liste ruft den geteilten Bauer nicht auf -- ihr Statuskreis bleibt leer, waehrend"
	+ " der Editor daneben einen richtigen zeigt.");
assert.ok(/avesmapsPowerlineStatusMarker\(/.test(html),
	"Der Kraftlinien-Editor ruft den geteilten Bauer nicht auf (zweite Fassung eingeschlichen?).");
checks += 2;

console.log(`OK -- ${checks} Zusicherungen (Statuskreis der Kraftlinienliste).`);
