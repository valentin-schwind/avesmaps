/**
 * „Ist hier ein Wiki-Artikel zu holen?" — der Kandidaten-Abgleich der WikiSync-Listen.
 *
 * Er beantwortet für EINE Listenzeile genau eine Frage und liefert einen von vier Zuständen:
 *
 *   zugewiesen  — die Zeile trägt bereits einen Wiki-Artikel (leise Raute, nur Kontur)
 *   zuweisbar   — ihr Name trifft einen Katalogeintrag exakt (volle Raute)
 *   kandidat    — im Katalog steht etwas, das passen könnte, aber nicht wortgleich
 *                 (gestrichelte Kontur, der Tooltip nennt den Fund)
 *   ""          — nichts gefunden
 *
 * 💣 DIE ABWESENHEIT DES SYMBOLS HEISST „WIR HABEN NICHTS GEFUNDEN", NICHT „ES GIBT KEINEN
 *    ARTIKEL". Genau dafür gibt es den dritten Zustand: ohne ihn stünde „Brücke nach Akrabaal"
 *    leer da, obwohl das Wiki „Brücke VON Akrabaal" führt — das Symbol hätte dem Leser das
 *    Gegenteil der Wahrheit beigebracht. ⚠️ Auf derselben Zeile ist bereits eine Abwesenheit
 *    bedeutungstragend: der grüne Kreis (.has-map-status) fehlt bei Literatur, Karten und
 *    Vorkommen mit Absicht, weil diese drei kein „liegt auf der Karte" haben. Zwei verschieden
 *    bedeutende Abwesenheiten auf einer Zeile sind eine Falle — deshalb steht die dritte Spalte
 *    NUR unter dem Opt-in `.wikisync-itemlist--wikistatus`, und eine Liste ohne Katalog setzt es
 *    gar nicht erst: dann fehlt die ganze Spalte, statt in jeder Zeile ein Nichts zu behaupten.
 *
 * 🔴 Eigene, geprüfte Funktion — KEINE Bedingung im Zeichner. Der Zeichner fragt, dieser Rechner
 *    antwortet; nur so ist die Abnahmeliste überhaupt prüfbar.
 *
 * 🔴 Er ruft NICHTS auf. Kein `fetch`, kein Wiki, keine Datenbank — der Katalog wird ihm
 *    übergeben. Bei den Kraftlinien reist er ohnehin in derselben Antwort mit
 *    (`GET /api/edit/map/powerlines.php` → `wiki_articles`, 23 Einträge).
 *
 * Entwurf/Mockup: docs/listensymbol-wiki-mockup.html (Variante A, Owner-Abnahme 17.08.2026).
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
 * Der Abgleich für EINE Listenzeile.
 *
 * @param {string} name        unser Name (bei den Kraftlinien: der Name der Namensgruppe)
 * @param {Array}  katalog     die Artikel, die die Liste ohnehin schon geladen hat
 *                             ([{name, wiki_url, wiki_key}, …]) — nie eine Abfrage von hier aus
 * @param {{zugewiesen?:boolean}} [optionen]
 * @returns {{zustand:string, artikel:string}} zustand ∈ zugewiesen|zuweisbar|kandidat|""
 */
function avesmapsWikistatusZustand(name, katalog, optionen) {
	const eintraege = Array.isArray(katalog) ? katalog : [];
	const zugewiesen = !!(optionen && optionen.zugewiesen);
	if (zugewiesen) {
		return { zustand: "zugewiesen", artikel: "" };
	}
	const schluessel = avesmapsWikistatusSchluessel(name);
	if (schluessel === "") {
		return { zustand: "", artikel: "" };
	}
	// 1. Der exakte Treffer. Er geht IMMER vor — ein Name, der einen Katalogeintrag wortgleich
	//    trifft, ist zuweisbar und nicht bloß ein Kandidat, auch wenn er nebenbei einem zweiten
	//    Artikel ähnlich sieht.
	const genau = eintraege.find((e) => e && avesmapsWikistatusSchluessel(e.name) === schluessel);
	if (genau) {
		return { zustand: "zuweisbar", artikel: String(genau.name || "") };
	}
	// 2. Der Kandidat. Bei mehreren gewinnt der mit den meisten übereinstimmenden Wörtern; bei
	//    Gleichstand der mit dem geringeren Wortüberschuss, dann alphabetisch — der Zustand einer
	//    Zeile darf nicht davon abhängen, in welcher Reihenfolge der Katalog eintrifft.
	const worte = avesmapsWikistatusWorte(name);
	if (worte.length === 0) {
		return { zustand: "", artikel: "" };
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
	if (bester) {
		return { zustand: "kandidat", artikel: bester.name };
	}
	return { zustand: "", artikel: "" };
}

/**
 * Das Markup der dritten Spalte — EIN Erzeuger, damit die achte Liste nicht die neunte Rezeptur
 * schreibt (dieselbe Lehre wie bei der Bilanzzeile, js/review/review-list-balance.js).
 *
 * Liefert für den leeren Zustand den leeren String: kein Element, kein Platzhalter. Das Raster
 * hält die Spalte offen, die Zeile bleibt gleich hoch.
 */
function avesmapsWikistatusMarkup(zustand, artikel) {
	const beschriftung = {
		zuweisbar: "Zuweisbar",
		kandidat: "Kandidat im Wiki gefunden: „" + String(artikel || "") + "“",
		zugewiesen: "Zugewiesen",
	}[zustand];
	if (!beschriftung) {
		return "";
	}
	const sicher = (typeof escapeHtml === "function")
		? escapeHtml(beschriftung)
		: String(beschriftung).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
	return '<span class="wiki-state wiki-state--' + zustand + '" title="' + sicher + '"></span>';
}

if (typeof window !== "undefined") {
	window.avesmapsWikistatusZustand = avesmapsWikistatusZustand;
	window.avesmapsWikistatusMarkup = avesmapsWikistatusMarkup;
}
if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		avesmapsWikistatusFalten,
		avesmapsWikistatusSchluessel,
		avesmapsWikistatusWorte,
		avesmapsWikistatusWortGleich,
		avesmapsWikistatusVergleich,
		avesmapsWikistatusZustand,
		avesmapsWikistatusMarkup,
	};
}
