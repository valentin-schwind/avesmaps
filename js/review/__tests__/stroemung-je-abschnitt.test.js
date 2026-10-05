// DIE RICHTUNGSKNÖPFE DER SEKTION „STRÖMUNG", AUSGEFÜHRT — Meldung #7996 (Thomas, Großer Fluss –
// Delta: „die einzelnen Abschnitte lassen sich nicht umkehren, nur der gesamte Fluss").
// Entwurf: docs/superpowers/specs/2026-10-05-flussrichtung-je-abschnitt-design.md
//
// 💣 DER ZUSTANDSBAUER WIRD AUSGEFÜHRT, NICHT GELESEN. Am 10.09.2026 hat ein Regex-Test die
// Unterzeile des Ribbon-Menüs SECHS TAGE lang falsch stehen lassen: er prüfte, dass
// `MutationObserver` im Quelltext steht, nie, was die Funktion ausgibt. Hier wird
// `renderPathFlowSection` wirklich gefahren und die Beschriftung abgelesen.
// ⚠️ Die Attrappen sind EXPLIZIT, kein Proxy: ein Proxy, der jeden Bezeichner beantwortet,
// verschluckt genau den ReferenceError, der am 03.09.2026 die Beschriftungen der Live-Karte zwei
// Stunden lang gekostet hat.
//
// Aus der Wurzel des Repos:  node js/review/__tests__/stroemung-je-abschnitt.test.js

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const repoRoot = path.join(__dirname, "..", "..", "..");
// ⚠️ Zeilenendenneutral -- Arbeitskopie CRLF, Deploy-Tor LF (AGENTS.md §9).
const lies = (rel) => fs.readFileSync(path.join(repoRoot, rel), "utf8").replace(/\r\n/g, "\n");

/** Ein Element, das nur kann, was die Sektion von ihm verlangt. */
function macheElement(id) {
	return { id, hidden: false, textContent: "", value: "", disabled: false, dataset: {} };
}

/**
 * Baut die Sektion samt Attrappen und lädt review-path-flow.js wirklich.
 * @param {{segmentDir: (string|null), wayDirs: Array<string|null>}} lage
 */
function macheKontext(lage) {
	const ids = ["path-flow-section", "path-flow-state", "path-flow-direction", "path-flow-segment",
		"path-flow-complete", "path-flow-factor", "path-flow-factor-save", "path-flow-status"];
	const elemente = {};
	ids.forEach((id) => { elemente[id] = macheElement(id); });

	// Der angeklickte Abschnitt ist immer der erste der Gruppe.
	const segmente = lage.wayDirs.map((dir, i) => ({
		id: "seg-" + i,
		properties: {
			public_id: "seg-" + i,
			name: "Testfluss",
			feature_subtype: "Flussweg",
			flow: dir === null ? undefined : { dir, source: "editor" },
		},
	}));
	const angeklickt = {
		id: "seg-0",
		properties: {
			public_id: "seg-0",
			name: "Testfluss",
			feature_subtype: "Flussweg",
			flow: lage.segmentDir === null ? undefined : { dir: lage.segmentDir, source: "editor" },
		},
	};
	segmente[0] = angeklickt;

	const gesendet = [];
	const toasts = [];
	let klickHandler = null;

	const context = {
		console,
		document: {
			getElementById: (id) => elemente[id] || null,
			addEventListener: (typ, fn) => { if (typ === "click") { klickHandler = fn; } },
		},
		window: { avesmapsRedrawRiverFlowArrows: () => {} },
		pathEditFeature: angeklickt,
		pathData: segmente,
		normalizePathSubtype: (s) => String(s || ""),
		pathWikiCurrentFeaturePublicId: () => "seg-0",
		// Antwortet wie der Server nach dem Umbau.
		pathWikiPost: async (body) => {
			gesendet.push(body);
			return Object.assign({
				ok: true, dry_run: false, segments: lage.wayDirs.length,
				directed: 0, directed_before: lage.wayDirs.filter((d) => d !== null).length,
				flipped: 0, factor_updated: 0, conflicts_cleared: 0, writes: 0,
				undirected_on_chain: 0, undirected_spurs: 0, undirected_stubs: 0,
				segments_updated: [],
			}, lage.antwort || {});
		},
		applyWikiPathSegmentsUpdate: () => {},
		showFeedbackToast: (text, art) => { toasts.push({ text, art }); },
	};
	context.globalThis = context;
	vm.createContext(context);
	vm.runInContext(lies("js/review/review-path-flow.js"), context);
	return { context, elemente, gesendet, toasts, klick: () => klickHandler };
}

/** Feuert einen Klick auf ein Element, wie der delegierende Zuhörer ihn sieht. */
function klicke(k, id) {
	const ziel = {
		closest: (sel) => (sel.split(",").map((s) => s.trim()).includes("#" + id) ? k.elemente[id] : null),
	};
	k.klick()({ target: ziel });
}

let fehler = 0;
const pruefe = (was, ok) => {
	if (ok) { console.log("ok  " + was); return; }
	console.log("FEHLER  " + was);
	fehler++;
};

console.log("=== A0 · Die Knöpfe stehen nach EBENEN, nicht verschränkt ===");
{
	// 💣 „Richtung vervollständigen" trägt kein Geltungswort. Zwischen zwei
	// „(dieser Abschnitt)"-Beschriftungen gelesen wird es zur Handlung DES ABSCHNITTS. Im Browser
	// gemessen: in der einspaltigen Lage bei ~512px stand es direkt NEBEN „setzen (dieser
	// Abschnitt)". Deshalb erst die zwei Knöpfe des Flusses, dann der des Abschnitts.
	const html = lies("index.html");
	const i = (id) => html.indexOf('id="' + id + '"');
	pruefe("Reihenfolge im Markup: Fluss, Fluss, Abschnitt",
		i("path-flow-direction") > 0 && i("path-flow-direction") < i("path-flow-complete")
			&& i("path-flow-complete") < i("path-flow-segment"));
}

console.log("\n=== A · Deltaarm: Fluss gerichtet, dieser Abschnitt nicht ===");
{
	const k = macheKontext({ segmentDir: null, wayDirs: [null, "forward", "forward", "forward"] });
	k.context.renderPathFlowSection();
	const seg = k.elemente["path-flow-segment"];
	const weg = k.elemente["path-flow-direction"];
	pruefe("der Abschnitts-Knopf ist SICHTBAR", seg.hidden === false);
	pruefe("… und heißt „Richtung setzen (dieser Abschnitt)“",
		seg.textContent === "Richtung setzen (dieser Abschnitt)");
	pruefe("… sein Modus ist dir (nicht flip -- es gibt nichts zu drehen)", seg.dataset.flowMode === "dir");
	pruefe("der Weg-Knopf heißt „Richtung umdrehen (ganzer Fluss)“",
		weg.textContent === "Richtung umdrehen (ganzer Fluss)");
	pruefe("„vervollständigen“ ist sichtbar (3 von 4 gerichtet)",
		k.elemente["path-flow-complete"].hidden === false);
}

console.log("\n=== B · Der Klick schickt die richtige Anfrage ===");
{
	const k = macheKontext({ segmentDir: null, wayDirs: [null, "forward", "forward"] });
	k.context.renderPathFlowSection();
	klicke(k, "path-flow-segment");
	pruefe("genau eine Anfrage", k.gesendet.length === 1);
	const b = k.gesendet[0] || {};
	pruefe("… action set_flow", b.action === "set_flow");
	pruefe("… mit dir: forward", b.dir === "forward");
	pruefe("💣 … und OHNE flip (sonst drehte sie den ganzen Fluss)", b.flip === undefined);
	pruefe("… scharf (dry_run false, confirm apply)", b.dry_run === false && b.confirm === "apply");
}

console.log("\n=== C · Gerichteter Abschnitt: „Pfeil umdrehen“ mit scope ===");
{
	const k = macheKontext({ segmentDir: "forward", wayDirs: ["forward", "forward", "forward"] });
	k.context.renderPathFlowSection();
	const seg = k.elemente["path-flow-segment"];
	pruefe("heißt „Pfeil umdrehen (dieser Abschnitt)“", seg.textContent === "Pfeil umdrehen (dieser Abschnitt)");
	pruefe("Modus flip", seg.dataset.flowMode === "flip");
	klicke(k, "path-flow-segment");
	const b = k.gesendet[0] || {};
	pruefe("💣 schickt flip MIT scope: segment", b.flip === true && b.scope === "segment");
}

console.log("\n=== D · Gegenprobe: der Weg-Knopf bleibt WAY-WEIT ===");
{
	const k = macheKontext({ segmentDir: "forward", wayDirs: ["forward", "forward", "forward"] });
	k.context.renderPathFlowSection();
	klicke(k, "path-flow-direction");
	const b = k.gesendet[0] || {};
	pruefe("flip ohne scope", b.flip === true && b.scope === undefined);
}

console.log("\n=== E · Einteiliger Weg: kein zweiter Knopf, kein Zusatz ===");
{
	const k = macheKontext({ segmentDir: null, wayDirs: [null] });
	k.context.renderPathFlowSection();
	pruefe("der Abschnitts-Knopf ist VERBORGEN", k.elemente["path-flow-segment"].hidden === true);
	pruefe("… und der Weg-Knopf heißt schlicht „Richtung festlegen“",
		k.elemente["path-flow-direction"].textContent === "Richtung festlegen");
}

console.log("\n=== F · Mehrteilig und ganz ungerichtet: erst die Kette ===");
{
	const k = macheKontext({ segmentDir: null, wayDirs: [null, null, null] });
	k.context.renderPathFlowSection();
	pruefe("„Richtung festlegen (ganzer Fluss)“",
		k.elemente["path-flow-direction"].textContent === "Richtung festlegen (ganzer Fluss)");
	// 💣 ERST DIE KETTE, DANN DIE ARME. Richtet jemand an einem ganz richtungslosen Fluss zuerst
	// einen Abzweig, wirft `set_dir` danach `no_anchor_on_chain` -- die Hauptkette ist dann per
	// Knopf nicht mehr richtbar (am Großen Fluss 44 Abschnitte von Hand). Gemessen an der
	// T-Form-Fixture, gefunden von einem Prüfagenten. Dieser Riegel kostet nichts, weil
	// „Richtung festlegen (ganzer Fluss)" in genau diesem Zustand daneben steht.
	pruefe("💣 der Abschnitts-Knopf ist VERBORGEN (sonst sperrt ein Abzweig die Kette aus)",
		k.elemente["path-flow-segment"].hidden === true);
}

console.log("\n=== F2 · Einteilig und gerichtet: auch der Weg-Knopf ohne Zusatz ===");
{
	// 💣 Der Zusatz gilt BEIDEN Zweigen. Der erste Bau band ihn nur an „festlegen", während
	// „umdrehen" ihn unbedingt trug -- ein einteiliger, gerichteter Fluss zeigte damit
	// „Richtung umdrehen (ganzer Fluss)" ohne Gegenstück. Eine Regel an EINEM von zwei Erzeugern.
	const k = macheKontext({ segmentDir: "forward", wayDirs: ["forward"] });
	k.context.renderPathFlowSection();
	pruefe("„Richtung umdrehen“ ohne „(ganzer Fluss)“",
		k.elemente["path-flow-direction"].textContent === "Richtung umdrehen");
	pruefe("… und kein Abschnitts-Knopf", k.elemente["path-flow-segment"].hidden === true);
}

void (async () => {
	console.log("\n=== G · Die Auskunft statt des englischen Fehlers ===");
	const k = macheKontext({
		segmentDir: null, wayDirs: [null, "forward", "forward"],
		antwort: { directed: 0, undirected_spurs: 22, undirected_stubs: 2 },
	});
	k.context.renderPathFlowSection();
	klicke(k, "path-flow-complete");
	// Die Meldung entsteht asynchron im await der Zusage -- zwei Ticks reichen hier nicht
	// zuverlaessig, deshalb bis zur Meldung warten (und notfalls abbrechen).
	for (let i = 0; i < 50 && k.elemente["path-flow-status"].textContent === ""; i++) {
		await new Promise((r) => setImmediate(r));
	}
	{
		const text = k.elemente["path-flow-status"].textContent;
		// 🔴 KEIN ALGORITHMUS-JARGON. „Hauptkette" ist der Diameter-Walk; das Wort stand im
		// ganzen index.html und im Handbuch NULL Mal (von einem Prüfagenten gezählt). Der Editor
		// sieht PFEILE auf der Karte — und ein richtungsloser Abschnitt ist genau daran erkennbar,
		// dass er keinen hat. Deshalb spricht die Meldung von Pfeilen, nicht von Ketten.
		pruefe("spricht von Pfeilen, nicht von der „Hauptkette“",
			text.includes("Der durchgehende Lauf hat überall Pfeile"));
		pruefe("💣 kein Algorithmus-Jargon im sichtbaren Text", !/Hauptkette|Kette/.test(text));
		pruefe("nennt die 22 Abzweigungen", text.includes("22 Abzweigungen"));
		pruefe("nennt die 2 kurzen Abschnitte", text.includes("2 sehr kurze Abschnitte"));
		// ⚠️ Der Hinweis nennt den WEG dorthin: der Dialog ist modal, die Pfeile liegen auf der
		// Karte darunter, und der Einzelknopf gilt immer nur dem GEÖFFNETEN Abschnitt.
		pruefe("sagt, wie man hinkommt (auf der Karte anklicken)",
			text.includes("auf der Karte anklicken") && text.includes("Richtung setzen"));
		pruefe("💣 kein englischer Satz mehr", !/fully directed/i.test(text));
		pruefe("💣 und es ist KEIN Fehler", !/^Fehler/.test(text) && (k.toasts[0] || {}).art === "info");

		console.log("\n=== H · Singular und Plural ===");
		{
			const satz = k.context.pathFlowOffeneAbschnitteSatz({ undirected_spurs: 1, undirected_stubs: 0 });
			pruefe("1 Abzweigung hat (Singular)", satz.includes("1 Abzweigung hat noch keinen Pfeil"));
		}
		{
			const satz = k.context.pathFlowOffeneAbschnitteSatz({ undirected_spurs: 0, undirected_stubs: 1 });
			pruefe("1 sehr kurzer Abschnitt hat", satz.includes("1 sehr kurzer Abschnitt hat noch keinen Pfeil"));
		}
		{
			const satz = k.context.pathFlowOffeneAbschnitteSatz({ undirected_spurs: 2, undirected_stubs: 3 });
			pruefe("beide zusammen mit „und“", satz.includes("2 Abzweigungen und 3 sehr kurze Abschnitte haben"));
		}
		{
			// ⚠️ Ein alter Server schickt die Felder nicht -- dann schweigt der Satz, statt „0" zu melden.
			pruefe("ohne Zahlen: leerer Satz", k.context.pathFlowOffeneAbschnitteSatz({}) === "");
		}
	}

	console.log("\n=== I · Offene KETTEN-Abschnitte verweisen auf den anderen Knopf ===");
	{
		// 💣 Der Server liefert `undirected_on_chain`, und zuerst hat es niemand gelesen (Befund
		// eines Prüfagenten). Ein offener Abschnitt AUF der Hauptkette ist der eine Fall, den
		// „Richtung vervollständigen" wirklich löst -- stünde dort nur der Einzelknopf, schickte
		// die Meldung den Editor von Hand durch etwas, das ein Klick erledigt.
		const satz = k.context.pathFlowOffeneAbschnitteSatz({ undirected_on_chain: 3, undirected_spurs: 9, undirected_stubs: 1 });
		pruefe("nennt die 3 Abschnitte des durchgehenden Laufs",
			satz.includes("3 Abschnitte im durchgehenden Lauf"));
		pruefe("💣 ohne das Wort „Hauptkette“", !satz.includes("Hauptkette"));
		pruefe("verweist auf „Richtung vervollständigen“", satz.includes("Richtung vervollständigen"));
		pruefe("💣 und NICHT auf den Einzelknopf (falsche Empfehlung)", !satz.includes("dieser Abschnitt"));
		const einer = k.context.pathFlowOffeneAbschnitteSatz({ undirected_on_chain: 1 });
		pruefe("Singular: „1 Abschnitt … hat“", einer.includes("1 Abschnitt im durchgehenden Lauf hat"));
	}

	console.log("\n=== J · Der Popup-Shortcut nutzt DENSELBEN Satzbauer ===");
	{
		// 💣 Zweiter Konsument von set_dir. Er trug bis zum 05.10.2026 seinen eigenen Wortlaut
		// („— Abzweige bleiben ohne Richtung", ohne Zahl), während der Kommentar am Satzbauer
		// EINEN Erzeuger behauptete. Eine Regel, die einen von zwei Erzeugern bindet, ist keine.
		const k2 = macheKontext({
			segmentDir: null, wayDirs: [null, null, null],
			antwort: { directed: 2, undirected_spurs: 7, undirected_stubs: 0 },
		});
		await k2.context.submitPathFlowShortcut({ properties: { public_id: "seg-0", name: "Testfluss", feature_subtype: "Flussweg" } });
		const toast = (k2.toasts[0] || {}).text || "";
		pruefe("der Toast nennt die Zahl der Abzweigungen", toast.includes("7 Abzweigungen"));
		pruefe("💣 und nicht mehr den alten zahllosen Wortlaut", !toast.includes("Abzweige bleiben ohne Richtung"));
	}

	console.log("\n=== K · Die Rückmeldung gehört dem Abschnitt, der sie ausgelöst hat ===");
	{
		// 💣 DER TEUERSTE BEFUND DES DESIGN-AGENTEN, gemessen im echten Browser.
		// `#path-flow-status` wurde nur geschrieben, nie gelöscht: `resetPathEditForm` leert allein
		// `#path-edit-status`, und `populatePathEditForm` fasste die Zeile nicht an. Ein Editor
		// setzt Arm A, öffnet Arm B — und liest dort die Meldung von A, hält B also für erledigt.
		// Der Fehler ist VORBESTEHEND, aber dieses Feature macht ihn zum Hauptablauf: am Großen
		// Fluss 22 Arme hintereinander.
		const k3 = macheKontext({ segmentDir: null, wayDirs: [null, "forward", "forward"] });
		k3.elemente["path-flow-status"].textContent = "Richtung gesetzt — Pfeil auf der Karte prüfen.";
		k3.context.pathFlowClearStatus();
		pruefe("pathFlowClearStatus leert die Zeile",
			k3.elemente["path-flow-status"].textContent === "");

		// 💣 UND BEIDE BEFÜLLER MÜSSEN SIE RUFEN. `review-paths.js` trägt ZWEI Stellen, die den
		// Dialog befüllen (der Design-Agent nannte nur eine) -- eine Regel an einem von zwei
		// Erzeugern ist keine Regel. Gezählt, nicht vermutet.
		const quelle = lies("js/review/review-paths.js");
		const rufe = (quelle.match(/pathFlowClearStatus\(\)/g) || []).length;
		pruefe("BEIDE Befüller rufen das Leeren (2 Aufrufe)", rufe === 2);
		const render = (quelle.match(/renderPathFlowSection\(\)/g) || []).length;
		pruefe("… und es gibt genau so viele Befüller wie Leerungen", render === rufe);

		// ⚠️ NICHT in renderPathFlowSection selbst: die läuft auch nach einer Wiki-Zuweisung am
		// SELBEN Abschnitt (review-path-wiki.js), und dort ist die Meldung noch gültig.
		const bauer = lies("js/review/review-path-flow.js");
		const rumpfVon = bauer.indexOf("function renderPathFlowSection()");
		const rumpfBis = bauer.indexOf("\nasync function submitPathFlowAction", rumpfVon);
		const rumpf = bauer.slice(rumpfVon, rumpfBis > 0 ? rumpfBis : undefined);
		pruefe("💣 der Zustandsbauer leert NICHT selbst (sonst stirbt die Meldung bei jedem Rendern)",
			!rumpf.includes("pathFlowClearStatus("));
	}

	console.log("\n=== L · Die Meldung schickt den Editor zum Pfeil ===");
	{
	// 🔴 `dir: "forward"` ist die ZEICHENRICHTUNG, also eine Münze. Die ganze Bedienung stützt
	// sich darauf, dass der Editor den Pfeil ansieht und ihn bei Bedarf dreht — und der Dialog ist
	// modal, die Pfeile liegen auf der Karte darunter. Ohne diesen Satz steht er vor einem Pfeil,
	// von dem er nicht weiß, dass er ihn prüfen soll. (Befund des Design-Agenten; zuerst ungedeckt,
	// eine Mutation durfte den Satz streichen und alles blieb grün.)
		const kp = macheKontext({
			segmentDir: null, wayDirs: [null, "forward", "forward"],
			antwort: { directed: 1, writes: 1, undirected_spurs: 0, undirected_stubs: 0 },
		});
		kp.context.renderPathFlowSection();
		klicke(kp, "path-flow-segment");
		for (let i = 0; i < 50 && kp.elemente["path-flow-status"].textContent === ""; i++) {
			await new Promise((r) => setImmediate(r));
		}
		const textP = kp.elemente["path-flow-status"].textContent;
		pruefe("sagt, dass der Pfeil zu prüfen ist", textP.includes("Pfeil auf der Karte prüfen"));
		pruefe("… und nennt den Knopf, der ihn dreht", textP.includes("Pfeil umdrehen"));
	}

	console.log("");
	if (fehler > 0) {
		console.log(fehler + " Zusicherung(en) NICHT erfüllt");
		process.exit(1);
	}
	console.log("alle Zusicherungen erfüllt");
})();
