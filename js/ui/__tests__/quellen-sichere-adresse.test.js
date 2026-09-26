// Nur eine http(s)-Adresse wird ein Link -- in der Infobox, im Quellen-Editor und im Staetten-Kasten.
//
// 💣 WARUM ES DAS GIBT (26.09.2026): `feature-source-markup.js` setzte jede Katalogadresse als
// `href="' + esc(url) + '"`. Maskieren verhindert nur den Ausbruch aus dem Attribut -- eine Quelle mit
// `url = "javascript:alert(1)"` waere ein klickbarer Link gewesen, der Code ausfuehrt, in der Infobox,
// die JEDER Besucher sieht. Live gemessen am selben Tag: 3.917 Katalogquellen, 3.538 https, 20 http,
// 359 ohne Adresse, KEINE andere -- die Luecke stand offen, war aber unbenutzt.
//
// 🔴 Die Regel gibt es GENAU EINMAL (featureSourceSichereUrl, js/ui/feature-source-markup.js). Dieser
// Test FUEHRT sie aus und rendert danach jede Oberflaeche mit boesen Adressen: jeder `href`, der dabei
// herauskommt, muss mit http:// oder https:// beginnen. „Die Funktion existiert" beweist nichts; ein
// Erzeuger, der an ihr vorbeilaeuft, faellt nur so auf.
//
// Aus der Wurzel des Repos:  node js/ui/__tests__/quellen-sichere-adresse.test.js

"use strict";

const assert = require("node:assert");
const path = require("node:path");

const WURZEL = path.resolve(__dirname, "..", "..", "..");
const markup = require(path.join(WURZEL, "js/ui/feature-source-markup.js"));
const editor = require(path.join(WURZEL, "js/review/review-feature-sources.js"));
const kasten = require(path.join(WURZEL, "js/ui/staetten-kasten.js"));

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
	"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[c]));
const tr = (_k, fallback) => fallback;

// Die boesen Adressen. ⚠️ Das Leerzeichen und das Steuerzeichen DAVOR sind die Faelle, an denen eine
// Regel ohne Anker scheitert: der Browser wirft beides weg, bevor er das Schema liest.
const BOESE = [
	"javascript:alert(1)",
	"JaVaScRiPt:alert(1)",
	" javascript:alert(1)",
	"\u0001javascript:alert(1)",
	"data:text/html,<script>alert(1)</script>",
	"vbscript:msgbox(1)",
	// ⚠️ traegt "https://" WEITER HINTEN -- faengt eine Regel, der der Anker `^` fehlt.
	"javascript:fetch('https://boese.de')",
	"ftp://beispiel.de/x",
	"https:beispiel.de",
	"//beispiel.de/protokollrelativ",
	"/uploads/relativ.pdf",
	"beispiel.de/ohne-schema",
];

/** Alle href-Werte eines Markups, zurueckmaskiert. */
function hrefs(html) {
	const aus = [];
	const muster = /href="([^"]*)"/g;
	let treffer;
	while ((treffer = muster.exec(html)) !== null) {
		aus.push(treffer[1].replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">")
			.replace(/&#39;/g, "'").replace(/&amp;/g, "&"));
	}
	return aus;
}

function alleHrefsSicher(html, wo) {
	for (const wert of hrefs(html)) {
		assert.ok(/^https?:\/\//i.test(wert), wo + ": unsicherer href " + JSON.stringify(wert) + "\n" + html);
	}
}

let pruefungen = 0;

// ══ 1. Der Helfer selbst ═════════════════════════════════════════════════════════════════════════
{
	const f = markup.featureSourceSichereUrl;
	assert.strictEqual(typeof f, "function", "featureSourceSichereUrl muss exportiert sein");
	for (const boese of BOESE) {
		assert.strictEqual(f(boese), "", "boese Adresse durchgelassen: " + JSON.stringify(boese));
		pruefungen++;
	}
	for (const leer of ["", "   ", null, undefined, 0, false, {}, []]) {
		assert.strictEqual(f(leer), "", "leer/kaputt durchgelassen: " + JSON.stringify(leer));
		pruefungen++;
	}
	assert.strictEqual(f("https://beispiel.de/a?b=1"), "https://beispiel.de/a?b=1");
	assert.strictEqual(f("http://beispiel.de"), "http://beispiel.de");
	assert.strictEqual(f("HTTPS://Beispiel.de"), "HTTPS://Beispiel.de", "Gross/Klein egal");
	assert.strictEqual(f("  https://beispiel.de  "), "https://beispiel.de", "getrimmt zurueck");
	pruefungen += 4;
	console.log("1. Helfer: OK");
}

// ══ 2. Infobox: jede Zeile, jede Tafel, mit jeder boesen Adresse ═══════════════════════════════════
{
	for (const boese of BOESE) {
		const html = markup.buildSourceListMarkup(boese, [
			// eigene Quelle (Zeile 1) -- Link im Titel UND Adresszeile hinter dem ⓘ
			{ url: boese, label: "Eigene Quelle", type: "briefspiel", official: false },
			// Publikation (Tabelle) -- Link in der Titelzelle
			{ url: boese, label: "Publikation", type: "quellenband", official: true, reference_kind: "ausfuehrlich", pages: "12" },
			{ url: boese, label: "Erwaehnung", type: "abenteuer", official: true, reference_kind: "erwaehnung" },
		], {
			wikiOfficial: true,
			wikiLabel: "Wiki Aventurica",
			wikiLicenseLabel: "CC BY-SA 3.0",
			wikiLicenseUrl: boese,
		});
		alleHrefsSicher(html, "Infobox mit " + JSON.stringify(boese));
		// Der TEXT bleibt stehen -- ohne sichere Adresse zeigt die Zeile ihren Namen, keinen Link.
		assert.ok(html.includes("Eigene Quelle"), "Name der eigenen Quelle fehlt");
		assert.ok(html.includes("Publikation"), "Name der Publikation fehlt");
		assert.ok(html.includes("Wiki Aventurica"), "Name der Wiki-Zeile fehlt");
		assert.ok(html.includes("CC BY-SA 3.0"), "Lizenzname der Wiki-Zeile fehlt");
		assert.ok(html.includes('<span class="fs-src-plain">'), "unsicherer Link muss als .fs-src-plain stehen");
		pruefungen += 6;
	}

	// Gegenprobe: dieselben Zeilen mit sicherer Adresse sind WIRKLICH Links -- sonst waere der
	// Test oben auch gruen, wenn gar nichts mehr verlinkt wird.
	const gut = markup.buildSourceListMarkup("https://de.wiki-aventurica.de/wiki/Gareth", [
		{ url: "https://beispiel.de/eigen", label: "Eigene Quelle", type: "briefspiel", official: false },
		{ url: "http://beispiel.de/pub", label: "Publikation", type: "quellenband", official: true, reference_kind: "ausfuehrlich" },
	], { wikiOfficial: true, wikiLicenseLabel: "CC BY-SA 3.0", wikiLicenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/de/" });
	const guteHrefs = hrefs(gut);
	for (const erwartet of [
		"https://de.wiki-aventurica.de/wiki/Gareth",
		"https://beispiel.de/eigen",
		"http://beispiel.de/pub",
		"https://creativecommons.org/licenses/by-sa/3.0/de/",
	]) {
		assert.ok(guteHrefs.includes(erwartet), "sichere Adresse nicht verlinkt: " + erwartet + "\n" + gut);
		pruefungen++;
	}
	// Der href traegt die GEPRUEFTE Adresse (getrimmt), nicht die rohe -- sonst waere der Helfer nur
	// ein Torwaechter, und was durchgeht, waere nicht das, was er geprueft hat.
	const rand = markup.buildSourceListMarkup("", [
		{ url: "  https://beispiel.de/rand  ", label: "Mit Rand", type: "briefspiel", license: "cc-by-sa-4.0" },
	], { wikiLicenseLabel: "CC", wikiLicenseUrl: "  https://beispiel.de/lizenz  " });
	const mitRand = (h) => h !== h.trim();
	assert.ok(hrefs(rand).includes("https://beispiel.de/rand"), "Titel-href nicht getrimmt\n" + rand);
	assert.ok(!hrefs(rand).some(mitRand), "ein href traegt Leerzeichen am Rand\n" + rand);
	const randWiki = markup.buildSourceListMarkup("  https://beispiel.de/wiki  ", [], {
		wikiLicenseLabel: "CC", wikiLicenseUrl: "  https://beispiel.de/lizenz  ",
	});
	assert.ok(hrefs(randWiki).includes("https://beispiel.de/lizenz"), "Lizenz-href nicht getrimmt\n" + randWiki);
	assert.ok(!hrefs(randWiki).some(mitRand), "ein href traegt Leerzeichen am Rand\n" + randWiki);
	pruefungen += 4;
	// Die Adresszeile hinter dem ⓘ verlinkt die sichere Adresse ebenfalls ...
	assert.ok(gut.includes('class="fs-src-rights-url" href="https://beispiel.de/eigen"'), "Adresszeile nicht verlinkt");
	// ... und zeigt die unsichere als TEXT, damit ein Editor sieht, was er reparieren muss.
	const schlechtTafel = markup.buildSourceListMarkup("", [
		{ url: "javascript:alert(1)", label: "Eigene Quelle", type: "briefspiel", official: false },
	], {});
	assert.ok(schlechtTafel.includes("<dd>javascript:alert(1)</dd>"), "unsichere Adresse muss in der Tafel als Text stehen\n" + schlechtTafel);
	pruefungen += 2;
	console.log("2. Infobox: OK");
}

// ══ 3. Die Lizenzzeile hinter dem ⓘ liest ihre Adresse aus der festen Tafel -- auch durch den Helfer ══
{
	const tafel = markup.FEATURE_SOURCE_LICENSES;
	const schluessel = Object.keys(tafel).find((k) => tafel[k] && tafel[k].url);
	assert.ok(schluessel, "keine Lizenz mit Adresse in FEATURE_SOURCE_LICENSES");
	const vorher = tafel[schluessel].url;
	try {
		tafel[schluessel].url = "javascript:alert(1)";
		const html = markup.buildSourceListMarkup("", [
			{ url: "https://beispiel.de/x", label: "Mit Lizenz", type: "briefspiel", license: schluessel },
		], {});
		alleHrefsSicher(html, "Lizenz-Marke");
		assert.ok(!html.includes("javascript:"), "die unsichere Lizenzadresse darf nirgends stehen\n" + html);
		pruefungen += 2;
	} finally {
		tafel[schluessel].url = vorher;
	}
	console.log("3. Lizenz-Marke: OK");
}

// ══ 4. Quellen-Editor: Quellenzeile (mit und ohne Marke) und Wiki-Zeile ════════════════════════════
{
	for (const boese of BOESE) {
		for (const quelle of [
			{ source_id: 5, url: boese, label: "Eigene Quelle", type: "briefspiel" },
			// mit Marke „2 von 3 Abschnitten" -- der zweite Zweig des Zeilenbauers
			{ source_id: 5, url: boese, label: "Eigene Quelle", type: "briefspiel", segments: 2, segments_of: 3 },
		]) {
			const zeile = editor.renderFeatureSourceRow(quelle, esc, tr, true);
			alleHrefsSicher(zeile, "Editorzeile mit " + JSON.stringify(boese));
			assert.ok(zeile.includes("Eigene Quelle"), "Name fehlt in der Editorzeile");
			assert.ok(zeile.includes("data-remove-source-id"), "das ✕ muss bleiben -- dort repariert man");
			pruefungen += 3;
		}
		const wiki = editor.renderFeatureSourceWikiRow(boese, esc, tr);
		alleHrefsSicher(wiki, "Editor-Wikizeile mit " + JSON.stringify(boese));
		assert.ok(wiki.includes("Wiki Aventurica"), "Name der Wiki-Zeile fehlt");
		assert.ok(!wiki.includes("↗"), "ohne Link kein Pfeil");
		pruefungen += 3;
	}
	const gut = editor.renderFeatureSourceRow({ source_id: 5, url: "https://beispiel.de/eigen", label: "X", type: "briefspiel" }, esc, tr, true);
	assert.ok(hrefs(gut).includes("https://beispiel.de/eigen"), "sichere Adresse im Editor nicht verlinkt\n" + gut);
	const gutMarke = editor.renderFeatureSourceRow({ source_id: 5, url: "https://beispiel.de/eigen", label: "X", type: "briefspiel", segments: 2, segments_of: 3 }, esc, tr, true);
	assert.ok(hrefs(gutMarke).includes("https://beispiel.de/eigen"), "sichere Adresse mit Marke nicht verlinkt\n" + gutMarke);
	const gutWiki = editor.renderFeatureSourceWikiRow("https://de.wiki-aventurica.de/wiki/Gareth", esc, tr);
	assert.ok(hrefs(gutWiki).includes("https://de.wiki-aventurica.de/wiki/Gareth"), "Wiki-Zeile nicht verlinkt");
	pruefungen += 3;
	console.log("4. Quellen-Editor: OK");
}

// ══ 5. Beide Weiterreicher fragen WIRKLICH die geteilte Regel (Spion, zur Laufzeit) ════════════════
{
	const vorher = markup.featureSourceSichereUrl;
	const aufrufe = [];
	markup.featureSourceSichereUrl = function (url) {
		aufrufe.push(url);
		return vorher(url);
	};
	try {
		editor.renderFeatureSourceRow({ source_id: 1, url: "https://a.de/editor", label: "A", type: "briefspiel" }, esc, tr, true);
		editor.renderFeatureSourceWikiRow("https://a.de/wiki", esc, tr);
		const verlinkbar = kasten.staettenKastenIstVerlinkbareAdresse("https://a.de/kasten");
		assert.strictEqual(verlinkbar, true);
		assert.ok(aufrufe.includes("https://a.de/editor"), "Editorzeile fragt nicht die geteilte Regel");
		assert.ok(aufrufe.includes("https://a.de/wiki"), "Editor-Wikizeile fragt nicht die geteilte Regel");
		assert.ok(aufrufe.includes("https://a.de/kasten"), "Staetten-Kasten fragt nicht die geteilte Regel");
		pruefungen += 4;
		// Und die ANTWORT kommt von dort: sagt die geteilte Regel nein, sagt der Kasten nein.
		markup.featureSourceSichereUrl = () => "";
		assert.strictEqual(kasten.staettenKastenIstVerlinkbareAdresse("https://a.de/kasten"), false);
		pruefungen++;
	} finally {
		markup.featureSourceSichereUrl = vorher;
	}
	for (const boese of BOESE) {
		assert.strictEqual(kasten.staettenKastenIstVerlinkbareAdresse(boese), false, "Kasten: " + JSON.stringify(boese));
		pruefungen++;
	}
	console.log("5. Weiterreicher: OK");
}

console.log("quellen-sichere-adresse: " + pruefungen + " Pruefungen, alle gruen");
