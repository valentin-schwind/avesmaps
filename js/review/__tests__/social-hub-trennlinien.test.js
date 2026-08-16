"use strict";
// Die Trennlinien der Zeilengruppen im Social-Media-Hub.
//
// 💣 GEPRÜFT WIRD DIE NACHBARSCHAFT IM MARKUP, NICHT DIE FARBE DER LINIE. Hier stand von der
// Geburt des Hubs an (df98d70c, 10.08.2026) bis zum 16.08.2026 die Regel
//   .social-hub__radio:first-of-type { border-top: 0 }
// und sie hat NIE getroffen: `:first-of-type` meint das erste Geschwister desselben TAGS. Die
// Zeilen sind <label> -- und vor ihnen stehen die <label class="social-hub__label"> der
// Gruppenüberschriften. Das erste <label> der Spalte ist also die Titelzeile, nie eine Radiozeile.
// Eine tote CSS-Regel sagt nichts, bricht nichts und fällt in keinem Test auf; sie stand fünf Tage
// da, und gesehen hat es erst jemand, der aus einem anderen Grund in die Datei sah.
//
// Deshalb prüft dieser Test das EINZIGE, woran so etwas messbar ist: liegt die Zeile, die keine
// Linie tragen soll, wirklich hinter einer Überschrift -- und die, die eine tragen soll, wirklich
// hinter ihresgleichen? Genau diese Nachbarschaft setzt der Nachbarschaftsselektor `X + X` voraus.
// Verschiebt jemand das Markup, ist die Regel wieder tot, und zwar lautlos.
//
// Vom Repo-Wurzelverzeichnis aus:
//   node js/review/__tests__/social-hub-trennlinien.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const WURZEL = path.join(__dirname, "..", "..", "..");
const html = fs.readFileSync(path.join(WURZEL, "index.html"), "utf8");
const cssMitProsa = fs.readFileSync(path.join(WURZEL, "css", "components", "social-hub.css"), "utf8");
// 🪤 Erster Lauf dieses Tests: er schlug an -- am ERKLÄRTEXT über der reparierten Regel, in dem das
// Wort `:first-of-type` vorkommt. Genau andersherum wäre es schlimmer: eine Regel, die nur in einem
// auskommentierten Block steht, hätte den Test bestanden, ohne je zu wirken. Also nur echte Regeln.
const css = cssMitProsa.replace(/\/\*[\s\S]*?\*\//g, "");

// ---- ein Mindest-Scanner für DIREKTE Kinder ------------------------------------------------------
// ⚠️ Bewusst kein DOM: die Tests hier laufen mit blankem node. Gebraucht wird auch nur eines --
// die Reihenfolge der Geschwister EINER Ebene. Die Verschachtelung muss trotzdem stimmen, sonst
// zählte das <label class="social-hub__soft"> im Bild-Kästchen als Geschwister der Radiozeilen.
const LEERE_ELEMENTE = new Set([
	"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr",
]);

function klasseVon(attribute) {
	const treffer = /\bclass\s*=\s*"([^"]*)"/.exec(attribute);
	return treffer ? treffer[1].split(/\s+/).filter(Boolean) : [];
}

function direkteKinder(quelltext, startIndex) {
	const tags = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g;
	tags.lastIndex = startIndex;
	const kinder = [];
	let tiefe = 0;
	let m;
	while ((m = tags.exec(quelltext)) !== null) {
		const schliessend = m[1] === "/";
		const tag = m[2].toLowerCase();
		const attribute = m[3];
		if (schliessend) {
			tiefe--;
			if (tiefe === 0) break;
			continue;
		}
		if (LEERE_ELEMENTE.has(tag) || /\/\s*$/.test(attribute)) {
			if (tiefe === 1) kinder.push({ tag: tag, klassen: klasseVon(attribute) });
			continue;
		}
		tiefe++;
		if (tiefe === 2) kinder.push({ tag: tag, klassen: klasseVon(attribute) });
	}
	return kinder;
}

// Kommentare raus: in ihnen stehen <label>- und <small>-Erwähnungen, die kein Element sind.
const ohneKommentare = html.replace(/<!--[\s\S]*?-->/g, "");
const start = ohneKommentare.indexOf('<div class="social-hub__main">');
assert.ok(start !== -1, "die Spalte .social-hub__main muss in index.html stehen");

const zeilen = direkteKinder(ohneKommentare, start);
const hat = (kind, name) => kind.klassen.indexOf(name) !== -1;
const index = (name) => zeilen.findIndex((k) => hat(k, name));

// ---- der Bestand ---------------------------------------------------------------------------------

const radios = zeilen.filter((k) => hat(k, "social-hub__radio"));
const haken = zeilen.filter((k) => hat(k, "social-hub__check"));
assert.strictEqual(radios.length, 2, "zwei Lizenzzeilen: eigenes Werk und freie Lizenz");
assert.strictEqual(haken.length, 1, "eine KI-Zeile");

// ---- warum `:first-of-type` hier nie treffen konnte -----------------------------------------------
// 🪤 Diese Zusicherung sieht nach einer Selbstverständlichkeit aus und ist der ganze Befund: das
// erste <label> der Spalte gehört einer ÜBERSCHRIFT. Wer `:first-of-type` wieder einsetzt, trifft
// sie und keine Zeile.
const erstesLabel = zeilen.find((k) => k.tag === "label");
assert.ok(erstesLabel && hat(erstesLabel, "social-hub__label"),
	"das erste <label> der Spalte ist eine Gruppenüberschrift -- deshalb ist `:first-of-type` hier blind");
assert.ok(!/:first-of-type/.test(css),
	"`:first-of-type` gehört nicht in diese Datei: die Zeilen sind <label> zwischen lauter <label>");

// ---- die Nachbarschaft, auf der `X + X` steht -----------------------------------------------------

const erstesRadio = index("social-hub__radio");
assert.ok(hat(zeilen[erstesRadio - 1], "social-hub__label"),
	"vor der ersten Lizenzzeile steht ihre Überschrift -- dort trennt schon die Überschrift, also KEINE Linie");
assert.ok(hat(zeilen[erstesRadio + 1], "social-hub__radio"),
	"die zweite Lizenzzeile folgt unmittelbar auf die erste -- nur so greift `.social-hub__radio + .social-hub__radio`");

const derHaken = index("social-hub__check");
assert.ok(hat(zeilen[derHaken - 1], "social-hub__label"),
	"vor der KI-Zeile steht ihre Überschrift -- sie trägt aus demselben Grund keine Linie");

// ---- und die Regel selbst -------------------------------------------------------------------------
// ⚠️ Geprüft wird die FORM der Regel, nicht ihre Wirkung -- ohne DOM ist die Kaskade nicht messbar.
// Die Wirkung hängt an genau zwei Dingen: dieser Form und der Nachbarschaft oben.
assert.ok(/\.social-hub__radio\s*\+\s*\.social-hub__radio/.test(css),
	"die Linie sitzt ZWISCHEN zwei Lizenzzeilen");
assert.ok(/\.social-hub__check\s*\+\s*\.social-hub__check/.test(css),
	"und zwischen zwei KI-Zeilen -- heute gibt es nur eine, aber die Gruppe daneben soll gleich aussehen");

// 💣 Die Kanalliste löst dasselbe Problem mit `:first-child`, und DAS trifft, weil eine Kanalzeile
// ein <div> ist und erstes Kind ihres Containers. Sie ist der Maßstab, an dem die beiden Gruppen
// oben seit dem 16.08.2026 gemessen werden -- fällt sie weg, ist die Begründung oben ohne Anker.
assert.ok(/\.social-hub__channel-row:first-child\s*\{[^}]*border-top:\s*0/.test(css),
	"die Kanalliste bleibt die Vorlage: über ihrer ersten Zeile steht ebenfalls keine Linie");

console.log("ok - social-hub-trennlinien: " + zeilen.length + " Geschwister in .social-hub__main geprüft");
