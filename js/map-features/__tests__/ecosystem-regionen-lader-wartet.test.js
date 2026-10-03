// DER REGIONEN-LADER MELDET „FERTIG" ERST, WENN DIE EBENE WIRKLICH DA IST -- ausgefuehrt, nicht gelesen.
//
// 🔴 DER BEFUND (Owner 03.10.2026, „schon zum wiederholten Mal"): beim Einstellen eines Labels zeigt
// das Auswahlmenue „Gehoert zu" (`#label-edit-region`) ploetzlich NUR die Ebene, die gerade aktiv
// ist -- bei aktiver Vegetation nur „Vegetation", bei aktiver Topographie nur „Topographie" --, obwohl
// alle drei Ebenen zur Auswahl stehen muessten.
//
// 💣 DIE URSACHE, am Browser gegen den echten Code gemessen (Anfragen mitgezaehlt):
//   1. Jeder Schreibvorgang leert den Regionen-Bestand ALLER Ebenen (`invalidateEcosystemRegionCache`),
//      laedt aber nur die AKTIVE neu.
//   2. Beim naechsten Oeffnen eines Label-Dialogs fragen ZWEI Aufrufer nach allen Ebenen: die
//      Traegerzeile (`renderLabelCarrierNote`) und die Flaechensuche
//      (`avesmapsEcosystemAreaPublicIdOfLabel`). Beide gehen durch `loadEcosystemRegions`.
//   3. Jeder Aufruf zieht eine neue Marke (`ecosystemRegionRequestTokens`). Die ZWEITE Anfrage
//      ueberholt die erste -- und die erste kehrt bei ihrer Antwort stillschweigend zurueck,
//      OHNE zu speichern. Wer auf sie wartete, bekommt „fertig" gemeldet, waehrend die Ebene noch
//      fehlt (die zweite Anfrage laeuft ja noch).
//   4. `fillLabelRegionSelect` baut das Menue GENAU EINMAL, direkt nach diesem `await` -- aus dem
//      Bestand von diesem Augenblick: nur die aktive Ebene steht darin. Wenige hundert Millisekunden
//      spaeter ist der Bestand vollstaendig, das Menue aber nie wieder neu gebaut worden.
//   Im Browser belegt: nach dem Oeffnen „Vegetation(536)", derselbe Aufruf mit dem inzwischen vollen
//   Bestand „Derographie(94), Vegetation(536), Topographie(600)".
//
// 🔴 DIE REGEL: `await loadEcosystemRegions(kind)` heisst „die Ebene steht jetzt im Bestand" -- fuer
// JEDEN Aufrufer, auch fuer den, dessen eigene Anfrage ueberholt wurde. Zwei Wege dahin, und beide
// stehen hier: gleichzeitige Aufrufer teilen sich EINE Anfrage; ein erzwungenes Neuladen laesst die
// ueberholten Aufrufer auf die neuere warten.
//
// ⚠️ Der Test laedt die ECHTE Datei in einen vm-Kontext und beantwortet die Serveranfragen von Hand,
// in der Reihenfolge, in der sie im Browser eintreffen. Ein Test, der den Lader nachbaut, haette den
// Fehler nie gesehen -- er sitzt genau in der Zeitfolge zwischen Anfrage und Antwort.
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/ecosystem-regionen-lader-wartet.test.js
"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const wurzel = path.join(__dirname, "..", "..", "..");
// ⭐ Zeilenenden-neutral (AGENTS.md §9): Arbeitskopie CRLF, CI LF.
const lies = (datei) => fs.readFileSync(path.join(wurzel, datei), "utf8").replace(/\r\n/g, "\n");
const SPEICHER = "js/map-features/map-features-ecosystem-region-store.js";
const EBENEN = ["derographisch", "vegetation", "topographie", "klima"];
const ruhe = () => new Promise((fertig) => setImmediate(fertig));
let pruefungen = 0;

// ---- Buehne ---------------------------------------------------------------------------------------

// Der echte Schreibkanal samt Lader in einem vm-Kontext. `postEcosystemEdit` ist eine Attrappe, die
// jede Anfrage ANHAELT, bis der Test sie beantwortet -- damit steuert der Test die Zeitfolge.
//
// 🔴 Die Attrappe wird NACH dem Laden gesetzt und ersetzt damit die echte Fassung: der Lader loest
// `postEcosystemEdit` erst beim Aufruf auf, sieht also sie.
function baueBuehne(aktiveEbene = "vegetation") {
	const anfragen = [];
	const kontext = {
		console: { warn() {}, log() {}, error() {} },
		JSON, Math, Number, String, Boolean, Array, Object, Promise, Map, Set,
		isKnownEcosystemKind: (kind) => EBENEN.includes(kind),
		getActiveEcosystemLayerKind: () => kontext.__aktiv,
		__aktiv: aktiveEbene,
	};
	kontext.globalThis = kontext;
	vm.createContext(kontext);
	vm.runInContext(lies(SPEICHER), kontext);

	kontext.postEcosystemEdit = (aktion, rumpf) => {
		assert.strictEqual(aktion, "list_regions", "der Lader fragt nur list_regions");
		return new Promise((loese, verwirf) => {
			anfragen.push({
				kind: rumpf.kind,
				beantworte(marke = "stand") {
					loese({
						regions: [{ public_id: `${rumpf.kind}-1`, name: `${rumpf.kind}:${marke}`, kind: rumpf.kind }],
						region_types: [{ type_key: "x", label: "X" }],
					});
				},
				scheitere(text = "Serverfehler") {
					verwirf(new Error(text));
				},
			});
		});
	};

	const lese = (ausdruck) => JSON.parse(vm.runInContext(`JSON.stringify(${ausdruck})`, kontext));
	return {
		kontext,
		anfragen,
		geladeneEbenen: () => lese("Object.keys(ecosystemRegionsByKind)").sort(),
		namenDer: (kind) => lese(`(ecosystemRegionsByKind[${JSON.stringify(kind)}] || []).map((r) => r.name)`),
		laden: (kind, optionen) => kontext.loadEcosystemRegions(kind, optionen),
	};
}

// Alle bisher gestellten, noch offenen Anfragen in der Reihenfolge ihres Abgangs beantworten.
async function beantworteAlle(buehne, marke) {
	for (const anfrage of buehne.anfragen.slice()) {
		if (!anfrage.beantwortet) {
			anfrage.beantwortet = true;
			anfrage.beantworte(marke);
			await ruhe();
		}
	}
}

function pruefe(bedingung, text) {
	pruefungen += 1;
	assert.ok(bedingung, text);
}

// ---- A. Gleichzeitige Aufrufer derselben Ebene ----------------------------------------------------
//
// Das ist der Livefall: Traegerzeile und Flaechensuche fragen beide nach derselben Ebene, die zweite
// Anfrage ueberholt die erste. Wer auf die ERSTE wartet, muss trotzdem eine gefuellte Ebene vorfinden.
async function abschnittA() {
	const b = baueBuehne();
	const zustandAufrufer1 = b.laden("topographie").then(() => b.geladeneEbenen());
	await ruhe();
	const zustandAufrufer2 = b.laden("topographie").then(() => b.geladeneEbenen());
	await ruhe();

	await beantworteAlle(b);
	const [eins, zwei] = await Promise.all([zustandAufrufer1, zustandAufrufer2]);

	pruefe(eins.includes("topographie"),
		"A1: der ERSTE Aufrufer wacht mit gefuellter Ebene auf -- sonst baut er sein Menue aus einem leeren Bestand");
	pruefe(zwei.includes("topographie"), "A2: auch der zweite Aufrufer findet die Ebene");
	pruefe(b.anfragen.length === 1,
		`A3: gleichzeitige Aufrufer teilen sich EINE Anfrage statt zwei zu stellen (gestellt: ${b.anfragen.length})`);
}

// ---- B. Ein erzwungenes Neuladen ueberholt eine laufende Anfrage ----------------------------------
//
// Der zweite Weg zur selben Lage: der Dialog hat eine Anfrage laufen, ein Speichern erzwingt dieselbe
// Ebene neu. Die alte Antwort wird verworfen -- der alte Aufrufer darf aber erst weiterlaufen, wenn
// die NEUE da ist.
async function abschnittB() {
	const b = baueBuehne();
	let weitergelaufen = false;
	const dialog = b.laden("vegetation").then(() => {
		weitergelaufen = true;
		return b.namenDer("vegetation");
	});
	await ruhe();
	b.laden("vegetation", { force: true });          // das erzwungene Neuladen nach einem Schreibvorgang
	await ruhe();
	pruefe(b.anfragen.length === 2, "B1: das erzwungene Neuladen stellt eine eigene, zweite Anfrage");

	b.anfragen[0].beantworte("alt");                 // die ALTE Antwort trifft zuerst ein
	await ruhe();
	pruefe(weitergelaufen === false,
		"B2: der ueberholte Aufrufer laeuft NICHT weiter, solange die neuere Anfrage aussteht");

	b.anfragen[1].beantworte("neu");
	const namen = await dialog;
	pruefe(namen.length === 1 && namen[0] === "vegetation:neu",
		`B3: er laeuft mit dem NEUEN Stand weiter (gefunden: ${JSON.stringify(namen)})`);
}

// ---- C. Eine spaete alte Antwort ueberschreibt nie eine neuere ------------------------------------
//
// Die Marke aus dem Juli (2026-07-28) darf der Umbau nicht kosten: sie schuetzt gerade vor diesem Fall.
async function abschnittC() {
	const b = baueBuehne();
	const erste = b.laden("topographie");
	await ruhe();
	const zweite = b.laden("topographie", { force: true });
	await ruhe();

	b.anfragen[1].beantworte("neu");                 // die neuere zuerst ...
	await ruhe();
	b.anfragen[0].beantworte("alt");                 // ... die alte danach
	await Promise.all([erste, zweite]);

	const namen = b.namenDer("topographie");
	pruefe(namen.length === 1 && namen[0] === "topographie:neu",
		`C1: die spaete alte Antwort ueberschreibt den neuen Stand NICHT (gefunden: ${JSON.stringify(namen)})`);
}

// ---- D. Der Fall des Owners, von Anfang bis Ende --------------------------------------------------
//
// Speichern leert den Bestand und laedt die aktive Ebene neu; danach oeffnet ein Dialog, in dem zwei
// Aufrufer ALLE Ebenen verlangen. Wenn der erste Aufrufer weiterlaeuft, muessen alle da sein --
// genau in diesem Augenblick baut `fillLabelRegionSelect` das Menue.
async function abschnittD() {
	for (const aktiv of ["vegetation", "topographie"]) {
		const b = baueBuehne(aktiv);

		b.kontext.invalidateEcosystemRegionCache();   // das Speichern: alles leeren, nur die aktive laden
		await ruhe();
		await beantworteAlle(b);
		pruefe(b.geladeneEbenen().join() === aktiv, `D1 (${aktiv}): nach dem Speichern steht nur die aktive Ebene da`);

		const traegerzeile = Promise.all(EBENEN.map((kind) => b.laden(kind))).then(() => b.geladeneEbenen());
		await ruhe();
		// Die Flaechensuche startet erst, wenn die erste Runde schon unterwegs ist (im Browser nach der
		// Antwort der Sperre) -- ihre Anfragen ueberholen die der Traegerzeile.
		const flaechensuche = Promise.all(EBENEN.map((kind) => b.laden(kind))).then(() => b.geladeneEbenen());
		await ruhe();

		await beantworteAlle(b);
		const sichtDerTraegerzeile = await traegerzeile;
		await flaechensuche;

		assert.deepStrictEqual(sichtDerTraegerzeile, EBENEN.slice().sort(),
			`D2 (${aktiv}): beim Weiterlaufen der Traegerzeile stehen ALLE Ebenen im Bestand -- sonst zeigt das `
			+ `Auswahlmenue nur die aktive`);
		pruefungen += 1;
	}
}

// ---- E. Nach dem Leeren wird wirklich NEU geladen ------------------------------------------------
//
// 💣 Die Gegenseite der gemeinsamen Anfrage: eine abgeschlossene Anfrage darf nicht als „laeuft noch"
// haengenbleiben. Sonst gaebe ein spaeterer Aufruf nach dem Leeren die alte, laengst erledigte Zusage
// zurueck, ohne etwas zu laden -- die Ebene bliebe leer, und kein Fehler sagte warum.
async function abschnittE() {
	const b = baueBuehne("vegetation");
	const erster = b.laden("topographie");
	await ruhe();
	await beantworteAlle(b);
	await erster;
	pruefe(b.geladeneEbenen().includes("topographie"), "E1: die Ebene steht nach der Antwort im Bestand");

	b.kontext.invalidateEcosystemRegionCache();      // leert alles, laedt die AKTIVE (vegetation) neu
	await ruhe();
	const vorher = b.anfragen.length;
	const zweiter = b.laden("topographie");
	await ruhe();
	pruefe(b.anfragen.length === vorher + 1,
		"E2: nach dem Leeren stellt ein neuer Aufruf eine NEUE Anfrage -- keine alte, erledigte Zusage");
	await beantworteAlle(b);
	await zweiter;
	pruefe(b.geladeneEbenen().includes("topographie"), "E3: und die Ebene steht wieder da");
}

// ---- F. Ein Fehlschlag haengt niemanden auf -------------------------------------------------------
//
// Bestehendes Verhalten, hier festgehalten, weil die gemeinsame Anfrage es nicht kosten darf: eine
// LEERE Liste statt einer fehlenden, damit die Dialoge nicht ewig auf ein Vokabular warten.
async function abschnittF() {
	const b = baueBuehne();
	const aufrufer1 = b.laden("derographisch").then(() => "fertig");
	await ruhe();
	const aufrufer2 = b.laden("derographisch").then(() => "fertig");
	await ruhe();

	b.anfragen[0].scheitere();
	if (b.anfragen[1]) {
		b.anfragen[1].scheitere();
	}
	const ergebnis = await Promise.race([
		Promise.all([aufrufer1, aufrufer2]),
		new Promise((fertig) => setTimeout(() => fertig("haengt"), 500)),
	]);

	pruefe(ergebnis !== "haengt", "F1: auch bei einem Fehlschlag kehren ALLE Aufrufer zurueck");
	pruefe(b.geladeneEbenen().includes("derographisch") && b.namenDer("derographisch").length === 0,
		"F2: der Fehlschlag hinterlaesst eine LEERE Liste, keine fehlende");

	// F3: scheitert die UEBERHOLTE Anfrage, gilt dieselbe Zusage wie bei ihrer Antwort (Abschnitt B) --
	// der Aufrufer wartet auf die neuere und laeuft nicht mit einem leeren Bestand weiter. Der Fehlerzweig
	// ist ein eigener Weg durch dieselbe Funktion; ohne diesen Fall blieb er ungeprueft.
	const c = baueBuehne();
	let weiter = false;
	const alter = c.laden("klima").then(() => {
		weiter = true;
		return c.namenDer("klima");
	});
	await ruhe();
	c.laden("klima", { force: true });
	await ruhe();
	c.anfragen[0].scheitere();                       // die ALTE Anfrage scheitert zuerst
	await ruhe();
	pruefe(weiter === false, "F3: der Aufrufer einer gescheiterten, ueberholten Anfrage wartet auf die neuere");
	c.anfragen[1].beantworte("neu");
	const namen = await alter;
	pruefe(namen.length === 1 && namen[0] === "klima:neu",
		`F4: und er laeuft mit dem Stand der neueren weiter (gefunden: ${JSON.stringify(namen)})`);
}

(async () => {
	await abschnittA();
	await abschnittB();
	await abschnittC();
	await abschnittD();
	await abschnittE();
	await abschnittF();
	console.log(`ecosystem-regionen-lader-wartet: ${pruefungen} Pruefungen bestanden`);
})().catch((fehler) => {
	console.error(fehler);
	process.exit(1);
});
