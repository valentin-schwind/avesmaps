const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Der Abschnitt „Gebirgsformen — Beispiele auf der Karte" im Fenster „Darstellung" (Owner 14.09.2026:
// „Der Editor soll bei den Gebirgsformen keine Musterbeispiele sondern richtige Beispiele aus der karte
// anzeigen"). Entwurf: docs/superpowers/specs/2026-09-14-gebirgsformen-kartenbeispiele-design.md
//
// 🪤 Der Test SCHNEIDET die Funktionen aus dem Fenster und FUEHRT SIE AUS, mit einem Attrappen-DOM --
// eine im Test nachgebaute Fassung waere gruen geblieben, egal was das Fenster tut.
//
// Aus der Wurzel des Repos:  node js/pages/__tests__/darstellung-gebirgsformen.test.js

const wurzel = path.join(__dirname, "..", "..", "..");
const editor = fs.readFileSync(path.join(wurzel, "html/landschaften-editor.html"), "utf8");
vm.runInThisContext(
	fs.readFileSync(path.join(wurzel, "js/map-features/ecosystem-display.js"), "utf8"),
	{ filename: "ecosystem-display.js" }
);
const hydro = require(path.join(wurzel, "js/map-features/map-features-ecosystem-hydrologie.js"));

function schneide(name) {
	const von = editor.indexOf("function " + name + "(");
	assert.ok(von >= 0, name + " steht im Fenster");
	const bis = editor.indexOf("\n}", von);
	assert.ok(bis > von, name + " hat ein Ende");
	return editor.slice(von, bis + 2);
}

const A = "e215c7d1-fca0-4c7b-9a75-c138151954b0";
const B = "8590c0c8-98ad-4104-8a7f-03df8571189c";
const C = "11111111-2222-4333-8444-555555555555";
const X = "99999999-8888-4777-8666-555555555555";   // eine Region, die es nicht mehr gibt

// ---- A. Der Abschnitt steht in der EINEN Liste -------------------------------------------------
// Aus ihr kommen Laden, Speichern, Zuruecksetzen und der Sendekoerper; fehlt er dort, verschwindet
// eine Pflege beim Speichern lautlos.
assert.ok(/const ECO_DISPLAY_ABSCHNITTE = \[[^\]]*"gebirgsformen"/.test(editor),
	"„gebirgsformen“ steht in ECO_DISPLAY_ABSCHNITTE");

// ---- B. Das Markup steht vor dem Skript --------------------------------------------------------
const posSkript = editor.indexOf("ECO_DISPLAY_EBENEN");
["ecoDisplayGebirgsformenSection", "ecoDisplayGebirgsformenRows", "ecoDisplayGebirgsformenFoot"].forEach((id) => {
	const pos = editor.indexOf('id="' + id + '"');
	assert.ok(pos > 0 && pos < posSkript, id + " steht im Markup, VOR dem Skript, das es verdrahtet");
});

// 💣 Der Tabellenkopf ist eine DRITTE Stelle mit der Zahl des Deckels (neben der JS- und der
// PHP-Konstante), und er steht fest im Markup. Aendert jemand den Deckel, erzeugt die Zeile mehr oder
// weniger Felder als der Kopf Spalten hat -- die Tabelle rutscht aus dem Raster, lautlos. Gefunden vom
// Pruefagenten vor dem Commit.
const abschnittMarkup = editor.slice(editor.indexOf('id="ecoDisplayGebirgsformenSection"'),
	editor.indexOf('id="ecoDisplayGebirgsformenRows"'));
const kopfBeispiele = (abschnittMarkup.match(/<th[^>]*>Beispiel \d+<\/th>/g) || []).length;
assert.strictEqual(kopfBeispiele, globalThis.AVESMAPS_ECOSYSTEM_DISPLAY_GEBIRGSFORM_MAX,
	"der Tabellenkopf hat so viele Spalten „Beispiel N“, wie der Deckel Felder erzeugt");

// ---- C. Die Formentabelle ist geladen -- und stoesst mit nichts zusammen ------------------------
// 💣 Zwei klassische Skripte mit demselben Namen auf oberster Ebene: bei `const` wirft das zweite,
// bei `function` gewinnt still das spaetere. Beides waere hier unsichtbar, bis ein Regler etwas
// anderes tut als auf der Karte.
const quellen = [...editor.matchAll(/<script src="\/([^"]+)"/g)].map((m) => m[1]);
assert.ok(quellen.includes("js/map-features/map-features-ecosystem-hydrologie.js"),
	"das Fenster laedt die Formentabelle -- dieselbe Datei wie die Karte");
const erstesInline = editor.search(/<script>\s*"use strict"/);
assert.ok(editor.indexOf('src="/js/map-features/map-features-ecosystem-hydrologie.js"') < erstesInline,
	"und zwar VOR dem Skript des Fensters");
const namen = (quelltext) => {
	const s = new Set();
	for (const m of quelltext.matchAll(/^(?:const|let|var|class|function\*?|async function)\s+([A-Za-z_$][\w$]*)/gm)) {
		s.add(m[1]);
	}
	return s;
};
const hydroNamen = namen(fs.readFileSync(path.join(wurzel, "js/map-features/map-features-ecosystem-hydrologie.js"), "utf8"));
quellen.filter((q) => !q.endsWith("map-features-ecosystem-hydrologie.js")).forEach((q) => {
	const andere = namen(fs.readFileSync(path.join(wurzel, q), "utf8"));
	const gleich = [...hydroNamen].filter((n) => andere.has(n));
	assert.deepStrictEqual(gleich, [], "kein Name der Formentabelle kommt auch in " + q + " vor");
});
const inline = [...editor.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join("\n");
assert.deepStrictEqual([...hydroNamen].filter((n) => namen(inline).has(n)), [],
	"und keiner im Skript des Fensters");

// ---- D. Die Auswahl: Gebirge der Topographie, nach Namen, Doppelte unterscheidbar --------------
const regionenBauer = new Function(schneide("ecoDisplayGebirgsformRegionen") + "\nreturn ecoDisplayGebirgsformRegionen;")();
const gebirge = regionenBauer([
	{ public_id: A, name: "Rote Sichel", kind: "topographie", region_type: "gebirge" },
	{ public_id: B, name: "Gorische Wüste", kind: "topographie", region_type: "gebirge" },
	{ public_id: C, name: "Gorische Wüste", kind: "topographie", region_type: "gebirge" },
	{ public_id: "d", name: "Abagund", kind: "topographie", region_type: "huegelland" },
	{ public_id: "e", name: "Farindel", kind: "vegetation", region_type: "wald" },
	{ public_id: A, name: "Rote Sichel", kind: "topographie", region_type: "gebirge" },
]);
assert.deepStrictEqual(gebirge.map((g) => g.id), [C, B, A],
	"nur Gebirge der Topographie, jede Region einmal, nach Namen (Gleichnamige nach Kennung)");
assert.deepStrictEqual(gebirge.map((g) => g.label), ["Gorische Wüste (11111111)", "Gorische Wüste (8590c0c8)", "Rote Sichel"],
	"⚠️ gleichnamige Gebirge tragen einen Unterscheider, alle anderen nicht");

// ---- E. Setzen: nur Gewaehltes, ohne Dubletten, alte Schluessel weg ------------------------------
const setzKontext = { ecoDisplayTafel: { gebirgsformen: {} }, ecoDisplayBearbeitet: false,
	AVESMAPS_ECOSYSTEM_DISPLAY_GEBIRGSFORM_MAX: globalThis.AVESMAPS_ECOSYSTEM_DISPLAY_GEBIRGSFORM_MAX };
vm.createContext(setzKontext);
vm.runInContext(schneide("ecoDisplaySetzGebirgsform"), setzKontext);
const setz = (form, werte, ue) => setzKontext.ecoDisplaySetzGebirgsform(form, werte, ue);
const teil = () => JSON.parse(JSON.stringify(setzKontext.ecoDisplayTafel.gebirgsformen));

setz("karst", [A, "", B], hydro.avesmapsHydroMorphSchluessel);
assert.deepStrictEqual(teil(), { karst: [A, B] }, "leere Felder fallen, die Reihenfolge bleibt");
assert.strictEqual(setzKontext.ecoDisplayBearbeitet, true, "und das Fenster weiss, dass etwas ungespeichert ist");
setz("karst", [B, B, ""], hydro.avesmapsHydroMorphSchluessel);
assert.deepStrictEqual(teil(), { karst: [B] }, "dieselbe Region zweimal ist ein Beispiel");
setz("karst", ["", "", ""], hydro.avesmapsHydroMorphSchluessel);
assert.deepStrictEqual(teil(), {}, "🔴 ohne Beispiel verschwindet die Form ganz -- keine leere Liste als Aussage");
setz("karst", [A, B, C, X], hydro.avesmapsHydroMorphSchluessel);
assert.deepStrictEqual(teil(), { karst: [A, B, C] }, "hoechstens drei");
setzKontext.ecoDisplayTafel.gebirgsformen = { karstrelief: [C], inselberg: [B] };
setz("karst", [A], hydro.avesmapsHydroMorphSchluessel);
assert.deepStrictEqual(teil(), { inselberg: [B], karst: [A] },
	"💣 ein alter Schluessel derselben Form geht, eine fremde Form bleibt unberuehrt");

// ---- F. Zeichnen: ausgefuehrt mit Attrappen-DOM ------------------------------------------------
function knoten(tag) {
	return {
		tag, kinder: [], attrs: {}, zuhoerer: {}, hidden: false, className: "", disabled: false, value: "",
		_text: "",
		get textContent() { return this._text; },
		set textContent(v) { this._text = String(v); this.kinder = []; },
		appendChild(k) { this.kinder.push(k); return k; },
		setAttribute(n, v) { this.attrs[n] = v; },
		addEventListener(t, f) { this.zuhoerer[t] = f; },
	};
}
const dom = {
	ecoDisplayGebirgsformenSection: knoten("div"),
	ecoDisplayGebirgsformenRows: knoten("tbody"),
	ecoDisplayGebirgsformenFoot: knoten("p"),
};
const zeichenKontext = {
	$: (id) => dom[id],
	document: { createElement: knoten },
	Option: function (text, value) { return { text, value }; },
	rows: [
		{ regions: [{ public_id: A, name: "Rote Sichel", kind: "topographie", region_type: "gebirge" }] },
		{ regions: [{ public_id: B, name: "Ehernes Schwert", kind: "topographie", region_type: "gebirge" }] },
	],
	ecoDisplayReiter: "topographie",
	ecoDisplayDarfSpeichern: true,
	ecoDisplayBearbeitet: false,
	ecoDisplayTafel: { gebirgsformen: { kettengebirge: [B, X], karstrelief: [A] } },
	ECOSYSTEM_HYDRO_MORPHOLOGIEN: hydro.ECOSYSTEM_HYDRO_MORPHOLOGIEN,
	avesmapsHydroMorphSchluessel: hydro.avesmapsHydroMorphSchluessel,
	avesmapsGebirgsformBeispielIds: globalThis.avesmapsGebirgsformBeispielIds,
	AVESMAPS_ECOSYSTEM_DISPLAY_GEBIRGSFORM_MAX: globalThis.AVESMAPS_ECOSYSTEM_DISPLAY_GEBIRGSFORM_MAX,
};
vm.createContext(zeichenKontext);
vm.runInContext([
	schneide("ecoDisplayTeil"),
	schneide("ecoDisplayGebirgsformRegionen"),
	schneide("ecoDisplaySetzGebirgsform"),
	schneide("ecoDisplayZeichneGebirgsformen"),
].join("\n"), zeichenKontext);

zeichenKontext.ecoDisplayZeichneGebirgsformen();
const tb = dom.ecoDisplayGebirgsformenRows;
const formen = hydro.ECOSYSTEM_HYDRO_MORPHOLOGIEN;
assert.strictEqual(dom.ecoDisplayGebirgsformenSection.hidden, false, "bei der Topographie steht der Abschnitt");
assert.strictEqual(tb.kinder.length, formen.length, "eine Zeile je Form -- aus der Formentabelle, nicht abgeschrieben");
const zeileVon = (key) => tb.kinder[formen.findIndex((f) => f.key === key)];
const felder = (key) => zeileVon(key).kinder.slice(1).map((td) => td.kinder[0]);

assert.strictEqual(zeileVon("kettengebirge").kinder[0].textContent, "Kettengebirge", "die Zeile nennt die Form");
assert.strictEqual(felder("kettengebirge").length, 3, "drei Auswahlfelder je Form");
assert.deepStrictEqual(felder("kettengebirge").map((f) => f.value), [B, X, ""], "die gepflegten Beispiele stehen in ihren Feldern");
assert.ok(felder("kettengebirge")[1].kinder.some((o) => o.value === X && /nicht mehr auf der Karte/.test(o.text)),
	"⚠️ eine Region, die es nicht mehr gibt, bleibt SICHTBAR und herausnehmbar");
assert.ok(!felder("kettengebirge")[0].kinder.some((o) => /nicht mehr auf der Karte/.test(o.text)),
	"und nur dort, wo sie steht");
assert.strictEqual(felder("karst")[0].value, A, "ein alter Schluessel erscheint bei seiner heutigen Form");
assert.ok(felder("schild").every((f) => f.value === ""), "eine Form ohne Pflege steht leer da");
assert.deepStrictEqual(felder("schild")[0].kinder.map((o) => o.text), ["—", "Ehernes Schwert", "Rote Sichel"],
	"die Auswahl: Strich, dann die Gebirge nach Namen");
assert.ok(felder("schild").every((f) => f.disabled === false), "wer speichern darf, darf waehlen");
assert.ok(/2 Gebirge/.test(dom.ecoDisplayGebirgsformenFoot.textContent), "der Fuss nennt, wie viele zur Wahl stehen");

// Waehlen schreibt in die Arbeitstafel und zeichnet neu.
const karstFelder = felder("karst");
karstFelder[1].value = B;
karstFelder[1].zuhoerer.change();
assert.deepStrictEqual(JSON.parse(JSON.stringify(zeichenKontext.ecoDisplayTafel.gebirgsformen)),
	{ kettengebirge: [B, X], karst: [A, B] }, "die Wahl landet unter dem heutigen Schluessel, der alte ist weg");
assert.strictEqual(zeichenKontext.ecoDisplayBearbeitet, true, "und ist als ungespeichert vermerkt");
assert.deepStrictEqual(felder("karst").map((f) => f.value), [A, B, ""], "das Fenster zeichnet den neuen Stand");

// Ohne Speicherrecht: ansehen ja, waehlen nein.
zeichenKontext.ecoDisplayDarfSpeichern = false;
zeichenKontext.ecoDisplayZeichneGebirgsformen();
assert.ok(felder("karst").every((f) => f.disabled === true), "ohne Speicherrecht sind die Felder gesperrt");

// Andere Ebene: der Abschnitt geht.
zeichenKontext.ecoDisplayReiter = "vegetation";
zeichenKontext.ecoDisplayZeichneGebirgsformen();
assert.strictEqual(dom.ecoDisplayGebirgsformenSection.hidden, true, "bei der Vegetation steht er nicht");
assert.strictEqual(tb.kinder.length, 0, "und seine Zeilen sind weg");

// ---- G. Gesamtzeichnen und Senden nehmen ihn mit -----------------------------------------------
assert.ok(/ecoDisplayZeichneGebirgsformen\(\);/.test(schneide("ecoDisplayZeichne").replace(/^\s*\/\/[^\n]*$/gm, "")),
	"ecoDisplayZeichne ruft den Abschnitt");
const abschnitte = JSON.parse((editor.match(/const ECO_DISPLAY_ABSCHNITTE = (\[[^\]]*\]);/) || [])[1]);
const senden = new Function("ECO_DISPLAY_ABSCHNITTE", "ecoDisplayTeil",
	schneide("ecoDisplayZumSenden") + "\nreturn ecoDisplayZumSenden;")(
	abschnitte, (name) => ({ gebirgsformen: { karst: [A] }, kollision: {} })[name] || {});
assert.deepStrictEqual(senden(), { gebirgsformen: { karst: [A] } },
	"der Sendekoerper traegt die Beispiele -- und keinen leeren Abschnitt");

// ---- H. Zuruecksetzen sagt, dass die Beispiele mitgehen -----------------------------------------
// Der Server loescht beim Zuruecksetzen die ganze Tafel. Wer die Farben zuruecksetzt, darf die
// gepflegten Beispiele nicht still verlieren -- die Rueckfrage nennt sie beim Namen.
// 🪤 AUSGEFUEHRT, NICHT GELESEN: hier stand ein Regex auf „Beispielgebirge" -- und das Wort steht auch
// im KOMMENTAR ueber der Rueckfrage. Eine Mutationsprobe hat den Satz aus der Rueckfrage genommen, und
// der Test blieb gruen. Jetzt wird der Klick-Handler aufgerufen und die Rueckfrage abgefangen.
const resetVon = editor.indexOf('$("ecoDisplayReset").addEventListener("click"');
const resetBis = editor.indexOf("\n});", resetVon);
assert.ok(resetVon > 0 && resetBis > resetVon, "der Handler von „Auf Vorgabe zuruecksetzen“ steht da");
const resetKontext = {
	gefragt: [],
	handler: null,
	ecoDisplayTafel: { gebirgsformen: {} },
	$: () => ({ addEventListener: (typ, f) => { resetKontext.handler = f; } }),
	window: { confirm: (text) => { resetKontext.gefragt.push(text); return false; } },
	ecoDisplayMelde: () => {},
	ecoDisplayPost: () => { throw new Error("abgelehnt heisst: nichts wird gesendet"); },
};
vm.createContext(resetKontext);
vm.runInContext(schneide("ecoDisplayTeil") + "\n" + editor.slice(resetVon, resetBis + 4), resetKontext);
assert.strictEqual(typeof resetKontext.handler, "function", "der Handler ist angemeldet");
(async () => {
	await resetKontext.handler();
	assert.ok(!/Beispielgebirge/.test(resetKontext.gefragt[0]),
		"ohne gepflegte Beispiele fragt die Rueckfrage wie bisher");
	resetKontext.ecoDisplayTafel = { gebirgsformen: { karst: [A] } };
	await resetKontext.handler();
	assert.ok(/Beispielgebirge der Gebirgsformen werden entfernt/.test(resetKontext.gefragt[1]),
		"mit gepflegten Beispielen nennt die Rueckfrage sie beim Namen");
	console.log("darstellung-gebirgsformen: alle Zusicherungen gruen");
})().catch((fehler) => { console.error(fehler); process.exit(1); });
