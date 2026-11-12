import { settleChecks } from "../blocking-checks.ts";
import type { Database } from "../database.ts";
import type { Finding } from "../findings.ts";
import { REVIEW_COLUMNS, readReviewPlaceIndex, reviewCells } from "./reviews-import.ts";
import { transformReviews } from "./reviews.ts";
import { readTableCells, type Cell } from "./sync-table.ts";
import { check, compareRows, count, forbiddenColumns, type ParityCheck } from "./verify-catalog.ts";

/**
 * Parität der Bewertungen gegen dieselbe Antwortdatei, aus der importiert wurde (WI-0063 P3, Vertrag `reviews.yaml`, `verifier`).
 *
 * Geprüft wird: Anzahl (gleich den speicherbaren Zeilen der Antwort, Kopfzahl gegen Liste), jede Zeile Spalte für Spalte (NULL bleibt
 * NULL, kein leerer String), jede Bewertung hängt an einer AKTIVEN Ortszeile und je Ort stimmen Anzahl und Sternesumme (der Durchschnitt
 * wird im Lesepfad gerechnet, mit der Summe ist er ohne Rundung vergleichbar), die Reihenfolge je Ort (Anlagezeit, Nummer absteigend),
 * die Struktur (keine Personenspalte, kein JSON, kein `entity_type`, keine Moderationsflagge, kein Namensschnappschuss) und der
 * Datenschutz der Ausgabe (kein Befund nennt einen Text oder Autor, Probe gegen die Quelle).
 *
 * 🔴 Nichts hier hält einen Lauf an (Betreiber 2026-10-03). Der Vertrag nennt keine Sollzahlen (nicht abgerufen, UNKNOWN). Nur lesend.
 */

export interface ReviewsParityReport {
    passed: boolean;
    /** Die Antwort war unbrauchbar, widersprüchlich oder leer ohne Beleg: der Schritt hat nichts geschrieben, also gibt es nichts zu prüfen. */
    skipped: boolean;
    checks: ParityCheck[];
    /** Die Befunde der Umwandlung (der Import hat sie schon gemeldet). */
    findings: Finding[];
}

/** Spaltennamen, die an einer Bewertung nie stehen dürfen (Personenbezug und Moderation). */
const FORBIDDEN_COLUMNS = [
    "ip_hash",
    "user_agent",
    "request_origin",
    "is_hidden",
    "is_spam",
    "location_name",
    "created_by",
] as const;

export async function verifyReviews(database: Database, payload: unknown): Promise<ReviewsParityReport> {
    const index = await readReviewPlaceIndex(database);
    const expected = transformReviews(payload, index);
    if (expected.skipped) return { passed: true, skipped: true, checks: [], findings: expected.findings };
    const checks: ParityCheck[] = [];
    // Eine Zeile mit gelöschtem Inhalt (Redaktion, WI-0269) gehört nicht mehr dem Import (`protectedWhere`): Name und Text sind weg und
    // kommen nicht zurück. Sie zählt auf keiner Seite des Vergleichs (die Zeile bleibt als Spur, ihr Inhalt ist Absicht).
    const geloescht = new Set(
        (
            await database<{ id: string }[]>`
                SELECT legacy_review_id::text AS id FROM place_review
                WHERE source_system = 'legacy' AND inhalt_geloescht_at IS NOT NULL
            `
        ).map((row) => row.id),
    );
    const reviews = expected.reviews.filter((row) => !geloescht.has(String(row.legacyReviewId)));

    // ---- Anzahl ------------------------------------------------------------------------------------------------------------------
    const stored = await count(
        database,
        `SELECT count(*) FROM place_review WHERE source_system = 'legacy' AND inhalt_geloescht_at IS NULL`,
    );
    const visible = expected.counts?.visible ?? -1;
    checks.push(
        check(
            "counts",
            stored === reviews.length && expected.delivered === visible,
            `place_review ${String(stored)} von ${String(reviews.length)} speicherbaren Zeilen der Antwort (${String(expected.delivered)} geliefert, counts.visible ${String(visible)}; nach Abzug der als nicht speicherbar oder verwaist gemeldeten)`,
        ),
    );

    // ---- Zeile für Zeile ---------------------------------------------------------------------------------------------------------
    const actual = new Map(
        (
            await readTableCells(
                database,
                "place_review",
                REVIEW_COLUMNS,
                "t.source_system = 'legacy' AND t.inhalt_geloescht_at IS NULL",
            )
        ).map((cells) => [String(cells[0]), cells]),
    );
    const wanted = new Map<string, Cell[]>(reviews.map((row) => [String(row.legacyReviewId), reviewCells(row)]));
    const rowOffenders = compareRows(
        wanted,
        actual,
        REVIEW_COLUMNS.map((column) => column.name),
        (key) => `Bewertung ${key}`,
    );
    const blank = await count(
        database,
        `SELECT count(*) FROM place_review WHERE btrim(coalesce(author_name, 'x')) = '' OR btrim(coalesce(body, 'x')) = '' OR btrim(coalesce(dsa_date, 'x')) = ''`,
    );
    checks.push(
        check(
            "rows",
            rowOffenders.length === 0 && blank === 0,
            rowOffenders.length === 0 && blank === 0
                ? `${String(actual.size)} Bewertungen gleich der Antwort (Nummer, Ort, Sterne, Autor, Text, aventurisches Datum, Anlagezeit); NULL bleibt NULL, keine leere Zeichenkette gespeichert; keine gespeicherte Zeile fehlt in der Quelle und keine speicherbare fehlt hier`
                : `${String(rowOffenders.length)} Bewertungen weichen ab, ${String(blank)} mit leerer Zeichenkette`,
            rowOffenders,
        ),
    );

    // ---- Ort: aktiver Fremdschlüssel, Anzahl und Sternesumme je Ort ----------------------------------------------------------------
    const inactive = await count(
        database,
        `SELECT count(*) FROM place_review r JOIN place p ON p.id = r.place_id WHERE NOT p.is_active`,
    );
    const perPlace = await database<{ place_id: string; reviews: number; stars: number; ids: string }[]>`
        SELECT place_id::text,
               count(*)::int AS reviews,
               sum(stars)::int AS stars,
               array_agg(legacy_review_id ORDER BY legacy_created_at DESC, legacy_review_id DESC)::text AS ids
        FROM place_review WHERE source_system = 'legacy' AND inhalt_geloescht_at IS NULL GROUP BY place_id
    `;
    const haveByPlace = new Map(perPlace.map((row) => [row.place_id, row]));
    const wantByPlace = new Map<string, { publicId: string; reviews: number; stars: number; ids: number[] }>();
    for (const row of [...reviews].sort(
        (a, b) =>
            (a.legacyCreatedAt < b.legacyCreatedAt ? 1 : a.legacyCreatedAt > b.legacyCreatedAt ? -1 : 0) ||
            b.legacyReviewId - a.legacyReviewId,
    )) {
        const entry = wantByPlace.get(row.placeId) ?? { publicId: row.placePublicId, reviews: 0, stars: 0, ids: [] };
        entry.reviews += 1;
        entry.stars += row.stars;
        entry.ids.push(row.legacyReviewId);
        wantByPlace.set(row.placeId, entry);
    }
    const placeOffenders: string[] = [];
    const orderOffenders: string[] = [];
    for (const [placeId, want] of wantByPlace) {
        const have = haveByPlace.get(placeId);
        if (!have || have.reviews !== want.reviews || have.stars !== want.stars) {
            placeOffenders.push(
                `Ort ${want.publicId}: ${String(have?.reviews ?? 0)} Bewertungen, Sterne ${String(have?.stars ?? 0)} statt ${String(want.reviews)} und ${String(want.stars)}`,
            );
        } else if (have.ids !== `{${want.ids.join(",")}}`) {
            orderOffenders.push(`Ort ${want.publicId}: ${have.ids} statt {${want.ids.join(",")}}`);
        }
    }
    for (const placeId of haveByPlace.keys()) {
        if (!wantByPlace.has(placeId))
            placeOffenders.push(`Ort mit Id ${placeId}: Bewertungen ohne Gegenstück in der Antwort`);
    }
    checks.push(
        check(
            "place",
            inactive === 0 && placeOffenders.length === 0,
            inactive === 0 && placeOffenders.length === 0
                ? `jeder Fremdschlüssel löst auf eine AKTIVE Ortszeile; je Ort (${String(wantByPlace.size)}) stimmen Anzahl und Sternesumme mit der Antwort überein`
                : `${String(inactive)} Bewertungen an einem stillgelegten Ort, ${String(placeOffenders.length)} Orte mit abweichender Anzahl oder Sternesumme`,
            placeOffenders,
        ),
    );
    checks.push(
        check(
            "order",
            orderOffenders.length === 0,
            orderOffenders.length === 0
                ? "je Ort entspricht die Folge (Anlagezeit, Nummer; beide absteigend) der Folge, die aus der Antwort gerechnet wird"
                : `${String(orderOffenders.length)} Orte mit anderer Reihenfolge`,
            orderOffenders,
        ),
    );

    // ---- Struktur ----------------------------------------------------------------------------------------------------------------
    const structure = await forbiddenColumns(database, ["place_review"], FORBIDDEN_COLUMNS);
    const personal = await database<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'place_review'
          AND column_name ~ '(^|_)(ip|agent|origin|email|mail|session|token|user|account)(_|$)'
    `;
    const structureOffenders = [
        ...structure.map((row) => `${row.table_name}.${row.column_name} (${row.data_type})`),
        ...personal.map((row) => `place_review.${row.column_name} (nach dem Namen personenbezogen)`),
    ];
    checks.push(
        check(
            "structure",
            structureOffenders.length === 0,
            structureOffenders.length === 0
                ? "keine Spalte ip_hash, user_agent, request_origin, is_hidden, is_spam, location_name oder created_by und keine nach dem Namen personenbezogene; kein JSON-Typ, kein entity_type"
                : `${String(structureOffenders.length)} verbotene Spalten`,
            [...new Set(structureOffenders)],
        ),
    );

    // ---- Datenschutz der Ausgabe -------------------------------------------------------------------------------------------------
    const output = JSON.stringify(expected.findings);
    const leaks: string[] = [];
    for (const row of expected.reviews) {
        if (
            row.authorName !== null &&
            [...row.authorName].length >= 6 &&
            output.includes(JSON.stringify(row.authorName).slice(1, -1))
        ) {
            leaks.push(`Bewertung ${String(row.legacyReviewId)}: der Autor steht in einem Befund`);
        }
        if (row.body !== null && [...row.body].length >= 10 && output.includes(JSON.stringify(row.body).slice(1, -1))) {
            leaks.push(`Bewertung ${String(row.legacyReviewId)}: der Text steht in einem Befund`);
        }
    }
    checks.push(
        check(
            "privacy_output",
            leaks.length === 0,
            leaks.length === 0
                ? "kein Befund nennt einen Autorennamen oder einen Text (Probe der Befunde gegen die Quelle); Berichte nennen Kennungen und Zahlen"
                : `${String(leaks.length)} Befunde enthalten personenbezogenen Text`,
            leaks,
        ),
    );

    const settled = settleChecks("verify:reviews", checks);
    return { passed: settled.passed, skipped: false, checks: settled.checks, findings: expected.findings };
}
