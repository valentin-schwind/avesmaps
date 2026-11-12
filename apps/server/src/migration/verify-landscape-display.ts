import {
    AVENTURIA,
    AVENTURIA_LANDSCAPE_DISPLAY_DEFAULTS,
    MAX_BAND,
    DISPLAY_SIZE_BANDS,
    effectiveLandscapeDisplay,
    type LandscapeDisplayDefaults,
} from "@avesmaps3d/shared";
import { settleChecks } from "../blocking-checks.ts";
import type { Database } from "../database.ts";
import type { LandscapeDisplayInput } from "./landscape-display.ts";
import { rowsOf } from "./landscape-display.ts";

/**
 * Paritaet der Darstellungstafel gegen dieselbe Datei, aus der importiert wurde (WI-0064).
 *
 * Geprueft wird nicht nur, dass Zeilen da sind, sondern dass sie stimmen: die Zahl der Arten, gueltige Baender (Anfang vor
 * Ende oder ausdruecklich "aus"), jede Zeile Feld fuer Feld gegen die neu gerechnete wirksame Tafel, Stempel und SHA-256 der Datei
 * gegen die Herkunftszeile - und die WIRKUNG: dass jede Beschriftung ohne eigenes Band in `map_label_effective` das Band ihrer Art
 * traegt, gemessen am Bestand und nicht an einer Fixture.
 *
 * Befunde sind keine Fehler: sie melden, wo die Tafel Legacys Bestand nicht deckt oder etwas bewegt (Arten ohne Zeile, Baender
 * "aus", Beschriftungen, auf die die Tafel wirkt).
 */

export interface ParityCheck {
    name: string;
    passed: boolean;
    detail: string;
    offenders?: string[];
    /** Hält ein Ausfall das Urteil an? Sonst ist er ein Befund (`blocking-checks.ts`). */
    blocking?: boolean;
}

export interface LandscapeDisplayParityReport {
    passed: boolean;
    stamp: string;
    checks: ParityCheck[];
    findings: string[];
}

const SAMPLE = 5;

function check(name: string, passed: boolean, detail: string, offenders: string[] = []): ParityCheck {
    return offenders.length > 0
        ? { name, passed, detail, offenders: offenders.slice(0, SAMPLE) }
        : { name, passed, detail };
}

interface StoredRow {
    art_key: string;
    band_from: number;
    band_to: number;
    curve_max: number;
    priority: number;
    sizes: number[];
}

export async function verifyLandscapeDisplay(
    database: Database,
    input: LandscapeDisplayInput,
    options: { mapDomainId?: string; defaults?: LandscapeDisplayDefaults } = {},
): Promise<LandscapeDisplayParityReport> {
    const mapDomainId = options.mapDomainId ?? AVENTURIA.mapDomain;
    const defaults = options.defaults ?? AVENTURIA_LANDSCAPE_DISPLAY_DEFAULTS;
    const effective = effectiveLandscapeDisplay(defaults, input.response);
    const wanted = rowsOf(effective);
    const checks: ParityCheck[] = [];
    const findings: string[] = [];

    const stored = await database<StoredRow[]>`
        SELECT art_key, band_from, band_to, curve_max, priority, size_by_band::float8[] AS sizes
        FROM landscape_display_art
        WHERE map_domain_id = ${mapDomainId}
        ORDER BY art_key
    `;
    const storedByKey = new Map(stored.map((row) => [row.art_key, row]));

    // 1. Die Arten: genau die der wirksamen Tafel (plus die Grundvorgabe), keine mehr, keine weniger.
    const missing = [...wanted.keys()].filter((art) => !storedByKey.has(art));
    const extra = stored.map((row) => row.art_key).filter((art) => !wanted.has(art));
    checks.push(
        check(
            "arten",
            missing.length === 0 && extra.length === 0,
            `${String(stored.length)} Zeilen, erwartet ${String(wanted.size)} (${String(wanted.size - 1)} Arten und die Grundvorgabe)`,
            [...missing.map((art) => `fehlt: ${art}`), ...extra.map((art) => `zu viel: ${art}`)],
        ),
    );

    // 2. Gueltige Baender, unabhaengig von den Sperren der Tabelle gemessen. Die Tabelle traegt das ZIEL (0..8, WI-0129):
    // Legacys `bis = 7` steht dort als 8.
    const badBands = stored
        .filter(
            (row) =>
                !(row.band_from >= 0 && row.band_from <= MAX_BAND) ||
                !(row.band_to >= -1 && row.band_to <= MAX_BAND) ||
                (row.band_to >= 0 && row.band_from > row.band_to),
        )
        .map((row) => `${row.art_key}: ${String(row.band_from)}..${String(row.band_to)}`);
    const off = stored.filter((row) => row.band_to < 0).map((row) => row.art_key);
    checks.push(
        check(
            "baender",
            badBands.length === 0,
            `jedes Band ab <= bis oder ausdruecklich aus (bis = -1); ${String(off.length)} aus`,
            badBands,
        ),
    );

    // 3. Schriftgroessen: neun je Zeile, innerhalb der Legacy-Schranken.
    const badSizes = stored
        .filter(
            (row) =>
                row.sizes.length !== DISPLAY_SIZE_BANDS ||
                row.sizes.some((size) => size < defaults.sizeLimits.min || size > defaults.sizeLimits.max),
        )
        .map((row) => `${row.art_key}: ${row.sizes.join(",")}`);
    checks.push(
        check(
            "groessen",
            badSizes.length === 0,
            `${String(DISPLAY_SIZE_BANDS)} Werte je Zeile in ${String(defaults.sizeLimits.min)}..${String(defaults.sizeLimits.max)}`,
            badSizes,
        ),
    );

    // 4. Paritaet Zeile fuer Zeile gegen die neu gerechnete wirksame Tafel.
    const differing: string[] = [];
    for (const [art, row] of wanted) {
        const have = storedByKey.get(art);
        if (have === undefined) continue;
        const fields: string[] = [];
        if (have.band_from !== row.band_from || have.band_to !== row.band_to) {
            fields.push(
                `Band ${String(have.band_from)}..${String(have.band_to)} statt ${String(row.band_from)}..${String(row.band_to)}`,
            );
        }
        if (have.curve_max !== row.curve_max)
            fields.push(`curveMax ${String(have.curve_max)} statt ${String(row.curve_max)}`);
        if (have.priority !== row.priority)
            fields.push(`Prioritaet ${String(have.priority)} statt ${String(row.priority)}`);
        if (have.sizes.map(Number).join(",") !== row.sizes.join(",")) {
            fields.push(`Groessen ${have.sizes.join(",")} statt ${row.sizes.join(",")}`);
        }
        if (fields.length > 0) differing.push(`${art}: ${fields.join("; ")}`);
    }
    checks.push(
        check(
            "paritaet",
            differing.length === 0,
            "jede Zeile gleich der aus Vorgaben und Uebersteuerung gerechneten",
            differing,
        ),
    );

    // 5. Herkunft: Stempel und SHA-256 der Datei gegen die Herkunftszeile.
    const [source] = await database<{ stamp: string; sha256: string; defaults_ref: string }[]>`
        SELECT stamp, sha256, defaults_ref FROM landscape_display_source WHERE map_domain_id = ${mapDomainId}
    `;
    const sourceDetail =
        source === undefined ? "keine Herkunftszeile" : `Stempel ${source.stamp}, Vorgaben ${source.defaults_ref}`;
    checks.push(
        check(
            "herkunft",
            source !== undefined &&
                source.stamp === effective.stamp &&
                source.sha256 === input.sha256 &&
                source.defaults_ref === effective.defaultsRef,
            source === undefined
                ? sourceDetail
                : `${sourceDetail}; Datei: Stempel ${effective.stamp}, Vorgaben ${effective.defaultsRef}`,
        ),
    );

    // 6. Die Wirkung, am Bestand gemessen: eigenes Band nur mit beiden Enden, sonst das der Tafel (Art, sonst Grundvorgabe).
    const wrongEffect = await database<{ public_id: string; name: string; detail: string }[]>`
        SELECT l.public_id::text AS public_id, l.name,
               format('Band %s..%s, erwartet %s..%s', e.label_min_zoom, e.label_max_zoom, w.want_min, w.want_max) AS detail
        FROM map_label l
        JOIN map_label_effective e ON e.label_id = l.id
        -- Bewusst anders gebaut als die Ansicht (COALESCE-Kette statt ORDER BY ... LIMIT 1): zwei Wege zum selben Ergebnis.
        LEFT JOIN landscape_display_art own ON own.map_domain_id = l.map_domain_id AND own.art_key = l.subtype
        LEFT JOIN landscape_display_art base ON base.map_domain_id = l.map_domain_id AND base.art_key = '*'
        CROSS JOIN LATERAL (
            SELECT CASE WHEN l.label_min_zoom IS NOT NULL AND l.label_max_zoom IS NOT NULL THEN l.label_min_zoom
                        ELSE COALESCE(own.band_from, base.band_from, l.label_min_zoom) END AS want_min,
                   CASE WHEN l.label_min_zoom IS NOT NULL AND l.label_max_zoom IS NOT NULL THEN l.label_max_zoom
                        ELSE COALESCE(own.band_to, base.band_to, l.label_max_zoom) END AS want_max
        ) w
        WHERE l.map_domain_id = ${mapDomainId}
          AND (e.label_min_zoom IS DISTINCT FROM w.want_min OR e.label_max_zoom IS DISTINCT FROM w.want_max)
        ORDER BY l.name
    `;
    checks.push(
        check(
            "wirkung",
            wrongEffect.length === 0,
            "jede Beschriftung traegt in map_label_effective ihr eigenes Band (beide Enden) oder das der Tafel",
            wrongEffect.map((row) => `${row.name} (${row.public_id}): ${row.detail}`),
        ),
    );

    // ---- Befunde ---------------------------------------------------------------------------------------------------
    const noRow = await database<{ subtype: string; labels: number }[]>`
        SELECT l.subtype, count(*)::int AS labels
        FROM map_label l
        WHERE l.is_active AND l.map_domain_id = ${mapDomainId} AND l.subtype IS NOT NULL
        GROUP BY l.subtype
        ORDER BY l.subtype
    `;
    const inherit = noRow.filter((row) => !wanted.has(row.subtype));
    if (inherit.length > 0) {
        findings.push(
            `Arten im Bestand ohne eigene Zeile in Legacys Tafel, sie erben die Grundvorgabe: ${inherit
                .map((row) => `${row.subtype} (${String(row.labels)})`)
                .join(", ")}`,
        );
    }
    if (off.length > 0) {
        findings.push(
            `Arten mit Band "aus" (bis = -1): ${off.join(", ")} - ihre Beschriftungen ohne eigenes Band erscheinen nirgends`,
        );
    }
    const [incomplete] = await database<{ n: number }[]>`
        SELECT count(*)::int AS n FROM map_label
        WHERE is_active AND map_domain_id = ${mapDomainId} AND (label_min_zoom IS NULL OR label_max_zoom IS NULL)
    `;
    findings.push(
        `Beschriftungen ohne vollstaendiges eigenes Band (auf sie wirkt die Tafel): ${String(incomplete?.n ?? 0)} - Legacy zaehlte am 2026-09-21 keine`,
    );
    const { overrides } = input.response;
    if (Object.keys(overrides.unapplied).length > 0) {
        findings.push(
            `von Legacy gefuehrt, nicht angewandt: ${Object.entries(overrides.unapplied)
                .map(([name, count]) => `${name} ${String(count)}`)
                .join(", ")}`,
        );
    }
    if (overrides.unknownSections.length > 0) {
        findings.push(
            `UNBEKANNTE Abschnitte in Legacys Antwort: ${overrides.unknownSections.join(", ")} - Werkzeug pruefen`,
        );
    }

    // Betreiber 2026-10-03: Nur Prüfungen aus `BLOCKING_CHECKS` lassen das Urteil scheitern; die übrigen sind Befunde.
    const settled = settleChecks("verify:landscape-display", checks);
    return { passed: settled.passed, stamp: effective.stamp, checks: settled.checks, findings };
}
