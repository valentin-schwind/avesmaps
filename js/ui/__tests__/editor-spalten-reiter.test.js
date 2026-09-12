/**
 * Aus Spalten werden Reiter — das Bauteil, wirklich gefahren.
 *
 * Abnahmeliste des Entwurfs
 * (docs/superpowers/specs/2026-09-12-sync-monitor-am-telefon-design.md):
 * A1 · A2 · A3 · A5 · A6 · A7 werden hier geprüft; A4 und die CSS-Zusicherungen stehen in
 * `editor-spalten-reiter-verdrahtung.test.js`.
 *
 * 🔴 DER KERN IST A6: versteckt wird per KLASSE, nie per `hidden`. `[hidden]{display:none
 * !important}` gilt in JEDER Breite — mit `hidden` wären die zwei anderen Spalten auch am
 * 1400px-Fenster weg, und ein `!important` nimmt keine Media-Query zurück. Der Fehler ist dabei
 * STILL: am Telefon sieht alles richtig aus, kaputt ist der Desktop.
 *
 * ⚠️ Bewusst kein jsdom: die Editorseiten laden das Bauteil abhängigkeitsfrei, und ein Test, der
 * eine Bibliothek braucht, die das Produkt nicht hat, misst etwas anderes als das Produkt
 * (dieselbe Entscheidung wie in ribbon-menu.test.js daneben).
 */

"use strict";

const path = require("path");

let fehler = 0;
function pruefe(bedingung, name) {
	if (bedingung) return;
	fehler++;
	console.error("FEHLER: " + name);
}

// ---- Ein Mini-DOM, gerade so viel wie das Bauteil anfasst -------------------------------------
function macheElement(name) {
	const element = {
		nodeName: name,
		nodeType: 1,
		hidden: false,
		type: "",
		textContent: "",
		className: "",
		dataset: {},
		children: [],
		parentNode: null,
		attribute: {},
		zuhoerer: {},
		klassen: new Set(),
		setAttribute(schluessel, wert) { this.attribute[schluessel] = String(wert); },
		getAttribute(schluessel) {
			return Object.prototype.hasOwnProperty.call(this.attribute, schluessel) ? this.attribute[schluessel] : null;
		},
		addEventListener(art, fn) { (this.zuhoerer[art] = this.zuhoerer[art] || []).push(fn); },
		feuere(art, ereignis) {
			const liste = this.zuhoerer[art] || [];
			for (const fn of liste) fn(ereignis || {});
			return liste.length;
		},
		appendChild(kind) { this.children.push(kind); kind.parentNode = this; return kind; },
		insertBefore(kind, vor) {
			const stelle = this.children.indexOf(vor);
			this.children.splice(stelle < 0 ? this.children.length : stelle, 0, kind);
			kind.parentNode = this;
			return kind;
		},
		contains(anderes) {
			if (anderes === this) return true;
			return this.children.some((kind) => kind.contains && kind.contains(anderes));
		},
		querySelector(selektor) {
			// Nur das, was das Bauteil fragt: "h1, h2, h3".
			const gesucht = selektor.split(",").map((teil) => teil.trim().toUpperCase());
			for (const kind of this.children) {
				if (gesucht.includes(kind.nodeName)) return kind;
				const tiefer = kind.querySelector ? kind.querySelector(selektor) : null;
				if (tiefer) return tiefer;
			}
			return null;
		},
	};
	element.classList = {
		add: (klasse) => element.klassen.add(klasse),
		remove: (klasse) => element.klassen.delete(klasse),
		contains: (klasse) => element.klassen.has(klasse),
		toggle: (klasse, an) => {
			if (an === undefined) { return element.klassen.has(klasse) ? (element.klassen.delete(klasse), false) : (element.klassen.add(klasse), true); }
			if (an) { element.klassen.add(klasse); } else { element.klassen.delete(klasse); }
			return an;
		},
	};
	return element;
}

let reiterLeisteSichtbar = true;   // die gerechnete Sichtbarkeit, die `wirkt()` liest
global.document = {
	createElement: (name) => macheElement(name.toUpperCase()),
	querySelector: () => null,
};
global.window = {
	getComputedStyle: () => ({ display: reiterLeisteSichtbar ? "flex" : "none" }),
};

const { avesmapsSpaltenReiterAttach, avesmapsSpaltenReiter } =
	require(path.join(__dirname, "..", "editor-spalten-reiter.js"));

function neuerWirt(anzahl, kurznamen) {
	const huelle = macheElement("DIV");
	const wirt = macheElement("DIV");
	huelle.appendChild(wirt);
	for (let i = 0; i < anzahl; i += 1) {
		const spalte = macheElement("DIV");
		if (kurznamen && kurznamen[i]) spalte.dataset.reiter = kurznamen[i];
		const kopf = macheElement("H2");
		kopf.textContent = "Lange Überschrift " + (i + 1);
		spalte.appendChild(kopf);
		wirt.appendChild(spalte);
	}
	return wirt;
}

// ---- 1) A1: eine Leiste, und genau EINE Spalte ist an ----------------------------------------
{
	reiterLeisteSichtbar = true;
	const wirt = neuerWirt(3, ["Lücken", "Modell", "Details"]);
	const steuerung = avesmapsSpaltenReiterAttach(wirt);
	pruefe(steuerung !== null, "A1: drei Spalten ergeben eine Steuerung");
	pruefe(steuerung.knoepfe.length === 3, "A1: drei Reiter für drei Spalten");
	const aus = steuerung.spalten.filter((s) => s.classList.contains("avm-spalte-aus"));
	pruefe(aus.length === 2, "A1: zwei von drei Spalten sind abgewählt");
	pruefe(!steuerung.spalten[0].classList.contains("avm-spalte-aus"), "A1: die erste Spalte ist die aktive");
	pruefe(steuerung.aktiv() === 0, "A1: der Startreiter ist der erste");

	// Der zweite Reiter wird geklickt.
	steuerung.knoepfe[1].feuere("click");
	pruefe(steuerung.aktiv() === 1, "A1: ein Klick schaltet um");
	pruefe(steuerung.spalten[0].classList.contains("avm-spalte-aus"), "A1: die vorige Spalte geht aus");
	pruefe(!steuerung.spalten[1].classList.contains("avm-spalte-aus"), "A1: die geklickte Spalte kommt an");
	pruefe(steuerung.knoepfe[1].classList.contains("is-active"), "A1: der geklickte Reiter ist aktiv");
	pruefe(!steuerung.knoepfe[0].classList.contains("is-active"), "A1: der vorige Reiter ist es nicht mehr");
	pruefe(steuerung.knoepfe[1].getAttribute("aria-selected") === "true", "A1: aria-selected folgt");
	pruefe(steuerung.knoepfe[0].getAttribute("aria-selected") === "false", "A1: und zwar in beide Richtungen");
}

// ---- 2) A6: NIE `hidden` ---------------------------------------------------------------------
// 🔴 Die tragende Zusicherung. Mit `hidden` wäre die Spalte in JEDER Breite weg -- das
//    `!important` aus dem Reset nimmt keine Media-Query zurück, und kaputt wäre der DESKTOP.
{
	reiterLeisteSichtbar = true;
	const wirt = neuerWirt(3);
	const steuerung = avesmapsSpaltenReiterAttach(wirt);
	steuerung.zeige(2);
	const mitHidden = steuerung.spalten.filter((s) => s.hidden === true);
	pruefe(mitHidden.length === 0, "A6: keine Spalte wird über `hidden` versteckt");
	pruefe(steuerung.spalten[0].classList.contains("avm-spalte-aus"), "A6: versteckt wird über die Klasse");
	pruefe(steuerung.leiste.hidden === false, "A6: auch die Leiste selbst trägt kein `hidden`");
}

// ---- 3) A3: die Hausform, keine zehnte Rezeptur ------------------------------------------------
{
	reiterLeisteSichtbar = true;
	const wirt = neuerWirt(3, ["Lücken", "Modell", "Details"]);
	const steuerung = avesmapsSpaltenReiterAttach(wirt);
	const klassen = steuerung.leiste.className.split(/\s+/);
	pruefe(klassen.includes("avm-tabs"), "A3: die Leiste trägt die Hausform .avm-tabs");
	pruefe(klassen.includes("avm-spalten-reiter"), "A3: und .avm-spalten-reiter als Sichtbarkeits-Schalter");
	pruefe(steuerung.knoepfe.every((k) => k.className.split(/\s+/).includes("avm-tab")), "A3: jeder Reiter ist ein .avm-tab");
	pruefe(steuerung.knoepfe.every((k) => k.type === "button"), "A3: ein Reiter ist type=button — sonst sendet er ein Formular ab");
	pruefe(steuerung.leiste.getAttribute("role") === "tablist", "A3: die Leiste ist eine tablist");
	// Die Leiste steht VOR dem Wirt, nicht darin: ein Kind von `.cols` wäre eine vierte Flex-Spalte.
	const huelle = steuerung.leiste.parentNode;
	pruefe(huelle.children.indexOf(steuerung.leiste) < huelle.children.indexOf(wirt), "A3: die Leiste steht vor dem Spalten-Wirt");
	pruefe(wirt.children.indexOf(steuerung.leiste) === -1, "A3: und NICHT als vierte Spalte darin");
}

// ---- 4) Die Kurznamen: data-reiter, sonst die Überschrift, sonst eine Zählung ------------------
{
	reiterLeisteSichtbar = true;
	const mitNamen = avesmapsSpaltenReiterAttach(neuerWirt(3, ["Lücken", "Modell", "Details"]));
	pruefe(mitNamen.knoepfe.map((k) => k.textContent).join("|") === "Lücken|Modell|Details", "Kurzname: data-reiter gewinnt");

	const ohneNamen = avesmapsSpaltenReiterAttach(neuerWirt(2));
	pruefe(ohneNamen.knoepfe[0].textContent === "Lange Überschrift 1", "Kurzname: ohne data-reiter die Überschrift");

	const leer = macheElement("DIV");
	const wirtLeer = macheElement("DIV");
	leer.appendChild(wirtLeer);
	wirtLeer.appendChild(macheElement("DIV"));
	wirtLeer.appendChild(macheElement("DIV"));
	const ohneAlles = avesmapsSpaltenReiterAttach(wirtLeer);
	pruefe(ohneAlles.knoepfe[0].textContent === "Spalte 1", "Kurzname: ohne alles eine Zählung — nie ein leerer Reiter");

	// Eine eigene Namensfunktion schlägt beides.
	const eigen = avesmapsSpaltenReiterAttach(neuerWirt(2, ["A", "B"]), { name: (spalte, i) => "N" + i });
	pruefe(eigen.knoepfe.map((k) => k.textContent).join("") === "N0N1", "Kurzname: eine eigene Funktion schlägt data-reiter");
}

// ---- 5) A5: kein Sprung, solange die Reiter nicht wirken ---------------------------------------
// 🔴 `wirkt()` fragt die GERECHNETE Sichtbarkeit der Leiste, nie die Schwellenzahl ein zweites
//    Mal. Eine Kopie der 680 hier liefe beim nächsten Nachjustieren auseinander.
{
	reiterLeisteSichtbar = true;
	const wirt = neuerWirt(3);
	const steuerung = avesmapsSpaltenReiterAttach(wirt);
	pruefe(steuerung.wirkt() === true, "A5: bei sichtbarer Leiste wirken die Reiter");

	reiterLeisteSichtbar = false;
	pruefe(steuerung.wirkt() === false, "A5: bei versteckter Leiste nicht");
	steuerung.zeige(2);
	pruefe(steuerung.aktiv() === 0, "A5: `zeige` tut am breiten Fenster NICHTS");
	// 🪤 Nicht „aktiv() ist noch 0" allein: der Zustand der KLASSEN muss ebenso unberührt sein,
	//    sonst verschiebt ein `zeige` am breiten Fenster still eine Klasse, die dort niemand liest
	//    — und beim nächsten Verkleinern springt das Fenster auf eine Spalte, die keiner wählte.
	pruefe(steuerung.spalten[2].classList.contains("avm-spalte-aus") === true,
		"A5: die angefragte Spalte bleibt dort abgewählt");
	pruefe(steuerung.spalten[0].classList.contains("avm-spalte-aus") === false,
		"A5: und die aktive bleibt aktiv");

	// Der Reiter-KLICK bleibt trotzdem möglich (er geht nicht über `zeige`) -- sonst wäre die Leiste
	// an dem Rand, an dem sie gerade erscheint, für einen Frame tot.
	steuerung.knoepfe[2].feuere("click");
	pruefe(steuerung.aktiv() === 2, "A5: ein echter Reiterklick wirkt immer");

	// Fällt geschlossen aus: ohne getComputedStyle gilt „die Reiter wirken nicht".
	const gemerkt = global.window.getComputedStyle;
	global.window.getComputedStyle = () => { throw new Error("kein Stil"); };
	pruefe(steuerung.wirkt() === false, "A5: ohne getComputedStyle fällt `wirkt` GESCHLOSSEN aus");
	global.window.getComputedStyle = gemerkt;
	reiterLeisteSichtbar = true;
}

// ---- 6) `zeige` findet die Spalte über ein Kind ------------------------------------------------
{
	reiterLeisteSichtbar = true;
	const wirt = neuerWirt(3, ["Lücken", "Modell", "Details"]);
	const steuerung = avesmapsSpaltenReiterAttach(wirt);
	const tiefesKind = macheElement("SPAN");
	steuerung.spalten[2].appendChild(tiefesKind);

	steuerung.zeige(tiefesKind);
	pruefe(steuerung.aktiv() === 2, "zeige: ein Kind der Spalte genügt — genau so ruft selectKey sie");

	steuerung.zeige(steuerung.spalten[1]);
	pruefe(steuerung.aktiv() === 1, "zeige: die Spalte selbst geht auch");

	steuerung.zeige(macheElement("SPAN"));
	pruefe(steuerung.aktiv() === 1, "zeige: ein fremdes Element ändert nichts");
	steuerung.zeige(null);
	pruefe(steuerung.aktiv() === 1, "zeige: null ändert nichts");
	steuerung.zeige(99);
	pruefe(steuerung.aktiv() === 1, "zeige: ein Index ausserhalb ändert nichts");
}

// ---- 7) A7: zweiter attach → dieselbe Steuerung, kein zweiter Reitersatz ------------------------
// 🔴 Die Doppelanmeldung, die das Sammelmenü am 23.08.2026 live unbrauchbar gemacht hat: zwei
//    Zuhörer, der erste öffnet, der zweite schließt im selben Klick — und jede Zeile sieht
//    richtig aus.
{
	reiterLeisteSichtbar = true;
	const wirt = neuerWirt(3);
	const erste = avesmapsSpaltenReiterAttach(wirt);
	const zweite = avesmapsSpaltenReiterAttach(wirt);
	pruefe(erste === zweite, "A7: der zweite Aufruf liefert die vorhandene Steuerung");
	pruefe(wirt.parentNode.children.filter((k) => String(k.className).includes("avm-spalten-reiter")).length === 1,
		"A7: und baut keine zweite Leiste");
	pruefe(erste.knoepfe[0].zuhoerer.click.length === 1, "A7: jeder Reiter hat genau EINEN Klick-Zuhörer");
}

// ---- 8) Nichts umzuschalten heisst keine Leiste ------------------------------------------------
{
	reiterLeisteSichtbar = true;
	pruefe(avesmapsSpaltenReiterAttach(null) === null, "ohne Wirt: null");
	pruefe(avesmapsSpaltenReiterAttach(neuerWirt(1)) === null, "eine Spalte: null — ein Reiter für nichts ist ein Klick für nichts");
	pruefe(avesmapsSpaltenReiterAttach(neuerWirt(0)) === null, "keine Spalte: null");
	// Ein Textknoten zwischen den Spalten ist keine Spalte.
	const wirt = neuerWirt(2);
	wirt.children.push({ nodeType: 3, nodeName: "#text" });
	const steuerung = avesmapsSpaltenReiterAttach(wirt);
	pruefe(steuerung.spalten.length === 2, "Textknoten werden nicht zu Spalten");
}

// ---- 9) Der Nachschlager ----------------------------------------------------------------------
// ⚠️ Er gibt es, damit keine Seite sich die Steuerung in eine `const` legen muss — der Zugriff aus
//    einer Funktion darauf hinge sonst an der Reihenfolge zweier Blöcke derselben Datei (TDZ).
{
	reiterLeisteSichtbar = true;
	const wirt = neuerWirt(3);
	const steuerung = avesmapsSpaltenReiterAttach(wirt);
	pruefe(avesmapsSpaltenReiter(wirt) === steuerung, "Nachschlager: findet die Steuerung am Wirt");
	pruefe(avesmapsSpaltenReiter(macheElement("DIV")) === null, "Nachschlager: ohne Steuerung null");
	pruefe(avesmapsSpaltenReiter(null) === null, "Nachschlager: ohne Element null");

	// Über einen Selektor -- so ruft ihn der Monitor.
	global.document.querySelector = (selektor) => (selektor === ".cols" ? wirt : null);
	pruefe(avesmapsSpaltenReiter(".cols") === steuerung, "Nachschlager: auch über einen Selektor");
	pruefe(avesmapsSpaltenReiter(".gibtsnicht") === null, "Nachschlager: ein Selektor ins Leere ergibt null");
	global.document.querySelector = () => null;
}

if (fehler > 0) {
	console.error(`\n${fehler} Zusicherung(en) verletzt.`);
	process.exit(1);
}
console.log("editor-spalten-reiter.test.js: alle Zusicherungen erfüllt.");
