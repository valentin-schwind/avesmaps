// Die SCHREIBZEILE des Wiki-Zuweisungskastens -- „wann wirkt das, was ich hier tue?“
//
// 🔴 DER ANLASS IST EIN OWNER-BEFUND (16.08.2026), und er galt genau EINEM Kasten: „Editieren →
// Speichern“ ist ueberall stimmig, nur der Wiki-Kasten schwieg. Man waehlte einen Artikel, sah ein
// Ergebnis und wusste nicht, ob das schon in der Datenbank steht oder wartet. Seine Worte: „wenn du
// dahinschreibst, dass Änderungen gespeichert werden müssen (unter das WikiSync, das offensichtlich
// noch nicht gespeichert ist, was niemand sieht), dann ist alles ok“ -- und „Abbrechen wenn ich die
// Änderungen nicht haben will“.
//
// Drei Dinge werden hier festgenagelt, und alle drei fallen aus der ERKLAERUNG (`schreibt`), nicht
// aus der Oberflaeche:
//   1. eine DAUERHAFTE Zeile, die den Schreibzeitpunkt nennt -- sichtbar, BEVOR jemand klickt.
//   2. ein SICHTBARER Zustand „noch nicht gespeichert“, sobald etwas aussteht.
//   3. der Verwerfen-Knopf -- aber NUR dort, wo es etwas zu verwerfen gibt. Wo sofort geschrieben
//      wird, waere er eine Luege; dort heisst der Rueckweg „Entfernen“.
//
// 💣 UND DAS IST DER PUNKT, DEN EIN SPAETERER LESER ZUERST WISSEN MUSS: das Bauteil kennt KEINE
// Objektart. Sieben abgeschriebene Textzeilen in sieben Oberflaechen waeren das Gegenteil dieses
// ganzen Zweigs -- genau eine stand vorher da (html/landschaften-editor.html), von Hand, und sie
// ist mit diesem Umbau weggefallen.
//
// ⭐ Geprueft wird das VERHALTEN, nicht die Form: Teil 1 baut Modelle, Teil 2 faehrt einen echten
// `mount` samt Klicks ueber die Zuhoerer, die das Bauteil selbst angehaengt hat.
//
// 🪤 UND EINE WARNUNG AN DEN NAECHSTEN, DER HIER SCHREIBT: in einer doppelt gequoteten
// JS-Zeichenkette beendet ein gerades " die Zeichenkette. Deutsche Anfuehrungszeichen kommen
// deshalb IMMER als Paar „…“ -- ein „Wort" mit geradem Schlusszeichen macht die Datei kaputt, und
// ein Skript, das das nachtraeglich reparieren will, frisst leicht den Text dazwischen (genau das
// ist am 17.08.2026 passiert).
//
// Run: node js/ui/__tests__/wiki-assign-schreibzeile.test.js
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const { AVESMAPS_WIKI_ASSIGN_REGISTRY, avesmapsWikiAssignSubject } = require("../wiki-assign-registry.js");
const { avesmapsWikiAssignDiff } = require("../wiki-assign-diff.js");
const {
	AVESMAPS_WIKI_ASSIGN_TEXTE,
	avesmapsWikiAssignSkin,
	avesmapsWikiAssignModell,
	avesmapsWikiAssignMarkup,
	avesmapsWikiAssignMount,
} = require("../wiki-assign.js");

// Im Browser legen die <script>-Zeilen diese Globalen an; `mount` prueft BEIDE.
global.avesmapsWikiAssignSubject = avesmapsWikiAssignSubject;
global.avesmapsWikiAssignDiff = avesmapsWikiAssignDiff;

const wurzel = path.resolve(__dirname, "..", "..", "..");
let checks = 0;
const zaehl = () => { checks += 1; };
const knoepfeVon = (modell) => modell.knoepfe.map((k) => k.aktion);

// Eine Erklaerung, die nur das traegt, worum es hier geht. 🔴 Bewusst KEINE echte Objektart: die
// Regel gilt fuer den WERT von `schreibt`, nicht fuer eine bestimmte Objektart -- eine Fixture aus
// dem echten Register machte diesen Teil von deren Feldern abhaengig.
const erklaerungMit = (schreibt) => ({
	label: "Wiki-Artikel",
	suche: { art: "liste", quelle: "kandidaten" },
	treffer: [],
	felder: [],
	sync: false,
	schreibt: schreibt,
});

// ══ TEIL 1 — DAS REINE MODELL ═══════════════════════════════════════════════════════════════

// (1) sofort, ruhend: die Zeile nennt den Schreibzeitpunkt, und es gibt keinen Verwerfen-Knopf.
const sofortRuhend = avesmapsWikiAssignModell(erklaerungMit("sofort"), { artikel: null }, {});
assert.ok(sofortRuhend.schreibZeile, "die Schreibzeile fehlt ganz");
assert.strictEqual(sofortRuhend.schreibZeile.text, AVESMAPS_WIKI_ASSIGN_TEXTE.schreibtSofort);
assert.strictEqual(sofortRuhend.schreibZeile.ungespeichert, false);
assert.ok(knoepfeVon(sofortRuhend).indexOf("verwerfen") === -1,
	"eine sofort schreibende Oberflaeche bietet Abbrechen an -- das waere eine Luege");
zaehl(); zaehl(); zaehl(); zaehl();

// (2) 🔴 sofort UND ungespeichert: DAS DARF ES NICHT GEBEN, und das Bauteil haelt es aus. Wo sofort
// geschrieben wird, kann nichts ausstehen -- ein Merker, den irgendwer trotzdem setzt, darf weder
// die Zeile umschreiben noch den Knopf herbeizaubern. Sonst haengt der Rueckweg an einer Handlung,
// die es auf dem Server schon gibt.
const sofortOffen = avesmapsWikiAssignModell(erklaerungMit("sofort"), { artikel: null }, { ungespeichert: true });
assert.strictEqual(sofortOffen.schreibZeile.text, AVESMAPS_WIKI_ASSIGN_TEXTE.schreibtSofort);
assert.strictEqual(sofortOffen.schreibZeile.ungespeichert, false);
assert.ok(knoepfeVon(sofortOffen).indexOf("verwerfen") === -1);
zaehl(); zaehl(); zaehl();

// (3) speichern, ruhend.
const wartetRuhend = avesmapsWikiAssignModell(erklaerungMit("speichern"), { artikel: null }, {});
assert.strictEqual(wartetRuhend.schreibZeile.text, AVESMAPS_WIKI_ASSIGN_TEXTE.schreibtSpeichern);
assert.ok(knoepfeVon(wartetRuhend).indexOf("verwerfen") === -1,
	"der Verwerfen-Knopf steht da, obwohl nichts aussteht -- ein vierter Knopf ohne Gegenstand");
zaehl(); zaehl();

// (4) speichern UND ungespeichert: die Zeile wechselt UND nennt den Schreibzeitpunkt weiter.
// 💣 Genau das ist der Kern: ein blosses „Noch nicht gespeichert.“ naehme die Auskunft weg, wegen
// der die Zeile ueberhaupt existiert -- und zwar in dem Augenblick, in dem sie zaehlt.
const wartetOffen = avesmapsWikiAssignModell(erklaerungMit("speichern"), { artikel: null }, { ungespeichert: true });
assert.strictEqual(wartetOffen.schreibZeile.text, AVESMAPS_WIKI_ASSIGN_TEXTE.schreibtOffen);
assert.strictEqual(wartetOffen.schreibZeile.ungespeichert, true);
assert.ok(/Speichern/.test(wartetOffen.schreibZeile.text),
	"der ungespeicherte Zustand nennt den Schreibzeitpunkt nicht mehr");
assert.ok(knoepfeVon(wartetOffen).indexOf("verwerfen") !== -1,
	"der Verwerfen-Knopf fehlt, obwohl etwas aussteht");
zaehl(); zaehl(); zaehl(); zaehl();

// (5) Ohne `schreibt` und mit UNSINN: STUMM, nicht geraten. Eine falsche Auskunft darueber, ob
// etwas schon in der Datenbank steht, ist schlimmer als gar keine.
[undefined, "", "vielleicht", 1].forEach((wert) => {
	const stumm = avesmapsWikiAssignModell(
		Object.assign(erklaerungMit("speichern"), { schreibt: wert }), { artikel: null }, { ungespeichert: true });
	assert.strictEqual(stumm.schreibZeile, null, "bei `schreibt: " + JSON.stringify(wert) + "` wird geraten");
	assert.ok(knoepfeVon(stumm).indexOf("verwerfen") === -1);
	zaehl(); zaehl();
});

// (6) In den zwei ARBEITS-Zustaenden steht sie nicht: die Suche ist fluechtig, und die Sync-Vorschau
// sagt es mit ihrem eigenen Fussatz. Zwei Saetze uebereinander, die dasselbe meinen, liest niemand.
["suche", "sync"].forEach((modus) => {
	const arbeitend = avesmapsWikiAssignModell(erklaerungMit("speichern"), { artikel: null },
		{ modus: modus, ungespeichert: true, syncZeilen: [] });
	assert.strictEqual(arbeitend.schreibZeile, null, "im Modus " + modus + " steht die Schreibzeile doch da");
	zaehl();
});

// (7) BEIDE HUELLEN tragen sie, und die Zustandsklasse kommt NUR im ungespeicherten Fall.
// 💣 Eine Rolle, die nur in einer Huelle einen Namen hat, faellt in der anderen lautlos aus
// (die Regel steht im Kopf von js/ui/wiki-assign.js).
["dt", "label-wiki"].forEach((huelleName) => {
	const huelle = avesmapsWikiAssignSkin(huelleName);
	const ruhig = avesmapsWikiAssignMarkup(wartetRuhend, huelle);
	const offen = avesmapsWikiAssignMarkup(wartetOffen, huelle);
	assert.ok(ruhig.indexOf(huelle.schreibZeile) !== -1, huelleName + ": die Schreibzeile fehlt im Markup");
	assert.ok(ruhig.indexOf(huelle.schreibZeileOffen) === -1,
		huelleName + ": die Zustandsklasse steht auch im ruhenden Kasten -- dann faerbt er dauernd");
	assert.ok(offen.indexOf(huelle.schreibZeile + " " + huelle.schreibZeileOffen) !== -1,
		huelleName + ": im ungespeicherten Fall fehlt die Zustandsklasse: " + offen);
	// ⚠️ `role="status"`/`aria-live`: das Umspringen der Zeile ist der einzige Zustandswechsel im
	// Kasten, den ein Hilfsmittel sonst gar nicht mitbekaeme -- der Knoten wird beim Zeichnen ersetzt.
	assert.ok(/data-wa-schreibzeile[^>]*role="status"[^>]*aria-live="polite"/.test(offen),
		huelleName + ": die Schreibzeile meldet sich Hilfsmitteln nicht: " + offen);
	zaehl(); zaehl(); zaehl(); zaehl();
});

// (8) 🔴 BEIDE HUELLENKLASSEN HABEN EINE CSS-REGEL, UND DIE KOMBINATION AUCH. Die generische
// `.is-ungespeichert` allein faerbt nichts -- dieselbe Falle wie bei `.is-active` in der
// Trefferliste, die am 16.08.2026 in einer Huelle unsichtbar war.
// 🪤 OHNE KOMMENTARE, und das ist eine Korrektur vom 17.08.2026. Die Mutationsprobe „nimm der
// dt-Huelle ihre Kombinationsregel“ lief GRUEN durch: `region-sync.css` nennt sie in einem
// Kommentar („Gegenstueck: .dt-schreibzeile.is-ungespeichert“), und die Suche fand den Kommentar.
// Eine Zusicherung, die ein Kommentar erfuellt, prueft den Kommentar -- genau die Falle, die im
// Quellen-Test daneben schon einmal zugeschnappt ist.
const allesCss = (function sammle(verzeichnis, gesammelt) {
	fs.readdirSync(path.join(wurzel, verzeichnis), { withFileTypes: true }).forEach((eintrag) => {
		const rel = verzeichnis + "/" + eintrag.name;
		if (eintrag.isDirectory()) { gesammelt = sammle(rel, gesammelt); return; }
		if (eintrag.name.endsWith(".css")) {
			gesammelt += fs.readFileSync(path.join(wurzel, rel), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");
		}
	});
	return gesammelt;
})("css", "");
["dt", "label-wiki"].forEach((huelleName) => {
	const huelle = avesmapsWikiAssignSkin(huelleName);
	assert.ok(allesCss.indexOf("." + huelle.schreibZeile) !== -1,
		huelleName + ": ." + huelle.schreibZeile + " hat in keiner CSS-Datei eine Regel");
	assert.ok(allesCss.indexOf("." + huelle.schreibZeile + "." + huelle.schreibZeileOffen) !== -1,
		huelleName + ": die KOMBINATION ." + huelle.schreibZeile + "." + huelle.schreibZeileOffen
		+ " hat keine Regel -- der ungespeicherte Zustand saehe aus wie der ruhende");
	zaehl(); zaehl();
});

// (9) Jede Objektart des echten Registers traegt einen der zwei Werte -- geraten wird nirgends.
// ⚠️ Ein BODEN auf die Zahl, damit ein leer gewordenes Register nicht als „alles gut“ durchgeht.
const arten = Object.entries(AVESMAPS_WIKI_ASSIGN_REGISTRY);
assert.ok(arten.length >= 8, "das Feldregister fuehrt nur " + arten.length + " Objektarten");
zaehl();
arten.forEach(([subject, e]) => {
	assert.ok(e.schreibt === "sofort" || e.schreibt === "speichern",
		subject + ": `schreibt` ist weder sofort noch speichern (" + JSON.stringify(e.schreibt) + ") -- "
		+ "dann schweigt der Kasten dieser Objektart ueber seinen Schreibzeitpunkt.");
	zaehl();
});
// 🔴 UND DIE GEMESSENE WIRKLICHKEIT, Objektart fuer Objektart (17.08.2026). Sie steht hier als
// TAFEL, nicht als Zahl: „zwei schreiben sofort“ liest sich vollstaendig und sagt nicht, welche.
// Wer eine Zeile aendert, hat den Schreibweg dieser Oberflaeche gemessen -- oder er irrt sich.
assert.deepStrictEqual(
	Object.fromEntries(arten.map(([subject, e]) => [subject, e.schreibt])),
	{
		kraftlinie: "speichern",       // wikiAssignUngespeichert setzt nur die Meldung
		weg: "sofort",                 // assign_to / clear_assign gegen /api/edit/wiki/paths.php
		ort: "sofort",                 // assign_to / clear_assign gegen die Siedlungs-Endpunkte
		landschaft: "speichern",       // wikiStand bzw. pendingWikiRegion
		landschaftslabel: "speichern", // currentLabelWikiRegion, buildLabelEditPayload
		territorium: "speichern",      // die Formularfelder region-edit-wiki-*
		literatur: "speichern",        // aeWikiUngespeichert, lies() in saveStammdaten
		karte: "speichern",            // ceWikiUngespeichert, lies() in saveStamm
	},
	"die Tafel der Schreibzeitpunkte hat sich geaendert -- gemessen oder geraten?");
zaehl();

// ══ TEIL 2 — DER ECHTE ABLAUF UEBER `mount` ═════════════════════════════════════════════════
// Geklickt wird ueber die Zuhoerer, die `mount` selbst angehaengt hat -- kein nachgebauter Ablauf.

/**
 * Behaelter-Attrappe MIT `querySelector`. 🔴 Sie ist noetig, weil das Umlegen des Haekchens den
 * TEILWEISEN Weg nimmt (`zeichneSchreibzustand`): eine Attrappe, die immer `null` liefert, faellt
 * auf das volle Zeichnen zurueck -- der Test praefte dann genau den Zweig NICHT, um den es geht.
 */
function behaelterAttrappe() {
	const zuhoerer = {};
	const schreibzeile = { textContent: "", className: "", innerHTML: "" };
	const knopfreihe = { textContent: "", className: "", innerHTML: "" };
	return {
		textContent: "", innerHTML: "",
		schreibzeile: schreibzeile,
		knopfreihe: knopfreihe,
		addEventListener(typ, fn) { zuhoerer[typ] = fn; },
		removeEventListener(typ) { delete zuhoerer[typ]; },
		querySelector(selektor) {
			if (selektor === "[data-wa-schreibzeile]") { return schreibzeile; }
			if (selektor === "[data-wa-knoepfe]") { return knopfreihe; }
			return null;
		},
		contains() { return true; },
		feuere(typ, z) { if (zuhoerer[typ]) { zuhoerer[typ]({ target: z, preventDefault() {} }); } },
	};
}
function ziel(merkmal, wert) {
	const element = {
		getAttribute: (name) => (name === merkmal ? wert : null),
		hasAttribute: (name) => name === merkmal,
	};
	element.closest = (selektor) => (selektor === "[" + merkmal + "]" ? element : null);
	return element;
}
const ruhe = () => new Promise((fertig) => setTimeout(fertig, 0));

(async () => {
	// Die Erklaerung „kraftlinie“ ist die einzige echte, deren Suche im Browser laeuft (`liste`) --
	// damit braucht dieser Teil kein `fetch`.
	const geladenerArtikel = { name: "Konzilslinie", wiki_url: "https://w/wiki/K", wiki_key: "k", werte: {} };
	const kandidat = { name: "Satinavs Ketten", wiki_url: "https://w/wiki/S", wiki_key: "s", werte: {} };
	const standBauen = () => ({ artikel: geladenerArtikel, listen: { wiki_articles: [kandidat] } });

	// ---- (10) Zuweisen -> ausstehend -> Verwerfen -> wieder der geladene Stand ------------------
	{
		const b = behaelterAttrappe();
		let verwerfenRufe = 0;
		let ladeRufe = 0;
		const st = avesmapsWikiAssignMount(b, {
			subject: "kraftlinie", skin: "dt",
			laden: () => { ladeRufe += 1; return standBauen(); },
			zuweisen: () => {},
			verwerfen: () => { verwerfenRufe += 1; },
		});
		await ruhe();
		assert.strictEqual(ladeRufe, 1);
		assert.ok(b.innerHTML.indexOf(AVESMAPS_WIKI_ASSIGN_TEXTE.schreibtSpeichern) !== -1,
			"der frisch geladene Kasten sagt seinen Schreibzeitpunkt nicht: " + b.innerHTML);
		assert.ok(b.innerHTML.indexOf('data-wa-aktion="verwerfen"') === -1,
			"der Verwerfen-Knopf steht schon da, bevor irgendetwas aussteht");
		zaehl(); zaehl(); zaehl();

		// Suchen und den einen Kandidaten waehlen.
		b.feuere("click", ziel("data-wa-aktion", "aendern"));
		await ruhe();
		b.feuere("click", ziel("data-wa-treffer", "0"));
		await ruhe();
		assert.strictEqual(st.lies().wiki_key, "s", "der Treffer wurde gar nicht uebernommen");
		assert.ok(b.innerHTML.indexOf(AVESMAPS_WIKI_ASSIGN_TEXTE.schreibtOffen) !== -1,
			"nach dem Zuweisen sagt der Kasten nicht, dass etwas aussteht: " + b.innerHTML);
		assert.ok(b.innerHTML.indexOf('data-wa-aktion="verwerfen"') !== -1,
			"nach dem Zuweisen fehlt der Verwerfen-Knopf: " + b.innerHTML);
		zaehl(); zaehl(); zaehl();

		// Verwerfen: erst der Rueckruf der Oberflaeche, dann das Neuladen.
		b.feuere("click", ziel("data-wa-aktion", "verwerfen"));
		await ruhe();
		assert.strictEqual(verwerfenRufe, 1, "der Rueckruf `verwerfen` wurde nicht gerufen");
		assert.strictEqual(ladeRufe, 2, "nach dem Verwerfen wurde nicht neu geladen -- der Entwurf staende weiter");
		assert.strictEqual(st.lies().wiki_key, "k", "der geladene Artikel kam nicht zurueck");
		assert.ok(b.innerHTML.indexOf(AVESMAPS_WIKI_ASSIGN_TEXTE.schreibtSpeichern) !== -1,
			"die Zeile behauptet weiter Ungespeichertes: " + b.innerHTML);
		assert.ok(b.innerHTML.indexOf('data-wa-aktion="verwerfen"') === -1,
			"der Verwerfen-Knopf bleibt stehen, obwohl nichts mehr aussteht");
		zaehl(); zaehl(); zaehl(); zaehl(); zaehl();
	}

	// ---- (11) Ein ABGELEHNTES `verwerfen` aendert NICHTS ---------------------------------------
	// 🔴 Dieselbe Regel wie bei `zuweisen`/`loesen`: wer nichts tun konnte, lehnt ab, und dann bleibt
	// der Kasten stehen. Loeste er auf, waere die Zuweisung fuer den Betrachter verworfen und im
	// Entwurf der Oberflaeche weiterhin da -- die schlimmere Haelfte, weil sie ruhig aussieht.
	{
		const b = behaelterAttrappe();
		let ladeRufe = 0;
		avesmapsWikiAssignMount(b, {
			subject: "kraftlinie", skin: "dt",
			laden: () => { ladeRufe += 1; return standBauen(); },
			zuweisen: () => {},
			verwerfen: () => { throw new Error("geht gerade nicht"); },
		});
		await ruhe();
		b.feuere("click", ziel("data-wa-aktion", "aendern"));
		await ruhe();
		b.feuere("click", ziel("data-wa-treffer", "0"));
		await ruhe();
		const ladeVorher = ladeRufe;
		b.feuere("click", ziel("data-wa-aktion", "verwerfen"));
		await ruhe();
		assert.strictEqual(ladeRufe, ladeVorher, "trotz abgelehntem `verwerfen` wurde neu geladen");
		assert.ok(b.innerHTML.indexOf(AVESMAPS_WIKI_ASSIGN_TEXTE.schreibtOffen) !== -1,
			"trotz abgelehntem `verwerfen` meldet der Kasten wieder Ruhe: " + b.innerHTML);
		zaehl(); zaehl();
	}

	// ---- (12) Eine ABGELEHNTE Zuweisung stellt nichts aus --------------------------------------
	// 💣 Der Merker haengt am ERFOLG, nicht am Klick. Haenge er am Klick, saehe der Editor nach einem
	// Serverfehler „noch nicht gespeichert“ -- und speicherte, um etwas zu sichern, was es nicht gibt.
	{
		const b = behaelterAttrappe();
		avesmapsWikiAssignMount(b, {
			subject: "kraftlinie", skin: "dt",
			laden: () => standBauen(),
			zuweisen: () => Promise.reject(new Error("der Server sagt nein")),
			verwerfen: () => {},
		});
		await ruhe();
		b.feuere("click", ziel("data-wa-aktion", "aendern"));
		await ruhe();
		b.feuere("click", ziel("data-wa-treffer", "0"));
		await ruhe();
		// 🪤 UND ZWAR AUS DEM RUHEZUSTAND HERAUS GEMESSEN. Nach einer abgelehnten Zuweisung bleibt
		// die SUCHE offen, und dort steht die Schreibzeile ohnehin nie -- die Probe waere gruen,
		// egal was der Merker sagt. Genau so ist die erste Fassung durchgerutscht. Also erst die
		// Suche schliessen, dann fragen.
		b.feuere("click", ziel("data-wa-aktion", "abbrechen"));
		await ruhe();
		assert.ok(b.innerHTML.indexOf(AVESMAPS_WIKI_ASSIGN_TEXTE.schreibtSpeichern) !== -1,
			"nach der Absage steht die ruhende Schreibzeile nicht da: " + b.innerHTML);
		assert.ok(b.innerHTML.indexOf(AVESMAPS_WIKI_ASSIGN_TEXTE.schreibtOffen) === -1,
			"eine ABGELEHNTE Zuweisung stellt trotzdem etwas aus: " + b.innerHTML);
		assert.ok(b.innerHTML.indexOf('data-wa-aktion="verwerfen"') === -1,
			"nach einer abgelehnten Zuweisung steht der Verwerfen-Knopf da -- es gibt nichts zu verwerfen");
		zaehl(); zaehl(); zaehl();
	}

	// ---- (12b) EIN NEULADEN LOESCHT DEN MERKER -------------------------------------------------
	// 🔴 Das ist der Weg, auf dem ein „Speichern“ der Oberflaeche die Zeile zuruecksetzt: die Wirte
	// zeichnen ihre Spalte danach neu und montieren den Kasten frisch (oder rufen `neuLaden`). Ohne
	// diesen Riegel behauptete der Kasten nach dem Speichern weiter Ungespeichertes -- und ein
	// „Abbrechen“ daneben boete an, etwas zu verwerfen, das laengst in der Datenbank steht.
	{
		const b = behaelterAttrappe();
		const st = avesmapsWikiAssignMount(b, {
			subject: "kraftlinie", skin: "dt",
			laden: () => standBauen(),
			loesen: () => {},
			verwerfen: () => {},
		});
		await ruhe();
		b.feuere("click", ziel("data-wa-aktion", "entfernen"));
		await ruhe();
		assert.ok(b.innerHTML.indexOf(AVESMAPS_WIKI_ASSIGN_TEXTE.schreibtOffen) !== -1);
		await st.neuLaden();
		assert.ok(b.innerHTML.indexOf(AVESMAPS_WIKI_ASSIGN_TEXTE.schreibtSpeichern) !== -1,
			"nach einem Neuladen behauptet der Kasten weiter Ungespeichertes: " + b.innerHTML);
		assert.ok(b.innerHTML.indexOf('data-wa-aktion="verwerfen"') === -1,
			"nach einem Neuladen steht der Verwerfen-Knopf weiter da");
		zaehl(); zaehl(); zaehl();
	}

	// ---- (13) Entfernen stellt etwas aus --------------------------------------------------------
	{
		const b = behaelterAttrappe();
		avesmapsWikiAssignMount(b, {
			subject: "kraftlinie", skin: "dt",
			laden: () => standBauen(),
			loesen: () => {},
			verwerfen: () => {},
		});
		await ruhe();
		b.feuere("click", ziel("data-wa-aktion", "entfernen"));
		await ruhe();
		assert.ok(b.innerHTML.indexOf(AVESMAPS_WIKI_ASSIGN_TEXTE.schreibtOffen) !== -1,
			"nach dem Entfernen sagt der Kasten nichts von einer ausstehenden Aenderung: " + b.innerHTML);
		assert.ok(b.innerHTML.indexOf('data-wa-aktion="verwerfen"') !== -1,
			"nach dem Entfernen fehlt der Verwerfen-Knopf -- die Loeschung liesse sich nicht zuruecknehmen");
		zaehl(); zaehl();
	}

	// ---- (14) Das HAEKCHEN stellt etwas aus, und zwar OHNE den Kasten neu zu bauen --------------
	// 💣 Es ist der einzige Ausloeser, der aus einem `change` kommt: ein volles `innerHTML` naehme dem
	// Kaestchen den Fokus mitten in einer Tastaturbedienung. Gemessen wird deshalb am TEILWEISEN Weg
	// (die Attrappe liefert die zwei Knoten, die `zeichneSchreibzustand` sucht).
	{
		const b = behaelterAttrappe();
		avesmapsWikiAssignMount(b, {
			subject: "ort", skin: "dt",
			laden: () => ({ artikel: null, keinArtikel: false }),
			verwerfen: () => {},
			// 🔴 Die Objektart „ort“ schreibt SOFORT -- fuer diesen Fall wird sie uebersteuert, weil
			// genau das der Anlegefall des Kartendialogs tut. Zwei Fliegen: der Uebersteuerungsweg
			// wird mitgefahren, und das Haekchen gibt es nur bei „ort“ und „landschaftslabel“.
			schreibt: "speichern",
		});
		await ruhe();
		const vorher = b.innerHTML;
		const haken = ziel("data-wa-kein-artikel", "");
		haken.checked = true;
		b.feuere("change", haken);
		await ruhe();
		assert.strictEqual(b.innerHTML, vorher,
			"das Umlegen des Haekchens hat den ganzen Kasten neu gebaut -- der Fokus ist weg");
		assert.strictEqual(b.schreibzeile.textContent, AVESMAPS_WIKI_ASSIGN_TEXTE.schreibtOffen,
			"die Schreibzeile wurde nicht nachgezogen: " + JSON.stringify(b.schreibzeile.textContent));
		assert.ok(/is-ungespeichert/.test(b.schreibzeile.className),
			"die Zustandsklasse fehlt: " + b.schreibzeile.className);
		assert.ok(b.knopfreihe.innerHTML.indexOf('data-wa-aktion="verwerfen"') !== -1,
			"der Verwerfen-Knopf wurde nicht nachgezogen: " + b.knopfreihe.innerHTML);
		zaehl(); zaehl(); zaehl(); zaehl();
	}

	// ---- (15) Die UEBERSTEUERUNG wirkt und laesst das Register in Ruhe ---------------------------
	// 🪤 Sie hat genau EINEN Aufrufer (den Anlegefall des Ortsdialogs). `Object.assign` auf eine
	// frische Huelle, nie auf die Erklaerung selbst: die ist ein geteiltes Objekt, das ALLE Mounts
	// derselben Objektart lesen -- eine Mutation dort schluege auf jeden offenen Dialog durch.
	{
		const b = behaelterAttrappe();
		avesmapsWikiAssignMount(b, {
			subject: "weg", skin: "dt",
			laden: () => ({ artikel: null }),
			schreibt: "speichern",
			verwerfen: () => {},
		});
		await ruhe();
		assert.ok(b.innerHTML.indexOf(AVESMAPS_WIKI_ASSIGN_TEXTE.schreibtSpeichern) !== -1,
			"die Uebersteuerung wirkt nicht: " + b.innerHTML);
		assert.strictEqual(AVESMAPS_WIKI_ASSIGN_REGISTRY.weg.schreibt, "sofort",
			"die Uebersteuerung hat die Erklaerung im Register veraendert -- sie gilt damit ueberall");
		zaehl(); zaehl();

		// Und ein unsinniger Wert uebersteuert NICHT (kein Raten).
		const b2 = behaelterAttrappe();
		avesmapsWikiAssignMount(b2, {
			subject: "weg", skin: "dt", laden: () => ({ artikel: null }), schreibt: "vielleicht",
		});
		await ruhe();
		assert.ok(b2.innerHTML.indexOf(AVESMAPS_WIKI_ASSIGN_TEXTE.schreibtSofort) !== -1,
			"ein unsinniger Uebersteuerungswert hat die Erklaerung verdraengt: " + b2.innerHTML);
		zaehl();
	}

	// ══ TEIL 3 — JEDE WARTENDE OBERFLAECHE HAT EINEN RUECKWEG ══════════════════════════════════
	// 🪤 UND HIER IST DIE EHRLICHE GRENZE DIESES TESTS: das Folgende ist eine TEXTPROBE. Sie sieht,
	// DASS ein `verwerfen:` an jeder Montagestelle steht, nicht, dass es den Entwurf wirklich
	// zuruecknimmt -- die Fehlerklasse, vor der der Kopf von js/ui/wiki-assign.js warnt.
	// ⭐ Was sie trotzdem faengt, ist der teuerste Fall: eine NEUE Oberflaeche, die den Rueckruf
	// schlicht vergisst. Dort zeigte der Verwerfen-Knopf wieder den alten Artikel, waehrend das
	// naechste Speichern den verworfenen schriebe -- ein HALBES Zuruecknehmen, und das ist schlimmer
	// als gar keins. Das VERHALTEN einer echten Oberflaeche faehrt
	// js/ui/__tests__/wiki-assign-landschaft.test.js im vm-Sandkasten.
	// 🪤 DER DECKEL IST GROSSZUEGIG, UND ZWAR MIT GRUND: die Blocklaenge haengt an den KOMMENTAREN im
	// Aufruf, nicht am Code. Mit 1600 fiel js/review/review-settlement-wiki.js heraus -- der einzige
	// Aufruf mit der Uebersteuerungs-Begruendung darin, also ausgerechnet der interessanteste. Der
	// Boden auf die Trefferzahl weiter unten hat es gemeldet; ohne ihn waere der Block still
	// unvollstaendig gelaufen.
	const MONTAGE = /avesmapsWikiAssignMount\(([\s\S]{0,5000}?)\n[\t ]*\}\);/g;
	const gefunden = [];
	function sammleMontagen(verzeichnis) {
		fs.readdirSync(path.join(wurzel, verzeichnis), { withFileTypes: true }).forEach((eintrag) => {
			const rel = verzeichnis + "/" + eintrag.name;
			if (eintrag.isDirectory()) {
				if (eintrag.name !== "__tests__" && eintrag.name !== "third-party") { sammleMontagen(rel); }
				return;
			}
			if (!/\.(js|html)$/.test(eintrag.name)) { return; }
			const quelle = fs.readFileSync(path.join(wurzel, rel), "utf8");
			MONTAGE.lastIndex = 0;
			let t;
			while ((t = MONTAGE.exec(quelle)) !== null) {
				const art = /subject:\s*"([a-z]+)"/.exec(t[1]);
				if (art) { gefunden.push({ datei: rel, subject: art[1], block: t[1] }); }
			}
		});
	}
	sammleMontagen("js");
	sammleMontagen("html");
	// ⚠️ EIN BODEN, sonst beweist ein kaputt gewordenes Suchmuster gar nichts (elf Oberflaechen,
	// gemessen am 17.08.2026 -- acht Objektarten, Weg, Ort und Landschaft in je zweien).
	assert.ok(gefunden.length >= 11,
		"es wurden nur " + gefunden.length + " Montagestellen des Zuweisungskastens gefunden -- "
		+ "das Suchmuster passt nicht mehr, und dieser Block prueft dann nichts.");
	zaehl();
	gefunden.forEach((stelle) => {
		const uebersteuert = /schreibt:\s*"speichern"/.test(stelle.block)
			// Der Anlegefall des Ortsdialogs: ein Ausdruck, kein Literal.
			|| /schreibt:\s*[^,\n]*\?\s*"sofort"\s*:\s*"speichern"/.test(stelle.block);
		const wartet = (avesmapsWikiAssignSubject(stelle.subject) || {}).schreibt === "speichern" || uebersteuert;
		if (!wartet) {
			// Eine sofort schreibende Oberflaeche DARF keinen haben -- den Knopf gibt es dort nicht.
			assert.ok(!/verwerfen:/.test(stelle.block),
				stelle.datei + " (" + stelle.subject + ") reicht `verwerfen` ein, schreibt aber sofort -- "
				+ "der Rueckruf wird nie gerufen und liest sich wie ein Beleg.");
			zaehl();
			return;
		}
		assert.ok(/verwerfen:/.test(stelle.block),
			stelle.datei + " (" + stelle.subject + ") wartet auf das Speichern, reicht aber kein `verwerfen` "
			+ "ein. Dann zeigt der Verwerfen-Knopf wieder den alten Artikel, waehrend das naechste "
			+ "Speichern den verworfenen schreibt -- ein HALBES Zuruecknehmen.");
		zaehl();
	});

	console.log("wiki-assign-schreibzeile: " + checks + " Zusicherungen erfuellt, "
		+ gefunden.length + " Montagestellen geprueft.");
})().catch((fehler) => {
	console.error(fehler && fehler.stack ? fehler.stack : fehler);
	process.exit(1);
});
