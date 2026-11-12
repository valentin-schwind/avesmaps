import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { search } from "../src/search/search.ts";
import { createSubjectService, type SubjectService } from "../src/subjects/service.ts";
import { MAP_DOMAIN, P4, cleanSubjectFixtures, insertSubjectFixtures } from "./support/subject-fixture.ts";

/**
 * Verborgene Orte werden auf der Karte entdeckt (WI-0080).
 *
 * 🔴 Die Regel des Betreibers (2026-10-05, wörtlich): „verborgene orte sind spielerisch nur über die karte zu
 * erkunden, tauchen nicht in der wegpunkt-suche und nicht in der spotlight-suche auf, können aber ganz normal
 * angeklickt und bereist werden, wenn sie entdeckt werden“.
 *
 * 💣 Die Regel steht an mehreren Stellen, und sie ist an jeder EINZELNEN davon leise: Wer den Riegel irrtümlich
 * zurück in `detail-place.ts` oder `service.ts` setzt, bekommt einen Ort, den man sieht und anklickt und der mit
 * 404 antwortet. Wer ihn aus `search.ts` oder `nearby.ts` nimmt, verrät jeden Fund, ohne dass etwas rot wird.
 * Deshalb stehen alle Stellen hier beieinander, mit dem Grund daneben.
 *
 * 🪤 Bewusste Abweichung von Legacy: Dort ist ein verborgener Ort unsichtbar, aber über seinen Namen SUCHBAR
 * (`MCS-006`). Hier ist es umgekehrt.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase("Verborgene Orte (WI-0080)", () => {
    let database: Database;
    let service: SubjectService;

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string);
        await migrate(database);
        await insertSubjectFixtures(database);
        service = createSubjectService(database);
    }, 180_000);

    afterAll(async () => {
        await cleanSubjectFixtures(database);
        await database.end({ timeout: 5 });
    });

    it("🔴 gefunden heißt ganz normal: volles Detail und eine Quellenbox wie bei jedem Ort", async () => {
        // Der Klick auf die Marke holt das Detail. Vorher kam hier 404 (`detail-place.ts`), und weil der Ort
        // gar nicht gezeichnet wurde, fiel das niemandem auf.
        const detail = await service.detail({ kind: "place", id: P4.dorfVerborgen });
        expect(detail).not.toBeNull();
        expect(detail?.title).toBe("P4 Dorf Verborgen");
        expect(detail?.subject).toEqual({ kind: "place", id: P4.dorfVerborgen });
        // Die Quellenbox des Panels hängt an einem ZWEITEN Riegel (`service.ts`, `members`). Ohne ihn wäre er
        // der einzige Ort der Karte mit Panel, aber ohne Quellen.
        expect(await service.sources({ kind: "place", id: P4.dorfVerborgen })).not.toBeNull();
        // Ein Ort, den es nicht gibt, bleibt nichts - der Riegel ist weg, die Prüfung auf Vorhandensein nicht.
        expect(await service.detail({ kind: "place", id: randomUUID() })).toBeNull();
    });

    it("🔴 der Lesevertrag SAGT, dass er verborgen ist - der Client fragt nicht die Karte (Nachtrag 2026-10-05)", async () => {
        // Betreiber 2026-10-05: „kannst du eine weitere pille in lila neben ‚offiziell/inoffiziell‘ mit den titel ‚Verborgen‘“.
        // Der Kopf des Panels stellt sie neben das Kanon-Etikett; woher er das Merkmal hat, steht hier.
        const verborgen = await service.detail({ kind: "place", id: P4.dorfVerborgen });
        expect(verborgen?.hidden).toBe(true);
        // Nur, wo es zutrifft: Ein gewöhnlicher Ort trägt das Feld gar nicht (additiv, nicht `false`).
        const sichtbar = await service.detail({ kind: "place", id: P4.dorf });
        expect(sichtbar).not.toBeNull();
        expect(sichtbar?.hidden).toBeUndefined();
        expect("hidden" in (sichtbar ?? {})).toBe(false);
    });

    it("🔴 in keiner Suche: weder Spotlight noch Wegpunktsuche nennen ihn, auch nicht bei genauem Namen", async () => {
        const sichtbar = await search(database, "P4 Dorf", { mapDomainId: MAP_DOMAIN });
        expect(sichtbar.hits.map((hit) => hit.name)).toContain("P4 Dorf Eins");
        expect(sichtbar.hits.map((hit) => hit.name)).not.toContain("P4 Dorf Verborgen");
        // Auch wer den Namen schon kennt, findet ihn nicht über die Suche; er findet ihn auf der Karte.
        const genau = await search(database, "P4 Dorf Verborgen", { mapDomainId: MAP_DOMAIN });
        expect(genau.hits).toEqual([]);
    });

    it("🔴 in keiner Liste eines anderen Objekts: „In der Nähe“ nennt ihn nicht, obwohl er der nächste wäre", async () => {
        // Der verborgene Ort liegt auf (143|123), die drei sichtbaren Dörfer auf (140|120), (141|121) und
        // (142|122). Eine Abfrage direkt an seiner Stelle müsste ihn als nächsten nennen - sie darf nicht.
        const hier = await service.mapPoint(143, 123);
        const namen = (hier?.nearby ?? []).map((item) => item.name);
        expect(namen).not.toContain("P4 Dorf Verborgen");
        expect(namen).toContain("P4 Dorf Adresse");
    });

    it("🔴 kein Objektlink aus dem Wiki führt auf ihn: weder über die Kennung noch über die Adresse", async () => {
        // Ein Link im Wikitext nennt ihn nicht, sonst verriete ihn jeder Artikel, der ihn erwähnt.
        expect(await service.resolveLink({ param: "place", name: "place", value: P4.dorfVerborgen })).toMatchObject({
            notFound: { param: "place" },
        });
    });
});
