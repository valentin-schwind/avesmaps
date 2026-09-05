// Die iOS-Schwelle: Eingabefelder tragen am groben Zeiger mindestens 16px.
//
// Geprueft wird, was hier lautlos kippt: dass es genau EINEN Finger-Block gibt, dass die Schwelle
// ihren WERT haelt (nicht bloss gesetzt ist), dass die Felder den Token lesen statt eines Literals
// -- und dass der falsche Fix (maximum-scale im Viewport-Meta) nicht nachwaechst.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/app/__tests__/touch-scale.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");

/** 💣 In diesen Dateien erklaert die Prosa genau das, wonach gesucht wird -- ein Treffer im
 *  Kommentar ist deshalb kein Beweis, sondern die haeufigste Art, einen gruenen Test zu bauen,
 *  der nichts haelt. In diesem Repo sind schon vier Zusicherungen darauf hereingefallen. */
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
const planner = withoutComments(read("css", "features", "route-planner.css"));
const indexHtml = withoutComments(read("index.html"));

// ---- Der EINE Finger-Block ----------------------------------------------------------------------
const coarseBlocks = tokens.match(/@media\s*\(pointer:\s*coarse\)\s*\{[\s\S]*?\n\}/g) || [];
assert.strictEqual(coarseBlocks.length, 1,
	`tokens.css traegt ${coarseBlocks.length} (pointer: coarse)-Bloecke -- es muss genau EINER sein.`
	+ " Zwei waeren zwei Wahrheiten, und die faende man erst, wenn sie auseinanderlaufen.");
const coarse = coarseBlocks[0];

// ---- Die Schwelle: der WERT, nicht die blosse Anwesenheit ----------------------------------------
const controlFont = coarse.match(/--font-size-control:\s*([0-9.]+)px/);
assert.ok(controlFont, "der Finger-Block setzt --font-size-control");
assert.ok(Number(controlFont[1]) >= 16,
	`--font-size-control ist am Finger ${controlFont[1]}px -- unter 16 faehrt Safari beim Fokus in`
	+ " jedes Feld hinein und kehrt nicht zurueck. 16 ist eine Schwelle, kein Richtwert: 15,5 zoomt.");

// ---- Die Felder lesen den Token ------------------------------------------------------------------
const feldRegel = planner.match(
	/^\.route-planner-options-panel input\[type="number"\],[\s\S]*?\{([^}]*)\}/m);
assert.ok(feldRegel, "die Regel fuer Zahlenfeld und Select ist auffindbar");
const font = feldRegel[1].match(/font-size:\s*([^;]+);/);
assert.ok(font && /var\(--font-size-control\)/.test(font[1]),
	`Zahlenfeld/Select liest --font-size-control statt "${font ? font[1].trim() : "nichts"}"`);
assert.ok(feldRegel[1].indexOf("font: inherit") < feldRegel[1].indexOf("font-size:"),
	"und zwar NACH `font: inherit` -- die Kurzform setzt font-size mit und ueberschriebe die Zeile sonst");

// ---- Das Wegpunktfeld: die eine Ausnahme ---------------------------------------------------------
//
// 💣 Am 10.08.2026 live gemessen, durch Einspritzen beider Fassungen in die laufende Seite:
// `.waypoint-input { font-size: 16px }` bewegt NICHTS (das Feld bleibt bei 13,33px), erst
// `input.waypoint-input` setzt sich durch. Ohne die hoehere Spezifitaet bliebe die Schwelle am
// wichtigsten Feld des Planers wirkungslos, und zwar lautlos.
// 🔴 SEIT 05.09.2026 OHNE MEDIA QUERY (Owner: „dropdown auf 13 und die eingabefelder auch"): der
//    Token traegt den Sprung selbst -- am Zeiger --font-size-body, am Finger 16px aus dem einen
//    coarse-Block. Zwei Regeln mit demselben Wert waeren die Divergenz, gegen die dieser Test
//    sonst steht. Geprueft wird deshalb die SPEZIFITAET (`input.` muss dabei sein) und der Token,
//    nicht mehr die Media Query.
const wegpunktRegel = planner.match(/(?:^|\n)input\.waypoint-input\s*\{([^}]*)\}/);
assert.ok(wegpunktRegel,
	"route-planner.css traegt eine Regel fuer `input.waypoint-input` -- mit blossem"
	+ " `.waypoint-input` bliebe sie wirkungslos: jQuery-UI setzt `.ui-widget input"
	+ " { font-size: 1em }` (0,1,1), und #search traegt `ui-widget` (live gemessen 10.08./05.09.2026)");
assert.ok(/var\(--font-size-control\)/.test(wegpunktRegel[1]), "und sie liest den Token");
assert.ok(!/@media\s*\(pointer:\s*coarse\)\s*\{[^}]*input\.waypoint-input/.test(planner),
	"…und NUR diese eine -- eine zweite, media-gebundene Regel mit demselben Wert waere die"
	+ " Divergenz, die beim naechsten Taktwechsel auseinanderlaeuft");
assert.ok(/\.waypoint-input\s*\{[^}]*font-size:\s*15px/.test(planner),
	"die alte 15px-Regel bleibt unangetastet -- sie gewinnt heute ohnehin nicht, und sie zu aendern"
	+ " koennte den Zeiger verschieben, falls die Kaskade dort einmal repariert wird");

// ---- Die Beschriftungen bleiben, wie sie sind ----------------------------------------------------
//
// 🔴 Absichtlich NICHT mitgehoben. Die Felder haben feste Hoehen (25px / 32px), ihre Schrift waechst
// nach innen. Beschriftungszeilen haben keine feste Hoehe -- sie mitzuheben machte den Planer am
// Telefon hoeher, und dessen Hoehenbudget ist eine eigene, groessere Frage (der Versuch vom 10.08.
// wurde deshalb zurueckgerollt). Die Zoom-Falle betrifft ohnehin nur Eingabefelder.
const zeilenRegel = planner.match(/^\.display-options__row,[\s\S]*?\{([^}]*)\}/m);
assert.ok(zeilenRegel, "die Beschriftungszeile ist auffindbar");
assert.ok(!/var\(--font-size-control\)/.test(zeilenRegel[1]),
	"die Beschriftungszeilen lesen den Token NICHT -- sie haben keine feste Hoehe und wuerden den"
	+ " Planer am Telefon wachsen lassen");

// ---- Die uebrigen Besucher-Fenster mit Eingabefeldern --------------------------------------------
//
// Die Schwelle gilt UEBERALL, wo ein Besucher tippt -- nicht nur im Routenplaner. Drei Fenster
// haben eigene Formulare; das Bewertungsformular teilt sich die Regeln des Meldedialogs
// (es traegt class="location-report-form"), deshalb sind es drei Regeln und nicht vier.
//
// ⚠️ Anders als die Planerfelder haben diese KEINE feste Hoehe -- sie wachsen am Finger mit der
// Schrift. Hier unschaedlich, weil alle drei Fenster scrollen; im Planer waere es das nicht
// gewesen (dessen Hoehenbudget ist eine eigene Frage).
const DIALOG_FELDER = [
	["css/components/legal-dialog.css", ".legal-contact input", "Kontaktformular"],
	["css/components/location-report-dialog.css", ".location-report-form__field input",
		"Meldedialog + Bewertungsformular"],
	["css/components/location-report-dialog.css", ".report-sources__add input[type=\"text\"]",
		"Quellen-Unterformular"],
];
DIALOG_FELDER.forEach(([rel, selector, name]) => {
	const css = withoutComments(read(...rel.split("/")));
	const rule = css.match(new RegExp("^" + escapeRe(selector) + "[\\s\\S]*?\\{([^}]*)\\}", "m"));
	assert.ok(rule, `Feldregel fuer ${name} gefunden (${selector})`);
	assert.ok(/font-size:\s*var\(--font-size-control\)/.test(rule[1]),
		`${name} liest --font-size-control -- sonst zoomt iOS beim Fokus in das Feld`);
	assert.ok(rule[1].indexOf("font: inherit") < rule[1].indexOf("font-size:"),
		`${name}: die Schwelle steht NACH \`font: inherit\` -- die Kurzform setzt font-size mit`);
});

// Und die Fenster muessen scrollen, sonst waere das Wachsen der Felder ein Ueberlauf.
// 🔴 „Hinweise" stand hier bis zum 05.09.2026 mit drin und wurde am DATEIINHALT geprueft
//    (irgendwo ein `overflow-y: auto` in legal-dialog.css). Seit sein Rumpf am Bauteil haengt,
//    gibt es diese Zeile dort nicht mehr -- sie waere die zweite Fassung derselben Zusage. Die
//    SORGE bleibt woertlich dieselbe (das Kontaktformular waechst am Finger, also muss das
//    Fenster scrollen) und wird unten geprueft, an der Stelle, die sie jetzt einloest.
[["css/features/location-reviews.css", "Bewertungen"]].forEach(([rel, name]) => {
	const css = withoutComments(read(...rel.split("/")));
	assert.ok(/overflow-y:\s*auto/.test(css),
		`${name} scrollt -- daran haengt, dass die groesseren Felder nicht ueberlaufen`);
});

// 🔴 DER MELDEDIALOG SCROLLT SEIT 04.09.2026 WOANDERS -- und das ist der Sinn der Aenderung.
//    Vorher trug die HUELLE `overflow-y: auto`: das ganze Fenster lief, Titel und "Speichern"
//    wanderten aus dem Bild (Owner: "…um zum speichern zu kommen und den titel aus den augen
//    verliere"). Jetzt laeuft der RUMPF, und der ist `.avm-fenster__rumpf` aus dem Bauteil.
// 💣 Die Sorge dieses Tests bleibt dieselbe -- die groesseren Felder duerfen nicht ueberlaufen --,
//    also wird sie weiter geprueft, nur an der Stelle, die sie jetzt einloest. Und BEIDE Haelften:
//    die Regel im Bauteil UND dass die neun Fenster sie wirklich tragen. Eine Haelfte allein
//    waere nichts wert.
const bauteilCss = withoutComments(read("css", "components", "fenster.css"));
const rumpfRegel = /\.avm-fenster__rumpf\s*\{([^}]*)\}/.exec(bauteilCss);
assert.ok(rumpfRegel && /overflow:\s*auto/.test(rumpfRegel[1]),
	"Meldedialog scrollt -- der Rumpf des Fenster-Bauteils muss `overflow: auto` tragen");
assert.ok(rumpfRegel && /min-height:\s*0/.test(rumpfRegel[1]),
	"`min-height: 0` fehlt am Rumpf -- ein Flex-Kind schrumpft sonst nicht unter seinen Inhalt, "
	+ "`overflow: auto` greift nie, und es scrollt wieder die Huelle");
// ⚠️ Eigener Name: `indexHtml` ist in dieser Datei schon vergeben (weiter oben). Ein zweites
//    `const` desselben Namens ist ein SyntaxError -- und der macht den Test rot, BEVOR eine
//    einzige Zusicherung laeuft. Beim Bau am 04.09.2026 haben dadurch drei Mutationsproben
//    "gefangen" gemeldet, die in Wahrheit nur diesen Syntaxfehler sahen.
const rumpfMarkup = read("index.html");
const traeger = (rumpfMarkup.match(/class="location-report-form[^"]*avm-fenster__rumpf/g) || []).length
	+ (rumpfMarkup.match(/class="avm-fenster__rumpf"/g) || []).length;
assert.ok(traeger >= 9,
	`nur ${traeger} Fenster tragen den Rumpf -- es sind neun Blaetter, die diese Huelle teilen; `
	+ "fehlt einem der Rumpf, scrollt dort wieder das ganze Fenster");
// 💣 Und „Hinweise" NAMENTLICH, nicht ueber die Menge darueber: `traeger >= 9` ist eine Zahl, und
//    sie bliebe gruen, wenn ausgerechnet dieses eine Fenster seinen Rumpf verloere. Genau daran
//    haengt hier aber ein Befund -- das Kontaktformular sitzt in DIESEM Fenster.
assert.ok(/class="legal-dialog__scroll avm-fenster__rumpf"/.test(rumpfMarkup),
	"Hinweise scrollt -- sein Rumpf traegt .avm-fenster__rumpf; ohne das laeuft wieder die Huelle,"
	+ " und die am Finger gewachsenen Kontaktfelder laufen ueber");

// ---- Die Suchkachel: EINE Regel mit ihren Nachbarn ------------------------------------------------
//
// Owner 11.08.2026: "kachel aber farbe und outline wie Hinweise bzw Neuigkeiten". Das ist erfuellt,
// indem sie in DERSELBEN Regel steht -- nicht, indem die Werte abgeschrieben sind. Ein gefuellter
// Knopf trug seine Rangfolge im Dunkelmodus ohnehin nicht: dort liegen --color-button (#6b6456) und
// --color-panel (#312e26) beide im selben Braun.
const legalCss = withoutComments(read("css", "components", "legal-dialog.css"));
// 💣 ES SIND ZWEI REGELN, NICHT EINE: die Grundregel (Farbe, Kontur, Radius, Schatten) und die
// Hover-Regel zwei Absaetze darunter. Am 11.08.2026 stand die Suchkachel in der ersten und fehlte
// in der zweiten -- sie sah richtig aus und blieb unter dem Zeiger stumm. Genau das faengt diese
// Pruefung ab, und zwar fuer JEDEN Eckknopf: die Liste waechst mit, die Regel bleibt dieselbe.
// (Vorher stand hier ein Abgleich auf die woertliche Dreier-Liste. Der biss zwar, aber er biss
// auch den, der einen VIERTEN Eckknopf richtig eintrug.)
const ECKKNOEPFE = ["#map-search-button", "#map-layer-button", "#legal-button", "#news-button"];
const selektorlisten = Array.from(legalCss.matchAll(/([^{}]*#news-button[^{}]*?)\{/g)).map((m) => m[1]);
const grundregel = selektorlisten.find((liste) => !/:hover/.test(liste));
const hoverregel = selektorlisten.find((liste) => /:hover/.test(liste));
assert.ok(grundregel, "es gibt eine gemeinsame Grundregel der Eckknoepfe");
assert.ok(hoverregel, "und eine gemeinsame Hover-Regel");
ECKKNOEPFE.forEach((id) => {
	assert.ok(grundregel.includes(id),
		`${id} steht in der GEMEINSAMEN Grundregel -- kopierte Werte waeren die Divergenz, vor der`
		+ " AGENTS.md §12 warnt");
	assert.ok(hoverregel.includes(id + ":hover"),
		`${id} steht auch in der Hover-Regel -- sonst sieht der Knopf richtig aus und bleibt unter`
		+ " dem Zeiger stumm (so geschehen am 11.08.2026)");
});
// ⚠️ Der Block darf MEHRERE Knoepfe nennen und tut es seit dem 12.08.2026 auch: der Anzeige-Knopf
// (Auge) steht mit drin, damit die zwei 48er-Kacheln nicht zwei Quellen fuer dieselbe Groesse
// haben. Gesucht wird deshalb der Block, in dessen Selektorliste die Suchkachel VORKOMMT -- nicht
// einer, der nur aus ihr besteht. Die woertliche Fassung hat drei Deploys rot gemacht, obwohl an
// der Regel nichts falsch war.
// ⚠️ Und es ist nicht die ERSTE Regel mit diesem Selektor -- das ist die gemeinsame Grundregel
// von weiter oben. Gesucht ist die, die das Fingermass traegt.
const kachelBloecke = Array.from(legalCss.matchAll(/([^{}]*#map-search-button[^{}]*)\{([^}]*)\}/g));
const eigen = kachelBloecke.find((b) => /width:\s*48px/.test(b[2]) && !/:hover|:focus/.test(b[1]));
const kachelBlock = eigen ? eigen[2] : "";   // [1] ist die Selektorliste, [2] der Rumpf
assert.ok(eigen,
	"und hat einen eigenen Block fuer das, was eine Kachel ausmacht (48x48) -- ggf. gemeinsam mit"
	+ " ihren gleich grossen Nachbarn, die Selektorliste darf wachsen");
["background", "border:", "border-radius", "box-shadow", "color:"].forEach((prop) => {
	assert.ok(!new RegExp(escapeRe(prop)).test(kachelBlock),
		`der Kachel-Block setzt ${prop} NICHT selbst -- das kommt aus der gemeinsamen Regel`);
});
// Die Kachel ist seit dem 11.08. FREI von der Reihe (Owner: "sie muss nich ihren partnern
// gleichen, sie kann auch ueber den anderen beiden liegen" + "groesser war super") -- sie darf
// deshalb Fingermass tragen statt sich an 32px zu binden.
// 💣 Aber ihre LAGE wird nirgends gerechnet: der Bund ist eine Spalte, die beiden Verweise sind
// seine zweite Reihe. Ein `bottom`-Abstand haette --avesmaps-corner-stack lesen muessen, und genau
// die Zahl lag am 10.08. um 8px daneben, als die Knoepfe wuchsen und sie stehenblieb.
assert.ok(/width:\s*48px/.test(kachelBlock) && /height:\s*48px/.test(kachelBlock),
	"die Kachel traegt Fingermass (48x48) -- sie muss ihren Nachbarn nicht mehr gleichen");
assert.ok(!/aspect-ratio/.test(kachelBlock) && !/align-self/.test(kachelBlock),
	"und koppelt sich NICHT ueber aspect-ratio/align-self an die Reihe -- das ist ein Zirkel (der Bund"
	+ " hat keine eigene Hoehe), gemessen wurde die Kachel damit 302x302");
assert.ok(!/bottom:/.test(kachelBlock) && !/avesmaps-corner-stack/.test(kachelBlock),
	"und rechnet ihren Abstand zum Bund NICHT aus -- sie ist die erste Reihe einer Spalte");

const bundRegel = legalCss.match(/^#map-corner-actions\s*\{([^}]*)\}/m);
assert.ok(bundRegel && /flex-direction:\s*column/.test(bundRegel[1]),
	"der Bund ist eine SPALTE -- daran haengt, dass die Kachel ohne Zahl ueber den Verweisen liegt");
assert.ok(/\.map-corner-actions__row/.test(legalCss) && /map-corner-actions__row/.test(indexHtml),
	"und die beiden Verweise stehen in einer eigenen Zeile darunter");

const indexSuch = indexHtml.indexOf('id="map-search-button"');
const indexBund = indexHtml.indexOf('id="map-corner-actions"');
const indexNews = indexHtml.indexOf('id="news-button"');
assert.ok(indexBund > -1 && indexSuch > indexBund && indexSuch < indexNews,
	"und sie steht IM Bund, als erstes Element vor \"Neuigkeiten\"");

const layoutCss = withoutComments(read("css", "layout", "map-layout.css"));
assert.ok(/@media\s*\(pointer:\s*coarse\)[\s\S]*?\.leaflet-control-zoom[^}]*display:\s*none/.test(layoutCss),
	"der Zoom-Control wird am Finger ausgeblendet -- er und die Kachel teilen sich die Ecke nie");
const bootstrapJs = withoutComments(read("js", "app", "bootstrap.js"));
assert.ok(/L\.control\.zoom\(/.test(bootstrapJs),
	"...aber weiterhin ANGELEGT: sonst stuende die Platzierungsregel in infopanel.css als tote"
	+ " Zusicherung da, die map-corner-actions.test.js prueft");
assert.ok(/openSpotlightSearch\s*\(/.test(bootstrapJs),
	"die Kachel ruft die vorhandene Suche, statt eine zweite zu bauen");

// ---- Die Lupe waechst zum Feld -------------------------------------------------------------------
//
// Drei Dinge, die EINE Bewegung ergeben: das Fenster sitzt am Finger unten (sonst floege es quer
// statt zu wachsen), die Bewegung selbst geht vom Rechteck der Kachel aus, und die Tastatur darf
// das Feld nicht verdecken.
const spotlightCss = withoutComments(read("css", "components", "spotlight-search.css"));
assert.ok(/@media\s*\(pointer:\s*coarse\)[\s\S]*?align-items:\s*flex-end/.test(spotlightCss),
	"am Finger ist das Suchfenster UNTEN verankert -- dort sitzt die Kachel, die es oeffnet");
assert.ok(/\.spotlight-search__results\s*\{\s*order:\s*1/.test(spotlightCss)
	&& /\.spotlight-search__input\s*\{\s*order:\s*2/.test(spotlightCss),
	"und die Treffer wachsen per `order` nach oben -- NICHT per flex-direction: column-reverse,"
	+ " das erwischte auch die versteckte Ueberschrift und die Statuszeile");

const spotlightJs = withoutComments(read("js", "ui", "spotlight-search.js"));
assert.ok(/function animateSpotlightFromSearchTile\s*\(/.test(spotlightJs),
	"es gibt die Bewegung ueberhaupt -- sie war beim ersten Anlauf versprochen und nie gebaut");
const flip = spotlightJs.match(/function animateSpotlightFromSearchTile\s*\([\s\S]*?\n\}/);
assert.ok(/getElementById\("map-search-button"\)/.test(flip[0]),
	"und sie misst sich an der KACHEL, nicht an einem geratenen Punkt");
// 💣 Reveal, NICHT Skalierung. Eine Skalierung quetscht den Text im ersten Bild zusammen und zieht
// ihn auseinander; clip-path schiebt nur die Kante und laesst die Schrift unangetastet. Owner
// 11.08.2026: "das textfeld klappt auf und verbreitet sich links, das icon bleibt an der stelle".
assert.ok(/clipPath/.test(flip[0]) && !/scale\(/.test(flip[0]),
	"die Bewegung ist ein clip-path-Reveal von rechts nach links, keine Skalierung");
// Das "Zeichen bleibt stehen" macht KEINE zweite Lupe im Feld -- es haelt die Kachel oben.
assert.ok(/#spotlight-search-overlay:not\(\[hidden\]\)\s*~\s*#map-corner-actions #map-search-button/
	.test(spotlightCss),
	"die Kachel liegt waehrend des Oeffnens UEBER dem Fenster -- sie ist das Zeichen, das bleibt");
assert.ok(!/modal-dialog-open/.test(spotlightCss),
	"und zwar ueber den Geschwister-Selektor: die Klasse `modal-dialog-open` gilt fuer JEDES"
	+ " Fenster und stellte die Kachel damit auch ueber die Hinweise");
assert.ok(/prefers-reduced-motion/.test(flip[0]),
	"wer Bewegung abbestellt hat, bekommt den Endzustand ohne Weg dorthin");
assert.ok(/pointer:\s*coarse/.test(flip[0]),
	"und am Zeiger laeuft sie nicht -- dort gibt es keine Kachel, von der aus etwas wachsen koennte");
// 💣 Im OEFFNER nachsehen, nicht in der ganzen Datei: die Funktionsdefinition steht weiter oben und
// enthaelt denselben Namen -- eine Suche ueber die ganze Datei findet immer sie zuerst und meldet
// gruen, egal wo der Aufruf steht. Genau so war diese Zusicherung zuerst geschrieben.
const oeffner = spotlightJs.match(/function openSpotlightSearch\([\s\S]*?\n\}/);
assert.ok(oeffner, "der Oeffner ist auffindbar");
assert.ok(oeffner[0].indexOf("overlay.hidden = false") < oeffner[0].indexOf("animateSpotlightFromSearchTile()"),
	"aufgerufen wird sie NACH dem Sichtbarmachen -- vorher hat das Fenster kein Rechteck");
// ---- Das Fenster sitzt AUF der Kachel, nicht am Bildrand -----------------------------------------
//
// 💣 Ohne das klappt das Feld UNTERHALB der Lupe auf statt aus ihr heraus -- gemessen: gleiche
// rechte Kante, aber 38px senkrechter Versatz. Owner 11.08.2026: "kannst du die position gleich
// lassen? nur die groesse und damit nur die linke seite soll sich nach links ausbreiten".
assert.ok(/function positionSpotlightAtSearchTile\s*\(/.test(spotlightJs),
	"die Lage des Fensters wird an der Kachel ausgerichtet");
const lage = spotlightJs.match(/function positionSpotlightAtSearchTile\s*\([\s\S]*?\n\}/);
assert.ok(/getBoundingClientRect\(\)/.test(lage[0]),
	"und zwar aus ihrem GEMESSENEN Rechteck -- rechnen hiesse Bundabstand + Zeilenhoehe + Luecke,"
	+ " drei Zahlen ohne Token, die beim naechsten Wachsen still auseinanderlaufen");
assert.ok(/--avesmaps-spotlight-bottom/.test(lage[0]) && !/padding-bottom/.test(lage[0]),
	"ueber eine eigene CSS-Variable, nicht ueber padding-bottom");
assert.ok(/--avesmaps-keyboard-inset/.test(spotlightJs)
	&& !/style\.paddingBottom/.test(spotlightJs),
	"und die Tastatur schreibt eine ZWEITE Variable -- zwei Schreiber auf derselben Eigenschaft"
	+ " hiessen, dass der letzte gewinnt");
assert.ok(spotlightJs.indexOf("positionSpotlightAtSearchTile()") < spotlightJs.lastIndexOf("animateSpotlightFromSearchTile()"),
	"die Lage steht, BEVOR die Bewegung misst");

assert.ok(/visualViewport/.test(spotlightJs),
	"das Feld haengt an der SICHThoehe: iOS schrumpft den Layout-Viewport bei offener Tastatur"
	+ " nicht, ein unten verankertes Feld verschwaende sonst dahinter");

// ---- Am Telefon schwebt nichts mehr ueber der Karte -----------------------------------------------
//
// Owner 11.08.2026: "alle floating infoboxen im mobilformat nicht mehr zeigen".
const runtimeState = withoutComments(read("js", "app", "runtime-state.js"));
const popupCss = withoutComments(read("css", "features", "location-popups-markers.css"));

// EINE Definition von "Telefon": die Klasse kommt aus avesmapsIsPhoneViewport(), das CSS liest sie.
assert.ok(/classList\.toggle\("avesmaps-phone",\s*avesmapsIsPhoneViewport\(\)\)/.test(runtimeState),
	"die Klasse `avesmaps-phone` kommt aus avesmapsIsPhoneViewport() -- eine zweite Fassung als"
	+ " Media-Query waere schon nicht dasselbe: die Heuristik misst die KURZSEITE, also auch die"
	+ " Hoehe, und traefe ein quer gehaltenes Telefon nicht");
["resize", "orientationchange"].forEach((ereignis) => {
	assert.ok(new RegExp(`addEventListener\\("${ereignis}"`).test(runtimeState),
		`und wird bei "${ereignis}" nachgezogen -- ein gedrehtes Telefon bleibt eins`);
});

// 💣 VERSTECKT, nicht am Oeffnen gehindert. Die Panel-Fuellung haengt bei Siedlungen am `popupopen`
// des Markers: wer das Oeffnen abschneidet, bekommt kein Popup UND kein Panel.
assert.ok(/html\.avesmaps-phone \.leaflet-popup\s*\{[^}]*display:\s*none/.test(popupCss),
	"alle schwebenden Boxen sind am Telefon versteckt -- EINE Regel auf Leaflets gemeinsamer Huelle,"
	+ " nicht zwanzig geriegelte Aufrufstellen");
const markerEntryJs = withoutComments(read("js", "map-features", "map-features-location-marker-entry.js"));
assert.ok(/on\("popupopen"/.test(markerEntryJs) && /avesmapsShowLocationInInfopanel/.test(markerEntryJs),
	"...und genau deshalb: das Panel einer Siedlung wird im popupopen gefuellt");
["js/app/bootstrap.js", "js/map-features/map-features-location-marker-entry.js"].forEach((rel) => {
	const src = withoutComments(read(...rel.split("/")));
	assert.ok(!/map\.openPopup\s*=/.test(src),
		`${rel} haengt sich NICHT in map.openPopup -- das Oeffnen zu schlucken naehme dem Panel`
		+ " seinen Ausloeser (so gebaut am 10.08., am selben Tag zurueckgerollt)");
});

// 🔴 Die eine Flaeche, deren EINZIGE Ausgabe die Box war, wird umgeleitet statt versteckt.
const lookupJs = withoutComments(read("js", "map-features", "map-features-location-lookup.js"));
const box = lookupJs.match(/function openFloatingLocationBoxForMarkerEntry\([\s\S]*?\n\}/);
assert.ok(box, "die schwebende Box von \"naechster Ort\" ist auffindbar");
assert.ok(/avesmapsIsPhoneViewport\(\)/.test(box[0]) && /avesmapsShowLocationInInfopanel/.test(box[0]),
	"sie fuellt am Telefon das PANEL, statt eine versteckte Box zu oeffnen -- sonst taete ein Klick"
	+ " auf die Karte dort sichtbar nichts");

// ---- Die Massstabsskala steht ueber den beiden Verweisknoepfen -----------------------------------
//
// Owner 11.08.2026: "schueb nach oben, aber nur ueber die zwei buttons. es is ok wenn es vom
// suchfeld verdeckt werden sollte." Gemessen war die Ueberlappung 61x32px (Skala x 47..314 auf
// 360px Schirm, Bund x 253..348) -- die Skala ist mittig verankert und bei Zoom 3 volle 267px breit.
const uiControls = withoutComments(read("js", "ui", "ui-controls.js"));
const scaleCss = withoutComments(read("css", "features", "map-scale-band.css"));
// 💣 Die Regel muss Leaflet SCHLAGEN. `.leaflet-bottom .leaflet-control { margin-bottom: 10px }`
// ist (0,2,0); eine Regel an `.map-scale-band` allein ist (0,1,0) und verliert -- genau daran ist
// der erste Anlauf am 11.08.2026 gescheitert. Die Abnahme hat es NICHT gefangen, weil sie die Regel
// mit !important in die Seite eingespritzt hat: gepruefte und ausgelieferte Fassung waren nicht
// dieselbe. Deshalb prueft diese Zusicherung die SPEZIFITAET, nicht die blosse Anwesenheit.
const hubRegel = scaleCss.match(/^html\.avesmaps-phone [^{]*\.map-scale-band\s*\{([^}]*)\}/m);
assert.ok(hubRegel,
	"der Hub steht in einer Regel, die mit html.avesmaps-phone qualifiziert ist");
assert.ok(/\.leaflet-bottom/.test(hubRegel[0]),
	"...und mit .leaflet-bottom -- sonst gewinnt Leaflets `.leaflet-bottom .leaflet-control` (0,2,0)");
assert.ok(/margin-bottom:\s*var\(--avesmaps-scale-lift/.test(hubRegel[1]),
	"sie liest den gemessenen Hub");
assert.ok(!/!important/.test(scaleCss),
	"und braucht dafuer KEIN !important -- die Spezifitaet reicht, und genau !important war der"
	+ " Unterschied zwischen der geprueften und der ausgelieferten Fassung");
const lift = uiControls.match(/function syncMapScaleBandLift\(\)[\s\S]*?\n\}/);
assert.ok(lift, "es gibt den Hub");
assert.ok(/\.map-corner-actions__row/.test(lift[0]) && !/#map-corner-actions"/.test(lift[0]),
	"er misst die VERWEIS-ZEILE, nicht den ganzen Bund -- die Suchkachel darf die Skala anschneiden,"
	+ " die beiden Knoepfe nicht");
assert.ok(/getBoundingClientRect\(\)/.test(lift[0]),
	"und zwar gemessen: ausrechnen hiesse Bundabstand + Kachelhoehe + Luecke + Zeilenhoehe, vier"
	+ " Zahlen ohne Token");
assert.ok(/avesmapsIsPhoneViewport/.test(lift[0]) && /removeProperty/.test(lift[0]),
	"am Zeiger wird der Hub wieder entfernt, nicht bloss nicht gesetzt");
// 💣 Die Zeilenhoehe aendert sich im Betrieb (offene Infobox auf schmalem Schirm -> die Knoepfe
// stapeln, 32px wird 70px). Ein fester Hub waere genau dann falsch, wenn das Panel aufgeht.
assert.ok(/new ResizeObserver\(syncMapScaleBandLift\)/.test(uiControls),
	"ein ResizeObserver haengt an der Zeile -- sie stapelt bei offener Infobox und wird hoeher");

// ---- Der Routenplaner liegt ueber der Kartenbedienung --------------------------------------------
//
// Owner 11.08.2026: "der routenplaner soll ueber den buttons auf der karte liegen". Gemessen trugen
// #search und #map-corner-actions BEIDE --z-map-ui (1000) -- bei gleichem z-index entscheidet die
// Reihenfolge im Markup, und der Bund steht spaeter. Er lag deshalb mitten im Panelinhalt.
const layoutCssZ = withoutComments(read("css", "layout", "map-layout.css"));
const legalCssZ = withoutComments(read("css", "components", "legal-dialog.css"));
const planerZ = tokens.match(/--z-map-panel:\s*(\d+)/);
const kartenZ = tokens.match(/--z-map-ui:\s*(\d+)/);
assert.ok(planerZ && kartenZ, "beide Stufen stehen in tokens.css");
assert.ok(Number(planerZ[1]) > Number(kartenZ[1]),
	`--z-map-panel (${planerZ[1]}) liegt ueber --z-map-ui (${kartenZ[1]})`);
// ⚠️ Und unter den beiden Panels, die den Planer zudecken duerfen.
assert.ok(Number(planerZ[1]) < 1080,
	`--z-map-panel (${planerZ[1]}) bleibt unter dem Infopanel (1080) und dem Editorpanel (1100)`);
["#search", "#toggle-button"].forEach((selector) => {
	const rule = layoutCssZ.match(new RegExp("^" + escapeRe(selector) + "\\s*\\{([^}]*)\\}", "m"));
	assert.ok(rule && /z-index:\s*var\(--z-map-panel\)/.test(rule[1]),
		`${selector} liegt auf --z-map-panel -- der Planer UND seine Lasche, sonst verschwindet die`
		+ " Lasche unter dem Bund, sobald sie sich ueberschneiden");
});
assert.ok(/#map-corner-actions\s*\{[^}]*z-index:\s*var\(--z-map-ui\)/.test(legalCssZ),
	"der Knopfbund bleibt auf --z-map-ui -- er ist die Kartenbedienung, nicht das Panel");

// ---- Alle Dropdowns tragen EINE Groesse -- und die ist NICHT die iOS-Schwelle -------------------
//
// Owner 11.08.2026: erst "die unterschiedlichen schriftgroessen der dropdowns", dann "alle auf 14px";
// Owner 05.09.2026: "--font-size-dropdown auf 12px" -- so gross wie die Beschriftungen daneben.
// 💣 Deshalb ein EIGENER Token. --font-size-control traegt die iOS-Schwelle (>=16px, sonst zoomt
// Safari beim Fokus in ein Eingabefeld). Haette man den auf 14 gesetzt, waeren Wegpunktfeld und
// Zahlenfelder mit unter die Schwelle gerutscht -- also genau das zurueckgeholt, was zwei Commits
// vorher behoben wurde.
// 🔴 GEPRUEFT WIRD DIE TRENNUNG, NICHT DER WERT. Hier stand `dropdownGroesse[1] !== controlFont[1]`
//    -- ein Vergleich zweier ZAHLEN. Seit dem 05.09.2026 sind beide am Zeiger 12px, und die
//    Zusicherung waere rot geworden, obwohl die Trennung heil ist: der Finger-Block hebt NUR
//    --font-size-control. Gefragt ist also, ob der Dropdown-Token unabhaengig deklariert ist und
//    vom Finger-Block in Ruhe gelassen wird -- gleiche Werte sind erlaubt, gemeinsame Herkunft
//    nicht.
const dropdownDeklaration = tokens.match(/--font-size-dropdown:\s*([^;]+);/);
assert.ok(dropdownDeklaration, "tokens.css definiert --font-size-dropdown");
assert.ok(!/--font-size-control/.test(dropdownDeklaration[1]),
	"und zwar OHNE --font-size-control zu lesen -- der traegt die iOS-Schwelle und springt am Finger"
	+ " auf 16px, was jede Combobox mitnaehme: " + dropdownDeklaration[1].trim());
// ⚠️ UND DIE GEGENRICHTUNG: der Feld-Token darf den Dropdown-Token ebenso wenig lesen.
//    Heute waere das folgenlos (der coarse-Block setzt --font-size-control ohnehin auf 16px),
//    aber es macht aus zwei Gruenden EINEN Wert -- und beim naechsten Dropdown-Entscheid folgten
//    die Eingabefelder am Zeiger stillschweigend mit.
const controlDeklaration = tokens.match(/--font-size-control:\s*([^;]+);/);
assert.ok(controlDeklaration && !/--font-size-dropdown/.test(controlDeklaration[1]),
	"--font-size-control liest NICHT --font-size-dropdown -- zwei Token, zwei Gruende: "
	+ (controlDeklaration ? controlDeklaration[1].trim() : "keine Deklaration"));
assert.ok(!/--font-size-dropdown/.test(coarse),
	"…und der Finger-Block laesst ihn in Ruhe -- sonst waere die Trennung der zwei Token wirkungslos");
[".transport-combobox", ".transport-combobox__label", ".transport-combobox__option span"]
	.forEach((selector) => {
		const rule = planner.match(new RegExp("^" + escapeRe(selector) + "\\s*\\{([^}]*)\\}", "m"));
		assert.ok(rule, `Regel fuer ${selector} gefunden`);
		assert.ok(/font-size:\s*var\(--font-size-dropdown\)/.test(rule[1]),
			`${selector} liest --font-size-dropdown -- der sichtbare Text der Combobox steckt im __label,`
			+ " eine Zusicherung nur auf dem Knopf liefe daran vorbei");
	});
assert.ok(/\.route-planner-options-panel select \{[^}]*font-size:\s*var\(--font-size-dropdown\)/.test(planner),
	"die nativen Auswahlfelder ebenfalls -- sie sind Dropdowns, keine Tippfelder");

// ---- Ueberlaeufe kuerzen mit „…", statt aus dem Panel zu brechen ---------------------------------
//
// 💣 Das Kuerzen allein reicht nicht: gemessen ragte die Reisebeginn-Zeile auf 360px Schirm 45px
// hinaus, weil Zeile und <label> als Flex-Elemente `min-width: auto` tragen und damit nicht unter
// ihre Inhaltsbreite koennen. Erst min-width: 0 an der Kette macht aus dem Ueberlauf ein Kuerzen.
assert.ok(/\.route-planner-options-panel__row,[\s\S]{0,80}label \{[^}]*min-width:\s*0/.test(planner),
	"Zeile UND label duerfen schrumpfen -- sonst schieben sie hinaus, statt zu kuerzen");
const kuerzt = planner.match(/\.route-planner-options-panel select,[\s\S]{0,60}\{([^}]*)\}/);
assert.ok(kuerzt && /text-overflow:\s*ellipsis/.test(kuerzt[1]) && /overflow:\s*hidden/.test(kuerzt[1]),
	"und der Ueberhang endet mit … (ellipsis braucht overflow: hidden)");

// ---- Die Auswahlfelder tragen unsere Schrift, nicht die des Betriebssystems ----------------------
//
// 💣 `getComputedStyle` verschweigt das: ein natives <select> (appearance: auto) ist ein Widget des
// Betriebssystems und malt seinen Text mit DESSEN Schrift -- gemeldet wird trotzdem brav die
// CSS-Vorgabe. Owner 11.08.2026: "bist du dir sicher, dass die gleich gross sind? ... die schriften
// mein ich". Waren sie nicht. Erst `appearance: none` gibt die Schrift an die Seite zurueck.
// ⚠️ NACHTRAG 11.08.2026: seit Monat und Unterbringung Comboboxen sind, ist im Optionsteil des
// Planers KEIN sichtbares <select> mehr uebrig -- die beiden stecken versteckt in ihren Huellen. Die
// folgenden drei Zusicherungen halten damit eine Regel fest, die im Moment nichts BEMALT. Sie bleiben
// trotzdem stehen: sie sind der Bauplan fuer das naechste native Auswahlfeld, das hier landet, und
// die Chevron-Zusicherung darunter gilt weiterhin dem Meldedialog, der eins hat. Die lebende
// Zusicherung fuer die zwei ist der Abschnitt „Reisemonat und Unterbringung SIND die Combobox".
// 💣 Ueber den INHALT gesucht, nicht ueber den Zeilenanfang. `.route-planner-options-panel select`
// steht auch als ZWEITE Zeile einer Selektorliste (zusammen mit input[type=number]) -- ein
// ^-Anker greift die und liefert den falschen Rumpf. Das ist in dieser Datei die dritte
// Zusicherung, die auf genau diese Weise danebengriff (vorher .planner-group__toggle und
// .transport-combobox); wer hier eine neue schreibt, sucht nach dem Rumpf, nicht nach der Zeile.
const planerSelect = planner.match(
	/\.route-planner-options-panel select \{([^}]*appearance:\s*none[^}]*)\}/);
assert.ok(planerSelect, "die Auswahlfelder des Planers haben eine eigene Regel mit appearance");
assert.ok(/appearance:\s*none/.test(planerSelect[1]) && /-webkit-appearance:\s*none/.test(planerSelect[1]),
	"sie sind KEIN natives Systemwidget mehr -- sonst malt das System den Text");
assert.ok(/background-image:\s*var\(--avesmaps-select-chevron\)/.test(planerSelect[1]),
	"und tragen den Pfeil aus dem Token");

// 💣 EIN Zeichen, nicht zwei. Zwei Data-URIs waeren zwei Bilder, deren Farbe getrennt altert.
const chevron = tokens.match(/--avesmaps-select-chevron:\s*url\(/);
assert.ok(chevron, "das Pfeil-Zeichen steht als Token in tokens.css");
const reportCss = withoutComments(read("css", "components", "location-report-dialog.css"));
[["route-planner.css", planner], ["location-report-dialog.css", reportCss]].forEach(([name, css]) => {
	assert.ok(!/background-image:\s*url\("data:image\/svg/.test(css),
		`${name} traegt den Pfeil NICHT als eigenen Data-URI -- beide lesen den Token`);
});

// ---- Reisemonat und Unterbringung SIND die Combobox, sie sehen ihr nicht nur aehnlich -----------
//
// Owner 11.08.2026, mit Pfeil im Bild von den zwei Auswahlfeldern auf „Lastensegler". Gleiche Hoehe
// (32) und gleiche Schrift (14) fallen deshalb nicht durch abgeschriebene Zahlen zusammen, sondern
// weil es ein Bauteil ist. Genau das haelt dieser Abschnitt fest -- eine Zusicherung auf „height:
// 32px" waere die Divergenz, die sie verhindern soll.
// (`uiControls` ist weiter oben schon gelesen -- eine zweite Deklaration desselben Namens ist auf
//  oberster Ebene ein Syntaxfehler, kein stiller Ueberschreiber.)
const config = withoutComments(read("js", "config.js"));

// 💣 Die Anmeldung ist ABGELEITET: es gibt keine zweite Liste „welche Selects sind Comboboxen",
// die man beim naechsten Eintrag vergessen koennte.
assert.ok(/const ICON_TRANSPORT_SELECT_IDS\s*=\s*Object\.keys\(TRANSPORT_ICON_PATHS\)/.test(config),
	"ICON_TRANSPORT_SELECT_IDS liest die SCHLUESSEL von TRANSPORT_ICON_PATHS -- eine zweite,"
	+ " handgepflegte Liste waere die, die beim naechsten Eintrag vergessen wird");

const iconTabelle = config.match(/const TRANSPORT_ICON_PATHS\s*=\s*\{[\s\S]*?\n\};/);
assert.ok(iconTabelle, "TRANSPORT_ICON_PATHS ist auffindbar");
["travelStartMonth", "travelLodging"].forEach((selectId) => {
	const eintrag = iconTabelle[0].match(new RegExp(escapeRe(selectId) + ":\\s*\\{([^}]*)\\}"));
	assert.ok(eintrag,
		`${selectId} steht in TRANSPORT_ICON_PATHS -- ohne den Eintrag ist es kein Bauteil, sondern`
		+ " wieder ein natives Auswahlfeld, das nur so aussieht");
	assert.strictEqual(eintrag[1].trim(), "",
		`${selectId} traegt KEINE Zeichen -- fuer dreizehn Monate und vier Unterkuenfte gibt es keine,`
		+ " und ein erfundener Platzhalter waere schlechter als keiner");
});

// 💣 Das Zeichen ist damit optional, und das <img> darf nur entstehen, wenn es eine Quelle gibt:
// ein <img> ohne src ist kein leerer Platz, sondern das kaputte Bildsymbol des Browsers.
const optionBauer = uiControls.match(/function createTransportOptionButton\([\s\S]*?\n\}/);
assert.ok(optionBauer, "createTransportOptionButton ist auffindbar");
assert.ok(/if \(iconPath\) \{[\s\S]*?createElement\("img"\)/.test(optionBauer[0]),
	"das <img> entsteht nur, WENN es einen Pfad gibt -- sonst baut die Liste dreizehn kaputte"
	+ " Bildsymbole, und `alt=\"\"` versteckt die nur vor Vorleseprogrammen, nicht vor dem Auge");

// 🔴 DIE tragende Zusicherung dieses Abschnitts. jQuerys `trigger("change")` ruft NUR jQuery-gebundene
// Zuhoerer auf; native `addEventListener("change")` bleiben stumm. Das Haus weiss das
// (js/app/visitor-tracking.js umgeht es), und am 11.08.2026 haben zwei native Zuhoerer es sofort
// vorgefuehrt: der Reisetag blieb nach der Monatswahl ausgegraut (map-features-waypoints.js:64) und
// die Kopfzeile der eingeklappten Gruppe zeigte weiter „ohne Reisebeginn"
// (map-features-planner-groups.js:252). Beides lautlos -- die Combobox selbst sah richtig aus.
const uebernahme = uiControls.match(/menuElement\.addEventListener\("click",[\s\S]*?\n\t\}\);/);
assert.ok(uebernahme, "die Uebernahme einer Auswahl ist auffindbar");
assert.ok(/dispatchEvent\(new Event\("change",\s*\{\s*bubbles:\s*true\s*\}\)\)/.test(uebernahme[0]),
	"die Auswahl schickt ein ECHTES change-Ereignis -- es erreicht native UND jQuery-Zuhoerer,"
	+ " und jeden genau einmal (jQuery haengt seine selbst an einen nativen)");
assert.ok(!/\.trigger\("change"\)/.test(uebernahme[0]),
	"und NICHT jQuerys synthetisches trigger(\"change\") daneben -- zwei Ausloeser waeren doppeltes"
	+ " Feuern fuer jeden jQuery-Zuhoerer");

// 💣 Ueber den RUMPF gesucht und mit gestrippten Kommentaren: `withoutComments` schneidet seit dem
// 11.08.2026 auch <!-- --> heraus. Der erklaerende Kommentar neben dem Monat nennt selbst
// `transport-native-select` und `<select>` -- ohne das Strippen haette diese Zusicherung ihn
// gefunden statt des Markups. In dieser Datei ist das die fuenfte Zusicherung dieser Bauart.
// Die dritte Spalte ist die ZAHL der Eintraege. 💣 Sie steht hier, weil „traegt ueberhaupt ein
// <option>" nicht beisst: die Mutation „eine Option geloescht" lief damit gruen durch, und genau so
// verschwindet ein Monat, ohne dass es jemandem auffaellt -- die Combobox sieht weiter richtig aus.
// 13 = „Unbekannt (keine Jahreszeiten)" + die zwoelf aventurischen Monate; die zwoelf sind gesetzt,
// die vier Unterkuenfte sind eine Wahl. Wer eine Stufe ergaenzt, aendert die Zahl hier mit -- das ist
// die Absicht, nicht der Preis.
const NEUE_COMBOBOXEN = [
	["travelStartMonth", "Reisemonat", 13],
	["travelLodging", "Unterbringung", 4],
];
// 💣 NICHT per `[\s\S]*?` von einem `<div class="transport-select-with-icon">` zur id gesucht: das
// Muster griff die ERSTE Huelle der Datei -- eine Transport-Huelle, die ein <img> traegt -- und lief
// von dort bis hierher. Die Zusicherung „kein <img>" meldete damit rot an der richtigen Stelle aus
// dem falschen Grund. Stattdessen an den Huellen zerteilt und jede an ihrem eigenen Ende beschnitten.
const HUELLEN_START = '<div class="transport-select-with-icon';
// 💣 ERST beschneiden, DANN suchen -- nicht umgekehrt. Andersherum reicht das letzte Stueck bis zum
// Dateiende, und die id findet sich dann auch in einer FREMDEN Huelle: waere das Markup wieder
// unverpackt, meldete der Test „Knopf und Menue fehlen" statt „gar keine Huelle" und schickte den
// naechsten an die falsche Stelle. (Er wuerde rot -- aber aus dem falschen Grund, und das ist die
// halbe Miete eines Tests.)
function huelleVon(selectId) {
	return indexHtml.split(HUELLEN_START)
		.map((teil) => {
			// Bis zum Ende des Menues: das ist das letzte Kind der Huelle, danach faengt fremdes Markup an.
			const menue = teil.indexOf('class="transport-combobox__menu"');
			return menue < 0 ? "" : teil.slice(0, teil.indexOf("</div>", menue) + 6);
		})
		.find((huelle) => new RegExp('id="' + escapeRe(selectId) + '"').test(huelle)) || null;
}

NEUE_COMBOBOXEN.forEach(([selectId, name, eintraege]) => {
	const huelle = huelleVon(selectId);
	assert.ok(huelle, `${name} steckt in der Huelle .transport-icon-select`);
	assert.ok(new RegExp('id="' + escapeRe(selectId) + '" class="transport-native-select"').test(huelle),
		`${name}: das <select> traegt transport-native-select (display: none) -- es BLEIBT die Wahrheit`
		+ " und wird nur versteckt");
	assert.ok(new RegExp('id="' + escapeRe(selectId) + 'Button" class="transport-combobox"').test(huelle)
		&& new RegExp('id="' + escapeRe(selectId) + 'Menu" class="transport-combobox__menu"').test(huelle),
		`${name} hat Knopf und Menue des Bauteils`);
	assert.ok(!/<img/.test(huelle),
		`${name} traegt kein <img> -- die vier Transportmittel haben eins, diese beiden nicht`);
	assert.strictEqual((huelle.match(/<option\s/g) || []).length, eintraege,
		`${name}: ${eintraege} Eintraege stehen als <option> im MARKUP. 🔴 Acht Stellen lesen`
		+ " `.options`, um an die Namen zu kommen (route-plan-calendar.js, review-path-seasons.js,"
		+ " map-features-layer-state.js ...) -- eine Liste in JS waere die zweite Wahrheit, und ein"
		+ " einzelner fehlender Eintrag faellt an der Combobox nicht auf");
});

// 💣 EINE Breitenregel fuer beide, und sie muss gewinnen. Gemessen, bevor es sie gab: der Monat blieb
// bei 192px (die festen 192 von .transport-select-with-icon gewannen, weil die Regel weiter unten
// stand), die Unterbringung landete bei 176px (ihre Regel stand zufaellig noch weiter unten) -- zwei
// Werte fuer dasselbe Ding. Deshalb prueft das hier die SPEZIFITAET, nicht die blosse Anwesenheit.
const breitenRegel = planner.match(
	/\.route-planner-options-panel__row--combobox \.transport-select-with-icon\s*\{([^}]*)\}/);
assert.ok(breitenRegel,
	"eine Regel mit ZWEI Klassen (0,2,0) setzt die Breite -- eine mit einer Klasse verlaeuft sich"
	+ " gegen .transport-select-with-icon (feste 192px)");
assert.ok(/width:\s*auto/.test(breitenRegel[1]) && /flex:\s*1 1 auto/.test(breitenRegel[1])
	&& /min-width:\s*0/.test(breitenRegel[1]),
	"sie loescht die feste Breite, laesst wachsen, und min-width: 0 macht aus dem Ueberlauf ein"
	+ " Kuerzen mit …");
assert.ok(/\.route-planner-options-panel__row--combobox > label\s*\{[^}]*flex:\s*1 1 auto/.test(planner),
	"und das <label> waechst mit -- es ist inline-flex und schrumpft sonst um seinen Inhalt, es"
	+ " gaebe also gar keinen freien Platz, in den die Huelle wachsen koennte");
assert.ok(!/\.planner-travel-start__month\s*\{/.test(planner) && !/\.planner-lodging__select\s*\{/.test(planner),
	"die zwei alten Einzelregeln sind WEG -- sie waren die zwei aehnlichen Formeln, die 192 gegen 176"
	+ " ergaben");

// ---- Der Planer hat eine Hoehe, an der sein overflow-y greift ------------------------------------
//
// Zusicherung 2 aus dem Entwurf (§10): „140dvh kommt nicht zurueck." Gemessen auf 360x640 stand das
// Panel 766px hoch in einem 640er Schirm, 136px hingen unter dem Rand, und sein Scrollweg war 0 --
// stattdessen scrollte die SEITE und trug die Karte weg.
const schmalBlock = layoutCss.match(/@media\s*\(max-width:\s*640px\)\s*\{[\s\S]*?\r?\n\}/);
assert.ok(schmalBlock, "map-layout.css traegt den Block fuer schmale Schirme");
const suchRegel = schmalBlock[0].match(/#search\s*\{([^}]*)\}/);
assert.ok(suchRegel, "und darin eine Regel fuer #search");

const deckel = suchRegel[1].match(/max-height:\s*calc\(\s*([0-9.]+)dvh\s*-\s*([0-9.]+)px\s*\)/);
assert.ok(deckel, "#search bekommt dort einen max-height-Deckel in dvh");
assert.ok(Number(deckel[1]) <= 100,
	`der Deckel steht bei ${deckel[1]}dvh -- ueber 100 ist er hoeher als der Schirm und greift NIE.`
	+ " Genau das war die 140dvh: eine Grenze, die nie zog, und ein Panel, das nicht scrollte.");

// 💣 Die Kopplung, an der die Kette haengt: der Abzug muss den oberen Abstand DECKEN. Sonst endet das
// Panel wieder unter dem Bildrand -- der Fehler kaeme mit einem Deckel zurueck, der korrekt aussieht.
const basisRegel = layoutCss.replace(schmalBlock[0], "").match(/#search\s*\{([^}]*)\}/);
assert.ok(basisRegel, "die Grundregel von #search ist auffindbar");
const obenAb = basisRegel[1].match(/top:\s*([0-9.]+)px/);
assert.ok(obenAb, "sie setzt einen oberen Abstand");
assert.ok(Number(deckel[2]) >= Number(obenAb[1]),
	`der Deckel zieht ${deckel[2]}px ab, das Panel beginnt aber ${obenAb[1]}px unter der Oberkante`
	+ " -- weniger abzuziehen als der Abstand betraegt, laesst es wieder unten hinausragen");
assert.ok(/overflow-y:\s*auto/.test(basisRegel[1]),
	"...und die Grundregel scrollt ueberhaupt -- der Deckel allein taete sonst nichts");

// 🔴 UND DIE FOLGE, DIE DER DECKEL HATTE: #search ist seither ein echter Scroll-Container. Was darin
// `position: fixed` steht, bindet iOS an dessen KASTEN statt an den Bildschirm -- Chrome nicht, das
// folgt hier der Spezifikation. Die Randlasche war ein Kind von #search und verschwand deshalb am
// 11.08.2026 auf dem Telefon des Owners in BEIDEN Zustaenden: zugeklappt sitzt #search bei
// left: -350px und nahm sie mit, aufgeklappt lag sie bei 350..380 ausserhalb der 0..350 des Panels
// und wurde von `overflow-x: hidden` weggeschnitten. Sie steht jetzt NEBEN dem Panel, so wie
// `avesmaps-infopanel__handle` seit jeher direkt am <body> haengt -- die Lasche, die auf demselben
// Foto zu sehen war.
// 💣 Ueber die div-BILANZ geprueft, nicht per Regex auf Verschachtelung: eine Bilanz von -1 heisst,
// dass zwischen dem oeffnenden Tag von #search und der Lasche ein </div> mehr steht als <div> --
// #search ist also zu. Kommentare sind vorher raus, sonst zaehlt Prosa mit.
const searchOffen = indexHtml.indexOf('<div id="search"');
const laschePos = indexHtml.indexOf('<button id="toggle-button"');
assert.ok(searchOffen > -1 && laschePos > searchOffen,
	"#search und die Randlasche sind im Markup auffindbar, in dieser Reihenfolge");
const dazwischen = indexHtml.slice(searchOffen + '<div id="search"'.length, laschePos);
const divBilanz = (dazwischen.match(/<div\b/g) || []).length - (dazwischen.match(/<\/div>/g) || []).length;
assert.ok(divBilanz <= -1,
	`die Randlasche steht INNERHALB von #search (div-Bilanz ${divBilanz}, erwartet <= -1). Seit #search`
	+ " einen Deckel hat, scrollt es -- und ein `position: fixed` in einem Scroll-Container ist auf iOS"
	+ " an dessen Kasten gebunden, nicht an den Bildschirm. Die Lasche war damit unsichtbar, in beiden"
	+ " Zustaenden. Sie gehoert NEBEN das Panel, wie avesmaps-infopanel__handle.");

// 🔴 Ein DECKEL, keine feste Hoehe, und der Ankerpunkt bleibt stehen. `top: 0; height: 100dvh` war der
// Versuch vom 10.08.2026: er schiebt das Panel auch mit wenig Inhalt an beide Kanten, und daran hing
// die Kettenreaktion (Kartenecke unter dem Panel, Lasche entkoppelt, Stapelzahl der Ecke veraltet).
// 💣 Ueber die Deklarations-NAMEN geprueft, nicht per Regex auf "height:" -- `max-height` enthaelt das
// Wort und liefe einer naiven Suche als Treffer durch.
const gesetzt = suchRegel[1].split(";").map((d) => d.split(":")[0].trim()).filter(Boolean);
["height", "top", "bottom"].forEach((eigenschaft) => {
	assert.ok(!gesetzt.includes(eigenschaft),
		`der schmale Fall setzt \`${eigenschaft}\` NICHT -- er gibt dem Panel nur einen Deckel.`
		+ " Eine feste Hoehe oder ein verschobener Anker zieht die Kartenecke, die Lasche und die"
		+ " Stapelzahl hinter sich her; ein max-height bewegt nachweislich keins davon.");
});

// ---- Die Etappen-Box ist kein Stossdaempfer, und sie scrollt nicht fuer sich ---------------------
//
// Owner 11.08.2026 mit Foto vom Telefon: „das kleine platzhalter feld fuer die etappen hat kaum eine
// mindesthoehe und man muss scrollen fuer 2 zeilen text ... das routenergebnis feld muss eigentlich
// nicht scrollbar sein denn der ganze routenplaner hat einen scrollbalken."
// 💣 Das war EIN Fehler mit zwei Gesichtern: als Flex-Kind von #search mit dem voreingestellten
// `flex-shrink: 1` war #overview der STOSSDAEMPFER des Panels -- alles ueber dessen Deckel wurde aus
// ihr herausgequetscht (gemessen 60 -> 33px) --, und ihr eigener `overflow-y: auto` machte daraus
// einen zweiten Rollbalken statt sichtbaren Text. Ohne Schrumpfen braucht sie keine `min-height`:
// sie ist so hoch wie ihr Inhalt (nachgemessen 60px bei 58px Inhalt, kein eigener Rollbalken).
const overviewCss = withoutComments(read("css", "features", "route-overview.css"));
const overviewRegel = overviewCss.match(/#overview\s*\{([^}]*)\}/);
assert.ok(overviewRegel, "die Regel fuer #overview ist auffindbar");
assert.ok(/flex:\s*0 0 auto/.test(overviewRegel[1]),
	"#overview schrumpft NICHT (flex: 0 0 auto) -- mit flex-shrink: 1 ist es der Stossdaempfer des"
	+ " Panels, und zwei Zeilen Text landen in einem 33px-Kasten");
const overviewGesetzt = overviewRegel[1].split(";").map((d) => d.split(":")[0].trim());
["overflow", "overflow-y", "overflow-x", "max-height"].forEach((eigenschaft) => {
	assert.ok(!overviewGesetzt.includes(eigenschaft),
		`#overview setzt \`${eigenschaft}\` NICHT -- gedeckelt und gescrollt wird eine Ebene hoeher, bei`
		+ " #search. Zwei Rollbalken uebereinander sind genau der Zustand, den der Owner gemeldet hat."
		+ " ⚠️ Eine Achse auf `auto` rechnet das `visible` der anderen in `auto` um -- eine einzelne"
		+ " overflow-Zeile bringt den zweiten Balken also in BEIDEN Richtungen zurueck.");
});
// 💣 Und die zweite Grenze im schmalen Fall ist ebenfalls weg: zwei Formeln fuer dieselbe Box sind
// die, von denen man die eine vergisst.
assert.ok(!/#overview/.test(schmalBlock[0]),
	"der Block fuer schmale Schirme setzt KEINE eigene Hoehengrenze fuer #overview mehr");

// ---- Am ZEIGER rollt nur die Uebersicht, und nur mit Ergebnis (12.08.2026) -----------------------
//
// Owner: „auf dem desktop haben wir in der höhe genug platz NUR die reiseübersicht (und co.)
// scrollen zu lassen." Der Rollbalken des Panels springt beim Erscheinen und schiebt JEDE Zeile um;
// rollt nur das Ergebnis, trifft der Sprung eine Box.
const eigenerLauf = overviewCss.match(/html:not\(\.avesmaps-phone\) #overview:has\(\*\)\s*\{([^}]*)\}/);
assert.ok(eigenerLauf, "am Zeiger rollt die Uebersicht fuer sich, sobald ein Ergebnis drinsteht");
assert.ok(/overflow-y:\s*auto/.test(eigenerLauf[1]), "...sie rollt");
assert.ok(/flex:\s*1 1 auto/.test(eigenerLauf[1]), "...und nimmt den uebrigen Platz");

// 💣 DIE MINDESTHOEHE IST DER GANZE UNTERSCHIED ZUM FEHLER VOM 11.08.2026. Damals rollte diese Box
// auch -- weil sie mit `flex-shrink: 1` zum Stossdaempfer wurde und alles ueber dem Panel-Deckel aus
// ihr herausgequetscht wurde (60 -> 33px, zwei Zeilen Text in einem 33px-Kasten). Mit `flex: 1 1
// auto` OHNE Boden waere exakt das zurueck. Der Boden ist die Zeile, die „nimmt Platz" von
// „wird zusammengedrueckt" unterscheidet.
assert.ok(/min-height:\s*\d/.test(eigenerLauf[1]),
	"...und hat einen BODEN -- ohne ihn ist sie wieder der Stossdaempfer des Panels (11.08.2026)");

// 💣 `:has(*)`, nicht pauschal: ohne Route traegt die Box nur einen Textknoten und soll so kompakt
// bleiben wie bisher (Owner: „da soll das zunächst die box sein, die sie jetzt ist"). Ein leerer
// 220px-Kasten unter den Eingabefeldern waere das Gegenteil.
assert.ok(/#overview:has\(\*\)/.test(overviewCss),
	"die Regel greift nur mit Ergebnis im Kasten, nicht im leeren Zustand");
// ⚠️ Und nur am Zeiger: am Telefon rollt das ganze Panel, eine zweite Rollflaeche darin waere ein
// zweiter Balken.
assert.ok(/html:not\(\.avesmaps-phone\)/.test(eigenerLauf.input.slice(0, eigenerLauf.index + 60)),
	"und nur am Zeiger -- am Telefon rollt das Panel als Ganzes");

// ---- Am Telefon ist nur EIN Panel offen ----------------------------------------------------------
//
// Owner 11.08.2026 mit Foto: das Infopanel lag ueber dem aufgeklappten Routenplaner. Am Zeiger duerfen
// beide nebeneinander stehen -- dort ist Platz.
const plannerToggle = withoutComments(read("js", "ui", "route-planner-toggle.js"));
const infopanelJs = withoutComments(read("js", "map-features", "map-features-infopanel.js"));

// 💣 EIN Weg fuer beide Richtungen. Vorher stand die Bewegung nur im Klick-Zuhoerer; ein zweiter
// Aufrufer haette sie abschreiben muessen, und zwei Fassungen derselben Animation laufen auseinander.
const fahrweg = plannerToggle.match(/function setRoutePlannerCollapsed\([\s\S]*?\n\}/);
assert.ok(fahrweg, "es gibt EINEN Weg, den Planer auf- und zuzufahren");
assert.ok(/if \(collapsed === isSearchPanelHidden\) \{\s*return;/.test(fahrweg[0]),
	"🔴 der Riegel gegen Ping-Pong: schon in diesem Zustand -> nichts tun. Ohne ihn ruft der Planer"
	+ " beim Aufgehen das Infopanel zu, dessen sync() ruft hierher zurueck, und das schaukelt sich auf.");
assert.ok(/if \(!collapsed &&[\s\S]{0,220}avesmapsIsPhoneViewport\(\)[\s\S]{0,220}avesmapsInfopanelCollapse\(\)/
	.test(fahrweg[0]),
	"nur beim AUFgehen (!collapsed) und nur am Telefon wird das Infopanel eingeklappt -- Einklappen"
	+ " loest nie ein Aufklappen aus, das ist die zweite Haelfte des Ping-Pong-Riegels");
assert.ok(/window\.avesmapsCollapseRoutePlanner = function/.test(plannerToggle),
	"und es gibt das Gegenstueck, das das Infopanel rufen kann");
assert.ok(/\$\("#toggle-button"\)\.off\("click"\)\.on\("click",[\s\S]{0,160}setRoutePlannerCollapsed\(/
	.test(plannerToggle),
	"die Lasche geht durch denselben Weg -- nicht an ihm vorbei");

// 💣 Der Haken des Infopanels sitzt in sync() -- der EINEN Stelle, durch die jedes Aufgehen laeuft
// (Ort, Weg, Region, Kraftlinie, Route, Etappe). Sechzehn geriegelte Show-*-Funktionen waeren
// sechzehn Gelegenheiten, die naechste zu vergessen.
const syncFn = infopanelJs.match(/function sync\(\) \{[\s\S]*?\n\t\}/);
assert.ok(syncFn, "sync() des Infopanels ist auffindbar");
assert.ok(/avesmapsCollapseRoutePlanner\(\)/.test(syncFn[0]),
	"sync() klappt den Planer ein, wenn das Infopanel aufgeht");
assert.ok(/avesmapsIsPhoneViewport\(\)/.test(syncFn[0]),
	"...aber nur am Telefon -- am Zeiger bleiben beide offen (nachgemessen 1280x800)");
// 💣 Nur am UEBERGANG. sync() laeuft bei JEDEM Inhaltswechsel; ohne den Vergleich mit dem vorherigen
// Stand faehrt der Planer auch dann zu, wenn das Panel laengst offen ist -- wer ihn daneben aufzieht,
// saehe ihn sofort wieder zufallen.
assert.ok(/if \(open && !wasOpen &&/.test(syncFn[0]),
	"und nur am UEBERGANG zu -> auf, nicht bei jedem sync()");
assert.ok(/wasOpen = open;/.test(syncFn[0]) && /var wasOpen = false;/.test(infopanelJs),
	"der vorherige Stand wird dafuer gefuehrt");
// 💣 Gezaehlt wird, ob der Name AUSSERHALB von sync() vorkommt -- nicht, wie oft er insgesamt steht:
// im Haken selbst steht er zweimal (Riegel `typeof ... === "function"` und Aufruf), das ist richtig
// so. Eine feste Zahl waere hier eine Zusicherung auf die Schreibweise statt auf die Regel.
const rufeGesamt = (infopanelJs.match(/avesmapsCollapseRoutePlanner/g) || []).length;
const rufeInSync = (syncFn[0].match(/avesmapsCollapseRoutePlanner/g) || []).length;
assert.strictEqual(rufeGesamt, rufeInSync,
	`avesmapsCollapseRoutePlanner steht ${rufeGesamt - rufeInSync}x AUSSERHALB von sync(). Genau das`
	+ " soll es nicht geben: sync() ist der eine Haken, durch den jedes Aufgehen laeuft. Eine zweite"
	+ " Stelle ist der Anfang der Divergenz, gegen die er ueberhaupt gewaehlt wurde.");

// ---- Die beiden Randlaschen: EIN Bauteil, EIN Satz Maße ------------------------------------------
//
// Owner 11.08.2026: „sowohl das routenplaner-tab als auch das infopanel-tab von oben nach unten
// durchgehen (keine raender/spalten oben und unten mehr)" -- nur am Telefon.
// 💣 Sie sind seit jeher gleich gebaut, standen aber mit denselben drei Zahlen in ZWEI Dateien. Am
// Telefon haette die Hoehe an beiden Enden zugleich wandern muessen -- genau die Divergenz, vor der
// AGENTS.md §12 warnt. Jetzt lesen beide dieselben Token, und der Telefonfall steht an EINER Stelle.
// 🔴 Seit dem 04.09.2026 sind es ZWEI Gruppen mit ZWEI Satz Maßen, und das ist ein Owner-Entscheid:
// der Griff des PLANERS (--avesmaps-tab-*) schrumpft am Telefon auf 26x56, weil er dort ein PFEIL
// ohne Wort ist; die beiden PANEL-REITER "Info" und "Editor" (--avesmaps-paneltab-*) behalten ihre
// 30x140 auch am Telefon, weil sie ihre BESCHRIFTUNG tragen und zu zweit ein Reiterpaar sind
// ("editor und infotab sollten nicht abmessung und groesse der lasche vom routenplaner auf dem
// handy haben. sondern vom desktop"). Die Kopplung gilt weiterhin -- aber INNERHALB jeder Gruppe.
const TAB_TOKEN = ["--avesmaps-tab-top", "--avesmaps-tab-h", "--avesmaps-tab-w",
	"--avesmaps-paneltab-top", "--avesmaps-paneltab-h", "--avesmaps-paneltab-w"];
TAB_TOKEN.forEach((name) => {
	assert.ok(new RegExp(escapeRe(name) + ":\\s*[^;]+;").test(tokens),
		`${name} steht in tokens.css`);
});

const infopanelCss = withoutComments(read("css", "features", "infopanel.css"));
const reviewPanelCss = withoutComments(read("css", "features", "review-panel.css"));
// 💣 `.review-panel-toggle` steht mehrfach am Zeilenanfang (u.a. als Sammelregel mit
// `.review-panel__icon-button`). Gemeint ist die EIGENSTAENDIGE Regel -- die mit `position: fixed`.
[["#toggle-button", layoutCss, "Routenplaner-Griff", "tab"],
 [".avesmaps-infopanel__handle", infopanelCss, "Info-Reiter", "paneltab"],
 [".review-panel-toggle", reviewPanelCss, "Editor-Reiter", "paneltab"]]
	.forEach(([selector, css, name, gruppe]) => {
	const treffer = [...css.matchAll(new RegExp("^" + escapeRe(selector) + "\\s*\\{([^}]*)\\}", "gm"))]
		.map((t) => t[1]).filter((rumpf) => /position:\s*fixed/.test(rumpf));
	assert.strictEqual(treffer.length, 1,
		`die eigenstaendige Regel fuer den ${name} ist genau einmal auffindbar (gefunden: ${treffer.length})`);
	const regel = treffer[0];
	[["top", `--avesmaps-${gruppe}-top`], ["height", `--avesmaps-${gruppe}-h`],
	 ["width", `--avesmaps-${gruppe}-w`]].forEach(([eigenschaft, token]) => {
		assert.ok(new RegExp(eigenschaft + ":\\s*var\\(" + escapeRe(token) + "\\)").test(regel),
			`${name}: \`${eigenschaft}\` liest ${token} statt einer eigenen Zahl -- sonst wandert der eine`
			+ " Reiter am Telefon und der andere bleibt stehen");
	});
});
// 💣 Ohne das sitzt die Beschriftung auf voller Hoehe am oberen Rand: bei `writing-mode:
// vertical-rl` ist die Zeilenachse senkrecht, `text-align` richtet also nach oben/unten aus.
[["#toggle-button", layoutCss, "Routenplaner-Griff"],
 [".avesmaps-infopanel__handle", infopanelCss, "Info-Reiter"]].forEach(([selector, css, name]) => {
	const regel = css.match(new RegExp(escapeRe(selector) + "\\s*\\{([^}]*)\\}"));
	assert.ok(/text-align:\s*center/.test(regel[1]),
		`${name}: die Beschriftung steht mittig -- auf 100dvh klebte sie sonst oben`);
});

// 🔴 Und DAS ist die Zusicherung, die den Entscheid vom 04.09.2026 haelt: der Telefon-Block darf die
// Maße der PANEL-REITER nicht anfassen. Vorher lasen sie --avesmaps-tab-*, schrumpften am Telefon
// auf 26x56 mit -- und der Owner sah zwei Briefmarken an der Kante statt zweier Reiter.
["--avesmaps-paneltab-w", "--avesmaps-paneltab-h", "--avesmaps-paneltab-top"].forEach((name) => {
	const block = tokens.match(/html\.avesmaps-phone\s*\{([^}]*)\}/);
	assert.ok(block && !new RegExp(escapeRe(name) + "\\s*:").test(block[1]),
		`${name} wird am Telefon NICHT ueberschrieben -- die zwei beschrifteten Reiter behalten dort`
		+ " ihre Desktop-Maße (Owner 04.09.2026); nur der Pfeilgriff des Planers schrumpft");
});

// 💣 Der Telefonfall haengt an der KLASSE, nicht an einer Media-Query. „Telefon" ist in diesem Haus
// EINE Definition: avesmapsIsPhoneViewport() misst `pointer: coarse` UND die KURZSEITE (<= 600px) und
// setzt `html.avesmaps-phone`. Eine Breiten-Query traefe ein quer gehaltenes Telefon nicht und ein
// Tablet zu viel.
const telefonBlock = tokens.match(/html\.avesmaps-phone\s*\{([^}]*)\}/);
assert.ok(telefonBlock, "tokens.css traegt den Telefon-Block");
// 🔴 Am Telefon laufen die PANELS von Kante zu Kante -- die LASCHEN nicht. Am 11.08.2026 galt fuer
// wenige Stunden beides; „von oben nach unten durchgehen" war dem Panel gemeint, nicht seinem
// Reiter (Owner: „das Tab sollte nicht veraendert werden"). Eine Lasche ueber 100dvh ist ein
// Balken neben der Karte. Diese Pruefung haelt die Ruecknahme fest.
assert.ok(/--avesmaps-panel-inset-top:\s*0/.test(telefonBlock[1])
	&& /--avesmaps-panel-inset-bottom:\s*0/.test(telefonBlock[1]),
	"am Telefon laufen die PANELS von Kante zu Kante");
assert.ok(!/--avesmaps-tab-top\s*:/.test(telefonBlock[1]),
	"...und die LASCHEN fangen am Telefon dort an, wo sie ueberall anfangen -- der Griff des Planers"
	+ " rueckt seit dem 12.08.2026 in die Mitte, aber das ist eine LAGE (top: 50% + translate) und"
	+ " keine zweite Zahl (css/layout/map-layout.css)");
// 🔴 Die Lehre vom 11.08.2026 in ihrer haltbaren Form: die Lasche darf am Telefon KLEINER werden
// (der Pfeilgriff vom 12.08.2026, Owner am Entwurf abgenommen), aber nie ein Anteil des Schirms --
// genau das war der 100dvh-Balken neben der Karte.
const telefonHoehe = telefonBlock[1].match(/--avesmaps-tab-h:\s*([0-9.]+)(px|dvh|vh|%|em|rem)/);
const grundHoehe = tokens.match(/--avesmaps-tab-h:\s*([0-9.]+)px/);
assert.ok(telefonHoehe && grundHoehe, "beide Hoehen der Lasche sind auffindbar");
assert.strictEqual(telefonHoehe[2], "px",
	`die Telefon-Hoehe der Lasche steht in px (gefunden: ${telefonHoehe[2]}) -- ein Anteil des`
	+ " Schirms macht daraus wieder den Balken vom 11.08.2026");
assert.ok(Number(telefonHoehe[1]) < Number(grundHoehe[1]),
	`...und sie ist kleiner als am Zeiger (${telefonHoehe[1]} < ${grundHoehe[1]})`);
// Der Routenplaner las die Panel-Token lange NICHT: `top: 10px` und `max-height: 95vh` standen als
// eigene Zahlen in map-layout.css, und er blieb deshalb mitten im Bild stehen, waehrend das
// Infopanel gegenueber schon an der Kante klebte.
const planerAmTelefon = layoutCss.match(/html\.avesmaps-phone\s+#search\s*\{([^}]*)\}/);
assert.ok(planerAmTelefon, "der Routenplaner hat eine Telefon-Regel");
assert.ok(/top:\s*var\(--avesmaps-panel-inset-top\)/.test(planerAmTelefon[1])
	&& /bottom:\s*var\(--avesmaps-panel-inset-bottom\)/.test(planerAmTelefon[1]),
	"und liest darin DIESELBEN Token wie das Infopanel gegenueber -- eigene Zahlen liefen auseinander");
assert.strictEqual((tokens.match(/html\.avesmaps-phone\s*\{/g) || []).length, 1,
	"und es gibt genau EINEN solchen Block in tokens.css -- zwei waeren zwei Wahrheiten");

// ---- Der Rollbalken darf die Breite nicht verschieben (12.08.2026) ------------------------------
//
// Owner: „beim aufklappen taucht die scrollbar auf, die alle abmessungen veraendert." Gemessen im
// Panel: ohne Rinne springt die Inhaltsbreite beim Erscheinen des Balkens von 400 auf 385px -- jede
// Zeile bricht neu um, die Tabelle rutscht, und zwar genau in dem Moment, in dem der Finger etwas
// aufklappt. Mit `stable` ist der Platz von Anfang an da: gemessener Sprung 0px.
const panelBody = infopanelCss.match(/^\.avesmaps-infopanel__body\s*\{([^}]*)\}/m);
assert.ok(panelBody, "der Panel-Koerper ist auffindbar");
assert.ok(/overflow-y:\s*auto/.test(panelBody[1]), "er rollt");
assert.ok(/scrollbar-gutter:\s*stable/.test(panelBody[1]),
	"...und haelt den Platz dafuer IMMER frei -- sonst aendert das Aufklappen eines Deckels die"
	+ " Breite aller Zeilen darin");
// ⚠️ BEIDE Rollkaesten der Karte, nicht nur der gemeldete. Der Planer klappt seine Gruppen genauso
// auf und bekommt genauso eine Route hineingeschrieben; die Regel an einer Stelle zu setzen hiesse,
// denselben Fehler halb zu beheben.
// 💣 Und zwar `stable`, NICHT `both-edges`. Die Rinne kommt zusaetzlich zum Padding und nur auf der
// Balkenseite, der Inhalt steht also schief -- das ist hier bewusst in Kauf genommen. `both-edges`
// heilt die Schieflage und kostet den Rand ein zweites Mal (gemessen 28px je Seite statt 18/33);
// im Routenplaner nebenan war genau das dem Owner zu breit (12.08.2026, „bisschen arg breit ist es
// schon jetzt links und rechts"). In DIESEM Panel wiegt der ruhige Umbruch schwerer: es klappt bei
// jedem Deckel auf und zu.
assert.ok(!/both-edges/.test(panelBody[1]),
	"...aber nur auf der Balkenseite -- both-edges kostet den Rand ein zweites Mal");

// ---- Der Routenplaner hat KEINE Rinne, und das ist eine Entscheidung ------------------------------
//
// 🔴 Hier stand am 12.08.2026 fuer wenige Stunden dieselbe Rinne. Sie ist weg, weil bei nativen
// Balken nicht alle drei Wuensche zugleich gehen: symmetrisch, ohne Sprung, schmal. `stable` allein
// stellte den Inhalt schief (10px links gegen 25px rechts), `both-edges` machte beide Raender 20px
// breit -- „bisschen arg breit". Von den dreien ist der SPRUNG der ertraeglichste, deshalb faellt
// die Rinne (Owner: „wir akzeptieren, dass die inhalte nach innen verrutschen").
// ⭐ Am Zeiger stellt sich die Frage ohnehin nicht mehr: dort rollt nur noch die Reiseuebersicht
// (siehe unten), der Sprung trifft also eine Box statt jeder Zeile des Planers.
const planerKasten = layoutCss.match(/^#search\s*\{([^}]*)\}/m);
assert.ok(planerKasten && /overflow-y:\s*auto/.test(planerKasten[1]),
	"der Planer rollt weiterhin -- als Netz fuer den Fall, dass schon die Eingaben zu hoch sind");
assert.ok(!/scrollbar-gutter/.test(planerKasten[1]),
	"...aber ohne reservierte Rinne: der Balken darf Platz nehmen, wenn er kommt");

// ---- Der Planer faehrt beim Start herein, und seine Lasche faehrt MIT (12.08.2026) ---------------
//
// Owner: „das ganze panel von links nach rechts reinfaehrt, wenn das laden fertig ist."
// 💣 Die Lasche steht NEBEN dem Panel, nicht darin (siehe die div-Bilanz weiter oben) -- ein
// `transform` am Panel erreicht sie also nicht. Gemessen blieb sie bei 350..380 stehen und schwebte
// frei auf der Karte, waehrend der Planer draussen war. Beide gehoeren deshalb in DIESELBE Regel:
// zwei Regeln mit derselben Verschiebung waeren zwei Zahlen, die auseinanderlaufen koennen.
const ladeCss = withoutComments(read("css", "features", "loading-bar.css"));
// ⚠️ Knopfbund UND Zoom warten gemeinsam (Owner 12.08.2026). Sie wandern schon gemeinsam, wenn die
// Infobox aufgeht (infopanel.css) -- zwei Regeln fuer dasselbe Warten liefen beim naechsten Anfassen
// auseinander.
const wartende = ladeCss.match(/^html\.avesmaps-booting #map-corner-actions,\s*html\.avesmaps-booting \.leaflet-control-zoom\s*\{([^}]*)\}/m);
assert.ok(wartende, "Knopfbund und Zoom stehen in DERSELBEN Warteregel");
assert.ok(/opacity:\s*0/.test(wartende[1]) && !/display:\s*none/.test(wartende[1]),
	"...und warten ausgeblendet, nicht ausgebaut -- der Bund wird gemessen (syncMapCornerStack)");
const einfahrt = ladeCss.match(/^html:not\(\.avesmaps-phone\)\.avesmaps-booting #search,\s*html:not\(\.avesmaps-phone\)\.avesmaps-booting #toggle-button\s*\{([^}]*)\}/m);
assert.ok(einfahrt,
	"Panel UND Lasche stehen in derselben Startstellungs-Regel -- die Lasche haengt nicht im Panel,"
	+ " sie muss eigens mitbewegt werden");
assert.ok(/transform:\s*translateX\(calc\(-1 \* var\(--avesmaps-planner-width\)\)\)/.test(einfahrt[1]),
	"...und beide um dieselbe Panelbreite, aus dem Token statt als Zahl");
// 💣 Und die RUHESTELLUNG der Lasche liest denselben Token. Bis zum 19.08.2026 stand hier
// `left: 350px` als Zahl, waehrend die Startstellung darueber um den Token verschob -- zwei Werte
// fuer dieselbe Panelbreite. Solange beide 350 meinten, fiel nichts auf; wer den Token verstellt,
// haette den Planer wandern und die Lasche stehen sehen, und die Einfahrt oben waere neben der
// Panelkante gelandet. Die Startstellung ist die Ruhestellung MINUS diese Breite -- das geht nur
// auf, wenn beide dieselbe Quelle lesen.
const laschenRuhe = layoutCss.match(/^#toggle-button\s*\{([^}]*)\}/m);
assert.ok(laschenRuhe, "die Ruheregel der Lasche ist auffindbar");
assert.ok(/left:\s*var\(--avesmaps-planner-width\)/.test(laschenRuhe[1]),
	"die Lasche steht an der Panelkante, aus dem Token -- als Zahl liefe sie beim ersten"
	+ " Verstellen von der Startstellung weg, die denselben Token verschiebt");
// ⚠️ `transform`, nicht `left`: das Auf- und Zuklappen animiert `left` inline per jQuery, eine
// CSS-Transition darauf interpolierte jeden Schritt ein zweites Mal.
["#search", "#toggle-button"].forEach((selektor) => {
	const regel = layoutCss.match(new RegExp("^" + escapeRe(selektor) + "\\s*\\{([^}]*)\\}", "m"));
	assert.ok(regel && /transition:[^;]*transform 0\.22s/.test(regel[1]),
		`${selektor} faehrt in 0.22s -- gleiche Dauer fuer beide, sonst kommt eins zuerst an`);
	assert.ok(!/transition:[^;]*[^-]left\s/.test(regel[1]),
		`${selektor} laesst \`left\` in Ruhe -- das animiert jQuery`);
});
// 🔴 Und die Klasse muss wieder fallen, egal was passiert: das Sicherheitsnetz in loading-bar.js
// traegt seit dem 12.08.2026 mehr als den Balken.
const ladeJs = withoutComments(read("js", "app", "loading-bar.js"));
assert.ok(/function bootBeenden\(\)[\s\S]{0,200}classList\.remove\("avesmaps-booting"\)/.test(ladeJs),
	"es gibt EINE Stelle, die den Startlauf beendet");
assert.ok(/setTimeout\(bootBeenden,\s*\d+\)/.test(ladeJs),
	"...und das Zeitnetz ruft SIE, nicht nur dec('boot') -- sonst bliebe der Planer bei einem Fehler"
	+ " draussen und der Knopfbund unsichtbar");

// ---- Der Rand zur Karte ist EINE Zahl, und der Panel-Rand ist daraus ABGELEITET ------------------
//
// Owner 11.08.2026: „hinweise und der untere rand vom infopanel sind 3px auseinander -> gleich
// abschliessen" (gemessen waren es 2: Panel 786, Knopfbund 788). Ursache waren zwei Zahlen, die
// dasselbe meinten -- `bottom: 14px` am Panel gegen `bottom: 12px` am Bund.
assert.ok(/--avesmaps-edge-gap:\s*[0-9.]+px/.test(tokens),
	"--avesmaps-edge-gap steht in tokens.css -- der Abstand zum Kartenrand");
// 💣 ABGELEITET, nicht abgeschrieben. Ein zweites `12px` sähe heute richtig aus und liefe beim
// naechsten Anfassen auseinander -- genau so ist die 14 entstanden.
assert.ok(/--avesmaps-panel-inset-bottom:\s*var\(--avesmaps-edge-gap\)/.test(tokens),
	"der untere Panel-Rand RECHNET sich aus dem Kartenrand -- als eigene Zahl koennte er wieder"
	+ " danebenliegen, und genau das war der gemeldete Versatz");

const KANTEN_LESER = [
	[infopanelCss, ".avesmaps-infopanel", "bottom", "--avesmaps-panel-inset-bottom", "Infopanel"],
	[infopanelCss, ".avesmaps-infopanel", "top", "--avesmaps-panel-inset-top", "Infopanel oben"],
	[legalCss, "#map-corner-actions", "bottom", "--avesmaps-edge-gap", "Knopfbund"],
];
KANTEN_LESER.forEach(([css, selector, eigenschaft, token, name]) => {
	const regel = css.match(new RegExp(escapeRe(selector) + "\\s*\\{([^}]*)\\}"));
	assert.ok(regel, `die Regel fuer ${name} ist auffindbar`);
	assert.ok(new RegExp(eigenschaft + ":\\s*var\\(" + escapeRe(token) + "\\)").test(regel[1]),
		`${name}: \`${eigenschaft}\` liest ${token} statt einer eigenen Zahl`);
});
// Das Editorpanel haengt per Owner-Vorgabe am selben unteren Rand wie die Infobox. Die Vorgabe war
// als ZAHL formuliert und haette beim naechsten Anfassen still aufgehoert zu gelten.
assert.ok(/#review-panel\s*\{[^}]*bottom:\s*var\(--avesmaps-panel-inset-bottom\)/.test(infopanelCss),
	"das Editorpanel liest denselben Panel-Rand -- die Kopplung steht jetzt im Code, nicht nur im Kommentar");
// Und der Zoom rechnet seinen Abstand ebenfalls daraus, statt die 12 ein drittes Mal zu kennen.
assert.ok(/bottom:\s*calc\(var\(--avesmaps-edge-gap\)\s*\+\s*var\(--avesmaps-corner-stack\)\)/.test(infopanelCss),
	"der Zoom rechnet Kartenrand + Stapelhoehe, statt die Zahl abzuschreiben");

// 🔴 Am Telefon fallen NUR die Panel-Raender weg, nicht der Kartenrand. Owner: „im mobile full
// height" -- das gilt den Panels. Zoege der Telefon-Block auch --avesmaps-edge-gap auf 0, klebten
// „Neuigkeiten" und „Hinweise" am Bildschirmrand.
assert.ok(/--avesmaps-panel-inset-top:\s*0/.test(telefonBlock[1])
	&& /--avesmaps-panel-inset-bottom:\s*0/.test(telefonBlock[1]),
	"am Telefon laufen die Panels von Kante zu Kante");
assert.ok(!/--avesmaps-edge-gap\s*:/.test(telefonBlock[1]),
	"...aber der KARTENRAND bleibt stehen -- sonst klebte der Knopfbund am Bildschirmrand");

// ---- Die Suchkachel steht auch am Zeiger, und der Zoom weicht ihr MESSEND aus --------------------
//
// Owner 11.08.2026: „der Suchen button kommt uebrigens gut an, wir wollen dass der auch schnell aufm
// desktop verfuegbar ist und die kachel zwischen zoom und den hinweisbuttons platzieren. allerdings
// brauchen wir hier nicht die animation."
// ⚠️ Die Kachel darf in einer SELEKTORLISTE stehen -- seit dem 12.08.2026 tut sie das (der
// Anzeige-Knopf ist ihr Nachbar in derselben Spalte und teilt sich ihre Groesse). Die Zusicherung
// suchte vorher eine Regel, die mit `#map-search-button {` beginnt, und wurde von dem Komma rot,
// obwohl die Kachel unveraendert sichtbar ist. Geprueft wird deshalb: IRGENDEINE Regel, deren
// Selektorliste mit ihr anfaengt, macht sie sichtbar.
const kachelRegeln = legalCss.match(/^#map-search-button[^{]*\{[^}]*\}/gm) || [];
assert.ok(kachelRegeln.some((regel) => /display:\s*inline-flex/.test(regel)),
	"die Suchkachel ist sichtbar -- an BEIDEN Zeigern");
assert.ok(!/@media\s*\(pointer:\s*coarse\)\s*\{[^}]*#map-search-button/.test(legalCss),
	"und nicht mehr per (pointer: coarse) freigeschaltet -- der Riegel ist weg, nicht umgedreht");

// 💣 DIE ZAHL WIRD GEMESSEN, NICHT GEPFLEGT. Der Bund ist mit der Kachel von 32 auf 86px gewachsen;
// der Zoom rechnet seinen Abstand aus --avesmaps-corner-stack. Stand die Zahl weiter als Literal im
// Stylesheet, saesse er mitten auf der Kachel -- dieselbe Falle wie am 10.08.2026, nur groesser
// (damals 8px daneben). Gemessen nach dem Umbau: Zoom 640..696, Kachel 702..750, Verweise 756..788,
// Ueberlappung 0.
const stapel = uiControls.match(/function syncMapCornerStack\(\)[\s\S]*?\n\}/);
assert.ok(stapel, "es gibt die Messung der Bundhoehe");
assert.ok(/getElementById\("map-corner-actions"\)/.test(stapel[0])
	&& /getBoundingClientRect\(\)\.height/.test(stapel[0]),
	"sie misst den BUND selbst -- ausrechnen hiesse Kachelhoehe + Luecke + Zeilenhoehe, drei Zahlen,"
	+ " von denen die naechste wieder vergessen wird");
assert.ok(/documentElement\.style\.setProperty\("--avesmaps-corner-stack"/.test(stapel[0]),
	"und schreibt sie als Inline-Stil auf <html> -- das schlaegt Grundwert UND Media-Query ohne !important");
assert.ok(/new ResizeObserver\(syncMapCornerStack\)/.test(uiControls),
	"ein ResizeObserver haengt am Bund -- er waechst im Betrieb (gestapelte Verweiszeile bei offener"
	+ " Infobox auf schmalem Schirm)");

// 💣 Der zweite Fund desselben Umbaus: `positionSpotlightAtSearchTile` schloss aus der BREITE der
// Kachel auf den Zeiger (sie war dort `display: none`, also 0 breit). Seit sie auch am Zeiger steht,
// ist das falsch. Folgenlos war es nur zufaellig -- die Variable wird ausschliesslich im
// (pointer: coarse)-Block gelesen.
const lageFn = spotlightJs.match(/function positionSpotlightAtSearchTile\s*\([\s\S]*?\n\}/);
assert.ok(lageFn && /matchMedia\("\(pointer: coarse\)"\)\.matches/.test(lageFn[0]),
	"die Verankerung am Kachelrechteck fragt den ZEIGER, nicht die Kachelbreite");
assert.ok(lageFn[0].indexOf("matchMedia") < lageFn[0].indexOf("getBoundingClientRect"),
	"und zwar BEVOR sie misst -- sonst haengt das Ergebnis wieder daran, ob die Kachel gerade da ist");

// ⚠️ Die Aufklapp-Bewegung bleibt am Finger. Owner: „hier brauchen wir nicht die animation, dass sich
// die spotlight suche oeffnet reicht vollkommen." Am Zeiger nachgemessen: 0 laufende Animationen am
// Dialog, clip-path `none` -- und am Telefon laeuft sie weiter (220ms, clipPath).
assert.ok(/pointer:\s*coarse/.test(flip[0]),
	"die Bewegung laeuft nur am groben Zeiger");

// ---- Der falsche Fix darf nicht nachwachsen ------------------------------------------------------
const viewport = indexHtml.match(/<meta\s+name="viewport"[^>]*>/);
assert.ok(viewport, "index.html traegt ein Viewport-Meta");
assert.ok(!/maximum-scale|user-scalable/.test(viewport[0]),
	"das Viewport-Meta sperrt das Aufziehen NICHT -- das naehme allen die Zoomgeste, und neuere"
	+ " iOS-Fassungen ignorieren es ohnehin");

// ---- Die Randlaschen am Telefon (12.08.2026) -----------------------------------------------------
//
// Zwei Entscheidungen des Owners, am Entwurf abgenommen: die Info-Lasche gibt es im Frontend nicht
// mehr, und die Lasche des Planers ist ein kleiner Pfeilgriff statt eines beschrifteten Balkens.
//
// ⚠️ NUR im Frontend. Im Edit-Modus ist die Info-Lasche der zweite Reiter neben „Editor" -- ohne sie
// gaebe es dort keinen Weg zurueck ins Infopanel. Deshalb wird die QUALIFIZIERUNG geprueft, nicht
// bloss, dass irgendwo ein display:none steht.
const infoLasche = infopanelCss.match(/^html\.avesmaps-phone [^{]*\.avesmaps-infopanel__handle\s*\{([^}]*)\}/m);
assert.ok(infoLasche, "es gibt eine Telefon-Regel fuer die Info-Lasche");
assert.ok(/display:\s*none/.test(infoLasche[1]),
	"sie versteckt die Lasche am Telefon");
assert.ok(/body:not\(\.edit-mode\)/.test(infoLasche[0]),
	"...und zwar nur im Frontend. `body`, weil map-features-political-territory-loader.js die Klasse"
	+ " `edit-mode` auf den BODY setzt -- an <html> gehaengt greift die Ausnahme nie und die Lasche"
	+ " waere auch im Editor weg, wo sie der Weg zwischen zwei Panels ist");

// 💣 Das Wort bleibt im Knopf. Es ist sein zugaenglicher Name und der Anker seiner Uebersetzung; ein
// Pfeil, der es ERSETZT, sieht auf dem Schirm identisch aus und nimmt beides weg.
assert.ok(/id="toggle-button"[^>]*data-i18n="planner\.toggle"[^>]*>\s*Routenplaner/.test(indexHtml),
	"der Knopf traegt weiterhin sein Wort samt i18n-Anker");
const phoneGriff = layoutCss.match(/^html\.avesmaps-phone #toggle-button\s*\{([^}]*)\}/m);
assert.ok(phoneGriff, "es gibt eine Telefon-Regel fuer die Lasche des Planers");
assert.ok(/font-size:\s*0/.test(phoneGriff[1]),
	"...die das Wort unsichtbar macht, statt es aus dem Markup zu nehmen");
assert.ok(/^html\.avesmaps-phone #toggle-button::before\s*\{[^}]*content:/m.test(layoutCss),
	"der Pfeil kommt aus ::before -- er ist Schmuck, kein Inhalt");

// 💣 Die Richtung IST der Zustand. Sie haengt an einer Klasse, die das JS setzt; zeigt der Pfeil in
// die falsche Richtung, sieht sonst nichts falsch aus -- deshalb beide Enden geprueft.
assert.ok(/^html\.avesmaps-phone\.avesmaps-planner-collapsed #toggle-button::before\s*\{[^}]*content:/m.test(layoutCss),
	"der zugeklappte Zustand hat seine eigene Pfeilrichtung");
assert.ok(/function markRoutePlannerCollapsed[\s\S]{0,400}classList\.toggle\("avesmaps-planner-collapsed"/.test(plannerToggle),
	"und die Klasse kommt aus markRoutePlannerCollapsed");
const zustandsSchreiber = (plannerToggle.match(/isSearchPanelHidden\s*=(?!=)/g) || []).length;
assert.strictEqual(zustandsSchreiber, 1,
	`der Zustand wird an genau EINER Stelle geschrieben (gefunden: ${zustandsSchreiber}). Variable und`
	+ " Klasse gehoeren zusammen -- eine zweite Zuweisung daneben laesst die Klasse zurueck, und dann"
	+ " zeigt der Pfeil verkehrt herum, ohne dass irgendetwas anderes auffaellt");

// ⚠️ Die MASSE stehen in tokens.css, die FORM in map-layout.css -- dieselbe Trennung wie bei den
// Grundwerten. Eine Breite in der Telefonregel waere der dritte Ort, an dem Laschenmaße stehen.
const phoneTokens = tokens.match(/^html\.avesmaps-phone\s*\{([^}]*)\}/m);
assert.ok(phoneTokens && /--avesmaps-tab-w:\s*[0-9.]+px/.test(phoneTokens[1]) && /--avesmaps-tab-h:\s*[0-9.]+px/.test(phoneTokens[1]),
	"die Telefon-Maße der Lasche stehen in tokens.css (die Groessenlehre dazu steht oben)");
["width", "height"].forEach((eigenschaft) => {
	assert.ok(!new RegExp(`(^|;)\\s*${eigenschaft}:`).test(phoneGriff[1]),
		`die Telefonregel setzt \`${eigenschaft}\` NICHT selbst -- sie liest die Token`);
});
assert.ok(/--avesmaps-tab-edge-shade:\s*linear-gradient/.test(tokens)
	&& /background-image:\s*var\(--avesmaps-tab-edge-shade\)/.test(phoneGriff[1]),
	"der Kantenschatten ist ein Token und wird als solcher gelesen -- keine Farbe von Hand (AGENTS.md §12)");

// ---- Der Knopfbund blendet am Telefon aus, waehrend die Infobox offen ist (12.08.2026) ----------
//
// Owner: „solang es ausgefahren ist koennen die items auch ausgeblendet werden (mit der bewegung
// nach links) und wieder eingeblendet werden wenn das infopanel zurueck nach rechts faehrt."
const bundAmTelefon = infopanelCss.match(/^html\.avesmaps-phone\.avesmaps-any-panel-open #map-corner-actions\s*\{([^}]*)\}/m);
assert.ok(bundAmTelefon, "es gibt eine Telefon-Regel fuer den Knopfbund bei offenem Panel");
assert.ok(/opacity:\s*0/.test(bundAmTelefon[1]) && /visibility:\s*hidden/.test(bundAmTelefon[1]),
	"sie blendet ihn aus");
// 💣 DIE Falle dieser Regel. syncMapCornerStack misst `getBoundingClientRect().height` und schreibt
// sie als --avesmaps-corner-stack auf <html>; `display: none` misst 0, der Guard `if (!hoehe)
// return` liesse die veraltete Zahl stehen, und der Zoom saesse beim naechsten Wachsen des Bundes
// falsch. Verborgen, aber gelayoutet, misst sich weiter richtig -- gemessen: 219 zu, 256 offen.
assert.ok(!/display:\s*none/.test(bundAmTelefon[1]),
	"...aber NIEMALS mit display:none -- der Bund muss messbar bleiben (syncMapCornerStack)");
assert.ok(/pointer-events:\s*none/.test(bundAmTelefon[1]),
	"...und schluckt keine Tipper, solange er unsichtbar ist");
// ⚠️ Blende und Weg gehoeren zusammen: dieselbe Dauer, sonst ist der Bund weg, bevor er drueben ist.
const bundGrund = infopanelCss.match(/^\.avesmaps-infopanel-mode #map-corner-actions\s*\{([^}]*)\}/m);
assert.ok(bundGrund && /transition:[^;]*right 0\.22s[^;]*opacity 0\.22s/.test(bundGrund[1]),
	"Weg und Blende laufen gleich lang (0.22s), und zwar schon in der Grundregel -- sonst blendet er"
	+ " nur in eine Richtung weich");

console.log("touch-scale tests passed");
