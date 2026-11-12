import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import {
    CommunityFehler,
    abschliessen,
    archivieren,
    aufbewahren,
    detail,
    liste,
    melden,
    notiz,
    papierkorb,
    personenbezugLoeschen,
    prioritaet,
    rueckfrage,
    sichten,
    statusAntworten,
    statusLesen,
    statusZurueckziehen,
    uebernehmen,
    wiedereroeffnen,
    wiederherstellen,
    zustaendig,
    type Meldung,
} from "../src/community/db.ts";
import { authFixture, type AuthFixture } from "./support/auth-fixture.ts";

/**
 * Das Community-Modul in der Datenbank (WI-0268, Migration 0265), gegen echtes PostgreSQL. Die Testrolle ist der Besitzer des Schemas;
 * die Rechte der App- und Jobs-Rolle prüft `community-grants.test.ts`.
 *
 * - Melden ist idempotent; der Bezug hält den Schnappschuss, die Statusseite zeigt nie Notizen und keine Begründung.
 * - 🔴 Revision: Wer mit einem veralteten Stand speichert, bekommt `community_conflict`; Notizen prüfen und zählen keine Revision.
 * - Lebenszyklus: Sichten, Übernehmen, Rückfrage, Antwort des Melders, Abschließen mit Pflichtbegründung, Wiedereröffnen,
 *   „durch Antwort wieder geöffnet“, Zurückziehen, Papierkorb, Wiederherstellen, Archiv.
 * - 🔴 Datenschutz: Personenbezug löschen und die Frist nach 90 Tagen leeren Melder und Statuslink; der Sachinhalt bleibt.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const ORT = "11111111-2222-4333-8444-555555555555";
const schluessel = (): string => randomBytes(32).toString("base64url");

async function fehler(lauf: Promise<unknown>): Promise<CommunityFehler> {
    try {
        await lauf;
    } catch (error) {
        if (error instanceof CommunityFehler) return error;
        throw error;
    }
    throw new Error("kein Fehler");
}

describeWithDatabase("Community: Datenmodell und Funktionen (PostgreSQL)", { timeout: 60_000 }, () => {
    let database: Database;
    let fixture: AuthFixture;
    let lena: string;
    let thomas: string;

    const meldung = (overrides: Partial<Meldung> = {}): Meldung => ({
        operationId: randomUUID(),
        schluessel: schluessel(),
        kategorie: "lage",
        text: "Wehrheim liegt zu weit im Westen, laut Regionalband näher an der Reichsstraße.",
        quelle: "Herz des Reiches, S. 112",
        name: "Alrike",
        bezug: {
            art: "objekt",
            objektArt: "place",
            objektId: ORT,
            name: "Wehrheim",
            typ: "Stadt",
            lage: { x: 500, y: 400 },
        },
        ...overrides,
    });

    const zeileVon = async (id: number) => (await detail(database, id))?.zeile;

    async function leeren(): Promise<void> {
        await database`DELETE FROM avesmaps_community.vorgang`;
    }

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        fixture = authFixture(database);
        lena = (await fixture.person("reviewer", { name: "Lena" })).id;
        thomas = (await fixture.person("admin", { name: "Thomas" })).id;
    });

    beforeEach(leeren);

    afterAll(async () => {
        await leeren().catch(() => undefined);
        await fixture?.cleanup();
        await database?.end({ timeout: 5 });
    });

    it("melden ist idempotent und hält Bezug, Melder und die Meldung als erste Nachricht", async () => {
        const m = meldung();
        const id = await melden(database, m);
        expect(await melden(database, { ...m, text: "Ein ganz anderer Text als beim ersten Mal." })).toBe(id);
        const d = await detail(database, id);
        expect(d?.zeile).toMatchObject({
            zustand: "neu",
            art: "meldung",
            kategorie: "lage",
            bezugName: "Wehrheim",
            ohneQuelle: false,
        });
        expect(d?.bezug).toMatchObject({
            art: "objekt",
            objektArt: "place",
            objektId: ORT,
            typ: "Stadt",
            lage: { x: 500, y: 400 },
        });
        expect(d?.melder).toEqual({ name: "Alrike", rueckwege: ["statusseite"], entfernt: false });
        expect(d?.verlauf.filter((e) => e.art === "nachricht")).toHaveLength(1);
        expect(d?.verlauf[0]).toMatchObject({ art: "ereignis", ereignis: "eingang", vomMelder: true });
        // Ohne Quelle trägt die Zeile den Hinweis; zu kurz scheitert in der Datenbank.
        const ohne = await melden(database, meldung({ quelle: undefined }));
        expect((await zeileVon(ohne))?.ohneQuelle).toBe(true);
        expect((await fehler(melden(database, meldung({ text: "zu kurz" })))).code).toBe("community_invalid");
    });

    it("eine Stelle statt eines Objekts; mögliche Dublette nur bei demselben Objekt", async () => {
        const stelle = await melden(
            database,
            meldung({
                kategorie: "fehlt",
                fehltArt: "fluss",
                bezug: { art: "stelle", lage: { x: 10, y: 20 }, naechsterOrt: "Gallys" },
            }),
        );
        expect((await zeileVon(stelle))?.bezugName).toBe("Gallys");
        const erste = await melden(database, meldung());
        const zweite = await melden(database, meldung({ kategorie: "name" }));
        expect((await zeileVon(zweite))?.moeglicheDublette).toBe(`COM-${String(erste).padStart(6, "0")}`);
        expect((await zeileVon(stelle))?.moeglicheDublette).toBeNull();
    });

    it("🔴 „Etwas fehlt“ nimmt die Arten des neuen Formulars an, behält `gebiet` für alte Meldungen und lehnt jede andere Art ab (0338)", async () => {
        const stelle = { art: "stelle" as const, lage: { x: 10, y: 20 } };
        for (const fehltArt of ["insel", "landschaft", "herrschaft", "sprache", "gebiet"]) {
            const id = await melden(database, meldung({ kategorie: "fehlt", fehltArt, bezug: stelle }));
            expect((await detail(database, id))?.fehltArt, fehltArt).toBe(fehltArt);
        }
        await expect(
            melden(database, meldung({ kategorie: "fehlt", fehltArt: "wolke", bezug: stelle })),
        ).rejects.toThrow();
        // Eine Art gehört nur zu „Etwas fehlt“.
        await expect(
            melden(database, meldung({ kategorie: "lage", fehltArt: "insel", bezug: stelle })),
        ).rejects.toThrow();
    });

    it("🔴 die Statusseite zeigt Nachrichten nach außen, nie Notizen, nie die Begründung; falscher Schlüssel → null", async () => {
        const m = meldung();
        const id = await melden(database, m);
        await notiz(database, { id, person: lena, text: "Intern: Thomas fragen" });
        const r = await rueckfrage(database, {
            id,
            person: lena,
            revision: (await zeileVon(id))!.revision,
            text: "Welche Seite genau?",
        });
        const sicht = await statusLesen(database, m.schluessel);
        expect(sicht).toMatchObject({ zustand: "rueckfrage", ergebnis: null, bezugName: "Wehrheim" });
        expect(JSON.stringify(sicht)).not.toContain("Intern");
        expect(sicht?.nachrichten.map((n) => n.richtung)).toEqual(["ein", "aus"]);
        await abschliessen(database, {
            id,
            person: lena,
            revision: r,
            ergebnis: "abgelehnt",
            begruendung: "Geheime Begründung",
            nachricht: "Danke, wir bleiben bei der Lage.",
        });
        const zu = await statusLesen(database, m.schluessel);
        expect(zu).toMatchObject({ zustand: "abgeschlossen", ergebnis: "abgelehnt" });
        expect(JSON.stringify(zu)).not.toContain("Geheime");
        expect(await statusLesen(database, schluessel())).toBeNull();
    });

    it("🔴 veraltete Revision → community_conflict; Notizen prüfen und zählen keine Revision", async () => {
        const id = await melden(database, meldung());
        const r0 = (await zeileVon(id))!.revision;
        const r1 = await sichten(database, { id, person: lena, revision: r0 });
        expect(r1).toBe(r0 + 1);
        expect(
            (await fehler(prioritaet(database, { id, person: thomas, revision: r0, prioritaet: "hoch" }))).code,
        ).toBe("community_conflict");
        await notiz(database, { id, person: thomas, text: "nur eine Notiz" });
        expect((await zeileVon(id))?.revision).toBe(r1);
        expect(await prioritaet(database, { id, person: thomas, revision: r1, prioritaet: "hoch" })).toBe(r1 + 1);
        // Dieselbe Operation noch einmal ist nichts.
        const operationId = randomUUID();
        const r2 = await zustaendig(database, { operationId, id, person: thomas, revision: r1 + 1, ziel: lena });
        expect(await zustaendig(database, { operationId, id, person: thomas, revision: r1 + 1, ziel: lena })).toBe(r2);
    });

    it("Lebenszyklus: Übernehmen, Rückfrage, Antwort, Abschluss mit Pflichtbegründung, Wiedereröffnen, Archiv", async () => {
        const m = meldung();
        const id = await melden(database, m);
        let r = await uebernehmen(database, { id, person: lena, revision: (await zeileVon(id))!.revision });
        expect(await zeileVon(id)).toMatchObject({ zustand: "in_arbeit", zustaendig: { id: lena, name: "Lena" } });
        expect((await fehler(sichten(database, { id, person: lena, revision: r }))).code).toBe("community_transition");
        await rueckfrage(database, { id, person: lena, revision: r, text: "Welche Auflage?" });
        expect((await zeileVon(id))?.zustand).toBe("rueckfrage");
        await statusAntworten(database, randomUUID(), m.schluessel, "Die zweite Auflage.");
        expect((await zeileVon(id))?.zustand).toBe("in_arbeit");
        r = (await zeileVon(id))!.revision;
        expect(
            (
                await fehler(
                    abschliessen(database, { id, person: lena, revision: r, ergebnis: "umgesetzt", begruendung: "  " }),
                )
            ).code,
        ).toBe("community_invalid");
        // „beantwortet“ gibt es nur für Anfragen.
        expect(
            (
                await fehler(
                    abschliessen(database, {
                        id,
                        person: lena,
                        revision: r,
                        ergebnis: "beantwortet",
                        begruendung: "x",
                    }),
                )
            ).code,
        ).toBe("community_invalid");
        r = await abschliessen(database, {
            id,
            person: lena,
            revision: r,
            ergebnis: "umgesetzt",
            begruendung: "Ort verschoben",
        });
        expect((await liste(database, { segment: "erledigt", person: lena })).zeilen.map((z) => z.nummer)).toHaveLength(
            1,
        );
        r = await wiedereroeffnen(database, { id, person: lena, revision: r, grund: "Doch noch nicht ganz" });
        expect(await zeileVon(id)).toMatchObject({ zustand: "in_arbeit", ergebnis: null });
        const d = await detail(database, id);
        expect(d?.verlauf.find((e) => e.art === "ereignis" && e.ereignis === "abgeschlossen")).toMatchObject({
            neu: "umgesetzt",
            text: "Ort verschoben",
        });
        r = await abschliessen(database, {
            id,
            person: lena,
            revision: r,
            ergebnis: "bereits_richtig",
            begruendung: "geprüft",
        });
        await archivieren(database, { id, person: lena, revision: r });
        expect((await liste(database, { segment: "archiv", person: lena })).zeilen).toHaveLength(1);
    });

    it("eine Antwort auf einen abgeschlossenen Vorgang öffnet ihn wieder; zurückgezogen bleibt zu", async () => {
        const m = meldung();
        const id = await melden(database, m);
        const r = (await zeileVon(id))!.revision;
        await abschliessen(database, {
            id,
            person: lena,
            revision: r,
            ergebnis: "abgelehnt",
            begruendung: "ohne Quelle",
        });
        await statusAntworten(database, randomUUID(), m.schluessel, "Hier ist die Quelle: Seite 12.");
        const d = await detail(database, id);
        expect(d?.zeile.zustand).toBe("in_arbeit");
        expect(d?.verlauf.some((e) => e.art === "ereignis" && e.ereignis === "wiedereroeffnet" && e.vomMelder)).toBe(
            true,
        );
        await statusZurueckziehen(database, randomUUID(), m.schluessel);
        expect((await zeileVon(id))?.ergebnis).toBe("zurueckgezogen");
        expect((await fehler(statusAntworten(database, randomUUID(), m.schluessel, "noch was"))).code).toBe(
            "community_transition",
        );
    });

    it("Dublette braucht den Vorgang, von dem sie eine ist", async () => {
        const erste = await melden(database, meldung());
        const zweite = await melden(database, meldung());
        const r = (await zeileVon(zweite))!.revision;
        expect(
            (
                await fehler(
                    abschliessen(database, {
                        id: zweite,
                        person: lena,
                        revision: r,
                        ergebnis: "dublette",
                        begruendung: "x",
                    }),
                )
            ).code,
        ).toBe("community_invalid");
        await abschliessen(database, {
            id: zweite,
            person: lena,
            revision: r,
            ergebnis: "dublette",
            begruendung: "schon gemeldet",
            dubletteVon: erste,
        });
        expect((await detail(database, zweite))?.dubletteVon).toBe(`COM-${String(erste).padStart(6, "0")}`);
    });

    it("Papierkorb: Statusseite verschwindet, Wiederherstellen öffnet wieder; Suche findet Text und Nummer", async () => {
        const m = meldung({ text: "Hier wohnt ein Drache im Brunnen, ganz sicher." });
        const id = await melden(database, m);
        let r = await papierkorb(database, { id, person: thomas, revision: (await zeileVon(id))!.revision });
        expect(await statusLesen(database, m.schluessel)).toBeNull();
        expect((await liste(database, { segment: "papierkorb", person: thomas })).zaehler.papierkorb).toBe(1);
        expect((await liste(database, { segment: "offen", person: thomas })).zeilen).toHaveLength(0);
        r = await wiederherstellen(database, { id, person: thomas, revision: r });
        expect((await zeileVon(id))?.zustand).toBe("in_arbeit");
        expect((await liste(database, { segment: "offen", person: thomas, q: "Drache" })).zeilen).toHaveLength(1);
        expect(
            (await liste(database, { segment: "offen", person: thomas, q: `COM-${String(id).padStart(6, "0")}` }))
                .zeilen,
        ).toHaveLength(1);
        expect((await liste(database, { segment: "offen", person: thomas, q: "Greif" })).zeilen).toHaveLength(0);
        expect(r).toBeGreaterThan(0);
    });

    it("🔴 Personenbezug löschen: Melder, Statuslink und seine Texte weg, Sachinhalt bleibt", async () => {
        const m = meldung();
        const id = await melden(database, m);
        await personenbezugLoeschen(database, { id, person: thomas });
        const d = await detail(database, id);
        expect(d?.melder).toEqual({ name: null, rueckwege: [], entfernt: true });
        expect(d?.verlauf.find((e) => e.art === "nachricht")).toMatchObject({ richtung: "ein", text: null });
        expect(d?.zeile).toMatchObject({ kategorie: "lage", bezugName: "Wehrheim" });
        expect(await statusLesen(database, m.schluessel)).toBeNull();
        // Ohne Rückweg keine Rückfrage.
        expect(
            (await fehler(rueckfrage(database, { id, person: lena, revision: d!.zeile.revision, text: "Hallo?" })))
                .code,
        ).toBe("community_transition");
    });

    it("🔴 Aufbewahrung: Archiv nach 30 Tagen, Kontakt nach 90 Tagen, Papierkorb nach 30 Tagen weg; Offenes bleibt", async () => {
        const offen = await melden(database, meldung());
        const alt = meldung();
        const erledigt = await melden(database, alt);
        await abschliessen(database, {
            id: erledigt,
            person: lena,
            revision: (await zeileVon(erledigt))!.revision,
            ergebnis: "umgesetzt",
            begruendung: "erledigt",
        });
        const spam = await melden(database, meldung());
        await papierkorb(database, { id: spam, person: thomas, revision: (await zeileVon(spam))!.revision });
        await database`UPDATE avesmaps_community.vorgang SET eingegangen_at = now() - interval '200 days'`;
        await database`UPDATE avesmaps_community.vorgang SET abgeschlossen_at = now() - interval '91 days' WHERE id = ${erledigt}`;
        await database`UPDATE avesmaps_community.vorgang SET papierkorb_at = now() - interval '31 days',
                                                           abgeschlossen_at = now() - interval '31 days' WHERE id = ${spam}`;
        expect(await aufbewahren(database)).toEqual({ archiviert: 1, kontakt: 1, geloescht: 1 });
        expect(await detail(database, spam)).toBeNull();
        const d = await detail(database, erledigt);
        expect(d?.archiviertAt).not.toBeNull();
        expect(d?.melder).toMatchObject({ name: null, entfernt: true });
        expect(d?.verlauf.find((e) => e.art === "nachricht")?.text).toContain("Wehrheim");
        expect(await statusLesen(database, alt.schluessel)).toBeNull();
        expect((await zeileVon(offen))?.zustand).toBe("neu");
        expect(await aufbewahren(database)).toEqual({ archiviert: 0, kontakt: 0, geloescht: 0 });
    });
});
