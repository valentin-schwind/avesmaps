// Der Pinsel sammelt eine Strichfolge und speichert EINMAL -- statt bei jedem Strich zu schreiben und
// danach das ganze Sichtfeld neu zu laden.
//
// 🔴 WARUM DAS EIN TEST IST. Live gemessen am 04.09.2026: 15 Speicherungen desselben Waldes in 30
// Sekunden, je 47 KB hoch und ~470 KB runter, zusammen rund 7 MB -- waehrend der PHP-Pool am Anschlag
// war und die Seite ausfiel. Der teure Teil war nie das Speichern, sondern das Neuladen dahinter.
//
// 💣 UND DIE GEFAEHRLICHSTE ZEILE IST DIE REVISION. Sie kam frueher aus dem Neuladen. Nimmt man das
// Neuladen aus dem Wartepfad, ohne sie aus der ANTWORT zu holen, schickt der zweite Strich eine
// veraltete `expected_revision` -- und bekommt einen 409. Dann waere der Umbau schlimmer als der
// Zustand davor, und zwar erst beim zweiten Strich, also nicht beim ersten Ausprobieren.
//
// Der Block wird AUSGESCHNITTEN und AUSGEFUEHRT, nicht gelesen: ein Regex kennt keinen Geltungsbereich
// und haette die Revisionsfalle nie gefunden.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const QUELLE = fs.readFileSync(
	path.join(__dirname, "..", "map-features-ecosystem-brush.js"),
	"utf8",
).replace(/\r\n/g, "\n");   // ⚠️ zeilenendenneutral: hier CRLF, in der CI LF.

let fehler = 0;
function pruefe(bedingung, text) {
	if (!bedingung) {
		console.error("FAIL: " + text);
		fehler += 1;
	}
}

// --- Den Block herausschneiden -------------------------------------------------------------------
function schneide(von, bis, name) {
	const a = QUELLE.indexOf(von);
	const b = QUELLE.indexOf(bis);
	if (a < 0 || b < 0 || b <= a) {
		console.error("FAIL: Block '" + name + "' nicht gefunden (a=" + a + ", b=" + b + ")");
		fehler += 1;
		return "";
	}
	return QUELLE.slice(a, b);
}

const KONSTANTEN = schneide("const BRUSH_SPEICHER_RUHE_MS", "let brushCursorLayer", "Konstanten");
const LOGIK = schneide("\t// Ein Strich ist zu Ende", "\t// ---- Ereignisse", "Speicherlogik");

pruefe(/BRUSH_SPEICHER_RUHE_MS = 2500/.test(KONSTANTEN), "Ruhefrist steht auf 2500 ms (Owner 04.09.2026)");
pruefe(/BRUSH_SPEICHER_MAX_MS = 15000/.test(KONSTANTEN), "Deckel steht auf 15000 ms");

// --- Eine Welt bauen, in der der Block wirklich laeuft --------------------------------------------
function welt({ antwortRevision = 8, wirftBeimSpeichern = null } = {}) {
	const protokoll = { posts: [], reloads: [], reloadsSofort: 0, cacheLeerungen: 0, meldungen: [] };
	let jetzt = 1_000_000;
	let naechsteId = 1;
	const timer = new Map();

	const flaeche = {
		public_id: "eea2f691",
		geometry_revision: 7,
		geometry_geojson: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
	};

	const ctx = {
		console,
		Number,
		Math,
		Date: { now: () => jetzt },
		window: {
			setTimeout: (fn, ms) => {
				const id = naechsteId++;
				timer.set(id, { fn, faellig: jetzt + ms });
				return id;
			},
			clearTimeout: (id) => { timer.delete(id); },
		},
		// Die Abhaengigkeiten des Blocks, alle als Attrappe:
		areaByPublicId: (id) => (String(id) === flaeche.public_id ? flaeche : null),
		areaGeometry: (a) => a?.geometry_geojson || a?.geometry || null,
		postEcosystemEdit: async (aktion, rumpf) => {
			protokoll.posts.push({ aktion, expected_revision: rumpf.expected_revision });
			if (wirftBeimSpeichern) {
				throw new Error(wirftBeimSpeichern);
			}
			return { ok: true, area: { geometry_revision: antwortRevision, geometry: flaeche.geometry_geojson } };
		},
		withEcosystemOperation: async (label, run) => await run(),
		invalidateEcosystemRegionCache: () => { protokoll.cacheLeerungen += 1; },
		scheduleEcosystemAreaReload: (opts) => {
			protokoll.reloads.push(opts || null);
			if (opts && opts.immediate) {
				protokoll.reloadsSofort += 1;
			}
		},
		loadEcosystemAreas: async () => { protokoll.reloads.push("direkt"); },
		say: (m) => { protokoll.meldungen.push(String(m)); },
		updateBrushPreview: () => {},
	};
	ctx.globalThis = ctx;
	vm.createContext(ctx);

	const quelltext = `
		let brushMode = "brush";
		let brushAreaPublicId = "eea2f691";
		let brushWorkingGeometry = { type: "Polygon", coordinates: [[[0,0],[2,0],[2,2],[0,0]]] };
		let brushStrokeActive = false;
		let brushLastStampPoint = null;
		let brushDirty = false;
		let brushSaving = false;
		let brushUndoRevision = null;
		${KONSTANTEN}
		${LOGIK}
		globalThis.__griff = {
			strich: () => { brushDirty = true; finishStroke(); },
			sofort: () => speichereSofort(),
			dirty: () => brushDirty,
			revision: () => brushUndoRevision,
			flaecheRevision: () => brushAreaPublicId,
		};
	`;
	vm.runInContext(quelltext, ctx);

	// Die Uhr vorstellen und faellige Timer feuern lassen.
	async function verstreiche(ms) {
		jetzt += ms;
		const faellig = [...timer.entries()].filter(([, t]) => t.faellig <= jetzt);
		faellig.forEach(([id]) => timer.delete(id));
		for (const [, t] of faellig) {
			t.fn();
		}
		await new Promise((r) => setImmediate(r));
	}

	return { ctx, protokoll, flaeche, verstreiche, griff: ctx.__griff, offeneTimer: () => timer.size };
}

// =================================================================================================
(async () => {

// --- 1) Eine Strichfolge wird EIN Schreibvorgang ---------------------------------------------------
{
	const w = welt();
	// Fuenf Striche im 2-Sekunden-Takt = 10 s, also innerhalb des Deckels.
	for (let i = 0; i < 5; i++) {
		w.griff.strich();
		await w.verstreiche(2000);
	}
	pruefe(w.protokoll.posts.length === 0,
		"waehrend des Malens im 2-s-Takt wird NICHT geschrieben (war: " + w.protokoll.posts.length + ")");

	await w.verstreiche(2500);           // Ruhe
	pruefe(w.protokoll.posts.length === 1,
		"nach der Ruhefrist genau EIN Schreibvorgang (war: " + w.protokoll.posts.length + ")");
	pruefe(w.protokoll.reloads.length === 1,
		"und genau EIN Neuladen (war: " + w.protokoll.reloads.length + ")");
	pruefe(w.protokoll.reloadsSofort === 0,
		"das Neuladen laeuft ENTPRELLT, nie mit { immediate: true }");
}

// --- 1b) Der gemessene Fall vom 04.09.2026: 15 Striche in 30 Sekunden ------------------------------
{
	const w = welt();
	for (let i = 0; i < 15; i++) {
		w.griff.strich();
		await w.verstreiche(2000);
	}
	await w.verstreiche(2500);
	// 30 s Malen ueberschreiten den 15-s-Deckel einmal -- also zwei Schreibvorgaenge, nicht einer.
	// ⚠️ Das ist GEWOLLT: der Deckel ist der Datenschutz dieses Umbaus, nicht ein Schoenheitsfehler.
	pruefe(w.protokoll.posts.length === 2,
		"satinavs 15 Striche werden zu 2 Schreibvorgaengen, nicht zu 15 (war: " + w.protokoll.posts.length + ")");
	pruefe(w.protokoll.reloads.length === 2,
		"und zu 2 Neuladevorgaengen statt 15 (war: " + w.protokoll.reloads.length + ")");
}

// --- 2) 💣 Die Revision kommt aus der ANTWORT (die 409-Falle) --------------------------------------
{
	const w = welt({ antwortRevision: 8 });
	w.griff.strich();
	await w.verstreiche(2600);
	pruefe(w.protokoll.posts[0]?.expected_revision === 7, "erster Schreibvorgang schickt Revision 7");
	pruefe(w.flaeche.geometry_revision === 8,
		"die Antwort-Revision landet im LEBENDEN Flaechenobjekt (war: " + w.flaeche.geometry_revision + ")");

	// Zweiter Block -- er muss die NEUE Revision schicken, sonst 409.
	w.griff.strich();
	await w.verstreiche(2600);
	pruefe(w.protokoll.posts.length === 2, "zweiter Schreibvorgang fand statt");
	pruefe(w.protokoll.posts[1]?.expected_revision === 8,
		"zweiter Schreibvorgang schickt die Revision AUS DER ANTWORT, nicht die alte 7 (war: "
		+ w.protokoll.posts[1]?.expected_revision + ")");
}

// --- 3) Fehlt die Revision in der Antwort, wird NICHT geraten --------------------------------------
{
	const w = welt({ antwortRevision: NaN });
	w.griff.strich();
	await w.verstreiche(2600);
	pruefe(w.flaeche.geometry_revision === 7,
		"ohne brauchbare Antwort-Revision bleibt der alte Wert stehen -- ehrlicher 409 statt erfundener Wert");
}

// --- 4) 💣 Der Deckel greift auch bei ununterbrochenem Malen ---------------------------------------
{
	const w = welt();
	// Alle 2 s ein Strich, ohne je 2,5 s Ruhe zu lassen -- ohne Deckel wuerde nie gespeichert.
	for (let i = 0; i < 12; i++) {
		w.griff.strich();
		await w.verstreiche(2000);
	}
	pruefe(w.protokoll.posts.length >= 1,
		"nach spaetestens 15 s wird geschrieben, auch wenn ununterbrochen gemalt wird (war: "
		+ w.protokoll.posts.length + ")");
}

// --- 5) Werkzeug schliessen schreibt SOFORT --------------------------------------------------------
{
	const w = welt();
	w.griff.strich();
	await w.verstreiche(200);            // weit vor der Ruhefrist
	pruefe(w.protokoll.posts.length === 0, "vor der Frist noch nichts geschrieben");
	await w.griff.sofort();
	pruefe(w.protokoll.posts.length === 1, "speichereSofort schreibt ohne zu warten");
	pruefe(w.offeneTimer() === 0, "und raeumt den wartenden Timer weg (kein zweiter Schreibvorgang)");
}

// --- 6) Ein Fehlschlag verwirft nichts -------------------------------------------------------------
{
	const w = welt({ wirftBeimSpeichern: "Netz weg" });
	w.griff.strich();
	await w.verstreiche(2600);
	pruefe(w.protokoll.posts.length === 1, "es wurde versucht");
	pruefe(w.griff.dirty() === true,
		"nach einem Fehlschlag bleibt der Stand ungespeichert -- er darf NICHT als geschrieben gelten");
	pruefe(w.protokoll.meldungen.length === 1, "und der Editor wird gewarnt");
}

console.log(fehler === 0
	? "OK ecosystem-pinsel-speicherrate"
	: fehler + " Fehler in ecosystem-pinsel-speicherrate");
process.exit(fehler === 0 ? 0 : 1);

})();
