import { Value } from "@sinclair/typebox/value";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SubjectDetail, type SubjectDetail as SubjectDetailType, type SubjectFact } from "@avesmaps3d/shared";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { createSubjectService, type SubjectService } from "../src/subjects/service.ts";
import { P7, P7_WIKI, cleanP7Fixtures, insertP7Fixtures } from "./support/p7-fixture.ts";

/**
 * Die Staatsinfobox im Detail eines Herrschaftsgebiets (WI-0063 27.18, Gebietsexport E4, Migration 0076) gegen echtes PostgreSQL:
 * welche Zeilen aus `territory_detail` entstehen, in welcher Folge, mit welcher Herkunft, und was NICHT entsteht - der bewusste
 * Leerwert, die stillgelegte Zeile, ein Gebiet ohne Zeile und die vier Zusatzfelder, die nur verborgen mitkommen.
 *
 * Die Welt sind die Gebiete der P7-Fixtures (Vorsilbe `70000000-`); die Detailzeilen legt dieser Test von Hand an und räumt sie vor den
 * Gebieten wieder weg. Der Bestand `avesmaps3d_dev` ist ein anderer Ort und bleibt unberührt.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

type Origin = "override" | "wiki";

/** Ein Wert und seine Herkunft; `null` heißt: kein Wert und kein Vermerk. */
type Entry = readonly [value: string | null, origin?: Origin];

describeWithDatabase("Gebiet: Staatsinfobox aus E4 gegen PostgreSQL (WI-0063 27.18)", () => {
    let database: Database;
    let service: SubjectService;

    /**
     * Legt die Detailzeile eines Gebiets an: die Werte in den Spalten von `territory_detail`, die Herkunft je Feld in
     * `territory_detail_field_origin`. Eine aktive Zeile braucht mindestens ein Feld (Migration 0076), darum kommen die Werte mit dem INSERT.
     */
    async function setDetail(
        publicId: string,
        fields: Readonly<Record<string, Entry>>,
        state: { active: boolean } = { active: true },
    ): Promise<void> {
        const [territory] = await database<
            { id: string }[]
        >`SELECT id::text FROM territory WHERE public_id = ${publicId}::uuid`;
        if (!territory) throw new Error(`kein Gebiet ${publicId}`);
        // Die Spaltennamen kommen aus diesem Test, nie von außen; die Werte gehen als Parameter.
        const columns = Object.keys(fields);
        const values = columns.map((column) => (fields[column] as Entry)[0]);
        const marks = columns.map((_column, position) => `$${String(position + 2)}`);
        const retired = state.active ? "" : ", state, is_active, retired_at, retired_origin";
        const retiredValues = state.active ? "" : ", 'retired', FALSE, now(), 'import'";
        const [row] = await database.unsafe<{ id: string }[]>(
            `INSERT INTO territory_detail (territory_id, ${columns.join(", ")}${retired})
             VALUES ($1::bigint, ${marks.join(", ")}${retiredValues}) RETURNING id::text`,
            [territory.id, ...values],
        );
        if (!row) throw new Error("Detailzeile nicht angelegt");
        for (const column of columns) {
            const origin = (fields[column] as Entry)[1];
            if (origin === undefined) continue;
            await database`
                INSERT INTO territory_detail_field_origin (territory_detail_id, field, origin)
                VALUES (${row.id}::bigint, ${column}, ${origin})`;
        }
    }

    async function removeDetails(): Promise<void> {
        const mine = `(SELECT id FROM territory WHERE public_id::text LIKE '70000000-%')`;
        await database.unsafe(
            `DELETE FROM territory_detail_field_origin WHERE territory_detail_id IN (SELECT id FROM territory_detail WHERE territory_id IN ${mine})`,
        );
        await database.unsafe(`DELETE FROM territory_detail WHERE territory_id IN ${mine}`);
    }

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string);
        await migrate(database);
        // Ein früherer, abgebrochener Lauf hat vielleicht Detailzeilen hinterlassen; sie blockierten das Aufräumen der Gebiete.
        await removeDetails();
        await insertP7Fixtures(database);

        // Das Reich: alle 17 Felder, gemischte Herkunft, Hauptstadt verknüpft, der Sitz ein verborgener Ort.
        await database`
            UPDATE territory SET status_text = 'abhängige Provinz', valid_label = '100 BF - 900 BF',
                   wiki_url = ${`${P7_WIKI}P7_Reich`}, capital_place_public_id = ${P7.anfang}, seat_place_public_id = ${P7.versteck}
            WHERE public_id = ${P7.reich}::uuid`;
        await setDetail(P7.reich, {
            continent: ["Aventurien", "wiki"],
            founded_text: ["100 BF", "wiki"],
            dissolved_text: ["besteht", "override"],
            form_of_government: ["Feudalherrschaft", "wiki"],
            capital_name: ["P7 Anfang (nominell)", "wiki"],
            seat_name: ["Burg Versteck", "wiki"],
            ruler: ["Kaiser Test", "override"],
            language: ["Garethi", "wiki"],
            currency: ["Dukaten", "wiki"],
            population: ["80000(1040 BF)", "wiki"],
            founder: ["Kaiser Raul", "wiki"],
            political: ["Mittelreich", "override"],
            trade_zone: ["Nordmeer", "wiki"],
            trade_goods: ["Holz, Vieh", "wiki"],
            geographic: ["Testland", "wiki"],
            blazon: ["Rot, ein Greif", "wiki"],
            affiliation_raw: ["Mittelreich", "wiki"],
        });

        // Baronie Eins: der bewusste Leerwert beim Oberhaupt, ein leerer Hauptstadtname bei verknüpftem Ort, ein Rest nur mit Klammer.
        await database`
            UPDATE territory SET capital_place_public_id = ${P7.mitte} WHERE public_id = ${P7.baronieEins}::uuid`;
        await setDetail(P7.baronieEins, {
            ruler: ["", "override"],
            capital_name: ["", "override"],
            language: ["Tulamidya", "override"],
            founder: ["Gründer Eins", "wiki"],
            geographic: ["Mark(Baronie)", "wiki"],
        });

        // Anspruch Eins: ein eigener Knoten ohne Wiki-Artikel; nur Overrides, dazu ein Feld ohne Herkunftsvermerk.
        await database`
            UPDATE territory SET wiki_key = 'eigener-knoten:p7t', wiki_url = NULL WHERE public_id = ${P7.anspruchEins}::uuid`;
        await setDetail(P7.anspruchEins, {
            language: ["Garethi", "override"],
            political: ["Mittelreich", "override"],
            currency: ["Dukaten"],
        });

        // Anspruch Zwei: eine stillgelegte Zeile mit Werten. Baronie Zwei bekommt keine Zeile.
        await setDetail(
            P7.anspruchZwei,
            { ruler: ["Alt", "wiki"], language: ["Altgarethi", "wiki"] },
            { active: false },
        );

        service = createSubjectService(database);
    }, 180_000);

    afterAll(async () => {
        await removeDetails();
        await cleanP7Fixtures(database);
        await database.end({ timeout: 5 });
    });

    async function territory(id: string): Promise<SubjectDetailType> {
        const result = await service.detail({ kind: "territory", id });
        if (result === null) throw new Error(`kein Gebiet: ${id}`);
        expect(
            Value.Check(SubjectDetail, result),
            JSON.stringify([...Value.Errors(SubjectDetail, result)].slice(0, 2)),
        ).toBe(true);
        return result;
    }

    const fieldsOf = (detail: SubjectDetailType): string[] => (detail.facts ?? []).map((fact) => fact.field);
    const factOf = (detail: SubjectDetailType, field: string): SubjectFact | undefined =>
        (detail.facts ?? []).find((fact) => fact.field === field);
    const valueOf = (detail: SubjectDetailType, field: string): string | undefined => {
        const fact = factOf(detail, field);
        return fact !== undefined && "value" in fact ? fact.value : undefined;
    };

    it("🔴 viele Felder: alle Zeilen der Infobox in Legacys Folge, dahinter die vier verborgenen Zusatzfelder", async () => {
        const reich = await territory(P7.reich);
        expect(fieldsOf(reich)).toEqual([
            "status",
            "herrschaftsform",
            "oberhaupt",
            "gruendung",
            "aufloesung",
            "gruender",
            "capital",
            "seat",
            "sprache",
            "waehrung",
            "einwohnerzahl",
            "handelszone",
            "geographisch",
            "validity",
            "handelswaren",
            "continent",
            "politisch",
            "wappenbeschreibung",
            "zugehoerigkeitRoh",
        ]);
        expect(valueOf(reich, "herrschaftsform")).toBe("Feudalherrschaft");
        expect(valueOf(reich, "oberhaupt")).toBe("Kaiser Test");
        expect(valueOf(reich, "gruendung")).toBe("100 BF");
        expect(valueOf(reich, "aufloesung")).toBe("besteht");
        // Legacy setzt vor jede Klammer ein Leerzeichen (`normalizeRegionParentheticalSpacing`).
        expect(valueOf(reich, "einwohnerzahl")).toBe("80000 (1040 BF)");
        expect(valueOf(reich, "handelswaren")).toBe("Holz, Vieh");
    });

    it("🔴 genau die vier Felder, die Legacy nicht zeigt, tragen legacyHidden; keine Zeile der Infobox trägt es", async () => {
        const reich = await territory(P7.reich);
        const hidden = (reich.facts ?? []).filter((fact) => fact.legacyHidden === true).map((fact) => fact.field);
        expect(hidden).toEqual(["continent", "politisch", "wappenbeschreibung", "zugehoerigkeitRoh"]);
        expect(valueOf(reich, "politisch")).toBe("Mittelreich");
        expect(valueOf(reich, "wappenbeschreibung")).toBe("Rot, ein Greif");
    });

    it("die Herkunft je Feld: Wiki-Text mit der Adresse des Gebiets, ein Override und ein Feld ohne Vermerk sind redaktionell", async () => {
        const reich = await territory(P7.reich);
        expect(factOf(reich, "herrschaftsform")?.provenance).toEqual({ kind: "wiki", wikiUrl: `${P7_WIKI}P7_Reich` });
        expect(factOf(reich, "oberhaupt")?.provenance).toEqual({ kind: "editorial" });
        expect(factOf(reich, "aufloesung")?.provenance).toEqual({ kind: "editorial" });
        const eigen = await territory(P7.anspruchEins);
        // Das Gebiet ohne Herkunftsvermerk beim Währungsfeld: nie „wiki“.
        expect(factOf(eigen, "waehrung")?.provenance).toEqual({ kind: "editorial" });
    });

    it("🔴 Hauptstadt: der Text des Gebietsexports, der Link über die Kennung des Ortes; ein verborgener Ort verlinkt nicht", async () => {
        const reich = await territory(P7.reich);
        const capital = factOf(reich, "capital");
        expect(capital).toMatchObject({
            field: "capital",
            value: "P7 Anfang (nominell)",
            ref: { kind: "place", id: P7.anfang },
        });
        // Der Sitz ist ein verborgener Ort: der Text steht, ein Link auf ihn gäbe es nicht, und sein Name steht nirgends sonst.
        const seat = factOf(reich, "seat");
        expect(seat).toMatchObject({ field: "seat", value: "Burg Versteck" });
        expect(seat !== undefined && "ref" in seat).toBe(false);
    });

    it("🔴 der bewusste Leerwert: keine Zeile Oberhaupt; was daneben einen Inhalt hat, steht", async () => {
        const baronie = await territory(P7.baronieEins);
        expect(fieldsOf(baronie)).not.toContain("oberhaupt");
        expect(valueOf(baronie, "sprache")).toBe("Tulamidya");
        expect(valueOf(baronie, "gruender")).toBe("Gründer Eins");
        expect(valueOf(baronie, "geographisch")).toBe("Mark (Baronie)");
        for (const fact of baronie.facts ?? []) {
            expect("value" in fact ? fact.value.trim() : "x", fact.field).not.toBe("");
        }
    });

    it("ein leerer Hauptstadtname nimmt den Namen des verknüpften Ortes nicht weg (Legacy zeigt ihn auch dann)", async () => {
        const baronie = await territory(P7.baronieEins);
        expect(factOf(baronie, "capital")).toMatchObject({
            value: "P7 Mitte",
            ref: { kind: "place", id: P7.mitte },
            provenance: { kind: "editorial" },
        });
    });

    it("🔴 ein eigener Knoten ohne Wiki-Artikel: seine Overrides stehen, das Zusatzfeld bleibt verborgen, es gibt keine Wikizeile", async () => {
        const eigen = await territory(P7.anspruchEins);
        expect(fieldsOf(eigen)).toEqual(["sprache", "waehrung", "politisch"]);
        expect(valueOf(eigen, "sprache")).toBe("Garethi");
        expect(factOf(eigen, "politisch")?.legacyHidden).toBe(true);
        expect(eigen.wiki).toBeUndefined();
    });

    it("🔴 ein Gebiet ohne Detailzeile und ein Gebiet mit stillgelegter Zeile bekommen keine Zeile der Infobox", async () => {
        const ohne = await territory(P7.baronieZwei);
        expect(ohne.facts).toBeUndefined();
        const still = await territory(P7.anspruchZwei);
        expect(still.facts).toBeUndefined();
    });

    it("X1 führt für Staatsartikel keine Feldlinks: kein Fakt der Infobox trägt `links`", async () => {
        const reich = await territory(P7.reich);
        for (const fact of reich.facts ?? []) expect("links" in fact, fact.field).toBe(false);
    });
});
