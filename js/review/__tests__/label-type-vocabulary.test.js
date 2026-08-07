// Welche Art-Liste der Label-Dialog anbietet -- freies Label gegen Flächenlabel.
//
// 🔴 DIE HERKUNFT ENTSCHEIDET, NICHT DIE VORGESCHICHTE. Ein Label, das über „Hier hinzufügen ->
// Neues Label" (oder „Höhenpunkt setzen", oder das Ziehen einer Wiki-Region auf die Karte) entsteht,
// ist ein FREIES Label: es hängt an keiner Landschaftsfläche und kann in diesem Moment auch an keiner
// hängen. Ihm gehört die volle Liste aus dem Markup. Nur ein Label, das WIRKLICH an einer Fläche
// hängt, bekommt das eingedampfte Vokabular seiner Ebene.
//
// 💣 Was das kostete (Editor-Meldung 2026-08-07): das Auswahlfeld ist über alle Dialoge DASSELBE
// Element. Wer ein Topographie-Flächenlabel öffnete und danach ein neues Label anlegte, bekam die
// dreizehn Topographie-Arten vorgesetzt -- ohne „Berggipfel", denn Gipfel sind Punkte und keine
// Flächen. Und weil „Höhenpunkt setzen" den Dialog öffnet und danach `value = "berggipfel"` setzt,
// ging diese Zuweisung in derselben Lage STILL ins Leere: der Punkt entstand als `region`-Label ohne
// Höhenzeile, ohne Fehler, ohne Meldung.
//
// 🔴 Geprüft wird die ECHTE Datei in einer vm-Sandbox gegen das ECHTE Markup aus index.html -- eine
// abgeschriebene Options-Liste im Test bestünde auch dann, wenn das Markup längst anders aussieht.
//
// Ausführen, vom Repo-Wurzelverzeichnis:
//   node js/review/__tests__/label-type-vocabulary.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..", "..", "..");

// Der ECHTE Titelbauer, nicht einer für den Test nachgebaut -- sonst prüfte der Titel-Teil unten den
// Stub. Dieselbe Vorbereitung wie in js/map-features/__tests__/ecosystem-rendering.test.js: die Datei
// liest `ecosystemGeometryArea` aus dem globalen Bereich.
global.ecosystemGeometryArea = require("../../map-features/map-features-ecosystem-geometry.js").ecosystemGeometryArea;
const { ecosystemDialogTitle } = require("../../map-features/map-features-ecosystem-rendering.js");

// ---- Das echte Markup des Auswahlfelds aus index.html --------------------------------------------

const indexHtml = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const selectMatch = indexHtml.match(/<select id="label-edit-type"[^>]*>([\s\S]*?)<\/select>/);
assert.ok(selectMatch, "das Auswahlfeld label-edit-type steht in index.html");
const FULL_MARKUP = selectMatch[1];
const FULL_VALUES = [...FULL_MARKUP.matchAll(/<option value="([^"]*)"/g)].map((treffer) => treffer[1]);
assert.ok(FULL_VALUES.includes("berggipfel"), "die volle Liste führt berggipfel");
assert.ok(FULL_VALUES.length > 20, `die volle Liste hat mehr als 20 Arten (${FULL_VALUES.length})`);

// ---- Ein Auswahlfeld, das sich wie ein echtes verhält ---------------------------------------------

// 💣 Der value-Setter ist der Kern dieses Tests: ein Wert, den keine Option trägt, HAFTET NICHT --
// genau daran ist „Höhenpunkt setzen" still gescheitert. Ein Stub, der jeden Wert annimmt, würde den
// Fehler wegdefinieren.
function createSelect(markup) {
	const select = {
		options: [],
		_value: "",
		appendChild(option) {
			this.options.push(option);
			if (this.options.length === 1 && this._value === "") {
				this._value = option.value;
			}
		},
		get innerHTML() {
			return this.options.map((option) => `<option value="${option.value}">${option.text}</option>`).join("");
		},
		set innerHTML(html) {
			this.options = [...String(html).matchAll(/<option value="([^"]*)"[^>]*>([\s\S]*?)<\/option>/g)]
				.map((treffer) => ({ value: treffer[1], text: treffer[2].trim() }));
			this._value = this.options.length > 0 ? this.options[0].value : "";
		},
		get value() {
			return this._value;
		},
		set value(wanted) {
			this._value = this.options.some((option) => option.value === String(wanted)) ? String(wanted) : "";
		},
	};
	select.innerHTML = markup;
	return select;
}

function values(select) {
	return select.options.map((option) => option.value);
}

// ---- Ein Fake-DOM, gerade gross genug für populateLabelEditForm -----------------------------------

function createSandbox() {
	const typeSelect = createSelect(FULL_MARKUP);
	const elements = new Map([["label-edit-type", typeSelect]]);

	const stubElement = () => ({
		value: "",
		checked: false,
		hidden: false,
		textContent: "",
		options: [],
		appendChild() {},
		focus() {},
		querySelector: () => null,
	});

	const document = {
		getElementById(id) {
			if (!elements.has(id)) {
				elements.set(id, stubElement());
			}
			return elements.get(id);
		},
		querySelectorAll: () => [],
		createElement: () => ({ label: "", appendChild() {} }),
		addEventListener() {},
	};

	const sandbox = {
		console,
		document,
		window: undefined,
		L: { latLng: (value) => value },
		Option: function Option(text, value) {
			return { text: String(text), value: String(value) };
		},
		$: () => ({ prop() {} }),
		acquireFeatureSoftLock: () => {},
		syncModalDialogBodyState: () => {},
		setLabelEditStatus: () => {},
		ECOSYSTEM_KINDS: ["derographisch", "vegetation", "topographie"],
		ECOSYSTEM_KIND_LABELS: { topographie: "Topographie" },
		ecosystemRegionsByKind: {},
		ecosystemRegionTypesByKind: {},
		ecosystemRegionOfLabel: () => null,
		loadEcosystemRegions: async () => {},
		ecosystemDialogTitle,
		isEcosystemPeakSubtype: (subtype) => ["berggipfel", "vulkan"].includes(String(subtype || "")),
		labelMarkers: [],
	};
	vm.createContext(sandbox);
	vm.runInContext(fs.readFileSync(path.join(ROOT, "js", "review", "review-labels.js"), "utf8"), sandbox, {
		filename: "review-labels.js",
	});

	return { sandbox, typeSelect, elements };
}

// 💣 EINE Injektion je Sandbox. `labelTypeFullMarkup` ist ein Top-Level-`let` und liegt damit NICHT am
// Sandbox-Global -- eine zweite Injektion in dieselbe Sandbox liefe gegen einen frischen Satz
// Variablen und der Test spiegelte den alten Stand.

// ---- Die Vokabellage einer Ebene, so wie sie live steht ------------------------------------------

// Die Topographie führt Flächen-Arten. Kein `berggipfel`: ein Gipfel ist ein Punkt.
const TOPOGRAPHIE_TYPEN = [
	{ type_key: "gebirge", label: "Gebirge" },
	{ type_key: "see", label: "See" },
	{ type_key: "meer", label: "Meer" },
	{ type_key: "kueste", label: "Küste" },
	{ type_key: "huegelland", label: "Hügelland" },
	{ type_key: "wadi", label: "Wadi" },
	{ type_key: "schlucht", label: "Schlucht" },
	{ type_key: "hochebene", label: "Hochebene" },
	{ type_key: "tiefebene", label: "Tiefebene" },
	{ type_key: "tal", label: "Tal" },
	{ type_key: "flussdelta", label: "Flussdelta" },
	{ type_key: "insel", label: "Insel" },
];
assert.ok(
	!TOPOGRAPHIE_TYPEN.some((typ) => typ.type_key === "berggipfel"),
	"die Topographie-Ebene führt kein berggipfel -- das ist die Voraussetzung dieses Tests",
);

const FLAECHEN_REGION = { kind: "topographie", public_id: "eco-1", name: "Ehernes Schwert", area_count: 1 };

// renderLabelCarrierNote ist async (sie wartet auf die Regionslisten) -- ohne dieses Warten prüften
// die Fälle 3 und 4 den Stand VOR der Verfeinerung und bestünden auch dann, wenn sie nie liefe.
const nachDerVerfeinerung = () => new Promise((fertig) => setImmediate(fertig));

function oeffneFlaechenlabel({ sandbox, typeSelect }) {
	sandbox.ecosystemRegionTypesByKind = { topographie: TOPOGRAPHIE_TYPEN };
	sandbox.ecosystemRegionsByKind = { topographie: [FLAECHEN_REGION] };
	sandbox.ecosystemRegionOfLabel = () => FLAECHEN_REGION;
	sandbox.applyLabelTypeVocabulary(FLAECHEN_REGION, { labelType: "gebirge", publicId: "lbl-1" });
	assert.ok(!values(typeSelect).includes("berggipfel"), "Vorbedingung: das Flächenlabel dampft die Liste ein");
}

async function main() {
	// ---- 1. Ein neues Label nach einem Flächenlabel: volle Liste -----------------------------------

	{
		const umgebung = createSandbox();
		const { sandbox, typeSelect } = umgebung;
		oeffneFlaechenlabel(umgebung);

		// „Hier hinzufügen -> Neues Label": kein labelEntry, nur ein Punkt auf der Karte.
		sandbox.populateLabelEditForm({ latlng: { lat: 500, lng: 500 } });
		await nachDerVerfeinerung();

		assert.deepStrictEqual(
			values(typeSelect),
			FULL_VALUES,
			"ein neues Label bekommt die volle Liste aus dem Markup, nicht die Reste des zuletzt geöffneten",
		);
		assert.strictEqual(typeSelect.value, "region", "und steht auf der neutralen Art");
		assert.strictEqual(
			umgebung.elements.get("label-edit-title").textContent,
			"Freies Label bearbeiten",
			"und der Titel nennt die Form: ein neues Label kann keine Fläche haben, das steht sofort fest",
		);
	}

	// ---- 2. „Höhenpunkt setzen" trifft danach wirklich berggipfel ----------------------------------

	{
		const umgebung = createSandbox();
		const { sandbox, typeSelect } = umgebung;
		oeffneFlaechenlabel(umgebung);

		// Genau die zwei Schritte aus startNewEcosystemPeak (map-features-ecosystem-context-action.js).
		sandbox.populateLabelEditForm({ latlng: { lat: 500, lng: 500 } });
		typeSelect.value = "berggipfel";
		sandbox.syncLabelHeightRow();

		assert.strictEqual(typeSelect.value, "berggipfel", "der Höhenpunkt wird ein Berggipfel, kein region-Label");
		assert.strictEqual(
			umgebung.elements.get("label-edit-height-row").hidden,
			false,
			"und seine Höhenzeile ist da",
		);
	}

	// ---- 3. Ein bestehendes Flächenlabel behält sein eingedampftes Vokabular -----------------------

	// ⚠️ Die Gegenprobe. Wäre die Heilung aus 1. zu breit -- etwa eine Wiederherstellung, die NACH der
	// Verfeinerung liefe --, stünde hier wieder die volle Liste und ein Waldstück dürfte „Gebirge" heissen.

	{
		const umgebung = createSandbox();
		const { sandbox, typeSelect } = umgebung;
		const label = { labelType: "gebirge", publicId: "lbl-1" };
		sandbox.ecosystemRegionTypesByKind = { topographie: TOPOGRAPHIE_TYPEN };
		sandbox.ecosystemRegionsByKind = { topographie: [FLAECHEN_REGION] };
		sandbox.ecosystemRegionOfLabel = () => FLAECHEN_REGION;

		sandbox.populateLabelEditForm({ labelEntry: { label, marker: { getLatLng: () => ({ lat: 1, lng: 2 }) } } });

		// 🪤 ZUERST der Zwischenstand, VOR dem Warten: solange die Fläche nicht aufgelöst ist, weiss der
		// Dialog die Form nicht. „Freies Label" wäre hier eine Behauptung, die sich gleich als falsch
		// erweist -- und ein Titel, der von „frei" auf „Topographie" springt, ist schlimmer als einer, der
		// erst allgemein bleibt.
		assert.strictEqual(
			umgebung.elements.get("label-edit-title").textContent,
			"Label bearbeiten",
			"vor der Auflösung bleibt der Titel allgemein",
		);

		await nachDerVerfeinerung();

		assert.ok(
			!values(typeSelect).includes("berggipfel"),
			"ein Flächenlabel bietet weiter nur die Arten seiner Ebene an",
		);
		assert.strictEqual(typeSelect.value, "gebirge", "und behält seine eigene Art");
		assert.strictEqual(
			umgebung.elements.get("label-edit-title").textContent,
			"Topographie-Label bearbeiten",
			"und der Titel nennt seine Ebene -- die Worte des Owners von 2026-07-28, unverändert",
		);
	}

	// ---- 4. Ein bestehendes Label OHNE Fläche ist ebenfalls frei -----------------------------------

	{
		const umgebung = createSandbox();
		const { sandbox, typeSelect } = umgebung;
		oeffneFlaechenlabel(umgebung);
		sandbox.ecosystemRegionOfLabel = () => null;

		const label = { labelType: "kontinent", publicId: "lbl-2" };
		sandbox.populateLabelEditForm({ labelEntry: { label, marker: { getLatLng: () => ({ lat: 1, lng: 2 }) } } });
		await nachDerVerfeinerung();

		assert.deepStrictEqual(values(typeSelect), FULL_VALUES, "ein Kontinent-Label gehört zu keiner Ebene");
		assert.strictEqual(typeSelect.value, "kontinent", "und behält seine Art");
		assert.strictEqual(
			umgebung.elements.get("label-edit-title").textContent,
			"Freies Label bearbeiten",
			"und heisst nach der Auflösung ebenfalls frei -- die Form hängt an der Fläche, nicht am Alter",
		);
	}

	console.log("label-type-vocabulary: alle Prüfungen bestanden");
}

main().catch((fehler) => {
	console.error(fehler);
	process.exit(1);
});
