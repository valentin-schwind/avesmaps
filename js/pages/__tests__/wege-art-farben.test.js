// Die Farben der Wegarten bleiben lesbar -- in BEIDEN Themen.
//
// 🔴 DIESER TEST RECHNET, ER SCHAUT NICHT. Kontrast ist die eine Eigenschaft einer Farbe, die man
// mit blossem Auge zuverlaessig falsch einschaetzt: eine Farbe kann huebsch aussehen und trotzdem
// unter der Lesbarkeitsgrenze liegen. Ohne diesen Test hellt irgendwann jemand einen Wert auf,
// weil er "zu duester" wirkt, und niemand merkt, dass die Schrift damit unlesbar wird.
//
// 💣 GENAU DAS IST BEIM BAU PASSIERT. Die erste Fassung rechnete gegen --color-panel-soft
// (#faf6ee) und landete bei 4,27 bis 4,38 -- knapp unter der Grenze. Der echte Grund der
// Editorseite ist aber --color-page-bg (#f3f0e8), etwas dunkler. Gezeigt hat es erst die Messung
// in der laufenden Seite, nicht die Rechnung daneben. Deshalb nimmt dieser Test die Werte aus
// tokens.css und den Grund aus DEMSELBEN Token-Block.
//
// ⚠️ Reichsstrasse, Strasse und Weg haben bewusst KEIN eigenes Token -- ihre Kartenfarben sind
// Weiss, Grau und Hellwarm, als Text waere das Rauschen. Sie tragen die normale Schriftfarbe und
// stehen deshalb nicht in dieser Liste.
//
// Entwurf: docs/wegearten-farben-mockup.html
// Run: node js/pages/__tests__/wege-art-farben.test.js

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..", "..", "..");
const tokens = fs.readFileSync(path.join(root, "css", "base", "tokens.css"), "utf8");
const wegeCss = fs.readFileSync(path.join(root, "css", "pages", "wege-editor.css"), "utf8");
const wegeJs = fs.readFileSync(path.join(root, "js", "pages", "wege-editor.js"), "utf8");

const ARTEN = ["pfad", "gebirgspass", "wuestenpfad", "flussweg", "seeweg"];
const GRENZE = 4.5; // WCAG AA fuer kleine Schrift

let checks = 0;

// ---- Farbrechnung ------------------------------------------------------------------------------
function kanaele(hex) {
	const h = hex.replace("#", "").trim();
	return [0, 2, 4].map((i) => parseInt(h.substr(i, 2), 16));
}
function helligkeit(hex) {
	const c = kanaele(hex).map((v) => {
		const x = v / 255;
		return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
	});
	return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function kontrast(a, b) {
	const l1 = helligkeit(a), l2 = helligkeit(b);
	const [hoch, tief] = l1 > l2 ? [l1, l2] : [l2, l1];
	return (hoch + 0.05) / (tief + 0.05);
}

// ---- Die zwei Token-Bloecke trennen -------------------------------------------------------------
// Der dunkle beginnt bei :root[data-theme="dark"]; alles davor ist das helle Thema.
// 💣 KOMMENTARE ZUERST RAUS. tokens.css ERWAEHNT diesen Selektor schon in Zeile 9, um zu
// begruenden, warum das dunkle Thema nicht an prefers-color-scheme haengt. Ein indexOf ueber den
// Rohtext findet die Erwaehnung statt der Regel und schneidet den hellen Block nach neun Zeilen ab
// -- dann fehlt scheinbar jedes Token. Derselbe Fehler ist mir in dieser Sitzung dreimal
// unterlaufen (zweimal im Panel-Wachtest): in einem Projekt, das seine Regeln IM Stylesheet
// begruendet, muss jeder CSS-Test die Kommentare entfernen, bevor er etwas sucht.
const tokensOhneKommentare = tokens.replace(/\/\*[\s\S]*?\*\//g, "");
const dunkelStart = tokensOhneKommentare.indexOf(':root[data-theme="dark"]');
assert.ok(dunkelStart > 0, 'Der Block :root[data-theme="dark"] fehlt in tokens.css.');
checks++;

const bloecke = {
	hell: tokensOhneKommentare.slice(0, dunkelStart),
	dunkel: tokensOhneKommentare.slice(dunkelStart),
};

function wert(block, name) {
	const treffer = block.match(new RegExp("--" + name + ":\\s*(#[0-9a-fA-F]{6})"));
	return treffer ? treffer[1] : null;
}

// ---- 1. Jede Art hat in BEIDEN Themen einen Wert ------------------------------------------------
for (const [thema, block] of Object.entries(bloecke)) {
	const grund = wert(block, "color-page-bg");
	assert.ok(grund, `--color-page-bg fehlt im ${thema}en Themenblock.`);
	checks++;

	for (const art of ARTEN) {
		const farbe = wert(block, "color-path-" + art);
		assert.ok(farbe,
			`--color-path-${art} fehlt im ${thema}en Themenblock. Eine Farbe, die nur ein Thema `
			+ "kennt, faellt im anderen auf den Wert des ersten zurueck -- und der ist dort gebaut, "
			+ "um sich vom GEGENTEILIGEN Grund abzuheben.");
		checks++;

		const k = kontrast(farbe, grund);
		assert.ok(k >= GRENZE,
			`--color-path-${art} (${farbe}) hat im ${thema}en Thema nur ${k.toFixed(2)} Kontrast `
			+ `gegen ${grund}. Die Untergrenze fuer kleine Schrift ist ${GRENZE}. `
			+ "Die Kartenfarbe ist fuer eine LINIE auf heller Karte gewaehlt, nicht fuer SCHRIFT -- "
			+ "sie muss fuer die Beschriftung nachgezogen werden, nicht uebernommen.");
		checks++;
	}
}

// ---- 2. Die Farbe steht im Stylesheet, nicht im JavaScript --------------------------------------
// AGENTS.md §12: nie eine Farbe hartkodieren, und schon gar nicht im Code.
for (const art of ARTEN) {
	assert.ok(new RegExp("\\.avm-row__kind--" + art + "\\s*\\{[^}]*var\\(--color-path-" + art + "\\)").test(wegeCss),
		`css/pages/wege-editor.css hat keine Regel .avm-row__kind--${art}, die var(--color-path-${art}) benutzt.`);
	checks++;
}
assert.ok(!/#[0-9a-fA-F]{6}/.test(wegeJs.split("\n").filter((z) => /avm-row__kind/.test(z)).join("\n")),
	"js/pages/wege-editor.js schreibt eine Farbe direkt an die Art-Beschriftung. Die Farbe gehoert "
	+ "ins Stylesheet; der Renderer vergibt nur die Klasse.");
checks++;

// ---- 3. Der Klassenname faellt aus dem Subtyp-Schluessel, ohne Zuordnungstabelle -----------------
// ⚠️ PATH_SUBTYPE_KEYS sind stabile Datenschluessel (AGENTS.md §2) und werden nie uebersetzt --
// deshalb genuegt Kleinschreiben. Eine Tabelle waere eine zweite Wahrheit.
assert.ok(/function subtypeClass\(subtype\)[\s\S]{0,220}toLowerCase\(\)/.test(wegeJs),
	"subtypeClass() leitet den Klassennamen nicht mehr per toLowerCase aus dem Subtyp ab.");
checks++;

console.log(`wege-art-farben: ${checks} Pruefungen bestanden (${ARTEN.length} Arten x 2 Themen).`);
