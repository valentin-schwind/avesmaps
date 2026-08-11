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
const wegpunktRegel = planner.match(
	/@media\s*\(pointer:\s*coarse\)\s*\{[^}]*input\.waypoint-input\s*\{([^}]*)\}/);
assert.ok(wegpunktRegel,
	"route-planner.css traegt eine (pointer: coarse)-Regel fuer `input.waypoint-input`"
	+ " -- mit blossem `.waypoint-input` bliebe die Schwelle dort wirkungslos (live gemessen)");
assert.ok(/var\(--font-size-control\)/.test(wegpunktRegel[1]), "und sie liest den Token");
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
[["css/components/location-report-dialog.css", "Meldedialog"],
 ["css/features/location-reviews.css", "Bewertungen"],
 ["css/components/legal-dialog.css", "Hinweise"]].forEach(([rel, name]) => {
	const css = withoutComments(read(...rel.split("/")));
	assert.ok(/overflow-y:\s*auto/.test(css),
		`${name} scrollt -- daran haengt, dass die groesseren Felder nicht ueberlaufen`);
});

// ---- Die Suchkachel: EINE Regel mit ihren Nachbarn ------------------------------------------------
//
// Owner 11.08.2026: "kachel aber farbe und outline wie Hinweise bzw Neuigkeiten". Das ist erfuellt,
// indem sie in DERSELBEN Regel steht -- nicht, indem die Werte abgeschrieben sind. Ein gefuellter
// Knopf trug seine Rangfolge im Dunkelmodus ohnehin nicht: dort liegen --color-button (#6b6456) und
// --color-panel (#312e26) beide im selben Braun.
const legalCss = withoutComments(read("css", "components", "legal-dialog.css"));
const gemeinsam = legalCss.match(/^#map-search-button,\s*\r?\n#legal-button,\s*\r?\n#news-button\s*\{/m);
assert.ok(gemeinsam,
	"die Suchkachel steht in DERSELBEN Regel wie #legal-button und #news-button -- kopierte Werte"
	+ " waeren die Divergenz, vor der AGENTS.md §12 warnt");
const eigen = legalCss.match(/^#map-search-button\s*\{([^}]*)\}/m);
assert.ok(eigen, "und hat einen eigenen Block fuer das, was eine Kachel ausmacht");
["background", "border:", "border-radius", "box-shadow", "color:"].forEach((prop) => {
	assert.ok(!new RegExp(escapeRe(prop)).test(eigen[1]),
		`der Kachel-Block setzt ${prop} NICHT selbst -- das kommt aus der gemeinsamen Regel`);
});
// Die Kachel ist seit dem 11.08. FREI von der Reihe (Owner: "sie muss nich ihren partnern
// gleichen, sie kann auch ueber den anderen beiden liegen" + "groesser war super") -- sie darf
// deshalb Fingermass tragen statt sich an 32px zu binden.
// 💣 Aber ihre LAGE wird nirgends gerechnet: der Bund ist eine Spalte, die beiden Verweise sind
// seine zweite Reihe. Ein `bottom`-Abstand haette --avesmaps-corner-stack lesen muessen, und genau
// die Zahl lag am 10.08. um 8px daneben, als die Knoepfe wuchsen und sie stehenblieb.
assert.ok(/width:\s*48px/.test(eigen[1]) && /height:\s*48px/.test(eigen[1]),
	"die Kachel traegt Fingermass (48x48) -- sie muss ihren Nachbarn nicht mehr gleichen");
assert.ok(!/aspect-ratio/.test(eigen[1]) && !/align-self/.test(eigen[1]),
	"und koppelt sich NICHT ueber aspect-ratio/align-self an die Reihe -- das ist ein Zirkel (der Bund"
	+ " hat keine eigene Hoehe), gemessen wurde die Kachel damit 302x302");
assert.ok(!/bottom:/.test(eigen[1]) && !/avesmaps-corner-stack/.test(eigen[1]),
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
// Owner 11.08.2026: erst "die unterschiedlichen schriftgroessen der dropdowns", dann "alle auf 14px".
// 💣 Deshalb ein EIGENER Token. --font-size-control traegt die iOS-Schwelle (>=16px, sonst zoomt
// Safari beim Fokus in ein Eingabefeld). Haette man den auf 14 gesetzt, waeren Wegpunktfeld und
// Zahlenfelder mit unter die Schwelle gerutscht -- also genau das zurueckgeholt, was zwei Commits
// vorher behoben wurde.
const dropdownGroesse = tokens.match(/--font-size-dropdown:\s*([0-9.]+)px/);
assert.ok(dropdownGroesse, "tokens.css definiert --font-size-dropdown");
assert.ok(dropdownGroesse[1] !== controlFont[1],
	"und zwar getrennt von der iOS-Schwelle -- ein gemeinsamer Token zoege die Eingabefelder mit");
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

// ---- Der falsche Fix darf nicht nachwachsen ------------------------------------------------------
const viewport = indexHtml.match(/<meta\s+name="viewport"[^>]*>/);
assert.ok(viewport, "index.html traegt ein Viewport-Meta");
assert.ok(!/maximum-scale|user-scalable/.test(viewport[0]),
	"das Viewport-Meta sperrt das Aufziehen NICHT -- das naehme allen die Zoomgeste, und neuere"
	+ " iOS-Fassungen ignorieren es ohnehin");

console.log("touch-scale tests passed");
