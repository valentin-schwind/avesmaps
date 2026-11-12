import {
    LORE_READING,
    LORE_ROWS,
    LORE_ROW_LIMIT,
    loreCountsContinent,
    loreGroupOrder,
    loreRowStands,
    subjectKey,
    type LoreCounts,
    type LoreEntryView,
    type LoreEverywhereLink,
    type LoreGroup,
    type LoreGroupView,
    type LoreKind,
    type LoreRowView,
    type SubjectDetailKind,
    type SubjectRef,
} from "@avesmaps3d/shared";
import type { Queryable } from "../../database.ts";
import {
    eintraegeAmFlaechenpunkt,
    eintraegeAnPunkten,
    KEIN_ERSATZ,
    ortszeileErsetzt,
    ortszeilenErsatz,
    vereinigeEintraege,
    type OrtszeilenErsatz,
} from "../../vorkommen/index.ts";
import { areaGroupMembers, territoryChains, type SubjectIndex } from "../subject-index.ts";
import { lookupWikiKey, wikiKeyOfLoreKey } from "../wiki-key-lookup.ts";

/**
 * Die Vorkommen eines Gegenstands (WI-0091, Vertrag `lore.yaml` -> `panelbezug`, D5): die vier Zeilen der Datentabelle - Waren,
 * Fauna, Flora, Spezies - und ihr aufgeklappter Inhalt.
 *
 * 🔴 **Die Regel ist Enthaltensein, nicht Bindung** (Betreiber 2026-10-06, wörtlich: „etwas kommt in einer region vor -> es wird
 * da gelistet. altenmohn ist im herz des kontinents - also werden dort alle vorkommen in dieser fläche gelistet. dasselbe für
 * wege, routenetappen, landschaften, politische regionen usw.“). Ein Vorkommen gehört einer Fläche; jeder Gegenstand, der IN
 * dieser Fläche liegt, listet es. Daraus werden zwei Listen und ein Link:
 *
 * - **„Direkt von hier“** (`here`, dazu `origin` für die Relation `herkunft`): der Gegenstand selbst trägt den Schlüssel - am ORT
 *   zusätzlich das tiefste Gebiet an seinem Punkt. 🪤 Das Gebiet ist streng genommen schon Enthaltensein; es bleibt hier, weil
 *   der Betreiber am 2026-10-06 sagte „‚Direkt hier‘ listet weiterhin wie bisher“. 🔴 Der Schlüssel `here` bleibt, der angezeigte
 *   Wortlaut heißt seit dem 2026-10-07 „Direkt von hier“ (Betreiber: „‚Direkt von hier‘ passt gut.“, WI-0103).
 * - **„Aus der Region“** (`region`): jede WEITERE Fläche, die ihn enthält - Landschaften über `region_area`, politische Gebiete
 *   über `territory_shape` beziehungsweise die Elternkette `territory.parent_id`.
 * - **„Überall in Aventurien“**: 🔴 **ein LINK auf die Landschaft „Aventurien“, keine Liste** (Betreiber 2026-10-06: „am besten
 *   wär eigentlich ein Link von ‚Überall in Aventurien‘-> klick -> ganze aventurien wird gezeigt und alle vorkommen in
 *   aventurien gelistet“). Dort sind genau diese Einträge ihr eigenes „Direkt von hier“. Darum reist kein einziger ihrer bis zu
 *   476 Namen je Art mehr mit - die Antwort trägt nur die Zahl und das Ziel. 🔴 **Und er steht ÜBERALL** (Betreiber 2026-10-07:
 *   „und ‚Überall in Aventurien‘ muss natürlich auch überall stehen, wenns in Aventurien ist :)“, WI-0103): auch an einem
 *   Gegenstand, der weder Eigenes noch Regionales trägt. 🔴 **Die Zeile entsteht deshalb, sobald sie etwas zu zeigen hat**
 *   (`loreRowStands`) - nicht erst, wenn ihr Zählsatz eine Zahl hat. Der Satz selbst zählt seit WI-0104 **nur die Listen**
 *   (`LORE_READING.countScope = "own"`, Betreiber 2026-10-07: „kannst du ‚überall in aventurien‘ von der zahl im header von
 *   vorkommen abziehen?“), an einem Gegenstand ohne Eigenes also 0.
 *
 * 🔴 **Aufgelöst wird über die typisierten Ziele, nie über einen Namen.** Der Import hat jede Ortszeile durch denselben Lookup
 * geschickt wie die Objektlinks (`wiki-key-lookup.ts`, `canonicalWikiKey`; `lore.yaml` -> `ortsbezug.aufloesung`) und das Ergebnis
 * in `lore_place_target` als echten Fremdschlüssel abgelegt. Der Leser fragt diese Fremdschlüssel; er schlägt keinen Schlüssel und
 * keinen Namen mehr nach. Nur der Objektlink am NAMEN eines Eintrags und das Ziel des Kontinentlinks gehen noch einmal durch
 * dieselbe Schleuse.
 *
 * 🪤 Die Brücke über das Detailfeld `geographic` ist NICHT gebaut: `territory_detail.geographic` ist Freitext, und ihn gegen
 * Schlüssel zu vergleichen wäre die Namensauflösung, die der Betreiber am 2026-10-05 verboten hat.
 *
 * 🪤 Weg und Kraftlinie sind KEIN Zielraum der Lore (`lore.yaml` -> `ortsbezug.schluesselraeume.weg_und_kraftlinie`): sie tragen
 * keine eigenen Einträge. `lore_place_target` hat keine `path_id`, und der CHECK `lore_place_target_one_target` erzwingt genau
 * eines von Ort, Gebiet, Region, Gipfel - das ist keine Lücke der Leseschicht, sondern des Schemas.
 *
 * 🔴 **Ein WEG erbt seit dem 2026-10-07 trotzdem** (Betreiber: „Wege sollen abgeleitete Vorkommen haben (‚Aus der Region‘)“,
 * WI-0103): alles, was seine Linie enthält. Er hat damit **nur** „Aus der Region“ und den Link, nie „Direkt von hier“ - genau die
 * Ansage. Dasselbe gilt für die **ROUTENETAPPE** (WI-0106, die Kette ihrer Wege als Linie) und für den **KARTENPUNKT**
 * (WI-0110, der angeklickte Punkt als Stelle). 🪤 **Die KRAFTLINIE bleibt leer**: der Betreiber hat sie nicht genannt, und
 * `LEGACY_ROWS.powerline` hat keinen Platz für die vier Zeilen. Eine halbe Rezeptur steht hier nicht herum - der Fall ist eine
 * Zeile und benannt.
 *
 * 🔴 **Seit WI-0257 S2 gelten neben den Ortszeilen die REGELN der Einträge** (Vertrag `lore.yaml` -> `regelauswertung`,
 * `apps/server/src/vorkommen/`): Ein Eintrag, dessen Regel den Gegenstand trifft, steht unter „Aus der Region“ - nie unter
 * „Direkt von hier“, das bleibt den Einträgen, die den Gegenstand selbst nennen. Ort, Gipfel, Kartenpunkt und Gebiet fragen die
 * Regeln an ihrem Punkt, eine Landschaft an dem Punkt ihrer Fläche (von größeren Landschaften erbt sie nur), ein Weg und eine
 * Etappe an Punkten ENTLANG der Linie (`PFAD_SCHRITT`). Ein Eintrag zählt einmal, auch wenn er über Ortszeile und Regel kommt.
 * Wo eine Regel denselben Ort genauer fasst als eine Ortszeile desselben Eintrags und derselben Beziehung, gilt nur die Regel
 * (`LORE_READING.ortszeileHinterRegel`, Vali 2026-10-29, WI-0257 §2 F2): `entriesAt` und `continentCounts` lassen diese Ortszeile aus. Nicht am Rahmen selbst: Eine Landschaft oder ein Gebiet als Gegenstand behält die Zeilen, die es nennt (`selfFrame`, Entscheid der Leitung).
 */

/**
 * Die Kontinentbegriffe, die in EINEM Kartenraum „überall“ heißen. Legacys feste Liste `AVESMAPS_LORE_CONTINENT_KEYS` nennt neun;
 * auf der Karte Aventurien gilt genau `aventurien` - Myranor, Uthuria, Tharun, Rakshazar und Riesland liegen nicht auf dieser
 * Karte und tragen nichts bei (gemessen: 1.174 Zeilen `aventurien`, 484 für die übrigen Kontinente).
 *
 * 🔴 Die Liste ist der Kartenraum, nicht die Lore: ein neuer Kartenraum bringt seinen Begriff hier mit. Ein unbekannter Kartenraum
 * bekommt keinen Link „Überall …“ - lieber keinen Link als einen falschen.
 */
const CONTINENT_KEYS_OF_DOMAIN: Readonly<Record<string, readonly string[]>> = { aventuria: ["aventurien"] };

/** Die Ziele einer Nähe: interne Kennungen je Tabelle, so wie `lore_place_target` sie führt. */
export interface LoreTargets {
    places: readonly number[];
    territories: readonly number[];
    regions: readonly number[];
    peaks: readonly number[];
}

const NO_TARGETS: LoreTargets = { places: [], territories: [], regions: [], peaks: [] };

const isEmpty = (targets: LoreTargets): boolean =>
    targets.places.length + targets.territories.length + targets.regions.length + targets.peaks.length === 0;

/** Die Träger eines Gegenstands, nach Nähe getrennt. */
export interface LoreCarriers {
    /** „Direkt von hier“: der Gegenstand selbst, am Ort zusätzlich das tiefste Gebiet an seinem Punkt. */
    here: LoreTargets;
    /** „Aus der Region“: jede weitere Fläche, die ihn enthält. */
    region: LoreTargets;
    /** Die Kontinentbegriffe dieses Kartenraums; leer heißt kein Link „Überall …“. */
    continents: readonly string[];
    /**
     * Die Einträge (`lore_entry.id`), deren Regeln den Gegenstand treffen (WI-0257 S2). Sie stehen unter „Aus der Region“; ein Eintrag,
     * der auch in `here` oder `region` vorkommt, zählt einmal.
     */
    rules: readonly string[];
    /** Die Rahmen, hinter denen eine Ortszeile zurücktritt (F2); leer, wo der Schalter aus ist oder es keine Regeln gibt. */
    ersatz: OrtszeilenErsatz;
    /**
     * Der Gegenstand ist selbst eine Landschaft (mit ihrer Gruppe gleichnamiger) oder ein Gebiet: Die Zeilen, die ihn nennen
     * (`here`), treten hinter keine Regel zurück. F2 fasst genauer, was INNERHALB eines Rahmens liegt, nicht den Rahmen selbst.
     */
    selfFrame?: boolean;
}

const EMPTY_CARRIERS: LoreCarriers = {
    here: NO_TARGETS,
    region: NO_TARGETS,
    continents: [],
    rules: [],
    ersatz: KEIN_ERSATZ,
};

/** Trägt der Gegenstand überhaupt Träger? Ohne sie ist jede Abfrage überflüssig. */
export const hasLoreCarriers = (carriers: LoreCarriers): boolean =>
    !isEmpty(carriers.here) || !isEmpty(carriers.region) || carriers.continents.length > 0 || carriers.rules.length > 0;

/** Alle Gebiete unter diesen im Baum `territory.parent_id`, ohne sie selbst; je Gebiet einmal. */
function descendantsOf(index: SubjectIndex, roots: readonly number[]): number[] {
    if (roots.length === 0) return [];
    const children = new Map<number, number[]>();
    for (const record of index.territories.byId.values()) {
        if (record.parentId === null) continue;
        const list = children.get(record.parentId);
        if (list === undefined) children.set(record.parentId, [record.id]);
        else list.push(record.id);
    }
    const found = new Set<number>();
    const queue = [...roots];
    while (queue.length > 0) {
        const current = queue.pop() as number;
        for (const child of children.get(current) ?? []) {
            if (found.has(child) || roots.includes(child)) continue;
            found.add(child);
            queue.push(child);
        }
    }
    return [...found];
}

/** Die Elternkette dieser Gebiete im Baum, ohne sie selbst: die politischen Gebiete, die sie ENTHALTEN. */
function ancestorsOf(index: SubjectIndex, leaves: readonly number[]): number[] {
    const found = new Set<number>();
    for (const leaf of leaves) {
        let current = index.territories.byId.get(leaf)?.parentId ?? null;
        while (current !== null && !found.has(current)) {
            found.add(current);
            current = index.territories.byId.get(current)?.parentId ?? null;
        }
    }
    for (const leaf of leaves) found.delete(leaf);
    return [...found];
}

/**
 * 🔴 **DIE EINE STELLE, an der das Enthaltensein geprüft wird** - für jede Art dieselbe, nur mit einer anderen Geometrie:
 *
 * - `point`: der Punkt eines Ortes oder Gipfels, oder der Repräsentant einer Fläche ({@link areaProbe}).
 * - `lines`: der GANZE Verlauf einer Linie, aus der Tabelle selbst. 🪤 Nicht ein Punkt auf ihr - ein Weg streift mehrere Träger
 *   (gemessen: eine Linie schneidet im Median 8 Flächen, ein Ort 7), und ein Punkt daraus verlöre alle anderen.
 *
 * 🪤 Die Geometrie der Linie reist NICHT durch Node: Sie wird in der Abfrage selbst gesammelt. Eine Straße mit tausenden
 * Stützpunkten als GeoJSON durch den Treiber zu schicken wäre dieselbe Antwort für mehr Bytes.
 */
export type LoreSpot =
    | { at: "point"; x: number; y: number }
    | { at: "lines"; table: "path"; ids: readonly string[]; extra?: readonly Polyline[] };

/**
 * Eine Linie ohne Zeile in der Tabelle (der Gang querfeldein, ein Stück freies Wasser), flach `[x0, y0, x1, y1, …]` in Kartenkoordinaten. Sie kommt aus der
 * Routenantwort des Fragenden (WI-0257 S2, `RouteStageLoreRequest.lines`) und wird den Wegen als Stelle hinzugefügt.
 */
export type Polyline = readonly number[];

/** Die Zeilen `g` (je Weg und je Linie eine Geometrie) einer Stelle aus Linien, als Quelle für ein `WITH`; `next` ist die erste freie Parameternummer. */
function lineRows(
    ids: readonly string[],
    extra: readonly Polyline[],
    table: "path",
): { sql: string; params: (number | string[] | number[])[]; next: number } {
    const wege = `SELECT l.geom AS g FROM ${LINE_TABLES[table]} l WHERE l.public_id = ANY($1::uuid[]) AND l.is_active`;
    const lines = extra.filter((line) => line.length >= 4);
    if (lines.length === 0) return { sql: wege, params: [[...ids]], next: 2 };
    const index: number[] = [];
    const xs: number[] = [];
    const ys: number[] = [];
    lines.forEach((line, at) => {
        for (let i = 0; i + 1 < line.length; i += 2) {
            index.push(at);
            xs.push(line[i] as number);
            ys.push(line[i + 1] as number);
        }
    });
    return {
        sql: `${wege}
              UNION ALL
              SELECT ST_MakeLine(ST_SetSRID(ST_MakePoint(u.x, u.y), 0) ORDER BY u.i) AS g
                FROM unnest($2::int[], $3::float8[], $4::float8[]) WITH ORDINALITY AS u(l, x, y, i) GROUP BY u.l`,
        params: [[...ids], index, xs, ys],
        next: 5,
    };
}

/**
 * Aus welcher Tabelle die Linien kommen: eine feste Wahl, nie eine Eingabe (der Name wird in den Text gesetzt).
 *
 * 🪤 Hier steht NUR `path`. Die Kraftlinie hätte dieselbe Gestalt, aber der Betreiber hat am 2026-10-07 die Wege genannt und
 * sie nicht - ein zweiter Eintrag, den niemand ruft, wäre eine halbe Rezeptur (WI-0103).
 */
const LINE_TABLES = { path: "path" } as const;

/** Die Geometrie der Stelle als Quelle für ein `WITH`, samt ihren Parametern. `next` ist die erste freie Parameternummer. */
function spotSource(spot: LoreSpot): { sql: string; params: (number | string[] | number[])[]; next: number } {
    if (spot.at === "point") {
        return {
            sql: "SELECT ST_SetSRID(ST_MakePoint($1::double precision, $2::double precision), 0) AS geom",
            params: [spot.x, spot.y],
            next: 3,
        };
    }
    const rows = lineRows(spot.ids, spot.extra ?? [], spot.table);
    return { sql: `SELECT ST_Collect(s.g) AS geom FROM (${rows.sql}) s`, params: rows.params, next: rows.next };
}

/** Alle politischen Gebiete, deren Form diese Stelle berührt - unabhängig von der Tiefe. */
async function territoriesAt(database: Queryable, spot: LoreSpot): Promise<number[]> {
    const source = spotSource(spot);
    const rows = await database.unsafe<{ territory_id: string }[]>(
        `WITH spot AS (${source.sql})
         SELECT DISTINCT sh.territory_id::text AS territory_id
         FROM territory_shape sh, spot
         WHERE spot.geom IS NOT NULL AND ST_Intersects(sh.geom, spot.geom)`,
        source.params,
    );
    return rows.map((row) => Number(row.territory_id));
}

/** Alle Landschaften, deren Fläche diese Stelle berührt; alle drei Ebenen zählen, eine Fläche ist eine Fläche. */
async function regionsAt(database: Queryable, spot: LoreSpot): Promise<number[]> {
    const source = spotSource(spot);
    const rows = await database.unsafe<{ region_id: string }[]>(
        `WITH spot AS (${source.sql})
         SELECT DISTINCT a.region_id::text AS region_id
         FROM region_area a
         JOIN region r ON r.id = a.region_id AND r.is_active AND NOT r.is_hidden, spot
         WHERE a.is_active AND spot.geom IS NOT NULL AND ST_Intersects(a.geom, spot.geom)`,
        source.params,
    );
    return rows.map((row) => Number(row.region_id));
}

/**
 * Das TIEFSTE Gebiet am Punkt eines Ortes, wie Legacys Lesepfad es nimmt. Mehrere Gebiete gleicher Tiefe (überlappende oder
 * umstrittene Formen) zählen ALLE - es wird keines gewählt, wie schon bei einem mehrdeutigen Ziel im Import.
 *
 * 🪤 Tiefe ist die Länge der wirksamen Kette (`territoryChains`), NICHT `territory_shape.band`: das Band ist ein ZOOMband. Ein
 * Filter darauf fand als „tiefstes Gebiet“ immer ein Wurzelgebiet, und jeder Ort bekam dessen Teilbaum von 547 Gebieten
 * (Discovery §10, Falle im ersten Lauf).
 */
export function deepestOf(index: SubjectIndex, candidates: readonly number[]): number[] {
    const chains = territoryChains(index.territories, [...candidates]);
    const deepest = chains[0]?.length;
    if (deepest === undefined) return [];
    return chains
        .filter((chain) => chain.length === deepest)
        .flatMap((chain) => {
            const leaf = chain[chain.length - 1];
            return leaf === undefined ? [] : [leaf.id];
        });
}

/**
 * Ungültige Legacy-Flächen werden BEIM LESEN repariert, und nur, was ungültig ist - dieselbe Rezeptur wie im Kontext der
 * Fläche (`subjects/context.ts`), in der Suche (`search/search.ts`) und bei den Landschaften einer Route
 * (`landscapes/route-landscapes.ts`). Eine gültige Form geht unverändert durch; `method=structure` ist die Wahl, die dort
 * schon steht.
 *
 * 💣 **Ohne sie fiel die Probe über GANZE Landschaften aus** (WI-0107, Befund F1 aus WI-0104): `ST_UnaryUnion` wirft an einer
 * selbstschneidenden Fläche eine `TopologyException`, und die reiste ungebremst bis zur Route - fünf bekannte Landschaften
 * (Düsterholz, Tal des Nader, Silker Hain, Vorgebirge der Drachensteine, Farindelwald) antworteten mit **500**.
 * 🪤 Es ist nicht die EINZELNE Form: Silker Hains vier Flächen brechen einzeln nicht, erst ihre Vereinigung.
 */
const REPAIRED_AREA = `CASE WHEN (ST_IsValidDetail(a.geom)).valid THEN a.geom
                            ELSE ST_CollectionExtract(ST_MakeValid(a.geom, 'method=structure'), 3) END`;

/** Woher die Flächen kommen - eine feste Wahl wie bei {@link LINE_TABLES}, nie eine Eingabe (der Name geht in den Text). */
const PROBE_TABLES = { region: "region_area", territory: "territory_shape" } as const;

/**
 * Ein Punkt IN der Fläche dieses Gegenstands, an dem das Enthaltensein geprüft wird (`ST_PointOnSurface`), und ihre Größe.
 *
 * 🪤 **Das ist eine Näherung, und sie ist bewusst gewählt** (IMPLEMENTATION DETAIL): Exaktes `ST_CoveredBy` zwischen zwei
 * Vielecken kostet an jedem Panelaufruf ein Vielfaches, und eine Landschaft liegt in der Praxis entweder ganz oder gar nicht in
 * einer anderen. Die Größe begrenzt die Richtung: Eine Fläche erbt nur von GRÖSSEREN Flächen. Ohne diese Schranke erbte die
 * Landschaft „Aventurien“ von dem Vegetationsfleck, der zufällig ihren Repräsentanten überdeckt.
 *
 * 🪤 **Die Reparatur verschiebt nichts** (WI-0107, gemessen am 2026-10-08 über ALLE 5.137 Landschaftsgruppen und ALLE 1.676
 * Gebiete): 5.089 Gruppen rechnen Bit für Bit dasselbe, 43 bekommen eine minimal andere Zahl - und **keine einzige** einen
 * anderen Träger. Die Gebiete sind unverändert, dort war ohnehin keine Form unvereinbar.
 *
 * 💣 **`NOT ST_IsEmpty` ist kein Feinschliff:** Repariert sich eine Form zu nichts, ist `g` leer statt NULL, `ST_X` gibt NULL,
 * und `Number(null)` wäre **0** - die Fläche prüfte das Enthaltensein am Nullpunkt der Karte und erbte, was dort liegt. Ohne
 * brauchbaren Punkt gibt es keinen, genau wie bei einer Fläche ohne Geometrie.
 */
async function areaProbe(
    database: Queryable,
    table: "region" | "territory",
    ids: readonly number[],
): Promise<{ x: number; y: number; area: number } | undefined> {
    if (ids.length === 0) return undefined;
    const rows = await database.unsafe<{ x: number; y: number; area: number }[]>(
        `SELECT ST_X(ST_PointOnSurface(g)) AS x, ST_Y(ST_PointOnSurface(g)) AS y, ST_Area(g) AS area
         FROM (SELECT ST_UnaryUnion(ST_Collect(${REPAIRED_AREA})) AS g
               FROM ${PROBE_TABLES[table]} a
               WHERE a.${table}_id = ANY($1::bigint[])${table === "region" ? " AND a.is_active" : ""}) u
         WHERE g IS NOT NULL AND NOT ST_IsEmpty(g)`,
        [[...ids]],
    );
    const row = rows[0];
    return row === undefined ? undefined : { x: Number(row.x), y: Number(row.y), area: Number(row.area) };
}

/** Die Landschaften, die diese Stelle berühren und GRÖSSER sind als die Fläche, von der sie stammt. */
async function largerRegionsAt(
    database: Queryable,
    spot: LoreSpot,
    minArea: number,
    exclude: readonly number[],
): Promise<number[]> {
    const source = spotSource(spot);
    const rows = await database.unsafe<{ region_id: string }[]>(
        `WITH spot AS (${source.sql})
         SELECT a.region_id::text AS region_id
         FROM region_area a
         JOIN region r ON r.id = a.region_id AND r.is_active AND NOT r.is_hidden, spot
         WHERE a.is_active AND spot.geom IS NOT NULL
           AND NOT (a.region_id = ANY($${String(source.next + 1)}::bigint[]))
           AND ST_Intersects(a.geom, spot.geom)
         GROUP BY a.region_id
         HAVING sum(ST_Area(a.geom)) > $${String(source.next)}::double precision`,
        [...source.params, minArea, [...exclude]],
    );
    return rows.map((row) => Number(row.region_id));
}

const without = (ids: readonly number[], remove: readonly number[]): number[] => {
    const drop = new Set(remove);
    return ids.filter((id) => !drop.has(id));
};

/** Die Karte, für die Regeln gelten (`vorkommen/punkte.ts`, `DOMAENE`). */
export const RULE_DOMAIN = "aventuria";

/**
 * Der Abstand der Punkte entlang einer Linie, an denen die Regeln gefragt werden (WI-0257 S2), in Kartenkoordinaten.
 *
 * 🔴 **Abgeleitet, nicht geraten:** Gemessen über den Bestand ist die kleinste Seite eines Waldes (2.931 Flächen) im Median 2,2 und
 * an der 5. Perzentile 1,0, die Wurzel der Fläche an der 10. Perzentile 1,1; Seen (563) liegen bei 1,7 und 0,35. Bei 0,5 trifft ein
 * Punkt jede Sehne ab 0,5 Länge, also jeden Wald, den die Linie überhaupt durchquert (bis auf die kleinsten Splitter).
 */
export const PFAD_SCHRITT = 0.5;

/**
 * So viele Punkte höchstens je Anfrage: ein sehr langer Weg (gemessen höchstens 179 Einheiten je Abschnitt, eine ganze Reichsstraße
 * mehrere hundert) vergröbert den Abstand, statt die Abfrage zu dehnen. Der Abstand liegt erst jenseits von 300 Einheiten
 * Gesamtlänge über `PFAD_SCHRITT`.
 */
export const PFAD_PUNKTE = 600;

/**
 * Punkte ENTLANG der Wege: Anfang und Ende jeder zusammengefügten Linie und alle `PFAD_SCHRITT` dazwischen
 * (`ST_LineInterpolatePoints`), auf zwei Stellen gerundet und ohne Dopplungen. Die Geometrie reist nicht durch Node; nur die Punkte
 * kommen zurück.
 */
async function pathPoints(
    database: Queryable,
    ids: readonly string[],
    extra: readonly Polyline[],
): Promise<{ x: number; y: number }[]> {
    if (ids.length === 0 && extra.length === 0) return [];
    const rows = lineRows(ids, extra, "path");
    const answer = await database.unsafe<{ x: number; y: number }[]>(
        `WITH raw AS (${rows.sql}),
         c AS (SELECT (ST_Dump(ST_LineMerge(ST_Collect(raw.g)))).geom AS g FROM raw),
         t AS (SELECT greatest($${String(rows.next)}::float8, coalesce(sum(ST_Length(g)), 0) / $${String(rows.next + 1)}::float8) AS step FROM c)
         SELECT DISTINCT round(ST_X(pt.geom)::numeric, 2)::float8 AS x, round(ST_Y(pt.geom)::numeric, 2)::float8 AS y
           FROM c CROSS JOIN t
           CROSS JOIN LATERAL (
               SELECT ST_StartPoint(c.g) AS geom
               UNION ALL SELECT ST_EndPoint(c.g)
               UNION ALL
               SELECT (ST_Dump(ST_LineInterpolatePoints(c.g, LEAST(1.0, t.step / ST_Length(c.g)), true))).geom
                WHERE ST_Length(c.g) > 0
           ) pt`,
        [...rows.params, PFAD_SCHRITT, PFAD_PUNKTE],
    );
    // Sortiert wie die Punkte der Etappen in „Unterwegs“ (`unterwegs.ts`, dort ist der erste Treffer die Gegend); `DISTINCT` verspricht keine Reihenfolge.
    return answer.map((row) => ({ x: Number(row.x), y: Number(row.y) })).sort((a, b) => a.x - b.x || a.y - b.y);
}

/**
 * Die Träger eines Gegenstands. `point` ist der Punkt eines Ortes (für das tiefste Gebiet) beziehungsweise die Stelle eines
 * Kartenpunkts; ohne ihn bekommt ein Ort nur sich selbst. Weg und Kraftlinie bekommen keine eigenen Träger.
 *
 * 🔴 **`mapPoint` ist der dritte Träger nach Weg (WI-0103) und Etappe (WI-0106) - und der günstigste**: Die Stelle ist genau
 * der Punkt, den der Fragende angeklickt hat. Keine Linie zu sammeln, keine Fläche zu vereinigen, kein Repräsentant zu
 * suchen. Er hat damit, wie ein Weg, **nur „Aus der Region“ und den Link, nie „Direkt von hier“**: `lore_place_target` kennt
 * Ort, Gebiet, Region und Gipfel, keine Koordinate - Schema, nicht Wahl.
 */
export async function loreCarriersOf(
    database: Queryable,
    index: SubjectIndex,
    kind: SubjectDetailKind | "mapPoint",
    publicIds: readonly string[],
    point?: { x: number; y: number },
    lines: readonly Polyline[] = [],
): Promise<LoreCarriers> {
    const carriers = await carriersWithoutFlag(database, index, kind, publicIds, point, lines);
    return kind === "area" || kind === "territory" ? { ...carriers, selfFrame: true } : carriers;
}

async function carriersWithoutFlag(
    database: Queryable,
    index: SubjectIndex,
    kind: SubjectDetailKind | "mapPoint",
    publicIds: readonly string[],
    point: { x: number; y: number } | undefined,
    lines: readonly Polyline[],
): Promise<LoreCarriers> {
    const continents = CONTINENT_KEYS_OF_DOMAIN[index.mapDomainId] ?? [];
    const rise = LORE_READING.regionReading === "contains-and-below";
    // Die Regeln gelten für die Karte Aventurien; ein anderer Kartenraum hat keine (und keinen Katalog zu laden).
    const withRules = index.mapDomainId === RULE_DOMAIN && kind !== "powerline";
    const ersatz = withRules && LORE_READING.ortszeileHinterRegel ? await ortszeilenErsatz(database) : KEIN_ERSATZ;
    /** Die Einträge, deren Regeln diese Punkte treffen (alle Punkte in EINER Auswertung). */
    const rulesAt = async (points: readonly { x: number; y: number }[]): Promise<string[]> => {
        if (!withRules || points.length === 0) return [];
        return vereinigeEintraege(await eintraegeAnPunkten(database, points)).map((entry) => entry.id);
    };
    const idsOf = async (table: "place" | "terrain_peak" | "region"): Promise<number[]> => {
        const rows = await database.unsafe<{ id: string }[]>(
            `SELECT id::text AS id FROM ${table} WHERE public_id = ANY($1::uuid[]) AND is_active ORDER BY id`,
            [[...publicIds]],
        );
        return rows.map((row) => Number(row.id));
    };
    switch (kind) {
        case "place": {
            const places = await idsOf("place");
            if (point === undefined)
                return { here: { ...NO_TARGETS, places }, region: NO_TARGETS, continents, rules: [], ersatz };
            const spot: LoreSpot = { at: "point", ...point };
            const [covering, regions, rules] = await Promise.all([
                territoriesAt(database, spot),
                regionsAt(database, spot),
                rulesAt([point]),
            ]);
            const deepest = deepestOf(index, covering);
            return {
                here: { ...NO_TARGETS, places, territories: deepest },
                region: {
                    ...NO_TARGETS,
                    regions,
                    territories: [...without(covering, deepest), ...(rise ? descendantsOf(index, deepest) : [])],
                },
                continents,
                rules,
                ersatz,
            };
        }
        case "territory": {
            const territories = publicIds.flatMap((id) => {
                const record = index.territories.byPublicId.get(id);
                return record === undefined ? [] : [record.id];
            });
            const probe = await areaProbe(database, "territory", territories);
            // Wie bei den Ortszeilen: ALLE Landschaften am Punkt des Gebiets, ohne die Schranke „größer“ (die gilt für Landschaften).
            const [regions, rules] =
                probe === undefined
                    ? [[], []]
                    : await Promise.all([regionsAt(database, { at: "point", ...probe }), rulesAt([probe])]);
            return {
                here: { ...NO_TARGETS, territories },
                region: {
                    ...NO_TARGETS,
                    regions,
                    territories: [
                        ...ancestorsOf(index, territories),
                        ...(rise ? descendantsOf(index, territories) : []),
                    ],
                },
                continents,
                rules,
                ersatz,
            };
        }
        case "area": {
            // Eine Landschaft ist die Gruppe gleichnamiger Regionen (WI-0047): alle Mitglieder tragen, nicht nur der Anker.
            const members = [...new Set(publicIds.flatMap((id) => areaGroupMembers(index.regions, id)))];
            const rows = await database<{ id: string }[]>`
                SELECT id::text AS id FROM region WHERE public_id = ANY(${members}::uuid[]) AND is_active ORDER BY id
            `;
            const regions = rows.map((row) => Number(row.id));
            const probe = await areaProbe(database, "region", regions);
            if (probe === undefined)
                return { here: { ...NO_TARGETS, regions }, region: NO_TARGETS, continents, rules: [], ersatz };
            const spot: LoreSpot = { at: "point", x: probe.x, y: probe.y };
            const [larger, territories, rules] = await Promise.all([
                largerRegionsAt(database, spot, probe.area, regions),
                territoriesAt(database, spot),
                // 🔴 Wie bei den Ortszeilen erbt die Fläche nur von GRÖSSEREN Landschaften (die eigenen zählen dazu): ohne die
                // Schranke trüge „Aventurien“, was in dem Wald lebt, der zufällig ihren Repräsentanten überdeckt.
                withRules
                    ? eintraegeAmFlaechenpunkt(
                          database,
                          { x: probe.x, y: probe.y, flaeche: probe.area },
                          regions.map(String),
                      ).then((hit) => hit.eintraege.map((entry) => entry.id))
                    : Promise.resolve<string[]>([]),
            ]);
            return {
                here: { ...NO_TARGETS, regions },
                region: { ...NO_TARGETS, regions: larger, territories },
                continents,
                rules,
                ersatz,
            };
        }
        case "peak": {
            const peaks = await idsOf("terrain_peak");
            const rows = await database<{ x: number; y: number }[]>`
                SELECT ST_X(geom) AS x, ST_Y(geom) AS y FROM terrain_peak WHERE id = ANY(${peaks}::bigint[])
            `;
            const at = rows[0];
            if (at === undefined)
                return { here: { ...NO_TARGETS, peaks }, region: NO_TARGETS, continents, rules: [], ersatz };
            const spot: LoreSpot = { at: "point", x: Number(at.x), y: Number(at.y) };
            const [regions, territories, rules] = await Promise.all([
                regionsAt(database, spot),
                territoriesAt(database, spot),
                rulesAt([{ x: Number(at.x), y: Number(at.y) }]),
            ]);
            return {
                here: { ...NO_TARGETS, peaks },
                region: { ...NO_TARGETS, regions, territories },
                continents,
                rules,
                ersatz,
            };
        }
        case "path": {
            // 🔴 Ein Weg hat NUR „Aus der Region“ und den Link: eigene Einträge kann er strukturell nicht tragen
            // (`lore_place_target` hat keine `path_id`). Geerbt wird über DIESELBE Regel wie bei einer Fläche, nur mit der
            // Linie als Stelle - alles, was sie enthält, und zwar auf ihrer GANZEN Länge, nicht an einem Punkt. Die Regeln
            // fragen Punkte ENTLANG der Linie (`PFAD_SCHRITT`).
            // 🔴 Dazu die Linien der Abschnitte OHNE Weg (querfeldein, freies Wasser), die nur die Etappe kennt (`lines`).
            const spot: LoreSpot = { at: "lines", table: "path", ids: publicIds, extra: lines };
            const [regions, territories, rules] = await Promise.all([
                regionsAt(database, spot),
                territoriesAt(database, spot),
                withRules ? pathPoints(database, publicIds, lines).then(rulesAt) : Promise.resolve<string[]>([]),
            ]);
            return { here: NO_TARGETS, region: { ...NO_TARGETS, regions, territories }, continents, rules, ersatz };
        }
        case "mapPoint": {
            // 🔴 Dieselbe Regel wie am Weg, nur mit dem angeklickten PUNKT als Stelle: alles, was ihn enthält, steht unter
            // „Aus der Region“. Eigene Einträge kann eine Koordinate strukturell nicht tragen.
            // 🪤 ALLE Gebiete am Punkt, nicht nur das tiefste. Das tiefste Gebiet steht am ORT unter „Direkt von hier“,
            // weil der Betreiber am 2026-10-06 sagte „‚Direkt hier‘ listet weiterhin wie bisher“ - ein Kartenpunkt hat
            // dieses „bisher“ nicht und damit keinen Grund, eine seiner Flächen vor den anderen auszuzeichnen.
            if (point === undefined) return EMPTY_CARRIERS;
            const spot: LoreSpot = { at: "point", ...point };
            const [regions, territories, rules] = await Promise.all([
                regionsAt(database, spot),
                territoriesAt(database, spot),
                rulesAt([point]),
            ]);
            return { here: NO_TARGETS, region: { ...NO_TARGETS, regions, territories }, continents, rules, ersatz };
        }
        // 🪤 Die Kraftlinie bleibt leer: der Betreiber hat am 2026-10-07 die WEGE genannt, nicht sie, und
        // `LEGACY_ROWS.powerline` hat keinen Platz für die vier Zeilen. Die Rezeptur dafür wäre eine Zeile (`table:
        // "powerline"`) - sie steht hier bewusst nicht.
        case "powerline":
            return EMPTY_CARRIERS;
    }
}

export interface EntryRow {
    id: string;
    /** `lore_entry.public_id`: die Kennung, die Oberfläche und Suche nennen (WI-0257 S4). */
    public_id: string;
    kind: string;
    name: string;
    /** `null`: ein Eintrag der Redaktion ohne Wiki-Artikel (Migration 0235). */
    wiki_key: string | null;
    origin: boolean;
}

/**
 * Die Einträge an diesen Trägern. Ein Eintrag erscheint EINMAL und trägt `origin`, wenn irgendeine seiner Zeilen an diesem
 * Träger die Relation `herkunft` hat.
 *
 * 💣 **`skipContinent` ist nicht Feinschliff, sondern der Unterschied zwischen 47 und 1.221 Einträgen.** Gemessen am 2026-10-06:
 * Die Kontinentzeilen lösen alle auf GENAU EIN Kartenobjekt auf - die Landschaft „Aventurien“ (`region.id` 103, `region_type`
 * `kontinent`) -, und die trägt die 1.174 als ihr eigenes Ziel. „Kontinentweit“ und „in der Fläche Aventurien enthalten“ sind in
 * den Daten also DASSELBE. Jedes Objekt der Karte liegt in dieser Fläche: Ohne diesen Ausschluss stünden die 1.174 noch einmal
 * unter „Aus der Region“, obwohl sie als Link schon dastehen. 🔴 „Direkt von hier“ schließt sie NICHT aus - an der Landschaft
 * „Aventurien“ selbst sind sie genau das, und dorthin führt der Link.
 *
 * 🔴 **`ersatz` (WI-0257 S2, F2):** Eine Ortszeile, deren Ziel die Rahmenfläche einer Regel DESSELBEN Eintrags und DERSELBEN Beziehung
 * ist, zählt nicht (`OrtszeilenErsatz`); der Eintrag steht dort nur, wo die Regel trifft. Alle anderen Ortszeilen gelten weiter.
 */
async function entriesAt(
    database: Queryable,
    targets: LoreTargets,
    skipContinent: boolean,
    ersatz: OrtszeilenErsatz,
): Promise<EntryRow[]> {
    if (isEmpty(targets)) return [];
    // Eine Zeile je Ortszeile (mehrere Ziele derselben Zeile ergeben eine), mit den Landschaften, auf die sie zeigt: Ob sie hinter eine
    // Regel zurücktritt, entscheidet `ortszeileErsetzt` in Node.
    const rows = await database<(EntryRow & { relation: string; regions: string[] })[]>`
        SELECT e.id::text AS id, e.public_id::text AS public_id, e.kind, e.name, e.wiki_key, p.relation,
               p.relation = 'herkunft' AS origin,
               coalesce((SELECT array_agg(zt.region_id::text) FROM lore_place_target zt
                          WHERE zt.lore_place_id = p.id AND zt.region_id IS NOT NULL), '{}') AS regions
        FROM lore_place p
        JOIN lore_entry e ON e.id = p.lore_entry_id AND e.is_active AND e.state = 'active'
        WHERE p.is_active AND p.state = 'active'
          AND (NOT ${skipContinent} OR p.key_class <> 'continent')
          AND EXISTS (
            SELECT 1 FROM lore_place_target t
             WHERE t.lore_place_id = p.id
               AND (t.place_id = ANY(${[...targets.places]}::bigint[])
                 OR t.region_id = ANY(${[...targets.regions]}::bigint[])
                 OR t.terrain_peak_id = ANY(${[...targets.peaks]}::bigint[])
                 OR t.territory_id = ANY(${[...targets.territories]}::bigint[])))
    `;
    // Ein Eintrag erscheint EINMAL und trägt `origin`, wenn irgendeine seiner (geltenden) Zeilen an diesem Träger die Relation `herkunft` hat.
    const byEntry = new Map<string, EntryRow>();
    for (const row of rows) {
        if (ortszeileErsetzt(ersatz, row.id, row.relation, row.regions)) continue;
        const known = byEntry.get(row.id);
        if (known === undefined) {
            byEntry.set(row.id, {
                id: row.id,
                public_id: row.public_id,
                kind: row.kind,
                name: row.name,
                wiki_key: row.wiki_key,
                origin: row.origin,
            });
        } else if (row.origin) {
            known.origin = true;
        }
    }
    return [...byEntry.values()];
}

/**
 * Wie viele Einträge je Art „überall“ gelten (Rang 3) - nur die ZAHL, nie die Namen. Welche das sind, entscheidet
 * `LORE_READING.continentReading`: `additive` nimmt jeden Eintrag mit einer Kontinentzeile (Legacys Mechanik), `replacing` nur
 * den, der AUSSCHLIESSLICH Kontinentbegriffe nennt (sein Satz „es sei denn weitere orte werden genannt“).
 *
 * 🔴 **F2 (`ersatz`):** Eine Kontinentzeile, hinter die eine Regel mit dem Rahmen „Aventurien“ derselben Beziehung getreten ist
 * („Wald in Aventurien“), gilt nicht mehr; der Eintrag fällt aus dem Link und aus dessen Zahl heraus. Hat er eine zweite
 * Kontinentzeile (andere Beziehung), zählt er weiter.
 */
async function continentCounts(
    database: Queryable,
    continents: readonly string[],
    ersatz: OrtszeilenErsatz,
): Promise<Map<LoreKind, number>> {
    const found = new Map<LoreKind, number>();
    if (continents.length === 0) return found;
    const onlyContinent = LORE_READING.continentReading === "replacing";
    // Eine Zeile je Kontinentzeile; die Zahl je Art entsteht in Node, weil die Zeilen hinter einer Regel zurücktreten können.
    const rows = await database<{ id: string; kind: string; relation: string; regions: string[] }[]>`
        SELECT e.id::text AS id, e.kind, p.relation,
               coalesce((SELECT array_agg(zt.region_id::text) FROM lore_place_target zt
                          WHERE zt.lore_place_id = p.id AND zt.region_id IS NOT NULL), '{}') AS regions
        FROM lore_place p
        JOIN lore_entry e ON e.id = p.lore_entry_id AND e.is_active AND e.state = 'active'
        WHERE p.is_active AND p.state = 'active' AND p.key_class = 'continent' AND (p.role IS NULL OR p.role = 'ort')
          -- 🪤 Wie beim Import (bareLoreKey): das Praefix wiki: faellt weg, klein geschrieben wird verglichen.
          AND lower(regexp_replace(p.place_wiki_key, '^wiki:', '')) = ANY(${[...continents]}::text[])
          AND (
            NOT ${onlyContinent}
            OR NOT EXISTS (
                SELECT 1 FROM lore_place o
                WHERE o.lore_entry_id = e.id AND o.is_active AND o.state = 'active' AND o.key_class = 'other' AND (o.role IS NULL OR o.role = 'ort')
            )
          )
    `;
    const perKind = new Map<string, Set<string>>();
    for (const row of rows) {
        if (ortszeileErsetzt(ersatz, row.id, row.relation, row.regions)) continue;
        const entries = perKind.get(row.kind);
        if (entries === undefined) perKind.set(row.kind, new Set([row.id]));
        else entries.add(row.id);
    }
    for (const [kind, entries] of perKind) if (isLoreKind(kind)) found.set(kind, entries.size);
    return found;
}

/**
 * Das Ziel des Links „Überall in Aventurien“: die Landschaft, die den Kontinentschlüssel trägt - über dieselbe Schleuse wie jeder
 * andere Objektlink. 🔴 Keines oder mehrere heißt KEIN Link; und am Ziel selbst gibt es keinen, denn dort sind diese Einträge
 * schon „Direkt von hier“ und ein Link auf sich selbst führt nirgendwohin.
 */
function continentTarget(index: SubjectIndex, continents: readonly string[], self: SubjectRef): SubjectRef | undefined {
    const [key] = continents;
    if (key === undefined) return undefined;
    const match = lookupWikiKey(index.wikiKeys, wikiKeyOfLoreKey(key));
    if (match.kind !== "one") return undefined;
    return subjectKey(match.ref) === subjectKey(self) ? undefined : match.ref;
}

/** Ein Eintrag mit der Gruppe, in der er steht. */
export interface Placed {
    /** `lore_entry.id` und `lore_entry.public_id`. */
    id: string;
    publicId: string;
    group: LoreGroup;
    kind: LoreKind;
    name: string;
    wikiKey: string | null;
}

export const isLoreKind = (value: string): value is LoreKind =>
    value === "fauna" || value === "flora" || value === "spezies" || value === "ware";

/**
 * Jeden Eintrag in GENAU EINE Gruppe. Reihenfolge der Entscheidung: `herkunft` an einem eigenen Träger gewinnt („Von hier“, ein
 * Eintrag mit Herkunft steht nur dort), dann „Direkt von hier“ vor „Aus der Region“. Ein Eintrag, der dem Gegenstand gehört UND an
 * einer umgebenden Fläche hängt, steht bei ihm - nie zweimal.
 */
export function place(here: readonly EntryRow[], region: readonly EntryRow[]): Placed[] {
    const byId = new Map<string, Placed>();
    for (const row of here) {
        if (!isLoreKind(row.kind)) continue;
        byId.set(row.id, {
            id: row.id,
            publicId: row.public_id,
            group: row.origin ? "origin" : "here",
            kind: row.kind,
            name: row.name,
            wikiKey: row.wiki_key,
        });
    }
    for (const row of region) {
        if (!isLoreKind(row.kind) || byId.has(row.id)) continue;
        byId.set(row.id, {
            id: row.id,
            publicId: row.public_id,
            group: "region",
            kind: row.kind,
            name: row.name,
            wikiKey: row.wiki_key,
        });
    }
    return [...byId.values()];
}

/**
 * Die Anzeige eines Namens: Objektlink, wo der Wiki-Schlüssel des Eintrags GENAU EIN Kartenobjekt trägt, sonst die Infobox des Vorkommens
 * selbst (`loreEntry`, `info-eintrag.vue`).
 *
 * 🔴 Derselbe Weg wie jeder andere Link: `wikiKeyOfLoreKey` setzt das Präfix `wiki:`, `lookupWikiKey` fragt durch
 * `canonicalWikiKey`. Mehrdeutig heißt KEIN Kartenobjekt (`kind: "many"`). Nie über den Namen - ein Name ist Anzeige, nie Schlüssel
 * (Betreiber 2026-10-05).
 *
 * 🪤 **Der Wiki-Artikel ist kein Ziel des Namens mehr** (Betreiber 2026-10-30: „die infobox der vorkommens wird nicht aufgerufen“): Von
 * 5.138 Einträgen trägt einer ein Kartenobjekt, also öffnete der Name fast immer einen neuen Tab statt der Infobox, die ein Eintrag aus
 * der Suche hat. Der Wiki-Artikel steht dort im Quellenkasten (`search/eintrag.ts`). Auch ein Eintrag ohne Wiki-Artikel (Migration
 * 0235) hat diese Infobox und damit ein Ziel; `ref.id` ist die öffentliche Kennung `lore_entry.public_id`.
 */
function viewOf(index: SubjectIndex, entry: Placed): LoreEntryView {
    const eintrag: SubjectRef = { kind: "loreEntry", id: entry.publicId };
    if (entry.wikiKey === null) return { name: entry.name, ref: eintrag };
    const match = lookupWikiKey(index.wikiKeys, wikiKeyOfLoreKey(entry.wikiKey));
    return { name: entry.name, ref: match.kind === "one" ? match.ref : eintrag };
}

/**
 * Die Einträge, deren Regeln den Gegenstand treffen (`lore_entry.id` aus `carriers.rules`), als Zeilen wie die der Ortszeilen. Sie tragen
 * nie `origin`: Sie stehen unter „Aus der Region“ (`place` lässt einen Eintrag, der dem Gegenstand auch selbst gehört, bei ihm stehen).
 */
async function ruleEntries(database: Queryable, ids: readonly string[]): Promise<EntryRow[]> {
    if (ids.length === 0) return [];
    return database<EntryRow[]>`
        SELECT e.id::text AS id, e.public_id::text AS public_id, e.kind, e.name, e.wiki_key, FALSE AS origin
        FROM lore_entry e
        WHERE e.id = ANY(${[...ids]}::bigint[]) AND e.is_active AND e.state = 'active'
    `;
}

/** Alle Listen eines Gegenstands, in EINEM Lauf - die Abfragen laufen nebeneinander. */
async function placedEntries(database: Queryable, carriers: LoreCarriers): Promise<Placed[]> {
    const [here, region, viaRules] = await Promise.all([
        // 🔴 Am Rahmen selbst (Landschaft, Gebiet) gelten die Zeilen, die ihn nennen, wie bisher - der Entscheid der Leitung zu F2.
        entriesAt(database, carriers.here, false, carriers.selfFrame === true ? KEIN_ERSATZ : carriers.ersatz),
        entriesAt(database, carriers.region, true, carriers.ersatz),
        ruleEntries(database, carriers.rules),
    ]);
    return place(here, [...region, ...viaRules]);
}

/**
 * 🔴 **DIE EINE REGEL, was eine Zeile ZÄHLT**: die Einträge der Listen plus, **wo der Link wirklich steht**, die Zahl hinter ihm
 * (`LORE_READING.countScope`, seit WI-0104 `own` - der Satz zählt nur, was als Liste dasteht).
 *
 * 🔴 **Ob die Zeile ENTSTEHT, sagt `loreRowStands` - nicht diese Zahl** (WI-0104). Bis WI-0103 war es dieselbe Frage; unter
 * `own` ist sie es nicht mehr, weil ein Gegenstand ohne Eigenes die Zahl 0 und trotzdem den Link trägt.
 *
 * 💣 **`linked` ist nicht Feinschliff.** Am Linkziel selbst - der Landschaft „Aventurien“ - gibt es keinen Link, und dort sind
 * genau diese Einträge schon „Direkt von hier“, stehen also in `own`. Ohne diese Bedingung stünden ihre 1.174 an genau diesem
 * einen Gegenstand DOPPELT in der Zahl.
 */
const rowCount = (own: number, everywhere: number, linked: boolean): number =>
    own + (linked && loreCountsContinent() ? everywhere : 0);

/**
 * Die vier Zähler für die Detailantwort - dieselbe Rechnung wie {@link listLore}, damit Satz und Liste nie auseinanderlaufen.
 *
 * 🔴 **Eine Art steht hier, wenn ihre Zeile steht** (`loreRowStands`), nicht wenn ihre Zahl größer als 0 ist. Unter
 * `countScope: "own"` trägt eine Zeile, deren ganzer Inhalt der Link ist, die Zahl **0** - und sie steht trotzdem (WI-0104).
 * Eine Art, die es auch kontinentweit nicht gibt, fehlt weiter ganz; ohne jede Art gibt es kein Objekt und damit keine Zeile -
 * nie ein „(0)“ ohne Inhalt (WI-0063 5.3).
 */
export async function loreCounts(
    database: Queryable,
    index: SubjectIndex,
    carriers: LoreCarriers,
    self: SubjectRef,
): Promise<LoreCounts | undefined> {
    if (!hasLoreCarriers(carriers)) return undefined;
    const linked = continentTarget(index, carriers.continents, self) !== undefined;
    // 💣 Die Kontinentzahlen werden geholt, sobald der Link STEHT - nicht erst, wenn er auch ZÄHLT. Unter
    // `countScope: "own"` zählt er nicht, trägt die Zeile aber allein (WI-0104); ohne diese Zahl verschwände sie wieder.
    const [entries, continent] = await Promise.all([
        placedEntries(database, carriers),
        linked
            ? continentCounts(database, carriers.continents, carriers.ersatz)
            : Promise.resolve(new Map<LoreKind, number>()),
    ]);
    const counts: Record<string, number> = {};
    for (const entry of entries) counts[entry.kind] = (counts[entry.kind] ?? 0) + 1;
    const result: LoreCounts = {};
    for (const kind of LORE_ROWS) {
        const own = counts[kind] ?? 0;
        const everywhere = continent.get(kind) ?? 0;
        if (loreRowStands(own, everywhere, linked)) result[kind] = rowCount(own, everywhere, linked);
    }
    return Object.keys(result).length === 0 ? undefined : result;
}

/**
 * Die vier Zeilen samt aufgeklapptem Inhalt. Eine Zeile entsteht nur, wo der Zählsatz eine Zahl hat (dieselbe Regel wie
 * `loreCounts`).
 *
 * 🔴 **Der Fall „nur Kontinentweites“ ist am 2026-10-07 umgedreht worden** (Betreiber: „und ‚Überall in Aventurien‘ muss
 * natürlich auch überall stehen, wenns in Aventurien ist :)“, WI-0103). Ein Gegenstand ohne eigene und ohne regionale Einträge
 * bekommt die Zeile - mit dem Link als ihrem ganzen Inhalt. „Leer ist unsichtbar“ (WI-0063 5.3) widerspricht dem nicht:
 * Die Zeile ist nicht leer, sie trägt den Link.
 *
 * 🔴 **Seit WI-0104 hängt das an `loreRowStands`, nicht an der Zahl.** WI-0103 ließ beides an {@link rowCount} hängen, weil
 * `countScope: "all"` den Link mitzählte; mit `own` ist die Zahl dort 0, und eine Bedingung `count > 0` nähme die Entscheidung
 * still zurück. Die zwei Fragen sind getrennt, nicht mit einer Ausnahme gegengesteuert.
 *
 * Reihung: Gruppe, dann Name ohne Beachtung der Groß- und Kleinschreibung (`lore.yaml` -> `ortsbezug.lesebezug.punkte`).
 */
export async function listLore(
    database: Queryable,
    index: SubjectIndex,
    carriers: LoreCarriers,
    self: SubjectRef,
): Promise<LoreRowView[]> {
    if (!hasLoreCarriers(carriers)) return [];
    const [entries, continent] = await Promise.all([
        placedEntries(database, carriers),
        continentCounts(database, carriers.continents, carriers.ersatz),
    ]);
    const target = continentTarget(index, carriers.continents, self);

    const rows: LoreRowView[] = [];
    for (const kind of LORE_ROWS) {
        const mine = entries.filter((entry) => entry.kind === kind);
        const everywhere = continent.get(kind) ?? 0;
        const linked = target !== undefined;
        if (!loreRowStands(mine.length, everywhere, linked)) continue;
        const count = rowCount(mine.length, everywhere, linked);
        const groups = new Map<LoreGroup, LoreEntryView[]>();
        for (const entry of [...mine].sort((left, right) => left.name.localeCompare(right.name, "de"))) {
            const list = groups.get(entry.group);
            if (list === undefined) groups.set(entry.group, [viewOf(index, entry)]);
            else if (list.length < LORE_ROW_LIMIT) list.push(viewOf(index, entry));
        }
        const views: LoreGroupView[] = [...groups.entries()]
            .sort(([left], [right]) => loreGroupOrder(left) - loreGroupOrder(right))
            .map(([group, list]) => ({ group, entries: list }));
        const link: LoreEverywhereLink | undefined =
            target === undefined || everywhere === 0 ? undefined : { ref: target, count: everywhere };
        rows.push({ kind, count, groups: views, ...(link === undefined ? {} : { everywhere: link }) });
    }
    return rows;
}
