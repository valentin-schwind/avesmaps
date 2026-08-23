'use strict';

/**
 * Das Wappen-Menue in BEIDEN Editoren, gemessen gegen das abgenommene Mockup
 * (docs/wappen-verwaltung-mockup.html, 23.08.2026). Lauf:
 *   node js/pages/__tests__/wappen-menue-verdrahtung.test.js
 *
 * 🔴 WARUM ES DIESEN TEST GIBT. Das Mockup versprach ZWEI Schalter („Lokale Wappen" /
 * „Wiki-Wappen"); gebaut wurde zuerst EINER, dazu ein Eintrag, den das Mockup gar nicht kennt.
 * Der Owner hat sich darauf verlassen, dass ein abgenommenes Mockup gebaut wird, wie es dasteht.
 * Es ist der Vertrag -- und ein Vertrag, den niemand nachmisst, ist bloss eine Absicht.
 *
 * ⚠️ Was ein Datei-Test NICHT beantwortet: ob das Menue unter seinem Knopf steht, ob es aufgeht,
 * und wie es in hell/dunkel wirkt. Das gehoert in den Browser.
 */

const fs = require('fs');
const path = require('path');

const WURZEL = path.join(__dirname, '..', '..', '..');
const lies = (p) => fs.readFileSync(path.join(WURZEL, p), 'utf8');

const ORTE = lies('html/wiki-sync-settlement-editor.html');
const TERRITORIEN = lies('html/wiki-sync-monitor.html');
const CSS = lies('css/components/editor-page.css');
const BEIDE = [['Ortseditor', ORTE], ['Territorien-Editor', TERRITORIEN]];

let fehler = 0;
function pruefe(bedingung, was) {
	if (bedingung) return;
	console.error('FEHLER: ' + was);
	fehler++;
}

// ---- 1. DER VERTRAG: drei Zeilen, in dieser Reihenfolge, in BEIDEN Oberflaechen ----------------
// 🔴 Genau die drei aus dem Mockup. Ein vierter Eintrag darf dazukommen, aber diese drei muessen
// da sein und in dieser Ordnung stehen.
const MOCKUP_ZEILEN = ['Lokale Wappen', 'Wiki-Wappen', 'Hole Wiki-Wappen'];
// 🔴 Der Ortsbilder-Schalter kam am 24.08.2026 dazu (Owner) und steht ZWISCHEN den Wappen-Schaltern
// und dem Lauf -- die drei Notaus-Schalter beieinander, die Handlung darunter.
pruefe(ORTE.includes('<b>Ortsbilder</b>'), 'Ortseditor: die Zeile „Ortsbilder" fehlt im Menue');
pruefe(ORTE.indexOf('<b>Ortsbilder</b>') > ORTE.indexOf('<b>Wiki-Wappen</b>')
	&& ORTE.indexOf('<b>Ortsbilder</b>') < ORTE.indexOf('<b>Hole Wiki-Wappen</b>'),
	'Ortseditor: „Ortsbilder" steht zwischen den Schaltern und dem Lauf');
pruefe(!TERRITORIEN.includes('<b>Ortsbilder</b>'),
	'Territorien-Editor: kein Ortsbilder-Schalter -- dort gaebe es nichts zu schalten');
for (const [name, html] of BEIDE) {
	const stellen = MOCKUP_ZEILEN.map((z) => html.indexOf('<b>' + z + '</b>'));
	MOCKUP_ZEILEN.forEach((z, i) => pruefe(stellen[i] > -1, `${name}: die Mockup-Zeile „${z}" fehlt`));
	pruefe(stellen[0] > -1 && stellen[0] < stellen[1] && stellen[1] < stellen[2],
		`DER KERN VON TEIL 1 (${name}): die drei Zeilen stehen in der Reihenfolge des Mockups`);
}

// ---- 2. ZWEI Schalter, nicht einer ------------------------------------------------------------
// 🪤 Das war die Abweichung, die der Owner beanstandet hat. Ein einzelner Schalter waere hier
// wieder „vereinfacht" -- und diese Zusicherung ist die einzige Stelle, die das bemerkt.
const SCHALTER = [
	['Ortseditor', ORTE, 'seCoatsLocal', 'seCoatsWiki'],
	['Territorien-Editor', TERRITORIEN, 'btnCoatsLocal', 'btnCoatsWiki'],
];
for (const [name, html, lokalId, wikiId] of SCHALTER) {
	pruefe(html.includes(`id="${lokalId}" data-which="local"`), `${name}: der Schalter „lokal" fehlt`);
	pruefe(html.includes(`id="${wikiId}" data-which="wiki"`), `${name}: der Schalter „Wiki" fehlt`);
	for (const id of [lokalId, wikiId]) {
		// Beide haengen am SELBEN Handler -- zwei Fassungen desselben Klicks liefen auseinander.
		pruefe(html.includes(`$('${id}')?.addEventListener('click', toggleCoatSwitch)`)
			|| html.includes(`$("${id}")?.addEventListener("click", toggleCoatSwitch)`),
			`${name}: ${id} ist nicht mit toggleCoatSwitch verdrahtet`);
	}
	// 🔴 EIN Endpunkt fuer beide Objektarten: die Schalter gelten gemeinsam. Ein Notaus fuer
	// rechtliche Fragen, der nur die Haelfte abschaltet, ist keiner.
	pruefe(html.includes("'set_coat_switch'") || html.includes('"set_coat_switch"'),
		`${name}: ruft nicht die gemeinsame Aktion set_coat_switch`);
}

// ---- 3. Der Knopf zeigt BEIDE Stellungen ------------------------------------------------------
// 🔴 Mockup: „lokal an · Wiki aus". Ein Notaus, dessen Stand man aufklappen muss, ist keiner.
for (const [name, html] of BEIDE) {
	pruefe(html.includes('· Wiki ') && html.includes('lokal ${'),
		`DER KERN VON TEIL 3 (${name}): die Unterzeile des Knopfes nennt beide Schalterstellungen`);
}

// ---- 4. aria-pressed heisst AN ----------------------------------------------------------------
// 💣 BEIDE Editoren hatten es INVERTIERT ("true" == aus). Jede CSS-Regel und jeder Screenreader
// daran sagt dann das Gegenteil -- und das CSS faerbt den Zustand jetzt.
for (const [name, html] of BEIDE) {
	pruefe(/aria-pressed['"],\s*an \? ['"]true['"] : ['"]false['"]/.test(html),
		`DER KERN VON TEIL 4 (${name}): aria-pressed="true" heisst EINGESCHALTET`);
}

// ---- 5. „Wappen lokalisieren" ist aus beiden Baendern verschwunden -----------------------------
// 🔴 Owner: „‚Wappen lokalisieren' soll nicht mehr im Menüband auftauchen."
for (const [name, html] of BEIDE) {
	const von = html.indexOf('<div class="controls">');
	const bis = html.indexOf('</header>');
	pruefe(von > -1 && bis > von, `${name}: das Menueband ist auffindbar`);
	// ⚠️ HTML-Kommentare raus, BEVOR gesucht wird -- sonst schlaegt der Test auf der Erklaerung an,
	// die beschreibt, warum der Knopf weg ist. (Beim ersten Lauf genau so passiert.)
	const band = html.slice(von, bis).replace(/<!--[\s\S]*?-->/g, '');
	pruefe(!band.includes('>Wappen lokalisieren<'),
		`${name}: „Wappen lokalisieren" steht wieder als eigener Knopf im Band`);
	// ⚠️ Der Ortseditor heisst „Wappen & Bilder", der Monitor „Wappen" -- der Bilder-Schalter gilt
	// NUR Orten, im Monitor gaebe es nichts zu schalten. Das ist ein Feld, das die eine Oberflaeche
	// nicht hat, keine Divergenz der Bauform.
	pruefe(/Wappen (&amp; Bilder )?▾/.test(band), `${name}: der Sammelknopf „Wappen ▾" fehlt im Band`);
	pruefe(!band.includes('>Bilder: An<') && !band.includes('Bilder: An</span>'),
		`${name}: der Bilder-Schalter steht wieder als eigener Knopf im Band`);
}

// ---- 6. Die Huelle fuellt ihre Gitterspalte ---------------------------------------------------
// 💣 `.controls` ist ein GRID mit `grid-auto-columns: minmax(0,1fr)`. Die Huelle war von
// `.type-filter` abgeschrieben, dessen Wirt eine FLEX-Werkzeugleiste ist; dort ist `flex: 0 0 auto`
// richtig. Hier schrumpfte der Knopf dadurch auf seine Textbreite und liess den Rest der Spalte
// leer -- eine Luecke im Band, die der Owner im Bild markieren musste, weil kein Test sie sah.
// ⚠️ Wer eine Rezeptur abschreibt, muss ihren WIRT mitpruefen.
for (const [name, html] of BEIDE) {
	pruefe(/\.controls\s*\{[^}]*grid-auto-columns\s*:\s*minmax\(0\s*,\s*1fr\)/.test(html),
		`${name}: der Wirt .controls ist noch ein Grid mit gleich breiten Spalten`);
}
pruefe(/\.rb-menu\s*>\s*\.btn2\s*\{[^}]*width:\s*100%/.test(CSS),
	'DER KERN VON TEIL 6: der Knopf in der Huelle fuellt seine Gitterspalte');
const huelle = CSS.slice(CSS.indexOf('.rb-menu {'), CSS.indexOf('.rb-menu__panel'));
pruefe(!/flex:\s*0\s+0\s+auto/.test(huelle),
	'die Huelle traegt kein `flex: 0 0 auto` mehr -- das war die Ursache der Luecke');

// ---- 7. Die Optik der zwei Schalter, wie im Mockup --------------------------------------------
// 🔴 Pillenform mit FARBRAND (gruen AN / Warnfarbe AUS), keine Fuellung. ⚠️ Das ist die begruendete
// Ausnahme zu „no pill shapes" (AGENTS.md §12): jene Regel gilt Knoepfen, die etwas AUSLOESEN --
// diese zwei sind Zustandsanzeigen, und die eckigen „starten"/„prüfen" daneben trennen beides.
const pille = CSS.slice(CSS.indexOf('.rb-menu__sw--state'));
pruefe(/border-radius:\s*999px/.test(pille), 'DER KERN VON TEIL 7: die Schalter sind Pillen wie im Mockup');
pruefe(/aria-pressed="true"\]\s*\{[^}]*--color-success/.test(pille), 'AN traegt die Erfolgsfarbe');
pruefe(/aria-pressed="false"\]\s*\{[^}]*--color-warning/.test(pille), 'AUS traegt die Warnfarbe');
// 💣 Tokens, keine Hexwerte -- das Mockup schreibt #7d8f4a/#cfe08e direkt hin, was im hellen Thema
// nicht traegt (AGENTS.md §12: nie eine Farbe hartkodieren).
pruefe(!/#[0-9a-fA-F]{3,6}\b/.test(pille.slice(0, 700)),
	'die Schalterfarben kommen aus Tokens, nicht als Hexwert aus dem Mockup');

// ---- 8. Das Panel teilt die vorhandene Menue-Optik --------------------------------------------
// ⚠️ Eine dritte Menue-Rezeptur waere genau die Divergenz, die AGENTS.md fuer Listenzeilen schon
// zweimal beschreibt.
for (const [name, html] of BEIDE) {
	pruefe(html.includes('class="rb-menu__panel type-filter__menu"'),
		`${name}: das Panel benutzt die vorhandene Menue-Optik, statt eine neue zu erfinden`);
}

// ---- 9. Keine toten Kennungen ------------------------------------------------------------------
// 💣 Eine Kennung nur im Markup ist ein toter Knopf; eine nur im Skript ist ein `$()` auf null.
// Beides faellt im Browser NICHT auf -- es passiert nur nichts. 🪤 Und `$('x').onclick = …` OHNE
// Fragezeichen ist schlimmer: ein TypeError beim Laden, der die ganze Seite mitnimmt. Genau das
// stand nach dem Umbau kurz im Territorien-Editor.
const KENNUNGEN = [
	['Ortseditor', ORTE, ['seCoatsMenu', 'seCoatsMenuPanel', 'seCoatsMenuState', 'seCoatsLocal',
		'seCoatsWiki', 'seLocalizeCoats', 'seLocalizeCoatsState', 'seCleanupCoats', 'seCleanupCoatsState']],
	['Territorien-Editor', TERRITORIEN, ['btnCoatsMenu', 'btnCoatsMenuPanel', 'stCoatsMenuState',
		'btnCoatsLocal', 'btnCoatsWiki', 'btnLocalizeCoats', 'stLocalize']],
];
for (const [name, html, ids] of KENNUNGEN) {
	for (const id of ids) {
		pruefe(html.includes(`id="${id}"`), `${name}: ${id} fehlt im Markup`);
		pruefe(html.includes(`$('${id}')`) || html.includes(`$("${id}")`),
			`${name}: ${id} wird im Skript nie nachgeschlagen`);
	}
	pruefe(!html.includes("$('btnCoatsToggle')") && !html.includes('$("seCoatsToggle")'),
		`${name}: der entfernte Einzelschalter wird nirgends mehr angefasst`);
}

// ---- 9b. JEDES EINMAL, NICHT ZWEIMAL ----------------------------------------------------------
// 🔴 GENAU DAS HAT DAS MENÜ LIVE UNBRAUCHBAR GEMACHT (23.08.2026, vom Owner gemeldet): beim Umbau
// blieb der alte Auf-/Zuklapp-Block stehen und der neue kam dazu. Zwei `function setCoatsMenuOpen`
// sind gültiges JavaScript -- die zweite gewinnt --, aber der Klick-Handler war damit ZWEIMAL
// registriert: der erste öffnete das Menü, der zweite schloss es im selben Klick wieder. Für den
// Benutzer passiert nichts, und im Code sieht jede einzelne Zeile richtig aus.
//
// 💣 Teil 2 und 9 prüfen, DASS verdrahtet ist -- nicht, WIE OFT. Eine Anwesenheitsprüfung kann eine
// Verdopplung grundsätzlich nicht sehen; sie braucht eine eigene Zusicherung.
const EINMALIG = [
	['Ortseditor', ORTE, [
		'function setCoatsSwitchStates', 'function setCoatsMenuOpen', 'async function toggleCoatSwitch',
		'$("seCoatsMenu")?.addEventListener', '$("seCoatsMenuPanel")?.addEventListener',
		'$("seCoatsLocal")?.addEventListener', '$("seCoatsWiki")?.addEventListener',
		'$("seImagesToggle")?.addEventListener', 'function renderCoatsMenuState',
	]],
	['Territorien-Editor', TERRITORIEN, [
		'function setCoatsSwitchStates', 'function setCoatsMenuOpen', 'async function toggleCoatSwitch',
		"$('btnCoatsMenu')?.addEventListener", "$('btnCoatsMenuPanel')?.addEventListener",
		"$('btnCoatsLocal')?.addEventListener", "$('btnCoatsWiki')?.addEventListener",
	]],
];
for (const [name, html, stellen] of EINMALIG) {
	for (const stelle of stellen) {
		const anzahl = html.split(stelle).length - 1;
		pruefe(anzahl === 1,
			`DER KERN VON TEIL 9b (${name}): „${stelle}" kommt ${anzahl}x vor, erwartet genau 1x. `
			+ 'Zwei Klick-Handler am selben Knopf heben sich gegenseitig auf.');
	}
}

// ⚠️ Und die Aussenklick-Wache genau einmal je Dokument: zweimal registriert schliesst sie das
// Menü, das der andere Handler gerade geöffnet hat.
for (const [name, html] of BEIDE) {
	const wachen = (html.match(/document\.addEventListener\(['"]click['"], \(\) => setCoatsMenuOpen\(false\)\)/g) || []).length;
	pruefe(wachen === 1, `${name}: die Aussenklick-Wache ist ${wachen}x registriert, erwartet 1x`);
}

// ---- 10. Der Aufraeum-Lauf fragt, bevor er schreibt --------------------------------------------
// ⚠️ Er steht NICHT im Mockup -- er ist die eine bewusste Zugabe, und der Owner entscheidet, ob er
// dort bleibt. Solange er da ist, gilt seine Regel: erst zeigen, dann fragen, dann schreiben.
const block = ORTE.slice(ORTE.indexOf('async function handleSeCleanupCoatsClick'));
const vorschau = block.indexOf('cleanup_coats');
const frage = block.indexOf('window.confirm');
const scharf = block.indexOf('confirm: "apply"');
pruefe(vorschau > -1 && frage > -1 && scharf > -1, 'Vorschau, Rueckfrage und scharfe Fahrt kommen alle vor');
pruefe(vorschau < frage && frage < scharf,
	'DER KERN VON TEIL 10: erst die Vorschau, dann die Rueckfrage, DANN das Schreiben');

if (fehler > 0) {
	console.error(`\n${fehler} Zusicherung(en) verletzt.`);
	process.exit(1);
}
console.log('OK: wappen-menue-verdrahtung -- alle Zusicherungen gehalten');
