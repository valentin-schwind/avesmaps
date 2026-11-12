import {
    foldName,
    landscapeSearchHandlePattern,
    pathChainKey,
    pathSearchHandlePattern,
    placeNearZoom,
    renderZoomForBand,
    SEARCH_LIMIT,
    SEARCH_MIN_LENGTH,
    type InhalteVorkommenArt,
    type MapBounds,
    type SearchHit,
    type SearchResponse,
    type SearchSpracheSektion,
} from "@avesmaps3d/shared";
import type { PendingQuery, Row, TransactionSql } from "postgres";
import { SERVER_TIMEOUTS, withStatementTimeout, type Database } from "../database.ts";
import { landmarkenSektion } from "./landmarken-suche.ts";
import { gefaltet, likePattern, passtGefaltet } from "./like.ts";
import { sprachenSektion } from "./sprachen-index.ts";
import { gemessen, sucheVorkommen, type VorkommenSucheErgebnis } from "./vorkommen-suche.ts";

// Das Suchmuster steht in `like.ts` (auch die Sektion „Vorkommen“ und die Ortssuche der Anfragen brauchen es); der Name bleibt hier erreichbar.
export { likePattern };

/**
 * Der Search Core (WI-0013): vier Domänen, eine Frage — wie heisst es, und wo ist es?
 *
 * ⭐ DER GANZE BESTAND SIND 7.591 NAMEN. Das ist die Zahl, die diesen Kern klein macht: 3.396 Orte,
 * 1.047 Gebietsnamen, 719 Wegketten, 8 Klimazonen. Ein voller Durchlauf über `place` mit `ILIKE`
 * dauert gemessen **2 ms**.
 *
 * 💣 Damit erledigt sich die offene Frage D2 von selbst, und zwar anders als erwartet. Sie lautete
 * „unscharf oder Präfix — ist `pg_trgm` auf dem VPS verfügbar?". Bei 7.591 Zeilen braucht es weder
 * Erweiterung noch Index: ein Scan ist schneller, als jede Netzwerkrunde je sein wird. Eine
 * Abhängigkeit, die nichts beschleunigt, ist reine Schuld — und sie haette den Kern an eine Frage
 * gebunden, die nur Claudio beantworten kann.
 *
 * 🪤 `pg_trgm` bliebe trotzdem interessant, aber fuer etwas anderes: fuer TIPPFEHLER („Gareht"
 * findet „Gareth"). Das ist eine Produktentscheidung, keine Geschwindigkeitsfrage, und sie gehoert
 * in die volle Spotlight-Suche.
 */

/** Was aus der Datenbank kommt, bevor daraus ein Treffer wird. */
interface RawHit {
    kind: SearchHit["kind"];
    id: string;
    name: string;
    subtype: string | null;
    x: number;
    y: number;
    /** Die Region hinter einem Landschaftslabel (WI-0043); sonst `null`. */
    region: string | null;
    /** Der Ausschnitt des ganzen Wegs oder der ganzen Landschaft (WI-0044); sonst `null`. */
    min_x: number | null;
    min_y: number | null;
    max_x: number | null;
    max_y: number | null;
    /** Alle Regionen einer Landschaft ohne eigenes Label, gleichnamige zusammen (WI-0047); sonst `null`. */
    regions: string[] | null;
}

/** Griffe wie „Wald-925“ sind kein Name, nach dem jemand sucht (WI-0047, Legacy §5). Einmal gebaut. */
const GRIFF = landscapeSearchHandlePattern();

/**
 * Derselbe Riegel für Wege (WI-0105): „Pfad-3443“, „Strasse-5097“, „Meer-9281“ sind kein Name. Gemessen
 * standen 74 von 845 beschrifteten Ketten mit einem Griff in der Trefferliste, und `ORDER BY length(name)`
 * sortierte sie nach vorn - kurze Namen zuerst.
 *
 * 🪤 Der Riegel verbirgt den Griff JEDER Art, nicht nur den der eigenen; 38 aktive Wege tragen den Griff einer
 * fremden. Der blanke Artname („Weg“ für einen `Weg“) hängt an der Zeile und steht deshalb daneben.
 */
const WEG_GRIFF = pathSearchHandlePattern();

export interface SearchOptions {
    mapDomainId?: string;
    limit?: number;
    /**
     * Sucht ein Editor? Dann findet er auch einen Seeweg, aber nur über seinen GENAUEN Namen, etwa einen
     * Befund wie „Meer-699“ (Betreiber 2026-09-27: „kannst du für editoren es zulassen dorthin zu 'fliegen'
     * wenn sie exakt den namen in der spotlightsuche eingeben?“). Die Karte zeigt keine Seewege mehr; die
     * goldene Markierung des Treffers zeigt, wo er liegt.
     */
    editor?: boolean;
    /**
     * Die Klimazonen, deren Name in der Sprache des Browsers zur Anfrage passt (Schlüssel, WI-0171; Betreiber
     * 2026-10-15: „Der Browser schickt die passenden Schlüssel mit, Deutsch bleibt zusätzlich serverseitig“).
     *
     * 🔴 Die acht Namen stehen in der Sprachtafel (`climate.zone.*`), nicht hier: `climate_zone_type.label` ist und
     * bleibt der deutsche Stamm. Der Zweig unten findet deshalb ZWEIERLEI - was dieser Liste entspricht, und was dem
     * deutschen Namen entspricht. Ohne Liste sucht die Zone wie vor WI-0171.
     */
    climateKeys?: readonly string[];
    /**
     * Ist die Art eines Vorkommens durch den Inhaltsschalter ausgeblendet (`panel.lore.<art>`)? Eine ausgeblendete Art fehlt in der Sektion „Vorkommen“ und in den Begriffen der kurzen
     * Anfragen (WI-0257 S3a). Ohne Angabe gilt keine als ausgeblendet.
     */
    ausgeblendet?: (art: InhalteVorkommenArt) => boolean;
    /**
     * Wohin der Fehler des Vorkommen-Anteils (Sektion, Gebiete, kurze Anfragen) geht. Mit dieser Angabe bleibt die Suche der Orte, Landschaften, Wege und Klimazonen bei einem
     * Fehler dort heil und liefert nur ihre eigenen Treffer (die Route meldet ihn); ohne sie fällt der Fehler durch, damit Tests ihn sehen.
     */
    onVorkommenFehler?: (fehler: unknown) => void;
    /**
     * Wohin der Fehler der Sektion „Sprachen“ geht (WI-0261 S5c). Wie bei den Vorkommen: Mit dieser Angabe bleibt die Suche heil und liefert nur ihre übrigen Treffer; ohne sie fällt der Fehler
     * durch, damit Tests ihn sehen.
     */
    onSprachenFehler?: (fehler: unknown) => void;
    /**
     * Die Dauer der Teile in Millisekunden (`haupt`, `vorkommen` mit `index`, `katalog`, `anfrage`, `sprachen`, `landmarken`); die Route schreibt sie als
     * `Server-Timing` (Suche unter Last, Claudio 2026-11-01: in Production 1,2 bis 1,4 s ohne Last). Ohne Angabe misst niemand.
     */
    zeiten?: Map<string, number>;
    /**
     * Bekommt vor der eigentlichen Suche den Abfrageplan der Hauptabfrage (`EXPLAIN (ANALYZE, BUFFERS)`), Zeile für Zeile. Nur für die Betreiberroute
     * `/api/admin/system/suche-plan`: Die Hauptabfrage braucht auf der Stage 1,2 s gleich welches Wort, lokal 0,05 s, und den Plan dort sieht sonst niemand.
     */
    abfrageplan?: (zeilen: string[]) => void;
    /** Feuert, wenn niemand mehr auf die Antwort wartet (der Browser hat die Anfrage verworfen): Die Hauptabfrage bricht dann ab (57014). */
    signal?: AbortSignal;
}

/**
 * Sucht über die vier migrierten Domänen.
 *
 * 🔴 EIN Deckel über alles, und er wird um eins überzogen abgefragt: nur so ist „es gibt mehr"
 * beantwortbar, ohne ein zweites `count(*)` über denselben Bestand laufen zu lassen.
 *
 * Exakte Namen stehen vor Teiltreffern (WI-0114). Innerhalb beider Gruppen gilt die Klassenordnung
 * aus WI-0007: eine Metropole steht über einem Dorf, ein Ort über einer Landschaft. Das bleibt
 * die einfache Antwort auf D3. Legacys `map-search-scoring.php` ist ein eigenes Modul mit eigenem Test und gehört
 * nicht nebenbei nachgebaut.
 */
export async function search(
    database: Database,
    rawQuery: string,
    options: SearchOptions = {},
): Promise<SearchResponse> {
    const query = rawQuery.trim();
    const limit = options.limit ?? SEARCH_LIMIT;
    const mapDomainId = options.mapDomainId ?? "aventuria";
    const editor = options.editor === true;
    const climateKeys = [...(options.climateKeys ?? [])];

    if (query.length < SEARCH_MIN_LENGTH) {
        return { query, hits: [], truncated: false };
    }

    // Gefaltet auf beiden Seiten (OPS-000065): „Athykril“ findet „Âthykril“, „Strasse“ findet „Straße“, und umgekehrt.
    const muster = likePattern(foldName(query));
    const passt = (spalte: PendingQuery<Row[]>): PendingQuery<Row[]> => passtGefaltet(database, spalte, muster);
    // Einer mehr als der Deckel: der überzählige beantwortet `truncated`, ohne gezählt zu werden.
    const grenze = limit + 1;

    // Die Vorkommen laufen neben der Hauptabfrage; alle sind erst zusammen fertig (kein einzelnes `await`, das die anderen verwaisen ließe).
    const vorkommenLauf = sucheVorkommen(database, query, {
        ...(options.ausgeblendet === undefined ? {} : { ausgeblendet: options.ausgeblendet }),
        ...(options.zeiten === undefined ? {} : { zeiten: options.zeiten }),
    }).catch((fehler: unknown): VorkommenSucheErgebnis => {
        if (options.onVorkommenFehler === undefined) throw fehler;
        options.onVorkommenFehler(fehler);
        return {};
    });
    // Die Sprachen der Karte (WI-0261 S5c) laufen ebenso daneben: ein Durchlauf über wenige Zeilen im Speicher.
    const sprachenLauf = sprachenSektion(database, query).catch((fehler: unknown): SearchSpracheSektion | undefined => {
        if (options.onSprachenFehler === undefined) throw fehler;
        options.onSprachenFehler(fehler);
        return undefined;
    });
    // Die Landmarken (WI-0271 L6) sind eine eigene Sektion wie die Gebiete: ein kurzer Durchlauf über `terrain_peak`, neben der Hauptabfrage. Ein Fehler
    // dort ist einer der Suche (dieselbe Datenbank, dieselbe Art Abfrage wie die Orte), kein Zusatz, der still fehlen dürfte.
    const landmarkenLauf = landmarkenSektion(database, query, mapDomainId);
    const hauptLauf = database<RawHit[]>`
        WITH treffer AS (
            SELECT 'ort'::text AS kind,
                   p.public_id::text AS id,
                   p.name,
                   p.subtype,
                   ST_X(p.geom) AS x,
                   ST_Y(p.geom) AS y,
                   NULL::text AS region,
                   -- Ein Ort ist eine Stelle: Er hat keinen Ausschnitt (WI-0044).
                   NULL::box2d AS bounds,
                   NULL::text[] AS regions,
                   -- Die Klassenordnung aus WI-0007: eine Metropole vor einem Dorf.
                   COALESCE(r.rank, 50) AS ordnung
            FROM place p
            LEFT JOIN label_class_rank r ON r.scope = 'place' AND r.class_key = p.subtype
            WHERE p.is_active
              AND NOT COALESCE(p.is_hidden, FALSE)
              AND p.map_domain_id = ${mapDomainId}
              AND ${passt(database`p.name`)}

            UNION ALL

            -- 🪤 Die Landschaften kommen über ihre LABELS, nicht über die Flächen: ein Label trägt
            -- einen Punkt, eine Fläche nur einen Umriss. Wer eine Fläche anspringt, muss sich
            -- vorher überlegen, wohin genau — und das ist genau die Arbeit, die das Label schon
            -- getan hat.
            --
            -- 🔴 Die Fläche dahinter ist die REGION des Labels (WI-0043), über region_id und nur, wenn
            -- sie aktiv ist. Ein freies Label bekommt keine, und aus dem Namen wird keine geraten.
            SELECT 'landschaft'::text,
                   l.public_id::text,
                   l.name,
                   l.subtype,
                   ST_X(l.geom),
                   ST_Y(l.geom),
                   reg.public_id::text,
                   -- Der Ausschnitt: alle aktiven Flächen der Region (WI-0044). Ein freies Label hat keinen.
                   flaechen.box,
                   NULL::text[],
                   60
            -- 🪤 Erst der Name, in einer Unterabfrage hinter OFFSET 0 (OPS-000065): Als Bedingung daneben ordnete PostgreSQL ihn nach
            -- Kosten hinter den Griff-Regex, und der lief über jede Zeile statt über die Treffer.
            FROM (SELECT * FROM map_label WHERE ${passt(database`name`)} OFFSET 0) l
            LEFT JOIN region reg ON reg.id = l.region_id AND reg.is_active
            LEFT JOIN LATERAL (
                SELECT ST_Extent(a.geom) AS box
                FROM region_area a
                WHERE a.region_id = reg.id AND a.is_active
            ) flaechen ON TRUE
            -- 🔴 Nur aktive Beschriftungen (WI-0043 B5, Sicherheitsprüfung S-14): Eine stillgelegte wäre
            -- sonst ein Treffer, der auf eine Stelle ohne Namen zeigt.
            -- 🔴 Und kein Griff (WI-0047): 88 unsichtbare Labels heißen „Flussland/Flusstal-001“ und so
            -- weiter. Legacy nimmt sie im Frontend ganz heraus (Owner 14.09.2026).
            WHERE l.is_active
              -- Verborgene Landschaften (WI-0178 T41) nennt die Suche nicht.
              AND NOT EXISTS (SELECT 1 FROM region verborgen WHERE verborgen.id = l.region_id AND verborgen.is_hidden)
              AND l.name !~* ${GRIFF}

            UNION ALL

            -- 🔴 Die Landschaft OHNE eigenes Label ist selbst der Treffer (WI-0047, Betreiber 2026-09-26:
            -- „sie soll natürlich auch flächen ohne beschriftung finden“). Legacys Regeln (Owner 14.09.2026,
            -- landschaften-in-der-suche-design.md): Eine Region fällt nur heraus, wenn IHR EIGENES Label
            -- ihren Namen trägt - dann steht sie schon als Label da. Ein Griff ist kein Name.
            --
            -- 🔴 Gleicher Name, gleiche Art, gleiche Ebene ist EIN Treffer (Betreiber zu G1: „wir wollen
            -- A“): „Archipel der Perlen“ sind fünf Regionen, alle leuchten, der Ausschnitt umfasst alle.
            --
            -- Der Punkt liegt auf der größten Fläche; dort steht der Name der Auswahl. 💣 Eine ungültige
            -- Fläche aus Legacy wird dafür repariert wie bei den Routen-Landschaften: ST_PointOnSurface
            -- bräche sonst mit einer TopologyException die ganze Suche ab.
            SELECT 'landschaft'::text,
                   gruppe.regionen[1],
                   gruppe.name,
                   gruppe.region_type,
                   ST_X(gruppe.punkt),
                   ST_Y(gruppe.punkt),
                   gruppe.regionen[1],
                   gruppe.box,
                   gruppe.regionen,
                   60
            FROM (
                SELECT min(btrim(r.name)) AS name,
                       r.region_type,
                       array_agg(DISTINCT r.public_id::text ORDER BY r.public_id::text) AS regionen,
                       ST_Extent(a.geom) AS box,
                       (array_agg(
                           ST_PointOnSurface(CASE WHEN (ST_IsValidDetail(a.geom)).valid THEN a.geom
                                             ELSE ST_CollectionExtract(ST_MakeValid(a.geom, 'method=structure'), 3) END)
                           ORDER BY ST_Area(a.geom) DESC, a.public_id
                       ))[1] AS punkt
                -- Erst der Name, dann der Griff (wie bei den Labels oben).
                FROM (SELECT * FROM region WHERE ${passt(database`name`)} OFFSET 0) r
                JOIN region_area a ON a.region_id = r.id AND a.is_active
                WHERE r.is_active AND NOT r.is_hidden
                  AND r.map_domain_id = ${mapDomainId}
                  AND r.region_layer <> 'klima'
                  AND r.name !~* ${GRIFF}
                  AND NOT EXISTS (
                      SELECT 1 FROM map_label l
                      WHERE l.region_id = r.id AND l.is_active AND lower(btrim(l.name)) = lower(btrim(r.name))
                  )
                GROUP BY r.region_layer, r.region_type, lower(btrim(r.name))
            ) gruppe

            UNION ALL

            -- 💣 Je KETTE, nicht je Abschnitt. „Reichsstraße 2" besteht aus 74 Abschnitten; wer sie
            -- einzeln listet, liefert 74 Treffer für eine Straße. Der Schlüssel ist derselbe wie in
            -- der Beschriftung, und er wird derselbe bleiben, wenn der Wiki-Schlüssel kommt
            -- (MCS-014).
            --
            -- 💣 UND EINE KETTE IST NICHT IMMER EINE LINIE. 189 von 719 beschrifteten Ketten
            -- verschmelzen zu mehreren Stücken — Flussarme, Lücken im Bestand —, darunter „Der
            -- Große Fluss". Die Suche verwarf sie früher still. Das Sprungziel ist jetzt die Mitte
            -- des LÄNGSTEN Stücks: dort liegt die Straße, nicht in der Lücke zwischen zwei Armen.
            -- 🪤 Klammern Pflicht: ein ORDER BY in einem UNION-Zweig gilt sonst dem ganzen UNION.
            --
            -- 🔴 Ein Weg ist sein NAME, über Wegtypen hinweg (WI-0177 Schritt 2b, Legacys Regel (c)): Die
            -- Kennung ist der Kettenschlüssel name:Name (pathChainKey), die Art die häufigste seiner
            -- Abschnitte. Ein Seeweg desselben Namens ist kein zweiter Treffer (sonst trügen zwei Zeilen
            -- dieselbe Kennung); der Ausschnitt nimmt Seewege nur, wo der Name allein aus ihnen besteht.
            (SELECT DISTINCT ON (k.name)
                   'weg'::text,
                   ${pathChainKey("")}::text || k.name,
                   k.name,
                   k.subtype,
                   ST_X(ST_LineInterpolatePoint(stueck.geom, 0.5)),
                   ST_Y(ST_LineInterpolatePoint(stueck.geom, 0.5)),
                   NULL::text,
                   -- 🔴 Der GANZE Weg (Betreiber 2026-09-26: „ja - und ihn auch markieren“): alle aktiven
                   -- Abschnitte mit Name und Art, auch die ohne Beschriftung - dieselben, die die Markierung
                   -- auf der Karte trägt. „Der Große Fluss“ zeigt so den ganzen Fluss, nicht sein längstes Stück.
                   (SELECT ST_Extent(q.geom)
                    FROM path q
                    WHERE q.is_active
                      AND q.map_domain_id = ${mapDomainId}
                      AND q.name = k.name
                      AND (q.subtype <> 'Seeweg' OR k.nur_see)),
                   NULL::text[],
                   70
            -- 🪤 Der Griff-Riegel gilt NUR dem öffentlichen Zweig. Der Editor sucht einen Seeweg über den
            -- genauen Namen, und zwar gerade, um einen Befund zu finden - „Suchmeer-7“ muss er weiter finden.
            --
            -- 🔴 Seewege gibt es für die Suche nicht, wie für die Karte (Betreiber 2026-09-27: „wir tun so, als
            -- ob es seewege nicht mehr gibt“). Nur ein Editor findet einen, und nur über den genauen Namen:
            -- Er sucht dann einen Befund, keinen Weg.
            FROM (
                SELECT p.name, bool_and(p.subtype = 'Seeweg') AS nur_see, mode() WITHIN GROUP (ORDER BY p.subtype) AS subtype,
                       ST_LineMerge(ST_Collect(p.geom)) AS geom
                FROM path p
                WHERE p.is_active
                  AND p.map_domain_id = ${mapDomainId}
                  AND (
                      (p.subtype <> 'Seeweg' AND p.label_visible AND ${passt(database`p.name`)}
                       AND p.name !~* ${WEG_GRIFF} AND btrim(p.name) <> p.subtype)
                      OR (${editor} AND p.subtype = 'Seeweg' AND lower(btrim(p.name)) = lower(${query}))
                  )
                GROUP BY p.name
            ) k
            CROSS JOIN LATERAL ST_Dump(k.geom) AS stueck
            ORDER BY k.name, ST_Length(stueck.geom) DESC)

            UNION ALL

            -- 🔴 Klimazonen: EIN Treffer je Zone, das Sprungziel ist die Mitte ihres Bandes auf der
            -- Mittelsenkrechten der Karte (Betreiberentscheidung 2026-09-23). Ein Band reicht von
            -- Rand zu Rand, ein eigener Punkt steht nirgends — die Namen stehen an den Kartenrändern.
            --
            -- 💣 NICHT aus climate_label_render. Das ist die Renderansicht der NAMEN: EPSG:3857
            -- statt aventuria-v1 und zwei Zeilen je Zone, eine an jedem Rand. Die Liste zeigte jede
            -- Zone doppelt, und der Sprung las Meter als Karteneinheiten und landete in einer Ecke.
            --
            -- 💣 UND die Mitte des LÄNGSTEN Stücks, nicht die der ganzen Spanne: an der Khôm teilt eine
            -- Blase Steppen- und Wüstenzone an der Senkrechten, und die Mitte der Spanne läge in der
            -- Nachbarzone. Der Schwerpunkt taugt ebenso wenig — bei vier der acht Bänder liegt er
            -- außerhalb.
            (SELECT DISTINCT ON (b.type_key)
                   'klima'::text,
                   b.type_key,
                   t.label,
                   NULL,
                   ST_X(ST_LineInterpolatePoint(stueck.geom, 0.5)),
                   ST_Y(ST_LineInterpolatePoint(stueck.geom, 0.5)),
                   NULL::text,
                   -- Ein Klimaband reicht von Rand zu Rand: Es bleibt beim Mittelpunkt und seinem Zoom.
                   NULL::box2d,
                   NULL::text[],
                   80
            FROM climate_band b
            JOIN climate_zone_type t ON t.type_key = b.type_key
            CROSS JOIN LATERAL ST_Dump(ST_Intersection(
                b.geom,
                ST_SetSRID(ST_MakeLine(
                    ST_MakePoint((ST_XMin(b.geom) + ST_XMax(b.geom)) / 2, ST_YMin(b.geom)),
                    ST_MakePoint((ST_XMin(b.geom) + ST_XMax(b.geom)) / 2, ST_YMax(b.geom))
                ), 0)
            )) AS stueck
            WHERE t.is_active
              -- 🔴 Zweierlei, seit die Zonennamen übersetzt werden (WI-0171, Betreiber 2026-10-15): der deutsche Stamm
              -- in label, UND die Schlüssel, die der Browser aus seiner Sprachtafel geschickt hat. Der Stamm bleibt
              -- stehen, damit eine neue Sprachtafel ohne Serveränderung auskommt und eine geteilte Adresse weiter trifft.
              -- (Kein Backtick in dieser Abfrage: Sie steht selbst in einem Template-Literal.)
              AND (${passt(database`t.label`)} OR t.type_key = ANY(${climateKeys}::text[]))
              -- Berührt die Senkrechte das Band nur in einem Punkt, ist das kein Stück.
              AND ST_GeometryType(stueck.geom) = 'ST_LineString'
            ORDER BY b.type_key, ST_Length(stueck.geom) DESC)
        )
        SELECT kind, id, name, subtype, x, y, region,
               ST_XMin(bounds) AS min_x, ST_YMin(bounds) AS min_y,
               ST_XMax(bounds) AS max_x, ST_YMax(bounds) AS max_y,
               regions
        FROM treffer
        -- Ein genauer Landschaftsname darf nicht hinter Orts-Teiltreffern am Deckel verschwinden.
        -- Innerhalb beider Gruppen bleibt die Klassenordnung; Kennungen lösen letzte Gleichstände.
        ORDER BY (lower(${gefaltet(database, database`btrim(name)`)}) = ${foldName(query)}) DESC, ordnung, length(name), name, kind, id
        LIMIT ${grenze}
    `;
    // 🔴 Ohne JIT (Claudio 2026-11-01, Suche unter Last; Plan der Stage über `suche-plan`): Der Planer schätzt diese Abfrage auf rund 900.000
    // Kosteneinheiten, weit über `jit_above_cost`, und PostgreSQL übersetzte sie vor jedem Lauf. Von 1.296 ms waren 1.223 ms JIT, gleich welches
    // Wort; die Abfrage selbst brauchte gut 70 ms. Lokal gibt es kein LLVM, darum war die Suche dort schnell. Mit dem Signal endet die Abfrage,
    // sobald der Browser die Anfrage verwirft (ein neuer Tastendruck), statt die Datenbank weiter zu beschäftigen.
    const ohneJit = <T>(arbeit: (transaction: TransactionSql) => Promise<T>): Promise<T> =>
        withStatementTimeout(database, SERVER_TIMEOUTS.statementMs, arbeit, {
            jitOff: true,
            ...(options.signal === undefined ? {} : { signal: options.signal }),
        });
    if (options.abfrageplan !== undefined) {
        const plan = await ohneJit(
            (transaction) => transaction<{ "QUERY PLAN": string }[]>`EXPLAIN (ANALYZE, BUFFERS) ${hauptLauf}`,
        );
        options.abfrageplan(plan.map((zeile) => zeile["QUERY PLAN"]));
    }
    const { zeiten } = options;
    const [rows, zusatz, sprachen, landmarken] = await Promise.all([
        gemessen(
            zeiten,
            "haupt",
            ohneJit((transaction) => transaction<RawHit[]>`${hauptLauf}`),
        ),
        gemessen(zeiten, "vorkommen", vorkommenLauf),
        gemessen(zeiten, "sprachen", sprachenLauf),
        gemessen(zeiten, "landmarken", landmarkenLauf),
    ]);

    const truncated = rows.length > limit;
    const hits: SearchHit[] = rows.slice(0, limit).map((row) => ({
        kind: row.kind,
        id: row.id,
        name: row.name,
        ...(row.subtype === null ? {} : { subtype: row.subtype }),
        x: Number(row.x),
        y: Number(row.y),
        zoom: row.kind === "ort" ? placeNearZoom(row.subtype) : zoomForKind(row.kind),
        ...(row.region === null ? {} : { region: row.region }),
        ...(row.min_x === null || row.min_y === null || row.max_x === null || row.max_y === null
            ? {}
            : { bounds: [Number(row.min_x), Number(row.min_y), Number(row.max_x), Number(row.max_y)] as MapBounds }),
        // Nur eine Gruppe nennt ihre Regionen; eine einzelne steht schon in `region` (WI-0047).
        ...(row.regions !== null && row.regions.length > 1 ? { regions: row.regions } : {}),
    }));

    return {
        query,
        hits,
        truncated,
        ...zusatz,
        ...(sprachen === undefined ? {} : { sprachen }),
        ...(landmarken === undefined ? {} : { landmarken }),
    };
}

/**
 * Wie weit man heranfährt, wenn das Ziel keine Ortsklasse hat.
 *
 * 🪤 Ein Klimaband ist tausend Einheiten breit, ein Weg hundert, ein Gebietsname dazwischen. Eine
 * gemeinsame Zahl wäre für das eine zu nah und für das andere zu fern.
 */
export function zoomForKind(kind: SearchHit["kind"]): number {
    switch (kind) {
        case "klima":
            return renderZoomForBand(1);
        case "landschaft":
            return renderZoomForBand(3);
        default:
            return renderZoomForBand(4);
    }
}
