// Ein NEIN des Servers beim Zuweisen muss ZU SEHEN sein -- am Ort des Klicks.
//
// 💣 DER FALL (gemeldet 02.09.2026: „es wird angezeigt, aber ich kann es nicht anklicken").
// `trefferWaehlen` fing die Ablehnung von `zuweisen` zwar ab, setzte aber `ui.suchFehler = ""` --
// also das GEGENTEIL einer Meldung -- und zeichnete nicht neu. Der Klick kam an, der Aufruf lief,
// der Server sagte nein, und an der Liste ruehrte sich nichts. Von einem toten Klick war das nicht
// zu unterscheiden.
// ⚠️ Die Oberflaeche meldet den Grund zwar per Toast, aber der ist fluechtig und erscheint am
// anderen Ende des Bildes. Beides bleibt: der Toast ist die Nachricht, diese Zeile der Zustand.
//
// Aus der Wurzel des Repos:  node js/ui/__tests__/wiki-assign-zuweisen-fehler.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const wurzel = path.join(__dirname, "..", "..", "..");
let pruefungen = 0;
const pruefe = (b, was) => { assert.ok(b, was); pruefungen++; };

// 💣 Kommentare raus, bevor gemessen wird -- die Begruendung nennt genau die Zeichen, die der Test
// sucht. Ein Test, der seine eigene Dokumentation liest, ist gruen und wertlos.
const ohneKommentare = (text) => text
	.replace(/\/\*[\s\S]*?\*\//g, "")
	.split(/\r?\n/)
	.map((z) => z.replace(/(^|[^:])\/\/.*$/, "$1"))
	.join("\n");

const QUELLE = fs.readFileSync(path.join(wurzel, "js", "ui", "wiki-assign.js"), "utf8");
const CODE = ohneKommentare(QUELLE);

// Den Rumpf von trefferWaehlen herausschneiden -- bis zur naechsten Funktion.
const ab = CODE.indexOf("function trefferWaehlen(");
pruefe(ab > -1, "trefferWaehlen gefunden");
const bis = CODE.indexOf("\n\tfunction ", ab + 1);
const BLOCK = bis === -1 ? CODE.slice(ab) : CODE.slice(ab, bis);

// ---- A. Die Ablehnung wird gezeigt, nicht geloescht --------------------------------------------
pruefe(!/ui\.suchFehler\s*=\s*""/.test(BLOCK),
	"🔴 trefferWaehlen loescht die Meldung NICHT mehr (das war der ganze Fehler)");
pruefe(/ui\.suchFehler\s*=/.test(BLOCK), "es wird eine Meldung gesetzt");
pruefe(BLOCK.includes("fehler && fehler.message"),
	"und zwar die Meldung des Servers, nicht ein eigener Text");

// 🪤 UND DER FEHLER MUSS ALS PARAMETER GEBUNDEN SEIN -- genau daran ist die erste Fassung dieses
// Fixes gescheitert: der Ablehnungszweig hiess `}, () => {`, der Rumpf las `fehler`, und das warf
// einen ReferenceError. Ergebnis: eine unbehandelte Ablehnung und ein Bild, an dem sich NICHTS
// ruehrt -- also exakt der Fehler, der behoben werden sollte, nur eine Ebene tiefer. Gefunden hat
// das der Browser, nicht dieser Test; deshalb steht die Zusicherung jetzt hier.
pruefe(/\}\s*,\s*\(\s*fehler\s*\)\s*=>\s*\{/.test(BLOCK),
	"🔴 der Ablehnungszweig BINDET `fehler` als Parameter (sonst ReferenceError)");

// 🔴 GESETZT ALLEIN GENUEGT NICHT -- ohne Neuzeichnen sieht sie niemand. Genau daran ist die alte
// Fassung zusaetzlich gescheitert: sie zeichnete auch nicht neu.
pruefe(BLOCK.includes("zeichneTreffer()"), "und danach wird neu gezeichnet");

// ---- B. Die Dauer, weil sie zwei gleich aussehende Fehler trennt --------------------------------
// ⚠️ Vor jedem Wiki-Abruf des Servers sitzt eine Drossel von 20 s; `assign_to` holt die Seite LIVE.
// „nach 21 s" ist eine andere Geschichte als „nach 0,2 s".
pruefe(BLOCK.includes("Date.now() - begonnen"), "die Dauer wird gemessen");
pruefe(/const begonnen = Date\.now\(\);/.test(CODE.slice(ab, bis === -1 ? undefined : bis)),
	"und der Anfang steht VOR dem Aufruf, im selben Block");
pruefe(BLOCK.includes("AVESMAPS_WIKI_ASSIGN_LANGSAM_MS"),
	"genannt wird sie erst ab der Schwelle");

// ---- C. Die Schwelle selbst ---------------------------------------------------------------------
const schwelle = (QUELLE.match(/const AVESMAPS_WIKI_ASSIGN_LANGSAM_MS\s*=\s*(\d+);/) || [])[1];
pruefe(schwelle !== undefined, "die Schwelle ist definiert");
pruefe(Number(schwelle) > 0, "sie ist groesser als 0");
// 🔴 Sie muss UNTER der Drossel liegen (20 s) -- sonst nennt ausgerechnet der Drossel-Fall seine
// Dauer nicht, also genau der, fuer den die Zahl gebaut ist.
pruefe(Number(schwelle) < 20000, "sie liegt unter den 20 s der Drossel");
// ⚠️ Und nicht so klein, dass jede gewoehnliche Absage ein „nach 0 s" traegt.
pruefe(Number(schwelle) >= 1000, "aber ueber einer Sekunde");

// ---- C2. Eine laufende Suche darf die Meldung nicht wegwischen -----------------------------------
// 💣 IM BROWSER GEMESSEN: `zeichneTreffer` lief zweimal in DERSELBEN Millisekunde -- zuerst mit dem
// Grund, dann mit leerem `suchFehler` aus `trefferHolen.then`. Beide teilen sich EINE Hinweiszeile,
// und der Erfolgszweig der Suche leert sie bedingungslos. Ohne diesen Riegel stand die Meldung
// 0,1 ms lang da und war weg -- also genau so unsichtbar wie vorher.
// ⭐ Benutzt wird der Riegel, den es schon gibt: `laufendeSuche` laesst jede ueberholte Antwort
// aussteigen. Ein Klick auf einen Treffer beendet die Suche ohnehin.
pruefe(/laufendeSuche\+\+/.test(BLOCK),
	"🔴 trefferWaehlen entwertet eine noch laufende Suche (sonst wischt sie die Meldung weg)");

// ---- C3. Der Vorsatz nennt die richtige Sache ----------------------------------------------------
// ⚠️ Die Hinweiszeile traegt BEIDE Fehlschlaege. „Suche fehlgeschlagen" ueber einer abgelehnten
// Zuweisung schickt den Editor an die falsche Stelle -- er sucht den Fehler im Suchfeld, waehrend
// der Server das SCHREIBEN abgelehnt hat.
pruefe(BLOCK.includes('ui.fehlerArt = "zuweisen"'), "die Zuweisung meldet sich als Zuweisung");
pruefe(CODE.includes("AVESMAPS_WIKI_ASSIGN_TEXTE.zuweisenFehler"), "und es gibt einen eigenen Vorsatz dafuer");
pruefe(/zuweisenFehler:\s*"[^"]+"/.test(QUELLE), "der Vorsatz steht in der Texttabelle");
// 🔴 Und der Suchzweig setzt sie ZURUECK -- sonst traegt die naechste Suchmeldung „Zuweisen
// fehlgeschlagen", und die Verwechslung waere nur umgedreht.
const sAb = CODE.indexOf("function sucheAnstossen");
const sBis = CODE.indexOf("\n\tfunction ", sAb + 1);
pruefe(sAb > -1, "sucheAnstossen gefunden");
pruefe((sBis === -1 ? CODE.slice(sAb) : CODE.slice(sAb, sBis)).includes('ui.fehlerArt = "suche"'),
	"der Suchzweig setzt die Fehlerart zurueck");

// ---- D. Die Trefferliste bleibt stehen -----------------------------------------------------------
// ⚠️ Ein misslungenes Zuweisen sagt nichts ueber die TREFFER aus. Sie zu leeren naehme dem Editor
// den zweiten Versuch -- und die Suche ist serverseitig gedrosselt.
pruefe(!/ui\.treffer\s*=\s*\[\]/.test(BLOCK), "die Trefferliste wird NICHT geleert");

// ---- E. Die Gegenprobe: der Erfolgszweig ist unberuehrt -------------------------------------------
pruefe(BLOCK.includes('neuerZustand("zugewiesen")'), "der Erfolgszweig uebernimmt weiterhin");
pruefe(BLOCK.includes("daten.keinArtikel = false"), "und loescht weiterhin den Merker");

// ---- F. Der Hinweis wird ueberhaupt gezeichnet ----------------------------------------------------
// 🪤 `zeichneTreffer` muss den Hinweis wirklich anfassen -- sonst setzt der Zweig oben eine Meldung,
// die nirgends landet, und der Test waere gruen fuer nichts.
const zAb = CODE.indexOf("function zeichneTreffer()");
pruefe(zAb > -1, "zeichneTreffer gefunden");
const zBis = CODE.indexOf("\n\tfunction ", zAb + 1);
const ZEICHNE = zBis === -1 ? CODE.slice(zAb) : CODE.slice(zAb, zBis);
pruefe(ZEICHNE.includes("data-wa-hinweis"), "zeichneTreffer aktualisiert die Hinweiszeile");
pruefe(/hinweis\.textContent\s*=/.test(ZEICHNE), "und schreibt ihren Text");
// Und das Modell fuellt den Hinweis aus suchFehler.
pruefe(/modell\.hinweis\s*=[\s\S]{0,200}suchFehler/.test(CODE),
	"das Modell speist den Hinweis aus suchFehler");

console.log(`wiki-assign-zuweisen-fehler.test.js: ${pruefungen} Pruefungen erfuellt`);
