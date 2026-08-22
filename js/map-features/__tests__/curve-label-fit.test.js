// Die Passung eines Namens auf seine Kurve. 🔴 Jede Zusicherung hier RUFT die Funktion und prueft
// ihr Ergebnis -- und keine darf bei kaputter Rechnung gruen bleiben.
//
// 💣 Der Vorrat aus dem Bauplan tat genau das: von fuenfzehn Mutationen des Moduls ueberlebten ELF.
// Die Faelle „senkrecht", „winzig", „engesV" und „wackel" sind DESHALB dazugekommen -- ohne sie
// waeren die Senkrecht-Regel, die 8-px-Untergrenze, das Mitskalieren der Breiten, die Beruhigung
// und die Suche nach dem ruhigsten Stueck von keiner Zeile gedeckt. Danach ueberleben noch VIER,
// und keine davon ist eine Testluecke: sie treffen Zweige, die in diesem Bau gar nicht erreichbar
// sind (Deckel je Luecke, Nachpruefung, doppelte Wachen, Reichweite der Fenstersuche) -- an jeder
// steht der Grund am Code. Wer hier etwas ergaenzt, macht dieselbe Probe: die Funktion an der
// geprueften Stelle kaputtmachen und sehen, ob es rot wird.
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/curve-label-fit.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const hier = (n) => path.join(__dirname, "..", n);
vm.runInThisContext(fs.readFileSync(hier("curved-label-layout.js"), "utf8"));
vm.runInThisContext(fs.readFileSync(hier("curve-label-fit.js"), "utf8"));

// Groesste Abweichung eines Stuecks von der Sehne des Ganzen, in Grad -- das Mass der Beruhigung.
function groessteAbweichung(pts) {
	const sehne = Math.atan2(pts[pts.length - 1].y - pts[0].y, pts[pts.length - 1].x - pts[0].x);
	let schlimmster = 0;
	for (let i = 1; i < pts.length; i += 1) {
		const w = Math.atan2(pts[i].y - pts[i - 1].y, pts[i].x - pts[i - 1].x);
		let d = Math.abs((w - sehne) * 180 / Math.PI) % 360;
		if (d > 180) { d = 360 - d; }
		if (d > schlimmster) { schlimmster = d; }
	}
	return schlimmster;
}

const bogen = (pts) => cumulativeLengths(pts)[pts.length - 1];
const textbreite = (f) => f.widths.reduce((a, b) => a + b, 0) + f.ls * (f.chars.length - 1);

// Eine waagerechte Kurve, 1000 px lang.
const lang = [{x: 0, y: 100}, {x: 1000, y: 100}];
const name = "DRACHENSTEINE";
const zeichen = name.split("");
const breiten = zeichen.map(() => 10);   // 10 px je Zeichen -> 130 px roh

// --- Ein Name ---------------------------------------------------------------------------------
const eins = avesmapsCurveLabelFit(lang, zeichen, breiten, 12, 1);
assert.ok(eins && eins.fenster.length === 1, "ein Name, ein Fenster");
// 🔴 Die Sperrung zieht den Namen ueber die Flaeche (Entwurf §5.2).
assert.ok(eins.fenster[0].ls > 0, "gesperrt wird");
// ⚠️ Auf 1000 px braucht ein Name von 130 px kein Gegenmittel. Meldet die Passung hier schon etwas,
// ist die Meldung „verlaengert" kein Befund mehr, sondern Grundrauschen (Entwurf §4.4).
assert.deepStrictEqual(eins.hinweise, [], "kein Gegenmittel, wo reichlich Platz ist");

// 💣 Zwei Deckel, und der zweite ist der, den man am Schirm sieht: hoechstens 50 % UND hoechstens
// 0,6 Schriftgroessen Zusatz je Luecke. Bei Zoom 7 ist die Drachenstein-Kurve 11 246 px lang und
// der Name 197 px -- 20 % davon waeren Buchstaben mit 50 px Abstand, die als Wort nicht mehr
// lesbar sind. Der Anteil allein genuegt also nicht.
const riesig = [{x: 0, y: 0}, {x: 11246, y: 0}];
const gross = avesmapsCurveLabelFit(riesig, zeichen, breiten, 12, 1);
assert.ok(gross.fenster[0].ls <= 0.6 * 12 + 1e-9,
  "der Zusatz je Luecke ist auf 0,6 Schriftgroessen gedeckelt -- nicht nur der Anteil");
// 🪤 Die Zeile darueber kann in DIESEM Bau nie ausloesen (Bericht Aufgabe 4): das Fenster wird nach
// dem NAMEN bemessen, nicht nach der Kurve, und damit bleibt der Zusatz je Luecke immer weit unter
// dem Deckel. Sie steht als Obergrenze -- was die 11 246 px wirklich baendigt, ist die naechste:
const grossBogen = bogen(gross.fenster[0].pts);
assert.ok(grossBogen <= 130 * 1.5,
  "das Fenster ist so gross wie der NAME, nicht wie die Kurve -- gemessen " + grossBogen.toFixed(1) + " px");
// Und die Sperrung nimmt nur ihren Anteil am freien Rest, nicht den Rest selbst.
assert.ok(gross.fenster[0].ls * 12 <= 0.2 * (grossBogen - 130) + 1e-6,
  "gesperrt wird der ANTEIL des freien Restes, nicht der freie Rest");

// --- Mehrere Namen ---------------------------------------------------------------------------
const drei = avesmapsCurveLabelFit(lang, zeichen, breiten, 12, 3);
assert.strictEqual(drei.fenster.length, 3, "drei Namen, drei Fenster");
const mitten = drei.fenster.map((f) => f.pts[Math.floor(f.pts.length / 2)].x);
assert.ok(mitten[0] < mitten[1] && mitten[1] < mitten[2], "der Reihe nach");

// 🔴 Ein HOECHSTwert, kein Sollwert (Entwurf §4.2): passen drei nicht, kommen weniger -- aber die
// verbleibenden verteilen sich NEU ueber die ganze Kurve, statt auf ihrem Drittel sitzen zu bleiben.
const kurz = [{x: 0, y: 0}, {x: 300, y: 0}];
const gedraengt = avesmapsCurveLabelFit(kurz, zeichen, breiten, 12, 3);
assert.ok(gedraengt.fenster.length < 3, "auf 300 px passen keine drei Namen von 130 px");
assert.ok(gedraengt.fenster.length >= 1, "einer geht");
const eineMitte = gedraengt.fenster[0].pts[Math.floor(gedraengt.fenster[0].pts.length / 2)].x;
assert.ok(Math.abs(eineMitte - 150) < 40, "neu verteilt, nicht auf dem alten Drittel stehengeblieben");

// --- Passung: nie ein abgeschnittener Buchstabe (Entwurf §4.4) --------------------------------
const knapp = [{x: 0, y: 0}, {x: 120, y: 0}];
const gepasst = avesmapsCurveLabelFit(knapp, zeichen, breiten, 12, 1);
assert.ok(gepasst && gepasst.fenster.length === 1, "auch knapp kommt ein Fenster heraus");
const f = gepasst.fenster[0];
const gebraucht = f.widths.reduce((a, b) => a + b, 0) + f.ls * (f.chars.length - 1);
const vorhanden = cumulativeLengths(f.pts)[f.pts.length - 1];
assert.ok(gebraucht <= vorhanden + 1e-6,
  "der Text passt in sein Fenster -- sonst faellt live der erste Buchstabe weg ('CHWARZE SICHE')");
assert.ok(f.fontSize >= 8, "verkleinert wird hoechstens bis 8 px");
// Mittel 1 zuerst: 120 px reichen nicht fuer 130 px Text, also wird die Kurve tangential ueber ihre
// eigenen Enden hinaus verlaengert -- die Schrift bleibt dabei unangetastet.
assert.ok(vorhanden > 120, "die Kurve wurde verlaengert, gemessen " + vorhanden.toFixed(1) + " px");
assert.strictEqual(f.fontSize, 12, "und dafuer musste noch nichts verkleinert werden");
assert.deepStrictEqual(gepasst.hinweise, ["verlaengert"], "genau das steht im Befund");

// 🔴 Und wenn das Verlaengern an seinen Deckel stoesst: verkleinern bis 8 px, und reicht auch das
// nicht, DOCH weiter verlaengern. Abgeschnitten wird nie (Entwurf §4.4, Mittel 1-3).
const winzig = [{x: 0, y: 0}, {x: 60, y: 0}];
const gezwungen = avesmapsCurveLabelFit(winzig, zeichen, breiten, 12, 1);
assert.ok(gezwungen && gezwungen.fenster.length === 1, "auch 60 px tragen einen Namen von 130 px");
const z = gezwungen.fenster[0];
assert.strictEqual(z.fontSize, AVESMAPS_CURVE_LABEL_DEFAULTS.minFontPx,
  "verkleinert wird bis genau 8 px und keinen Punkt darunter");
// ⚠️ Die Breiten sind bei 12 px gemessen und skalieren linear mit -- ohne das rechnet die Passung
// mit den Massen einer Schrift, die gar nicht gezeichnet wird.
assert.ok(Math.abs(z.widths[0] - (breiten[0] * z.fontSize) / 12) < 1e-9,
  "die Zeichenbreiten skalieren mit der verkleinerten Schrift");
const zBogen = bogen(z.pts);
assert.ok(zBogen > 60 * (1 + AVESMAPS_CURVE_LABEL_DEFAULTS.extendMaxPct / 100),
  "und weil auch 8 px nicht reichen, geht es ueber den Verlaengerungs-Deckel hinaus: " + zBogen.toFixed(1));
assert.ok(textbreite(z) <= zBogen + 1e-6, "auch hier faellt kein Buchstabe weg");
assert.deepStrictEqual(gezwungen.hinweise.slice().sort(), ["verkleinert", "verlaengert"],
  "beide Gegenmittel stehen im Befund");

// --- Leserichtung (Entwurf §4.1) --------------------------------------------------------------
// 💣 Die Probe gehoert HIER und nicht erst ans Zeichnen: wer sie erst beim Malen macht, hat die
// Fenster schon verteilt und muss sie alle noch einmal drehen.
const nachLinks = [{x: 1000, y: 100}, {x: 0, y: 100}];
const gedreht = avesmapsCurveLabelFit(nachLinks, zeichen, breiten, 12, 1);
const g = gedreht.fenster[0];
assert.ok(g.pts[0].x < g.pts[g.pts.length - 1].x, "das ausgegebene Fenster laeuft IMMER nach rechts");

// 🔴 Der senkrechte Fall -- die Koschberge (Entwurf §4.1: dx = 0, liest aufwaerts). Hier sagt „weiter
// links" nichts, und es gilt die kartografische Gewohnheit „von unten nach oben". y waechst am
// Schirm nach unten, der erste Punkt liegt also TIEFER.
const senkrechtAbwaerts = [{x: 200, y: 0}, {x: 200, y: 400}];
const aufwaerts = avesmapsCurveLabelFit(senkrechtAbwaerts, zeichen, breiten, 12, 1);
const ap = aufwaerts.fenster[0].pts;
assert.ok(Math.abs(ap[0].x - ap[ap.length - 1].x) < 1e-6, "die Probe ist wirklich senkrecht");
assert.ok(ap[0].y > ap[ap.length - 1].y, "senkrecht wird von unten nach oben gelesen");

// --- Beruhigung (Entwurf §5.1) ------------------------------------------------------------------
// Ein scharfer Knick darf den Namen nicht verdrehen: nach der Beruhigung weicht kein Stueck des
// Fensters mehr als maxTurnDeg von seiner Sehne ab. 💣 Ohne diese Zusicherung steht die Regel zwar
// im Plan, aber nichts haelt sie fest -- und sie ist der Grund, warum der Name an der Spitze der
// Sichel verdreht begann.
const scharferKnick = [{x: 0, y: 0}, {x: 200, y: 0}, {x: 200, y: 200}, {x: 400, y: 200}];
const beruhigt = avesmapsCurveLabelFit(scharferKnick, zeichen, breiten, 12, 1);
assert.ok(beruhigt, "auch ein Knick traegt einen Namen");
const schlimmster = groessteAbweichung(beruhigt.fenster[0].pts);
assert.ok(schlimmster <= AVESMAPS_CURVE_LABEL_DEFAULTS.maxTurnDeg + 1e-6,
  "kein Stueck weicht mehr als 30° von der Sehne ab, gemessen " + schlimmster.toFixed(1) + "°");
// 🪤 Der Fall darueber loest die Beruhigung gar nicht aus: zwischen den Knicken liegen 200 px, und
// die Fenstersuche findet dort ein voellig gerades Stueck (gemessen 0,0°). Erst ein Knick, dem das
// Fenster nicht ausweichen KANN, prueft die Beruhigung -- ein V aus zwei Armen von je 100 px, kuerzer
// als der Name selbst.
const engesV = [{x: 0, y: 0}, {x: 100, y: 0}, {x: 100, y: 100}];
const geglaettet = avesmapsCurveLabelFit(engesV, zeichen, breiten, 12, 1);
assert.ok(geglaettet, "auch ein V von 200 px traegt seinen Namen");
const vAbweichung = groessteAbweichung(geglaettet.fenster[0].pts);
assert.ok(vAbweichung > 1e-6, "das V ist nach der Beruhigung noch gebogen, keine Gerade");
assert.ok(vAbweichung <= AVESMAPS_CURVE_LABEL_DEFAULTS.maxTurnDeg + 1e-6,
  "aber kein Stueck weicht mehr als 30° ab -- ungebremst waeren es 45°, gemessen " + vAbweichung.toFixed(1) + "°");

// --- Das ruhigste Stueck (Entwurf §5.1) -----------------------------------------------------------
// 💣 Ein Label darf nicht dort sitzen, wo die Kurve am staerksten dreht. Hier liegt der Knick GENAU
// auf der geometrischen Mitte; wer das Fenster stur mittig ausschneidet, legt den Namen darauf.
const wackel = [{x: 0, y: 0}, {x: 430, y: 0}, {x: 450, y: 20}, {x: 470, y: 0}, {x: 900, y: 0}];
const ruhig = avesmapsCurveLabelFit(wackel, zeichen, breiten, 12, 1);
assert.ok(ruhig, "die Wackelkurve traegt ihren Namen");
const rp = ruhig.fenster[0].pts;
assert.ok(groessteAbweichung(rp) < 0.5,
  "das Fenster liegt auf einem geraden Arm, gemessen " + groessteAbweichung(rp).toFixed(2) + "°");
assert.ok(rp[0].x >= 470 || rp[rp.length - 1].x <= 430,
  "und es hat den Knick in der Mitte wirklich verlassen (" + rp[0].x.toFixed(0) + ".." + rp[rp.length - 1].x.toFixed(0) + ")");

// --- Nichts geht ---------------------------------------------------------------------------------
assert.strictEqual(avesmapsCurveLabelFit([{x: 0, y: 0}], zeichen, breiten, 12, 1), null,
  "ein einzelner Punkt ist keine Kurve");
assert.strictEqual(avesmapsCurveLabelFit(lang, [], [], 12, 1), null, "ohne Text kein Fenster");
assert.strictEqual(avesmapsCurveLabelFit(lang, zeichen, breiten.slice(1), 12, 1), null,
  "so viele Breiten wie Zeichen, sonst rechnet die Passung mit einem anderen Wort");
assert.strictEqual(avesmapsCurveLabelFit(lang, zeichen, breiten, 0, 1), null, "ohne Schriftgroesse kein Fenster");

console.log("curve-label-fit: alle Zusicherungen erfuellt");
