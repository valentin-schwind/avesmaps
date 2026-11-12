import {
    SUBJECT_LIMITS,
    pathReaderName,
    renderZoomForBand,
    type PathRef,
    type SubjectDetail,
    type SubjectSubtitlePart,
} from "@avesmaps3d/shared";
import { isStatementCancelled, withStatementTimeout, type Database } from "../database.ts";
import { sprachenAbschnitt } from "./sections/sprachen.ts";
import { wegfindungswerte } from "../system/wegfindungsstand.ts";
import { readCanon, readCounts } from "./carrier-tables.ts";
import { alsOhneKontext, isGeosTopologyError, lineContext } from "./context.ts";
import { wikiFact, wikiLine } from "./facts.ts";
import { lineGeometry } from "./line-geometry.ts";
import { loadLinkSource, textLinks } from "./link-pieces.ts";
import { anzeigeAbschnitte, resolvePathChain, resolvePathGroup, type ResolvedPathGroup } from "./path-group.ts";
import { orderRoutePlaces, readRouteSegments, wholeStretch, type RouteSegment } from "./path-route.ts";
import { loreCarriersOf, loreCounts } from "./sections/lore.ts";
import type { PathSegmentRecord, SubjectIndex } from "./subject-index.ts";
import { pageKeysOf } from "./wiki-key-lookup.ts";

/**
 * Das Subject „Weg“ (Straße, Pfad, Pass, Fluss): die GRUPPE seiner Abschnitte, nicht ein Abschnitt (Vertrag `subject-details.yaml`,
 * `wege`). Die Gruppe ist ein Wiki-Weg (ein Artikel), sonst Wegart plus echter Name, sonst das Einzelsegment. Die Antwort nennt die
 * kanonische Gruppe; ihr Kontext ist der ganze VERLAUF (Gebiete und Landschaften in der Reihenfolge des ersten Eintritts), damit
 * ein langer Fluss nicht je nach angeklicktem Abschnitt so wirkt, als läge er nur in der dortigen Herrschaft (WI-0063 5.4).
 *
 * Die Quellen sind die Vereinigung der Verknüpfungen aller Abschnitte, jede einmal (D1: Legacy verteilt sie auf alle Abschnitte).
 *
 * Aus den Abschnitten und den Orten an ihren Enden (`path-route.ts`, WI-0063 P7) kommen zwei Angaben: „Von – Bis“ der ganzen Straße
 * (`stretch`, Legacys Markierungszeile) und - nur mit Wiki-Artikel, ohne Seeweg und mit mindestens zwei Orten - die Orte für „Weg als
 * Route“ (`routePlaces`, Legacy B12).
 *
 * Weitere Straßennamen (WI-0302): Ein Abschnitt, der den Artikel als weiteren trägt, gehört zur Wiki-Gruppe (`migration/path-groups.ts`) und zählt für Verlauf,
 * Orte und Grenzen mit. Die Antwort nennt alle Kennungen der Gruppe (`abschnitte`, für „Anzeigen“) und die Straßen, mit denen der Weg Abschnitte teilt (`gemeinsam`).
 * Zu `abschnitte` kommt die Kette der echten Namen der Gruppe (OPS-000109, `anzeigeAbschnitte`): Ein Fluss, dessen Artikel nur an einem Teil hängt, leuchtet ganz.
 */

interface SnapshotRow {
    wiki_url: string;
    name: string | null;
    art: string | null;
    lage: string | null;
    laenge: string | null;
    verlauf: string | null;
    description: string | null;
    synced_at: Date | null;
}

/** Wie weit man an einen Weg heranfährt: wie ein Wegtreffer der Suche. */
const PATH_ZOOM = renderZoomForBand(4);

/** Der Name der Gruppe: der häufigste echte Name ihrer Abschnitte (bei Gleichstand der erste in alphabetischer Folge). */
function groupName(members: readonly PathSegmentRecord[]): string | null {
    const counts = new Map<string, number>();
    for (const segment of members) {
        const name = pathReaderName(segment.name, segment.subtype);
        if (name !== null) {
            counts.set(name, (counts.get(name) ?? 0) + 1);
        }
    }
    const [best] = [...counts.entries()].sort(
        ([leftName, left], [rightName, right]) => right - left || leftName.localeCompare(rightName, "de"),
    );
    return best?.[0] ?? null;
}

/** Die Wegarten der Gruppe, die häufigste zuerst (60 Wege tragen gemischte Arten: Pfad und Straße, Pass und Straße). */
function subtypesOf(members: readonly PathSegmentRecord[]): string[] {
    const counts = new Map<string, number>();
    for (const segment of members) counts.set(segment.subtype, (counts.get(segment.subtype) ?? 0) + 1);
    return [...counts.entries()]
        .sort(([leftType, left], [rightType, right]) => right - left || leftType.localeCompare(rightType))
        .map(([subtype]) => subtype);
}

/**
 * Die Abschnitte, die einer Wiki-Gruppe selbst gehören: die mit ihrem Artikel als Hauptartikel (WI-0302). Ein geteilter Abschnitt (der Artikel ist dort ein weiterer
 * Straßenname) zählt für Verlauf, Orte und Grenzen mit, nicht aber für den Titel: Sonst hieße eine kurze Straße mit vielen geteilten Abschnitten wie die fremde.
 */
function eigeneAbschnitte(group: ResolvedPathGroup, members: readonly PathSegmentRecord[]): PathSegmentRecord[] {
    if (group.kind !== "wiki") return [...members];
    const key = group.id.slice("wiki:".length);
    return members.filter((segment) => segment.mainKey === key);
}

/** Die Straße eines geteilten Abschnitts zum Öffnen: seine Hauptgruppe, sonst die seines Namens, sonst er selbst (nie die Gruppe, in der er geteilt ist). */
function strasseVon(index: SubjectIndex, segment: PathSegmentRecord, eigeneGruppe: string): PathRef {
    const gruppen = index.paths.groupsOf.get(segment.publicId) ?? [];
    const wahl =
        segment.mainKey !== null && gruppen.includes(`wiki:${segment.mainKey}`)
            ? `wiki:${segment.mainKey}`
            : gruppen.find((id) => id.startsWith("name:") && id !== eigeneGruppe);
    const gruppe = wahl === undefined ? undefined : index.paths.groups.get(wahl);
    const anchor = gruppe?.members[0];
    if (gruppe === undefined || anchor === undefined) return { kind: "path", anchor: segment.publicId };
    return gruppe.kind === "wiki" ? { kind: "path", anchor, wiki: gruppe.key } : { kind: "path", anchor };
}

/**
 * „Gemeinsam mit“ (WI-0302; Vali 2026-11-10, Option „Ja, mitzählen“): die Abschnitte der Gruppe, die einer Straße mit anderem echten Namen gehören und den Artikel der Gruppe als
 * weiteren Straßennamen tragen, je fremder Straße zusammengefasst; bei genau einem Abschnitt dessen „Von – Bis“. Nach Namen geordnet.
 */
function gemeinsamMit(
    index: SubjectIndex,
    group: ResolvedPathGroup,
    members: readonly PathSegmentRecord[],
    title: string | null,
    segments: readonly RouteSegment[],
): NonNullable<SubjectDetail["gemeinsam"]> {
    if (group.kind !== "wiki") return [];
    const key = group.id.slice("wiki:".length);
    const jeStrasse = new Map<string, PathSegmentRecord[]>();
    for (const segment of members) {
        if (segment.mainKey === key || !segment.further.some((entry) => entry.key === key)) continue;
        const name = pathReaderName(segment.name, segment.subtype);
        if (name === null || name === title) continue;
        jeStrasse.set(name, [...(jeStrasse.get(name) ?? []), segment]);
    }
    return [...jeStrasse.entries()]
        .sort(([a], [b]) => a.localeCompare(b, "de"))
        .map(([name, geteilt]) => {
            const [erster] = geteilt as [PathSegmentRecord, ...PathSegmentRecord[]];
            const einer = geteilt.length === 1 ? segments.find((segment) => segment.id === erster.publicId) : undefined;
            const strecke = einer === undefined ? undefined : wholeStretch([einer]);
            return {
                name,
                ref: strasseVon(index, erster, group.id),
                abschnitte: geteilt.length,
                ...(strecke === undefined ? {} : { von: strecke.from, bis: strecke.to }),
            };
        });
}

/** So viele Kennungen nennt `abschnitte` höchstens (Vertrag `SubjectDetail.abschnitte`); eine größere Gruppe leuchtet wie bisher über ihren Namen. */
const ABSCHNITTE_MAX = 5000;

export interface PathInput {
    /** Entweder ein Ankerabschnitt (`path.public_id`) oder ein Kettenschlüssel `name:<Name>`. */
    anchor?: string;
    chain?: string;
    wiki?: string;
}

export function pathGroupOf(index: SubjectIndex, input: PathInput): ResolvedPathGroup | null {
    if (input.anchor !== undefined) return resolvePathGroup(index.paths, input.anchor, input.wiki);
    if (input.chain !== undefined) return resolvePathChain(index.paths, input.chain, input.wiki);
    return null;
}

export async function pathDetail(
    database: Database,
    index: SubjectIndex,
    input: PathInput,
): Promise<SubjectDetail | null> {
    const group = pathGroupOf(index, input);
    if (!group) return null;
    const members = group.members.flatMap((id) => {
        const segment = index.paths.segments.get(id);
        return segment ? [segment] : [];
    });

    const subtypes = subtypesOf(members);
    // Exakter Treffer und Grenze der Wegpunkte, wie der Router sie rechnet (WI-0214): einmal, vor der Transaktion.
    const werte = await wegfindungswerte(database);
    // 🔴 `geometryStatementMs`: Ein Weg ist eine Linie (`loreCarriersOf`, `readRouteSegments`), die Grenze für Punkte traf ihn unter Last zuerst (WI-0283).
    const loaded = await withStatementTimeout(database, SUBJECT_LIMITS.geometryStatementMs, async (transaction) => {
        const [snapshot] =
            group.kind === "wiki"
                ? await transaction<SnapshotRow[]>`
                      SELECT wiki_url, name, art, lage, laenge, verlauf, description, synced_at
                      FROM wiki_path_snapshot
                      WHERE wiki_key = ${group.id.slice("wiki:".length)} AND is_active
                  `
                : [];
        // Ein Weg ohne Artikel kann trotzdem eine Adresse tragen (von Hand getippt, ohne Schlüssel und Schnappschuss).
        const [address] =
            group.kind === "wiki"
                ? []
                : await transaction<{ wiki_url: string }[]>`
                      SELECT a.wiki_url
                      FROM path_wiki_assignment a
                      JOIN path p ON p.id = a.path_id
                      WHERE p.public_id = ANY(${[...group.members]}::uuid[]) AND a.is_active AND a.role = 'main'
                        AND a.snapshot_id IS NULL AND a.wiki_url IS NOT NULL
                      ORDER BY p.public_id
                      LIMIT 1
                  `;
        return {
            snapshot,
            address,
            geometry: await lineGeometry(transaction, "path", group.members),
            // 🔴 Ein Weg erbt die Vorkommen der Flächen, die seine Linie enthalten (Betreiber 2026-10-07: „Wege sollen
            // abgeleitete Vorkommen haben (‚Aus der Region‘)“, WI-0103). Eigene kann er strukturell nicht tragen. In der
            // Antwort stehen NUR die vier Zahlen - die Namen holt die Sektion `lore` beim Aufklappen.
            counts: await readCounts(
                transaction,
                "path",
                group.members,
                await loreCounts(
                    transaction,
                    index,
                    await loreCarriersOf(transaction, index, "path", group.members),
                    group.ref,
                ),
            ),
            canon: await readCanon(transaction, "path", group.members),
            // Die Linkziele des Artikels dieses Wegs (Export X1), über den Key der Zuordnung (X2) seiner Abschnitte, nie über den Namen.
            linkSource: await loadLinkSource(
                transaction,
                index.wikiKeys,
                pageKeysOf(index.wikiKeys, "path", group.members),
            ),
            segments: await readRouteSegments(transaction, group.members, index.mapDomainId, werte.exactHit),
            // Tunnel (Migration 0172) und Karawanenroute (Migration 0174): wie viele Abschnitte der Gruppe sie tragen; nur das Panel
            // nennt es.
            merkmale: (
                await transaction<{ tunnel: number; karawanenroute: number }[]>`
                    SELECT count(*) FILTER (WHERE is_tunnel)::int AS tunnel,
                           count(*) FILTER (WHERE mark = 'karawanenroute')::int AS karawanenroute
                      FROM path WHERE public_id = ANY(${[...group.members]}::uuid[])
                `
            )[0] ?? { tunnel: 0, karawanenroute: 0 },
        };
    });

    const wikiUrl = loaded.snapshot?.wiki_url ?? loaded.address?.wiki_url ?? null;
    // „Weg als Route“ gibt es wie „Anzeigen“ nur mit Wiki-Artikel und nie bei Seewegen (Legacy `pathWegAktionErlaubt`), und nur, wenn
    // die Straße mindestens zwei Orte verbindet (Betreiber 14.09.2026: „Die Kachel soll bei zu kurzen Wegen ausgeblendet werden“).
    const routePlaces = wikiUrl !== null && subtypes[0] !== "Seeweg" ? orderRoutePlaces(loaded.segments) : [];
    const stretch = wholeStretch(loaded.segments);
    const wiki = (value: string | null): { value: string | null; wikiUrl: string | null; syncedAt: Date | null } => ({
        value,
        wikiUrl,
        syncedAt: loaded.snapshot?.synced_at ?? null,
    });
    // Ein Name macht keinen Link (WI-0063 27.12, Zuordnung nur über den Wiki-Key): Lage und Verlauf verlinken nur die Teilstücke, für die der Artikel ein
    // Linkziel nennt (Export X1). Der Verlauf nennt ALLE Links des Rohtexts, auch Abzweig- und Querungsziele fremder Wege: nur, wessen Anzeigetext im
    // angezeigten Verlauf steht, wird ein Link.
    const lage = loaded.snapshot?.lage ?? null;
    const verlauf = loaded.snapshot?.verlauf ?? null;
    const facts = [
        ...wikiFact("description", wiki(loaded.snapshot?.description ?? null)),
        ...wikiFact("art", wiki(loaded.snapshot?.art ?? null)),
        ...wikiFact("lage", wiki(lage), { links: textLinks(loaded.linkSource, ["lage"], lage) }),
        ...wikiFact("laenge", wiki(loaded.snapshot?.laenge ?? null)),
        ...wikiFact("verlauf", wiki(verlauf), { links: textLinks(loaded.linkSource, ["verlauf"], verlauf) }),
    ];

    let context: SubjectDetail["context"];
    let kontextFehlt = false;
    if (loaded.geometry) {
        try {
            context = await lineContext(database, index, loaded.geometry.lines);
        } catch (error) {
            // Ein Schnittfehler von GEOS lässt den Kontext fehlen, nicht die Auskunft. Die Zeitgrenze ebenso (WI-0283): „Verläuft durch“ fehlt dann einmal, statt dass
            // das ganze Infopanel mit 503 ausfällt; die Route gibt die Antwort nicht in einen Zwischenspeicher.
            if (isStatementCancelled(error)) kontextFehlt = true;
            else if (!isGeosTopologyError(error)) throw error;
        }
    }

    // Der Titel ist der eigene echte Name; erst ohne ihn der Name des Wiki-Artikels (Legacy `getPathTitleName`). Geteilte Abschnitte zählen dafür nicht (WI-0302).
    const title = groupName(eigeneAbschnitte(group, members)) ?? loaded.snapshot?.name ?? groupName(members) ?? null;
    const gemeinsam = gemeinsamMit(index, group, members, title, loaded.segments);
    const subtitle: SubjectSubtitlePart[] = subtypes.map((key) => ({ part: "type", key }));
    // Karawanenroute (WI-0177 §30, Migration 0174): das Kennzeichen über dem Wegtyp, vor ihm; „teils“, wenn nur ein Teil der Abschnitte.
    const { tunnel, karawanenroute } = loaded.merkmale;
    if (karawanenroute > 0)
        subtitle.unshift({
            part: "mark",
            key: "karawanenroute",
            ...(karawanenroute < group.members.length ? { partial: true as const } : {}),
        });
    // Tunnel (WI-0177, Migration 0172), wie Unterirdisch am Ort: hinter dem Wegtyp; „mit Tunnel“, wenn nur ein Teil der Abschnitte.
    if (tunnel > 0)
        subtitle.push({ part: "tunnel", ...(tunnel < group.members.length ? { partial: true as const } : {}) });
    const line = wikiLine(index, wikiUrl, loaded.snapshot?.name);
    const abschnitte = anzeigeAbschnitte(index.paths, group);
    const antwort: SubjectDetail = {
        subject: group.ref,
        revision: index.revision,
        ...(title === null || title.trim() === "" ? {} : { title }),
        ...(subtitle.length === 0 ? {} : { subtitle }),
        ...(facts.length === 0 ? {} : { facts }),
        ...(line === undefined ? {} : { wiki: line }),
        ...(context === undefined ? {} : { context }),
        ...(loaded.canon === undefined ? {} : { canon: loaded.canon }),
        ...(loaded.counts === undefined ? {} : { counts: loaded.counts }),
        ...(loaded.geometry
            ? {
                  target: {
                      x: loaded.geometry.x,
                      y: loaded.geometry.y,
                      zoom: PATH_ZOOM,
                      bounds: loaded.geometry.bounds,
                  },
              }
            : {}),
        ...(routePlaces.length >= 2 && routePlaces.length <= werte.routeWaypointLimit ? { routePlaces } : {}),
        ...(stretch === undefined ? {} : { stretch }),
        ...(gemeinsam.length === 0 ? {} : { gemeinsam }),
        ...(abschnitte.length <= ABSCHNITTE_MAX ? { abschnitte } : {}),
        ...(await sprachenAbschnitt(database, "path", group.members)),
    };
    return kontextFehlt ? alsOhneKontext(antwort) : antwort;
}
