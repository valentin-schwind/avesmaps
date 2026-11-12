import { Type, type Static } from "@sinclair/typebox";

/**
 * Der visuelle Kanon: eine Quelle für Farbe, Schrift, Abstand, Radius, Schatten und Stapelung.
 *
 * 🔴 Er gilt für BEIDE Seiten — die Oberfläche bekommt ihn als CSS-Variablen
 * (`apps/web/src/styles/canon.css`, erzeugt aus dieser Tafel), die Karte als MapLibre-Werte. Das ist
 * der ganze Zweck: eine Farbe, die in einer Vue-Datei steht und in einem Kartenlayer noch einmal,
 * ist keine Farbe mehr, sondern zwei — und die laufen auseinander. Bei Legacy sind auf genau diesem
 * Weg Infobox und Routenplaner verschieden geworden; seine eigene Regel dazu lautet: *„Never
 * hardcode a colour, size, radius, spacing, or divider."*
 *
 * Was hier NICHT steht, und zwar mit Absicht:
 *
 * | Wert | wo er hingehört |
 * |---|---|
 * | Farbe einer Landschaftsart, eines Klimabands, einer Wegart | `config/map-cartography/` — sie ist Kartografie einer Domäne, nicht Gestaltung |
 * | Schriftgröße je Zoomstufe | `config/zoom-bands/` |
 * | Sichtbarkeit, Zoomband, Kollisionsrang | am Feature beziehungsweise in der Datenbank |
 *
 * Die Grenze verläuft an der Frage „gilt das für jede Kartendomäne?": der Saum einer Beschriftung
 * gilt überall, der Ton eines Waldes nur in Aventurien.
 */

/** Eine Beschriftungsfamilie: wie ihr Text aussieht und welchen Saum er trägt. */
export const LabelFamily = Type.Object(
    {
        $comment: Type.Optional(Type.String()),
        $ruinComment: Type.Optional(Type.String()),
        /** Vorgabefarbe. Trägt die Domäne eine Farbe je Art, schlägt sie diese hier. */
        color: Type.String({ pattern: "^#[0-9a-f]{6}$" }),
        /** Sperrung in em — MapLibres `text-letter-spacing` rechnet ebenfalls in em. */
        letterSpacing: Type.Number(),
        uppercase: Type.Boolean(),
        /**
         * Ruinen stehen kursiv (Legacy, MCS-015). Der kursive Schnitt ist kein zweiter Font,
         * sondern derselbe Regular, synthetisch geneigt - MapLibre bekommt ihn als eigenen
         * Glyphenstapel (`typography.mapFontStackItalic`), weil es kein `font-style` kennt.
         */
        ruinsItalic: Type.Optional(Type.Boolean()),
        haloColor: Type.String({ pattern: "^#[0-9a-f]{6}$" }),
        /**
         * Saumbreite als Anteil der Schriftgröße.
         *
         * 🔴 Ein Anteil, keine feste Pixelzahl: Legacy rechnet seinen Saum aus der Schriftgröße
         * (`fontSize * strokeRatio`), und ein Name wächst über acht Zoomstufen um mehr als das
         * Doppelte. Ein fester Saum wäre unten zu dick und oben zu dünn.
         */
        haloWidthRatio: Type.Number({ minimum: 0 }),
        /** Unschärfe des Saums, ebenfalls als Anteil der Schriftgröße. */
        haloBlurRatio: Type.Number({ minimum: 0 }),
        /**
         * Trägt der Name den Ton seiner Fläche (Klimazonen), steht er in dieser wahrgenommenen Helligkeit (OKLCH L):
         * Farbton und Buntheit kommen aus der Fläche, die Helligkeit nicht (Legacy `oklch(from … 0.85 c h)`).
         */
        toneLightness: Type.Optional(Type.Number({ exclusiveMinimum: 0, maximum: 1 })),
        /**
         * Trägt der Name den Ton seiner Fläche, auch sein Saum: dieser Farbton in dieser Helligkeit (OKLCH L), die Buntheit
         * höchstens `haloToneChroma`, damit der Saum nur trennt und nicht leuchtet. Ohne Angabe gilt `haloColor`.
         */
        haloToneLightness: Type.Optional(Type.Number({ exclusiveMinimum: 0, maximum: 1 })),
        haloToneChroma: Type.Optional(Type.Number({ minimum: 0 })),
        /**
         * Die Schriftgröße in Pixeln für eine Familie, die keine Größentafel hat (Klimazonennamen: eine Größe auf jeder
         * Zoomstufe). Die übrigen Familien bekommen ihre Größe aus `config/zoom-bands/` oder aus der Kachel.
         */
        size: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
        /** Dieselbe Größe am Telefon (`isPhoneViewport`), wo `size` die Namen breiter machte als den Schirm. */
        sizePhone: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
        $typeLineComment: Type.Optional(Type.String()),
        /**
         * Die zweite Zeile unter einem Namen, die seine Art nennt („Steppe“ unter „Große Öde“), als Anteil der Namensgröße
         * (WI-0135). Farbe und Saum sind die des Namens.
         */
        typeLineScale: Type.Optional(Type.Number({ exclusiveMinimum: 0, maximum: 1 })),
    },
    { additionalProperties: false },
);

export const DesignCanon = Type.Object(
    {
        schemaVersion: Type.Integer({ exclusiveMinimum: 0 }),
        provenance: Type.Object(
            {
                baselineId: Type.String(),
                findings: Type.Array(Type.String()),
                legacyEvidence: Type.String(),
                note: Type.String(),
            },
            { additionalProperties: false },
        ),
        typography: Type.Object(
            {
                /** Die Schriftkette der Oberfläche. */
                fontFamily: Type.String(),
                /** Der Glyphenstapel, unter dem MapLibre die Schrift anfordert. */
                mapFontStack: Type.String(),
                /**
                 * Der kursive Stapel - aus DERSELBEN Schriftdatei synthetisch geneigt, genau wie
                 * der Browser es fuer Legacys `font-style: italic` tut. Keine zweite Schrift.
                 */
                mapFontStackItalic: Type.String(),
                weightRegular: Type.Integer(),
                weightBold: Type.Integer(),
                /**
                 * 🔴 `false` heißt `font-synthesis-weight: none`. Faculty Glyphic bringt nur den
                 * Regular-Schnitt mit; ein Browser, der daraus ein Fett rechnet, liefert matschige
                 * Kanten. Betonung entsteht über Farbe, nicht über Gewicht.
                 */
                synthesisWeight: Type.Boolean(),
                size: Type.Record(Type.String(), Type.Number({ exclusiveMinimum: 0 })),
                leading: Type.Record(Type.String(), Type.Number({ exclusiveMinimum: 0 })),
                letterSpacingCaps: Type.String(),
                /**
                 * Wie tief die Unterlängen der Hausschrift unter die Zeile reichen (als `em`). Wer
                 * einzeilig mit Auslassungspunkt kürzt, muss so weit nach unten Platz lassen - sonst
                 * schneidet `overflow: hidden` g, p und j ab (Betreiber 2026-09-25).
                 */
                descenderRoom: Type.String(),
            },
            { additionalProperties: false },
        ),
        colour: Type.Record(Type.String(), Type.String()),
        /**
         * Das dunkle Thema (WI-0032, Guide §23): NUR die Farben, die im Dunkeln anders sind, unter
         * ihrem hellen Namen. Was auf der Karte liegt, hat keinen Dunkelwert - die Karte bleibt hell.
         */
        colourDark: Type.Optional(Type.Record(Type.String(), Type.String())),
        space: Type.Record(Type.String(), Type.Number({ minimum: 0 })),
        radius: Type.Record(Type.String(), Type.Number({ minimum: 0 })),
        control: Type.Object(
            {
                height: Type.Number({ exclusiveMinimum: 0 }),
                labelWidth: Type.Number({ exclusiveMinimum: 0 }),
                headerPadding: Type.Tuple([Type.Number(), Type.Number()]),
                rowPadding: Type.Tuple([Type.Number(), Type.Number()]),
                columnPadding: Type.Tuple([Type.Number(), Type.Number()]),
                dividerGap: Type.Number({ minimum: 0 }),
                dividerGapTight: Type.Number({ minimum: 0 }),
            },
            { additionalProperties: false },
        ),
        /**
         * Der Fokusring (Guide §30.3, WI-0120 A8): seine Breite in Pixeln. Die Farbe ist `colour.focus` und kippt mit dem
         * Thema; der Erzeuger setzt beides zu `--focus-ring` zusammen (Legacy `0 0 0 3px var(--color-focus)`). Komponiert
         * wird er im Bauteil mit dem eigenen Schatten, nie an dessen Stelle.
         */
        focusRing: Type.Object(
            {
                width: Type.Number({ exclusiveMinimum: 0 }),
            },
            { additionalProperties: false },
        ),
        /**
         * Der Statuspunkt mit Hof (Guide §15, WI-0120 A8): Durchmesser des Punkts und Breite des Hofs in Pixeln. Die
         * Hoffarben stehen unter `colour` (`successHalo`, `mutedHalo`, `dangerHalo`, `warningHalo`).
         */
        statusDot: Type.Object(
            {
                size: Type.Number({ exclusiveMinimum: 0 }),
                halo: Type.Number({ exclusiveMinimum: 0 }),
            },
            { additionalProperties: false },
        ),
        /**
         * Der Statuskreis jeder Liste (AGENTS.md „der Kreis“, Guide §13.17; WI-0068 P3, Baustein `AvmKreis`): Außendurchmesser und
         * Ringstärke in Pixeln, Legacys `--map-status-circle-size` und `border: 2px`. Die Farbe ist `colour.mapPresence`.
         */
        statusCircle: Type.Optional(
            Type.Object(
                {
                    size: Type.Number({ exclusiveMinimum: 0 }),
                    ring: Type.Number({ exclusiveMinimum: 0 }),
                },
                { additionalProperties: false },
            ),
        ),
        /** Der Routenplaner (Guide §17.1, §17.2, §17.11): Panelbreite, Randlasche, Pfeilgriff am Telefon. */
        planner: Type.Object(
            {
                width: Type.Number({ exclusiveMinimum: 0 }),
                tabWidth: Type.Number({ exclusiveMinimum: 0 }),
                tabHeight: Type.Number({ exclusiveMinimum: 0 }),
                tabTop: Type.Number({ minimum: 0 }),
                handleWidth: Type.Number({ exclusiveMinimum: 0 }),
                handleHeight: Type.Number({ exclusiveMinimum: 0 }),
            },
            { additionalProperties: false },
        ),
        /**
         * Das Infopanel am rechten Rand (Guide §16): Breite der Lesespalte, Kantenlänge des ✕ am Telefon, und die Maße
         * seiner Bausteine (P6): Beschriftungsspalte der Feldzeile, Blätterpfeile und Seitenmarken auf dem Kopfbild, Kachel
         * des Aktionsbands und Polster des Deckels.
         */
        infoPanel: Type.Object(
            {
                width: Type.Number({ exclusiveMinimum: 0 }),
                closeSize: Type.Number({ exclusiveMinimum: 0 }),
                labelWidth: Type.Number({ exclusiveMinimum: 0 }),
                navSize: Type.Number({ exclusiveMinimum: 0 }),
                markWidth: Type.Number({ exclusiveMinimum: 0 }),
                markHeight: Type.Number({ exclusiveMinimum: 0 }),
                tileMinHeight: Type.Number({ exclusiveMinimum: 0 }),
                tileIcon: Type.Number({ exclusiveMinimum: 0 }),
                /**
                 * Das Zeichen einer Kennzahlkachel im Etappenkopf (Wegweiser, Taschenuhr, Zelt; WI-0089 P2). Eigener
                 * Name, obwohl der Wert heute dem der Aktionskachel gleicht: Die Aktionskachel ist eine offene
                 * Gestaltungsfrage (WI-0089 P4), und ihre Änderung darf die Kennzahlen nicht mitziehen.
                 */
                figureIcon: Type.Number({ exclusiveMinimum: 0 }),
                /** Oben/unten und links/rechts, in Pixeln. */
                lidPadding: Type.Tuple([Type.Number({ minimum: 0 }), Type.Number({ minimum: 0 })]),
                /** Der Umschlag eines Werks im Literaturstreifen (P8, Guide §16.4): das Hochformat eines gedruckten Bandes. */
                coverWidth: Type.Number({ exclusiveMinimum: 0 }),
                coverHeight: Type.Number({ exclusiveMinimum: 0 }),
                /** Die Vorschau einer Karte im Streifen der Kartensammlung; das Bild füllt sie formatunabhängig. */
                mapThumbWidth: Type.Number({ exclusiveMinimum: 0 }),
                mapThumbHeight: Type.Number({ exclusiveMinimum: 0 }),
                /** Wie unkenntlich das Bild unter einem Spoiler-Deckel wird (Pixel). */
                veilBlur: Type.Number({ minimum: 0 }),
                /**
                 * Der Wappendaumen vor einem Gebietsnamen in der Treppe „Liegt in“ (WI-0094, Legacy
                 * `.location-popup__breadcrumb-coat`): Kantenlänge und, weil er auf der Textgrundlinie der Zeile sitzt,
                 * wie weit er unter sie reicht - beides in Pixeln.
                 */
                stairCoat: Type.Number({ exclusiveMinimum: 0 }),
                stairCoatDrop: Type.Number({ minimum: 0 }),
                /**
                 * Die feste Breite der Markenspalte im Buchstabenregister der Vorkommenszeilen (WI-0099, Guide §16.4):
                 * auf das breiteste der 27 möglichen Glyphen gelegt, damit alle Namen an derselben Kante beginnen.
                 * Legacys `min-width` lässt die Kante bei „W“ nach rechts rutschen.
                 */
                loreLetterWidth: Type.Number({ exclusiveMinimum: 0 }),
                /**
                 * Die Mindestbreite einer Spalte desselben Registers, unter der es auf EINE Spalte zurückfällt. 💣 Sie ist
                 * der ganze Trick und gemessen, nicht geschätzt: Ohne sie entstehen am Telefon Spalten von 64 px, und die
                 * Liste wird höher statt kürzer. Die Grenze zieht damit der Browser, nicht eine zweite Breitenabfrage.
                 */
                loreColumnMin: Type.Number({ exclusiveMinimum: 0 }),
            },
            { additionalProperties: false },
        ),
        /**
         * Die Fensterhülle (WI-0045, Guide §12): die benannten Breiten in Pixeln - ein Fenster wählt
         * eine davon, eine neue kommt mit ihrem Beleg hierher, nie als Zahl ins Fenster - und die
         * Mindestbreite einer Spalte im Rumpf, unter der nebeneinanderstehende Blöcke umbrechen:
         * `spalte` für Karten, `lesespalte` für Spalten aus Lesetext und Tafeln. `schiene` ist die Zone links
         * neben dem Rumpf (WI-0127, Guide §13.12): ihre Breite, die feste Spalte des Stands und der linke Balken.
         * `spalten` sind die festen Spalten eines Rumpfs aus Spalten (WI-0068 P3, Baustein `FensterSpalte`): die Facetten links,
         * der Inspector rechts, die Mitte nimmt den Rest; `kachel` die Mindestbreite einer Kachel im Bildraster, `daumen` das
         * Vorschaubild vor einer Listenzeile. `bildansicht.pfeil` die runden Knöpfe der Bildansicht (Guide §13.46).
         */
        fenster: Type.Optional(
            Type.Object(
                {
                    breite: Type.Record(Type.String(), Type.Number({ exclusiveMinimum: 0 })),
                    spalte: Type.Number({ exclusiveMinimum: 0 }),
                    lesespalte: Type.Number({ exclusiveMinimum: 0 }),
                    schiene: Type.Optional(
                        Type.Object(
                            {
                                breite: Type.Number({ exclusiveMinimum: 0 }),
                                wert: Type.Number({ exclusiveMinimum: 0 }),
                                kante: Type.Number({ exclusiveMinimum: 0 }),
                            },
                            { additionalProperties: false },
                        ),
                    ),
                    spalten: Type.Optional(
                        Type.Object(
                            {
                                facetten: Type.Number({ exclusiveMinimum: 0 }),
                                inspektor: Type.Number({ exclusiveMinimum: 0 }),
                            },
                            { additionalProperties: false },
                        ),
                    ),
                    kachel: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
                    daumen: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
                    bildansicht: Type.Optional(
                        Type.Object({ pfeil: Type.Number({ exclusiveMinimum: 0 }) }, { additionalProperties: false }),
                    ),
                    hinweise: Type.Optional(
                        Type.Object(
                            {
                                begriff: Type.Number({ exclusiveMinimum: 0 }),
                                bild: Type.Number({ exclusiveMinimum: 0 }),
                            },
                            { additionalProperties: false },
                        ),
                    ),
                    /** Das Umschlagbild eines Treffers vor dem Titel (WI-0287) in Bildpunkten. */
                    umschlag: Type.Optional(
                        Type.Object(
                            {
                                breite: Type.Number({ exclusiveMinimum: 0 }),
                                hoehe: Type.Number({ exclusiveMinimum: 0 }),
                            },
                            { additionalProperties: false },
                        ),
                    ),
                    /** Das Vorschaubild der Kartenvorschläge (WI-0275), ein CSS-Wert (etwa `clamp(…)`). */
                    vorschauHoehe: Type.Optional(Type.String({ minLength: 1 })),
                    /** Der leere Platz eines Kartenvorschlags ohne Bild und die Beschriftungsspalten seiner Fakten und der Zeile „Version“. */
                    platzhalterHoehe: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
                    faktenLabel: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
                    versionLabel: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
                },
                { additionalProperties: false },
            ),
        ),
        icon: Type.Record(Type.String(), Type.Number({ exclusiveMinimum: 0 })),
        /**
         * Der Kartentooltip (Guide §15.3): Legacys Zettel. Polster in Pixeln (oben/unten, links/rechts), die Kantenlänge
         * des Pfeils, der Abstand seiner Spitze über dem Ankerpunkt und die Zeilenhöhe.
         */
        tooltip: Type.Object(
            {
                padding: Type.Tuple([Type.Number({ minimum: 0 }), Type.Number({ minimum: 0 })]),
                arrow: Type.Number({ exclusiveMinimum: 0 }),
                offset: Type.Number({ minimum: 0 }),
                leading: Type.Number({ exclusiveMinimum: 0 }),
            },
            { additionalProperties: false },
        ),
        shadow: Type.Record(Type.String(), Type.String()),
        /** Die Schatten des dunklen Themas: schwarz statt warmbraun, und kräftiger. */
        shadowDark: Type.Optional(Type.Record(Type.String(), Type.String())),
        z: Type.Record(Type.String(), Type.Integer()),
        /** Himmel, Dunst und Fläche hinter der geneigten Karte (WI-0290): die Kulisse, keine Oberflächenfarbe. */
        atmosphere: Type.Object(
            {
                sky: Type.String(),
                skyHorizon: Type.String(),
                sea: Type.String(),
            },
            { additionalProperties: false },
        ),
        /**
         * Die Route auf der Karte (Guide §17.10): Breiten in Pixeln, der Faktor der veralteten Route
         * (Owner 14.09.2026: „gedimmt“ statt weg), Querfeldein gestrichelt, die Wegpunktmarken.
         */
        route: Type.Object(
            {
                width: Type.Number({ exclusiveMinimum: 0 }),
                haloWidth: Type.Number({ minimum: 0 }),
                staleFactor: Type.Number({ exclusiveMinimum: 0, maximum: 1 }),
                offroadOpacity: Type.Number({ exclusiveMinimum: 0, maximum: 1 }),
                offroadDash: Type.Tuple([Type.Number({ exclusiveMinimum: 0 }), Type.Number({ exclusiveMinimum: 0 })]),
                markerDisc: Type.Number({ exclusiveMinimum: 0 }),
                markerDropWidth: Type.Number({ exclusiveMinimum: 0 }),
                markerDropHeight: Type.Number({ exclusiveMinimum: 0 }),
                travelerSize: Type.Number({ exclusiveMinimum: 0 }),
                /** Der Pfeil wächst mit dem Zoom: bis `travelerZoom[0]` `travelerSize`, ab `[1]` diese Größe. */
                travelerSizeClose: Type.Number({ exclusiveMinimum: 0 }),
                travelerZoom: Type.Tuple([Type.Number(), Type.Number()]),
                /**
                 * Die Marke eines Grenzübertritts (WI-0065 Z3 C), gezeichnet wie die Scheibe des Wegpunkts nur kleiner: Radien in
                 * Pixeln für den dunklen Rand, den Körper samt goldenem Ring (`ring` ist dessen Breite) und das dunkle Auge.
                 */
                crossingMarker: Type.Object(
                    {
                        rim: Type.Number({ exclusiveMinimum: 0 }),
                        body: Type.Number({ exclusiveMinimum: 0 }),
                        ring: Type.Number({ exclusiveMinimum: 0 }),
                        eye: Type.Number({ exclusiveMinimum: 0 }),
                    },
                    { additionalProperties: false },
                ),
            },
            { additionalProperties: false },
        ),
        /**
         * Die gefährlichen Gebiete auf der Karte (WI-0308): Tönung, Striche unter 45° und Rand in `colour.mapGefahr`; Breiten in Pixeln,
         * `raster` ist der Abstand der Striche senkrecht gemessen.
         */
        mapGefahr: Type.Optional(
            Type.Object(
                {
                    raster: Type.Number({ exclusiveMinimum: 0 }),
                    strich: Type.Number({ exclusiveMinimum: 0 }),
                    deckkraft: Type.Number({ exclusiveMinimum: 0, maximum: 1 }),
                    toenung: Type.Number({ minimum: 0, maximum: 1 }),
                    kante: Type.Number({ exclusiveMinimum: 0 }),
                    kanteDeckkraft: Type.Number({ exclusiveMinimum: 0, maximum: 1 }),
                },
                { additionalProperties: false },
            ),
        ),
        /**
         * Die gewählte Fläche auf der Karte (WI-0043): leuchtende Füllung, weicher Schein, klare Kontur
         * und ihr Name. Die Farben stehen unter `colour` (`mapSelection`, `mapSelectionGlow`); hier stehen
         * Deckkraft und Maße in Pixeln.
         */
        mapSelection: Type.Object(
            {
                fillOpacity: Type.Number({ exclusiveMinimum: 0, maximum: 1 }),
                lineWidth: Type.Number({ exclusiveMinimum: 0 }),
                glowWidth: Type.Number({ exclusiveMinimum: 0 }),
                glowBlur: Type.Number({ minimum: 0 }),
                /**
                 * Die Größe des Namens eines gewählten GEBIETS (WI-0062, F7) - und die Rückfallgröße eines
                 * versetzten Flächennamens, solange die Karte seine Beschriftung noch nie gezeigt hat.
                 *
                 * 🔴 Der Name einer gewählten LANDSCHAFT steht seit WI-0093 nicht mehr in dieser Größe,
                 * sondern in seiner eigenen (`label_size` aus `map_label_effective`): „dieselbe Größe wie
                 * ungewählt" ist eine Regel, kein Wert.
                 */
                labelSize: Type.Number({ exclusiveMinimum: 0 }),
                /** Der gewählte Weg (WI-0044): Deckkraft seiner goldenen Linie. */
                pathOpacity: Type.Number({ exclusiveMinimum: 0, maximum: 1 }),
                /** Ihre Breite in Pixeln, bei jedem Zoom gleich; je Wegart abweichend in `pathWidthByType`. */
                pathWidth: Type.Number({ exclusiveMinimum: 0 }),
                pathWidthByType: Type.Record(Type.String(), Type.Number({ exclusiveMinimum: 0 })),
                /** Das gewählte Band einer Themenansicht (Klimazonen): seine Deckkraft, die übrigen behalten die der Ansicht. */
                bandOpacity: Type.Number({ exclusiveMinimum: 0, maximum: 1 }),
            },
            { additionalProperties: false },
        ),
        /**
         * Das Messwerkzeug (Guide §17.13, Finding MCS-030). Nur die Strichelung steht hier: Breite, Farbe,
         * Griffmaße und Saum leitet `measure/measure-layers.ts` aus `mapSelection`, `route`, `icon` und
         * `colour` ab, weil Legacys Werte dort schon stehen. Begründung im `$measureComment` des Kanons.
         */
        measure: Type.Object(
            {
                /** `line-dasharray` in Vielfachen der Linienbreite: Legacys 10 px Strich und 8 px Lücke bei 4 px Breite. */
                lineDash: Type.Tuple([Type.Number({ exclusiveMinimum: 0 }), Type.Number({ exclusiveMinimum: 0 })]),
            },
            { additionalProperties: false },
        ),
        /**
         * Die Topographie der Landschaften (WI-0055): Höhenlinien, Höhenstufen und das Gipfeldreieck. Die
         * Farben stehen unter `colour` (`mapContour`, `mapHeight0` …); hier Maße, Deckkraft und Stufen.
         */
        topography: Type.Object(
            {
                contour: Type.Object(
                    {
                        /** Je Stufe [Hunderter, Fünfhunderter, Tausender]. */
                        minZoom: Type.Tuple([Type.Number(), Type.Number(), Type.Number()]),
                        /** Ab hier auch die Hunderter im Gebirge (eigene Kachelquelle). */
                        detailMinZoom: Type.Number(),
                        opacity: Type.Tuple([Type.Number(), Type.Number(), Type.Number()]),
                        zoomRange: Type.Tuple([Type.Number(), Type.Number()]),
                        widthLow: Type.Tuple([Type.Number(), Type.Number(), Type.Number()]),
                        widthHigh: Type.Tuple([Type.Number(), Type.Number(), Type.Number()]),
                        labelMinZoom: Type.Tuple([Type.Number(), Type.Number(), Type.Number()]),
                        labelZoom: Type.Tuple([Type.Number(), Type.Number()]),
                        labelSize: Type.Tuple([Type.Number(), Type.Number()]),
                        labelSpacing: Type.Number({ exclusiveMinimum: 0 }),
                    },
                    { additionalProperties: false },
                ),
                /** Ab welcher Höhe (Schritt) die Stufe `colour.mapHeight<i>` beginnt, aufsteigend. */
                heightSteps: Type.Array(Type.Number(), { minItems: 2 }),
                peak: Type.Object(
                    {
                        minZoom: Type.Number(),
                        sizeStops: Type.Array(Type.Tuple([Type.Number(), Type.Number()]), { minItems: 1 }),
                        triangleHeight: Type.Number({ exclusiveMinimum: 0 }),
                        triangleHalfWidth: Type.Number({ exclusiveMinimum: 0 }),
                        /** Luft zwischen Spitze des Dreiecks und Unterkante der Schrift, in Anteilen der Schriftgröße. */
                        triangleGap: Type.Number({ minimum: 0 }),
                        heightScale: Type.Number({ exclusiveMinimum: 0 }),
                    },
                    { additionalProperties: false },
                ),
            },
            { additionalProperties: false },
        ),
        mapLabel: Type.Object(
            {
                families: Type.Record(Type.String(), LabelFamily),
            },
            { additionalProperties: true },
        ),
    },
    { $id: "DesignCanon", additionalProperties: true },
);

export type DesignCanon = Static<typeof DesignCanon>;
export type LabelFamily = Static<typeof LabelFamily>;

/** Die Familien, die es gibt. Ein Tippfehler wird damit ein Typfehler, kein stiller Rückfall. */
export const LABEL_FAMILIES = ["place", "landscape", "climate", "path", "peak", "contour"] as const;
export type LabelFamilyName = (typeof LABEL_FAMILIES)[number];
