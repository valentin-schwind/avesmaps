"use strict";

// Die Seite steht auf `noindex` -- und die drei Stellen, an denen das schiefgehen kann.
//
// 🔴 OWNER-ENTSCHEID 12.10.2026, nach dem Umzug auf `legacy.avesmaps.de`: die alte Anwendung soll
// NICHT mehr indexiert werden, die Sichtbarkeit bekommt die neue Seite unter `avesmaps.de`.
//
// 💣 DIE TEUERSTE FALLE IST EIN `Disallow: /` IN robots.txt. Es liegt nahe („soll ja nicht in die
// Suche") und bewirkt das GEGENTEIL: ein gesperrter Pfad verhindert das CRAWLEN, und dann liest nie
// jemand das `noindex` im <head>. Die Seite bleibt als „blockiert" im Index stehen -- ohne Snippet,
// ohne dass man es abstellen kann, und ohne dass irgendwo ein Fehler auftaucht. Gesperrt wird also
// nichts; das `noindex` erledigt es allein.
//
// 💣 UND `noindex` HEISST NICHT „KEINE LINK-VORSCHAU". `og:` und `twitter:` bedienen Discord, Slack,
// Mastodon und WhatsApp -- das hat mit Suchmaschinen nichts zu tun. Sie zeigten nach dem Umzug auf
// `avesmaps.de/og-image.jpg`, und das liefert dort seither HTML (der Catch-all der neuen SPA,
// gemessen 12.10.2026): jeder geteilte Link stand ohne Bild da, auch die aus dem Social-Hub. Wer
// beim naechsten Umzug nur „alles auf noindex" denkt, nimmt sie wieder mit.
//
// ⚠️ Zeilenendenneutral: die Arbeitskopie traegt CRLF, die CI LF (AGENTS.md §9).

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const WURZEL = path.resolve(__dirname, "..", "..", "..");
const lies = (datei) => fs.readFileSync(path.join(WURZEL, datei), "utf8").replace(/\r\n/g, "\n");

const html = lies("index.html");
const robots = lies("robots.txt");
const sitemap = lies("sitemap.xml");

// § A -- BEIDE Robots-Angaben stehen auf noindex. Die zweite (`googlebot`) ueberschreibt die erste
// fuer Google; nur eine davon umzustellen sieht richtig aus und wirkt bei Google nicht.
for (const name of ["robots", "googlebot"]) {
	const treffer = new RegExp(`<meta name="${name}" content="([^"]*)"`).exec(html);
	assert.ok(treffer, `<meta name="${name}"> fehlt in index.html`);
	assert.ok(
		/\bnoindex\b/.test(treffer[1]),
		`<meta name="${name}"> steht auf „${treffer[1]}" statt auf noindex`
	);
	// `follow` bleibt: die Links der Seite sollen weiter verfolgt werden -- unter anderem zum
	// Impressum, das als einzige Seite indexiert bleiben soll.
	assert.ok(
		/\bfollow\b/.test(treffer[1]) && !/\bnofollow\b/.test(treffer[1]),
		`<meta name="${name}"> soll „follow" behalten, steht aber auf „${treffer[1]}"`
	);
}

// § B -- DIE FALLE: kein `Disallow: /` in robots.txt.
const gesperrteWurzel = robots
	.split("\n")
	.map((z) => z.trim())
	.filter((z) => /^Disallow:\s*\/\s*$/i.test(z));
assert.strictEqual(
	gesperrteWurzel.length,
	0,
	"robots.txt sperrt die Wurzel -- dann wird die Seite nicht gecrawlt, das noindex nie gelesen, " +
		"und sie bleibt als „blockiert\" im Index stehen (genau das Gegenteil des Gewollten)"
);

// § C -- Keine canonical und keine hreflang mehr auf die FREMDE Seite. Eine canonical auf
// inhaltlich anderen Inhalt ist wirkungslos bis schaedlich, und hreflang behauptete, dort laege die
// deutsche Fassung dieser Seite.
for (const muster of [/<link[^>]*rel="canonical"/, /<link[^>]*hreflang=/]) {
	assert.ok(
		!muster.test(html),
		`index.html traegt noch ${muster} -- das gehoert zu einer Seite, die indexiert werden will`
	);
}

// § D -- Die LINK-VORSCHAU zeigt auf den Wirt, der die Datei wirklich hat.
// `avesmaps.de/og-image.jpg` antwortet seit dem Umzug mit HTML statt mit einem Bild.
for (const feld of ["og:url", "og:image", "twitter:image"]) {
	const attribut = feld.startsWith("og:") ? "property" : "name";
	const treffer = new RegExp(`<meta ${attribut}="${feld}" content="([^"]*)"`).exec(html);
	assert.ok(treffer, `<meta ${attribut}="${feld}"> fehlt in index.html`);
	assert.ok(
		treffer[1].startsWith("https://legacy.avesmaps.de/"),
		`${feld} zeigt auf „${treffer[1]}" -- geteilte Links haetten dann keine Vorschau`
	);
}

// § E -- Nirgends mehr die alte Adresse: sie fuehrt in allen drei Dateien ins Leere.
for (const [datei, inhalt] of [["index.html", html], ["robots.txt", robots], ["sitemap.xml", sitemap]]) {
	const alte = [...inhalt.matchAll(/https:\/\/(?:www\.)?avesmaps\.de/g)].filter(
		(m) => !inhalt.slice(Math.max(0, m.index - 7), m.index).endsWith("legacy.")
	);
	assert.strictEqual(alte.length, 0, `${datei}: ${alte.length}x die alte Adresse`);
}

// § F -- Die Sitemap reicht KEINE noindex-Seite ein. Die Startseite traegt noindex; stuende sie
// hier, meldete die Search Console „eingereichte URL als noindex markiert" -- ein Widerspruch, den
// man dann sucht. Das Impressum bleibt drin: es ist die eine Seite, die indexiert bleiben soll.
const adressen = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
assert.ok(adressen.length > 0, "sitemap.xml listet gar nichts mehr");
assert.ok(
	!adressen.includes("https://legacy.avesmaps.de/"),
	"Die Startseite steht in der Sitemap, traegt aber noindex -- das widerspricht sich"
);
assert.ok(
	adressen.some((a) => a.endsWith("/html/impressum.html")),
	"Das Impressum fehlt in der Sitemap -- es soll als einzige Seite auffindbar bleiben"
);

console.log(`seo-noindex-und-vorschau: OK (${adressen.length} Sitemap-Eintrag/Eintraege, Wurzel nicht gesperrt)`);
