import { createFinding, type Finding, type FindingObject } from "../findings.ts";

/**
 * Die reine Umwandlung der zwei lesenden Exporte, die Legacy am 2026-10-05 für Avesmaps3D gebaut hat (WI-0063 27.12, Vertrag
 * `wiki-link-targets.yaml`, Legacy-Commits `562638021` und `04a85a54f`, `docs/wiki-linkziele-export.md`): X1 `wiki-linkziele-export.php` (je ARTIKEL
 * und Wiki-Feld die Links `{anzeige, ziel, art, vorlage?, ns, ns_name, ziel_key, weiterleitung_auf?}`, Betreiber 2026-10-05: „X1 je Artikel ja“) und X2
 * `wiki-zuordnung-export.php` (je Kartenobjekt mit Wiki-Zuweisung der kanonische Key). Beide werden über den Key verbunden: `artikel[].wiki_key` und
 * `ziel_key` (X1) gegen `objekte[].wiki_key` (X2). Kein Datenbankzugriff, kein Abruf.
 *
 * 🔴 Ein Link wird NIE über den Namen zu einem Objekt (Betreiber 2026-10-05, AGENTS.md „Karteninteraktion“): `ziel_key` und `wiki_key` kommen
 * wörtlich aus Legacy, beide aus derselben Funktion (Titel → Weiterleitungstafel → `wiki:` + Slug), der Namensraum steckt im Key. Hier wird kein Key
 * gerechnet, geändert oder verglichen, was kein Key ist.
 *
 * 🔴 Quellenprüfung (keine neue blockierende Prüfung, Betreiber 2026-10-03): Ist eine Antwort unbrauchbar (`ok` nicht true, keine Liste) oder
 * leer, schreibt der Teil nichts und legt nichts still (`source_block_missing`, `source_empty_catalog`); der Zug geht weiter. Alle anderen
 * Auffälligkeiten sind Befunde.
 *
 * 🔴 `{{Pol|X}}` im Feld Staat und `{{Reg|X}}` im Feld Region sind Links (Betreiber 2026-10-05: „Pol/Reg ja“): `art` `vorlage` mit `vorlage` `Pol` oder
 * `Reg`, Ziel X, kanonisiert wie jedes Ziel; Vorlage:Pol nennt als einzigen Parameter die übergeordnete politische Region, mehr behauptet das Ziel nicht.
 * Wikilinks tragen `art` `wikilink`. Alle anderen Vorlagen sind keine Links; der Kopf zählt sie (`vorlagen_in_feldern`), der Befund
 * `x1_vorlagen_keine_links` hält sie sichtbar.
 */

export const WIKI_LINK_TARGETS_CONTRACT_VERSION = "0";

/** Die Arten von X2 in der Reihenfolge der Antwort. */
export const X2_ARTS = ["siedlung", "weg", "region", "kraftlinie", "landschaft", "gebiet"] as const;
export type X2Art = (typeof X2_ARTS)[number];

/** Was ein Link ist: ein Wikilink `[[Ziel|Anzeige]]` oder eine der zwei Vorlagen, die Legacy als Link führt (`{{Pol|X}}`, `{{Reg|X}}`). */
export const LINK_ARTS = ["wikilink", "vorlage"] as const;
export type LinkArt = (typeof LINK_ARTS)[number];

/** Die Seitenarten des Wiki-Dumps, für die Legacy Felder führt. */
export const PAGE_KINDS = ["settlement", "building", "region", "path", "powerline"] as const;
export type PageKind = (typeof PAGE_KINDS)[number];

const NEIGHBOURS = [
    "nachbar_n",
    "nachbar_no",
    "nachbar_o",
    "nachbar_so",
    "nachbar_s",
    "nachbar_sw",
    "nachbar_w",
    "nachbar_nw",
];

/**
 * Legacys Positivliste der Infobox-Felder je Seitenart (`AVESMAPS_WIKI_LINKZIELE_FELDER`). Sie ist hier nur Wissen für den Befund „Feld
 * unbekannt“: Der Import speichert jedes Feld, das Legacy nennt; ein Feld, das kein Leser kennt, hält nichts an.
 */
export const KNOWN_FIELDS: Readonly<Record<PageKind, readonly string[]>> = {
    settlement: [
        "region",
        "staat",
        "oberhaupt",
        "bevoelkerungsmehrheit",
        "handelszone",
        "verkehrswege",
        "tempel",
        ...NEIGHBOURS,
    ],
    building: ["standort", "verkehrswege", ...NEIGHBOURS],
    region: ["region", "staat", "verkehrswege", ...NEIGHBOURS],
    path: ["lage", "verlauf"],
    powerline: ["regionen", "verlauf"],
};

export interface AssignmentRow {
    art: X2Art;
    publicId: string;
    wikiKey: string;
    wikiUrl: string | null;
    wikiTitle: string | null;
    ns: number | null;
    nsName: string | null;
    isRedirect: boolean;
    redirectTitle: string | null;
    redirectNs: number | null;
    redirectNsName: string | null;
}

export interface PageRow {
    pageKey: string;
    pageTitle: string;
    pageKind: PageKind;
    ns: number;
    nsName: string;
}

export interface TargetRow {
    pageKey: string;
    field: string;
    position: number;
    displayText: string;
    linkArt: LinkArt;
    /** Bei `art` `vorlage` der Name der Vorlage (`Pol`, `Reg`), sonst `null`. */
    linkTemplate: string | null;
    targetRaw: string;
    targetKey: string;
    targetNs: number;
    targetNsName: string;
    isRedirect: boolean;
    redirectTitle: string | null;
    redirectNs: number | null;
    redirectNsName: string | null;
}

/** Die Stände, mit denen Legacy eine Antwort beschriftet; beide Antworten eines Zuges sollten dieselben tragen. */
export interface Stamps {
    mapRevision: number | null;
    ecosystemRevision: number | null;
    territoriesRevision: string | null;
    aliasStamp: string | null;
}

/** Ein Schlüssel, dessen Seite Legacys Dump-Lauf nicht trägt (`ohne_wikitext`): kein Artikel, also keine Linkziele. */
export interface MissingArticle {
    wikiKey: string;
    reason: string;
    objects: number;
}

export interface AssignmentTransform {
    /** Die Antwort war unbrauchbar oder leer: der Aufrufer schreibt nichts. */
    skipped: boolean;
    rows: AssignmentRow[];
    stamps: Stamps;
    /** Die Zahlen des Kopfes: je Art die Objekte ohne Zuweisung (Legacy zählt sie, liefert sie aber nicht). */
    withoutAssignment: Record<string, number>;
    findings: Finding[];
}

export interface LinkTransform {
    skipped: boolean;
    pages: PageRow[];
    targets: TargetRow[];
    /** Die Schlüssel ohne Wikitext im Dump-Lauf (für den Abgleich mit der Zuordnung; nichts davon wird gespeichert). */
    missing: MissingArticle[];
    stamps: Stamps;
    findings: Finding[];
}

type Bag = Record<string, unknown>;

const isBag = (value: unknown): value is Bag => typeof value === "object" && value !== null && !Array.isArray(value);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ein nichtleerer Text, sonst `null`. Legacy liefert Leeres nie als Text, wo es NULL meint; der Wert bleibt wörtlich (nicht getrimmt). */
const textOf = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value : null);
const intOf = (value: unknown): number | null => (typeof value === "number" && Number.isInteger(value) ? value : null);
const numberOf = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value) ? value : null;
/** Ein Text, auch der leere (der Hauptraum heißt `ns_name` ""); sonst `null`. */
const stringOf = (value: unknown): string | null => (typeof value === "string" ? value : null);
/** Der Eintrag einer festen Liste, den der Wert nennt, sonst `null`. */
const pick = <T extends string>(list: readonly T[], value: unknown): T | null =>
    list.find((entry) => entry === value) ?? null;

function stampsOf(bag: Bag): Stamps {
    return {
        mapRevision: numberOf(bag["map_revision"]),
        ecosystemRevision: numberOf(bag["ecosystem_revision"]),
        territoriesRevision: textOf(bag["territories_revision"]),
        aliasStamp: textOf(bag["aliase_stempel"]),
    };
}

const NO_STAMPS: Stamps = { mapRevision: null, ecosystemRevision: null, territoriesRevision: null, aliasStamp: null };

/** Die Quellenprüfung: unbrauchbar (kein Objekt, `ok` nicht true, keine Liste) oder leer. Sonst die Liste. */
function usableList(
    payload: unknown,
    file: string,
    listKey: "objekte" | "artikel",
): { list: unknown[]; bag: Bag } | { skip: Finding[]; stamps: Stamps } {
    const bag = isBag(payload) ? payload : null;
    if (bag === null || bag["ok"] !== true || !Array.isArray(bag[listKey])) {
        return {
            skip: [
                createFinding(
                    "source_block_missing",
                    `Die Antwort von ${file} ist unbrauchbar (ok nicht true oder ${listKey} keine Liste); der Teil schreibt nichts und legt nichts still, der Lauf geht weiter`,
                    {
                        grund:
                            bag === null
                                ? "kein Objekt"
                                : bag["ok"] !== true
                                  ? "ok nicht true"
                                  : `${listKey} keine Liste`,
                    },
                ),
            ],
            stamps: NO_STAMPS,
        };
    }
    const list = bag[listKey];
    if (list.length === 0) {
        return {
            skip: [
                createFinding(
                    "source_empty_catalog",
                    `Die Antwort von ${file} nennt keine ${listKey === "artikel" ? "Artikel" : "Objekte"}; der Teil schreibt nichts und legt nichts still (eine leere Liste ist hier nicht „alles entfernt“)`,
                    {},
                ),
            ],
            stamps: stampsOf(bag),
        };
    }
    return { list, bag };
}

const objectOf = (table: string, publicId: string, name: string | null): FindingObject => ({ table, publicId, name });

/** Die Umwandlung von X2, der Zuordnungstafel. */
export function transformAssignments(payload: unknown): AssignmentTransform {
    const source = usableList(payload, "wiki-zuordnung-export.php", "objekte");
    if ("skip" in source) {
        return { skipped: true, rows: [], stamps: source.stamps, withoutAssignment: {}, findings: source.skip };
    }
    const findings: Finding[] = [];
    const rows: AssignmentRow[] = [];
    const seen = new Set<string>();
    const unusable: FindingObject[] = [];
    const withoutKey: FindingObject[] = [];
    const duplicates: FindingObject[] = [];
    const redirects: FindingObject[] = [];
    const noNamespace: FindingObject[] = [];
    const perArt = Object.fromEntries(X2_ARTS.map((art) => [art, 0])) as Record<X2Art, number>;
    let keyless = 0;

    for (const raw of source.list) {
        const object = isBag(raw) ? raw : null;
        const art = object === null ? null : pick(X2_ARTS, object["art"]);
        const publicId = object === null ? null : textOf(object["public_id"]);
        if (object === null || art === null || publicId === null || !UUID.test(publicId)) {
            unusable.push(
                objectOf(
                    "wiki_key_assignment",
                    String(object?.["public_id"] ?? "(fehlt)"),
                    String(object?.["art"] ?? null),
                ),
            );
            continue;
        }
        const id = publicId.toLowerCase();
        const wikiKey = textOf(object["wiki_key"]);
        if (wikiKey === null) {
            keyless += 1;
            perArt[art] += 1;
            withoutKey.push(objectOf("wiki_key_assignment", id, art));
            continue;
        }
        if (seen.has(`${art}|${id}`)) {
            duplicates.push(objectOf("wiki_key_assignment", id, `${art} ${wikiKey}`));
            continue;
        }
        seen.add(`${art}|${id}`);
        perArt[art] += 1;
        const redirect = isBag(object["weiterleitung_auf"]) ? object["weiterleitung_auf"] : null;
        const ns = intOf(object["ns"]);
        const row: AssignmentRow = {
            art,
            publicId: id,
            wikiKey,
            wikiUrl: textOf(object["wiki_url"]),
            wikiTitle: textOf(object["wiki_titel"]),
            ns,
            nsName: ns === null ? null : stringOf(object["ns_name"]),
            isRedirect: redirect !== null,
            redirectTitle: redirect === null ? null : textOf(redirect["titel"]),
            redirectNs: redirect === null ? null : intOf(redirect["ns"]),
            redirectNsName: redirect === null ? null : stringOf(redirect["ns_name"]),
        };
        rows.push(row);
        if (row.isRedirect) redirects.push(objectOf("wiki_key_assignment", id, `${art} ${wikiKey}`));
        if (row.ns === null && row.wikiUrl !== null)
            noNamespace.push(objectOf("wiki_key_assignment", id, `${art} ${wikiKey}`));
    }

    if (unusable.length > 0) {
        findings.push(
            createFinding(
                "x2_object_unusable",
                `${String(unusable.length)} Objekte der Zuordnung ohne bekannte Art oder ohne gültige Kennung; nicht gespeichert`,
                { objekte: unusable.length },
                unusable,
            ),
        );
    }
    if (keyless > 0) {
        findings.push(
            createFinding(
                "x2_object_without_key",
                `${String(keyless)} Objekte tragen eine Zuweisung, aber keinen Key (Legacy: objekte_ohne_schluessel); nicht gespeichert, ein Key wird nicht aus einer Adresse oder einem Namen geraten`,
                { objekte: keyless },
                withoutKey,
            ),
        );
    }
    if (duplicates.length > 0) {
        findings.push(
            createFinding(
                "x2_object_duplicate",
                `${String(duplicates.length)} Objekte kommen in der Zuordnung zweimal vor (gleiche Art und Kennung); die erste Zeile gilt`,
                { objekte: duplicates.length },
                duplicates,
            ),
        );
    }
    if (redirects.length > 0) {
        findings.push(
            createFinding(
                "x2_redirect",
                `${String(redirects.length)} Objekte tragen eine Wiki-Adresse, die eine Weiterleitung ist; der Key ist der der Zielseite (Information)`,
                { objekte: redirects.length },
                redirects,
            ),
        );
    }
    if (noNamespace.length > 0) {
        findings.push(
            createFinding(
                "x2_namespace_unknown",
                `${String(noNamespace.length)} Objekte mit Adresse, deren Namensraum Legacy nicht ermittelt (ns null); er wird nicht aus dem Slug geraten (Information)`,
                { objekte: noNamespace.length },
                noNamespace,
            ),
        );
    }

    // Der Kopf: Legacy zählt je Art die zugewiesenen Objekte (mit und ohne Key) und die ohne Zuweisung.
    const kopf = isBag(source.bag["kopf"]) ? source.bag["kopf"] : {};
    const jeArt = isBag(kopf["je_art"]) ? kopf["je_art"] : {};
    const withoutAssignment: Record<string, number> = {};
    const differences: string[] = [];
    for (const art of X2_ARTS) {
        const entry = isBag(jeArt[art]) ? jeArt[art] : null;
        if (entry === null) continue;
        withoutAssignment[art] = numberOf(entry["ohne_zuweisung"]) ?? 0;
        const claimed = numberOf(entry["zugewiesen"]);
        if (claimed !== null && claimed !== perArt[art]) {
            differences.push(`${art}: Kopf ${String(claimed)}, gelesen ${String(perArt[art])}`);
        }
    }
    const claimedTotal = numberOf(kopf["objekte_mit_zuweisung"]);
    const readTotal = rows.length + keyless;
    if (claimedTotal !== null && claimedTotal !== readTotal) {
        differences.push(`gesamt: Kopf ${String(claimedTotal)}, gelesen ${String(readTotal)}`);
    }
    const distinct = new Set(rows.map((row) => row.wikiKey)).size;
    const claimedKeys = numberOf(kopf["verschiedene_schluessel"]);
    if (claimedKeys !== null && claimedKeys !== distinct) {
        differences.push(`verschiedene Keys: Kopf ${String(claimedKeys)}, gelesen ${String(distinct)}`);
    }
    if (differences.length > 0) {
        findings.push(
            createFinding(
                "x2_kopf_abweichung",
                `Der Kopf der Zuordnung nennt andere Zahlen, als die Objekte tragen (${differences.join("; ")})`,
                { abweichungen: differences.length },
                [],
                0,
                differences,
            ),
        );
    }

    return { skipped: false, rows, stamps: stampsOf(source.bag), withoutAssignment, findings };
}

/** Die Zerlegung eines Links aus X1; `null`, wenn ihm Anzeige, Ziel, Key, Namensraum oder eine bekannte Art fehlt (kein Key wird geraten). */
function linkOf(raw: unknown): Omit<TargetRow, "pageKey" | "field" | "position"> | null {
    if (!isBag(raw)) return null;
    const display = textOf(raw["anzeige"]);
    const target = textOf(raw["ziel"]);
    const key = textOf(raw["ziel_key"]);
    const ns = intOf(raw["ns"]);
    const art = pick(LINK_ARTS, raw["art"]);
    const template = textOf(raw["vorlage"]);
    // Eine Vorlage nennt ihren Namen, ein Wikilink keinen: sonst ist der Eintrag nicht das, was Legacy verspricht.
    if (display === null || target === null || key === null || ns === null || art === null) return null;
    if ((art === "vorlage") !== (template !== null)) return null;
    const redirect = isBag(raw["weiterleitung_auf"]) ? raw["weiterleitung_auf"] : null;
    const redirectNs = redirect === null ? null : intOf(redirect["ns"]);
    return {
        displayText: display,
        linkArt: art,
        linkTemplate: template,
        targetRaw: target,
        targetKey: key,
        targetNs: ns,
        targetNsName: stringOf(raw["ns_name"]) ?? "",
        isRedirect: redirect !== null,
        redirectTitle: redirect === null ? null : textOf(redirect["titel"]),
        redirectNs,
        redirectNsName: redirect === null || redirectNs === null ? null : stringOf(redirect["ns_name"]),
    };
}

/** Ein Abbild des Artikels, mit dem zwei Einträge desselben Keys verglichen werden (sie müssten gleich sein: der Export hat je Key einen). */
const pageSignature = (page: PageRow, targets: readonly TargetRow[]): string =>
    JSON.stringify([
        page.pageTitle,
        page.pageKind,
        page.ns,
        page.nsName,
        targets.map((t) => [
            t.field,
            t.position,
            t.displayText,
            t.linkArt,
            t.targetRaw,
            t.targetKey,
            t.targetNs,
            t.isRedirect,
        ]),
    ]);

/**
 * Die Umwandlung von X1, den Linkzielen je ARTIKEL: eine Seite je Key, ihre Links in der Reihenfolge des Quelltextes. Welche Objekte der Karte an einem
 * Artikel hängen, steht nicht hier, sondern in X2 (Betreiber 2026-10-05: „X1 je Artikel ja“).
 */
export function transformLinkTargets(payload: unknown): LinkTransform {
    const source = usableList(payload, "wiki-linkziele-export.php", "artikel");
    if ("skip" in source) {
        return { skipped: true, pages: [], targets: [], missing: [], stamps: source.stamps, findings: source.skip };
    }
    const findings: Finding[] = [];
    const pages: PageRow[] = [];
    const targets: TargetRow[] = [];
    const signatureOf = new Map<string, string>();
    const unusable: FindingObject[] = [];
    const brokenLinks: FindingObject[] = [];
    const duplicates: FindingObject[] = [];
    const unknownFields = new Map<string, number>();
    let brokenLinkCount = 0;

    for (const raw of source.list) {
        const article = isBag(raw) ? raw : null;
        const kind = article === null ? null : pick(PAGE_KINDS, article["seite_art"]);
        const key = article === null ? null : textOf(article["wiki_key"]);
        const title = article === null ? null : textOf(article["seite_titel"]);
        const ns = article === null ? null : intOf(article["ns"]);
        if (
            article === null ||
            kind === null ||
            key === null ||
            title === null ||
            ns === null ||
            !isBag(article["felder"])
        ) {
            unusable.push(
                objectOf(
                    "wiki_link_page",
                    String(article?.["wiki_key"] ?? "(fehlt)"),
                    String(article?.["seite_titel"] ?? null),
                ),
            );
            continue;
        }
        const page: PageRow = {
            pageKey: key,
            pageTitle: title,
            pageKind: kind,
            ns,
            nsName: stringOf(article["ns_name"]) ?? "",
        };
        const rows: TargetRow[] = [];
        for (const [field, list] of Object.entries(article["felder"])) {
            if (!Array.isArray(list)) continue;
            if (!KNOWN_FIELDS[kind].includes(field)) {
                unknownFields.set(`${kind}.${field}`, (unknownFields.get(`${kind}.${field}`) ?? 0) + 1);
            }
            let position = 0;
            for (const entry of list) {
                const link = linkOf(entry);
                if (link === null) {
                    brokenLinkCount += 1;
                    if (brokenLinks.length < 200)
                        brokenLinks.push(objectOf("wiki_link_target", key, `${title} / ${field}`));
                    continue;
                }
                rows.push({ pageKey: key, field, position, ...link });
                position += 1;
            }
        }
        // Der Export führt je Key EINEN Artikel. Käme er doppelt (ein Fehler in Legacy), gilt der erste, der zweite wird gemeldet.
        const signature = pageSignature(page, rows);
        if (signatureOf.has(key)) {
            duplicates.push(
                objectOf(
                    "wiki_link_page",
                    key,
                    `${title}${signatureOf.get(key) === signature ? "" : " (anderer Inhalt)"}`,
                ),
            );
            continue;
        }
        signatureOf.set(key, signature);
        pages.push(page);
        targets.push(...rows);
    }

    if (unusable.length > 0) {
        findings.push(
            createFinding(
                "x1_article_unusable",
                `${String(unusable.length)} Artikel der Linkziele ohne Key, Seitenart, Titel, Namensraum oder Felder; nicht gespeichert`,
                { artikel: unusable.length },
                unusable,
            ),
        );
    }
    if (brokenLinkCount > 0) {
        findings.push(
            createFinding(
                "x1_link_unusable",
                `${String(brokenLinkCount)} Links ohne Anzeigetext, Ziel, Key, Namensraum oder mit unbekannter Art (wikilink, vorlage mit Namen); nicht gespeichert, kein Key wird geraten`,
                { links: brokenLinkCount },
                brokenLinks,
                brokenLinkCount,
            ),
        );
    }
    if (duplicates.length > 0) {
        findings.push(
            createFinding(
                "x1_article_duplicate",
                `${String(duplicates.length)} Artikel stehen in den Linkzielen unter demselben Key mehrfach (der Export führt je Key einen); der erste gilt`,
                { artikel: duplicates.length },
                duplicates,
            ),
        );
    }
    if (unknownFields.size > 0) {
        findings.push(
            createFinding(
                "x1_field_unknown",
                `${String(unknownFields.size)} Felder stehen nicht in Legacys Positivliste, die dieser Vertrag kennt; gespeichert wie geliefert, ein Leser kennt sie nicht (Information)`,
                { felder: unknownFields.size },
                [],
                0,
                [...unknownFields].map(([name, count]) => `${name}: ${String(count)} Artikel`),
            ),
        );
    }

    const bag = source.bag;
    // Schlüssel, deren Seite der Dump-Lauf nicht trägt: Sie haben keine Linkziele, und ihre Felder bleiben Text (nicht als leere Felder geliefert).
    const missing: MissingArticle[] = [];
    for (const entry of Array.isArray(bag["ohne_wikitext"]) ? bag["ohne_wikitext"] : []) {
        const item = isBag(entry) ? entry : {};
        const wikiKey = textOf(item["wiki_key"]);
        if (wikiKey === null) continue;
        missing.push({
            wikiKey,
            reason: textOf(item["grund"]) ?? "unbekannt",
            objects: numberOf(item["objekte"]) ?? 0,
        });
    }
    if (missing.length > 0) {
        const reasons = new Map<string, number>();
        for (const entry of missing) reasons.set(entry.reason, (reasons.get(entry.reason) ?? 0) + 1);
        findings.push(
            createFinding(
                "x1_ohne_wikitext",
                `${String(missing.length)} zugewiesene Keys ohne Wikitext im Dump-Lauf (Legacy: ohne_wikitext, ${String(missing.reduce((sum, entry) => sum + entry.objects, 0))} Objekte); sie haben keine Linkziele, ihre Felder bleiben Text (Information)`,
                Object.fromEntries(reasons),
                missing.map((entry) =>
                    objectOf("wiki_link_page", entry.wikiKey, `${entry.reason}, ${String(entry.objects)} Objekte`),
                ),
                missing.length,
            ),
        );
    }
    const kopf = isBag(bag["kopf"]) ? bag["kopf"] : {};
    const templates = isBag(kopf["vorlagen_in_feldern"]) ? kopf["vorlagen_in_feldern"] : {};
    const templateNumbers = Object.fromEntries(
        Object.entries(templates).flatMap(([name, count]) =>
            typeof count === "number" ? [[name, count] as const] : [],
        ),
    );
    const templateTotal = Object.values(templateNumbers).reduce((sum, count) => sum + count, 0);
    if (templateTotal > 0) {
        findings.push(
            createFinding(
                "x1_vorlagen_keine_links",
                `${String(templateTotal)} andere Vorlagen in befüllten Feldern ({{Reichsstadt|…}}, {{Pol|…}} außerhalb des Feldes Staat) sind in Legacy keine Links und bleiben Text; nur {{Pol|X}} im Staat und {{Reg|X}} in der Region zählen (Information)`,
                templateNumbers,
            ),
        );
    }
    const collisions = numberOf(kopf["seiten_schluesselkollision"]);
    if (collisions !== null && collisions > 0) {
        findings.push(
            createFinding(
                "x1_schluesselkollision",
                `${String(collisions)} Seiten des Dump-Laufs teilen einen Key mit einer anderen (die Faltung der Umlaute ist verlustbehaftet); Information aus Legacys Kopf`,
                { seiten: collisions },
            ),
        );
    }

    // Der Kopf zählt je ARTIKEL: gegen die gelesenen Seiten gehalten.
    const counted = isBag(kopf["artikel"]) ? kopf["artikel"] : null;
    if (counted !== null) {
        const fieldsWithLinks = new Set(targets.map((target) => `${target.pageKey}|${target.field}`)).size;
        const readValues: Record<string, number> = {
            mit_wikitext: pages.length,
            felder_mit_link: fieldsWithLinks,
            links_gesamt: targets.length,
            links_pipe: targets.filter((target) => target.displayText !== target.targetRaw).length,
            links_vorlage: targets.filter((target) => target.linkArt === "vorlage").length,
            ziele_verschieden: new Set(targets.map((target) => target.targetKey)).size,
        };
        const differences = Object.entries(readValues).flatMap(([name, value]) => {
            const claimed = numberOf(counted[name]);
            return claimed !== null && claimed !== value
                ? [`${name}: Kopf ${String(claimed)}, gelesen ${String(value)}`]
                : [];
        });
        if (differences.length > 0) {
            findings.push(
                createFinding(
                    "x1_kopf_abweichung",
                    `Der Kopf der Linkziele nennt andere Zahlen, als die Artikel tragen (${differences.join("; ")})`,
                    { abweichungen: differences.length },
                    [],
                    0,
                    differences,
                ),
            );
        }
    }

    return { skipped: false, pages, targets, missing, stamps: stampsOf(bag), findings };
}

/**
 * Die zwei Antworten eines Zuges gegeneinander: Sie sind aus demselben Legacy-Stand gerechnet, wenn ihre Stempel gleich sind. Und die Artikel von X1
 * hängen an Keys, die X2 den Objekten zuweist: Ein Artikel, dessen Key kein Objekt der Zuordnung trägt, oder ein Key der Zuordnung (außer Gebiete: X1 führt
 * keine Gebiets-Infobox), für den X1 weder einen Artikel noch einen `ohne_wikitext`-Eintrag nennt, deutet auf zwei verschiedene Stände. Beides sind Befunde
 * (Information), nie ein Tor: Legacy wird zwischen den zwei Abrufen redigiert.
 */
export function crossFindings(links: LinkTransform, assignments: AssignmentTransform): Finding[] {
    if (links.skipped || assignments.skipped) return [];
    const findings: Finding[] = [];
    const a = links.stamps;
    const b = assignments.stamps;
    const names = ["mapRevision", "ecosystemRevision", "territoriesRevision", "aliasStamp"] as const;
    const differing = names.filter((name) => a[name] !== b[name]);
    if (differing.length > 0) {
        findings.push(
            createFinding(
                "x1_x2_stand",
                `Linkziele und Zuordnung tragen verschiedene Stände (${differing.map((name) => `${name}: ${String(a[name])} gegen ${String(b[name])}`).join("; ")}); Legacy wurde zwischen den Abrufen redigiert, der Zug geht weiter (Information)`,
                Object.fromEntries(differing.map((name) => [name, `${String(a[name])} / ${String(b[name])}`])),
            ),
        );
    }
    const assignedKeys = new Set(assignments.rows.map((row) => row.wikiKey));
    const pageKeys = new Set(links.pages.map((page) => page.pageKey));
    const missingKeys = new Set(links.missing.map((entry) => entry.wikiKey));
    const orphanPages = links.pages.filter((page) => !assignedKeys.has(page.pageKey));
    if (orphanPages.length > 0) {
        findings.push(
            createFinding(
                "x1_article_not_in_x2",
                `${String(orphanPages.length)} Artikel der Linkziele tragen einen Key, den die Zuordnung keinem Objekt zuweist; der Artikel bleibt gespeichert, ein Objekt findet ihn nicht (Information)`,
                { artikel: orphanPages.length },
                orphanPages.map((page) => objectOf("wiki_link_page", page.pageKey, page.pageTitle)),
            ),
        );
    }
    const unread = [
        ...new Set(
            assignments.rows
                .filter((row) => row.art !== "gebiet" && !pageKeys.has(row.wikiKey) && !missingKeys.has(row.wikiKey))
                .map((row) => row.wikiKey),
        ),
    ];
    if (unread.length > 0) {
        findings.push(
            createFinding(
                "x2_key_without_article",
                `${String(unread.length)} Keys der Zuordnung (ohne Gebiete) haben in den Linkzielen weder einen Artikel noch einen ohne_wikitext-Eintrag; ihre Felder bleiben Text (Information)`,
                { keys: unread.length },
                unread.map((key) => objectOf("wiki_key_assignment", key, null)),
            ),
        );
    }
    return findings;
}
