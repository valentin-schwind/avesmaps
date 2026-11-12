/**
 * Erzeugt die CSS-Variablen der Oberflaeche aus dem Designkanon.
 *
 * 🔴 DAMIT GIBT ES DIE TAFEL NUR EINMAL. Der Kanon (`config/design-canon/avesmaps.json`) traegt die
 * Werte; MapLibre liest sie als Zahlen ueber `@avesmaps3d/shared`, das CSS liest sie als Variablen
 * aus dieser erzeugten Datei. Wer eine Farbe in einer Vue-Datei schreibt, hat sie zum zweiten Mal -
 * und genau so sind bei Legacy Infobox und Routenplaner auseinandergelaufen.
 *
 * 💣 Die erzeugte Datei ist EINGECHECKT, nicht im Build erzeugt. Zwei Gruende: der Produktionsbau
 * muss bytegleich reproduzierbar bleiben (RWI-0001, ADR-0004 U33a), und eine Stildatei, die es nur
 * nach einem Skriptlauf gibt, fehlt genau dann, wenn jemand das Repository frisch auscheckt. Dass
 * beide zusammenpassen, prueft `apps/web/test/design-canon-css.test.ts` - es erzeugt neu und
 * vergleicht. Ein Kanonwert ohne Neulauf faellt damit im Test auf, nicht auf der Karte.
 *
 * 🪤 Die Variablennamen sind LEGACYS Namen (`--color-panel`, `--space-12`, `--radius-md`, …), nicht
 * neu erfundene. Damit laesst sich eine Legacy-Komponente spaeter uebernehmen, ohne ihre
 * Stilregeln umzuschreiben - der Kanon ist dann schon da, unter dem Namen, den sie kennt.
 *
 * Usage: node scripts/dev/build-design-canon-css.mjs
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const canonFile = join(repositoryRoot, "config", "design-canon", "avesmaps.json");
const outputDirectory = join(repositoryRoot, "apps", "web", "src", "styles");
const outputFile = join(outputDirectory, "canon.css");

/** camelCase -> kebab-case, damit `buttonSoftText` zu `button-soft-text` wird. */
function kebab(name) {
    return name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

function line(name, value) {
    return `    ${name}: ${value};`;
}

/**
 * Das dunkle Thema (WI-0032, Guide §23): `data-theme="dark"` an `<html>` legt die Dunkelwerte
 * ueber die hellen - nur die, die sich unterscheiden. Die Karte hat keine (Guide §23.1).
 */
function renderDarkTheme(canon) {
    const colours = Object.entries(canon.colourDark ?? {});
    const shadows = Object.entries(canon.shadowDark ?? {});
    if (colours.length === 0 && shadows.length === 0) return [];
    return [
        "/*",
        " * Das dunkle Thema: nur die Werte, die im Dunkeln anders sind. Was auf der Karte liegt, bleibt,",
        " * wie es ist - die Karte ist ein gezeichnetes Pergament (Guide §23.1).",
        " */",
        ':root[data-theme="dark"] {',
        "    color-scheme: dark;",
        ...colours.map(([name, value]) => line(`--color-${kebab(name)}`, value)),
        ...shadows.map(([name, value]) => line(`--shadow-${kebab(name)}`, value)),
        "}",
        "",
    ];
}

export function renderCanonCss(canon) {
    const t = canon.typography;
    const rows = [];

    rows.push("    /* Typografie */");
    rows.push(line("--font-ui", t.fontFamily));
    for (const [name, value] of Object.entries(t.size)) {
        rows.push(line(`--font-size-${kebab(name)}`, `${value}px`));
    }
    for (const [name, value] of Object.entries(t.leading)) {
        rows.push(line(`--leading-${kebab(name)}`, String(value)));
    }
    rows.push(line("--font-weight-regular", String(t.weightRegular)));
    rows.push(line("--font-weight-bold", String(t.weightBold)));
    rows.push(line("--letter-spacing-caps", t.letterSpacingCaps));
    rows.push(line("--descender-room", t.descenderRoom));

    rows.push("");
    rows.push("    /* Farbe */");
    for (const [name, value] of Object.entries(canon.colour).filter(([key]) => !key.startsWith("$"))) {
        rows.push(line(`--color-${kebab(name)}`, value));
    }

    rows.push("");
    rows.push("    /* Abstand, Radius, Symbolgroessen */");
    for (const [name, value] of Object.entries(canon.space)) {
        rows.push(line(`--space-${name}`, `${value}px`));
    }
    for (const [name, value] of Object.entries(canon.radius)) {
        rows.push(line(`--radius-${kebab(name)}`, `${value}px`));
    }
    for (const [name, value] of Object.entries(canon.icon)) {
        rows.push(line(`--icon-${kebab(name)}`, `${value}px`));
    }

    rows.push("");
    rows.push("    /* Bedienelemente und Fensterbauteile */");
    const c = canon.control;
    rows.push(line("--avm-control-h", `${c.height}px`));
    rows.push(line("--avm-field-label-w", `${c.labelWidth}px`));
    rows.push(line("--avm-kopf-pad", `${c.headerPadding[0]}px ${c.headerPadding[1]}px`));
    rows.push(line("--avm-row-pad", `${c.rowPadding[0]}px ${c.rowPadding[1]}px`));
    rows.push(line("--avm-col-pad", `${c.columnPadding[0]}px ${c.columnPadding[1]}px`));
    rows.push(line("--divider-gap", `${c.dividerGap}px`));
    rows.push(line("--divider-gap-tight", `${c.dividerGapTight}px`));
    // Der Fokusring (Guide §30.3, WI-0120 A8): Legacys Token unter Legacys Namen, die Farbe kippt mit dem Thema.
    // 🪤 Er verweist auf `--color-focus`, statt dessen Wert einzusetzen: Beide stehen an `:root`, und dort setzt das
    // dunkle Thema `--color-focus` neu - der Ring zieht so ohne eigenen Dunkelwert mit.
    rows.push(line("--focus-ring", `0 0 0 ${canon.focusRing.width}px var(--color-focus)`));
    // Seine Breite für jeden anderen Ring in derselben Stärke, etwa das kurze Leuchten geänderter Abschnitte im Wegeditor (OPS-000112).
    rows.push(line("--focus-ring-width", `${canon.focusRing.width}px`));
    // Der Statuspunkt mit Hof (Guide §15, WI-0120 A8): Punkt und Hof, die Hoffarben stehen unter den Farben.
    rows.push(line("--avm-status-dot", `${canon.statusDot.size}px`));
    rows.push(line("--avm-status-halo", `${canon.statusDot.halo}px`));
    // Die benannten Fensterbreiten (WI-0045, Guide §12): ein Fenster waehlt eine, es schreibt keine.
    for (const [name, value] of Object.entries(canon.fenster?.breite ?? {})) {
        rows.push(line(`--avm-fenster-${kebab(name)}`, `${value}px`));
    }
    if (canon.fenster?.spalte) rows.push(line("--avm-fenster-spalte", `${canon.fenster.spalte}px`));
    if (canon.fenster?.lesespalte) rows.push(line("--avm-fenster-lesespalte", `${canon.fenster.lesespalte}px`));
    // Die Schiene links neben dem Rumpf (WI-0127, Guide §13.12): Breite, feste Spalte des Stands, linker Balken.
    const schiene = canon.fenster?.schiene;
    if (schiene) {
        rows.push(line("--avm-fenster-schiene", `${schiene.breite}px`));
        rows.push(line("--avm-fenster-schiene-wert", `${schiene.wert}px`));
        rows.push(line("--avm-fenster-schiene-kante", `${schiene.kante}px`));
    }
    // Der Rumpf aus Spalten (WI-0068 P3): feste Facetten- und Inspectorspalte, Rasterkachel, Vorschaubild einer Listenzeile.
    const spalten = canon.fenster?.spalten;
    if (spalten) {
        rows.push(line("--avm-fenster-facetten", `${spalten.facetten}px`));
        rows.push(line("--avm-fenster-inspektor", `${spalten.inspektor}px`));
    }
    if (canon.fenster?.kachel) rows.push(line("--avm-fenster-kachel", `${canon.fenster.kachel}px`));
    if (canon.fenster?.daumen) rows.push(line("--avm-fenster-daumen", `${canon.fenster.daumen}px`));
    // Der Lesetext der Hinweise: die Spalte des Begriffs in den Faktenzeilen und das Bild im Text.
    if (canon.fenster?.hinweise) {
        rows.push(line("--avm-fenster-hinweise-begriff", `${canon.fenster.hinweise.begriff}px`));
        rows.push(line("--avm-fenster-hinweise-bild", `${canon.fenster.hinweise.bild}px`));
    }
    if (canon.fenster?.bildansicht) {
        rows.push(line("--avm-fenster-bildansicht-pfeil", `${canon.fenster.bildansicht.pfeil}px`));
    }
    // Treffer und Kartenvorschläge (WI-0287, WI-0275). Bis 2026-11-08 standen diese Werte nur von Hand in canon.css (50f9c5ca8).
    const vorschlag = canon.fenster;
    if (
        vorschlag?.umschlag ||
        vorschlag?.vorschauHoehe ||
        vorschlag?.platzhalterHoehe ||
        vorschlag?.faktenLabel ||
        vorschlag?.versionLabel
    ) {
        rows.push(
            "    /* Das Umschlagbild eines Treffers vor dem Titel (WI-0287), das Vorschaubild und der leere Platz der Kartenvorschläge (WI-0275), die Beschriftungsspalten ihrer Fakten und der Zeile „Version“. */",
        );
        if (vorschlag.umschlag) {
            rows.push(line("--avm-fenster-umschlag-w", `${vorschlag.umschlag.breite}px`));
            rows.push(line("--avm-fenster-umschlag-h", `${vorschlag.umschlag.hoehe}px`));
        }
        if (vorschlag.vorschauHoehe) rows.push(line("--avm-fenster-vorschau-hoehe", vorschlag.vorschauHoehe));
        if (vorschlag.platzhalterHoehe)
            rows.push(line("--avm-fenster-platzhalter-hoehe", `${vorschlag.platzhalterHoehe}px`));
        if (vorschlag.faktenLabel) rows.push(line("--avm-fenster-fakten-label", `${vorschlag.faktenLabel}px`));
        if (vorschlag.versionLabel) rows.push(line("--avm-fenster-version-label", `${vorschlag.versionLabel}px`));
    }
    // Der Statuskreis jeder Liste (Guide §13.17, WI-0068 P3): Außendurchmesser und Ring; die Farbe ist `--color-map-presence`.
    if (canon.statusCircle) {
        rows.push(line("--avm-kreis", `${canon.statusCircle.size}px`));
        rows.push(line("--avm-kreis-ring", `${canon.statusCircle.ring}px`));
    }
    // Der Kartentooltip (Guide §15.3): Legacys Zettel.
    const tip = canon.tooltip;
    rows.push(line("--avm-tooltip-pad", `${tip.padding[0]}px ${tip.padding[1]}px`));
    rows.push(line("--avm-tooltip-arrow", `${tip.arrow}px`));
    rows.push(line("--avm-tooltip-offset", `${tip.offset}px`));
    rows.push(line("--avm-tooltip-leading", String(tip.leading)));

    rows.push("");
    rows.push("    /* Routenplaner (Guide §17.1, §17.2) - Legacys Namen */");
    const p = canon.planner;
    rows.push(line("--avesmaps-planner-width", `${p.width}px`));
    rows.push(line("--avesmaps-tab-w", `${p.tabWidth}px`));
    rows.push(line("--avesmaps-tab-h", `${p.tabHeight}px`));
    rows.push(line("--avesmaps-tab-top", `${p.tabTop}px`));
    rows.push(line("--avesmaps-handle-w", `${p.handleWidth}px`));
    rows.push(line("--avesmaps-handle-h", `${p.handleHeight}px`));

    rows.push("");
    rows.push("    /* Infopanel am rechten Rand (Guide §16) - Legacys Namen */");
    rows.push(line("--avesmaps-infopanel-width", `${canon.infoPanel.width}px`));
    rows.push(line("--avesmaps-infopanel-close", `${canon.infoPanel.closeSize}px`));
    // Die Bausteine des Inhalts (P6): Feldzeile, Kopfbild, Aktionsband, Deckel.
    rows.push(line("--avesmaps-infopanel-label-w", `${canon.infoPanel.labelWidth}px`));
    rows.push(line("--avesmaps-infopanel-nav", `${canon.infoPanel.navSize}px`));
    rows.push(line("--avesmaps-infopanel-mark-w", `${canon.infoPanel.markWidth}px`));
    rows.push(line("--avesmaps-infopanel-mark-h", `${canon.infoPanel.markHeight}px`));
    rows.push(line("--avesmaps-infopanel-tile-min-h", `${canon.infoPanel.tileMinHeight}px`));
    rows.push(line("--avesmaps-infopanel-tile-icon", `${canon.infoPanel.tileIcon}px`));
    // Das Zeichen einer Kennzahlkachel im Etappenkopf (WI-0089 P2): eigener Name, damit P4 die Aktionskachel allein aendert.
    rows.push(line("--avesmaps-infopanel-figure-icon", `${canon.infoPanel.figureIcon}px`));
    rows.push(
        line("--avesmaps-infopanel-lid-pad", `${canon.infoPanel.lidPadding[0]}px ${canon.infoPanel.lidPadding[1]}px`),
    );
    // Die Katalogabschnitte (P8, Guide §16.4): Umschlag eines Werks und Vorschau einer Karte.
    rows.push(line("--avesmaps-infopanel-cover-w", `${canon.infoPanel.coverWidth}px`));
    rows.push(line("--avesmaps-infopanel-cover-h", `${canon.infoPanel.coverHeight}px`));
    rows.push(line("--avesmaps-infopanel-map-w", `${canon.infoPanel.mapThumbWidth}px`));
    rows.push(line("--avesmaps-infopanel-map-h", `${canon.infoPanel.mapThumbHeight}px`));
    rows.push(line("--avesmaps-infopanel-veil-blur", `${canon.infoPanel.veilBlur}px`));
    // Der Wappendaumen in der Treppe „Liegt in“ (WI-0094, Legacy `.location-popup__breadcrumb-coat`).
    rows.push(line("--avesmaps-infopanel-stair-coat", `${canon.infoPanel.stairCoat}px`));
    rows.push(line("--avesmaps-infopanel-stair-coat-drop", `${canon.infoPanel.stairCoatDrop}px`));
    // Das Buchstabenregister der Vorkommenszeilen (WI-0099): Breite der Markenspalte und Mindestbreite einer Spalte.
    rows.push(line("--avesmaps-infopanel-lore-letter", `${canon.infoPanel.loreLetterWidth}px`));
    rows.push(line("--avesmaps-infopanel-lore-col", `${canon.infoPanel.loreColumnMin}px`));

    rows.push("");
    rows.push("    /* Dunst und Himmel der geneigten Karte (WI-0016) */");
    for (const [name, value] of Object.entries(canon.atmosphere)) {
        rows.push(line(`--atmosphere-${kebab(name)}`, value));
    }

    rows.push("");
    rows.push("    /* Schatten und Stapelung */");
    for (const [name, value] of Object.entries(canon.shadow)) {
        rows.push(line(`--shadow-${kebab(name)}`, value));
    }
    for (const [name, value] of Object.entries(canon.z)) {
        rows.push(line(`--z-${kebab(name)}`, String(value)));
    }

    return [
        "/*",
        " * ERZEUGT - nicht von Hand aendern.",
        " *",
        " * Quelle: config/design-canon/avesmaps.json",
        " * Erzeuger: node scripts/dev/build-design-canon-css.mjs",
        " *",
        " * Wer hier einen Wert aendert, aendert ihn nur fuer die Oberflaeche und nicht fuer die Karte -",
        " * und beim naechsten Lauf ist die Aenderung weg. Der Wert gehoert in den Kanon.",
        " */",
        "",
        "/*",
        " * Die Hausschrift der OBERFLAECHE. Die Karte bekommt dieselbe Schrift als SDF-Glyphen",
        " * (scripts/dev/build-glyphs.mjs) - beide aus derselben TTF-Vorlage, damit ein Panel und ein",
        " * Kartenname nicht in zwei Schriften stehen.",
        " *",
        " * 🔴 Nur woff2, kein Rueckfallformat: Chrome holt die ersten ZWEI Quellen einer src-Liste, eine",
        " * Rueckfallkette kostet also bei jedem Kaltbesuch eine zweite Datei, ohne je gebraucht zu werden.",
        " */",
        "@font-face {",
        '    font-family: "Faculty Glyphic";',
        '    src: url("/fonts/FacultyGlyphic-Regular.woff2") format("woff2");',
        "    font-weight: 400;",
        "    font-style: normal;",
        "    font-display: swap;",
        "}",
        "",
        ":root {",
        "    color-scheme: light;",
        ...rows,
        "}",
        "",
        ...renderDarkTheme(canon),
        "/*",
        " * Die Schrift traegt Oberflaeche UND Karte, wie bei Legacy.",
        " *",
        " * 🔴 `font-synthesis-weight: none`, weil Faculty Glyphic nur den Regular-Schnitt mitbringt: ein",
        " * vom Browser gerechnetes Fett rendert matschig. Betonung entsteht ueber Farbe",
        " * (--color-text-strong, --color-accent-strong), nicht ueber Gewicht.",
        " */",
        "html,",
        "body,",
        "button,",
        "input,",
        "select,",
        "textarea {",
        "    font-family: var(--font-ui);",
        `    font-synthesis-weight: ${canon.typography.synthesisWeight ? "auto" : "none"};`,
        "}",
        "",
        "/*",
        " * 🔴 DEUTSCHE SILBENTRENNUNG, AUCH IN LINKS (Hausregel, WI-0088 P3).",
        " *",
        " * Betreiber 2026-10-06, woertlich: „und kannst du auf deutsche silbentrennung achten - auch bei links“.",
        " *",
        " * Zusammengesetzte Woerter sind hier der Normalfall, nicht die Ausnahme: „Herrschaftsgebiet“ oder",
        " * „Westliches Vorgebirge des Raschtulswalls“. In einer schmalen Spalte und am Telefon lief ein solches",
        " * Wort bisher ueber den Rand, oder `overflow-wrap: anywhere` brach es OHNE Strich mitten im Wort - der",
        " * Leser sieht dann nicht, dass es weitergeht. Mit Trennung bricht es an einer Silbe, mit Strich.",
        " *",
        " * Die Trennung richtet sich nach `lang` an `<html>`. Das setzt `applyLocale()` beim Start UND bei",
        " * jedem Sprachwechsel (apps/web/src/i18n/i18n.ts, apps/web/src/main.ts); gemessen am 2026-10-06 traegt",
        " * das Dokument `de` beziehungsweise `en` von der ersten Zeichnung an. Darum steht hier nur die Regel",
        " * und keine Sprache: Englisch trennt nach eigenen Stellen, und beide Woerterbuecher liegen im Browser.",
        " *",
        " * Sie steht HIER und nicht in den Bauteilen: EINE Aussage, EINE Rezeptur. `hyphens` erbt, also gilt sie",
        " * auch fuer Links, Ueberschriften, Tabellenzellen und Knopfaufschriften - genau das war der Wunsch.",
        " *",
        " * 🪤 Was NICHT getrennt werden darf, nimmt sich selbst aus: Was `white-space: nowrap` traegt, bricht nie",
        " * um und kann darum nicht getrennt werden - ein Wert samt Einheit (`AvmWert`, „4 S 8 H“), die Pillen, die",
        " * Etiketten, eine Reihe von Masszahlen. Ein Wort ohne Trennstellen im Woerterbuch (Kennung, Adresse,",
        " * Kuerzel, Zahl) laesst der Browser ganz; dort faengt weiter `overflow-wrap` den Ueberlauf.",
        " * Wer eine Flaeche ausdruecklich ungetrennt braucht, setzt `hyphens: manual` an ihr und sagt warum",
        " * (so wie der Vermerk unter den Kosten im Planer).",
        " */",
        "html {",
        "    hyphens: auto;",
        "}",
        "",
        "/*",
        " * 🔴 IN EINER LEISTE SITZT DIE VERSALHOEHE IN DER MITTE, NICHT DIE ZEILE (Hausregel, Guide §3.2).",
        " *",
        " * Leiste, Pille, Kopfzeile, Schalter: Der Text darin steht senkrecht mittig. Gemeint ist die Mitte",
        " * der VERSALHOEHE - vom Scheitel der Grossbuchstaben bis zur Grundlinie -, nicht die Mitte des",
        " * Zeilenkastens. 💣 Chrome rundet Ober- und Unterlaenge der Hausschrift auf ganze Pixel; wer die",
        " * Zeile zentriert, setzt die Buchstaben bis zu einem Geraetepixel daneben.",
        " *",
        " * Dreimal verlangt, deshalb eine Regel und keine dritte Einzelkorrektur:",
        " * 2026-09-25 „DE | EN einfach nur perfekt vertikal zentrieren sonst nix“,",
        " * 2026-10-04 „mach den text darin fett und zentrier ihn vertikal exakt mittig“,",
        " * 2026-10-05 „kannst du bei sowas darauf achten, dass der text immer vertikal zentriert ist?“.",
        " *",
        " * Das Rezept hat zwei Haelften, und es steht HIER statt ein viertes Mal in einer Komponente:",
        " * 1. Die Leiste zentriert ihre Kinder (`align-items: center`, oder `baseline`, wo mehrere Felder auf",
        " *    EINER Grundlinie stehen) und hat oben so viel Polster wie unten.",
        " * 2. Der Text traegt diese Klasse: Sie schneidet seinen Kasten auf genau die Versalhoehe.",
        " * Die Masse kommen damit aus der Schrift selbst, nicht aus einem von Hand austarierten Polster.",
        " * Gemessen wird am gezeichneten Bild: apps/web/e2e/leisten-mitte.spec.ts, hoechstens 0,5 px.",
        " */",
        ".avm-versalmitte {",
        "    display: block;",
        "    text-box: trim-both cap alphabetic;",
        "}",
        "",
        "/*",
        " * 🔴 EINE EINZEILIGE KLAPPBOX HAT IM GANZEN HAUS DIESELBE KOPFHOEHE (Hausregel, Guide §16.3).",
        " *",
        " * Betreiber 2026-10-07, woertlich: „was mich stoert ist, dass klappboxen alle wieder",
        " * unterschiedlich hoch sind. die sollen eine einheitliche hoehe haben (beispiele oneliner),",
        " * im routenplaner wie im infopanel etc.“",
        " *",
        " * Gemessen am 2026-10-07 standen DREI Hoehen nebeneinander, alle vier Faelle (1280 und 360 px,",
        " * hell und dunkel) gleich: die zwei Planerleisten 22,00 px, die fuenf Deckel der Routendetails",
        " * 21,94 px, die Deckel des Infopanels 16,08 px. Keine der drei war gesetzt - 21,94 ist der",
        " * Zeilenkasten von 11-px-Schrift (15,94) plus Polster, 16,08 der auf die Versalhoehe geschnittene",
        " * Kasten des 13-px-Winkels (10,08) plus Polster. Nur die 22,00 ist eine Entscheidung.",
        " *",
        " * 🔴 Die Hoehe ist deshalb ABGELEITET und keine neue Zahl: eine Symbolzeile (`icon.sm`) in",
        " * gleichem Polster oben und unten (`space.4`, also 3 px je Seite - genau das Polster, das die",
        " * Klappbox und der Deckel des Infopanels schon tragen). Die 16 px sind der Befund des Betreibers",
        " * vom 2026-09-24: Eine Kopfzeile mit Symbol darf nicht hoeher stehen als eine ohne, also ist die",
        " * Zeile so hoch wie ein Symbol. Die groesste der drei Hoehen gewinnt auch deshalb, weil nur sie",
        " * ein 16-px-Symbol traegt, ohne es zu beschneiden.",
        " *",
        " * 🪤 Die Klasse sagt die HOEHE, nicht die Ausrichtung. Wie der Text darin mittig sitzt, bleibt",
        " * Sache des Bauteils (§3.2): die Klappbox ueber die Zeilenhoehe eines Symbols, der Deckel des",
        " * Infopanels ueber `.avm-versalmitte` in einer senkrecht zentrierten Reihe. Eine gemeinsame",
        " * Ausrichtungsregel waere hier falsch - sie hat am 2026-10-06 gemessen beides verschlechtert",
        " * (WI-0089, dritter Nachgang).",
        " *",
        " * 🪤 Es ist eine UNTERGRENZE: Was mehr als eine Zeile traegt (die Vorschau unter einem Deckel,",
        " * ein Satz, der bei 360 px umbricht, der zweireihige Kopf einer Etappengruppe), bleibt so hoch,",
        " * wie sein Inhalt es verlangt. `border-box`, weil die Hoehe das Polster einschliesst.",
        " * Gemessen wird am gezeichneten Bild: apps/web/e2e/klappbox-hoehe.spec.ts.",
        " */",
        ".avm-klappbox-kopf {",
        "    box-sizing: border-box;",
        "    min-height: calc(var(--icon-sm) + var(--space-4));",
        "}",
        "",
        "/*",
        " * 🔴 EIN LINK, DER DIE SEITE VERLAESST, TRAEGT EIN ↗ - UND ER BEKOMMT ES HIER, NICHT IM BAUTEIL.",
        " *",
        " * Guide §13.13: „Ein Pfeil ↗ heisst: das fuehrt aus Avesmaps hinaus. Ohne ihn sieht ein Wiki-Link aus",
        " * wie ein Sprung auf die Karte, und der Unterschied ist fuer den Redakteur wesentlich.“ (CANON)",
        " * Guide §13.42, Ausfuehrungsvorschrift zum ↗: „Einmal, zentral - nie von Hand je Verweis. (CANON)",
        " * Entweder eine gemeinsame Verweisbehandlung oder automatisch ... Handgetippt bleibt er nirgends",
        " * vollstaendig.“",
        " *",
        " * 🔴 Betreiber 2026-10-07, woertlich: „kannst du bei allein externen links immer das symbol ↗",
        " * verwenden ich glaub es steht in den regeln, aber du hast jetzt bei den vorkommen (alles wiki-links",
        " * ↗ nicht rangemacht - war schon in legacy falsch)“",
        " *",
        " * 💣 Er hat an beiden Enden recht, und der zweite Satz des Guide war die Diagnose: Vor dieser Regel",
        " * stand der Pfeil an SECHS Stellen einzeln (zweimal als CSS-`::after`, viermal als",
        " * `<span aria-hidden>` im Markup) und fehlte an ACHT anderen - den 110 Vorkommensnamen, dem",
        " * Literaturtitel, der Kartensammlung und den fuenf Belegzeilen der Statusseite. Die naechste Stelle",
        " * vergisst eine Regel, die an sechs Stellen steht. Jetzt steht sie an einer.",
        " *",
        ' * 🔴 Der Traeger ist `target="_blank"`, nicht `href^="http"`: Was in einem neuen Fenster aufgeht,',
        " * verlaesst diese Seite - genau die Aussage, die der Pfeil macht. Ueber `href` liefe die kurze",
        " * Teiladresse im Toast (unsere eigene, mit `preventDefault`) in die Regel, und auf localhost gaebe es",
        " * kein `avesmaps` im Namen, an dem man sie wieder ausnehmen koennte. Legacy traegt dieselbe Naht:",
        ' * `a[target="_blank"]::after` in css/components/legal-dialog.css.',
        " *",
        " * 🪤 Ein Link, der NICHT hinausfuehrt, bekommt keinen - und das ist bei uns keine Ausnahme, sondern",
        " * eine andere Bauart: Der Objektlink im Panel (`info-link.vue`, die Treppe „Liegt in“, die",
        " * Vorkommensnamen mit eigenem Kartenobjekt) ist ein `<button>` und kein `<a>`. Legacy sagt es an",
        " * seinem Gegenstueck woertlich (css/features/lore.css): „Sieht aber aus wie ein Link, denn genau so",
        " * wird es gelesen -- kein ↗, das steht fuer ‚verlaesst die Seite‘.“",
        " *",
        ' * 🔴 Vorlesewerkzeuge hoeren ihn nicht: `content: <text> / ""` gibt dem erzeugten Inhalt einen leeren',
        " * Alternativtext. Die Zeile davor ist der Rueckfall fuer Browser, die die Alternativschreibweise nicht",
        " * kennen. Ein Pfeil, der in einer Reihe von 110 Vorkommensnamen 110-mal vorgelesen wird, waere",
        " * schlimmer als keiner.",
        " *",
        " * 🪤 Das geschuetzte Leerzeichen ist kein Schmuck: Es haelt den Pfeil an SEINEM Namen. In der",
        " * kommagetrennten Reihe der Vorkommen (`overflow-wrap: anywhere`) riss ein gewoehnliches Leerzeichen",
        " * ihn an jedem Zeilenende vom Wort los und setzte ihn allein in die naechste Zeile.",
        " *",
        " * 🪤 Die einzige Ausnahme ist Legacys eigene, und sie ist eng: ein Link OHNE Text - ein Umschlagbild,",
        " * ein Markenzeichen - hat nichts, woran der Pfeil haengen koennte. Sie wird im Bauteil mit",
        " * `content: none` gesetzt und dort begruendet (`info-literature.vue`, `hinweise-kacheln.vue`).",
        ' * 💣 Eine solche Ausnahme braucht mehr Gewicht als diese Regel: `a[target="_blank"]` wiegt',
        " * (0,1,1), eine Klasse allein nur (0,1,0). In einem Vue-Bauteil mit `<style scoped>` genuegt die",
        " * Klasse, weil der Uebersetzer `[data-v-…]` anhaengt und daraus (0,2,0) macht; ein GLOBALES",
        ' * Stilblatt muesste `a.klasse[target="_blank"]` schreiben. Sonst wirkt die Ausnahme lautlos nicht.',
        " *",
        " * 🪤 `.avm-nach-draussen` ist derselbe Pfeil fuer den Fall, dass der Text des Ankers in einem KIND",
        " * steht (die Kachel der Kartensammlung: Vorschau und Titel, beide Bloecke). Am Anker stuende der Pfeil",
        " * dort als eigene Zeile unter dem Titel, und unter dem Spoiler-Deckel blieb er als einziges Zeichen",
        " * sichtbar. Es ist EIN Regelblock mit zwei Waehlern - nicht eine zweite Fassung des Pfeils.",
        " * Gemessen wird am gezeichneten Bild: apps/web/e2e/externe-links.spec.ts.",
        " */",
        'a[target="_blank"]::after,',
        ".avm-nach-draussen::after {",
        '    content: "\\a0↗";',
        '    content: "\\a0↗" / "";',
        "}",
        "",
    ].join("\n");
}

async function main() {
    const canon = JSON.parse(await readFile(canonFile, "utf8"));
    await mkdir(outputDirectory, { recursive: true });
    await writeFile(outputFile, renderCanonCss(canon));
    const count = renderCanonCss(canon)
        .split("\n")
        .filter((row) => row.includes("--")).length;
    console.log(`${count} Variablen -> ${outputFile}`);
}

// 🪤 Der Vergleich laeuft ueber `pathToFileURL`, nicht ueber eine zusammengesetzte Zeichenkette:
// unter Windows ist die URL einer Datei `file:///C:/...` mit DREI Schraegstrichen, und ein von Hand
// gebautes `file://C:/...` trifft sie nie. Das Skript tat dann beim Aufruf schlicht nichts - kein
// Fehler, keine Datei, nur eine Eingabeaufforderung, die sofort zurueckkommt.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await main();
}
