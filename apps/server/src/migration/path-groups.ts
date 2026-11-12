import { pathReaderName } from "@avesmaps3d/shared";

/**
 * Die Wegegruppen (WI-0063, Vertrag `subject-details.yaml`, Abschnitt `wege`): Das Panel-Subject „Weg“ ist die GRUPPE, nicht das
 * Segment. Die Gruppe ist abgeleitet und hat keine Zeile und keine eigene UUID (Legacy rechnet sie bewusst, paths.yaml); diese
 * Datei rechnet sie, damit der Prüfer die Zahlen des Vertrags nachrechnen kann und der Leser (P4) eine geprüfte Vorlage hat.
 *
 * Die Regeln stehen in Legacys Suchindex (`api/app/map-search.php`, `getPathTitleName`, `shouldShowRoutePathDisplayName`):
 *  - WIKI-Gruppe: Art `wiki`, Schlüssel = `wiki_key` der Haupt- oder einer weiteren Zuweisung. Ein Segment gehört zur Gruppe
 *    seines Hauptschlüssels und zu jeder seiner weiteren.
 *  - NAMEN-Gruppe: Art `name`, Schlüssel = normalisierter echter Name, für Segmente OHNE Hauptzuweisung. Der Wegtyp trennt nicht
 *    (WI-0177 Schritt 2b, Legacys Regel (c) `wpGroupKeyOf`; Legacys Suchindex trennte noch nach Wegart). Nur ein Seeweg bleibt für
 *    sich (`seeweg:<Name>`): Besucher sehen keine Seewege, also zählt kein Landweg gleichen Namens sie mit.
 *  - Der Titel ist der eigene echte Name, sonst der Name des Wiki-Artikels. Was ein echter Name ist, sagt
 *    `pathReaderName` in `@avesmaps3d/shared` (WI-0105; die Regel stand hier als `isRealPathName`).
 *  - Ohne echten Namen und ohne Zuordnung gibt es keine Gruppe.
 * Zwei Gruppen mit verschiedenem Schlüssel sind zwei Wege, auch bei gleichem Anzeigenamen.
 */

export interface PathGroupInput {
    publicId: string;
    /** Der Name des Segments, wie Legacy ihn führt (`display_name`, sonst `name`). */
    name: string;
    /** Die Wegart (Reichsstrasse, Strasse, Weg, Pfad, Gebirgspass, Wuestenpfad, Flussweg, Seeweg). */
    subtype: string;
    /** `wiki_key` der Hauptzuweisung oder `null`. */
    mainKey: string | null;
    /** Die weiteren Zuweisungen: `wiki_key` und Name des Artikels. */
    further: readonly { key: string; name: string | null }[];
    /** Name des Wiki-Artikels der Hauptzuweisung (Rückfall für den Titel). */
    wikiName: string | null;
}

export interface PathGroup {
    kind: "wiki" | "name";
    key: string;
    members: string[];
}

export interface PathGroupResult {
    groups: PathGroup[];
    wikiGroups: number;
    nameGroups: number;
    /** Segmente mit echtem Namen (Titel). */
    segmentsWithTitle: number;
    /** Segmente ohne echten Namen und ohne Zuordnung: keine Gruppenidentität. */
    segmentsWithoutGroup: number;
    /** Normalisierte Titel, die unter mehr als einem Gruppenschlüssel vorkommen. */
    titlesInSeveralGroups: number;
}

/** Legacy `normalizePathSubtype` kennt diese acht Arten. */
export const PATH_SUBTYPES = [
    "Reichsstrasse",
    "Strasse",
    "Weg",
    "Pfad",
    "Gebirgspass",
    "Wuestenpfad",
    "Flussweg",
    "Seeweg",
] as const;

/** Die Textnormalisierung der Suche: NFD, ohne kombinierende Zeichen, klein, ß zu ss, alles außer a-z0-9 zu Leerzeichen, getrimmt. */
export function normalizeSearchText(value: string): string {
    return value
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/ß/g, "ss")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

/** Der Titel eines Segments: der eigene echte Name, sonst der Name des Wiki-Artikels (Legacy `getPathTitleName`). */
export function pathTitle(input: PathGroupInput): string {
    return pathReaderName(input.name, input.subtype) ?? (input.wikiName ?? "").trim();
}

export function computePathGroups(inputs: readonly PathGroupInput[]): PathGroupResult {
    const groups = new Map<string, PathGroup>();
    const titleKeys = new Map<string, Set<string>>();
    let segmentsWithTitle = 0;
    let segmentsWithoutGroup = 0;
    const add = (kind: "wiki" | "name", key: string, member: string, title: string): void => {
        const id = `${kind}:${key}`;
        const group = groups.get(id);
        if (group) group.members.push(member);
        else groups.set(id, { kind, key, members: [member] });
        const normalized = normalizeSearchText(title);
        if (normalized !== "") {
            const keys = titleKeys.get(normalized) ?? new Set<string>();
            keys.add(id);
            titleKeys.set(normalized, keys);
        }
    };
    for (const input of inputs) {
        const title = pathTitle(input);
        if (title !== "") segmentsWithTitle += 1;
        if (input.mainKey === null && input.further.length === 0 && title === "") {
            segmentsWithoutGroup += 1;
            continue;
        }
        if (input.mainKey !== null) {
            add("wiki", input.mainKey, input.publicId, title !== "" ? title : (input.wikiName ?? ""));
        } else if (pathReaderName(input.name, input.subtype) !== null) {
            // Ohne Hauptzuweisung die Namensgruppe, auch mit weiteren Zuweisungen: Seit WI-0300 lässt „Artikel lösen“ die weiteren stehen (WI-0302: weitere Straßennamen).
            const name = normalizeSearchText(title);
            add("name", input.subtype === "Seeweg" ? `seeweg:${name}` : name, input.publicId, title);
        }
        for (const entry of input.further) add("wiki", entry.key, input.publicId, entry.name ?? "");
    }
    const all = [...groups.values()];
    return {
        groups: all,
        wikiGroups: all.filter((group) => group.kind === "wiki").length,
        nameGroups: all.filter((group) => group.kind === "name").length,
        segmentsWithTitle,
        segmentsWithoutGroup,
        titlesInSeveralGroups: [...titleKeys.values()].filter((keys) => keys.size > 1).length,
    };
}
