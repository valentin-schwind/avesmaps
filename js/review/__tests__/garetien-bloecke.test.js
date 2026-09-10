"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const quelle = fs.readFileSync(
	path.join(__dirname, "..", "review-garetien-importer.js"), "utf8");

const a = quelle.indexOf("function garetienEingefuegtWirdMarkup");
assert.ok(a > -1);
const rumpf = quelle.slice(a, quelle.indexOf("\n\t}", a));

// 🔴 Owner 09.09.2026: „die sind alle auf der stage erst wichtig". Darstellung sowie Wiki &
// Quellen erscheinen NUR, wenn das Objekt auf der Stage liegt -- auf „Offen" entscheidet ein
// Editor zwei Dinge: ueberhaupt? und als was? Alles andere steht dort nur im Weg, bei jeder
// der 8237 Zeilen.
assert.ok(rumpf.indexOf("avesmapsGaretienStageHat") > -1,
	"der Kasten fragt nicht, ob das Objekt auf der Stage liegt");

// Form und Art bleiben sichtbar -- sie sind die Antwort auf „als was?".
const zielWahl = rumpf.indexOf("garetienZielWahlMarkup");
const stageFrage = rumpf.indexOf("avesmapsGaretienStageHat");
assert.ok(zielWahl > -1 && zielWahl < stageFrage,
	"Form und Art stehen hinter der Stage-Bedingung und verschwinden auf Offen");

console.log("OK -- garetien-bloecke");
