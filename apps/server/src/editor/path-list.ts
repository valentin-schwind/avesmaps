import {
    CLOSURE_REASONS,
    PATH_END_AT_PLACE,
    PATH_LAND_SUBTYPES,
    editorLandscapeCircle,
    editorPathGroupKey,
    isCalendarMonth,
    pathReaderName,
    type ClosureReason,
    type EditorPathList,
    type EditorPathReisen,
    type EditorPathRow,
    type EditorPathSaison,
    type EditorPathStreet,
    type EditorPathGeteilt,
    type FeldHerkuenfte,
    type FeldHerkunft,
    type PathMark,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { leseHerkunft } from "./feld-herkunft.ts";
import { leseWeitere } from "./path-weitere.ts";

/**
 * Der Lesepfad des Wege-Fensters (WI-0177 Stufe 2, W5a; Vertrag `packages/shared/src/editor-path-list.ts`), nach dem Muster der
 * Kraftlinien (`kraftlinien.ts`): EINE Abfrage über die aktiven Abschnitte samt Hauptartikel, gruppiert nach `name:subtype`. Seewege
 * fehlen wie überall im Wegeditor. Abschnitte, die von der Karte genommen sind (Stufe 3b: still mit `off_map`, `path-split.ts`), stehen
 * dabei, als eigene Gruppe neben den Abschnitten derselben Straße auf der Karte; gelöschte ebenso (EDIT-0003 T54: die Facette
 * „Gelöscht“, das Fenster liest nur, der Verlauf holt sie zurück).
 * - **Kennzeichen** (Karawanenroute, Migration 0174, WI-0177 §30): Abschnitte mit Kennzeichen gruppieren nach `name:mark`, über ihre
 *   Wegtypen hinweg; die Zeile nennt den häufigsten Wegtyp und, wenn es mehrere sind, alle (`subtypes`). Abschnitte ohne Kennzeichen
 *   gehören nie zu einer Straße mit Kennzeichen, auch bei gleichem Namen und Wegtyp.
 * - **Weitere Straßennamen** (WI-0302): Die Straße nennt je Abschnitt seine weiteren Wiki-Artikel (`weitere`) und dazu die Abschnitte ANDERER Straßen,
 *   die ihren Hauptartikel als weiteren tragen (`geteilt`): je einer mit dem Namen und dem Anker seiner Straße, seiner Nummer in deren Folge (wie
 *   deren Abschnittsliste sie zeigt), Von, Bis und Rahmen. Bearbeitet wird ein geteilter Abschnitt bei seiner eigenen Straße.
 */

/** Der Stand eines Abschnitts in der Liste: auf der Karte, von der Karte genommen, gelöscht (wie `wegStand` in `path-split.ts`). */
type Stand = "karte" | "abgenommen" | "geloescht";

interface AbschnittRow {
    public_id: string;
    name: string;
    subtype: string;
    is_bach: boolean;
    flow_direction: "forward" | "reverse" | null;
    label_visible: boolean;
    revision: number;
    points: number;
    wiki_url: string | null;
    wiki_title: string | null;
    wiki_key: string | null;
    wiki_art: string | null;
    source_system: string;
    stand: Stand;
    is_tunnel: boolean;
    mark: PathMark | null;
    allowed_transports: string[] | null;
    transport_domain: string | null;
    transport_seasons: Record<string, unknown> | null;
    transports_written: boolean;
    x0: number | null;
    y0: number | null;
    x1: number | null;
    y1: number | null;
}

const rund = (v: number): number => Math.round(v * 100) / 100;

async function leseAbschnitte(
    database: Queryable,
    mapDomainId: string,
    gruppe?: { name: string; stand: Stand } | { id: string },
): Promise<AbschnittRow[]> {
    const nur =
        gruppe === undefined
            ? database``
            : "id" in gruppe
              ? database`AND p.public_id = ${gruppe.id}::uuid`
              : // Ein Weg ist sein Name (Regel (c)); ein Abschnitt, dessen Name nur sein Wegtyp ist, ist ein Griff und gehört nie dazu.
                database`AND p.name = ${gruppe.name} AND btrim(p.name) <> p.subtype
                         AND p.is_active = ${gruppe.stand === "karte"} AND p.off_map = ${gruppe.stand === "abgenommen"}`;
    return database<AbschnittRow[]>`
        SELECT p.public_id::text AS public_id, p.name, p.subtype, p.is_bach, p.flow_direction, p.label_visible,
               p.revision::int AS revision,
               ST_NPoints(p.geom)::int AS points, coalesce(s.wiki_url, w.wiki_url) AS wiki_url, s.name AS wiki_title, s.wiki_key, s.art AS wiki_art,
               p.source_system,
               CASE WHEN p.is_active THEN 'karte' WHEN p.off_map THEN 'abgenommen' ELSE 'geloescht' END AS stand,
               p.is_tunnel, p.mark, p.allowed_transports, p.transport_domain, p.transport_seasons, p.transports_written,
               ST_XMin(p.geom) AS x0, ST_YMin(p.geom) AS y0, ST_XMax(p.geom) AS x1, ST_YMax(p.geom) AS y1
          FROM path p
          LEFT JOIN path_wiki_assignment w ON w.path_id = p.id AND w.role = 'main' AND w.is_active
          LEFT JOIN wiki_path_snapshot s ON s.id = w.snapshot_id AND s.is_active
         WHERE p.map_domain_id = ${mapDomainId} AND p.subtype <> 'Seeweg'
           ${nur}
         ORDER BY p.public_id
    `;
}

const rahmenEines = (a: AbschnittRow): [number, number, number, number] | undefined =>
    a.x0 === null || a.y0 === null || a.x1 === null || a.y1 === null
        ? undefined
        : [rund(a.x0), rund(a.y0), rund(a.x1), rund(a.y1)];

function rahmenVon(abschnitte: readonly AbschnittRow[]): [number, number, number, number] | undefined {
    let rahmen: [number, number, number, number] | undefined;
    for (const a of abschnitte) {
        const r = rahmenEines(a);
        if (r === undefined) continue;
        rahmen = rahmen
            ? [
                  Math.min(rahmen[0], r[0]),
                  Math.min(rahmen[1], r[1]),
                  Math.max(rahmen[2], r[2]),
                  Math.max(rahmen[3], r[3]),
              ]
            : r;
    }
    return rahmen;
}

/**
 * Der Wegtyp einer Straße und, mit Kennzeichen auf gemischtem Untergrund, alle ihre Wegtypen: der mit den meisten Abschnitten zuerst,
 * bei Gleichstand in der Folge der Landwege (`PATH_LAND_SUBTYPES`), dann nach Namen.
 */
export function untergrundVon(abschnitte: readonly Pick<AbschnittRow, "subtype">[]): {
    subtype: string;
    subtypes?: string[];
} {
    const zahl = new Map<string, number>();
    for (const a of abschnitte) zahl.set(a.subtype, (zahl.get(a.subtype) ?? 0) + 1);
    const rang = (art: string): number => {
        const i = (PATH_LAND_SUBTYPES as readonly string[]).indexOf(art);
        return i < 0 ? PATH_LAND_SUBTYPES.length : i;
    };
    const arten = [...zahl.keys()].sort(
        (a, b) => (zahl.get(b) ?? 0) - (zahl.get(a) ?? 0) || rang(a) - rang(b) || a.localeCompare(b, "de"),
    );
    const [erste] = arten;
    return { subtype: erste ?? "", ...(arten.length > 1 ? { subtypes: arten } : {}) };
}

/** Was Zeile und Straße teilen: Kreis, Artikel, Teilzuordnung, Rahmen, Herkunft, der Stand, Kennzeichen und Untergrund. */
function zusammenfassung(abschnitte: readonly AbschnittRow[]) {
    const mitArtikel = abschnitte.filter((a) => a.wiki_url !== null);
    const artikel = mitArtikel.find((a) => a.wiki_title !== null) ?? mitArtikel[0];
    // Die Wiki-Werte für das Wiki-Feld (WI-0225): Titel und Weg-Art des Artikels; ein fehlender Wert bleibt weg (unbekannt).
    const mitWerten =
        artikel?.wiki_key !== null && artikel?.wiki_key !== undefined && artikel.wiki_url !== null
            ? {
                  key: artikel.wiki_key,
                  url: artikel.wiki_url,
                  name: artikel.wiki_title ?? "",
                  werte: {
                      ...(artikel.wiki_title !== null ? { name: artikel.wiki_title } : {}),
                      ...(artikel.wiki_art !== null ? { subtype: artikel.wiki_art, mark: artikel.wiki_art } : {}),
                  },
              }
            : undefined;
    const bounds = rahmenVon(abschnitte);
    const fremd = abschnitte.find((a) => a.source_system !== "legacy")?.source_system;
    const stand = abschnitte[0]?.stand ?? "karte";
    // Das Kennzeichen der Straße nur, wenn alle Abschnitte es tragen; gemischt nennt es jeder Abschnitt selbst.
    const erstesKennzeichen = abschnitte[0]?.mark ?? null;
    const mark =
        erstesKennzeichen !== null && abschnitte.every((a) => a.mark === erstesKennzeichen)
            ? erstesKennzeichen
            : undefined;
    // Der häufigste Wegtyp und, auf mehreren, alle (ein Weg ist sein Name, über Wegtypen hinweg).
    const untergrund: { subtype: string; subtypes?: string[] | undefined } = untergrundVon(abschnitte);
    return {
        stand,
        mark,
        subtype: untergrund.subtype,
        subtypes: untergrund.subtypes,
        circle: editorLandscapeCircle(stand === "karte", mitArtikel.length === abschnitte.length),
        ...(artikel?.wiki_url
            ? { wiki: { url: artikel.wiki_url, ...(artikel.wiki_title !== null ? { title: artikel.wiki_title } : {}) } }
            : {}),
        artikel: mitWerten,
        teilzuordnung: mitArtikel.length > 0 && mitArtikel.length < abschnitte.length ? mitArtikel.length : undefined,
        ...(bounds ? { bounds } : {}),
        ...(fremd !== undefined ? { source: fremd } : {}),
    };
}

export async function listEditorPaths(database: Queryable, mapDomainId = "aventuria"): Promise<EditorPathList> {
    const gruppen = new Map<string, AbschnittRow[]>();
    for (const a of await leseAbschnitte(database, mapDomainId)) {
        const g = `${a.stand === "karte" ? "" : `${a.stand}|`}${editorPathGroupKey({ publicId: a.public_id, name: a.name, subtype: a.subtype })}`;
        const liste = gruppen.get(g);
        if (liste) liste.push(a);
        else gruppen.set(g, [a]);
    }
    const rows: EditorPathRow[] = [...gruppen.values()].map((teile) => {
        const erster = teile[0] as AbschnittRow;
        const z = zusammenfassung(teile);
        return {
            id: erster.public_id,
            name: erster.name,
            subtype: z.subtype,
            ...(z.mark !== undefined ? { mark: z.mark } : {}),
            ...(z.subtypes !== undefined ? { subtypes: z.subtypes } : {}),
            isBach: erster.is_bach,
            circle: z.circle,
            segments: teile.length,
            ...(z.wiki ? { wiki: z.wiki } : {}),
            ...(z.teilzuordnung !== undefined ? { wikiSegments: z.teilzuordnung } : {}),
            ...(z.bounds ? { bounds: z.bounds } : {}),
            ...(z.source !== undefined ? { source: z.source } : {}),
            ...(z.stand === "abgenommen" ? { offMap: true as const } : {}),
            ...(z.stand === "geloescht" ? { deleted: true as const } : {}),
        };
    });
    rows.sort(
        (a, b) =>
            a.name.localeCompare(b.name, "de") || a.subtype.localeCompare(b.subtype, "de") || (a.id < b.id ? -1 : 1),
    );
    return { rows };
}

/** Ein Ende eines Abschnitts: der Punkt und der Ort, an dem es hängt (Kasten ±`PATH_END_AT_PLACE`). */
export interface AbschnittsEnde {
    readonly x: number;
    readonly y: number;
    readonly ort?: { readonly id: string; readonly name: string } | undefined;
}

/** Ein Abschnitt mit seinen beiden Enden in der gespeicherten Richtung. */
export interface AbschnittMitEnden {
    readonly id: string;
    readonly anfang: AbschnittsEnde;
    readonly ende: AbschnittsEnde;
}

/** Der Knoten eines Endes: der Ort, an dem es hängt, sonst die Lage auf fünf Stellen (die Genauigkeit der Wegenden). */
const knotenVon = (ende: AbschnittsEnde): string => ende.ort?.id ?? `${ende.x.toFixed(5)}:${ende.y.toFixed(5)}`;

/**
 * Die Folge der Abschnitte entlang der Straße (EDIT-0003 T49): Beginnt am westlichsten Ende, das nur EIN Abschnitt berührt, und geht
 * von Knoten zu Knoten weiter; bei einer Lücke oder Verzweigung am nächsten westlichsten offenen Ende. Ein Ring beginnt am westlichsten
 * Punkt. `umgekehrt` sagt, dass der Abschnitt gegen seine gespeicherte Richtung läuft.
 */
export function folgeEntlang(abschnitte: readonly AbschnittMitEnden[]): { id: string; umgekehrt: boolean }[] {
    const offen = new Set(abschnitte.map((a) => a.id));
    const grad = new Map<string, number>();
    for (const a of abschnitte)
        for (const k of [knotenVon(a.anfang), knotenVon(a.ende)]) grad.set(k, (grad.get(k) ?? 0) + 1);
    const raus: { id: string; umgekehrt: boolean }[] = [];
    const naechsterStart = (): { a: AbschnittMitEnden; umgekehrt: boolean } | undefined => {
        let bester: { a: AbschnittMitEnden; umgekehrt: boolean; x: number; frei: boolean } | undefined;
        for (const a of abschnitte) {
            if (!offen.has(a.id)) continue;
            for (const [ende, umgekehrt] of [
                [a.anfang, false],
                [a.ende, true],
            ] as const) {
                const frei = (grad.get(knotenVon(ende)) ?? 0) === 1;
                const besser =
                    bester === undefined ||
                    (frei && !bester.frei) ||
                    (frei === bester.frei && (ende.x < bester.x || (ende.x === bester.x && a.id < bester.a.id)));
                if (besser) bester = { a, umgekehrt, x: ende.x, frei };
            }
        }
        return bester;
    };
    for (let start = naechsterStart(); start !== undefined; start = naechsterStart()) {
        let jetzt: { a: AbschnittMitEnden; umgekehrt: boolean } | undefined = start;
        while (jetzt !== undefined) {
            offen.delete(jetzt.a.id);
            raus.push({ id: jetzt.a.id, umgekehrt: jetzt.umgekehrt });
            const weiter = knotenVon(jetzt.umgekehrt ? jetzt.a.anfang : jetzt.a.ende);
            jetzt = undefined;
            for (const a of abschnitte) {
                if (!offen.has(a.id)) continue;
                if (knotenVon(a.anfang) === weiter) jetzt = { a, umgekehrt: false };
                else if (knotenVon(a.ende) === weiter) jetzt = { a, umgekehrt: true };
                if (jetzt !== undefined) break;
            }
        }
    }
    return raus;
}

/** Die Enden der Abschnitte und die Orte daran, in einer Abfrage. */
async function endenDer(database: Queryable, ids: readonly string[]): Promise<Map<string, AbschnittMitEnden>> {
    const zeilen = await database<
        {
            id: string;
            x0: number;
            y0: number;
            x1: number;
            y1: number;
            von_id: string | null;
            von: string | null;
            bis_id: string | null;
            bis: string | null;
        }[]
    >`
        SELECT p.public_id::text AS id,
               ST_X(ST_StartPoint(p.geom)) AS x0, ST_Y(ST_StartPoint(p.geom)) AS y0,
               ST_X(ST_EndPoint(p.geom)) AS x1, ST_Y(ST_EndPoint(p.geom)) AS y1,
               a.public_id::text AS von_id, a.name AS von, b.public_id::text AS bis_id, b.name AS bis
          FROM path p
          LEFT JOIN LATERAL (
              SELECT o.public_id, o.name FROM place o
               WHERE o.is_active AND o.map_domain_id = p.map_domain_id
                 AND o.geom && ST_Expand(ST_StartPoint(p.geom), ${PATH_END_AT_PLACE})
               ORDER BY o.geom <-> ST_StartPoint(p.geom) LIMIT 1
          ) a ON TRUE
          LEFT JOIN LATERAL (
              SELECT o.public_id, o.name FROM place o
               WHERE o.is_active AND o.map_domain_id = p.map_domain_id
                 AND o.geom && ST_Expand(ST_EndPoint(p.geom), ${PATH_END_AT_PLACE})
               ORDER BY o.geom <-> ST_EndPoint(p.geom) LIMIT 1
          ) b ON TRUE
         WHERE p.public_id = ANY(${ids as string[]}::uuid[])
    `;
    const ort = (id: string | null, name: string | null) => (id === null || name === null ? undefined : { id, name });
    return new Map(
        zeilen.map((z) => [
            z.id,
            {
                id: z.id,
                anfang: { x: z.x0, y: z.y0, ort: ort(z.von_id, z.von) },
                ende: { x: z.x1, y: z.y1, ort: ort(z.bis_id, z.bis) },
            },
        ]),
    );
}

/** Die Orte an den Enden eines Abschnitts in der Richtung seiner Straße (`umgekehrt` aus `folgeEntlang`). */
function vonBis(mitEnden: AbschnittMitEnden | undefined, umgekehrt: boolean): { von?: string; bis?: string } {
    const von = (umgekehrt ? mitEnden?.ende : mitEnden?.anfang)?.ort?.name;
    const bis = (umgekehrt ? mitEnden?.anfang : mitEnden?.ende)?.ort?.name;
    return { ...(von !== undefined ? { von } : {}), ...(bis !== undefined ? { bis } : {}) };
}

/**
 * Die Abschnitte anderer Straßen, die den Artikel `key` als weiteren Straßennamen tragen (WI-0302), ohne die eigenen (`eigene`): nur auf der Karte und ohne
 * Seewege, wie die Straßen des Fensters. Je fremder Straße wird ihre Folge einmal gerechnet; geordnet nach Straße und Nummer.
 */
async function geteilteAbschnitte(
    database: Queryable,
    mapDomainId: string,
    key: string,
    eigene: readonly string[],
): Promise<EditorPathGeteilt[]> {
    const fremde = await database<{ id: string; name: string; subtype: string }[]>`
        SELECT p.public_id::text AS id, p.name, p.subtype
          FROM path_wiki_assignment w
          JOIN wiki_path_snapshot s ON s.id = w.snapshot_id AND s.is_active
          JOIN path p ON p.id = w.path_id
         WHERE s.wiki_key = ${key} AND w.role = 'further' AND w.is_active
           AND p.is_active AND p.map_domain_id = ${mapDomainId} AND p.subtype <> 'Seeweg'
           AND NOT (p.public_id = ANY(${[...eigene]}::uuid[]))
         ORDER BY p.public_id
    `;
    const strassen = new Map<
        string,
        { teile: AbschnittRow[]; enden: Map<string, AbschnittMitEnden>; folge: ReturnType<typeof folgeEntlang> }
    >();
    const geteilt: EditorPathGeteilt[] = [];
    for (const f of fremde) {
        const benannt = pathReaderName(f.name, f.subtype) !== null;
        const schluessel = benannt ? `name:${f.name}` : `id:${f.id}`;
        let strasse = strassen.get(schluessel);
        if (strasse === undefined) {
            const teile = await leseAbschnitte(
                database,
                mapDomainId,
                benannt ? { name: f.name, stand: "karte" } : { id: f.id },
            );
            const enden = await endenDer(
                database,
                teile.map((a) => a.public_id),
            );
            strasse = { teile, enden, folge: folgeEntlang([...enden.values()]) };
            strassen.set(schluessel, strasse);
        }
        const stelle = strasse.folge.findIndex((teil) => teil.id === f.id);
        const zeile = strasse.teile.find((a) => a.public_id === f.id);
        const anker = strasse.teile[0];
        if (stelle < 0 || zeile === undefined || anker === undefined) continue;
        const r = rahmenEines(zeile);
        geteilt.push({
            id: f.id,
            strasse: f.name,
            strasseId: anker.public_id,
            nummer: stelle + 1,
            ...vonBis(strasse.enden.get(f.id), strasse.folge[stelle]!.umgekehrt),
            ...(r ? { bounds: r } : {}),
        });
    }
    return geteilt.sort((a, b) => a.strasse.localeCompare(b.strasse, "de") || a.nummer - b.nummer);
}

/** Die Herkunft eines Abschnitts für den Lesepfad: nur Felder mit Vermerk; ohne Vermerk fehlt sie. */
function vermerkeVon(herkunft: FeldHerkuenfte | undefined): { herkunft?: Record<string, FeldHerkunft> } {
    const vermerke = Object.entries(herkunft ?? {}).filter((e): e is [string, FeldHerkunft] => e[1] !== undefined);
    return vermerke.length > 0 ? { herkunft: Object.fromEntries(vermerke) } : {};
}

/**
 * Die Reisemittel eines Abschnitts, wie gespeichert. Ein Fenster mit unbekanntem Monat oder Tag lässt die Wegfindung als „ganzjährig“
 * gelten (`windowDays` gibt null); es fällt hier weg, damit das Fenster dasselbe zeigt. Ein Grund (`reason`, Migration 0208) bleibt
 * dabei, wenn er einer der bekannten ist; „vollständig geschrieben“ (F16 „A“) steht als `geschrieben`.
 */
function reisenVon(a: AbschnittRow): EditorPathReisen {
    const fenster: Record<string, EditorPathSaison> = {};
    for (const [mittel, roh] of Object.entries(a.transport_seasons ?? {})) {
        if (typeof roh !== "object" || roh === null) continue;
        const { from_month, from_day, to_month, to_day, reason } = roh as Record<string, unknown>;
        const tag = (wert: unknown): number | undefined =>
            typeof wert === "number" && Number.isInteger(wert) && wert >= 1 && wert <= 30 ? wert : undefined;
        const von = tag(from_day);
        const bis = tag(to_day);
        if (
            !isCalendarMonth(String(from_month)) ||
            !isCalendarMonth(String(to_month)) ||
            von === undefined ||
            bis === undefined
        )
            continue;
        fenster[mittel] = {
            from_month: String(from_month),
            from_day: von,
            to_month: String(to_month),
            to_day: bis,
            ...((CLOSURE_REASONS as readonly unknown[]).includes(reason) ? { reason: reason as ClosureReason } : {}),
        };
    }
    return {
        liste: a.allowed_transports,
        domaene: a.transport_domain,
        fenster,
        ...(a.transports_written ? { geschrieben: true as const } : {}),
    };
}

/** Die Straße, zu der ein Abschnitt gehört, mit ihren Abschnitten; `undefined`, wenn es ihn nicht (mehr) gibt. */
export async function readEditorPathStreet(
    database: Queryable,
    publicId: string,
    mapDomainId = "aventuria",
): Promise<EditorPathStreet | undefined> {
    const [eigener] = await leseAbschnitte(database, mapDomainId, { id: publicId });
    if (eigener === undefined) return undefined;
    const teile =
        pathReaderName(eigener.name, eigener.subtype) === null
            ? [eigener]
            : await leseAbschnitte(database, mapDomainId, { name: eigener.name, stand: eigener.stand });
    const erster = teile[0] as AbschnittRow;
    const z = zusammenfassung(teile);
    const sichtbar = new Set(teile.map((a) => a.label_visible));
    const enden = await endenDer(
        database,
        teile.map((a) => a.public_id),
    );
    const zeileVon = new Map(teile.map((a) => [a.public_id, a] as const));
    // Die Herkunft je Abschnitt (WI-0225 §7): Name, Wegtyp, Kennzeichen; ein Abschnitt ohne Vermerk fehlt.
    const herkunft = await leseHerkunft(
        database,
        "path",
        teile.map((a) => a.public_id),
    );
    const folge = folgeEntlang([...enden.values()]);
    // Die weiteren Straßennamen je Abschnitt und die Abschnitte anderer Straßen, die den Artikel dieser tragen (WI-0302).
    const weitere = await leseWeitere(
        database,
        teile.map((a) => a.public_id),
    );
    const geteilt =
        z.artikel === undefined
            ? []
            : await geteilteAbschnitte(
                  database,
                  mapDomainId,
                  z.artikel.key,
                  teile.map((a) => a.public_id),
              );
    return {
        id: erster.public_id,
        name: erster.name,
        subtype: z.subtype,
        ...(z.mark !== undefined ? { mark: z.mark } : {}),
        ...(z.subtypes !== undefined ? { subtypes: z.subtypes } : {}),
        isBach: erster.is_bach,
        circle: z.circle,
        labelVisible: sichtbar.size === 1 ? erster.label_visible : null,
        ...(z.wiki ? { wiki: z.wiki } : {}),
        ...(z.artikel ? { artikel: z.artikel } : {}),
        segments: folge.map(({ id, umgekehrt }) => {
            const a = zeileVon.get(id) as AbschnittRow;
            const r = rahmenEines(a);
            const eigeneWeitere = weitere.get(id) ?? [];
            return {
                id: a.public_id,
                revision: a.revision,
                labelVisible: a.label_visible,
                wiki: a.wiki_url !== null,
                points: a.points,
                ...(z.subtypes !== undefined ? { subtype: a.subtype } : {}),
                ...(a.is_tunnel ? { tunnel: true as const } : {}),
                ...(a.mark !== null ? { mark: a.mark } : {}),
                ...(r ? { bounds: r } : {}),
                ...vonBis(enden.get(id), umgekehrt),
                art: a.subtype,
                bach: a.is_bach,
                ...(a.subtype === "Flussweg" && a.flow_direction !== null ? { flowDirection: a.flow_direction } : {}),
                reisen: reisenVon(a),
                ...vermerkeVon(herkunft.get(a.public_id)),
                ...(eigeneWeitere.length > 0
                    ? { weitere: eigeneWeitere.map(({ key, name, url }) => ({ key, name, url })) }
                    : {}),
            };
        }),
        ...(geteilt.length > 0 ? { geteilt } : {}),
        ...(z.bounds ? { bounds: z.bounds } : {}),
        ...(z.source !== undefined ? { source: z.source } : {}),
        ...(z.stand === "abgenommen" ? { offMap: true as const } : {}),
        ...(z.stand === "geloescht" ? { deleted: true as const } : {}),
    };
}
