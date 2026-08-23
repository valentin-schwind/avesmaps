/*
 * DIE EINE WEICHE FÜR WAPPEN-ADRESSEN.
 *
 * 🔴 JEDES <img>, das ein Wappen zeigt, geht hier durch -- Karte, Infobox, Popup, die WikiSync-Listen
 * und die Editoren. Eine externe wiki-aventurica-Adresse wird über den serverseitigen Cache
 * (/api/app/coat.php) geleitet, der das Bild EINMAL holt und danach von unserer Platte liefert.
 * Lokale /uploads/-Adressen und bereits geleitete bleiben unverändert -- die Funktion ist damit
 * idempotent, ein zweiter Aufruf schadet nie.
 *
 * 💣 WARUM SIE HIER LIEGT UND NICHT MEHR IN map-features-region-info-markup.js: dort stand sie in
 * einer Datei, die NUR index.html lädt. Die Editorseiten kannten sie deshalb gar nicht, und SIEBEN
 * von elf Wappen-Ausgaben schrieben die Wiki-Adresse direkt ins src -- darunter die zwei
 * WikiSync-Listen mit EINEM Wappen JE ZEILE. Am 20.08.2026 lief daraufhin aus dem Browser jedes
 * Editors ein Sturm von hunderten Anfragen auf de.wiki-aventurica.de/wiki/Spezial:Dateipfad/…, und
 * das Wiki sperrte unsere Ausgangs-IP. Der Cache existierte die ganze Zeit -- er wurde nur nicht
 * gefragt. Eine Weiche, die nur die halbe Anwendung erreicht, ist keine Weiche.
 *
 * ⚠️ Wer eine neue Wappen-Ausgabe baut, muss ZWEIERLEI tun: sie hier durchschicken UND diese Datei
 * in seinem Dokument laden. Beides prüft js/ui/__tests__/wappen-quelle.test.js -- die zweite Hälfte,
 * weil eine fehlende Einbindung im Browser als ReferenceError endet und in keinem Textmuster-Test
 * auffällt.
 *
 * 🔴 Der Name bleibt `avesmapsCoatSrc`: er stand schon an vier Stellen im Code und wird hier nur
 * umgezogen, nicht umbenannt.
 *
 * ⚠️ Nur wiki-aventurica.de wird geleitet -- coat.php hat aus gutem Grund eine Host-Allowlist gegen
 * SSRF und lehnt alles andere ab. Eine fremde Bildadresse bleibt deshalb, wie sie ist.
 *
 * 🔴 23.08.2026 -- ZU. Owner: „SCHALT DAS ENDLICH AB." Eine Wiki-Adresse wird seither GAR NICHT
 * mehr angefragt, auch nicht ueber den eigenen Cache: sie bekommt den leeren Schild. Der Riegel im
 * Server (datei-riegel.php) haelt das Wiki frei, aber der Browser fragte weiter unseren eigenen
 * Endpunkt -- eine Ortsliste sind 3.538 Anfragen an uns selbst, alle mit 503, und die Konsole des
 * Editors lief damit voll. Hier zu antworten statt dort abzuweisen spart beide Haelften.
 *
 * 💣 DER PLATZHALTER IST NICHT "" -- ein leeres src laesst den Browser die SEITE als Bild laden.
 * Es ist derselbe leere Schild, den der Schalter „Wappen: Aus" einsetzt, damit jede
 * Layout-Entscheidung (Groesse, object-fit, der has-coat-Zweig) unangetastet bleibt.
 *
 * 💣 GEKOPPELTER WERT IN ZWEI DATEIEN: `AVESMAPS_WAPPEN_VOM_WIKI_ERLAUBT` hier und
 * `AVESMAPS_WIKI_DATEI_ABRUF_ERLAUBT` in `api/_internal/wiki/datei-riegel.php`. Wer nur den Server
 * wieder aufmacht, sieht weiter Schilde; wer nur hier aufmacht, bekommt 503 statt Wappen. Beide
 * zusammen umlegen.
 */

// 🔴 Der Schalter. `false` = keine Wappenadresse des Wikis wird angefragt.
const AVESMAPS_WAPPEN_VOM_WIKI_ERLAUBT = false;
// Der leere Schild (500x500), schon vom Schalter „Wappen: Aus" benutzt.
const AVESMAPS_WAPPEN_PLATZHALTER = "/img/wappen.png";
function avesmapsCoatSrc(url) {
	const value = String(url || "").trim();
	if (value === "") {
		return "";
	}
	if (/^https?:\/\/([a-z0-9-]+\.)?wiki-aventurica\.de\//iu.test(value)) {
		if (!AVESMAPS_WAPPEN_VOM_WIKI_ERLAUBT) {
			return AVESMAPS_WAPPEN_PLATZHALTER;
		}
		return "/api/app/coat.php?u=" + encodeURIComponent(value);
	}
	return value;
}

// Fuer den Test in Node -- im Browser ist `avesmapsCoatSrc` schlicht global (Hausmuster:
// js/ui/listen-statuskreis.js).
if (typeof module !== "undefined" && module.exports) {
	module.exports = { avesmapsCoatSrc, AVESMAPS_WAPPEN_VOM_WIKI_ERLAUBT, AVESMAPS_WAPPEN_PLATZHALTER };
}
