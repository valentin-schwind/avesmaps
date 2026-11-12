import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import type { Finding } from "../src/findings.ts";
import { importReviews } from "../src/migration/reviews-import.ts";
import {
    normalizeCreatedAt,
    transformReviews,
    type ReviewPlace,
    type ReviewPlaceIndex,
} from "../src/migration/reviews.ts";
import { verifyReviews } from "../src/migration/verify-reviews.ts";

/**
 * Bewertungen (WI-0063 P3, Migration 0075, Vertrag `reviews.yaml`, D4, Export E3): erst die reine Umwandlung mit kleinen Antworten in
 * der Form der Beispielantwort von Legacy (`docs/legacy-exporte/location-reviews-export.beispiel.json`, Mirror `024e3af3d`, gekürzt),
 * dann Import, Idempotenz, Löschen statt Stilllegen, wiederverwendete Nummern, geschützte Zeilen und der Prüfer gegen echtes PostgreSQL.
 *
 * 🔴 Der Datenschutztest steht in beiden Teilen: Eine Antwort, die fälschlich `ip_hash`, `user_agent`, `request_origin` oder Moderationsflaggen
 * trüge, darf nie in einer Zeile, einem Befund oder einem Bericht auftauchen.
 */

type Bag = Record<string, unknown>;

/** Kennungen der Fixture: Orte `75000000-…`, andere Träger `75100000-…`. */
const id = (prefix: string, n: number): string => `${prefix}-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const placeId = (n: number): string => id("75000000", n);
const otherId = (n: number): string => id("75100000", n);

const ANGBAR = placeId(1);
const GAREBORN = placeId(2);
const GELOESCHT = placeId(3);
const WEG = otherId(1);

const review = (n: number, over: Bag = {}): Bag => ({
    id: n,
    location_public_id: ANGBAR,
    location_name: "R75T Angbar",
    location_active: true,
    author_name: `Autor-${String(n)}-Alrik`,
    stars: 4,
    body: `Text der Bewertung ${String(n)} mit einigen Worten.`,
    dsa_date: "3. Praios 1047 BF",
    created_at: `2026-08-0${String(((n - 1) % 8) + 1)} 10:00:00`,
    ...over,
});

/** Eine stimmige Antwort: `moderated` Zeilen sind verborgen oder Spam und fehlen in der Liste. */
function answer(reviews: unknown[], over: { moderated?: number; counts?: Bag } & Bag = {}): Bag {
    const { moderated = 0, counts, ...rest } = over;
    return {
        ok: true,
        map_revision: 812,
        reviews_revision: "rev-5c1f0e9a7b3d2c41",
        counts: {
            total: reviews.length + moderated,
            visible: reviews.length,
            hidden: moderated,
            spam: 0,
            orphaned_location_ids: 0,
            orphaned_reviews: 0,
            ...counts,
        },
        reviews,
        ...rest,
    };
}

function index(): ReviewPlaceIndex {
    const place = (n: number, name: string, active = true): ReviewPlace => ({
        id: String(n),
        publicId: placeId(n),
        name,
        active,
    });
    const places = new Map<string, ReviewPlace>([
        [ANGBAR, place(1, "R75T Angbar")],
        [GAREBORN, place(2, "R75T Gareborn")],
        [GELOESCHT, place(3, "R75T Gelöscht", false)],
    ]);
    return { places, otherCarriers: new Set([WEG]) };
}

const find = (findings: readonly Finding[], code: string): Finding | undefined =>
    findings.find((finding) => finding.code === code);

describe("Bewertungen: die reine Umwandlung der Antwort von E3", () => {
    it("übernimmt die sichtbaren Bewertungen und löst den Ort über die Kennung auf (Beispielantwort, gekürzt)", () => {
        const payload = answer(
            [
                review(1, { author_name: "Alrik", body: "Gutes Bier.", created_at: "2026-08-01 10:00:00" }),
                review(2, {
                    location_public_id: GELOESCHT,
                    location_name: "Altes Dorf",
                    location_active: false,
                    author_name: "Rondra",
                    stars: 3,
                    body: "Stand hier mal.",
                    dsa_date: "",
                    created_at: "2026-08-02 10:00:00",
                }),
                review(3, {
                    location_public_id: "erfunden-123",
                    location_name: "Nirgendwo",
                    location_active: false,
                    created_at: "2026-08-03 10:00:00",
                }),
                review(7, {
                    location_public_id: WEG,
                    location_name: "Reichsstrasse",
                    location_active: false,
                    created_at: "2026-08-07 10:00:00",
                }),
            ],
            { moderated: 3, counts: { hidden: 2, spam: 2, orphaned_location_ids: 3, orphaned_reviews: 3 } },
        );
        const result = transformReviews(payload, index());
        expect(result.skipped).toBe(false);
        expect(result.delivered).toBe(4);
        expect(result.reviews).toEqual([
            {
                legacyReviewId: 1,
                placeId: "1",
                placePublicId: ANGBAR,
                stars: 4,
                authorName: "Alrik",
                body: "Gutes Bier.",
                dsaDate: "3. Praios 1047 BF",
                legacyCreatedAt: "2026-08-01T10:00:00.000",
            },
        ]);
        expect(result.notStored).toEqual({
            review_orphan_inactive_place: 1,
            review_location_not_uuid: 1,
            review_orphan_other_carrier: 1,
        });
        expect(find(result.findings, "review_orphan_inactive_place")?.objectCount).toBe(1);
        expect(find(result.findings, "review_orphan_other_carrier")?.objects[0]?.publicId).toBe("7");
        expect(result.counts).toEqual({
            total: 7,
            visible: 4,
            hidden: 2,
            spam: 2,
            orphanedLocationIds: 3,
            orphanedReviews: 3,
        });
        expect(result.stamp).toEqual({ reviewsRevision: "rev-5c1f0e9a7b3d2c41", mapRevision: 812 });
    });

    it("🔴 liest nie ein Feld außerhalb der Positivliste: von ip_hash, user_agent, request_origin bleibt nur der Name", () => {
        const payload = answer([
            review(1, {
                ip_hash: "GEHEIM-IPHASH",
                user_agent: "GEHEIM-AGENT",
                request_origin: "GEHEIM-HERKUNFT",
                created_by: "GEHEIM-KONTO",
                zusatz: "GEHEIM-ZUSATZ",
            }),
        ]);
        const result = transformReviews(payload, index());
        expect(result.reviews).toHaveLength(1);
        const everything = JSON.stringify(result);
        for (const secret of ["GEHEIM-IPHASH", "GEHEIM-AGENT", "GEHEIM-HERKUNFT", "GEHEIM-KONTO", "GEHEIM-ZUSATZ"]) {
            expect(everything, secret).not.toContain(secret);
        }
        expect(Object.keys(result.reviews[0] as object).sort()).toEqual(
            [
                "authorName",
                "body",
                "dsaDate",
                "legacyCreatedAt",
                "legacyReviewId",
                "placeId",
                "placePublicId",
                "stars",
            ].sort(),
        );
        const personal = find(result.findings, "personal_column_in_export");
        expect(personal?.notes).toEqual([
            "Schlüssel created_by",
            "Schlüssel ip_hash",
            "Schlüssel request_origin",
            "Schlüssel user_agent",
        ]);
        expect(find(result.findings, "review_field_unknown")?.notes).toEqual(["Schlüssel zusatz"]);
    });

    it("🔴 speichert nie eine Zeile, die is_hidden oder is_spam mit Wert wahr trägt (eine mit Wert falsch bleibt, die Flagge wird nie gelesen)", () => {
        const payload = answer([
            review(1, { is_hidden: 1, body: "GEHEIM-VERBORGEN" }),
            review(2, { is_spam: true, body: "GEHEIM-SPAM" }),
            review(3, { is_hidden: 0, is_spam: false }),
        ]);
        const result = transformReviews(payload, index());
        expect(result.reviews.map((row) => row.legacyReviewId)).toEqual([3]);
        expect(find(result.findings, "review_flag_in_export")?.objectCount).toBe(2);
        expect(JSON.stringify(result.findings)).not.toContain("GEHEIM");
        // Eine Flagge mit Wert falsch ist kein unbekanntes Feld und kein Personenbezug.
        expect(find(result.findings, "review_field_unknown")).toBeUndefined();
        expect(find(result.findings, "personal_column_in_export")).toBeUndefined();
    });

    it("🔴 kein Befund nennt einen Text oder Autor, nur Kennungen und Zahlen", () => {
        const payload = answer([
            review(1, {
                author_name: "ZZ-Systemtest (Agent 10)",
                body: "ZZ-Systemtest vom 05.08.2026 - bitte loeschen",
            }),
            review(2, { author_name: "", body: "x".repeat(250) }),
            review(3, { author_name: "Name mit Klarnamen Hubertus Mustermann", location_name: "Ganz anderer Ort" }),
            review(4, { location_public_id: "erfunden", author_name: "Nur ein Autor ohne Ort" }),
        ]);
        const result = transformReviews(payload, index());
        const output = JSON.stringify(result.findings);
        for (const secret of [
            "Systemtest (Agent",
            "bitte loeschen",
            "xxxxxxxxxx",
            "Hubertus",
            "Mustermann",
            "Ganz anderer Ort",
            "Nur ein Autor",
        ]) {
            expect(output, secret).not.toContain(secret);
        }
        // Die Systemtest-Zeile wird gemeldet, nicht gefiltert (Legacy-Befund id 121).
        expect(result.reviews.map((row) => row.legacyReviewId)).toEqual([1, 2, 3]);
        expect(find(result.findings, "review_test_row")?.objects).toEqual([
            { table: "place_review", publicId: "1", name: `Ort ${ANGBAR}` },
        ]);
        expect(find(result.findings, "review_author_empty")?.objectCount).toBe(1);
        expect(find(result.findings, "review_text_exceeds_legacy_limit")?.objects[0]?.publicId).toBe("2");
        expect(find(result.findings, "review_location_name_changed")?.objectCount).toBe(1);
        // Ein leerer Autor ist NULL (nie ein leerer String), ein zu langer Text bleibt unverändert.
        expect(result.reviews.find((row) => row.legacyReviewId === 2)).toMatchObject({
            authorName: null,
            body: "x".repeat(250),
        });
    });

    it("meldet Sterne außerhalb von 1 bis 5 und eine unlesbare Anlagezeit und speichert beide nicht", () => {
        const payload = answer([
            review(1, { stars: 0 }),
            review(2, { stars: 6 }),
            review(3, { stars: 3.5 }),
            review(4, { created_at: "gestern" }),
            review(5, { created_at: "2026-02-30 10:00:00" }),
            review(6),
        ]);
        const result = transformReviews(payload, index());
        expect(result.reviews.map((row) => row.legacyReviewId)).toEqual([6]);
        expect(find(result.findings, "review_stars_out_of_range")?.objectCount).toBe(3);
        expect(find(result.findings, "review_created_missing")?.objectCount).toBe(2);
    });

    it("eine doppelte Nummer in der Antwort: die erste gilt; eine Zeile ohne Nummer ist nicht speicherbar", () => {
        const payload = answer([review(1), review(1, { stars: 1 }), { author_name: "ohne Nummer" }, "kein Objekt"]);
        const result = transformReviews(payload, index());
        expect(result.reviews).toHaveLength(1);
        expect(result.reviews[0]?.stars).toBe(4);
        expect(find(result.findings, "review_duplicate_id")?.objectCount).toBe(1);
        expect(find(result.findings, "review_row_unusable")?.numbers["zeilen"]).toBe(2);
    });

    it("Legacy und Avesmaps3D stufen den Ort verschieden ein: Information, die Auflösung gilt nach Avesmaps3D", () => {
        const payload = answer([
            // Legacy aktiv, hier unbekannt.
            review(1, { location_public_id: otherId(99), location_active: true }),
            // Legacy nicht aktiv, hier ein aktiver Ort.
            review(2, { location_active: false }),
            // einig
            review(3),
        ]);
        const result = transformReviews(payload, index());
        expect(result.reviews.map((row) => row.legacyReviewId)).toEqual([2, 3]);
        const finding = find(result.findings, "review_location_active_disagrees");
        expect(finding?.numbers).toMatchObject({
            legacy_aktiv_hier_nicht: 1,
            legacy_nicht_aktiv_hier_aktiv: 1,
            einig: 1,
        });
        expect(find(result.findings, "review_orphan_unknown_id")?.objectCount).toBe(1);
    });

    it("🔴 eine unbrauchbare Antwort schreibt nichts: ok nicht true, keine Liste, keine Zahlen", () => {
        for (const payload of [
            null,
            "text",
            { ok: false, reviews: [], counts: {} },
            { ok: true, counts: {} },
            { ok: true, reviews: [] },
        ]) {
            const result = transformReviews(payload, index());
            expect(result.skipped).toBe(true);
            expect(result.reviews).toEqual([]);
            expect(result.findings.map((finding) => finding.code)).toEqual(["source_block_missing"]);
        }
    });

    it("🔴 eine in sich widersprüchliche Antwort schreibt nichts: Anzahl der Liste gegen counts.visible", () => {
        const wrongCount = transformReviews(
            answer([review(1), review(2)], { counts: { visible: 3, total: 3 } }),
            index(),
        );
        expect(wrongCount.skipped).toBe(true);
        expect(wrongCount.findings.map((finding) => finding.code)).toEqual(["source_counts_disagree"]);
        // verborgen und Spam passen nicht zu gesamt minus sichtbar
        const inconsistent = transformReviews(
            answer([review(1)], { counts: { total: 9, hidden: 1, spam: 1 } }),
            index(),
        );
        expect(inconsistent.findings.map((finding) => finding.code)).toEqual(["source_counts_disagree"]);
        // hidden und spam dürfen sich überschneiden: eine Zeile, die beides ist
        const overlapping = transformReviews(
            answer([review(1)], { counts: { total: 4, visible: 1, hidden: 2, spam: 2 } }),
            index(),
        );
        expect(overlapping.skipped).toBe(false);
    });

    it("🔴 eine leere Liste ist nur mit Beleg ein Stand: gesamt 0 ist keiner, alle verborgen schon", () => {
        const nothing = transformReviews(answer([]), index());
        expect(nothing.skipped).toBe(true);
        expect(nothing.findings.map((finding) => finding.code)).toEqual(["source_empty_catalog"]);
        const allModerated = transformReviews(answer([], { moderated: 5 }), index());
        expect(allModerated.skipped).toBe(false);
        expect(allModerated.reviews).toEqual([]);
    });

    it("normalisiert die naive Anlagezeit auf Millisekunden, ohne Zeitzone", () => {
        expect(normalizeCreatedAt("2026-08-01 10:00:00")).toBe("2026-08-01T10:00:00.000");
        expect(normalizeCreatedAt("2026-08-01T10:00:00.5")).toBe("2026-08-01T10:00:00.500");
        expect(normalizeCreatedAt("2026-08-01 10:00:00.123456")).toBe("2026-08-01T10:00:00.123");
        expect(normalizeCreatedAt("2026-08-01 25:00:00")).toBeNull();
        expect(normalizeCreatedAt("2026-02-30 10:00:00")).toBeNull();
        expect(normalizeCreatedAt(null)).toBeNull();
    });
});

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase("Bewertungen: Import, Idempotenz, Löschen und Prüfer gegen PostgreSQL (Migration 0075)", () => {
    let database: Database;
    let placeIds: Record<string, string>;

    async function clean(): Promise<void> {
        await database.unsafe(
            `DELETE FROM place_review WHERE place_id IN (SELECT id FROM place WHERE public_id::text LIKE '75000000-%')`,
        );
        await database.unsafe(`DELETE FROM place_review WHERE source_system = 'test'`);
        await database.unsafe(`DELETE FROM place WHERE public_id::text LIKE '75000000-%'`);
        await database.unsafe(`DELETE FROM path WHERE public_id::text LIKE '75100000-%'`);
        try {
            // Die Läufe der Tests; hängt noch eine Zeile daran, bleibt der Lauf stehen.
            await database.unsafe(`DELETE FROM migration_run WHERE data_domain = 'reviews'`);
        } catch {
            // ein Fremdschlüssel hält ihn: stehen lassen
        }
    }

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string);
        await migrate(database);
        await seedMapDomains(database);
        await clean();
    }, 180_000);

    afterAll(async () => {
        await clean();
        await database.end({ timeout: 5 });
    });

    beforeEach(async () => {
        await clean();
        placeIds = {};
        const insertPlace = async (publicId: string, name: string, active: boolean, x: number): Promise<void> => {
            const [row] = await database<{ id: string }[]>`
                INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
                VALUES (${publicId}, 'aventuria', ${name}, 'stadt', ST_SetSRID(ST_MakePoint(${x}, 300), 0), 'test', ${active})
                RETURNING id::text
            `;
            placeIds[publicId] = (row as { id: string }).id;
        };
        await insertPlace(ANGBAR, "R75T Angbar", true, 300);
        await insertPlace(GAREBORN, "R75T Gareborn", true, 301);
        await insertPlace(GELOESCHT, "R75T Gelöscht", false, 302);
        await database`
            INSERT INTO path (public_id, map_domain_id, name, subtype, is_bach, geom, source_system, is_active)
            VALUES (${WEG}, 'aventuria', 'R75T Weg', 'Strasse', FALSE,
                    ST_SetSRID(ST_MakeLine(ST_MakePoint(300, 310), ST_MakePoint(310, 310)), 0), 'test', TRUE)
        `;
    });

    const rows = async (): Promise<
        {
            legacy_review_id: number;
            place_public_id: string;
            stars: number;
            author_name: string | null;
            created: string;
        }[]
    > =>
        database`
            SELECT r.legacy_review_id, p.public_id::text AS place_public_id, r.stars, r.author_name,
                   to_char(r.legacy_created_at, 'YYYY-MM-DD HH24:MI:SS') AS created
            FROM place_review r JOIN place p ON p.id = r.place_id
            WHERE p.public_id::text LIKE '75000000-%'
            ORDER BY r.legacy_review_id
        `;

    function fixtureAnswer(): Bag {
        return answer(
            [
                review(1, { author_name: "Alrik", body: "Gutes Bier.", stars: 5, created_at: "2026-08-01 10:00:00" }),
                review(2, { location_public_id: GAREBORN, stars: 3, dsa_date: "", created_at: "2026-08-02 10:00:00" }),
                review(3, { author_name: "", body: "", stars: 4, created_at: "2026-08-03 10:00:00" }),
                review(4, { location_public_id: GELOESCHT, location_active: false }),
                review(5, { location_public_id: WEG, location_active: false }),
            ],
            { moderated: 2, counts: { hidden: 1, spam: 1, orphaned_location_ids: 2, orphaned_reviews: 2 } },
        );
    }

    it("legt die speicherbaren Bewertungen an, NULL für leere Texte, nichts für Verwaistes; der zweite Lauf ändert nichts", async () => {
        const first = await importReviews(database, fixtureAnswer());
        expect(first.skipped).toBe(false);
        expect(first.tables.place_review).toMatchObject({ created: 3, updated: 0, unchanged: 0, retired: 0 });
        expect(first.delivered).toBe(5);
        expect(first.stored).toBe(3);
        expect(first.changed).toBe(true);
        expect(await rows()).toEqual([
            {
                legacy_review_id: 1,
                place_public_id: ANGBAR,
                stars: 5,
                author_name: "Alrik",
                created: "2026-08-01 10:00:00",
            },
            {
                legacy_review_id: 2,
                place_public_id: GAREBORN,
                stars: 3,
                author_name: "Autor-2-Alrik",
                created: "2026-08-02 10:00:00",
            },
            {
                legacy_review_id: 3,
                place_public_id: ANGBAR,
                stars: 4,
                author_name: null,
                created: "2026-08-03 10:00:00",
            },
        ]);
        // Leere Texte sind NULL, nie ein leerer String.
        const [blank] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM place_review
            WHERE btrim(coalesce(author_name, 'x')) = '' OR btrim(coalesce(body, 'x')) = '' OR btrim(coalesce(dsa_date, 'x')) = ''
        `;
        expect(blank?.n).toBe(0);

        const second = await importReviews(database, fixtureAnswer());
        expect(second.tables.place_review).toMatchObject({ created: 0, updated: 0, unchanged: 3, retired: 0 });
        expect(second.changed).toBe(false);
        expect(second.reused).toBe(0);
    });

    it("🔴 was Legacy nicht mehr als sichtbar nennt, wird GELÖSCHT; der Bericht nennt Nummer und Ort, nie einen Text", async () => {
        await importReviews(database, fixtureAnswer());
        // Die Bewertung 2 wird in Legacy verborgen: sie fehlt im nächsten Satz.
        const without = answer(
            [
                review(1, { author_name: "Alrik", body: "Gutes Bier.", stars: 5, created_at: "2026-08-01 10:00:00" }),
                review(3, { author_name: "", body: "", stars: 4, created_at: "2026-08-03 10:00:00" }),
            ],
            { moderated: 3, counts: { hidden: 3 } },
        );
        const report = await importReviews(database, without);
        expect(report.tables.place_review.retired).toBe(1);
        expect((await rows()).map((row) => row.legacy_review_id)).toEqual([1, 3]);
        const removed = report.findings.find((finding) => finding.code === "review_removed");
        expect(removed?.objects).toEqual([{ table: "place_review", publicId: "2", name: `Ort ${GAREBORN}` }]);
        // 1 von 3 ist mehr als 5 Prozent: die Stilllegequote meldet nur.
        expect(report.findings.some((finding) => finding.code === "stilllegequote")).toBe(true);
        const output = JSON.stringify(report);
        for (const secret of ["Alrik", "Gutes Bier", "Text der Bewertung", "Autor-2"]) {
            expect(output, secret).not.toContain(secret);
        }
        // Es gibt keine Spalte, die den gelöschten Inhalt aufbewahrt.
        const [still] = await database<
            { n: number }[]
        >`SELECT count(*)::int AS n FROM place_review WHERE legacy_review_id = 2`;
        expect(still?.n).toBe(0);
    });

    it("🔴 eine leere, aber glaubwürdige Antwort (alle verborgen) löscht alles; eine ohne Beleg und eine unbrauchbare löschen nichts", async () => {
        await importReviews(database, fixtureAnswer());
        for (const payload of [
            answer([]),
            { ok: false, reviews: [] },
            null,
            answer([review(1)], { counts: { visible: 5 } }),
        ]) {
            const skipped = await importReviews(database, payload);
            expect(skipped.skipped).toBe(true);
            expect(skipped.changed).toBe(false);
            expect(await rows()).toHaveLength(3);
        }
        const allGone = await importReviews(database, answer([], { moderated: 4 }));
        expect(allGone.skipped).toBe(false);
        expect(allGone.tables.place_review.retired).toBe(3);
        expect(await rows()).toEqual([]);
    });

    it("eine wiederverwendete Nummer (andere Anlagezeit oder anderer Ort) ist eine NEUE Bewertung: die alte wird zuerst gelöscht", async () => {
        await importReviews(database, fixtureAnswer());
        const reused = answer(
            [
                review(1, { author_name: "Alrik", body: "Gutes Bier.", stars: 5, created_at: "2026-08-01 10:00:00" }),
                // Nummer 2 kehrt zurück: andere Anlagezeit, anderer Ort.
                review(2, { location_public_id: ANGBAR, stars: 1, created_at: "2026-09-15 08:30:00" }),
                review(3, { author_name: "", body: "", stars: 4, created_at: "2026-08-03 10:00:00" }),
            ],
            { moderated: 2, counts: { hidden: 2 } },
        );
        const report = await importReviews(database, reused);
        expect(report.reused).toBe(1);
        expect(report.findings.find((finding) => finding.code === "review_id_reused")?.objects[0]?.publicId).toBe("2");
        expect(await rows()).toEqual([
            {
                legacy_review_id: 1,
                place_public_id: ANGBAR,
                stars: 5,
                author_name: "Alrik",
                created: "2026-08-01 10:00:00",
            },
            {
                legacy_review_id: 2,
                place_public_id: ANGBAR,
                stars: 1,
                author_name: "Autor-2-Alrik",
                created: "2026-09-15 08:30:00",
            },
            {
                legacy_review_id: 3,
                place_public_id: ANGBAR,
                stars: 4,
                author_name: null,
                created: "2026-08-03 10:00:00",
            },
        ]);
        const again = await importReviews(database, reused);
        expect(again.changed).toBe(false);
        expect(again.reused).toBe(0);
    });

    it("ändert sich nur der Text einer Bewertung, ist es eine Änderung an derselben Zeile (geändert, nicht neu)", async () => {
        await importReviews(database, fixtureAnswer());
        const changed = fixtureAnswer();
        (changed["reviews"] as Bag[])[1] = review(2, {
            location_public_id: GAREBORN,
            stars: 2,
            dsa_date: "",
            created_at: "2026-08-02 10:00:00",
        });
        const report = await importReviews(database, changed);
        expect(report.tables.place_review).toMatchObject({ created: 0, updated: 1, unchanged: 2, retired: 0 });
        expect((await rows()).find((row) => row.legacy_review_id === 2)?.stars).toBe(2);
    });

    it("🔴 eine Zeile, die nicht aus Legacy stammt, fasst der Import nie an und löscht sie nie", async () => {
        await importReviews(database, fixtureAnswer());
        await database`
            INSERT INTO place_review (legacy_review_id, place_id, stars, author_name, legacy_created_at, source_system)
            VALUES (990001, ${placeIds[ANGBAR] as string}, 5, 'eigene Zeile', '2026-10-01 12:00:00', 'test')
        `;
        const report = await importReviews(database, fixtureAnswer());
        expect(report.changed).toBe(false);
        const [kept] = await database<
            { n: number }[]
        >`SELECT count(*)::int AS n FROM place_review WHERE source_system = 'test'`;
        expect(kept?.n).toBe(1);
        // Auch ein Satz, der alles Legacy-Eigene entfernt, lässt sie stehen.
        await importReviews(database, answer([], { moderated: 4 }));
        const [still] = await database<
            { n: number }[]
        >`SELECT count(*)::int AS n FROM place_review WHERE source_system = 'test'`;
        expect(still?.n).toBe(1);
    });

    it("🔴 der Import setzt den Zustand NUR beim Anlegen: neue Zeilen kommen als „gesichtet“, ein Zug ändert einen Zustand der Redaktion nie (WI-0269, Fachkonzept §14.3)", async () => {
        const payload = fixtureAnswer();
        await importReviews(database, payload);
        const zustaende = async (): Promise<Record<number, string>> =>
            Object.fromEntries(
                (
                    await database<
                        { legacy_review_id: number; zustand: string }[]
                    >`SELECT legacy_review_id, zustand FROM place_review WHERE source_system = 'legacy' ORDER BY 1`
                ).map((row) => [row.legacy_review_id, row.zustand]),
            );
        expect(await zustaende()).toEqual({ 1: "gesichtet", 2: "gesichtet", 3: "gesichtet" });
        // Die Redaktion verbirgt Nummer 1 und hält Nummer 2 zurück; Legacy ändert den Text von Nummer 1 und liefert eine neue Nummer 6.
        await database`UPDATE place_review SET zustand = 'verborgen', grund = 'spam' WHERE legacy_review_id = 1`;
        await database`UPDATE place_review SET zustand = 'zurueckgehalten', grund = 'adresse' WHERE legacy_review_id = 2`;
        const spaeter = answer(
            [
                review(1, { body: "Der Text hat sich in Legacy geändert." }),
                review(2, { location_public_id: GAREBORN, stars: 3, dsa_date: "", created_at: "2026-08-02 10:00:00" }),
                review(3, { author_name: "", body: "", stars: 4, created_at: "2026-08-03 10:00:00" }),
                review(6, { created_at: "2026-09-01 10:00:00" }),
            ],
            { moderated: 2, counts: { hidden: 1, spam: 1, orphaned_location_ids: 2, orphaned_reviews: 2 } },
        );
        const report = await importReviews(database, spaeter);
        expect(report.tables.place_review).toMatchObject({ created: 1, updated: 1 });
        expect(await zustaende()).toEqual({ 1: "verborgen", 2: "zurueckgehalten", 3: "gesichtet", 6: "gesichtet" });
        const [eins] = await database<
            { body: string; grund: string }[]
        >`SELECT body, grund FROM place_review WHERE legacy_review_id = 1`;
        expect(eins).toEqual({ body: "Der Text hat sich in Legacy geändert.", grund: "spam" });
        // Der Eingang einer Legacy-Zeile ist ihre Legacy-Zeit (nur für die Reihenfolge, als UTC gelesen).
        const [eingang] = await database<{ eingang: string }[]>`
            SELECT to_char(eingang AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS eingang FROM place_review WHERE legacy_review_id = 6
        `;
        expect(eingang?.eingang).toBe("2026-09-01 10:00:00");
    });

    it("🔴 eine Bewertung von der Website fasst der Import nie an und der Prüfer zählt sie nicht; eine mit gelöschtem Inhalt bekommt ihren Text nie zurück", async () => {
        const payload = fixtureAnswer();
        await importReviews(database, payload);
        await database`
            INSERT INTO place_review (place_id, stars, author_name, body, source_system, zustand)
            VALUES (${placeIds[ANGBAR] as string}, 5, 'Besucher', 'Von der Website', 'website', 'neu')
        `;
        // Die Redaktion hat den Inhalt von Nummer 1 gelöscht (Datenschutz): Zeile bleibt verborgen, ohne Name, Text, Datum.
        await database`
            UPDATE place_review SET zustand = 'verborgen', grund = 'person', author_name = NULL, body = NULL, dsa_date = NULL,
                   inhalt_geloescht_at = now() WHERE legacy_review_id = 1
        `;
        const report = await importReviews(database, payload);
        expect(report.changed).toBe(false);
        expect(report.tables.place_review.protectedRows).toBe(1);
        const [geblieben] = await database<{ body: string | null; author_name: string | null }[]>`
            SELECT body, author_name FROM place_review WHERE legacy_review_id = 1
        `;
        expect(geblieben).toEqual({ body: null, author_name: null });
        const [web] = await database<
            { n: number }[]
        >`SELECT count(*)::int AS n FROM place_review WHERE source_system = 'website'`;
        expect(web?.n).toBe(1);
        // Auch ein Satz ohne alle Legacy-Zeilen löscht weder die Website-Bewertung noch die Zeile mit gelöschtem Inhalt.
        await importReviews(database, answer([], { moderated: 4 }));
        const [rest] = await database<{ web: number; leer: number; alt: number }[]>`
            SELECT count(*) FILTER (WHERE source_system = 'website')::int AS web,
                   count(*) FILTER (WHERE inhalt_geloescht_at IS NOT NULL)::int AS leer,
                   count(*) FILTER (WHERE source_system = 'legacy' AND inhalt_geloescht_at IS NULL)::int AS alt
              FROM place_review
        `;
        expect(rest).toEqual({ web: 1, leer: 1, alt: 0 });
        // Der Prüfer vergleicht nur, was dem Import gehört.
        await importReviews(database, payload);
        const pruefung = await verifyReviews(database, payload);
        expect(pruefung.checks.filter((check) => !check.passed).map((check) => check.name)).toEqual([]);
    });

    it("🔴 ein Probelauf (dryRun) und ein Lauf ohne Beleg schreiben nichts, auch kein Journal", async () => {
        const [before] = await database<
            { n: number }[]
        >`SELECT count(*)::int AS n FROM migration_run WHERE data_domain = 'reviews'`;
        const report = await importReviews(database, fixtureAnswer(), { dryRun: true });
        expect(report.dryRun).toBe(true);
        expect(report.tables.place_review.created).toBe(3);
        expect(await rows()).toEqual([]);
        const [after] = await database<
            { n: number }[]
        >`SELECT count(*)::int AS n FROM migration_run WHERE data_domain = 'reviews'`;
        expect(after?.n).toBe(before?.n);
    });

    it("🔴 Datenschutz: eine Antwort mit Personenspalten und Flaggen bringt nichts davon in Zeilen, Befunde, Bericht oder Journal", async () => {
        const leaky = answer([
            review(1, {
                ip_hash: "GEHEIM-IPHASH",
                user_agent: "GEHEIM-AGENT",
                request_origin: "GEHEIM-HERKUNFT",
                created_by: "GEHEIM-KONTO",
            }),
            review(2, { is_hidden: 1, author_name: "Verborgene Person", body: "GEHEIM-VERBORGEN" }),
            review(3, { is_spam: 1, body: "GEHEIM-SPAM" }),
        ]);
        const report = await importReviews(database, leaky);
        expect(report.stored).toBe(1);
        const everything = JSON.stringify(report);
        for (const secret of ["GEHEIM", "Verborgene Person"]) {
            expect(everything, secret).not.toContain(secret);
        }
        expect(report.findings.some((finding) => finding.code === "personal_column_in_export")).toBe(true);
        expect(report.findings.some((finding) => finding.code === "review_flag_in_export")).toBe(true);
        const dump = await database<
            Record<string, unknown>[]
        >`SELECT * FROM place_review r WHERE r.legacy_review_id IN (1, 2, 3)`;
        expect(dump).toHaveLength(1);
        expect(JSON.stringify(dump)).not.toContain("GEHEIM");
        const [journal] = await database<{ journal: unknown }[]>`
            SELECT journal FROM migration_run WHERE data_domain = 'reviews' ORDER BY started_at DESC LIMIT 1
        `;
        expect(JSON.stringify(journal)).not.toContain("GEHEIM");
        // Die Tabelle hat keine Personenspalte und keine Moderationsflagge.
        const columns = await database<{ column_name: string }[]>`
            SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'place_review'
        `;
        const names = columns.map((column) => column.column_name);
        for (const forbidden of [
            "ip_hash",
            "user_agent",
            "request_origin",
            "is_hidden",
            "is_spam",
            "location_name",
            "created_by",
        ]) {
            expect(names, forbidden).not.toContain(forbidden);
        }
    });

    it("der Prüfer: Parität bestanden, mit Zahlen je Ort; er meldet eine veränderte Zeile, eine überzählige und eine fehlende", async () => {
        const payload = fixtureAnswer();
        await importReviews(database, payload);
        const ok = await verifyReviews(database, payload);
        expect(ok.skipped).toBe(false);
        expect(ok.checks.map((check) => `${check.name}:${String(check.passed)}`)).toEqual([
            "counts:true",
            "rows:true",
            "place:true",
            "order:true",
            "structure:true",
            "privacy_output:true",
        ]);
        expect(ok.passed).toBe(true);

        // Eine Zeile verändert, eine überzählig angelegt, eine entfernt.
        await database`UPDATE place_review SET stars = 1 WHERE legacy_review_id = 1`;
        await database`
            INSERT INTO place_review (legacy_review_id, place_id, stars, legacy_created_at)
            VALUES (990002, ${placeIds[ANGBAR] as string}, 2, '2026-10-02 12:00:00')
        `;
        await database`
            INSERT INTO place_review (legacy_review_id, place_id, stars, legacy_created_at)
            VALUES (990003, ${placeIds[ANGBAR] as string}, 2, '2026-10-03 12:00:00')
        `;
        await database`DELETE FROM place_review WHERE legacy_review_id = 3`;
        const broken = await verifyReviews(database, payload);
        const failed = broken.checks.filter((check) => !check.passed).map((check) => check.name);
        expect(failed).toEqual(expect.arrayContaining(["counts", "rows", "place"]));
        // Der Prüfer hält nichts an (Betreiber 2026-10-03): das Urteil bleibt bestanden, die Ausfälle sind Befunde.
        expect(broken.passed).toBe(true);
        expect(broken.checks.filter((check) => !check.passed).every((check) => check.blocking === false)).toBe(true);
    });

    it("der Prüfer hat bei einer unbrauchbaren Antwort nichts zu prüfen", async () => {
        const report = await verifyReviews(database, { ok: false });
        expect(report.skipped).toBe(true);
        expect(report.passed).toBe(true);
    });
});
