import { halbebeneAlsWkt } from "./halbebene.ts";
import type { Glied, Regel } from "./regeln.ts";

/**
 * Die SQL-Abfrage zu EINER Regel (Richtung A, WI-0257): Aus der Kette der Bedingungen wird eine Abfrage, die je Landschaftsfläche (Kandidat) entscheidet, ob und wie viel von ihr in der Geometrie der
 * Regel liegt. Die Geometrie der Regel wird dabei nie als Ganzes gebaut.
 *
 * 🔴 **Warum je Kandidat:** Die Vereinigung aller Waldflächen kostet gemessen 1,15 s, die Vereinigung der Rahmenfläche Aventurien nur 9 ms, ein `ST_Covers` je Waldfläche gegen sie 160 ms für alle 2.927. Wer
 * die Geometrie der Regel erst vereinigt und dann schneidet, bezahlt die Vereinigung; wer je Kandidat arbeitet, bezahlt nur Prüfungen mit `&&` und Vorfilter.
 *
 * **Das Modell.** Bedingung k ergibt die Menge G_k = (Vereinigung der Landschaften einer Art) ∩ Rahmenfläche ∩ Klimaband ∩ Halbebene. Ohne Arten steht statt der Landschaften die ganze Karte (mit
 * Fläche allein ist G_k die Fläche selbst). Die Regel ist R = ((G_0 op_1 G_1) op_2 G_2) …, streng von links. Weil jede Menge G_k in der Vereinigung der Kandidaten liegt (Landschaften der Arten der
 * Bedingungen, die etwas hinzufügen; bei Fläche allein die Fläche), ist R die Vereinigung der Stücke `c ∩ R` über alle Kandidaten c.
 *
 * **Je Kandidat c** wird jede Bedingung zu einem Stück T_k(c) = c ∩ G_k, und das ist entweder leer (`E`), ganz c (`F`) oder eine Form (`G`). Das billige Urteil `E`/`F` entsteht aus `&&`, `ST_Covers` und
 * `ST_Intersects` gegen die Maske (Rahmen, Klima, Lage); eine Form wird nur gerechnet, wo c die Maske anschneidet. Hat c die Art der Bedingung nicht (eine Bedingung `Gebirge` neben dem Kandidaten `Wald`),
 * liefert der Teil von c, den die Landschaften dieser Art überdecken, die Antwort. Die Stücke laufen durch die Kette: `und` schneidet, `oder` vereinigt, `ohne` zieht ab; die Urteile kürzen ab, wo sie können.
 *
 * Ein Kandidat ohne Landschaft (eine Bedingung nur mit Klima oder Lage) ist die Karte selbst: sein Stück ist der Rest der Regel, der zu keiner Landschaft gehört.
 *
 * 🪤 **Eine Zeile je Kandidat, keine Verbünde zwischen Zwischenergebnissen:** Die Bedingungen und die Schritte der Kette sind `LATERAL`-Unterabfragen auf der Zeile des Kandidaten. Als eigene CTE und
 * `JOIN ... ON ci` wählte der Planer, der für CTE keine Zeilenzahlen kennt, Schleifenverbünde und rechnete 2.900 mal 2.900 Zeilen (gemessen: 0,9 s allein dafür).
 */

/** Die Reparatur ungültiger Formen beim Lesen, dieselbe Rezeptur wie `REPAIRED_AREA` in `subjects/sections/lore.ts` (WI-0107). */
export const REPARIERT = (x: string): string =>
    `(CASE WHEN (ST_IsValidDetail(${x})).valid THEN ${x} ELSE ST_CollectionExtract(ST_MakeValid(${x}, 'method=structure'), 3) END)`;

/**
 * Der Zaun gegen das Hochziehen einer Unterabfrage: Ohne `OFFSET 0` setzt PostgreSQL ihren Ausdruck an jede Verwendung ein, und `ST_Covers` liefe zehnmal je Kandidat (gemessen: 0,73 s statt 0,2 s
 * für 2.931 Kandidaten).
 */
const ZAUN = "OFFSET 0";

/** Stücke unter dieser Fläche (Kartenquadrate) sind Rundungsstaub des Verschnitts und zählen als leer. */
const STAUB = "1e-6";
/** Ein Stück, das so gut wie die ganze Landschaft ist, gilt als ganz (relativ). */
const GANZ_AB = "(1 - 1e-6)";
/** Die Vereinfachung der Formen, in Kartenquadraten (Messung m5: 0,2). */
const VEREINFACHUNG = "0.2";
/** Die Siedlungsarten (`WIKISYNC_LAGE_ORTSARTEN`): Gebäude und Stadtviertel zählen nicht. */
const ORTSARTEN = ["metropole", "grossstadt", "stadt", "kleinstadt", "dorf"];

export interface ZusatzRahmenSql {
    /** Die Abfrage der Maske: eine Zeile mit der Spalte `g` (die Vereinigung; `NULL`, wo der Rahmen leer ist). Die Parameter legt `param` an. */
    readonly sql: (param: (wert: unknown, typ: string) => string) => string;
}

export interface RegelAbfrage {
    readonly text: string;
    readonly params: unknown[];
}

/** Ein Glied der Kette in der Form, in der die Abfrage es baut. */
interface GliedPlan {
    readonly glied: Glied;
    readonly leer: boolean;
    /** Die Namen der Masken-CTE; `null`, wo das Glied sie nicht setzt. */
    readonly rahmen: string | null;
    readonly klima: string | null;
    readonly lage: string | null;
    /** Nur beim künstlichen Schlussglied: der zusätzliche Rahmen. */
    readonly zusatz: string | null;
}

class Bau {
    readonly params: unknown[] = [];
    readonly ctes: string[] = [];
    private readonly masken = new Map<string, string>();
    readonly benutzt = new Set<string>();
    param = (wert: unknown, typ: string): string => {
        this.params.push(wert);
        return `$${String(this.params.length)}::${typ}`;
    };
    cte(name: string, sql: string, materialisiert = true): void {
        this.ctes.push(`${name} AS ${materialisiert ? "MATERIALIZED " : ""}(${sql})`);
    }
    /** Eine Maske einmal bauen, auch wenn mehrere Glieder sie nennen. */
    maske(schluessel: string, vorsilbe: string, sql: () => string, materialisiert = true): string {
        const da = this.masken.get(schluessel);
        if (da !== undefined) return da;
        const name = `${vorsilbe}_${String(this.masken.size)}`;
        this.masken.set(schluessel, name);
        this.cte(name, sql(), materialisiert);
        return name;
    }
}

function planeGlied(bau: Bau, glied: Glied, domaene: string): GliedPlan {
    const unerreichbar =
        (glied.nenntArten && glied.arten.length === 0) ||
        (glied.flaeche !== null && glied.flaeche.regionId === null) ||
        (glied.klima !== null && glied.klima.zonen.length === 0) ||
        (glied.lage !== null && glied.lage.halbebene === null);
    if (unerreichbar) return { glied, leer: true, rahmen: null, klima: null, lage: null, zusatz: null };
    const regionId = glied.flaeche?.regionId ?? null;
    const rahmen =
        regionId === null
            ? null
            : bau.maske(
                  `rahmen|${regionId}`,
                  "m_rahmen",
                  () => `SELECT ST_UnaryUnion(ST_Collect(${REPARIERT("a.geom")})) AS g FROM region_area a
                          WHERE a.is_active AND a.map_domain_id = ${bau.param(domaene, "text")} AND a.region_id = ${bau.param(regionId, "bigint")}`,
              );
    const klima =
        glied.klima === null
            ? null
            : bau.maske(
                  `klima|${[...glied.klima.zonen].sort().join(",")}`,
                  "m_klima",
                  () =>
                      `SELECT ST_UnaryUnion(ST_Collect(b.geom)) AS g FROM climate_band b WHERE b.type_key = ANY(${bau.param([...(glied.klima as { zonen: readonly string[] }).zonen], "text[]")})`,
              );
    const halbebene = glied.lage?.halbebene ?? null;
    const lage =
        halbebene === null
            ? null
            : bau.maske(
                  `lage|${halbebeneAlsWkt(halbebene)}`,
                  "m_lage",
                  () => `SELECT ST_GeomFromText(${bau.param(halbebeneAlsWkt(halbebene), "text")}, 0) AS g`,
                  false,
              );
    return { glied, leer: false, rahmen, klima, lage, zusatz: null };
}

/**
 * Die `LATERAL`-Unterabfragen EINER Bedingung auf der Zeile des Kandidaten `c`: am Ende steht `t<k>` mit den Spalten `st` (`E`, `F`, `G`) und `g` (die Form bei `G`).
 *
 * (1) Beziehung des Kandidaten zu jeder Maske (0 außerhalb, 1 ganz innerhalb, 2 angeschnitten), (2) das Urteil der Masken zusammen, (3) das Stück der Masken, (4) ob der Kandidat die Art der Bedingung
 * selbst trägt, (5) wenn nicht, das Stück, das die Landschaften der Art von ihm überdecken.
 */
function baueTerm(bau: Bau, plan: GliedPlan, k: number, domaene: string): string {
    const t = `t${String(k)}`;
    if (plan.leer) return `CROSS JOIN LATERAL (SELECT 'E'::text AS st, NULL::geometry AS g ${ZAUN}) ${t}`;
    const masken: string[] = [];
    if (plan.zusatz !== null) masken.push(plan.zusatz);
    if (plan.rahmen !== null) masken.push(plan.rahmen);
    if (plan.klima !== null) masken.push(plan.klima);
    if (plan.lage !== null) masken.push(plan.lage);
    for (const m of masken) bau.benutzt.add(m);
    const r = `r${String(k)}`;
    const u = `u${String(k)}`;
    const m = `m${String(k)}`;
    const h = `h${String(k)}`;
    const te = `te${String(k)}`;
    const rel = (maske: string, i: number): string =>
        `CASE WHEN ${maske}.g IS NULL OR NOT (${maske}.g && c.g) THEN 0 WHEN ST_Covers(${maske}.g, c.g) THEN 1 WHEN ST_Intersects(${maske}.g, c.g) THEN 2 ELSE 0 END AS q${String(i)}`;
    const qs = masken.map((_, i) => `${r}.q${String(i)}`);
    const urteil =
        masken.length === 0
            ? "'F'"
            : `CASE WHEN least(${qs.join(", ")}) = 0 THEN 'E' WHEN greatest(${qs.join(", ")}) = 1 THEN 'F' ELSE 'G' END`;
    let stueck = "c.g";
    masken.forEach((maske, i) => {
        stueck = `CASE WHEN ${r}.q${String(i)} = 2 THEN ST_CollectionExtract(ST_Intersection(${stueck}, ${maske}.g), 3) ELSE ${stueck} END`;
    });
    const teile: string[] = [];
    if (masken.length > 0) teile.push(`CROSS JOIN LATERAL (SELECT ${masken.map(rel).join(", ")} ${ZAUN}) ${r}`);
    teile.push(`CROSS JOIN LATERAL (SELECT ${urteil} AS ms ${ZAUN}) ${u}`);
    teile.push(
        `CROSS JOIN LATERAL (SELECT ${masken.length === 0 ? "NULL::geometry" : `CASE WHEN ${u}.ms = 'G' THEN ${stueck} END`} AS mg ${ZAUN}) ${m}`,
    );
    const glied = plan.glied;
    if (!glied.nenntArten) {
        teile.push(`CROSS JOIN LATERAL (SELECT ${u}.ms AS st, ${m}.mg AS g ${ZAUN}) ${t}`);
        return teile.join("\n    ");
    }
    const arten = bau.param([...glied.arten], "text[]");
    teile.push(
        `CROSS JOIN LATERAL (SELECT coalesce(c.layer IS NOT NULL AND c.layer <> 'klima' AND (c.layer || '|' || c.typ) = ANY(${arten}), FALSE) AS hat ${ZAUN}) ${h}`,
    );
    teile.push(
        `LEFT JOIN LATERAL (
        SELECT ST_CollectionExtract(ST_UnaryUnion(ST_Collect(ST_Intersection(c.g, dg.g))), 3) AS teil
          FROM region_area d
          JOIN region dr ON dr.id = d.region_id AND dr.is_active AND NOT dr.is_hidden AND dr.region_layer <> 'klima'
         CROSS JOIN LATERAL (SELECT ${REPARIERT("d.geom")} AS g) dg
         WHERE ${u}.ms <> 'E' AND NOT ${h}.hat AND d.is_active AND d.map_domain_id = ${bau.param(domaene, "text")}
           AND (dr.region_layer || '|' || dr.region_type) = ANY(${arten}) AND d.geom && c.g AND ST_Intersects(dg.g, c.g)
    ) ${te} ON TRUE`,
    );
    teile.push(
        `CROSS JOIN LATERAL (SELECT
            CASE WHEN ${u}.ms = 'E' THEN 'E' WHEN ${h}.hat THEN ${u}.ms WHEN ${te}.teil IS NULL OR ST_IsEmpty(${te}.teil) THEN 'E' ELSE 'G' END AS st,
            CASE WHEN ${u}.ms = 'E' THEN NULL WHEN ${h}.hat THEN ${m}.mg
                 ELSE ST_CollectionExtract(ST_Intersection(CASE WHEN ${u}.ms = 'F' THEN c.g ELSE ${m}.mg END, ${te}.teil), 3) END AS g ${ZAUN}) ${t}`,
    );
    return teile.join("\n    ");
}

/** Ein Stück ohne Fläche (Staub, leer) zählt als leer. */
const BEREINIGT_ST = (st: string, g: string): string =>
    `CASE WHEN ${st} = 'G' AND (${g} IS NULL OR ST_IsEmpty(${g}) OR ST_Area(${g}) < ${STAUB}) THEN 'E' ELSE ${st} END`;
const BEREINIGT_G = (st: string, g: string): string =>
    `CASE WHEN ${st} = 'G' AND (${g} IS NULL OR ST_IsEmpty(${g}) OR ST_Area(${g}) < ${STAUB}) THEN NULL ELSE ${g} END`;

/** Ein Schritt der Kette: das Stück bis hierher (`p`) mit dem Stück der nächsten Bedingung (`t`). */
function schritt(op: "und" | "oder" | "ohne", p: string, t: string): { st: string; g: string } {
    switch (op) {
        case "und":
            return {
                st: `CASE WHEN ${p}.st = 'E' OR ${t}.st = 'E' THEN 'E' WHEN ${p}.st = 'F' THEN ${t}.st WHEN ${t}.st = 'F' THEN ${p}.st ELSE 'G' END`,
                g: `CASE WHEN ${p}.st = 'G' AND ${t}.st = 'G' THEN ST_CollectionExtract(ST_Intersection(${p}.g, ${t}.g), 3)
                          WHEN ${p}.st = 'F' THEN ${t}.g WHEN ${t}.st = 'F' THEN ${p}.g END`,
            };
        case "oder":
            return {
                st: `CASE WHEN ${p}.st = 'F' OR ${t}.st = 'F' THEN 'F' WHEN ${p}.st = 'E' THEN ${t}.st WHEN ${t}.st = 'E' THEN ${p}.st ELSE 'G' END`,
                g: `CASE WHEN ${p}.st = 'G' AND ${t}.st = 'G' THEN ST_CollectionExtract(ST_Union(${p}.g, ${t}.g), 3)
                          WHEN ${p}.st = 'E' THEN ${t}.g WHEN ${t}.st = 'E' THEN ${p}.g END`,
            };
        case "ohne":
            return {
                st: `CASE WHEN ${p}.st = 'E' OR ${t}.st = 'F' THEN 'E' WHEN ${t}.st = 'E' THEN ${p}.st ELSE 'G' END`,
                g: `CASE WHEN ${t}.st = 'E' THEN ${p}.g
                          WHEN ${p}.st = 'F' AND ${t}.st = 'G' THEN ST_CollectionExtract(ST_Difference(c.g, ${t}.g), 3)
                          WHEN ${p}.st = 'G' AND ${t}.st = 'G' THEN ST_CollectionExtract(ST_Difference(${p}.g, ${t}.g), 3) END`,
            };
    }
}

/**
 * Die Abfrage zu einer Regel. Die Zeilen der Antwort tragen `art`: `L` eine Landschaft (eine Fläche davon, mit Urteil und gegebenenfalls Form), `R` den Rest ohne Landschaft, `S` eine Siedlung.
 * `zusatz` ist die Maske eines zusätzlichen Rahmens („Wirselkraut in Bornland“), der die ganze Regel noch einmal einschränkt.
 */
export function baueRegelAbfrage(
    regel: Regel,
    domaene: string,
    nachkommastellen: number,
    zusatz?: ZusatzRahmenSql,
): RegelAbfrage {
    const bau = new Bau();
    const plaene = regel.glieder.map((glied) => planeGlied(bau, glied, domaene));
    let zusatzName: string | null = null;
    if (zusatz !== undefined) {
        zusatzName = "m_zusatz";
        bau.cte(zusatzName, zusatz.sql(bau.param));
    }

    // Kandidaten: die Landschaften der Arten jener Bedingungen, die etwas hinzufügen (die erste und jede mit `oder`), bei Fläche allein die Fläche; ohne beides die Karte selbst.
    const bedingungen: string[] = [];
    let restKandidat = false;
    plaene.forEach((plan, k) => {
        if (plan.leer) return;
        if (k > 0 && plan.glied.op !== "oder") return;
        const glied = plan.glied;
        if (glied.nenntArten) {
            const vorfilter = [
                plan.rahmen === null ? "" : ` AND a.geom && (SELECT g FROM ${plan.rahmen})`,
                plan.klima === null ? "" : ` AND a.geom && (SELECT g FROM ${plan.klima})`,
            ].join("");
            bedingungen.push(
                `(r.region_layer <> 'klima' AND (r.region_layer || '|' || r.region_type) = ANY(${bau.param([...glied.arten], "text[]")})${vorfilter})`,
            );
        } else if (glied.flaeche?.regionId != null) {
            bedingungen.push(`r.id = ${bau.param(glied.flaeche.regionId, "bigint")}`);
        } else {
            restKandidat = true;
        }
    });
    const zusatzFilter = zusatzName === null ? "" : ` AND a.geom && (SELECT g FROM ${zusatzName})`;
    const aeste: string[] = [];
    if (bedingungen.length > 0) {
        aeste.push(
            `SELECT a.id AS aid, a.region_id AS rid, r.public_id AS pid, r.name AS name, r.region_layer AS layer, r.region_type AS typ, ${REPARIERT("a.geom")} AS g
               FROM region_area a JOIN region r ON r.id = a.region_id AND r.is_active AND NOT r.is_hidden
              WHERE a.is_active AND a.map_domain_id = ${bau.param(domaene, "text")} AND (${bedingungen.join(" OR ")})${zusatzFilter}`,
        );
    }
    if (restKandidat) {
        aeste.push(
            `SELECT NULL::bigint, NULL::bigint, NULL::uuid, NULL::text, NULL::text, NULL::text,
                    (SELECT ST_MakeEnvelope(min_x, min_y, max_x, max_y, 0) FROM map_domain WHERE id = ${bau.param(domaene, "text")})`,
        );
    }
    if (aeste.length === 0)
        aeste.push(
            `SELECT NULL::bigint, NULL::bigint, NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::geometry WHERE FALSE`,
        );
    bau.cte(
        "cand",
        `SELECT (row_number() OVER ())::int AS ci, k.* FROM (${aeste.join(" UNION ALL ")}) k(aid, rid, pid, name, layer, typ, g)`,
    );

    // Die Stücke je Bedingung und die Kette, alles auf der Zeile des Kandidaten.
    const glieder: GliedPlan[] = [...plaene];
    if (zusatzName !== null) {
        glieder.push({
            glied: { op: "und", arten: [], nenntArten: false, flaeche: null, klima: null, lage: null },
            leer: false,
            rahmen: null,
            klima: null,
            lage: null,
            zusatz: zusatzName,
        });
    }
    const kette: string[] = [];
    glieder.forEach((plan, k) => {
        kette.push(baueTerm(bau, plan, k, domaene));
        if (k === 0) {
            kette.push(
                `CROSS JOIN LATERAL (SELECT ${BEREINIGT_ST("t0.st", "t0.g")} AS st, ${BEREINIGT_G("t0.st", "t0.g")} AS g ${ZAUN}) n0`,
            );
            return;
        }
        const s = schritt(plan.glied.op, `n${String(k - 1)}`, `t${String(k)}`);
        kette.push(`CROSS JOIN LATERAL (SELECT ${s.st} AS st, ${s.g} AS g ${ZAUN}) s${String(k)}`);
        kette.push(
            `CROSS JOIN LATERAL (SELECT ${BEREINIGT_ST(`s${String(k)}.st`, `s${String(k)}.g`)} AS st, ${BEREINIGT_G(`s${String(k)}.st`, `s${String(k)}.g`)} AS g ${ZAUN}) n${String(k)}`,
        );
    });
    const letzte = `n${String(glieder.length - 1)}`;
    const maskenJoin = [...bau.benutzt].map((m) => `CROSS JOIN ${m}`).join(" ");

    // Das Ergebnis: je Kandidat das Urteil (ein Stück, das fast die ganze Landschaft ist, gilt als ganz).
    bau.cte(
        "fin",
        `SELECT c.ci, c.aid, c.rid, c.pid, c.name, c.g AS cg,
                CASE WHEN ${letzte}.st = 'G' AND ST_Area(${letzte}.g) >= ST_Area(c.g) * ${GANZ_AB} THEN 'F' ELSE ${letzte}.st END AS st,
                ${letzte}.g AS g
           FROM cand c ${maskenJoin}
           ${kette.join("\n           ")}
          WHERE ${letzte}.st <> 'E'`,
    );
    const form = (g: string): string =>
        `ST_AsGeoJSON(ST_SimplifyPreserveTopology(${g}, ${VEREINFACHUNG}), ${String(Math.min(8, Math.max(0, Math.floor(Number.isFinite(nachkommastellen) ? nachkommastellen : 1))))})`;
    const stueckGeom = "(CASE WHEN f.st = 'G' THEN f.g ELSE f.cg END)";
    bau.cte(
        "landschaft",
        `SELECT 'L'::text AS art, z.rid, z.pid, z.name, z.st, z.ganz, z.x0, z.y0, z.x1, z.y1,
                CASE WHEN NOT z.ganz THEN ${form("z.stueck")} END AS form
           FROM (
                SELECT f.rid, f.pid, f.name, f.st, ${stueckGeom} AS stueck,
                       (count(*) OVER w = (SELECT count(*) FROM region_area x WHERE x.region_id = f.rid AND x.is_active) AND bool_and(f.st = 'F') OVER w) AS ganz,
                       ST_XMin(${stueckGeom})::float8 AS x0, ST_YMin(${stueckGeom})::float8 AS y0, ST_XMax(${stueckGeom})::float8 AS x1, ST_YMax(${stueckGeom})::float8 AS y1
                  FROM fin f WHERE f.rid IS NOT NULL
                WINDOW w AS (PARTITION BY f.rid)
           ) z`,
        false,
    );
    bau.cte(
        "rest",
        `SELECT 'R'::text AS art, NULL::bigint AS rid, NULL::uuid AS pid, NULL::text AS name, f.st, FALSE AS ganz,
                ST_XMin(${stueckGeom})::float8 AS x0, ST_YMin(${stueckGeom})::float8 AS y0, ST_XMax(${stueckGeom})::float8 AS x1, ST_YMax(${stueckGeom})::float8 AS y1,
                ${form(stueckGeom)} AS form
           FROM fin f WHERE f.rid IS NULL`,
        false,
    );
    const ortsarten = bau.param(ORTSARTEN, "text[]");
    const domaeneOrt = bau.param(domaene, "text");
    bau.cte(
        "siedlung",
        `SELECT DISTINCT p.id, p.public_id, p.name, p.subtype, ST_X(p.geom)::float8 AS px, ST_Y(p.geom)::float8 AS py
           FROM fin f
           JOIN region_area a ON a.id = f.aid
           JOIN place p ON p.geom && a.geom AND p.is_active AND NOT p.is_hidden AND p.map_domain_id = ${domaeneOrt} AND p.subtype = ANY(${ortsarten})
          WHERE ST_Intersects(${stueckGeom}, p.geom)
         UNION
         SELECT p.id, p.public_id, p.name, p.subtype, ST_X(p.geom)::float8, ST_Y(p.geom)::float8
           FROM fin f
           JOIN place p ON p.is_active AND NOT p.is_hidden AND p.map_domain_id = ${domaeneOrt} AND p.subtype = ANY(${ortsarten})
          WHERE f.aid IS NULL AND p.geom && ${stueckGeom} AND ST_Intersects(${stueckGeom}, p.geom)`,
        false,
    );
    const text = `WITH ${bau.ctes.join(",\n")}
        SELECT l.art, l.rid::text AS rid, l.pid::text AS pid, l.name, l.st, l.ganz, l.x0, l.y0, l.x1, l.y1, l.form, NULL::text AS plid, NULL::text AS ppid, NULL::text AS pname, NULL::text AS psub, NULL::float8 AS px, NULL::float8 AS py
          FROM landschaft l
        UNION ALL
        SELECT r.art, NULL, NULL, NULL, r.st, r.ganz, r.x0, r.y0, r.x1, r.y1, r.form, NULL, NULL, NULL, NULL, NULL, NULL
          FROM rest r
        UNION ALL
        SELECT 'S', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, s.id::text, s.public_id::text, s.name, s.subtype, s.px, s.py
          FROM siedlung s`;
    return { text, params: bau.params };
}
