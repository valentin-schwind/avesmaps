// Die Farb-Token aus css/base/tokens.css lesen -- der Ersatz fuer getComputedStyle, den der
// naechtliche Laeufer braucht, weil er kein DOM hat.
//
// 🔴 NUR DER BASIS-BLOCK `:root { … }`, nicht `:root[data-theme="dark"]`. Gemessen am
// 23.08.2026: alle Token, die der Export nachschlaegt (`--color-ecosystem-*`,
// `--color-marker-waypoint`), stehen ausschliesslich im Basis-Block (Zeilen 13-702); der
// Dunkelblock (767-906) ruehrt keinen davon an. Der Abzug ist also themenunabhaengig -- und
// genau das prueft tools/svg-export/__tests__/tokens-tafel.test.js, damit ein spaeter
// dazugekommener Dunkel-Wert nicht lautlos eine zweite Wahrheit aufmacht.
//
// 💣 ERST DIE KOMMENTARE WEG, DANN SUCHEN. Der Kopfkommentar von tokens.css ERKLAERT den
// Dunkelmodus und schreibt dabei `:root[data-theme="dark"]` in Zeile 9 -- ein `indexOf(":root")`
// auf dem Rohtext landet also im Fliesstext und nicht im Block. Die erste Fassung tat genau
// das und kam nur deshalb aufs richtige Ergebnis, weil die naechste `{` zufaellig die des
// echten Blocks war. Wer hier eine Zeile umstellt, verliert diesen Zufall.
"use strict";

const fs = require("fs");

function svgxOhneKommentare(css) {
	return String(css).replace(/\/\*[\s\S]*?\*\//g, "");
}

// Der Block hinter einem Selektor, ueber die KLAMMERN gezaehlt -- nicht bis zum ersten `}`.
// 💣 In :root stehen @media-Schachtelungen; wer beim ersten `}` aufhoert, bekommt einen
// Bruchteil der Tafel, und alles danach faellt still auf den Rueckfallbeige zurueck.
function svgxBlockNach(css, selektorMuster, name) {
	const treffer = selektorMuster.exec(css);
	if (!treffer) { throw new Error(`tokens.css: kein ${name}-Block gefunden`); }
	const auf = css.indexOf("{", treffer.index);
	let tiefe = 0;
	for (let i = auf; i < css.length; i += 1) {
		if (css[i] === "{") { tiefe += 1; }
		else if (css[i] === "}") {
			tiefe -= 1;
			if (tiefe === 0) { return css.slice(auf + 1, i); }
		}
	}
	throw new Error(`tokens.css: ${name}-Block wird nie geschlossen`);
}

// ⚠️ `:root\s*\{` trifft den Basis-Block und NICHT `:root[data-theme="dark"] {` -- die eckige
// Klammer steht dazwischen. Das ist die ganze Unterscheidung; sie hier zu verlieren hiesse,
// den Abzug im dunklen Thema zu bauen.
function svgxRootBlock(css) {
	return svgxBlockNach(svgxOhneKommentare(css), /:root\s*\{/, ":root");
}

function svgxDarkBlock(css) {
	return svgxBlockNach(svgxOhneKommentare(css), /:root\[data-theme=["']dark["']\]\s*\{/, "dunkel");
}

// `--name: wert;` -> {name: wert}
function svgxTokenTafelAusCss(css) {
	const tafel = {};
	const muster = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi;
	let treffer;
	const block = svgxRootBlock(css);
	while ((treffer = muster.exec(block)) !== null) {
		tafel[treffer[1]] = treffer[2].trim();
	}
	return tafel;
}

// Ein Nachschlager in der Form, die svg-export-farben.js erwartet: `(name) -> string`,
// leerer String, wenn es den Token nicht gibt (so verhaelt sich getComputedStyle auch).
function svgxTokenLeser(pfadZuTokensCss) {
	const tafel = svgxTokenTafelAusCss(fs.readFileSync(pfadZuTokensCss, "utf8"));
	const leser = (name) => tafel[name] || "";
	leser.tafel = tafel;
	return leser;
}

module.exports = {
	svgxOhneKommentare: svgxOhneKommentare,
	svgxBlockNach: svgxBlockNach,
	svgxRootBlock: svgxRootBlock,
	svgxDarkBlock: svgxDarkBlock,
	svgxTokenTafelAusCss: svgxTokenTafelAusCss,
	svgxTokenLeser: svgxTokenLeser,
};
