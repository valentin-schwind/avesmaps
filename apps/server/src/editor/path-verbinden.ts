import {
    gleicheLage,
    PATH_MAX_POINTS,
    stuetzpunkteZuordnen,
    type PathVerbindenBody,
    type PathVerbindenGrund,
    type PathVerbindenPruefung,
    type PathVerbindenReceipt,
} from "@avesmaps3d/shared";
import type { Sql } from "../auth/session-store.ts";
import type { Database, Queryable } from "../database.ts";
import { derivePathVisualsFor } from "../derive/path-visual.ts";
import { ApiError } from "../http/api-error.ts";
import { netzOptionen } from "../routing/einstellungen.ts";
import type { RouteNode } from "../routing/network.ts";
import { deriveTopology, TECH_NODE_PREFIX, type Topology, type TopologyPath } from "../routing/topology.ts";
import { wegfindungswerte } from "../system/wegfindungsstand.ts";
import { fuehreFlussHoehenNach, umgekehrtAusProtokoll, wasserHoehenProtokoll } from "../terrain/fluss-hoehen.ts";
import { mapOperation, type MapActor, type MapAuditEntry } from "./map-operation.ts";
import { normalisiere } from "./path-edit.ts";
import { konflikt, pruefeSperren, type TxErgebnis } from "./path-split.ts";

/**
 * „Wege verbinden“ (WI-0252, `path.join`; Vertrag `packages/shared/src/editor-path-sammel.ts`): eine Kette gewählter Abschnitte wird EIN
 * Abschnitt mit einer Linie und den Einstellungen der Vorlage. Die Geometrie-Aktion (die Namens- und Zuweisungsaktion ist
 * `path-neuer-weg.ts`).
 *
 * - **Aneinander hängen** rechnet die Topologie der Wegfindung (`routing/topology.ts`) mit den eingestellten Werten (WI-0153, wie
 *   `endsOf`), nur über die Wege und Orte um die Kette: Zwei Enden hängen aneinander, wenn sie denselben Knoten bekommen (Ort im Kasten,
 *   Ende auf Ende im Fangradius). Eine Kette ist offen, ohne Abzweig unter den gewählten und ohne Lücke.
 * - **Die Linie** entsteht in Kettenfolge; ein Abschnitt, der andersherum läuft, wird umgedreht. An jeder Stoßstelle wird aus den beiden
 *   Enden EIN Stützpunkt auf dem Knoten des Netzes (der Ort, sonst der technische Knoten, `techNodes`). Danach läuft die Linie in der
 *   Richtung der Vorlage (ihre Fließrichtung bleibt richtig), gerundet wie jede Wegkurve (`normalisiere`).
 * - 🔴 **Verlustfrei im Wegenetz:** Dieselbe Topologie vorher und nachher, verglichen je Knoten über die Wege, die ihn berühren (die Kette
 *   als ein Weg): Es darf nur der technische Knoten an einer Stoßstelle wegfallen, an der sonst nichts hängt. Ein Ort an der Stoßstelle
 *   bleibt (der Stützpunkt liegt genau auf ihm und teilt die Linie dort), ein Weg, der dort endet, hängt danach mit einem T-Stoß an ihr;
 *   ein durchgehender Weg verlöre die Verbindung (zwei durchgehende Wege verbinden nie), dann geht es nicht (`netz`).
 * - **Schreiben:** die Vorlage bekommt die Linie gegen ihre Revision, die übrigen werden still gelegt wie „Ganz löschen“ (`is_active`); die
 *   gezeichnete Kurve in derselben Transaktion, die Wegfindung rechnet neu. EINE Operation, nie über eine fremde Sperre.
 * - **↺** nimmt der Server in der Rücknahme der Wege zurück (`ruecknahme-weg.ts`, `schreibeVerbindenZurueckIn`): die Vorlage bekommt ihre Linie zurück, die anderen kommen zurück auf die Karte, jeder gegen seine Revision.
 *   Die Rücknahme davon legt die Abschnitte wieder zu EINEM Weg zusammen (WI-0265 B8a2, `legeTeileZusammenIn` in `path-split.ts`; vorab prüft `pruefeVerbindenWieder`, dass das Verbinden heute noch zu derselben Linie ginge).
 * - **Eigene Höhen an Flüssen** (WI-0259, „Höhe wandert mit“): Alle Stützpunkte außer den Stoßstellen behalten ihre Lage, ihre Höhen bleiben also
 *   wirksam. Ein Stützpunkt an einer Stoßstelle, der auf den Knoten des Netzes rückt, nimmt seine Höhe mit (dieselbe Zuordnung wie die
 *   Wegkurve, `stuetzpunkteZuordnen`, gegen die alten Linien in Kettenfolge); ↺ führt sie aus dem Protokoll (`wasserHoehen`) zurück.
 */

type Punkt = [number, number];

interface Zeile {
    id: string;
    public_id: string;
    map_domain_id: string;
    subtype: string;
    is_active: boolean;
    off_map: boolean;
    revision: number;
    geojson: string;
}

const linieVon = (geojson: string): Punkt[] => (JSON.parse(geojson) as { coordinates: Punkt[] }).coordinates;

async function lies(sql: Queryable, ids: readonly string[], sperren: boolean): Promise<Zeile[]> {
    // FOR NO KEY UPDATE wie `path.update`: Die Operation ändert nie eine Kennung des Wegs.
    return sperren
        ? sql<Zeile[]>`
              SELECT id::text, public_id::text AS public_id, map_domain_id, subtype, is_active, off_map, revision::int AS revision,
                     ST_AsGeoJSON(geom, 15) AS geojson
                FROM path WHERE public_id = ANY(${[...ids]}::uuid[]) ORDER BY public_id FOR NO KEY UPDATE
          `
        : sql<Zeile[]>`
              SELECT id::text, public_id::text AS public_id, map_domain_id, subtype, is_active, off_map, revision::int AS revision,
                     ST_AsGeoJSON(geom, 15) AS geojson
                FROM path WHERE public_id = ANY(${[...ids]}::uuid[]) ORDER BY public_id
          `;
}

/** Land, Wasser oder See: Land und Wasser zu verbinden ergäbe keinen Weg, Seewege sind abgeschaltet. */
const familie = (subtype: string): string =>
    subtype === "Flussweg" ? "wasser" : subtype === "Seeweg" ? "see" : "land";

/** Ein Glied der Kette: der Abschnitt und ob er gegen die Kette läuft. */
export interface Glied {
    readonly publicId: string;
    readonly umgedreht: boolean;
}

export type Verbinden =
    | { readonly geht: true; readonly kette: readonly Glied[]; readonly linie: readonly Punkt[] }
    | { readonly geht: false; readonly grund: PathVerbindenGrund };

/** Die Kennung, unter der die Kette im Vergleich als EIN Weg steht. */
const KETTE = "\u0000kette";

/**
 * Je Knoten, welche Wege ihn berühren: Anfang und Ende je einmal, eine innere Teilung zweimal (zwei Stücke). Ein technischer Knoten steht
 * ohne Schlüssel (er heißt nach dem Ende, das ihn gründet, und das kann wegfallen); ein Ort mit seiner Kennung.
 */
function signaturen(topologie: Topology, abbild: (id: string) => string): string[] {
    const je = new Map<string, string[]>();
    const beruehrt = (knoten: string, wer: string): void => void je.set(knoten, [...(je.get(knoten) ?? []), wer]);
    for (const plan of topologie.plans) {
        const wer = abbild(plan.publicId);
        beruehrt(plan.start, wer);
        beruehrt(plan.end, wer);
        for (const teilung of plan.splits) {
            beruehrt(teilung.nodeId, wer);
            beruehrt(teilung.nodeId, wer);
        }
    }
    return [...je]
        .map(([knoten, wer]) => `${knoten.startsWith(TECH_NODE_PREFIX) ? "tech" : knoten}|${wer.sort().join(",")}`)
        .sort();
}

/**
 * Geht das Verbinden dieser Abschnitte, und wie liegt die Kette? Rein lesend; in der Transaktion des Schreibens mit den dort gesperrten
 * Zeilen gerufen, sonst für die Prüfung des Menüs.
 */
export async function rechneVerbinden(sql: Queryable, zeilen: readonly Zeile[]): Promise<Verbinden> {
    if (zeilen.length < 2) return { geht: false, grund: "anzahl" };
    if (zeilen.some((z) => !z.is_active)) return { geht: false, grund: "karte" };
    const familien = new Set(zeilen.map((z) => familie(z.subtype)));
    if (familien.size > 1 || familien.has("see")) return { geht: false, grund: "art" };
    const linien = new Map(zeilen.map((z) => [z.public_id, linieVon(z.geojson)] as const));
    const { topologie: vorher, knoten, umgebung, werte } = await topologieUm(sql, zeilen[0]!.map_domain_id, linien);

    const ids = zeilen.map((z) => z.public_id);

    // Die Kette: Jeder Abschnitt verbindet zwei Knoten; offen heißt zwei Enden mit einem Abschnitt, alle anderen mit zweien.
    const enden = new Map(
        zeilen.map((z) => {
            const plan = vorher.plans.find((p) => p.publicId === z.public_id)!;
            return [z.public_id, { start: plan.start, end: plan.end }] as const;
        }),
    );
    const an = new Map<string, string[]>();
    for (const [id, { start, end }] of enden) {
        if (start === end) return { geht: false, grund: "kette" };
        an.set(start, [...(an.get(start) ?? []), id]);
        an.set(end, [...(an.get(end) ?? []), id]);
    }
    if ([...an.values()].some((wer) => wer.length > 2)) return { geht: false, grund: "kette" };
    const aussen = [...an].filter(([, wer]) => wer.length === 1).map(([k]) => k);
    if (aussen.length !== 2) return { geht: false, grund: "kette" };
    // Von einem Außenknoten entlang: Jeder Schritt nimmt den Abschnitt, der am Knoten noch nicht genommen ist.
    const kette: Glied[] = [];
    const stoesse: string[] = [];
    let hier = [...aussen].sort()[0]!;
    const genommen = new Set<string>();
    for (;;) {
        const naechster = (an.get(hier) ?? []).find((id) => !genommen.has(id));
        if (naechster === undefined) break;
        genommen.add(naechster);
        const { start, end } = enden.get(naechster)!;
        const umgedreht = end === hier;
        kette.push({ publicId: naechster, umgedreht });
        hier = umgedreht ? start : end;
        if (genommen.size < zeilen.length) stoesse.push(hier);
    }
    if (kette.length !== zeilen.length) return { geht: false, grund: "kette" };

    // Die Linie in Kettenfolge, an jeder Stoßstelle EIN Stützpunkt auf dem Knoten des Netzes.
    const ortVon = new Map(knoten.map((k) => [k.id, [k.x, k.y] as Punkt] as const));
    const technisch = new Map(vorher.techNodes.map((k) => [k.id, [k.x, k.y] as Punkt] as const));
    const punktAn = (knotenId: string): Punkt => ortVon.get(knotenId) ?? technisch.get(knotenId)!;
    const roh: Punkt[] = [];
    kette.forEach((glied, i) => {
        const eigene = linien.get(glied.publicId)!;
        const teil = glied.umgedreht ? [...eigene].reverse() : [...eigene];
        if (i > 0) teil[0] = punktAn(stoesse[i - 1]!);
        if (i < kette.length - 1) teil[teil.length - 1] = punktAn(stoesse[i]!);
        roh.push(...(i === 0 ? teil : teil.slice(1)));
    });
    const linie = normalisiere(roh.map(([x, y]) => ({ x, y }))).map((p) => [p.x, p.y] as Punkt);
    if (linie.length < 2 || linie.length > PATH_MAX_POINTS) return { geht: false, grund: "punkte" };

    // 🔴 Das Netz verliert nichts: je Knoten dieselben Wege, die Kette als einer. Nur ein technischer Knoten an einer Stoßstelle, an dem
    // allein die Kette hängt, fällt weg.
    const nachher = deriveTopology(knoten, [{ publicId: KETTE, coordinates: linie }, ...umgebung], werte);
    const gewaehlt = new Set(ids);
    const alt = signaturen(vorher, (id) => (gewaehlt.has(id) ? KETTE : id));
    const neu = signaturen(nachher, (id) => id);
    const nurKette = `tech|${KETTE},${KETTE}`;
    const ohneStoesse = (liste: readonly string[]): string[] => liste.filter((s) => s !== nurKette);
    const altOhne = ohneStoesse(alt);
    const neuOhne = ohneStoesse(neu);
    if (altOhne.length !== neuOhne.length || altOhne.some((s, i) => s !== neuOhne[i]))
        return { geht: false, grund: "netz" };
    return { geht: true, kette, linie };
}

/** Die Werte der Topologie, wie die Wegfindung sie gerade nimmt (WI-0153). */
type TopologieWerte = Pick<ReturnType<typeof netzOptionen>, "endSnap" | "endpointBox" | "exactHit">;

/**
 * Die Topologie der Wegfindung um einige Linien (WI-0153, wie `endsOf`): mit den eingestellten Werten, nur über die Orte und die übrigen
 * aktiven Wege im Kasten um die Linien. Die Linien gehen in ihrer Folge zuerst ein, danach die Umgebung. Für „Wege verbinden“ und das
 * Flussnetz einer Straße (`path-flussnetz.ts`, OPS-000112).
 */
export async function topologieUm(
    sql: Queryable,
    domaene: string,
    linien: ReadonlyMap<string, readonly Punkt[]>,
): Promise<{ topologie: Topology; knoten: RouteNode[]; umgebung: TopologyPath[]; werte: TopologieWerte }> {
    const { endSnap, endpointBox, exactHit } = netzOptionen(await wegfindungswerte(sql));
    const alle = [...linien.values()].flat();
    const rand = endpointBox + endSnap + 1;
    const [x0, y0, x1, y1] = [
        Math.min(...alle.map((p) => p[0])) - rand,
        Math.min(...alle.map((p) => p[1])) - rand,
        Math.max(...alle.map((p) => p[0])) + rand,
        Math.max(...alle.map((p) => p[1])) + rand,
    ];
    const ids = [...linien.keys()];
    const orte = await sql<{ id: string; name: string; hidden: boolean; x: number; y: number }[]>`
        SELECT public_id::text AS id, name, is_hidden AS hidden, ST_X(geom) AS x, ST_Y(geom) AS y
          FROM place
         WHERE is_active AND map_domain_id = ${domaene} AND geom && ST_MakeEnvelope(${x0}, ${y0}, ${x1}, ${y1}, 0)
         ORDER BY public_id
    `;
    const andere = await sql<{ id: string; geojson: string }[]>`
        SELECT public_id::text AS id, ST_AsGeoJSON(geom, 15) AS geojson
          FROM path
         WHERE is_active AND map_domain_id = ${domaene} AND geom && ST_MakeEnvelope(${x0}, ${y0}, ${x1}, ${y1}, 0)
           AND NOT (public_id = ANY(${ids}::uuid[]))
         ORDER BY public_id
    `;
    const knoten: RouteNode[] = orte.map((o) => ({
        id: o.id,
        name: o.name,
        kind: "place",
        isHidden: o.hidden,
        x: o.x,
        y: o.y,
    }));
    const umgebung: TopologyPath[] = andere.map((w) => ({ publicId: w.id, coordinates: linieVon(w.geojson) }));
    const werte = { endSnap, endpointBox, exactHit };
    const topologie = deriveTopology(
        knoten,
        [...[...linien].map(([publicId, coordinates]) => ({ publicId, coordinates })), ...umgebung],
        werte,
    );
    return { topologie, knoten, umgebung, werte };
}

/** Die Prüfung des Menüs: dieselbe Rechnung, ohne zu schreiben. */
export async function pruefeVerbinden(database: Database, ids: readonly string[]): Promise<PathVerbindenPruefung> {
    const eindeutig = [...new Set(ids)];
    const zeilen = await lies(database, eindeutig, false);
    if (zeilen.length !== eindeutig.length) throw new ApiError(404, "not_found", "Einen der Abschnitte gibt es nicht.");
    if (new Set(zeilen.map((z) => z.map_domain_id)).size > 1)
        throw new ApiError(400, "validation_failed", "Die Abschnitte liegen auf verschiedenen Karten.", {
            field: "ids",
        });
    const ergebnis = await rechneVerbinden(database, zeilen);
    return ergebnis.geht ? { geht: true, kette: [...ergebnis.kette] } : { geht: false, grund: ergebnis.grund };
}

/**
 * Die Vorprüfung der Rücknahme der Rücknahme von „Wege verbinden“ (WI-0265 B8a2): Die Abschnitte werden wieder zu EINEM Weg zusammengelegt (`legeTeileZusammenIn`). Das geht nur, wenn das Verbinden
 * heute noch ginge (dieselbe Rechnung wie die Operation: eine Kette, ohne Lücke, das Netz verliert nichts) UND zu derselben Linie führt, die das Original schrieb (`linie`, die Linie der Vorlage). Hat
 * seither jemand etwas an die Stoßstellen gehängt, das das Verbinden unmöglich macht, oder rückt die Linie anders, ist das ein Konflikt, kein stilles Zusammenlegen.
 */
export async function pruefeVerbindenWieder(
    database: Queryable,
    ids: readonly string[],
    vorlage: string,
    linie: readonly Punkt[],
): Promise<{ readonly geht: true } | { readonly geht: false; readonly grund: PathVerbindenGrund | "fehlt" | "linie" }> {
    const eindeutig = [...new Set(ids)];
    const zeilen = await lies(database, eindeutig, false);
    if (zeilen.length !== eindeutig.length) return { geht: false, grund: "fehlt" };
    const ergebnis = await rechneVerbinden(database, zeilen);
    if (!ergebnis.geht) return { geht: false, grund: ergebnis.grund };
    // In der Richtung der Vorlage, wie das Original sie schrieb.
    const gegen = ergebnis.kette.find((glied) => glied.publicId === vorlage)?.umgedreht ?? false;
    const berechnet = gegen ? [...ergebnis.linie].reverse() : [...ergebnis.linie];
    const gleich =
        berechnet.length === linie.length &&
        berechnet.every((p, i) => Math.abs(p[0] - linie[i]![0]) <= 1e-6 && Math.abs(p[1] - linie[i]![1]) <= 1e-6);
    return gleich ? { geht: true } : { geht: false, grund: "linie" };
}

const linieAlsSql = (tx: Sql, linie: readonly Punkt[]) => tx`
    ST_SetSRID(ST_MakeLine(ARRAY(
        SELECT ST_MakePoint(t.x, t.y)
          FROM unnest(${linie.map((p) => p[0])}::float8[], ${linie.map((p) => p[1])}::float8[]) WITH ORDINALITY AS t(x, y, n)
         ORDER BY t.n)), 0)
`;

/** Jeder Abschnitt einmal, in der Folge seiner Kennung (dieselbe Sperrfolge für jede Auswahl). */
function abschnitteVon(body: PathVerbindenBody): { publicId: string; baseRevision: number }[] {
    const je = new Map(body.sections.map((teil) => [teil.publicId, teil] as const));
    return [...je.values()].sort((a, b) => (a.publicId < b.publicId ? -1 : a.publicId > b.publicId ? 1 : 0));
}

const GRUND_TEXT: Readonly<Record<PathVerbindenGrund, string>> = {
    anzahl: "Verbunden werden mindestens zwei Abschnitte.",
    karte: "Ein Abschnitt ist nicht auf der Karte.",
    art: "Landwege und Flüsse lassen sich nicht verbinden.",
    kette: "Die Abschnitte bilden keine Kette.",
    netz: "An einer Stoßstelle hängt ein durchgehender Weg; verbunden verlöre das Wegenetz die Verbindung.",
    punkte: "Die verbundene Linie hätte zu viele Stützpunkte.",
};

/**
 * Welche Stützpunkte eines Flusses beim Verbinden wandern (WI-0259): Die alten Linien stehen in Kettenfolge, an jeder Stoßstelle laufen
 * die beiden Enden in EINEN Stützpunkt auf dem Knoten des Netzes zusammen. Die Höhe jedes der beiden Enden zieht auf diesen Punkt (liegen
 * beide Enden voneinander entfernt je mit Höhe, gewinnt die erste Zeile; die andere bleibt unwirksam stehen). Alle übrigen Stützpunkte
 * ordnet `stuetzpunkteZuordnen` gegen die neue Linie zu.
 */
export function flussPunkteBeimVerbinden(
    linien: readonly (readonly Punkt[])[],
    neu: readonly Punkt[],
): { von: { x: number; y: number }; nach: { x: number; y: number } }[] {
    const alt: { x: number; y: number }[] = [];
    // Die zweiten Enden einer Stoßstelle, nach dem alten Punkt, der sie in der Zuordnung vertritt.
    const zusatz = new Map<number, { x: number; y: number }[]>();
    linien.forEach((linie, i) => {
        linie.forEach(([x, y], k) => {
            if (i > 0 && k === 0) zusatz.set(alt.length - 1, [...(zusatz.get(alt.length - 1) ?? []), { x, y }]);
            else alt.push({ x, y });
        });
    });
    const punkte = neu.map(([x, y]) => ({ x, y }));
    const zuordnung = stuetzpunkteZuordnen(alt, punkte);
    const ziel = new Map<number, { x: number; y: number }>([
        ...zuordnung.bleibt.map((b) => [b.alt, punkte[b.neu]!] as const),
        ...zuordnung.verschoben.map((v) => [v.alt, v.nach] as const),
    ]);
    const gewandert: { von: { x: number; y: number }; nach: { x: number; y: number } }[] = zuordnung.verschoben.map(
        (v) => ({ von: v.von, nach: v.nach }),
    );
    for (const [i, enden] of zusatz) {
        const nach = ziel.get(i);
        if (nach === undefined) continue;
        for (const von of enden) if (!gleicheLage(von, nach)) gewandert.push({ von, nach });
    }
    return gewandert;
}

export async function verbindeWege(
    database: Database,
    actor: MapActor,
    body: PathVerbindenBody,
): Promise<PathVerbindenReceipt> {
    const abschnitte = abschnitteVon(body);
    const vorlage = body.vorlage;
    if (vorlage === undefined || !abschnitte.some((a) => a.publicId === vorlage))
        throw new ApiError(400, "validation_failed", "Die Vorlage gehört nicht zu den Abschnitten.", {
            field: "vorlage",
        });
    const [vorab] = await database<{ map_domain_id: string }[]>`
        SELECT map_domain_id FROM path WHERE public_id = ${vorlage}::uuid
    `;
    if (vorab === undefined) throw new ApiError(404, "not_found", "Diesen Weg gibt es nicht.");
    const quittung = await mapOperation(
        database,
        actor,
        { operationId: body.operationId, operation: "path.join", mapDomainId: vorab.map_domain_id, body },
        async (tx) => {
            const zeilen = await lies(
                tx,
                abschnitte.map((a) => a.publicId),
                true,
            );
            if (zeilen.length !== abschnitte.length) throw new ApiError(404, "not_found", "Diesen Weg gibt es nicht.");
            if (new Set(zeilen.map((z) => z.map_domain_id)).size > 1)
                throw new ApiError(400, "validation_failed", "Die Abschnitte liegen auf verschiedenen Karten.", {
                    field: "sections",
                });
            const basis = new Map(abschnitte.map((a) => [a.publicId, a.baseRevision] as const));
            const anders = zeilen.find((z) => basis.get(z.public_id) !== z.revision);
            if (anders !== undefined) throw await konflikt(tx, anders.public_id);
            await pruefeSperren(
                tx,
                actor,
                zeilen.map((z) => z.public_id),
            );
            const ergebnis = await rechneVerbinden(tx, zeilen);
            if (!ergebnis.geht)
                throw new ApiError(400, "validation_failed", GRUND_TEXT[ergebnis.grund], {
                    field: "sections",
                    grund: ergebnis.grund,
                });
            // In der Richtung der Vorlage: ihre Fließrichtung und „Name auf der Karte“ gelten weiter so, wie sie gezeichnet war.
            const gegen = ergebnis.kette.find((g) => g.publicId === vorlage)!.umgedreht;
            const linie = gegen ? [...ergebnis.linie].reverse() : [...ergebnis.linie];
            const behalten = zeilen.find((z) => z.public_id === vorlage)!;
            const affected: PathVerbindenReceipt["affected"][number][] = [];
            const entries: MapAuditEntry[] = [];
            const [neu] = await tx<{ revision: number }[]>`
                UPDATE path SET geom = ${linieAlsSql(tx, linie)}
                 WHERE public_id = ${vorlage}::uuid AND revision = ${behalten.revision}
                RETURNING revision::int AS revision
            `;
            if (neu === undefined) throw await konflikt(tx, vorlage);
            affected.push({ kind: "path", id: vorlage, revision: neu.revision });
            entries.push({
                action: "path.joined",
                pathId: vorlage,
                revisionBefore: behalten.revision,
                revisionAfter: neu.revision,
                changes: { geometry: { before: linieVon(behalten.geojson), after: linie } },
            });
            for (const glied of ergebnis.kette) {
                if (glied.publicId === vorlage) continue;
                const zeile = zeilen.find((z) => z.public_id === glied.publicId)!;
                const [still] = await tx<{ revision: number }[]>`
                    UPDATE path SET is_active = FALSE
                     WHERE public_id = ${zeile.public_id}::uuid AND revision = ${zeile.revision}
                    RETURNING revision::int AS revision
                `;
                if (still === undefined) throw await konflikt(tx, zeile.public_id);
                affected.push({ kind: "path", id: zeile.public_id, revision: still.revision });
                entries.push({
                    action: "path.joined",
                    pathId: zeile.public_id,
                    revisionBefore: zeile.revision,
                    revisionAfter: still.revision,
                    changes: { active: { before: true, after: false } },
                });
            }
            await derivePathVisualsFor(tx, [Number(behalten.id)]);
            if (behalten.subtype === "Flussweg") {
                const linien = ergebnis.kette.map((glied) => {
                    const eigene = linieVon(zeilen.find((z) => z.public_id === glied.publicId)!.geojson);
                    return glied.umgedreht ? [...eigene].reverse() : eigene;
                });
                const hoehen = await fuehreFlussHoehenNach(
                    tx,
                    behalten.map_domain_id,
                    flussPunkteBeimVerbinden(linien, ergebnis.linie),
                );
                if (hoehen.umzuege.length > 0)
                    entries[0]!.changes!["wasserHoehen"] = wasserHoehenProtokoll(hoehen.umzuege);
                for (const g of hoehen.affected) affected.push(g);
            }
            return {
                receipt: {
                    affected,
                    derivedWork: [
                        { kind: "path_visual", state: "done" },
                        { kind: "routing", state: "pending" },
                    ],
                    warnings: [],
                },
                summary: `${String(zeilen.length)} Abschnitte zu einem verbunden`,
                entries,
            };
        },
    );
    return { ...quittung, publicId: vorlage };
}

/** Was die Operation „Wege verbinden“ an jedem ihrer Abschnitte schrieb (`changes` des Protokolls, `path.joined`). */
export type VerbindenProtokoll = ReadonlyMap<string, Record<string, { before?: unknown; after?: unknown }>>;

/**
 * ↺ in einer laufenden Transaktion (WI-0265 B6a2, die Rücknahme am Server `ruecknahme-weg.ts`): die Vorlage mit ihrer alten Linie, die übrigen zurück auf die Karte, jeder Abschnitt gegen seine
 * heutige Revision; die Höhen an Flüssen, die das Verbinden umzog (WI-0259, `wasserHoehen`), gehen an ihre Stützpunkte zurück. Die Vorlage muss noch auf der Karte sein, ein still gelegter Abschnitt
 * noch still (sonst 409).
 */
export async function schreibeVerbindenZurueckIn(
    tx: Sql,
    actor: MapActor,
    p: {
        readonly mapDomainId: string;
        readonly abschnitte: readonly { publicId: string; baseRevision: number }[];
        readonly je: VerbindenProtokoll;
        /** Der Abschnitt, der die Linie trug (seine Zeile im Protokoll nennt `geometry`). */
        readonly vorlage: string;
    },
): Promise<TxErgebnis> {
    const zeilen = await lies(
        tx,
        p.abschnitte.map((a) => a.publicId),
        true,
    );
    const basis = new Map(p.abschnitte.map((a) => [a.publicId, a.baseRevision] as const));
    const anders = zeilen.find((z) => basis.get(z.public_id) !== z.revision);
    if (anders !== undefined) throw await konflikt(tx, anders.public_id);
    await pruefeSperren(
        tx,
        actor,
        zeilen.map((z) => z.public_id),
    );
    const affected: PathVerbindenReceipt["affected"][number][] = [];
    const entries: MapAuditEntry[] = [];
    for (const zeile of zeilen) {
        const changes = p.je.get(zeile.public_id)!;
        if (zeile.public_id === p.vorlage) {
            // Die Vorlage muss noch auf der Karte sein; ihre alte Linie steht im Protokoll.
            if (!zeile.is_active) throw await konflikt(tx, zeile.public_id);
            const alt = changes["geometry"]?.before as Punkt[];
            const [neu] = await tx<{ revision: number }[]>`
                UPDATE path SET geom = ${linieAlsSql(tx, alt)}
                 WHERE public_id = ${zeile.public_id}::uuid AND revision = ${zeile.revision}
                RETURNING revision::int AS revision
            `;
            if (neu === undefined) throw await konflikt(tx, zeile.public_id);
            affected.push({ kind: "path", id: zeile.public_id, revision: neu.revision });
            entries.push({
                action: "path.joined",
                pathId: zeile.public_id,
                revisionBefore: zeile.revision,
                revisionAfter: neu.revision,
                changes: { geometry: { before: linieVon(zeile.geojson), after: alt } },
            });
            continue;
        }
        // Ein still gelegter muss es noch sein (sonst hat ihn inzwischen jemand zurückgeholt).
        if (zeile.is_active || zeile.off_map) throw await konflikt(tx, zeile.public_id);
        const [neu] = await tx<{ revision: number }[]>`
            UPDATE path SET is_active = TRUE
             WHERE public_id = ${zeile.public_id}::uuid AND revision = ${zeile.revision}
            RETURNING revision::int AS revision
        `;
        if (neu === undefined) throw await konflikt(tx, zeile.public_id);
        affected.push({ kind: "path", id: zeile.public_id, revision: neu.revision });
        entries.push({
            action: "path.joined",
            pathId: zeile.public_id,
            revisionBefore: zeile.revision,
            revisionAfter: neu.revision,
            changes: { active: { before: false, after: true } },
        });
    }
    await derivePathVisualsFor(
        tx,
        zeilen.map((z) => Number(z.id)),
    );
    // Die Höhen, die das Verbinden umgezogen hat (WI-0259), gehen an ihre Stützpunkte zurück.
    const umgezogen = umgekehrtAusProtokoll(p.je.get(p.vorlage)?.["wasserHoehen"]);
    if (umgezogen.length > 0) {
        const hoehen = await fuehreFlussHoehenNach(tx, p.mapDomainId, umgezogen, { genau: true });
        const eintrag = entries.find((e) => e.pathId === p.vorlage);
        if (hoehen.umzuege.length > 0 && eintrag?.changes !== undefined)
            eintrag.changes["wasserHoehen"] = wasserHoehenProtokoll(hoehen.umzuege);
        for (const g of hoehen.affected) affected.push(g);
    }
    return {
        receipt: {
            affected,
            derivedWork: [
                { kind: "path_visual", state: "done" },
                { kind: "routing", state: "pending" },
            ],
            warnings: [],
        },
        summary: `${String(zeilen.length)} Abschnitte wieder getrennt`,
        entries,
    };
}
