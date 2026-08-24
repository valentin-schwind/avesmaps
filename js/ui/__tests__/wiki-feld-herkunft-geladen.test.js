// Wer den Wiki-Override ZEICHNET, muss js/ui/wiki-feld-herkunft.js auch LADEN.
//
// 💣 DIE FALLE, GEGEN DIE DAS STEHT, HAT DAS HAUS SCHON EINMAL TEUER BEZAHLT. Jeder Zeichner
// beginnt mit `if (typeof avesmapsWikiFeldStand !== "function") { return; }` -- ein Riegel, der
// richtig ist (die Datei kann in einem Dokument fehlen) und der bei fehlender Skriptzeile LAUTLOS
// greift: die Feldzeilen saehen dann aus, als gaebe es keine Abweichung. Kein Fehler in der
// Konsole, kein roter Test, nichts.
// Genau diese Bauform war `avesmapsCoatSrc`: eine geteilte Datei, die nur EIN Dokument lud --
// 8 von 12 Wappen-Ausgaben hotlinkten daraufhin das Wiki, und es kostete die IP-Sperre.
//
// Gefunden statt gepflegt: der Test sucht die AUFRUFER von `avesmapsWikiFeldStand` und verlangt fuer
// jeden das Dokument, das ihn laedt. Eine neue Oberflaeche meldet sich damit von selbst.
//
// Run: node js/ui/__tests__/wiki-feld-herkunft-geladen.test.js

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const wurzel = path.resolve(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(wurzel, rel), "utf8");

const HELFER = "js/ui/wiki-feld-herkunft.js";
let checks = 0;

function alleQuellen(verzeichnis, treffer) {
	for (const eintrag of fs.readdirSync(path.join(wurzel, verzeichnis), { withFileTypes: true })) {
		if (eintrag.name === "__tests__" || eintrag.name === "third-party") { continue; }
		const rel = verzeichnis + "/" + eintrag.name;
		if (eintrag.isDirectory()) { alleQuellen(rel, treffer); }
		else if (/\.(js|html)$/.test(eintrag.name)) { treffer.push(rel); }
	}
	return treffer;
}

const quellen = alleQuellen("js", []).concat(alleQuellen("html", [])).concat(["index.html"]);
const inhalt = new Map(quellen.map((datei) => [datei, lies(datei)]));

// ---- Wer ruft ihn? ---------------------------------------------------------------------------

const aufrufer = quellen.filter((datei) =>
	datei !== HELFER && /avesmapsWikiFeldStand\s*\(/.test(inhalt.get(datei)));

assert.ok(aufrufer.length >= 3,
	"weniger als drei Aufrufer von avesmapsWikiFeldStand gefunden -- das Muster greift vermutlich "
	+ "nicht mehr: " + JSON.stringify(aufrufer));
checks++;

// ---- Und wer laedt ihn? ----------------------------------------------------------------------
// Ein Aufrufer ist entweder selbst ein Dokument (dann muss ER die Zeile tragen) oder ein Skript,
// das ein Dokument einbindet -- dann muss JEDES Dokument, das es einbindet, den Helfer ebenfalls
// laden. ⚠️ Ein Skript, das kein Dokument einbindet, ist tot und faellt hier ebenfalls auf.

const dokumente = quellen.filter((datei) => /\.html$/.test(datei));

for (const datei of aufrufer) {
	if (/\.html$/.test(datei)) {
		assert.ok(new RegExp(HELFER.replace(/\//g, "\\/")).test(inhalt.get(datei)),
			`${datei} ruft avesmapsWikiFeldStand, laedt aber ${HELFER} nicht. Der Zeichner gibt dann `
			+ "LAUTLOS auf (`typeof … !== \"function\"`), und die Feldzeilen sehen aus, als gaebe es "
			+ "keine Abweichung -- ohne Fehler, ohne Konsole, ohne roten Test.");
		checks++;
		continue;
	}

	// ⚠️ Nur ein echtes <script src=…> zaehlt, nicht die blosse Erwaehnung: die Dateien dieses
	// Projekts nennen einander staendig im Kommentar, und ein Kommentar laedt nichts. Der erste
	// Entwurf zaehlte jede Erwaehnung und meldete den Landschafts-Editor als Wirt des Kartendialogs.
	const wirte = dokumente.filter((dok) => {
		const muster = new RegExp("<script[^>]+src=[\"'][^\"']*"
			+ datei.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
		return muster.test(inhalt.get(dok));
	});
	assert.ok(wirte.length > 0,
		`${datei} ruft avesmapsWikiFeldStand, wird aber von KEINEM Dokument eingebunden -- entweder `
		+ "tot oder eine vergessene Skriptzeile.");
	checks++;

	for (const dok of wirte) {
		assert.ok(inhalt.get(dok).includes(HELFER),
			`${dok} bindet ${datei} ein, laedt aber ${HELFER} nicht. Der Zeichner gibt dort LAUTLOS `
			+ "auf und die Zeilen sehen aus wie „keine Abweichung\". Dieselbe Bauform wie "
			+ "avesmapsCoatSrc, wo eine geteilte Datei nur EIN Dokument band.");
		checks++;
	}
}

// ---- 💣 Und die Zelle darf nicht vom Uebersetzer ausgeraeumt werden --------------------------
// js/app/i18n.js setzt fuer `data-i18n` `el.textContent = v`. Eine `.wiki-alt`, die IN einem
// solchen Element steckt, ist beim ersten Sprachlauf spurlos weg -- und zwar erst dann, also nicht
// beim Bauen sichtbar. Sie gehoert deshalb NEBEN das uebersetzte Element, nie hinein.

for (const dok of dokumente) {
	const quelle = inhalt.get(dok);
	const treffer = quelle.match(/<[^>]*\bdata-i18n\b[^>]*>[^<]*<span[^>]*\bclass="wiki-alt"/g) || [];
	assert.deepStrictEqual(treffer, [],
		`${dok} schachtelt eine .wiki-alt IN ein Element mit data-i18n. js/app/i18n.js setzt dort `
		+ "`el.textContent = v` und raeumt die Zelle beim ersten Sprachlauf spurlos aus. Die Zelle "
		+ "gehoert NEBEN das uebersetzte Element: <span><span data-i18n=…>Name</span><span "
		+ "class=\"wiki-alt\"…></span></span>. Gefunden: " + treffer.join(" | "));
	checks++;
}

// ---- 💣 Und der Zeichner muss auch beim TIPPEN laufen ---------------------------------------
// Eine Abweichung, die nur beim Oeffnen gerechnet wird, bleibt stehen, nachdem der Editor den Wert
// von Hand angeglichen hat: durchgestrichener Wiki-Stand plus ↺ fuer etwas, das gar nicht mehr
// abweicht. Das Editorfenster der Landschaft hatte die Zuhoerer von Anfang an, der Kartendialog
// nicht -- gefunden hat es die Designpruefung, nicht das Testfeld. Eine Regel, die einen von zwei
// Erzeugern bindet, ist keine Regel (dieselbe Klasse wie die Verkehrsmittel-Sperre am 14.08.2026).
//
// ⚠️ Geprueft wird die NAEHE, nicht der genaue Aufbau: jeder Aufrufer soll seinen Zeichner an
// mindestens einen Eingabe- oder Auswahl-Zuhoerer haengen. Wie er heisst und wo er sitzt, bleibt
// seine Sache -- die Oberflaechen sind zu verschieden fuer eine Formvorschrift.

// 🪤 Gemessen wird der CODE, nicht die Datei: die Kommentare dieses Projekts sind laenger als der
// Rumpf, den sie erklaeren -- im Wege-Editor liegen ueber 400 Zeichen Begruendung zwischen dem
// `addEventListener("change"` und dem Aufruf darunter. Ein Fenster ueber den Rohtext haette dort
// eine richtige Verdrahtung als fehlend gemeldet.
function ohneKommentare(text) {
	// Blockkommentare: alles zwischen /* und */ faellt weg.
	const ohneBloecke = text.split("/*")
		.map((teil, n) => (n === 0 ? teil : teil.split("*/").slice(1).join("*/")))
		.join(" ");
	// Zeilenkommentare: ab // bis Zeilenende.
	return ohneBloecke.split("\n")
		.map((zeile) => {
			const stelle = zeile.indexOf("//");
			return stelle === -1 ? zeile : zeile.slice(0, stelle);
		})
		.join(" ")
		// 🪤 UND DIE LEERE ZUSAMMENFALTEN: ein weggeschnittener Kommentar hinterlaesst seine
		// Einrueckung, und im Wege-Editor frassen neun solcher Zeilen das ganze Fenster auf, bevor
		// der Aufruf darunter erreicht war. Gemessen wird die Dichte des CODES, nicht die seiner
		// Einrueckung.
		.replace(/\s+/g, " ");
}

for (const datei of aufrufer) {
	const quelle = ohneKommentare(inhalt.get(datei));
	// Der Zeichner: eine Funktion, deren NAME sie als Zeichner ausweist UND die den Wiki-Override
	// wirklich anfasst -- entweder `avesmapsWikiFeldStand` selbst oder den Rechner, der ihn ruft.
	//
	// 🪤 Bis zum 24.08.2026 stand hier nur `function\s+(\w*[Zz]eichne\w*)`, und das hatte ZWEI
	// Loecher, die einander verdeckt haben:
	//   (1) Es fand nur `function name(`, nie `const name = () =>`. Genau so heissen die Zeichner
	//       des Landschaften- und des Literatur-Editors (`zeichneWikiAbweichungen`,
	//       `aeWikiZeichneAbweichungen`) -- die Liste blieb leer, `continue` sprang beide Dateien
	//       ab, und der Test hat sie NIE geprueft, obwohl er sie zaehlte.
	//   (2) Es filterte nicht nach dem Rumpf. Als der Landschaften-Editor ein Fenster
	//       „Darstellung" mit `ecoDisplayZeichneTabelle` und vier Geschwistern bekam, fand die
	//       Suche ploetzlich fuenf Zeichner -- alle fuer eine ganz andere Sache -- und meldete eine
	//       fehlende Verdrahtung, die es nie gab.
	//
	// ⚠️ Und der Rumpf ALLEIN reicht auch nicht: im Literatur-Editor steht `avesmapsWikiFeldStand`
	// in `aeWikiStand()`, das nur RECHNET; gezeichnet wird eine Ebene darueber. Deshalb ein
	// Schritt ueber den Aufruf -- aber nur einer, sonst faengt die Kette die halbe Datei.
	const stellen = [];
	const decl = /(?:function\s+(\w+)\s*\(|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?(?:function\s*)?\()/g;
	let treffer = decl.exec(quelle);
	while (treffer !== null) {
		stellen.push({ name: treffer[1] || treffer[2], von: treffer.index });
		treffer = decl.exec(quelle);
	}
	const rumpf = (i) => quelle.slice(
		stellen[i].von,
		i + 1 < stellen.length ? stellen[i + 1].von : quelle.length
	);
	// Die Rechner: alles, was den Stand selbst ermittelt.
	const kern = stellen.map((s, i) => (rumpf(i).includes("avesmapsWikiFeldStand") ? s.name : null))
		.filter(Boolean);
	const zeichner = stellen
		.filter((s, i) => /[Zz]eichne/.test(s.name)
			&& (rumpf(i).includes("avesmapsWikiFeldStand") || kern.some((k) => rumpf(i).includes(k + "("))))
		.map((s) => s.name);
	// ⚠️ Keine Treffer heisst: diese Datei zeichnet den Override nicht ueber eine so benannte
	// Funktion -- dann kann der Test ueber ihre Verdrahtung nichts sagen und schweigt, statt zu raten.
	if (zeichner.length === 0) { continue; }
	// Ohne Regex-Bau aus Fremdtext: jede Stelle, an der ein input/change-Zuhoerer haengt, und die
	// naechsten 240 Zeichen dahinter -- der Zeichner soll darin vorkommen. Kurz genug, dass ein
	// zufaelliger Treffer eine andere Handlung betreffen muesste, lang genug fuer einen
	// mehrzeiligen Rumpf.
	const fenster = [];
	for (const auftakt of ['addEventListener("input"', 'addEventListener("change"']) {
		let von = quelle.indexOf(auftakt);
		while (von !== -1) {
			fenster.push(quelle.slice(von, von + 240));
			von = quelle.indexOf(auftakt, von + 1);
		}
	}
	const haengt = zeichner.some((name) => fenster.some((stueck) => stueck.includes(name)));
	assert.ok(haengt,
		datei + " rechnet die Abweichung nie neu, wenn im Formular getippt wird (" + zeichner.join(", ")
		+ " haengt an keinem input/change-Zuhoerer). Ein durchgestrichener Wiki-Stand bliebe stehen, "
		+ "nachdem der Editor den Wert von Hand angeglichen hat -- ein Rueckholangebot fuer etwas, das "
		+ "gar nicht mehr abweicht.");
	checks++;

	// 💣 UND ER MUSS AUCH BEIM AUFBAU LAUFEN, nicht nur beim Tippen. Im Wege-Editor stand der
	// Zeichner genau EINMAL im Code -- im `change`-Zuhoerer der Wegtyp-Auswahl. Ein frisch
	// geoeffneter Weg zeigte damit weder Durchstreichung noch ↺ noch braune Beschriftung, bis
	// jemand zufaellig die Auswahl anfasste. Der Test darueber war gruen: die Verdrahtung an den
	// Zuhoerer war ja da. Gefunden hat es die Konsistenzpruefung, nicht das Testfeld.
	// ⚠️ Geprueft wird, dass es MINDESTENS EINEN Aufruf ausserhalb aller Zuhoerer-Fenster gibt --
	// wo er steht (nach dem Mounten, nach dem Laden, in einem `setTimeout`), bleibt jeder
	// Oberflaeche selbst ueberlassen.
	const aufrufeAussen = zeichner.some((name) => {
		let von = quelle.indexOf(name + "()");
		while (von !== -1) {
			// 🪤 Die DEKLARATION ist kein Aufruf. Der erste Entwurf zaehlte sie mit -- damit war die
			// Zusicherung unerschuetterlich gruen, denn jede Funktion enthaelt ihren eigenen Namen
			// gefolgt von "()". Erst die Mutationsprobe hat es gezeigt.
			if (quelle.slice(Math.max(0, von - 9), von) === "function ") {
				von = quelle.indexOf(name + "()", von + 1);
				continue;
			}
			const drin = fenster.some((stueck) => {
				const start = quelle.indexOf(stueck);
				return start !== -1 && von >= start && von < start + stueck.length;
			});
			if (!drin) { return true; }
			von = quelle.indexOf(name + "()", von + 1);
		}
		return false;
	});
	assert.ok(aufrufeAussen,
		datei + " ruft seinen Zeichner AUSSCHLIESSLICH aus einem input/change-Zuhoerer ("
		+ zeichner.join(", ") + "). Ein frisch geoeffnetes Formular zeigt dann weder Durchstreichung "
		+ "noch ↺ noch braune Beschriftung, bis jemand zufaellig ein Feld anfasst -- und der Test "
		+ "darueber bleibt gruen, weil die Verdrahtung an den Zuhoerer ja da ist.");
	checks++;
}

console.log(`OK — jeder Zeichner des Wiki-Overrides bekommt seinen Helfer, und keine Zelle steckt `
	+ `im Uebersetzer (${checks} Zusicherungen; Aufrufer: ${aufrufer.join(", ")}).`);
