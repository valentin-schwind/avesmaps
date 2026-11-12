import {
    LORE_READING,
    LORE_ROWS,
    landscapeReaderName,
    type RouteUnterwegsEintrag,
    type RouteUnterwegsRequest,
} from "@avesmaps3d/shared";
import type { Queryable } from "../../database.ts";
import { eintraegeAnPunktgruppen, KEIN_ERSATZ, ortszeileErsetzt, type GruppenTreffer } from "../../vorkommen/index.ts";
import type { SubjectIndex } from "../subject-index.ts";
import {
    deepestOf,
    PFAD_PUNKTE,
    PFAD_SCHRITT,
    place,
    RULE_DOMAIN,
    type EntryRow,
    type Placed,
    type Polyline,
} from "./lore.ts";

/**
 * „Unterwegs gibt es:“ (WI-0257 S4): die Vorkommen einer GANZEN Route - jeder Eintrag, den das Panel irgendeiner Etappe unter „Aus der Region“ nennt, einmal, mit den Nummern seiner Etappen
 * und der Gegend, in der er zuerst vorkommt.
 *
 * 🔴 **Dieselbe Rechnung wie das Panel der Etappe, nur über alle Etappen auf einmal.** Je Etappe gilt, was `loreCarriersOf(…, "path", wege, undefined, linien)` und `placedEntries` in
 * `lore.ts` rechnen: die Landschaften und Gebiete, die ihre Linie berührt (`regionsAt`, `territoriesAt`), die Regeln an den Punkten entlang der Linie (`pathPoints`, `PFAD_SCHRITT`), die
 * Ortszeilen an diesen Flächen ohne Kontinentzeilen, hinter genaueren Regeln zurückgetreten (F2). Hier stehen dieselben Bedingungen als MENGEN: Die Geometrie aller Etappen in EINER Abfrage
 * (je Etappe gruppiert, nicht vermischt), die Regeln aller Punkte in EINER Auswertung, die Ortszeilen aller berührten Flächen in EINER Abfrage; danach setzt Node jede Etappe aus den Zuordnungen
 * zusammen. Was im Panel der Etappe 3 steht, steht hier „ab Etappe 3“ oder früher (Prüffall `vorkommen-panel.test.ts`, „jeder Eintrag steht im Panel genau der Etappen“).
 *
 * 💣 **Warum nicht je Etappe:** Gemessen am 2026-10-30 rechnete die Route je Etappe in eigener Transaktion rund 13 Abfragen, darunter den Kartenstand der Regeln zweimal; 67 Etappen brauchten
 * lokal 1,9 s und 845 Abfragen, auf der Stage brach eine Route mit 68 Etappen nach dem Zeitbudget ab. Gebündelt sind es rund ein Dutzend Abfragen je Route, gleich wie lang sie ist.
 * Die Abfragen rechnen ohne JIT (`jitOff` im Dienst): Die Punkte entlang einer Linie schätzt der Planer lokal auf rund 1,5 Millionen Kosteneinheiten, weit über `jit_above_cost`
 * (100.000); wo PostgreSQL mit LLVM läuft (die Stage, WI-0065), übersetzt er jede solche Abfrage, und das kostet mehr als die Rechnung selbst. Lokal gibt es kein LLVM.
 *
 * 🪤 Wo die Antwort des Panels von einer Reihenfolge der Datenbank abhing, die keine Abfrage zusagt (`DISTINCT` ohne `ORDER BY`), steht hier die Reihenfolge, die der Planer dort wählt
 * (Landschaften und Gebiete nach ihrer Kennung als Text): Sie entscheidet nur, welcher von zwei gleich guten Namen die Gegend ist. Zwei Einträge derselben Art mit demselben Namen stehen in der
 * Reihenfolge ihrer ersten Etappe, dann wie im Panel (Ortszeile vor Regel), dann nach `lore_entry.id`.
 */

/** Die Etappe der Anfrage: ihre Wege und die Linien ihrer Abschnitte ohne Weg. */
type Etappe = RouteUnterwegsRequest["stages"][number];

/** Eine Etappe, wie sie gerechnet wird: jeder Weg einmal, die Linien ab zwei Punkten (wie `lineRows`). */
interface Strecke {
    wege: string[];
    linien: Polyline[];
}

/** Was die Linie einer Strecke berührt und wo die Regeln gefragt werden. */
interface Lage {
    /** `region.id` wie `regionsAt`, nach der Kennung als Text geordnet. */
    regionen: string[];
    /** `territory.id` wie `territoriesAt`, ebenso geordnet. */
    gebiete: number[];
    /** Wie `pathPoints`: auf zwei Stellen gerundet, ohne Dopplung, nach Lage sortiert. */
    punkte: { x: number; y: number }[];
}

/**
 * Eine Ortszeile (`lore_place`) an einer der berührten Flächen, mit ALLEN ihren Zielen in der Reihenfolge `lore_place_target.id`: `r<region.id>`, `t<territory.id>` oder `-` (Ort, Gipfel).
 * 🪤 Ein Feld je Ziel statt zweier Felder mit `NULL`: postgres.js liest ein `NULL` in einem `text[]` als Zeichenkette „NULL“.
 */
interface Ortszeile extends EntryRow {
    relation: string;
    ziele: string[];
}

/** Ein Ziel einer Ortszeile, gelesen. */
type Ziel = { region: string } | { gebiet: string } | undefined;

const zielVon = (ziel: string): Ziel =>
    ziel.startsWith("r") ? { region: ziel.slice(1) } : ziel.startsWith("t") ? { gebiet: ziel.slice(1) } : undefined;

/** Der Schlüssel einer Etappe: zwei Etappen über dieselben Wege und Linien rechnen einmal (Hin- und Rückweg, Pendelstrecken). */
const schluesselDer = (etappe: Etappe): string =>
    `${[...etappe.paths].sort().join(",")}|${(etappe.lines ?? []).map((line) => line.join(",")).join(";")}`;

/**
 * Die Lage aller Strecken in EINER Abfrage: je Strecke die Landschaften und Gebiete, die ihre Linie berührt, und die Punkte entlang der Linie. 🔴 Je Strecke gruppiert wie die Stelle des Panels
 * (`spotSource`, `pathPoints`): Die Wege einer Strecke werden gesammelt und zusammengefügt, ehe die Punkte entstehen - zwei Strecken teilen nie eine Linie.
 *
 * 🪤 **Die Flächen stehen außen, die Strecken innen** (wie in `ladeUmgebungen`): Erst sucht der Index je Strecke die Flächen, deren Rechteck sie schneidet, dann prüft jede Fläche einmal
 * nacheinander ihre Strecken, und PostGIS bereitet eine große Fläche (das Meer, rund 18.000 Stützpunkte) einmal vor statt einmal je Strecke. Gemessen an 67 Etappen: 32 statt 150 ms für die
 * Landschaften, 18 statt 31 ms für die Gebiete, mit demselben Ergebnis.
 */
async function lagenDer(database: Queryable, strecken: readonly Strecke[]): Promise<Lage[]> {
    const lagen: Lage[] = strecken.map(() => ({ regionen: [], gebiete: [], punkte: [] }));
    const wegS: number[] = [];
    const wegId: string[] = [];
    const linS: number[] = [];
    const linNr: number[] = [];
    const xs: number[] = [];
    const ys: number[] = [];
    let nr = 0;
    strecken.forEach((strecke, s) => {
        for (const id of strecke.wege) {
            wegS.push(s);
            wegId.push(id);
        }
        for (const linie of strecke.linien) {
            for (let i = 0; i + 1 < linie.length; i += 2) {
                linS.push(s);
                linNr.push(nr);
                xs.push(linie[i] as number);
                ys.push(linie[i + 1] as number);
            }
            nr += 1;
        }
    });
    if (wegS.length + linS.length === 0) return lagen;
    const rows = await database.unsafe<{ art: "r" | "t" | "p"; s: number; id: string | null; x: number; y: number }[]>(
        `WITH wege AS (SELECT DISTINCT w.s, w.id FROM unnest($1::int[], $2::uuid[]) AS w(s, id)),
              roh AS MATERIALIZED (
                  SELECT w.s, l.geom AS g FROM wege w JOIN path l ON l.public_id = w.id AND l.is_active
                  UNION ALL
                  SELECT min(u.s), ST_MakeLine(ST_SetSRID(ST_MakePoint(u.x, u.y), 0) ORDER BY u.i)
                    FROM unnest($3::int[], $4::int[], $5::float8[], $6::float8[]) WITH ORDINALITY AS u(s, l, x, y, i)
                   GROUP BY u.l),
              stelle AS MATERIALIZED (SELECT roh.s, ST_Collect(roh.g) AS geom FROM roh GROUP BY roh.s),
              c AS MATERIALIZED (SELECT roh.s, (ST_Dump(ST_LineMerge(ST_Collect(roh.g)))).geom AS g FROM roh GROUP BY roh.s),
              t AS (SELECT c.s, greatest($7::float8, coalesce(sum(ST_Length(c.g)), 0) / $8::float8) AS step FROM c GROUP BY c.s),
              landpaar AS (SELECT a.id, array_agg(st.s) AS ss FROM stelle st JOIN region_area a ON a.is_active AND a.geom && st.geom GROUP BY a.id),
              gebietpaar AS (SELECT sh.territory_id, sh.band, array_agg(st.s) AS ss
                               FROM stelle st JOIN territory_shape sh ON sh.geom && st.geom GROUP BY sh.territory_id, sh.band)
         SELECT 'r' AS art, x.s, a.region_id::text AS id, NULL::float8 AS x, NULL::float8 AS y
           FROM landpaar k
           JOIN region_area a ON a.id = k.id
           JOIN region r ON r.id = a.region_id AND r.is_active AND NOT r.is_hidden
          CROSS JOIN LATERAL (SELECT st.s FROM stelle st WHERE st.s = ANY(k.ss) AND ST_Intersects(a.geom, st.geom) OFFSET 0) x
          GROUP BY x.s, a.region_id
         UNION ALL
         SELECT 't', x.s, sh.territory_id::text, NULL, NULL
           FROM gebietpaar k
           JOIN territory_shape sh ON sh.territory_id = k.territory_id AND sh.band = k.band
          CROSS JOIN LATERAL (SELECT st.s FROM stelle st WHERE st.s = ANY(k.ss) AND ST_Intersects(sh.geom, st.geom) OFFSET 0) x
          GROUP BY x.s, sh.territory_id
         UNION ALL
         SELECT DISTINCT 'p', c.s, NULL, round(ST_X(pt.geom)::numeric, 2)::float8, round(ST_Y(pt.geom)::numeric, 2)::float8
           FROM c JOIN t ON t.s = c.s
          CROSS JOIN LATERAL (
              SELECT ST_StartPoint(c.g) AS geom
              UNION ALL SELECT ST_EndPoint(c.g)
              UNION ALL
              SELECT (ST_Dump(ST_LineInterpolatePoints(c.g, LEAST(1.0, t.step / ST_Length(c.g)), true))).geom
               WHERE ST_Length(c.g) > 0
          ) pt`,
        [wegS, wegId, linS, linNr, xs, ys, PFAD_SCHRITT, PFAD_PUNKTE] as never[],
    );
    const gebiete = lagen.map(() => [] as string[]);
    for (const row of rows) {
        const lage = lagen[row.s] as Lage;
        if (row.art === "r") lage.regionen.push(row.id as string);
        else if (row.art === "t") (gebiete[row.s] as string[]).push(row.id as string);
        else lage.punkte.push({ x: Number(row.x), y: Number(row.y) });
    }
    lagen.forEach((lage, s) => {
        lage.regionen.sort();
        lage.gebiete = (gebiete[s] as string[]).sort().map(Number);
        lage.punkte.sort((a, b) => a.x - b.x || a.y - b.y);
    });
    return lagen;
}

/**
 * Die Ortszeilen an diesen Flächen, wie `entriesAt` sie für „Aus der Region“ liest (ohne Kontinentzeilen), mit ALLEN Zielen je Zeile: Node ordnet jede Zeile den Etappen zu, deren Flächen eines
 * ihrer Ziele sind, und liest aus denselben Zeilen die Gegend. Geordnet wie die Gegend sie liest: Eintrag, `sort_order`, Zeile.
 */
async function ortszeilenAn(
    database: Queryable,
    regionen: readonly string[],
    gebiete: readonly number[],
): Promise<Ortszeile[]> {
    if (regionen.length + gebiete.length === 0) return [];
    return database<Ortszeile[]>`
        SELECT e.id::text AS id, e.public_id::text AS public_id, e.kind, e.name, e.wiki_key, FALSE AS origin, p.relation,
               array_agg(CASE WHEN t.region_id IS NOT NULL THEN 'r' || t.region_id::text
                              WHEN t.territory_id IS NOT NULL THEN 't' || t.territory_id::text
                              ELSE '-' END ORDER BY t.id) AS ziele
          FROM lore_place p
          JOIN lore_entry e ON e.id = p.lore_entry_id AND e.is_active AND e.state = 'active'
          JOIN lore_place_target t ON t.lore_place_id = p.id
         WHERE p.is_active AND p.state = 'active' AND p.key_class <> 'continent'
           AND EXISTS (SELECT 1 FROM lore_place_target z
                        WHERE z.lore_place_id = p.id
                          AND (z.region_id = ANY(${[...regionen]}::bigint[]) OR z.territory_id = ANY(${[...gebiete]}::bigint[])))
         GROUP BY e.id, p.id
         ORDER BY e.id, p.sort_order, p.id
    `;
}

/** Die Einträge zu Regeltreffern (`ruleEntries` in `lore.ts`), nach Kennung geordnet. */
async function regelEintraege(database: Queryable, ids: readonly string[]): Promise<EntryRow[]> {
    if (ids.length === 0) return [];
    return database<EntryRow[]>`
        SELECT e.id::text AS id, e.public_id::text AS public_id, e.kind, e.name, e.wiki_key, FALSE AS origin
          FROM lore_entry e
         WHERE e.id = ANY(${[...ids]}::bigint[]) AND e.is_active AND e.state = 'active'
         ORDER BY e.id
    `;
}

/** Die Namen dieser Landschaften, wie die Gegend sie nennt: nie der Kontinent, nie ein Griff („Wald-925“); dann leer. Unbekannt, stillgelegt oder verborgen heißt leer. */
async function landschaftsnamen(database: Queryable, ids: readonly string[]): Promise<Map<string, string>> {
    const namen = new Map<string, string>();
    if (ids.length === 0) return namen;
    const rows = await database<{ id: string; name: string; type: string }[]>`
        SELECT id::text AS id, name, region_type AS type FROM region
         WHERE id = ANY(${[...ids]}::bigint[]) AND is_active AND NOT is_hidden
    `;
    for (const row of rows) {
        const name = row.type === "kontinent" ? null : landscapeReaderName(row.name, row.type);
        namen.set(row.id, name ?? "");
    }
    return namen;
}

/** Die verschiedenen Strecken der Etappen: Hin- und Rückweg, Pendelstrecken rechnen einmal; `streckeDer[at]` ist die der Etappe `at`. */
function streckenDer(etappen: readonly Etappe[]): { strecken: Strecke[]; streckeDer: number[] } {
    const nummer = new Map<string, number>();
    const strecken: Strecke[] = [];
    const streckeDer = etappen.map((etappe) => {
        const schluessel = schluesselDer(etappe);
        let at = nummer.get(schluessel);
        if (at === undefined) {
            const linien = (etappe.lines ?? []).filter((linie) => linie.length >= 4);
            at = strecken.push({ wege: [...new Set(etappe.paths)], linien }) - 1;
            nummer.set(schluessel, at);
        }
        return at;
    });
    return { strecken, streckeDer };
}

/**
 * Die Landschaften und Gebiete, die eine Linie der Route berührt, als `public_id` (WI-0257 S5, die Gegenden eines gewählten Vorkommens an der Route): dieselbe Lage wie für die Liste
 * (`lagenDer`), über alle Etappen vereinigt. Verborgene und stillgelegte Landschaften fehlen wie dort.
 */
export async function beruehrteFlaechen(
    database: Queryable,
    etappen: readonly Etappe[],
): Promise<{ landschaften: Set<string>; gebiete: Set<string> }> {
    const lagen = await lagenDer(database, streckenDer(etappen).strecken);
    const regionen = [...new Set(lagen.flatMap((lage) => lage.regionen))];
    const gebiete = [...new Set(lagen.flatMap((lage) => lage.gebiete))];
    const [r, t] = await Promise.all([
        regionen.length === 0
            ? []
            : database<
                  { id: string }[]
              >`SELECT public_id::text AS id FROM region WHERE id = ANY(${regionen}::bigint[])`,
        gebiete.length === 0
            ? []
            : database<
                  { id: string }[]
              >`SELECT public_id::text AS id FROM territory WHERE id = ANY(${gebiete}::bigint[])`,
    ]);
    return { landschaften: new Set(r.map((row) => row.id)), gebiete: new Set(t.map((row) => row.id)) };
}

/**
 * Die Einträge der ganzen Route, geordnet nach Art und Name, je Eintrag mit seinen Etappen (aufsteigend) und der Gegend seiner ersten Etappe. `frist` läuft zwischen den Schritten: Sie wirft,
 * wenn das Zeitbudget der Route aufgebraucht ist, und setzt sonst die Grenze der nächsten Abfragen auf den Rest.
 *
 * Die Gegend, je Eintrag das erste Brauchbare an seiner ersten Etappe (Betreiber 2026-10-29: „da wärs cool wenn bei den sachen noch die gegend dranstehen würde“):
 *
 * 1. **Die Ortszeile:** Ziel einer Ortszeile des Eintrags (in der Reihenfolge des Wiki-Artikels), das die Linie der Etappe berührt - die Landschaft oder das Gebiet, das der Artikel nennt. Eine
 *    Ortszeile, die hinter eine genauere Regel zurücktritt (F2), nennt nichts.
 * 2. **Der Treffer der Regel:** die Landschaften am ersten Punkt, an dem eine Regel trifft (erst der Rahmen, dann die genannten Arten, dann die übrigen; `treffendeFlaechen`).
 * 3. **Das Gebiet darüber:** das tiefste politische Gebiet, das die Etappe berührt; fehlt es (freies Wasser), die erste benannte Landschaft der Etappe.
 *
 * Nie ein automatischer Name („Wald-925“), nie der Kontinent („Aventurien“ sagt nichts). 🪤 „Zuerst“ gilt je Etappe: Innerhalb einer Etappe gibt es keine Fahrtreihenfolge der Punkte (die Träger
 * kommen aus der Tabelle, nicht aus der Reise), die Wahl ist aber stabil (Punkte nach Lage sortiert). 🔴 Die Namen sind die der Karte und werden nie übersetzt.
 */
export async function unterwegsDerRoute(
    database: Queryable,
    index: SubjectIndex,
    etappen: readonly Etappe[],
    frist: () => Promise<void> = () => Promise.resolve(),
): Promise<RouteUnterwegsEintrag[]> {
    // Gleiche Etappen rechnen einmal: `strecken` sind die verschiedenen, `streckeDer[at]` ist die der Etappe `at`.
    const { strecken, streckeDer } = streckenDer(etappen);

    const lagen = await lagenDer(database, strecken);
    await frist();
    // Die Regeln gelten für die Karte Aventurien (wie `carriersWithoutFlag`); ein anderer Kartenraum hat keine und keine Rahmen.
    const regeln =
        index.mapDomainId === RULE_DOMAIN
            ? await eintraegeAnPunktgruppen(
                  database,
                  lagen.map((lage) => lage.punkte),
              )
            : undefined;
    await frist();
    const ersatz = regeln !== undefined && LORE_READING.ortszeileHinterRegel ? regeln.ersatz : KEIN_ERSATZ;
    const treffer: readonly GruppenTreffer[] =
        regeln?.gruppen ?? strecken.map(() => ({ eintraege: [], flaechen: new Map<string, string[]>() }));

    const alleRegionen = [...new Set(lagen.flatMap((lage) => lage.regionen))];
    const alleGebiete = [...new Set(lagen.flatMap((lage) => lage.gebiete))];
    const regelIds = [...new Set(treffer.flatMap((t) => t.eintraege.map((entry) => entry.id)))];
    // Alle Landschaften, die eine Gegend nennen kann: die berührten (Ortszeile, erste benannte) und die der Regeltreffer.
    const benennbar = [...new Set([...alleRegionen, ...treffer.flatMap((t) => [...t.flaechen.values()].flat())])];
    const [zeilen, viaRegeln, namen] = await Promise.all([
        ortszeilenAn(database, alleRegionen, alleGebiete),
        regelEintraege(database, regelIds),
        landschaftsnamen(database, benennbar),
    ]);

    // Die geltenden Ortszeilen (als Nummer ihrer Zeile) je Fläche und je Eintrag. Eine Zeile, die hinter eine genauere Regel zurücktritt (F2), gilt nirgends: weder für die Liste noch für die Gegend.
    const anRegion = new Map<string, number[]>();
    const anGebiet = new Map<string, number[]>();
    const desEintrags = new Map<string, number[]>();
    const ablegen = (karte: Map<string, number[]>, id: string, nr: number): void => {
        const liste = karte.get(id);
        if (liste === undefined) karte.set(id, [nr]);
        else if (liste[liste.length - 1] !== nr) liste.push(nr);
    };
    zeilen.forEach((zeile, nr) => {
        const ziele = zeile.ziele.map(zielVon);
        const regionen = ziele.flatMap((ziel) => (ziel !== undefined && "region" in ziel ? [ziel.region] : []));
        if (ortszeileErsetzt(ersatz, zeile.id, zeile.relation, regionen)) return;
        for (const ziel of ziele) {
            if (ziel === undefined) continue;
            if ("region" in ziel) ablegen(anRegion, ziel.region, nr);
            else ablegen(anGebiet, ziel.gebiet, nr);
        }
        ablegen(desEintrags, zeile.id, nr);
    });
    const regionMengen = lagen.map((lage) => new Set(lage.regionen));
    const gebietMengen = lagen.map((lage) => new Set(lage.gebiete.map(String)));

    // Je Strecke die Einträge ihres Panels (`placedEntries`): erst die Ortszeilen an ihren Flächen, dann die Regeltreffer; ein Eintrag einmal.
    const eintraegeDer: Placed[][] = lagen.map((lage, s) => {
        const nummern = new Set<number>();
        for (const id of lage.regionen) for (const nr of anRegion.get(id) ?? []) nummern.add(nr);
        for (const id of gebietMengen[s] as Set<string>) for (const nr of anGebiet.get(id) ?? []) nummern.add(nr);
        const ortszeilen = [...nummern].sort((a, b) => a - b).map((nr) => zeilen[nr] as Ortszeile);
        const getroffen = new Set((treffer[s] as GruppenTreffer).eintraege.map((entry) => entry.id));
        return place([], [...ortszeilen, ...viaRegeln.filter((row) => getroffen.has(row.id))]);
    });

    const name = (id: string): string => namen.get(id) ?? "";
    const gebietsname = (id: string | number): string => index.territories.byId.get(Number(id))?.name.trim() ?? "";
    /** Die Gegend eines Eintrags an seiner ersten Strecke `s`; leer, wo es keinen Namen gibt. */
    const gegend = (entry: string, s: number): string => {
        const regionenHier = regionMengen[s] as Set<string>;
        const gebieteHier = gebietMengen[s] as Set<string>;
        for (const nr of desEintrags.get(entry) ?? []) {
            for (const ziel of (zeilen[nr] as Ortszeile).ziele.map(zielVon)) {
                if (ziel === undefined) continue;
                const hier =
                    "region" in ziel
                        ? regionenHier.has(ziel.region)
                            ? name(ziel.region)
                            : ""
                        : gebieteHier.has(ziel.gebiet)
                          ? gebietsname(ziel.gebiet)
                          : "";
                if (hier !== "") return hier;
            }
        }
        for (const id of (treffer[s] as GruppenTreffer).flaechen.get(entry) ?? []) {
            if (name(id) !== "") return name(id);
        }
        const lage = lagen[s] as Lage;
        for (const id of deepestOf(index, lage.gebiete)) {
            if (gebietsname(id) !== "") return gebietsname(id);
        }
        // Freies Wasser oder eine Etappe ohne Gebiet: die erste benannte Landschaft, die sie berührt.
        return lage.regionen.map(name).find((value) => value !== "") ?? "";
    };

    interface Fund {
        entry: Placed;
        etappen: number[];
        strecke: number;
    }
    const funde = new Map<string, Fund>();
    streckeDer.forEach((s, at) => {
        for (const entry of eintraegeDer[s] as Placed[]) {
            let fund = funde.get(entry.id);
            if (fund === undefined) {
                fund = { entry, etappen: [], strecke: s };
                funde.set(entry.id, fund);
            }
            fund.etappen.push(at);
        }
    });
    const ordnung = (kind: string): number => LORE_ROWS.indexOf(kind as (typeof LORE_ROWS)[number]);
    return [...funde.values()]
        .sort(
            (left, right) =>
                ordnung(left.entry.kind) - ordnung(right.entry.kind) ||
                left.entry.name.localeCompare(right.entry.name, "de"),
        )
        .map((fund) => {
            const hier = gegend(fund.entry.id, fund.strecke);
            return {
                id: fund.entry.publicId,
                name: fund.entry.name,
                kind: fund.entry.kind,
                etappen: fund.etappen,
                ...(hier === "" ? {} : { gegend: hier }),
            };
        });
}
