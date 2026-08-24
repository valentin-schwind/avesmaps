// Zwei Sperrklinken gegen Wildwuchs, den niemand beschlossen hat. Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node tools/__tests__/sperrklinken.test.js
//
// 🔴 SIE VERLANGEN KEINE VERBESSERUNG, SIE VERBIETEN EINE VERSCHLECHTERUNG. Beide Zahlen sind am
// 24.08.2026 am Bestand gemessen. Sie abzubauen ist Arbeit fuer eigene Sitzungen; hier steht nur,
// dass sie nicht weiter wachsen. Eine Klinke hat kein Ende, sie hat eine Richtung — und im
// Gegensatz zu einem Aufraeumprojekt wirkt sie ab heute.
//
// ⚠️ Die dritte Klinke, stumme catch-Bloecke unter api/, steht in
// api/_internal/__tests__/stumme-catches-test.php — dort, weil sie nur mit PHPs eigenem
// `token_get_all` exakt zu zaehlen ist. Ein Regex sieht Kommentare als Code und zaehlte in beide
// Richtungen falsch.
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const WURZEL = path.join(__dirname, "..", "..");
const lies = (...teile) => fs.readFileSync(path.join(WURZEL, ...teile), "utf8");

/** Alle Dateien unter `start`, die `passt` bejaht. */
function sammle(start, passt, gefunden = []) {
	for (const eintrag of fs.readdirSync(path.join(WURZEL, start), { withFileTypes: true })) {
		const relativ = path.posix.join(start, eintrag.name);
		if (eintrag.isDirectory()) {
			sammle(relativ, passt, gefunden);
		} else if (passt(relativ)) {
			gefunden.push(relativ);
		}
	}
	return gefunden;
}

/** 💣 Der Hausfehler beim Zaehlen: die Prosa erklaert oft genau das, wonach gesucht wird.
 *  Ein Treffer im Kommentar ist kein Befund, sondern die haeufigste Art, eine gruene Zahl zu
 *  bauen, die nichts haelt. (Dieselbe Lehre steht in js/app/__tests__/scope-hint.test.js.) */
function ohneKommentare(quelltext) {
	return quelltext.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

const fehlschlaege = [];

/**
 * Eine Klinke. Steigt der Wert, ist der Test rot und sagt, was zu tun ist; sinkt er, gibt es
 * einen Hinweis statt eines Fehlschlags — in einem geteilten Arbeitsbaum soll niemandes
 * Verbesserung rot sein.
 */
function klinke({ name, wert, obergrenze, spitze, rat }) {
	if (wert > obergrenze) {
		fehlschlaege.push(
			`\nSPERRKLINKE „${name}“: ${wert}, erlaubt sind ${obergrenze}.\n\n${rat}\n` +
			(spitze.length ? `\nAm staerksten betroffen:\n${spitze.map((z) => `    ${z}`).join("\n")}\n` : "") +
			`\nDie Obergrenze in ${path.basename(__filename)} darf SINKEN, nicht steigen.\n`
		);
		return;
	}
	if (wert < obergrenze) {
		console.log(
			`Hinweis: „${name}“ steht bei ${wert} (Obergrenze ${obergrenze}). Bitte die Obergrenze\n` +
			`         auf ${wert} senken — eine Klinke, die nicht nachgezogen wird, gibt den Gewinn zurueck.`
		);
	}
}

// ── Klinke 1: Aufrufstellen, die selbst `fetch(` rufen ─────────────────────────────────────────
//
// 🪤 WARUM. js/app/api-client.js hat 635 Zeilen und wird von genau EINER Datei benutzt; 60 andere
// rufen `fetch(` direkt. Damit erfindet jede Aufrufstelle ihre Fehlerbehandlung neu — 48 Stellen
// in 25 Dateien tragen ein `.catch(() => [] / null)`, und AGENTS.md nennt genau diesen Griff bei
// der Wiki-Zuweisung als den Vertragsbruch, der die echte Zuweisung loescht: „eine Zusage, die mit
// NICHTS aufloest" ist der schlimmere Fall, weil der Kasten dann ruhig „keine Zuweisung" zeigt
// statt einer Fehlermeldung. Der Riegel dagegen steht heute in EINEM Bauteil.
//
// ⚠️ Gezaehlt werden DATEIEN, nicht Aufrufe: eine Datei, die drei Anfragen stellt, ist ein
// Umbauziel, keine drei. Und ohne Kommentare — dieser Block hier erwaehnt `fetch(` selbst.
const FETCH_DATEIEN_OBERGRENZE = 60;

const jsDateien = sammle("js", (p) =>
	p.endsWith(".js") && !p.includes("third-party") && !p.includes("__tests__"));

const mitFetch = jsDateien.filter((p) => /(^|[^.\w])fetch\s*\(/.test(ohneKommentare(lies(p))));

assert.ok(jsDateien.length > 200, `der Sammler findet Browser-Skripte (gefunden: ${jsDateien.length})`);
assert.ok(mitFetch.length > 0, "der Zaehler findet Anfragen — sonst prueft er nichts");

klinke({
	name: "Dateien mit direktem fetch(",
	wert: mitFetch.length,
	obergrenze: FETCH_DATEIEN_OBERGRENZE,
	spitze: [],
	rat:
		"Eine neue Anfrage geht durch den gemeinsamen Weg in js/app/api-client.js, nicht an ihm\n" +
		"vorbei. Der Vertrag dort: bei !response.ok und bei ok:false wird GEWORFEN, nie ein leerer\n" +
		"Rueckfall aufgeloest — sonst haelt der Aufrufer den leeren Zustand fuer „nichts vorhanden“,\n" +
		"und das naechste Speichern loescht, was wirklich da war.",
});

// ── Klinke 2: JavaScript, das in einer HTML-Seite wohnt ────────────────────────────────────────
//
// 🪤 WARUM. 13.988 Zeilen JS liegen inline in den Seiten; html/wiki-sync-settlement-editor.html
// allein traegt 4.314 — mehr als js/review/review-wiki-sync.js vor dem M5-Split hatte. Dieser Code
// ist fuer jedes Werkzeug unsichtbar: kein Linter sieht ihn, kein Test kann ihn `require`n, keine
// Suche nach Dateinamen findet ihn, und wiederverwenden laesst er sich gar nicht.
//
// 💣 Genau dort sass der Fehler vom 24.08.2026: zwei `function setCoatsMenuOpen` in derselben
// Seite, der Klick-Handler damit zweimal registriert — der erste oeffnete das Menue, der zweite
// schloss es im selben Klick. Fuer den Benutzer passierte nichts, und jede einzelne Zeile sah
// richtig aus. In einer .js-Datei heisst diese Regel `no-redeclare`.
const INLINE_JS_ZEILEN_OBERGRENZE = 13988;

const seiten = ["index.html"]
	.concat(sammle("html", (p) => p.endsWith(".html")))
	.concat(sammle("edit", (p) => p.endsWith(".php")));

const inlineJe = seiten
	.map((p) => {
		const quelle = lies(p);
		let zeilen = 0;
		// ⚠️ Nur Bloecke OHNE `src` — ein <script src="…"> hat keinen eigenen Rumpf.
		for (const treffer of quelle.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
			// ⚠️ EIN abschliessender Zeilenumbruch wird abgeschnitten, sonst zaehlt jeder Block eine
			// Zeile zu viel und die Zahl stimmt mit keiner anderen Messung im Haus ueberein.
			zeilen += treffer[1].replace(/\n$/, "").split("\n").length;
		}
		return { seite: p, zeilen };
	})
	.filter((e) => e.zeilen > 0)
	.sort((a, b) => b.zeilen - a.zeilen);

const inlineGesamt = inlineJe.reduce((summe, e) => summe + e.zeilen, 0);

assert.ok(seiten.length > 10, `der Sammler findet Seiten (gefunden: ${seiten.length})`);
assert.ok(inlineGesamt > 1000, "der Zaehler findet Inline-JS — sonst prueft er nichts");

klinke({
	name: "Inline-JS-Zeilen in HTML-Seiten",
	wert: inlineGesamt,
	obergrenze: INLINE_JS_ZEILEN_OBERGRENZE,
	spitze: inlineJe.slice(0, 4).map((e) => `${String(e.zeilen).padStart(5)}  ${e.seite}`),
	rat:
		"Neues JavaScript kommt in eine .js-Datei unter js/pages/ und wird per <script src=…>\n" +
		"eingebunden — dann sieht es ein Linter, kann ein Test es laden, und der Stempler gibt ihm\n" +
		"sein ?v=. Inline waechst nur, was niemand pruefen kann.",
});

// ── Ergebnis ──────────────────────────────────────────────────────────────────────────────────
//
// ⚠️ Kein `assert.fail` hier, und das ist kein Stilbruch: das Deploy-Tor zeigt bei einem roten Test
// `tail -20` seiner Ausgabe. Eine Node-Stapelspur ist zwanzig Zeilen lang und schoebe damit genau
// den Rat aus dem Bild, den diese Klinke geben soll.
if (fehlschlaege.length > 0) {
	process.stderr.write(fehlschlaege.join("\n"));
	process.stderr.write(`\n${fehlschlaege.length} Sperrklinke(n) gerissen.\n`);
	process.exit(1);
}

console.log(`sperrklinken ok (fetch-Dateien ${mitFetch.length}, Inline-JS ${inlineGesamt} Zeilen)`);
