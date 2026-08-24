/**
 * Das Sammelmenü im Menüband — Verhalten und Einmaligkeit.
 *
 * 🔴 Der teuerste Fehler dieses Bauteils ist NICHT „es klappt nicht auf", sondern „der Handler ist
 * zweimal da": dann öffnet der erste und schließt der zweite im selben Klick, für den Benutzer
 * passiert nichts, und jede einzelne Zeile sieht richtig aus (live passiert am 23.08.2026).
 * Deshalb ist Teil 4 der Kern dieser Datei.
 */

"use strict";

const assert = require("assert");
const path = require("path");

let fehler = 0;
function pruefe(bedingung, name) {
	if (bedingung) return;
	fehler++;
	console.error("FEHLER: " + name);
}

// ---- Ein Mini-DOM, gerade so viel wie das Bauteil anfasst -------------------------------------
// ⚠️ Bewusst kein jsdom: die Editorseiten laden das Bauteil abhängigkeitsfrei, und ein Test, der
// eine Bibliothek braucht, die das Produkt nicht hat, misst etwas anderes als das Produkt.
function macheElement(name) {
	return {
		nodeName: name,
		hidden: false,
		attribute: {},
		zuhoerer: {},
		setAttribute(schluessel, wert) { this.attribute[schluessel] = String(wert); },
		getAttribute(schluessel) { return Object.prototype.hasOwnProperty.call(this.attribute, schluessel) ? this.attribute[schluessel] : null; },
		addEventListener(art, fn) { (this.zuhoerer[art] = this.zuhoerer[art] || []).push(fn); },
		/** @returns {number} wie viele Zuhörer die Nachricht bekommen haben */
		feuere(art, ereignis) {
			const liste = this.zuhoerer[art] || [];
			for (const fn of liste) fn(ereignis || {});
			return liste.length;
		},
	};
}

const dokument = macheElement("#document");
global.document = {
	_nachId: {},
	getElementById(id) { return this._nachId[id] || null; },
	addEventListener: dokument.addEventListener.bind(dokument),
	feuere: dokument.feuere.bind(dokument),
	zuhoerer: dokument.zuhoerer,
};
global.window = {};

const { avesmapsRibbonMenuAttach, avesmapsRibbonMenuAttachById } =
	require(path.join(__dirname, "..", "ribbon-menu.js"));

function neuesPaar(offen) {
	const knopf = macheElement("BUTTON");
	const panel = macheElement("DIV");
	panel.hidden = !offen;
	return { knopf, panel };
}
function klickEreignis() {
	let gestoppt = false;
	return { stopPropagation() { gestoppt = true; }, get gestoppt() { return gestoppt; } };
}

// ---- 1. Fehlende Elemente sind kein Absturz ---------------------------------------------------
// ⚠️ Ein Editor, der das Menü (noch) nicht hat, ruft dasselbe Skript auf. `$('x').onclick = …` ohne
// Fragezeichen war im Territorien-Editor schon einmal ein TypeError beim Laden, der die ganze Seite
// mitnahm (AGENTS.md, Wappen-Menü Teil 9).
pruefe(avesmapsRibbonMenuAttach(null, macheElement("DIV")) === null, "ohne Knopf: null statt Wurf");
pruefe(avesmapsRibbonMenuAttach(macheElement("BUTTON"), null) === null, "ohne Panel: null statt Wurf");

// ---- 2. Auf, zu, und aria-expanded sagt dasselbe ----------------------------------------------
{
	const { knopf, panel } = neuesPaar(false);
	const menue = avesmapsRibbonMenuAttach(knopf, panel);
	pruefe(menue !== null, "die Steuerung kommt zurück");
	pruefe(knopf.getAttribute("aria-expanded") === "false", "im Ruhezustand meldet aria-expanded false");

	knopf.feuere("click", klickEreignis());
	pruefe(panel.hidden === false, "der erste Klick öffnet");
	pruefe(knopf.getAttribute("aria-expanded") === "true", "offen meldet aria-expanded true");

	knopf.feuere("click", klickEreignis());
	pruefe(panel.hidden === true, "der zweite Klick schließt");
	pruefe(knopf.getAttribute("aria-expanded") === "false", "geschlossen meldet aria-expanded false wieder");
}

// ---- 3. Der Zustand IST das hidden-Attribut ---------------------------------------------------
// 💣 Kein Modulzustand daneben: wer `hidden` von außen setzt, hat den Stand geändert -- und das
// Bauteil darf ihn nicht aus einer eigenen Variable überschreiben. Genau daran ist das
// Anzeige-Menü der Karte gescheitert (Klasse statt Wahrheit gelesen).
{
	const { knopf, panel } = neuesPaar(false);
	const menue = avesmapsRibbonMenuAttach(knopf, panel);
	panel.hidden = false;                       // von außen geöffnet
	pruefe(menue.istOffen() === true, "istOffen liest das Panel, nicht sich selbst");
	knopf.feuere("click", klickEreignis());
	pruefe(panel.hidden === true, "der Klick schließt das von außen geöffnete Menü");
}

// ---- 4. DER KERN: kein Handler zweimal --------------------------------------------------------
{
	const { knopf, panel } = neuesPaar(false);
	const erste = avesmapsRibbonMenuAttach(knopf, panel);
	const zweite = avesmapsRibbonMenuAttach(knopf, panel);
	pruefe(erste === zweite, "DER KERN VON TEIL 4: ein zweiter Aufruf liefert dieselbe Steuerung");
	pruefe((knopf.zuhoerer.click || []).length === 1,
		"DER KERN VON TEIL 4: der Knopf trägt genau EINEN Klick-Handler, nicht zwei");
	// Und die Wirkung, die der doppelte Handler live zerstört hat: EIN Klick öffnet.
	knopf.feuere("click", klickEreignis());
	pruefe(panel.hidden === false, "nach zwei Anmeldungen öffnet ein Klick trotzdem");
}

// ---- 5. Der Klick ins Panel schließt nicht ----------------------------------------------------
// ⚠️ Sonst schließt jeder Schalterdruck das Menü, und man kann nicht zwei Dinge hintereinander tun.
{
	const { knopf, panel } = neuesPaar(true);
	avesmapsRibbonMenuAttach(knopf, panel);
	const ereignis = klickEreignis();
	panel.feuere("click", ereignis);
	pruefe(ereignis.gestoppt === true, "der Klick ins Panel wird gestoppt");
	pruefe(panel.hidden === false, "und das Menü bleibt offen");
}

// ---- 6. Klick daneben und Escape schließen ----------------------------------------------------
{
	const { knopf, panel } = neuesPaar(true);
	avesmapsRibbonMenuAttach(knopf, panel);
	global.document.feuere("click", klickEreignis());
	pruefe(panel.hidden === true, "ein Klick irgendwo sonst schließt");

	panel.hidden = false;
	global.document.feuere("keydown", { key: "Escape" });
	pruefe(panel.hidden === true, "Escape schließt");

	panel.hidden = false;
	global.document.feuere("keydown", { key: "a" });
	pruefe(panel.hidden === false, "eine andere Taste schließt NICHT");
}

// ---- 7. Der Knopfklick stoppt die Ausbreitung -------------------------------------------------
// 💣 Ohne stopPropagation schlägt derselbe Klick auf `document` durch und schließt, was er gerade
// geöffnet hat -- das Menü ginge nie auf, und im Code sähe jede Zeile richtig aus.
{
	const { knopf, panel } = neuesPaar(false);
	avesmapsRibbonMenuAttach(knopf, panel);
	const ereignis = klickEreignis();
	knopf.feuere("click", ereignis);
	pruefe(ereignis.gestoppt === true, "DER KERN VON TEIL 7: der Knopfklick stoppt die Ausbreitung");
}

// ---- 8. Der Weg über IDs ----------------------------------------------------------------------
{
	const knopf = macheElement("BUTTON"), panel = macheElement("DIV");
	panel.hidden = true;
	global.document._nachId = { kKnopf: knopf, kPanel: panel };
	const menue = avesmapsRibbonMenuAttachById("kKnopf", "kPanel");
	pruefe(menue !== null, "über IDs kommt eine Steuerung");
	menue.oeffne();
	pruefe(panel.hidden === false, "oeffne() öffnet");
	menue.schliesse();
	pruefe(panel.hidden === true, "schliesse() schließt");
	pruefe(avesmapsRibbonMenuAttachById("gibtEsNicht", "kPanel") === null, "unbekannte ID: null statt Wurf");
}

// ---- 9. Das Bauteil bleibt abhängigkeitsfrei --------------------------------------------------
// 🔴 Es wird von eigenständigen iframe-Dokumenten geladen, die das Rüstzeug des Hauptfensters NICHT
// haben. Ein `require`/`import` oder ein Griff nach einer Projekt-Globalen macht es dort unbrauchbar
// -- und zwar erst zur Laufzeit, im Browser, ohne dass ein Test etwas merkt.
{
	const fs = require("fs");
	const quelle = fs.readFileSync(path.join(__dirname, "..", "ribbon-menu.js"), "utf8");
	const ohneKommentare = quelle.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
	pruefe(!/\brequire\s*\(/.test(ohneKommentare.replace(/module\.exports[\s\S]*$/, "")),
		"kein require im Browser-Pfad");
	pruefe(!/\bimport\s/.test(ohneKommentare), "kein import");
	for (const global of ["escapeHtml", "jQuery", "\\$\\(", "avesmapsApi"]) {
		pruefe(!new RegExp(global).test(ohneKommentare), "keine Projekt-Globale: " + global);
	}
}

if (fehler === 0) console.log("OK: ribbon-menu -- alle Zusicherungen gehalten");
else { console.error(fehler + " Zusicherung(en) gebrochen"); process.exit(1); }
