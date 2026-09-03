// Der Satz unter dem Zoomband eines GIPFELS im Beschriftungsdialog.
//
// 🔴 DER REGLER BEKOMMT SEINE ANTWORT MIT (Lehre vom 02.09.2026): in den Landschaftsansichten „Alle“
// und „Topographie“ steht ein Gipfel spaetestens ab der Vorgabe seiner Art
// (avesmapsLabelImBandDerAnsicht, map-features-labels.js) -- ein spaeteres „Sichtbar ab Zoom“ gilt
// dort nicht. Vom 27.08. bis zum 02.09.2026 galt der Regler bei 76 Gipfeln NIRGENDS und sagte es
// nicht; das war „die einstellung zur darstellung hat keinen effekt“. Ein Wert, der irgendwo nicht
// gilt, steht seither dabei -- und dieser Test haelt fest, dass er wirklich dasteht.
//
// ⭐ Der Test FAEHRT den Zeichner mit einer Dokument-Attrappe und der ECHTEN Tafel, statt seinen
// Quelltext zu lesen; die Zahl im Satz muss die der Tafel sein, keine abgeschriebene 4.
//
// Aus der Wurzel des Repos:  node js/review/__tests__/label-gipfel-hinweis.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const wurzel = path.join(__dirname, "..", "..", "..");
const skript = fs.readFileSync(path.join(wurzel, "js", "review", "review-labels.js"), "utf8").replace(/\r\n/g, "\n");
const seite = fs.readFileSync(path.join(wurzel, "index.html"), "utf8").replace(/\r\n/g, "\n");
let pruefungen = 0;
const ist = (a, b, was) => { assert.strictEqual(a, b, `${was} (bekam: ${JSON.stringify(a)})`); pruefungen++; };
const pruefe = (b, was) => { assert.ok(b, was); pruefungen++; };

function ausschnitt(name) {
	const von = skript.indexOf("function " + name + "(");
	assert.ok(von >= 0, name + " steht als eigene Funktion da");
	const bis = skript.indexOf("\n}", von);
	return skript.slice(von, bis + 2);
}

// Die Dokument-Attrappe: zwei Elemente, sonst nichts.
const elemente = {};
global.window = {};
global.location = { search: "" };
global.document = { getElementById: (id) => elemente[id] || null };
vm.runInThisContext(
	fs.readFileSync(path.join(wurzel, "js", "map-features", "ecosystem-display.js"), "utf8"),
	{ filename: "ecosystem-display.js" }
);
global.isEcosystemPeakSubtype = (t) => t === "berggipfel" || t === "vulkan";
vm.runInThisContext(
	ausschnitt("avesmapsLabelGipfelHinweisText") + "\n" + ausschnitt("avesmapsLabelZeichneGipfelHinweis"),
	{ filename: "review-labels-ausschnitt.js" }
);

// ---- A. Das Markup: die Zeile steht UNTER dem Zoomband und ist zu ------------------------------
pruefe(/id="label-edit-gipfel-hinweis-row" hidden>/.test(seite), "die Zeile steht im Dialog und ist versteckt");
pruefe(/<small id="label-edit-gipfel-hinweis">/.test(seite), "der Satz ist ein <small> in der Zeile");
pruefe(seite.indexOf('id="label-edit-max-zoom-marke"') < seite.indexOf('id="label-edit-gipfel-hinweis-row"'),
	"sie steht NACH „Sichtbar bis Zoom“ -- die Antwort gehoert unter den Regler, den sie erklaert");
pruefe(seite.indexOf('id="label-edit-gipfel-hinweis-row"') < seite.indexOf('id="label-edit-curve"'),
	"und VOR dem Haken „Kurvenbeschriftung“");

// ---- B. Ohne Elemente: kein Wurf ------------------------------------------------------------------
avesmapsLabelZeichneGipfelHinweis("berggipfel", avesmapsEcosystemDisplayVorgabe("berggipfel"));
pruefungen++;

// ---- C. Mit Elementen: Gipfel ja, alles andere nein -----------------------------------------------
const zeile = { hidden: true };
const satz = { textContent: "" };
elemente["label-edit-gipfel-hinweis-row"] = zeile;
elemente["label-edit-gipfel-hinweis"] = satz;

avesmapsLabelZeichneGipfelHinweis("berggipfel", avesmapsEcosystemDisplayVorgabe("berggipfel"));
ist(zeile.hidden, false, "🔴 ein Berggipfel bekommt den Satz");
pruefe(satz.textContent.includes("ab Zoom 4"), "und der nennt die Vorgabe der Tafel (ab 4): " + satz.textContent);
pruefe(satz.textContent.includes("„Alle“") && satz.textContent.includes("„Topographie“"),
	"und die zwei Ansichten, in denen die Zusage gilt");
pruefe(/Sichtbar ab Zoom/.test(satz.textContent), "und nennt den Regler beim Namen");

avesmapsLabelZeichneGipfelHinweis("vulkan", avesmapsEcosystemDisplayVorgabe("vulkan"));
ist(zeile.hidden, false, "ein Vulkan ebenso");

avesmapsLabelZeichneGipfelHinweis("wald", avesmapsEcosystemDisplayVorgabe("wald"));
ist(zeile.hidden, true, "💣 ein Wald nicht -- die Zusage gilt NUR der Gipfelliste");
avesmapsLabelZeichneGipfelHinweis("see", avesmapsEcosystemDisplayVorgabe("see"));
ist(zeile.hidden, true, "ein See nicht");
avesmapsLabelZeichneGipfelHinweis("", avesmapsEcosystemDisplayVorgabe(""));
ist(zeile.hidden, true, "keine Art: nichts");

// ---- D. Die Zahl ist die der TAFEL, keine abgeschriebene -------------------------------------------
avesmapsEcosystemDisplayInstall({ vorgabe: { berggipfel: { ab: 5, bis: 7 } } });
avesmapsLabelZeichneGipfelHinweis("berggipfel", avesmapsEcosystemDisplayVorgabe("berggipfel"));
ist(zeile.hidden, false, "Tafel auf ab 5: der Satz bleibt");
pruefe(satz.textContent.includes("ab Zoom 5") && !satz.textContent.includes("ab Zoom 4"),
	"🔴 und nennt die 5 der Tafel, nicht eine abgeschriebene 4: " + satz.textContent);
// Dieselbe Zahl, die die Karte liest -- die Weiche fragt avesmapsEcosystemDisplayBand.
ist(avesmapsEcosystemDisplayBand("berggipfel").ab, 5, "die Karte liest dieselbe 5");

// ---- E. Eine Tafel auf „aus“ sagt nichts zu -- dann steht auch nichts da ---------------------------
avesmapsEcosystemDisplayInstall({ vorgabe: { berggipfel: { ab: 5, bis: 4 } } });
avesmapsLabelZeichneGipfelHinweis("berggipfel", avesmapsEcosystemDisplayVorgabe("berggipfel"));
ist(zeile.hidden, true, "Tafel „aus“: kein Satz");
avesmapsEcosystemDisplayInstall(null);

// ---- F. Ohne Vorgabe (Seite ohne das Modul) kein Satz -- eine geratene Zahl waere schlimmer -------
avesmapsLabelZeichneGipfelHinweis("berggipfel", null);
ist(zeile.hidden, true, "ohne Vorgabe kein Satz");

// ---- G. Keine Zahl im Satzbauer -- sie kommt IMMER von der Tafel ----------------------------------
const rumpfText = ausschnitt("avesmapsLabelGipfelHinweisText")
	.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/[^\n]*$/gm, "");
pruefe(!/\d/.test(rumpfText), "💣 im Satzbauer steht keine Ziffer -- die Zahl kommt aus der Tafel");

// ---- H. Die Verdrahtung: der Marken-Zeichner ruft ihn, in BEIDEN Oeffnungspfaden ---------------
const zeichner = ausschnitt("avesmapsLabelZeichneVorgabeMarken");
pruefe(zeichner.includes("avesmapsLabelZeichneGipfelHinweis(art, vorgabe);"),
	"avesmapsLabelZeichneVorgabeMarken ruft den Hinweis -- damit haengt er an jedem Oeffnen und an jedem Artwechsel");

console.log(`label-gipfel-hinweis.test: OK (${pruefungen} Zusicherungen)`);
