/**
 * „Wie steht diese Zeile zum Wiki?" — der Zustandsrechner der WikiSync-Listen.
 *
 * Er beantwortet für EINE Listenzeile genau eine Frage, und die Antwort hat zwei Ebenen: WAS
 * gefunden wurde (der Befund) und WIE die Zeile es zeigt (die Form).
 *
 *   Befund              Form            Raute (11px)
 *   ------------------  --------------  ----------------------------------------------
 *   zuweisung           zugewiesen      gefüllt
 *   teilzuweisung       teilweise       halb gefüllt
 *   kein_artikel        ohne-artikel    durchgezogene Kontur, leer
 *   treffer  (wortgl.)  kandidat        gestrichelte Kontur mit Punkt in der Mitte
 *   aehnlich (unscharf) kandidat        gestrichelte Kontur mit Punkt in der Mitte
 *   nichts              offen           gestrichelte Kontur, leer
 *
 * 🔴 DIE LEITIDEE, UND SIE IST DER GRUND FÜR GENAU DIESE ZUORDNUNG:
 *    **durchgezogen = erledigt, gestrichelt = offen.**
 *    „zugewiesen" und „kein Wiki-Artikel vorhanden" sind BEIDE abgeschlossen — einmal mit einem
 *    Artikel, einmal mit der Feststellung, dass es keinen gibt. Offen sind nur die letzten beiden,
 *    und dort sagt der Punkt „hier liegt was". Ohne diesen Satz dreht der nächste Leser die
 *    Zuordnung um, weil „kein Artikel" nach einem Mangel klingt und „Kandidat gefunden" nach
 *    einem Erfolg — beides ist hier nicht gemeint.
 *
 * 🔴 JEDE Zeile trägt ein Symbol; es gibt keinen leeren Zustand (Owner-Entscheid 17.08.2026).
 *    🪤 Die Vorgängerfassung ließ die Zeile leer, wenn nichts gefunden wurde, und musste dann in
 *    drei Dateien erklären, dass die Leerstelle „wir haben nichts gefunden" heißt und nicht „es
 *    gibt keinen Artikel". Die Belegung macht diese Erklärung gegenstandslos: sie spricht aus,
 *    was vorher geschwiegen wurde — und den Unterschied, um den es dabei ging, trägt jetzt eine
 *    eigene Form (`ohne-artikel`).
 *    ⚠️ Die Nachbarregel bleibt davon UNBERÜHRT: der grüne Kartenkreis (.has-map-status) fehlt
 *    bei Literatur, Karten und Vorkommen weiterhin mit Absicht, und dieses Fehlen ist Information.
 *    Das ist ein anderes Zeichen mit einer anderen Regel — hier wird nichts angeglichen.
 *
 * ⚠️ `treffer` und `aehnlich` teilen sich EINE Form. Der Abgleich entscheidet nur, OB etwas da
 *    ist, nicht wie genau es passt; die Unterscheidung reist als Befund weiter und steht im
 *    Tooltip. Eine eigene Form dafür ist eine Owner-Entscheidung, kein Umbau.
 *
 * 🔴 Eigene, geprüfte Funktion — KEINE Bedingung im Zeichner. Der Zeichner fragt, dieser Rechner
 *    antwortet; nur so ist die Abnahmeliste überhaupt prüfbar.
 *
 * 🔴 Er ruft NICHTS auf. Kein `fetch`, kein Wiki, keine Datenbank — der Katalog wird ihm
 *    übergeben. Bei den Kraftlinien reist er ohnehin in derselben Antwort mit
 *    (`GET /api/edit/map/powerlines.php` → `wiki_articles`, 23 Einträge).
 *
 * Entwurf/Mockup: docs/listensymbol-wiki-mockup.html (Owner-Abnahme 17.08.2026).
 * Test: js/review/__tests__/wikistatus-abgleich.test.js
 */

"use strict";

/**
 * Wörter, die keine Identität tragen. Klein gehalten: jedes zusätzliche Wort hier macht den
 * Abgleich großzügiger, und ein Symbol, das überall leuchtet, ist so nutzlos wie keins.
 * „nach"/„von" stehen drin, weil genau daran der Abnahmefall hängt (Brücke NACH ↔ VON Akrabaal).
 */
const AVESMAPS_WIKISTATUS_STOPWORTE = new Set([
	"der", "die", "das", "den", "dem", "des", "ein", "eine", "einer", "eines",
	"von", "vom", "nach", "zu", "zur", "zum", "im", "in", "am", "an", "auf", "bei", "beim",
	"und", "mit", "fuer",
]);

/** Nummerierungen unserer eigenen Teilstücke: „Satinavs Kette I" / „… II", „Tobrische Linie II". */
const AVESMAPS_WIKISTATUS_ZAEHLER = /^(?:\d+|i{1,3}|iv|vi{0,3}|ix|xi{0,2}|x)$/;

/** Kürzer als das trägt kein Wort eine Identität („St.", „zu", „de"). */
const AVESMAPS_WIKISTATUS_MINDESTLAENGE = 3;

/**
 * Kleinschreibung + deutsche Umlaute ausgeschrieben + Akzente weg.
 *
 * ⚠️ Die Umlaute ZUERST, dann die Zerlegung: `normalize("NFD")` zerlegt „ä" in a + Trema, und
 * ein danach entferntes Trema machte aus „Brücke" ein „Brucke" statt „Bruecke". Beide Seiten
 * laufen durch dieselbe Faltung, der Unterschied wäre also nicht falsch, aber „ue" hält zwei
 * verschiedene Wörter (schon/schön) eher auseinander.
 *
 * 🔴 Das ist NICHT `avesmapsWikiSyncCreateMatchKey` und will es nicht sein: jener Schlüssel ist
 * eine feste Tabelle, an der ~10 Tabellen als Join hängen (AGENTS.md §5), dort fallen Umlaute
 * ersatzlos weg. Hier wird nichts gejoint und nichts gespeichert — hier wird nur verglichen.
 */
function avesmapsWikistatusFalten(text) {
	return String(text == null ? "" : text)
		.toLowerCase()
		.replace(/ä/g, "ae")
		.replace(/ö/g, "oe")
		.replace(/ü/g, "ue")
		.replace(/ß/g, "ss")
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "");
}

/**
 * Der Schlüssel für den EXAKTEN Treffer: gefaltet, alles außer Buchstaben und Ziffern weg.
 * „Bann-Linie" und „Bann Linie" sind damit derselbe Name, „Satinavs Kette I" und
 * „Satinavs Ketten" nicht.
 */
function avesmapsWikistatusSchluessel(name) {
	return avesmapsWikistatusFalten(name).replace(/[^a-z0-9]+/g, "");
}

/**
 * Die bedeutungstragenden Wörter eines Namens.
 *
 * 💣 Klammern trennen wie Leerzeichen, sie werden NICHT abgeschnitten. Bei uns steht in der
 * Klammer manchmal genau der gesuchte Name: „Klirrfrostsaite (Zwölfseitige Götterharfe)" trifft
 * den Wiki-Artikel „Zwölfsaitige Götterharfe" ausschließlich über seinen Klammerinhalt. Ein
 * Abschneiden nach Art von `avesmapsWikiSyncStripParentheticalSuffix` (dort richtig: eine Klammer
 * am Ende eines WIKI-Titels ist eine Begriffsklärung) verlöre diesen Abnahmefall.
 */
function avesmapsWikistatusWorte(name) {
	return avesmapsWikistatusFalten(name)
		.replace(/[^a-z0-9]+/g, " ")
		.trim()
		.split(/\s+/)
		.filter((wort) => wort !== ""
			&& wort.length >= AVESMAPS_WIKISTATUS_MINDESTLAENGE
			&& !AVESMAPS_WIKISTATUS_STOPWORTE.has(wort)
			&& !AVESMAPS_WIKISTATUS_ZAEHLER.test(wort));
}

/** Unterscheiden sich zwei Wörter um höchstens eine Einfügung, Löschung oder Ersetzung? */
function avesmapsWikistatusAbstandHoechstensEins(a, b) {
	if (a === b) { return true; }
	if (Math.abs(a.length - b.length) > 1) { return false; }
	const kurz = a.length <= b.length ? a : b;
	const lang = a.length <= b.length ? b : a;
	let i = 0;
	while (i < kurz.length && kurz[i] === lang[i]) { i++; }
	if (i === kurz.length) { return true; }
	if (kurz.length === lang.length) {
		// Ersetzung: ab der Fundstelle muss der Rest gleich sein.
		return kurz.slice(i + 1) === lang.slice(i + 1);
	}
	// Einfügung im längeren Wort.
	return kurz.slice(i) === lang.slice(i + 1);
}

/**
 * Sind zwei Wörter dasselbe Wort?
 *
 * Drei Stufen, jede an einem gemessenen Abnahmefall vom 17.08.2026 begründet:
 *   1. gleich                              — „Akrabaal" / „Akrabaal"
 *   2. Endung angehängt (ab 5 Zeichen, höchstens 2 mehr) — „Kette" / „Ketten"
 *   3. ein Tippfehler (ab 6 Zeichen)       — „zwoelfseitige" / „zwoelfsaitige"
 *
 * ⚠️ Die Längenschranken sind der Grund, warum das Symbol nicht überall leuchtet: ohne sie wären
 * „Olat" und „Olat…" oder „Then" und „Thek" dasselbe Wort, und die 16 automatisch benannten
 * Ortspaare (`Aldyra - Kuslik`) fingen an, Artikel zu treffen.
 */
function avesmapsWikistatusWortGleich(a, b) {
	if (a === b) { return true; }
	const kurz = a.length <= b.length ? a : b;
	const lang = a.length <= b.length ? b : a;
	if (kurz.length >= 5 && lang.length - kurz.length <= 2 && lang.startsWith(kurz)) { return true; }
	if (kurz.length >= 6 && avesmapsWikistatusAbstandHoechstensEins(a, b)) { return true; }
	return false;
}

/**
 * Wie gut passen zwei Wortlisten zusammen? Jedes Wort wird höchstens EINMAL vergeben, sonst
 * verdiente ein doppelt genanntes Wort („Kreuzung - Kreuzung") zwei Treffer.
 *
 * @returns {{treffer:number, deckungA:boolean, deckungB:boolean}}
 */
function avesmapsWikistatusVergleich(worteA, worteB) {
	const vergeben = new Array(worteA.length).fill(false);
	const getroffenB = new Array(worteB.length).fill(false);
	let treffer = 0;
	worteB.forEach((wortB, iB) => {
		for (let iA = 0; iA < worteA.length; iA++) {
			if (vergeben[iA]) { continue; }
			if (avesmapsWikistatusWortGleich(worteA[iA], wortB)) {
				vergeben[iA] = true;
				getroffenB[iB] = true;
				treffer++;
				return;
			}
		}
	});
	return {
		treffer,
		deckungA: worteA.length > 0 && vergeben.every(Boolean),
		deckungB: worteB.length > 0 && getroffenB.every(Boolean),
	};
}

/**
 * Reicht die Übereinstimmung für einen Kandidaten?
 *
 * 💣 ZWEI Bedingungen, und beide sind tragend:
 *   • mindestens ZWEI übereinstimmende Wörter — ein einzelnes gemeinsames Wort ist bei Namen aus
 *     einer Welt mit „Linie", „Band", „Pfad", „Kreuzung" Zufall, kein Fund;
 *   • eine der beiden Seiten muss VOLLSTÄNDIG aufgehen. Nur so trifft
 *     „Klirrfrostsaite (Zwölfseitige Götterharfe)" den Artikel „Zwölfsaitige Götterharfe"
 *     (der ARTIKEL geht auf, unser Name hat ein Wort mehr) und zugleich
 *     „Satinavs Kette I" den Artikel „Satinavs Ketten (Kraftlinien)"
 *     (UNSER Name geht auf, der Artikeltitel hat die Begriffsklärung mehr).
 *     Eine einseitige Regel verlöre je einen der beiden Abnahmefälle.
 */
function avesmapsWikistatusReichtAus(vergleich) {
	return vergleich.treffer >= 2 && (vergleich.deckungA || vergleich.deckungB);
}

/**
 * 🔴 DIE FORM ZU EINEM BEFUND — die Stelle, an der aus sechs Befunden fünf Formen werden.
 *
 * 💣 ZWEI VOKABULARE, UND KEIN WORT STEHT IN BEIDEN. Der Befund sagt, was gefunden wurde; die
 * Form sagt, was gezeichnet wird. Hieße ein Befund wie eine Form, könnte man an keiner Fundstelle
 * mehr erkennen, welche der beiden Ebenen gemeint ist — und genau daran hängt, dass `treffer` und
 * `aehnlich` in derselben Form zusammenfallen dürfen, ohne dass die Auskunft verlorengeht.
 * Ein Test hält die Disjunktheit fest.
 *
 * ⚠️ Ein unbekannter Befund liefert die leere Zeichenkette, und die zeichnet KEIN Symbol. Das ist
 * für alles, was dieser Rechner selbst erzeugt, unerreichbar (ein Test zählt die sechs Befunde
 * auf und verlangt für jeden ein Symbol) — aber die sichere Richtung: lieber gar nichts zeigen
 * als eine Behauptung, die niemand gerechnet hat.
 */
function avesmapsWikistatusForm(befund) {
	return {
		zuweisung: "zugewiesen",
		teilzuweisung: "teilweise",
		kein_artikel: "ohne-artikel",
		treffer: "kandidat",
		aehnlich: "kandidat",
		nichts: "offen",
	}[befund] || "";
}

/** Eine nicht-negative ganze Zahl, oder 0. Alles andere (undefined, true, "3", NaN) ist 0. */
function avesmapsWikistatusZahl(wert) {
	return (typeof wert === "number" && isFinite(wert) && wert > 0) ? Math.floor(wert) : 0;
}

/**
 * Der Zustand EINER Listenzeile.
 *
 * @param {string} name        unser Name (bei den Kraftlinien: der Name der Namensgruppe)
 * @param {Array}  katalog     die Artikel, die die Liste ohnehin schon geladen hat
 *                             ([{name, wiki_url, wiki_key}, …]) — nie eine Abfrage von hier aus
 * @param {{teile?:number, zugewieseneTeile?:number, keinArtikel?:boolean}} [optionen]
 * @returns {{befund:string, form:string, artikel:string, teile:number, zugewieseneTeile:number}}
 *          befund ∈ zuweisung|teilzuweisung|kein_artikel|treffer|aehnlich|nichts
 *          form   ∈ zugewiesen|teilweise|ohne-artikel|kandidat|offen
 *
 * 💣 ZÄHLER UND NENNER MÜSSEN AUS DERSELBEN POPULATION KOMMEN. `zugewieseneTeile` und `teile`
 * zählen dieselbe Menge (bei den Kraftlinien: die Segmente einer Namensgruppe, beide aus der
 * Antwort des Endpunkts). Wer den Zähler aus der einen Quelle und den Nenner aus der anderen
 * nimmt, bekommt im Tooltip „5 von 3" — und in der Zeichnung einen Zustand, den es nicht gibt.
 *
 * ⚠️ Fehlt `teile`, gilt `teile = zugewieseneTeile`: eine Liste, die nur „zugewiesen ja/nein"
 * weiß, übergibt `{zugewieseneTeile: 1}` und bekommt die volle Raute. Es gibt bewusst KEIN
 * boolesches `zugewiesen` mehr — ein `true` würde sonst als „1 von n" gelesen und aus einer
 * vollständigen Zuweisung eine halbe machen. Deshalb heißen die Felder anders als vorher.
 *
 * 🔴 DIE RANGFOLGE: eine echte Zuweisung schlägt alles, auch den Merker „kein Artikel" (ein
 * gesetzter Link ist die härtere Tatsache), und der Merker schlägt jeden Katalogfund — er ist
 * eine ENTSCHEIDUNG eines Editors, kein Suchergebnis.
 */
function avesmapsWikistatusZustand(name, katalog, optionen) {
	const wahl = optionen || {};
	const zugewieseneTeile = avesmapsWikistatusZahl(wahl.zugewieseneTeile);
	const teile = Math.max(avesmapsWikistatusZahl(wahl.teile), zugewieseneTeile);
	const fertig = (befund, artikel) => ({
		befund,
		form: avesmapsWikistatusForm(befund),
		artikel: String(artikel || ""),
		teile,
		zugewieseneTeile,
	});
	const eintraege = Array.isArray(katalog) ? katalog : [];
	if (zugewieseneTeile > 0) {
		return fertig(zugewieseneTeile >= teile ? "zuweisung" : "teilzuweisung", "");
	}
	if (wahl.keinArtikel === true) {
		return fertig("kein_artikel", "");
	}
	const schluessel = avesmapsWikistatusSchluessel(name);
	if (schluessel === "") {
		return fertig("nichts", "");
	}
	// 1. Der wortgleiche Treffer. Er geht IMMER vor — auch wenn der Name nebenbei einem zweiten
	//    Artikel ähnlich sieht, ist DER der Fund, den der Tooltip nennen muss.
	const genau = eintraege.find((e) => e && avesmapsWikistatusSchluessel(e.name) === schluessel);
	if (genau) {
		return fertig("treffer", genau.name);
	}
	// 2. Der ähnliche. Bei mehreren gewinnt der mit den meisten übereinstimmenden Wörtern; bei
	//    Gleichstand der mit dem geringeren Wortüberschuss, dann alphabetisch — der Zustand einer
	//    Zeile darf nicht davon abhängen, in welcher Reihenfolge der Katalog eintrifft.
	const worte = avesmapsWikistatusWorte(name);
	if (worte.length === 0) {
		return fertig("nichts", "");
	}
	let bester = null;
	eintraege.forEach((eintrag) => {
		if (!eintrag) { return; }
		const worteArtikel = avesmapsWikistatusWorte(eintrag.name);
		if (worteArtikel.length === 0) { return; }
		const vergleich = avesmapsWikistatusVergleich(worte, worteArtikel);
		if (!avesmapsWikistatusReichtAus(vergleich)) { return; }
		const kandidat = {
			name: String(eintrag.name || ""),
			treffer: vergleich.treffer,
			ueberschuss: Math.abs(worte.length - worteArtikel.length),
		};
		if (bester === null
			|| kandidat.treffer > bester.treffer
			|| (kandidat.treffer === bester.treffer && kandidat.ueberschuss < bester.ueberschuss)
			|| (kandidat.treffer === bester.treffer && kandidat.ueberschuss === bester.ueberschuss
				&& kandidat.name.localeCompare(bester.name, "de") < 0)) {
			bester = kandidat;
		}
	});
	return bester ? fertig("aehnlich", bester.name) : fertig("nichts", "");
}

/**
 * Das Markup der dritten Spalte — EIN Erzeuger, damit die achte Liste nicht die neunte Rezeptur
 * schreibt (dieselbe Lehre wie bei der Bilanzzeile, js/review/review-list-balance.js).
 *
 * 🔴 Er nimmt den GANZEN Zustand, nicht seine Felder einzeln. Zwei Zeichenketten nebeneinander
 * (`befund`, `artikel`) lassen sich vertauschen, und vertauscht käme ein plausibles Symbol mit
 * falschem Tooltip heraus — dieselbe Falle wie `caption`/`message` beim Social-Adapter.
 *
 * 🔴 JEDE Zeile bekommt ein Symbol. „offen" ist eine ausgesprochene Aussage (gestrichelte
 * Kontur), keine Abwesenheit.
 *
 * ⚠️ Der TOOLTIP unterscheidet weiter, was die Form zusammenfasst: ein wortgleicher Treffer ist
 * eine andere Auskunft als ein ähnlicher, und beide nennen den gefundenen Artikel beim Namen.
 */
function avesmapsWikistatusMarkup(zustand) {
	const stand = zustand || {};
	const befund = String(stand.befund || "");
	const form = avesmapsWikistatusForm(befund);
	if (form === "") {
		return "";
	}
	const artikel = String(stand.artikel || "");
	const beschriftung = {
		zuweisung: "Zugewiesen",
		teilzuweisung: "Teilweise zugewiesen: "
			+ avesmapsWikistatusZahl(stand.zugewieseneTeile) + " von " + avesmapsWikistatusZahl(stand.teile),
		kein_artikel: "Kein Wiki-Artikel vorhanden (im Editor festgestellt)",
		treffer: "Offen — Kandidat im Wiki: „" + artikel + "“ (Name stimmt wortgleich)",
		aehnlich: "Offen — Kandidat im Wiki: „" + artikel + "“ (ähnlicher Name)",
		nichts: "Offen — kein Kandidat gefunden",
	}[befund];
	const sicher = (typeof escapeHtml === "function")
		? escapeHtml(beschriftung)
		: String(beschriftung).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
	return '<span class="wiki-state wiki-state--' + form + '" title="' + sicher + '"></span>';
}

if (typeof window !== "undefined") {
	window.avesmapsWikistatusZustand = avesmapsWikistatusZustand;
	window.avesmapsWikistatusMarkup = avesmapsWikistatusMarkup;
	window.avesmapsWikistatusForm = avesmapsWikistatusForm;
}
if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		avesmapsWikistatusFalten,
		avesmapsWikistatusSchluessel,
		avesmapsWikistatusWorte,
		avesmapsWikistatusWortGleich,
		avesmapsWikistatusVergleich,
		avesmapsWikistatusForm,
		avesmapsWikistatusZustand,
		avesmapsWikistatusMarkup,
	};
}
