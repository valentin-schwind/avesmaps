import { describe, expect, it } from "vitest";
import type { FreigabeSicht, ReleaseTestLauf, ReleaseTestSicht, UmgebungenStand } from "@avesmaps3d/shared";
import { de } from "../src/i18n/de.ts";
import { en } from "../src/i18n/en.ts";
import {
    erhalteneReleases,
    leistenStaende,
    leistenUmgebung,
    lokalZustand,
    nachweisTon,
    nachweisVon,
    productionZustand,
    stagePruefungZustand,
    stageZustand,
    type LeistenEingabe,
} from "../src/freigabe/umgebungen-leiste.ts";

/**
 * Die Leiste „Lokal → Stage → Production“ (WI-0248): Was jede Umgebung über die drei Stationen und den Release-Nachweis weiß.
 *
 * 🔴 Problemfall, den diese Tests festhalten: Production zeigte „läuft“, ohne es zu wissen, und Lokal hatte gar keine Station. Was eine
 * Umgebung nicht weiß, steht als „nicht bekannt“ oder als Strich, nie als geratener Wert.
 */

const STAGE = "a7728a1".padEnd(40, "0");
const AUFTRAG = "b2ee1b3".padEnd(40, "0");

const sicht = (patch: Partial<FreigabeSicht> = {}): FreigabeSicht => ({
    now: "2026-10-24T08:00:00.000Z",
    datei: {
        schema: 1,
        standAt: "2026-10-24T07:59:00.000Z",
        production: { release: "b2ee1b3", commit: AUFTRAG, seit: "2026-10-18T00:17:00.000Z" },
        stage: { release: "a7728a1", commit: STAGE, seit: "2026-10-23T18:46:00.000Z" },
        stageGruen: true,
        stagePruefung: "Proben und Journal gruen",
        technik: { migrationen: [], rechte: [], umgebungswerte: [] },
        themen: [],
    },
    sperre: null,
    laeuft: null,
    frueher: [],
    ...patch,
});

const lauf = (patch: Partial<ReleaseTestLauf> = {}): ReleaseTestLauf => ({
    zustand: "keiner",
    fertigeTeile: [],
    sperre: false,
    jetzt: "2026-10-24T08:00:00.000Z",
    schritte: [],
    erwartetMs: 1,
    erwartetSchaetzung: false,
    fortschritt: 0,
    ...patch,
});

const test = (patch: Partial<ReleaseTestSicht> = {}): ReleaseTestSicht => ({
    now: "2026-10-24T08:00:00.000Z",
    verfuegbar: true,
    fehler: null,
    // WI-0248: Maßgeblich ist der aktuelle Stage-Stand; in diesen Fällen ist das der Stand der Läufe (`AUFTRAG`).
    kandidat: {
        stage: { sha: AUFTRAG, zeit: "2026-10-23T18:46:00Z" },
        auftrag: null,
    },
    lauf: lauf(),
    start: null,
    ...patch,
});

const ROUTE: UmgebungenStand = {
    eigene: { releaseId: "20261023T184600Z-a7728a1" },
    gegenseite: { releaseId: "20261018T001700Z-b2ee1b3", erreichbar: true },
    lokal: null,
};

const eingabe = (patch: Partial<LeistenEingabe>): LeistenEingabe => ({
    umgebung: "staging",
    sicht: sicht(),
    umgebungen: null,
    releaseTest: null,
    ...patch,
});

describe("Leiste: die Umgebung der Sitzung", () => {
    it("kennt die drei Umgebungen und sonst keine", () => {
        expect(leistenUmgebung("development")).toBe("development");
        expect(leistenUmgebung("staging")).toBe("staging");
        expect(leistenUmgebung("production")).toBe("production");
        expect(leistenUmgebung("test")).toBeNull();
        expect(leistenUmgebung(null)).toBeNull();
    });
});

describe("Leiste: die Stände der Stationen", () => {
    it("🔴 Lokal: der Stage-Stand kommt aus den Git-Notizen (Kandidat), Production bleibt ein Strich, nichts ist erreichbar gemeldet", () => {
        const { stage, production } = leistenStaende(
            eingabe({ umgebung: "development", sicht: null, releaseTest: test() }),
        );
        expect(stage).toEqual({
            stand: "b2ee1b3",
            release: "b2ee1b3",
            seit: "2026-10-23T18:46:00Z",
            gebaut: null,
            erreichbar: null,
        });
        expect(production).toEqual({ stand: null, release: null, seit: null, gebaut: null, erreichbar: null });
    });

    it("Lokal ohne Kandidat oder ohne Release-Test: beide Stationen sind Striche", () => {
        for (const releaseTest of [null, test({ kandidat: null })]) {
            const { stage, production } = leistenStaende(
                eingabe({ umgebung: "development", sicht: null, releaseTest }),
            );
            expect(stage.stand).toBeNull();
            expect(production.stand).toBeNull();
        }
    });

    it("Stage: Stand und Zeit aus Route und Datei; die eigene Station antwortet immer, die Gegenseite sagt es selbst", () => {
        const { stage, production } = leistenStaende(eingabe({ umgebungen: ROUTE }));
        expect(stage.stand).toBe("a7728a1");
        expect(stage.erreichbar).toBe(true);
        expect(stage.seit).toBe("2026-10-23T18:46:00.000Z");
        expect(production.stand).toBe("b2ee1b3");
        expect(production.erreichbar).toBe(true);
        const still = leistenStaende(
            eingabe({ umgebungen: { ...ROUTE, gegenseite: { releaseId: null, erreichbar: false } } }),
        );
        expect(still.production.erreichbar).toBe(false);
    });

    it("🔴 Stage ohne die Route (kein switch_environment): Production ist weder erreichbar noch unerreichbar gemeldet, aber ihr Stand steht in der Datei", () => {
        const { stage, production } = leistenStaende(eingabe({ umgebungen: null }));
        expect(stage.erreichbar).toBe(true);
        expect(production.erreichbar).toBeNull();
        expect(production.stand).toBe("b2ee1b3");
    });

    it("Production: ohne Datei trägt die Route beide Stände; die eigene Station antwortet immer", () => {
        const { stage, production } = leistenStaende(
            eingabe({
                umgebung: "production",
                sicht: sicht({ datei: null }),
                umgebungen: {
                    eigene: { releaseId: "20261018T001700Z-b2ee1b3" },
                    gegenseite: { releaseId: "20261023T184600Z-a7728a1", erreichbar: true },
                    lokal: null,
                },
            }),
        );
        expect(production.stand).toBe("b2ee1b3");
        expect(production.erreichbar).toBe(true);
        expect(stage.stand).toBe("a7728a1");
        expect(stage.erreichbar).toBe(true);
    });

    it("🔴 Production ohne Route (Nicht-Betreiber): kein Stand, kein „erreichbar“ für die Stage", () => {
        const { stage, production } = leistenStaende(
            eingabe({ umgebung: "production", sicht: sicht({ datei: null }), umgebungen: null }),
        );
        expect(stage).toEqual({ stand: null, release: null, seit: null, gebaut: null, erreichbar: null });
        expect(production.stand).toBeNull();
        expect(production.erreichbar).toBe(true);
    });
});

describe("Leiste: der Zustand einer Station", () => {
    const stage = (erreichbar: boolean | null) => ({
        stand: "a7728a1",
        release: "a7728a1",
        seit: null,
        gebaut: null,
        erreichbar,
    });

    it("🔴 die eigene Station antwortet: „erreichbar“, sofort, ohne Zeit und nie „noch nicht geprüft“ (Vali: „die stage weiß selbst nicht ob sie erreichbar ist“)", () => {
        const hier = stageZustand(stage(true), true);
        expect(hier).toEqual({ key: "admin.umgebungen.erreichbar", ton: "gut", fuellung: "voll" });
        expect(hier.params).toBeUndefined();
        // Auch wenn die Route nichts weiß (kein switch_environment): Die Seite kommt von dieser Umgebung.
        expect(stageZustand(stage(null), true).key).toBe("admin.umgebungen.erreichbar");
        expect(productionZustand(stage(true), null, false, null, true)).toEqual(hier);
        expect(productionZustand(stage(null), null, false, sicht().datei, true).key).toBe(
            "admin.umgebungen.erreichbar",
        );
        // Die Wörter stehen in beiden Tafeln, das Wort ohne Zeit.
        expect(de["admin.umgebungen.erreichbar"]).not.toContain("{ms}");
        expect(en["admin.umgebungen.erreichbar"]).not.toContain("{ms}");
    });

    it("Stage: die Gegenseite sagt, ob sie antwortet; weiß die Umgebung nichts, „nicht bekannt“", () => {
        expect(stageZustand(stage(false), false).key).toBe("admin.umgebungen.antwortetNicht");
        expect(stageZustand(stage(false), false).ton).toBe("rot");
        expect(stageZustand(stage(true), false).key).toBe("admin.umgebungen.prod.laeuft");
        const unbekannt = stageZustand(stage(null), false);
        expect(unbekannt.key).toBe("admin.umgebungen.unbekannt");
        expect(unbekannt.ton).toBe("leise");
        expect(unbekannt.fuellung).toBe("leer");
    });

    it("Stage: die Prüfung des Stands ist eine eigene Zeile aus der Statusdatei; ohne Datei weiß die Umgebung nichts", () => {
        expect(stagePruefungZustand(null)).toBeNull();
        expect(stagePruefungZustand(sicht().datei)?.key).toBe("admin.umgebungen.stage.gruen");
        const ungeprueft = { ...sicht().datei!, stageGruen: null };
        expect(stagePruefungZustand(ungeprueft)?.key).toBe("admin.umgebungen.stage.ungeprueft");
        expect(stagePruefungZustand({ ...ungeprueft, nachweis: "rot" })?.key).toBe("admin.umgebungen.stage.rot");
        expect(stagePruefungZustand({ ...ungeprueft, stageGruen: false })?.ton).toBe("rot");
    });

    it("🔴 Production: ohne Datei und ohne Antwort der Route steht „nicht bekannt“, nicht „läuft“", () => {
        expect(productionZustand(stage(null), null, false, null).key).toBe("admin.umgebungen.unbekannt");
        expect(productionZustand(stage(true), null, false, null).key).toBe("admin.umgebungen.prod.laeuft");
        expect(productionZustand(stage(false), null, false, null).key).toBe("admin.umgebungen.antwortetNicht");
        // Die Statusdatei kennt den Stand von Production; ohne Route (Nicht-Betreiber auf der Stage) bleibt es bei „läuft“.
        expect(productionZustand(stage(null), null, false, sicht().datei).key).toBe("admin.umgebungen.prod.laeuft");
    });

    it("Production: ein laufender Vorgang geht vor", () => {
        const freigabe = {
            ops: "OPS-000142",
            art: "release" as const,
            seit: "2026-10-24T07:00:00.000Z",
            offen: true,
            fortschritt: null,
        };
        expect(productionZustand(stage(true), freigabe, true, sicht().datei).key).toBe(
            "admin.umgebungen.prod.unterwegs",
        );
        const umschalten = {
            ...freigabe,
            fortschritt: {
                zustand: "laeuft" as const,
                phase: "umschalten" as const,
                fertig: [],
                beginn: "2026-10-24T07:00:00.000Z",
                phaseSeit: null,
                ende: null,
                fehlerCode: null,
                fehler: null,
            },
        };
        const z = productionZustand(stage(true), umschalten, true, sicht().datei);
        expect(z.key).toBe("admin.umgebungen.prod.startet");
        expect(z.fuellung).toBe("halb");
    });

    it("🔴 Lokal: auf Lokal selbst ist es erreichbar; ohne das Recht weiß die Ansicht nichts (keine geratene „keine Adresse“)", () => {
        const probe = { zustand: "ungeprueft", ms: null } as const;
        const adresse = { adresse: "https://rechner.tail0000.ts.net", imMenue: "erreichbar" } as const;
        expect(lokalZustand(true, true, null, probe)?.key).toBe("admin.umgebungen.erreichbar");
        // Auch ohne das Recht, die Adresse zu sehen: Die eigene Umgebung antwortet immer.
        expect(lokalZustand(true, false, null, probe)?.key).toBe("admin.umgebungen.erreichbar");
        expect(lokalZustand(false, false, null, probe)).toBeNull();
        expect(lokalZustand(false, true, null, probe)?.key).toBe("admin.umgebungen.lokal.ohneAdresse");
        expect(lokalZustand(false, true, adresse, probe)?.key).toBe("admin.umgebungen.lokal.ungeprueft");
        expect(lokalZustand(false, true, adresse, { zustand: "laeuft", ms: null })?.fuellung).toBe("halb");
        const ok = lokalZustand(false, true, adresse, { zustand: "ok", ms: 42 });
        expect(ok?.key).toBe("admin.umgebungen.lokal.erreichbar");
        expect(ok?.params).toEqual({ ms: 42 });
        expect(lokalZustand(false, true, adresse, { zustand: "nein", ms: null })?.ton).toBe("rot");
    });

    it("Lokal: die Zeit in ms steht nur, wenn die Probe sie gemessen hat", () => {
        const adresse = { adresse: "https://rechner.tail0000.ts.net", imMenue: "erreichbar" } as const;
        const ohneZeit = lokalZustand(false, true, adresse, { zustand: "ok", ms: null });
        expect(ohneZeit?.key).toBe("admin.umgebungen.erreichbar");
        expect(ohneZeit?.params).toBeUndefined();
        // Eine gemessene 0 ms ist eine Messung und bleibt stehen.
        expect(lokalZustand(false, true, adresse, { zustand: "ok", ms: 0 })?.params).toEqual({ ms: 0 });
    });
});

describe("Leiste: der Release-Nachweis unter dem Pfeil von Lokal zur Stage", () => {
    const lokal = (releaseTest: ReleaseTestSicht | null) =>
        nachweisVon(eingabe({ umgebung: "development", sicht: null, releaseTest }));

    it("🔴 Lokal ohne Lauf für den Stand: der Nachweis fehlt, und er nennt den Stand, der geprüft würde", () => {
        expect(lokal(test())).toEqual({ zustand: "fehlt", stand: "b2ee1b3", prozent: null });
        // Ohne Freigabe zählt der Stage-Stand.
        expect(
            lokal(test({ kandidat: { stage: { sha: STAGE, zeit: "2026-10-23T18:46:00Z" }, auftrag: null } })).stand,
        ).toBe("a7728a1");
    });

    it("Lokal: grün, rot und abgebrochen gelten nur für den Stand, zu dem der Lauf gehört", () => {
        for (const zustand of ["gruen", "rot", "abgebrochen"] as const) {
            expect(lokal(test({ lauf: lauf({ zustand, sha: AUFTRAG }) })).zustand).toBe(zustand);
        }
        // Ein grüner Lauf von gestern ist keine Antwort auf den Stand von heute.
        expect(lokal(test({ lauf: lauf({ zustand: "gruen", sha: STAGE }) })).zustand).toBe("fehlt");
    });

    it("Lokal: läuft der Test, steht der Fortschritt dabei; ein abgestürzter Lauf läuft nicht", () => {
        const laeuft = lokal(test({ lauf: lauf({ zustand: "laeuft", sha: AUFTRAG, lebt: true, fortschritt: 0.42 }) }));
        expect(laeuft).toEqual({ zustand: "laeuft", stand: "b2ee1b3", prozent: 42 });
        expect(
            lokal(test({ lauf: lauf({ zustand: "laeuft", sha: AUFTRAG, lebt: false, fortschritt: 0.42 }) })).zustand,
        ).toBe("abgebrochen");
    });

    it("Lokal: baut ein Start das Testpaket, läuft der Nachweis ohne Fortschritt; ein gescheiterter Start ist kein Nachweis", () => {
        const start = (zustand: "baut" | "fehler") => ({
            commit: AUFTRAG,
            seit: "2026-10-24T08:00:00Z",
            zustand,
            grund: null,
        });
        expect(lokal(test({ start: start("baut") }))).toEqual({ zustand: "laeuft", stand: "b2ee1b3", prozent: null });
        expect(lokal(test({ start: start("fehler") })).zustand).toBe("fehlt");
    });

    it("🔴 Lokal: ein Auftrag dieses Standes in der Warteschlange ist ein Nachweis in Arbeit, auch wenn er noch wartet (WI-0248)", () => {
        const auftrag = (commit: string) => ({
            id: "00000000-0000-4000-8000-000000000001",
            zustand: "wartet" as const,
            commit,
            wiederholen: false,
            seit: "2026-10-26T08:00:00Z",
            platz: 1,
            wartetAuf: null,
            grund: null,
            abbruch: false,
        });
        // Ein roter Lauf von früher zählt nicht mehr, solange der neue Auftrag wartet.
        const rot = lauf({ zustand: "rot", sha: AUFTRAG });
        expect(lokal(test({ lauf: rot, auftrag: auftrag(AUFTRAG) }))).toEqual({
            zustand: "laeuft",
            stand: "b2ee1b3",
            prozent: null,
        });
        // Ein Auftrag für einen anderen Stand ändert den Nachweis dieses Standes nicht.
        expect(lokal(test({ lauf: rot, auftrag: auftrag("c".repeat(40)) })).zustand).toBe("rot");
    });

    it("🔴 Lokal ohne Release-Test, mit nicht lesbarem Starter oder ohne Kandidat: nicht bekannt", () => {
        expect(lokal(null).zustand).toBeNull();
        expect(lokal(test({ verfuegbar: false, fehler: "x" })).zustand).toBeNull();
        expect(lokal(test({ kandidat: null })).zustand).toBeNull();
    });

    it("Stage: der Nachweis aus der Statusdatei; eine ältere Datei kennt das Feld nicht", () => {
        const mit = (nachweis: "fehlt" | "laeuft" | "gruen" | "rot") =>
            nachweisVon(eingabe({ sicht: sicht({ datei: { ...sicht().datei!, nachweis } }) }));
        expect(mit("gruen")).toEqual({ zustand: "gruen", stand: "a7728a1", prozent: null });
        expect(mit("fehlt").zustand).toBe("fehlt");
        expect(mit("laeuft").zustand).toBe("laeuft");
        expect(mit("rot").zustand).toBe("rot");
        expect(nachweisVon(eingabe({})).zustand).toBeNull();
        expect(nachweisVon(eingabe({ sicht: null })).zustand).toBeNull();
    });

    it("Production weiß nichts vom Nachweis", () => {
        expect(nachweisVon(eingabe({ umgebung: "production", sicht: sicht({ datei: null }) })).zustand).toBeNull();
    });

    it("jeder Zustand hat einen Ton", () => {
        expect(nachweisTon("gruen")).toBe("erfolg");
        expect(nachweisTon("rot")).toBe("gefahr");
        expect(nachweisTon("laeuft")).toBe("warnung");
        expect(nachweisTon("abgebrochen")).toBe("warnung");
        expect(nachweisTon("fehlt")).toBe("neutral");
    });
});

describe("Leiste: erhaltene Releases auf Production", () => {
    it("zählt Freigaben, keine Rückwege; ohne Kanal (Production) bleibt die Liste leer", () => {
        const frueher = [
            {
                ops: "OPS-000140",
                release: "b2ee1b3",
                at: "2026-10-18T00:17:00Z",
                wer: "Vali",
                art: "release" as const,
                themen: 0,
            },
            {
                ops: "OPS-000139",
                release: "5d1e9a2",
                at: "2026-10-17T20:00:00Z",
                wer: null,
                art: "rollback" as const,
                themen: 0,
            },
        ];
        expect(erhalteneReleases(sicht({ frueher })).map((lauf) => lauf.ops)).toEqual(["OPS-000140"]);
        expect(erhalteneReleases(sicht())).toEqual([]);
        expect(erhalteneReleases(null)).toEqual([]);
    });
});

describe("Leiste: die Texte stehen in der Tafel", () => {
    it("alle Schlüssel der Leiste gibt es auf Deutsch und Englisch", () => {
        for (const key of [
            "admin.umgebungen.leiste",
            "admin.umgebungen.unbekannt",
            "admin.umgebungen.abnahme",
            "admin.umgebungen.nachweis.fehlt",
            "admin.umgebungen.erhalten.titel",
            "admin.umgebungen.erhalten.unbekannt",
        ] as const) {
            expect(de[key]).not.toBe("");
            expect(en[key]).not.toBe("");
        }
    });
});
