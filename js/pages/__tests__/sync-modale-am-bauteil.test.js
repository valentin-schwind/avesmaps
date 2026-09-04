"use strict";

/*
 * Die sechs Fenster der zwei Sync-Seiten haengen am Fenster-Bauteil (A21-A26 des Bauplans
 * docs/superpowers/plans/2026-09-04-fenster-vereinheitlichung.md).
 *
 * 💣 WARUM ES DIESEN TEST GIBT. Die sechs waren am 04.09.2026 die letzten Fenster im Haus, die ihre
 *    Kopfzeile selbst bauten -- ein Text-DIV ohne Knopf (`.modal-title`), eine Fussleiste als
 *    eigene Rezeptur (`.modal-actions`), und ein Rumpf, der gar keiner war: die Huelle trug das
 *    Polster, ein innerer Kasten (.zb 70vh, .ident-table 60vh, #geomList 50vh, #bindung-sammel-liste
 *    340px) scrollte fuer sich. Zwei davon wichen in fuenf Werten voneinander ab, obwohl derselbe
 *    Bauer sie schrieb. Der Stapelumbau vom 04.09. hat sie bewusst ausgelassen, weil `.modal-title`
 *    keinen Knopf hatte, den man haette umklassen koennen -- ein Skript haette ein <span> in einen
 *    Text-DIV geschoben. Deshalb hier je Fenster eine Zusicherung, nicht ein Muster ueber alle.
 *
 * ⚠️ Geprueft wird die VERDRAHTUNG (Markup + Skript + welche Regel bleibt), nicht das gerechnete
 *    Bild -- die Masse stehen im Kommentar am Ende und wurden im Browser nachgemessen.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const WURZEL = path.join(__dirname, "..", "..", "..");
const lies = (...teile) => fs.readFileSync(path.join(WURZEL, ...teile), "utf8").replace(/\r\n/g, "\n");
const ohneKommentare = (txt) => txt.replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

let zusicherungen = 0;
function wahr(bedingung, text) {
	assert.ok(bedingung, text);
	zusicherungen++;
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const SEITEN = [
	{
		datei: "html/wiki-sync-monitor.html",
		fenster: [
			{ overlay: "wappenDialog", titel: "wappenTitel", x: "wappenClose" },
			{ overlay: "bindung-sammel-modal", titel: "bindung-sammel-titel", x: "bindung-sammel-schliessen" },
			{ overlay: "geomModal", titel: "geomTitel", x: "geomCloseX", massenhandlung: "geomPurgeAll" },
		],
		// Innere Kaesten, die frueher fuer sich scrollten -- jetzt scrollt der Rumpf.
		innenKaesten: [".ident-table {"],
	},
	{
		datei: "html/wiki-sync-settlement-editor.html",
		fenster: [
			{ overlay: "seWappenDialog", titel: "seWappenTitel", x: "seWappenClose" },
			{ overlay: "seAssignDialog", titel: "seAssignTitel", x: "seAssignCloseX" },
			// Die Fussleiste wird von renderZoomBandsActions gefuellt -- die Hauptgruppe steht im Skript.
			{ overlay: "seZoomBandsDialog", titel: "seZoomBandsTitle", x: "seZoomBandsCloseX",
				fussImSkript: "renderZoomBandsActions", massenhandlung: "seZoomBandsResetAll" },
		],
		innenKaesten: [".zb {"],
	},
];

for (const seite of SEITEN) {
	const roh = lies(...seite.datei.split("/"));
	const txt = ohneKommentare(roh);
	const name = seite.datei.split("/").pop();

	// --- Das Bauteil erreicht die Seite, und der Schleier-Schliesser kommt VOR seinem ersten Aufruf --
	wahr(/<link rel="stylesheet" href="\/css\/components\/editor-page\.css">/.test(txt),
		name + ": laedt editor-page.css nicht -- nur darueber kommt css/components/fenster.css an");
	const schliesserTag = txt.indexOf('<script src="/js/ui/dialog-hintergrund-schliessen.js"></script>');
	const ersterAufruf = txt.indexOf("avesmapsDialogHintergrundSchliessenById(");
	wahr(schliesserTag > 0, name + ": das Hintergrundklick-Bauteil wird nicht geladen");
	wahr(ersterAufruf > schliesserTag,
		name + ": avesmapsDialogHintergrundSchliessenById wird gerufen, BEVOR das Bauteil geladen ist "
		+ "-- ReferenceError, und das Inline-Skript bricht mitten drin ab (die changelog-dialog-Falle)");

	// --- Die Huelle traegt nur noch das MASS; Huelle, Kopf und Fuss kommen aus fenster.css ----------
	const modalBox = txt.match(/^\s*\.modal-box \{([^}]*)\}/m);
	wahr(modalBox, name + ": `.modal-box {` fehlt");
	wahr(/max-height:\s*\d+vh/.test(modalBox[1]),
		name + ": `.modal-box` hat kein max-height -- ohne Deckel an der HUELLE scrollt nie der Rumpf");
	for (const fremd of ["background", "border", "padding", "box-shadow", "border-radius"]) {
		wahr(!new RegExp("\\b" + fremd + "\\s*:").test(modalBox[1]),
			name + ": `.modal-box` traegt wieder `" + fremd + "` -- das ist Sache des Bauteils "
			+ "(css/components/fenster.css), eine zweite Fassung laeuft auseinander");
	}
	for (const kasten of seite.innenKaesten) {
		const regel = txt.slice(txt.indexOf(kasten), txt.indexOf("}", txt.indexOf(kasten)));
		wahr(regel.length > 0 && !/max-height|overflow/.test(regel),
			name + ": `" + kasten + "` scrollt wieder fuer sich (max-height/overflow) -- zwei "
			+ "Bildlaufleisten uebereinander, und der Fensterkopf wandert beim Scrollen doch");
	}

	for (const f of seite.fenster) {
		const von = roh.indexOf('<div id="' + f.overlay + '" class="modal" hidden>');
		wahr(von > 0, name + ": Overlay #" + f.overlay + " fehlt");
		const bis = roh.indexOf("\n</div>\n", von);
		wahr(bis > von, name + ": das Overlay #" + f.overlay + " schliesst nicht auf Spalte 0 -- der Schnitt misst die halbe Seite");
		const block = ohneKommentare(roh.slice(von, bis + 7));
		const wo = name + " #" + f.overlay + ": ";

		// 1) Huelle: Werkzeugfenster, mit Rolle und Titelbezug.
		wahr(new RegExp('<div class="modal-box[^"]* avm-fenster avm-fenster--werkzeug" role="dialog" aria-modal="true" aria-labelledby="' + esc(f.titel) + '">').test(block),
			wo + "die Huelle traegt nicht `.avm-fenster .avm-fenster--werkzeug` + role=\"dialog\" + aria-labelledby auf ihren Titel");
		wahr(!/avm-fenster--blatt/.test(block), wo + "Blatt-Fassung -- diese Fenster sind Werkzeugfenster (Bauplan A21-A26)");
		wahr(!/style="[^"]*(width|max-height|overflow)/.test(block),
			wo + "ein Inline-style setzt Breite oder Scrollen -- das gehoert in eine Klasse (.modal-box--geom) bzw. an die Huelle");

		// 2) Kopfzeile: Griff, <h2>-Titel, gefasster ✕ -- genau EINE.
		wahr((block.match(/class="avm-fenster__kopf"/g) || []).length === 1, wo + "nicht genau EINE Kopfzeile");
		wahr(/class="avm-fenster__griff" aria-hidden="true">⁝⁝</.test(block), wo + "der Griff fehlt");
		wahr(new RegExp('<h2 class="avm-fenster__titel" id="' + esc(f.titel) + '">').test(block),
			wo + "der Titel ist kein <h2 class=\"avm-fenster__titel\"> -- dann greift der Browser-Standard (20px, margin)");
		wahr(new RegExp('<button type="button" class="avm-fenster__knopf avm-fenster__knopf--gefasst" id="' + esc(f.x) + '" aria-label="Schließen">✕</button>').test(block),
			wo + "der ✕ fehlt oder ist nicht der gefasste 32x32 des Bauteils");
		wahr(!/modal-title|modal-actions/.test(block), wo + "`.modal-title`/`.modal-actions` stehen noch im Markup -- die alte Bauform lebt weiter");

		// 3) Rumpf und Fuss, in dieser Reihenfolge.
		const kopf = block.indexOf('class="avm-fenster__kopf"');
		const rumpf = block.indexOf('class="avm-fenster__rumpf"');
		const fuss = block.indexOf('class="avm-fenster__fuss"');
		wahr((block.match(/class="avm-fenster__rumpf"/g) || []).length === 1, wo + "nicht genau EIN Rumpf");
		wahr((block.match(/class="avm-fenster__fuss"/g) || []).length === 1, wo + "nicht genau EINE Fussleiste");
		wahr(kopf < rumpf && rumpf < fuss, wo + "Kopf, Rumpf und Fuss stehen nicht in dieser Reihenfolge");

		// 4) Die Hauptgruppe steht rechts -- im Markup oder, wo das Skript die Leiste fuellt, dort.
		if (f.fussImSkript) {
			const fn = txt.match(new RegExp("function " + f.fussImSkript + "\\(\\)[\\s\\S]*?\\n\\}\\n"));
			wahr(fn, wo + f.fussImSkript + " nicht gefunden");
			// ⚠️ MIT `class="` gezaehlt: der Kommentar ueber der Zeile nennt die Klasse auch.
			wahr((fn[0].match(/class="avm-fenster__fuss-haupt"/g) || []).length === 2,
				wo + f.fussImSkript + " baut nicht in BEIDEN Zweigen eine .avm-fenster__fuss-haupt -- ohne sie stehen die Knoepfe links");
			if (f.massenhandlung) {
				wahr(fn[0].indexOf(f.massenhandlung) < fn[0].indexOf('class="avm-fenster__fuss-haupt"'),
					wo + "die Massenhandlung " + f.massenhandlung + " steht nicht LINKS vor der Hauptgruppe");
			}
		} else {
			wahr(/class="avm-fenster__fuss-haupt"/.test(block), wo + "die Knopfgruppe traegt `.avm-fenster__fuss-haupt` nicht -- ohne sie steht sie nicht rechts");
			if (f.massenhandlung) {
				wahr(block.indexOf('id="' + f.massenhandlung + '"') < block.indexOf('class="avm-fenster__fuss-haupt"'),
					wo + "die Massenhandlung " + f.massenhandlung + " steht nicht LINKS vor der Hauptgruppe (docs/design-language.md §Fenster)");
			}
		}

		// 5) Verdrahtung im Skript: ✕ und Schleier schliessen -- ueber das Bauteil, nicht die Abschrift.
		const skript = txt.slice(txt.indexOf("<script>", txt.indexOf("</style>")));
		wahr(new RegExp("\\$\\(['\"]" + esc(f.x) + "['\"]\\)").test(skript), wo + "der ✕ #" + f.x + " ist im Skript nicht verdrahtet -- ein Knopf, der sichtbar nichts tut");
		wahr(new RegExp("avesmapsDialogHintergrundSchliessenById\\(['\"]" + esc(f.overlay) + "['\"]").test(skript),
			wo + "der Schleier-Klick laeuft nicht ueber avesmapsDialogHintergrundSchliessenById");
		wahr(!new RegExp("event\\.target\\.id\\s*===\\s*['\"]" + esc(f.overlay) + "['\"]").test(skript),
			wo + "die alte Abschrift `event.target.id === overlay` steht noch da -- sie schliesst beim Ziehen einer Textmarkierung ueber den Rand");
	}
}

console.log("OK -- sechs Sync-Fenster am Bauteil, " + zusicherungen + " Zusicherungen");

/*
 * Im Browser nachgemessen (05.09.2026, lokal, beide Seiten, Fenster per hidden=false geoeffnet):
 * Huelle Radius 5px, Rand --color-border-strong, padding 0 · Kopfzeile 45px bei 6/14, Griff 16px,
 * Titel 16px/700, ✕ 32x32 gefasst · Rumpf scrollt, Kopf und Fuss stehen · Fussleiste 45px,
 * Hauptgruppe rechts, Massenhandlung links.
 */
