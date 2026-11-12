import {
    openLiteratureCount,
    type CitymapEntry,
    type LiteratureEntry,
    type ReviewEntry,
    type SubjectCitymapsSection,
    type SubjectCounts,
    type SubjectLiteratureSection,
    type SubjectRef,
    type SubjectReviewsSection,
} from "@avesmaps3d/shared";
import { formatNumber, isMessageKey, t, tPlural, type MessageKey } from "../i18n/i18n";
import { cachedSection, fetchSection, loadSection } from "./panel-section-load";
import type { RevisionCache } from "./subject-cache";

/**
 * Die Katalogabschnitte des Infopanels als reines Modell (WI-0063 P8, Design Guide §16.4; Legacy
 * `js/map-features/map-features-place-extras.js` und `js/community/location-reviews.js`, Mirror `04a85a54f`): Kartensammlung,
 * Literatur und Bewertungen. Reine Funktionen ohne Vue - sie lassen sich prüfen, ohne den Browser zu öffnen.
 *
 * 🔴 Die Überschrift folgt dem Satzmuster „⟨Was⟩ zu ⟨Wem⟩ (⟨Zahl⟩)“ (Guide §16.4, Legacy wörtlich): „Kartensammlung von Gareth“,
 * „Literatur zu Gareth“, „Bewertung zu Gareth“ - Einzahl bei der Bewertung, auch bei fünf, weil die Zahl in der Klammer steht. Ohne
 * Namen steht nur das Wort (Legacy `review.heading`).
 *
 * 🔴 Keine leeren Abschnitte (WI-0063 5.3): Ein Abschnitt entsteht nur, wo die Detailantwort ihn zählt (`counts`), und seine Liste
 * kommt in EINER abbrechbaren Frage, die bei Last von selbst wiederholt (`fetchUnderLoad`, wie die Quellen). Scheitert sie, steht
 * dort eine kleine Zeile samt „Noch einmal versuchen“, und der Rest des Panels bleibt benutzbar.
 */

/** Welche Abschnitte es gibt und in welcher Reihenfolge sie stehen (Legacy: Kartensammlung, Literatur, Bewertungen). */
export const CATALOG_SECTIONS = ["citymaps", "literature", "reviews"] as const;
export type CatalogSection = (typeof CATALOG_SECTIONS)[number];

/** Was ein Abschnitt braucht, bevor seine Liste da ist: wen er fragt, wie er heißt und welche Zahl in der Klammer steht. */
export interface CatalogModel {
    section: CatalogSection;
    ref: SubjectRef;
    /** Der Name des Gegenstands („Gareth“): Das Fenster zu diesem Abschnitt heißt „Kartensammlung von Gareth“ und baut den Titel selbst. */
    name: string;
    heading: string;
    /**
     * Die Zahl in Klammern; `undefined`, wo es keine gibt. Das ist genau ein Fall: ein Gegenstand, an dem NUR verdeckte Werke stehen
     * (Legacy zeigte dort „(0)“, und „(0)“ ist bei uns verboten, WI-0063 5.3).
     */
    count?: number;
    /**
     * Ein Ort ohne Karte (WI-0275 Stufe C): Der Abschnitt ist die Einladung „Eine gute Karte kennen? Karte vorschlagen“ und fragt keine Liste. Eine Ausnahme von „keine leeren Abschnitte“, vom Betreiber
     * gewollt („ja natürlich“, 2026-11-02): Ohne den Abschnitt gäbe es für den ersten Vorschlag keinen Weg.
     */
    leer?: boolean;
}

const SECTION_LABELS: Readonly<Record<CatalogSection, { named: MessageKey; bare: MessageKey }>> = {
    citymaps: { named: "infoPanel.citymaps.headingIn", bare: "infoPanel.citymaps.heading" },
    literature: { named: "infoPanel.literature.headingIn", bare: "infoPanel.literature.heading" },
    reviews: { named: "infoPanel.reviews.headingIn", bare: "infoPanel.reviews.heading" },
};

/** Die Überschrift eines Abschnitts: mit Namen „Literatur zu Gareth“, ohne Namen nur „Literatur“. */
export function catalogHeading(section: CatalogSection, name: string | undefined): string {
    const labels = SECTION_LABELS[section];
    const title = (name ?? "").trim();
    return title === "" ? t(labels.bare) : t(labels.named, { name: title });
}

/**
 * Die Abschnitte, die das Panel baut, in Legacys Reihenfolge - genau die, die die Detailantwort zählt. Ein Gegenstand mit nur
 * verdeckten Werken bekommt seinen Literaturabschnitt über `literatureHidden`, aber ohne Zahl.
 */
export function catalogsOf(
    ref: SubjectRef,
    name: string | undefined,
    counts: SubjectCounts | undefined,
): CatalogModel[] {
    if (counts === undefined) return [];
    const models: CatalogModel[] = [];
    const add = (section: CatalogSection, count: number | undefined): void => {
        models.push({
            section,
            ref,
            name: (name ?? "").trim(),
            heading: catalogHeading(section, name),
            ...(count === undefined ? {} : { count }),
        });
    };
    if (counts.citymaps !== undefined) add("citymaps", counts.citymaps);
    else if (ref.kind === "place") {
        models.push({
            section: "citymaps",
            ref,
            name: (name ?? "").trim(),
            heading: catalogHeading("citymaps", undefined),
            leer: true,
        });
    }
    if (counts.literature !== undefined || counts.literatureHidden === true) add("literature", counts.literature);
    if (counts.reviews !== undefined) add("reviews", counts.reviews);
    return models;
}

// ---------------------------------------------------------------------------------------------------------------
// Literatur
// ---------------------------------------------------------------------------------------------------------------

/** Ein Bild, so wie der Streifen es zeichnet: Adresse und Maße, mehr braucht ein `<img>` nicht. */
export interface CardImage {
    url: string;
    width: number;
    height: number;
}

/**
 * Eine Karte des Literaturstreifens (Legacy `buildGameLiteratureCardMarkup`): Umschlag, Titel, Metazeile, Art, „enthalten in“.
 *
 * 🔴 **Die Karte führt nicht mehr nach draußen, sie öffnet das Verzeichnis** (WI-0118, Betreiber 2026-10-09: ein Klick auf eine Literatur
 * soll „immer den jeweiligen Eintrag im Verzeichnis vergrößert darstellen“): Umschlag und Titel sind beide EIN Knopf, der das Fenster
 * „Literatur zu …“ bei diesem Werk aufschlägt. Die Ziele nach draußen (Laden, Wiki Aventurica, Nationalbibliothek) stehen dort, jedes
 * mit ↗.
 */
export interface LiteratureCard {
    /** Die Kennung des Werks (`adventure.public_id`): Sie ist der Schlüssel der Karte und das, was das Fenster aufschlägt. */
    key: string;
    title: string;
    /**
     * Der Umschlag des Werks. 🔴 Er FEHLT, wo der Media Core keinen freigibt - dann zeichnet die Karte KEIN Bild: keinen Rahmen,
     * keine Beschriftung, keinen Alternativtext (MEDIA-M12). Nur die Fläche bleibt stehen, damit im Streifen alle Titel auf
     * derselben Höhe beginnen.
     */
    cover: CardImage | undefined;
    /** Der Hinweis am Knopf: was ein Klick tut. */
    hint: string;
    /** „DSA5 · 1047 BF“; leer, wenn beides fehlt. */
    meta: string;
    /** Die Werkart als Wort in der Sprache der Seite; ein unbekannter Schlüssel bleibt, wie er ist. */
    type: string;
    /** „enthalten in: Aventurische Anthologie“; leer ohne Sammelwerk. */
    containedIn: string;
    /** Der Eintrag steht unter einem Deckel (Rolle `play`: „spielt hier“ IST der Spoiler). */
    spoiler: boolean;
}

/** Die Werkart als Wort (Legacy `avesmapsGameLiteratureProductTypeLabel`); ein unbekannter Schlüssel wird durchgereicht. */
export function literatureTypeLabel(productType: string): string {
    const key = `infoPanel.literature.type.${productType.toLowerCase()}`;
    return isMessageKey(key) ? t(key as MessageKey) : productType;
}

function cardOf(entry: LiteratureEntry): LiteratureCard {
    const meta = [entry.edition, entry.year].filter((part): part is string => part !== undefined).join(" · ");
    const cover = entry.cover;
    return {
        key: entry.id,
        title: entry.title,
        cover: cover === undefined ? undefined : { url: cover.url, width: cover.width, height: cover.height },
        hint: t("infoPanel.catalog.openHint", { title: entry.title }),
        meta,
        type: literatureTypeLabel(entry.productType),
        containedIn:
            entry.containedIn === undefined ? "" : t("infoPanel.literature.containedIn", { name: entry.containedIn }),
        spoiler: entry.role === "play",
    };
}

export interface LiteratureModel {
    cards: LiteratureCard[];
    /**
     * Steht nichts offen da (nur Spoiler), sagt der Abschnitt das in einem Satz - sonst wäre nur eine Reihe Deckel zu sehen
     * (Legacy `.avesmaps-adv__empty`).
     */
    note: string;
}

export function literatureModelOf(section: SubjectLiteratureSection): LiteratureModel {
    return {
        cards: section.works.map(cardOf),
        note:
            section.works.length > 0 && openLiteratureCount(section.works) === 0
                ? t("infoPanel.literature.noneOpen")
                : "",
    };
}

// ---------------------------------------------------------------------------------------------------------------
// Kartensammlung
// ---------------------------------------------------------------------------------------------------------------

/**
 * Eine Kachel des Kartenstreifens (Legacy `cityMapCardMarkup`): die Vorschau und darunter der Titel, nichts weiter.
 *
 * 🔴 **Die Kachel führt nicht mehr nach draußen, sie öffnet das Verzeichnis** (WI-0118, Betreiber 2026-10-09): Ein Klick schlägt das
 * Fenster „Kartensammlung von …“ bei dieser Karte auf, vergrößert. Die Fundstellen stehen dort, jede mit ↗.
 */
export interface CitymapCard {
    /** Die Kennung der Karte (`citymap.public_id`): Sie ist der Schlüssel der Kachel und das, was das Fenster aufschlägt. */
    key: string;
    title: string;
    /** Der Hinweis am Knopf: was ein Klick tut. */
    hint: string;
    /**
     * Die Vorschau der Karte. 🔴 Sie FEHLT, wo der Media Core keine freigibt - dann zeichnet die Kachel KEIN Bild: keinen Rahmen,
     * keine Beschriftung, keinen Alternativtext (MEDIA-M12). Nur die Fläche bleibt stehen, damit im Streifen alle Titel auf
     * derselben Höhe beginnen.
     */
    preview: CardImage | undefined;
    spoiler: boolean;
}

function mapCardOf(entry: CitymapEntry): CitymapCard {
    const preview = entry.preview;
    return {
        key: entry.id,
        title: entry.title,
        hint: t("infoPanel.catalog.openHint", { title: entry.title }),
        preview: preview === undefined ? undefined : { url: preview.url, width: preview.width, height: preview.height },
        spoiler: entry.spoiler === true,
    };
}

export const citymapsModelOf = (section: SubjectCitymapsSection): CitymapCard[] => section.maps.map(mapCardOf);

// ---------------------------------------------------------------------------------------------------------------
// Urheberzeile
// ---------------------------------------------------------------------------------------------------------------

/**
 * Die Urheberzeile unter einem Streifen (Legacy `avesmapsGameLiteratureCreditMarkup` und `avesmapsCitymapCreditMarkup`,
 * Pflichtangabe aus den Ulisses-Fanrichtlinien, `NOTICE.md`; Betreiber 2026-10-06: „ja, bau die zeile ein! im zweifel wie legacy“).
 *
 * 🔴 **Nur der Satz, kein Weg in den Laden** (Betreiber 2026-10-09, wörtlich: „mach Bilder © Ulisses Spiele bzw. der
 * jeweiligen Rechteinhaber — im F-Shop ansehen [zu] Bilder © Ulisses Spiele bzw. der jeweiligen Rechteinhaber“). Legacys Anker
 * „im F-Shop ansehen“ entfällt damit bewusst.
 *
 * 🔴 **Keine Bilder, keine Zeile.** Sie steht nur, wo mindestens EIN Bild zu sehen ist - Legacys eigene, strengere Bedingung
 * (`cityMapsHaveVisibleCover`, dessen Test wörtlich: „a section showing covers must show the credit“ / „no covers, no credit“).
 * Ein Ort, dessen Werke alle keinen freigegebenen Umschlag tragen, zeigt sie nicht: eine Urheberzeile ohne Bilder wäre eine
 * Aussage über nichts.
 *
 * 🔴 **Dieselbe Bedingung für BEIDE Streifen**, nicht „nur Literatur“ fest verdrahtet. Die Kartensammlung zeigte vom Widerruf am
 * 2026-10-06 bis zu seiner Rücknahme am 2026-10-08 keine Vorschauen und damit keine Zeile; mit den Bildern kam sie von selbst zurück.
 *
 * 🔴 **Nur der Satz, kein Link** (Betreiber 2026-10-09: die Zeile lautet nur noch „Bilder © Ulisses Spiele bzw. der jeweiligen Rechteinhaber“, ohne
 * „— im F-Shop ansehen“): Der Weg in den Laden steht an den Fundstellen des einzelnen Eintrags, nicht in einer Pflichtangabe.
 *
 * 🪤 Gefragt wird, was die Liste TRÄGT, nicht was der Browser geladen hat: Ein Bild, dessen Adresse nicht lädt, nimmt das Bauteil
 * aus seiner Karte (`@error`) - das ist ein Unfall, keine Aussage über die Rechte. Legacy prüft dieselbe Seite, die Daten.
 */
export function catalogCredit(images: readonly (CardImage | undefined)[]): string | undefined {
    return images.some((image) => image !== undefined) ? t("infoPanel.catalog.credit") : undefined;
}

// ---------------------------------------------------------------------------------------------------------------
// Bewertungen
// ---------------------------------------------------------------------------------------------------------------

/** So viele Sterne hat eine Bewertung, immer (Guide §16.6). */
export const STAR_COUNT = 5;

export type StarFill = "full" | "half" | "empty";

/**
 * Die fünf Sterne zu einem Wert (Legacy `reviewStarsMarkup`): voll, sobald der Wert die Stufe erreicht, halb ab einer halben Stufe
 * darunter, sonst leer. 🔴 Eine Teilfüllung entsteht AM SELBEN Zeichen (Guide §16.6), nie durch ein zweites Symbol.
 */
export function starsOf(value: number): StarFill[] {
    const clamped = Math.min(Math.max(Number.isFinite(value) ? value : 0, 0), STAR_COUNT);
    return Array.from({ length: STAR_COUNT }, (_unused, index) => {
        const step = index + 1;
        return clamped >= step ? "full" : clamped >= step - 0.5 ? "half" : "empty";
    });
}

/** Eine Zeile der Bewertungsliste: „⟨Autor⟩ schreibt (⟨Datum⟩):“, darunter die Sterne und der Text in Anführungszeichen. */
export interface ReviewRow {
    key: string;
    /** Die Kopfzeile, fertig; ein leerer Autor heißt „Anonym“ (Legacy `review.anonymousAuthor`). */
    head: string;
    stars: StarFill[];
    /** Die Beschriftung der Sterne für Bildschirmleser („3 von 5 Sternen“). */
    starsLabel: string;
    /** Der Text in Anführungszeichen; leer, wo keiner steht (dann entfällt die Zeile). */
    text: string;
}

export interface ReviewsModel {
    /** Der Durchschnitt als Zahl mit einer Nachkommastelle; leer ohne Bewertung. */
    average: string;
    averageStars: StarFill[];
    averageLabel: string;
    /** „9 Bewertungen“ beziehungsweise „1 Bewertung“, über ALLE sichtbaren. */
    count: string;
    rows: ReviewRow[];
}

function reviewRowOf(entry: ReviewEntry, index: number): ReviewRow {
    const author = (entry.author ?? "").trim() === "" ? t("infoPanel.reviews.anonymous") : (entry.author as string);
    const date = entry.date;
    return {
        key: String(index),
        head:
            date === undefined
                ? t("infoPanel.reviews.writes", { author })
                : t("infoPanel.reviews.writesDate", { author, date }),
        stars: starsOf(entry.stars),
        starsLabel: t("infoPanel.reviews.starsLabel", { n: formatNumber(entry.stars, 0) }),
        text: entry.text === undefined ? "" : t("infoPanel.reviews.quote", { text: entry.text }),
    };
}

export function reviewsModelOf(section: SubjectReviewsSection): ReviewsModel {
    const average = section.average;
    return {
        average: average === undefined ? "" : formatNumber(average, 1),
        averageStars: starsOf(average ?? 0),
        averageLabel: average === undefined ? "" : t("infoPanel.reviews.starsLabel", { n: formatNumber(average, 1) }),
        count: tPlural("infoPanel.reviews.count", section.count, { n: formatNumber(section.count, 0) }),
        rows: section.reviews.map(reviewRowOf),
    };
}

// ---------------------------------------------------------------------------------------------------------------
// Abruf
// ---------------------------------------------------------------------------------------------------------------

export type CatalogAnswer = SubjectLiteratureSection | SubjectCitymapsSection | SubjectReviewsSection;

/**
 * Abruf und kurzer Cache stehen in `panel-section-load.ts` - EINE Rezeptur für alle Sektionen, auch für die Vorkommen, die kein
 * Abschnitt sind, sondern vier Zeilen (WI-0091). Hier bleiben nur die Namen, unter denen `info-catalog.vue` sie kennt.
 */
export const fetchCatalog = (
    section: CatalogSection,
    ref: SubjectRef,
    signal?: AbortSignal,
    fetcher?: typeof fetch,
): Promise<CatalogAnswer | null> => fetchSection<CatalogAnswer>(section, ref, signal, fetcher);

/** Die frische Liste aus dem Cache - oder `undefined`; sie erlaubt dem Abschnitt, ohne Wartezeile zu zeichnen. */
export const cachedCatalog = (
    section: CatalogSection,
    ref: SubjectRef,
    store?: RevisionCache<CatalogAnswer>,
): CatalogAnswer | undefined => cachedSection<CatalogAnswer>(section, ref, store);

/** Holt die Liste, zuerst aus dem Cache; eine gefundene Liste wandert hinein. */
export const loadCatalog = (
    section: CatalogSection,
    ref: SubjectRef,
    signal?: AbortSignal,
    fetcher?: typeof fetch,
    store?: RevisionCache<CatalogAnswer>,
): Promise<CatalogAnswer | null> => loadSection<CatalogAnswer>(section, ref, signal, fetcher, store);
