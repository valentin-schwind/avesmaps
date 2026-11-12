import { Type, type Static } from "@sinclair/typebox";

/**
 * Wie breit ein Name gezeichnet wird (WI-0004, Invariante I2).
 *
 * Die Ableitung muss wissen, wie lang ein Schriftlauf mindestens sein muss, und der Kachelbau, auf
 * welche Länge er ihn zuschneidet. Beides hängt an derselben Zahl, und die Zahl muss aus derselben
 * Typografie stammen, die MapLibre tatsächlich zeichnet - sonst ist „der Lauf ist länger als sein
 * Name" eine Hoffnung.
 *
 * Deshalb steht die Rechnung hier, einmal, und wird von der Ableitung, vom Kachelweg und von den
 * Tests benutzt. Die Vorschubwerte kommen aus `config/glyph-metrics/`, erzeugt aus genau den
 * `.pbf`-Dateien, die MapLibre lädt (`scripts/dev/build-glyph-metrics.mjs`).
 *
 * MapLibres eigene Formel, aus `shaping.ts` abgelesen:
 *
 *     x += metrics.advance * scale + spacing     je Glyphe
 *     lineLength = x - spacing                   der Zuschlag hinter der letzten faellt weg
 *
 * mit `spacing = letterSpacing * ONE_EM` und `ONE_EM = 24`. Es sind also **n-1 Lücken**, nicht n -
 * ein Fehler, der sich bei einem kurzen Namen versteckt und bei einem langen auffaellt.
 */

export const GlyphMetricModel = Type.Object(
    {
        schemaVersion: Type.Literal(1),
        fontStack: Type.String(),
        /** Die Em-Groesse der Vorschubwerte. MapLibres ONE_EM. */
        unitsPerEm: Type.Number({ exclusiveMinimum: 0 }),
        /** Vorschub fuer ein Zeichen, das die Schrift nicht fuehrt. Der breiteste, nie null. */
        fallbackAdvance: Type.Number({ minimum: 0 }),
        /** Codepunkt als Zeichenkette -> Vorschub in Em-Einheiten. */
        advances: Type.Record(Type.String(), Type.Number({ minimum: 0 })),
    },
    { $id: "GlyphMetricModel", additionalProperties: true },
);

export type GlyphMetricModel = Static<typeof GlyphMetricModel>;

export interface TextMetrics {
    /** Schriftgroesse in Bildschirmpixeln. */
    size: number;
    /** Sperrung in ems, wie `text-letter-spacing` im Stil. */
    letterSpacing: number;
}

/**
 * Die Breite eines Namens in Bildschirmpixeln, so wie MapLibre ihn setzt.
 *
 * Gezaehlt wird ueber Codepunkte, nicht ueber UTF-16-Einheiten: ein zusammengesetztes Zeichen
 * zaehlt einmal, sonst bekaeme es eine Luecke zu viel.
 */
export function measureTextWidth(model: GlyphMetricModel, text: string, metrics: TextMetrics): number {
    const codePoints = [...text];
    if (codePoints.length === 0) {
        return 0;
    }
    let advance = 0;
    for (const character of codePoints) {
        const code = character.codePointAt(0);
        advance += model.advances[String(code)] ?? model.fallbackAdvance;
    }
    const gaps = codePoints.length - 1;
    const spacing = metrics.letterSpacing * model.unitsPerEm * gaps;
    return ((advance + spacing) * metrics.size) / model.unitsPerEm;
}

/**
 * Wie lang ein Schriftlauf mindestens sein muss, damit der Name daraufpasst.
 *
 * Der Zuschlag ist kein Bauchgefuehl: Legacy haelt einen Sicherheitsrand von 4 Prozent und einen
 * Vorhalt von 15 Prozent, weil die Beruhigung den Bogen nachtraeglich kuerzt und der Name sonst
 * genau dann nicht mehr passt, wenn die Kurve ruhig genug geworden ist (Finding MCS-008). Ein Lauf,
 * der nur exakt so lang ist wie sein Name, verliert ihn beim ersten Rundungsschritt.
 */
export const RUN_HEADROOM = 1.196;

export function requiredRunLength(model: GlyphMetricModel, text: string, metrics: TextMetrics): number {
    return measureTextWidth(model, text, metrics) * RUN_HEADROOM;
}
