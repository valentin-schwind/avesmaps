// Das geteilte Wiki-Zuweisungs-Bauteil (Aufgabe 3, Entwurf §§4–6).
//
// 🔴 Geprueft wird die REINE Haelfte -- Zustandsmodell und Auszeichnungs-Bauer. Genau dafuer ist
// das Bauteil in „rein“ und „ans DOM haengen“ geschnitten (dasselbe Muster wie js/ui/filter-bar.js):
// die Entscheidungen, die schiefgehen koennen (welcher Zustand, welche Knoepfe, welche Felder,
// welche Huelle), sind ohne Browser messbar. Was ein Emulator nicht beantworten kann -- ob sich der
// Kasten im echten Editorfenster auch bedienen laesst --, beantwortet der Ablauf, nicht dieser Test
// (AGENTS.md §9: „Abnahme heisst ABLAUF, nicht Mass“).
//
// Run: node js/ui/__tests__/wiki-assign.test.js
"use strict";

const assert = require("assert");
const { AVESMAPS_WIKI_ASSIGN_REGISTRY } = require("../wiki-assign-registry.js");
const {
	AVESMAPS_WIKI_ASSIGN_SKINS,
	avesmapsWikiAssignSkin,
	avesmapsWikiAssignModell,
	avesmapsWikiAssignMarkup,
	avesmapsWikiAssignTrefferListeInhalt,
	avesmapsWikiAssignMount,
	avesmapsWikiAssignListeFiltern,
	avesmapsWikiAssignTrefferMeta,
	avesmapsWikiAssignFeldLabel,
	avesmapsWikiAssignRufen,
} = require("../wiki-assign.js");

const kraftlinie = AVESMAPS_WIKI_ASSIGN_REGISTRY.kraftlinie;
const dt = avesmapsWikiAssignSkin("dt");
const knoepfeVon = (modell) => modell.knoepfe.map((k) => k.aktion);
let checks = 0;

// ── 1) DIE DREI ZUSTAENDE ENTSTEHEN AUS DER ERKLAERUNG ────────────────────────────────────────
// Das Bauteil kennt keine Objektart: dieselbe Funktion, dreimal derselbe Aufruf, drei Zustaende.

// offen -- kein Artikel zugeordnet
const offen = avesmapsWikiAssignModell(kraftlinie, { artikel: null }, {});
assert.strictEqual(offen.modus, "offen");
assert.deepStrictEqual(knoepfeVon(offen), ["zuweisen"]);
assert.deepStrictEqual(offen.felder.map((f) => f.label), ["Zuordnung"]);
assert.strictEqual(offen.felder[0].wert, "— keine —");
checks += 4;

// suche -- Suchfeld, Trefferliste, Tastaturhinweis
const suche = avesmapsWikiAssignModell(kraftlinie, { artikel: null }, {
	modus: "suche",
	suchtext: "satinav",
	treffer: [
		{ name: "Satinavs Ketten", wiki_url: "https://de.wiki-aventurica.de/wiki/Satinavs_Ketten", wiki_key: "satinavs-ketten", werte: { staerke: "kontinental", regionen: "Maraskan" } },
		{ name: "Satinavs Fessel", wiki_url: "https://de.wiki-aventurica.de/wiki/Satinavs_Fessel", wiki_key: "satinavs-fessel", werte: { regionen: "Güldenland" }, haengtAn: "Fessel des Satinav" },
	],
	aktiv: 0,
});
assert.strictEqual(suche.modus, "suche");
assert.deepStrictEqual(knoepfeVon(suche), ["abbrechen"]);
assert.ok(suche.suchfeld && suche.suchfeld.wert === "satinav");
assert.strictEqual(suche.treffer.length, 2);
assert.ok(/↑ ↓ wählen · Enter zuweisen · Esc schließt/.test(suche.hinweis), suche.hinweis);
checks += 5;

// 💣 Die Trefferzeile stammt AUS DER ERKLAERUNG (`art` + `treffer: ["staerke","regionen"]`) und ist
// genau die des Mockups. Der zweite Artikel fuehrt keine Staerke -- sein Teil faellt weg, statt als
// leerer Zwischenraum dazustehen.
assert.strictEqual(suche.treffer[0].meta, "Kraftlinie · kontinental · Maraskan");
assert.strictEqual(suche.treffer[1].meta, "Kraftlinie · Güldenland");
checks += 2;

// 🔴 Ein Treffer sagt IM Treffer, wenn er schon woanders haengt -- vor dem Klick, nicht danach.
assert.strictEqual(suche.treffer[0].warnung, "");
assert.ok(suche.treffer[1].warnung.includes("Fessel des Satinav"), suche.treffer[1].warnung);
// ⚠️ Und er sagt es NUR, wenn die Suche es liefert. Liefert sie nichts (gemessen 16.08.2026: kein
// Suchendpunkt tut es), bleibt die Zeile leer -- eine erfundene Belegt-Anzeige, die manchmal
// stimmt, waere schlimmer als keine.
const ohneBelegung = avesmapsWikiAssignModell(kraftlinie, { artikel: null }, {
	modus: "suche", treffer: [{ name: "Madas Kelch", werte: {} }],
});
assert.strictEqual(ohneBelegung.treffer[0].warnung, "");
checks += 3;

// zugewiesen -- Feldliste, Wiki-Link, Knoepfe
const zugewiesen = avesmapsWikiAssignModell(kraftlinie, {
	artikel: {
		name: "Satinavs Ketten",
		wiki_url: "https://de.wiki-aventurica.de/wiki/Satinavs_Ketten",
		wiki_key: "satinavs-ketten",
		werte: { staerke: "kontinental", regionen: "Maraskan · Aventurien" },
	},
}, {});
assert.strictEqual(zugewiesen.modus, "zugewiesen");
assert.deepStrictEqual(
	zugewiesen.felder.map((f) => f.label),
	["Artikel", "Schlüssel", "Stärke", "Regionen"]
);
checks += 2;

// ── 2) LEERE FELDER FALLEN WEG, SIE STEHEN NICHT LEER DA ──────────────────────────────────────
// 💣 Am Original gemessen (Entwurf §4): „Madas Kelch" fuehrt weder Staerke noch Laenge, von fuenf
// geprueften Kraftlinien-Artikeln haben ZWEI Luecken. Ein Kasten mit fester Zeilenzahl verspraeche,
// was das Wiki oft nicht hergibt.
const luecken = avesmapsWikiAssignModell(kraftlinie, {
	artikel: { name: "Madas Kelch", wiki_url: "https://de.wiki-aventurica.de/wiki/Madas_Kelch", wiki_key: "madas-kelch", werte: { staerke: "", affinitaet: "Elementar", laenge: "   ", regionen: "" } },
}, {});
assert.deepStrictEqual(luecken.felder.map((f) => f.label), ["Artikel", "Schlüssel", "Affinität"]);
// Kein leerer Wert kommt durch -- auch keiner, der nur aus Leerzeichen besteht.
assert.ok(luecken.felder.every((f) => f.wert.trim() !== ""), "eine leere Feldzeile ist durchgerutscht");
const lueckenMarkup = avesmapsWikiAssignMarkup(luecken, dt);
assert.ok(!/Stärke/.test(lueckenMarkup), "„Stärke“ steht im Markup, obwohl der Artikel keine führt");
assert.ok(!/Länge/.test(lueckenMarkup), "„Länge“ steht im Markup, obwohl der Artikel keine führt");
checks += 4;

// ── 3) KEIN SYNC-KNOPF OHNE FELDZIELE ─────────────────────────────────────────────────────────
// 💣 Der Knopf haengt an den FELDERN, nicht am Abgleich (Entwurf §4). Die Kraftlinien HABEN einen
// Massenlauf („⚡ Kraftlinien syncen“ im Menueband), aber kein bearbeitbares Kartenfeld, das ein
// Sync fuellen koennte -- also steht dort keiner. Die erste Mockup-Fassung hatte das falsch herum.
assert.strictEqual(kraftlinie.sync, false);
assert.deepStrictEqual(knoepfeVon(zugewiesen), ["aendern", "entfernen"]);
assert.ok(!/data-wa-aktion="sync"/.test(avesmapsWikiAssignMarkup(zugewiesen, dt)));
checks += 3;

// Und mit Feldzielen erscheint er -- dieselbe Funktion, nur eine andere Erklaerung.
const mitSync = {
	label: "Wiki-Ort", art: "Ort", suche: { art: "server", url: "/api/edit/wiki/settlements.php" },
	treffer: ["art"], sync: true,
	felder: [{ wiki: "name", karte: "name", label: "Name" }, { wiki: "art", karte: "settlement_type", label: "Art" }],
};
const ortZugewiesen = avesmapsWikiAssignModell(mitSync, {
	artikel: { name: "Havena", wiki_url: "https://de.wiki-aventurica.de/wiki/Havena", wiki_key: "havena", werte: { name: "Havena", art: "Metropole" } },
}, {});
assert.deepStrictEqual(knoepfeVon(ortZugewiesen), ["aendern", "sync", "entfernen"]);
assert.ok(/data-wa-aktion="sync"/.test(avesmapsWikiAssignMarkup(ortZugewiesen, dt)));
checks += 2;

// ── 4) KEIN FREITEXTFELD FUER EINE ADRESSE ────────────────────────────────────────────────────
// 💣 Entwurf §5: „Freie Adressen bleiben draussen." Ein Zuweisungsfeld, in das man alles tippen
// kann, ist der Grund, warum bei den Kraftlinien ein Tippfehler unsichtbar blieb (15.08.2026). Die
// Vorgaengerfassung stand als <input type="url"> mit <datalist> da -- das SCHLUG VOR und schraenkte
// nicht ein. Keiner der drei Zustaende darf so etwas wieder erzeugen.
[offen, suche, zugewiesen, ortZugewiesen].forEach((modell, i) => {
	const markup = avesmapsWikiAssignMarkup(modell, dt);
	assert.ok(!/type="url"/.test(markup), "Zustand " + i + " traegt ein <input type=url>");
	assert.ok(!/type="text"/.test(markup), "Zustand " + i + " traegt ein freies Textfeld");
	assert.ok(!/<datalist/.test(markup), "Zustand " + i + " traegt ein <datalist>");
	checks += 3;
});
// Das EINZIGE Eingabefeld des Bauteils ist die Suche -- und die traegt nichts in die Zuweisung.
const sucheMarkup = avesmapsWikiAssignMarkup(suche, dt);
assert.strictEqual((sucheMarkup.match(/<input/g) || []).length, 1);
assert.ok(/type="search"/.test(sucheMarkup));
checks += 2;

// ── 5) BEIDE HUELLEN LIEFERN IHRE EIGENEN KLASSEN ─────────────────────────────────────────────
// 🔴 Ein Bauteil, ZWEI Huellen, und das ist die Obergrenze (Entwurf §4a, AGENTS.md §11). Der Skin
// ist eine TABELLE -- derselbe Bauer, andere Namen. Ein dritter Skin ist verboten.
assert.deepStrictEqual(Object.keys(AVESMAPS_WIKI_ASSIGN_SKINS).sort(), ["dt", "label-wiki"],
	"Es gibt nicht mehr genau zwei Huellen. Zwei ist die Obergrenze (Entwurf §4a).");
checks++;

// Beide Tabellen fuehren dieselben Rollen -- sonst faellt beim Anschliessen der zweiten Huelle
// lautlos eine Klasse weg und ein Stueck steht ungestylt da.
const rollen = Object.keys(AVESMAPS_WIKI_ASSIGN_SKINS.dt).sort();
assert.deepStrictEqual(Object.keys(AVESMAPS_WIKI_ASSIGN_SKINS["label-wiki"]).sort(), rollen,
	"Die zwei Huellen fuehren verschiedene Rollen -- eine davon zeichnet dann unvollstaendig.");
checks++;

const labelWiki = avesmapsWikiAssignSkin("label-wiki");
const dtMarkup = avesmapsWikiAssignMarkup(zugewiesen, dt);
const lwMarkup = avesmapsWikiAssignMarkup(zugewiesen, labelWiki);
assert.ok(dtMarkup.includes('class="avm-wiki-assign"'), dtMarkup.slice(0, 120));
assert.ok(dtMarkup.includes('class="dt-grp"'));
assert.ok(dtMarkup.includes('class="dt-link"'));
assert.ok(!dtMarkup.includes("label-wiki"), "die dt-Huelle traegt label-wiki-Klassen");
checks += 4;

assert.ok(lwMarkup.includes('class="label-wiki-reference"'));
assert.ok(lwMarkup.includes('class="label-wiki-reference__head"'));
assert.ok(lwMarkup.includes('class="label-wiki-reference__link"'));
assert.ok(!/\bdt-/.test(lwMarkup), "die label-wiki-Huelle traegt dt-Klassen");
checks += 4;

// ⚠️ An DREI Stellen benutzen die zwei Huellen verschiedene ELEMENTE, nicht nur andere Namen: die
// Feldliste ist im Editorfenster ein Raster aus <div>, im Kartendialog ein <dl>. Deshalb traegt die
// Tabelle auch die Elementnamen -- eine reine Klassentabelle koennte das nicht ausdruecken.
assert.ok(/<div class="dt-grid">/.test(dtMarkup));
assert.ok(/<dl class="label-wiki-reference__dl">/.test(lwMarkup));
assert.ok(/<dt>Artikel<\/dt>/.test(lwMarkup));
checks += 3;

// Eine unbekannte Huelle faellt NICHT heimlich auf „dt" zurueck -- ein Tippfehler soll auffallen.
assert.strictEqual(avesmapsWikiAssignSkin("dt-neu"), null);
checks++;

// ── 6) DER DRITTE ZUSTAND ─────────────────────────────────────────────────────────────────────
// Er gilt fuer ALLE Objektarten (Entwurf §2.7), gezeigt wird er, wo die Erklaerung ihn fuehrt.
assert.ok(offen.haken && offen.haken.text === "Kein Wiki-Artikel vorhanden");
assert.strictEqual(offen.haken.gesetzt, false);
const gehakt = avesmapsWikiAssignModell(kraftlinie, { artikel: null, keinArtikel: true }, {});
assert.strictEqual(gehakt.haken.gesetzt, true);
// 🔴 Der zweite Halbsatz des Hinweises ist tragend: der Merker ist NICHT endgueltig -- ohne ihn
// liest er sich als endgueltig, und die Wiedervorlage wirkt wie ein Fehler.
assert.ok(/bis im Wiki einer auftaucht/.test(offen.hinweis), offen.hinweis);
// Eine Erklaerung OHNE den Haken zeigt auch keinen.
assert.strictEqual(avesmapsWikiAssignModell(mitSync, { artikel: null }, {}).haken, null);
// 🔴 Neben einer ZUWEISUNG steht er nicht (Mockup, Karte 1 gegen Karte 3): "es gibt keinen" und
// "hier ist er" schliessen einander aus.
assert.strictEqual(zugewiesen.haken, null, "der dritte Zustand steht neben einer Zuweisung");
assert.strictEqual(suche.haken, null, "der dritte Zustand steht mitten in der Suche");
// 💣 Die eine Ausnahme ist der AUSWEG: ist der Merker gesetzt UND ein Artikel zugewiesen (ein
// widerspruechlicher Zustand), muss er sichtbar bleiben -- sonst kommt niemand mehr heraus, und
// weil das Speichern immer beide Werte schickt, lehnte der Server danach JEDE Aenderung ab.
const widerspruch = avesmapsWikiAssignModell(kraftlinie,
	{ artikel: { name: "Satinavs Ketten", wiki_url: "https://de.wiki-aventurica.de/wiki/Satinavs_Ketten", wiki_key: "k", werte: {} }, keinArtikel: true }, {});
assert.ok(widerspruch.haken && widerspruch.haken.gesetzt === true,
	"der gesetzte Merker ist neben einer Zuweisung unsichtbar -- der Ausweg fehlt");
checks += 9;

// ── 7) DIE SYNC-VORSCHAU ──────────────────────────────────────────────────────────────────────
// 💣 Sind alle Angaben gleich, kommt EIN Satz -- keine leere Haekchenliste.
const syncLeer = avesmapsWikiAssignModell(mitSync, { artikel: { name: "Havena" } }, { modus: "sync", syncZeilen: [] });
assert.ok(/Alles stimmt bereits mit dem Wiki überein/.test(syncLeer.hinweis), syncLeer.hinweis);
assert.strictEqual(syncLeer.syncAktionen.length, 0);
checks += 2;

const syncVoll = avesmapsWikiAssignModell(mitSync, { artikel: { name: "Havena" } }, {
	modus: "sync",
	syncZeilen: [
		{ karte: "name", label: "Name", alt: "Havena", neu: "Havena (Stadt)", gehakt: true, grund: "" },
		{ karte: "settlement_type", label: "Art", alt: "Großstadt", neu: "", gehakt: false, grund: "das Wiki sagt nichts — würde die Angabe leeren" },
	],
});
const syncMarkup = avesmapsWikiAssignMarkup(syncVoll, dt);
// Vorangehakt ist, was AENDERT -- nicht, was leert: genau ein Haken.
assert.strictEqual((syncMarkup.match(/checked/g) || []).length, 1);
assert.ok(/1 Angabe übernehmen/.test(syncMarkup), syncMarkup);
assert.ok(/Alle anhaken/.test(syncMarkup));
// Der Grund steht IN der Zeile -- eine ungehakte Zeile ohne Begruendung liest sich wie ein Fehler.
assert.ok(/würde die Angabe leeren/.test(syncMarkup));
// Ein leerer neuer Wert wird als „—" gezeigt, nicht als Nichts.
assert.ok(/dt-sync-row__neu">—</.test(syncMarkup), syncMarkup);
// ⚠️ Uebernehmen fuellt nur das Formular -- gespeichert wird mit „Speichern".
assert.ok(/gespeichert wird mit/.test(syncMarkup));
// 🔴 Der erklaerende Hinweis steht in der Vorschau OBEN, vor der Liste (Mockup, Karte „Sync
// gedrückt“): er sagt, was die Liste darunter ueberhaupt ist. Unter den Knoepfen kaeme er zu spaet.
assert.ok(syncMarkup.indexOf("würden sich ändern") < syncMarkup.indexOf("dt-sync-rows"),
	"der Hinweis der Sync-Vorschau steht unter der Liste statt darueber");
// In den uebrigen Zustaenden steht er weiterhin UNTEN (Mockup, Karte 1 und 2).
const offenMarkup = avesmapsWikiAssignMarkup(offen, dt);
assert.ok(offenMarkup.indexOf("Konfliktliste") > offenMarkup.indexOf("data-wa-kein-artikel"),
	"der Hinweis des dritten Zustands steht ueber seinem Haekchen");
checks += 8;

// 💣 Der Nenner zaehlt nur Felder MIT Kartenziel -- eine Anzeige-Zeile kann sich nie aendern.
const mitAnzeigeFeld = Object.assign({}, mitSync, { felder: mitSync.felder.concat([{ wiki: "deko", karte: "", label: "Deko" }]) });
const nenner = avesmapsWikiAssignModell(mitAnzeigeFeld, { artikel: { name: "Havena" } }, {
	modus: "sync", syncZeilen: [{ karte: "name", label: "Name", alt: "a", neu: "b", gehakt: true, grund: "" }],
});
assert.ok(/1 von 2 Angaben/.test(nenner.hinweis), nenner.hinweis);
checks++;

// Eine GESPERRTE Feldzeile (Entwurf §7, parent_locked): sichtbar gesperrt, nicht still uebersprungen.
const gesperrt = avesmapsWikiAssignModell(mitSync, { artikel: { name: "Havena" } }, {
	modus: "sync",
	syncZeilen: [{ karte: "parent", label: "Eltern", alt: "Garetien", neu: "Kosch", gehakt: false, gesperrt: true, grund: "Elternbeziehung gesperrt" }],
});
const gesperrtMarkup = avesmapsWikiAssignMarkup(gesperrt, dt);
assert.ok(/disabled/.test(gesperrtMarkup), "die gesperrte Feldzeile ist nicht gesperrt");
assert.ok(/Elternbeziehung gesperrt/.test(gesperrtMarkup), "der Grund fehlt -- ein Knopf, der nicht kann, muss sagen warum");
checks += 2;

// ── 8) DIE BROWSER-SUCHE ──────────────────────────────────────────────────────────────────────
// Die Erklaerung sagt, WOHER die Treffer kommen; das Bauteil merkt den Unterschied nicht.
const kandidaten = [
	{ name: "Satinavs Ketten" }, { name: "Madas Kelch" }, { name: "Yaquirlinie" }, { name: "Satinavs Fessel" },
];
assert.deepStrictEqual(avesmapsWikiAssignListeFiltern(kandidaten, "SATINAV").map((k) => k.name),
	["Satinavs Ketten", "Satinavs Fessel"]);
assert.strictEqual(avesmapsWikiAssignListeFiltern(kandidaten, "").length, 4);
assert.strictEqual(avesmapsWikiAssignListeFiltern(kandidaten, "gibtesnicht").length, 0);
// Gedeckelt wie die Server-Suchen (limit=40).
assert.strictEqual(avesmapsWikiAssignListeFiltern(Array.from({ length: 90 }, (_, i) => ({ name: "L" + i })), "L").length, 40);
checks += 4;

// ── 9) DIE RUECKFALLKETTE DER BESCHRIFTUNG ────────────────────────────────────────────────────
// label -> karte -> wiki. 💣 Bei einer ANZEIGE-Zeile (karte: "") ist die mittlere Stufe leer --
// ohne `label` staende dort der Wiki-Feldname. Deshalb traegt die Kraftlinien-Erklaerung welche.
assert.strictEqual(avesmapsWikiAssignFeldLabel({ wiki: "staerke", karte: "", label: "Stärke" }), "Stärke");
assert.strictEqual(avesmapsWikiAssignFeldLabel({ wiki: "art", karte: "settlement_type" }), "settlement_type");
assert.strictEqual(avesmapsWikiAssignFeldLabel({ wiki: "staerke", karte: "" }), "staerke");
checks += 3;

// ── 10) MASKIERUNG ────────────────────────────────────────────────────────────────────────────
// Ein Artikelname kommt aus dem Wiki, also von aussen, und landet in einem innerHTML.
const boese = avesmapsWikiAssignModell(kraftlinie, {
	artikel: { name: '<img src=x onerror="alert(1)">', wiki_url: "https://de.wiki-aventurica.de/wiki/X", wiki_key: "x", werte: {} },
}, {});
const boeseMarkup = avesmapsWikiAssignMarkup(boese, dt);
assert.ok(!/<img/.test(boeseMarkup), "ein Artikelname ist unmaskiert ins Markup gelangt");
assert.ok(/&lt;img/.test(boeseMarkup));
// 💣 Eine Adresse landet in einem href -- Maskieren allein reicht dort nicht, `javascript:` ueberlebt sie.
const jsUrl = avesmapsWikiAssignModell(kraftlinie, {
	artikel: { name: "Boese", wiki_url: "javascript:alert(1)", wiki_key: "b", werte: {} },
}, {});
assert.ok(!/href="javascript/.test(avesmapsWikiAssignMarkup(jsUrl, dt)), "eine javascript:-Adresse ist als href durchgekommen");
checks += 3;

// ── 11) DER BLINDGAENGER GIBT SICH ZU ERKENNEN (Nachbesserung 1, Befund 3) ────────────────────
// 💣 DIE TEUERSTE ZUSICHERUNG DIESER DATEI. `mount` kann scheitern, ohne dass der Aufrufer es
// merkt: laedt wiki-assign.js, aber das Feldregister NICHT -- genau der Zustand nach einem
// Deploy-Fehlschlag, der den ?v=-Stempel vergiftet und Dateien live auf 404 stehen laesst
// (AGENTS.md §9) --, dann gibt mount eine Steuerung zurueck, die nichts tut. Gaebe deren `lies()`
// lauter Leerstrings, schriebe der naechste Klick auf „Speichern" eine LEERE Zuweisung auf alle
// Segmente: eine Loeschung, die niemand angeordnet hat, ununterscheidbar von „es war nie eine da"
// (AGENTS.md §10).
//
// In Node sind `avesmapsWikiAssignSubject`/`avesmapsWikiAssignDiff` KEINE Globalen -- der erste
// Aufruf faellt also durch genau die Tuer, um die es geht, und braucht dafuer kein DOM.
//
// 🪤 UND GENAU DAS WAR DIE FALLE DER ERSTEN FASSUNG: sie prüfte hier auch „unbekannte Hülle“ --
// nur erreichte diese Probe ihren Zweig NIE, weil sie schon am Feldregister-Riegel herausfiel.
// Sie war grün und sicherte nichts zu, und dieselbe Ursache machte die Meldungsprobe blind
// gegen die drei anderen Texte. Deshalb werden die Voraussetzungen jetzt STUFENWEISE gesetzt,
// und jede Stufe prüft die Meldung, die zu ihr gehört -- so kann keine Probe an der falschen
// Tür landen.
const blindBehaelter = { textContent: "" };
const blind = avesmapsWikiAssignMount(blindBehaelter, { subject: "kraftlinie", skin: "dt", laden: () => ({}) });
assert.strictEqual(blind.bereit, false, "der Blindgaenger gibt sich nicht als solcher zu erkennen");
assert.strictEqual(blind.lies(), null,
	"lies() eines unvollstaendig geladenen Bauteils liefert einen Schreibwert -- ein Speichern wuerde die Zuweisung loeschen");
// Stufe 1: gar nichts geladen -> die Meldung nennt das FELDREGISTER.
assert.ok(/wiki-assign-registry\.js/.test(blindBehaelter.textContent), blindBehaelter.textContent);
checks += 3;

// Stufe 2: Feldregister da, Diff-Rechnung fehlt. 🔴 Dieser Zweig ist nicht kosmetisch -- ohne die
// Diff-Rechnung faende eine Objektart mit `sync: true` beim Druck auf „Sync“ nie einen
// Unterschied und meldete „Alles stimmt bereits mit dem Wiki überein“: eine beruhigende Lüge.
global.avesmapsWikiAssignSubject = require("../wiki-assign-registry.js").avesmapsWikiAssignSubject;
const ohneDiff = { textContent: "" };
const blindDiff = avesmapsWikiAssignMount(ohneDiff, { subject: "kraftlinie", skin: "dt", laden: () => ({}) });
assert.strictEqual(blindDiff.bereit, false);
assert.strictEqual(blindDiff.lies(), null);
assert.ok(/wiki-assign-diff\.js/.test(ohneDiff.textContent), ohneDiff.textContent);
checks += 3;

// Stufe 3: beide Voraussetzungen da -- ab jetzt kommen die Proben WIRKLICH bis zur Objektart
// und zur Huelle durch.
global.avesmapsWikiAssignDiff = require("../wiki-assign-diff.js").avesmapsWikiAssignDiff;
const unbekannteArt = { textContent: "" };
const blindArt = avesmapsWikiAssignMount(unbekannteArt, { subject: "gibtesnicht", skin: "dt" });
assert.strictEqual(blindArt.bereit, false);
assert.strictEqual(blindArt.lies(), null);
assert.ok(/keine Erklärung/.test(unbekannteArt.textContent), unbekannteArt.textContent);
assert.ok(/gibtesnicht/.test(unbekannteArt.textContent), unbekannteArt.textContent);
checks += 4;

// Und die unbekannte HUELLE -- die Probe, die in der ersten Fassung ihren Zweig verfehlte.
const unbekannteHuelle = { textContent: "" };
const blind2 = avesmapsWikiAssignMount(unbekannteHuelle, { subject: "kraftlinie", skin: "gibtesnicht" });
assert.strictEqual(blind2.bereit, false);
assert.strictEqual(blind2.lies(), null);
assert.ok(/unbekannte Hülle/.test(unbekannteHuelle.textContent), unbekannteHuelle.textContent);
checks += 3;

// 🔴 Und die Weiche muss beim AUFRUFER stehen, sonst nuetzt das Merkmal nichts. Der einzige
// heutige Aufrufer ist der Kraftlinien-Editor; er darf `wikiAssign` NICHT blank auf
// Wahrheitswert pruefen (`wikiAssign ? … : …` liesse den Blindgaenger durch -- der ist ein
// Objekt und damit wahr).
const powerlineHtml = require("fs").readFileSync(
	require("path").resolve(__dirname, "..", "..", "..", "html", "wiki-sync-powerline-editor.html"), "utf8");
assert.ok(/wikiAssign && wikiAssign\.bereit/.test(powerlineHtml),
	"html/wiki-sync-powerline-editor.html prueft `wikiAssign.bereit` nicht mehr -- ein Blindgaenger "
	+ "kaeme durch und ein Speichern loeschte die Zuweisung aller Segmente der Linie.");
assert.ok(!/wikiAssign \? wikiAssign\.lies\(\)/.test(powerlineHtml),
	"der Kraftlinien-Editor prueft wieder nur, OB ein Bauteil da ist, statt ob es bereit ist.");
checks += 2;

// ── 12) TIPPEN ZEICHNET NUR DIE TREFFERLISTE (Nachbesserung 1, Befund 4) ──────────────────────
// 🔴 Bis 16.08.2026 zeichnete jeder Tastendruck den ganzen Kasten per innerHTML neu und setzte
// Zeiger und Fokus ans Ende -- eine Korrektur mitten im Suchbegriff war unmoeglich, jede
// Textmarkierung weg. Die Abnahme verlangt Tastaturbedienung in Chrome UND Firefox.
//
// Die tragende Eigenschaft: der Inhalt der Liste hat EINEN Bauer, den beide Wege benutzen -- der
// volle Aufbau und das Nachzeichnen beim Tippen. Damit koennen sie nicht auseinanderlaufen.
const listenInhalt = avesmapsWikiAssignTrefferListeInhalt(suche, dt);
assert.ok(listenInhalt.indexOf("Satinavs Ketten") !== -1);
assert.ok(avesmapsWikiAssignMarkup(suche, dt).indexOf(listenInhalt) !== -1,
	"der Listeninhalt des Teil-Neuzeichnens steht so nicht im vollen Markup -- die zwei Wege sind "
	+ "auseinandergelaufen, und beim Tippen entstuende ein anderes Bild als beim Oeffnen.");
// Der Behaelter traegt den Angriffspunkt, sonst findet das Teil-Neuzeichnen ihn nicht und faellt
// stillschweigend auf das volle zurueck (also zurueck in den Fehler).
assert.ok(/data-wa-liste/.test(avesmapsWikiAssignMarkup(suche, dt)),
	"der Trefferliste fehlt data-wa-liste -- zeichneTreffer faellt auf das volle Zeichnen zurueck.");
assert.ok(/data-wa-hinweis/.test(avesmapsWikiAssignMarkup(suche, dt)),
	"dem Hinweis fehlt data-wa-hinweis -- der Trefferzaehler bliebe beim Tippen stehen.");
checks += 4;

// Und die Verdrahtung: die zwei Tipp-Wege rufen zeichneTreffer, nicht zeichne.
const quelle = require("fs").readFileSync(require("path").resolve(__dirname, "..", "wiki-assign.js"), "utf8");
const zeichneTrefferKoerper = quelle.slice(quelle.indexOf("function zeichneTreffer()"),
	quelle.indexOf("function zustandUebernehmen"));
assert.ok(zeichneTrefferKoerper.indexOf("behaelter.innerHTML") === -1,
	"zeichneTreffer setzt behaelter.innerHTML -- damit ist das Suchfeld doch wieder weg.");
assert.ok(/ui\.aktiv = \(ui\.aktiv \+ schritt[\s\S]{0,220}?zeichneTreffer\(\)/.test(quelle),
	"↑ ↓ zeichnet wieder den ganzen Kasten.");
assert.ok(/ui\.aktiv = 0;[\s\S]{0,220}?zeichneTreffer\(\)/.test(quelle),
	"das Suchergebnis zeichnet wieder den ganzen Kasten.");
checks += 3;

// 💣 UND BEIDE ARIA-Merkmale werden nachgezogen. Das Feld wird beim Tippen nicht neu gebaut,
// also bleibt jedes Merkmal stehen, das zeichneTreffer nicht anfasst. Genau so stand
// `aria-expanded` nach dem Oeffnen der Suche auf "false" (die Liste war da noch leer) und wurde
// nie wieder angefasst -- LIVE gemessen bei vier Treffern, waehrend der Markup-Test gruen war.
// 🔴 Ein reiner Markup-Test sieht das NIE: er prueft den Bauer, und der war richtig. Die
// Zusicherung gehoert deshalb an die VERDRAHTUNG -- und das ist die Lehre, nicht die Zeile.
const zeichneTrefferKoerper2 = quelle.slice(quelle.indexOf("function zeichneTreffer()"),
	quelle.indexOf("function zustandUebernehmen"));
// 🪤 UND SIE PRUEFT DEN WERT, NICHT DAS VORKOMMEN. Die erste Fassung fragte nur, ob
// `feld.setAttribute("aria-expanded"` irgendwo im Rumpf steht -- ein fest verdrahtetes
// `"true"` an derselben Stelle liess sie gruen. Sie fing damit ausgerechnet die Fehlerform
// nicht, gegen die sie geschrieben wurde: ein Merkmal, das dasteht und nicht mitwandert.
// Also wird das ARGUMENT gelesen und muss von der Trefferzahl abhaengen.
const expandedRuf = zeichneTrefferKoerper2.match(/feld\.setAttribute\(\s*"aria-expanded"\s*,([^;]*)\)\s*;/);
assert.ok(expandedRuf, "zeichneTreffer zieht aria-expanded nicht nach -- es bleibt auf dem Stand des Oeffnens stehen, und das war die leere Liste.");
assert.ok(/treffer\.length/.test(expandedRuf[1]),
	"zeichneTreffer setzt aria-expanded auf einen FESTEN Wert (" + expandedRuf[1].trim() + ") -- es muss von der Trefferzahl abhaengen, sonst steht es wieder still.");
assert.ok(/aria-activedescendant/.test(zeichneTrefferKoerper2),
	"zeichneTreffer zieht aria-activedescendant nicht nach.");
checks += 3;

// ── 13) DIE ARIA-ROLLEN SIND VOLLSTAENDIG, NICHT HALB (Nachbesserung 1, Befund 6) ─────────────
// ⚠️ Halbe Rollen sind schlechter als keine: eine Liste mit role=option, deren Auswahl nirgends
// gemeldet wird, sieht fuer ein Hilfsmittel vollstaendig aus und ist stumm.
const ariaMarkup = avesmapsWikiAssignMarkup(suche, dt);
assert.ok(/role="combobox"/.test(ariaMarkup), "das Suchfeld ist keine combobox");
assert.ok(/role="listbox"/.test(ariaMarkup));
assert.ok(/role="option"/.test(ariaMarkup));
// Die Auswahl wird gemeldet -- und der Verweis zeigt auf eine Kennung, die es WIRKLICH gibt.
const aktivId = (ariaMarkup.match(/aria-activedescendant="([^"]+)"/) || [])[1];
assert.ok(aktivId, "aria-activedescendant fehlt -- die Tastaturauswahl ist fuer Hilfsmittel unsichtbar");
assert.ok(ariaMarkup.indexOf('id="' + aktivId + '"') !== -1,
	"aria-activedescendant zeigt auf eine Kennung, die es im Markup nicht gibt: " + aktivId);
const listenIdTreffer = (ariaMarkup.match(/aria-controls="([^"]+)"/) || [])[1];
assert.ok(listenIdTreffer && ariaMarkup.indexOf('id="' + listenIdTreffer + '" role="listbox"') !== -1,
	"aria-controls zeigt nicht auf die Trefferliste");
// 💣 OHNE Treffer darf KEIN aria-activedescendant dastehen -- ein Verweis auf eine Kennung, die
// es nicht gibt, ist fuer ein Hilfsmittel schlimmer als keiner.
const leereSuche = avesmapsWikiAssignModell(kraftlinie, { artikel: null }, { modus: "suche", treffer: [] });
const leerMarkup = avesmapsWikiAssignMarkup(leereSuche, dt);
assert.ok(!/aria-activedescendant/.test(leerMarkup),
	"bei null Treffern steht ein aria-activedescendant ins Leere");
checks += 7;

// 💣 `aria-expanded` sagt, ob die Liste etwas ANBIETET. Fest auf "true" verdrahtet meldete es
// auch bei null Treffern eine offene Auswahl, die es nicht gibt (Nachbesserung 2, Klein B).
assert.ok(/aria-expanded="false"/.test(leerMarkup), "bei null Treffern meldet aria-expanded eine offene Auswahl");
assert.ok(/aria-expanded="true"/.test(ariaMarkup), "mit Treffern meldet aria-expanded keine offene Auswahl");
checks += 2;

// 💣 In einem `role="listbox"` sind nur `option`/`group` zulaessige Kinder. Der Leerkasten ist
// ein nackter <div> und damit ein Verstoss, den kein Browser meldet -- er traegt deshalb
// `role="presentation"` und ist aus dem Barrierefreiheitsbaum genommen.
const listeLeerInhalt = avesmapsWikiAssignTrefferListeInhalt(leereSuche, dt);
assert.ok(/role="presentation"/.test(listeLeerInhalt),
	"der Leerkasten steht ohne Rolle als Kind eines role=listbox: " + listeLeerInhalt);
// Und weil er damit stumm ist, muss die Auskunft dort stehen, wo die Trefferzahl ohnehin steht.
assert.ok(/Keine Treffer · /.test(leereSuche.hinweis), leereSuche.hinweis);
// Gegenprobe: mit Treffern gibt es keinen Leerkasten.
assert.ok(!/role="presentation"/.test(avesmapsWikiAssignTrefferListeInhalt(suche, dt)),
	"mit Treffern steht trotzdem ein Leerkasten in der Liste");
checks += 3;

// ── 14) DER FEHLERPFAD LIEFERT AUCH KEINEN SCHREIBWERT (Nachbesserung 2, W3-Rest) ─────────────
// 🔴 DER RIEGEL WAR HALB. Er griff beim Mount -- aber `neuLaden()` faengt einen Fehler aus
// `opt.laden()` ab, schreibt „der Stand konnte nicht gelesen werden" in den Kasten und liess
// `bereit` auf `true` stehen. `lies()` gab dann lauter Leerstrings, und ein „Speichern" haette
// die Zuweisung geloescht: derselbe stille Verlust wie beim Blindgaenger, nur einen Trichter
// tiefer. Beim Kraftlinien-Editor ist `laden` synchron und der Pfad damit latent -- die erste
// Objektart mit SERVER-`laden` (Aufgabe 4) macht ihn lebendig.
//
// 🔴 Die Eigenschaft, die hier festgenagelt wird: `bereit === true` heisst AUSNAHMSLOS, dass
// `lies()` ein gueltiger Schreibwert ist. Es gibt keinen dritten Zustand, in dem der Kasten eine
// Fehlermeldung zeigt und der Speicherpfad trotzdem bedient wird.
//
// Ein Behaelter, der gerade genug kann: `mount` haengt Zuhoerer an und schreibt im Fehlerfall
// `textContent` -- gezeichnet wird auf diesem Pfad nie.
function scheinBehaelter() {
	return { textContent: "", innerHTML: "", addEventListener() {}, removeEventListener() {}, querySelector() { return null; } };
}

(async () => {
	// Fehlerart 1: `laden` WIRFT (synchron).
	const wirft = scheinBehaelter();
	const stWirft = avesmapsWikiAssignMount(wirft, {
		subject: "kraftlinie", skin: "dt",
		laden: () => { throw new Error("Leseweg kaputt"); },
	});
	await stWirft.neuLaden();
	assert.strictEqual(stWirft.bereit, false,
		"nach einem geworfenen Fehler im Datenweg meldet das Bauteil weiterhin `bereit` -- ein Speichern wuerde die Zuweisung loeschen");
	assert.strictEqual(stWirft.lies(), null, "lies() liefert nach einem geworfenen Fehler einen Schreibwert");
	assert.ok(/konnte nicht gelesen werden/.test(wirft.textContent), wirft.textContent);
	checks += 3;

	// Fehlerart 2: `laden` gibt eine ZUSAGE zurueck, die ABGELEHNT wird. Genau die Form, die eine
	// Objektart mit Server-`laden` benutzt -- der Grund, warum dieser Rest nicht warten konnte.
	const lehntAb = scheinBehaelter();
	const stAbgelehnt = avesmapsWikiAssignMount(lehntAb, {
		subject: "kraftlinie", skin: "dt",
		laden: () => Promise.reject(new Error("HTTP 500")),
	});
	await stAbgelehnt.neuLaden();
	assert.strictEqual(stAbgelehnt.bereit, false,
		"nach einer abgelehnten Zusage meldet das Bauteil weiterhin `bereit`");
	assert.strictEqual(stAbgelehnt.lies(), null, "lies() liefert nach einer abgelehnten Zusage einen Schreibwert");
	assert.ok(/konnte nicht gelesen werden/.test(lehntAb.textContent), lehntAb.textContent);
	checks += 3;

	// 🔴 Und ein SPAETERES Scheitern nimmt die Zusage zurueck: erst glueckt der Lauf, dann nicht
	// mehr. Was dann im Kasten steht, ist eine Fehlermeldung, und was in `daten` steht, ist
	// veraltet -- `bereit` darf nicht auf der alten Zusage sitzenbleiben.
	let gehtNoch = true;
	const kippt = scheinBehaelter();
	const stKippt = avesmapsWikiAssignMount(kippt, {
		subject: "kraftlinie", skin: "dt",
		laden: () => (gehtNoch ? { artikel: null, keinArtikel: true } : Promise.reject(new Error("weg"))),
	});
	await stKippt.neuLaden();
	assert.strictEqual(stKippt.bereit, true, "nach einem geglueckten Ladelauf ist das Bauteil nicht bereit");
	assert.strictEqual(stKippt.lies().kein_artikel, true, "der geglueckte Ladelauf kommt nicht im Schreibwert an");
	gehtNoch = false;
	await stKippt.neuLaden();
	assert.strictEqual(stKippt.bereit, false,
		"ein spaeteres Scheitern nimmt die Zusage nicht zurueck -- der Kasten zeigt einen Fehler und der Speicherpfad wird trotzdem bedient");
	assert.strictEqual(stKippt.lies(), null);
	checks += 4;

	// ── 15) DER ZWILLING: EINE ZUSAGE, DIE MIT NICHTS AUFLOEST (Nachbesserung 3) ──────────────
	// 💣 Der stillere der beiden. Eine abgelehnte Zusage faengt `catch`; eine Zusage, die mit
	// `undefined`/`null`/einer Zahl AUFLOEST, faengt niemand -- `zustandUebernehmen` machte daraus
	// wortlos „keine Zuweisung" (`roh || {}`), und `geladen = true` lief danach bedingungslos.
	//
	// 🔴 Und der Schaden ist GROESSER als beim geworfenen Fehler: dort steht wenigstens eine
	// Meldung im Kasten. Hier zeigte er ruhig „keine Zuweisung", waehrend der Schreibwert von der
	// echten Adresse auf `""` kippte -- der Editor sieht nichts, saveLine schreibt es auf alle
	// Segmente. Scharf wird es beim ersten Server-`laden` (Aufgabe 4), und der Hausstil dafuer
	// steht in derselben Datei: `.catch(() => [])`.
	async function ladenLiefert(wert) {
		const behaelter = scheinBehaelter();
		const st = avesmapsWikiAssignMount(behaelter, { subject: "kraftlinie", skin: "dt", laden: () => wert });
		await st.neuLaden();
		return { st: st, behaelter: behaelter };
	}

	// A1-A4: jede Form einzeln, keine als Sammelprobe -- eine davon durchzulassen genuegt.
	const nichtObjekte = [
		["A1 undefined", undefined],
		["A2 null", null],
		["A3 eine Zahl", 5],
		["A4 eine aufgeloeste Zusage ohne Wert", Promise.resolve(undefined)],
		["A5 eine Liste", []],
	];
	for (const [name, wert] of nichtObjekte) {
		const { st, behaelter } = await ladenLiefert(wert);
		assert.strictEqual(st.bereit, false,
			name + ": ein `laden`, das kein Objekt liefert, gilt als geglueckt -- der Schreibwert waere leer");
		assert.strictEqual(st.lies(), null, name + ": lies() liefert einen Schreibwert");
		assert.ok(/konnte nicht gelesen werden/.test(behaelter.textContent),
			name + ": der Kasten schweigt dazu -- " + JSON.stringify(behaelter.textContent));
		checks += 3;
	}

	// A6: gar kein `laden` uebergeben. Ein Aufruferfehler, kein Datenfall -- er darf nicht als
	// „nichts zugewiesen" durchgehen.
	const ohneLaden = scheinBehaelter();
	const stOhneLaden = avesmapsWikiAssignMount(ohneLaden, { subject: "kraftlinie", skin: "dt" });
	await stOhneLaden.neuLaden();
	assert.strictEqual(stOhneLaden.bereit, false, "A6: ohne `laden` meldet das Bauteil `bereit`");
	assert.strictEqual(stOhneLaden.lies(), null);
	checks += 2;

	// 🔴 D2 -- DER FALL, DER WEHTUT: eine Linie MIT Zuweisung, ein zweites neuLaden(), das nichts
	// liefert. `neuLaden` gehoert zur Schnittstelle, die die Aufgaben 4-9 benutzen.
	let d2Liefert = { artikel: { name: "X", wiki_url: "https://de.wiki-aventurica.de/wiki/X", wiki_key: "x", werte: {} } };
	const d2 = scheinBehaelter();
	const stD2 = avesmapsWikiAssignMount(d2, { subject: "kraftlinie", skin: "dt", laden: () => d2Liefert });
	await stD2.neuLaden();
	assert.strictEqual(stD2.lies().wiki_url, "https://de.wiki-aventurica.de/wiki/X",
		"D2: der erste Lauf traegt die Adresse nicht in den Schreibwert");
	d2Liefert = undefined;
	await stD2.neuLaden();
	assert.strictEqual(stD2.bereit, false,
		"D2: ein zweiter Lauf, der nichts liefert, laesst `bereit` stehen -- der Schreibwert kippt "
		+ "lautlos von der echten Adresse auf \"\", und saveLine schreibt das auf alle Segmente.");
	assert.strictEqual(stD2.lies(), null);
	checks += 3;

	// ⚠️ GEGENPROBE: die GEWOLLTE Leerung darf davon nicht getroffen werden. Ein `laden`, das ein
	// echtes Objekt OHNE Artikel liefert, ist ein gueltiger Zustand („nichts zugewiesen") -- und
	// „Entfernen" laeuft ohnehin gar nicht durch neuLaden, sondern setzt daten.artikel direkt.
	const leerAberGueltig = await ladenLiefert({ artikel: null, keinArtikel: true });
	assert.strictEqual(leerAberGueltig.st.bereit, true,
		"ein gueltiges Objekt ohne Artikel gilt faelschlich als Fehlschlag -- damit waere die gewollte Leerung kaputt");
	// 🔴 `kein_artikel_geaendert: false` steht hier ausdruecklich mit drin: der Ladelauf hat den Merker
	// gerade GESETZT geliefert, also ist er NICHT „seit dem Laden veraendert" -- ein Schreibweg, der
	// darauf hoert, schickt ihn nicht mit (Owner-Entscheid 16.08.2026, anstelle eines
	// `expected_revision`). Ein `true` an dieser Stelle waere der Fehler, den der Riegel verhindert:
	// ein frisch geladener, unangetasteter Dialog wuerde den Merker eines zweiten Editors mitschreiben.
	assert.deepStrictEqual(leerAberGueltig.st.lies(),
		{ name: "", wiki_url: "", wiki_key: "", kein_artikel: true, kein_artikel_geaendert: false });
	const leeresObjekt = await ladenLiefert({});
	assert.strictEqual(leeresObjekt.st.bereit, true, "ein leeres Objekt ist ein gueltiger Zustand, kein Fehlschlag");
	checks += 3;

	// 🔴 Die Eigenschaft in EINEM Satz, ueber JEDE der unten aufgezaehlten Steuerungen: kein
	// `bereit === true` ohne gueltigen Schreibwert, kein gueltiger Schreibwert ohne
	// `bereit === true`.
	// 💣 Hier stand „ueber alle VIER gebauten Faelle“, waehrend die Liste sieben fuehrte. Eine
	// Zahl im Kommentar liest sich wie eine vollstaendige Liste und niemand zaehlt nach --
	// dieselbe Form wie „ERZEUGER 1 VON 2" (AGENTS.md §10). Wer eine Steuerung ergaenzt,
	// haengt sie an die Liste; eine Zahl gibt es hier nicht mehr.
	[
		blind, blindDiff, blindArt, blind2,          // die vier Blindgaenger aus `mount`
		stWirft, stAbgelehnt, stKippt,                // Wurf, abgelehnte Zusage, spaeteres Scheitern
		stOhneLaden, stD2,                            // gar kein `laden`; der zweite Lauf ohne Wert
		leerAberGueltig.st, leeresObjekt.st,          // die zwei GUELTIGEN Leerzustaende (Gegenprobe)
	].forEach((st, i) => {
		assert.strictEqual(st.bereit === true, st.lies() !== null,
			"Steuerung " + i + ": `bereit` und die Gueltigkeit von lies() gehen auseinander");
		checks++;
	});


	// ── 17) EIN SYNCHRONER WURF AUS EINEM RUECKRUF IST AUCH EINE ABLEHNUNG (Nachbesserung 2) ───
	// 💣 `Promise.resolve(opt.x())` wertet den Aufruf AUS, bevor `Promise.resolve` ihn zu fassen
	// bekommt. Wirft eine Oberflaeche synchron, verliess der Fehler den Klick-Zuhoerer ungefangen,
	// und der Ablehnungszweig darunter war TOT. Gemessen am 16.08.2026 an `syncUebernehmen` -- dem
	// einzigen der drei, den eine Oberflaeche ueberhaupt synchron schreiben kann; `zuweisen` und
	// `loesen` sind dort `async` und waren deshalb zufaellig richtig.
	//
	// 🔴 GEFAHREN WIRD DER KLICKPFAD, nicht der Rueckruf. Genau daran ist die vorige Fassung
	// gescheitert: sie rief `syncUebernehmen([])` direkt und sah die Verdrahtung nie.
	function klickBehaelter() {
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
	function klickZiel(merkmal, wert) {
		const element = {
			getAttribute: (name) => (name === merkmal ? wert : null),
			hasAttribute: (name) => name === merkmal,
		};
		element.closest = (selektor) => (selektor === "[" + merkmal + "]" ? element : null);
		return element;
	}
	const kurzeRuhe = () => new Promise((fertig) => setTimeout(fertig, 0));

	const artikelStand = {
		artikel: { name: "Konzilslinie", wiki_url: "https://w/wiki/K", wiki_key: "k", werte: {} },
		listen: { wiki_articles: [{ name: "Satinavs Ketten", wiki_url: "https://w/wiki/S", wiki_key: "s", werte: {} }] },
	};

	// (a) `syncUebernehmen` wirft synchron -- der Kraftlinien-Erklaerung fehlt der Sync-Knopf, also
	// wird die Aktion direkt ausgeloest (genau das tut auch ein Klick auf den Knopf).
	const kSync = klickBehaelter();
	let syncRufe = 0;
	avesmapsWikiAssignMount(kSync, {
		subject: "kraftlinie", skin: "dt",
		laden: () => artikelStand,
		syncUebernehmen: () => { syncRufe++; throw new Error("SYNCHRON GEWORFEN"); },
	});
	await kurzeRuhe();
	let durchschlag = null;
	try {
		kSync.feuere("click", klickZiel("data-wa-aktion", "sync-uebernehmen"));
	} catch (fehler) {
		durchschlag = fehler;
	}
	await kurzeRuhe();
	assert.strictEqual(syncRufe, 1, "der Rueckruf wurde gar nicht erreicht");
	assert.strictEqual(durchschlag, null,
		"ein synchroner Wurf aus `syncUebernehmen` verlaesst den Klick-Zuhoerer ungefangen: "
		+ (durchschlag && durchschlag.message));
	checks += 2;

	// (b) Dasselbe fuer `loesen` -- und der Zustand darf sich NICHT bewegen.
	const kLoesen = klickBehaelter();
	const stLoesen = avesmapsWikiAssignMount(kLoesen, {
		subject: "kraftlinie", skin: "dt",
		laden: () => artikelStand,
		loesen: () => { throw new Error("SYNCHRON GEWORFEN"); },
	});
	await kurzeRuhe();
	let durchschlagL = null;
	try {
		kLoesen.feuere("click", klickZiel("data-wa-aktion", "entfernen"));
	} catch (fehler) {
		durchschlagL = fehler;
	}
	await kurzeRuhe();
	assert.strictEqual(durchschlagL, null, "ein synchroner Wurf aus `loesen` schlaegt durch");
	assert.strictEqual(stLoesen.lies().wiki_key, "k",
		"nach einem gescheiterten Loesen ist die Zuweisung trotzdem weg");
	checks += 2;

	// (c) Und fuer `zuweisen`: erst die Suche oeffnen (Listen-Suche, kein Netz), dann den Treffer.
	const kZuweisen = klickBehaelter();
	const stZuweisen = avesmapsWikiAssignMount(kZuweisen, {
		subject: "kraftlinie", skin: "dt",
		laden: () => ({ artikel: null, listen: artikelStand.listen }),
		zuweisen: () => { throw new Error("SYNCHRON GEWORFEN"); },
	});
	await kurzeRuhe();
	kZuweisen.feuere("click", klickZiel("data-wa-aktion", "zuweisen"));
	await kurzeRuhe();
	let durchschlagZ = null;
	try {
		kZuweisen.feuere("click", klickZiel("data-wa-treffer", "0"));
	} catch (fehler) {
		durchschlagZ = fehler;
	}
	await kurzeRuhe();
	assert.strictEqual(durchschlagZ, null, "ein synchroner Wurf aus `zuweisen` schlaegt durch");
	assert.strictEqual(stZuweisen.lies().wiki_key, "",
		"nach einem gescheiterten Zuweisen steht die Zuweisung trotzdem da");
	checks += 2;

	// 🔴 Und der Trichter selbst, damit die Eigenschaft benannt ist und nicht nur beobachtet:
	// wer wirft, lehnt ab -- beides ist dasselbe.
	let gefangen = null;
	await avesmapsWikiAssignRufen(() => { throw new Error("geworfen"); }).then(() => {}, (f) => { gefangen = f; });
	assert.ok(gefangen && /geworfen/.test(gefangen.message),
		"avesmapsWikiAssignRufen macht aus einem synchronen Wurf keine abgelehnte Zusage");
	// Eine abgelehnte Zusage bleibt eine abgelehnte Zusage, ein Wert bleibt ein Wert.
	let gefangen2 = null;
	await avesmapsWikiAssignRufen(() => Promise.reject(new Error("abgelehnt"))).then(() => {}, (f) => { gefangen2 = f; });
	assert.ok(gefangen2 && /abgelehnt/.test(gefangen2.message));
	assert.strictEqual(await avesmapsWikiAssignRufen((x) => x * 2, 21), 42);
	// Kein Rueckruf uebergeben ist kein Fehler -- das Bauteil ruft alle vier auch dann.
	assert.strictEqual(await avesmapsWikiAssignRufen(undefined), null);
	checks += 4;

	// ══ DIE FUELLUNG FOLGT DER HAUPTHANDLUNG -- und sie WANDERT ════════════════════════════════
	// 🔴 Owner-Entscheid 16.08.2026 als Folge der konservativen Vorhaekelung: solange nichts angehakt
	// ist, traegt „Alle anhaken" die Fuellung („Uebernehmen" ist dann abgeschaltet); ab dem ersten
	// Haken traegt „Uebernehmen" sie. GENAU EINER, immer -- nie zwei, nie null (AGENTS.md §12).
	// 💣 Geprueft in BEIDEN Huellen: die Klassen heissen verschieden, und eine Huelle ohne
	// `knopfHaupt` gaebe stumm den weichen Knopf aus.
	function syncMarkup(huelle, syncZeilen) {
		const modell = avesmapsWikiAssignModell(
			{ label: "X", felder: [{ wiki: "a", karte: "a" }, { wiki: "b", karte: "b" }], sync: true },
			{ artikel: { name: "A", werte: {} } },
			{ modus: "sync", syncZeilen: syncZeilen }
		);
		return avesmapsWikiAssignMarkup(modell, avesmapsWikiAssignSkin(huelle));
	}
	[
		["dt", "primary"],
		["label-wiki", "location-report-form__button--primary"],
	].forEach(([huelle, hauptKlasse]) => {
		// (1) NICHTS angehakt -> die Fuellung liegt auf „Alle anhaken".
		const ohneHaken = syncMarkup(huelle, [
			{ karte: "a", label: "A", alt: "x", neu: "y", gehakt: false, grund: "auf der Karte steht bereits ein Wert" },
		]);
		const kastenOhne = /data-wa-aktion="sync-alle"/.exec(ohneHaken);
		assert.ok(kastenOhne, huelle + ": der Knopf „Alle anhaken“ fehlt");
		assert.ok(new RegExp('class="[^"]*' + hauptKlasse + '[^"]*"[^>]*data-wa-aktion="sync-alle"').test(ohneHaken),
			huelle + ": bei NULL Haken traegt „Alle anhaken“ die Fuellung nicht -- sie laege auf dem "
			+ "abgeschalteten Knopf: " + ohneHaken);
		assert.ok(!new RegExp('class="[^"]*' + hauptKlasse + '[^"]*"[^>]*data-wa-aktion="sync-uebernehmen"').test(ohneHaken),
			huelle + ": der abgeschaltete „Uebernehmen“-Knopf ist trotzdem gefuellt -- zwei Hauptknoepfe");
		// (2) EINER angehakt -> sie wandert auf „Uebernehmen“.
		const mitHaken = syncMarkup(huelle, [
			{ karte: "a", label: "A", alt: "x", neu: "y", gehakt: true, grund: "" },
		]);
		assert.ok(new RegExp('class="[^"]*' + hauptKlasse + '[^"]*"[^>]*data-wa-aktion="sync-uebernehmen"').test(mitHaken),
			huelle + ": ab dem ersten Haken traegt „Uebernehmen“ die Fuellung nicht: " + mitHaken);
		assert.ok(!new RegExp('class="[^"]*' + hauptKlasse + '[^"]*"[^>]*data-wa-aktion="sync-alle"').test(mitHaken),
			huelle + ": „Alle anhaken“ bleibt gefuellt -- zwei Hauptknoepfe nebeneinander");
		checks += 5;
	});

	// ══ `kein_artikel_geaendert` -- BEIDE RICHTUNGEN, ueber den Klickpfad ═══════════════════════
	// 🔴 Owner-Entscheid 16.08.2026 anstelle eines `expected_revision`: der Merker reist nur mit, wenn
	// er SEIT DEM LADEN bewusst umgelegt wurde. Wer ihn nicht anfasst, kann ihn nicht loeschen --
	// sonst nimmt ein alter offener Dialog beim naechsten beliebigen Speichern die Entscheidung eines
	// zweiten Editors aus dem Konfliktzentrum zurueck.
	// 💣 Der Unterschied ist VERAENDERT, nicht GESETZT. Beide Richtungen werden deshalb einzeln
	// gefahren: haenge der Riegel an „gesetzt", liesse sich der Merker nie wieder loswerden.
	async function haekchenUmlegen(startwert, neuerWert) {
		const behaelter = klickBehaelter();
		const st = avesmapsWikiAssignMount(behaelter, {
			subject: "kraftlinie", skin: "dt",
			laden: () => ({ artikel: null, keinArtikel: startwert }),
		});
		await kurzeRuhe();
		const ziel = klickZiel("data-wa-kein-artikel", "");
		ziel.checked = neuerWert;
		behaelter.feuere("change", ziel);
		await kurzeRuhe();
		return st.lies();
	}
	// (1) ungesetzt -> gesetzt
	const gesetzt = await haekchenUmlegen(false, true);
	assert.strictEqual(gesetzt.kein_artikel, true);
	assert.strictEqual(gesetzt.kein_artikel_geaendert, true,
		"ein GESETZTES Haekchen gilt nicht als veraendert -- der Merker kaeme nie beim Server an");
	// (2) gesetzt -> ungesetzt: der Fall, den ein Riegel auf „gesetzt" verschlucken wuerde.
	const entfernt = await haekchenUmlegen(true, false);
	assert.strictEqual(entfernt.kein_artikel, false);
	assert.strictEqual(entfernt.kein_artikel_geaendert, true,
		"ein bewusst ENTFERNTES Haekchen gilt nicht als veraendert -- man wuerde den Merker nie wieder los");
	// (3) angefasst und wieder zurueckgelegt: kein Unterschied zum geladenen Stand, also nichts zu
	//     schicken. ⚠️ Die Regel haengt am WERT, nicht daran, ob jemand geklickt hat.
	const zurueck = await haekchenUmlegen(true, true);
	assert.strictEqual(zurueck.kein_artikel_geaendert, false,
		"ein Haekchen, das auf seinem geladenen Wert steht, gilt als veraendert");
	// (4) Und ein `neuLaden()` setzt den Bezugspunkt neu -- danach ist wieder nichts veraendert.
	const behaelterNeu = klickBehaelter();
	let standNeu = { artikel: null, keinArtikel: false };
	const stNeu = avesmapsWikiAssignMount(behaelterNeu, {
		subject: "kraftlinie", skin: "dt", laden: () => standNeu,
	});
	await kurzeRuhe();
	const zielNeu = klickZiel("data-wa-kein-artikel", "");
	zielNeu.checked = true;
	behaelterNeu.feuere("change", zielNeu);
	assert.strictEqual(stNeu.lies().kein_artikel_geaendert, true);
	standNeu = { artikel: null, keinArtikel: true };
	await stNeu.neuLaden();
	assert.strictEqual(stNeu.lies().kein_artikel_geaendert, false,
		"nach einem Neuladen gilt der frische Serverstand noch als veraendert");
	checks += 7;

	console.log("wiki-assign: " + checks + " Zusicherungen erfuellt");
})().catch((fehler) => {
	console.error(fehler && fehler.message ? fehler.message : fehler);
	process.exit(1);
});
