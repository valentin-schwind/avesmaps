import { Type, type Static } from "@sinclair/typebox";

/**
 * Wie die Wege aussehen (WI-0010 Stufe 1).
 *
 * 🔴 HIER STEHT KEIN KOSTENFAKTOR. Kartografische Wegdarstellung und Routingkosten sind zwei
 * Verantwortungen (Betreiberentscheidung 2026-09-21): eine Änderung der Darstellung darf nicht
 * nebenbei das Routing ändern. Beide benutzen die Wegart als Schlüssel — das ist eine Verbindung,
 * keine Verschmelzung.
 *
 * ⭐ Legacy belegt die Trennung selbst: seine Geschwindigkeiten stehen als Matrix
 * Verkehrsmittel × Wegart an ganz anderer Stelle, und `allowed_transports` hängt sogar am
 * einzelnen Weg. Der Kostenfaktor 1,0–2,0 in seinem Graphen ist nur eine vereinfachte Projektion
 * davon — in einer Kartografietafel wäre er gleich doppelt falsch einsortiert.
 *
 * 💣 Das Schema verbietet zusätzliche Felder (`additionalProperties: false`). Wer hier später ein
 * `speed` oder `cost` hinzufügt, bekommt einen Fehler statt einer stillen Vermischung.
 */

export const PathStyle = Type.Object(
    {
        /** Zeichenreihenfolge von unten nach oben. Wasser unten, Reichsstraßen oben. */
        order: Type.Integer({ minimum: 0 }),
        /** Die Füllung der Linie. */
        center: Type.String({ pattern: "^#[0-9a-f]{6}$" }),
        /** Der Saum darum — er trennt die Linie vom bunten Untergrund. */
        outline: Type.String({ pattern: "^#[0-9a-f]{6}$" }),
        centerWidth: Type.Number({ exclusiveMinimum: 0 }),
        outlineWidth: Type.Number({ exclusiveMinimum: 0 }),
        /** Die Farbe des NAMENS — hell, auf dunklem Halo (Legacy `getPathLabelStyle`). */
        labelColor: Type.String({ pattern: "^#[0-9a-f]{6}$" }),
        /**
         * Die Karte zeigt diese Wegart niemandem — weder Linie noch Name, auch keinem Editor. Seewege
         * (Betreiber 2026-09-27: „wir tun so, als ob es seewege nicht mehr gibt. sie sollen nicht mehr auf
         * der karte sein“); bis dahin sahen sie nur Editoren (2026-09-23, Legacy `IS_EDIT_MODE`).
         */
        hidden: Type.Optional(Type.Boolean()),
        $comment: Type.Optional(Type.String()),
    },
    { additionalProperties: false },
);
export type PathStyle = Static<typeof PathStyle>;

export const PathCartography = Type.Object(
    {
        $comment: Type.Optional(Type.String()),
        $trennungComment: Type.Optional(Type.String()),
        $orderComment: Type.Optional(Type.String()),
        $strokeComment: Type.Optional(Type.String()),
        $bachComment: Type.Optional(Type.String()),
        $labelComment: Type.Optional(Type.String()),
        $nichtUebernommen: Type.Optional(Type.String()),
        schemaVersion: Type.Literal(1),
        mapDomain: Type.String(),
        types: Type.Record(Type.String(), PathStyle),
        $breitenComment: Type.Optional(Type.String()),
        $pfeilComment: Type.Optional(Type.String()),
        /**
         * Die Stroemungspfeile auf den Fluessen (V11) — EDITORWERKZEUG, kein Kartenbild.
         *
         * 🪤 Die Fuellung steht hier mit Absicht NICHT: sie ist die Flussfarbe aus
         * `types.Flussweg.center`. Eine zweite Stelle fuer dieselbe Farbe waere genau der Fehler,
         * den WI-0008 abgeschafft hat.
         */
        flowArrow: Type.Object(
            {
                /** Bildschirm-Abstand zweier Pfeile. Legacys ARROW_SPACING_PX. */
                spacingPx: Type.Number({ exclusiveMinimum: 0 }),
                strokeColor: Type.String({ pattern: "^#[0-9a-f]{6}$" }),
                strokeOpacity: Type.Number({ minimum: 0, maximum: 1 }),
            },
            { additionalProperties: false },
        ),
        /**
         * Breitenfaktor je Wegart und Zoomstufe — sieben Werte in LEGACYS Zaehlung (z0..z6).
         *
         * 💣 Eine 0 heisst NICHT „unsichtbar", sondern „nicht auf der Karte". Legacy nimmt einen
         * Weg mit Faktor 0 ueber `pathShouldBeOnMap` heraus; bei uns setzt der Code daraus das
         * `minzoom` des Layers. Wer die 0 als Breite 0 zeichnete, liesse den Renderer jede
         * unsichtbare Linie weiter verarbeiten.
         *
         * 🪤 Eine Art, die hier FEHLT, ist nicht vergessen: Legacys `getPathWidthScale` gibt fuer
         * einen unbekannten Schluessel 1 zurueck. Genau daran haengt, dass Fluesse und Seewege nie
         * duenner werden und nie verschwinden.
         *
         * ⭐ `bach` steht als eigene Zeile, obwohl es keine Wegart ist. Diese Tafel beschreibt das
         * AUSSEHEN, nicht den Speicher — dieselbe Unterscheidung wie in Legacys eigenem Kommentar.
         */
        widthScale: Type.Record(Type.String(), Type.Array(Type.Number({ minimum: 0 }), { minItems: 7, maxItems: 7 })),
        /**
         * Ein Abschnitt im Tunnel ist gestrichelt (WI-0177, Migration 0172; Betreiber 2026-10-18: „du kannst unterirdische wege
         * (tunnel) auf der map gestrichelt darstellen“). Farbe und Breite bleiben die seiner Wegart; nur der Strich setzt aus, die
         * Kontur im selben Takt.
         */
        tunnel: Type.Object(
            {
                $comment: Type.Optional(Type.String()),
                /** Strich und Lücke in Vielfachen der Kernbreite (MapLibre `line-dasharray`). */
                dash: Type.Array(Type.Number({ exclusiveMinimum: 0 }), { minItems: 2, maxItems: 2 }),
            },
            { additionalProperties: false },
        ),
        /**
         * Die Karawanenroute (WI-0177 §30, Migration 0174): ein Kennzeichen über dem Wegtyp. Kontur und Kern bleiben die des Wegtyps,
         * darüber eine Punktreihe; der Name in eigener Farbe. Durchmesser und Abstand in Bildpunkten bei Faktor 1 der Breitentafel.
         */
        karawanenroute: Type.Object(
            {
                $comment: Type.Optional(Type.String()),
                dot: Type.String({ pattern: "^#[0-9a-f]{6}$" }),
                dotWidth: Type.Number({ exclusiveMinimum: 0 }),
                spacing: Type.Number({ exclusiveMinimum: 0 }),
                labelColor: Type.String({ pattern: "^#[0-9a-f]{6}$" }),
            },
            { additionalProperties: false },
        ),
        /**
         * Wasser im Überblick: dünne Linie ohne weiße Kontur, die Kontur erst im nahen Bild.
         *
         * Betreiberentscheidung 2026-09-23: „Im hohen Zoom sollten Flüsse nur noch als dünne
         * Linien und ohne weiße Kontur sichtbar sein. Die Kontur sollte erst bei hohen Zoomstufen
         * sichtbar sein."
         *
         * ⭐ Legacy kennt dieselbe Stufung (`PATH_RENDER_CONFIG.simplified*`: unter z3 Kontur-
         * Deckkraft 0) — und zeigt Besuchern in der Standardansicht die Flusslinien gar nicht, nur
         * die ins Kartenbild gemalten Flüsse und die Flussnamen. Die Schwelle hier liegt deshalb
         * höher als Legacys z3: ab `outlineFromBand` blendet die Kontur über eine Stufe ein.
         */
        water: Type.Object(
            {
                $comment: Type.Optional(Type.String()),
                /** Welche Wegarten Wasser sind. Ein Bach ist ein Flussweg und gehört mit dazu. */
                types: Type.Array(Type.String(), { minItems: 1 }),
                /** Ab diesem Band (Legacy-Zählung) steht die Kontur voll; eine Stufe davor beginnt sie. */
                outlineFromBand: Type.Integer({ minimum: 1, maximum: 6 }),
                /** Breite der Mittellinie unterhalb der Schwelle, in px. */
                thinCenterWidth: Type.Number({ exclusiveMinimum: 0 }),
            },
            { additionalProperties: false },
        ),
        /** Wie die Wegnamen aussehen. Der Halo ist schwarz — die Namen sind hell. */
        label: Type.Object(
            {
                $comment: Type.Optional(Type.String()),
                $groesseComment: Type.Optional(Type.String()),
                $laufComment: Type.Optional(Type.String()),
                $kalibrierungComment: Type.Optional(Type.String()),
                $winkelComment: Type.Optional(Type.String()),
                /**
                 * Die Grundgroesse der Wegnamen in Bildschirmpixeln. Die Aufschlaege aus
                 * `sizeDelta` kommen darauf.
                 *
                 * 💣 Diese Zahl stand zweimal im Code: als Literal `12` im Kartenlayer und als
                 * `LABEL_SIZE = 12` in der Ableitung der Schriftlaeufe. Zwei Stellen fuer eine
                 * Zahl, die zusammenpassen MUSS - der Lauf wird auf genau diese Groesse
                 * zugeschnitten, und ein Name, der breiter ist als sein Lauf, verschwindet
                 * ersatzlos.
                 */
                baseSize: Type.Number({ exclusiveMinimum: 0 }),
                /**
                 * Der optische Faktor des Betreibers auf die Wegnamen.
                 *
                 * ⭐ Getrennt von `baseSize`, nicht hineingerechnet: `baseSize` ist Legacys Zahl,
                 * dieser Faktor ist eine Entscheidung. Wer sie verschmilzt, kann hinterher nicht
                 * mehr sagen, welche der beiden er gerade aendert.
                 *
                 * 💣 Er geht auch in die ABLEITUNG der Schriftlaeufe ein. Ein Name, der breiter ist
                 * als sein Lauf, wird von MapLibre weggelassen - wer den Faktor nur im Kartenlayer
                 * erhoeht, laesst Wegnamen verschwinden, ohne dass irgendwo etwas meldet.
                 */
                calibration: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
                /**
                 * Wie stark die Linie unter einem Namen knicken darf (WI-0010 P5, 2026-09-23).
                 *
                 * 💣 `maxAngleDeg` IST MAPLIBRES `text-max-angle`: in keinem Stück von 3/5 der
                 * Schriftgröße darf die Linie um mehr drehen, sonst verwirft MapLibre den Namen
                 * STILL. Die Ableitung wählt die Läufe deshalb mit DERSELBEN Zahl aus, und der
                 * Kartenlayer setzt sie ausdrücklich — zwei Stellen, eine Quelle.
                 *
                 * ⭐ `maxTurnDeg` ist Legacys Deckel über den GANZEN Namen
                 * (`PATH_LABEL_MAX_TURN_DEG`): „passt ein Name nur noch in einen Bogen, wird er
                 * nicht gezeichnet."
                 */
                maxAngleDeg: Type.Number({ exclusiveMinimum: 0, maximum: 180 }),
                maxTurnDeg: Type.Number({ exclusiveMinimum: 0 }),
                /**
                 * Wie viel laenger die Schriftlaeufe geschnitten werden, als der Name bei
                 * `baseSize` braucht.
                 *
                 * 🪤 Ohne Reserve ist der Lauf exakt so lang wie der Name - und jede Vergroesserung
                 * laesst ihn verschwinden. Genau das hat der Betreiber gesehen: ab Faktor 1.05 waren
                 * die Wegnamen weg. Die Reserve ist der Spielraum, in dem sich die Schriftgroesse
                 * bewegen darf, OHNE die Laeufe neu abzuleiten.
                 */
                runHeadroom: Type.Number({ minimum: 1 }),
                haloColor: Type.String({ pattern: "^#[0-9a-f]{6}$" }),
                haloStrength: Type.Object(
                    { strasse: Type.Number({ minimum: 0 }), wasser: Type.Number({ minimum: 0 }) },
                    { additionalProperties: false },
                ),
                sizeDelta: Type.Object(
                    { Flussweg: Type.Number(), bach: Type.Number(), sonst: Type.Number() },
                    { additionalProperties: false },
                ),
            },
            { additionalProperties: false },
        ),
        provenance: Type.Object(
            {
                baselineId: Type.String(),
                source: Type.String(),
                note: Type.Optional(Type.String()),
            },
            { additionalProperties: false },
        ),
    },
    { additionalProperties: false },
);
export type PathCartography = Static<typeof PathCartography>;
