import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    LegacyDateiFehler,
    NAME_MAX,
    QUELLE_MAX,
    TEXT_MAX,
    berlinZuUtc,
    planeUebernahme,
    pruefeDatei,
    type OrtZeile,
} from "../src/migration/community-legacy.ts";
import {
    berichtZeilen,
    pruefeNachLauf,
    runCommunityLegacy,
    uebernehmeEine,
} from "../src/migration/community-legacy-lauf.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";

/**
 * Die einmalige Übernahme der offenen Legacy-Meldungen (WI-0268 C9, Migration 0277, `migration/community-legacy*.ts`, Vertrag `community-meldungen.yaml`).
 *
 * Problemfälle: Breite und Länge sind vertauscht (Legacy `lng` ist x); eine Testzeile oder eine Lage außerhalb der Welt wird übernommen; ein zu kurzer Text scheitert an der Grenze
 * der Datenbank, statt aufgefüllt zu werden; die Notiz trägt den Namen des Melders; der Melder bekommt eine Mail oder einen Schlüssel; derselbe Lauf zweimal legt jede Meldung
 * doppelt an; ein Probelauf schreibt; `--anwenden` läuft ohne Zitat; Bericht oder Protokoll nennen einen Namen oder Text.
 */

const ORT = (name: string, x: number, y: number, subtype = "dorf", n = 1): OrtZeile => ({
    publicId: `c9000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    name,
    subtype,
    x,
    y,
});

/** Eine Zeile des Exports mit allen Feldern; was ein Test nicht braucht, bleibt leer. */
const zeile = (id: number, uebrige: Record<string, unknown> = {}): Record<string, unknown> => ({
    id,
    type: "location",
    subtype: "dorf",
    name: "Wehrheim",
    reporter: "",
    lat: 100,
    lng: 200,
    source: "",
    wiki_url: "",
    comment: "Das Dorf liegt weiter im Osten am Fluss.",
    review_note: "",
    created_at: "2026-08-05 14:03:00",
    ...uebrige,
});

const plane = (zeilen: unknown[], orte: OrtZeile[] = []) => planeUebernahme(zeilen, orte);
const eine = (z: Record<string, unknown>, orte: OrtZeile[] = []) => {
    const plan = plane([z], orte);
    expect(plan.uebernahmen).toHaveLength(1);
    return plan.uebernahmen[0]!;
};

describe("Datei: die Antwort des Exports", () => {
    it("🔴 nimmt nur ok:true mit Liste und stimmigem count; sonst bricht sie mit einem klaren Satz ab", () => {
        expect(pruefeDatei({ ok: true, count: 1, reports: [zeile(1)] })).toHaveLength(1);
        expect(pruefeDatei({ ok: true, count: 0, reports: [] })).toEqual([]);
        for (const falsch of [
            null,
            [],
            "text",
            { ok: false, count: 0, reports: [] },
            { count: 0, reports: [] },
            { ok: true, count: 0 },
            { ok: true, count: 0, reports: {} },
            { ok: true, count: 2, reports: [zeile(1)] },
            { ok: true, reports: [zeile(1)] },
        ]) {
            expect(() => pruefeDatei(falsch)).toThrow(LegacyDateiFehler);
        }
    });
});

describe("Abbildung: Lage, Zeit, Filter", () => {
    it("🔴 x ist lng und y ist lat", () => {
        const u = eine(zeile(1, { lat: 123.456, lng: 654.321 }));
        expect(u.bezug.lage).toEqual({ x: 654.32, y: 123.46 });
    });

    it("🔴 Testzeilen (Name, Kommentar oder Melder beginnt mit ZZ-Systemtest, ohne Groß/Klein) und Lagen außerhalb der Welt werden nicht übernommen, nur gezählt", () => {
        const plan = plane([
            zeile(1),
            zeile(2, { name: "ZZ-Systemtest Ort" }),
            zeile(3, { comment: "  zz-SYSTEMTEST vom 05.08.2026 - bitte löschen" }),
            zeile(4, { reporter: "ZZ-Systemtest (Agent 10)" }),
            zeile(5, { lat: -0.01 }),
            zeile(6, { lng: 1024.5 }),
            zeile(7, { lat: Number.NaN }),
            zeile(8, { lng: "200" }),
            zeile(9, { lat: 0, lng: 1024 }),
            zeile(10, { name: "Der ZZ-Systemtest-Ort" }),
        ]);
        expect(plan.geliefert).toBe(10);
        expect(plan.uebernahmen.map((u) => u.legacyId)).toEqual([1, 9, 10]);
        expect(plan.befunde.testzeile).toEqual([2, 3, 4]);
        expect(plan.befunde.lageUngueltig).toEqual([5, 6, 7, 8]);
    });

    it("unbrauchbare Zeilen und doppelte Nummern: die erste gilt, der Rest wird gezählt", () => {
        const plan = plane([
            zeile(1),
            zeile(1, { name: "Zweite" }),
            "keine zeile",
            { id: "x" },
            zeile(2, { created_at: "gestern" }),
            { ...zeile(3), id: -3 },
        ]);
        expect(plan.uebernahmen.map((u) => u.legacyId)).toEqual([1]);
        expect(plan.befunde.doppelt).toEqual([1]);
        expect(plan.befunde.unbrauchbar).toEqual([0, 0, 2, 0]);
    });

    it("🔴 die Zeit ist Berliner Serverzeit: Sommer, Winter und beide Tage der Umstellung", () => {
        expect(berlinZuUtc("2026-08-05 14:03:00")).toBe("2026-08-05T12:03:00.000Z");
        expect(berlinZuUtc("2026-01-05 14:03:00")).toBe("2026-01-05T13:03:00.000Z");
        // Frühjahr: am 29.03.2026 springt 02:00 auf 03:00.
        expect(berlinZuUtc("2026-03-29 01:59:59")).toBe("2026-03-29T00:59:59.000Z");
        expect(berlinZuUtc("2026-03-29 03:00:00")).toBe("2026-03-29T01:00:00.000Z");
        // Herbst: am 25.10.2026 springt 03:00 auf 02:00; die doppelte Stunde gilt als die zweite, immer dasselbe.
        expect(berlinZuUtc("2026-10-25 02:30:00")).toBe("2026-10-25T01:30:00.000Z");
        expect(berlinZuUtc("2026-10-25 03:00:00")).toBe("2026-10-25T02:00:00.000Z");
        expect(berlinZuUtc("2026-08-05T14:03:00")).toBe("2026-08-05T12:03:00.000Z");
        // Legacy liefert Sekundenbruchteile (Production-Probelauf 2026-11-01): Millisekunden bleiben, mehr Stellen fallen weg.
        expect(berlinZuUtc("2026-10-12 14:03:07.123")).toBe("2026-10-12T12:03:07.123Z");
        expect(berlinZuUtc("2026-01-05 14:03:07.5")).toBe("2026-01-05T13:03:07.500Z");
        expect(berlinZuUtc("2026-10-12 14:03:07.123456")).toBe("2026-10-12T12:03:07.123Z");
        expect(eine(zeile(1, { created_at: "2026-10-12 14:03:07.123" })).eingegangenAt).toBe(
            "2026-10-12T12:03:07.123Z",
        );
        for (const falsch of [
            "2026-08-05 14:03:00.",
            "2026-08-05 14:03:00.1234567",
            "",
            "gestern",
            "2026-13-01 10:00:00",
            "2026-02-30 10:00:00",
            "2026-08-05 25:00:00",
            "2026-08-05",
        ]) {
            expect(berlinZuUtc(falsch), falsch).toBeUndefined();
        }
        expect(eine(zeile(1, { created_at: "2026-08-05 14:03:00" })).eingegangenAt).toBe("2026-08-05T12:03:00.000Z");
    });
});

describe("Abbildung: Kategorie", () => {
    it("🔴 location mit Treffer ist angabe, ohne Treffer fehlt (ort); eine Beschriftung fehlt in der Art nach ihrem Untertyp", () => {
        const orte = [ORT("Wehrheim", 200, 100)];
        const treffer = eine(zeile(1), orte);
        expect([treffer.kategorie, treffer.fehltArt]).toEqual(["angabe", null]);
        const ohne = eine(zeile(2, { name: "Neudorf" }), orte);
        expect([ohne.kategorie, ohne.fehltArt]).toEqual(["fehlt", "ort"]);
        const art = (subtype: string) => eine(zeile(3, { type: "label", subtype })).fehltArt;
        for (const [untertyp, erwartet] of Object.entries({
            fluss: "fluss",
            meer: "gewaesser",
            see: "gewaesser",
            gebirge: "gebirge",
            bergkette: "gebirge",
            berggipfel: "gebirge",
            vulkan: "gebirge",
            huegel: "gebirge",
            huegelland: "gebirge",
            felsformation: "gebirge",
            sonstiges: "anderes",
            region: "gebiet",
            insel: "gebiet",
            inselgruppe: "gebiet",
            wald: "gebiet",
            steppe: "gebiet",
            wueste: "gebiet",
            suempfe_moore: "gebiet",
            eislandschaft: "gebiet",
        })) {
            expect(art(untertyp), untertyp).toBe(erwartet);
        }
        // Ein Untertyp, den das Werkzeug nicht kennt, wird `anderes` und steht im Bericht.
        const plan = plane([zeile(4, { type: "label", subtype: "neuland" })]);
        expect(plan.uebernahmen[0]!.fehltArt).toBe("anderes");
        expect(plan.befunde.artUnbekannt).toEqual([4]);
    });

    it("Kraftlinie ist angabe; Weg, Gebiet, Anmerkung, Karte und Fundort sind sonstiges", () => {
        expect(eine(zeile(1, { type: "powerline", subtype: "kraftlinie" })).kategorie).toBe("angabe");
        for (const type of ["path", "territory", "comment", "citymap", "citymap_link"]) {
            const u = eine(zeile(2, { type, subtype: type }));
            expect([u.kategorie, u.fehltArt], type).toEqual(["sonstiges", null]);
        }
        const plan = plane([zeile(3, { type: "neuartig" })]);
        expect(plan.uebernahmen[0]!.kategorie).toBe("sonstiges");
        expect(plan.befunde.typUnbekannt).toEqual([3]);
    });

    it("zählt je Kategorie", () => {
        const plan = plane([
            zeile(1),
            zeile(2),
            zeile(3, { type: "label", subtype: "fluss" }),
            zeile(4, { type: "path", subtype: "weg" }),
        ]);
        expect(plan.jeKategorie).toEqual({ "fehlt:ort": 2, "fehlt:fluss": 1, sonstiges: 1 });
    });
});

describe("Abbildung: Objektabgleich am Ort", () => {
    it("🔴 gleicher Name (getrimmt, ohne Groß/Klein) bis 30 Einheiten: Bezug auf den Ort, bei mehreren der nächste", () => {
        const orte = [
            ORT("Wehrheim", 100, 100, "stadt", 1),
            ORT("wehrheim", 110, 100, "dorf", 2),
            ORT("Andernort", 108, 100, "dorf", 3),
        ];
        const u = eine(zeile(1, { name: "  WEHRHEIM ", lng: 108, lat: 100 }), orte);
        expect(u.kategorie).toBe("angabe");
        expect(u.bezug).toEqual({
            art: "objekt",
            objektArt: "place",
            objektId: orte[1]!.publicId,
            name: "wehrheim",
            typ: "dorf",
            lage: { x: 110, y: 100 },
            vorschlagLage: { x: 108, y: 100 },
        });
    });

    it("die Lage der Meldung ist nur ab mehr als 0,5 Einheiten Abstand ein Vorschlag", () => {
        const orte = [ORT("Wehrheim", 100, 100)];
        const nah = eine(zeile(1, { lng: 100.5, lat: 100 }), orte);
        expect(nah.bezug).not.toHaveProperty("vorschlagLage");
        const fern = eine(zeile(2, { lng: 100.51, lat: 100 }), orte);
        expect(fern.bezug).toHaveProperty("vorschlagLage", { x: 100.51, y: 100 });
    });

    it("🔴 jenseits von 30 Einheiten, bei anderem Namen oder bei einer Beschriftung bleibt es eine Stelle mit dem nächsten Ort", () => {
        const orte = [ORT("Wehrheim", 100, 100, "dorf", 1), ORT("Nahort", 400, 400, "dorf", 2)];
        const zuWeit = eine(zeile(1, { lng: 130.1, lat: 100 }), orte);
        expect(zuWeit.bezug).toEqual({ art: "stelle", lage: { x: 130.1, y: 100 }, naechsterOrt: "Wehrheim" });
        expect(zuWeit.kategorie).toBe("fehlt");
        const grenze = eine(zeile(2, { lng: 130, lat: 100 }), orte);
        expect(grenze.bezug.art).toBe("objekt");
        const anders = eine(zeile(3, { name: "Neudorf", lng: 399, lat: 400 }), orte);
        expect(anders.bezug).toEqual({ art: "stelle", lage: { x: 399, y: 400 }, naechsterOrt: "Nahort" });
        // Nur Orte werden abgeglichen.
        const label = eine(zeile(4, { type: "label", subtype: "see", name: "Wehrheim", lng: 100, lat: 100 }), orte);
        expect(label.bezug.art).toBe("stelle");
        // Ohne jeden Ort gibt es auch keinen nächsten.
        expect(eine(zeile(5)).bezug).toEqual({ art: "stelle", lage: { x: 200, y: 100 } });
    });
});

describe("Abbildung: Text, Quelle, Melder, Notiz", () => {
    it("🔴 ein Kommentar unter zehn Zeichen bekommt den Satz mit Art und Name davor; ein ausreichender bleibt, wie er ist", () => {
        expect(eine(zeile(1, { comment: "  " })).text).toBe("Vorschlag aus der alten Karte: Dorf „Wehrheim“.");
        expect(eine(zeile(2, { comment: "im Osten" })).text).toBe(
            "Vorschlag aus der alten Karte: Dorf „Wehrheim“. im Osten",
        );
        expect(eine(zeile(3, { comment: "  genau zehn  " })).text).toBe("genau zehn");
        expect(eine(zeile(4, { type: "label", subtype: "suempfe_moore", name: "Nebelmoor", comment: "" })).text).toBe(
            "Vorschlag aus der alten Karte: Sumpf oder Moor „Nebelmoor“.",
        );
        expect(eine(zeile(5, { type: "path", subtype: "weg", name: "", comment: "x" })).text).toBe(
            "Vorschlag aus der alten Karte: Weg. x",
        );
        expect(eine(zeile(6, { comment: "" })).text.length).toBeGreaterThanOrEqual(10);
        const plan = plane([zeile(7, { comment: "" }), zeile(8)]);
        expect(plan.aufgefuellt).toBe(1);
    });

    it("ein Text über 2000 Zeichen wird gekürzt und steht im Bericht", () => {
        const plan = plane([zeile(1, { comment: `${"ä".repeat(TEXT_MAX)}Überlauf` })]);
        expect(Array.from(plan.uebernahmen[0]!.text)).toHaveLength(TEXT_MAX);
        expect(plan.befunde.textGekuerzt).toEqual([1]);
    });

    it("die Quelle ist Quelle und Wiki-Adresse mit · verbunden, leere fallen weg, über 1000 Zeichen gibt es keine", () => {
        expect(eine(zeile(1, { source: " Regionalband ", wiki_url: "https://wiki.example/Wehrheim" })).quelle).toBe(
            "Regionalband · https://wiki.example/Wehrheim",
        );
        expect(eine(zeile(2, { wiki_url: "https://wiki.example/Wehrheim" })).quelle).toBe(
            "https://wiki.example/Wehrheim",
        );
        expect(eine(zeile(3, { source: "Regionalband" })).quelle).toBe("Regionalband");
        expect(eine(zeile(4)).quelle).toBeNull();
        const plan = plane([zeile(5, { source: "q".repeat(QUELLE_MAX + 1) })]);
        expect(plan.uebernahmen[0]!.quelle).toBeNull();
        expect(plan.befunde.quelleZuLang).toEqual([5]);
        expect(eine(zeile(6, { source: "q".repeat(QUELLE_MAX) })).quelle).toHaveLength(QUELLE_MAX);
    });

    it("der Melder ist nur sein getrimmter Name, höchstens 80 Zeichen; leer heißt keiner", () => {
        expect(eine(zeile(1, { reporter: "  Alrike  " })).melderName).toBe("Alrike");
        expect(eine(zeile(2, { reporter: "   " })).melderName).toBeNull();
        const plan = plane([zeile(3, { reporter: "n".repeat(NAME_MAX + 5) })]);
        expect(plan.uebernahmen[0]!.melderName).toHaveLength(NAME_MAX);
        expect(plan.befunde.nameGekuerzt).toEqual([3]);
    });

    it("🔴 die Notiz nennt Meldung, Datum, Art, Name, Lage und die Notiz der Redaktion, nie den Namen des Melders", () => {
        const u = eine(
            zeile(42, { reporter: "Alrike Quellenfinder", review_note: "Bitte mit dem Regionalband abgleichen." }),
        );
        expect(u.notiz).toBe(
            "Aus Legacy übernommen: Meldung 42 vom 05.08.2026, Art location/dorf, Name „Wehrheim“, Lage 200/100. " +
                "Notiz der Redaktion in Legacy: Bitte mit dem Regionalband abgleichen.",
        );
        expect(u.notiz).not.toContain("Alrike");
        expect(eine(zeile(43, { name: "" })).notiz).toBe(
            "Aus Legacy übernommen: Meldung 43 vom 05.08.2026, Art location/dorf, Lage 200/100.",
        );
    });

    it("🔴 der Bericht nennt nur Zahlen und Nummern, nie einen Namen oder Text", () => {
        const plan = plane(
            [
                zeile(1, { reporter: "Alrike Quellenfinder", comment: "Geheimer Kommentar zum Dorf." }),
                zeile(2, { name: "ZZ-Systemtest X", reporter: "Bernd Beispiel" }),
            ],
            [ORT("Wehrheim", 200, 100)],
        );
        for (const schon of [undefined, new Set([1])]) {
            const text = berichtZeilen(plan, schon).join("\n");
            for (const geheim of ["Alrike", "Geheimer", "Bernd", "Wehrheim", "Systemtest X"])
                expect(text).not.toContain(geheim);
            expect(text).toContain("geliefert");
            expect(text).toContain("(Legacy-Nummern 2)");
        }
        expect(berichtZeilen(plan, undefined).join("\n")).toContain("Migration 0277");
        expect(berichtZeilen(plan, new Set([1])).join("\n")).toMatch(/schon übernommen\s+1/u);
    });
});

// --- gegen echtes PostgreSQL ---------------------------------------------------------------------------------------------------------------

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const SOURCE = "test-wi0268-c9";
const ORT_ID = "a2680c09-0000-4000-8000-000000000001";
const BASIS = 9_268_000;
const NAME_MELDER = "Alrike Testmelder";
const NAME_ZWEITER = "Bernd Beispielhaft";
const KOMMENTAR = "Das Dorf liegt weiter im Osten, hinter dem großen Fluss.";

interface Zaehlung {
    vorgang: number;
    legacy: number;
    ereignis: number;
    protokoll: number;
}

describeWithDatabase("Übernahme gegen PostgreSQL (Migration 0277)", { timeout: 120_000 }, () => {
    let database: Database;
    let schreibgeschuetzt: Database;
    let ordner: string;
    let datei: string;

    const umgebung = { DATABASE_URL: testDatabaseUrl, AVESMAPS_ENV: "test" } as NodeJS.ProcessEnv;
    const lauf = async (args: string[], db: Database = database) => {
        const ausgabe: string[] = [];
        const code = await runCommunityLegacy(
            args,
            umgebung,
            { out: (z) => ausgabe.push(z), err: (z) => ausgabe.push(z) },
            { database: db, systemUser: "probe" },
        );
        return { code, text: ausgabe.join("\n") };
    };
    const zaehlen = async (): Promise<Zaehlung> => {
        const [z] = await database<Zaehlung[]>`
            SELECT (SELECT count(*)::int FROM avesmaps_community.vorgang) AS vorgang,
                   (SELECT count(*)::int FROM avesmaps_community.legacy_meldung) AS legacy,
                   (SELECT count(*)::int FROM avesmaps_community.ereignis) AS ereignis,
                   (SELECT count(*)::int FROM avesmaps_auth.security_event WHERE action = 'system.community_legacy_uebernommen') AS protokoll
        `;
        return z!;
    };
    const vorgangVon = async (legacyId: number): Promise<number> => {
        const [z] = await database<{ vorgang_id: string }[]>`
            SELECT vorgang_id::text AS vorgang_id FROM avesmaps_community.legacy_meldung WHERE legacy_id = ${legacyId}
        `;
        return Number(z?.vorgang_id);
    };
    async function aufraeumen(): Promise<void> {
        await database`
            DELETE FROM avesmaps_community.vorgang
             WHERE id IN (SELECT vorgang_id FROM avesmaps_community.legacy_meldung WHERE legacy_id >= ${BASIS} AND legacy_id < ${BASIS + 1000})
        `;
        await database`DELETE FROM place WHERE source_system = ${SOURCE}`;
    }

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await seedMapDomains(database);
        await aufraeumen();
        await database`
            INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
            VALUES (${ORT_ID}, 'aventuria', 'Zwölfhain-C9', 'dorf', ST_SetSRID(ST_MakePoint(913, 722), 0), ${SOURCE}, TRUE)
        `;
        schreibgeschuetzt = postgres(testDatabaseUrl as string, {
            max: 1,
            onnotice: () => {},
            connection: { default_transaction_read_only: true },
        }) as unknown as Database;
        ordner = mkdtempSync(join(tmpdir(), "community-legacy-c9-"));
        datei = join(ordner, "map-reports-offen.json");
        const reports = [
            zeile(BASIS + 1, {
                name: " zwölfhain-c9 ",
                reporter: NAME_MELDER,
                lat: 726,
                lng: 916,
                source: "Regionalband",
                wiki_url: "https://wiki.example/Zw",
                comment: KOMMENTAR,
                review_note: "Redaktion: bitte prüfen.",
                created_at: "2026-08-05 14:03:00",
            }),
            zeile(BASIS + 2, {
                type: "label",
                subtype: "fluss",
                name: "Testfluss-C9",
                reporter: "",
                lat: 726,
                lng: 916,
                comment: "kurz",
                created_at: "2026-01-05 09:00:00",
            }),
            zeile(BASIS + 3, { name: "ZZ-Systemtest Ort", comment: "ZZ-Systemtest vom 05.08.2026" }),
            zeile(BASIS + 4, { lat: 2000 }),
            zeile(BASIS + 5, {
                type: "path",
                subtype: "weg",
                name: "Alter Pfad-C9",
                reporter: NAME_ZWEITER,
                comment: "Der Weg fehlt zwischen den Orten.",
                lat: 410,
                lng: 510,
            }),
        ];
        writeFileSync(datei, JSON.stringify({ ok: true, count: reports.length, reports }), "utf8");
    });

    afterAll(async () => {
        await aufraeumen();
        await schreibgeschuetzt.end({ timeout: 5 });
        await database.end({ timeout: 5 });
        rmSync(ordner, { recursive: true, force: true });
    });

    it("🔴 `--anwenden` ohne Zitat bricht ab, bevor es Datei oder Datenbank anfasst", async () => {
        const vorher = await zaehlen();
        for (const args of [
            ["--datei", datei, "--anwenden"],
            ["--datei", datei, "--anwenden", "--operator-said", "   "],
            ["--datei", join(ordner, "gibt-es-nicht.json"), "--anwenden"],
        ]) {
            const { code, text } = await lauf(args);
            expect(code, args.join(" ")).toBe(2);
            expect(text).toContain("--operator-said");
        }
        expect(await zaehlen()).toEqual(vorher);
        // Ein unbekannter Schalter ist ein Aufruffehler.
        expect((await lauf(["--datei", datei, "--ueberschreiben"])).code).toBe(2);
    });

    it("🔴 der Probelauf berichtet und schreibt nichts (auch nicht auf einer Verbindung, die schreiben dürfte, ginge es durch)", async () => {
        // Die Verbindung verweigert jedes Schreiben (25006): Was der Probelauf unternähme, ginge schief.
        await expect(
            schreibgeschuetzt`UPDATE avesmaps_community.vorgang SET revision = revision WHERE false`,
        ).rejects.toMatchObject({ code: "25006" });
        const vorher = await zaehlen();
        const { code, text } = await lauf(["--datei", datei], schreibgeschuetzt);
        expect(code).toBe(0);
        expect(text).toContain("PROBELAUF");
        expect(text).toMatch(/geliefert\s+5/u);
        expect(text).toMatch(/Testzeilen \(ZZ-Systemtest\)\s+1 \(Legacy-Nummern 9268003\)/u);
        expect(text).toMatch(/Lage ungültig oder außerhalb\s+1 \(Legacy-Nummern 9268004\)/u);
        expect(text).toMatch(/zu übernehmen\s+3/u);
        expect(text).toMatch(/Objekt gefunden \(Ort\)\s+1/u);
        expect(text).toMatch(/Stelle\s+2/u);
        expect(text).toMatch(/Kategorie angabe\s+1/u);
        expect(text).toMatch(/Kategorie fehlt:fluss\s+1/u);
        expect(text).toMatch(/Kategorie sonstiges\s+1/u);
        expect(text).toMatch(/schon übernommen\s+0/u);
        for (const geheim of [NAME_MELDER, NAME_ZWEITER, "Testfluss", "Zwölfhain", KOMMENTAR.slice(0, 20)])
            expect(text).not.toContain(geheim);
        // Mit Zitat, aber ohne --anwenden bleibt es ein Probelauf.
        const mitZitat = await lauf(["--datei", datei, "--operator-said", "los"], schreibgeschuetzt);
        expect(mitZitat.code).toBe(0);
        expect(mitZitat.text).toContain("PROBELAUF");
        expect(await zaehlen()).toEqual(vorher);
    });

    it("🔴 `--anwenden` mit Zitat legt je Meldung einen Vorgang an, prüft sie gegen die Datei und protokolliert nur Zahlen", async () => {
        const vorher = await zaehlen();
        const { code, text } = await lauf([
            "--datei",
            datei,
            "--anwenden",
            "--operator-said",
            "Übernimm die offenen Meldungen auf dev.",
        ]);
        expect(text).toContain("Freigabe (Betreiberzitat): „Übernimm die offenen Meldungen auf dev.“");
        expect(text).toMatch(/3 neu angelegt, 0 waren schon da/u);
        expect(text).toContain("alle 3 Meldungen stimmen mit der Datei überein");
        expect(code).toBe(0);
        for (const geheim of [NAME_MELDER, NAME_ZWEITER, "Testfluss", "Zwölfhain", KOMMENTAR.slice(0, 20)])
            expect(text).not.toContain(geheim);
        const nachher = await zaehlen();
        expect(nachher.vorgang).toBe(vorher.vorgang + 3);
        expect(nachher.legacy).toBe(vorher.legacy + 3);
        expect(nachher.ereignis).toBe(vorher.ereignis + 3);
        expect(nachher.protokoll).toBe(vorher.protokoll + 1);

        const [eintrag] = await database<
            { details: Record<string, unknown>; actor_kind: string; actor_label: string; target_ref: string }[]
        >`
            SELECT details, actor_kind, actor_label, target_ref FROM avesmaps_auth.security_event
             WHERE action = 'system.community_legacy_uebernommen' ORDER BY id DESC LIMIT 1
        `;
        expect(eintrag).toMatchObject({
            details: { geliefert: 5, angelegt: 3, vorhanden: 0, ausgefiltert: 2, zitat: true },
            actor_kind: "cli",
            actor_label: "cli:probe",
        });
        expect(JSON.stringify(eintrag)).not.toContain("Übernimm");
    });

    it("🔴 der Vorgang des Orts: Bezug auf den Ort mit Vorschlag, Nachricht, Notiz, Ereignis und die alte Eingangszeit", async () => {
        const id = await vorgangVon(BASIS + 1);
        const [v] = await database<
            {
                art: string;
                kategorie: string;
                eingang: string;
                zustand: string;
                quelle: string | null;
                fehlt_art: string | null;
                revision: number;
                eingegangen_at: Date;
                aktiv_at: Date;
            }[]
        >`SELECT art, kategorie, eingang, zustand, quelle, fehlt_art, revision, eingegangen_at, aktiv_at FROM avesmaps_community.vorgang WHERE id = ${id}`;
        expect(v).toMatchObject({
            art: "meldung",
            kategorie: "angabe",
            eingang: "website",
            zustand: "neu",
            quelle: "Regionalband · https://wiki.example/Zw",
            fehlt_art: null,
            revision: 2,
        });
        expect(v!.eingegangen_at.toISOString()).toBe("2026-08-05T12:03:00.000Z");
        expect(v!.aktiv_at.toISOString()).toBe("2026-08-05T12:03:00.000Z");

        const [b] = await database<
            {
                art: string;
                objekt_art: string;
                objekt_id: string;
                name: string;
                typ: string;
                lage_x: number;
                lage_y: number;
                vorschlag_x: number;
                vorschlag_y: number;
                naechster_ort: string | null;
            }[]
        >`SELECT art, objekt_art, objekt_id::text, name, typ, lage_x, lage_y, vorschlag_x, vorschlag_y, naechster_ort FROM avesmaps_community.bezug WHERE vorgang_id = ${id}`;
        expect(b).toEqual({
            art: "objekt",
            objekt_art: "place",
            objekt_id: ORT_ID,
            name: "Zwölfhain-C9",
            typ: "dorf",
            lage_x: 913,
            lage_y: 722,
            vorschlag_x: 916,
            vorschlag_y: 726,
            naechster_ort: null,
        });

        const [n] = await database<{ richtung: string; weg: string; text: string; at: Date }[]>`
            SELECT richtung, weg, text, at FROM avesmaps_community.nachricht WHERE vorgang_id = ${id}
        `;
        expect(n).toMatchObject({ richtung: "ein", weg: "formular", text: KOMMENTAR });
        expect(n!.at.toISOString()).toBe("2026-08-05T12:03:00.000Z");

        const notizen = await database<{ text: string; von_person: string | null }[]>`
            SELECT text, von_person::text FROM avesmaps_community.notiz WHERE vorgang_id = ${id}
        `;
        expect(notizen).toHaveLength(1);
        expect(notizen[0]!.von_person).toBeNull();
        expect(notizen[0]!.text).toContain(`Meldung ${String(BASIS + 1)} vom 05.08.2026`);
        expect(notizen[0]!.text).toContain("Notiz der Redaktion in Legacy: Redaktion: bitte prüfen.");
        expect(notizen[0]!.text).not.toContain("Alrike");

        const ereignisse = await database<
            {
                seq: number;
                art: string;
                vom_melder: boolean;
                neu: string;
                text: string;
                at: Date;
                von_person: string | null;
            }[]
        >`
            SELECT seq, art, vom_melder, neu, text, at, von_person::text FROM avesmaps_community.ereignis WHERE vorgang_id = ${id}
        `;
        expect(ereignisse).toHaveLength(1);
        expect(ereignisse[0]).toMatchObject({
            seq: 1,
            art: "eingang",
            vom_melder: true,
            neu: "neu",
            text: `Aus Legacy übernommen (Meldung ${String(BASIS + 1)})`,
            von_person: null,
        });
        expect(ereignisse[0]!.at.toISOString()).toBe("2026-08-05T12:03:00.000Z");
    });

    it("🔴 der Melder hat nur den Namen: keine Mail, kein Discord, kein Konto, kein Schlüssel; ohne Namen gar keinen Melder", async () => {
        const mit = await vorgangVon(BASIS + 1);
        const [m] = await database<
            {
                name: string | null;
                mail: string | null;
                discord_id: string | null;
                person_id: string | null;
                schluessel_hash: Buffer | null;
                entfernt_at: Date | null;
            }[]
        >`SELECT name, mail, discord_id, person_id::text, schluessel_hash, entfernt_at FROM avesmaps_community.melder WHERE vorgang_id = ${mit}`;
        expect(m).toEqual({
            name: NAME_MELDER,
            mail: null,
            discord_id: null,
            person_id: null,
            schluessel_hash: null,
            entfernt_at: null,
        });
        const ohne = await vorgangVon(BASIS + 2);
        const melder = await database`SELECT 1 FROM avesmaps_community.melder WHERE vorgang_id = ${ohne}`;
        expect(melder).toHaveLength(0);
        // Auch die Tafel der Zuordnung trägt nichts Persönliches.
        const spalten = await database<{ column_name: string }[]>`
            SELECT column_name FROM information_schema.columns
             WHERE table_schema = 'avesmaps_community' AND table_name = 'legacy_meldung' ORDER BY ordinal_position
        `;
        expect(spalten.map((s) => s.column_name)).toEqual(["legacy_id", "vorgang_id", "uebernommen_at"]);
    });

    it("die Beschriftung und der Weg: Stelle mit dem nächsten Ort, aufgefüllter Text, Art des Fehlenden", async () => {
        const fluss = await vorgangVon(BASIS + 2);
        const [v] = await database<{ kategorie: string; fehlt_art: string | null; eingegangen_at: Date }[]>`
            SELECT kategorie, fehlt_art, eingegangen_at FROM avesmaps_community.vorgang WHERE id = ${fluss}
        `;
        expect(v).toMatchObject({ kategorie: "fehlt", fehlt_art: "fluss" });
        expect(v!.eingegangen_at.toISOString()).toBe("2026-01-05T08:00:00.000Z");
        const [b] = await database<
            { art: string; objekt_id: string | null; lage_x: number; lage_y: number; naechster_ort: string | null }[]
        >`
            SELECT art, objekt_id::text, lage_x, lage_y, naechster_ort FROM avesmaps_community.bezug WHERE vorgang_id = ${fluss}
        `;
        expect(b).toEqual({ art: "stelle", objekt_id: null, lage_x: 916, lage_y: 726, naechster_ort: "Zwölfhain-C9" });
        const [n] = await database<
            { text: string }[]
        >`SELECT text FROM avesmaps_community.nachricht WHERE vorgang_id = ${fluss}`;
        expect(n!.text).toBe("Vorschlag aus der alten Karte: Fluss „Testfluss-C9“. kurz");

        const weg = await vorgangVon(BASIS + 5);
        const [w] = await database<{ kategorie: string; fehlt_art: string | null }[]>`
            SELECT kategorie, fehlt_art FROM avesmaps_community.vorgang WHERE id = ${weg}
        `;
        expect(w).toEqual({ kategorie: "sonstiges", fehlt_art: null });
        // Testzeile und Lage außerhalb sind nie angekommen.
        expect(await vorgangVon(BASIS + 3)).toBeNaN();
        expect(await vorgangVon(BASIS + 4)).toBeNaN();
    });

    it("🔴 derselbe Lauf noch einmal legt nichts doppelt an; jede Legacy-Nummer bleibt bei ihrem Vorgang", async () => {
        const ids = [await vorgangVon(BASIS + 1), await vorgangVon(BASIS + 2), await vorgangVon(BASIS + 5)];
        const vorher = await zaehlen();
        const { code, text } = await lauf([
            "--datei",
            datei,
            "--anwenden",
            "--operator-said",
            "Noch einmal, zur Probe.",
        ]);
        expect(code).toBe(0);
        expect(text).toMatch(/0 neu angelegt, 3 waren schon da/u);
        const nachher = await zaehlen();
        expect(nachher.vorgang).toBe(vorher.vorgang);
        expect(nachher.legacy).toBe(vorher.legacy);
        expect(nachher.ereignis).toBe(vorher.ereignis);
        expect([await vorgangVon(BASIS + 1), await vorgangVon(BASIS + 2), await vorgangVon(BASIS + 5)]).toEqual(ids);
        // Der Probelauf danach sieht sie als schon übernommen.
        expect((await lauf(["--datei", datei], schreibgeschuetzt)).text).toMatch(/schon übernommen\s+3/u);
        // Dieselbe Nummer direkt gerufen gibt den vorhandenen Vorgang zurück.
        const plan = planeUebernahme(pruefeDatei(JSON.parse(readFileSync(datei, "utf8"))), []);
        expect(await uebernehmeEine(database, plan.uebernahmen[0]!)).toBe(ids[0]);
        expect(await zaehlen()).toMatchObject({ vorgang: vorher.vorgang, legacy: vorher.legacy });
    });

    it("🔴 die Prüfung nach dem Lauf schlägt an, wenn Text, Lage, Melder oder Zahl der Zeilen nicht mehr zur Datei passen", async () => {
        const plan = planeUebernahme(pruefeDatei(JSON.parse(readFileSync(datei, "utf8"))), [
            ORT("Zwölfhain-C9", 913, 722, "dorf"),
        ]);
        // Die Orte der Probe sind nicht die der Datenbank: Für die Prüfung zählen nur die Meldungen 1, 2 und 5 mit ihrer Abbildung gegen die Datenbank.
        const eigene = plan.uebernahmen.filter((u) => u.legacyId === BASIS + 2 || u.legacyId === BASIS + 5);
        expect(await pruefeNachLauf(database, eigene)).toEqual([]);
        const id = await vorgangVon(BASIS + 2);
        const aendere = async (aenderung: () => Promise<unknown>, rueckgaengig: () => Promise<unknown>) => {
            await aenderung();
            try {
                expect(await pruefeNachLauf(database, eigene)).toEqual([BASIS + 2]);
            } finally {
                await rueckgaengig();
            }
            expect(await pruefeNachLauf(database, eigene)).toEqual([]);
        };
        await aendere(
            () =>
                database`UPDATE avesmaps_community.nachricht SET text = 'ein anderer Text, ganz anders' WHERE vorgang_id = ${id}`,
            () =>
                database`UPDATE avesmaps_community.nachricht SET text = 'Vorschlag aus der alten Karte: Fluss „Testfluss-C9“. kurz' WHERE vorgang_id = ${id}`,
        );
        await aendere(
            () => database`UPDATE avesmaps_community.bezug SET lage_x = lage_x + 1 WHERE vorgang_id = ${id}`,
            () => database`UPDATE avesmaps_community.bezug SET lage_x = lage_x - 1 WHERE vorgang_id = ${id}`,
        );
        await aendere(
            () =>
                database`INSERT INTO avesmaps_community.melder (vorgang_id, name, mail) VALUES (${id}, 'Jemand', 'jemand@example.org')`,
            () => database`DELETE FROM avesmaps_community.melder WHERE vorgang_id = ${id}`,
        );
        await aendere(
            () => database`UPDATE avesmaps_community.vorgang SET quelle = 'eine erfundene Quelle' WHERE id = ${id}`,
            () => database`UPDATE avesmaps_community.vorgang SET quelle = NULL WHERE id = ${id}`,
        );
        // Eine Meldung, die nie übernommen wurde, fehlt.
        const nie = planeUebernahme([zeile(BASIS + 91)], []).uebernahmen;
        expect(await pruefeNachLauf(database, nie)).toEqual([BASIS + 91]);
    });

    it("die Datenbank prüft die Grenzen wie `community_melden`: zu kurzer Text, kein Bezug, unbekannte Kategorie", async () => {
        const plan = planeUebernahme([zeile(BASIS + 90)], []);
        const u = plan.uebernahmen[0]!;
        const rufe = (aenderung: Record<string, unknown>) =>
            uebernehmeEine(database, { ...u, ...aenderung } as typeof u);
        await expect(rufe({ text: "kurz" })).rejects.toMatchObject({ code: "KC422" });
        await expect(rufe({ kategorie: "bewertung" })).rejects.toMatchObject({ code: "KC422" });
        await expect(rufe({ bezug: { art: "irgendwas" } })).rejects.toMatchObject({ code: "KC422" });
        await expect(rufe({ quelle: "q".repeat(QUELLE_MAX + 1) })).rejects.toMatchObject({ code: "KC422" });
        await expect(rufe({ melderName: "n".repeat(NAME_MAX + 1) })).rejects.toMatchObject({ code: "KC422" });
        await expect(rufe({ legacyId: 0 })).rejects.toMatchObject({ code: "KC422" });
        const [z] = await database<
            { n: number }[]
        >`SELECT count(*)::int AS n FROM avesmaps_community.legacy_meldung WHERE legacy_id = ${BASIS + 90}`;
        expect(z!.n).toBe(0);
    });

    it("🔴 eine unbrauchbare Datei bricht ab und schreibt nichts", async () => {
        const vorher = await zaehlen();
        const kaputt = join(ordner, "kaputt.json");
        writeFileSync(kaputt, JSON.stringify({ ok: true, count: 2, reports: [zeile(BASIS + 60)] }), "utf8");
        expect((await lauf(["--datei", kaputt, "--anwenden", "--operator-said", "x"])).code).toBe(1);
        writeFileSync(kaputt, "{ kein json", "utf8");
        expect((await lauf(["--datei", kaputt, "--anwenden", "--operator-said", "x"])).code).toBe(1);
        expect((await lauf(["--datei", join(ordner, "fehlt.json"), "--anwenden", "--operator-said", "x"])).code).toBe(
            1,
        );
        expect(await zaehlen()).toEqual(vorher);
    });
});
