import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import {
    FREIGABE_JOB_KIND,
    FREIGABE_NACHWEISE,
    FREIGABE_PHASEN,
    FreigabeDatei,
    FreigabeFortschritt,
    FreigabeStand,
    GRUNDLAGE,
    freigabeJobRef,
    phasenFuer,
    istGrundlagenPfad,
    istStillerPfad,
    sperreVon,
    themaVon,
} from "../src/system/freigabe.ts";

/**
 * Die Regel, was ein Thema ist (FREIGABE-0001 §1; Betreiber 2026-10-13 „alles wie empfohlen, ja“ auf E1 und E2).
 *
 * 🔴 Drei Sätze, und sie entscheiden, was die Betreiber in der Liste sehen:
 * 1. Was eine gemeinsame Grundlage anfasst, ist **Grundlage** — auch mit Paketnummer.
 * 2. Sonst entscheidet die Paketnummer der Commit-Zeile.
 * 3. Was kein Thema nennt, ist **Grundlage**; was nur Doku oder Tests anfasst, zählt gar nicht.
 */

describe("Freigabe: welchem Thema gehört ein Commit?", () => {
    it("🔴 eine Migration macht ihn zur Grundlage, obwohl er ein Paket nennt", () => {
        expect(themaVon("feat(WI-0068): Typbilder", ["apps/server/migrations/0113_media_type_image.sql"])).toBe(
            GRUNDLAGE,
        );
        expect(themaVon("feat(WI-0068): Typbilder", ["packages/shared/src/media.ts"])).toBe(GRUNDLAGE);
        expect(themaVon("feat(WI-0068): Typbilder", ["apps/web/src/i18n/de.ts"])).toBe(GRUNDLAGE);
    });

    it("sonst entscheidet die Paketnummer aus der Commit-Zeile", () => {
        expect(themaVon("feat(WI-0128 E12): Ort verschieben", ["apps/web/src/ortseditor/ortseditor.vue"])).toBe(
            "WI-0128",
        );
        expect(themaVon("fix(WI-0128): die Lasche", ["apps/web/src/map/panel.vue"])).toBe("WI-0128");
    });

    it("🔴 ein Commit ohne Paketnummer ist Grundlage — was kein Thema nennt, ist keins", () => {
        expect(themaVon("fix(besucher): Anwesenheit nach Sorte", ["apps/web/src/besuch/besuch.vue"])).toBe(GRUNDLAGE);
        expect(themaVon("production-buendel.sh: verständliche Liste", ["apps/server/src/jobs/worker.ts"])).toBe(
            GRUNDLAGE,
        );
    });

    it("🔴 reine Doku, Planung und Tests zählen nicht: sie reisen stillschweigend mit", () => {
        expect(themaVon("docs(WI-0128): Stand", ["project-control/work-items/WI-0128.md"])).toBeNull();
        expect(themaVon("test(WI-0128): drei Wächter", ["apps/server/test/places.test.ts"])).toBeNull();
        expect(themaVon("docs: Blatt", ["review/wi-0139/blatt.png", "docs/design/guide.md"])).toBeNull();
        expect(themaVon("feat(WI-0139): Fenster", ["apps/web/e2e/neuigkeiten-review.spec.ts"])).toBeNull();
    });

    it("ein Commit mit Doku UND Code zählt nach seinem Code", () => {
        expect(
            themaVon("feat(WI-0128 E12): Ort verschieben", [
                "project-control/work-items/WI-0128.md",
                "apps/web/src/ortseditor/ortseditor.vue",
            ]),
        ).toBe("WI-0128");
    });

    it("die beiden Pfadregeln für sich", () => {
        expect(istGrundlagenPfad("packages/shared/src/news.ts")).toBe(true);
        expect(istGrundlagenPfad("ops/deploy/auto-stage.sh")).toBe(true);
        expect(istGrundlagenPfad("apps/web/src/news/news.ts")).toBe(false);
        expect(istStillerPfad("apps/server/test/news.test.ts")).toBe(true);
        expect(istStillerPfad("apps/web/src/news/news.ts")).toBe(false);
        // 🪤 Ein Quellpfad, der „test“ nur im Namen trägt, ist kein Test.
        expect(istStillerPfad("apps/web/src/testwelt/testwelt.ts")).toBe(false);
    });
});

describe("Freigabe: steht der Weg nach Production offen?", () => {
    const datei = (patch: Partial<FreigabeDatei> = {}): FreigabeDatei => ({
        schema: 1,
        standAt: "2026-10-13T14:00:00.000Z",
        production: { release: "878c244", commit: "878c2440".padEnd(40, "0"), seit: "2026-10-12T21:22:00.000Z" },
        stage: { release: "e2f28dd", commit: "e2f28dd0".padEnd(40, "0"), seit: "2026-10-13T14:05:00.000Z" },
        stageGruen: true,
        stagePruefung: "Proben und Journal, 14:08",
        technik: { migrationen: ["0118", "0119"], rechte: [], umgebungswerte: ["KANAL"] },
        themen: [],
        ...patch,
    });

    it("offen, wenn die Stage grün und weiter als Production ist", () => {
        expect(sperreVon(datei(), false)).toBeNull();
    });

    it("🔴 gesperrt, solange die Stage nicht grün ist — ungeprüft geht nichts raus", () => {
        // 🔴 Zwei Lagen, zwei Sätze (Betreiber 2026-10-14): Er stand vor „Die Stage ist noch nicht grün geprüft“ und
        // konnte nicht sehen, ob etwas kaputt ist oder nur noch keine Prüfung gelaufen war. `false` ist geprüft und rot,
        // `null` heißt: Claudios Lauf hat noch nichts geschrieben.
        expect(sperreVon(datei({ stageGruen: false }), false)).toBe("stage_rot");
        expect(sperreVon(datei({ stageGruen: null }), false)).toBe("stage_ungeprueft");
    });

    it("gesperrt, wenn es nichts zu schieben gibt oder schon eine läuft", () => {
        const gleich = datei();
        expect(sperreVon({ ...gleich, stage: { ...gleich.stage, commit: gleich.production.commit } }, false)).toBe(
            "gleich",
        );
        expect(sperreVon(datei(), true)).toBe("laeuft");
    });

    it("ohne Statusdatei steht „nicht eingerichtet“ da, kein Fehler", () => {
        expect(sperreVon(null, false)).toBe("nicht_eingerichtet");
    });

    it("🔴 eine laufende Freigabe schlägt jede andere Sperre: erst fertig werden, dann weitersehen", () => {
        expect(sperreVon(datei({ stageGruen: false }), true)).toBe("laeuft");
    });

    /**
     * WI-0248: Im Nachtmodus IST das Freigeben die Kandidatenbenennung. Problemfall: `stageGruen` setzte Claudios Skript nur mit grünem
     * Release-Nachweis, den es ohne Knopfdruck nie gab; der Knopf blieb für immer zu. Jetzt genügen im Nachtmodus grüne Proben.
     */
    describe("im Nachtmodus (WI-0248)", () => {
        const nacht = (patch: Partial<FreigabeDatei> = {}): FreigabeDatei =>
            datei({ stageGruen: null, nachts: true, probenGruen: true, ...patch });

        it("🔴 grüne Proben öffnen den Knopf, auch ohne Release-Nachweis — gleich ob er fehlt, läuft oder schon grün ist", () => {
            expect(sperreVon(nacht(), false)).toBeNull();
            expect(sperreVon(nacht({ nachweis: "fehlt" }), false)).toBeNull();
            expect(sperreVon(nacht({ nachweis: "laeuft" }), false)).toBeNull();
            expect(sperreVon(nacht({ nachweis: "gruen" }), false)).toBeNull();
        });

        it("🔴 ein roter Release-Nachweis hält den Knopf zu und ist „geprüft und rot“", () => {
            expect(sperreVon(nacht({ nachweis: "rot" }), false)).toBe("stage_rot");
            expect(sperreVon(nacht({ stageGruen: false }), false)).toBe("stage_rot");
        });

        it("🔴 ohne grüne Proben bleibt es ungeprüft", () => {
            // Fehlt die Angabe ganz (eine ältere Datei oder ein Werkzeug ohne `--proben-gruen`), heißt das „nein“.
            const ohneAngabe: FreigabeDatei = nacht();
            delete ohneAngabe.probenGruen;
            expect(sperreVon(ohneAngabe, false)).toBe("stage_ungeprueft");
            expect(sperreVon(nacht({ probenGruen: false }), false)).toBe("stage_ungeprueft");
            expect(sperreVon(nacht({ probenGruen: false, nachweis: "gruen" }), false)).toBe("stage_ungeprueft");
        });

        it("🔴 ohne `nachts` schiebt der Knopf sofort — und das nur mit `stageGruen === true`", () => {
            for (const nachts of [{}, { nachts: false }]) {
                const roh = datei({ stageGruen: null, probenGruen: true, nachweis: "gruen", ...nachts });
                expect(sperreVon(roh, false)).toBe("stage_ungeprueft");
                expect(sperreVon({ ...roh, nachweis: "fehlt" }, false)).toBe("stage_ungeprueft");
                expect(sperreVon({ ...roh, nachweis: "rot" }, false)).toBe("stage_rot");
                expect(sperreVon({ ...roh, stageGruen: true }, false)).toBeNull();
            }
        });

        it("gleich und laufend gehen weiter vor", () => {
            const offen = nacht();
            expect(sperreVon({ ...offen, stage: { ...offen.stage, commit: offen.production.commit } }, false)).toBe(
                "gleich",
            );
            expect(sperreVon(offen, true)).toBe("laeuft");
        });

        it("🔴 die neuen Angaben sind optional (ältere Dateien bleiben lesbar) und der Nachweis kennt nur vier Werte", () => {
            expect(Value.Check(FreigabeDatei, datei())).toBe(true);
            expect(Value.Check(FreigabeDatei, nacht())).toBe(true);
            for (const nachweis of FREIGABE_NACHWEISE) {
                expect(Value.Check(FreigabeDatei, nacht({ nachweis }))).toBe(true);
            }
            expect(Value.Check(FreigabeDatei, { ...nacht(), nachweis: "vielleicht" })).toBe(false);
            expect(Value.Check(FreigabeDatei, { ...nacht(), probenGruen: "ja" })).toBe(false);
        });
    });
});

/**
 * 🔴 Der Weg auf den VPS ist zeilenweise: Claudios Abholer liest `avesmaps3d-corridor-probe freigabe-auftraege` Zeile für Zeile,
 * Felder mit `|` getrennt, und handelt bei der ersten Zeile, die wie ein Auftrag aussieht. Alles, was aus der Statusdatei in einen
 * Vorgangstitel wandert, ist damit ein Einschleusungsweg — gemeldet 2026-10-13 von der Sitzung „Ortseditor WI-0128 Abschluss“ für den
 * Anzeigenamen (dort schon durch `cleanDisplayName` geschlossen), hier für die Felder, die MIR gehören.
 *
 * Die Statusdatei kommt von einer anderen Maschine. Also wird sie geprüft, nicht geglaubt.
 */
describe("Freigabe: was aus der Statusdatei kommt, ist eine Kennung — kein Freitext", () => {
    const stand = { release: "e2f28dd", commit: "e2f28dd0a1b2c3d4e5f60718293a4b5c6d7e8f90", seit: null };

    it("🔴 ein Zeilenumbruch im Release wird abgelehnt — er wäre auf dem VPS eine zweite Auftragszeile", () => {
        const angriff = { ...stand, release: "x\n999999|release|x|t|t|-|x" };
        expect(Value.Check(FreigabeStand, angriff)).toBe(false);
        expect(Value.Check(FreigabeStand, { ...stand, release: "e2f|28dd" })).toBe(false);
        expect(Value.Check(FreigabeStand, { ...stand, release: "e2f28dd\r\n" })).toBe(false);
    });

    it("🔴 ein Commit ist hexadezimal und sonst nichts", () => {
        expect(Value.Check(FreigabeStand, stand)).toBe(true);
        expect(Value.Check(FreigabeStand, { ...stand, commit: "zzzz" })).toBe(false);
        expect(Value.Check(FreigabeStand, { ...stand, commit: "e2f28dd; rm -rf /" })).toBe(false);
        // Kurzform und volle Länge sind beide zulässig.
        expect(Value.Check(FreigabeStand, { ...stand, commit: "e2f28dd" })).toBe(true);
    });

    it("die Prüfzeile ist Text, aber ohne Steuerzeichen", () => {
        const datei = (pruefung: string): unknown => ({
            schema: 1,
            standAt: "2026-10-13T14:00:00.000Z",
            production: stand,
            stage: stand,
            stageGruen: true,
            stagePruefung: pruefung,
            technik: { migrationen: [], rechte: [], umgebungswerte: [] },
            themen: [],
        });
        expect(Value.Check(FreigabeDatei, datei("Proben und Journal, 14:08"))).toBe(true);
        expect(Value.Check(FreigabeDatei, datei("Proben\nund Journal"))).toBe(false);
    });
});

/**
 * Der Fortschritt eines Laufs (WI-0204): Die Phasen stehen EINMAL hier, damit Claudios Abholer, die Jobart, die Route und die Oberfläche
 * dieselben Namen benutzen (Handover `2026-10-16-umgebungen-fortschritt-an-claudio.md`).
 */
describe("Freigabe: der Fortschritt eines Laufs", () => {
    it("🔴 eine Freigabe läuft vom Abholen bis zu den Proben; der Rückweg danach nur, wenn die Proben rot sind", () => {
        expect(phasenFuer("release")).toEqual([
            "abgeholt",
            "vorbereiten",
            "migrieren",
            "rechte",
            "umschalten",
            "proben",
            "zurueck",
        ]);
        expect(phasenFuer("rollback")).toEqual(["abgeholt", "zurueck", "proben"]);
        // Jede Phase der beiden Abläufe kennt die Jobart, und keine darüber hinaus.
        expect(new Set([...phasenFuer("release"), ...phasenFuer("rollback")])).toEqual(new Set(FREIGABE_PHASEN));
    });

    it("der Ref ist genau die OPS-Kennung des Vorgangs", () => {
        expect(FREIGABE_JOB_KIND).toBe("production_freigabe");
        expect(freigabeJobRef("OPS-000030")).toBe("freigabe-OPS-000030");
    });

    it("der Vertrag nimmt einen gemeldeten Lauf an und eine fremde Phase oder einen Freitext als Kennung nicht", () => {
        const lauf = {
            zustand: "laeuft",
            phase: "migrieren",
            fertig: [
                { phase: "abgeholt", ms: 2000 },
                { phase: "vorbereiten", ms: null },
            ],
            beginn: "2026-10-16T19:00:00.000Z",
            phaseSeit: null,
            ende: null,
            fehlerCode: null,
            fehler: null,
        };
        expect(Value.Check(FreigabeFortschritt, lauf)).toBe(true);
        expect(Value.Check(FreigabeFortschritt, { ...lauf, phase: "tanzen" })).toBe(false);
        expect(Value.Check(FreigabeFortschritt, { ...lauf, fehlerCode: "Rot | erfunden" })).toBe(false);
    });
});
