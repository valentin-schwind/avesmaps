import { FACULTY_GLYPHIC_METRICS, requiredRunLength } from "@avesmaps3d/shared";
import { settleChecks } from "../blocking-checks.ts";
import type { Database } from "../database.ts";
import { LABEL_SIZE, runFitsAngle } from "./path-runs.ts";
import { calmestWindow, mapUnitsPerPixel, type Point } from "./run-geometry.ts";

/**
 * Die Zusicherungen über die Wegnamen-Schriftläufe (WI-0010 P5).
 *
 * 🪤 Eigene Prüfungen nur, wo der Wegfall sie wirklich braucht. Was `verify:runs` bei den
 * Landschaften prüft und hier genauso gälte, ist nicht abgeschrieben — geprüft wird, was bei Wegen
 * ANDERS ist:
 *
 *   * Ein Lauf liegt EXAKT auf seinem Weg. Bei den Landschaften ist die Achse abgeleitet und darf
 *     von der Fläche abweichen; hier ist die Geometrie authoritativ, und jede Abweichung wäre ein
 *     Name neben der Straße.
 *   * Ein Name steht einmal je Kette, nicht je Abschnitt. Das war der Anlass des ganzen Umbaus.
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

export async function verifyPathRuns(database: Database, mapDomainId = "aventuria"): Promise<RunReport> {
    const checks: RunCheck[] = [];

    // 0. abgeleitet — der Wächter über den BESTAND, vor allem, was ihn voraussetzt
    //
    // 💣 Ohne ihn war bei LEERER `path_label_run` nichts rot: Alle sechs folgenden Prüfungen haben
    // die Form `X.length === 0`, und vier davon (`auf_der_sichtbaren_linie`, `satz_vollzaehlig`,
    // `zoombaender_ueberschneidungsfrei`, `laenge_reicht_fuer_den_namen`) lesen ausschließlich aus
    // `path_label_run` — ohne eine Zeile finden sie nichts und sagen „bestanden“. Auch
    // `knickt_nicht_unter_dem_namen` meldete dann „0 von 0“. Ein abgebrochener `derive:path-runs`
    // wäre so unbemerkt geblieben. Ein Werkzeug, das nichts geprüft hat, darf nicht „bestanden“
    // sagen (Kap. 11.155). Derselbe Wächter steht seit MCS-028 in `verify-runs.ts` (`abgeleitet`).
    //
    // 🪤 „Soll einen Lauf haben“ heißt bei den Wegen ETWAS ANDERES als bei den Regionen. Dort ist es
    // `region.label_curve_enabled`, eine redaktionelle Einstellung aus Legacy. Einen solchen Schalter
    // gibt es beim Weg nicht: Maßgeblich ist, was `derivePathRuns` lädt — `path.is_active AND
    // path.label_visible`, gruppiert nach (`name`, `subtype`), also die KETTE. Genommen ist deshalb
    // ihre Bedingung, nicht die der Regionen.
    //
    // 🪤 Und anders als bei den Regionen ist eine Kette ohne Lauf hier der NORMALFALL, nicht der
    // Verdacht: Ein kurzer oder verschlungener Weg trägt seinen Namen auf keiner Stufe, auch nicht
    // auf z8. Diese Prüfung inventarisiert deshalb nur; ob eine fehlende Kette ein Defekt ist,
    // urteilt `kein_name_ohne_lauf` weiter unten (sie trennt „hätte Platz“ von „zu kurz“ und „zu
    // krumm“).
    //
    // 🔴 Das URTEIL ist `chains > 0` — die Ketten ohne Lauf sind ein BEFUND, keine neue blockierende
    // Prüfung. `BLOCKING_CHECKS` ist seit der Betreiberentscheidung vom 2026-10-03 leer und bleibt
    // es; eine Vollzähligkeitsregel der Entwicklung ist keine Betreiberentscheidung.
    const [totals] = await database<{ chains: number; labelled: number; runs: number }[]>`
        SELECT
            (SELECT count(*)::int FROM (
                SELECT 1 FROM path_label_run WHERE map_domain_id = ${mapDomainId} GROUP BY name, subtype
            ) s) AS chains,
            (SELECT count(*)::int FROM (
                SELECT 1 FROM path
                WHERE is_active AND label_visible AND map_domain_id = ${mapDomainId}
                GROUP BY name, subtype
            ) k) AS labelled,
            (SELECT count(*)::int FROM path_label_run WHERE map_domain_id = ${mapDomainId}) AS runs
    `;
    // Die Gegenliste zur Zahl: WELCHE Kette trägt keinen einzigen Lauf.
    //
    // 🪤 Der Name allein benennt die Kette nicht: „Eisenstraße" und „Walsachstraße" gibt es in je
    // VIER Arten, „Belen-Horas-Straße", „Bornstraße", „Gauweg" und sieben weitere in dreien
    // (gemessen 2026-10-06). Der Schlüssel ist (`name`, `subtype`); die öffentliche Kennung eines
    // Teilstücks kommt dazu, damit die Kette in `path` nachschlagbar ist.
    const unrun = await database<{ name: string; subtype: string; publicId: string; parts: number }[]>`
        WITH kette AS (
            SELECT p.name,
                   p.subtype,
                   min(p.public_id::text) AS public_id,
                   count(*)::int AS parts
            FROM path p
            WHERE p.is_active AND p.label_visible AND p.map_domain_id = ${mapDomainId}
            GROUP BY p.name, p.subtype
        )
        SELECT k.name, k.subtype, k.public_id AS "publicId", k.parts
        FROM kette k
        WHERE NOT EXISTS (
            SELECT 1 FROM path_label_run r
            WHERE r.name = k.name AND r.subtype = k.subtype AND r.map_domain_id = ${mapDomainId}
        )
        ORDER BY k.name, k.subtype
    `;
    checks.push({
        name: "abgeleitet",
        passed: (totals?.chains ?? 0) > 0,
        detail:
            `${String(totals?.chains ?? 0)} von ${String(totals?.labelled ?? 0)} Ketten mit sichtbarem Namen, ` +
            `${String(totals?.runs ?? 0)} Instanzen` +
            (unrun.length > 0 ? `, ${String(unrun.length)} ohne Lauf` : ""),
        // Befunde stehen vollständig da: jeder ist ein Urteil, das jemand lesen soll, keine Stichprobe.
        ...(unrun.length > 0
            ? {
                  findings: unrun.map(
                      (row) =>
                          `ohne Lauf: ${row.name} (${row.subtype}, ${String(row.parts)} Teilstück${row.parts === 1 ? "" : "e"}, ${row.publicId})`,
                  ),
              }
            : {}),
    });

    // 1. auf_der_sichtbaren_linie
    //
    // 🔴 DIE INVARIANTE HAT SICH AM 2026-09-22 GEÄNDERT. Sie hieß „der Lauf liegt auf der ROHEN
    // Weggeometrie"; seit die Karte eine geglättete Kurve zeichnet (Migration 0024), wäre das die
    // falsche Zusicherung — der Name läge exakt auf einer Linie, die niemand sieht. Geprüft wird
    // gegen `path_visual`, also gegen das, was gezeichnet wird.
    const abweichend = await database<{ name: string; abstand: number }[]>`
        WITH kette AS (
            SELECT p.name, p.subtype, ST_Collect(COALESCE(v.geom, p.geom)) AS geom
            FROM path p
            LEFT JOIN path_visual v ON v.path_id = p.id
            WHERE p.is_active AND p.label_visible AND p.map_domain_id = ${mapDomainId}
            GROUP BY p.name, p.subtype
        )
        SELECT r.name, ST_Distance(r.geom, k.geom) AS abstand
        FROM path_label_run r
        JOIN kette k ON k.name = r.name AND k.subtype = r.subtype
        WHERE ST_Distance(r.geom, k.geom) > 0.001
        ORDER BY abstand DESC
    `;
    checks.push({
        name: "auf_der_sichtbaren_linie",
        passed: abweichend.length === 0,
        detail: `${String(abweichend.length)} Läufe liegen nicht auf der gezeichneten Kurve`,
        offenders: abweichend.slice(0, SAMPLE).map((row) => `${row.name}: ${row.abstand.toFixed(4)}`),
    });

    // 2. kein_name_ohne_lauf — mit einer Unterscheidung, die der erste Entwurf nicht traf
    //
    // 🪤 „Kette ohne Lauf" ist nicht automatisch ein Fehler. Ein sehr kurzer Weg mit einem langen
    // Namen kann nicht beschriftet werden, auch bei z8 nicht — das ist Geometrie, keine Verletzung.
    // Gemeldet wird deshalb nur, wo PLATZ WÄRE und trotzdem kein Lauf entstand; die anderen werden
    // gezählt und genannt, aber sie lassen die Prüfung nicht fallen. Der erste Entwurf zählte
    // beides zusammen und hätte einen Normalfall zum Defekt erklärt.
    const ohneLauf = await database<{ name: string; subtype: string; laenge: number }[]>`
        WITH kette AS (
            -- 💣 DAS LÄNGSTE TEILSTÜCK, NICHT DIE SUMME DER KETTE. Ein Name steht auf EINER
            -- durchgehenden Linie; über eine Lücke hinweg kann er nicht laufen. Hier stand die
            -- Gesamtlänge der zusammengefügten Kette, und die Prüfung meldete daraufhin
            -- „Kronstraße von Hinterbruch nach Rivilauken" als Defekt: 9,70 Einheiten insgesamt,
            -- aber kein einzelnes Teilstück lang genug für diesen Namen. Die Ableitung arbeitet je
            -- Teilstück — der Prüfer muss dieselbe Frage stellen wie sie, sonst prüft er eine
            -- andere.
            SELECT p.name,
                   p.subtype,
                   MAX(ST_Length(teil.geom)) AS laenge
            FROM path p
            LEFT JOIN path_visual v ON v.path_id = p.id
            CROSS JOIN LATERAL (
                SELECT (ST_Dump(ST_LineMerge(COALESCE(v.geom, p.geom)))).geom AS geom
            ) AS teil
            WHERE p.is_active AND p.label_visible AND p.map_domain_id = ${mapDomainId}
            GROUP BY p.name, p.subtype
        )
        SELECT k.name, k.subtype, k.laenge
        FROM kette k
        WHERE NOT EXISTS (
            SELECT 1 FROM path_label_run r
            WHERE r.name = k.name AND r.subtype = k.subtype AND r.map_domain_id = ${mapDomainId}
        )
    `;
    // 🪤 Die ECHTE Glyphenmetrik, nicht `length(name) * 7`. Der erste Entwurf schätzte in SQL und
    // meldete daraufhin drei Ketten von 0,44 bis 0,74 Karteneinheiten als „hätte Platz" - sie
    // haben keinen. Eine Schätzung, die einen Normalfall zum Defekt erklärt, ist schlechter als
    // keine Prüfung: sie lehrt, das FAIL zu übersehen.
    //
    // 💣 Und die GLEICHE Größe wie die Ableitung, nicht noch einmal `12` von Hand. Das war die
    // dritte Kopie derselben Zahl — nach dem Kartenlayer und der Ableitung. Als die Läufe Reserve
    // bekamen, hielt dieser Prüfer weiter 12 für richtig und meldete sieben Ketten als Defekt, die
    // keiner sind: ein Prüfer, der seine eigene Annahme mitbringt, prüft sich selbst.
    const bedarfBeiMaxZoom = (name: string): number =>
        requiredRunLength(FACULTY_GLYPHIC_METRICS, name, { size: LABEL_SIZE, letterSpacing: 0 }) * mapUnitsPerPixel(8);
    const langGenug = ohneLauf.filter((row) => row.laenge >= bedarfBeiMaxZoom(row.name));
    // 🪤 Lang genug ist nicht dasselbe wie „hätte Platz". Seit die Ableitung auch die Krümmung
    // prüft (knickt_nicht_unter_dem_namen), bleibt ein verschlungener Bach namenlos, obwohl er lang
    // ist — auf keinem Stück läge der Name ruhig genug, auch nicht auf z8. Der Prüfer stellt
    // dieselbe Frage wie die Ableitung, sonst prüft er eine andere.
    const hatRuhigeStelle = async (name: string, subtype: string): Promise<boolean> => {
        const teile = await database<{ geojson: string }[]>`
            SELECT ST_AsGeoJSON((ST_Dump(ST_LineMerge(ST_Collect(COALESCE(v.geom, p.geom))))).geom, 15) AS geojson
            FROM path p
            LEFT JOIN path_visual v ON v.path_id = p.id
            WHERE p.is_active AND p.label_visible AND p.map_domain_id = ${mapDomainId}
              AND p.name = ${name} AND p.subtype = ${subtype}
        `;
        const breite = requiredRunLength(FACULTY_GLYPHIC_METRICS, name, { size: LABEL_SIZE, letterSpacing: 0 });
        return teile.some((teil) => {
            const punkte: Point[] = (JSON.parse(teil.geojson) as { coordinates: number[][] }).coordinates.map(
                ([x, y]) => ({ x: x as number, y: y as number }),
            );
            const fenster = calmestWindow(punkte, breite * mapUnitsPerPixel(8), undefined, (w) =>
                runFitsAngle(w, breite, 8),
            );
            return fenster.length >= 2;
        });
    };
    const haettePlatz: typeof langGenug = [];
    for (const row of langGenug) {
        if (await hatRuhigeStelle(row.name, row.subtype)) {
            haettePlatz.push(row);
        }
    }
    const zuKrummGesamt = langGenug.length - haettePlatz.length;
    checks.push({
        name: "kein_name_ohne_lauf",
        passed: haettePlatz.length === 0,
        detail: `${String(haettePlatz.length)} Ketten ohne Lauf, obwohl Platz wäre; ${String(ohneLauf.length - langGenug.length)} weitere sind zu kurz, ${String(zuKrummGesamt)} zu krumm für ihren Namen`,
        offenders: haettePlatz
            .slice(0, SAMPLE)
            .map((row) => `${row.name} (${row.subtype}): ${row.laenge.toFixed(2)} Einheiten`),
    });

    // 3. satz_vollzaehlig — eine Instanz ohne ihre Geschwister ergäbe eine halbe Beschriftung
    const unvollstaendig = await database<{ name: string; instance_count: number; ist: number }[]>`
        SELECT name, instance_count, count(*)::int AS ist
        FROM path_label_run
        WHERE map_domain_id = ${mapDomainId}
        GROUP BY name, subtype, part, instance_count
        HAVING count(*) <> instance_count
    `;
    checks.push({
        name: "satz_vollzaehlig",
        passed: unvollstaendig.length === 0,
        detail: `${String(unvollstaendig.length)} Sätze mit fehlenden Instanzen`,
        offenders: unvollstaendig
            .slice(0, SAMPLE)
            .map((row) => `${row.name}: ${String(row.ist)} von ${String(row.instance_count)}`),
    });

    // 4. zoombaender_ueberschneidungsfrei — sonst stünden zwei Sätze gleichzeitig auf derselben Linie
    const ueberlappend = await database<{ name: string; a: number; b: number }[]>`
        SELECT a.name, a.run_min_zoom AS a, b.run_min_zoom AS b
        FROM path_label_run a
        JOIN path_label_run b
          ON a.name = b.name AND a.subtype = b.subtype AND a.part = b.part
         AND a.instance_count < b.instance_count
        WHERE a.map_domain_id = ${mapDomainId}
          AND a.run_min_zoom <= b.run_max_zoom
          AND b.run_min_zoom <= a.run_max_zoom
        LIMIT 20
    `;
    checks.push({
        name: "zoombaender_ueberschneidungsfrei",
        passed: ueberlappend.length === 0,
        detail: `${String(ueberlappend.length)} Paare von Sätzen teilen sich eine Zoomstufe`,
        offenders: ueberlappend.slice(0, SAMPLE).map((row) => row.name),
    });

    // 5. laenge_reicht_fuer_den_namen — die Ableitung darf nichts versprechen, was nicht passt
    const zuKurz = await database<{ name: string; laenge: number; noetig: number }[]>`
        SELECT name,
               ST_Length(geom) AS laenge,
               name_width_px * (1024.0 / (512.0 * power(2, run_min_zoom))) AS noetig
        FROM path_label_run
        WHERE map_domain_id = ${mapDomainId}
          AND ST_Length(geom) < name_width_px * (1024.0 / (512.0 * power(2, run_min_zoom))) * 0.99
        ORDER BY 2
    `;
    checks.push({
        name: "laenge_reicht_fuer_den_namen",
        passed: zuKurz.length === 0,
        detail: `${String(zuKurz.length)} Läufe sind auf ihrer untersten Stufe kürzer als ihr Name`,
        offenders: zuKurz
            .slice(0, SAMPLE)
            .map((row) => `${row.name}: ${row.laenge.toFixed(2)} < ${row.noetig.toFixed(2)}`),
    });

    // 6. knickt_nicht_unter_dem_namen — MapLibre verwirft einen Namen auf einem Bogen STILL
    //
    // 💣 Gefunden 2026-09-23: von 42 Wegnamen in den Kacheln über Gareth setzte MapLibre selbst ohne
    // jede Konkurrenz nur 7. Prüfung 5 war grün — die Läufe waren lang genug, nur zu krumm. Länge
    // allein ist kein Versprechen, dass ein Name erscheint.
    const laeufe = await database<{ name: string; zoom: number; breite: number; geojson: string }[]>`
        SELECT name, run_min_zoom AS zoom, name_width_px AS breite, ST_AsGeoJSON(geom, 15) AS geojson
        FROM path_label_run
        WHERE map_domain_id = ${mapDomainId}
    `;
    const zuKrumm = laeufe.filter((lauf) => {
        const koordinaten = (JSON.parse(lauf.geojson) as { coordinates: number[][] }).coordinates;
        const punkte = koordinaten.map(([x, y]) => ({ x: x as number, y: y as number }));
        return !runFitsAngle(punkte, lauf.breite, lauf.zoom);
    });
    checks.push({
        name: "knickt_nicht_unter_dem_namen",
        passed: zuKrumm.length === 0,
        detail: `${String(zuKrumm.length)} von ${String(laeufe.length)} Läufen knicken unter ihrem Namen stärker, als MapLibre zulässt`,
        offenders: zuKrumm.slice(0, SAMPLE).map((lauf) => `${lauf.name} (ab z${String(lauf.zoom)})`),
    });

    // Betreiber 2026-10-03: Nur Prüfungen aus `BLOCKING_CHECKS` lassen das Urteil scheitern; die übrigen sind Befunde.
    return settleChecks("verify:path-runs", checks);
}
