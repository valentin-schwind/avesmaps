const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Die Beispielgebirge der Gebirgsformen im Auswahlfeld „Morphologie" (Owner 14.09.2026: „Der Editor
// soll bei den Gebirgsformen keine Musterbeispiele sondern richtige Beispiele aus der karte anzeigen").
// Entwurf: docs/superpowers/specs/2026-09-14-gebirgsformen-kartenbeispiele-design.md
//
// 🪤 AUSGEFUEHRT, NICHT GELESEN. Die Regeln werden aus ihrer Datei geladen, die zwei Dialogfunktionen
// aus map-features-ecosystem-properties.js ausgeschnitten und gefahren. Ein Regex kennt keinen
// Geltungsbereich -- nur die Verdrahtung (wer ruft wen) wird am kommentarfreien Quelltext geprueft.
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/gebirgsform-beispiele.test.js

const wurzel = path.join(__dirname, "..", "..", "..");
vm.runInThisContext(
	fs.readFileSync(path.join(wurzel, "js/map-features/ecosystem-display.js"), "utf8"),
	{ filename: "ecosystem-display.js" }
);
const hydro = require(path.join(wurzel, "js/map-features/map-features-ecosystem-hydrologie.js"));
const properties = fs.readFileSync(path.join(wurzel, "js/map-features/map-features-ecosystem-properties.js"), "utf8");
const phpTafel = fs.readFileSync(path.join(wurzel, "api/_internal/app/ecosystem-display.php"), "utf8");

const ids = globalThis.avesmapsGebirgsformBeispielIds;
const zeile = globalThis.avesmapsGebirgsformZeilentext;
const uebersetze = hydro.avesmapsHydroMorphSchluessel;
assert.strictEqual(typeof ids, "function", "avesmapsGebirgsformBeispielIds ist ladbar");
assert.strictEqual(typeof zeile, "function", "avesmapsGebirgsformZeilentext ist ladbar");

const A = "e215c7d1-fca0-4c7b-9a75-c138151954b0";
const B = "8590c0c8-98ad-4104-8a7f-03df8571189c";
const C = "11111111-2222-4333-8444-555555555555";
const D = "66666666-7777-4888-9999-aaaaaaaaaaaa";

// 🪟 Arrays aus dem vm-Kontext tragen einen fremden Prototyp -- vor dem Vergleich in den eigenen Realm.
const liste = (x) => [...x];

// ---- A. Die Regel: Reihenfolge, Dubletten, Deckel -----------------------------------------------
assert.deepStrictEqual(liste(ids({ karst: [B, A] }, "karst", uebersetze)), [B, A],
	"die Beispiele stehen in der gepflegten Reihenfolge");
assert.deepStrictEqual(liste(ids({ karst: [A, A, B] }, "karst", uebersetze)), [A, B], "eine Dublette faellt");
assert.deepStrictEqual(liste(ids({ karst: [A, B, C, D] }, "karst", uebersetze)), [A, B, C],
	"hoechstens drei -- auch wenn eine Tafel mehr traegt");
assert.deepStrictEqual(liste(ids({ karst: [A, 42, "", null, B] }, "karst", uebersetze)), [A, B],
	"nur Kennungen zaehlen");
assert.deepStrictEqual(liste(ids({ karst: [A] }, "schild", uebersetze)), [], "eine fremde Form bekommt nichts");
assert.deepStrictEqual(liste(ids({ karst: A }, "karst", uebersetze)), [], "eine blanke Kennung ist keine Liste");
assert.deepStrictEqual(liste(ids(null, "karst", uebersetze)), [], "ohne Tafel nichts");
assert.deepStrictEqual(liste(ids([A], "karst", uebersetze)), [], "eine Liste ist keine Tafel");
assert.deepStrictEqual(liste(ids({ karst: [A] }, "", uebersetze)), [], "ohne Form nichts");

// ---- B. 💣 Alte Schluessel wandern mit ---------------------------------------------------------
// Wird eine Form je umbenannt, stehen ihre Beispiele unter dem alten Schluessel. Ohne die Uebersetzung
// verschwaenden sie still -- und der heutige Schluessel gewinnt, wenn beide dastehen.
assert.deepStrictEqual(liste(ids({ karstrelief: [B] }, "karst", uebersetze)), [B],
	"ein alter Schluessel traegt seine Beispiele weiter");
assert.deepStrictEqual(liste(ids({ kegelberge: [C], inselberg: [A] }, "inselberg", uebersetze)), [A, C],
	"der heutige Schluessel zuerst, der alte danach");
assert.deepStrictEqual(liste(ids({ karstrelief: [B] }, "karst", null)), [],
	"ohne Uebersetzer kennt die Regel den alten Schluessel nicht -- der Aufrufer MUSS ihn reichen");

// ---- C. Die Zeile ------------------------------------------------------------------------------
assert.strictEqual(zeile("Kettengebirge", ["Ehernes Schwert", "Raschtulswall"]),
	"Kettengebirge — wie Ehernes Schwert, Raschtulswall");
assert.strictEqual(zeile("Schild", []), "Schild", "ohne Beispiel steht nur der Name, wie bisher");
assert.strictEqual(zeile("Karst", undefined), "Karst");
assert.strictEqual(zeile("Karst", ["  ", null, "Rorwhed"]), "Karst — wie Rorwhed", "leere Namen fallen");

// ---- D. Der Deckel steht zweimal und muss gleich sein ------------------------------------------
const phpMax = Number((phpTafel.match(/const AVESMAPS_ECOSYSTEM_DISPLAY_GEBIRGSFORM_MAX = (\d+);/) || [])[1]);
assert.strictEqual(globalThis.AVESMAPS_ECOSYSTEM_DISPLAY_GEBIRGSFORM_MAX, 3, "der Deckel im Browser ist drei");
assert.strictEqual(phpMax, globalThis.AVESMAPS_ECOSYSTEM_DISPLAY_GEBIRGSFORM_MAX,
	"Browser und Server nennen denselben Deckel -- sonst nimmt einer an, was der andere verwirft");

// ---- E. Der Dialog: das Auswahlfeld wirklich gefuellt ------------------------------------------
function schneide(name) {
	const von = properties.indexOf("\tfunction " + name + "(");
	assert.ok(von > 0, name + " steht im Dialog");
	const bis = properties.indexOf("\n\t}", von);
	assert.ok(bis > von, name + " hat ein Ende");
	return properties.slice(von, bis + 3);
}

const feld = {
	kinder: [],
	value: "kettengebirge",
	set innerHTML(v) { this.kinder = []; },
	appendChild(k) { this.kinder.push(k); return k; },
};
let tafel = { kettengebirge: [A, B], karst: [C] };
const kontext = {
	propertiesElement: (name) => (name === "morphologie" ? feld : null),
	document: { createElement: () => ({ value: "", textContent: "" }) },
	avesmapsEcosystemDisplayTeil: (name) => (name === "gebirgsformen" ? tafel : {}),
	avesmapsGebirgsformBeispielIds: ids,
	avesmapsGebirgsformZeilentext: zeile,
	avesmapsHydroMorphSchluessel: uebersetze,
	gebirgsformRegionNamen: null,
};
vm.createContext(kontext);
// ⚠️ Zwei Schnitte, nicht einer: zwischen beiden steht `let gebirgsformRegionNamen`, und als `let` im
// Kontext waere es eine lexikalische Bindung, die der Test von aussen nicht mehr setzen koennte.
vm.runInContext(schneide("fuelleVorlagenFeld") + "\n" + schneide("morphologieZeilentext")
	+ "\n;this.__fuelle = fuelleVorlagenFeld; this.__zeile = morphologieZeilentext;", kontext);

const formen = hydro.ECOSYSTEM_HYDRO_MORPHOLOGIEN;
const texte = () => feld.kinder.slice(1).map((o) => o.textContent);
const werte = () => feld.kinder.slice(1).map((o) => o.value);

// Solange die Regionsliste unterwegs ist: die blossen Namen.
kontext.__fuelle("morphologie", formen, kontext.__zeile);
assert.strictEqual(feld.kinder[0].textContent, "—", "erste Zeile ist der Strich");
assert.strictEqual(feld.value, "", "das Feld steht nach dem Fuellen auf „—“ -- eine Vorlage ist eine Aktion");
assert.deepStrictEqual(texte(), formen.map((f) => f.name), "ohne Regionsliste stehen nur die Formnamen da");

// Die Liste ist da: Namen der gepflegten Beispiele, eine geloeschte Region faellt still weg.
kontext.gebirgsformRegionNamen = new Map([[A, "Ehernes Schwert"], [B, "Raschtulswall"]]);
kontext.__fuelle("morphologie", formen, kontext.__zeile);
const nach = texte();
assert.strictEqual(nach[formen.findIndex((f) => f.key === "kettengebirge")],
	"Kettengebirge — wie Ehernes Schwert, Raschtulswall", "die Beispiele stehen in der Zeile");
assert.strictEqual(nach[formen.findIndex((f) => f.key === "karst")], "Karst",
	"eine Region, die es nicht (mehr) gibt, faellt still weg");
assert.strictEqual(nach[formen.findIndex((f) => f.key === "schild")], "Schild", "ohne Pflege der Name allein");
// 🔴 DER WERT BLEIBT DER SCHLUESSEL.
assert.deepStrictEqual(werte(), formen.map((f) => f.key),
	"jede Zeile traegt als WERT den Schluessel der Vorlage, nie ihren Text");

// Ohne Beschrifter (die Hoehenstufe) aendert sich nichts.
kontext.__fuelle("morphologie", hydro.ECOSYSTEM_HYDRO_HOEHENSTUFEN);
assert.deepStrictEqual(texte(), hydro.ECOSYSTEM_HYDRO_HOEHENSTUFEN.map((f) => f.name),
	"ein Feld ohne Beschrifter zeigt die Namen wie bisher");

// Ein alter Schluessel in der Tafel erreicht die heutige Form auch im Dialog.
tafel = { haertling: [B] };
kontext.__fuelle("morphologie", formen, kontext.__zeile);
assert.strictEqual(texte()[formen.findIndex((f) => f.key === "inselberg")], "Inselberg — wie Raschtulswall",
	"der Dialog reicht den Uebersetzer an die Regel");

// ---- F. Die Verdrahtung ------------------------------------------------------------------------
const code = properties.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/[^\n]*$/gm, "");
const aufrufe = code.match(/fuelleVorlagenFeld\("morphologie",[\s\S]*?\);/g) || [];
assert.strictEqual(aufrufe.length, 2, "das Morphologie-Feld wird an zwei Stellen gefuellt (Aufbau und nach list_regions)");
aufrufe.forEach((aufruf) => assert.ok(/morphologieZeilentext\);$/.test(aufruf),
	"jede Fuellung reicht den Beschrifter: " + aufruf.replace(/\s+/g, " ")));

// Die Namen kommen aus DERSELBEN list_regions-Antwort: der Oeffner reicht sie an die Uebernahme.
// ⚠️ Eine eigene Funktion statt eines Blocks im Oeffner -- der war schon 14.481 Zeichen lang, und
// landschaft-dialog-beide-haelften.test.js schneidet ihn unter 15.000. Der erste Bau stand als Block
// darin und machte genau diesen fremden Test rot.
const vonListe = code.indexOf('postEcosystemEdit("list_regions", { kind: area.kind })');
const bisListe = code.indexOf("mountEcosystemAreaSources(area.region_public_id)", vonListe);
assert.ok(vonListe > 0 && bisListe > vonListe, "der list_regions-Abschnitt des Dialogs steht da");
assert.ok(/uebernimmGebirgsformNamen\(result\.regions, area\);/.test(code.slice(vonListe, bisListe)),
	"der Oeffner reicht die Antwort von list_regions an die Uebernahme");

// Die Uebernahme selbst, ausgefuehrt.
vm.runInContext(schneide("uebernimmGebirgsformNamen") + "\n;this.__uebernimm = uebernimmGebirgsformNamen;", kontext);
kontext.ECOSYSTEM_HYDRO_MORPHOLOGIEN = formen;
tafel = { kettengebirge: [A] };
kontext.gebirgsformRegionNamen = null;
feld.kinder = [];
kontext.__uebernimm([{ public_id: A, name: "Ehernes Schwert" }], { kind: "topographie", region_type: "huegelland" });
assert.strictEqual(kontext.gebirgsformRegionNamen.get(A), "Ehernes Schwert", "die Namen stehen danach bereit");
assert.strictEqual(feld.kinder.length, 0,
	"ohne Gebirge wird kein Morphologie-Feld gefuellt -- dort steht gar keins");
kontext.__uebernimm([{ public_id: A, name: "Ehernes Schwert" }], { kind: "topographie", region_type: "gebirge" });
assert.strictEqual(texte()[formen.findIndex((f) => f.key === "kettengebirge")], "Kettengebirge — wie Ehernes Schwert",
	"beim Gebirge fuellt die Uebernahme das Feld mit den Namen neu");
kontext.__uebernimm(null, { kind: "topographie", region_type: "gebirge" });
assert.strictEqual(texte()[formen.findIndex((f) => f.key === "kettengebirge")], "Kettengebirge",
	"eine Antwort ohne Regionen leert die Namen, statt den Dialog abzubrechen");

// Das Anwenden liest weiter den WERT des Feldes.
const handler = code.slice(code.indexOf('propertiesElement("morphologie")?.addEventListener("change"'),
	code.indexOf('propertiesElement("hoehenstufe")?.addEventListener("change"'));
assert.ok(/ereignis\?\.target\?\.value/.test(handler), "wendeVorlageAn bekommt den Wert, nicht den Text");

console.log("gebirgsform-beispiele: alle Zusicherungen gruen");
