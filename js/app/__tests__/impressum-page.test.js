// html/impressum.html -- der Weg zu Impressum und Datenschutz OHNE JavaScript (Befund A24).
//
// 💣 DAS FENSTER „HINWEISE" OEFFNET NUR JAVASCRIPT. Damit waren Impressum UND
// Datenschutzerklaerung fuer jeden ohne JavaScript unerreichbar -- also genau die beiden Angaben,
// die § 5 DDG und Art. 13 DSGVO „unmittelbar erreichbar" verlangen. Der Knopf ist deshalb ein <a>
// mit Ziel: mit JavaScript oeffnet er das Fenster, ohne fuehrt er auf diese Seite.
//
// 🔴 DER PREIS IST EINE ZWEITE KOPIE DER RECHTSTEXTE, und eine stille Divergenz waere hier
// schlimmer als anderswo: zwei Datenschutzerklaerungen, die verschiedenes sagen, sind schlechter
// als eine. Es gibt keinen Build-Schritt, der die Seite erzeugen koennte -- also haelt dieser Test
// beide Fassungen Zeichen fuer Zeichen aneinander. Hier IST der Quelltext das Erzeugnis.
//
// Ausführen, vom Repo-Wurzelverzeichnis:
//   node js/app/__tests__/impressum-page.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");
const indexHtml = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const page = fs.readFileSync(path.join(ROOT, "html", "impressum.html"), "utf8");

// Holt den Text, den index.html unter diesem i18n-Schluessel anzeigt.
function indexText(key) {
	const match = indexHtml.match(new RegExp('data-i18n="' + key.replace(/\./g, "\\.") + '">([\\s\\S]*?)</(?:strong|span)>'));
	assert.ok(match, "index.html traegt den Schluessel " + key);
	return match[1].trim();
}

// ---- Beide Fassungen sagen dasselbe ---------------------------------------------------------------

// 💣 Faengt: jemand schaerft einen Absatz im Fenster nach und vergisst die Seite (oder umgekehrt).
// Das faellt sonst NIEMANDEM auf -- beide Seiten sehen fuer sich genommen richtig aus.
[
	"legal.responsible.body",
	"legal.privacy.hosting.body",
	"legal.privacy.cookies.body",
	"legal.analytics.body",
].forEach((key) => {
	assert.ok(page.includes(indexText(key)), "html/impressum.html traegt " + key + " wortgleich");
});

// ⚠️ EIN Satz weicht ab, und zwar mit Absicht: im Fenster steht das Kontaktformular darunter, auf
// der Seite nicht. Beides wird festgehalten -- dass die Anpassung DA ist, und dass die Fassung des
// Fensters NICHT hineinkopiert wurde. Findet der Ersetzer seine Stelle nicht mehr (weil jemand den
// Satz im Fenster umformuliert hat), sind beide Zeichenketten gleich und die zweite Zusicherung
// wird rot -- der Test bewacht damit auch seine eigene Voraussetzung.
const rightsInDialog = indexText("legal.privacy.rights.body");
const rightsOnPage = rightsInDialog.replace(
	"richtest du bitte über das Kontaktformular unten in diesen Hinweisen",
	"richtest du bitte an die oben genannte E-Mail-Adresse",
);
assert.ok(page.includes(rightsOnPage), "der Rechte-Absatz steht angepasst auf der Seite");
assert.ok(!page.includes(rightsInDialog), "und die Fassung des Fensters wurde nicht hineinkopiert");

// ---- Die Seite muss auffindbar sein ---------------------------------------------------------------

// 💣 Faengt: jemand kopiert den Kopf einer Editor-Seite hierher. Jede andere Seite unter html/ traegt
// `noindex`, weil sie Werkzeug ist -- diese eine muss gefunden werden, das ist ihr ganzer Zweck.
assert.ok(!/<meta\s+name="robots"[^>]*noindex/i.test(page), "die Seite traegt KEIN noindex");
assert.ok(/<link\s+rel="canonical"[^>]*impressum\.html/i.test(page), "und eine kanonische Adresse");

const sitemap = fs.readFileSync(path.join(ROOT, "sitemap.xml"), "utf8");
assert.ok(sitemap.includes("https://avesmaps.de/html/impressum.html"), "die Sitemap kennt die Seite");

// ---- Der Weg ohne JavaScript ----------------------------------------------------------------------

// 💣 Faengt: der Knopf wird wieder ein <button>. Dann ist das Fenster erneut nur mit JavaScript
// erreichbar, und der ganze Befund ist zurueck -- ohne dass irgendetwas kaputt AUSSIEHT.
const buttonMatch = indexHtml.match(/<a id="legal-button"[^>]*>/);
assert.ok(buttonMatch, "#legal-button ist ein <a>, kein <button>");
assert.ok(/href="\/html\/impressum\.html"/.test(buttonMatch[0]), "und zeigt auf die Seite");

// 🔴 UND MIT JAVASCRIPT DARF ER GENAU DAS NICHT TUN. Ohne preventDefault oeffnet ein Klick das
// Fenster UND verlaesst die Karte -- mitsamt der gerade geplanten Route.
//
// ⚠️ Hier steht nur, DASS der Handler die geteilte Regel ruft. Ob sie die Navigation wirklich
// anhaelt, prueft legal-anchor.test.js an einem mitzaehlenden Ereignis -- und das ist der
// Unterschied, der zaehlt: eine Zusicherung auf `event.preventDefault()` im Quelltext liess
// `if (false) { event.preventDefault(); }` gruen durch. Nachgestellt, bevor diese Zeile entstand.
const bootstrap = fs.readFileSync(path.join(ROOT, "js", "app", "bootstrap.js"), "utf8");
const handler = bootstrap.match(/\$\("#legal-button"\)\.on\("click",[\s\S]{0,240}?\);/);
assert.ok(handler, "bootstrap.js bindet den Klick auf #legal-button");
assert.ok(
	/avesmapsHandleLegalButtonClick\(event, setLegalDialogOpen\)/.test(handler[0]),
	"und der Handler ruft die geteilte Regel, statt eine eigene Kopie zu tragen",
);

// ---- Die Adresse, hier wie dort ---------------------------------------------------------------

// 💣 Faengt: auf der zweiten Seite steht die Adresse im Klartext. Der Schutz von index.html waere
// dann wertlos -- ein Sammelprogramm braucht nur eine der beiden Seiten.
assert.ok(!page.includes("info@avesmaps.de"), "die Adresse steht auch hier nicht im Klartext");
assert.ok(!/mailto:/i.test(page), "und kein mailto: -- danach wird zuerst gesucht");
assert.ok(page.includes('<span id="legal-mail">'), "der Traeger fuer die Adresse ist da");
assert.ok(page.includes('src="/js/app/legal-mail.js"'), "die Seite laedt das Modul");
assert.ok(/avesmapsActivateLegalMail\(document\)/.test(page), "und ruft es auf");

// Und der Rueckweg zur Karte -- eine Sackgasse waere fuer den, der ohne JavaScript hier landet,
// genau die Sackgasse, die dieser Befund beseitigt.
assert.ok(/href="\/"/.test(page), "es gibt einen Weg zurueck zur Karte");

console.log("impressum-page ok");
