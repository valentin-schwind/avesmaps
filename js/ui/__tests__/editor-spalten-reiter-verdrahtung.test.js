/**
 * Dass der Territorien-Editor die Reiter WIRKLICH benutzt — und dass die CSS-Seite stimmt.
 *
 * Abnahmeliste des Entwurfs
 * (docs/superpowers/specs/2026-09-12-sync-monitor-am-telefon-design.md): A2 · A4 · A6 · A8 · A9 ·
 * A10 · A11 stehen hier; A1/A3/A5/A7 im Bauteil-Test daneben.
 *
 * 🪤 EIN REGEX KENNT KEINEN GELTUNGSBEREICH — die Lehre vom 03.09.2026, die zwei Stunden ohne
 * Beschriftungen auf der Live-Karte gekostet hat: ein Quelltext-Test fand die Zeile, und der Bauer
 * daneben warf beim Ausführen einen ReferenceError. Deshalb wird `selectKey` hier AUSGESCHNITTEN
 * UND AUSGEFÜHRT, mit Attrappen — und die Attrappen sind einfache Objekte, KEIN Proxy: ein Proxy,
 * der jeden Bezeichner beantwortet, verschluckt genau diesen Fehler.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

let fehler = 0;
function pruefe(bedingung, name) {
	if (bedingung) return;
	fehler++;
	console.error("FEHLER: " + name);
}

const WURZEL = path.resolve(__dirname, "..", "..", "..");
const lies = (...teile) => fs.readFileSync(path.join(WURZEL, ...teile), "utf8");

const monitor = lies("html", "wiki-sync-monitor.html");
const editorBody = lies("css", "components", "editor-body.css");
const overlay = lies("css", "components", "political-territory-editor-overlay.css");
const wikiSync = lies("js", "review", "review-wiki-sync.js");

/**
 * Kommentare weg, bevor gesucht wird. 💣 Beide Blätter und die Seite BEGRÜNDEN ihre Regeln im
 * Klartext und nennen dabei genau die Muster, gegen die sie warnen ("NIE `hidden`", "100vh") --
 * ein Test, der den Rohtext liest, schlägt an der Warnung an, die vor dem Muster warnt.
 * ⚠️ Zeilenendenneutral (AGENTS.md §9): hier CRLF, im Tor LF.
 */
function ohneKommentare(quelle) {
	return String(quelle)
		.replace(/\r\n/g, "\n")
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^[ \t]*\/\/.*$/gm, "");
}

const monitorRein = ohneKommentare(monitor);
const editorBodyRein = ohneKommentare(editorBody);
const overlayRein = ohneKommentare(overlay);
const wikiSyncRein = ohneKommentare(wikiSync);

// -----------------------------------------------------------------------------------------------
// 1. A4: `selectKey` wird ausgeschnitten und GEFAHREN — springt es auf die Detailspalte?
// -----------------------------------------------------------------------------------------------
{
	const treffer = monitorRein.match(/function selectKey\(k\)\{[\s\S]*?\n\}/);
	pruefe(Boolean(treffer), "A4: `function selectKey` in html/wiki-sync-monitor.html gefunden");

	if (treffer) {
		const detailSpalte = { id: "detail" };
		const gezeigt = [];
		let renderDetailGerufen = 0;

		const kontext = {
			// Die Attrappen, die selectKey anfasst. Bewusst vollständig ausgeschrieben: fehlt eine,
			// wirft der Lauf -- und genau das soll er, statt still durchzulaufen.
			selectedKey: null,
			editMode: true,
			pendingCapital: "irgendwas",
			capResults: [1, 2, 3],
			renderDetail() { renderDetailGerufen += 1; },
			$: (id) => (id === "detail" ? detailSpalte : null),
			CSS: { escape: (wert) => String(wert) },
			document: { querySelectorAll: () => [] },
			avesmapsSpaltenReiter: (selektor) => ({
				zeige: (ziel) => gezeigt.push({ selektor, ziel }),
			}),
		};
		kontext.globalThis = kontext;
		vm.createContext(kontext);
		vm.runInContext(treffer[0] + "\nselectKey('wiki:probe');", kontext);

		pruefe(renderDetailGerufen === 1, "A4: selectKey rendert das Detailpanel (unverändert)");
		pruefe(kontext.selectedKey === "wiki:probe", "A4: und setzt den gewählten Schlüssel");
		pruefe(gezeigt.length === 1, "A4: selectKey ruft die Reitersteuerung GENAU einmal");
		pruefe(gezeigt[0] && gezeigt[0].selektor === ".cols", "A4: und zwar die des Spalten-Wirts `.cols`");
		pruefe(gezeigt[0] && gezeigt[0].ziel === detailSpalte,
			"A4: gezeigt wird die DETAILspalte — nicht die Liste, aus der geklickt wurde");
	}
}

// -----------------------------------------------------------------------------------------------
// 2. A4 (Gegenprobe): ohne das Bauteil darf selectKey NICHT werfen.
//    ⚠️ Das ist der Fall „alter Cache / Skript nicht geladen". Ein ReferenceError hier nähme dem
//    Editor das Detailpanel KOMPLETT -- also genau die Funktion, die es schon immer gab.
// -----------------------------------------------------------------------------------------------
{
	const treffer = monitorRein.match(/function selectKey\(k\)\{[\s\S]*?\n\}/);
	if (treffer) {
		let renderDetailGerufen = 0;
		const kontext = {
			selectedKey: null, editMode: true, pendingCapital: undefined, capResults: [],
			renderDetail() { renderDetailGerufen += 1; },
			$: () => null,
			CSS: { escape: (wert) => String(wert) },
			document: { querySelectorAll: () => [] },
			// avesmapsSpaltenReiter fehlt hier ABSICHTLICH.
		};
		kontext.globalThis = kontext;
		vm.createContext(kontext);
		let geworfen = null;
		try { vm.runInContext(treffer[0] + "\nselectKey('wiki:probe');", kontext); }
		catch (f) { geworfen = f; }
		pruefe(geworfen === null, "A4: ohne das Bauteil läuft selectKey durch (fällt offen aus)");
		pruefe(renderDetailGerufen === 1, "A4: und rendert weiter das Detailpanel");
	}
}

// -----------------------------------------------------------------------------------------------
// 3. Die Verdrahtung: Skript eingebunden, Kurznamen gesetzt, attach gerufen.
// -----------------------------------------------------------------------------------------------
{
	pruefe(monitorRein.includes('src="/js/ui/editor-spalten-reiter.js"'),
		"Verdrahtung: das Bauteil ist in html/wiki-sync-monitor.html eingebunden");
	pruefe(/avesmapsSpaltenReiterAttach\(document\.querySelector\('\.cols'\)\)/.test(monitorRein),
		"Verdrahtung: attach wird auf `.cols` gerufen");

	// 🔴 Die Kurznamen. Ohne sie stünde in der Leiste „Noch nicht modellierte Herrschaftsgebiete" --
	//    so abgeschnitten wie die Spalte, um die es hier überhaupt geht.
	for (const [id, name] of [["left", "Lücken"], ["right", "Modell"], ["detail", "Details"]]) {
		const regel = new RegExp(`id="${id}"[^>]*data-reiter="${name}"`);
		pruefe(regel.test(monitorRein), `Verdrahtung: Spalte #${id} trägt den Kurznamen „${name}“`);
	}

	// ⚠️ Das Ergebnis von attach darf NICHT in eine Variable wandern: `selectKey` steht 150 Zeilen
	//    weiter unten, und ein Zugriff aus der Funktion auf eine `const` davor hängt an der
	//    Reihenfolge zweier Blöcke derselben Datei (temporale Todeszone). Der Nachschlager
	//    `avesmapsSpaltenReiter` gibt es genau deshalb.
	pruefe(!/(?:const|let|var)\s+\w+\s*=\s*(?:typeof avesmapsSpaltenReiterAttach[\s\S]{0,80})?avesmapsSpaltenReiterAttach\(/.test(monitorRein),
		"Verdrahtung: das attach-Ergebnis wird NICHT in eine Variable gelegt (TDZ)");
}

// -----------------------------------------------------------------------------------------------
// 4. A2/A6: die CSS-Seite. Die Klasse wirkt NUR in der Media-Query.
// -----------------------------------------------------------------------------------------------
{
	pruefe(editorBodyRein.includes(".avm-spalten-reiter"), "A2: .avm-spalten-reiter steht in editor-body.css");

	// Der Block der Media-Query herausschneiden und gegen den Rest halten.
	const abBeginn = editorBodyRein.indexOf("@media (max-width: 680px)");
	pruefe(abBeginn > 0, "A2: die 680px-Query steht in editor-body.css");
	if (abBeginn > 0) {
		// Klammern zählen, ab der ersten öffnenden nach dem @media.
		const ab = editorBodyRein.indexOf("{", abBeginn);
		let tiefe = 0, ende = ab;
		for (let i = ab; i < editorBodyRein.length; i += 1) {
			if (editorBodyRein[i] === "{") tiefe += 1;
			else if (editorBodyRein[i] === "}") { tiefe -= 1; if (tiefe === 0) { ende = i + 1; break; } }
		}
		const inQuery = editorBodyRein.slice(ab, ende);
		const ausserhalb = editorBodyRein.slice(0, abBeginn) + editorBodyRein.slice(ende);

		pruefe(/\.avm-spalte-aus\s*\{/.test(inQuery), "A6: `.avm-spalte-aus` wird IN der Query versteckt");
		pruefe(!/\.avm-spalte-aus\s*\{/.test(ausserhalb),
			"A6: und NIRGENDS ausserhalb — sonst wären die Spalten in JEDER Breite weg");
		pruefe(/\.avm-spalten-reiter\s*\{[^}]*display:\s*flex/.test(inQuery),
			"A2: die Leiste wird erst IN der Query sichtbar");
		pruefe(/\.avm-spalten-reiter\s*\{[^}]*display:\s*none/.test(ausserhalb),
			"A2: und steht ausserhalb auf display:none — über 680px gibt es keine Reiter");

		// 💣 `--avm-col-pad` ist ein ZWEIwert (8px 14px). In `padding: 0 var(--avm-col-pad)` wird
		//    daraus `0 8px 14px` — oben 0, seitlich 8, UNTEN 14. Der erste Bau stand genau so da.
		//    Der Seiteneinzug dieses Hauses ist `--space-12`, und er ist ein EINwert.
		const leisteRegel = (ausserhalb.match(/\.avm-spalten-reiter\s*\{[^}]*\}/) || [""])[0];
		pruefe(!/padding:[^;]*--avm-col-pad/.test(leisteRegel),
			"A2: die Leiste polstert NICHT mit dem Zweiwert-Token --avm-col-pad");
		pruefe(/padding:\s*0 var\(--space-12\)/.test(leisteRegel),
			"A2: sondern mit dem Seiteneinzug --space-12 — dieselbe Kante wie die Spalten");
		// Und sie holt Abstand und Trennlinie von `.avm-tabs`, statt sie ein zweites Mal zu setzen.
		pruefe(!/gap:/.test(leisteRegel), "A2: kein eigenes `gap` — das bringt .avm-tabs mit");
		pruefe(!/border-bottom/.test(leisteRegel), "A2: und keine eigene Trennlinie");

		// 💣 Die Reihenfolge trägt: `.avm-tabs` (display:flex) und `.avm-spalten-reiter`
		//    (display:none) liegen beide auf (0,1,0) am DEMSELBEN Element.
		// 🪤 UND HIER SASS DIE `-1`-FALLE AUS AGENTS.md §9, gefunden von der Mutationsprobe: ein
		//    blosser `indexOf(A) < indexOf(B)` ist auch dann WAHR, wenn A gar nicht mehr da ist
		//    (`-1 < irgendwas`). Die Zusicherung blieb grün, als `.avm-tabs` umbenannt wurde — also
		//    genau in dem Fall, in dem die Leiste ihre Form verliert. Erst die Stellen prüfen,
		//    dann vergleichen.
		const stelleTabs = editorBodyRein.indexOf(".avm-tabs {");
		const stelleReiter = editorBodyRein.indexOf(".avm-spalten-reiter {");
		pruefe(stelleTabs >= 0, "A2: `.avm-tabs {` steht in editor-body.css (die FORM der Leiste)");
		pruefe(stelleReiter >= 0, "A2: `.avm-spalten-reiter {` steht dort ebenfalls");
		pruefe(stelleTabs >= 0 && stelleReiter >= 0 && stelleTabs < stelleReiter,
			"A2: `.avm-spalten-reiter` steht NACH `.avm-tabs` — bei gleicher Spezifität entscheidet die Reihenfolge");
	}
}

// -----------------------------------------------------------------------------------------------
// 5. A8/A9/A10: die Telefon- und Touch-Regeln der Seite.
// -----------------------------------------------------------------------------------------------
{
	pruefe(monitorRein.includes("@media (max-width: 680px)"),
		"A8: die Seite hat eine 680px-Query (sie hatte bis 12.09.2026 KEINE einzige)");
	pruefe(monitorRein.includes("@media (hover: none) and (pointer: coarse)"),
		"A10: und einen eigenen Touch-Riegel");

	const telefon = monitorRein.slice(monitorRein.indexOf("@media (max-width: 680px)"),
		monitorRein.indexOf("@media (hover: none) and (pointer: coarse)"));
	pruefe(/\.controls\s*\{[^}]*grid-auto-flow:\s*row/.test(telefon),
		"A8: das Menüband bricht um (grid-auto-flow:row) statt fünf Kacheln in eine Zeile zu zwingen");
	pruefe(/\.btn2 \.t1[^{]*\{[^}]*white-space:\s*normal/.test(telefon),
		"A8: und die Kachelbeschriftung darf umbrechen statt zu „2 · Hi…“ zu werden");
	pruefe(/#status\s*\{[^}]*white-space:\s*normal/.test(telefon), "A9: die Statuszeile umbricht");
	pruefe(/#status\s*\{[^}]*flex-wrap:\s*wrap/.test(telefon), "A9: und ihre Teile brechen in die nächste Zeile");

	const touch = monitorRein.slice(monitorRein.indexOf("@media (hover: none) and (pointer: coarse)"));
	pruefe(/#dropRoot, #dropExclude\s*\{[^}]*display:\s*none/.test(touch),
		"A10: die zwei Drop-Zonen fallen am Touch-Gerät (HTML5-DnD kennt kein Touch)");
	pruefe(/\.row, \.node\s*\{[^}]*cursor:\s*default/.test(touch),
		"A10: und mit ihnen `cursor:grab` — dieselbe Behauptung, eine Etage kleiner");

	// 🔴 Der Touch-Riegel misst das GERÄT, nicht die Breite: ein Tablet ist breit UND tastbedient.
	//    Wer die zwei Riegel zusammenzieht, nimmt einem Tablet die Drop-Zonen nicht ab (falsch
	//    herum) oder einem schmalen Desktopfenster die Spalten nicht (ebenso falsch).
	pruefe(!telefon.includes("#dropRoot"),
		"A10: die Drop-Zonen hängen NICHT am Breiten-Riegel — der misst die falsche Frage");
	pruefe(!touch.includes(".controls {"),
		"A8: das Menüband hängt NICHT am Touch-Riegel — es ist eine Platzfrage, keine Gerätefrage");
}

// -----------------------------------------------------------------------------------------------
// 6. A11: die Inline-Maße des Sync-Fensters sind weg, das Maß steht im CSS.
//    💣 Ein Inline-Style ist die eine Form, gegen die eine Media-Query nicht gewinnt — daran war
//       die 680px-Regel des Overlays für genau dieses Fenster wirkungslos.
// -----------------------------------------------------------------------------------------------
{
	pruefe(!/dialog\.style\.width/.test(wikiSyncRein) && !/dialog\.style\.height/.test(wikiSyncRein),
		"A11: openAvesmapsSyncEditorOverlay setzt Breite/Höhe NICHT mehr inline");
	pruefe(/#avesmaps-sync-editor-overlay \.political-territory-editor-dialog\s*\{[^}]*width:\s*min\(1400px/.test(overlayRein),
		"A11: das Maß des Sync-Fensters steht jetzt im Overlay-Blatt");
	pruefe(overlayRein.includes("@media (max-width: 680px)"), "A11: und die 680px-Regel ist da");

	const ab = overlayRein.indexOf("@media (max-width: 680px)");
	const inQuery = overlayRein.slice(ab);
	pruefe(/width:\s*100%/.test(inQuery) && /height:\s*100%/.test(inQuery),
		"A11: am schmalen Bildschirm füllt das Fenster den Schleier");
	// 💣 `100vh` ist auf einem Telefon die Höhe OHNE Abzug der Adressleiste: das Fenster ragte
	//    unten hinaus, und dort sitzt die Fußleiste mit „Speichern".
	pruefe(!/height:\s*100vh/.test(inQuery), "A11: und zwar mit 100%, NIE mit 100vh");
	pruefe(/#avesmaps-sync-editor-overlay \.political-territory-editor-dialog/.test(inQuery),
		"A11: die Regel nennt das Sync-Fenster mit — sonst gewinnt seine eigene (1,1,0) darüber");
}

if (fehler > 0) {
	console.error(`\n${fehler} Zusicherung(en) verletzt.`);
	process.exit(1);
}
console.log("editor-spalten-reiter-verdrahtung.test.js: alle Zusicherungen erfüllt.");
