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
	avesmapsWikiAssignListeFiltern,
	avesmapsWikiAssignTrefferMeta,
	avesmapsWikiAssignFeldLabel,
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

console.log("wiki-assign: " + checks + " Zusicherungen erfuellt");
