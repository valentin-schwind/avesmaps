// Welche Landschafts-Ebene zeigt die Fluesse? Seit dem 09.09.2026: dem BESUCHER alle, dem EDITOR nur
// „Alle" und „Topographie" wie zuvor.
//
// 🔴 VOM 23.08.2026 AN ZEIGTEN NUR „ALLE" UND „TOPOGRAPHIE" DIE GEWAESSER (Owner damals: „du kannst die
// Fluesse bei Alle und topographie auch einschalten."). Seit dem 09.09.2026 gilt das nur noch fuer den
// EDITOR -- der BESUCHER sieht sie in allen fuenf Ebenen („auch die sollen in allen landschaftsansichten
// default aktiviert und sichtbar sein", Owner). Sein Wert steht seither in ECOSYSTEM_FRONTEND_PROFIL,
// der Editor haelt seine alte Ebenentabelle (ECOSYSTEM_EDITOR_RIVER_KINDS).
//
// 🔴 EIN ERSTER ENTWURF DES NACHTRAGS LIESS DEN EDITOR AUF DEN BESUCHERWERT ZURUECKFALLEN und gab ihm
// die Fluesse dadurch in JEDER Ebene -- eine Luecke im Entwurf, keine gewollte Ausweitung. Diese Datei
// misst BEIDE Rollen einzeln, gerade weil sie seither unterschiedliche Antworten geben.
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

const ORTSKLASSEN = ["metropole", "grossstadt", "stadt", "kleinstadt", "dorf", "gebaeude"];

function welt({ modus = "ecosystem", gemerktAlle = "0", ebene = "vegetation", hakenVorher = false,
	editor = true } = {}) {
	const haken = { id: "toggleRivers", checked: hakenVorher, listener: [],
		addEventListener(typ, fn) { if (typ === "change") { this.listener.push(fn); } },
		dispatchEvent(ereignis) { this.listener.forEach((fn) => fn(ereignis)); return true; } };
	const geschehen = [];
	const felder = { toggleRivers: haken };
	const buehne = { modus };
	// ⚠️ Die Ortsklassen stehen hier, seit die Fluesse durch `ecosystemAnzeigeSoll` gehen: dessen
	// Leser (ecosystemAnzeigeLesen) nimmt die Lage ALLER zehn Schalter auf, wenn der Besucher einen
	// davon anfasst. Ohne sie waere die Wahl unten nicht messbar.
	const klassen = {};
	ORTSKLASSEN.forEach((art) => { klassen[art] = false; });
	const context = {
		console,
		Set,
		Boolean,
		String,
		Number,
		Math,
		Object,
		Event: class { constructor(typ) { this.type = typ; } },
		window: { localStorage: { getItem: () => gemerktAlle, setItem: () => {} } },
		document: {
			getElementById: (id) => felder[id] || null,
			querySelectorAll: () => [],
			addEventListener: () => {},
		},
		getSelectedMapLayerMode: () => buehne.modus,
		IS_ECOSYSTEM_ENABLED: editor,
		IS_EDIT_MODE: editor,
		isKnownEcosystemKind: () => true,
		activeEcosystemLayerKind: ebene,
		LOCATION_TYPE_VISIBILITY_ORDER: ORTSKLASSEN,
		getLocationToggleButton: (art) => ({
			hasClass: () => klassen[art] === true,
			removeClass: () => { klassen[art] = false; },
			toggleClass: (_k, an) => { klassen[art] = an === true; },
		}),
		syncPathVisibility: () => geschehen.push("wege-neu-gezeichnet"),
	};
	context.globalThis = context;
	vm.createContext(context);
	vm.runInContext(quelle, context);
	return { context, haken, geschehen, buehne };
}

// ---- 1. Welche Ebene zeigt sie: dem BESUCHER alle fuenf, dem EDITOR nur zwei -------------------
//
// 🔴 Bis zum 09.09.2026 standen hier drei Zeilen auf AUS („ueber den Vegetationsflaechen waeren es nur
// Linien"). Der Owner hat das fuer den BESUCHER umgedreht; die Zeilen bleiben stehen, damit erkennbar
// ist, WAS sich geaendert hat -- nur seine Erwartung ist gewandert.
//
// 🔴 DER EDITOR IST NICHT MITGEWANDERT. Ein erster Entwurf des Nachtrags liess ihn beim fehlenden
// Profil auf denselben Wert zurueckfallen wie den Besucher und gab ihm die Fluesse dadurch in JEDER
// Ebene -- eine Luecke im Entwurf. Er behaelt die Regel vom 23.08.2026: nur „Alle" und „Topographie"
// zeigen sie ihm, die drei uebrigen nicht. Die mittlere Zeile der zweiten Liste ist die eigentliche
// Zusicherung dieses Abschnitts -- ohne sie kippt das beim naechsten Anfassen lautlos zurueck.

[
	["alle", { gemerktAlle: "1", editor: false }],
	["topographie", { ebene: "topographie", editor: false }],
	["vegetation", { ebene: "vegetation", editor: false }],
	["derographisch", { ebene: "derographisch", editor: false }],
	["klima", { ebene: "klima", editor: false }],
].forEach(([name, lage]) => {
	const { context, haken } = welt(lage);
	context.syncEcosystemRiverVisibility();
	assert.strictEqual(haken.checked, true,
		`Besucher, Ebene „${name}": die Fluesse sind an -- in allen fuenf Ebenen (Owner 09.09.2026)`);
});

[
	["alle", { gemerktAlle: "1", editor: true }, true],
	["topographie", { ebene: "topographie", editor: true }, true],
	["vegetation", { ebene: "vegetation", editor: true }, false],
	["derographisch", { ebene: "derographisch", editor: true }, false],
	["klima", { ebene: "klima", editor: true }, false],
].forEach(([name, lage, erwartet]) => {
	const { context, haken } = welt(lage);
	context.syncEcosystemRiverVisibility();
	assert.strictEqual(haken.checked, erwartet,
		`Editor, Ebene „${name}": die Fluesse sind ${erwartet ? "an" : "aus"} -- seine eigene Tabelle`
		+ " ist vom Nachtrag vom 09.09.2026 unberuehrt geblieben");
});

// ---- 2. Der Ebenenwechsel laesst sie beim BESUCHER an ------------------------------------------
//
// 🔴 Vor dem 09.09.2026 legte der Wechsel den Haken auch beim Besucher um (Vegetation aus, Topographie
// an). Das ist der eigentliche Unterschied dieses Umbaus: fuer ihn entscheidet die Ebene nicht mehr
// mit -- fuer den Editor unveraendert schon (siehe Abschnitt 1).

const wechsel = welt({ ebene: "vegetation", editor: false });
wechsel.context.syncEcosystemRiverVisibility();
assert.strictEqual(wechsel.haken.checked, true, "Vorbedingung: in Vegetation sind sie an");

wechsel.context.activeEcosystemLayerKind = "topographie";
wechsel.context.syncEcosystemRiverVisibility();
assert.strictEqual(wechsel.haken.checked, true, "der Wechsel nach Topographie laesst sie an");

wechsel.context.activeEcosystemLayerKind = "klima";
wechsel.context.syncEcosystemRiverVisibility();
assert.strictEqual(wechsel.haken.checked, true, "und der Wechsel in die Klimazonen ebenso");

// ⚠️ Der EDITOR dagegen wechselt WIRKLICH mit -- seine Tabelle entscheidet je Ebene neu, bei jedem
// Betreten oder Ebenenwechsel.
const editorWechsel = welt({ ebene: "vegetation", editor: true });
editorWechsel.context.syncEcosystemRiverVisibility();
assert.strictEqual(editorWechsel.haken.checked, false, "Editor in Vegetation: aus");

editorWechsel.context.activeEcosystemLayerKind = "topographie";
editorWechsel.context.syncEcosystemRiverVisibility();
assert.strictEqual(editorWechsel.haken.checked, true, "Editor, Wechsel nach Topographie: an");

editorWechsel.context.activeEcosystemLayerKind = "klima";
editorWechsel.context.syncEcosystemRiverVisibility();
assert.strictEqual(editorWechsel.haken.checked, false, "Editor, Wechsel in die Klimazonen: wieder aus");

// ---- 2b. Die WAHL des Besuchers schlaegt die Vorgabe -- die des Editors nicht -------------------
//
// 🔴 „Der Haken bleibt dabei benutzbar: der Wechsel setzt ihn, die naechste eigene Entscheidung sticht
// ihn -- bis zum naechsten Wechsel" (Owner 23.08.2026). Fuer den BESUCHER faellt das „bis zum naechsten
// Wechsel" seit dem 09.09.2026 weg: seine Entscheidung steht im Soll und wird beim Wechsel
// zurueckgeschrieben, nicht ueberschrieben. Fuer den EDITOR gilt der Satz weiter -- er hat kein Profil,
// also auch keine Wahl darin.

const besucherWahl = welt({ ebene: "vegetation", editor: false });
besucherWahl.context.syncEcosystemRiverVisibility();
assert.strictEqual(besucherWahl.haken.checked, true, "Vorbedingung: die Vorgabe hat sie angeschaltet");
besucherWahl.haken.checked = false;
besucherWahl.haken.dispatchEvent({ type: "change", isTrusted: true });
besucherWahl.context.activeEcosystemLayerKind = "topographie";
besucherWahl.context.syncEcosystemRiverVisibility();
assert.strictEqual(besucherWahl.haken.checked, false,
	"🔴 der Besucher hat sie ausgeschaltet, und der Ebenenwechsel respektiert das");

const editorWahl = welt({ ebene: "vegetation", editor: true });
editorWahl.context.syncEcosystemRiverVisibility();
editorWahl.haken.checked = false;
editorWahl.haken.dispatchEvent({ type: "change", isTrusted: true });
editorWahl.context.activeEcosystemLayerKind = "topographie";
editorWahl.context.syncEcosystemRiverVisibility();
assert.strictEqual(editorWahl.haken.checked, true,
	"⚠️ beim Editor sticht die eigene Entscheidung nur bis zum naechsten Wechsel -- unveraendert seit"
	+ " dem 23.08.2026, denn eine Besucherwahl entsteht fuer ihn gar nicht");

// ---- 3. Beim Verlassen bekommt der Benutzer SEINE Lage zurueck ---------------------------------
//
// 💣 Der Fall, der ohne Gedaechtnis danebengeht: wer mit AUSgeschalteten Fluessen in die Ebene geht und
// wieder herausgeht, saesse danach in „Standard" mit Fluessen, die er nie eingeschaltet hat.

const geliehen = welt({ ebene: "topographie", hakenVorher: false });
geliehen.context.syncEcosystemRiverVisibility();
assert.strictEqual(geliehen.haken.checked, true, "in der Topographie an");
geliehen.buehne.modus = "deregraphic";
geliehen.context.syncEcosystemRiverVisibility();
assert.strictEqual(geliehen.haken.checked, false, "💣 und beim Verlassen zurueck auf AUS");

// Umgekehrt genauso: wer sie selbst an hatte, behaelt sie -- hier ohne jede Aenderung dazwischen.
// ⚠️ editor: false, denn in der Vegetation ist „an" seit dem 09.09.2026 nur noch die Vorgabe des
// Besuchers -- der Editor waere hier von Anfang an auf AUS und diese Zeile pruefte dann etwas anderes.
const eigene = welt({ ebene: "vegetation", hakenVorher: true, editor: false });
eigene.context.syncEcosystemRiverVisibility();
assert.strictEqual(eigene.haken.checked, true, "in der Vegetation bleiben sie jetzt an");
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
// woertlich „fuer Wege/Fluesse gibt es keine Erinnerung". Seit dem 23.08.2026 gibt es eine.
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
		+ "die merkt sich dann die geleerte Lage. Das Einschalten macht syncEcosystemRiverVisibility, "
		+ "und nur die nimmt es beim Verlassen auch wieder zurueck.");

console.log("ok - ecosystem-fluesse");
