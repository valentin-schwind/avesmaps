import { Value } from "@sinclair/typebox/value";
import {
    GEBIRGS_MODELL_SPALTE,
    GEBIRGS_MODELL_WERTE,
    GEBIRGS_PRESETS_VORGABE,
    GEBIRGS_WERTE,
    GebirgsAenderung,
    linieMitHoehen,
    type EditConflictDetails,
    type EditorGebirge,
    type GebirgsKammAenderung,
    type GebirgsModellWert,
    type GebirgsNetzAenderung,
    type GebirgsNetzStand,
    type GebirgsWert,
    type GebirgsZurueckAlle,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { resolveTerrainRecipe } from "./auswahl.ts";
import { leseGebirgsZusatz } from "./gebirge-zusatz.ts";
import { flussHoehenAufStuetzpunkten } from "./fluss-hoehen.ts";
import { grundhoeheFor, loadMountainJobs } from "./inputs.ts";

// Der Lesehelfer liegt ohne Fastify in `gebirge-zusatz.ts`, damit der Lader des Geländes (`inputs.ts`) ihn nehmen kann (WI-0247).
export { leseGebirgsZusatz, type GebirgsZusatz } from "./gebirge-zusatz.ts";

/**
 * Lesen und Schreiben des Gebirge-Editors (WI-0226; Vertrag `packages/shared/src/gebirge/vertrag.ts`). Die Oberfläche (Reiter „Gebirge“)
 * baut die Landschaft (WI-0178); sie ruft `gebirgSchreiben` in ihrem `landscape.update`, damit Felder, Gebirge und Gipfel EINE Operation
 * sind. Alles hängt an der Teilfläche (`region_area.public_id`) und ihrer Zeile in `terrain_control`.
 *
 * Seit WI-0245 (Datenmodell C, Migration 0212) gehören dazu das gezeichnete Netz (`terrain_ridge_edge`, `terrain_ridge_point`), die drei
 * Werte des Rückennetzes (`grat`, `grat_breite`, `talboden`) und die Revision der Gebirgswerte. Das Netz wird nur als Ganzes ersetzt und
 * steht vorher und nachher im Protokoll (`area.gebirge`, Feld `netz`); ↺ im Verlauf schreibt das alte Netz zurück.
 */

/** Die Presets, die der Editor zeigt: die Gruppe der gültigen Fassung, sonst die Vorgabe aus dem Code (wirkt erst mit der Fassung). */
export async function gebirgsPresets(database: Queryable, domain: string): Promise<EditorGebirge["presets"]> {
    const recipe = await resolveTerrainRecipe(database, domain);
    return recipe.gebirgsPresets
        ? { quelle: "fassung", fassung: recipe.version, gruppe: recipe.gebirgsPresets }
        : { quelle: "vorgabe", fassung: recipe.version, gruppe: GEBIRGS_PRESETS_VORGABE };
}

/** Alles für den Reiter und die Vorschau eines Gebirges; `undefined`, wenn die Teilfläche kein aktives Gebirge ist. */
export async function readEditorGebirge(database: Queryable, area: string): Promise<EditorGebirge | undefined> {
    const [ziel] = await database<{ id: string; domain: string }[]>`
        SELECT a.id::text AS id, a.map_domain_id AS domain
          FROM region_area a JOIN region r ON r.id = a.region_id AND r.is_active
         WHERE a.public_id = ${area}::uuid AND a.is_active AND r.region_layer = 'topographie' AND r.region_type = 'gebirge'
    `;
    if (!ziel) return undefined;
    const [job] = await loadMountainJobs(database, ziel.domain, [area], { auchOhneWerte: true });
    if (!job || job.areaPublicId !== area) return undefined;
    const { regler: _regler, ...eingabe } = job.input;
    void _regler;
    const zusatz = (await leseGebirgsZusatz(database, [ziel.id])).get(ziel.id)!;
    // Die gewürfelte Saat (Migration 0214); leer: abgeleitet, wie `eingabe.saat` sie zeigt.
    const [gespeichert] = await database<{ saat: number | null }[]>`
        SELECT (to_jsonb(c) ->> 'saat')::int AS saat FROM terrain_control c WHERE area_id = ${ziel.id}::bigint AND is_active
    `;
    return {
        area,
        eingabe,
        stand: { ...job.stand, ...zusatz, saat: gespeichert?.saat ?? null },
        grundhoehe: grundhoeheFor(job.flaeche),
        presets: await gebirgsPresets(database, ziel.domain),
    };
}

/** Die Spalten von `terrain_control`, die der Editor schreibt; `maximalhoehe` ist die Kammhöhe. */
type ModellSpalte = (typeof GEBIRGS_MODELL_SPALTE)[GebirgsModellWert];
type Spalte = GebirgsWert | ModellSpalte | "gebirgstyp" | "muster" | "maximalhoehe" | "saat";
type Zeile = Record<Spalte, string | number | null>;
const SPALTEN: readonly Spalte[] = [
    "gebirgstyp",
    "muster",
    "maximalhoehe",
    ...GEBIRGS_WERTE,
    ...GEBIRGS_MODELL_WERTE.map((wert) => GEBIRGS_MODELL_SPALTE[wert]),
    "saat",
];
const istModellWert = (name: string): name is GebirgsModellWert =>
    (GEBIRGS_MODELL_WERTE as readonly string[]).includes(name);
/** Die Spalte zu einem Namen aus `zurueck`. */
const spalteVon = (name: GebirgsZurueckAlle): Spalte =>
    name === "typ"
        ? "gebirgstyp"
        : name === "kammhoehe"
          ? "maximalhoehe"
          : istModellWert(name)
            ? GEBIRGS_MODELL_SPALTE[name]
            : name;

/**
 * Die Punkthöhen einer geschriebenen Linie (WI-0249 P9): die Paare `[Stelle, Höhe]` an ihren Stellen, die übrigen `null`; die Höhe je Linie
 * eines Clients vor 0219 (`h`) füllt die Stellen ohne Paar. Eine Stelle hinter dem letzten Punkt ist 400.
 */
function hoehenVon(kamm: GebirgsKammAenderung, nr: number): (number | null)[] | null {
    if (kamm.hoehen === undefined && kamm.h === undefined) return null;
    const hoehen: (number | null)[] = kamm.punkte.map(() => kamm.h ?? null);
    for (const [stelle, h] of kamm.hoehen ?? []) {
        if (stelle >= kamm.punkte.length)
            throw new ApiError(
                400,
                "invalid_gebirge",
                `Ungültige Änderung am Gebirge: /netz/kaemme/${String(nr)}/hoehen nennt Punkt ${String(stelle)}, die Linie hat ${String(kamm.punkte.length)}`,
            );
        hoehen[stelle] = h;
    }
    return hoehen;
}

/** Das Netz, wie es gelesen wird: Kämme vor Tälern, Punkthöhen parallel zu den Punkten; `h` fehlt beim Schreiben für „Vorgabe“ und steht beim Lesen als `null`. */
const netzStand = (netz: GebirgsNetzAenderung): GebirgsNetzStand => ({
    kaemme: [
        ...netz.kaemme.map((kamm, nr) => ({ kamm, nr })).filter(({ kamm }) => kamm.rang !== "tal"),
        ...netz.kaemme.map((kamm, nr) => ({ kamm, nr })).filter(({ kamm }) => kamm.rang === "tal"),
    ].map(({ kamm, nr }) =>
        linieMitHoehen(
            kamm.punkte.map(([x, y]) => [x, y] as [number, number]),
            kamm.rang,
            hoehenVon(kamm, nr),
        ),
    ),
    nebengipfel: netz.nebengipfel.map((punkt) => ({ x: punkt.x, y: punkt.y, h: punkt.h ?? null })),
    ...((netz.mulden?.length ?? 0) === 0
        ? {}
        : { mulden: netz.mulden!.map((punkt) => ({ x: punkt.x, y: punkt.y, h: punkt.h ?? null })) }),
    // Eigene Höhen an Flüssen und Seen (WI-0249, 0230): nur mit Einträgen, in der Folge der Lesung (`gebirge-zusatz.ts`).
    ...((netz.flussHoehen?.length ?? 0) === 0
        ? {}
        : { flussHoehen: netz.flussHoehen!.map(({ x, y, h }) => ({ x, y, h })) }),
    ...((netz.seeHoehen?.length ?? 0) === 0 ? {} : { seeHoehen: netz.seeHoehen!.map(({ x, y, h }) => ({ x, y, h })) }),
});

const linieWkt = (punkte: readonly (readonly [number, number])[]): string =>
    `LINESTRING(${punkte.map(([x, y]) => `${String(x)} ${String(y)}`).join(", ")})`;

/**
 * Die Punkthöhen als Feldliteral für `heights_schritt` (`{2300,NULL,2100}`), ohne eigene Höhe `null` (Spalte NULL). Als Text, weil `unnest`
 * ein Feld von Feldern zu einer Liste flacht; die Anweisung wandelt es je Zeile in `int[]`.
 */
const hoehenLiteral = (linie: GebirgsNetzStand["kaemme"][number]): string | null =>
    linie.hoehen === undefined ? null : `{${linie.hoehen.map((h) => (h === null ? "NULL" : String(h))).join(",")}}`;

/** Ersetzt das Netz einer Teilfläche ganz. Ein Kamm ohne Länge und ein Punkt außerhalb der Karte sind 400. */
async function schreibeNetz(tx: Queryable, flaeche: string, domain: string, netz: GebirgsNetzStand): Promise<void> {
    const ohneLaenge = netz.kaemme.findIndex((kamm) =>
        kamm.punkte.every(([x, y]) => x === kamm.punkte[0]![0] && y === kamm.punkte[0]![1]),
    );
    if (ohneLaenge >= 0)
        throw new ApiError(
            400,
            "invalid_gebirge",
            `Ungültige Änderung am Gebirge: /netz/kaemme/${String(ohneLaenge)} hat keine Länge`,
        );
    await tx`DELETE FROM terrain_ridge_edge WHERE area_id = ${flaeche}::bigint`;
    await tx`DELETE FROM terrain_ridge_point WHERE area_id = ${flaeche}::bigint`;
    await tx`DELETE FROM terrain_valley_edge WHERE area_id = ${flaeche}::bigint`;
    await tx`DELETE FROM terrain_hollow_point WHERE area_id = ${flaeche}::bigint`;
    await tx`DELETE FROM terrain_water_height WHERE area_id = ${flaeche}::bigint`;
    const kaemme = netz.kaemme.filter((k) => k.rang !== "tal");
    const taeler = netz.kaemme.filter((k) => k.rang === "tal");
    try {
        // Die Höhe je Linie (`height_schritt`, 0216) schreibt dieses Release nicht mehr (0219): Sie bleibt NULL, die Punkthöhen stehen in
        // `heights_schritt`.
        if (kaemme.length > 0)
            await tx`
                INSERT INTO terrain_ridge_edge (area_id, map_domain_id, ordinal, rang, geom, heights_schritt)
                SELECT ${flaeche}::bigint, ${domain}, k.ordinal - 1, k.rang, ST_GeomFromText(k.wkt, 0), k.hoehen::int[]
                  FROM unnest(${kaemme.map((kamm) => kamm.rang)}::text[], ${kaemme.map((kamm) => linieWkt(kamm.punkte))}::text[], ${kaemme.map(hoehenLiteral)}::text[])
                       WITH ORDINALITY AS k(rang, wkt, hoehen, ordinal)
            `;
        if (taeler.length > 0)
            await tx`
            INSERT INTO terrain_valley_edge (area_id, map_domain_id, ordinal, geom, heights_schritt)
            SELECT ${flaeche}::bigint, ${domain}, k.ordinal - 1, ST_GeomFromText(k.wkt, 0), k.hoehen::int[]
              FROM unnest(${taeler.map((k) => linieWkt(k.punkte))}::text[], ${taeler.map(hoehenLiteral)}::text[]) WITH ORDINALITY AS k(wkt, hoehen, ordinal)
        `;
        if (netz.nebengipfel.length > 0)
            await tx`
            INSERT INTO terrain_ridge_point (area_id, map_domain_id, ordinal, geom, height_schritt)
            SELECT ${flaeche}::bigint, ${domain}, p.ordinal - 1, ST_SetSRID(ST_MakePoint(p.x, p.y), 0), p.h
              FROM unnest(${netz.nebengipfel.map((p) => p.x)}::float8[], ${netz.nebengipfel.map((p) => p.y)}::float8[],
                          ${netz.nebengipfel.map((p) => p.h)}::int[]) WITH ORDINALITY AS p(x, y, h, ordinal)
        `;
        const mulden = netz.mulden ?? [];
        if (mulden.length > 0)
            await tx`
            INSERT INTO terrain_hollow_point (area_id, map_domain_id, ordinal, geom, height_schritt)
            SELECT ${flaeche}::bigint, ${domain}, p.ordinal - 1, ST_SetSRID(ST_MakePoint(p.x, p.y), 0), p.h
              FROM unnest(${mulden.map((p) => p.x)}::float8[], ${mulden.map((p) => p.y)}::float8[],
                          ${mulden.map((p) => p.h)}::int[]) WITH ORDINALITY AS p(x, y, h, ordinal)
        `;
        for (const [art, punkte] of [
            ["fluss", netz.flussHoehen ?? []],
            ["see", netz.seeHoehen ?? []],
        ] as const)
            if (punkte.length > 0)
                await tx`
                INSERT INTO terrain_water_height (area_id, map_domain_id, art, ordinal, geom, height_schritt)
                SELECT ${flaeche}::bigint, ${domain}, ${art}, p.ordinal - 1, ST_SetSRID(ST_MakePoint(p.x, p.y), 0), p.h
                  FROM unnest(${punkte.map((p) => p.x)}::float8[], ${punkte.map((p) => p.y)}::float8[],
                              ${punkte.map((p) => p.h)}::int[]) WITH ORDINALITY AS p(x, y, h, ordinal)
            `;
    } catch (fehler) {
        // Die Tafeln prüfen Lage und Länge (0212): 23514 heißt, ein Punkt liegt außerhalb der Karte.
        if ((fehler as { code?: string }).code === "23514")
            throw new ApiError(
                400,
                "invalid_gebirge",
                "Ungültige Änderung am Gebirge: das Netz liegt nicht ganz auf der Karte",
            );
        throw fehler;
    }
}

/** 409 `edit_conflict` am Gebirge: wer zuletzt `area.gebirge` an dieser Teilfläche schrieb, und wann. */
async function gebirgsKonflikt(tx: Queryable, area: string, revision: number, geaendert: Date): Promise<ApiError> {
    const [letzte] = await tx<{ at: Date; id: string | null; display_name: string | null }[]>`
        SELECT o.at, o.actor_person_id::text AS id, p.display_name
          FROM map_audit_event e
          JOIN map_operation o ON o.operation_id = e.operation_id
          LEFT JOIN avesmaps_auth.person p ON p.id = o.actor_person_id
         WHERE e.region_area_public_id = ${area}::uuid AND e.action = 'area.gebirge'
         ORDER BY e.id DESC
         LIMIT 1
    `;
    const details: EditConflictDetails = {
        currentRevision: revision,
        changedAt: (letzte?.at ?? geaendert).toISOString(),
    };
    if (letzte?.id != null && letzte.display_name != null)
        details.changedBy = { id: letzte.id, displayName: letzte.display_name };
    return new ApiError(
        409,
        "edit_conflict",
        "Jemand hat das Gebirge gerade geändert. Neu laden zeigt den aktuellen Stand.",
        details,
    );
}

/** Eine Änderung für den Verlauf: eine Spalte mit ihrem Wert, oder das Netz als Ganzes. */
export type GebirgsSpaltenAenderung =
    | { feld: Spalte; alt: string | number | null; neu: string | number | null }
    | { feld: "netz"; alt: GebirgsNetzStand; neu: GebirgsNetzStand };

export interface GebirgsSchreibung {
    /** Für die Rechnung im Umkreis (WI-0223) mit der neuen Revision der Gebirgswerte; leer, wenn sich nichts geändert hat. */
    affected: { kind: "terrain_control"; id: string; revision: number }[];
    /** Was sich geändert hat, je Spalte alt und neu und das Netz als Ganzes, für den Verlauf der Operation. */
    aenderungen: GebirgsSpaltenAenderung[];
}

/**
 * Schreibt eine Änderung am Gebirge in `terrain_control` (innerhalb der Transaktion des Aufrufers). Nur die genannten Felder; was in
 * `zurueck` steht, geht zurück auf die Vorgabe (leer). Fehlt die Zeile (ein neues Gebirge: die Landschaft verwirft beim Artwechsel die alten Werte, T50),
 * legt sie die Änderung an; eine stillgelegte belebt sie mit der Änderung allein wieder. Prüft die Werte gegen den Vertrag (400) und dass die Teilfläche ein aktives Gebirge ist (404/400).
 * Ein Netz ersetzt das alte ganz; ein gleiches Netz ist keine Änderung. Flusshöhen ohne Stützpunkt eines aktiven Flusswegs speichert es nicht
 * (WI-0259: der Wegeditor führt die Höhe mit dem Stützpunkt nach; was verwaist ist, räumt das nächste „Fertig“ ab); Seehöhen bleiben. Mit `baseRevision` ist eine andere Revision der Gebirgswerte 409;
 * jede Änderung, auch die am Netz allein, zählt sie hoch.
 */
export async function gebirgSchreiben(tx: Queryable, area: string, aenderung: unknown): Promise<GebirgsSchreibung> {
    if (!Value.Check(GebirgsAenderung, aenderung)) {
        const fehler = [...Value.Errors(GebirgsAenderung, aenderung)][0];
        throw new ApiError(
            400,
            "invalid_gebirge",
            `Ungültige Änderung am Gebirge: ${fehler?.path ?? ""} ${fehler?.message ?? ""}`.trim(),
        );
    }
    // Was gesetzt wird, je Spalte; was in `zurueck` steht, wird leer. Beides für dasselbe Feld ist ein Widerspruch.
    const gesetzt: Partial<Record<Spalte, string | number | undefined>> = {
        gebirgstyp: aenderung.typ,
        muster: aenderung.muster,
        maximalhoehe: aenderung.kammhoehe,
        ...aenderung.werte,
        saat: aenderung.saat,
    };
    for (const wert of GEBIRGS_MODELL_WERTE) gesetzt[GEBIRGS_MODELL_SPALTE[wert]] = aenderung.modell?.[wert];
    const zurueck = aenderung.zurueck ?? [];
    const beides = zurueck.filter((name) => gesetzt[spalteVon(name)] !== undefined);
    if (beides.length > 0) {
        throw new ApiError(
            400,
            "invalid_gebirge",
            `Ungültige Änderung am Gebirge: ${beides.join(", ")} zugleich gesetzt und zurückgenommen`,
        );
    }
    const [ziel] = await tx<{ id: string; domain: string; gebirge: boolean }[]>`
        SELECT a.id::text, a.map_domain_id AS domain,
               (r.region_layer = 'topographie' AND r.region_type = 'gebirge') AS gebirge
          FROM region_area a JOIN region r ON r.id = a.region_id AND r.is_active
         WHERE a.public_id = ${area}::uuid AND a.is_active
    `;
    if (!ziel) throw new ApiError(404, "not_found", "Diese Fläche gibt es nicht.");
    if (!ziel.gebirge) throw new ApiError(400, "kein_gebirge", "Diese Fläche ist kein Gebirge.");

    // Eine stillgelegte Zeile zählt als „keine Werte“; die Tafel erlaubt je Teilfläche nur eine Zeile (`terrain_control_area_unique`).
    const [zeile] = await tx<(Zeile & { id: string; is_active: boolean; revision: string; updated_at: Date })[]>`
        SELECT id::text, is_active, revision::text, updated_at, gebirgstyp, muster, maximalhoehe, hypsometrie, plateau, rauschen,
               einschnitt, erosion, talbreite, koernung, stufen, bergform, sattel, grat, grat_breite, talboden, erosionsfestigkeit, saat
          FROM terrain_control WHERE area_id = ${ziel.id}::bigint
           FOR UPDATE
    `;
    const vorher = zeile?.is_active ? zeile : undefined;
    if (aenderung.baseRevision !== undefined && aenderung.baseRevision !== (vorher ? Number(vorher.revision) : 0))
        throw await gebirgsKonflikt(tx, area, vorher ? Number(vorher.revision) : 0, zeile?.updated_at ?? new Date());
    const alt: Zeile = Object.fromEntries(SPALTEN.map((s) => [s, vorher?.[s] ?? null])) as Zeile;
    const neu: Zeile = { ...alt };
    for (const name of zurueck) neu[spalteVon(name)] = null;
    for (const s of SPALTEN) {
        const wert = gesetzt[s];
        if (wert !== undefined) neu[s] = wert;
    }
    const aenderungen: GebirgsSpaltenAenderung[] = SPALTEN.filter((s) => neu[s] !== alt[s]).map((feld) => ({
        feld,
        alt: alt[feld],
        neu: neu[feld],
    }));
    if (aenderung.netz !== undefined) {
        const netzAlt = (await leseGebirgsZusatz(tx, [ziel.id])).get(ziel.id)!.netz;
        const netzNeu = netzStand(aenderung.netz);
        // Alte Clients kennen die Höhen an Flüssen und Seen nicht (WI-0249, 0230): Ohne das Feld bleiben die gespeicherten.
        if (aenderung.netz.flussHoehen === undefined && netzAlt.flussHoehen !== undefined)
            netzNeu.flussHoehen = netzAlt.flussHoehen;
        if (aenderung.netz.seeHoehen === undefined && netzAlt.seeHoehen !== undefined)
            netzNeu.seeHoehen = netzAlt.seeHoehen;
        // Alte Clients kennen Mulden nicht; nur eine ausdrücklich gesendete Liste ersetzt sie.
        if (aenderung.netz.mulden === undefined) {
            if (netzAlt.mulden !== undefined) netzNeu.mulden = netzAlt.mulden;
            if (!aenderung.netz.kaemme.some((k) => k.rang === "tal")) {
                netzNeu.kaemme = [...netzNeu.kaemme, ...netzAlt.kaemme.filter((k) => k.rang === "tal")];
            }
        }
        // Flusshöhen, die auf keinem Stützpunkt eines aktiven Flusswegs liegen (der Fluss ist verlegt oder gelöscht worden, WI-0259 „Höhe wandert
        // mit“), speichert das Netz nicht: Das räumt verwaiste Einträge beim nächsten „Fertig“ auf. Seehöhen bleiben, wie sie sind.
        if (netzNeu.flussHoehen !== undefined) {
            const behalten = await flussHoehenAufStuetzpunkten(tx, ziel.domain, netzNeu.flussHoehen);
            if (behalten.length === 0) delete netzNeu.flussHoehen;
            else if (behalten.length < netzNeu.flussHoehen.length) netzNeu.flussHoehen = behalten;
        }
        if (JSON.stringify(netzNeu) !== JSON.stringify(netzAlt)) {
            await schreibeNetz(tx, ziel.id, ziel.domain, netzNeu);
            aenderungen.push({ feld: "netz", alt: netzAlt, neu: netzNeu });
        }
    }
    if (aenderungen.length === 0) return { affected: [], aenderungen };

    // Auch ein Netz allein schreibt die Zeile: Der Trigger zählt dabei die Revision (0212).
    const [geschrieben] = zeile
        ? await tx<{ revision: string }[]>`
            UPDATE terrain_control
               SET gebirgstyp = ${neu.gebirgstyp}, muster = ${neu.muster}, maximalhoehe = ${neu.maximalhoehe},
                   hypsometrie = ${neu.hypsometrie}, plateau = ${neu.plateau}, rauschen = ${neu.rauschen},
                   einschnitt = ${neu.einschnitt}, erosion = ${neu.erosion}, talbreite = ${neu.talbreite},
                   koernung = ${neu.koernung}, stufen = ${neu.stufen}, bergform = ${neu.bergform}, sattel = ${neu.sattel},
                   grat = ${neu.grat}, grat_breite = ${neu.grat_breite}, talboden = ${neu.talboden},
                   erosionsfestigkeit = ${neu.erosionsfestigkeit}, saat = ${neu.saat},
                   is_active = TRUE, updated_at = now()
             WHERE id = ${zeile.id}::bigint
            RETURNING revision::text
        `
        : await tx<{ revision: string }[]>`
            INSERT INTO terrain_control (area_id, map_domain_id, source_system, gebirgstyp, muster, maximalhoehe, hypsometrie, plateau,
                                         rauschen, einschnitt, erosion, talbreite, koernung, stufen, bergform, sattel, grat, grat_breite,
                                         talboden, erosionsfestigkeit, saat)
            VALUES (${ziel.id}::bigint, ${ziel.domain}, 'avesmaps3d', ${neu.gebirgstyp}, ${neu.muster}, ${neu.maximalhoehe},
                    ${neu.hypsometrie}, ${neu.plateau}, ${neu.rauschen}, ${neu.einschnitt}, ${neu.erosion}, ${neu.talbreite},
                    ${neu.koernung}, ${neu.stufen}, ${neu.bergform}, ${neu.sattel}, ${neu.grat}, ${neu.grat_breite}, ${neu.talboden},
                    ${neu.erosionsfestigkeit}, ${neu.saat})
            RETURNING revision::text
        `;
    return {
        affected: [{ kind: "terrain_control", id: area, revision: Number(geschrieben!.revision) }],
        aenderungen,
    };
}
