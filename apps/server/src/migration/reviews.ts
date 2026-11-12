import { createFinding, type Finding, type FindingObject } from "../findings.ts";

/**
 * Legacys Bewertungen von Orten (Export E3, `GET /api/app/location-reviews-export.php`), übersetzt in das Zielmodell (WI-0063 P3,
 * Vertrag `reviews.yaml`, D4, Migration 0075). REINE Umwandlung ohne Datenbank: derselbe Code füttert den Import und den Prüfer, damit
 * beide nie auseinanderlaufen. Die Antwort (Quelle: `docs/legacy-exporte/location-reviews-export.beispiel.json` im Legacy-Mirror
 * `024e3af3d`):
 *
 *   { ok, map_revision, reviews_revision, counts: { total, visible, hidden, spam, orphaned_location_ids, orphaned_reviews },
 *     reviews: [ { id, location_public_id, location_name, location_active, author_name, stars, body, dsa_date, created_at } ] }
 *
 * 🔴 DATENSCHUTZ. Gelesen wird NUR, was auf der Positivliste `REVIEW_FIELDS` steht. Jeder andere Schlüssel einer Zeile wird nie gelesen:
 * von ihm bleibt nur sein NAME (Befund `personal_column_in_export` für `ip_hash`, `user_agent`, `request_origin` und Konto-Kennungen,
 * `review_field_unknown` für alles andere), nie ein Wert. Eine Zeile, die trotzdem `is_hidden` oder `is_spam` mit Wert wahr trägt, wird
 * nie gespeichert (`review_flag_in_export`). Kein Befund und kein Bericht enthält einen Text oder einen Autorennamen: Objekte tragen
 * die Kennung der Bewertung (Legacys laufende Nummer) und die des Ortes.
 *
 * 🔴 Nichts hier hält den Lauf an (Betreiber 2026-10-03): eine unbrauchbare, leere oder in sich widersprüchliche Antwort lässt den
 * Schritt entfallen (nichts geschrieben, nichts gelöscht, `source_*`-Befund), jede andere Auffälligkeit ist ein Befund.
 *
 * Die Auflösung des Ortes ist eine reine Funktion von (Kennung, Zustand der Trägertabellen): `location_public_id` trifft
 * `place.public_id` oder `place.legacy_public_id` einer AKTIVEN Zeile oder die Bewertung wird nicht gespeichert. Der Namensschnappschuss
 * `location_name` wird nie zur Auflösung benutzt, nur für den Befund `review_location_name_changed` (Information).
 */

export const REVIEWS_CONTRACT_VERSION = "1";

/** Die einzigen Schlüssel einer Bewertungszeile, die der Import liest (Positivliste, Vertrag `auswahl`). */
export const REVIEW_FIELDS = [
    "id",
    "location_public_id",
    "location_name",
    "location_active",
    "author_name",
    "stars",
    "body",
    "dsa_date",
    "created_at",
] as const;

/**
 * Schlüssel, die in einer Antwort NICHT stehen dürfen, weil sie Personenbezug tragen (Vertrag `scope.enthaelt_nicht`). Es zählt der
 * Name; ein Wert wird nie gelesen. Alles, was sonst nicht auf der Positivliste steht, ist `review_field_unknown`.
 */
export const PERSONAL_REVIEW_KEYS = [
    "ip_hash",
    "ip",
    "user_agent",
    "request_origin",
    "created_by",
    "updated_by",
    "user_id",
    "account_id",
    "session_id",
    "email",
] as const;

/** Legacys Obergrenzen der Spalten (Zeichen); eine längere Angabe wird gemeldet und unverändert gespeichert. */
export const REVIEW_LIMITS = { author_name: 80, body: 200, dsa_date: 60 } as const;

/** Kennzeichen der Systemtest-Zeile (Vertrag `datenschutz.systemtest_zeile_id_121`): gemeldet, nie gefiltert. */
const TEST_ROW_PREFIX = "ZZ-Systemtest";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STAMP = /^rev-[0-9a-f]{16}$/;

/** Ein Ort in Avesmaps3D, wie die Auflösung ihn braucht. */
export interface ReviewPlace {
    id: string;
    publicId: string;
    name: string;
    active: boolean;
}

/** Was Avesmaps3D an Zielen hat: die Orte (nach `public_id` UND `legacy_public_id`) und die Kennungen aller anderen Träger. */
export interface ReviewPlaceIndex {
    /** Kennung (klein geschrieben) → Ort; `legacy_public_id` und `public_id` zeigen auf dieselbe Zeile. */
    places: ReadonlyMap<string, ReviewPlace>;
    /** Kennungen von Weg, Region, Gebiet, Beschriftung, Wegkreuzung, Gipfel, Kraftlinie und Kraftlinienpunkt (klein geschrieben). */
    otherCarriers: ReadonlySet<string>;
}

/** Eine speicherbare Bewertung (alles Weitere der Antwort ist nur für Befunde gelesen worden). */
export interface ReviewRow {
    legacyReviewId: number;
    /** `place.id` (Datenbank) und `place.public_id`. */
    placeId: string;
    placePublicId: string;
    stars: number;
    authorName: string | null;
    body: string | null;
    dsaDate: string | null;
    /** Naive Anlagezeit, `YYYY-MM-DDTHH:MM:SS.mmm`, wie die Datenbank sie liest (kein Zonenbezug). */
    legacyCreatedAt: string;
}

/** Die Zahlen der Antwort, die nur im Bericht stehen (nicht in einer Tabelle). */
export interface ReviewSourceCounts {
    total: number;
    visible: number;
    hidden: number;
    spam: number;
    orphanedLocationIds: number | null;
    orphanedReviews: number | null;
}

export interface ReviewsTransform {
    /** Die Antwort war unbrauchbar, leer ohne Beleg oder in sich widersprüchlich: nichts schreiben, nichts löschen. */
    skipped: boolean;
    reviews: ReviewRow[];
    /** Wie viele Zeilen die Antwort lieferte (gleich `counts.visible`, sonst ist der Schritt entfallen). */
    delivered: number;
    counts: ReviewSourceCounts | null;
    /** `reviews_revision` und `map_revision` der Antwort, nur als Herkunft im Bericht. */
    stamp: { reviewsRevision: string | null; mapRevision: number | null };
    /** Wie viele gelieferte Zeilen aus welchem Grund nicht gespeichert wurden (Befundcode → Zahl). */
    notStored: Record<string, number>;
    findings: Finding[];
}

type Bag = Record<string, unknown>;

function isBag(value: unknown): value is Bag {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function count(value: unknown): number | null {
    return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function skip(findings: Finding[], counts: ReviewSourceCounts | null = null): ReviewsTransform {
    return {
        skipped: true,
        reviews: [],
        delivered: 0,
        counts,
        stamp: { reviewsRevision: null, mapRevision: null },
        notStored: {},
        findings,
    };
}

/** Die Zeichenzahl, wie Legacys `mb_strlen`: Codepunkte, nicht UTF-16-Einheiten. */
function length(value: string): number {
    return [...value].length;
}

/** Ein Text aus der Antwort: wörtlich; leer oder Leerraum wird `null` (nie ein leerer String), ein Nicht-Text ebenso. */
function textOf(value: unknown): string | null {
    return typeof value === "string" && value.trim() !== "" ? value : null;
}

/**
 * Die Anlagezeit: `YYYY-MM-DD HH:MM:SS` (auch mit `T` und Bruchteil) als gültiger Kalendertag, NAIV. Das Ergebnis hat Millisekunden
 * (`to_char … MS`); weitere Stellen werden abgeschnitten, damit der zweite Lauf dasselbe vergleicht.
 */
export function normalizeCreatedAt(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/.exec(value.trim());
    if (!match) return null;
    const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number) as [
        number,
        number,
        number,
        number,
        number,
        number,
    ];
    const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    if (
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day ||
        hour > 23 ||
        minute > 59 ||
        second > 59
    ) {
        return null;
    }
    const millis = (match[7] ?? "").padEnd(3, "0").slice(0, 3);
    return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}.${millis}`;
}

/**
 * Wandelt die Antwort um. `index` sind die Träger in Avesmaps3D (aus der Datenbank gelesen, siehe `readReviewPlaceIndex`).
 */
export function transformReviews(payload: unknown, index: ReviewPlaceIndex): ReviewsTransform {
    const bag = isBag(payload) ? payload : null;
    if (bag === null || bag["ok"] !== true || !Array.isArray(bag["reviews"])) {
        return skip([
            createFinding(
                "source_block_missing",
                "Die Antwort von location-reviews-export.php ist unbrauchbar (ok nicht true oder reviews keine Liste); der Schritt schreibt nichts und löscht nichts, der Lauf geht weiter",
                {
                    grund: bag === null ? "kein Objekt" : bag["ok"] !== true ? "ok nicht true" : "reviews keine Liste",
                },
            ),
        ]);
    }
    const list = bag["reviews"];
    const rawCounts = isBag(bag["counts"]) ? bag["counts"] : null;
    const total = count(rawCounts?.["total"]);
    const visible = count(rawCounts?.["visible"]);
    const hidden = count(rawCounts?.["hidden"]);
    const spam = count(rawCounts?.["spam"]);
    if (rawCounts === null || total === null || visible === null || hidden === null || spam === null) {
        return skip([
            createFinding(
                "source_block_missing",
                "Die Antwort von location-reviews-export.php trägt keine lesbaren Zahlen (counts mit total, visible, hidden, spam); ohne sie lässt sich die Vollständigkeit nicht prüfen, der Schritt schreibt nichts und löscht nichts",
                { grund: rawCounts === null ? "counts fehlt" : "counts unlesbar" },
            ),
        ]);
    }
    const counts: ReviewSourceCounts = {
        total,
        visible,
        hidden,
        spam,
        orphanedLocationIds: count(rawCounts["orphaned_location_ids"]),
        orphanedReviews: count(rawCounts["orphaned_reviews"]),
    };
    // Falsche Anzahl: die Liste trägt genau die sichtbaren Zeilen; hidden und spam können sich überschneiden (eine Zeile kann beides
    // sein), also liegt total - visible zwischen dem Größeren der beiden und ihrer Summe.
    const moderated = total - visible;
    if (list.length !== visible || moderated < Math.max(hidden, spam) || moderated > hidden + spam) {
        return skip(
            [
                createFinding(
                    "source_counts_disagree",
                    `Die Antwort von location-reviews-export.php widerspricht sich: ${String(list.length)} gelieferte Zeilen gegen counts.visible ${String(visible)} ` +
                        `(gesamt ${String(total)}, verborgen ${String(hidden)}, Spam ${String(spam)}); der Schritt schreibt nichts und löscht nichts, der Lauf geht weiter`,
                    { geliefert: list.length, visible, total, hidden, spam },
                ),
            ],
            counts,
        );
    }
    // Eine leere Liste ist nur glaubwürdig, wenn Legacy sagt, dass die Tabelle lebt (alle Zeilen verborgen oder Spam). Bei gesamt 0
    // wäre „alles gelöscht“ ein Schluss aus einer leeren Tabelle: kein Stand.
    if (list.length === 0 && total === 0) {
        return skip(
            [
                createFinding(
                    "source_empty_catalog",
                    "Die Antwort von location-reviews-export.php ist leer und zählt auch gesamt 0 Zeilen: das ist kein Stand, aus dem sich „alle Bewertungen sind weg“ lesen ließe; der Schritt schreibt nichts und löscht nichts",
                    { total: 0 },
                ),
            ],
            counts,
        );
    }

    const findings: Finding[] = [];
    const reviews: ReviewRow[] = [];
    const notStored: Record<string, number> = {};
    const stored = (code: string): void => {
        notStored[code] = (notStored[code] ?? 0) + 1;
    };

    // Befunde je Zeile: nur Kennungen, nie ein Text.
    const bucket = new Map<string, FindingObject[]>();
    const add = (code: string, object: FindingObject): void => {
        const items = bucket.get(code) ?? [];
        items.push(object);
        bucket.set(code, items);
    };
    const personalKeys = new Set<string>();
    const unknownKeys = new Set<string>();
    const seenIds = new Set<number>();
    const allowed = new Set<string>(REVIEW_FIELDS);
    let unusableRows = 0;
    let locationActiveAgrees = 0;
    let legacyActiveOursNot = 0;
    let legacyInactiveOursActive = 0;

    for (const item of list) {
        if (!isBag(item)) {
            unusableRows += 1;
            continue;
        }
        let flagged = false;
        for (const key of Object.keys(item)) {
            if (allowed.has(key)) continue;
            if (key === "is_hidden" || key === "is_spam") {
                // Die Positivliste hätte sie nicht liefern dürfen; nur ein wahrer Wert verwirft die Zeile.
                const value = item[key];
                if (value === true || value === 1 || value === "1") flagged = true;
                continue;
            }
            if ((PERSONAL_REVIEW_KEYS as readonly string[]).includes(key)) personalKeys.add(key);
            else unknownKeys.add(key);
        }
        const rawId = item["id"];
        const legacyReviewId = typeof rawId === "number" && Number.isInteger(rawId) && rawId > 0 ? rawId : null;
        if (legacyReviewId === null) {
            unusableRows += 1;
            continue;
        }
        const ref = (placeId: string | null): FindingObject => ({
            table: "place_review",
            publicId: String(legacyReviewId),
            name: placeId === null ? null : `Ort ${placeId}`,
        });
        if (seenIds.has(legacyReviewId)) {
            add("review_duplicate_id", ref(null));
            stored("review_duplicate_id");
            continue;
        }
        seenIds.add(legacyReviewId);

        const locationRaw =
            typeof item["location_public_id"] === "string" ? item["location_public_id"].trim().toLowerCase() : "";
        const isUuid = UUID.test(locationRaw);
        const locationRef = ref(isUuid ? locationRaw : null);
        if (flagged) {
            add("review_flag_in_export", locationRef);
            stored("review_flag_in_export");
            continue;
        }
        const legacyActive = typeof item["location_active"] === "boolean" ? item["location_active"] : null;

        // ---- Ort -----------------------------------------------------------------------------------------------------------------
        let place: ReviewPlace | undefined;
        if (!isUuid) {
            add("review_location_not_uuid", locationRef);
            stored("review_location_not_uuid");
        } else {
            const found = index.places.get(locationRaw);
            if (found === undefined) {
                const code = index.otherCarriers.has(locationRaw)
                    ? "review_orphan_other_carrier"
                    : "review_orphan_unknown_id";
                add(code, locationRef);
                stored(code);
            } else if (!found.active) {
                add("review_orphan_inactive_place", locationRef);
                stored("review_orphan_inactive_place");
            } else {
                place = found;
            }
        }
        if (legacyActive !== null) {
            if (legacyActive && place === undefined) legacyActiveOursNot += 1;
            else if (!legacyActive && place !== undefined) legacyInactiveOursActive += 1;
            else locationActiveAgrees += 1;
            if ((legacyActive && place === undefined) || (!legacyActive && place !== undefined)) {
                add("review_location_active_disagrees", locationRef);
            }
        }
        if (place === undefined) continue;

        // ---- Felder --------------------------------------------------------------------------------------------------------------
        const stars = item["stars"];
        if (typeof stars !== "number" || !Number.isInteger(stars) || stars < 1 || stars > 5) {
            add("review_stars_out_of_range", ref(place.publicId));
            stored("review_stars_out_of_range");
            continue;
        }
        const createdAt = normalizeCreatedAt(item["created_at"]);
        if (createdAt === null) {
            add("review_created_missing", ref(place.publicId));
            stored("review_created_missing");
            continue;
        }
        const authorName = textOf(item["author_name"]);
        const body = textOf(item["body"]);
        const dsaDate = textOf(item["dsa_date"]);
        const placeRef = ref(place.publicId);
        for (const [field, value] of [
            ["author_name", authorName],
            ["body", body],
            ["dsa_date", dsaDate],
        ] as const) {
            if (value !== null && length(value) > REVIEW_LIMITS[field]) {
                add("review_text_exceeds_legacy_limit", { ...placeRef, name: `${placeRef.name ?? ""} (${field})` });
            }
        }
        if (authorName === null) add("review_author_empty", placeRef);
        if ((authorName ?? "").startsWith(TEST_ROW_PREFIX) || (body ?? "").startsWith(TEST_ROW_PREFIX)) {
            add("review_test_row", placeRef);
        }
        const snapshotName = typeof item["location_name"] === "string" ? item["location_name"].trim() : "";
        if (snapshotName !== "" && snapshotName !== place.name) add("review_location_name_changed", placeRef);

        reviews.push({
            legacyReviewId,
            placeId: place.id,
            placePublicId: place.publicId,
            stars,
            authorName,
            body,
            dsaDate,
            legacyCreatedAt: createdAt,
        });
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
        findings.push(createFinding(code, message(objects.length), { zeilen: objects.length, ...numbers }, objects));
    };
    if (personalKeys.size > 0) {
        findings.push(
            createFinding(
                "personal_column_in_export",
                `Die Antwort trägt Schlüssel mit Personenbezug (${[...personalKeys].sort().join(", ")}); sie werden NIE gelesen und nie gespeichert, nur der Schlüsselname steht hier. Der Export hätte sie nicht liefern dürfen (Positivliste in Legacy)`,
                { schluessel: personalKeys.size },
                [],
                0,
                [...personalKeys].sort().map((key) => `Schlüssel ${key}`),
            ),
        );
    }
    if (unknownKeys.size > 0) {
        findings.push(
            createFinding(
                "review_field_unknown",
                `Die Antwort trägt Schlüssel außerhalb der Positivliste (${[...unknownKeys].sort().join(", ")}); sie werden nie gelesen (nur ihre Namen stehen hier)`,
                { schluessel: unknownKeys.size },
                [],
                0,
                [...unknownKeys].sort().map((key) => `Schlüssel ${key}`),
            ),
        );
    }
    if (unusableRows > 0) {
        findings.push(
            createFinding(
                "review_row_unusable",
                `${String(unusableRows)} gelieferte Zeilen sind nicht lesbar (kein Objekt oder id keine positive Ganzzahl); sie werden nicht gespeichert`,
                { zeilen: unusableRows },
            ),
        );
        notStored["review_row_unusable"] = unusableRows;
    }
    report(
        "review_duplicate_id",
        (n) => `${String(n)} Zeilen tragen eine id, die in der Antwort schon vorkam; die erste gilt`,
    );
    report(
        "review_flag_in_export",
        (n) =>
            `${String(n)} gelieferte Zeilen tragen is_hidden oder is_spam mit Wert wahr; die Positivliste hätte sie nicht liefern dürfen, sie werden nicht gespeichert`,
    );
    report(
        "review_location_not_uuid",
        (n) => `${String(n)} Bewertungen tragen als Ort keine UUID; nicht gespeichert (Legacy prüft die Kennung nie)`,
    );
    report(
        "review_orphan_unknown_id",
        (n) => `${String(n)} Bewertungen nennen einen Ort, den es in Avesmaps3D nicht gibt; nicht gespeichert`,
    );
    report(
        "review_orphan_inactive_place",
        (n) => `${String(n)} Bewertungen nennen einen stillgelegten Ort; nicht gespeichert`,
    );
    report(
        "review_orphan_other_carrier",
        (n) =>
            `${String(n)} Bewertungen nennen Weg, Region, Gebiet, Beschriftung, Wegkreuzung, Gipfel oder Kraftlinie statt eines Ortes; nicht gespeichert (Legacy prüft die Kennung nie)`,
    );
    report(
        "review_location_active_disagrees",
        (n) =>
            `${String(n)} Bewertungen, bei denen Legacy und Avesmaps3D den Ort verschieden einstufen (Legacy aktiv, hier nicht aufgelöst: ${String(legacyActiveOursNot)}; Legacy nicht aktiv, hier ein aktiver Ort: ${String(legacyInactiveOursActive)}); Information, die Auflösung gilt nach Avesmaps3D`,
        {
            legacy_aktiv_hier_nicht: legacyActiveOursNot,
            legacy_nicht_aktiv_hier_aktiv: legacyInactiveOursActive,
            einig: locationActiveAgrees,
        },
    );
    report(
        "review_stars_out_of_range",
        (n) => `${String(n)} Bewertungen tragen Sterne außerhalb von 1 bis 5; nicht gespeichert`,
    );
    report(
        "review_created_missing",
        (n) => `${String(n)} Bewertungen tragen keine lesbare Anlagezeit; nicht gespeichert`,
    );
    report(
        "review_text_exceeds_legacy_limit",
        (n) =>
            `${String(n)} Angaben sind länger als Legacys Spalte (Autor ${String(REVIEW_LIMITS.author_name)}, Text ${String(REVIEW_LIMITS.body)}, Datum ${String(REVIEW_LIMITS.dsa_date)} Zeichen); gespeichert unverändert`,
    );
    report("review_author_empty", (n) => `${String(n)} Bewertungen ohne Autor (der Leser zeigt „Anonym“); Information`);
    report(
        "review_test_row",
        (n) =>
            `${String(n)} Bewertungen beginnen bei Autor oder Text mit „${TEST_ROW_PREFIX}“ (Testzeile, Legacy-Befund id 121): nicht gefiltert, ihre Entfernung ist Sache von Legacys Moderation und wirkt beim nächsten Zug`,
    );
    report(
        "review_location_name_changed",
        (n) =>
            `${String(n)} Bewertungen, deren Namensschnappschuss vom heutigen Ortsnamen abweicht (Umbenennung oder falsche Zuordnung); Information, der Name wird nie zur Auflösung benutzt`,
    );

    return {
        skipped: false,
        reviews,
        delivered: list.length,
        counts,
        stamp: {
            reviewsRevision:
                typeof bag["reviews_revision"] === "string" && STAMP.test(bag["reviews_revision"])
                    ? bag["reviews_revision"]
                    : null,
            mapRevision: count(bag["map_revision"]),
        },
        notStored,
        findings,
    };
}
