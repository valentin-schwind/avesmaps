// Der Startlauf hat eine MITTE: ein Schleier ueber der Karte, eine stehende Windrose darin,
// der Satz „Karte wird geladen …" darunter -- und die rechte Kante faehrt herein wie der
// Planer gegenueber.
// Entwurf: docs/superpowers/specs/2026-08-19-startladen-schleier-und-windrose-design.md
//
// Geprueft wird, was hier lautlos kippt: dass der Schleier Klicks DURCHLAESST (Owner-Entscheid),
// dass er UNTER dem schmalen Streifen oben liegt, dass jede Farbe aus einem Token kommt und in
// BEIDEN Themen steht -- und dass die gedrehte Editor-Lasche ihr Vorzeichen behaelt.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/app/__tests__/startladen-schleier.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");

/** 💣 In diesen Dateien erklaert die Prosa genau das, wonach gesucht wird -- ein Treffer im
 *  Kommentar ist deshalb kein Beweis, sondern die haeufigste Art, einen gruenen Test zu bauen,
 *  der nichts haelt. */
function withoutComments(source) {
	return source
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^[ \t]*\/\/.*$/gm, "");
}

function escapeRe(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const tokens = withoutComments(read("css", "base", "tokens.css"));

// ---- Die vier Token stehen in BEIDEN Themen -----------------------------------------------------
//
// 🔴 „leicht weiss" (Owner 19.08.2026) beschreibt das HELLE Thema. Derselbe Wert ueber der dunklen
// Karte waere ein Blitz -- deshalb ist dieser Schleier, anders als die Scrims daneben, nicht
// gepinnt, sondern hat einen eigenen dunklen Gegenwert.
const dunkelAb = tokens.indexOf(':root[data-theme="dark"]');
assert.ok(dunkelAb > 0, "tokens.css traegt einen :root[data-theme=\"dark\"]-Block");
const hellerBlock = tokens.slice(0, dunkelAb);
const dunklerBlock = tokens.slice(dunkelAb);

const BOOT_TOKEN = [
	"--color-boot-veil",
	"--color-boot-ring-ink",
	"--color-boot-ring-pale",
	"--color-boot-ring-track"
];
BOOT_TOKEN.forEach((name) => {
	const muster = new RegExp(escapeRe(name) + ":\\s*[^;]+;");
	assert.ok(muster.test(hellerBlock), `${name} fehlt im hellen Thema`);
	assert.ok(muster.test(dunklerBlock),
		`${name} fehlt im DUNKLEN Thema. „leicht weiss" beschreibt das helle; derselbe Wert ueber`
		+ " der dunklen Karte waere ein Blitz -- der Schleier ist bewusst nicht gepinnt.");
});

// 🔴 Das Gold ist KEIN eigenes Token: es ist --color-accent-strong, das Wappengold, das die
// Designsprache dafuer schon fuehrt. Ein fuenftes Token waere eine zweite Wahrheit fuer eine
// Farbe, die es gibt.
assert.ok(!/--color-boot-ring-gold\s*:/.test(tokens),
	"--color-boot-ring-gold gehoert NICHT nach tokens.css -- das Gold ist --color-accent-strong."
	+ " (Das Mockup fuehrt es abweichend; massgeblich ist der Bauplan.)");

const ladeCss = withoutComments(read("css", "features", "loading-bar.css"));
const ladeJs = withoutComments(read("js", "app", "loading-bar.js"));

// ---- Der Schleier laesst DURCH -----------------------------------------------------------------
//
// 🔴 Owner-Entscheid 19.08.2026, keine Feinheit: Schieben und Zoomen gehen waehrend des Ladens
// weiter wie bisher. Wer das umdreht, sperrt den Besucher bei einem haengenden Ladevorgang
// 20 Sekunden aus -- so lange laeuft das Sicherheitsnetz in loading-bar.js.
const schleier = ladeCss.match(/^\.avesmaps-boot-veil\s*\{([^}]*)\}/m);
assert.ok(schleier, "css/features/loading-bar.css traegt die Regel .avesmaps-boot-veil");
assert.ok(/pointer-events:\s*none/.test(schleier[1]),
	"Der Schleier laesst Klicks DURCH (Owner-Entscheid). Sperrt er, sitzt der Besucher bei einem"
	+ " haengenden Ladevorgang 20 Sekunden fest, bis das Sicherheitsnetz greift.");

// ---- ...und liegt UNTER dem schmalen Streifen oben ----------------------------------------------
//
// 💣 Beide Zahlen werden aus der Datei GELESEN, nicht hier abgeschrieben -- sonst prueft der Test
// seine eigene Kopie und nicht das Stylesheet.
const balken = ladeCss.match(/^\.avesmaps-loading-bar\s*\{([^}]*)\}/m);
assert.ok(balken, "die Balken-Regel steht weiterhin da");
const zBalken = Number((balken[1].match(/z-index:\s*(\d+)/) || [])[1]);
const zSchleier = Number((schleier[1].match(/z-index:\s*(\d+)/) || [])[1]);
assert.ok(Number.isFinite(zBalken) && Number.isFinite(zSchleier),
	"Balken und Schleier tragen beide einen z-index");
assert.ok(zSchleier < zBalken,
	`Der Schleier (${zSchleier}) muss UNTER dem Balken (${zBalken}) liegen -- darueber verdeckt er`
	+ " genau den schmalen Streifen oben, der laut Auftrag bleiben soll.");

// ---- Er blendet aus, er verschwindet nicht ------------------------------------------------------
//
// 💣 Gleiche Begruendung wie beim Knopfbund darueber: aus `display: none` gibt es kein Ausblenden.
assert.ok(/opacity:\s*0/.test(schleier[1]) && /visibility:\s*hidden/.test(schleier[1]),
	"der Schleier ruht auf opacity + visibility");
assert.ok(!/display:\s*none/.test(schleier[1]),
	"...und NICHT auf display:none -- daraus gibt es kein Ausblenden, nur ein Verschwinden");
const schleierAn = ladeCss.match(/^html\.avesmaps-booting \.avesmaps-boot-veil\s*\{([^}]*)\}/m);
assert.ok(schleierAn && /opacity:\s*1/.test(schleierAn[1]),
	"und er kommt an der Startlauf-Klasse -- nicht an einem eigenen, zweiten Zustand");

// ---- Die Farbe kommt aus dem Token --------------------------------------------------------------
assert.ok(/background:\s*var\(--color-boot-veil\)/.test(schleier[1]),
	"die Schleierfarbe kommt aus einem Token (AGENTS.md §12), nicht als Literal");

// ---- Der Satz darunter: data-i18n, weil es hier kein tr() gibt ----------------------------------
//
// ⚠️ js/app/loading-bar.js laeuft in index.html Zeile 247, js/app/i18n.js erst in Zeile 3003 --
// `window.tr` existiert zur Bauzeit des Knotens NICHT. Der Satz steht deutsch im Knoten und wird
// vom Durchlauf des Uebersetzers nachgezogen. Eine zweite Spracherkennung hier waere der teurere
// Fehler (dass es davon nur EINE gibt, ist die Zusicherung, die zaehlt).
assert.ok(/setAttribute\("data-i18n",\s*"boot\.loading"\)/.test(ladeJs),
	"der Satz unter dem Kreis traegt data-i18n=\"boot.loading\"");
assert.ok(/veilText\.textContent\s*=/.test(ladeJs),
	"...und seine deutsche Vorgabe steht als textContent im Knoten (nicht leer, sonst sieht ein"
	+ " deutscher Besucher gar nichts)");
assert.ok(!/window\.tr\b|[^.\w]tr\(/.test(ladeJs),
	"loading-bar.js ruft kein tr() -- es gibt hier keins, und ein Aufruf waere still undefined");

const enStrings = withoutComments(read("js", "app", "i18n-en.js"));
assert.ok(/"boot\.loading":\s*"[^"]+"/.test(enStrings),
	"js/app/i18n-en.js kennt boot.loading -- sonst steht der Satz unter ?lang=en dauerhaft deutsch");

// ---- Die Windrose ------------------------------------------------------------------------------
//
// 💣 Der Ring haengt am SCHLEIER, nicht im Textknoten: der Uebersetzer setzt `el.textContent = v`
// und raeumte die SVG im selben Knoten mit weg, sobald jemand ?lang=en aufruft. Der Fehler waere
// unter Deutsch unsichtbar.
assert.ok(/veil\.insertBefore\(\s*rose\s*,\s*veilText\s*\)/.test(ladeJs),
	"die Windrose wird VOR den Textknoten in den Schleier gehaengt (Geschwister, nicht Kind)");
assert.ok(!/veilText\.(innerHTML|appendChild)/.test(ladeJs),
	"...und NICHT in den Textknoten: der Uebersetzer setzt dort textContent und raeumte die SVG"
	+ " mit weg -- unter Deutsch waere das unsichtbar");

// 🔴 Die Rose STEHT. Bewegt wird allein das goldene Stueck (Owner 19.08.2026) -- eine kreiselnde
// Kompassrose liest sich als „verirrt", nicht als „laedt".
const sweep = ladeCss.match(/^\.avesmaps-boot-veil__sweep\s*\{([^}]*)\}/m);
assert.ok(sweep, "das laufende Stueck hat eine eigene Regel");
assert.ok(/animation:\s*avesmaps-boot-sweep/.test(sweep[1]),
	"...und es ist das EINZIGE, was sich dreht");
const rosenRegel = ladeCss.match(/^\.avesmaps-boot-veil__rose\s*\{([^}]*)\}/m);
assert.ok(rosenRegel && !/animation:/.test(rosenRegel[1]),
	"die Rose selbst dreht sich NICHT -- eine kreiselnde Kompassrose liest sich als „verirrt\"");

// 💣 Ohne `transform-box: fill-box` ist der Bezugspunkt einer Drehung bei einem SVG-Teilelement
// der ganze Zeichenbereich: das goldene Stueck liefe dann auf einer KREISBAHN um die Rose herum,
// statt sich an Ort und Stelle zu drehen. Das sieht aus wie ein Fehler im Pfad und ist keiner.
assert.ok(/transform-box:\s*fill-box/.test(sweep[1]),
	"transform-box: fill-box ist tragend -- ohne sie kreist das Goldstueck um die Rose herum");
assert.ok(/transform-origin:\s*center/.test(sweep[1]),
	"...zusammen mit transform-origin: center");

// ⚠️ Ein voellig stehender Kreis sagt nichts. Unter prefers-reduced-motion blendet er auf und ab.
const ruhig = ladeCss.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/g) || [];
assert.ok(ruhig.some((block) => /avesmaps-boot-veil__sweep/.test(block) && /avesmaps-boot-pulse/.test(block)),
	"unter prefers-reduced-motion tritt eine Blende an die Stelle der Drehung -- ein voellig"
	+ " stehender Kreis sagt nichts, und eine Blende ist keine vestibulaere Bewegung");

// ---- Keine Farbe im Markup ---------------------------------------------------------------------
//
// 💣 Die SVG entsteht als String im JS. Genau dort schleicht sich ein Literal ein, das kein
// CSS-Sweep je findet -- und im dunklen Thema faellt es dann als schwarzer Fleck auf.
const markup = ladeJs.match(/function windroseMarkup\(\)[\s\S]*?\n\t\}/);
assert.ok(markup, "windroseMarkup() steht in loading-bar.js");
assert.ok(!/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(markup[0]),
	"kein Farbliteral in der SVG -- die Farben kommen ueber Klassen aus dem Stylesheet"
	+ " (AGENTS.md §12). Ein Literal hier faende kein CSS-Sweep je.");

// ---- Der Teilstrichkranz ist GERECHNET, nicht geraten -------------------------------------------
//
// 24 Striche auf dem Ring r=40: Umfang 2*PI*40 = 251,33, geteilt durch 24 = 10,47 -- minus der
// Strichlaenge 1,6 bleibt die Luecke 8,87. Eine geratene Zahl laesst den Kranz sichtbar auslaufen
// (der letzte Strich trifft den ersten nicht).
const kranz = ladeJs.match(/stroke-dasharray="1\.6 ([0-9.]+)"/);
assert.ok(kranz, "der Teilstrichkranz traegt seine dasharray");
const erwarteteLuecke = (2 * Math.PI * 40) / 24 - 1.6;
assert.ok(Math.abs(Number(kranz[1]) - erwarteteLuecke) < 0.05,
	`die Luecke im Kranz ist ${kranz[1]}, gerechnet waeren es ${erwarteteLuecke.toFixed(2)}`
	+ " (24 Striche auf r=40). Eine geratene Zahl laesst den Kranz sichtbar auslaufen.");

// ---- Die rechte Kante faehrt herein ------------------------------------------------------------
//
// Owner 19.08.2026: „info bzw. editor panel ebenfalls rechts versteckt bleiben und nach links
// ausklappen sobald geladen ist" -- spiegelbildlich zum Planer gegenueber.
const startstellung = ladeCss.match(
	/^html\.avesmaps-booting \.avesmaps-infopanel__handle,\s*html\.avesmaps-booting \.avesmaps-infopanel,\s*html\.avesmaps-booting #review-panel\s*\{([^}]*)\}/m);
assert.ok(startstellung,
	"die drei UNGEDREHTEN Flaechen der rechten Kante stehen in EINER Regel -- drei Regeln waeren"
	+ " drei Strecken, die auseinanderlaufen koennen");
assert.ok(/transform:\s*translateX\(100%\)/.test(startstellung[1]),
	"...und warten 100% ihrer EIGENEN Breite weit draussen. Prozent, keine Zahl: am Telefon ist"
	+ " die Lasche 26px breit statt 30 (--avesmaps-tab-w im Finger-Block), und ein Token waere"
	+ " hier eine zweite Stelle, die das wissen muesste.");

// 💣 `transform`, nicht `right`. `right` waere naheliegend -- beide Laschen haben schon eine
// right-Transition fuers Andocken an die Panelkante, und diese Datei laedt NACH css/styles.css
// (index.html:55/56), gewoenne bei gleicher Spezifitaet also sogar. Aber `right` IST hier bereits
// belegt: die Andockregeln in css/features/infopanel.css fahren die Laschen damit zwischen
// Bildschirm- und Panelkante hin und her. Eine zweite Bedeutung auf derselben Eigenschaft hiesse,
// dass beide Bewegungen sich gegenseitig ueberschreiben, sobald sich der Andockzustand waehrend
// des Startlaufs aendert. `transform` ist frei und kollidiert mit nichts.
assert.ok(!/(^|[^-])right:/.test(startstellung[1]),
	"die Startstellung laeuft ueber transform, NICHT ueber right -- die Andockregeln in"
	+ " infopanel.css setzen right:0 bei gleicher Spezifitaet und stehen spaeter im Ladepfad");

// 💣 Die Editor-Lasche traegt schon `transform: rotate(180deg)`. Ein danebengeschriebenes
// translateX ERSETZT die Drehung -- die Beschriftung stuende kopf. Und weil nach der Drehung ihre
// eigene x-Achse nach LINKS zeigt, muss es MINUS heissen: ein +100% schoebe sie ueber die Karte
// statt aus dem Bild. Dieselbe Strecke wie oben, zwei Schreibweisen -- deshalb eine eigene Regel.
const editorLasche = ladeCss.match(/^html\.avesmaps-booting #review-panel-toggle\s*\{([^}]*)\}/m);
assert.ok(editorLasche, "die Editor-Lasche hat ihre EIGENE Regel (sie ist gedreht)");
assert.ok(/transform:\s*rotate\(180deg\)\s+translateX\(-100%\)/.test(editorLasche[1]),
	"Sie komponiert rotate(180deg) MIT translateX(-100%). Ohne das rotate steht die Beschriftung"
	+ " kopf; mit +100% schiebt sie sich ueber die Karte statt aus dem Bild.");

// ⚠️ Ohne `transform` in der eigenen Transition SPRINGEN die Laschen am Ende des Startlaufs auf
// ihren Platz, statt zu gleiten. Der Balken faellt auf, die fehlende Bewegung nicht.
const infoCss = withoutComments(read("css", "features", "infopanel.css"));
const handleRegel = infoCss.match(/^\.avesmaps-infopanel__handle\s*\{([^}]*)\}/m);
assert.ok(handleRegel, "die Regel .avesmaps-infopanel__handle steht in infopanel.css");
assert.ok(/transition:[^;]*transform 0\.22s/.test(handleRegel[1]),
	"die Info-Lasche fuehrt transform in ihrer Transition -- sonst springt sie, statt zu gleiten");

const reviewCss = withoutComments(read("css", "features", "review-panel.css"));
// 💣 Der Selektor `.review-panel-toggle` steht ZWEIMAL am Zeilenanfang: einmal als letzte
// Selektorzeile einer SAMMELREGEL (gemeinsam mit .review-panel__icon-button -- dort steht die
// geteilte Optik der Knoepfe), einmal als EIGENE Regel. Gemeint ist die eigene, erkennbar an
// `position: fixed`. Ein `^`-verankertes match() nimmt die erste und damit die falsche; genau
// das ist beim Bau passiert und hat die Sammelregel veraendert, die hier nichts zu suchen hat.
const toggleRegeln = [...reviewCss.matchAll(/^\.review-panel-toggle\s*\{([^}]*)\}/gm)].map((t) => t[1]);
const toggleRegel = toggleRegeln.find((rumpf) => /position:\s*fixed/.test(rumpf));
assert.ok(toggleRegel,
	"die EIGENSTAENDIGE Regel .review-panel-toggle steht in review-panel.css (die mit position: fixed)");
assert.ok(/transition:[^;]*transform 220ms/.test(toggleRegel),
	"die Editor-Lasche fuehrt transform in ihrer Transition -- und in IHRER Dauer (220ms)");
// ...und die Sammelregel bleibt unberuehrt: sie faerbt auch die Kopfknoepfe des Panels, die mit
// dem Startlauf nichts zu tun haben.
const sammelRegel = reviewCss.match(/^\.review-panel__icon-button,\s*\.review-panel-toggle\s*\{([^}]*)\}/m);
assert.ok(sammelRegel && !/transition:/.test(sammelRegel[1]),
	"die Sammelregel .review-panel__icon-button + .review-panel-toggle traegt KEINE transition --"
	+ " sie gehoert der geteilten Knopf-Optik, nicht dem Startlauf");

// 🔴 Der Planer und SEINE Lasche bleiben unangetastet. #toggle-button steht auf left:350px und
// landet beim Start auf left:0 -- also sichtbar. Das ist der Owner-Entscheid vom 12.08.2026
// („ich meinte nicht, dass die tab-lasche nachgeladen wird") und kein Versehen.
const planerEinfahrt = ladeCss.match(
	/^html:not\(\.avesmaps-phone\)\.avesmaps-booting #search,\s*html:not\(\.avesmaps-phone\)\.avesmaps-booting #toggle-button\s*\{([^}]*)\}/m);
assert.ok(planerEinfahrt && /--avesmaps-planner-width/.test(planerEinfahrt[1]),
	"die Startstellung des Planers steht unveraendert da -- dieser Bau fasst sie nicht an");

// ---- ...und weiter, wenn ein Panel offen steht ---------------------------------------------------
//
// 💣 Die Laschen docken bei offenem Panel an der PANELkante, nicht an der Bildschirmkante. Die
// eigene Breite reicht dann nicht -- und das ist der VORGABEfall im Editor.
const offenHandle = ladeCss.match(
	/^html\.avesmaps-booting\.avesmaps-any-panel-open \.avesmaps-infopanel__handle\s*\{([^}]*)\}/m);
assert.ok(offenHandle, "es gibt eine Startstellung fuer den Fall, dass ein Panel offen steht");
assert.ok(/translateX\(calc\(100% \+ var\(--avesmaps-ip-w\)\)\)/.test(offenHandle[1]),
	"...und sie weicht um die eigene Breite PLUS die Panelbreite -- sonst schwebt die Lasche"
	+ " waehrend des Startlaufs frei auf der Karte");
const offenToggle = ladeCss.match(
	/^html\.avesmaps-booting\.avesmaps-any-panel-open #review-panel-toggle\s*\{([^}]*)\}/m);
assert.ok(offenToggle, "dasselbe fuer die gedrehte Editor-Lasche");
assert.ok(/rotate\(180deg\)\s+translateX\(calc\(-100% - var\(--avesmaps-ip-w\)\)\)/.test(offenToggle[1]),
	"...mit negativem Vorzeichen, weil ihre x-Achse nach der Drehung nach links zeigt");

console.log("startladen-schleier: alle Zusicherungen gehalten");
