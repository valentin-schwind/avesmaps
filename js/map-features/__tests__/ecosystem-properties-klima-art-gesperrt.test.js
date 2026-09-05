// Die Art einer KLIMAZONE steht im Kartendialog „Fläche bearbeiten" fest (22.08.2026).
//
// 💣 ZUR LAUFZEIT GEFAHREN, NICHT PER GREP -- und das ist hier der ganze Punkt. Das Auswahlfeld wird
// beim Öffnen ZWEIMAL neu gebaut: einmal leer, einmal nach `list_regions` mit dem Vokabular der Ebene.
// Ein Suchmuster fände ein `disabled` an der ersten Stelle und hielte die Sperre für gebaut, während
// der zweite Bau sie eine halbe Sekunde später wieder abräumt. Dieser Test öffnet den Dialog wirklich
// und sieht nach, was am ENDE dasteht.
//
// ⚠️ Der Riegel, der zählt, steht auf dem Server (avesmapsUpdateEcosystemRegion). Hier geht es allein
// darum, dass der Editor gar nicht erst versucht, was gleich darauf abgelehnt würde -- und dass er
// erfährt, WARUM.

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const wurzel = path.join(__dirname, "..", "..", "..");

// ---- Die Bühne: gerade so viel DOM, dass der Dialog aufgeht ---------------------------------------

class Attrappe {
	constructor(id) {
		this.id = id;
		this.options = [];
		this.value = "";
		this.disabled = false;
		this.hidden = false;
		this.checked = false;
		this.textContent = "";
		this.title = "";
		this.min = "0";
		this.max = "0";
		this.style = {};
		this.classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
	}

	get innerHTML() { return this._html || ""; }

	// 🪤 `innerHTML = ""` ist im Dialog das Leeren des Auswahlfeldes -- die Attrappe muss die Optionen
	// dabei wirklich verlieren, sonst wüchse die Liste bei jedem Bau und der Test sähe den Neubau nie.
	set innerHTML(wert) {
		this._html = String(wert);
		if (String(wert) === "") {
			this.options = [];
		}
	}

	appendChild(kind) { this.options.push(kind); return kind; }
	replaceChildren() { this.options = []; }
	addEventListener() {}
	setAttribute(name, value) { this[name] = String(value); }
	removeEventListener() {}
	focus() {}
	select() {}
	remove() {}
	querySelector() { return null; }
	querySelectorAll() { return []; }
	closest() { return null; }
}

const knoten = new Map();

function element(id) {
	if (!knoten.has(id)) {
		knoten.set(id, new Attrappe(id));
	}
	return knoten.get(id);
}

// Die Ebenen, so wie `list_regions` sie kennt: Klima trägt die Zonen, Vegetation die Bewuchsarten.
const ARTEN = {
	klima: [
		{ type_key: "gemaessigt", label: "Gemäßigt" },
		{ type_key: "tropisch", label: "Tropisch" },
	],
	vegetation: [
		{ type_key: "wald", label: "Wald" },
		{ type_key: "wueste", label: "Wüste" },
	],
};

const flaechen = new Map();

const kontext = {
	console,
	Map,
	Set,
	Array,
	Number,
	String,
	Boolean,
	Object,
	JSON,
	Math,
	Promise,
	Error,
	module: { exports: {} },
	setTimeout,
	clearTimeout,
	Option: function Option(label, value) { return { label, value }; },
	document: {
		readyState: "complete",
		getElementById: (id) => element(id),
		createElement: () => new Attrappe("neu"),
		addEventListener: () => {},
		documentElement: {},
	},
	ecosystemLayers: flaechen,
	// Der einzige Nachbar, der hier wirklich etwas entscheidet -- absichtlich der ECHTE, denn genau
	// er ist die Stelle, an der die Frage „wird diese Ebene abgeleitet?" EINMAL beantwortet wird.
	isDerivedEcosystemKind: require("../map-features-ecosystem-rendering.js").isDerivedEcosystemKind,
	emptyTypeLabel: () => "— ohne Art —",
	findLabelEntryByPublicId: () => null,
	// `list_regions` ist der einzige Aufruf, den das Öffnen macht.
	postEcosystemEdit: async (aktion, rumpf) => {
		assert.strictEqual(aktion, "list_regions", `Unerwarteter Aufruf beim Öffnen: ${aktion}`);
		return {
			region_types: ARTEN[rumpf.kind] || [],
			regions: [{ public_id: "r-1", area_count: 1 }],
		};
	},
};
kontext.window = { requestAnimationFrame: () => 0 };
kontext.globalThis = kontext;
vm.createContext(kontext);
vm.runInContext(
	fs.readFileSync(path.join(wurzel, "js/map-features/map-features-ecosystem-properties.js"), "utf8"),
	kontext
);

async function oeffne(kind, regionType) {
	knoten.clear();
	flaechen.clear();
	flaechen.set("f-1", {
		_ecosystemArea: {
			public_id: "f-1",
			region_public_id: "r-1",
			region_name: "Prüffläche",
			kind,
			region_type: regionType,
			geometry: { type: "Polygon", coordinates: [[[0, 0], [10, 0], [10, 10], [0, 0]]] },
		},
	});
	await kontext.window.AvesmapsEcosystemProperties.open("f-1");
	// 🔴 Die Artauswahl heisst seit dem 25.08.2026 `label-edit-type` und steht im GEMEINSAMEN KOPF:
	// Flaeche und Beschriftung teilen sie sich (live in 613 von 613 Paaren mit Art identisch).
	// Das Flaechenmodul erreicht sie ueber AVESMAPS_ECO_ZWILLINGE, sein Code sagt weiter
	// `propertiesElement("type")` -- die Sperre bei einer Klimazone gilt unveraendert.
	return { art: element("label-edit-type"), hinweis: element("ecosystem-properties-typehint") };
}

(async () => {
	// ---- Die Klimazone: gesperrt, erklärt -- und trotzdem lesbar -----------------------------------

	const klima = await oeffne("klima", "tropisch");

	assert.strictEqual(
		klima.art.disabled,
		true,
		"Das Auswahlfeld „Art\" ist bei einer Klimazone bedienbar. Der Server lehnt die Änderung ab "
			+ "(avesmapsUpdateEcosystemRegion) -- der Editor erführe das erst beim Speichern, als "
			+ "Fehlermeldung ohne Grund."
	);
	assert.strictEqual(
		klima.hinweis.hidden,
		false,
		"Die Erklärzeile fehlt. Ein graues Feld ohne Satz daneben ist kein Riegel, sondern eine "
			+ "Sackgasse -- der Zwilling im Editorfenster sagt seit dem 03.08.2026, warum es grau ist."
	);

	// ⚠️ Ohne diese Zusicherung prüfte die vorige nur den LADEZUSTAND: bis `list_regions` antwortet,
	// ist das Feld für jede Ebene gesperrt, und der Test wäre auch dann grün, wenn die Antwort nie
	// ankäme. Eine gefüllte Optionsliste beweist, dass er den fertigen Dialog misst.
	assert.ok(
		klima.art.options.length > 1,
		"Das Auswahlfeld wurde nach `list_regions` gar nicht befüllt -- dann prüft die Zusicherung "
			+ "darüber nur den Ladezustand und wäre auch bei einer Vegetationsfläche grün."
	);
	assert.strictEqual(
		klima.art.value,
		"tropisch",
		"Gesperrt heisst nicht leer: das Feld muss weiterhin ZEIGEN, welche der Zonen das ist. Ohne "
			+ "Wert stünde dort „— ohne Art —\", und das Speichern schickte eine Leerung an den Server."
	);

	// ---- Die gezeichnete Fläche: unverändert bedienbar ---------------------------------------------

	const vegetation = await oeffne("vegetation", "wald");

	assert.strictEqual(
		vegetation.art.disabled,
		false,
		"Die Sperre greift zu weit: eine gezeichnete Fläche muss ihre Art weiterhin ändern können. "
			+ "Sie gilt allein den ABGELEITETEN Ebenen (isDerivedEcosystemKind)."
	);
	assert.strictEqual(
		vegetation.hinweis.hidden,
		true,
		"Die Erklärzeile der Klimazone steht bei einer Vegetationsfläche da und erklärt dort etwas, "
			+ "das nicht zutrifft."
	);

	// ---- Und die zwei Oberflächen sagen DENSELBEN Satz ----------------------------------------------
	//
	// 🔴 Es gibt zwei Orte, an denen eine Region bearbeitet wird -- diesen Kartendialog und
	// html/landschaften-editor.html. Zwei Wortlaute für dieselbe Regel sind die Divergenz, die dieses
	// Haus überall sonst aufräumt (AGENTS.md §11, „Die Listenzeile -- es gibt ZWEI").

	const html = fs.readFileSync(path.join(wurzel, "index.html"), "utf8");
	const editor = fs.readFileSync(path.join(wurzel, "html/landschaften-editor.html"), "utf8");
	const SATZ = "Die Fläche dieser Zone entsteht aus den Trennlinien auf der Karte "
		+ "(Landschaften → Klimazonen). Art und Umriss lassen sich hier nicht ändern.";

	assert.ok(
		html.includes(SATZ),
		"Der Kartendialog trägt den Satz nicht mehr wortgleich (index.html)."
	);
	assert.ok(
		editor.includes(SATZ),
		"Das Editorfenster trägt den Satz nicht mehr wortgleich (html/landschaften-editor.html). "
			+ "Wer ihn dort umformuliert, muss ihn hier mitnehmen -- sonst erklärt dieselbe Regel sich "
			+ "an zwei Orten verschieden."
	);

	// Und er steht im Markup UNTER der Artauswahl, nicht irgendwo: eine Erklärung, die über dem
	// erklärten Feld steht, liest sich als Überschrift der ganzen Gruppe.
	const artStelle = html.indexOf('id="label-edit-type"');
	const hinweisStelle = html.indexOf('id="ecosystem-properties-typehint"');
	const flaechenStelle = html.indexOf('id="ecosystem-properties-areas"');
	assert.ok(
		artStelle > 0 && hinweisStelle > artStelle && hinweisStelle < flaechenStelle,
		"Die Erklärzeile gehört zwischen die Artauswahl und die Flächenzeile."
	);

	console.log("ok - ecosystem-properties-klima-art-gesperrt");
})();
