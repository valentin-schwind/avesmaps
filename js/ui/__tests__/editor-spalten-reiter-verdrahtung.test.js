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
const reiterBlatt = lies("css", "components", "editor-spalten-reiter.css");
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
const reiterRein = ohneKommentare(reiterBlatt);
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
	pruefe(reiterRein.includes(".avm-spalten-reiter"), "A2: .avm-spalten-reiter steht im eigenen Blatt");

	// Der Block der Media-Query herausschneiden und gegen den Rest halten.
	const abBeginn = reiterRein.indexOf("@media (max-width: 680px)");
	pruefe(abBeginn > 0, "A2: die 680px-Query steht im Blatt des Bauteils");
	if (abBeginn > 0) {
		// Klammern zählen, ab der ersten öffnenden nach dem @media.
		const ab = reiterRein.indexOf("{", abBeginn);
		let tiefe = 0, ende = ab;
		for (let i = ab; i < reiterRein.length; i += 1) {
			if (reiterRein[i] === "{") tiefe += 1;
			else if (reiterRein[i] === "}") { tiefe -= 1; if (tiefe === 0) { ende = i + 1; break; } }
		}
		const inQuery = reiterRein.slice(ab, ende);
		const ausserhalb = reiterRein.slice(0, abBeginn) + reiterRein.slice(ende);

		pruefe(/\.avm-spalte-aus\s*\{/.test(inQuery), "A6: `.avm-spalte-aus` wird IN der Query versteckt");
		pruefe(!/\.avm-spalte-aus\s*\{/.test(ausserhalb),
			"A6: und NIRGENDS ausserhalb — sonst wären die Spalten in JEDER Breite weg");
		pruefe(/\.avm-tabs\.avm-spalten-reiter\s*\{[^}]*display:\s*flex/.test(inQuery),
			"A2: die Leiste wird erst IN der Query sichtbar");
		pruefe(/\.avm-tabs\.avm-spalten-reiter\s*\{[^}]*display:\s*none/.test(ausserhalb),
			"A2: und steht ausserhalb auf display:none — über 680px gibt es keine Reiter");

		// 💣 `--avm-col-pad` ist ein ZWEIwert. In `padding: 0 var(--avm-col-pad)` wird daraus
		//    `0 8px 12px` — oben 0, seitlich 8, UNTEN 12. Der erste Bau stand genau so da.
		const leisteRegel = (ausserhalb.match(/\.avm-tabs\.avm-spalten-reiter\s*\{[^}]*\}/) || [""])[0];
		pruefe(!/padding:[^;]*--avm-col-pad/.test(leisteRegel),
			"A2: die Leiste polstert NICHT mit dem Zweiwert-Token --avm-col-pad");
		// Und sie holt Abstand und Trennlinie von `.avm-tabs`, statt sie ein zweites Mal zu setzen.
		pruefe(!/gap:/.test(leisteRegel), "A2: kein eigenes `gap` — das bringt .avm-tabs mit");
		pruefe(!/border-bottom/.test(leisteRegel), "A2: und keine eigene Trennlinie");

		// 🪤 UND HIER DIE ZWEITE HÄLFTE DERSELBEN FALLE, gefunden von der Konsistenzprüfung: der
		//    erste Bau schrieb `--space-12` (14px) hin und begründete es mit „der Seiteneinzug ist
		//    überall 14". Der GLOBALE Token steht aber auf `--space-10` (12px); die 14px-Fassungen
		//    sind Überschreibungen an Fensterhüllen im ELTERNdokument, und Custom Properties
		//    kreuzen keine iframe-Grenze. Die Leiste stand damit 2px neben den Spaltentiteln —
		//    das Gegenteil der Garantie, die der Kommentar behauptete.
		// 🔴 Also wird die Kante GERECHNET, nicht abgeschrieben: die Seitenkomponente von
		//    `--avm-col-pad` aus tokens.css gegen das Polster der Leiste.
		const tokens = ohneKommentare(lies("css", "base", "tokens.css"));
		const colPad = (tokens.match(/--avm-col-pad:\s*([^;]+);/) || [])[1] || "";
		const seiteVonColPad = (colPad.trim().split(/\s+/)[1] || "").trim();
		pruefe(seiteVonColPad === "var(--space-10)",
			`A2: --avm-col-pad führt seitlich var(--space-10) (gelesen: „${seiteVonColPad}“)`);
		const leistePad = (leisteRegel.match(/padding:\s*0\s+([^;]+);/) || [])[1] || "";
		pruefe(leistePad.trim() === seiteVonColPad,
			`A2: die Leiste trägt DIESELBE Kante wie die Spalten (Leiste „${leistePad.trim()}“ gegen Spalte „${seiteVonColPad}“)`);
		// 🪤 Und kein Override in den Editorseiten, das die Rechnung oben ungültig machen würde.
		const editorPage = ohneKommentare(lies("css", "components", "editor-page.css"));
		pruefe(!/--avm-col-pad:/.test(editorPage) && !/--avm-col-pad:/.test(reiterRein),
			"A2: kein --avm-col-pad-Override in editor-page.css/dem Blatt — sonst gilt die Rechnung nicht");
	}
}

// -----------------------------------------------------------------------------------------------
// 4b. Die Touch-Ziele. 🔴 Der Reiter ist am Telefon der EINZIGE Weg zwischen den Spalten und war
//     im ersten Bau ~27px hoch — kleiner als die Zeilen, die er erschließt, und kleiner als die
//     44px, die derselbe Umbau für die Menübandkacheln fordert. Zwei Maße für dieselbe Frage.
// -----------------------------------------------------------------------------------------------
{
	const tokens = ohneKommentare(lies("css", "base", "tokens.css"));
	pruefe(/--avm-touch-h:\s*44px/.test(tokens),
		"A10: der Token --avm-touch-h steht in tokens.css (44px war vorher viermal als eigene Zahl da)");

	const ab = reiterRein.indexOf("@media (hover: none) and (pointer: coarse)");
	pruefe(ab > 0, "A10: das Blatt hat einen Touch-Riegel für die Reiterleiste");
	const touchBody = ab > 0 ? reiterRein.slice(ab) : "";
	pruefe(/\.avm-spalten-reiter \.avm-tab\s*\{[^}]*min-height:\s*var\(--avm-touch-h\)/.test(touchBody),
		"A10: der Reiter bekommt dort das Touch-Ziel aus dem Token");
	// 💣 NUR die Reiter dieses Bauteils, nicht `.avm-tab` überall: jene Klasse trägt die
	//    Reiterzeilen von elf anderen Oberflächen, und die mitzuvergrößern wäre unbestellt.
	pruefe(!/^\s*\.avm-tab\s*\{/m.test(touchBody),
		"A10: und zwar über `.avm-spalten-reiter .avm-tab`, NICHT über `.avm-tab` allein");

	// Die Seite selbst: Kacheln, Zeilen und Baumknoten lesen denselben Token.
	const touchSeite = monitorRein.slice(monitorRein.indexOf("@media (hover: none) and (pointer: coarse)"));
	const telefonSeite = monitorRein.slice(monitorRein.indexOf("@media (max-width: 680px)"),
		monitorRein.indexOf("@media (hover: none) and (pointer: coarse)"));
	pruefe(/\.btn2\s*\{[^}]*min-height:\s*var\(--avm-touch-h\)/.test(telefonSeite),
		"A10: die Menübandkachel liest den Token statt einer eigenen 44");
	pruefe(/\.row, \.node\s*\{[^}]*min-height:\s*var\(--avm-touch-h\)/.test(touchSeite),
		"A10: Listenzeile und Baumknoten bekommen dasselbe Touch-Ziel");
	pruefe(!/min-height:\s*44px/.test(telefonSeite) && !/min-height:\s*44px/.test(touchSeite),
		"A10: und NIRGENDS eine abgeschriebene 44 — das wäre die fünfte Fassung derselben Zahl");
}

// -----------------------------------------------------------------------------------------------
// 4c. Die tote Trennlinie und die zwei gequetschten Zeilen (Befunde der Designprüfung).
// -----------------------------------------------------------------------------------------------
{
	const telefon = monitorRein.slice(monitorRein.indexOf("@media (max-width: 680px)"),
		monitorRein.indexOf("@media (hover: none) and (pointer: coarse)"));

	// 💣 `.col + .col` ist ein GESCHWISTER-Selektor: `display:none` an der Spalte davor nimmt die
	//    Linie nicht zurück. Auf „Modell"/„Details" blieb ein 1px-Strich am Bildschirmrand.
	pruefe(/\.col \+ \.col\s*\{[^}]*border-left:\s*0/.test(telefon),
		"Designprüfung: die tote Trennlinie der abgewählten Spalte fällt");

	// `select#filter` bekommt dasselbe min-width:0, das die Regel darüber seinem Nachbarn gibt.
	pruefe(/\.bar\s*\{[^}]*flex-wrap:\s*wrap/.test(telefon), "Designprüfung: die Filterzeile bricht um");
	pruefe(/\.bar select\s*\{[^}]*min-width:\s*0/.test(telefon),
		"Designprüfung: das Auswahlfeld kann schrumpfen (wie input[type=search] seit jeher)");
	pruefe(/\.colfoot\s*\{[^}]*flex-wrap:\s*wrap/.test(telefon),
		"Designprüfung: die drei Fußknöpfe brechen um statt auf ~100px zu schrumpfen");
}

// -----------------------------------------------------------------------------------------------
// 4d. Die Übernahme-Vorschau: VIER verschachtelte Polster, und die Regel gehört ins BAUTEIL.
//     💣 Der erste Bau verkleinerte nur die äußerste Hülle — und tat das im <style>-Block der
//        Seite, also als lautlose Überstimmung eines geteilten Bauteils, wovor dieselbe Seite
//        ausdrücklich warnt. Übrig blieben drei innere 18er: 8+18 = 26px je Seite.
// -----------------------------------------------------------------------------------------------
{
	const planSheet = ohneKommentare(lies("css", "components", "sync-plan-sheet.css"));
	const ab = planSheet.indexOf("@media (max-width: 680px)");
	pruefe(ab > 0, "Designprüfung: die Schwelle steht im Blatt des Bauteils, nicht im <style> der Seite");
	const inQuery = ab > 0 ? planSheet.slice(ab) : "";
	pruefe(/\.sync-plan-host\s*\{[^}]*padding:\s*var\(--space-6\)/.test(inQuery), "Designprüfung: die äußere Hülle");
	pruefe(/summary,\s*\n?\s*\.sync-plan-host \.gate\s*\{[^}]*padding:\s*11px var\(--space-8\)/.test(inQuery),
		"Designprüfung: und die zwei inneren 18er an summary und .gate");
	pruefe(/\.rows\s*\{[^}]*padding:\s*2px var\(--space-8\) 14px/.test(inQuery),
		"Designprüfung: und das dritte an .rows");
	// 🔴 Keine Überstimmung mehr aus dem <style>-Block der Seite.
	pruefe(!/\.sync-plan-host\s*\{/.test(monitorRein),
		"Designprüfung: die Seite überstimmt `.sync-plan-host` NICHT mehr aus ihrem <style>-Block");
}

// -----------------------------------------------------------------------------------------------
// 4e. Fund der Konsistenzprüfung: die zwei Klassen tragen VIER Fenster. Nur das Sync-Fenster
//     füllt den Bildschirm; die drei anderen behalten ihr Grundmaß unverändert.
// -----------------------------------------------------------------------------------------------
{
	const ab = overlayRein.indexOf("@media (max-width: 680px)");
	const inQuery = ab > 0 ? overlayRein.slice(ab) : "";

	// Das Grundmaß der drei anderen steht unverändert da.
	pruefe(/\.political-territory-editor-overlay\s*\{[^}]*padding:\s*8px/.test(inQuery),
		"Konsistenz: die drei anderen Fenster dieser Hülle behalten ihr 8px-Schleierpolster");
	pruefe(/^\s*\.political-territory-editor-dialog\s*\{[^}]*width:\s*calc\(100vw - 16px\)/m.test(inQuery),
		"Konsistenz: und ihr Grundmaß calc(100vw - 16px)");

	// Bildschirmfüllend ist AUSSCHLIESSLICH das Sync-Fenster.
	pruefe(/#avesmaps-sync-editor-overlay\s*\{[^}]*padding:\s*0/.test(inQuery),
		"Konsistenz: nur beim Sync-Fenster fällt das Schleierpolster");
	const fuellRegel = (inQuery.match(/\{[^{}]*width:\s*100%;[^{}]*\}/) || [""])[0];
	const fuellSelektor = (inQuery.match(/([^{}]*)\{[^{}]*width:\s*100%;/) || ["", ""])[1];
	pruefe(fuellSelektor.includes("#avesmaps-sync-editor-overlay"),
		"Konsistenz: die 100%-Regel ist auf #avesmaps-sync-editor-overlay gescopt");
	pruefe(!/^\s*\.political-territory-editor-dialog,/m.test(inQuery),
		"Konsistenz: sie zieht NICHT die klassenweite Fassung mit — die trägt vier Fenster");
	pruefe(/border-radius:\s*0/.test(fuellRegel), "Konsistenz: und nimmt dort den Radius mit");
}

// -----------------------------------------------------------------------------------------------
// 4f. 🔴 DIE LEISTE GEWINNT ÜBER SPEZIFITÄT, NICHT ÜBER DIE LADEREIHENFOLGE.
//     💣 `.avm-tabs` setzt `display: flex` (0,1,0). Eine einklassige `.avm-spalten-reiter`-Regel
//        läge gleichauf, und dann entschiede, welches Blatt später lädt — „eine Regel, die nur über
//        die Ladereihenfolge gilt, ist keine Regel". Mit zwei Klassen (0,2,0) darf das Blatt
//        überall hängen, und genau darauf beruht der eigene `<link>`.
//     🪤 Die alte Fassung dieses Blocks verglich `indexOf(A) < indexOf(B)` in EINER Datei und saß
//        damit auf der `-1`-Falle aus AGENTS.md §9 (`-1 < irgendwas` ist wahr, auch wenn A fehlt).
//        Mit der Spezifität gibt es nichts mehr zu vergleichen.
// -----------------------------------------------------------------------------------------------
{
	pruefe(/\.avm-tabs\.avm-spalten-reiter\s*\{/.test(reiterRein),
		"A2: die Leiste wird über ZWEI Klassen adressiert (0,2,0) — unabhängig von der Ladereihenfolge");
	pruefe(!/^\.avm-spalten-reiter\s*\{/m.test(reiterRein),
		"A2: und NICHT einklassig — das läge mit .avm-tabs gleichauf");
	pruefe(/\.avm-tabs \{/.test(editorBodyRein),
		"A2: `.avm-tabs` (die FORM) steht weiter in editor-body.css");

	// 💣 DER RÜCKFALL, DEN DAS LIVE-BILD VOM 13.09.2026 GEKOSTET HAT: die Regeln standen in
	//    editor-body.css, die eine Editorseite nur über den @import von editor-page.css erreicht.
	//    Das JavaScript lief, die geänderte Datei hinter der Kette nicht.
	pruefe(!/avm-spalte-aus\s*\{/.test(editorBodyRein),
		"A2: `.avm-spalte-aus` steht NICHT mehr in editor-body.css (hinter der @import-Kette)");
	pruefe(!/\.avm-spalten-reiter[^}]*\{[^}]*display/.test(editorBodyRein),
		"A2: und auch keine Sichtbarkeitsregel der Leiste");

	// Das Blatt hängt mit EIGENEM <link> an der Seite, nicht über den @import.
	pruefe(monitorRein.includes('href="/css/components/editor-spalten-reiter.css"'),
		"A2: die Seite lädt das Blatt mit einem eigenen <link>");
	const editorPageQuelle = ohneKommentare(lies("css", "components", "editor-page.css"));
	pruefe(!/@import[^;]*editor-spalten-reiter/.test(editorPageQuelle),
		"A2: und NICHT über einen @import in editor-page.css");
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
