// Eine Kurve fuer ALLE Zoomanimationen -- auch bei der Deckkraft.
//
// 🔴 AGENTS.md §11 und docs/kartenflaechen-und-zoomblenden.md: „eine Kurve und eine Dauer fuer ALLE
// Zoomanimationen". Am 26.08.2026 wurden dafuer acht verstreute Abschriften eingesammelt -- die
// TRANSFORM-Haelfte dieser Regel. Die DECKKRAFT-Haelfte blieb auf `ease-out` stehen und war damit
// die letzte abweichende Kurve des ganzen Zoomschritts.
//
// ⭐ Gefunden am 27.08.2026, indem die wirksamen Uebergaenge ALLER Zeichenflaechen live ausgelesen
// wurden (Kacheln, SVG-Renderer, Marker-Canvas, Grenzen-Canvas, Schraffur, Marker-Icons,
// Wegenamen-Canvas): ueberall `transform 0.5s cubic-bezier(0.42, 0, 0.58, 1)`, delay 0s -- nur
// diese eine Deckkraft nicht.
//
// ⚠️ Die DAUER bleibt bewusst eigen (`--border-label-fade-out`): sie ist der Anteil des Ausblendens
// am Blendenbudget und MUSS kuerzer sein als der Zoomschritt, sonst ist die Flaeche an dessen Ende
// noch nicht bei 0.
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/zoom-kurve-einheitlich.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const wurzel = path.join(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(wurzel, rel), "utf8").split("\r\n").join("\n");
// ⚠️ Ohne Kommentare, sonst schlaegt der Test an der Warnung an, die vor der Falle warnt.
const labelsCss = lies("css/features/map-labels.css").replace(/\/\*[\s\S]*?\*\//g, "");

assert.ok(!/ease-out/.test(labelsCss),
	"🔴 In map-labels.css steht wieder eine `ease-out`-Kurve -- der Zoomschritt hat genau eine Kurve.");
assert.ok(/opacity var\(--border-label-fade-out[^;]*var\(--avesmaps-zoom-kurve\)/.test(labelsCss),
	"🔴 Die Deckkraft der Grenzbeschriftungen liest die gemeinsame Kurve nicht.");
assert.ok(/transform var\(--avesmaps-zoom-dauer\) var\(--avesmaps-zoom-kurve\)/.test(labelsCss),
	"🔴 Die Transform-Haelfte liest die gemeinsamen Token nicht.");
assert.ok(/opacity var\(--border-label-fade-out, 120ms\)/.test(labelsCss),
	"⚠️ Die eigene Ausblenddauer ist verschwunden -- sie muss kuerzer bleiben als der Zoomschritt.");

console.log("OK: der Zoomschritt hat eine Kurve, auch bei der Deckkraft.");
