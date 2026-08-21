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
 */
function avesmapsCoatSrc(url) {
	const value = String(url || "").trim();
	if (value === "") {
		return "";
	}
	if (/^https?:\/\/([a-z0-9-]+\.)?wiki-aventurica\.de\//iu.test(value)) {
		return "/api/app/coat.php?u=" + encodeURIComponent(value);
	}
	return value;
}

// Fuer den Test in Node -- im Browser ist `avesmapsCoatSrc` schlicht global (Hausmuster:
// js/ui/listen-statuskreis.js).
if (typeof module !== "undefined" && module.exports) {
	module.exports = { avesmapsCoatSrc };
}
