import {
    SEARCH_MIN_LENGTH,
    landscapeReaderName,
    pathReaderName,
    subjectKey,
    wikiPageNameKey,
    type ObjectLinkParam,
    type ObjectLinkRequest,
    type ResolveLinkCandidate,
    type ResolveLinkResponse,
    type ResolveLinkVia,
    type SearchHit,
    type SubjectRef,
} from "@avesmaps3d/shared";
import type { Database } from "../database.ts";
import { search } from "../search/search.ts";
import { resolvePathChain, resolvePathGroup, type ResolvedPathGroup } from "./path-group.ts";
import { canonicalAreaRef, type SubjectIndex } from "./subject-index.ts";

/**
 * Die Auflösung der Legacy-Objektlinks auf einen kanonischen `SubjectRef` (WI-0063 4.6; Vertrag `subject-details.yaml`,
 * `objektlinks`). Der Leser (P5) übersetzt die Adresse hierüber und benutzt danach dieselbe „Subject öffnen“-Naht wie Suche
 * und Karteninteraktion: es entsteht kein zweiter Infopanel-Pfad.
 *
 * Die Regeln sind Legacys (`js/app/wiki-deeplink.js`, Discovery-Mirror `avesmaps@b9657635a`):
 *  - Welcher Schlüssel gilt, entscheidet `readObjectLink` in `@avesmaps3d/shared` (Priorität, deutsch vor englisch).
 *  - `siedlung` sucht Ort, dann Gebiet, dann Landschaft/Gipfel; `staat` Gebiet, dann Ort; `region` Gebiet, dann Landschaft,
 *    dann Ort; `strasse` und `fluss` suchen dieselben Wege. Der erste Träger-Typ mit Treffer gewinnt: Haben Ort und Gebiet
 *    denselben Schlüssel (Fasar, Punin: 26 Fälle), löst die Reihenfolge ihn deterministisch auf.
 *  - Verglichen wird der Seitenanteil der GESPEICHERTEN Wiki-Adresse des Trägers (`wikiLinkKey`), nie Titel oder `wiki_key`.
 *  - Ein Weg ist der GANZE Weg, die Gruppe; die Hauptzuweisung gewinnt vor der weiteren, die weitere vor dem Namenskanal.
 *  - Findet der Index nichts, fragt Legacy EINMAL die eigene Suche nach dem Seitennamen (ein abschließender Klammerzusatz
 *    entfällt: „Sultanat Fasar (Kalifat)“ sucht „Sultanat Fasar“).
 *
 * 🔴 Wo Legacy beim ersten Treffer einer Art still wählte (`find`), wählt Avesmaps3D NIE still: mehrere Subjects mit
 * demselben Schlüssel sind eine Auswahl (`candidates`). Nichts gefunden heißt `notFound`, nie Gareth oder die Startansicht.
 */

type CarrierKind = "place" | "territory" | "label";

/** Welche Art von Träger ein Parameter in welcher Reihenfolge sucht (Legacy `WIKI_DEEPLINK_PARAM_ROUTING`). */
const ROUTING: Readonly<Record<"siedlung" | "staat" | "region", readonly CarrierKind[]>> = {
    siedlung: ["place", "territory", "label"],
    staat: ["territory", "place"],
    region: ["territory", "label", "place"],
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Candidate {
    ref: SubjectRef;
    title?: string;
    type?: string;
}

function candidate(ref: SubjectRef, title: string | null | undefined, type: string | null | undefined): Candidate {
    return {
        ref,
        ...(title === null || title === undefined || title.trim() === "" ? {} : { title }),
        ...(type === null || type === undefined || type === "" ? {} : { type }),
    };
}

/** Aus den Treffern die Antwort: einer ist ein Ref, mehrere sind eine Auswahl, keiner ist `null` (weiter zur nächsten Art). */
function settle(found: readonly Candidate[], param: ObjectLinkParam, via: ResolveLinkVia): ResolveLinkResponse | null {
    const unique = new Map<string, Candidate>();
    for (const entry of found) {
        const key = subjectKey(entry.ref);
        if (!unique.has(key)) unique.set(key, entry);
    }
    const list = [...unique.entries()];
    const [first] = list;
    if (first === undefined) return null;
    if (list.length === 1) return { ref: first[1].ref, param, via };
    // Eine feste Reihenfolge, damit dieselbe Auswahl immer gleich aussieht: nach Titel, dann nach Schlüssel.
    list.sort(
        ([leftKey, left], [rightKey, right]) =>
            (left.title ?? "").localeCompare(right.title ?? "", "de") || leftKey.localeCompare(rightKey),
    );
    const candidates: ResolveLinkCandidate[] = list.map(([, entry]) => entry);
    return { candidates, param, via };
}

function pathCandidate(group: ResolvedPathGroup, index: SubjectIndex): Candidate {
    const members = group.members.flatMap((id) => {
        const segment = index.paths.segments.get(id);
        return segment ? [segment] : [];
    });
    // 🪤 Ein Griff ist kein Titel (WI-0105): Die Auswahlliste zeigte sonst „Strasse-123“. Ohne Titel setzt die
    // Oberfläche „Unbezeichnete Straße“ ein, wie bei einer namenlosen Fläche.
    const real = members.flatMap((segment) => pathReaderName(segment.name, segment.subtype) ?? []);
    const title = real[0] ?? members.find((segment) => segment.mainName !== null)?.mainName ?? null;
    return candidate(group.ref, title, members[0]?.subtype);
}

/** Wege zu einem Schlüssel: Hauptzuweisung, sonst weitere Zuweisung, sonst der Name; je Gruppe ein Treffer. */
function pathLink(index: SubjectIndex, key: string, param: ObjectLinkParam): ResolveLinkResponse | null {
    const carriers = index.links.byKey.get(key);
    const groups: ResolvedPathGroup[] = [];
    const add = (group: ResolvedPathGroup | null): void => {
        if (group) groups.push(group);
    };
    if (carriers && carriers.pathMain.length > 0) {
        for (const segment of carriers.pathMain) add(resolvePathGroup(index.paths, segment));
    } else if (carriers && carriers.pathFurther.length > 0) {
        // Ein Artikel, der nur als weitere Zuweisung auf der Karte liegt (ein Pilgerweg über fremden Straßen).
        for (const entry of carriers.pathFurther) add(resolvePathGroup(index.paths, entry.segment, entry.key));
    } else {
        for (const segment of index.paths.byNameKey.get(key) ?? []) add(resolvePathGroup(index.paths, segment));
    }
    return settle(
        groups.map((group) => pathCandidate(group, index)),
        param,
        "wiki",
    );
}

function carrierCandidates(index: SubjectIndex, key: string, kind: CarrierKind): Candidate[] {
    const carriers = index.links.byKey.get(key);
    if (!carriers) return [];
    switch (kind) {
        case "place":
            return carriers.place.map((place) =>
                candidate({ kind: "place", id: place.publicId }, place.name, place.subtype),
            );
        case "territory":
            return carriers.territory.map((territory) =>
                candidate({ kind: "territory", id: territory.publicId }, territory.name, territory.type),
            );
        case "label": {
            const areas = carriers.area.flatMap((region) => {
                const ref = canonicalAreaRef(index.regions, region.publicId);
                return ref ? [candidate(ref, landscapeReaderName(region.name, region.type), region.type)] : [];
            });
            const peaks = carriers.peak.map((peak) =>
                candidate({ kind: "peak", id: peak.publicId }, peak.name, peak.subtype),
            );
            return [...areas, ...peaks];
        }
    }
}

/** `?place=<öffentliche ID>`: ein Ort, eine Landschaft über ihre Beschriftung oder ein Gipfel (Legacy `findPlaceDeeplinkSpotlightEntry`). */
async function placeLink(database: Database, index: SubjectIndex, value: string): Promise<ResolveLinkResponse | null> {
    if (!UUID.test(value)) return null;
    const id = value.toLowerCase();
    const rows = await database<{ kind: string; id: string }[]>`
        SELECT 'place' AS kind, p.public_id::text AS id
        FROM place p
        WHERE p.public_id = ${id}::uuid AND p.is_active AND NOT p.is_hidden AND p.map_domain_id = ${index.mapDomainId}
        UNION ALL
        SELECT 'label', r.public_id::text
        FROM map_label l
        JOIN region r ON r.id = l.region_id AND r.is_active AND NOT r.is_hidden
        WHERE l.public_id = ${id}::uuid AND l.is_active
        UNION ALL
        SELECT 'peak', t.public_id::text
        FROM terrain_peak t
        WHERE t.public_id = ${id}::uuid AND t.is_active AND NOT 'verborgen' = ANY (t.merkmale) AND t.map_domain_id = ${index.mapDomainId}
    `;
    // Ein Ort vor einer Beschriftung vor einem Gipfel: Legacys Reihenfolge `["location", "label"]`.
    for (const kind of ["place", "label", "peak"]) {
        const row = rows.find((candidateRow) => candidateRow.kind === kind);
        if (!row) continue;
        if (kind === "place") return { ref: { kind: "place", id: row.id }, param: "place", via: "id" };
        if (kind === "peak") return { ref: { kind: "peak", id: row.id }, param: "place", via: "id" };
        const ref = canonicalAreaRef(index.regions, row.id);
        if (ref) return { ref, param: "place", via: "id" };
    }
    return null;
}

/** Der Seitenname, wie die Suche ihn bekommt: dekodiert, Leerzeichen statt Unterstrich, ohne abschließenden Klammerzusatz. */
export function searchNameOf(value: string): string {
    let decoded: string;
    try {
        decoded = decodeURIComponent(value.replace(/\+/g, " "));
    } catch {
        // Kaputte Prozentkodierung: der Rohwert bleibt (wie Legacy).
        decoded = value;
    }
    const spaced = decoded.replace(/_/g, " ").trim();
    return spaced.replace(/\s*\([^()]*\)\s*$/, "").trim() || spaced;
}

/** Ein Treffer der eigenen Suche (oder der Gebietsnamen) als Kandidat, oder `null`, wenn kein Subject daraus wird. */
async function hitCandidates(
    database: Database,
    index: SubjectIndex,
    hits: readonly SearchHit[],
): Promise<{ kind: CarrierKind | "path"; candidate: Candidate; name: string }[]> {
    const free = hits.filter((hit) => hit.kind === "landschaft" && hit.region === undefined).map((hit) => hit.id);
    // Eine freie Beschriftung ist nur ein Subject, wenn sie ein Gipfel ist (`terrain_peak`); sonst gibt es keine Zeile.
    const peakIds =
        free.length === 0
            ? new Set<string>()
            : new Set(
                  (
                      await database<{ id: string }[]>`
                          SELECT public_id::text AS id FROM terrain_peak
                          WHERE public_id = ANY(${free}::uuid[]) AND is_active AND NOT 'verborgen' = ANY (merkmale) AND map_domain_id = ${index.mapDomainId}
                      `
                  ).map((row) => row.id),
              );
    const result: { kind: CarrierKind | "path"; candidate: Candidate; name: string }[] = [];
    for (const hit of hits) {
        switch (hit.kind) {
            case "ort":
                result.push({
                    kind: "place",
                    candidate: candidate({ kind: "place", id: hit.id }, hit.name, hit.subtype),
                    name: hit.name,
                });
                break;
            case "landschaft": {
                if (hit.region !== undefined) {
                    const ref = canonicalAreaRef(index.regions, hit.region);
                    if (ref)
                        result.push({
                            kind: "label",
                            candidate: candidate(ref, hit.name, hit.subtype),
                            name: hit.name,
                        });
                } else if (peakIds.has(hit.id)) {
                    result.push({
                        kind: "label",
                        candidate: candidate({ kind: "peak", id: hit.id }, hit.name, hit.subtype),
                        name: hit.name,
                    });
                }
                break;
            }
            case "weg": {
                // Ein erzeugter Name („Reichsstrasse-12“) ist kein Name, nach dem jemand verlinkt (Legacy zeigt ihn nie).
                if (pathReaderName(hit.name, hit.subtype ?? "") === null) break;
                const group = resolvePathChain(index.paths, hit.id);
                if (group) result.push({ kind: "path", candidate: pathCandidate(group, index), name: hit.name });
                break;
            }
            case "klima":
                break;
        }
    }
    return result;
}

/** Gebietsnamen: die Suche kennt sie nicht, die Auflösung braucht sie (`staat`, `region`). Der genaue Name vor dem Teilnamen. */
function territoryNameHits(
    index: SubjectIndex,
    name: string,
): { kind: "territory"; candidate: Candidate; name: string }[] {
    const needle = name.toLowerCase();
    return [...index.territories.byId.values()]
        .filter((territory) => territory.name.toLowerCase().includes(needle))
        .sort(
            (left, right) =>
                Number(right.name.toLowerCase() === needle) - Number(left.name.toLowerCase() === needle) ||
                left.name.length - right.name.length ||
                left.name.localeCompare(right.name, "de"),
        )
        .slice(0, 20)
        .map((territory) => ({
            kind: "territory" as const,
            candidate: candidate({ kind: "territory", id: territory.publicId }, territory.name, territory.type),
            name: territory.name,
        }));
}

/**
 * Der Namens-Fallback (Legacy `resolveWikiDeeplinkViaMapSearch`): eine Suche nach dem Seitennamen, der erste Treffer der Art,
 * die der Parameter zuerst sucht, sonst der oberste Treffer. Mehrere Treffer mit genau diesem Namen in dieser Art sind eine
 * Auswahl, kein stiller Griff.
 */
async function nameLink(
    database: Database,
    index: SubjectIndex,
    request: ObjectLinkRequest,
    kinds: readonly (CarrierKind | "path")[],
): Promise<ResolveLinkResponse | null> {
    const queryName = searchNameOf(request.value);
    if (queryName.length < SEARCH_MIN_LENGTH) return null;
    const searched = await search(database, queryName.slice(0, 100), { limit: 20 });
    const hits = [...(await hitCandidates(database, index, searched.hits)), ...territoryNameHits(index, queryName)];
    const wanted = wikiPageNameKey(queryName);
    for (const kind of kinds) {
        const ofKind = hits.filter((hit) => hit.kind === kind);
        const exact = ofKind.filter((hit) => wikiPageNameKey(hit.name) === wanted);
        const settled = settle(
            (exact.length > 0 ? exact : ofKind.slice(0, 1)).map((hit) => hit.candidate),
            request.param,
            "name",
        );
        if (settled) return settled;
    }
    const [top] = hits;
    return top ? settle([top.candidate], request.param, "name") : null;
}

/**
 * Löst einen Objektlink auf. Die Antwort ist genau eines von: ein Ref, mehrere Kandidaten, nichts gefunden.
 */
export async function resolveObjectLink(
    database: Database,
    index: SubjectIndex,
    request: ObjectLinkRequest,
): Promise<ResolveLinkResponse> {
    const notFound: ResolveLinkResponse = { notFound: { param: request.param, value: request.value } };
    if (request.param === "place") return (await placeLink(database, index, request.value)) ?? notFound;

    const key = wikiPageNameKey(request.value);
    if (key === "") return notFound;
    if (request.param === "strasse" || request.param === "fluss") {
        return pathLink(index, key, request.param) ?? (await nameLink(database, index, request, ["path"])) ?? notFound;
    }
    const kinds = ROUTING[request.param];
    for (const kind of kinds) {
        const settled = settle(carrierCandidates(index, key, kind), request.param, "wiki");
        if (settled) return settled;
    }
    return (await nameLink(database, index, request, kinds)) ?? notFound;
}
