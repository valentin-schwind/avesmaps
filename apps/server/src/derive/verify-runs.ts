import { acceptedCurveOutside, KNOWN_OUTLIERS } from "./curve-review.ts";
import { RENDER_ZOOM_OFFSET, VECTOR_TILE_MAX_ZOOM } from "@avesmaps3d/shared";
import { settleChecks } from "../blocking-checks.ts";
import type { Database } from "../database.ts";

/**
 * Die Invarianten der Schriftläufe als ausführbare Prüfung (WI-0004, ADR-0007).
 *
 * Sie steht hier und nicht in einer Testdatei, weil sie zwei verschiedene Fragen beantworten muss:
 * ob die Ableitung an einer bekannten Form das Richtige tut (Test, kleine Fixture), und ob der
 * echte Bestand die Zusagen hält (`npm run verify:runs`, tausende Flächen). Zwei Abschriften
 * derselben Abfrage wären zwei Wahrheiten.
 *
 * Jede Prüfung nennt ihr Urteil und die ersten Abweichler; eine Zahl allein ist nichts, woran man
 * arbeiten kann.
 */

export interface RunCheck {
    name: string;
    passed: boolean;
    detail: string;
    offenders?: string[];
    /** Benannte Befunde: stehen im Bericht, entscheiden aber nicht über bestanden (die Prüfung nennt ihre Regel). */
    findings?: string[];
    /** Hält ein Ausfall das Urteil an? Sonst ist er ein Befund (`blocking-checks.ts`). */
    blocking?: boolean;
}

export interface RunReport {
    passed: boolean;
    checks: RunCheck[];
}

const SAMPLE = 5;

function check(
    name: string,
    passed: boolean,
    detail: string,
    offenders: string[] = [],
    findings: string[] = [],
): RunCheck {
    return {
        name,
        passed,
        detail,
        ...(offenders.length > 0 ? { offenders: offenders.slice(0, SAMPLE) } : {}),
        // Befunde stehen vollständig da: jeder ist ein Urteil, das jemand lesen soll, keine Stichprobe.
        ...(findings.length > 0 ? { findings } : {}),
    };
}

export async function verifyRuns(database: Database): Promise<RunReport> {
    const checks: RunCheck[] = [];

    const [totals] = await database<{ regions: number; runs: number; curved: number }[]>`
        SELECT
            (SELECT count(DISTINCT region_id)::int FROM landscape_label_run) AS regions,
            (SELECT count(*)::int FROM landscape_label_run) AS runs,
            (SELECT count(*)::int FROM region WHERE is_active AND label_curve_enabled) AS curved
    `;
    // Die Gegenliste zur Zahl: WELCHE Kurvenregion trägt keinen einzigen Lauf.
    //
    // 💣 Sie wird gebraucht, weil keine andere Prüfung dieser Datei diese Klasse sehen KANN:
    // `nur_aktive_kurvenregionen` prüft die Gegenrichtung (Läufe ohne Berechtigung), `I1`, `I2`,
    // `I4`, `I5`, `I6` und `kachel_liefert_im_band` setzen je eine Zeile in `landscape_label_run`
    // voraus, und `I7_name_bleibt` prüft das Punktlabel, nicht die Kurve. Eine Kurvenregion ohne
    // jeden Lauf berührt keine einzige dieser Abfragen (MCS-028, 2026-10-06).
    //
    // 🪤 Ohne öffentliche Kennung ist der Befund nicht nachschlagbar: „Farlornschwelle“ gibt es
    // zweimal, „Amboss“ und „Koschberge“ ebenfalls (Legacys „Umbau der Gebirge“). Der Name allein
    // benennt die Region nicht.
    const unrun = await database<{ publicId: string; name: string }[]>`
        SELECT r.public_id AS "publicId", r.name
        FROM region r
        WHERE r.is_active AND r.label_curve_enabled
          AND NOT EXISTS (SELECT 1 FROM landscape_label_run x WHERE x.region_id = r.id)
        ORDER BY r.name
    `;
    // 🪤 Ohne diese Prüfung wäre ein leerer Bestand in jeder folgenden Abfrage grün. Ein Werkzeug,
    // das nichts geprüft hat, darf nicht "bestanden" sagen (Kap. 11.155).
    //
    // 🔴 Das URTEIL bleibt `regions > 0` — die fehlenden Regionen sind ein BEFUND, keine neue
    // blockierende Prüfung. `BLOCKING_CHECKS` ist seit der Betreiberentscheidung vom 2026-10-03
    // leer, und eine Aktualitäts- oder Vollzähligkeitsregel der Entwicklung ist keine
    // Betreiberentscheidung (`blocking-checks.ts`). Heute ist die eine Lücke „Wargenkuppen“ bekannt
    // und richtig (ungültige Geometrie in Legacy, I7); morgen wäre es ein abgebrochener
    // `derive:runs`, und der stand bisher nirgends.
    checks.push(
        check(
            "abgeleitet",
            (totals?.regions ?? 0) > 0,
            `${String(totals?.regions ?? 0)} von ${String(totals?.curved ?? 0)} Kurvenregionen, ${String(totals?.runs ?? 0)} Instanzen` +
                (unrun.length > 0 ? `, ${String(unrun.length)} ohne Lauf` : ""),
            [],
            unrun.map((row) => `ohne Lauf: ${row.name} (${row.publicId})`),
        ),
    );

    // Läufe gehören nur aktiven Regionen mit eingeschalteter Kurve. Bei einer stillgelegten Region
    // zeichnet die Sicht sie nicht, bei einer ausgeschalteten Kurve aber doch (Legacy-Stand 2026-09-26).
    // derive:runs räumt beides weg; diese Prüfung sagt, wenn etwas liegen blieb.
    const orphaned = await database<{ name: string }[]>`
        SELECT DISTINCT reg.name FROM landscape_label_run r JOIN region reg ON reg.id = r.region_id
        WHERE NOT (reg.is_active AND reg.label_curve_enabled)
        ORDER BY reg.name
    `;
    checks.push(
        check(
            "nur_aktive_kurvenregionen",
            orphaned.length === 0,
            orphaned.length === 0
                ? "jeder Lauf gehört einer aktiven Region mit eingeschalteter Kurve"
                : `${String(orphaned.length)} Regionen außerhalb der Kurvenregionen tragen Läufe`,
            orphaned.map((row) => row.name),
        ),
    );

    // I7: der Name darf nie verschwinden. Ein fehlender Lauf ist erlaubt, ein fehlendes Label nicht.
    const nameless = await database<{ name: string }[]>`
        SELECT r.name FROM region r
        WHERE r.is_active AND r.label_curve_enabled
          AND NOT EXISTS (SELECT 1 FROM map_label l WHERE l.id = r.primary_label_id AND l.is_active)
        ORDER BY r.name
    `;
    checks.push(
        check(
            "I7_name_bleibt",
            nameless.length === 0,
            nameless.length === 0
                ? "jede Kurvenregion hat ihr Punktlabel"
                : `${String(nameless.length)} Regionen ohne Label`,
            nameless.map((row) => row.name),
        ),
    );

    // Seit WI-0018 steht jede Instanz einmal JE STUFE da: vollzählig heißt deshalb je Stufe.
    const miscounted = await database<{ name: string; zoom: number; claimed: number; actual: number }[]>`
        SELECT reg.name, r.run_min_zoom AS zoom, r.instance_count AS claimed, count(*)::int AS actual
        FROM landscape_label_run r JOIN region reg ON reg.id = r.region_id
        GROUP BY reg.name, r.region_id, r.instance_count, r.run_min_zoom
        HAVING count(*) <> r.instance_count
    `;
    checks.push(
        check(
            "I1_satz_vollzaehlig",
            miscounted.length === 0,
            miscounted.length === 0
                ? "jeder Satz trägt auf jeder Stufe, was er behauptet"
                : `${String(miscounted.length)} Sätze unvollständig`,
            miscounted.map(
                (row) => `${row.name} @z${String(row.zoom)}: ${String(row.actual)} statt ${String(row.claimed)}`,
            ),
        ),
    );

    const over = await database<{ name: string; count: number; max: number }[]>`
        SELECT reg.name, r.instance_count AS count, COALESCE(reg.label_curve_max, 1) AS max
        FROM landscape_label_run r JOIN region reg ON reg.id = r.region_id
        WHERE r.instance_count > COALESCE(reg.label_curve_max, 1)
    `;
    checks.push(
        check(
            "I1_hoechstzahl",
            over.length === 0,
            over.length === 0 ? "kein Satz über label_curve_max" : `${String(over.length)} Sätze zu groß`,
            over.map((row) => `${row.name}: ${String(row.count)} > ${String(row.max)}`),
        ),
    );

    // I2: auf der niedrigsten Stufe seines Bandes trägt der Lauf seinen Namen, auch der einzelne.
    //
    // 💣 Bis 2026-10-11 war der Satz mit EINER Instanz ausgenommen: „ein zu enger Platz kostet die Kurve, nicht den Namen“.
    // Es kostete den Namen. MapLibre setzt mit `line-center` keinen Namen, der länger ist als seine Linie, und das
    // Punktlabel schweigt, sobald die Region einen Lauf hat (`has_curve_run`): 34 Läufe in 26 Regionen ohne Namen
    // (Dairuchsee z5). Seither verlängert die Ableitung den Einzellauf (`ausweichLauf`), und I2 prüft ihn mit.
    const tooShort = await database<{ name: string; zoom: number; have: number; need: number }[]>`
        SELECT reg.name, r.run_min_zoom AS zoom,
               round(ST_Length(r.geom)::numeric, 2) AS have,
               round((r.name_width_px * (1024.0 / (512.0 * power(2, r.run_min_zoom))))::numeric, 2) AS need
        FROM landscape_label_run r JOIN region reg ON reg.id = r.region_id
        -- 🪤 \`name_width_px\` ist REAL (vier Byte, rund sieben Stellen) und wird beim Speichern
        -- gerundet. Ein Lauf, der GENAU so lang ist wie sein Name, las sich dann „36.06 < 36.06"
          -- (Tommellande, 2026-09-23). Der Spielraum ist die Genauigkeit von REAL, nicht mehr.
        WHERE ST_Length(r.geom) < r.name_width_px * (1024.0 / (512.0 * power(2, r.run_min_zoom))) * (1 - 1e-6)
    `;
    checks.push(
        check(
            "I2_laenger_als_der_name",
            tooShort.length === 0,
            tooShort.length === 0
                ? "jeder Lauf trägt seinen Namen ab seiner Stufe"
                : `${String(tooShort.length)} zu kurz`,
            tooShort.map((row) => `${row.name} @z${String(row.zoom)}: ${String(row.have)} < ${String(row.need)}`),
        ),
    );

    const gaps = await database<{ name: string; detail: string }[]>`
        -- 🔴 run_min_zoom ist RENDERZOOM, label_min_zoom eine FACHLICHE Stufe. Der Vergleich
        -- braucht deshalb den Versatz (WI-0015); ohne ihn meldet der Verifier ein Loch, wo keines
        -- ist, und uebersieht eines, wo eines waere. Der Wert kommt aus dem Modell, nicht als
        -- Ziffer in diesem SQL.
        -- 🪤 Keine Backticks in diesem Kommentar: er steht in einem Template-Literal.
        -- Oben endet die Pflicht an der hoechsten ausgelieferten Kachel (WI-0129): ein Band bis 8 hat Laeufe bis MapLibre 8,
        -- die Karte zeigt Stufe 8 aus dieser Kachel. Derselbe Deckel wie in der Ableitung (runCeilingBand).
        -- Unten beginnt ein Band ab Stufe 0 mit Kachel 0 (WI-0129 §17d), wie in der Ableitung (runFloorZoom).
        WITH bands AS (
            SELECT r.region_id, reg.name, r.run_min_zoom, r.run_max_zoom,
                   CASE WHEN l.label_min_zoom <= 0 THEN 0 ELSE l.label_min_zoom + ${RENDER_ZOOM_OFFSET} END AS label_min_zoom,
                   LEAST(l.label_max_zoom + ${RENDER_ZOOM_OFFSET}, ${VECTOR_TILE_MAX_ZOOM}) AS label_max_zoom
            FROM landscape_label_run r
            JOIN region reg ON reg.id = r.region_id
            -- Die WIRKSAMEN Baender (0057): dieselben, nach denen die Laeufe gerechnet wurden.
            JOIN map_label_effective l ON l.label_id = r.style_label_id
            WHERE r.instance = 0
        )
        SELECT name, format('%s..%s im Band %s..%s', run_min_zoom, run_max_zoom, label_min_zoom, label_max_zoom) AS detail
        FROM bands b
        WHERE (run_min_zoom > label_min_zoom
               AND NOT EXISTS (SELECT 1 FROM bands o WHERE o.region_id = b.region_id
                                                       AND o.run_max_zoom = b.run_min_zoom - 1))
           OR (run_max_zoom < label_max_zoom
               AND NOT EXISTS (SELECT 1 FROM bands o WHERE o.region_id = b.region_id
                                                       AND o.run_min_zoom = b.run_max_zoom + 1))
    `;
    checks.push(
        check(
            "I2_baender_lueckenlos",
            gaps.length === 0,
            gaps.length === 0 ? "kein Loch im Erscheinungsband" : `${String(gaps.length)} Lücken`,
            gaps.map((row) => `${row.name}: ${row.detail}`),
        ),
    );

    const overlaps = await database<{ name: string }[]>`
        SELECT DISTINCT reg.name
        FROM landscape_label_run a
        JOIN landscape_label_run b ON b.region_id = a.region_id
                                  AND b.instance_count <> a.instance_count
                                  AND b.run_min_zoom <= a.run_max_zoom
                                  AND b.run_max_zoom >= a.run_min_zoom
        JOIN region reg ON reg.id = a.region_id
    `;
    checks.push(
        check(
            "I2_baender_ueberschneidungsfrei",
            overlaps.length === 0,
            overlaps.length === 0
                ? "je Zoomstufe genau ein Satz"
                : `${String(overlaps.length)} Regionen mit zwei Sätzen auf einer Stufe`,
            overlaps.map((row) => row.name),
        ),
    );

    // I4: 30 Grad gegen die eigene Sehne, dieselbe Schranke, die `calmToChord` durchsetzt.
    const bent = await database<{ name: string; degrees: string }[]>`
        WITH parts AS (
            SELECT reg.name, r.id,
                   degrees(ST_Azimuth(ST_PointN(r.geom, s), ST_PointN(r.geom, s + 1))) AS seg,
                   degrees(ST_Azimuth(ST_StartPoint(r.geom), ST_EndPoint(r.geom))) AS chord
            FROM landscape_label_run r
            JOIN region reg ON reg.id = r.region_id
            CROSS JOIN LATERAL generate_series(1, ST_NPoints(r.geom) - 1) AS s
            WHERE NOT ST_Equals(ST_PointN(r.geom, s), ST_PointN(r.geom, s + 1))
        )
        SELECT name, round(max(LEAST(abs(seg - chord), 360 - abs(seg - chord)))::numeric, 1)::text AS degrees
        FROM parts GROUP BY name, id
        HAVING max(LEAST(abs(seg - chord), 360 - abs(seg - chord))) > 30.001
    `;
    checks.push(
        check(
            "I4_beruhigt",
            bent.length === 0,
            bent.length === 0 ? "kein Lauf knickt über 30 Grad" : `${String(bent.length)} Läufe zu scharf`,
            bent.map((row) => `${row.name}: ${row.degrees} Grad`),
        ),
    );

    // I5: die Kurve darf die Fläche verlassen — Legacy lässt sie das ausdrücklich, um zwischen
    // Lappen zu überbrücken und um Buchten abzukürzen (MCS-008). Die Prüfung verbietet das nicht,
    // sie zieht die Grenze: die MEHRHEIT der Lauflänge muss über der eigenen Fläche liegen.
    //
    // 🪤 Eine strengere Schwelle misst die Breite der Fläche, nicht die Lage des Namens. Bei einem
    // Hangwald — einem Streifen am Gebirgsrand — läuft der Name auf der Karte sichtbar richtig und
    // verlässt den Streifen trotzdem auf Teilstücken. Bei 98 Prozent waren 79 von 124 Läufen rot,
    // während die Sichtprüfung an allen sechs Legacy-Referenzflächen einwandfrei war.
    //
    // 🔴 Eine KONKAVE Fläche ist ein Befund, kein Fehler (Betreiber 2026-09-30, Syrrenauen: „sie sollen ihren Bogen
    // beibehalten“). Besteht die Fläche aus EINEM Polygon und liegt ihr Schwerpunkt außerhalb, legt Legacys Verfahren
    // (Polynomfit im Hauptachsenframe, `fitCurve`) den Lauf bewusst über die Biegung. Der Bogen gilt als richtig, wie
    // Legacys Algorithmus ihn legt, und die Ableitung ändert ihn nicht. Ein solcher Lauf steht im Bericht (`findings`,
    // mit Innenanteil) und entscheidet nicht über bestanden. Die Regel nennt keine Region und gilt für jede Fläche;
    // für alle übrigen (Schwerpunkt innen, mehrere Teilflächen) bleibt I5 unverändert scharf.
    //
    // 🔴 Gemessen wird das KURVENSTÜCK. Die Ableitung setzt an jeden Einzellauf vorn und hinten je ein Segment entlang der
    // Sehne (`ausweichLauf`): den Ausweichraum (Migration 0110) und, wo die Fläche zu klein für den Namen ist, die Verlängerung
    // bis zum Namen (2026-10-11). Diese Stücke ragen oft hinaus (Efferdstränen z3: Name 46 Einheiten, Fläche 18 breit) und sagen
    // nichts über die Lage der Kurve. Dieselbe Regel wie `kurvenstueck` in der Ableitung; ein Satz mit mehreren Instanzen hat sie nicht.
    const containment = await database<{ name: string; zoom: number; share: string; concave: boolean }[]>`
        WITH measured AS (
            SELECT r.region_id, r.run_min_zoom,
                   CASE WHEN r.instance_count = 1 AND ST_NPoints(r.geom) >= 4
                        THEN ST_RemovePoint(ST_RemovePoint(r.geom, ST_NPoints(r.geom) - 1), 0)
                        ELSE r.geom END AS geom
            FROM landscape_label_run r
        )
        SELECT reg.name, m.run_min_zoom AS zoom,
               round((ST_Length(ST_Intersection(m.geom, shape.geom))
                      / NULLIF(ST_Length(m.geom), 0))::numeric, 3)::text AS share,
               (ST_NumGeometries(shape.geom) = 1 AND NOT ST_Contains(shape.geom, ST_Centroid(shape.geom))) AS concave
        FROM measured m
        JOIN region reg ON reg.id = m.region_id
        CROSS JOIN LATERAL (
            SELECT ST_Union(a.geom) AS geom FROM region_area a
            WHERE a.region_id = reg.id AND a.is_active
        ) shape
        WHERE ST_Length(ST_Intersection(m.geom, shape.geom)) <= 0.5 * ST_Length(m.geom)
        ORDER BY 2
    `;
    // Namentlicher Rückstand statt gleitender Schwelle. Die ersten sieben Regionen sind schmale oder
    // stark gebogene Formen, bei denen der Polynomfit dritten Grades die Fläche verlässt - dasselbe
    // Verfahren, das Legacy verwendet. Die Sichtprüfung an allen sechs Legacy-Referenzflächen ist
    // einwandfrei; diese sieben sind es nicht.
    //
    // 🔴 Betreiberentscheidung 2026-09-21: sie bleiben als kartografischer Review-Bestand stehen.
    // Der Algorithmus wird deswegen NICHT geändert - Legacys Verfahren bleibt maßgeblich, und
    // weder die rohe Achse noch ein Innenlage-Kostenanteil hat messbar verbessert. Der Betreiber
    // beurteilt die sieben selbst, bevor bewusst von Legacys Polynomfit abgewichen wird.
    //
    // Jede WEITERE Region außerhalb dieser Menge macht den Lauf rot - ausgenommen die konkaven Einzelflächen (Befund).

    const findings = containment.filter((row) => row.concave);
    const sharp = containment.filter((row) => !row.concave);
    const unexpected = sharp.filter((row) => !acceptedCurveOutside(row.name, row.concave));
    // 🪤 Gelistet und getroffen sind zwei Zahlen. Eine Region der Liste kann gerade über der
    // Schwelle liegen; sie bleibt trotzdem gelistet, weil ihr Lauf sich mit jeder Änderung der
    // Geometrie wieder verschieben kann. Beide Zahlen zu nennen kostet vier Wörter - sie zu
    // verwechseln hat die Dokumentation an drei Stellen falsch gemacht.
    //
    // 🪤 Und seit WI-0018 sind Läufe nicht mehr Regionen: eine Region trägt einen Lauf je Stufe.
    // Gezählt werden deshalb die REGIONEN, die Abweichler nennen ihre Stufe.
    const hitRegions = new Set(sharp.map((row) => row.name)).size;
    const findingRegions = new Set(findings.map((row) => row.name)).size;
    checks.push(
        check(
            "I5_laeuft_in_der_flaeche",
            unexpected.length === 0,
            unexpected.length === 0
                ? `jeder Lauf liegt mehrheitlich über seiner Fläche (${String(hitRegions)} von ${String(KNOWN_OUTLIERS.length)} gelisteten Review-Regionen aktuell darunter, ${String(sharp.length)} Läufe; Befund konkave Einzelfläche: ${String(findings.length)} Läufe in ${String(findingRegions)} Regionen)`
                : `${String(unexpected.length)} unerwartete Läufe liegen mehrheitlich daneben`,
            (unexpected.length === 0 ? sharp : unexpected).map(
                (row) => `${row.name} @z${String(row.zoom)}: ${row.share} innen`,
            ),
            findings.map(
                (row) =>
                    `${row.name} @z${String(row.zoom)}: ${row.share} innen (konkave Einzelfläche, Schwerpunkt außerhalb: Legacys Bogen bleibt)`,
            ),
        ),
    );

    // 🔴 Regression (Legacy-Stand 2026-09-28): Die Gruppierung nach Name allein hielt zwei
    // GLEICHNAMIGE, aber verschiedene aktive Regionen für dieselbe - Legacys „Umbau der Gebirge"
    // legt seither mehrfach denselben Namen an (Amboss, Koschberge je zweimal aktiv). Maßgeblich ist
    // die Region (`reg.id`), nicht ihr Name: `storeRuns` schreibt je Aufruf genau einen Fingerabdruck
    // je Region, ein Mix entsteht nur, wenn zwei Aufrufe für dieselbe Region ineinanderliefen.
    const mixed = await database<{ id: string; name: string; count: number }[]>`
        SELECT reg.id::text AS id, reg.name, count(DISTINCT r.source_fingerprint)::int AS count
        FROM landscape_label_run r JOIN region reg ON reg.id = r.region_id
        GROUP BY reg.id, reg.name HAVING count(DISTINCT r.source_fingerprint) > 1
    `;
    checks.push(
        check(
            "I6_ein_fingerabdruck_je_region",
            mixed.length === 0,
            mixed.length === 0
                ? "veraltet ist je Region feststellbar"
                : `${String(mixed.length)} Regionen mit gemischten Fingerabdrücken`,
            mixed.map((row) => `${row.name} (${row.id}): ${String(row.count)}`),
        ),
    );

    // Die Kachelfunktion selbst: die Kachel, in der die Mitte eines Laufs liegt, muss auf dessen
    // niedrigster Stufe Bytes liefern. Ohne diese Probe wäre das Zoomband eine Spalte, die niemand
    // liest, und ein Tippfehler in der Funktion bliebe bis zur Sichtprüfung unbemerkt.
    const probes = await database<{ name: string; z: number; bytes: number }[]>`
        WITH probe AS (
            SELECT reg.name, r.run_min_zoom AS z,
                   floor((ST_X(ST_LineInterpolatePoint(v.geom, 0.5)) + 20037508.342789244)
                         / ((2 * 20037508.342789244) / power(2, r.run_min_zoom)))::int AS x,
                   floor((20037508.342789244 - ST_Y(ST_LineInterpolatePoint(v.geom, 0.5)))
                         / ((2 * 20037508.342789244) / power(2, r.run_min_zoom)))::int AS y
            FROM landscape_label_run r
            JOIN landscape_label_run_render v ON v.run_id = r.id
            JOIN region reg ON reg.id = r.region_id
            WHERE r.instance = 0
            ORDER BY reg.name
            LIMIT 20
        )
        SELECT name, z, length(landscape_label_run_tile(z, x, y))::int AS bytes FROM probe
    `;
    const empty = probes.filter((row) => row.bytes === 0);
    checks.push(
        check(
            "kachel_liefert_im_band",
            probes.length > 0 && empty.length === 0,
            `${String(probes.length - empty.length)} von ${String(probes.length)} Proben liefern Bytes`,
            empty.map((row) => `${row.name} @z${String(row.z)}`),
        ),
    );

    // Betreiber 2026-10-03: Nur Prüfungen aus `BLOCKING_CHECKS` lassen das Urteil scheitern; die übrigen sind Befunde.
    return settleChecks("verify:runs", checks);
}
