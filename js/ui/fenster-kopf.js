/* 🪤 04.09.2026 Stempel-Heilung nach einem abgebrochenen Deploy -- die Begruendung steht in css/components/fenster.css. */
"use strict";

/*
 * DIE KOPFLEISTE EINES FENSTERS -- gebaut, nicht abgeschrieben.
 *
 * Entwurf: docs/fensterformen-mockup.html · Regel: docs/design-language.md §Fenster
 * Bauplan: docs/superpowers/plans/2026-09-04-fenster-vereinheitlichung.md
 *
 * 💣 WARUM ES DIESE DATEI GIBT. Am 04.09.2026 stand derselbe Kopf SIEBENMAL im JavaScript --
 *    in vier Dateien, fuer sieben Fenster (Landschaften · Wege · Kraftlinien · Orte · Literatur ·
 *    Karten · Territorien). Jede Fassung baute dieselben drei Elemente in derselben Reihenfolge,
 *    und jede haette einzeln nachgezogen werden muessen, als der Griff dazukam. Genau so sind
 *    die 13 Schliessknopf-Rezepturen im CSS entstanden, die dieses Bauteil beendet -- hier war
 *    es dasselbe, nur eine Etage hoeher.
 *
 * 🔴 ER SETZT NUR DIE BAUTEILKLASSEN, KEINE WERTE. Wie der Kopf AUSSIEHT, steht in
 *    css/components/fenster.css und nirgends sonst. Wer hier eine Farbe oder ein Polster
 *    schreibt, hat die zweite Wahrheit angelegt, die beide Dateien verhindern sollen.
 *
 * ⚠️ Die Wirtsklasse bleibt erhalten. Die Fenster tragen zusaetzlich ihre eigene Kopfklasse
 *    (`avm-editor-dialog__header`, `political-territory-editor-dialog__header`) -- an der haengen
 *    ihre EIGENEN Regeln (Zieh-Verhalten der durchsichtigen Huelle, Grund). Sie faellt erst,
 *    wenn niemand sie mehr liest; das ist eine eigene Aufraeumung, kein Nebeneffekt hier.
 *
 * 🪤 DIESE DATEI LAG AM 04.09.2026 NICHT AUF DEM SERVER -- 404, waehrend index.html sie mit
 *    korrektem ?v=-Stempel anforderte. Ursache ist die Falle aus AGENTS.md §9: ein zweiter Push
 *    waehrend eines laufenden Deploys BRICHT dessen Lauf ab, und ein abgebrochener Lauf laedt
 *    NICHTS hoch. Der naechste rechnet seine Dateien ab `github.event.before` -- also ab dem
 *    abgebrochenen Commit -- und dessen EIGENE Dateien laedt damit nie jemand.
 * 💣 Es faellt nicht auf: der Stempel in index.html ist der neue, die Datei dahinter fehlt einfach.
 *    Kein Test sieht es, die Konsole zeigt nur ein nacktes 404 ohne Dateinamen. Gemessen war die
 *    Folge schwer -- jedes umgestellte Fenster stand auf `display: block`: Griff, Titel und ✕
 *    untereinander, Titel 13,3px statt 16, nativer Knopf statt 32x32.
 * ⭐ Geheilt wird das NUR durch eine Inhaltsaenderung -- deshalb steht diese Notiz hier. Gefunden
 *    hat es der Blick ins NETZ-PROTOKOLL der Live-Seite nach dem Push, nicht die Konsole.
 */

/**
 * Baut die Kopfleiste eines Fensters.
 *
 * @param {string} titel        Die Aufschrift.
 * @param {object} [opts]
 * @param {string} [opts.wirtsklasse]  zusaetzliche Klasse an der Leiste (die alte Kopfklasse).
 * @param {string} [opts.titelId]      id fuer das <h2> (aria-labelledby der Huelle).
 * @param {string} [opts.schliessenAria] aria-label des Schliessknopfes.
 * @param {Function} [opts.aufSchliessen] Klick-Handler des Schliessknopfes.
 * @returns {{kopf: HTMLElement, titelEl: HTMLElement, schliessen: HTMLButtonElement}}
 */
function avesmapsFensterKopf(titel, opts) {
	const o = opts || {};
	const kopf = document.createElement("div");
	kopf.className = o.wirtsklasse
		? o.wirtsklasse + " avm-fenster__kopf"
		: "avm-fenster__kopf";

	// 🔴 Der Griff. Owner 04.09.2026: alle Fenster sind verschiebbar und tragen ihn, „damit fuer
	//    jeden klar [ist], dass man das verschieben kann". Ob er SICHTBAR ist, entscheidet das
	//    Blatt (@media hover:none and pointer:coarse) -- am Telefon zieht dialog-drag.js nicht,
	//    und dort soll er nichts behaupten. Deshalb steht hier keine Bedingung.
	// ⚠️ aria-hidden: er ist Zierat fuer das Auge, kein Bedienelement. Ein Screenreader, der
	//    „Doppelpunkt Doppelpunkt" vorliest, hat nichts gewonnen.
	const griff = document.createElement("span");
	griff.className = "avm-fenster__griff";
	griff.setAttribute("aria-hidden", "true");
	griff.textContent = "⁝⁝";

	const titelEl = document.createElement("h2");
	titelEl.className = "avm-fenster__titel";
	titelEl.textContent = titel;
	if (o.titelId) {
		titelEl.id = o.titelId;
	}

	// 🔴 GEFASST, nicht nackt: alle sieben Aufrufer sind Werkzeugfenster. Ein Blatt baut seinen
	//    Kopf im Markup und nimmt dort `--nackt` (docs/design-language.md §Fenster).
	const schliessen = document.createElement("button");
	schliessen.type = "button";
	schliessen.className = "avm-fenster__knopf avm-fenster__knopf--gefasst";
	schliessen.setAttribute("aria-label", o.schliessenAria || "Schließen");
	schliessen.textContent = "✕";
	if (typeof o.aufSchliessen === "function") {
		schliessen.addEventListener("click", o.aufSchliessen);
	}

	kopf.appendChild(griff);
	kopf.appendChild(titelEl);
	kopf.appendChild(schliessen);
	return { kopf: kopf, titelEl: titelEl, schliessen: schliessen };
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = { avesmapsFensterKopf: avesmapsFensterKopf };
}
