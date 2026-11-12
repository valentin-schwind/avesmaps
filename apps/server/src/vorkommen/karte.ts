import { createHash } from "node:crypto";
import type {
    VorkommenForm,
    VorkommenLandschaft,
    VorkommenOptionen,
    VorkommenRahmen,
    VorkommenRegelTreffer,
    VorkommenSiedlung,
    VorkommenTreffer,
    VorkommenZusatzRahmen,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { halbebeneAlsWkt, halbebeneVon, zwischenHalbebenen } from "./halbebene.ts";
import { baueRegelAbfrage, REPARIERT, type ZusatzRahmenSql } from "./regel-sql.ts";
import { ermittleKartenstand, ladeRegeln, type Regel } from "./regeln.ts";
import { Zwischenspeicher } from "./speicher.ts";

/**
 * Richtung A der Auswertung (WI-0257, S1): Eintrag → Karte. Welche Landschaften und Siedlungen trifft ein Eintrag über seine Regeln? Für die Suche und das Leuchten.
 *
 * - **Je Regel** die Landschaften, die ihre Geometrie berühren: `ganz` (nur die Kennung; die Karte lässt sie über den Kachelfilter leuchten) oder `angeschnitten` (der Teil in der Geometrie als Form,
 *   vereinfacht, GeoJSON mit einer Nachkommastelle). Eine Landschaft ist die Fläche einer Region; hat sie mehrere Flächen und liegt nur ein Teil in der Geometrie, ist sie angeschnitten und die Form
 *   fasst die Teile zusammen. Dazu die Siedlungen in der Geometrie und der gemeinsame Rahmen für den Flug. Die Geometrie wird NIE als Ganzes gebaut (`regel-sql.ts`).
 * - **Ein zusätzlicher Rahmen** („Wirselkraut in Bornland“) schneidet jede Regel noch einmal zu.
 * - **Zwischenspeicher:** je Eintrag über die Fingerabdrücke seiner aktiven Regeln, den Kartenstand, den Rahmen und die Genauigkeit. Das Prüfen des Zwischenspeichers kostet zwei kleine Abfragen.
 *   Mehrere gleichzeitige Fragen nach demselben Eintrag rechnen einmal.
 * - Regeln mit einer wartenden Fläche rechnet niemand (`ladeRegeln` lässt sie weg); ein Eintrag ohne rechenbare Regel hat `regeln: []`.
 */

const DOMAENE = "aventuria";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const ZIFFERN = /^[0-9]{1,18}$/u;

/** Bis zu 100 Einträge oder 64 MB; eine Antwort mit allen 2.902 Wäldern wiegt wenige Hundert Kilobyte. */
const speicher = new Zwischenspeicher<VorkommenTreffer>(100, 64 * 1024 * 1024);
const unterwegs = new Map<string, Promise<VorkommenTreffer | undefined>>();

/** Leert den Zwischenspeicher (für Tests und für einen Betrieb, der nach einem Eingriff an der Datenbank neu rechnen will). */
export function leereVorkommenSpeicher(): void {
    speicher.leere();
    unterwegs.clear();
}

interface EintragZeile {
    id: string;
    public_id: string;
    keys: string[];
}

/** Der Eintrag (aktiv) samt den Fingerabdrücken seiner aktiven Regeln; `eintragId` ist die Kennung der Schnittstelle (`public_id`) oder `lore_entry.id`. */
async function findeEintrag(database: Queryable, eintragId: string): Promise<EintragZeile | undefined> {
    if (UUID.test(eintragId)) {
        const [zeile] = await database<EintragZeile[]>`
            SELECT e.id::text AS id, e.public_id::text AS public_id,
                   coalesce(array_agg(r.rule_key ORDER BY r.rule_key) FILTER (WHERE r.id IS NOT NULL), '{}') AS keys
              FROM lore_entry e LEFT JOIN lore_rule r ON r.lore_entry_id = e.id AND r.is_active AND r.state = 'active'
             WHERE e.public_id = ${eintragId}::uuid AND e.is_active AND e.state = 'active'
             GROUP BY e.id
        `;
        return zeile;
    }
    if (!ZIFFERN.test(eintragId)) return undefined;
    const [zeile] = await database<EintragZeile[]>`
        SELECT e.id::text AS id, e.public_id::text AS public_id,
               coalesce(array_agg(r.rule_key ORDER BY r.rule_key) FILTER (WHERE r.id IS NOT NULL), '{}') AS keys
          FROM lore_entry e LEFT JOIN lore_rule r ON r.lore_entry_id = e.id AND r.is_active AND r.state = 'active'
         WHERE e.id = ${eintragId}::bigint AND e.is_active AND e.state = 'active'
         GROUP BY e.id
    `;
    return zeile;
}

/**
 * Die Maske des zusätzlichen Rahmens: die Flächen der Landschaften, die feinste Form des Gebiets, die Halbebene einer Lage und der Streifen zwischen zwei Orten
 * (`zwischenHalbebenen`, WI-0253 §27 B); nennt der Rahmen mehrere Teile, gilt ihr Schnitt. `undefined`, wo er nichts einschränkt.
 */
export function zusatzMaske(rahmen: VorkommenZusatzRahmen | undefined): ZusatzRahmenSql | undefined {
    if (rahmen === undefined) return undefined;
    // Eine leere Liste ist kein Rahmen (wer nichts nennt, schränkt nicht ein).
    const regionIds =
        rahmen.regionIds === undefined || rahmen.regionIds.length === 0 ? undefined : [...rahmen.regionIds];
    const gebiet = rahmen.territoryId;
    const lage = rahmen.lage;
    const zwischen = rahmen.zwischen;
    if (regionIds === undefined && gebiet === undefined && lage === undefined && zwischen === undefined)
        return undefined;
    const teile: ((param: (wert: unknown, typ: string) => string) => string)[] = [];
    if (regionIds !== undefined) {
        teile.push(
            (param) => `SELECT ST_UnaryUnion(ST_Collect(${REPARIERT("a.geom")})) AS g
                         FROM region_area a JOIN region r ON r.id = a.region_id AND r.is_active AND NOT r.is_hidden
                        WHERE a.is_active AND (r.public_id::text = ANY(${param(regionIds, "text[]")}) OR r.id::text = ANY(${param(regionIds, "text[]")}))`,
        );
    }
    if (gebiet !== undefined) {
        teile.push(
            (param) => `SELECT ST_UnaryUnion(ST_Collect(ST_MakeValid(s.geom))) AS g
                         FROM territory_shape s
                        WHERE s.territory_id = ${param(gebiet, "bigint")} AND s.band = (SELECT max(b.band) FROM territory_shape b WHERE b.territory_id = ${param(gebiet, "bigint")})`,
        );
    }
    if (lage !== undefined) {
        // Eine Lage, die nichts trennt, trifft nichts (wie die Lage einer Regel): die Maske ist leer.
        const halbebene = halbebeneVon(lage.richtung, [lage.ort]);
        teile.push((param) =>
            halbebene === null
                ? "SELECT NULL::geometry AS g"
                : `SELECT ST_GeomFromText(${param(halbebeneAlsWkt(halbebene), "text")}, 0) AS g`,
        );
    }
    if (zwischen !== undefined) {
        // „Zwischen A und B“ sind zwei Bedingungen mit UND (WI-0253 §27 B): der Streifen zwischen den beiden Linien. Fällt eine Halbebene weg, trifft der Rahmen nichts.
        const streifen = zwischenHalbebenen(zwischen.a, zwischen.b);
        for (const halbebene of streifen ?? [null]) {
            teile.push((param) =>
                halbebene === null
                    ? "SELECT NULL::geometry AS g"
                    : `SELECT ST_GeomFromText(${param(halbebeneAlsWkt(halbebene), "text")}, 0) AS g`,
            );
        }
    }
    return {
        sql: (param) => {
            const sqls = teile.map((teil) => teil(param));
            if (sqls.length === 1) return sqls[0] as string;
            const schnitt = sqls
                .map((_, i) => `t${String(i)}.g`)
                .reduce((links, rechts) => `ST_Intersection(${links}, ${rechts})`);
            return `SELECT ST_CollectionExtract(${schnitt}, 3) AS g FROM ${sqls.map((sql, i) => `(${sql}) t${String(i)}`).join(" CROSS JOIN ")}`;
        },
    };
}

/**
 * Die Maske des Rahmens als eigene Abfrage (eine Zeile, Spalte `g`) samt ihren Parametern, für Abfragen außerhalb der Regelrechnung (die Ziele einer Ortszeile). `ersterParameter`
 * ist die erste freie Parameternummer. `undefined`, wo der Rahmen nichts einschränkt.
 */
export function maskeAlsAbfrage(
    rahmen: VorkommenZusatzRahmen | undefined,
    ersterParameter = 1,
): { sql: string; params: unknown[] } | undefined {
    const maske = zusatzMaske(rahmen);
    if (maske === undefined) return undefined;
    const params: unknown[] = [];
    const sql = maske.sql((wert, typ) => {
        params.push(wert);
        return `$${String(ersterParameter + params.length - 1)}::${typ}`;
    });
    return { sql, params };
}

interface AbfrageZeile {
    art: "L" | "R" | "S";
    rid: string | null;
    pid: string | null;
    name: string | null;
    st: string | null;
    ganz: boolean | null;
    x0: number | null;
    y0: number | null;
    x1: number | null;
    y1: number | null;
    form: string | null;
    plid: string | null;
    ppid: string | null;
    pname: string | null;
    psub: string | null;
    px: number | null;
    py: number | null;
}

const vereinige = (a: VorkommenRahmen | null, b: VorkommenRahmen | null): VorkommenRahmen | null =>
    a === null
        ? b
        : b === null
          ? a
          : { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };

const rahmenAus = (z: AbfrageZeile): VorkommenRahmen | null =>
    z.x0 === null || z.y0 === null || z.x1 === null || z.y1 === null
        ? null
        : { x0: z.x0, y0: z.y0, x1: z.x1, y1: z.y1 };

/** Die Polygone einer GeoJSON-Form (leere Formen nach der Vereinfachung ergeben keine). */
function polygoneVon(text: string | null): unknown[] {
    if (text === null) return [];
    const geo = JSON.parse(text) as { type: string; coordinates: unknown[] };
    if (geo.type === "Polygon") return geo.coordinates.length === 0 ? [] : [geo.coordinates];
    if (geo.type === "MultiPolygon") return geo.coordinates;
    return [];
}

function formAus(polygone: unknown[]): VorkommenForm | undefined {
    if (polygone.length === 0) return undefined;
    if (polygone.length === 1) return { type: "Polygon", coordinates: polygone[0] as unknown[] };
    return { type: "MultiPolygon", coordinates: polygone };
}

/** Aus den Zeilen der Abfrage das Ergebnis einer Regel. */
function ergebnisDerRegel(regel: Regel, zeilen: readonly AbfrageZeile[]): VorkommenRegelTreffer {
    const nachRegion = new Map<string, AbfrageZeile[]>();
    const siedlungen: VorkommenSiedlung[] = [];
    let restPolygone: unknown[] = [];
    let restRahmen: VorkommenRahmen | null = null;
    for (const zeile of zeilen) {
        if (zeile.art === "S") {
            siedlungen.push({
                placeId: zeile.plid as string,
                publicId: zeile.ppid as string,
                name: zeile.pname as string,
                art: zeile.psub as string,
                x: zeile.px as number,
                y: zeile.py as number,
            });
        } else if (zeile.art === "R") {
            restPolygone = [...restPolygone, ...polygoneVon(zeile.form)];
            restRahmen = vereinige(restRahmen, rahmenAus(zeile));
        } else {
            const liste = nachRegion.get(zeile.rid as string);
            if (liste === undefined) nachRegion.set(zeile.rid as string, [zeile]);
            else liste.push(zeile);
        }
    }
    const landschaften: VorkommenLandschaft[] = [];
    let rahmen: VorkommenRahmen | null = null;
    for (const [regionId, flaechen] of nachRegion) {
        const erste = flaechen[0] as AbfrageZeile;
        let box: VorkommenRahmen | null = null;
        for (const f of flaechen) box = vereinige(box, rahmenAus(f));
        if (box === null) continue;
        if (erste.ganz === true) {
            landschaften.push({
                regionId,
                publicId: erste.pid as string,
                name: erste.name as string,
                schnitt: "ganz",
                rahmen: box,
            });
        } else {
            const form = formAus(flaechen.flatMap((f) => polygoneVon(f.form)));
            // Ein Stück, das die Vereinfachung ganz verschluckt, ist kein sichtbarer Treffer.
            if (form === undefined) continue;
            landschaften.push({
                regionId,
                publicId: erste.pid as string,
                name: erste.name as string,
                schnitt: "angeschnitten",
                form,
                rahmen: box,
            });
        }
        rahmen = vereinige(rahmen, box);
    }
    landschaften.sort((a, b) => a.name.localeCompare(b.name, "de") || Number(a.regionId) - Number(b.regionId));
    siedlungen.sort((a, b) => a.name.localeCompare(b.name, "de") || Number(a.placeId) - Number(b.placeId));
    const restForm = formAus(restPolygone);
    if (restForm !== undefined && restRahmen !== null) rahmen = vereinige(rahmen, restRahmen);
    return {
        ruleId: regel.ruleId,
        ruleKey: regel.ruleKey,
        beziehung: regel.beziehung,
        landschaften,
        ...(restForm !== undefined && restRahmen !== null ? { rest: { form: restForm, rahmen: restRahmen } } : {}),
        siedlungen,
        rahmen,
        verwaiste: regel.verwaiste,
    };
}

/** Eine Regel rechnen: eine Abfrage. */
export async function rechneRegel(
    database: Queryable,
    regel: Regel,
    optionen: VorkommenOptionen = {},
): Promise<VorkommenRegelTreffer> {
    const abfrage = baueRegelAbfrage(regel, DOMAENE, optionen.nachkommastellen ?? 1, zusatzMaske(optionen.rahmen));
    const zeilen = await database.unsafe<AbfrageZeile[]>(abfrage.text, abfrage.params as never[]);
    return ergebnisDerRegel(regel, zeilen);
}

const rahmenSchluessel = (optionen: VorkommenOptionen): string =>
    JSON.stringify([
        optionen.rahmen?.regionIds === undefined || optionen.rahmen.regionIds.length === 0
            ? null
            : [...optionen.rahmen.regionIds].sort(),
        optionen.rahmen?.territoryId ?? null,
        optionen.rahmen?.lage ?? null,
        optionen.rahmen?.zwischen ?? null,
        optionen.nachkommastellen ?? 1,
    ]);

/**
 * Was ein Eintrag über seine Regeln auf der Karte trifft, oder `undefined`, wo es keinen aktiven Eintrag dieser Kennung gibt. `eintragId` ist die Kennung der Schnittstelle (`lore_entry.public_id`)
 * oder `lore_entry.id`. Mehrere Regeln einer Beziehung gelten als Vereinigung; sie stehen hier einzeln, die Vereinigung bildet, wer sie braucht.
 * 🪤 Die Antwort kommt aus dem Zwischenspeicher und gehört allen Aufrufern: nicht verändern, nur lesen (oder kopieren).
 */
export async function trefferDesEintrags(
    database: Queryable,
    eintragId: string,
    optionen: VorkommenOptionen = {},
): Promise<VorkommenTreffer | undefined> {
    const eintrag = await findeEintrag(database, eintragId);
    if (eintrag === undefined) return undefined;
    const stand = optionen.stand ?? (await ermittleKartenstand(database, DOMAENE));
    const schluessel = `${eintrag.id}|${rahmenSchluessel(optionen)}`;
    const pruefstand = createHash("sha256")
        .update(JSON.stringify([stand, eintrag.keys]))
        .digest("hex")
        .slice(0, 24);
    const gemerkt = speicher.get(schluessel, pruefstand);
    if (gemerkt !== undefined) return gemerkt;
    const laufend = unterwegs.get(`${schluessel}|${pruefstand}`);
    if (laufend !== undefined) return laufend;
    const lauf = (async (): Promise<VorkommenTreffer | undefined> => {
        const regeln = await ladeRegeln(database, eintrag.id);
        const ergebnisse: VorkommenRegelTreffer[] = [];
        for (const regel of regeln) ergebnisse.push(await rechneRegel(database, regel, optionen));
        let rahmen: VorkommenRahmen | null = null;
        for (const e of ergebnisse) rahmen = vereinige(rahmen, e.rahmen);
        const treffer: VorkommenTreffer = { id: eintrag.id, eintragId: eintrag.public_id, regeln: ergebnisse, rahmen };
        speicher.set(schluessel, pruefstand, treffer, JSON.stringify(treffer).length);
        return treffer;
    })().finally(() => {
        unterwegs.delete(`${schluessel}|${pruefstand}`);
    });
    unterwegs.set(`${schluessel}|${pruefstand}`, lauf);
    return lauf;
}
