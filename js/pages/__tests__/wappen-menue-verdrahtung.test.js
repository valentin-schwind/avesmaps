'use strict';

/**
 * Das Wappen-Menue im Menueband des Ortseditors (Mockup docs/wappen-verwaltung-mockup.html,
 * abgenommen 23.08.2026). Lauf: node js/pages/__tests__/wappen-menue-verdrahtung.test.js
 *
 * 🔴 Gewacht wird die VERDRAHTUNG, nicht das Aussehen: ein Markup ohne Handler sieht im Browser
 * vollkommen richtig aus und tut beim Klick nichts. Genau diese Sorte Knopf stand hier schon einmal
 * monatelang im Band („Wappen lokalisieren", Markup aus Schritt 1, nie verdrahtet).
 * ⚠️ Was ein Datei-Test NICHT beantworten kann: ob das Menue unter seinem Knopf steht und ob es
 * beim Klick wirklich aufgeht. Das gehoert in den Browser -- siehe der Befund „Trichter-Menue
 * braucht den Knopf RECHTS", den kein DOM-Test je gesehen hat.
 */

const fs = require('fs');
const path = require('path');

const DATEI = path.join(__dirname, '..', '..', '..', 'html', 'wiki-sync-settlement-editor.html');
const html = fs.readFileSync(DATEI, 'utf8');

let fehler = 0;
function pruefe(bedingung, was) {
	if (bedingung) return;
	console.error('FEHLER: ' + was);
	fehler++;
}

// ---- 1. Jede Kennung steht im Markup UND wird im Skript benutzt -------------------------------
// 💣 Eine Kennung, die nur im Markup steht, ist ein toter Knopf; eine, die nur im Skript steht,
// ist ein `$()` auf null -- beides faellt im Browser NICHT auf, es passiert nur nichts.
const KENNUNGEN = [
	'seCoatsMenu', 'seCoatsMenuPanel', 'seCoatsMenuState',
	'seCoatsToggle', 'seLocalizeCoats', 'seLocalizeCoatsState',
	'seCleanupCoats', 'seCleanupCoatsState',
];
for (const id of KENNUNGEN) {
	pruefe(html.includes(`id="${id}"`), `${id} fehlt im Markup`);
	pruefe(html.includes(`$("${id}")`), `${id} wird im Skript nie nachgeschlagen`);
}

// ---- 2. Die drei Handlungen haengen an einem Klick --------------------------------------------
const KLICKS = [
	['seCoatsToggle', 'toggleSettlementCoatsEnabled'],
	['seLocalizeCoats', 'handleSeLocalizeCoatsClick'],
	['seCleanupCoats', 'handleSeCleanupCoatsClick'],
];
for (const [id, fn] of KLICKS) {
	pruefe(
		html.includes(`$("${id}")?.addEventListener("click", ${fn})`),
		`DER KERN VON TEIL 2: ${id} ist nicht mit ${fn} verdrahtet`
	);
	pruefe(new RegExp(`function ${fn}\\b`).test(html), `${fn} ist gar nicht definiert`);
}

// ---- 3. Der Aufraeum-Lauf FRAGT, bevor er schreibt --------------------------------------------
// 🔴 Die Regel dahinter ist eine Heuristik. Ein Lauf, der beim ersten Klick loescht, ist die
// Falle, gegen die die ganze Vorschau gebaut ist.
const block = html.slice(html.indexOf('async function handleSeCleanupCoatsClick'));
const ersterAufruf = block.indexOf('cleanup_coats');
const bestaetigung = block.indexOf('window.confirm');
const scharferAufruf = block.indexOf('confirm: "apply"');
pruefe(ersterAufruf > -1 && bestaetigung > -1 && scharferAufruf > -1,
	'Vorschau, Rueckfrage und scharfe Fahrt muessen alle drei vorkommen');
pruefe(ersterAufruf < bestaetigung && bestaetigung < scharferAufruf,
	'DER KERN VON TEIL 3: erst die Vorschau, dann die Rueckfrage, DANN das Schreiben');

// ⚠️ Die Rueckfrage muss die betroffenen Dateien NENNEN. Eine blosse Zahl kann niemand pruefen,
// und dann ist die Vorschau nur eine Beruhigung.
const frage = block.slice(bestaetigung - 1400, bestaetigung);
pruefe(frage.includes('e.ort') && frage.includes('e.datei'),
	'die Rueckfrage nennt Ortsname und Dateiname, nicht nur eine Anzahl');

// 🪤 Und sie sagt, dass die Regel irren kann. Ohne diesen Satz liest sich die Liste wie ein Befund.
pruefe(/fälschlich|irren|kann.*falsch/i.test(frage),
	'die Rueckfrage sagt, dass ein echtes Wappen faelschlich in der Liste stehen kann');

// ---- 4. aria-pressed heisst AN ----------------------------------------------------------------
// 💣 Die alte Fassung hatte es INVERTIERT -- `aria-pressed="true"` stand fuer „aus". Jede CSS-Regel
// und jeder Screenreader, der daran haengt, sagt dann das Gegenteil des Zustands.
const schalter = html.slice(html.indexOf('function setCoatsToggleState'), html.indexOf('async function toggleSettlementCoatsEnabled'));
pruefe(/aria-pressed",\s*enabled \? "true" : "false"/.test(schalter),
	'DER KERN VON TEIL 4: aria-pressed="true" heisst EINGESCHALTET');

// ---- 5. „Wappen lokalisieren" ist aus dem Band verschwunden -----------------------------------
// 🔴 Owner 23.08.2026: „‚Wappen lokalisieren‘ soll nicht mehr im Menüband auftauchen."
const bandStart = html.indexOf('<div class="controls">');
const bandEnde = html.indexOf('</header>');
// ⚠️ HTML-Kommentare raus, bevor gesucht wird -- sonst schlaegt der Test auf der Erklaerung an,
// die genau beschreibt, warum der Knopf weg ist. (Beim ersten Lauf genau so passiert.)
const band = html.slice(bandStart, bandEnde).replace(/<!--[\s\S]*?-->/g, '');
pruefe(!/<button[^>]*>[^<]*<span class="t1">Wappen lokalisieren/.test(band)
	&& !band.includes('>Wappen lokalisieren<'),
	'„Wappen lokalisieren" steht wieder als eigener Knopf im Band');
pruefe(band.includes('Wappen ▾'), 'der Sammelknopf „Wappen ▾" fehlt im Band');

// ⚠️ Das Panel teilt die Optik des Filtermenues -- eine dritte Menue-Rezeptur waere genau die
// Divergenz, die AGENTS.md fuer Listenzeilen schon zweimal beschreibt.
pruefe(html.includes('class="rb-menu__panel type-filter__menu"'),
	'das Panel benutzt die vorhandene Menue-Optik, statt eine neue zu erfinden');

// ---- 6. Die Huelle fuellt ihre Gitterspalte ---------------------------------------------------
// 💣 `.controls` ist ein GRID mit `grid-auto-columns: minmax(0,1fr)` -- jede Kachel bekommt eine
// gleich breite Spalte. Die Huelle war von `.type-filter` abgeschrieben, dessen Wirt eine
// FLEX-Werkzeugleiste ist; dort ist `flex: 0 0 auto` richtig. Hier schrumpfte der Knopf dadurch
// auf seine Textbreite und liess den Rest der Spalte leer -- eine Luecke im Band, die der Owner
// im Bild markieren musste, weil kein Test sie sah (23.08.2026).
// ⚠️ Wer eine Rezeptur abschreibt, muss ihren WIRT mitpruefen. Diese Zusicherung ist die einzige
// Stelle, an der das Paar (Grid-Wirt / fuellendes Kind) zusammen aufgeschrieben ist.
const editorCss = fs.readFileSync(
	path.join(__dirname, '..', '..', '..', 'css', 'components', 'editor-page.css'), 'utf8');

pruefe(/\.controls\s*\{[^}]*grid-auto-columns\s*:\s*minmax\(0\s*,\s*1fr\)/.test(html),
	'der Wirt .controls ist noch ein Grid mit gleich breiten Spalten -- '
	+ 'aendert sich das, gehoert die Regel darunter geprueft');
pruefe(/\.rb-menu\s*>\s*\.btn2\s*\{[^}]*width:\s*100%/.test(editorCss),
	'DER KERN VON TEIL 6: der Knopf in der Huelle fuellt seine Gitterspalte');

// 🪤 Und das `flex: 0 0 auto` der Vorlage darf NICHT zurueckkommen -- es ist genau der Wert, der
// die Luecke gemacht hat.
const huelle = editorCss.slice(editorCss.indexOf('.rb-menu {'), editorCss.indexOf('.rb-menu__panel'));
pruefe(!/flex:\s*0\s+0\s+auto/.test(huelle),
	'die Huelle traegt kein `flex: 0 0 auto` mehr -- das war die Ursache der Luecke');

if (fehler > 0) {
	console.error(`\n${fehler} Zusicherung(en) verletzt.`);
	process.exit(1);
}
console.log('OK: wappen-menue-verdrahtung -- alle Zusicherungen gehalten');
