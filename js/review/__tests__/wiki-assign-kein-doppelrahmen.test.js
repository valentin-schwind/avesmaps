// Der Kasten „Wiki-Weg" (und „Wiki-Ort") steckte in ZWEI ineinanderliegenden Rahmen.
// Owner 31.08.2026: „‚Wiki-Weg' in einem doppelten rahmen steckt".
//
// 🔴 DAS BAUTEIL ZEICHNET SEINEN EIGENEN KASTEN. `js/ui/wiki-assign.js` erzeugt die Hülle
// `.label-wiki-reference` -- Rand, Radius, Hintergrund, Polsterung -- UND die Überschrift darin.
// Ein `.label-edit-section` darum herum ist deshalb ein zweiter, leerer Kasten: gemessen am
// 31.08.2026 hatten beide dieselbe Randfarbe (rgb(81,74,60)), denselben Hintergrund
// (rgb(49,46,38)) und je eigene Polsterung.
// ⚠️ Der Unterschied zu „Andere Quelle": DORT trägt der äussere Kasten die Überschrift, hat also
// eine Aufgabe. Beim Wiki-Kasten enthält er nichts als den inneren.
//
// ⭐ Der Label-Editor machte es von Anfang an richtig (blankes div) -- er ist die Referenzform,
// nach der die anderen gerichtet wurden, kein neues Muster.
//
// Aus der Wurzel des Repos:  node js/review/__tests__/wiki-assign-kein-doppelrahmen.test.js

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..", "..");
const html = fs.readFileSync(path.join(repoRoot, "index.html"), "utf8").replace(/\r\n/g, "\n");

// 💣 Der Selektor sucht den BEHAELTER, nicht den Host: gesucht wird die Bauform
// `<div class="label-edit-section"><div id="…-wiki-assign-host">`, und die darf es nirgends geben.
const doppelt = [...html.matchAll(/<div class="label-edit-section"><div id="([a-z-]*-wiki-assign-host)"/g)]
	.map((treffer) => treffer[1]);
assert.deepStrictEqual(doppelt, [],
	"kein Wiki-Kasten steckt in einem .label-edit-section -- gefunden: " + JSON.stringify(doppelt));

// Die Gegenprobe: es gibt die Hosts ueberhaupt noch. Ohne sie waere die Zusicherung oben Vakuum.
const hosts = [...html.matchAll(/id="([a-z-]*-wiki-assign-host)"/g)].map((t) => t[1]);
assert.deepStrictEqual(hosts.sort(), [
	"label-wiki-assign-host",
	"path-wiki-assign-host",
	"settlement-wiki-assign-host",
	"territory-wiki-assign-host",
], "die vier Wiki-Kaesten stehen weiterhin in index.html");

// ⚠️ Und der Rahmen des Bauteils bleibt: entfernt jemand den INNEREN statt des aeusseren, steht der
// Kasten ohne jede Kante da. Die Regel dafuer liegt in css/components/region-sync.css.
const css = fs.readFileSync(path.join(repoRoot, "css/components/region-sync.css"), "utf8").replace(/\r\n/g, "\n");
assert.ok(/\.label-wiki-reference\s*\{[^}]*border:\s*1px solid/.test(css),
	".label-wiki-reference zeichnet weiterhin seinen eigenen Rand");

console.log("wiki-assign-kein-doppelrahmen: alle Zusicherungen erfuellt");
