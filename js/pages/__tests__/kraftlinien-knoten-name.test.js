// Der Anzeigename eines Kraftlinien-Knotens im Kraftlinien-Editor.
//
// 💣 Warum es diesen Test gibt (live gemessen 18.08.2026): api/edit/map/powerlines.php loeste die
// Knoten seiner Segmente mit `is_active = 1` auf. Sechs Knoten fielen durch -- vorhanden, nur
// deaktiviert -- und der Editor zeigte dafuer den Rueckfall: die nackte UUID. Einer davon
// (Glaail'Mhuoarr) haengt an fuenf Kraftlinien. Der Owner hat es gesehen, kein Werkzeug.
//
// 🔴 Die Reparatur darf den Rueckfall NICHT abschaffen. Ein Knoten kann wirklich geloescht sein;
// dann ist die Kennung das Einzige, was der Editor noch hat. Er darf nur nicht mehr der Normalfall
// fuer Deaktivierte sein -- das ist genau der dritte Fall, den dieser Test festnagelt.
//
// ⭐ Die Funktion wird AUS DER AUSGELIEFERTEN SEITE gezogen, nicht abgeschrieben: eine Abschrift
// bleibt gruen, wenn sich das Original aendert. Dieselbe Bauform wie
// js/review/__tests__/citymap-editor-search.test.js.
//
// Run (aus dem Repo-Wurzelverzeichnis):  node js/pages/__tests__/kraftlinien-knoten-name.test.js

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const editorPfad = path.join(__dirname, "..", "..", "..", "html", "wiki-sync-powerline-editor.html");
const html = fs.readFileSync(editorPfad, "utf8");

// Die Funktionen dieser Seite stehen im IIFE auf Spaltenebene 0; die schliessende Klammer auf
// derselben Ebene beendet die Deklaration.
const holen = (name) => {
	const re = new RegExp("\\nfunction " + name + "\\([\\s\\S]*?\\n\\}");
	const treffer = html.match(re);
	assert.ok(treffer, `${name}() steht nicht mehr in html/wiki-sync-powerline-editor.html -- umbenannt?`);
	return vm.runInNewContext("(" + treffer[0].trim() + ")");
};

const nodeAnzeigeName = holen("nodeAnzeigeName");

let checks = 0;

// ---- Fall 1: aktiver Knoten -- unveraendert wie vor dem 18.08.2026 ------------------------------
assert.strictEqual(nodeAnzeigeName({ name: "Keranvor", is_active: true }, "uuid-1"), "Keranvor");
checks++;

// ---- Fall 2: DER FALL, um den es geht -----------------------------------------------------------
assert.strictEqual(
	nodeAnzeigeName({ name: "Glaail'Mhuoarr", is_active: false }, "8d75b8ba-b33a-477c-ab18-01c0b1986f0f"),
	"Glaail'Mhuoarr (deaktiviert)",
	"Ein deaktivierter Knoten muss mit Namen UND Kennzeichnung erscheinen. Ohne die Kennzeichnung "
	+ "sieht der Editor nicht, warum der Knoten auf der Karte fehlt; ohne den Namen steht dort die "
	+ "UUID -- genau der Befund vom 18.08.2026.");
checks++;

// ---- Fall 3: der Rueckfall bleibt die letzte Bremse ---------------------------------------------
assert.strictEqual(nodeAnzeigeName(undefined, "ef5b84b6-b1ac-481b-8773-8e9331f9b30c"),
	"ef5b84b6-b1ac-481b-8773-8e9331f9b30c",
	"Ein Knoten, den der Endpunkt gar nicht kennt (wirklich geloescht), muss weiterhin seine "
	+ "Kennung zeigen -- sie ist dann das Einzige, was der Editor hat.");
checks++;
assert.strictEqual(nodeAnzeigeName({ name: "", is_active: false }, "uuid-x"), "uuid-x",
	"Ein Knoten OHNE Namen faellt weiterhin auf die Kennung zurueck; ' (deaktiviert)' allein waere "
	+ "kein Name.");
checks++;
assert.strictEqual(nodeAnzeigeName(null, ""), "?");
checks++;

// ---- Der Zusatz haengt an `false`, nicht an „falsy" ---------------------------------------------
// 💣 Eine aeltere Antwort ohne das Feld darf keinen Knoten faelschlich als deaktiviert ausweisen --
// sonst traegt nach einem Teil-Deploy JEDER Knoten die Kennzeichnung, und sie sagt nichts mehr.
assert.strictEqual(nodeAnzeigeName({ name: "Kreuzung" }, "uuid-2"), "Kreuzung",
	"Ohne das Feld `is_active` gilt ein Knoten als aktiv. Ein `!node.is_active` haette hier "
	+ "'(deaktiviert)' geschrieben und damit alle Knoten gekennzeichnet.");
checks++;

// ---- Und die EINZIGE Anzeigequelle bleibt eine ---------------------------------------------------
// ⚠️ nodeName() ist der Trichter, durch den Ortsliste, Nodices-Spalte, Kantenliste, Auswahlfeld und
// die Rueckfrage beim Entfernen alle gehen. Baut jemand die Aufloesung dort wieder selbst, steht die
// Kennzeichnung an vier von fuenf Oberflaechen.
const nodeNameRumpf = html.match(/\nfunction nodeName\([\s\S]*?\n\}/);
assert.ok(nodeNameRumpf && /nodeAnzeigeName\(nodesMap\[publicId\], publicId\)/.test(nodeNameRumpf[0]),
	"nodeName() ruft nodeAnzeigeName() nicht mehr. Dann gilt die Kennzeichnung nur noch dort, wo "
	+ "sie jemand einzeln nachtraegt.");
checks++;

console.log(`OK -- ${checks} Zusicherungen (Anzeigename eines Kraftlinien-Knotens).`);
