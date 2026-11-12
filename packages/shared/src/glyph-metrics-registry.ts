import { Value } from "@sinclair/typebox/value";
import { GlyphMetricModel } from "./glyph-metrics.ts";
import facultyGlyphic from "../../../config/glyph-metrics/faculty-glyphic-regular.json" with { type: "json" };
import facultyGlyphicItalic from "../../../config/glyph-metrics/faculty-glyphic-italic.json" with { type: "json" };

/**
 * Laedt die Vorschubtafel aus config/glyph-metrics, einmal validiert.
 *
 * Die Datei wird erzeugt, nicht gepflegt (scripts/dev/build-glyph-metrics.mjs). Ein Schriftwechsel
 * aendert Glyphen und Tafel im selben Lauf; sie koennen nicht auseinanderdriften.
 */
function parseModel(candidate: unknown, fileName: string): GlyphMetricModel {
    if (!Value.Check(GlyphMetricModel, candidate)) {
        const [firstError] = [...Value.Errors(GlyphMetricModel, candidate)];
        const detail = firstError ? `${firstError.path}: ${firstError.message}` : "unknown validation error";
        throw new Error(`invalid glyph metric model in ${fileName} (${detail})`);
    }
    return candidate;
}

export const FACULTY_GLYPHIC_METRICS: GlyphMetricModel = parseModel(facultyGlyphic, "faculty-glyphic-regular.json");

/**
 * Die Tafel des kursiven Stacks (Ruinennamen, MCS-015).
 *
 * ⭐ Gemessen sind ihre Vorschubwerte Zeichen fuer Zeichen dieselben wie die des Regular - die
 * synthetische Neigung schert die Glyphe, sie verschiebt den Vorschub nicht. Sie steht trotzdem als
 * eigene Tafel da: `build-glyph-metrics.mjs` erzeugt beide und meldet die Gleichheit als Zeile im
 * Lauf. Waere sie hier nur ein Alias, wuerde ein spaeterer Schriftwechsel sie still brechen.
 */
export const FACULTY_GLYPHIC_ITALIC_METRICS: GlyphMetricModel = parseModel(
    facultyGlyphicItalic,
    "faculty-glyphic-italic.json",
);
