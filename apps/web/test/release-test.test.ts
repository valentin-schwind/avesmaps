import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
    RELEASE_TEST_BROWSERTEILE,
    RELEASE_TEST_SCHRITTE,
    releaseTestBeschaeftigt,
    releaseTestCommit,
    type ReleaseTestAuftrag,
    type ReleaseTestLauf,
    type ReleaseTestSicht,
    type ReleaseTestTeil,
} from "@avesmaps3d/shared";
import { formProblems } from "../src/auth/formular.ts";
import { ApiFailure } from "../src/auth/api.ts";
import { da } from "../src/i18n/da.ts";
import { de } from "../src/i18n/de.ts";
import { en } from "../src/i18n/en.ts";
import { es } from "../src/i18n/es.ts";
import { fr } from "../src/i18n/fr.ts";
import { t } from "../src/i18n/i18n.ts";
import { it as italienisch } from "../src/i18n/it.ts";
import { nl } from "../src/i18n/nl.ts";
import { pl } from "../src/i18n/pl.ts";
import { sv } from "../src/i18n/sv.ts";
import {
    abbrechenCommit,
    abweisungVon,
    andererStand,
    auftragWartet,
    bereicheText,
    berichtText,
    createReleaseTest,
    dauerGrob,
    faelleText,
    ladeTakt,
    releaseTestAktiv,
    releaseTestKnopf,
    releaseTestWiederholen,
    releaseVolltestKnopf,
    schrittName,
    standGewechselt,
    startGescheitert,
    teilBezeichnung,
    teilZeile,
    versuchOffen,
    wiederholungText,
} from "../src/freigabe/release-test.ts";

/**
 * Der Release-Test in der lokalen Systemsteuerung (WI-0248 L), was die Oberfläche rechnet. Die Sätze, auf die es ankommt:
 * 1. **Der Knopf prüft den aktuellen Stage-Stand und gibt ihn frei** (WI-0248), und er ist gesperrt, solange ein Test läuft oder startet oder dieser Stand schon freigegeben grün ist.
 * 2. **Starten schickt den Stand mit, den die Karte sah; Abbrechen den des laufenden Tests.**
 * 3. **Der Bericht zum Kopieren enthält genau, was die Karte zeigt**, mit Stand, Zeitpunkten und Ort der Berichte.
 */

const STAGE = "a".repeat(40);
const AUFTRAG = "b".repeat(40);

const lauf = (patch: Partial<ReleaseTestLauf> = {}): ReleaseTestLauf => ({
    zustand: "keiner",
    fertigeTeile: [],
    sperre: false,
    jetzt: "2026-10-23T10:00:00.000Z",
    schritte: RELEASE_TEST_SCHRITTE.map((id) => ({
        id,
        zustand: "offen" as const,
        erwartetMs: 60_000,
        schaetzung: true,
    })),
    erwartetMs: 14 * 60_000,
    erwartetSchaetzung: true,
    fortschritt: 0,
    ...patch,
});

const auftrag = (patch: Partial<ReleaseTestAuftrag> = {}): ReleaseTestAuftrag => ({
    id: "00000000-0000-4000-8000-000000000001",
    zustand: "wartet",
    commit: AUFTRAG,
    wiederholen: false,
    seit: "2026-10-26T08:00:00.000Z",
    platz: 2,
    wartetAuf: null,
    grund: null,
    abbruch: false,
    ...patch,
});

const sicht = (patch: Partial<ReleaseTestSicht> = {}): ReleaseTestSicht => ({
    now: "2026-10-23T10:00:00.000Z",
    verfuegbar: true,
    fehler: null,
    // WI-0248: Geprüft und freigegeben wird der aktuelle Stage-Stand; der Stand der Läufe in diesen Fällen (`AUFTRAG`) ist er.
    kandidat: {
        stage: { sha: AUFTRAG, zeit: "2026-10-23T08:00:00Z" },
        auftrag: null,
    },
    lauf: lauf(),
    start: null,
    ...patch,
});

describe("Welcher Stand, und wann ist der Knopf zu", () => {
    it("🔴 geprüft wird der aktuelle Stage-Stand (WI-0248), auch neben einem früheren Auftrag der Stage", () => {
        expect(releaseTestCommit(sicht().kandidat)).toBe(AUFTRAG);
        const mitAuftrag = {
            stage: { sha: STAGE, zeit: "z" },
            auftrag: { sha: AUFTRAG, zeit: "z", ops: "OPS-000123" },
        };
        expect(releaseTestCommit(mitAuftrag)).toBe(STAGE);
        expect(releaseTestCommit({ stage: null, auftrag: null })).toBeNull();
        expect(releaseTestKnopf(sicht())).toEqual({ commit: AUFTRAG, sperre: null });
        expect(releaseTestKnopf(sicht({ kandidat: mitAuftrag }))).toEqual({ commit: STAGE, sperre: null });
    });

    it("🔴 ein grüner Stand sperrt nur, wenn er schon freigegeben ist; ein Grün ohne Freigabe gibt der Druck frei (WI-0248)", () => {
        const gruen = lauf({ zustand: "gruen", sha: AUFTRAG });
        expect(releaseTestKnopf(sicht({ lauf: gruen })).sperre).toBeNull();
        const freigabe = {
            sha: AUFTRAG,
            zeit: "z",
            kennung: "RT-00000000-0000-4000-8000-000000000001",
            von: "Vali",
            zustand: "gruen" as const,
            ausliefern: true,
            grund: "grün",
        };
        const k = { stage: { sha: AUFTRAG, zeit: "z" }, auftrag: null, freigabe };
        expect(releaseTestKnopf(sicht({ lauf: gruen, kandidat: k })).sperre).toBe("gruen");
        // Eine abgebrochene Freigabe desselben Standes sperrt nicht: Der nächste Druck gibt neu frei.
        const ab = { ...k, freigabe: { ...freigabe, zustand: "abgebrochen" as const, ausliefern: false } };
        expect(releaseTestKnopf(sicht({ lauf: gruen, kandidat: ab })).sperre).toBeNull();
    });

    it("🔴 gesperrt mit Grund: nicht verfügbar, kein Stand, läuft, abgestürzt, startet", () => {
        expect(releaseTestKnopf(null).sperre).toBe("nicht_verfuegbar");
        expect(releaseTestKnopf(sicht({ verfuegbar: false, lauf: null })).sperre).toBe("nicht_verfuegbar");
        expect(releaseTestKnopf(sicht({ kandidat: { stage: null, auftrag: null } })).sperre).toBe("kein_kandidat");
        expect(releaseTestKnopf(sicht({ lauf: lauf({ zustand: "laeuft", sha: AUFTRAG }) })).sperre).toBe("laeuft");
        expect(releaseTestKnopf(sicht({ lauf: lauf({ zustand: "laeuft", sha: AUFTRAG, lebt: false }) })).sperre).toBe(
            "abgestuerzt",
        );
        expect(
            releaseTestKnopf(sicht({ start: { commit: AUFTRAG, seit: "z", zustand: "baut", grund: null } })).sperre,
        ).toBe("startet");
    });

    it("grün für einen anderen Stand, rot und abgebrochen sperren nichts; ein fehlgeschlagener Start auch nicht", () => {
        expect(releaseTestKnopf(sicht({ lauf: lauf({ zustand: "gruen", sha: STAGE }) })).sperre).toBeNull();
        expect(releaseTestKnopf(sicht({ lauf: lauf({ zustand: "rot", sha: AUFTRAG }) })).sperre).toBeNull();
        expect(releaseTestKnopf(sicht({ lauf: lauf({ zustand: "abgebrochen", sha: AUFTRAG }) })).sperre).toBeNull();
        expect(
            releaseTestKnopf(sicht({ start: { commit: AUFTRAG, seit: "z", zustand: "fehler", grund: "x" } })).sperre,
        ).toBeNull();
    });

    it("Abbrechen gibt es nur für einen laufenden Test mit lebendem Prozess", () => {
        expect(abbrechenCommit(sicht())).toBeNull();
        expect(abbrechenCommit(sicht({ lauf: lauf({ zustand: "laeuft", sha: AUFTRAG }) }))).toBe(AUFTRAG);
        expect(abbrechenCommit(sicht({ lauf: lauf({ zustand: "laeuft", sha: AUFTRAG, lebt: false }) }))).toBeNull();
        expect(abbrechenCommit(sicht({ lauf: lauf({ zustand: "gruen", sha: AUFTRAG }) }))).toBeNull();
        expect(abbrechenCommit(null)).toBeNull();
    });

    it("nachgefragt wird nur, solange etwas läuft: alle dreißig Sekunden, beim Bauen des Testpakets öfter", () => {
        expect(ladeTakt(null)).toBeNull();
        expect(ladeTakt(sicht())).toBeNull();
        expect(ladeTakt(sicht({ lauf: lauf({ zustand: "laeuft" }) }))).toBe(30_000);
        expect(ladeTakt(sicht({ start: { commit: AUFTRAG, seit: "z", zustand: "baut", grund: null } }))).toBe(10_000);
        expect(releaseTestBeschaeftigt(sicht({ lauf: lauf({ zustand: "rot" }) }))).toBe(false);
    });
});

describe("🔴 Der Auftrag in der Warteschlange (WI-0248)", () => {
    it("ein wartender Auftrag sperrt Starten und Wiederholen („eingereiht“), ein übernommener ohne Lauf heißt „startet“", () => {
        expect(releaseTestKnopf(sicht({ auftrag: auftrag() })).sperre).toBe("eingereiht");
        expect(releaseTestKnopf(sicht({ auftrag: auftrag({ zustand: "laeuft", platz: null }) })).sperre).toBe(
            "startet",
        );
        // Läuft der Lauf, gilt er: „läuft“.
        const laeuft = sicht({
            auftrag: auftrag({ zustand: "laeuft" }),
            lauf: lauf({ zustand: "laeuft", sha: AUFTRAG }),
        });
        expect(releaseTestKnopf(laeuft).sperre).toBe("laeuft");
        const rot = sicht({
            auftrag: auftrag(),
            lauf: lauf({ zustand: "rot", sha: AUFTRAG, wiederholbar: true }),
        });
        expect(releaseTestWiederholen(rot)).toMatchObject({ sichtbar: true, sperre: "eingereiht" });
    });

    it("Abbrechen gilt dem Auftrag, wartend oder laufend; ohne Auftrag dem laufenden Test", () => {
        expect(abbrechenCommit(sicht({ auftrag: auftrag() }))).toBe(AUFTRAG);
        expect(abbrechenCommit(sicht({ auftrag: auftrag({ zustand: "laeuft" }) }))).toBe(AUFTRAG);
        expect(abbrechenCommit(sicht({ auftrag: null }))).toBeNull();
    });

    it("mit Auftrag ist die Karte aktiv und fragt alle zehn Sekunden nach, mit laufendem Lauf alle dreißig", () => {
        expect(releaseTestAktiv(sicht({ auftrag: auftrag() }))).toBe(true);
        expect(ladeTakt(sicht({ auftrag: auftrag() }))).toBe(10_000);
        expect(
            ladeTakt(
                sicht({ auftrag: auftrag({ zustand: "laeuft" }), lauf: lauf({ zustand: "laeuft", sha: AUFTRAG }) }),
            ),
        ).toBe(30_000);
        expect(versuchOffen(sicht({ auftrag: auftrag() }), Date.parse("2026-10-26T09:00:00Z"))).toBe(false);
    });

    it("wartend: Platz, worauf er wartet und der Grund; laufend oder ohne Auftrag nichts", () => {
        expect(auftragWartet(sicht({ auftrag: auftrag({ wartetAuf: "terrain_full", grund: "waits_slot" }) }))).toEqual({
            platz: 2,
            wartetAuf: "terrain_full",
            grund: "waits_slot",
        });
        expect(auftragWartet(sicht({ auftrag: auftrag({ zustand: "laeuft" }) }))).toBeNull();
        expect(auftragWartet(sicht())).toBeNull();
    });
});

describe("Start gescheitert, und ein Lauf von einem anderen Stand", () => {
    const fehler = {
        commit: AUFTRAG,
        seit: "2026-10-23T10:00:00.000Z",
        zustand: "fehler" as const,
        grund: "kein Platz",
    };

    it("🔴 ein gescheiterter Start ist der Zustand der Karte; ein startender, ein gelungener und keiner sind es nicht", () => {
        expect(startGescheitert(sicht({ start: fehler }))).toEqual(fehler);
        expect(startGescheitert(sicht({ start: { ...fehler, zustand: "baut", grund: null } }))).toBeNull();
        expect(startGescheitert(sicht({ start: null }))).toBeNull();
        expect(startGescheitert(null)).toBeNull();
        // Er sperrt den Knopf nicht: Der nächste Versuch ist erlaubt.
        expect(releaseTestKnopf(sicht({ start: fehler })).sperre).toBeNull();
    });

    it("🔴 ein Lauf, der zu einem anderen Stand gehört als der Kandidat, wird so benannt; derselbe Stand, kein Lauf und kein Kandidat nicht", () => {
        const rot = lauf({ zustand: "rot", sha: STAGE });
        // Kandidat ist die Freigabe (AUFTRAG), der Lauf gehört zum Stage-Stand.
        expect(andererStand(sicht({ lauf: rot }))).toEqual({ lauf: STAGE, kandidat: AUFTRAG });
        expect(andererStand(sicht({ lauf: lauf({ zustand: "gruen", sha: AUFTRAG }) }))).toBeNull();
        expect(andererStand(sicht({ lauf: lauf() }))).toBeNull();
        expect(andererStand(sicht({ lauf: lauf({ zustand: "rot" }) }))).toBeNull();
        expect(andererStand(sicht({ lauf: null }))).toBeNull();
        expect(andererStand(sicht({ lauf: rot, kandidat: { stage: null, auftrag: null } }))).toBeNull();
        expect(andererStand(null)).toBeNull();
    });
});

describe("Zeiten in der Sprache der Seite", () => {
    it("grob: Minuten, ab zehn auf fünf gerundet; ab einer Stunde Stunden und Minuten", () => {
        expect(dauerGrob(20_000, "de")).toBe("1 Min.");
        expect(dauerGrob(7 * 60_000, "de")).toBe("7 Min.");
        expect(dauerGrob(12 * 60_000, "de")).toBe("10 Min.");
        expect(dauerGrob(13 * 60_000, "de")).toBe("15 Min.");
        expect(dauerGrob(60 * 60_000, "de")).toBe("1 Std.");
        expect(dauerGrob((2 * 60 + 24) * 60_000, "de")).toBe("2 Std. 25 Min.");
        expect(dauerGrob(7 * 60_000, "en")).toBe("7 min");
    });

    it("die Schritte tragen ihren Namen aus der Sprachtafel; die Browserteile ihre Nummer", () => {
        expect(schrittName("installation", t)).toBe("Installation");
        expect(schrittName("typen", t)).toBe("Typprüfung");
        expect(schrittName("browser-3", t)).toBe("Browser 3 von 4");
        for (const id of RELEASE_TEST_SCHRITTE) {
            const name = schrittName(id, t);
            expect(name, id).not.toMatch(/^admin\./u);
        }
    });
});

describe("Der Bericht zum Kopieren", () => {
    const rot = (): ReleaseTestSicht =>
        sicht({
            lauf: lauf({
                zustand: "rot",
                sha: AUFTRAG,
                start: "2026-10-23T10:00:00.000Z",
                ende: "2026-10-23T12:30:00.000Z",
                ordner: "C:/avesmaps3d-data/release-werkzeug/.release-runs/b",
                fehler: {
                    schritt: "tests",
                    grund: "tests: Exit 1",
                    faelle: [
                        { datei: "apps/server/test/a.test.ts", name: "A rechnet", meldung: ["erwartet 2", "bekam 3"] },
                        { datei: "apps/web/test/b.test.ts", name: "", meldung: ["Cannot find module"] },
                    ],
                    faelleGesamt: 5,
                    protokollEnde: ["Zeile 1", "FAIL a.test.ts"],
                },
            }),
        });

    it("🔴 nennt Stand, Zeitpunkte, Schritt, Grund, rote Fälle mit ihren Meldungen, das Protokollende und den Ort der Berichte", () => {
        expect(berichtText(rot(), t)).toBe(
            [
                "Release-Test: rot",
                `Stand: ${AUFTRAG}`,
                "Start: 2026-10-23T10:00:00.000Z · Ende: 2026-10-23T12:30:00.000Z",
                "Fehlgeschlagen in: Alle Tests",
                "Meldung:",
                "tests: Exit 1",
                "Rote Fälle (2 von 5):",
                "- apps/server/test/a.test.ts › A rechnet",
                "    erwartet 2",
                "    bekam 3",
                "- apps/web/test/b.test.ts",
                "    Cannot find module",
                "Ende des Protokolls (Alle Tests):",
                "Zeile 1",
                "FAIL a.test.ts",
                "Vollständige Berichte: C:/avesmaps3d-data/release-werkzeug/.release-runs/b",
            ].join("\n"),
        );
    });

    it("ohne rote Fälle und ohne Protokoll bleiben die Teile weg; ohne Bericht gibt es keinen Text", () => {
        const s = rot();
        const ohne = {
            ...s,
            lauf: {
                ...s.lauf!,
                fehler: { schritt: null, grund: "abgebrochen", faelle: [], faelleGesamt: 0, protokollEnde: [] },
            },
        } as ReleaseTestSicht;
        const text = berichtText(ohne, t) ?? "";
        expect(text).toContain("abgebrochen");
        expect(text).not.toContain("Rote Fälle");
        expect(text).not.toContain("Ende des Protokolls");
        expect(text).not.toContain("Fehlgeschlagen in");
        expect(berichtText(sicht(), t)).toBeNull();
        expect(berichtText(null, t)).toBeNull();
    });
});

describe("Laden, Starten, Abbrechen", () => {
    type Anfrage = { url: string; methode: string; body: Record<string, unknown> | undefined };
    const stubFetcher = (
        antworten: { get?: unknown; getStatus?: number; post?: unknown; postStatus?: number },
        log: Anfrage[],
    ): typeof fetch =>
        (async (url: RequestInfo | URL, init?: RequestInit) => {
            const methode = init?.method ?? "GET";
            log.push({
                url: String(url),
                methode,
                body: init?.body === undefined ? undefined : (JSON.parse(String(init.body)) as Record<string, unknown>),
            });
            const post = methode === "POST";
            const status = (post ? antworten.postStatus : antworten.getStatus) ?? 200;
            const body = post ? antworten.post : antworten.get;
            return new Response(JSON.stringify(body ?? {}), {
                status,
                headers: { "content-type": "application/json" },
            });
        }) as typeof fetch;

    it("lädt die Sicht; antwortet die Route nicht (nicht lokal), bleibt sie leer und die Karte weg", async () => {
        const log: Anfrage[] = [];
        const test = createReleaseTest({
            fetcher: stubFetcher({ get: sicht() }, log),
            jetzt: () => 5_000,
        });
        await test.laden();
        expect(test.sicht.value?.verfuegbar).toBe(true);
        expect(test.abwesend.value).toBe(false);
        expect(test.geladenAm.value).toBe(5_000);
        expect(log[0]).toMatchObject({ methode: "GET" });
        expect(log[0]?.url).toBe("/api/admin/system/release-test");

        const nicht = createReleaseTest({
            fetcher: stubFetcher({ get: { error: { code: "not_found", message: "x" } }, getStatus: 404 }, []),
        });
        await nicht.laden();
        expect(nicht.sicht.value).toBeNull();
        expect(nicht.abwesend.value).toBe(true);

        const fremd = createReleaseTest({ fetcher: stubFetcher({ get: { operationId: "x", status: "applied" } }, []) });
        await fremd.laden();
        expect(fremd.sicht.value).toBeNull();
    });

    it("gleichzeitige Fragen teilen sich eine", async () => {
        const log: Anfrage[] = [];
        const test = createReleaseTest({ fetcher: stubFetcher({ get: sicht() }, log) });
        await Promise.all([test.laden(), test.laden(), test.laden()]);
        expect(log.filter((a) => a.methode === "GET")).toHaveLength(1);
    });

    it("🔴 Starten schickt den Stand mit, den die Karte sah, und lädt danach neu; gesperrt schickt es nichts", async () => {
        const log: Anfrage[] = [];
        const test = createReleaseTest({
            fetcher: stubFetcher({ get: sicht(), post: { operationId: "x", status: "applied" } }, log),
        });
        await test.laden();
        expect(await test.starten()).toBe(true);
        const posts = log.filter((a) => a.methode === "POST");
        expect(posts).toHaveLength(1);
        expect(posts[0]?.url).toBe("/api/admin/system/release-test/starten");
        expect(posts[0]?.body).toMatchObject({ commit: AUFTRAG });
        expect(typeof posts[0]?.body?.["operationId"]).toBe("string");
        expect(log.at(-1)?.methode).toBe("GET");

        // Läuft schon einer: Es geht nichts raus.
        const laeuft = createReleaseTest({
            fetcher: stubFetcher({ get: sicht({ lauf: lauf({ zustand: "laeuft", sha: AUFTRAG }) }) }, log),
        });
        await laeuft.laden();
        const vorher = log.length;
        expect(await laeuft.starten()).toBe(false);
        expect(log.length).toBe(vorher);
    });

    it("Abbrechen schickt den Stand des laufenden Tests und sonst nichts", async () => {
        const log: Anfrage[] = [];
        const test = createReleaseTest({
            fetcher: stubFetcher(
                {
                    get: sicht({ lauf: lauf({ zustand: "laeuft", sha: STAGE }) }),
                    post: { operationId: "x", status: "applied" },
                },
                log,
            ),
        });
        await test.laden();
        expect(await test.abbrechen()).toBe(true);
        const post = log.find((a) => a.methode === "POST");
        expect(post?.url).toBe("/api/admin/system/release-test/abbrechen");
        expect(post?.body).toMatchObject({ commit: STAGE });

        const keiner = createReleaseTest({ fetcher: stubFetcher({ get: sicht() }, []) });
        await keiner.laden();
        expect(await keiner.abbrechen()).toBe(false);
    });

    it("🔴 ein abgelehnter Start nennt seinen Grund als eigenen Satz", async () => {
        const test = createReleaseTest({
            fetcher: stubFetcher(
                { get: sicht(), post: { error: { code: "release_test_stale", message: "x" } }, postStatus: 409 },
                [],
            ),
        });
        await test.laden();
        expect(await test.starten()).toBe(false);
        expect(test.problems.value).toEqual([{ key: "admin.umgebungen.releaseTest.error.stale" }]);
        expect(test.busy.value).toBe(false);
    });
});

describe("Die Fehlercodes haben ihre Sätze", () => {
    it("🔴 jeder Fachcode des Servers wird ein Satz der Tafel, nicht „ging nicht“", () => {
        const codes = [
            "release_test_unavailable",
            "release_test_stale",
            "release_test_laeuft",
            "release_test_gruen",
            "release_test_sperre",
            "release_test_kein_lauf",
            "release_test_kein_roter_lauf",
            "release_test_fehler",
        ];
        const keys = codes.map((code) => formProblems(new ApiFailure(409, code, "x"))[0]?.key);
        expect(new Set(keys).size).toBe(codes.length);
        for (const key of keys) {
            expect(key).toMatch(/^admin\.umgebungen\.releaseTest\.error\./u);
            expect(de[key as keyof typeof de], String(key)).toBeTypeOf("string");
        }
    });
});

// ───────────────────────── Rote Teile wiederholen, Browserteile nach Thema (WI-0248) ─────────────────────────

const teil = (patch: Partial<ReleaseTestTeil> & { id: ReleaseTestTeil["id"] }): ReleaseTestTeil => ({
    name: "Name",
    bereiche: ["orte", "wege"],
    zustand: "gruen",
    uebernommen: false,
    erwartetMs: 60_000,
    ...patch,
});

describe("🔴 Rote Teile wiederholen: Wann der Knopf steht", () => {
    const rot = (patch: Partial<ReleaseTestLauf> = {}): ReleaseTestSicht =>
        sicht({ lauf: lauf({ zustand: "rot", sha: AUFTRAG, wiederholbar: true, ...patch }) });

    it("nur wenn es für den Kandidaten einen roten oder abgebrochenen, wiederholbaren Lauf gibt", () => {
        expect(releaseTestWiederholen(rot())).toEqual({ sichtbar: true, commit: AUFTRAG, sperre: null });
        expect(releaseTestWiederholen(rot({ zustand: "abgebrochen" })).sichtbar).toBe(true);
        // Ein Lauf ohne Kennzeichen „wiederholbar“ (älterer Starter) oder grün, laufend, ohne Lauf: kein Knopf.
        expect(releaseTestWiederholen(rot({ wiederholbar: false })).sichtbar).toBe(false);
        expect(releaseTestWiederholen(sicht({ lauf: lauf({ zustand: "rot", sha: AUFTRAG }) })).sichtbar).toBe(false);
        expect(
            releaseTestWiederholen(sicht({ lauf: lauf({ zustand: "gruen", sha: AUFTRAG, wiederholbar: true }) }))
                .sichtbar,
        ).toBe(false);
        expect(
            releaseTestWiederholen(sicht({ lauf: lauf({ zustand: "laeuft", sha: AUFTRAG, wiederholbar: true }) }))
                .sichtbar,
        ).toBe(false);
        expect(releaseTestWiederholen(sicht()).sichtbar).toBe(false);
        expect(releaseTestWiederholen(null)).toEqual({ sichtbar: false, commit: null, sperre: null });
    });

    it("🔴 ein roter Lauf eines anderen Standes ist keine Antwort auf den Kandidaten: kein Knopf", () => {
        expect(releaseTestWiederholen(rot({ sha: STAGE })).sichtbar).toBe(false);
        expect(releaseTestWiederholen(rot({ sha: STAGE })).commit).toBe(AUFTRAG);
    });

    it("gesperrt, solange ein Start das Testpaket baut", () => {
        const baut = { commit: AUFTRAG, seit: "z", zustand: "baut" as const, grund: null };
        expect(releaseTestWiederholen({ ...rot(), start: baut })).toEqual({
            sichtbar: true,
            commit: AUFTRAG,
            sperre: "startet",
        });
    });
});

describe("Rote Teile wiederholen: der Aufruf", () => {
    type Anfrage = { url: string; methode: string; body: Record<string, unknown> | undefined };
    const fetcher = (
        get: unknown,
        log: Anfrage[],
        post: unknown = { operationId: "x", status: "applied" },
    ): typeof fetch =>
        (async (url: RequestInfo | URL, init?: RequestInit) => {
            const methode = init?.method ?? "GET";
            log.push({
                url: String(url),
                methode,
                body: init?.body === undefined ? undefined : (JSON.parse(String(init.body)) as Record<string, unknown>),
            });
            return new Response(JSON.stringify(methode === "POST" ? post : get), {
                status: 200,
                headers: { "content-type": "application/json" },
            });
        }) as typeof fetch;

    it("🔴 schickt den Stand des roten Laufs mit wiederholen: true an die Startroute und lädt danach neu", async () => {
        const log: Anfrage[] = [];
        const test = createReleaseTest({
            fetcher: fetcher(sicht({ lauf: lauf({ zustand: "rot", sha: AUFTRAG, wiederholbar: true }) }), log),
        });
        await test.laden();
        expect(await test.wiederholen()).toBe(true);
        const posts = log.filter((a) => a.methode === "POST");
        expect(posts).toHaveLength(1);
        expect(posts[0]?.url).toBe("/api/admin/system/release-test/starten");
        expect(posts[0]?.body).toMatchObject({ commit: AUFTRAG, wiederholen: true });
        expect(log.at(-1)?.methode).toBe("GET");
    });

    it("ein gewöhnlicher Start schickt kein wiederholen; ohne roten Lauf oder bei einem laufenden Test geht nichts raus", async () => {
        const log: Anfrage[] = [];
        const test = createReleaseTest({ fetcher: fetcher(sicht(), log) });
        await test.laden();
        expect(await test.starten()).toBe(true);
        expect(log.find((a) => a.methode === "POST")?.body).not.toHaveProperty("wiederholen");
        const vorher = log.length;
        expect(await test.wiederholen()).toBe(false);
        expect(log.length).toBe(vorher);

        const laeuft = createReleaseTest({
            fetcher: fetcher(sicht({ lauf: lauf({ zustand: "laeuft", sha: AUFTRAG, wiederholbar: true }) }), log),
        });
        await laeuft.laden();
        const nach = log.length;
        expect(await laeuft.wiederholen()).toBe(false);
        expect(log.length).toBe(nach);
    });

    it("kein früherer Lauf: Der Fachcode des Servers wird ein eigener Satz", async () => {
        const test = createReleaseTest({
            fetcher: (async (_url: RequestInfo | URL, init?: RequestInit) =>
                new Response(
                    JSON.stringify(
                        init?.method === "POST"
                            ? { error: { code: "release_test_kein_roter_lauf", message: "x" } }
                            : sicht({ lauf: lauf({ zustand: "rot", sha: AUFTRAG, wiederholbar: true }) }),
                    ),
                    { status: init?.method === "POST" ? 409 : 200, headers: { "content-type": "application/json" } },
                )) as typeof fetch,
        });
        await test.laden();
        expect(await test.wiederholen()).toBe(false);
        expect(test.problems.value).toEqual([{ key: "admin.umgebungen.releaseTest.error.keinRoterLauf" }]);
    });
});

describe("Die Browserteile in Worten", () => {
    it("Name aus der Tafel über die Kennung, Bereiche in der Sprache der Seite, Fälle als Satzteil", () => {
        expect(teilBezeichnung("browser-2", t)).toBe("Browser 2 von 4 · Gebiete, Landschaften, Darstellung");
        expect(teilBezeichnung("tests", t)).toBe("Alle Tests");
        expect(bereicheText({ bereiche: ["orte", "kraftlinien"] }, t)).toBe("Orte, Kraftlinien");
        expect(faelleText({ faelle: 453 }, t)).toBe("Fälle: 453");
        expect(faelleText({ faelle: 453, faelleSchaetzung: true }, t)).toBe("Fälle: ≈ 453");
        expect(faelleText({}, t)).toBeNull();
    });

    it("eine Zeile je Teil für den Bericht: Zustand, übernommen, Fälle, rote, Grund", () => {
        expect(teilZeile(teil({ id: "browser-1", faelle: 373, rot: 0 }), t)).toBe(
            "- Browser 1 von 4 · Orte, Wege, Kraftlinien: grün · Fälle: 373",
        );
        expect(teilZeile(teil({ id: "browser-2", zustand: "rot", faelle: 437, rot: 2 }), t)).toBe(
            "- Browser 2 von 4 · Gebiete, Landschaften, Darstellung: rot · Fälle: 437 · rot: 2",
        );
        expect(
            teilZeile(teil({ id: "browser-3", zustand: "uebersprungen", grund: "Martin ließ sich nicht starten" }), t),
        ).toBe("- Browser 3 von 4 · Kamera, Karte, Systemsteuerung: nicht gelaufen · Martin ließ sich nicht starten");
        expect(teilZeile(teil({ id: "browser-4", uebernommen: true, faelle: 497, faelleSchaetzung: false }), t)).toBe(
            "- Browser 4 von 4 · Infopanel, Reisen, Spielmodus: grün · übernommen · Fälle: 497",
        );
    });

    it("die Wiederholung: was übernommen wurde und was neu lief, oder warum nichts", () => {
        expect(
            wiederholungText({ von: "x", uebernommen: ["voll", "browser-1"], neu: ["browser-2"], grund: null }, t),
        ).toBe(
            "Wiederholung: übernommen Alle Tests, Browser 1 von 4 · Orte, Wege, Kraftlinien; neu gelaufen: Browser 2 von 4 · Gebiete, Landschaften, Darstellung.",
        );
        expect(
            wiederholungText(
                {
                    von: "x",
                    uebernommen: [],
                    neu: ["voll"],
                    grund: "Umgebung verändert (Testpaket): alle Teile laufen neu",
                },
                t,
            ),
        ).toBe("Wiederholung: nichts übernommen. Umgebung verändert (Testpaket): alle Teile laufen neu");
    });

    it("🔴 der Bericht zum Kopieren nennt die Teile, die Wiederholung und bei jedem Fall seinen Teil", () => {
        const s = sicht({
            lauf: lauf({
                zustand: "rot",
                sha: AUFTRAG,
                start: "2026-10-24T10:00:00.000Z",
                ende: "2026-10-24T12:00:00.000Z",
                teile: [
                    teil({ id: "browser-1", faelle: 373 }),
                    teil({ id: "browser-2", zustand: "rot", faelle: 437, rot: 1 }),
                ],
                wiederholung: { von: "x", uebernommen: ["voll"], neu: ["browser-1", "browser-2"], grund: null },
                fehler: {
                    schritt: "tests",
                    grund: "Vitest: 1 rot, 0 übersprungen, 0 todo\nBrowserteil 2 (x): 1 rot",
                    faelle: [
                        {
                            datei: "apps/server/test/a.test.ts",
                            name: "[rot] A",
                            meldung: ["erwartet 2"],
                            teil: "tests",
                            teilName: "Alle Tests",
                        },
                        { datei: "b.spec.ts", name: "[rot] B", meldung: [], teil: "browser-2", teilName: "x" },
                    ],
                    faelleGesamt: 2,
                    protokollEnde: [],
                },
            }),
        });
        const text = berichtText(s, t) ?? "";
        expect(text).toContain(
            "Teile:\n- Browser 1 von 4 · Orte, Wege, Kraftlinien: grün · Fälle: 373\n- Browser 2 von 4",
        );
        expect(text).toContain("Wiederholung: übernommen Alle Tests; neu gelaufen: Browser 1 von 4");
        expect(text).toContain("- [Alle Tests] apps/server/test/a.test.ts › [rot] A");
        expect(text).toContain("- [Browser 2 von 4 · Gebiete, Landschaften, Darstellung] b.spec.ts › [rot] B");
        // Reihenfolge: Meldung, Teile, Wiederholung, rote Fälle.
        expect(text.indexOf("Meldung:")).toBeLessThan(text.indexOf("Teile:"));
        expect(text.indexOf("Teile:")).toBeLessThan(text.indexOf("Wiederholung:"));
        expect(text.indexOf("Wiederholung:")).toBeLessThan(text.indexOf("Rote Fälle"));
    });
});

describe("🔴 Alle Sprachtafeln tragen die Teile und die Wiederholung", () => {
    const tafeln = { de, en, fr, es, it: italienisch, nl, pl, da, sv } as unknown as Record<
        string,
        Record<string, string>
    >;
    const zuordnung = JSON.parse(readFileSync(new URL("../e2e/release-teile.json", import.meta.url), "utf8")) as {
        teile: { id: string; name: string; bereiche: string[] }[];
    };
    const P = "admin.umgebungen.releaseTest.";
    const bereiche = [...new Set(zuordnung.teile.flatMap((x) => x.bereiche))];
    const schluessel = [
        "teile.titel",
        ...RELEASE_TEST_BROWSERTEILE.map((id) => `teil.${id}`),
        ...bereiche.map((b) => `bereich.${b}`),
        "teile.faelle",
        "teile.faelleSchaetzung",
        "teile.rot",
        "teile.uebernommen",
        ...["offen", "laeuft", "gruen", "rot", "uebersprungen"].map((z) => `teile.zustand.${z}`),
        "wiederholen.knopf",
        "wiederholen.hinweis",
        "wiederholung.uebernommen",
        "wiederholung.nichts",
        "bericht.teile",
        "error.keinRoterLauf",
        // Die Abweisung und der Blick auf den Stand vor dem Start (WI-0248).
        "abgewiesen",
        "abgewiesenGrund",
        "stageGewechselt",
        "freigabeGewechselt",
        "keinerLaeuft",
        "letzterLauf",
    ].map((k) => P + k);
    const platzhalter = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/gu)].map((m) => m[1] ?? "").sort();

    it.each(Object.keys(tafeln))(
        "%s: jeder Schlüssel ist da, nicht leer, mit denselben Platzhaltern wie deutsch",
        (sprache) => {
            for (const k of schluessel) {
                const wert = tafeln[sprache]?.[k];
                expect(wert, `${sprache} ${k}`).toBeTypeOf("string");
                expect((wert ?? "").trim().length, `${sprache} ${k}`).toBeGreaterThan(0);
                expect(platzhalter(wert ?? ""), `${sprache} ${k}`).toEqual(platzhalter(tafeln["de"]?.[k] ?? ""));
            }
        },
    );

    it("🔴 die Namen der Teile in der deutschen Tafel sind die der Zuordnung (eine Quelle, kein Auseinanderlaufen)", () => {
        // Die vier Teile nach Thema; dazu `kern`, die Stichprobe von Prüfprofil B mit eigenem Namen aus release-kern.json, und `kern-echt`, die
        // Kernabläufe des Release-Tors (Profil tor, WI-0264) mit dem Namen aus release-tor.json.
        expect(zuordnung.teile.map((x) => x.id)).toEqual(
            RELEASE_TEST_BROWSERTEILE.filter((id) => id !== "kern" && id !== "kern-echt"),
        );
        for (const x of zuordnung.teile) expect(tafeln["de"]?.[`${P}teil.${x.id}`], x.id).toBe(x.name);
        const kern = JSON.parse(readFileSync(new URL("../e2e/release-kern.json", import.meta.url), "utf8")) as {
            name: string;
        };
        expect(tafeln["de"]?.[`${P}teil.kern`]).toBe(kern.name);
        const tor = JSON.parse(readFileSync(new URL("../e2e/release-tor.json", import.meta.url), "utf8")) as {
            name: string;
            bereiche: string[];
        };
        expect(tafeln["de"]?.[`${P}teil.kern-echt`]).toBe(tor.name);
        // Jeder Bereich des Tors hat sein Wort (die Systemsteuerung übersetzt sie).
        for (const b of tor.bereiche) expect(tafeln["de"]?.[`${P}bereich.${b}`], b).toBeTypeOf("string");
    });

    it("🔴 jeder Schritt des Runners hat in jeder Sprache einen Namen (auch daten und kern-echt des Tors), mit denselben Platzhaltern", () => {
        for (const sprache of Object.keys(tafeln))
            for (const id of RELEASE_TEST_SCHRITTE.filter((s) => !s.startsWith("browser-"))) {
                const wert = tafeln[sprache]?.[`${P}schritt.${id}`];
                expect(wert, `${sprache} ${id}`).toBeTypeOf("string");
                expect((wert ?? "").trim().length, `${sprache} ${id}`).toBeGreaterThan(0);
                expect(platzhalter(wert ?? ""), `${sprache} ${id}`).toEqual(
                    platzhalter(tafeln["de"]?.[`${P}schritt.${id}`] ?? ""),
                );
            }
    });

    it("die Bereiche der Zuordnung haben alle ihr Wort, und ein Wort ohne Bereich steht nicht in der Tafel", () => {
        const vorhanden = Object.keys(de)
            .filter((k) => k.startsWith(`${P}bereich.`))
            .map((k) => k.slice(`${P}bereich.`.length));
        expect(vorhanden.sort()).toEqual(bereiche.sort());
    });
});

// ───────────────────────── Abweisung und frischer Blick vor dem Start (WI-0248, Abbruch am 2026-10-24) ─────────────────────────

describe("🔴 Läuft etwas, oder sagt die Karte „Kein Release-Test läuft“?", () => {
    it("aktiv ist nur ein Lauf mit lebendem Prozess oder ein Start, der sein Paket baut", () => {
        expect(releaseTestAktiv(null)).toBe(false);
        expect(releaseTestAktiv(sicht())).toBe(false);
        expect(releaseTestAktiv(sicht({ lauf: lauf({ zustand: "laeuft", sha: AUFTRAG }) }))).toBe(true);
        expect(releaseTestAktiv(sicht({ lauf: lauf({ zustand: "laeuft", sha: AUFTRAG, lebt: false }) }))).toBe(false);
        expect(releaseTestAktiv(sicht({ start: { commit: AUFTRAG, seit: "z", zustand: "baut", grund: null } }))).toBe(
            true,
        );
    });

    it("nach einem Abbruch, bei Rot, Grün und einem gescheiterten Start läuft nichts", () => {
        for (const zustand of ["abgebrochen", "rot", "gruen"] as const)
            expect(releaseTestAktiv(sicht({ lauf: lauf({ zustand, sha: STAGE }) })), zustand).toBe(false);
        expect(
            releaseTestAktiv(sicht({ start: { commit: AUFTRAG, seit: "z", zustand: "fehler", grund: "Sperre" } })),
        ).toBe(false);
    });

    it("🔴 nach einem Abbruch geht der Startknopf: Der abgebrochene Lauf sperrt nichts", () => {
        const abgebrochen = sicht({ lauf: lauf({ zustand: "abgebrochen", sha: AUFTRAG, sperre: true }) });
        expect(releaseTestKnopf(abgebrochen)).toEqual({ commit: AUFTRAG, sperre: null });
    });
});

describe("🔴 Die Abweisung nennt ihren Grund und bleibt stehen", () => {
    const kandidatStage = { stage: { sha: STAGE, zeit: "z" }, auftrag: null };
    const kandidatAuftrag = {
        stage: { sha: STAGE, zeit: "z" },
        auftrag: { sha: AUFTRAG, zeit: "z", ops: "OPS-000123" },
    };

    it("ein Stand, der sich bewegt hat, nennt den jetzigen: bei der Stage „Die Stage ist …“, bei der Freigabe „Die Freigabe ist …“", () => {
        expect(standGewechselt(kandidatStage, STAGE)).toEqual({
            key: "admin.umgebungen.releaseTest.stageGewechselt",
            params: { sha: "aaaaaaa" },
        });
        expect(standGewechselt(kandidatAuftrag, AUFTRAG)).toEqual({
            key: "admin.umgebungen.releaseTest.freigabeGewechselt",
            params: { sha: "bbbbbbb" },
        });
        expect(t("admin.umgebungen.releaseTest.stageGewechselt", { sha: "3329b56" })).toBe(
            "Die Stage ist inzwischen auf 3329b56 – neu starten?",
        );
    });

    it("die Sperre ohne Prozess: der Satz zum Fachcode und der Grund des Starters wörtlich dahinter", () => {
        const fehler = new ApiFailure(409, "release_test_sperre", "x", {
            grund: "Die Sperre .release-runs\\aktiv besteht, aber kein Release-Lauf lebt (…).",
        });
        expect(abweisungVon(fehler, kandidatStage)).toEqual([
            { key: "admin.umgebungen.releaseTest.error.sperre" },
            {
                key: "admin.umgebungen.releaseTest.abgewiesenGrund",
                params: { grund: "Die Sperre .release-runs\\aktiv besteht, aber kein Release-Lauf lebt (…)." },
            },
        ]);
    });

    it("veraltet (stale) nennt den jetzigen Stand; ein Fehler ohne Kennung des Release-Tests ist keine Abweisung", () => {
        expect(
            abweisungVon(new ApiFailure(409, "release_test_stale", "x", { kandidat: STAGE }), kandidatStage),
        ).toEqual([standGewechselt(kandidatStage, STAGE)]);
        expect(abweisungVon(new ApiFailure(409, "release_test_stale", "x"), kandidatStage)).toEqual([
            { key: "admin.umgebungen.releaseTest.error.stale" },
        ]);
        expect(abweisungVon(new ApiFailure(401, "passkey_rejected", "x"), null)).toBeNull();
        expect(abweisungVon(new Error("x"), null)).toBeNull();
    });

    type Anfrage = { url: string; methode: string };
    /** Ein Server: GET liefert nacheinander die Sichten (die letzte bleibt), POST antwortet fest. */
    function server(
        sichten: ReleaseTestSicht[],
        log: Anfrage[],
        post: { status: number; body: unknown } = { status: 200, body: { operationId: "x", status: "applied" } },
    ): typeof fetch {
        let gelesen = 0;
        return (async (url: RequestInfo | URL, init?: RequestInit) => {
            const methode = init?.method ?? "GET";
            log.push({ url: String(url), methode });
            if (methode === "POST")
                return new Response(JSON.stringify(post.body), {
                    status: post.status,
                    headers: { "content-type": "application/json" },
                });
            const antwort = sichten[Math.min(gelesen, sichten.length - 1)];
            gelesen += 1;
            return new Response(JSON.stringify(antwort), {
                status: 200,
                headers: { "content-type": "application/json" },
            });
        }) as typeof fetch;
    }

    it("🔴 vor dem Start liest die Karte den Stand frisch (?frisch=1); ist er derselbe, geht der Start raus", async () => {
        const log: Anfrage[] = [];
        const test = createReleaseTest({ fetcher: server([sicht()], log) });
        await test.laden();
        expect(await test.starten()).toBe(true);
        const urls = log.map((a) => `${a.methode} ${a.url}`);
        expect(urls[0]).toBe("GET /api/admin/system/release-test");
        expect(urls[1]).toBe("GET /api/admin/system/release-test?frisch=1");
        expect(urls[2]).toBe("POST /api/admin/system/release-test/starten");
        expect(test.abweisung.value).toEqual([]);
    });

    it("🔴 hat sich der Stand seit der Anzeige bewegt, startet NICHTS: Die Karte zeigt den neuen Stand und sagt es", async () => {
        const log: Anfrage[] = [];
        const alt = sicht({ kandidat: kandidatStage });
        const neu = sicht({ kandidat: { stage: { sha: AUFTRAG, zeit: "z2" }, auftrag: null } });
        const test = createReleaseTest({ fetcher: server([alt, neu], log) });
        await test.laden();
        expect(releaseTestKnopf(test.sicht.value).commit).toBe(STAGE);
        expect(await test.starten()).toBe(false);
        expect(log.some((a) => a.methode === "POST")).toBe(false);
        expect(releaseTestKnopf(test.sicht.value).commit).toBe(AUFTRAG);
        expect(test.abweisung.value).toEqual([
            { key: "admin.umgebungen.releaseTest.stageGewechselt", params: { sha: "bbbbbbb" } },
        ]);
        expect(test.busy.value).toBe(false);
    });

    it("geht der Knopf inzwischen nicht mehr (ein Test läuft schon), sagt die Karte den Grund, statt stumm nichts zu tun", async () => {
        const log: Anfrage[] = [];
        const laeuft = sicht({ lauf: lauf({ zustand: "laeuft", sha: AUFTRAG }) });
        const test = createReleaseTest({ fetcher: server([sicht(), laeuft], log) });
        await test.laden();
        expect(await test.starten()).toBe(false);
        expect(log.some((a) => a.methode === "POST")).toBe(false);
        expect(test.abweisung.value).toEqual([{ key: "admin.umgebungen.releaseTest.sperre.laeuft" }]);
    });

    it("🔴 weist der Server den Start ab (Sperre ohne Prozess), steht der Grund in der Abweisung und bleibt beim Nachladen stehen", async () => {
        const log: Anfrage[] = [];
        const test = createReleaseTest({
            fetcher: server([sicht()], log, {
                status: 409,
                body: {
                    error: { code: "release_test_sperre", message: "x", details: { grund: "Sperre ohne Prozess." } },
                },
            }),
        });
        await test.laden();
        expect(await test.starten()).toBe(false);
        expect(test.abweisung.value.map((satz) => satz.key)).toEqual([
            "admin.umgebungen.releaseTest.error.sperre",
            "admin.umgebungen.releaseTest.abgewiesenGrund",
        ]);
        // Die Karte lädt im Takt nach; die Abweisung bleibt, bis der nächste Versuch beginnt.
        await test.laden();
        await test.laden();
        expect(test.abweisung.value).toHaveLength(2);
    });

    it("🔴 der nächste Versuch räumt die alte Abweisung weg; ein gelungener Start endet mit der Quittung", async () => {
        const log: Anfrage[] = [];
        let post: { status: number; body: unknown } = {
            status: 409,
            body: { error: { code: "release_test_laeuft", message: "x" } },
        };
        const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => {
            const methode = init?.method ?? "GET";
            log.push({ url: String(url), methode });
            return new Response(JSON.stringify(methode === "POST" ? post.body : sicht()), {
                status: methode === "POST" ? post.status : 200,
                headers: { "content-type": "application/json" },
            });
        }) as typeof fetch;
        const test = createReleaseTest({ fetcher });
        await test.laden();
        expect(await test.starten()).toBe(false);
        expect(test.abweisung.value.length).toBeGreaterThan(0);
        post = { status: 200, body: { operationId: "x", status: "applied" } };
        expect(await test.starten()).toBe(true);
        expect(test.abweisung.value).toEqual([]);
        expect(test.versuch.value).toBeNull();
    });
});

describe("🔴 Ein Druck räumt die Karte (Vali 2026-10-25)", () => {
    const antwort = (body: unknown, status = 200): Response =>
        new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

    it("der Versuch ist offen, bis etwas läuft oder baut oder ein Start vorliegt, der nicht älter ist als er", () => {
        const versuch = Date.parse("2026-10-25T20:00:00Z");
        const start = (seit: string) => ({ commit: AUFTRAG, seit, zustand: "fehler" as const, grund: "x" });
        expect(versuchOffen(sicht(), null)).toBe(false);
        expect(versuchOffen(sicht(), versuch)).toBe(true);
        expect(versuchOffen(sicht({ start: start("2026-10-25T19:00:00Z") }), versuch)).toBe(true);
        expect(versuchOffen(sicht({ start: start("2026-10-25T20:00:01Z") }), versuch)).toBe(false);
        expect(versuchOffen(sicht({ lauf: lauf({ zustand: "laeuft", sha: AUFTRAG }) }), versuch)).toBe(false);
    });

    it("vom Druck bis zur Antwort steht der Versuch; eine Abweisung beendet ihn und trägt ihre Uhrzeit", async () => {
        let beimSenden: number | null = null;
        const zuletzt: { test?: ReturnType<typeof createReleaseTest> } = {};
        const fetcher = (async (_url: RequestInfo | URL, init?: RequestInit) => {
            if (init?.method !== "POST") return antwort(sicht());
            beimSenden = zuletzt.test?.versuch.value ?? null;
            return antwort({ error: { code: "release_test_laeuft", message: "x" } }, 409);
        }) as typeof fetch;
        const test = createReleaseTest({ fetcher, jetzt: () => 4_000 });
        zuletzt.test = test;
        await test.laden();
        expect(test.versuch.value).toBeNull();
        expect(await test.starten()).toBe(false);
        expect(beimSenden).toBe(4_000);
        expect(test.versuch.value).toBeNull();
        expect(test.abgewiesenAm.value).toBe(4_000);
    });

    it("🔴 „Starte Lauf …“ bis zur Quittung, danach der Auftrag (WI-0248: Starten reiht ein)", async () => {
        let gesendet = false;
        let beimSenden: number | null = null;
        const zuletzt: { test?: ReturnType<typeof createReleaseTest> } = {};
        const eingereiht = sicht({ auftrag: auftrag() });
        const fetcher = (async (_url: RequestInfo | URL, init?: RequestInit) => {
            if (init?.method !== "POST") return antwort(gesendet ? eingereiht : sicht());
            beimSenden = zuletzt.test?.versuch.value ?? null;
            gesendet = true;
            return antwort({ operationId: "x", status: "applied" });
        }) as typeof fetch;
        const test = createReleaseTest({ fetcher, jetzt: () => 7_000 });
        zuletzt.test = test;
        await test.laden();
        expect(await test.starten()).toBe(true);
        // Während des Sendens stand der Versuch; mit der Quittung ist er vorbei, und die Sicht trägt den Auftrag.
        expect(beimSenden).toBe(7_000);
        expect(test.versuch.value).toBeNull();
        expect(test.abgewiesenAm.value).toBeNull();
        expect(test.sicht.value?.auftrag).toMatchObject({ zustand: "wartet", platz: 2 });
        expect(releaseTestKnopf(test.sicht.value).sperre).toBe("eingereiht");
    });
});

describe("🔴 Der Zustand der Freigabe statt des Knopfes (WI-0248)", () => {
    it("sagt je Zustand, was aus der Freigabe wird; ohne Freigabe, wie eine entsteht", async () => {
        const { freigabeZustand } = await import("../src/freigabe/freigabe-zustand.ts");
        const f = (zustand: string) =>
            ({ commit: AUFTRAG, von: "Vali", zustand, grund: "Release-Test rot: Vitest: 1 rot" }) as never;
        expect(freigabeZustand(null).key).toBe("admin.umgebungen.freigabe.keine");
        expect(freigabeZustand(f("wartet"))).toMatchObject({ key: "admin.umgebungen.freigabe.wartet", ton: "" });
        expect(freigabeZustand(f("laeuft")).key).toBe("admin.umgebungen.freigabe.laeuft");
        expect(freigabeZustand(f("rot"))).toMatchObject({ key: "admin.umgebungen.freigabe.rot", ton: "rot" });
        expect(freigabeZustand(f("gruen"))).toMatchObject({ key: "admin.umgebungen.freigabe.gruen", ton: "gut" });
        expect(freigabeZustand(f("ausgeliefert"))).toMatchObject({
            key: "admin.umgebungen.freigabe.ausgeliefert",
            ton: "gut",
        });
        for (const z of ["abgebrochen", "fremd", "ungueltig"])
            expect(freigabeZustand(f(z))).toMatchObject({
                key: "admin.umgebungen.freigabe.nicht",
                params: { stand: "bbbbbbb" },
            });
        // Auf Lokal kommt sie aus dem Kandidaten (mit `sha` statt `commit`).
        expect(freigabeZustand({ sha: AUFTRAG, von: null, zustand: "abgebrochen", grund: "x" }).params).toMatchObject({
            wer: "–",
        });
        expect(t("admin.umgebungen.freigabe.gruen", { stand: "bbbbbbb", wer: "Vali" })).toBe(
            "Freigabe bbbbbbb von Vali: grün, geht von selbst nach Production",
        );
    });
});

describe("🔴 Schnelltest und Volltest (WI-0264)", () => {
    const freigabe = {
        sha: AUFTRAG,
        zeit: "z",
        kennung: "RT-00000000-0000-4000-8000-000000000001",
        von: "Vali",
        zustand: "gruen" as const,
        ausliefern: true,
        grund: "grün",
    };

    it("ein freigegebener grüner Stand sperrt nur den Schnelltest; laufend, eingereiht und startend sperren beide", () => {
        const k = { stage: { sha: AUFTRAG, zeit: "z" }, auftrag: null, freigabe };
        const gruen = sicht({ lauf: lauf({ zustand: "gruen", sha: AUFTRAG }), kandidat: k });
        expect(releaseTestKnopf(gruen).sperre).toBe("gruen");
        expect(releaseVolltestKnopf(gruen)).toEqual({ commit: AUFTRAG, sperre: null });
        expect(releaseVolltestKnopf(sicht({ lauf: lauf({ zustand: "laeuft", sha: AUFTRAG }) })).sperre).toBe("laeuft");
        expect(releaseVolltestKnopf(sicht({ auftrag: auftrag() })).sperre).toBe("eingereiht");
        expect(releaseVolltestKnopf(null).sperre).toBe("nicht_verfuegbar");
    });

    it("„Volltest“ schickt denselben Start mit `volltest: true`; der Schnelltest schickt ihn nicht", async () => {
        const log: { methode: string; body: Record<string, unknown> | undefined }[] = [];
        const fetcher = (async (_url: RequestInfo | URL, init?: RequestInit) => {
            const methode = init?.method ?? "GET";
            log.push({
                methode,
                body: init?.body === undefined ? undefined : (JSON.parse(String(init.body)) as Record<string, unknown>),
            });
            const body = methode === "POST" ? { operationId: "x", status: "applied" } : sicht();
            return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
        }) as typeof fetch;
        const test = createReleaseTest({ fetcher });
        await test.laden();
        expect(await test.volltest()).toBe(true);
        expect(await test.starten()).toBe(true);
        const posts = log.filter((a) => a.methode === "POST").map((a) => a.body);
        expect(posts[0]).toMatchObject({ commit: AUFTRAG, volltest: true });
        expect(posts[1]).not.toHaveProperty("volltest");
    });

    it("die Tafel und die Knöpfe haben ihre Sätze in allen Sprachen", () => {
        for (const tafel of [da, de, en, es, fr, italienisch, nl, pl, sv]) {
            for (const schluessel of [
                "admin.umgebungen.releaseTest.volltest",
                "admin.umgebungen.releaseTest.volltestHinweis",
                "admin.umgebungen.releaseTest.tafel.titel",
                "admin.umgebungen.releaseTest.tafel.gruenVoll",
            ] as const)
                expect(tafel[schluessel].length).toBeGreaterThan(0);
        }
        expect(de["admin.umgebungen.releaseTest.starten"]).toBe("Schnelltest");
        expect(de["admin.umgebungen.releaseTest.volltest"]).toBe("Volltest");
    });
});
