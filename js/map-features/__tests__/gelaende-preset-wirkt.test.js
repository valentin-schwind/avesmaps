"use strict";

/**
 * Eine Vorlage muss in der FLÄCHE ankommen, nicht nur im Schieberegler.
 *
 * 💣 DER FEHLER, DEN DIESER TEST FESTNAGELT (gemeldet 05.09.2026: „die presets haben keinen effekt
 * ich muss immer auf preset und dann auf automatisch zurücksetzen gehen"). `wendeVorlageAn` schrieb
 * seine Werte mit `regler.value = …` in die elf Schieber und rief danach `renderTerrainControls`.
 * Und das liest jeden Regler aus `area[feld.key]` ZURÜCK -- also aus der Fläche, in die niemand
 * geschrieben hatte. Zwei Zeilen weiter standen die alten Werte wieder da.
 *
 * 🔴 UND DER ZEICHNER LIEST OHNEHIN NUR DIE FLÄCHE. `reglerFuer(area)` in
 * map-features-ecosystem-height-render.js kennt kein DOM: was nicht in `area.terrain_*` steht,
 * existiert für das Höhenbild nicht. Genau deshalb wirkte auch die Höhenstufe nie -- sie setzt
 * `terrain_avg_height`, und ohne den Wert in der Fläche bleibt eine Fläche ohne Gipfel flach.
 *
 * ⚠️ ZUR LAUFZEIT GEFAHREN, NICHT PER GREP. Ein Suchmuster fände die Zuweisung an den Regler und
 * hielte die Vorlage für angewandt -- der Rückweg über `renderTerrainControls` steht 200 Zeilen
 * weiter und in einer anderen Funktion. Dieselbe Lehre wie beim Ansichts-Popup der Beschriftungen
 * (03.09.2026): ein Bauer wird ausgeführt, nicht gelesen.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const wurzel = path.join(__dirname, "..", "..", "..");
const hydro = require(path.join(wurzel, "js/map-features/map-features-ecosystem-hydrologie.js"));

let gehalten = 0;
const pruefe = (name, fn) => {
	try {
		fn();
		gehalten++;
		console.log("  ok  " + name);
	} catch (fehler) {
		console.error("  FEHLER  " + name + "\n    " + fehler.message);
		process.exitCode = 1;
	}
};

/* ---- Die Bühne: gerade so viel DOM, dass der Dialog aufgeht und Ereignisse ankommen ------------- */

// 🔴 SIE KLEMMT WIE EIN `input[type=range]`. Das ist keine Bequemlichkeit, sondern die Zusicherung
// weiter unten: eine Vorlage muss den Wert NEHMEN, DEN DER REGLER ANNIMMT -- ein Wert ausserhalb der
// Reglergrenzen wird beim Zuweisen gekappt, und die Fläche darf danach nicht die ungekappte Zahl
// tragen. Sonst zeigt der Editor 0,7 und gespeichert wird 0,72 (die Falle, die „Schild" und
// „Inselberg" am 04.09.2026 je einmal getroffen hat).
class Attrappe {
	constructor(id) {
		this.id = id;
		this.options = [];
		this._value = "";
		this.disabled = false;
		this.hidden = false;
		this.checked = false;
		this.textContent = "";
		this.title = "";
		this.min = "";
		this.max = "";
		this.step = "";
		this.style = {};
		this.dataset = {};
		this.classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
		this._hoerer = new Map();
	}

	get value() { return this._value; }

	set value(roh) {
		const zahl = Number(roh);
		if (this.min !== "" && Number.isFinite(zahl) && zahl < Number(this.min)) {
			this._value = String(this.min);
			return;
		}
		if (this.max !== "" && Number.isFinite(zahl) && zahl > Number(this.max)) {
			this._value = String(this.max);
			return;
		}
		this._value = String(roh);
	}

	get innerHTML() { return this._html || ""; }

	set innerHTML(wert) {
		this._html = String(wert);
		if (String(wert) === "") { this.options = []; }
	}

	appendChild(kind) { this.options.push(kind); return kind; }
	replaceChildren() { this.options = []; }
	addEventListener(typ, fn) {
		if (!this._hoerer.has(typ)) { this._hoerer.set(typ, []); }
		this._hoerer.get(typ).push(fn);
	}
	removeEventListener() {}
	// Das Ereignis wirklich auslösen -- so, wie der Browser es tut.
	feuere(typ) {
		(this._hoerer.get(typ) || []).forEach((fn) => fn({ target: this, preventDefault() {} }));
	}
	setAttribute(name, value) { this[name] = String(value); }
	getAttribute(name) { return this[name]; }
	focus() {}
	select() {}
	remove() {}
	querySelector() { return null; }
	querySelectorAll() { return []; }
	closest() { return null; }
}

const knoten = new Map();
const element = (id) => {
	if (!knoten.has(id)) { knoten.set(id, new Attrappe(id)); }

	return knoten.get(id);
};

// Die Reglergrenzen kommen aus `index.html` -- GELESEN, nicht abgeschrieben. Eine zweite Tabelle
// hier veraltete stumm, sobald jemand einen Regler umspannt.
const markup = fs.readFileSync(path.join(wurzel, "index.html"), "utf8");
function setzeReglerGrenzenAusMarkup() {
	const muster = /id="ecosystem-properties-([a-z]+)" type="range" min="([\d.]+)" max="([\d.]+)" step="([\d.]+)"/g;
	let treffer;
	let n = 0;
	while ((treffer = muster.exec(markup)) !== null) {
		const feld = element("ecosystem-properties-" + treffer[1]);
		feld.min = treffer[2];
		feld.max = treffer[3];
		feld.step = treffer[4];
		n++;
	}

	return n;
}

const flaechen = new Map();
let rahmen = [];
// Serveraufrufe, die beim blossen Anwenden einer Vorlage gar nicht vorkommen duerfen.
const fremdeAufrufe = [];

const kontext = {
	console: { log() {}, warn() {}, error() {} },
	Map, Set, Array, Number, String, Boolean, Object, JSON, Math, Promise, Error, Date,
	module: { exports: {} },
	setTimeout, clearTimeout,
	Option: function Option(label, value) { return { label, value }; },
	document: {
		readyState: "complete",
		activeElement: null,
		getElementById: (id) => element(id),
		createElement: () => new Attrappe("neu"),
		addEventListener: () => {},
		documentElement: {},
	},
	ecosystemLayers: flaechen,
	labelData: [],
	isDerivedEcosystemKind: require(path.join(wurzel, "js/map-features/map-features-ecosystem-rendering.js")).isDerivedEcosystemKind,
	emptyTypeLabel: () => "— ohne Art —",
	findLabelEntryByPublicId: () => null,
	// Die ECHTEN Tabellen und der echte Leser -- eine Attrappe prüfte hier sich selbst.
	ECOSYSTEM_HYDRO_MORPHOLOGIEN: hydro.ECOSYSTEM_HYDRO_MORPHOLOGIEN,
	ECOSYSTEM_HYDRO_HOEHENSTUFEN: hydro.ECOSYSTEM_HYDRO_HOEHENSTUFEN,
	avesmapsHydroVorlage: hydro.avesmapsHydroVorlage,
	avesmapsHydroMorphSchluessel: hydro.avesmapsHydroMorphSchluessel,
	// Die Regel des Trichters -- der Dialog fragt sie, und der Test darf sie nicht nachbauen.
	avesmapsGebirgeBleibtFlach: hydro.avesmapsGebirgeBleibtFlach,
	postEcosystemEdit: async (aktion) => {
		if (aktion === "list_regions") {
			return {
				region_types: [{ type_key: "gebirge", label: "Gebirge" }],
				regions: [{ public_id: "r-1", area_count: 1 }],
			};
		}
		fremdeAufrufe.push(aktion);

		return {};
	},
};
// `requestAnimationFrame` SAMMELT statt sofort zu laufen -- sonst zeichnete der Test sein Bild
// mitten in der Vorlage, und die Reihenfolge (erst schreiben, dann zeichnen) wäre nicht messbar.
kontext.window = {
	requestAnimationFrame: (fn) => { rahmen.push(fn); return rahmen.length; },
	cancelAnimationFrame: () => {},
	AvesmapsEcosystemHeightRender: {
		isGrayscale: () => false,
		setGrayscale() {},
		invalidate() {},
		redraw() {},
		setPreviewCoarse() {},
		betrifftAnzeige: () => true,
	},
};
kontext.globalThis = kontext;
vm.createContext(kontext);
vm.runInContext(
	fs.readFileSync(path.join(wurzel, "js/map-features/map-features-ecosystem-properties.js"), "utf8"),
	kontext
);

const GEBIRGE = () => ({
	public_id: "f-1",
	region_public_id: "r-1",
	region_name: "Prüfgebirge",
	kind: "topographie",
	region_type: "gebirge",
	geometry: { type: "Polygon", coordinates: [[[0, 0], [10, 0], [10, 10], [0, 0]]] },
});

// 🪤 DIE KNOTEN BLEIBEN STEHEN, und das ist keine Bequemlichkeit: `bindEcosystemPropertiesDialog`
// verdrahtet GENAU EINMAL (`propertiesBound`) -- so wie im Browser, wo das Markup die ganze Sitzung
// überlebt. Wer die Bühne zwischen zwei Öffnungen leert, hängt die Hörer an weggeworfene Elemente,
// und jedes `change` danach läuft ins Leere: der Test meldete „die Höhenstufe kommt nicht an",
// während sie im Browser einwandfrei ankam. Ein Fehler der Bühne, der wie ein Befund aussieht.
async function oeffneGebirge(zusatz) {
	flaechen.clear();
	rahmen = [];
	setzeReglerGrenzenAusMarkup();
	flaechen.set("f-1", { _ecosystemArea: Object.assign(GEBIRGE(), zusatz || {}) });
	await kontext.window.AvesmapsEcosystemProperties.open("f-1");

	return flaechen.get("f-1")._ecosystemArea;
}

const waehle = (feldId, wert) => {
	const feld = element("ecosystem-properties-" + feldId);
	feld.value = wert;
	feld.feuere("change");
};

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   DIE ZUSICHERUNGEN
   ══════════════════════════════════════════════════════════════════════════════════════════════ */

(async () => {
	pruefe("die Bühne findet die Regler wirklich", () => {
		assert.ok(setzeReglerGrenzenAusMarkup() >= 11,
			"weniger als elf Geländeregler im Markup gefunden -- dann prüft der Test eine leere Bühne");
	});

	// ---- 1. Die Morphologie landet in der FLÄCHE ---------------------------------------------------

	{
		const flaeche = await oeffneGebirge();
		waehle("morphologie", "karst");

		pruefe("eine Morphologie schreibt ihre Werte in die Fläche, nicht nur in den Regler", () => {
			// 🔴 Das ist der gemeldete Fehler. Der Zeichner liest `area.terrain_*` und sonst nichts;
			// eine Vorlage, die nur den Schieber stellt, ändert am Bild kein Pixel.
			const karst = hydro.avesmapsHydroVorlage(hydro.ECOSYSTEM_HYDRO_MORPHOLOGIEN, "karst");
			assert.strictEqual(flaeche.terrain_grain, karst.koernung,
				"„Erhebungen" + "\" steht nicht in der Fläche -- die Vorlage erreicht das Höhenbild nicht");
			assert.strictEqual(flaeche.terrain_bergform, karst.bergform, "Bergform fehlt in der Fläche");
			assert.strictEqual(flaeche.terrain_rauschen, karst.rauschen, "Rauschen fehlt in der Fläche");
			assert.strictEqual(flaeche.terrain_sattel, karst.sattel, "Kamm-Sattel fehlt in der Fläche");
			assert.strictEqual(flaeche.terrain_talbreite, karst.talbreite, "Talbreite fehlt in der Fläche");
			assert.strictEqual(flaeche.terrain_einschnitt, karst.einschnitt, "Einschnitt fehlt in der Fläche");
			assert.strictEqual(flaeche.terrain_erosion, karst.erosion, "Erosion fehlt in der Fläche");
			assert.strictEqual(flaeche.terrain_plateau, karst.plateau, "Plateau fehlt in der Fläche");
			assert.strictEqual(flaeche.terrain_levels, karst.stufen, "Detailstufen fehlen in der Fläche");
			assert.strictEqual(flaeche.terrain_hypsometrie, karst.hypsometrie, "Hypsometrie fehlt in der Fläche");
		});

		pruefe("und der Regler zeigt danach denselben Wert -- er springt nicht zurück", () => {
			// 💣 Hier war der Fehler SICHTBAR: `renderTerrainControls` baut jeden Regler aus der Fläche
			// neu auf. Solange die Fläche die alten Werte trug, sprang der Schieber sofort zurück.
			assert.strictEqual(Number(element("ecosystem-properties-grain").value),
				hydro.avesmapsHydroVorlage(hydro.ECOSYSTEM_HYDRO_MORPHOLOGIEN, "karst").koernung,
				"der Regler zeigt einen anderen Wert als die Fläche trägt");
		});

		pruefe("die Herkunft wird gemerkt, damit ↺ und Titel einen Bezugspunkt haben", () => {
			assert.strictEqual(flaeche.terrain_preset_morph, "karst",
				"die gewählte Vorlage wurde nicht gemerkt");
		});
	}

	// ---- 2. Die Höhenstufe -- der zweite gemeldete Fall --------------------------------------------

	{
		const flaeche = await oeffneGebirge();
		waehle("hoehenstufe", "mittelgebirge");

		pruefe("eine Höhenstufe setzt die Kammhöhe der Fläche", () => {
			// 🔴 „warum höhenstufe nichts mit den höhen tut" (05.09.2026). `terrain_avg_height` ist
			// die EINZIGE Höhe, die der Trichter kennt (`maximalhoehe`), und ohne sie bleibt eine
			// Fläche ohne Gipfel exakt flach -- siehe `avesmapsGebirgsRasterBauen`.
			assert.strictEqual(flaeche.terrain_avg_height, 1500,
				"die Höhenstufe erreicht die Fläche nicht -- das Höhenbild bleibt, wie es war");
			assert.strictEqual(flaeche.terrain_preset_hoehe, "mittelgebirge",
				"die gewählte Höhenstufe wurde nicht gemerkt");
		});

		pruefe("und sie fasst KEINEN Formregler an", () => {
			// ⚠️ Zwei Tabellen, zwei Fragen. Griffe die Höhenstufe an die Form, überschriebe die Wahl
			// der Höhe still die Morphologie daneben.
			assert.strictEqual(flaeche.terrain_grain, undefined,
				"die Höhenstufe hat einen Formregler mitgesetzt");
			assert.strictEqual(flaeche.terrain_plateau, undefined,
				"die Höhenstufe hat das Plateau mitgesetzt");
		});
	}

	// ---- 3. Beide nacheinander -- die eine darf die andere nicht abräumen --------------------------

	{
		const flaeche = await oeffneGebirge();
		waehle("morphologie", "kammgebirge");
		waehle("hoehenstufe", "hochgebirge");

		pruefe("Form und Höhe stehen nebeneinander, nicht nacheinander", () => {
			assert.strictEqual(flaeche.terrain_avg_height, 3200, "die Höhenstufe kam nicht an");
			assert.strictEqual(flaeche.terrain_grain,
				hydro.avesmapsHydroVorlage(hydro.ECOSYSTEM_HYDRO_MORPHOLOGIEN, "kammgebirge").koernung,
				"die Höhenstufe hat die Morphologie davor abgeräumt");
			assert.strictEqual(flaeche.terrain_preset_morph, "kammgebirge",
				"die gemerkte Morphologie ging beim Wählen der Höhenstufe verloren");
			assert.strictEqual(flaeche.terrain_preset_hoehe, "hochgebirge",
				"die gemerkte Höhenstufe fehlt");
		});
	}

	// ---- 4. Der Wert, den der Regler NICHT annimmt, darf auch nicht gespeichert werden -------------

	{
		const flaeche = await oeffneGebirge();
		// Eine Vorlage mit einem Wert ausserhalb der Reglerspanne. 🔴 Sie steht NUR im Test: die zehn
		// echten liegen alle in ihren Schranken (`gelaende-vorlagen.test.js` hält das fest). Geprüft
		// wird der WEG -- dass die Fläche den Wert vom Regler bekommt und nicht aus der Tabelle.
		const uebermass = [{ key: "pruefform", name: "Prüfform", werte: { hypsometrie: 9 } }];
		kontext.ECOSYSTEM_HYDRO_MORPHOLOGIEN.push(uebermass[0]);
		try {
			waehle("morphologie", "pruefform");
			pruefe("ein Wert ausserhalb der Reglerspanne wird gekappt, bevor er in die Fläche geht", () => {
				const max = Number(element("ecosystem-properties-hypsometrie").max);
				assert.strictEqual(flaeche.terrain_hypsometrie, max,
					"die Fläche trägt " + flaeche.terrain_hypsometrie + " statt der gekappten " + max
					+ " -- gespeichert würde damit ein anderes Gelände als das gezeigte");
			});
		} finally {
			kontext.ECOSYSTEM_HYDRO_MORPHOLOGIEN.pop();
		}
	}

	// ---- 5. Speichern: eine ausdrücklich gewählte NULL ist eine Entscheidung -----------------------

	{
		const flaeche = await oeffneGebirge();
		waehle("morphologie", "karst");           // Karst setzt `hypsometrie: 0` -- ausdrücklich.
		let gesendet = null;
		const echt = kontext.postEcosystemEdit;
		kontext.postEcosystemEdit = async (aktion, rumpf) => {
			if (aktion === "update_area_terrain") {
				gesendet = rumpf;
				// Der Server antwortet mit dem, was er gespeichert hat -- hier: was ankam.
				// Wie der echte Endpunkt: leer = NULL („ableiten"), sonst die ZAHL zurück
				// (`avesmapsUpdateEcosystemAreaTerrain` castet jedes Feld auf float/int).
				const antwort = { public_id: rumpf.public_id };
				Object.keys(rumpf).forEach((k) => {
					if (k === "public_id") { return; }
					if (k.startsWith("terrain_preset_")) { antwort[k] = rumpf[k] === "" ? null : rumpf[k]; return; }
					antwort[k] = rumpf[k] === "" ? null : Number(rumpf[k]);
				});

				return antwort;
			}

			return echt(aktion, rumpf);
		};
		try {
			element("ecosystem-properties-terrain-build").feuere("click");
			await new Promise((f) => setTimeout(f, 0));
		} finally {
			kontext.postEcosystemEdit = echt;
		}

		pruefe("eine gewählte 0 wird gespeichert, nicht als „ableiten\" verworfen", () => {
			// 💣 `String(regler?.value || "")` macht aus der Null einen leeren String, und leer heisst
			// im Endpunkt NULL = „leite den Wert ab". Eine ausdrücklich eingestellte 0 -- die
			// Hypsometrie des Karst, eine Bergform 0, eine Kammhöhe 0 -- war damit kein Wert, sondern
			// ein Verzicht. Beim nächsten Öffnen stand die abgeleitete Vorgabe da.
			assert.ok(gesendet, "der Knopf „Höhenfeld erzeugen\" hat gar nicht gespeichert");
			assert.strictEqual(gesendet.terrain_hypsometrie, "0",
				"die gewählte 0 wurde als „" + gesendet.terrain_hypsometrie
				+ "\" geschickt -- der Server liest das als „ableiten\" und verwirft die Entscheidung");
		});

		pruefe("und sie kommt als 0 zurück in die Fläche, nicht als null", () => {
			assert.strictEqual(flaeche.terrain_hypsometrie, 0,
				"nach dem Speichern trägt die Fläche " + flaeche.terrain_hypsometrie
				+ " statt der gespeicherten 0");
		});
	}

	// ---- 6. Und der Vertrag von vorher gilt weiter -------------------------------------------------

	{
		const flaeche = await oeffneGebirge();
		fremdeAufrufe.length = 0;
		waehle("morphologie", "rumpfgebirge");
		waehle("hoehenstufe", "tiefland");

		pruefe("eine Vorlage schreibt NICHT in die Datenbank", () => {
			// 🔴 Der Editor sieht das Ergebnis und entscheidet dann -- dieselbe Trennung wie bei jedem
			// anderen Regler, und der Grund, warum „Auf Automatik zurück" daneben noch etwas bedeutet.
			// ⚠️ GEZÄHLT, nicht am globalen Fehlerzustand abgelesen: `process.exitCode` trägt jeden
			// vorherigen roten Fall mit und hielte diese Zusicherung für verletzt, sobald irgendwo
			// sonst etwas schiefging -- eine Zusicherung, die fremde Fehler meldet, sagt nichts.
			assert.deepStrictEqual(fremdeAufrufe, [],
				"beim Anwenden einer Vorlage ging ein Serveraufruf hinaus: " + fremdeAufrufe.join(", "));
			assert.strictEqual(flaeche.terrain_avg_height, 150,
				"die zweite Vorlage kam nicht an -- dann prüft die Zusicherung darüber nichts");
		});
	}

	// ---- 6b. Eine Fläche, die gar kein Relief bekommen KANN, sagt das ------------------------------

	{
		// Die Bühne hat keine Beschriftungen, also keine Gipfel -- genau die Lage der
		// „Salamandersteine" (live gemessen 05.09.2026: 0 Gipfel, terrain_avg_height NULL).
		const flaeche = await oeffneGebirge();

		pruefe("ohne Gipfel und ohne Kammhöhe steht der Hinweis da", () => {
			assert.strictEqual(element("ecosystem-properties-terrain-flachhint").hidden, false,
				"das Fenster schweigt, obwohl die Fläche flach bleiben MUSS -- der Editor stellt zwölf "
				+ "Regler ein, die nichts bewirken können");
		});

		pruefe("sobald eine Kammhöhe da ist, verschwindet er wieder", () => {
			waehle("hoehenstufe", "mittelgebirge");
			assert.strictEqual(element("ecosystem-properties-terrain-flachhint").hidden, true,
				"der Hinweis bleibt stehen, obwohl die Höhenstufe das Problem gerade gelöst hat");
			assert.strictEqual(flaeche.terrain_avg_height, 1500, "die Höhenstufe kam nicht an");
		});
	}

	// ---- 6c. „Gebirgszug ermitteln" legt die fehlende Höhe vor ------------------------------------

	{
		const flaeche = await oeffneGebirge();
		const echt = kontext.postEcosystemEdit;
		kontext.postEcosystemEdit = async (aktion, rumpf) => {
			if (aktion === "compute_ridge") {
				return { gerechnet: true, terrain_ridge_line: [[1, 1], [5, 5], [9, 9]] };
			}

			return echt(aktion, rumpf);
		};
		try {
			element("ecosystem-properties-terrain-ridge").feuere("click");
			await new Promise((f) => setTimeout(f, 0));
		} finally {
			kontext.postEcosystemEdit = echt;
		}

		pruefe("die Linie kommt an -- und mit ihr eine Kammhöhe, sonst bliebe es leer", () => {
			// 🔴 Owner-Entscheid 05.09.2026 („Beides"): der Knopf liefert die Linie, und wenn sonst
			// nichts da ist, gleich eine Höhe dazu -- als VORSCHAU, sichtbar als „noch nicht
			// gespeichert". Eine Linie ohne Höhe ist ein Knopf, der sauber liefert und nichts bewirkt.
			assert.deepStrictEqual(flaeche.terrain_ridge_line, [[1, 1], [5, 5], [9, 9]],
				"die gerechnete Kammlinie kam nicht in der Fläche an");
			assert.strictEqual(flaeche.terrain_avg_height, 1500,
				"die Kammhöhe wurde nicht vorbelegt -- die Fläche bleibt trotz Kammlinie flach");
			assert.strictEqual(flaeche.terrain_preset_hoehe, "mittelgebirge",
				"die vorbelegte Höhe hat keine Herkunft -- dann zeigt ihr ↺ auf nichts");
		});

		pruefe("und die Statuszeile sagt, dass da etwas vorbelegt wurde", () => {
			// ⚠️ Eine stille Vorbelegung wäre eine Behauptung über das Gebirge, die niemand getroffen
			// hat. Der Satz nennt die Zahl UND dass sie noch nicht gespeichert ist.
			const text = String(element("ecosystem-properties-terrain-status").textContent || "");
			assert.ok(/1500/.test(text) && /nicht gespeichert/i.test(text),
				"die Statuszeile verschweigt die Vorbelegung: „" + text + "\"");
		});

		pruefe("bei einer Fläche MIT Kammhöhe wird nichts vorbelegt", () => {
			// ⚠️ Die Vorbelegung füllt eine LÜCKE. Ein vorhandener Wert wird nie überschrieben --
			// sonst nähme der Knopf eine getroffene Entscheidung zurück.
			assert.strictEqual(flaeche.terrain_avg_height, 1500);
			flaeche.terrain_avg_height = 900;
			element("ecosystem-properties-terrain-ridge").feuere("click");

			return new Promise((f) => setTimeout(() => {
				assert.strictEqual(flaeche.terrain_avg_height, 900,
					"eine vorhandene Kammhöhe wurde überschrieben");
				f();
			}, 0));
		});
	}

	// ---- 7. Wer offen ist, sagt das Fenster -- und ein geschlossenes hat NIEMANDEN offen ----------

	{
		await oeffneGebirge();
		const fenster = kontext.window.AvesmapsEcosystemProperties;

		pruefe("das offene Fenster nennt seine Fläche", () => {
			// Der Loader fragt genau hier nach, bevor er die Flächen neu lädt
			// (`avesmapsEcosystemOffeneGelaendeflaeche`). Antwortet das Fenster nichts, ist die
			// ungespeicherte Vorschau beim nächsten Schwenk weg.
			assert.strictEqual(fenster.offeneFlaeche(), "f-1",
				"das Fenster nennt seine offene Fläche nicht -- der Schutz der Vorschau greift nie");
		});

		pruefe("ein GESCHLOSSENES Fenster hat keine offene Fläche", () => {
			// 💣 DIE GEGENRICHTUNG, und sie ist die gefährlichere. `propertiesSourcePublicId` bleibt
			// nach dem Schliessen stehen; ohne die Abfrage auf `isOpen` schützte der Loader die
			// zuletzt bearbeitete Fläche FÜR IMMER vor frischen Serverwerten -- und das ist genau die
			// Störung („meine Änderung kommt nicht an"), die dieses Projekt schon mehrfach bezahlt hat.
			// ⚠️ Die WIRKUNG wird geprüft, nicht ihr Weg: sie entsteht heute aus zwei Quellen -- dem
			// `isOpen`-Riegel im Export UND der Aufräumzeile in `closeEcosystemPropertiesDialog`, die
			// `propertiesSourcePublicId` leert. Eine Mutationsprobe am 05.09.2026 hat den Riegel
			// deshalb als wirkungslos ausgewiesen; das ist richtig gemessen und kein Testloch. Fällt
			// eine der beiden Quellen weg, hält die andere -- fallen beide, wird diese Zeile rot.
			fenster.close();
			assert.strictEqual(fenster.isOpen(), false, "der Dialog liess sich nicht schliessen");
			assert.strictEqual(fenster.offeneFlaeche(), "",
				"ein geschlossenes Fenster nennt weiter eine Fläche -- die friert dann dauerhaft ein");
		});
	}

	if (!process.exitCode) {
		console.log("\n" + gehalten + " Zusicherungen gehalten.");
	}
})();
