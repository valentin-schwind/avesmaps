import {
    subjectKey,
    subjectSourcesUrl,
    type SourceEntry,
    type SourceReferenceKind,
    type SubjectRef,
    type SubjectSourcesSection,
} from "@avesmaps3d/shared";
import { isMessageKey, locale, t, tPlural, type MessageKey } from "../i18n/i18n";
import type { CanonPill, RightsRow, WikiModel } from "./panel-types";
import { createRevisionCache, type RevisionCache } from "./subject-cache";
import { fetchUnderLoad } from "./subject-client";

/**
 * Der Quellenkasten des Panels als reines Modell (WI-0063 P6, Design Guide §16.4 „Quellenkasten“; Legacy
 * `js/ui/feature-source-markup.js` `buildSourceListMarkup`, Mirror `8fb75eff9`): EIN Kasten mit zwei Zonen, jede nur mit Inhalt.
 *
 * - **Zone 1 „Quelle:“ / „Quellen:“** (Singular bei einer Zeile): zuerst die Wikizeile, dann jede von Hand zugeordnete Quelle
 *   (`referenceKind` fehlt), je eine Zeile mit Titel, Seiten, ⓘ-Rechtetafel und Halbpille aus Kanon und Art.
 * - **Zone 2 „Publikationen:“**: die Wiki-Belege (`referenceKind` gesetzt) als zwei Reiter, „Beschrieben“ (alles außer `erwaehnung`) und
 *   „Erwähnt“, jeder nur mit n > 0 und jeder mit einer Liste (WI-0254 §12, keine Tafel mehr): unter „Beschrieben“ in den Gruppen
 *   Ausführlich und Ergänzend mit Kopf und Zahl, unter „Erwähnt“ ohne Kopf; innerhalb jeder Gruppe nach Titel in der Sprache der Seite.
 *   Eine Zeile trägt Titel (mit Link), Typ und Seiten. Legacy zeigt keine Gesamtzahl.
 * - Zwischen den Zonen steht ein Trenner, aber NUR, wo oben wirklich etwas steht (Betreiber Legacy 2026-09-03): Ein Trenner über der
 *   ersten Zeile trennt nichts und sagt „hier fehlt etwas“.
 * - Ohne Wikizeile, ohne Quelle und ohne Beleg gibt es keinen Kasten.
 * - Die Notiz einer Quelle (`note`) zeigt Legacy im Infopanel nicht, und hier auch nicht: Bei den Quellen von Hand ist sie in allen 1.768
 *   Fällen die Adresse der Importseite, bei den Publikationen trägt sie Wikitext-Reste („Stand [[1026 BF]]“).
 *
 * Die Liste kommt aus `GET /api/subjects/{kind}/{id}/sources` (WI-0063 19); das Panel holt sie sofort, sobald die Detailantwort sie
 * zählt - Legacy zeigt die erste Zone und die Reiterzahlen ohne Klick. Reine Funktionen ohne Vue: Sie lassen sich prüfen, ohne den
 * Browser zu öffnen.
 */

/** Ab so vielen Einzelseiten wird gekürzt (Legacy `FEATURE_SOURCE_PAGES_MAX`); drei lesen sich in einem Blick. */
export const PAGES_MAX = 3;

export interface ShortPages {
    /** Was in der Zeile steht: „91, 92“ oder „9 ff.“. */
    short: string;
    /** Die volle Angabe; steht im Titel des Elements, wenn gekürzt wurde. */
    full: string;
    shortened: boolean;
}

/**
 * Lange Seitenangaben kürzen (Legacy `featureSourceShortenPages`, Betreiber Legacy 2026-08-24): ab der vierten Einzelseite
 * „erste ff.“. Ein Bereich („16-122“) trägt kein Komma und wird nie gekürzt - `ff.` machte aus einem bekannten Ende ein offenes.
 * Die volle Angabe geht nicht verloren, sie steht im Titel.
 */
export function shortenPages(pages: string | undefined): ShortPages | undefined {
    const full = (pages ?? "").trim();
    if (full === "") return undefined;
    const parts = full
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part !== "");
    if (parts.length <= PAGES_MAX) return { short: parts.join(", "), full, shortened: false };
    return { short: `${parts[0] ?? ""} ff.`, full, shortened: true };
}

/** Nur http(s) wird ein Link (Legacy `featureSourceSichereUrl`): `javascript:` überlebt jedes Maskieren. */
export function safeHref(url: string | undefined): string | undefined {
    const text = (url ?? "").trim();
    return /^https?:\/\//i.test(text) ? text : undefined;
}

/** Die Art einer Quelle als Wort in der Sprache der Seite; eine unbekannte Art bleibt, wie sie ist (Legacy reicht den Schlüssel durch). */
export function sourceTypeLabel(type: string): string {
    const key = `infoPanel.sourceType.${type}`;
    return isMessageKey(key) ? t(key as MessageKey) : type;
}

/** Eine Zeile der Zone 1: die Wikizeile oder eine von Hand zugeordnete Quelle (Legacy `.fs-src-row`). */
export interface SourceLine {
    key: string;
    kind: "wiki" | "direct";
    /** Der Name vorn: bei einer Belegstelle der Wirt („Herzogtum Weiden“), sonst der Titel. */
    title: string;
    href: string | undefined;
    pages: ShortPages | undefined;
    /** Die Halbpille: Kanon links, Art rechts; ohne Bezeichner eine ganze Pille. */
    pill: CanonPill | undefined;
    /** Die Tafel hinter dem ⓘ; die Wikizeile trägt IMMER eine (Lizenzhinweis). */
    rights: RightsRow[];
}

/** Eine Zeile der Publikationsliste: Titel mit Link, Art, Seiten. */
export interface SourceRow {
    key: string;
    title: string;
    href: string | undefined;
    /** Die Art der Quelle als Text in der Sprache der Seite. */
    type: string;
    pages: ShortPages | undefined;
    /** Wie ausführlich die Publikation das Subject behandelt; sie ordnet die Zeile einer Gruppe zu. */
    kind: SourceReferenceKind;
}

export interface SourcesModel {
    /** Von Hand zugeordnete Quellen. */
    direct: SourceLine[];
    /** Publikationen mit ausführlicher oder ergänzender Behandlung. */
    described: SourceRow[];
    /** Publikationen, die das Subject nur erwähnen. */
    mentioned: SourceRow[];
}

/** Eine Gruppe der Publikationsliste: eine Art des Belegs mit ihren Zeilen nach Titel. */
export interface SourceGroup {
    key: SourceReferenceKind;
    /** Der Kopf der Gruppe („Ausführlich“); ohne Kopf (unter „Erwähnt“) steht die Liste für sich. */
    label: string | undefined;
    rows: SourceRow[];
}

/** Ein Reiter der Publikationen (Legacy `.fs-src-tab`): Beschriftung, Zahl und die Liste, die er aufklappt. */
export interface PublicationTab {
    key: "described" | "mentioned";
    label: string;
    count: number;
    /** Der Hinweis am Reiter („nur Erwähnung“), wo es einen gibt. */
    hint: string | undefined;
    groups: SourceGroup[];
}

export interface SourceBox {
    /** „Quelle:“ bei einer Zeile, „Quellen:“ bei mehreren; leer ohne Zeile. */
    label: string;
    lines: SourceLine[];
    tabs: PublicationTab[];
    /** Der Trenner zwischen den Zonen: nur, wo Zone 1 etwas trägt UND Zone 2 etwas hat (oder noch lädt). */
    divider: boolean;
}

export function emptySources(): SourcesModel {
    return { direct: [], described: [], mentioned: [] };
}

/** Die Wikizeile als erste Zeile der Zone 1. */
function wikiLineOf(wiki: WikiModel): SourceLine {
    return {
        key: "wiki",
        kind: "wiki",
        title: wiki.label,
        href: safeHref(wiki.url),
        pages: undefined,
        pill: wiki.canon,
        rights: wiki.rights,
    };
}

/** Die Tafel hinter dem ⓘ einer Katalogquelle (Legacy `rechteMarkup`): Kanon, Lizenz, Titel (wenn vorn der Wirt steht), Nennung, Adresse. */
function rightsOf(entry: SourceEntry, hiddenTitle: string | undefined): RightsRow[] {
    const rows: RightsRow[] = [];
    // Die Art in Klammern entfällt bei `sonstiges`: Es IST die Nicht-Aussage, „Fanmaterial (Sonstiges)“ sagte nichts (Legacy).
    const art = entry.type === "sonstiges" ? "" : ` (${sourceTypeLabel(entry.type)})`;
    rows.push({
        key: "kanon",
        label: t("infoPanel.source.rightsKanon"),
        text: entry.official ? t("infoPanel.source.kanonOfficial") : t("infoPanel.source.kanonUnofficial", { art }),
    });
    const license = entry.license;
    // Eine nicht erfasste Lizenz fehlt - leer heißt nie „keine Lizenz“ (Legacy `featureSourceLicenseText`, D1).
    if (license?.statement === "license" && license.name !== undefined) {
        rows.push({
            key: "license",
            label: t("infoPanel.source.rightsLicense"),
            text: license.name,
            ...(license.uri === undefined ? {} : { href: license.uri }),
        });
    } else if (license?.statement === "public_domain" || license?.statement === "unfree") {
        rows.push({
            key: "license",
            label: t("infoPanel.source.rightsLicense"),
            text: t(
                license.statement === "public_domain"
                    ? "infoPanel.source.licensePublicDomain"
                    : "infoPanel.source.licenseUnfree",
            ),
        });
    }
    if (hiddenTitle !== undefined) {
        rows.push({ key: "title", label: t("infoPanel.source.rightsTitle"), text: hiddenTitle });
    }
    if (entry.attribution !== undefined) {
        rows.push({ key: "attribution", label: t("infoPanel.source.rightsAttribution"), text: entry.attribution });
    }
    if (entry.url !== undefined) {
        rows.push({ key: "address", label: t("infoPanel.source.rightsAddress"), text: entry.url, href: entry.url });
    }
    return rows;
}

/**
 * Eine von Hand zugeordnete Quelle als Zeile. Welcher Name vorn steht (Legacy `featureSourceVornName`, Betreiber 2026-09-01): bei einer
 * Belegstelle der Wirt, bei einem Werk der Titel; der Titel der Seite wandert dann hinter das ⓘ, damit er nicht verloren geht.
 *
 * ⚠️ Der Vertrag nennt den Wirt (`corpus.label`), aber nicht seine Form (`belegstelle`/`werk`): Hier gilt „hat der Wirt einen Namen, steht
 * er vorn“. Das ist Legacys Regel für alle Belegstellen (heute alle Wirte außer KoschWiki und Nordmarken, die noch ohne Form sind);
 * für diese beiden stünde in Legacy der Titel. Schließen ließe es ein additives `corpus.form` im Vertrag.
 */
function lineOf(entry: SourceEntry, index: number): SourceLine {
    const own = (entry.title ?? "").trim();
    const host = (entry.corpus?.label ?? "").trim();
    const title = host !== "" ? host : own !== "" ? own : (entry.url ?? "");
    const hiddenTitle = host !== "" && own !== "" && own !== host ? own : undefined;
    return {
        key: `${String(index)}:${entry.url ?? entry.title ?? ""}`,
        kind: "direct",
        title,
        href: safeHref(entry.url),
        pages: shortenPages(entry.pages),
        // Die Art ist das zweite Feld der Halbpille (Betreiber Legacy 2026-09-01: „das soll so aussehn wie die anderen“).
        pill: { state: entry.official ? "official" : "unofficial", by: sourceTypeLabel(entry.type) },
        rights: rightsOf(entry, hiddenTitle),
    };
}

function rowOf(entry: SourceEntry, index: number, kind: SourceReferenceKind): SourceRow {
    return {
        key: `${String(index)}:${entry.url ?? entry.title ?? ""}`,
        title: entry.title ?? entry.url ?? "",
        href: safeHref(entry.url),
        type: sourceTypeLabel(entry.type),
        pages: shortenPages(entry.pages),
        kind,
    };
}

/**
 * Teilt die Antwort in die drei Töpfe; eine Quelle ohne Titel und ohne Adresse hat nichts zu zeigen und fällt weg. Der Eintrag eines Vorkommens bringt seine Publikationen mit der Antwort und
 * braucht keine eigene Quellenroute (WI-0260): Er reicht die Liste ohne Umschlag herein.
 */
export function sourcesModelOf(section: Pick<SubjectSourcesSection, "sources">): SourcesModel {
    const model = emptySources();
    section.sources.forEach((entry, index) => {
        if ((entry.title ?? entry.url ?? "") === "") return;
        const kind = entry.referenceKind;
        if (kind === undefined) model.direct.push(lineOf(entry, index));
        else if (kind === "erwaehnung") model.mentioned.push(rowOf(entry, index, kind));
        else model.described.push(rowOf(entry, index, kind));
    });
    return model;
}

/** Eine Gruppe eines Reiters: die Art des Belegs und der Kopf, den sie trägt (ohne Kopf steht die Liste für sich). */
interface GroupSlot {
    kind: SourceReferenceKind;
    label: MessageKey | undefined;
}

/** Unter „Beschrieben“ in dieser Folge, jede mit Kopf; „Erwähnt“ ist eine Gruppe ohne Kopf. */
const DESCRIBED_SLOTS: readonly GroupSlot[] = [
    { kind: "ausfuehrlich", label: "inhalte.bezug.ausfuehrlich" },
    { kind: "ergaenzend", label: "inhalte.bezug.ergaenzend" },
];
const MENTIONED_SLOTS: readonly GroupSlot[] = [{ kind: "erwaehnung", label: undefined }];

/**
 * Die Zeilen eines Reiters als Gruppen, in jeder nach Titel in der Sprache der Seite. `numeric`, damit „Aventurischer Bote 2“ vor „… 10“
 * steht; gleiche Titel behalten ihre Folge (die Sortierung ist stabil). Eine Gruppe ohne Zeile entsteht nicht.
 */
function groupsOf(rows: readonly SourceRow[], slots: readonly GroupSlot[]): SourceGroup[] {
    const collator = new Intl.Collator(locale.value, { numeric: true });
    return slots
        .map(({ kind, label }): SourceGroup => ({
            key: kind,
            label: label === undefined ? undefined : t(label),
            rows: rows.filter((row) => row.kind === kind).sort((x, y) => collator.compare(x.title, y.title)),
        }))
        .filter((group) => group.rows.length > 0);
}

/**
 * Der Kasten aus Wikizeile und Quellen. `noteBelow` heißt: Unter der ersten Zone steht noch eine Zeile (die Liste lädt oder ist
 * gescheitert) - dann gehört auch der Trenner dorthin, damit er beim Eintreffen der Liste nicht erscheint und wieder verschwindet.
 */
export function sourceBoxOf(
    wiki: WikiModel | undefined,
    sources: SourcesModel | undefined,
    noteBelow = false,
): SourceBox {
    const lines = [...(wiki === undefined ? [] : [wikiLineOf(wiki)]), ...(sources?.direct ?? [])];
    const tabs: PublicationTab[] = [];
    if (sources !== undefined && sources.described.length > 0) {
        tabs.push({
            key: "described",
            label: t("infoPanel.sources.described"),
            count: sources.described.length,
            hint: undefined,
            groups: groupsOf(sources.described, DESCRIBED_SLOTS),
        });
    }
    if (sources !== undefined && sources.mentioned.length > 0) {
        tabs.push({
            key: "mentioned",
            label: t("infoPanel.sources.mentioned"),
            count: sources.mentioned.length,
            hint: t("infoPanel.sources.mentionTitle"),
            groups: groupsOf(sources.mentioned, MENTIONED_SLOTS),
        });
    }
    return {
        label: lines.length === 0 ? "" : tPlural("infoPanel.source", lines.length),
        lines,
        tabs,
        divider: lines.length > 0 && (tabs.length > 0 || noteBelow),
    };
}

/** Gibt es etwas zu zeigen? Ohne Zeile und ohne Reiter (und ohne wartende Zeile) entsteht kein Kasten (WI-0063 5.3). */
export const hasBox = (box: SourceBox, noteBelow = false): boolean =>
    box.lines.length > 0 || box.tabs.length > 0 || noteBelow;

/**
 * Ruft die Quellen-Sektion eines Subjects ab (`subjectSourcesUrl`). Eine Absage wegen Last (503) fragt der Dienst selbst noch einmal
 * (`fetchUnderLoad`, dieselbe Regel wie das Detail). `null` bei 404 (das Subject gibt es nicht mehr); jeder andere Fehler wirft: Der
 * Kasten zeigt dann seinen kleinen Fehlerzustand und der Rest des Panels bleibt (WI-0063 5.3).
 */
export async function fetchSources(
    ref: SubjectRef,
    signal?: AbortSignal,
    fetcher: typeof fetch = (...args) => globalThis.fetch(...args),
): Promise<SubjectSourcesSection | null> {
    const url = subjectSourcesUrl(ref);
    if (url === null) throw new Error(`Subject ${ref.kind} hat keine Quellen-Sektion`);
    const response = await fetchUnderLoad(fetcher, url, signal);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`${url} antwortete ${String(response.status)}`);
    return (await response.json()) as SubjectSourcesSection;
}

/** Der kurze Cache der Quellenlisten, wie der der Subjects (`subject-cache.ts`): Wer zwischen zwei Orten hin und her springt, spürt den Server nicht. */
const sharedCache: RevisionCache<SubjectSourcesSection> = createRevisionCache();

/** Die frische Liste aus dem Cache - oder `undefined`; sie erlaubt dem Kasten, ohne Wartezeile zu zeichnen. */
export const cachedSources = (
    ref: SubjectRef,
    store: RevisionCache<SubjectSourcesSection> = sharedCache,
): SubjectSourcesSection | undefined => store.get(subjectKey(ref));

/** Holt die Liste, zuerst aus dem Cache; eine gefundene Liste wandert hinein. */
export async function loadSources(
    ref: SubjectRef,
    signal?: AbortSignal,
    fetcher?: typeof fetch,
    store: RevisionCache<SubjectSourcesSection> = sharedCache,
): Promise<SubjectSourcesSection | null> {
    const cached = cachedSources(ref, store);
    if (cached !== undefined) return cached;
    const section = await fetchSources(ref, signal, fetcher);
    if (section !== null) store.set(subjectKey(ref), section);
    return section;
}
