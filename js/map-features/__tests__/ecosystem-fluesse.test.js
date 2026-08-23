// Welche Landschafts-Ebene zeigt die Fluesse? (Owner 23.08.2026: „du kannst die Fluesse bei Alle und
// topographie auch einschalten.")
//
// 🔴 DIE EBENE LEIHT SICH DEN HAKEN UND GIBT IHN ZURUECK -- dieselbe Bauart wie
// syncEcosystemSettlementVisibility nebenan, und aus demselben Grund: `#toggleRivers` gehoert dem
// Anzeige-Menue der GANZEN Karte, nicht dieser Ebene. Wer ihn ohne Gedaechtnis umlegt, laesst den
// Benutzer mit einer Lage zurueck, die er nie gewaehlt hat -- und in „Standard" sieht das dann aus wie
// ein Fehler der Wege-Anzeige.
//
// 💣 EINE Aufrufstelle (syncEcosystemPaneStates), und sie deckt Eintreten, Ebenenwechsel UND Verlassen
// ab. Deshalb hat die Funktion KEINEN Parameter: sie liest den Modus selbst. Zwei Setzer einzeln zu
// verdrahten waere die Falle vom 14.08.2026 -- dieser Test fuehrt sie deshalb ueber den MODUS, nicht
// ueber ein Argument.

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const quelle = fs.readFileSync(
	path.join(__dirname, "..", "map-features-ecosystem-layer-switch.js"), "utf8");

function welt({ modus = "ecosystem", gemerktAlle = "0", ebene = "vegetation", hakenVorher = false } = {}) {
	const haken = { id: "toggleRivers", checked: hakenVorher, listener: [],
		addEventListener(typ, fn) { if (typ === "change") { this.listener.push(fn); } },
		dispatchEvent(ereignis) { this.listener.forEach((fn) => fn(ereignis)); return true; } };
	const geschehen = [];
	const felder = { toggleRivers: haken };
	const buehne = { modus };
	const context = {
		console,
		Set,
		Boolean,
		String,
		Number,
		Math,
		Event: class { constructor(typ) { this.type = typ; } },
		window: { localStorage: { getItem: () => gemerktAlle, setItem: () => {} } },
		document: {
			getElementById: (id) => felder[id] || null,
			querySelectorAll: () => [],
			addEventListener: () => {},
		},
		getSelectedMapLayerMode: () => buehne.modus,
		IS_ECOSYSTEM_ENABLED: true,
		IS_EDIT_MODE: true,
		isKnownEcosystemKind: () => true,
		activeEcosystemLayerKind: ebene,
		syncPathVisibility: () => geschehen.push("wege-neu-gezeichnet"),
	};
	context.globalThis = context;
	vm.createContext(context);
	vm.runInContext(quelle, context);
	return { context, haken, geschehen, buehne };
}

// ---- 1. Welche Ebene zeigt sie -----------------------------------------------------------------

[
	["alle", { gemerktAlle: "1" }, true, "die Uebersicht will die Gewaesser"],
	["topographie", { ebene: "topographie" }, true, "ein Gebirge ohne seine Fluesse ist ein halbes Relief"],
	["vegetation", { ebene: "vegetation" }, false, "ueber den Vegetationsflaechen waeren es nur Linien"],
	["derographisch", { ebene: "derographisch" }, false, "dito"],
	["klima", { ebene: "klima" }, false, "die Klimabaender sind Flaechen wie die anderen auch"],
].forEach(([name, lage, soll, warum]) => {
	const { context, haken } = welt(lage);
	context.syncEcosystemRiverVisibility();
	assert.strictEqual(haken.checked, soll,
		`Ebene „${name}": Fluesse sollten ${soll ? "AN" : "AUS"} sein -- ${warum}`);
});

// ---- 2. Der Wechsel legt ihn um ----------------------------------------------------------------
//
// 🔴 Owner-Entscheid: der Ebenenwechsel setzt den Haken, im Editor wie im Frontend. Der Haken bleibt
// benutzbar -- bis zum naechsten Wechsel.

const wechsel = welt({ ebene: "vegetation" });
wechsel.context.syncEcosystemRiverVisibility();
assert.strictEqual(wechsel.haken.checked, false, "Vorbedingung: in Vegetation sind sie aus");

wechsel.context.activeEcosystemLayerKind = "topographie";
wechsel.context.syncEcosystemRiverVisibility();
assert.strictEqual(wechsel.haken.checked, true, "der Wechsel nach Topographie schaltet sie an");

wechsel.context.activeEcosystemLayerKind = "vegetation";
wechsel.context.syncEcosystemRiverVisibility();
assert.strictEqual(wechsel.haken.checked, false, "und der Wechsel zurueck wieder aus");

// ---- 3. Beim Verlassen bekommt der Benutzer SEINE Lage zurueck ---------------------------------
//
// 💣 Der Fall, der ohne Gedaechtnis danebengeht: wer mit AUSgeschalteten Fluessen in die Ebene geht,
// dort Topographie waehlt und wieder herausgeht, saesse danach in „Standard" mit Fluessen, die er nie
// eingeschaltet hat.

const geliehen = welt({ ebene: "topographie", hakenVorher: false });
geliehen.context.syncEcosystemRiverVisibility();
assert.strictEqual(geliehen.haken.checked, true, "in der Topographie an");
geliehen.buehne.modus = "deregraphic";
geliehen.context.syncEcosystemRiverVisibility();
assert.strictEqual(geliehen.haken.checked, false, "💣 und beim Verlassen zurueck auf AUS");

// Umgekehrt genauso: wer sie selbst an hatte, behaelt sie.
const eigene = welt({ ebene: "vegetation", hakenVorher: true });
eigene.context.syncEcosystemRiverVisibility();
assert.strictEqual(eigene.haken.checked, false, "in der Vegetation nimmt die Ebene sie weg");
eigene.buehne.modus = "political";
eigene.context.syncEcosystemRiverVisibility();
assert.strictEqual(eigene.haken.checked, true, "🔴 beim Verlassen bekommt er seine eigene Lage zurueck");

// ⚠️ Zweimal „drinnen" darf die Lage NICHT ein zweites Mal merken -- syncEcosystemControlsVisibility
// laeuft auch mitten im Modus (etwa wenn die Rechteauskunft eintrifft). Sonst waere die geliehene Lage
// festgeschrieben und der Benutzer bekaeme seine eigene nie wieder. (Dieselbe Falle steht wortgleich
// an syncEcosystemSettlementVisibility.)
const zweimal = welt({ ebene: "topographie", hakenVorher: false });
zweimal.context.syncEcosystemRiverVisibility();
zweimal.context.syncEcosystemRiverVisibility();
zweimal.buehne.modus = "deregraphic";
zweimal.context.syncEcosystemRiverVisibility();
assert.strictEqual(zweimal.haken.checked, false,
	"⚠️ ein zweites Merken mitten im Modus darf die geliehene Lage nicht festschreiben");

// Und wer gar nicht drin war, dem wird beim Verlassen nichts angefasst.
const nieDrin = welt({ modus: "deregraphic", hakenVorher: true });
nieDrin.context.syncEcosystemRiverVisibility();
assert.strictEqual(nieDrin.haken.checked, true, "ohne Eintritt gibt es nichts zurueckzugeben");

// ---- 4. Die Karte erfaehrt davon ---------------------------------------------------------------
//
// 💣 Ein programmatisch gesetztes `checked` feuert KEIN `change`. Ohne eigenes Signal blieben die
// Fluesse unsichtbar (syncPathVisibility) und die Fliessrichtungs-Pfeile stuenden auf altem Stand --
// beide haengen an genau diesem Haken.

const gemeldet = welt({ ebene: "topographie" });
let gehoert = 0;
gemeldet.haken.addEventListener("change", () => { gehoert += 1; });
gemeldet.context.syncEcosystemRiverVisibility();
assert.strictEqual(gehoert, 1, "💣 die Aenderung muss als `change` gemeldet werden");
assert.ok(gemeldet.geschehen.includes("wege-neu-gezeichnet"), "und die Wege werden neu gezeichnet");

// ⚠️ Aendert sich nichts, wird auch nichts gemeldet -- sonst zeichnete jeder Kachelklick die Wege neu.
gehoert = 0;
gemeldet.geschehen.length = 0;
gemeldet.context.syncEcosystemRiverVisibility();
assert.strictEqual(gehoert, 0, "⚠️ eine Lage, die schon stimmt, loest kein Neuzeichnen aus");
assert.deepStrictEqual(gemeldet.geschehen, [], "und auch sonst nichts");

// ---- 5. Ausserhalb der Landschaften wird nichts angefasst --------------------------------------
//
// 💣 syncEcosystemPaneStates laeuft AUCH in anderen Ansichten (syncEcosystemControlsVisibility ruft es
// auf beiden Wegen). Ohne die Modusfrage naehme die Landschaften-Ebene den Fluss-Haken der GANZEN Karte
// in Beschlag -- „Standard" haette danach keine Fluesse mehr.

const woanders = welt({ modus: "deregraphic", ebene: "topographie", hakenVorher: true });
woanders.context.syncEcosystemRiverVisibility();
assert.strictEqual(woanders.haken.checked, true,
	"💣 ausserhalb des Landschaftsmodus bleibt der Haken unangetastet");

// ---- 6. Niemand darf den Haken VOR dem Merken loeschen -----------------------------------------
//
// 💣 DIE FALLE, DIE IM BROWSER ZUGESCHLAGEN HAT. setSelectedMapLayerMode(„ecosystem") setzte den
// Fluss-Haken selbst auf aus -- und das lief VOR syncEcosystemVisibility. Die Ebene merkte sich also
// die bereits geleerte Lage und gab beim Verlassen „aus" zurueck, auch dem, der die Fluesse selbst
// angehabt hatte. Es ist derselbe Fehler, an dem am 2026-08-05 an derselben Stelle schon
// setAllLocationTypesVisible(false) gescheitert ist -- die Begruendung steht dort im Code und sagte
// woertlich „fuer Wege/Fluesse gibt es keine Erinnerung". Seit heute gibt es eine.
// ⚠️ Ausnahmsweise am Quelltext geprueft: die Frage ist, ob eine ANDERE Datei diesen Schalter noch
// anfasst, und das laesst sich hier nicht ausfuehren (der Moduswechsel braucht jQuery, die Karte und
// zwei Dutzend Globals). Was die Erinnerung TUT, messen die Faelle darueber.
const modusQuelle = fs.readFileSync(path.join(__dirname, "..", "map-features-display-mode.js"), "utf8");
// 🪤 Das Ende MUSS ab dem Anfang gesucht werden: `syncEditorDisplayTogglesToMode` steht als
// Definition WEITER OBEN in der Datei, und ein blankes indexOf lieferte damit eine Stelle VOR dem
// Block -- der Ausschnitt waere leer und die Zusicherung darunter trivial erfuellt. Genau das ist
// beim Schreiben passiert; die Laengenpruefung darunter hat es gefangen und bleibt deshalb stehen.
const ecoAnfang = modusQuelle.indexOf('normalizedMode === "ecosystem"');
const ecoBlock = modusQuelle.slice(ecoAnfang, modusQuelle.indexOf("syncEditorDisplayTogglesToMode(", ecoAnfang));
assert.ok(ecoAnfang > 0 && ecoBlock.length > 100,
	"der Ecosystem-Block des Moduswechsels wurde nicht gefunden -- ohne ihn prueft die Zeile darunter nichts");
// 🪤 Und ohne die Kommentarzeilen: die Begruendung an der Codestelle NENNT die entfernte Zeile
// woertlich, und daran waere diese Zusicherung haengengeblieben. Gemessen wird Code, nicht Prosa.
const ecoCode = ecoBlock.split(String.fromCharCode(10)).filter((zeile) => !zeile.trim().startsWith("//")).join(String.fromCharCode(10));
assert.ok(!ecoCode.includes('$("#toggleRivers")'),
	"💣 der Moduswechsel darf `#toggleRivers` nicht mehr selbst leeren -- er laeuft VOR der Ebene, und "
		+ "die merkt sich dann die geleerte Lage. Das Ausschalten in Vegetation/Derographie macht "
		+ "syncEcosystemRiverVisibility, und nur die nimmt es beim Verlassen auch wieder zurueck.");

console.log("ok - ecosystem-fluesse");
