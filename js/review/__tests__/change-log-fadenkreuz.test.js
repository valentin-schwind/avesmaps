// Das Fadenkreuz einer Zeile im Fenster „Änderungen" — es sagt, wo ein Sprung möglich ist.
//
// 💣 VORHER LOG DIE LISTE IN BEIDE RICHTUNGEN. Jede Zeile mit einer `public_id` sah aus wie ein
// Knopf; bei Landschaften und Herrschaftsgebieten kann der Browser diese Kennung aber gar nicht
// nachschlagen (er kennt Orte, Wege und Labels) und antwortete beim Klick mit „Objekt ist nicht mehr
// aktiv oder wurde noch nicht neu geladen." — über ein Objekt, das quicklebendig danebenlag. Owner
// 06.09.2026: „ich will nur wissen wo es geht (z.b. durch ein faden-kreuz-button, mit dem ich aufs
// ziel zoomen)".
//
// 🔴 Geprüft wird die ECHTE Datei in einer vm-Sandbox, und die Zeilenbauer LAUFEN — an einer
// Textsuche liesse sich „diese Zeile ist ein Knopf und jene nicht" nicht ablesen.
//
// Ausführen, vom Repo-Wurzelverzeichnis:
//   node js/review/__tests__/change-log-fadenkreuz.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..", "..", "..");
const QUELLE = path.join(ROOT, "js", "review", "review-panels-change-log.js");
const source = fs.readFileSync(QUELLE, "utf8");

function macheElement(tag) {
	const el = {
		tag,
		className: "",
		dataset: {},
		kinder: [],
		textContent: "",
		title: "",
		hidden: false,
		attribute: {},
		classList: {
			add: (n) => { el.klassen.add(n); el.className = [...el.klassen].join(" "); },
			toggle: (n, an) => { if (an) { el.klassen.add(n); } else { el.klassen.delete(n); }
				el.className = [...el.klassen].join(" "); },
			contains: (n) => el.klassen.has(n),
		},
		setAttribute: (k, v) => { el.attribute[k] = v; },
		appendChild: (kind) => { el.kinder.push(kind); return kind; },
		querySelector: (wahl) => el.kinder.find((k) => ("." + k.className.split(" ").join(".")).includes(wahl)) || null,
	};
	el.klassen = new Set();
	Object.defineProperty(el, "innerHTML", {
		set(html) {
			el.kinder = (html.match(/class="[^"]+"/g) || []).map((treffer) => {
				const kind = macheElement("span");
				kind.className = treffer.slice(7, -1);
				kind.klassen = new Set(kind.className.split(" "));
				return kind;
			});
		},
		get() { return ""; },
	});

	return el;
}

const sandbox = {
	console,
	fetch: () => {},
	document: { createElement: macheElement, getElementById: () => null },
	window: undefined,
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: "review-panels-change-log.js" });

const changeLogEntryRow = sandbox.changeLogEntryRow;
assert.strictEqual(typeof changeLogEntryRow, "function", "der echte Zeilenbauer ist geladen");

const HEUTE = (() => {
	const jetzt = new Date();
	const zwei = (z) => String(z).padStart(2, "0");

	return `${jetzt.getFullYear()}-${zwei(jetzt.getMonth() + 1)}-${zwei(jetzt.getDate())}`;
})();
const zeit = HEUTE + " 04:34:00";
const ZIEL = { type: "bounds", lat: 230, lng: 120, bounds: [[200, 100], [260, 140]] };
// ⚠️ „Trägt ein Fadenkreuz" heisst SICHTBAR, nicht „das Element existiert": die Zelle bleibt im
// Raster stehen und wird versteckt, wie die Rückgängig-Zelle nebenan. Nur nach der Existenz gefragt
// wäre die Zusicherung ein Vakuum -- sie wäre auch dann grün, wenn jede Zeile ein Fadenkreuz zeigte.
const kreuz = (zeile) => {
	const zelle = zeile.querySelector(".change-log-entry__focus");

	return zelle && !zelle.hidden && String(zelle.textContent || "").trim() !== "" ? zelle : null;
};
let checks = 0;

// ---- (1) Eine Zeile mit Ziel trägt das Fadenkreuz --------------------------------------------------

const mitZiel = changeLogEntryRow({
	id: 1, action: "update_area_geometry", audit_source: "ecosystem",
	public_id: "area-nord", focus: ZIEL, created_at: zeit,
});
assert.ok(kreuz(mitZiel), "eine Zeile mit Ziel trägt ein Fadenkreuz");
assert.ok(!mitZiel.classList.contains("change-log-entry--static"), "und sie ist ein Knopf");
assert.strictEqual(mitZiel.attribute.role, "button", "auch für eine Vorlesehilfe");
// ⚠️ Das Zeichen allein trägt die Bedeutung nicht — der Satz steht im `title`, wie beim
// Rückgängig-Knopf nebenan. Ohne ihn ist das Fadenkreuz ein Ornament.
assert.ok(/[Ss]telle|[Kk]arte/.test(kreuz(mitZiel).title), "und sagt im title, wohin es führt");
// 🪤 NICHT „⌖" (U+2316 POSITION INDICATOR), so treffend der Name klingt: im Browser gemessen rendert
// es 5,3px breit, wo ⊕/⊙/⌾ 11,3px belegen -- bei dieser Schriftgrösse ist es ein Strich, den niemand
// als Fadenkreuz erkennt. Die Zusicherung steht hier, damit es niemand des Namens wegen zurücktauscht.
assert.notStrictEqual(kreuz(mitZiel).textContent, "⌖", "das Zeichen ist nicht das zu schmale ⌖");
assert.ok(String(kreuz(mitZiel).textContent).trim().length === 1, "und es ist genau ein Zeichen");
checks += 6;

// ---- (2) Eine Landschaftszeile OHNE Ziel ist kein Knopf --------------------------------------------
// 💣 DER GEMELDETE FEHLER. `public_id` ist hier die Kennung einer Fläche; findLocationMarkerByPublicId
// und seine zwei Geschwister durchsuchen Orte, Wege und Labels und finden sie nie. Als Knopf angeboten
// antwortet die Zeile mit einer Fehlermeldung über ein Objekt, dem nichts fehlt.

const ohneZiel = changeLogEntryRow({
	id: 2, action: "update_region", audit_source: "ecosystem",
	public_id: "area-nord", focus: null, created_at: zeit,
});
assert.ok(!kreuz(ohneZiel), "eine Landschaftszeile ohne Ziel trägt kein Fadenkreuz");
assert.ok(ohneZiel.classList.contains("change-log-entry--static"), "und ist kein Knopf");
assert.notStrictEqual(ohneZiel.attribute.role, "button", "auch nicht für eine Vorlesehilfe");
checks += 3;

// 💣 Dasselbe für die Herrschaftsgebiete: ihre `public_id` ist die Kennung einer Geometriezeile, und
// die kennt der Browser ebenso wenig. Zwei Quellen, eine Regel — sonst repariert man eine und lässt
// die andere lügen.
const politischOhneZiel = changeLogEntryRow({
	id: 3, action: "update_geometry", audit_source: "political_territory",
	public_id: "f74ea2ed-29a9-460d-8d3f-3832e4fbc86b", focus: null, created_at: zeit,
});
assert.ok(!kreuz(politischOhneZiel), "eine Gebietszeile ohne Ziel trägt kein Fadenkreuz");
assert.ok(politischOhneZiel.classList.contains("change-log-entry--static"), "und ist kein Knopf");
checks += 2;

// ---- (3) Der Nachschlagweg der KARTE bleibt ---------------------------------------------------------
// 🔴 Nur bei `map_feature` kann der Browser eine `public_id` wirklich auflösen — das ist der Weg, der
// die Infobox eines Ortes öffnet, statt nur hinzufliegen. Ihn mit abzuschalten wäre die Reparatur, die
// mehr wegnimmt als sie heilt.

const karteOhneZiel = changeLogEntryRow({
	id: 4, action: "update_point", audit_source: "map_feature",
	public_id: "loc-gareth", focus: null, created_at: zeit,
});
assert.ok(kreuz(karteOhneZiel), "eine Kartenzeile mit Kennung trägt ein Fadenkreuz");
assert.ok(!karteOhneZiel.classList.contains("change-log-entry--static"), "und bleibt ein Knopf");
checks += 2;

// ⚠️ Fehlt die Herkunft ganz, gilt sie als `map_feature` — genau das setzt `loadChangeLog` für die
// Kartenzeilen, und eine Zeile aus einem älteren Zwischenstand darf nicht stumm ihren Knopf verlieren.
const ohneHerkunft = changeLogEntryRow({ id: 5, action: "update_point", public_id: "loc-gareth", created_at: zeit });
assert.ok(kreuz(ohneHerkunft), "ohne genannte Herkunft zählt die Kartenregel");
checks += 1;

// ---- (3b) Ein Ziel, das keine Stelle ist, zaehlt nicht --------------------------------------------
// 💣 Das Fadenkreuz ist ein VERSPRECHEN: „hier geht es". Ein `focus` mit fehlenden oder unendlichen
// Zahlen erzeugte eines, und der Klick antwortete dann doch mit der Fehlermeldung -- genau der
// Widerspruch, den diese Änderung beseitigen soll. `focusAuditChangeTarget` verwirft solche Ziele
// bereits (`isWithinMapBounds`); die Zeile muss dieselbe Antwort geben, sonst lügt sie.

for (const kaputt of [{ type: "point" }, { type: "point", lat: null, lng: 5 }, { type: "point", lat: NaN, lng: 5 },
	{ type: "point", lat: "irgendwo", lng: 5 }, { type: "point", lat: Infinity, lng: 5 }]) {
	const zeile = changeLogEntryRow({ id: 7, action: "update_region", audit_source: "ecosystem", focus: kaputt, created_at: zeit });
	assert.ok(!kreuz(zeile), "ein Ziel ohne brauchbare Koordinate traegt kein Fadenkreuz: " + JSON.stringify(kaputt));
	assert.ok(zeile.classList.contains("change-log-entry--static"), "und die Zeile ist kein Knopf");
}
checks += 10;

// ⚠️ Die Null ist eine gueltige Koordinate -- die Karte beginnt bei 0/0. Wer auf Wahrheitswert prueft
// statt auf Endlichkeit, nimmt der linken unteren Ecke ihr Fadenkreuz.
const amUrsprung = changeLogEntryRow({ id: 8, action: "update_region", audit_source: "ecosystem",
	focus: { type: "point", lat: 0, lng: 0 }, created_at: zeit });
assert.ok(kreuz(amUrsprung), "0/0 ist eine Stelle wie jede andere");
checks += 1;

// ---- (4) Eine Moderationszeile bleibt stumm ---------------------------------------------------------
// Sie hat kein Kartenobjekt. Kein Fadenkreuz, kein Zeigefinger, keine Fehlermeldung.

const moderation = changeLogEntryRow({ id: 6, action: "report_approved", audit_source: "map_feature", created_at: zeit });
assert.ok(!kreuz(moderation), "eine Moderationszeile trägt kein Fadenkreuz");
assert.ok(moderation.classList.contains("change-log-entry--static"), "und ist kein Knopf");
checks += 2;

// ---- (5) Das Fadenkreuz ist eine MARKE, kein zweiter Tabstopp ---------------------------------------
// 🔴 Die ZEILE ist der Knopf (`role="button"`, `tabIndex`), und ein Knopf im Knopf hätte zwei Folgen:
// die Tastatur bekäme je Zeile einen zweiten Halt, und Enter darauf täte nichts — der keydown-Zuhörer
// in routing.js gibt bei `event.target !== this` auf. Der Klick auf das Fadenkreuz landet deshalb
// bewusst auf der Zeile und braucht keinen eigenen Zuhörer.
assert.strictEqual(kreuz(mitZiel).tag, "span", "das Fadenkreuz ist eine Marke, kein zweiter Knopf");
assert.strictEqual(kreuz(mitZiel).attribute["aria-hidden"], "true",
	"für eine Vorlesehilfe spricht die Zeile, nicht das Zeichen");
checks += 2;

// ---- (6) Es steht in Spalte 4 und stösst nicht in seine Nachbarn -------------------------------------
// 🔴 JEDE ZELLE NENNT IHRE SPALTE SELBST (siehe change-log-buendel.test.js): bei automatischer
// Platzierung rutschte alles um eine Spalte, sobald in einer Zeile etwas fehlt — und es fehlt in
// jeder zweiten. Spalte 4 ist die, die in einer Kindzeile frei ist; der Bündelkopf zählt dort.

const panelCss = fs.readFileSync(path.join(ROOT, "css", "features", "review-panel.css"), "utf8");
const cssOhneKommentar = panelCss.replace(/\/\*[\s\S]*?\*\//g, "");
function spalteVon(klasse) {
	let pos = 0;
	for (;;) {
		const i = cssOhneKommentar.indexOf(klasse, pos);
		if (i < 0) {
			return null;
		}
		const auf = cssOhneKommentar.indexOf("{", i);
		const zu = cssOhneKommentar.indexOf("}", auf);
		const rumpf = cssOhneKommentar.slice(auf + 1, zu);
		const p = rumpf.indexOf("grid-column:");
		if (p >= 0) {
			return rumpf.slice(p + "grid-column:".length, rumpf.indexOf(";", p)).trim();
		}
		pos = i + klasse.length;
	}
}
assert.strictEqual(spalteVon(".change-log-entry__focus"), "4", "das Fadenkreuz steht in Spalte 4");
assert.strictEqual(spalteVon(".change-log-group__count"), "4", "dort, wo der Bündelkopf seine Anzahl zeigt");
assert.strictEqual(spalteVon(".change-log-entry__time"), "5", "die Zeit bleibt in Spalte 5");
assert.strictEqual(spalteVon(".change-log-entry__actions"), "6", "und Rückgängig in Spalte 6");
checks += 4;

// ⚠️ Die Erklärzeile spannt von Spalte 2 bis zum Rand und liegt in Zeile 2 — läge das Fadenkreuz in
// derselben Rasterzeile ohne eigene Spalte, überdeckten sich beide.
assert.strictEqual(spalteVon(".change-log-entry__l2"), "2 / -1", "die zweite Zeile spannt weiterhin bis zum Rand");
checks += 1;

console.log(`OK -- ${checks} Zusicherungen bestanden.`);
