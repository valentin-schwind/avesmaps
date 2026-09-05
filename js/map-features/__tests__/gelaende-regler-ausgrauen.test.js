"use strict";

/**
 * Was gerade nichts bewirken kann, steht grau da.
 *
 * 🔴 Owner 05.09.2026: „doch grau aus was gerade nichts kann". Sieben Regler sind unter bestimmten
 * Bedingungen nachweislich wirkungslos -- gemessen am Rumpf von `avesmapsGebirgsRasterBauen`, nicht
 * geschätzt --, und das Fenster sagte es mit keinem Zeichen. Ein Editor drehte an einer Zahl, die
 * nichts bewirken KONNTE, und hielt das Werkzeug für kaputt.
 *
 * 💣 EINE REGEL, ZWEI LESER: der Trichter rechnet danach, das Fenster graut danach aus. Eine zweite
 * Fassung in der Oberfläche liefe beim nächsten Umbau auseinander, und der Fehler wäre in BEIDE
 * Richtungen still -- ein Regler, der grau ist und wirkt, oder einer, der wirkt und grau aussieht.
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

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   1. DIE REGEL -- jede Bedingung ist am Rechner abgelesen
   ══════════════════════════════════════════════════════════════════════════════════════════════ */

const ohneWirkung = hydro.avesmapsGebirgsReglerOhneWirkung;
const schluessel = (lage) => Object.keys(ohneWirkung(lage)).sort();

pruefe("bei voller Lage ist kein Regler stumm", () => {
	assert.deepStrictEqual(schluessel({ gipfel: 3, rauschen: 0.35, gewaesser: true }), []);
});

pruefe("Stärke des Rauschens auf 0 nimmt „Zahl\" und „Feinheit\" die Wirkung", () => {
	// 💣 GEMESSEN: `if (rauschen > 0)` umschliesst die GANZE Rauschschleife -- `koernung` und
	// `stufen` werden dann nie gelesen, und das Feld ist Bit fuer Bit dasselbe.
	assert.deepStrictEqual(schluessel({ gipfel: 3, rauschen: 0, gewaesser: true }),
		["terrain_grain", "terrain_levels"]);
});

pruefe("ohne Gewässer sind Talbreite und Taltiefe stumm", () => {
	assert.deepStrictEqual(schluessel({ gipfel: 3, rauschen: 0.35, gewaesser: false }),
		["terrain_einschnitt", "terrain_talbreite"]);
});

pruefe("ohne Gipfel sind Ausstrahlung und Durchhang stumm", () => {
	// ⚠️ Der Durchhang braucht ZWEI verschiedene Höhen: ohne Gipfel liegen alle Kammpunkte auf der
	// Kammhöhe, und zwischen zwei gleichen Höhen hängt nichts durch.
	assert.deepStrictEqual(schluessel({ gipfel: 0, rauschen: 0.35, gewaesser: true }),
		["terrain_bergform", "terrain_sattel"]);
});

pruefe("„weiss ich nicht\" graut NICHTS aus", () => {
	// 🔴 Im Zweifel lieber ein Regler zu viel bedienbar als einer, der grundlos gesperrt aussieht.
	assert.deepStrictEqual(schluessel({ gipfel: 3, rauschen: 0.35, gewaesser: null }), []);
	assert.deepStrictEqual(schluessel({ gipfel: 3, rauschen: 0.35 }), []);
});

pruefe("jeder stumme Regler nennt seinen Grund", () => {
	// ⚠️ Ein grauer Regler ohne Erklärung ist eine Sackgasse -- man sieht, dass etwas nicht geht,
	// und nicht, was man dagegen tun kann.
	const alle = Object.assign({},
		ohneWirkung({ gipfel: 0, rauschen: 0, gewaesser: false }));
	assert.strictEqual(Object.keys(alle).length, 6, "es sind nicht sechs stumme Regler");
	for (const [feld, grund] of Object.entries(alle)) {
		assert.ok(typeof grund === "string" && grund.length > 25,
			"der Grund für `" + feld + "` erklärt nichts: „" + grund + "\"");
	}
});

pruefe("die Sättigungsfälle stehen bewusst NICHT drin", () => {
	// 🔴 Die Massigkeit über ~0,6 und die tote Anlaufstrecke der Kammhöhe sind keine
	// „wirkt nicht"-Zustände, sondern „wirkt nicht MEHR" bzw. „wirkt noch nicht" -- sie hängen am
	// gerechneten Feld, nicht an einer Bedingung, die man ansehen kann. Sie stehen im Tooltip.
	// ⚠️ Ohne diese Zusicherung wäre der nächste Griff, sie „der Vollständigkeit halber"
	// dazuzunehmen -- und dann stünde ein Regler grau da, während er sehr wohl wirkt.
	const alle = ohneWirkung({ gipfel: 0, rauschen: 0, gewaesser: false });
	assert.ok(!("terrain_hypsometrie" in alle), "die Massigkeit wird ausgegraut -- sie wirkt aber");
	assert.ok(!("terrain_avg_height" in alle), "die Kammhöhe wird ausgegraut -- sie wirkt aber");
	assert.ok(!("terrain_plateau" in alle),
		"die Kammschärfe wird ausgegraut -- sie wirkt auch über den Mittelachsen-Rückfall");
});

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   2. DIE NAHT -- das Fenster liest die Regel wirklich, und es zieht beim Ziehen mit
   ══════════════════════════════════════════════════════════════════════════════════════════════ */

class Attrappe {
	constructor(id) {
		this.id = id;
		this.options = [];
		this._value = "";
		this._attr = {};
		this.hidden = false;
		this.disabled = false;
		this.checked = false;
		this.textContent = "";
		this.title = "";
		this.min = "";
		this.max = "";
		this.style = {};
		this.dataset = {};
		this._klassen = new Set();
		this._hoerer = new Map();
		this._eltern = null;
		this.classList = {
			add: (k) => this._klassen.add(k),
			remove: (k) => this._klassen.delete(k),
			toggle: (k, an) => (an ? this._klassen.add(k) : this._klassen.delete(k)),
			contains: (k) => this._klassen.has(k),
		};
	}

	get value() { return this._value; }
	set value(v) { this._value = String(v); }
	get innerHTML() { return this._html || ""; }
	set innerHTML(w) { this._html = String(w); if (String(w) === "") { this.options = []; } }
	appendChild(k) { this.options.push(k); return k; }
	replaceChildren() { this.options = []; }
	addEventListener(t, fn) {
		if (!this._hoerer.has(t)) { this._hoerer.set(t, []); }
		this._hoerer.get(t).push(fn);
	}
	feuere(t) { (this._hoerer.get(t) || []).forEach((fn) => fn({ target: this })); }
	removeEventListener() {}
	setAttribute(n, v) { this._attr[n] = String(v); this[n] = String(v); }
	getAttribute(n) { return Object.prototype.hasOwnProperty.call(this._attr, n) ? this._attr[n] : null; }
	// 🔴 DAS IST DER PUNKT DIESER BÜHNE: `syncReglerWirkung` greift über `closest` an die ZEILE.
	// Eine Attrappe, die dort `null` liefert, lässt die ganze Funktion still zurückkehren -- der
	// Test wäre grün und hätte nichts geprüft.
	closest(sel) {
		return sel === ".ecosystem-properties-dialog__terrainrow" ? this._eltern : null;
	}
	focus() {} select() {} remove() {} querySelector() { return null; } querySelectorAll() { return []; }
}

// 🔴 DIE TOOLTIPS KOMMEN AUS `index.html`, nicht aus dem Test. Sonst prüfte die Zusicherung
// „der ursprüngliche Tooltip überlebt" einen leeren String gegen einen leeren String -- ein Vakuum,
// das jede Fassung des Codes hält.
const markup = fs.readFileSync(path.join(wurzel, "index.html"), "utf8");
function titelAusMarkup(kid) {
	const block = markup.match(new RegExp(
		'<label class="ecosystem-properties-dialog__terrainrow"([^>]*)>[\\s\\S]{0,400}?'
		+ 'id="ecosystem-properties-' + kid + '" type="range"'));
	const t = block ? block[1].match(/title="([^"]*)"/) : null;

	return t ? t[1] : "";
}

const knoten = new Map();
const zeilen = new Map();
const element = (id) => {
	if (!knoten.has(id)) {
		const el = new Attrappe(id);
		// Jeder Regler bekommt seine Zeile -- so wie im Markup, samt ihrem echten Tooltip.
		const m = id.match(/^ecosystem-properties-(grain|levels|erosion|plateau|hypsometrie|avgheight|bergform|rauschen|sattel|talbreite|einschnitt)$/);
		if (m) {
			const zeile = new Attrappe(id + "-zeile");
			zeile.setAttribute("title", titelAusMarkup(m[1]));
			zeilen.set(id, zeile);
			el._eltern = zeile;
		}
		knoten.set(id, el);
	}

	return knoten.get(id);
};

const flaechen = new Map();
const kontext = {
	console: { log() {}, warn() {}, error() {} },
	Map, Set, Array, Number, String, Boolean, Object, JSON, Math, Promise, Error, Date,
	module: { exports: {} },
	setTimeout, clearTimeout,
	Option: function Option(l, v) { return { label: l, value: v }; },
	document: {
		readyState: "complete", activeElement: null,
		getElementById: (id) => element(id),
		createElement: () => new Attrappe("neu"),
		addEventListener: () => {}, documentElement: {},
	},
	ecosystemLayers: flaechen,
	labelData: [],
	isDerivedEcosystemKind: require(path.join(wurzel, "js/map-features/map-features-ecosystem-rendering.js")).isDerivedEcosystemKind,
	emptyTypeLabel: () => "— ohne Art —",
	findLabelEntryByPublicId: () => null,
	ECOSYSTEM_HYDRO_MORPHOLOGIEN: hydro.ECOSYSTEM_HYDRO_MORPHOLOGIEN,
	ECOSYSTEM_HYDRO_HOEHENSTUFEN: hydro.ECOSYSTEM_HYDRO_HOEHENSTUFEN,
	avesmapsHydroVorlage: hydro.avesmapsHydroVorlage,
	avesmapsHydroMorphSchluessel: hydro.avesmapsHydroMorphSchluessel,
	avesmapsGebirgeBleibtFlach: hydro.avesmapsGebirgeBleibtFlach,
	// Die ECHTE Regel -- eine Attrappe prüfte hier sich selbst.
	avesmapsGebirgsReglerOhneWirkung: hydro.avesmapsGebirgsReglerOhneWirkung,
	postEcosystemEdit: async (aktion) => (aktion === "list_regions"
		? { region_types: [{ type_key: "gebirge", label: "Gebirge" }], regions: [{ public_id: "r-1", area_count: 1 }] }
		: {}),
};
let gewaesserAntwort = true;
kontext.window = {
	requestAnimationFrame: () => 0,
	cancelAnimationFrame: () => {},
	AvesmapsEcosystemHeightRender: {
		isGrayscale: () => false, setGrayscale() {}, invalidate() {}, redraw() {},
		setPreviewCoarse() {}, betrifftAnzeige: () => true,
		gewaesserBeruehrt: () => gewaesserAntwort,
	},
};
kontext.globalThis = kontext;
vm.createContext(kontext);
vm.runInContext(
	fs.readFileSync(path.join(wurzel, "js/map-features/map-features-ecosystem-properties.js"), "utf8"),
	kontext
);

const STILL = "ecosystem-properties-dialog__terrainrow--still";
const istGrau = (kid) => zeilen.get("ecosystem-properties-" + kid)?.classList.contains(STILL) === true;

async function oeffne(zusatz) {
	flaechen.clear();
	flaechen.set("f-1", { _ecosystemArea: Object.assign({
		public_id: "f-1", region_public_id: "r-1", region_name: "Prüfgebirge",
		kind: "topographie", region_type: "gebirge",
		geometry: { type: "Polygon", coordinates: [[[0, 0], [10, 0], [10, 10], [0, 0]]] },
	}, zusatz || {}) });
	await kontext.window.AvesmapsEcosystemProperties.open("f-1");
}

(async () => {
	// Die Bühne hat keine Beschriftungen -> keine Gipfel. Gewässer: ja.
	gewaesserAntwort = true;
	await oeffne({ terrain_rauschen: 0.35 });

	pruefe("NAHT: ohne Gipfel stehen Ausstrahlung und Durchhang grau", () => {
		assert.ok(istGrau("bergform"), "„Ausstrahlung der Gipfel\" ist nicht ausgegraut");
		assert.ok(istGrau("sattel"), "„Durchhang zwischen den Gipfeln\" ist nicht ausgegraut");
	});

	pruefe("NAHT: was wirkt, bleibt normal", () => {
		assert.ok(!istGrau("talbreite"), "die Talbreite ist grau, obwohl ein Gewässer da ist");
		assert.ok(!istGrau("grain"), "die Zahl der Erhebungen ist grau, obwohl Rauschen läuft");
		assert.ok(!istGrau("hypsometrie"), "die Massigkeit ist grau -- sie wirkt aber immer");
	});

	pruefe("NAHT: der Grund steht im Tooltip der Zeile", () => {
		const titel = String(zeilen.get("ecosystem-properties-bergform").getAttribute("title") || "");
		assert.ok(/Wirkt gerade nicht/.test(titel) && /keinen Gipfel/.test(titel),
			"der Tooltip nennt den Grund nicht: „" + titel + "\"");
	});

	pruefe("NAHT: die Ausgrauung zieht beim ZIEHEN mit", () => {
		// 💣 Das ist der eigentliche Wert: „Stärke des Rauschens" auf 0 macht zwei Regler im selben
		// Moment wirkungslos. Eine Ausgrauung, die erst beim nächsten Öffnen nachkommt, ist keine
		// Rückmeldung, sondern ein zweiter Zustand.
		assert.ok(!istGrau("grain"), "Vorbedingung: die Zahl der Erhebungen darf noch nicht grau sein");
		const regler = element("ecosystem-properties-rauschen");
		regler.value = "0";
		regler.feuere("input");
		assert.ok(istGrau("grain"), "„Zahl der Erhebungen\" bleibt normal, obwohl die Stärke auf 0 steht");
		assert.ok(istGrau("levels"), "„Feinheit des Rauschens\" bleibt normal");
		// Und zurück.
		regler.value = "0.4";
		regler.feuere("input");
		assert.ok(!istGrau("grain"), "die Ausgrauung geht nicht wieder weg");
	});

	pruefe("NAHT: der ursprüngliche Tooltip überlebt den Wechsel -- UNVERÄNDERT", () => {
		// ⚠️ Er erklärt, was der Regler TUT -- das gilt auch, wenn er gerade nichts tut.
		// 💣 GEPRÜFT WIRD AUF ZEICHENGLEICHHEIT, nicht auf ein Stichwort. Eine Mutationsprobe hat
		// gezeigt, dass „steht `Rauschbuckel` noch drin?" jede Fassung hält: wird der Originaltitel
		// bei JEDEM Lauf neu gemerkt statt nur beim ersten, merkt sich der zweite Lauf den bereits
		// ergänzten Text als „Original" -- der Tooltip wächst dann mit jedem Reglerzug um einen
		// weiteren „Wirkt gerade nicht"-Vorsatz, und das Stichwort steht die ganze Zeit brav drin.
		const zeile = zeilen.get("ecosystem-properties-grain");
		const jetzt = String(zeile.getAttribute("title") || "");
		assert.strictEqual(jetzt, titelAusMarkup("grain"),
			"der Tooltip ist nach grau -> normal nicht mehr der ursprüngliche");
		assert.strictEqual((jetzt.match(/Wirkt gerade nicht/g) || []).length, 0,
			"der Vorsatz klebt noch am Tooltip, obwohl der Regler wieder wirkt");
	});

	pruefe("NAHT: und er bläht sich auch bei vielen Wechseln nicht auf", () => {
		const regler = element("ecosystem-properties-rauschen");
		const zeile = zeilen.get("ecosystem-properties-grain");
		for (let i = 0; i < 5; i++) {
			regler.value = "0";
			regler.feuere("input");
			regler.value = "0.4";
			regler.feuere("input");
		}
		assert.strictEqual(String(zeile.getAttribute("title") || ""), titelAusMarkup("grain"),
			"nach zehn Wechseln steht ein anderer Tooltip da als am Anfang");
	});

	// ---- Und die Gewässerfrage wird wirklich gestellt ---------------------------------------------

	gewaesserAntwort = false;
	await oeffne({ terrain_rauschen: 0.35 });

	pruefe("NAHT: ohne Gewässer stehen Talbreite und Taltiefe grau", () => {
		assert.ok(istGrau("talbreite"), "die Talbreite ist nicht ausgegraut");
		assert.ok(istGrau("einschnitt"), "die Taltiefe ist nicht ausgegraut");
	});

	if (!process.exitCode) {
		console.log("\n" + gehalten + " Zusicherungen gehalten.");
	}
})();
