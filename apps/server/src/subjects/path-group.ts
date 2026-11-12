import { parsePathChain, pathReaderName, type PathRef } from "@avesmaps3d/shared";
import type { PathGroupRecord, PathIndex } from "./subject-index.ts";

/**
 * Die Gruppe eines Wegs (WI-0063, Vertrag `subject-details.yaml`, Abschnitt `wege`): Das Subject „Weg“ ist die GRUPPE seiner
 * Abschnitte, nicht ein Abschnitt. Die Kennung nennt ein ANKERSEGMENT und löst die Gruppe daraus auf, nie aus dem
 * Anzeigenamen; die Gruppe hat keine eigene UUID. Die Regeln rechnet `migration/path-groups.ts` (derselbe Code wie der
 * Prüfer des Imports); hier wird nur nachgeschlagen.
 */
export interface ResolvedPathGroup {
    /** `wiki`: ein Artikel; `name`: der echte Name (über Wegarten hinweg, WI-0177 Schritt 2b); `single`: ein Abschnitt ohne Zuordnung und ohne echten Namen. */
    kind: "wiki" | "name" | "single";
    /** Die Identität der Gruppe: `wiki:<wiki_key>`, `name:<…>` oder `single:<öffentliche ID>`. */
    id: string;
    /** Die öffentlichen IDs der Abschnitte, aufsteigend; der erste ist der kanonische Anker. */
    members: readonly string[];
    /** Der kanonische Ref: der kleinste Abschnitt als Anker, bei einem Wiki-Weg dazu sein Schlüssel. */
    ref: PathRef;
}

function resolved(
    kind: ResolvedPathGroup["kind"],
    id: string,
    members: readonly string[],
    wikiKey: string | null,
): ResolvedPathGroup {
    const [anchor] = members;
    if (anchor === undefined) throw new Error("eine Wegegruppe ohne Abschnitt");
    return {
        kind,
        id,
        members,
        ref: wikiKey === null ? { kind: "path", anchor } : { kind: "path", anchor, wiki: wikiKey },
    };
}

/**
 * Die Gruppe, zu der ein Abschnitt gehört. `wikiHint` (der Schlüssel eines Artikels) wählt unter mehreren Wiki-Gruppen des
 * Abschnitts (Hauptzuweisung plus weitere); ohne Hinweis oder mit einem unbekannten gilt die Hauptzuweisung, sonst der Name,
 * sonst das Einzelsegment. `null`, wenn der Abschnitt unbekannt (oder stillgelegt) ist.
 */
export function resolvePathGroup(index: PathIndex, anchor: string, wikiHint?: string): ResolvedPathGroup | null {
    if (!index.segments.has(anchor)) return null;
    const groupIds = index.groupsOf.get(anchor) ?? [];
    const wanted = wikiHint === undefined ? undefined : `wiki:${wikiHint}`;
    const chosen = (wanted !== undefined && groupIds.includes(wanted) ? wanted : groupIds[0]) as string | undefined;
    const group: PathGroupRecord | undefined = chosen === undefined ? undefined : index.groups.get(chosen);
    if (!group) return resolved("single", `single:${anchor}`, [anchor], null);
    return resolved(group.kind, group.id, group.members, group.kind === "wiki" ? group.key : null);
}

/**
 * Die Abschnitte, die beim „Anzeigen“ eines Wegs leuchten (`SubjectDetail.abschnitte`, OPS-000109): die Gruppe (WI-0302: auch die geteilten Abschnitte einer
 * anderen Straße) und dazu die ganze Kette ihrer echten Namen. Hängt der Artikel eines Flusses nur an einem Teil seiner Abschnitte, zerfällt er in den Wiki-Weg und
 * eine Namensgruppe der übrigen; vor WI-0302 leuchtete die Karte nach dem Namen und nahm beide, und so bleibt es.
 *
 * Aus der Kette kommt kein Abschnitt, der einem ANDEREN Artikel gehört (zwei Gruppen mit verschiedenem Schlüssel sind zwei Wege): Beim Wiki-Weg ist der eigene
 * Artikel der der Gruppe, bei der Namensgruppe der einzige Artikel der Kette (bei mehreren gehört der Rest keinem allein). Die Namen kommen nur von den
 * eigenen Abschnitten, nicht von den geteilten (sonst leuchtete die fremde Straße mit), und nur echte Namen (ein Griff ist keine Kette). Ein Seeweg und ein
 * Landweg gleichen Namens bleiben getrennt, wie in den Gruppen.
 */
export function anzeigeAbschnitte(index: PathIndex, group: ResolvedPathGroup): string[] {
    const ids = new Set(group.members);
    const wikiKey = group.kind === "wiki" ? group.id.slice("wiki:".length) : null;
    const gesehen = new Set<string>();
    for (const member of group.members) {
        const segment = index.segments.get(member);
        if (segment === undefined || pathReaderName(segment.name, segment.subtype) === null) continue;
        if (wikiKey !== null && segment.mainKey !== wikiKey) continue;
        const seeweg = segment.subtype === "Seeweg";
        // Eine lange Straße trägt Hunderte Abschnitte eines Namens: die Kette je Name (und Seeweg oder nicht) nur einmal.
        const schluessel = `${String(seeweg)}:${segment.name}`;
        if (gesehen.has(schluessel)) continue;
        gesehen.add(schluessel);
        const kette = (index.byChain.get(segment.name) ?? []).flatMap((id) => {
            const glied = index.segments.get(id);
            return glied !== undefined && (glied.subtype === "Seeweg") === seeweg ? [glied] : [];
        });
        const artikel = new Set(kette.flatMap((glied) => (glied.mainKey === null ? [] : [glied.mainKey])));
        const eigener = wikiKey ?? (artikel.size === 1 ? [...artikel][0] : null);
        for (const glied of kette) if (glied.mainKey === null || glied.mainKey === eigener) ids.add(glied.publicId);
    }
    return [...ids].sort();
}

/**
 * Die Gruppe zu einem Kettenschlüssel `name:<Name>` (Suche, Kartenauswahl; ein altes `Name:Wegtyp` gilt dem Namen): alle Abschnitte
 * dieses Namens, über Wegtypen hinweg (WI-0177 Schritt 2b). Sie
 * gehören meist zu EINER Gruppe; ist ein Fluss nur teilweise einem Artikel zugeordnet (32 von 1.307 benannten Ketten), zerfällt er in den
 * Wiki-Weg und eine Namensgruppe der übrigen Abschnitte. Dann gilt die Gruppe, die die meisten Abschnitte der Kette trägt, und bei
 * Gleichstand der Wiki-Weg: die Kette meint den ganzen Fluss, und der Artikel ist seine Auskunft. `null` bei einer ungültigen Kette oder
 * ohne Abschnitt.
 */
export function resolvePathChain(index: PathIndex, chain: string, wikiHint?: string): ResolvedPathGroup | null {
    const parsed = parsePathChain(chain);
    if (!parsed) return null;
    const members = index.byChain.get(parsed.name) ?? [];
    const [first] = members;
    if (first === undefined) return null;
    if (wikiHint !== undefined) {
        // Der Hinweis wählt den Wiki-Weg, soweit ein Abschnitt der Kette zu ihm gehört; sonst gilt, als gäbe es ihn nicht.
        const hinted = members.find((member) => index.groupsOf.get(member)?.includes(`wiki:${wikiHint}`));
        return resolvePathGroup(index, hinted ?? first, wikiHint);
    }
    const counts = new Map<string, number>();
    for (const member of members) {
        const resolvedGroup = resolvePathGroup(index, member);
        if (resolvedGroup) counts.set(resolvedGroup.id, (counts.get(resolvedGroup.id) ?? 0) + 1);
    }
    const [best] = [...counts.entries()].sort(
        ([leftId, left], [rightId, right]) =>
            right - left ||
            Number(rightId.startsWith("wiki:")) - Number(leftId.startsWith("wiki:")) ||
            leftId.localeCompare(rightId),
    );
    if (best === undefined) return null;
    const member = members.find((candidate) => resolvePathGroup(index, candidate)?.id === best[0]);
    return member === undefined ? null : resolvePathGroup(index, member);
}
