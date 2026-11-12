import { SUBJECT_LIMITS, renderZoomForBand, type SubjectDetail } from "@avesmaps3d/shared";
import { withStatementTimeout, type Database, type Queryable } from "../database.ts";
import { readCanon, readCounts } from "./carrier-tables.ts";
import { isGeosTopologyError, lineContext } from "./context.ts";
import { EDITORIAL, LEGACY_HIDDEN, textFact, wikiFact, wikiLine } from "./facts.ts";
import { lineGeometry } from "./line-geometry.ts";
import { loadLinkSource, textLinks } from "./link-pieces.ts";
import { readPowerlineShape } from "./powerline-shape.ts";
import type { SubjectIndex } from "./subject-index.ts";
import { pageKeysOf } from "./wiki-key-lookup.ts";

/**
 * Das Subject „Kraftlinie“: die GRUPPE ihrer Segmente gleichen Namens, wie im Kraftlinien-Editor und wie Legacy (WI-0205, Befund K1:
 * vorher bildete ein Artikel eine eigene Gruppe, und eine Linie mit Teilzuordnung stand im Infopanel als zwei). Ein Segment ohne Namen
 * ist eine Linie für sich. Der Artikel steht an der Gruppe (der des ersten Segments, das einen trägt); wie viele Segmente ihn NICHT
 * tragen, sagt die Gestalt (`segmentsWithoutWiki`). Die Antwort nennt das kleinste Segment als kanonischen Anker. Der Kontext ist der
 * ganze Verlauf wie beim Weg.
 *
 * D6 trägt den Wiki-Text (Stärke, Affinität, Länge, Regionen, Verlauf); das Legacy-Nest trägt keinen Stempel. D1 trägt den Kanon,
 * aber keine Quellen: Legacy exportiert für Kraftlinien keine Verknüpfungen.
 *
 * Dazu ihre Gestalt aus den Segmenten (`powerline-shape.ts`, WI-0063 P7): „Verbindet“, „Verläuft über“, „Abschnitte“ wie Legacys Infobox.
 */

interface SnapshotRow {
    wiki_url: string;
    name: string | null;
    staerke: string | null;
    affinitaet: string | null;
    laenge: string | null;
    regionen: string | null;
    verlauf: string | null;
    description: string | null;
    synced_at: Date | null;
}

/** Wie weit man an eine Kraftlinie heranfährt: wie bei einem Weg. */
const POWERLINE_ZOOM = renderZoomForBand(4);

interface PowerlineMember {
    public_id: string;
    name: string;
    snapshot_id: string | null;
    wiki_url: string | null;
    /** Die eigene Beschreibung des Abschnitts (WI-0205 KF1); leer oder `null` heißt: keine. */
    description: string | null;
}

/**
 * Die Mitglieder der Gruppe, zu der ein Segment gehört, aufsteigend nach öffentlicher ID; leer, wenn das Segment unbekannt oder
 * stillgelegt ist: alle aktiven Segmente desselben Namens, ein Segment ohne Namen allein (wie `gruppeVon` im Editor).
 */
export async function powerlineMembers(
    transaction: Queryable,
    mapDomainId: string,
    anchor: string,
): Promise<PowerlineMember[]> {
    return transaction<PowerlineMember[]>`
        WITH anchor AS (
            SELECT p.id, p.name
            FROM powerline p
            WHERE p.public_id = ${anchor}::uuid AND p.is_active AND p.map_domain_id = ${mapDomainId}
        )
        SELECT m.public_id::text AS public_id, m.name, w.snapshot_id::text AS snapshot_id, w.wiki_url, m.description
        FROM anchor a
        JOIN powerline m ON m.is_active AND m.map_domain_id = ${mapDomainId}
        LEFT JOIN powerline_wiki_assignment w ON w.powerline_id = m.id AND w.is_active
        WHERE m.id = a.id OR (btrim(a.name) <> '' AND m.name = a.name)
        ORDER BY m.public_id
    `;
}

export async function powerlineDetail(
    database: Database,
    index: SubjectIndex,
    anchor: string,
): Promise<SubjectDetail | null> {
    const loaded = await withStatementTimeout(database, SUBJECT_LIMITS.statementMs, async (transaction) => {
        const members = await powerlineMembers(transaction, index.mapDomainId, anchor);
        const [first] = members;
        if (!first) return null;
        const ids = members.map((row) => row.public_id);
        const snapshotId = members.find((row) => row.snapshot_id !== null)?.snapshot_id ?? null;
        const [snapshot] = snapshotId
            ? await transaction<SnapshotRow[]>`
                  SELECT wiki_url, name, staerke, affinitaet, laenge, regionen, verlauf, description, synced_at
                  FROM wiki_powerline_snapshot WHERE id = ${snapshotId}::bigint AND is_active
              `
            : [];
        return {
            ids,
            name: first.name,
            snapshot,
            // Eine von Hand getippte Adresse ohne Schlüssel und Schnappschuss (4 Segmente im Satz).
            address: members.find((row) => row.wiki_url !== null)?.wiki_url ?? null,
            geometry: await lineGeometry(transaction, "powerline", ids),
            counts: await readCounts(transaction, "powerline", ids),
            canon: await readCanon(transaction, "powerline", ids),
            // Die Linkziele des Artikels dieser Kraftlinie (Export X1), über den Key der Zuordnung (X2) ihrer Segmente, nie über den Namen.
            linkSource: await loadLinkSource(transaction, index.wikiKeys, pageKeysOf(index.wikiKeys, "powerline", ids)),
            shape: await readPowerlineShape(transaction, ids, index.mapDomainId),
            // Die eigene Beschreibung der Linie: die erste gesetzte ihrer Abschnitte, wie im Editor (Legacy `fieldSample`).
            description:
                members.find((row) => row.description !== null && row.description.trim() !== "")?.description ?? null,
            // Teilzuordnung: die Segmente, die den Artikel der Linie nicht tragen (eine eigene Adresse zählt als zugeordnet).
            ohneArtikel:
                snapshotId === null && !members.some((row) => row.wiki_url !== null)
                    ? 0
                    : members.filter((row) => row.snapshot_id === null && row.wiki_url === null).length,
        };
    });
    if (!loaded) return null;
    const [canonicalAnchor] = loaded.ids;
    if (canonicalAnchor === undefined) return null;

    const wikiUrl = loaded.snapshot?.wiki_url ?? loaded.address;
    const wiki = (value: string | null): { value: string | null; wikiUrl: string | null; syncedAt: Date | null } => ({
        value,
        wikiUrl,
        syncedAt: loaded.snapshot?.synced_at ?? null,
    });
    // Ein Name macht keinen Link (WI-0063 27.12, Zuordnung nur über den Wiki-Key): Regionen und Verlauf verlinken nur die Teilstücke, für die der Artikel
    // ein Linkziel nennt (Export X1).
    const regionen = loaded.snapshot?.regionen ?? null;
    const verlauf = loaded.snapshot?.verlauf ?? null;
    const facts = [
        // Die Beschreibung wie Legacy: die eigene, sonst die des Wiki („Handgetipptes schlägt Wiki“, Mirror a7f2dac8,
        // `js/map-features/map-features-powerlines.js:382`; Orchestrierung 2026-10-18, WI-0205 §8). Eine leere eigene folgt dem Wiki.
        ...(loaded.description !== null
            ? textFact("description", { value: loaded.description, provenance: EDITORIAL })
            : wikiFact("description", wiki(loaded.snapshot?.description ?? null))),
        ...wikiFact("staerke", wiki(loaded.snapshot?.staerke ?? null)),
        ...wikiFact("affinitaet", wiki(loaded.snapshot?.affinitaet ?? null)),
        ...wikiFact("laenge", wiki(loaded.snapshot?.laenge ?? null)),
        ...wikiFact("regionen", wiki(regionen), { links: textLinks(loaded.linkSource, ["regionen"], regionen) }),
        // Legacys Infobox der Kraftlinie zeigt den Verlauf nicht (WI-0063 27.8); die Beschreibung zeigt sie voll (hier nur aus dem Nest).
        ...wikiFact("verlauf", wiki(verlauf), {
            ...LEGACY_HIDDEN,
            links: textLinks(loaded.linkSource, ["verlauf"], verlauf),
        }),
    ];

    let context: SubjectDetail["context"];
    if (loaded.geometry) {
        try {
            context = await lineContext(database, index, loaded.geometry.lines);
        } catch (error) {
            if (!isGeosTopologyError(error)) throw error;
        }
    }

    const line = wikiLine(index, wikiUrl, loaded.snapshot?.name);
    return {
        subject: { kind: "powerline", anchor: canonicalAnchor },
        revision: index.revision,
        ...(loaded.name.trim() === "" ? {} : { title: loaded.name }),
        ...(facts.length === 0 ? {} : { facts }),
        ...(line === undefined ? {} : { wiki: line }),
        ...(context === undefined ? {} : { context }),
        ...(loaded.canon === undefined ? {} : { canon: loaded.canon }),
        ...(loaded.counts === undefined ? {} : { counts: loaded.counts }),
        ...(loaded.shape === undefined
            ? {}
            : {
                  lineShape: {
                      ...loaded.shape,
                      ...(loaded.ohneArtikel > 0 ? { segmentsWithoutWiki: loaded.ohneArtikel } : {}),
                  },
              }),
        ...(loaded.geometry
            ? {
                  target: {
                      x: loaded.geometry.x,
                      y: loaded.geometry.y,
                      zoom: POWERLINE_ZOOM,
                      bounds: loaded.geometry.bounds,
                  },
              }
            : {}),
    };
}
