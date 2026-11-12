import { createFinding, type Finding, type FindingObject } from "../findings.ts";
import { normalizeCreatedAt } from "./reviews.ts";

/**
 * Die reine Umwandlung von Legacys Export der Wiki-Siedlungsregistry (X3, `wiki-siedlungen-export.php`, WI-0128 E4, Betreiberentscheid
 * 2026-10-10 „A“, Anfrage `project-control/legacy-requests/2026-10-10-wiki-siedlungsregistry-export.md`). Kein Datenbankzugriff, kein Abruf.
 *
 * 🔴 SCHLÜSSEL STATT NAMEN: `wiki_key` kommt wörtlich aus Legacy, gerechnet durch DIESELBE Funktion wie X1 `ziel_key` und X2 `wiki_key`
 * (Titel → Weiterleitungstafel → `wiki:` + Slug). Hier wird kein Key gerechnet, geändert oder aus einem Titel geraten; eine Zeile ohne Key
 * wird nicht gespeichert. Ob eine Siedlung auf der Karte liegt, steht NICHT in der Tabelle: das fragt der Leser über denselben Key gegen
 * X2 (`apps/server/src/editor/wiki-settlement-rows.ts`). Legacys `orte` (dieselbe Regel wie X2) und `legacy_auf_karte` (Legacys
 * NAMENSurteil der Ortsliste) reisen als `evidence` mit: für Befunde und den Prüfer, nie als gespeicherte Aussage.
 *
 * 🔴 Seit WI-0134 trägt X3 je Zeile `standort_links` (`[{ziel, ziel_key}]`): die Linkziele der rohen `standort`-Kette samt Legacys Key.
 * Sie werden als GENANNTE ORTE übernommen (Evidenz), nie als Beziehung „innerorts“ (Betreiber 2026-10-10: „Ein Link auf einen Ort bedeutet
 * nicht automatisch innerorts“). Kein Key wird gerechnet; ein Ziel ohne Key bleibt ohne. Trägt keine Zeile das Feld (X3 vor WI-0134),
 * bleiben die gespeicherten genannten Orte, wie sie sind (`linksDelivered` falsch, Befund `x3_ohne_standort_links`).
 *
 * 🔴 Quellenprüfung ohne neues Tor (Betreiber 2026-10-03): Ist die Antwort unbrauchbar (`ok` nicht true, `siedlungen` keine Liste) oder
 * leer, schreibt der Schritt nichts und legt nichts still (`source_block_missing`, `source_empty_catalog`); der Zug geht weiter. Alles
 * andere sind Befunde.
 */

export const WIKI_SETTLEMENTS_CONTRACT_VERSION = "0";

/** Legacys Ortsklassen (`AVESMAPS_ORTSKLASSEN`, api/_internal/ortsklassen.php), groß nach klein: genau die Klassen, die X3 liefert. */
export const SETTLEMENT_CLASSES = [
    "metropole",
    "grossstadt",
    "stadt",
    "kleinstadt",
    "dorf",
    "gebaeude",
    "stadtviertel",
] as const;

export interface WikiSettlementRow {
    wikiKey: string;
    title: string;
    ns: number | null;
    nsName: string | null;
    isRedirect: boolean;
    redirectTitle: string | null;
    redirectNs: number | null;
    redirectNsName: string | null;
    wikiUrl: string | null;
    settlementClass: string;
    settlementLabel: string | null;
    buildingType: string | null;
    buildingTypeExcluded: boolean;
    isRuined: boolean | null;
    continent: string | null;
    lage: string | null;
    standort: string | null;
    hasCoat: boolean;
    /** Naiv, `YYYY-MM-DDTHH:MM:SS.mmm` (Legacys Zeit ohne Zone, wie die Datenbank sie liest). */
    wikiFetchedAt: string | null;
    wikiEnrichedAt: string | null;
}

/** Was Legacy je gespeicherter Zeile außerdem sagt, ohne dass es gespeichert wird. */
export interface WikiSettlementEvidence {
    wikiKey: string;
    title: string;
    /** Die Kennungen der aktiven Orte, deren Nest auf den Key zeigt (Legacys Regel von X2). */
    places: string[];
    /** Legacys Ortsliste hält die Zeile für „auf der Karte“ - per NAMEN (Kartenname oder Titel des Nests). */
    legacyOnMap: boolean;
}

/** Ein Linkziel der `standort`-Kette, wie X3 es nennt. */
export interface WikiSettlementLink {
    position: number;
    targetRaw: string;
    /** Legacys Key; `null` heißt: Legacy nennt keinen. */
    targetKey: string | null;
}

export interface WikiSettlementStamps {
    mapRevision: number | null;
    aliasStamp: string | null;
    registryRevision: string | null;
}

export interface WikiSettlementCounts {
    /** Zeilen der Antwort. */
    delivered: number;
    stored: number;
    withoutKey: number;
    duplicateKeys: number;
    unusable: number;
    /** Gespeicherte Zeilen, denen Legacy einen Ort zuweist. */
    withPlace: number;
    /** Gespeicherte Zeilen, die Legacys Ortsliste ausblendet (lineare Infrastruktur). */
    excluded: number;
    /** Legacys Zahl „Fehlt“: nicht ausgeblendet und per Namen nicht auf der Karte. */
    legacyMissing: number;
}

export interface WikiSettlementTransform {
    skipped: boolean;
    rows: WikiSettlementRow[];
    /** Key der gespeicherten Zeile → ihre Linkziele (auch leer). Nur gefüllt, wenn `linksDelivered`. */
    links: Map<string, WikiSettlementLink[]>;
    /** Die Antwort trägt `standort_links` (X3 seit WI-0134). */
    linksDelivered: boolean;
    evidence: WikiSettlementEvidence[];
    stamps: WikiSettlementStamps;
    counts: WikiSettlementCounts;
    findings: Finding[];
}

type Bag = Record<string, unknown>;

const isBag = (value: unknown): value is Bag => typeof value === "object" && value !== null && !Array.isArray(value);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Ein nichtleerer Text, wörtlich; sonst `null` (Legacy liefert Leeres als null, ein Leerstring hieße dasselbe). */
const textOf = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value : null);
const intOf = (value: unknown): number | null => (typeof value === "number" && Number.isInteger(value) ? value : null);
const stringOf = (value: unknown): string | null => (typeof value === "string" ? value : null);
const boolOf = (value: unknown): boolean | null => (typeof value === "boolean" ? value : null);

const EMPTY_COUNTS: WikiSettlementCounts = {
    delivered: 0,
    stored: 0,
    withoutKey: 0,
    duplicateKeys: 0,
    unusable: 0,
    withPlace: 0,
    excluded: 0,
    legacyMissing: 0,
};

const NO_STAMPS: WikiSettlementStamps = { mapRevision: null, aliasStamp: null, registryRevision: null };

const SOURCE = "wiki-siedlungen-export.php";

const objectOf = (publicId: string, name: string | null): FindingObject => ({
    table: "wiki_settlement_registry",
    publicId,
    name,
});

function stampsOf(bag: Bag): WikiSettlementStamps {
    return {
        mapRevision: intOf(bag["map_revision"]),
        aliasStamp: textOf(bag["aliase_stempel"]),
        registryRevision: textOf(bag["registry_revision"]),
    };
}

function skip(findings: Finding[], stamps: WikiSettlementStamps = NO_STAMPS): WikiSettlementTransform {
    return {
        skipped: true,
        rows: [],
        links: new Map(),
        linksDelivered: false,
        evidence: [],
        stamps,
        counts: { ...EMPTY_COUNTS },
        findings,
    };
}

/** Eine Adresse geht als href an den Leser: nur http und https (wie die CHECK-Bedingung der Tabelle). */
const httpOnly = (value: string | null): string | null =>
    value !== null && /^https?:\/\//i.test(value) ? value : null;

/** Die Umwandlung von X3. */
export function transformWikiSettlements(payload: unknown): WikiSettlementTransform {
    const bag = isBag(payload) ? payload : null;
    if (bag === null || bag["ok"] !== true || !Array.isArray(bag["siedlungen"])) {
        return skip([
            createFinding(
                "source_block_missing",
                `Die Antwort von ${SOURCE} ist unbrauchbar (ok nicht true oder siedlungen keine Liste); der Schritt schreibt nichts und legt nichts still, der Lauf geht weiter`,
                {
                    datei: SOURCE,
                    grund:
                        bag === null ? "kein Objekt" : bag["ok"] !== true ? "ok nicht true" : "siedlungen keine Liste",
                },
            ),
        ]);
    }
    const list = bag["siedlungen"] as unknown[];
    if (list.length === 0) {
        return skip(
            [
                createFinding(
                    "source_empty_catalog",
                    `Die Antwort von ${SOURCE} nennt keine Siedlung; der Schritt schreibt nichts und legt nichts still (eine leere Liste ist hier nicht „alles entfernt“)`,
                    { datei: SOURCE },
                ),
            ],
            stampsOf(bag),
        );
    }

    const rows: WikiSettlementRow[] = [];
    const links = new Map<string, WikiSettlementLink[]>();
    // Das Feld fehlt in jeder Zeile: X3 vor WI-0134. Dann wird an den genannten Orten nichts geändert.
    const linksDelivered = list.some((raw) => isBag(raw) && Array.isArray(raw["standort_links"]));
    let brokenLinks = 0;
    const evidence: WikiSettlementEvidence[] = [];
    const counts: WikiSettlementCounts = { ...EMPTY_COUNTS, delivered: list.length };
    const seen = new Map<string, string>();
    const unusable: FindingObject[] = [];
    const withoutKey: FindingObject[] = [];
    const duplicates: FindingObject[] = [];
    const unknownClasses = new Map<string, number>();
    const droppedUrls: FindingObject[] = [];
    const unreadableTimes: FindingObject[] = [];
    const badPlaces: FindingObject[] = [];
    const nameOnly: FindingObject[] = [];

    for (const raw of list) {
        const item = isBag(raw) ? raw : null;
        const title = item === null ? null : textOf(item["titel"]);
        const settlementClass = item === null ? null : textOf(item["ortsklasse"]);
        if (item === null || title === null || settlementClass === null) {
            counts.unusable += 1;
            unusable.push(objectOf(String(item?.["wiki_key"] ?? "(fehlt)"), title));
            continue;
        }
        const wikiKey = textOf(item["wiki_key"]);
        if (wikiKey === null) {
            counts.withoutKey += 1;
            withoutKey.push(objectOf("(ohne Key)", title));
            continue;
        }
        const first = seen.get(wikiKey);
        if (first !== undefined) {
            counts.duplicateKeys += 1;
            duplicates.push(objectOf(wikiKey, `${title} (gilt: ${first})`));
            continue;
        }
        seen.set(wikiKey, title);

        if (!(SETTLEMENT_CLASSES as readonly string[]).includes(settlementClass)) {
            unknownClasses.set(settlementClass, (unknownClasses.get(settlementClass) ?? 0) + 1);
        }
        const rawUrl = textOf(item["wiki_url"]);
        const wikiUrl = httpOnly(rawUrl);
        if (rawUrl !== null && wikiUrl === null) droppedUrls.push(objectOf(wikiKey, title));
        const time = (key: string): string | null => {
            const value = item[key];
            if (value === null || value === undefined) return null;
            const parsed = normalizeCreatedAt(value);
            if (parsed === null) unreadableTimes.push(objectOf(wikiKey, `${title} (${key})`));
            return parsed;
        };
        const redirect = isBag(item["weiterleitung_auf"]) ? item["weiterleitung_auf"] : null;
        const ns = intOf(item["ns"]);
        const redirectNs = redirect === null ? null : intOf(redirect["ns"]);
        const row: WikiSettlementRow = {
            wikiKey,
            title,
            ns,
            nsName: ns === null ? null : stringOf(item["ns_name"]),
            isRedirect: redirect !== null,
            redirectTitle: redirect === null ? null : textOf(redirect["titel"]),
            redirectNs,
            redirectNsName: redirect === null || redirectNs === null ? null : stringOf(redirect["ns_name"]),
            wikiUrl,
            settlementClass,
            settlementLabel: textOf(item["ortsklasse_label"]),
            buildingType: textOf(item["bauwerkstyp"]),
            buildingTypeExcluded: item["bauwerkstyp_ausgeschlossen"] === true,
            isRuined: boolOf(item["ist_ruine"]),
            continent: textOf(item["kontinent"]),
            lage: textOf(item["lage"]),
            standort: textOf(item["standort"]),
            hasCoat: item["hat_wappen"] === true,
            wikiFetchedAt: time("abgerufen_am"),
            wikiEnrichedAt: time("angereichert_am"),
        };
        rows.push(row);
        if (linksDelivered) {
            const chain: WikiSettlementLink[] = [];
            for (const link of Array.isArray(item["standort_links"]) ? item["standort_links"] : []) {
                const target = isBag(link) ? textOf(link["ziel"]) : null;
                if (target === null) {
                    brokenLinks += 1;
                    continue;
                }
                chain.push({ position: chain.length, targetRaw: target, targetKey: textOf(link["ziel_key"]) });
            }
            links.set(wikiKey, chain);
        }

        const places: string[] = [];
        for (const place of Array.isArray(item["orte"]) ? item["orte"] : []) {
            if (typeof place === "string" && UUID.test(place)) places.push(place.toLowerCase());
            else badPlaces.push(objectOf(wikiKey, `${title}: ${String(place)}`));
        }
        const legacyOnMap = item["legacy_auf_karte"] === true;
        evidence.push({ wikiKey, title, places, legacyOnMap });
        if (places.length > 0) counts.withPlace += 1;
        if (row.buildingTypeExcluded) counts.excluded += 1;
        if (!row.buildingTypeExcluded && !legacyOnMap) counts.legacyMissing += 1;
        // 🔴 Legacys Liste hält die Zeile per NAMEN für platziert, aber kein Ort trägt ihren Key: bei uns steht sie unter „Fehlt“.
        if (!row.buildingTypeExcluded && legacyOnMap && places.length === 0) nameOnly.push(objectOf(wikiKey, title));
    }
    counts.stored = rows.length;

    const findings: Finding[] = [];
    if (unusable.length > 0) {
        findings.push(
            createFinding(
                "x3_zeile_unbrauchbar",
                `${String(unusable.length)} Zeilen der Wiki-Siedlungen ohne Titel oder Ortsklasse; nicht gespeichert`,
                { zeilen: unusable.length },
                unusable,
            ),
        );
    }
    if (withoutKey.length > 0) {
        findings.push(
            createFinding(
                "x3_ohne_schluessel",
                `${String(withoutKey.length)} Wiki-Siedlungen tragen keinen Key (Legacy: ohne_schluessel); nicht gespeichert, ein Key wird nicht aus dem Titel geraten`,
                { zeilen: withoutKey.length },
                withoutKey,
            ),
        );
    }
    if (duplicates.length > 0) {
        findings.push(
            createFinding(
                "x3_schluessel_doppelt",
                `${String(duplicates.length)} Wiki-Siedlungen teilen ihren Key mit einer früheren Zeile (Weiterleitung oder verlustbehaftete Faltung der Umlaute); die erste nach Titel gilt`,
                { zeilen: duplicates.length },
                duplicates,
            ),
        );
    }
    if (unknownClasses.size > 0) {
        findings.push(
            createFinding(
                "x3_klasse_unbekannt",
                `${String(unknownClasses.size)} Ortsklassen stehen nicht in Legacys Liste der Ortsklassen, die dieser Vertrag kennt; gespeichert wie geliefert (Information)`,
                Object.fromEntries(unknownClasses),
            ),
        );
    }
    if (droppedUrls.length > 0) {
        findings.push(
            createFinding(
                "link_scheme_rejected",
                `${String(droppedUrls.length)} Wiki-Siedlungen nennen eine Adresse ohne http oder https; sie wird nicht gespeichert (die Zeile schon)`,
                { zeilen: droppedUrls.length },
                droppedUrls,
            ),
        );
    }
    if (unreadableTimes.length > 0) {
        findings.push(
            createFinding(
                "x3_zeit_unlesbar",
                `${String(unreadableTimes.length)} Zeitangaben (abgerufen_am, angereichert_am) sind kein Kalenderzeitpunkt; gespeichert als NULL`,
                { werte: unreadableTimes.length },
                unreadableTimes,
            ),
        );
    }
    if (badPlaces.length > 0) {
        findings.push(
            createFinding(
                "x3_ort_kennung_unbrauchbar",
                `${String(badPlaces.length)} Einträge in \`orte\` sind keine UUID; sie zählen nicht (Information)`,
                { eintraege: badPlaces.length },
                badPlaces,
            ),
        );
    }
    if (nameOnly.length > 0) {
        findings.push(
            createFinding(
                "registry_nur_per_name_platziert",
                `${String(nameOnly.length)} Wiki-Siedlungen hält Legacys Ortsliste per NAMEN für platziert (gleichnamiger Ort oder Titel eines Nests), aber kein Ort trägt ihren Key: in Avesmaps3D stehen sie unter „Fehlt“ (Wiki-Keys statt Namen; Information)`,
                { zeilen: nameOnly.length },
                nameOnly,
            ),
        );
    }
    if (!linksDelivered) {
        findings.push(
            createFinding(
                "x3_ohne_standort_links",
                "Die Wiki-Siedlungen tragen keine Linkziele der Standortkette (X3 vor WI-0134); die genannten Orte bleiben, wie sie sind (Information)",
                { datei: SOURCE },
            ),
        );
    }
    if (brokenLinks > 0) {
        findings.push(
            createFinding(
                "x3_linkziel_unbrauchbar",
                `${String(brokenLinks)} Linkziele der Standortkette ohne Ziel; nicht gespeichert (Information)`,
                { linkziele: brokenLinks },
            ),
        );
    }
    findings.push(...headFindings(bag, list));
    return { skipped: false, rows, links, linksDelivered, evidence, stamps: stampsOf(bag), counts, findings };
}

/**
 * Der Kopf zählt selbst, über ALLE gelieferten Zeilen (auch die, die hier als doppelter Key oder ohne Key nicht gespeichert werden):
 * gegen eine eigene Zählung derselben Liste gehalten (Information, kein Tor).
 */
function headFindings(bag: Bag, list: readonly unknown[]): Finding[] {
    const kopf = isBag(bag["kopf"]) ? bag["kopf"] : null;
    if (kopf === null) return [];
    const items = list.filter(isBag);
    const tally = (predicate: (item: Bag) => boolean): number => items.filter(predicate).length;
    const read: Record<string, number> = {
        siedlungen: list.length,
        ohne_schluessel: tally((item) => textOf(item["wiki_key"]) === null),
        verschiedene_schluessel: new Set(items.map((item) => textOf(item["wiki_key"])).filter((key) => key !== null))
            .size,
        mit_ort: tally((item) => Array.isArray(item["orte"]) && item["orte"].length > 0),
        legacy_auf_karte: tally((item) => item["legacy_auf_karte"] === true),
        bauwerkstyp_ausgeschlossen: tally((item) => item["bauwerkstyp_ausgeschlossen"] === true),
    };
    read["ohne_ort"] = list.length - (read["mit_ort"] ?? 0);
    const chains = items.flatMap((item) => (Array.isArray(item["standort_links"]) ? item["standort_links"] : []));
    read["standort_linkziele"] = chains.length;
    read["standort_linkziele_ohne_schluessel"] = chains.filter(
        (link) => !isBag(link) || textOf(link["ziel_key"]) === null,
    ).length;
    const differences = Object.entries(read).flatMap(([name, value]) => {
        const claimed = intOf(kopf[name]);
        return claimed !== null && claimed !== value
            ? [`${name}: Kopf ${String(claimed)}, gelesen ${String(value)}`]
            : [];
    });
    const perClass = isBag(kopf["je_klasse"]) ? kopf["je_klasse"] : {};
    for (const settlementClass of SETTLEMENT_CLASSES) {
        const claimed = intOf(perClass[settlementClass]);
        const value = tally((item) => item["ortsklasse"] === settlementClass);
        if (claimed !== null && claimed !== value) {
            differences.push(`je_klasse.${settlementClass}: Kopf ${String(claimed)}, gelesen ${String(value)}`);
        }
    }
    if (differences.length === 0) return [];
    return [
        createFinding(
            "x3_kopf_abweichung",
            `Der Kopf der Wiki-Siedlungen nennt andere Zahlen, als die Zeilen tragen (${differences.join("; ")})`,
            { abweichungen: differences.length },
            [],
            0,
            differences,
        ),
    ];
}

/**
 * X3 gegen X2 desselben Zuges: Beide Antworten tragen `map_revision` und `aliase_stempel` aus DERSELBEN Funktion in Legacy. Weichen sie ab,
 * wurde Legacy zwischen den Abrufen redigiert, und Legacys `orte` und unsere Zuordnung aus X2 können auseinanderlaufen (Information).
 */
export function crossStampFindings(stamps: WikiSettlementStamps, zuordnung: unknown): Finding[] {
    if (!isBag(zuordnung) || zuordnung["ok"] !== true) return [];
    const theirs = { mapRevision: intOf(zuordnung["map_revision"]), aliasStamp: textOf(zuordnung["aliase_stempel"]) };
    const differing = (["mapRevision", "aliasStamp"] as const).filter((name) => stamps[name] !== theirs[name]);
    if (differing.length === 0) return [];
    return [
        createFinding(
            "x3_x2_stand",
            `Wiki-Siedlungen und Wiki-Zuordnung tragen verschiedene Stände (${differing.map((name) => `${name}: ${String(stamps[name])} gegen ${String(theirs[name])}`).join("; ")}); Legacy wurde zwischen den Abrufen redigiert, der Zug geht weiter (Information)`,
            Object.fromEntries(differing.map((name) => [name, `${String(stamps[name])} / ${String(theirs[name])}`])),
        ),
    ];
}
