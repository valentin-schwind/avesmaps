const assert = require("assert");
const fs = require("fs");
const path = require("path");

// Das Zoomband je Namensart im Fenster „Darstellung" (Entwurf §5.3 und §5.4).
//
// 💣 EIN Klick, ZWEI Enden. Bei den Siedlungen setzt ein Klick die eine Erscheinungsstufe, und die
// Kurve laeuft von dort bis ans Ende. Eine Landschaftsbeschriftung hat min_zoom UND max_zoom, und
// das aus gutem Grund: ein Kontinentname soll beim Hineinzoomen VERSCHWINDEN. Wer das Siedlungs-
// modell eins zu eins uebernimmt, verliert das obere Ende und damit die halbe Aussage.
//
// 🔴 „aus" ist als `bis < ab` kodiert, nicht als eigener Schalter -- ein dritter Zustand neben den
// zwei Enden waere eine dritte Wahrheit ueber dieselbe Sache.
//
// 🪤 Geschnitten und AUSGEFUEHRT, nicht gelesen: eine im Test nachgebaute Regel bliebe gruen, egal
// was das Fenster tut.
//
// Aus der Wurzel des Repos:  node js/pages/__tests__/darstellung-band.test.js

const wurzel = path.join(__dirname, "..", "..", "..");
const editor = fs.readFileSync(path.join(wurzel, "html/landschaften-editor.html"), "utf8");

const von = editor.indexOf("function ecoDisplayBandNeu(");
assert.ok(von >= 0, "ecoDisplayBandNeu steht im Fenster");
const bis = editor.indexOf("\n}", von);
const ecoDisplayBandNeu = new Function(editor.slice(von, bis + 2) + "; return ecoDisplayBandNeu;")();

// ---- A. Das naehere Ende wandert ----------------------------------------------------------------
assert.deepStrictEqual(ecoDisplayBandNeu({ ab: 0, bis: 7 }, 5), { ab: 0, bis: 5 }, "z5: bis ist naeher (2 < 5)");
assert.deepStrictEqual(ecoDisplayBandNeu({ ab: 0, bis: 5 }, 2), { ab: 2, bis: 5 }, "z2: ab ist naeher (2 < 3)");
assert.deepStrictEqual(ecoDisplayBandNeu({ ab: 2, bis: 5 }, 0), { ab: 0, bis: 5 }, "links davon zieht ab");
assert.deepStrictEqual(ecoDisplayBandNeu({ ab: 2, bis: 5 }, 7), { ab: 2, bis: 7 }, "rechts davon zieht bis");

// ⚠️ Gleichstand: „ab" gewinnt. Eine Regel muss auch in der Mitte entscheiden, sonst haengt das
// Ergebnis an Rundung -- und dann bewegt sich derselbe Klick mal so, mal so.
assert.deepStrictEqual(ecoDisplayBandNeu({ ab: 2, bis: 6 }, 4), { ab: 4, bis: 6 }, "Gleichstand: ab gewinnt");

// ---- B. Aus dem „aus"-Zustand heraus -------------------------------------------------------------
// 🔴 Ein Klick auf eine Stufe holt die Art zurueck -- als EINZELNE Stufe, nicht als ganzes Band.
// Ein „zurueck auf z0-z7" waere geraten: niemand hat gesagt, dass die Art ueberall stehen soll.
assert.deepStrictEqual(ecoDisplayBandNeu({ ab: 0, bis: -1 }, 4), { ab: 4, bis: 4 }, "aus dem Aus: eine Stufe");
assert.deepStrictEqual(ecoDisplayBandNeu({ ab: 3, bis: 1 }, 0), { ab: 0, bis: 0 },
	"jedes bis < ab gilt als aus, nicht nur das kanonische 0/-1");

// ---- C. Die Enden bleiben in der Ordnung --------------------------------------------------------
// 💣 Kein Klick darf ein Band erzeugen, das selbst „aus" bedeutet -- sonst schaltet ein Klick auf
// eine Stufe die Art versehentlich ab, und der Benutzer haelt es fuer einen Fehler.
for (let ab = 0; ab <= 7; ab += 1) {
	for (let b = ab; b <= 7; b += 1) {
		for (let z = 0; z <= 7; z += 1) {
			const neu = ecoDisplayBandNeu({ ab: ab, bis: b }, z);
			assert.ok(neu.bis >= neu.ab,
				"Klick z" + z + " auf z" + ab + "-z" + b + " ergibt " + neu.ab + "/" + neu.bis);
			assert.ok(neu.ab === z || neu.bis === z,
				"die angeklickte Stufe ist danach ein Ende (z" + z + " auf z" + ab + "-z" + b + ")");
		}
	}
}

// ---- D. Der Median ist ein eigenes Verb ----------------------------------------------------------
// 🔴 Zwei Verben, zwei Knoepfe: Messen schreibt nichts, Uebernehmen setzt die Vorgabe.
assert.ok(/Median ermitteln/.test(editor), "der Messknopf steht da");
assert.ok(/übernehmen/.test(editor), "und der Uebernahmeknopf getrennt daneben");
const vonM = editor.indexOf("function ecoDisplayMedianMessen");
assert.ok(vonM >= 0, "das Messen hat eine eigene Funktion");
const rumpfM = editor.slice(vonM, editor.indexOf("\n}", vonM));
assert.ok(!/action:\s*"save"/.test(rumpfM), "das Messen schickt kein save");
assert.ok(/action:\s*"median"/.test(rumpfM), "es fragt die Messung");

// ---- E. 🔴 DER MEDIAN ERREICHT DIE EDITOREN NIE -------------------------------------------------
// Owner 24.08.2026: „wir ermitteln den median, der wert, den die editoren sehen ist der wert aus der
// zoombandeinstellung". Eine Median-Marke im Beschriftungsdialog hiesse „richte dich nach dem
// Durchschnitt" -- das Gegenteil einer Vorgabe: sie zementierte den Bestand, statt ihn zu lenken.
// 🪤 Im Prototyp stand eine solche graue Marke kurzzeitig und ist am selben Tag gefallen.
const dialogSeite = fs.readFileSync(path.join(wurzel, "index.html"), "utf8");
assert.ok(!/median/i.test(dialogSeite.slice(
	dialogSeite.indexOf('id="label-edit-form"'),
	dialogSeite.indexOf('id="label-edit-form"') + 6000
)), "im Beschriftungsdialog steht kein Median");
const marken = fs.readFileSync(path.join(wurzel, "js/review/review-labels.js"), "utf8");
assert.ok(!/median/i.test(marken), "und der Dialogcode kennt ihn auch nicht");

// ---- F. 💣 Die leere Zelle ------------------------------------------------------------------------
// Eine Zeile OHNE „uebernehmen" braucht trotzdem ihre Zelle: `table-layout: fixed` schiebt sonst
// alles rechts davon um eine Spalte nach links -- genau die Ausrichtung, wegen der die Tabelle
// ueberhaupt eine Tabelle ist und kein Grid je Zeile.
assert.ok(/LEERE ZELLE/.test(editor), "der Grund steht an der Stelle");
assert.ok(/table-layout:\s*fixed/.test(
	fs.readFileSync(path.join(wurzel, "css/pages/landschaften-editor.css"), "utf8")
), "die Bandtabelle liegt auf festen Breiten");

console.log("darstellung-band: alle Zusicherungen gruen");
