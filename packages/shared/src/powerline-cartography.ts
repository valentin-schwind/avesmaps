import { Type, type Static } from "@sinclair/typebox";

/**
 * Wie die Kraftlinien aussehen (WI-0025).
 *
 * 🔴 Nur Darstellung. Was eine Kraftlinie verbindet und wie stark sie gebogen ist, steht in der
 * Datenbank; hier steht, wie die Karte sie zeichnet: die Leuchtlagen, das Wabern der Stränge (Legacys
 * Stellschrauben) und die Bögen am Himmel (Stufe 2).
 *
 * 💣 Das Schema verbietet zusätzliche Felder. Ein Tippfehler in einem Schlüssel fiele sonst still auf
 * einen Vorgabewert zurück, und die Karte sähe fast richtig aus.
 */

const Hex = Type.String({ pattern: "^#[0-9a-f]{6}$" });
const Anteil = Type.Number({ minimum: 0, maximum: 1 });

/** Ein Bereich `[von, bis]`, aus dem je Objekt gezogen wird; beide Grenzen in den Schranken. */
function Bereich(minimum: number, maximum: number) {
    const grenze = Type.Number({
        ...(Number.isFinite(minimum) ? { minimum } : {}),
        ...(Number.isFinite(maximum) ? { maximum } : {}),
    });
    return Type.Tuple([grenze, grenze]);
}

export const PowerlineGlow = Type.Object(
    {
        id: Type.String({ minLength: 1 }),
        color: Hex,
        /** Die Durchsichtigkeit im Strich (Legacys CSS `rgba`). */
        alpha: Anteil,
        /** Die Durchsichtigkeit der Lage (Legacys Leaflet-`opacity`). Beide multiplizieren sich. */
        opacity: Anteil,
        /** Bildschirmbreite in px, beim Zoomen gleich. */
        widthPx: Type.Number({ exclusiveMinimum: 0 }),
    },
    { additionalProperties: false },
);
export type PowerlineGlow = Static<typeof PowerlineGlow>;

export const PowerlineCartography = Type.Object(
    {
        $comment: Type.Optional(Type.String()),
        schemaVersion: Type.Literal(1),
        mapDomain: Type.String(),
        $glowComment: Type.Optional(Type.String()),
        /** Die Leuchtlagen von unten nach oben. */
        glow: Type.Array(PowerlineGlow, { minItems: 1 }),
        $auswahlComment: Type.Optional(Type.String()),
        /** Die Leuchtlagen der gewählten Kraftlinie, von unten nach oben; sie ersetzen `glow` für diese Linie. */
        auswahl: Type.Array(PowerlineGlow, { minItems: 1 }),
        $labelComment: Type.Optional(Type.String()),
        label: Type.Object(
            {
                color: Hex,
                alpha: Anteil,
                sizePx: Type.Number({ exclusiveMinimum: 0 }),
                /** Abstand über der Linie, in px. */
                offsetPx: Type.Number({ minimum: 0 }),
                /** Wiederholungsabstand entlang der Linie, in px (Legacys Wegnamen: 600). */
                repeatPx: Type.Number({ exclusiveMinimum: 0 }),
                haloColor: Hex,
                haloAlpha: Anteil,
                /**
                 * Saum und Weichzeichnung als Anteil der Schriftgröße.
                 *
                 * 🪤 Legacys Schein (0,14) lässt sich in MapLibre nicht nachbauen: der Saum lebt im Rand
                 * der Glyphenbilder, und ein breiterer füllt die ganze Glyphenkachel - grauer Kasten
                 * hinter jedem Buchstaben. Beide zusammen bleiben deshalb unter 0,125 der Schrift.
                 */
                haloWidthRatio: Type.Number({ minimum: 0, maximum: 0.1 }),
                haloBlurRatio: Type.Number({ minimum: 0, maximum: 0.1 }),
                /** Ab welcher LEGACY-Zoomstufe die Namen stehen; bei uns eine Stufe höher (WI-0015). */
                fromLegacyZoom: Type.Integer({ minimum: 0 }),
            },
            { additionalProperties: false },
        ),
        $leyKnotenComment: Type.Optional(Type.String()),
        /** Die Nodices in der Kraftlinien-Ansicht als leuchtende Knoten (Legacy „Ley-Knoten“). */
        leyKnoten: Type.Object(
            {
                glowColor: Hex,
                /** Wie weit der Schein über die Scheibe hinausreicht, in px (Legacy `shadowBlur`). */
                glowPx: Type.Number({ minimum: 0 }),
                /** Wie kräftig der Schein ist. Legacys Schatten hat keinen eigenen Wert; 0,9 nach Augenmaß am Vergleichsbild. */
                glowOpacity: Anteil,
                hofColor: Hex,
                ringColor: Hex,
                ringShare: Anteil,
                kernColor: Hex,
                kernShare: Anteil,
                kernMinPx: Type.Number({ minimum: 0 }),
                /** Radius = Außenradius des Ortsmarkers × Faktor, mindestens `minRadiusPx`. */
                radiusFactor: Type.Number({ exclusiveMinimum: 0 }),
                minRadiusPx: Type.Number({ minimum: 0 }),
                /** Die Namen der Nodices unterhalb ihres Zoombands, in pt (Legacy: 8). */
                nameBelowBandPt: Type.Number({ exclusiveMinimum: 0 }),
                /** Wie weit der Schein eines glühenden Knotens rund um ihn wabert, als Anteil seiner Weite (nicht aus Legacy). */
                wabern: Anteil,
                /** Wie stark der ganze Knoten langsam an- und abschwillt, als Anteil (nicht aus Legacy). */
                puls: Anteil,
            },
            { additionalProperties: false },
        ),
        $straengeComment: Type.Optional(Type.String()),
        /** Legacys wabernde Stränge (`POWERLINE_RENDER_CONFIG`); die Formel steht im Shader. */
        straenge: Type.Object(
            {
                anzahl: Type.Integer({ minimum: 1, maximum: 8 }),
                /** Stützpunkte einer geraden Linie (Legacy 8); dazwischen läuft der Strang geglättet. */
                segmente: Type.Integer({ minimum: 2 }),
                /**
                 * Die Linienlänge in Karteneinheiten, bei der die Stränge so stark rauschen wie in Legacys Formel. Jede Linie
                 * rauscht im Verhältnis ihrer Länge zu diesem Wert: kurze ruhig, lange kräftiger, alle mit demselben Bild.
                 */
                bezugslaenge: Type.Number({ exclusiveMinimum: 0 }),
                /**
                 * Wie weit Stränge und Fäden um die Mitte ihres Bündels auseinanderlaufen, als Vielfaches von Legacys Versätzen bei der
                 * Bezugslänge. Gleich für jede Linie ab der Bezugslänge, kürzere im Verhältnis ihrer Länge schmaler.
                 */
                faecherbreite: Type.Number({ exclusiveMinimum: 0 }),
                /**
                 * Proben je Segment zwischen zwei Stützpunkten bei einer Linie der `bezugslaenge`; jede andere im Verhältnis ihrer
                 * Länge, mindestens zwei. So oft knickt das Band, so viele Ecken rechnet die Grafikkarte.
                 */
                proben: Type.Integer({ minimum: 1 }),
                /**
                 * Nah dran höchstens so viel feiner unterteilt, als Vielfaches von `proben`; eine Zweierpotenz (die Stufen sind 1, 2,
                 * 4 …). Jede Stufe liegt fertig auf der Grafikkarte, je Linie und Bild wird eine gewählt.
                 */
                verfeinerung: Type.Integer({ minimum: 1, maximum: 16 }),
                /** So lang darf ein gerades Stück eines Strangs auf dem Bildschirm höchstens werden, bevor die nächste Stufe gilt. */
                kantePx: Type.Number({ exclusiveMinimum: 0 }),
                normalScales: Type.Array(Type.Number({ minimum: 0 }), { minItems: 1 }),
                waveOffsets: Type.Array(Type.Number(), { minItems: 1 }),
                phaseStep: Type.Number(),
                tremorNormalAmplitude: Type.Number({ minimum: 0 }),
                tremorTangentAmplitude: Type.Number({ minimum: 0 }),
                tremorNormalSpeed: Type.Number({ minimum: 0 }),
                tremorTangentSpeed: Type.Number({ minimum: 0 }),
                tremorNormalFrequency: Type.Number({ minimum: 0 }),
                tremorTangentFrequency: Type.Number({ minimum: 0 }),
                tremorPhaseMultiplier: Type.Number(),
                interferenceAmplitude: Type.Number({ minimum: 0 }),
                interferenceSpeed: Type.Number({ minimum: 0 }),
                /** Legacys Bildtakt: 33 ms, gut 30 Bilder je Sekunde. */
                frameIntervalMs: Type.Integer({ minimum: 16 }),
            },
            { additionalProperties: false },
        ),
        $faedenComment: Type.Optional(Type.String()),
        /**
         * Feine Fäden neben Legacys Strängen (nicht aus Legacy): je Linie und Faden pseudozufällig aus der Kennung der
         * Linie, innerhalb dieser Bereiche. Stränge und Fäden zusammen höchstens acht: Jeder zeichnet das ganze Netz noch einmal.
         */
        faeden: Type.Object(
            {
                anzahl: Type.Integer({ minimum: 0, maximum: 7 }),
                /** Breite als Anteil der Leuchtlagen; ein Zug je Faden, der Breite und Leuchtkraft zusammen setzt. */
                breite: Bereich(0, 1),
                /** Deckkraft als Anteil der Leuchtlagen, mit demselben Zug wie die Breite: ein breiter Faden leuchtet stärker. */
                leuchtkraft: Bereich(0, 1),
                /** Wie weit er ausschlägt, wie Legacys `normalScales`. */
                ausschlag: Bereich(0, Number.POSITIVE_INFINITY),
                /** Sein Abstand von der Bahn, wie Legacys `waveOffsets` (Karteneinheiten vor dem Ausschlag). */
                versatz: Bereich(Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY),
            },
            { additionalProperties: false },
        ),
        $boegenComment: Type.Optional(Type.String()),
        /** Die Bögen am Himmel (Stufe 2): Höhe, Aufsteigen mit der Neigung, aufrechte Namen. */
        boegen: Type.Object(
            {
                /** Höhe als Anteil der Kettenlänge. */
                anteil: Type.Number({ exclusiveMinimum: 0, maximum: 1 }),
                /** Höchstens so hoch, in Bildschirmpixeln. */
                hoechstensPx: Type.Number({ exclusiveMinimum: 0 }),
                /** Ab dieser Neigung (Grad) stehen die Bögen ganz. */
                vollAbNeigung: Type.Number({ exclusiveMinimum: 0, maximum: 90 }),
                namePx: Type.Number({ exclusiveMinimum: 0 }),
                nameAbstandPx: Type.Number({ minimum: 0 }),
                nameWiederholungPx: Type.Number({ exclusiveMinimum: 0 }),
            },
            { additionalProperties: false },
        ),
        $magiersichtComment: Type.Optional(Type.String()),
        /** Der entsättigte Untergrund der Kraftlinien-Ansicht. */
        magiersicht: Type.Object(
            {
                /** CSS `saturate()`: 1 unverändert, 0 grau. */
                saturation: Anteil,
                /** CSS `brightness()`: 1 unverändert, darunter dunkler. */
                brightness: Anteil,
                transitionMs: Type.Integer({ minimum: 0 }),
            },
            { additionalProperties: false },
        ),
    },
    { additionalProperties: false },
);
export type PowerlineCartography = Static<typeof PowerlineCartography>;

/**
 * Hexfarbe plus Anteil als `rgba()` — die Form, in der Legacy die Kraftlinienfarben führt.
 *
 * 🪤 Eine Funktion statt eines zweiten Farbfelds: die Tafel soll den Ton und seine Durchsichtigkeit
 * getrennt zeigen, so wie Legacys CSS sie getrennt lesbar hat.
 */
export function rgbaColour(hex: string, alpha: number): string {
    const kanal = (start: number): number => Number.parseInt(hex.slice(start, start + 2), 16);
    return `rgba(${String(kanal(1))}, ${String(kanal(3))}, ${String(kanal(5))}, ${String(alpha)})`;
}
