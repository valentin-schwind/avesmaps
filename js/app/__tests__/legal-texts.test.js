// Was das Hinweise-Fenster ZUSAGT, und ob die Seite es einhält (Befunde A22, A25).
//
// 🔴 Diese Datei prüft Rechtstexte, keine Funktionen -- und das ist Absicht. Der Systemtest hat
// zweimal denselben Fehlertyp gefunden: die Seite verspricht etwas, das sie nicht tut. Solche
// Abweichungen sind unsichtbar, weil beide Hälften für sich richtig aussehen -- der Satz liest sich
// gut, die Funktion arbeitet korrekt, nur zusammen ergeben sie eine Unwahrheit. Hier IST der Text
// das Erzeugnis, eine Zusicherung darauf misst also die Wirkung.
//
// ⚠️ Deutsch und Englisch stehen beide drin: die englische Fassung ist eine ÜBERSETZUNG derselben
// Zusage. Nur eine von beiden zu prüfen liesse die andere still auseinanderlaufen.
//
// Ausführen, vom Repo-Wurzelverzeichnis:
//   node js/app/__tests__/legal-texts.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");
const indexHtml = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const i18nEn = fs.readFileSync(path.join(ROOT, "js", "app", "i18n-en.js"), "utf8");

function indexText(key) {
	const match = indexHtml.match(new RegExp('data-i18n="' + key.replace(/\./g, "\\.") + '">([\\s\\S]*?)</(?:strong|span)>'));
	assert.ok(match, "index.html traegt den Schluessel " + key);
	return match[1].trim();
}

// ---- A22: Bewertungen werden NICHT vorab geprüft, und der Text sagt es jetzt ----------------------
//
// 💣 Der Satz warf zwei Wege zusammen: „Community-Meldungen UND Bewertungen … werden nicht
// automatisch veröffentlicht … redaktionell geprüft". Für Meldungen stimmt das (sie gehen in den
// Prüfbildschirm), für Bewertungen nicht -- die stehen sofort öffentlich. Während des Systemtests
// ist genau das passiert: eine Testbewertung stand live.
//
// ⚠️ Owner-Entscheid 06.08.2026: der SATZ wird richtiggestellt, nicht das Produkt. Eine
// Vorab-Moderation bräuchte zuerst eine Warteschlange in der Oberfläche -- ohne sie wäre eine neue
// Bewertung für die Öffentlichkeit weg UND für Bearbeiter unsichtbar, also beerdigt statt geprüft.
const reports = indexText("legal.communityReports.body");
assert.ok(
	reports.includes("Bewertungen von Orten erscheinen dagegen sofort und ohne vorherige Prüfung"),
	"der Text sagt, dass Bewertungen sofort erscheinen",
);
assert.ok(
	reports.includes("erst danach gesichtet") && reports.includes("jederzeit entfernt"),
	"und was stattdessen gilt: Prüfung danach, Entfernen jederzeit",
);
assert.ok(
	i18nEn.includes("appear immediately and without prior review"),
	"die englische Fassung sagt dasselbe",
);

// 💣 Faengt den Rueckfall: der Absatz beschreibt WIEDER nur die Meldungen, waehrend die Ueberschrift
// beide nennt. Genau diese Lage war der Befund.
const mentionsRatingsInLead = indexText("legal.communityReports.lead").includes("Bewertungen");
assert.ok(
	!mentionsRatingsInLead || /Bewertungen[^.]*sofort/.test(reports),
	"nennt die Ueberschrift Bewertungen, muss der Absatz ihren eigenen Weg beschreiben",
);

console.log("legal-texts ok");
