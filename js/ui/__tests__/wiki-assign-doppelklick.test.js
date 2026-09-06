// 💣 EIN ZWEITER KLICK AUF EINEN TREFFER DARF NICHT EINE ZWEITE ZUWEISUNG ABSCHICKEN.
//
// ANLASS (Log-Auswertung 06.09.2026). In jedem Ausfallfenster vom 30.08. bis 06.09.2026 stehen
// 12 bis 22 `POST settlements.php` EINES Browsers binnen ~20 Sekunden -- ein Editor, bei dem
// nichts passiert, waehlt denselben Treffer noch einmal. Die Ursache dafuer, DASS nichts passierte,
// ist behoben (der Server wartet nicht mehr auf die Drossel, api/_internal/wiki/sync.php); dieser
// Riegel ist die zweite Haelfte: solange eine Zuweisung laeuft, wird die naechste nicht abgeschickt.
//
// 🔴 ER SITZT IM GETEILTEN BAUTEIL, nicht in einer der elf Oberflaechen. Acht Objektarten waehlen
// ueber dieselbe Funktion (`trefferWaehlen`), und eine Regel, die einen von mehreren Erzeugern
// bindet, ist keine Regel -- dieselbe Lehre, die im selben Umbau schon einmal zugeschlagen hat
// (die Anmeldung lief am Drossel-Schalter vorbei, gemessen 22,154 s).
//
// Run: node js/ui/__tests__/wiki-assign-doppelklick.test.js
"use strict";

const assert = require("assert");
// ⚠️ Im Browser legen die <script>-Zeilen diese zwei Namen als Globale an, und `mount` prueft
// beide, bevor es irgendetwas zeichnet (sonst Blindgaenger). In Node muessen sie von Hand stehen --
// dieselbe Vorbereitung wie in wiki-assign-ort.test.js.
const { avesmapsWikiAssignSubject } = require("../wiki-assign-registry.js");
const { avesmapsWikiAssignDiff } = require("../wiki-assign-diff.js");
global.avesmapsWikiAssignSubject = avesmapsWikiAssignSubject;
global.avesmapsWikiAssignDiff = avesmapsWikiAssignDiff;
const { avesmapsWikiAssignMount } = require("../wiki-assign.js");

/** Der Behaelter, an dem das Bauteil haengt -- mit Zugriff auf die registrierten Zuhoerer. */
function scheinBehaelter() {
	const zuhoerer = {};
	return {
		id: "host", textContent: "", innerHTML: "", className: "", value: "",
		dataset: {}, style: {}, options: [], hidden: false, disabled: false,
		classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
		addEventListener(typ, fn) { zuhoerer[typ] = fn; },
		removeEventListener(typ) { delete zuhoerer[typ]; },
		querySelector() { return null; },
		querySelectorAll() { return []; },
		contains() { return true; },
		appendChild() {}, removeChild() {}, remove() {}, insertBefore() {},
		setAttribute() {}, removeAttribute() {}, getAttribute() { return null; },
		hasAttribute() { return false; },
		closest() { return null; }, focus() {}, dispatchEvent() { return true; },
		getBoundingClientRect() { return { width: 100, height: 20, top: 0, left: 0 }; },
		feuere(typ, ziel) {
			if (zuhoerer[typ]) {
				zuhoerer[typ]({ target: ziel, preventDefault() {}, stopPropagation() {} });
			}
		},
	};
}

/** Ein Ereignisziel mit GENAU einem Merkmal -- der Klickpfad fragt nacheinander zwei Selektoren ab. */
function scheinZiel(merkmal, wert) {
	const element = {
		getAttribute: (name) => (name === merkmal ? wert : null),
		hasAttribute: (name) => name === merkmal,
		value: "",
	};
	element.closest = (selektor) => (selektor === "[" + merkmal + "]" ? element : null);
	return element;
}

const warte = () => new Promise((fertig) => setTimeout(fertig, 0));

(async () => {
	let checks = 0;
	const zaehl = () => { checks++; };

	// ── 1) ZWEI KLICKS, EINE ZUWEISUNG ────────────────────────────────────────────────────────
	// Die Kraftlinie sucht in einer MITGEGEBENEN Liste (Registry: suche.art === "liste"), also
	// braucht dieser Test weder Netz noch Zeitgeber fuer die Trefferliste.
	const behaelter = scheinBehaelter();
	let rufe = 0;
	let aufloesen = null;
	const steuerung = avesmapsWikiAssignMount(behaelter, {
		subject: "kraftlinie",
		skin: "dt",
		laden: () => ({
			artikel: null,
			kartenwerte: {},
			listen: { wiki_articles: [{ name: "Gareth", wiki_url: "https://x/Gareth", wiki_key: "gareth" }] },
		}),
		// 🔴 Loest ABSICHTLICH nicht auf: genau der Zustand, in dem der Editor ein zweites Mal klickt.
		zuweisen: () => { rufe++; return new Promise((fertig) => { aufloesen = fertig; }); },
	});
	await steuerung.neuLaden();

	behaelter.feuere("click", scheinZiel("data-wa-aktion", "zuweisen"));
	await warte();
	assert.ok(
		behaelter.innerHTML.indexOf('data-wa-treffer="0"') !== -1,
		"die Trefferliste steht (sonst prueft der Rest dieses Tests nichts): " + behaelter.innerHTML
	);
	zaehl();

	behaelter.feuere("click", scheinZiel("data-wa-treffer", "0"));
	await warte();
	assert.strictEqual(rufe, 1, "der erste Klick weist zu");
	zaehl();

	behaelter.feuere("click", scheinZiel("data-wa-treffer", "0"));
	await warte();
	assert.strictEqual(
		rufe,
		1,
		"ein zweiter Klick waehrend der laufenden Zuweisung schickt eine ZWEITE ab -- genau die "
			+ "Bursts aus den Ausfallprotokollen"
	);
	zaehl();

	// ── 2) NACH DEM ENDE GEHT ES WIEDER ───────────────────────────────────────────────────────
	// 💣 Ohne diese Zusicherung waere ein Riegel, der nie aufgeht, ebenfalls gruen -- und der Kasten
	// waere nach der ersten Zuweisung fuer immer tot.
	aufloesen();
	await warte();
	await warte();
	behaelter.feuere("click", scheinZiel("data-wa-aktion", "zuweisen"));
	await warte();
	behaelter.feuere("click", scheinZiel("data-wa-treffer", "0"));
	await warte();
	assert.strictEqual(rufe, 2, "nach der abgeschlossenen Zuweisung ist der Kasten wieder bedienbar");
	zaehl();

	// ── 3) UND EINE ABGELEHNTE ZUWEISUNG GIBT IHN EBENSO FREI ─────────────────────────────────
	// 🔴 Der haeufigste Fall ueberhaupt: der Server sagt ab („Wiki gerade belegt", „Ziel-Ort nicht
	// gefunden"). Bliebe der Riegel dann zu, waere die Absage schlimmer als der Fehler -- der
	// Editor koennte es nie wieder versuchen, ohne den Dialog neu zu oeffnen.
	const behaelter2 = scheinBehaelter();
	let rufe2 = 0;
	let ablehnen = null;
	const steuerung2 = avesmapsWikiAssignMount(behaelter2, {
		subject: "kraftlinie",
		skin: "dt",
		laden: () => ({
			artikel: null,
			kartenwerte: {},
			listen: { wiki_articles: [{ name: "Gareth", wiki_url: "https://x/Gareth", wiki_key: "gareth" }] },
		}),
		zuweisen: () => { rufe2++; return new Promise((_, schiefgegangen) => { ablehnen = schiefgegangen; }); },
	});
	await steuerung2.neuLaden();
	behaelter2.feuere("click", scheinZiel("data-wa-aktion", "zuweisen"));
	await warte();
	behaelter2.feuere("click", scheinZiel("data-wa-treffer", "0"));
	await warte();
	assert.strictEqual(rufe2, 1);
	zaehl();

	ablehnen(new Error("Das Wiki Aventurica ist gerade durch einen anderen Abruf belegt."));
	await warte();
	await warte();
	behaelter2.feuere("click", scheinZiel("data-wa-treffer", "0"));
	await warte();
	assert.strictEqual(
		rufe2,
		2,
		"nach einer ABGELEHNTEN Zuweisung bleibt der Riegel zu -- der Editor kann es nie wieder "
			+ "versuchen, obwohl genau dieser Fall der haeufigste ist"
	);
	zaehl();

	console.log("OK - ein zweiter Klick schickt keine zweite Zuweisung ab (" + checks + " Zusicherungen)");
})().catch((fehler) => {
	console.error(fehler);
	process.exit(1);
});
