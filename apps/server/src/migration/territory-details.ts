import { createFinding, type Finding, type FindingObject } from "../findings.ts";
import {
    coatRightsOutcome,
    planCoat,
    readCoat,
    type CoatNote,
    type CoatPlan,
    type CoatReadProblem,
} from "./territory-coat.ts";

/**
 * Die Gebietsdetails und der Wappenzustand aus Legacys Gebietsexport (Export E4, Objekte `detail`, `detail_overrides` und `coat` je
 * Gebiet), übersetzt in das Zielmodell (WI-0063 P3, Vertrag `territory-details.yaml`, Migration 0076). REINE Umwandlung ohne Datenbank:
 * derselbe Code füttert den Import und den Prüfer. Die Datei ist dieselbe wie bei I14 (`legacy-political-territories.json`), kein neuer
 * Abruf.
 *
 *   detail            die 17 wirksamen Felder der Infobox, Override vor Wiki-Text: ein Text, `""` für einen BEWUSST leeren Override
 *                     (er verdeckt den Wiki-Wert), `null` für „kein Wert“
 *   detail_overrides  die Felder, deren Wert aus dem Override stammt, auch die leeren: daraus folgt die Herkunft je Feld
 *   coat              der Wappenzustand (siehe `territory-coat.ts`), hier nur durchgerechnet, nie geschrieben
 *
 * Herkunft je Feld (die echte Antwort trägt sie als Liste, nicht als Marker je Feld): im Satz `detail_overrides` → `override`; ein Text
 * außerhalb davon → `wiki`; `null` → kein Wert und kein Vermerk. Ein `""` außerhalb des Satzes ist nach Legacys Regel unmöglich und wird
 * als „kein Wert“ gespeichert (Befund `detail_empty_without_override`). Fehlt die Liste ganz (älterer Export), gilt ein leerer Wert als
 * Override und ein Text hat KEINEN Vermerk (Befund `detail_origin_not_delivered`): „nicht bekannt“ ist nie `wiki`.
 *
 * Der WIKI-SCHNAPPSCHUSS (WI-0209, Migration 0162, F24/G6) entsteht aus denselben Feldern: je Gebiet mit Wiki-Artikel (`wiki:…` am Gebiet
 * in Avesmaps3D) eine Zeile; Herkunft `wiki` gibt den Wiki-Wert, `override` (auch der bewusste Leerwert) und ein Text ohne bekannte Herkunft
 * „unbekannt“ (Legacy liefert den Wiki-Wert hinter einem Override nie), `null` „das Wiki kennt nichts“. Ein eigener Knoten hat keinen.
 *
 * 🔴 Nichts hier hält den Lauf an (Betreiber 2026-10-03). Trägt kein Gebiet das Objekt `detail` (älterer Export), entfällt dieser Teil
 * ohne Schreiben und ohne Stilllegen (`source_block_missing`); dasselbe gilt für `coat`. Reste von Wikimarkup, bewusste Leerwerte und
 * jede andere Auffälligkeit sind Befunde, nichts wird repariert (Cutoff-Regel).
 */

export const TERRITORY_DETAILS_CONTRACT_VERSION = "1";

/** Die 17 Felder in der Reihenfolge der Antwort (`detail.felder.liste` des Vertrags, ohne name, type, status, wiki_url). */
export const DETAIL_FIELDS = [
    "continent",
    "founded_text",
    "dissolved_text",
    "form_of_government",
    "capital_name",
    "seat_name",
    "ruler",
    "language",
    "currency",
    "population",
    "founder",
    "political",
    "trade_zone",
    "trade_goods",
    "geographic",
    "blazon",
    "affiliation_raw",
] as const;
export type DetailField = (typeof DETAIL_FIELDS)[number];
export type DetailOrigin = "override" | "wiki";

/** Ein Gebiet in Avesmaps3D, wie die Zuordnung es braucht. */
export interface DetailTerritory {
    id: string;
    publicId: string;
    name: string;
    active: boolean;
    /** `territory.wiki_key`: Mit `wiki:…` bekommt das Gebiet einen Wiki-Schnappschuss (Migration 0162); fehlt ohne. */
    wikiKey?: string | null;
}

/** Kennung (klein geschrieben) → Gebiet. */
export type TerritoryDetailIndex = ReadonlyMap<string, DetailTerritory>;

export interface DetailRow {
    /** `territory.id` (Datenbank) und `territory.public_id`. */
    territoryId: string;
    territoryPublicId: string;
    territoryName: string;
    /** `null` = kein Wert, `""` = bewusster Leerwert, sonst der wirksame Text. */
    values: Record<DetailField, string | null>;
    /** Die Herkunft je Feld mit Wert; ein Feld ohne Wert oder ohne bekannte Herkunft hat keinen Eintrag. */
    origins: Partial<Record<DetailField, DetailOrigin>>;
}

/** Eine Zeile von `wiki_territory_snapshot` (Migration 0162): der Wiki-Stand eines Gebietsartikels. */
export interface SnapshotRow {
    wikiKey: string;
    /** Der Wiki-Wert je Feld; `null` = das Wiki kennt keinen, außer das Feld steht in `unknown`. */
    values: Record<DetailField, string | null>;
    /** Die Felder, deren Wiki-Wert unbekannt ist (Legacy-Override). */
    unknown: DetailField[];
}

/**
 * Der Wiki-Stand aus den wirksamen Werten und ihrer Herkunft: `wiki` gibt den Wert, `override` und ein Text ohne bekannte Herkunft
 * „unbekannt“, kein Wert „das Wiki kennt nichts“. EINE Regel für den Import und den Prüfer (Migration 0162 füllt einmal nach derselben).
 */
export function snapshotFrom(
    wikiKey: string,
    values: Readonly<Record<DetailField, string | null>>,
    origins: Readonly<Partial<Record<DetailField, DetailOrigin>>>,
): SnapshotRow {
    const wiki = Object.fromEntries(DETAIL_FIELDS.map((field) => [field, null])) as Record<DetailField, string | null>;
    const unknown: DetailField[] = [];
    for (const field of DETAIL_FIELDS) {
        const origin = origins[field];
        if (origin === "wiki") wiki[field] = values[field];
        else if (origin === "override" || values[field] !== null) unknown.push(field);
    }
    return { wikiKey, values: wiki, unknown };
}

export interface FieldCount {
    /** Felder mit Text. */
    values: number;
    /** Bewusste Leerwerte (`""`, leerer Override). */
    empty: number;
    /** Felder ohne Wert (`null`). */
    missing: number;
}

export interface CoatSummary {
    undecided: number;
    none: number;
    set: number;
    setCustom: number;
    setWikiLocalized: number;
    setWikiStaging: number;
    /** Gebiete mit Wiki-Wappen ohne redaktionellen Entscheid (`source staging`), davon die, die Legacy zeigt. */
    undecidedWikiCandidate: number;
    undecidedWikiCandidateShown: number;
    /** Je Abbildung auf den Media Core. */
    suppressions: number;
    bindings: number;
    omitted: number;
    /** Lizenzstatus der gesetzten Wappen (leer = in der Antwort nicht genannt). */
    licenseOfSet: Record<string, number>;
    isPublic: number;
    isShown: number;
    /** Die alten Felder des Exports: `coat_of_arms_url` nicht leer; zur Gegenprobe gegen `shown` und `url`. */
    oldFieldUrls: number;
    urlsNamed: number;
}

export interface TerritoryDetailsTransform {
    detailPart: "applied" | "block_missing";
    coatPart: "planned" | "block_missing";
    /** Gebiete der Antwort und wie viele davon `detail` beziehungsweise `coat` tragen. */
    territories: number;
    withDetail: number;
    withCoat: number;
    /** Die Detailzeilen (nur Gebiete mit mindestens einem Wert, auch dem leeren, und bekannter aktiver Zeile). */
    details: DetailRow[];
    /** Die Wiki-Schnappschüsse: je bekanntem aktivem Gebiet mit `detail` und Wiki-Artikel einer (Migration 0162). */
    snapshots: SnapshotRow[];
    /** Je Feld die Zahl der Werte, der Leerwerte und der fehlenden (Quelle, alle Gebiete mit `detail`). */
    fieldCounts: Record<DetailField, FieldCount>;
    /** Der Wappenzustand je Gebiet mit `coat`, durchgerechnet (nichts geschrieben). */
    coats: CoatPlan[];
    coatNames: ReadonlyMap<string, string>;
    coatSummary: CoatSummary;
    findings: Finding[];
}

type Bag = Record<string, unknown>;

function isBag(value: unknown): value is Bag {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Reste von Wikimarkup im Text (Vertrag `wikitext_residue`): Links, Vorlagen, Verweise, geschützte Leerzeichen. */
const WIKITEXT_RESIDUE = /\[\[|\]\]|\{\{|\}\}|<ref|&nbsp;/i;

function emptyFieldCounts(): Record<DetailField, FieldCount> {
    return Object.fromEntries(DETAIL_FIELDS.map((field) => [field, { values: 0, empty: 0, missing: 0 }])) as Record<
        DetailField,
        FieldCount
    >;
}

function emptyCoatSummary(): CoatSummary {
    return {
        undecided: 0,
        none: 0,
        set: 0,
        setCustom: 0,
        setWikiLocalized: 0,
        setWikiStaging: 0,
        undecidedWikiCandidate: 0,
        undecidedWikiCandidateShown: 0,
        suppressions: 0,
        bindings: 0,
        omitted: 0,
        licenseOfSet: {},
        isPublic: 0,
        isShown: 0,
        oldFieldUrls: 0,
        urlsNamed: 0,
    };
}

/**
 * Wandelt die Antwort um. `index` sind die Gebiete in Avesmaps3D (aus der Datenbank gelesen, siehe `readTerritoryDetailIndex`).
 */
export function transformTerritoryDetails(payload: unknown, index: TerritoryDetailIndex): TerritoryDetailsTransform {
    const findings: Finding[] = [];
    const fieldCounts = emptyFieldCounts();
    const coatSummary = emptyCoatSummary();
    const empty = (): TerritoryDetailsTransform => ({
        detailPart: "block_missing",
        coatPart: "block_missing",
        territories: 0,
        withDetail: 0,
        withCoat: 0,
        details: [],
        snapshots: [],
        fieldCounts,
        coats: [],
        coatNames: new Map(),
        coatSummary,
        findings,
    });
    const bag = isBag(payload) ? payload : null;
    const rows = bag !== null && Array.isArray(bag["territories"]) ? (bag["territories"] as unknown[]) : null;
    if (bag === null || rows === null || rows.length === 0) {
        findings.push(
            createFinding(
                "source_block_missing",
                "Die Gebietsantwort ist unbrauchbar (kein Objekt, territories keine oder eine leere Liste); die Gebietsdetails schreiben nichts und legen nichts still, der Lauf geht weiter",
                { grund: bag === null ? "kein Objekt" : "territories keine oder leere Liste" },
            ),
        );
        return empty();
    }

    const objectRows = rows.filter(isBag);
    const withDetail = objectRows.filter((row) => isBag(row["detail"])).length;
    const withCoat = objectRows.filter((row) => isBag(row["coat"])).length;
    const detailPart = withDetail > 0 ? "applied" : "block_missing";
    const coatPart = withCoat > 0 ? "planned" : "block_missing";
    for (const [name, present, part] of [
        ["detail", withDetail, detailPart],
        ["coat", withCoat, coatPart],
    ] as const) {
        if (part === "block_missing") {
            findings.push(
                createFinding(
                    "source_block_missing",
                    `Kein Gebiet der Antwort trägt das Objekt ${name} (älterer Export, vor Legacy E4); dieser Teil schreibt nichts und legt nichts still, der Lauf geht weiter`,
                    { objekt: name, gebiete: objectRows.length },
                ),
            );
        } else if (present < objectRows.length) {
            findings.push(
                createFinding(
                    "source_detail_partial",
                    `Nur ${String(present)} von ${String(objectRows.length)} Gebieten tragen das Objekt ${name}; die übrigen gelten als ohne ${name}`,
                    { objekt: name, mit: present, gebiete: objectRows.length },
                ),
            );
        }
    }

    // Befunde je Gebiet: nur öffentliche Kennung und Name.
    const bucket = new Map<string, FindingObject[]>();
    const add = (code: string, object: FindingObject): void => {
        const items = bucket.get(code) ?? [];
        items.push(object);
        bucket.set(code, items);
    };
    const unknownFields = new Set<string>();
    const emptyKept: Record<string, number> = {};
    const residue: Record<string, number> = {};
    const details: DetailRow[] = [];
    const snapshots: SnapshotRow[] = [];
    const snapshotKeys = new Set<string>();
    const coats: CoatPlan[] = [];
    const coatNames = new Map<string, string>();
    const coatProblems = new Map<CoatReadProblem, FindingObject[]>();
    const coatNotes = new Map<CoatNote, FindingObject[]>();
    const rightsPending = new Map<string, FindingObject[]>();
    const seen = new Set<string>();
    let ownNodeWithDetail = 0;

    for (const row of objectRows) {
        const rawId = typeof row["public_id"] === "string" ? row["public_id"].trim().toLowerCase() : "";
        const territory = UUID.test(rawId) ? index.get(rawId) : undefined;
        const name = typeof row["name"] === "string" && row["name"].trim() !== "" ? row["name"] : null;
        const ref: FindingObject = { table: "territory", publicId: UUID.test(rawId) ? rawId : "", name };
        if (UUID.test(rawId)) {
            if (seen.has(rawId)) continue;
            seen.add(rawId);
        }

        // ---- Detailfelder ----------------------------------------------------------------------------------------------------------
        const detail = row["detail"];
        if (isBag(detail)) {
            const markers = row["detail_overrides"];
            const originsDelivered = Array.isArray(markers);
            const overrideSet = new Set<string>();
            if (Array.isArray(markers)) {
                for (const marker of markers) {
                    if (typeof marker === "string" && (DETAIL_FIELDS as readonly string[]).includes(marker)) {
                        overrideSet.add(marker);
                    } else {
                        unknownFields.add(`detail_overrides: ${typeof marker === "string" ? marker : "(kein Text)"}`);
                    }
                }
            }
            for (const key of Object.keys(detail)) {
                if (!(DETAIL_FIELDS as readonly string[]).includes(key)) unknownFields.add(`detail: ${key}`);
            }
            const values = Object.fromEntries(DETAIL_FIELDS.map((field) => [field, null])) as Record<
                DetailField,
                string | null
            >;
            const origins: Partial<Record<DetailField, DetailOrigin>> = {};
            for (const field of DETAIL_FIELDS) {
                const raw = detail[field];
                let value: string | null = null;
                if (typeof raw === "string") value = raw.trim() === "" ? "" : raw;
                else if (raw !== null && raw !== undefined) add("detail_value_not_text", ref);
                const inOverride = overrideSet.has(field);
                if (originsDelivered) {
                    if (inOverride) {
                        if (value === null) {
                            add("detail_override_marker_inconsistent", { ...ref, name: `${name ?? ""} (${field})` });
                        } else {
                            origins[field] = "override";
                        }
                    } else if (value === "") {
                        add("detail_empty_without_override", { ...ref, name: `${name ?? ""} (${field})` });
                        value = null;
                    } else if (value !== null) {
                        origins[field] = "wiki";
                    }
                } else if (value === "") {
                    origins[field] = "override";
                } else if (value !== null) {
                    add("detail_origin_not_delivered", { ...ref, name: `${name ?? ""} (${field})` });
                }
                values[field] = value;
                if (value === null) fieldCounts[field].missing += 1;
                else if (value === "") {
                    fieldCounts[field].empty += 1;
                    emptyKept[field] = (emptyKept[field] ?? 0) + 1;
                } else {
                    fieldCounts[field].values += 1;
                    if (WIKITEXT_RESIDUE.test(value)) {
                        residue[field] = (residue[field] ?? 0) + 1;
                        add("wikitext_residue", { ...ref, name: `${name ?? ""} (${field})` });
                    }
                }
            }
            const article = territory?.active === true ? (territory.wikiKey ?? "") : "";
            if (article.startsWith("wiki:") && !snapshotKeys.has(article)) {
                snapshotKeys.add(article);
                snapshots.push(snapshotFrom(article, values, origins));
            }
            if (DETAIL_FIELDS.some((field) => values[field] !== null)) {
                const wikiKey = typeof row["wiki_key"] === "string" ? row["wiki_key"].trim() : "";
                if (wikiKey === "" || wikiKey.startsWith("eigener-knoten:")) ownNodeWithDetail += 1;
                if (territory === undefined || !territory.active) {
                    add("detail_territory_not_found", ref);
                } else {
                    details.push({
                        territoryId: territory.id,
                        territoryPublicId: territory.publicId,
                        territoryName: territory.name,
                        values,
                        origins,
                    });
                }
            }
        }

        // ---- Wappenzustand (nur durchgerechnet) ----------------------------------------------------------------------------------
        const oldUrl = row["coat_of_arms_url"];
        if (typeof oldUrl === "string" && oldUrl.trim() !== "") coatSummary.oldFieldUrls += 1;
        const read = readCoat(row["coat"]);
        if (read.coat !== null && UUID.test(rawId)) {
            for (const problem of read.problems) {
                const items = coatProblems.get(problem) ?? [];
                items.push(ref);
                coatProblems.set(problem, items);
            }
            const plan = planCoat(rawId, read.coat);
            coats.push(plan);
            coatNames.set(rawId, name ?? "");
            const facts = plan.facts;
            coatSummary[facts.state] += 1;
            if (facts.isPublic) coatSummary.isPublic += 1;
            if (facts.isShown) coatSummary.isShown += 1;
            if (facts.url !== null) coatSummary.urlsNamed += 1;
            if (facts.state === "set") {
                if (facts.origin === "custom") coatSummary.setCustom += 1;
                else if (facts.origin === "wiki_localized") coatSummary.setWikiLocalized += 1;
                else if (facts.origin === "wiki_staging") coatSummary.setWikiStaging += 1;
                const license = facts.licenseStatus ?? "";
                coatSummary.licenseOfSet[license] = (coatSummary.licenseOfSet[license] ?? 0) + 1;
                const rights = coatRightsOutcome(facts.licenseStatus);
                if (!rights.automatic) {
                    const key = facts.licenseStatus ?? "(nicht genannt)";
                    const items = rightsPending.get(key) ?? [];
                    items.push(ref);
                    rightsPending.set(key, items);
                }
            }
            if (plan.outcome.kind === "suppression") coatSummary.suppressions += 1;
            else if (plan.outcome.kind === "binding") coatSummary.bindings += 1;
            else coatSummary.omitted += 1;
            if (plan.outcome.kind === "none" && plan.outcome.reason === "undecided_wiki_candidate") {
                coatSummary.undecidedWikiCandidate += 1;
                if (facts.isShown) coatSummary.undecidedWikiCandidateShown += 1;
            }
            for (const note of plan.notes) {
                const items = coatNotes.get(note) ?? [];
                items.push(ref);
                coatNotes.set(note, items);
            }
        }
    }

    // ---- Befunde -------------------------------------------------------------------------------------------------------------------
    const objectsOf = (code: string): FindingObject[] => bucket.get(code) ?? [];
    const report = (
        code: string,
        message: (n: number) => string,
        numbers: Record<string, number | string> = {},
    ): void => {
        const objects = objectsOf(code);
        if (objects.length === 0) return;
        findings.push(createFinding(code, message(objects.length), { eintraege: objects.length, ...numbers }, objects));
    };
    if (unknownFields.size > 0) {
        findings.push(
            createFinding(
                "detail_field_unknown",
                `Die Antwort trägt Schlüssel außerhalb der 17 Detailfelder (${[...unknownFields].sort().join("; ")}); sie werden nie gelesen`,
                { schluessel: unknownFields.size },
                [],
                0,
                [...unknownFields].sort(),
            ),
        );
    }
    report(
        "detail_value_not_text",
        (n) => `${String(n)} Detailfelder tragen weder Text noch null; sie werden als „kein Wert“ gelesen`,
    );
    report(
        "detail_origin_not_delivered",
        (n) =>
            `${String(n)} Detailfelder mit Text, aber ohne Liste detail_overrides in der Antwort: ohne Herkunftsvermerk gespeichert („nicht bekannt“, nie wiki); leere Werte gelten als Override`,
    );
    report(
        "detail_override_marker_inconsistent",
        (n) =>
            `${String(n)} Felder stehen in detail_overrides, tragen aber keinen Wert (null); als „kein Wert“ gespeichert`,
    );
    report(
        "detail_empty_without_override",
        (n) =>
            `${String(n)} Felder sind leer und stehen nicht in detail_overrides (nach Legacys Regel unmöglich: nur ein Override kann leer sein); als „kein Wert“ gespeichert`,
    );
    if (Object.keys(emptyKept).length > 0) {
        const total = Object.values(emptyKept).reduce((sum, n) => sum + n, 0);
        findings.push(
            createFinding(
                "detail_empty_override_kept",
                `${String(total)} bewusste Leerwerte (leere Overrides, je Feld: ${Object.entries(emptyKept)
                    .map(([field, n]) => `${field} ${String(n)}`)
                    .join(
                        ", ",
                    )}); als leerer Text gespeichert, nie als NULL: sie verdecken den Wiki-Wert (Information)`,
                emptyKept,
            ),
        );
    }
    report(
        "detail_territory_not_found",
        (n) =>
            `${String(n)} Gebiete mit Detailfeldern gibt es in Avesmaps3D nicht (oder nur stillgelegt); nicht gespeichert (I14 hat sie nicht angelegt)`,
    );
    if (ownNodeWithDetail > 0) {
        findings.push(
            createFinding(
                "detail_for_own_node",
                `${String(ownNodeWithDetail)} Gebiete ohne Wiki-Artikel (eigener Knoten, ohne wiki_key) tragen Detailfelder: nur Overrides sind dort möglich (Information)`,
                { gebiete: ownNodeWithDetail },
            ),
        );
    }
    if (Object.keys(residue).length > 0) {
        findings.push(
            createFinding(
                "wikitext_residue",
                `Reste von Wikimarkup in Detailtexten (je Feld: ${Object.entries(residue)
                    .map(([field, n]) => `${field} ${String(n)}`)
                    .join(", ")}); nicht repariert (Cutoff-Regel)`,
                residue,
                objectsOf("wikitext_residue"),
            ),
        );
    }

    // Wappenzustand
    const coatFinding = (
        code: string,
        items: FindingObject[] | undefined,
        message: (n: number) => string,
        numbers: Record<string, number | string> = {},
    ): void => {
        if (items === undefined || items.length === 0) return;
        findings.push(createFinding(code, message(items.length), { gebiete: items.length, ...numbers }, items));
    };
    if (coats.length > 0) {
        const lines = [
            `undecided ${String(coatSummary.undecided)} (davon mit Wiki-Wappen ohne Entscheid ${String(coatSummary.undecidedWikiCandidate)}, davon von Legacy gezeigt ${String(coatSummary.undecidedWikiCandidateShown)}), none ${String(coatSummary.none)}, set ${String(coatSummary.set)} (custom ${String(coatSummary.setCustom)}, wiki_localized ${String(coatSummary.setWikiLocalized)}, wiki_staging ${String(coatSummary.setWikiStaging)})`,
            `Lizenz der gesetzten: ${
                Object.entries(coatSummary.licenseOfSet)
                    .map(([license, n]) => `${license === "" ? "(nicht genannt)" : license} ${String(n)}`)
                    .join(", ") || "keine"
            }`,
            `Abbildung auf den Media Core (nur durchgerechnet, nichts geschrieben): Unterdrückung ${String(coatSummary.suppressions)}, Bindung ${String(coatSummary.bindings)}, keine Zeile ${String(coatSummary.omitted)}`,
            `Gegenprobe gegen die alten Felder der Antwort: coat_of_arms_url nicht leer ${String(coatSummary.oldFieldUrls)}, coat.url genannt ${String(coatSummary.urlsNamed)}, coat.shown ${String(coatSummary.isShown)}, coat.public ${String(coatSummary.isPublic)}`,
        ];
        findings.push(
            createFinding(
                "coat_state_summary",
                `Wappenzustand von ${String(coats.length)} Gebieten: ${String(coatSummary.set)} gesetzt, ${String(coatSummary.none)} ausdrücklich keins, ${String(coatSummary.undecided)} ohne Entscheid (Information; geschrieben wird er vom Medienimport)`,
                {
                    gebiete: coats.length,
                    undecided: coatSummary.undecided,
                    none: coatSummary.none,
                    set: coatSummary.set,
                    set_custom: coatSummary.setCustom,
                    set_wiki_localized: coatSummary.setWikiLocalized,
                    set_wiki_staging: coatSummary.setWikiStaging,
                    unterdrueckung: coatSummary.suppressions,
                    bindung: coatSummary.bindings,
                },
                [],
                0,
                lines,
            ),
        );
    }
    coatFinding(
        "coat_state_value_unknown",
        coatProblems.get("state_unknown"),
        (n) =>
            `${String(n)} Gebiete tragen einen coat.state außerhalb von undecided, none und set; als undecided gelesen (nie als „kein Wappen“)`,
    );
    coatFinding(
        "coat_origin_value_unknown",
        [...(coatProblems.get("origin_unknown") ?? []), ...(coatProblems.get("source_unknown") ?? [])],
        (n) =>
            `${String(n)} Gebiete tragen coat.origin oder coat.source außerhalb der bekannten Werte; die Bindung entfällt`,
    );
    coatFinding(
        "coat_none_with_url",
        coatNotes.get("coat_none_with_url"),
        (n) =>
            `${String(n)} Gebiete mit coat.state none, aber gefüllter Adresse (widersprüchlich); der strengere Zustand none gilt`,
    );
    coatFinding(
        "coat_set_without_file",
        coatNotes.get("coat_set_without_file"),
        (n) =>
            `${String(n)} Gebiete mit coat.state set, aber ohne Adresse (nicht öffentliche Lizenz in Legacy oder ausgeschalteter Herkunfts-Schalter; coat.public sagt, welches): keine Bindung aus E4; der private Export E5 B kann die Datei tragen`,
    );
    coatFinding(
        "coat_undecided_with_wiki_candidate",
        coatNotes.get("coat_undecided_with_wiki_candidate"),
        (n) =>
            `${String(n)} Gebiete ohne redaktionellen Entscheid, für die ein Wiki-Wappen bekannt ist (davon von Legacy gezeigt ${String(coatSummary.undecidedWikiCandidateShown)}); es wird nichts geraten, keine Bindung`,
        { gezeigt: coatSummary.undecidedWikiCandidateShown },
    );
    coatFinding(
        "coat_external_unlocalized",
        coatNotes.get("coat_external_unlocalized"),
        (n) =>
            `${String(n)} gesetzte Wappen liegen nur im Wiki (absolute Adresse ohne Kopie bei Legacy): nicht geladen, keine Bindung (kein zweiter Importpfad, media.yaml); Legacy zeigt sie nicht, ein leeres Bild wäre die Folge`,
    );
    coatFinding(
        "coat_cache_path_source",
        coatNotes.get("coat_cache_path_source"),
        (n) =>
            `${String(n)} Wappen unter /uploads/wappen/cache/ (Proxy-Zwischenspeicher): Datei holen und als Zwischenspeicher-Herkunft kennzeichnen (media.yaml)`,
    );
    coatFinding(
        "coat_not_shown",
        coatNotes.get("coat_not_shown"),
        (n) =>
            `${String(n)} Wappen passieren Legacys Lizenz-Gate, werden aber nicht angezeigt (Herkunfts-Schalter aus oder Datei nicht auslieferbar); Information`,
    );
    if (rightsPending.size > 0) {
        const all = [...rightsPending.values()].flat();
        const numbers: Record<string, number> = {};
        for (const [license, items] of rightsPending) numbers[license] = items.length;
        findings.push(
            createFinding(
                "coat_rights_pending",
                `${String(all.length)} gesetzte Wappen sind nach media.yaml nicht automatisch öffentlich (${[
                    ...rightsPending,
                ]
                    .map(([license, items]) => `${license} ${String(items.length)}`)
                    .join(
                        ", ",
                    )}); die Rechtezeilen schreibt der Medienimport, E5 B (Stempel und Login) kann die Einstufung bestätigen`,
                numbers,
                all,
            ),
        );
    }

    return {
        detailPart,
        coatPart,
        territories: objectRows.length,
        withDetail,
        withCoat,
        details,
        snapshots,
        fieldCounts,
        coats,
        coatNames,
        coatSummary,
        findings,
    };
}
