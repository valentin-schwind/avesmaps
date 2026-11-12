import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { ABGLEICH_JOBARTEN, abgleichKreis } from "@avesmaps3d/shared";
import { abgleicheModes, ausfuehrungFuer, pickupJobKinds, skippedJobKinds } from "../src/abgleiche/ausfuehrung.ts";
import { loadConfig } from "../src/config.ts";
import { FreigabeFehler, freigabeAus } from "../src/abgleiche/freigabe.ts";
import { runLegacyMediaJob, runLegacyPullJob, toolFile, type AbgleichDeps } from "../src/abgleiche/job.ts";
import { entfalleneSchritte, ergebnisZeile, leseMeldung, phaseZeile, zugAnteil } from "../src/abgleiche/protokoll.ts";
import { PIPELINE_STEPS } from "../src/migration/pipeline-steps.ts";
import { isEditorJob } from "../src/jobs/editor-freeze.ts";
import { JOB_HANDLERS, JobCancelled, JobFailure, type JobContext } from "../src/jobs/handlers.ts";
import { JOB_KIND_CATALOG } from "../src/jobs/kinds.ts";

/**
 * Die Abgleiche ohne Datenbank (WI-0127 SYS-14): Freigabe der Werkzeuge (`--auftrag` neben `--operator-said`), die Meldungen eines
 * Werkzeugs an seinen Auftrag, der Schalter `ABGLEICHE`, der Kreis, und die zwei Handler mit einem nachgebauten Werkzeugprozess:
 * Phasen, Ergebnis, Fehler mit der Abbruchzeile, Abbruch an der Phasengrenze beendet den Prozess.
 */

const AUFTRAG = "2f1c9a4e-7b3d-4e5f-8a6b-1c2d3e4f5a6b";

describe("Freigabe der Werkzeuge", () => {
    it("der Zuruf bleibt wie bisher: Zitat wörtlich, eingespielt", () => {
        expect(freigabeAus({ "operator-said": "zieh mal" })).toEqual({
            apply: true,
            zeile: "Freigabe (Betreiberzitat): „zieh mal“",
            kurz: "zieh mal",
            auftrag: null,
        });
    });

    it("ein Auftrag aus der Verwaltung spielt ein und nennt nur die Kennung, keinen Namen", () => {
        const freigabe = freigabeAus({ auftrag: AUFTRAG });
        expect(freigabe.apply).toBe(true);
        expect(freigabe.auftrag).toBe(AUFTRAG);
        expect(freigabe.zeile).toContain(AUFTRAG);
        expect(freigabe.zeile).toContain("Verwaltung");
        expect(freigabe.zeile).not.toContain("Betreiberzitat");
    });

    it("beides zugleich und eine kaputte Kennung sind Aufruffehler", () => {
        expect(() => freigabeAus({ "operator-said": "zieh mal", auftrag: AUFTRAG })).toThrow(FreigabeFehler);
        expect(() => freigabeAus({ auftrag: "kein-job" })).toThrow(FreigabeFehler);
    });

    it("ohne beides wird nur gerechnet", () => {
        expect(freigabeAus({})).toEqual({ apply: false, zeile: null, kurz: null, auftrag: null });
    });
});

describe("Meldungen eines Werkzeugs an seinen Auftrag", () => {
    it("Phase und Ergebnis gehen hin und zurück", () => {
        expect(leseMeldung(phaseZeile("I11"))).toEqual({ art: "phase", phase: "I11" });
        expect(leseMeldung(ergebnisZeile({ luecken: ["I24"], befunde: 3, satz: "map1-eco2-live" }))).toEqual({
            art: "ergebnis",
            ergebnis: { luecken: ["I24"], befunde: 3, satz: "map1-eco2-live" },
        });
    });

    it("eine gewöhnliche oder kaputte Zeile ist keine Meldung", () => {
        expect(leseMeldung("✅ I1 Orte: 4.092 neu")).toBeNull();
        expect(leseMeldung("::abgleich-ergebnis {kaputt")).toBeNull();
        expect(leseMeldung("::abgleich-phase ; rm -rf /")).toBeNull();
        expect(() => phaseZeile("I 11")).toThrow();
    });

    it("entfallene Schritte: „uebersprungen“ am Anfang oder „entfaellt“ im Satz, sonst nicht", () => {
        expect(
            entfalleneSchritte([
                { id: "I1", summary: "4092 neu" },
                {
                    id: "I20",
                    label: "Spielliteratur",
                    summary: "uebersprungen: kein Katalog geholt, nichts geschrieben",
                },
                { id: "I24", summary: "1200 Linkziele; Zuordnung (X2) entfaellt" },
                { id: "I26", summary: "übersprungen: das Manifest ist unbrauchbar" },
                { id: "I20", label: "Spielliteratur", summary: "uebersprungen: zweiter Lauf" },
            ]),
        ).toEqual(["I20 Spielliteratur", "I24", "I26"]);
    });
});

describe("Grober Fortschritt des Zugs (Betreiber 2026-10-10: „grob reicht, einfach ein fortschrittsbalken“)", () => {
    it("🔴 steigt mit jedem Schritt, der erste Lauf bis 80 %, der zweite bis 100 %; Unbekanntes ohne Angabe", () => {
        const erster = PIPELINE_STEPS.map((step) => zugAnteil(step.id, false) as number);
        const zweiter = PIPELINE_STEPS.map((step) => zugAnteil(step.id, true) as number);
        const alle = [...erster, ...zweiter];
        expect(alle.every((anteil, i) => i === 0 || anteil > (alle[i - 1] as number))).toBe(true);
        expect(erster[0]).toBe(0.05);
        expect(Math.max(...erster)).toBeLessThan(0.8);
        expect(zweiter[0]).toBe(0.8);
        expect(Math.max(...zweiter)).toBeLessThan(1);
        expect(zugAnteil("gibt-es-nicht", false)).toBeNull();
    });
});

describe("Schalter ABGLEICHE, Kreis, Halt unter Sperre, Katalog", () => {
    /**
     * Ein erwarteter Stand: der ganze Zug, die drei Kategoriezeilen (sie folgen ihm), die Medien und der Production-Zug.
     * Letzterer ist `verborgen`, solange der Wert ihn nicht nennt (WI-0144) — so bleibt Production unverändert.
     */
    const zug = (ganz: string, kategorie: string, medien: string, production = "verborgen") => ({
        legacy: ganz,
        legacy_landschaften: kategorie,
        legacy_wege: kategorie,
        legacy_orte: kategorie,
        medien,
        production,
    });
    it("ohne Wert lokal worker, mit Release aus; ein Tippfehler hält den Start an", () => {
        // 🪤 Die drei Kategoriezeilen (WI-0141) hängen allein an `legacy:kategorien`; jeder andere Wert lässt sie aus.
        const alle = (mode: string) => zug(mode, mode === "aus" ? "aus" : "aus", mode);
        expect(abgleicheModes({})).toEqual(alle("worker"));
        expect(abgleicheModes({ RELEASE_ID: "dev" })).toEqual(alle("worker"));
        expect(abgleicheModes({ RELEASE_ID: "20261011T120000Z-abc" })).toEqual(alle("aus"));
        expect(abgleicheModes({ RELEASE_ID: "20261011T120000Z-abc", ABGLEICHE: "worker" })).toEqual(alle("worker"));
        expect(abgleicheModes({ ABGLEICHE: "aus" })).toEqual(alle("aus"));
        expect(abgleicheModes({ ABGLEICHE: "korridor" })).toEqual(alle("korridor"));
        expect(() => abgleicheModes({ ABGLEICHE: "korridorr" })).toThrow(/ABGLEICHE/);
    });

    it("🔴 je Quelle (Stage, Option A): legacy:korridor,medien:aus; eine nicht genannte Quelle ist aus", () => {
        expect(abgleicheModes({ ABGLEICHE: "legacy:korridor,medien:aus" })).toEqual(zug("korridor", "aus", "aus"));
        expect(abgleicheModes({ ABGLEICHE: "legacy:korridor" })).toEqual(zug("korridor", "aus", "aus"));
        expect(abgleicheModes({ ABGLEICHE: " legacy : worker , medien : korridor " })).toEqual(
            zug("worker", "aus", "korridor"),
        );
        expect(() => abgleicheModes({ ABGLEICHE: "wiki:korridor" })).toThrow(/ABGLEICHE/);
        expect(() => abgleicheModes({ ABGLEICHE: "legacy:zug" })).toThrow(/ABGLEICHE/);
        expect(ausfuehrungFuer(abgleicheModes({ ABGLEICHE: "legacy:korridor,medien:aus" }), "medien")).toBe("aus");
        expect(ausfuehrungFuer("worker", "medien")).toBe("worker");
        expect(ausfuehrungFuer(undefined, "legacy")).toBe("aus");
    });

    it("🔴 Production: ABGLEICHE=legacy:kategorien sperrt den ganzen Zug und öffnet die drei Kategorien (WI-0141)", () => {
        // Betreiber 2026-10-13: „jede kategorie einzeln (also unterkategorien ohne dass man alles ziehen darf)“.
        // Mit einem Release holt Claudios Abholer sie ab, lokal rechnet sie der Worker (wie jede andere Art).
        expect(
            abgleicheModes({ RELEASE_ID: "20261013T120000Z-abc", ABGLEICHE: "legacy:kategorien,medien:aus" }),
        ).toEqual(zug("aus", "korridor", "aus"));
        expect(abgleicheModes({ ABGLEICHE: "legacy:kategorien,medien:aus" })).toEqual(zug("aus", "worker", "aus"));
        // `kategorien` ist eine Aussage über den Zug: nicht für alle Quellen zugleich, nicht für die Medien.
        expect(() => abgleicheModes({ ABGLEICHE: "kategorien" })).toThrow(/kategorien/);
        expect(() => abgleicheModes({ ABGLEICHE: "medien:kategorien" })).toThrow(/kategorien/);
        // Eine Kategoriezeile wird nie einzeln gesetzt: sie folgt der Quelle `legacy`, sonst gäbe es zwei Schalter.
        expect(() => abgleicheModes({ ABGLEICHE: "legacy_orte:korridor" })).toThrow(/legacy_orte/);
    });

    it("🔴 Kategorien einzeln öffnen: kategorien=wege+orte sperrt Landschaften mit eigenem Zustand (WI-0141)", () => {
        // Claudio 2026-10-13: Der erste Knopfdruck auf „Landschaften“ antwortete erst NACH dem Druck „geht noch nicht“.
        // Betreiberregel: „knöpfe dürfen nichts versprechen, was sie nicht halten können“.
        const prod = abgleicheModes({ RELEASE_ID: "r", ABGLEICHE: "legacy:kategorien=wege+orte,medien:aus" });
        expect(prod).toEqual({
            legacy: "aus",
            legacy_landschaften: "noch_nicht",
            legacy_wege: "korridor",
            legacy_orte: "korridor",
            medien: "aus",
            production: "verborgen",
        });
        // 🪤 `noch_nicht` ist NICHT `aus`: Der Worker lässt die Art liegen, holt sie aber auch nicht ab.
        expect([...pickupJobKinds(prod)]).toEqual(["legacy_zug"]);
        // Ohne Liste bleiben alle drei offen, wie bisher.
        expect(abgleicheModes({ RELEASE_ID: "r", ABGLEICHE: "legacy:kategorien" })).toEqual(
            zug("aus", "korridor", "aus"),
        );
        // Ein Tippfehler in der Liste haelt den Start an, statt still einen Knopf zu sperren.
        expect(() => abgleicheModes({ ABGLEICHE: "legacy:kategorien=wege+gipfel" })).toThrow(/gipfel/);
        expect(() => abgleicheModes({ ABGLEICHE: "legacy:kategorien=" })).toThrow(/ohne Kategorie/);
        expect(() => abgleicheModes({ ABGLEICHE: "legacy:korridor=wege" })).toThrow(/Kategorieliste/);
        // Und niemand setzt `noch_nicht` selbst: Es entsteht nur aus der Liste.
        expect(() => abgleicheModes({ ABGLEICHE: "legacy:noch_nicht" })).toThrow(/noch_nicht/);
    });

    it("🔴 Stage: ABGLEICHE=production:korridor zeigt NUR den Production-Zug (WI-0144)", () => {
        // Betreiber 2026-10-14: „abgleichen kann ich nur auf der stage nur von production - für die stage ist production die
        // einzige wahrheit. d.h. unter "Abgleiche" darf auf der Stage nur "Production-Zug" stehen.“
        // Deshalb leitet der eine Wert die übrigen Zeilen ab, statt drei Werte zu verlangen, die auseinanderlaufen können.
        const stage = abgleicheModes({ RELEASE_ID: "20261014T120000Z-abc", ABGLEICHE: "production:korridor" });
        expect(stage).toEqual(zug("verborgen", "verborgen", "verborgen", "korridor"));
        // Auch wenn jemand die Legacy-Zeilen ausdrücklich dazuschreibt: Production gewinnt, sonst wäre die Regel nur halb.
        expect(abgleicheModes({ RELEASE_ID: "r", ABGLEICHE: "production:korridor,legacy:korridor" })).toEqual(
            zug("verborgen", "verborgen", "verborgen", "korridor"),
        );
        // 🔴 Ungenannt heisst verborgen — Production und jede andere Umgebung bleiben, wie sie sind.
        expect(abgleicheModes({ RELEASE_ID: "r", ABGLEICHE: "legacy:kategorien,medien:aus" }).production).toBe(
            "verborgen",
        );
        expect(abgleicheModes({ ABGLEICHE: "korridor" }).production).toBe("verborgen");
        expect(abgleicheModes({}).production).toBe("verborgen");
        // Ausdrücklich verborgen oder aus bleibt erlaubt; ein Worker kann Production nicht lesen.
        expect(abgleicheModes({ RELEASE_ID: "r", ABGLEICHE: "production:verborgen" }).production).toBe("verborgen");
        expect(abgleicheModes({ RELEASE_ID: "r", ABGLEICHE: "production:aus" }).production).toBe("aus");
        expect(() => abgleicheModes({ ABGLEICHE: "production:worker" })).toThrow(/nur über den Korridor/u);
        expect(() => abgleicheModes({ ABGLEICHE: "production:kategorien" })).toThrow(/kategorien/u);
        // Der Abholer holt genau diese Art ab; kein Worker nimmt sie an.
        expect([...pickupJobKinds(stage)]).toEqual(["production_pull"]);
        expect([...skippedJobKinds(stage)].sort()).toEqual([
            "legacy_media",
            "legacy_pull",
            "legacy_zug",
            "production_pull",
        ]);
    });

    it("🔴 MAP_EDITING startet mit jedem Zug: production:korridor (WI-0144) und legacy:kategorien (Betreiber 2026-10-15)", () => {
        // Die frühere Startsperre `zugUndEditorNichtZugleich` ist gefallen: „Auch auf avesmaps.de soll man Orte bearbeiten
        // können“ (Betreiber 2026-10-15). Beide Umgebungen starten mit dem Editor.
        expect(
            loadConfig({ RELEASE_ID: "r", MAP_EDITING: "testwelt", ABGLEICHE: "production:korridor" }).mapEditing,
        ).toBe("testwelt");
        expect(
            loadConfig({ RELEASE_ID: "r", MAP_EDITING: "testwelt", ABGLEICHE: "legacy:kategorien" }).mapEditing,
        ).toBe("testwelt");
    });

    it("ein Worker ohne Ausführung lässt genau die drei Arten liegen; den Abholer-Arten schreibt er den Wartegrund", () => {
        const aus = abgleicheModes({ RELEASE_ID: "r", ABGLEICHE: "aus" });
        expect([...skippedJobKinds(aus)].sort()).toEqual([
            "legacy_media",
            "legacy_pull",
            "legacy_zug",
            "production_pull",
        ]);
        // Lokal rechnet der Worker den ganzen Zug und die Medien; die Kategorien bleiben aus, bis jemand sie schaltet,
        // und der Production-Zug ist verborgen (ihn rechnet nie ein Worker).
        expect([...skippedJobKinds(abgleicheModes({ ABGLEICHE: "worker" }))].sort()).toEqual([
            "legacy_zug",
            "production_pull",
        ]);
        const stage = abgleicheModes({ RELEASE_ID: "r", ABGLEICHE: "legacy:korridor,medien:aus" });
        expect([...skippedJobKinds(stage)].sort()).toEqual([
            "legacy_media",
            "legacy_pull",
            "legacy_zug",
            "production_pull",
        ]);
        expect([...pickupJobKinds(stage)].sort()).toEqual(["legacy_pull"]);
        // Production: der ganze Zug ist aus, die Kategorien holt der Abholer ab.
        const prod = abgleicheModes({ RELEASE_ID: "r", ABGLEICHE: "legacy:kategorien,medien:aus" });
        expect([...pickupJobKinds(prod)]).toEqual(["legacy_zug"]);
    });

    it("der Kreis: voll vollständig, halb mit Lücke, leer nie, gescheitert oder abgebrochen", () => {
        expect(abgleichKreis(null)).toBe("leer");
        expect(abgleichKreis({ state: "SUCCEEDED", luecken: [] })).toBe("voll");
        expect(abgleichKreis({ state: "SUCCEEDED", luecken: null })).toBe("voll");
        expect(abgleichKreis({ state: "SUCCEEDED", luecken: ["I24"] })).toBe("halb");
        expect(abgleichKreis({ state: "FAILED", luecken: null })).toBe("leer");
        expect(abgleichKreis({ state: "CANCELLED", luecken: [] })).toBe("leer");
    });

    it("🔴 ein Auftrag der Abgleiche trägt die Person, wartet unter Kartensperre aber nicht (Betreiber 2026-10-10, Frage 3)", () => {
        const person = "7e570000-0000-4000-8000-000000000001";
        expect(isEditorJob(person, "legacy_pull")).toBe(false);
        expect(isEditorJob(person, "legacy_media")).toBe(false);
        expect(isEditorJob(person, "media_settle")).toBe(true);
        expect(isEditorJob(person)).toBe(true);
    });

    it("jede Jobart der Abgleiche steht im Katalog, läuft allein und hält die Domäne nicht", () => {
        for (const kind of Object.values(ABGLEICH_JOBARTEN)) {
            const spec = JOB_KIND_CATALOG[kind];
            expect(spec?.origin).toBe("queued");
            expect(spec?.threads).toBeNull();
            expect(spec?.holdsSharedDomainLock).toBe(false);
        }
        expect(JOB_KIND_CATALOG["legacy_pull"]?.memoryKey({}, "I11")).toBe("terrain_full");
    });

    it("🔴 einen Handler haben alle ausser dem Production-Zug — den rechnet nur der Korridor (WI-0144)", () => {
        // Production zu lesen hat der Server keinen Weg und soll keinen bekommen. Darum gibt es hier keinen Handler; ein
        // verirrter Auftrag endet sauber mit `unknown_kind` (`jobs/child.ts`), und `ABGLEICHE` lässt `production:worker` nicht zu.
        const ohneHandler = Object.values(ABGLEICH_JOBARTEN).filter((kind) => JOB_HANDLERS[kind] === undefined);
        expect([...new Set(ohneHandler)]).toEqual(["production_pull"]);
        expect(() => abgleicheModes({ ABGLEICHE: "production:worker" })).toThrow(/Korridor/u);
    });

    it("die Werkzeuge liegen dort, wo der Handler sie startet", async () => {
        for (const name of ["legacy-update-cli", "media-cli", "media-fetch-cli", "media-files-cli"]) {
            await expect(readFile(toolFile(name), "utf8")).resolves.toMatch(/auftrag: \{ type: "string" \}/);
        }
    });
});

/**
 * 🔴 Der Vertrag mit Claudios Korridor (WI-0127 SYS-14c, Befund `handovers/2026-10-10-abgleiche-detailwerkzeuge-auftrag.md`): Auf Stage
 * ruft `ops/deploy/staging-import.sh` die Detailschritte einzeln auf und reicht die Freigabe als `"${ATTEST[@]}"` durch, also
 * `--operator-said "<Zitat>"` oder `--auftrag <Job>`. Jedes so aufgerufene Werkzeug muss beides kennen; sonst bräche ein Knopf-Zug bei I17
 * ab. Die Liste kommt aus dem Skript selbst: Ein neuer Detailschritt dort ohne `--auftrag` hier lässt den Test fallen.
 *
 * Dasselbe gilt für den Zug je Kategorie (`ops/deploy/kategorie-import.sh`, Stage und Production): Der Orte-Zug reicht die Freigabe an
 * I27 und I28 durch (WI-0199). Kennt ein Werkzeug `--auftrag` nicht, überspringt Claudios Läufer es beim Knopf mit einem Befund.
 */
describe("Detailwerkzeuge im Korridor (Stage)", () => {
    const staging = join(import.meta.dirname, "../../../ops/deploy/staging-import.sh");
    const kategorie = join(import.meta.dirname, "../../../ops/deploy/kategorie-import.sh");
    const korridorWerkzeuge = async (): Promise<string[]> => {
        const text = (await readFile(staging, "utf8")) + (await readFile(kategorie, "utf8"));
        const names = [
            ...text.matchAll(/apps\/server\/dist\/migration\/([a-z-]+-cli)\.js[^\n]*"\$\{ATTEST\[@\]\}"/gu),
        ].map((match) => match[1]!);
        return [...new Set(names)];
    };

    it("🔴 jedes Werkzeug, dem der Korridor die Freigabe durchreicht, nimmt --auftrag über abgleiche/freigabe.ts", async () => {
        const names = await korridorWerkzeuge();
        expect(names.length).toBeGreaterThanOrEqual(10);
        const ohne: string[] = [];
        for (const name of names) {
            const source = await readFile(toolFile(name), "utf8");
            if (!/auftrag: \{ type: "string" \}/u.test(source) || !source.includes("freigabeOderEnde("))
                ohne.push(name);
        }
        expect(ohne).toEqual([]);
        // Claudios `detail_cli` erkennt die Freigabe am Anfang der Zeile; die Zeile kommt aus `freigabeAus`.
        const text = await readFile(staging, "utf8");
        const zeile = freigabeAus({ auftrag: AUFTRAG }).zeile!;
        expect(text).toContain("^Freigabe (Auftrag aus der Verwaltung");
        expect(zeile.startsWith("Freigabe (Auftrag aus der Verwaltung")).toBe(true);
    });

    it("beide Freigaben zugleich enden mit Exit 2 und dem Satz, bevor etwas gelesen oder verbunden wird", async () => {
        const names = await korridorWerkzeuge();
        const results = await Promise.all(
            names.map(
                (name) =>
                    new Promise<{ name: string; code: number | null; stderr: string }>((resolve) => {
                        const child = spawn(
                            process.execPath,
                            [
                                toolFile(name),
                                // Die Pflichtangaben je Werkzeug (`parseArgs` ist streng: eine fremde Option endet mit Exit 1).
                                ...(name === "wiki-link-targets-cli"
                                    ? ["--zuordnung", "fehlt.json", "--linkziele", "fehlt.json"]
                                    : ["--source", "fehlt.json"]),
                                "--operator-said",
                                "zieh mal",
                                "--auftrag",
                                AUFTRAG,
                            ],
                            {
                                env: { ...process.env, DATABASE_URL: "postgres://niemand@127.0.0.1:1/keine" },
                                stdio: ["ignore", "ignore", "pipe"],
                            },
                        );
                        let stderr = "";
                        child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
                        child.on("close", (code) => resolve({ name, code, stderr }));
                    }),
            ),
        );
        for (const result of results) {
            expect([result.name, result.code, result.stderr.includes("schließen sich aus")]).toEqual([
                result.name,
                2,
                true,
            ]);
        }
    }, 120_000);
});

/** Ein nachgebauter Werkzeugprozess: schreibt die Zeilen, endet mit `code`; `kill()` beendet ihn sofort. */
function fakeTool(lines: readonly string[], code: number): { child: ChildProcess; killed: () => boolean } {
    const emitter = new EventEmitter() as ChildProcess & EventEmitter;
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    let killed = false;
    let closed = false;
    const close = (exit: number | null): void => {
        if (closed) return;
        closed = true;
        stdout.end();
        stderr.end();
        setImmediate(() => emitter.emit("close", exit));
    };
    Object.assign(emitter, {
        stdout,
        stderr,
        kill: () => {
            killed = true;
            close(null);
            return true;
        },
    });
    void (async () => {
        for (const line of lines) {
            if (closed) return;
            stdout.write(`${line}\n`);
            await new Promise((resolve) => setImmediate(resolve));
        }
        close(code);
    })();
    return { child: emitter, killed: () => killed };
}

interface Recorded {
    phases: { name: string; progress: number | null | undefined }[];
}

function context(options: { cancelAt?: string } = {}): JobContext & Recorded {
    const phases: Recorded["phases"] = [];
    return {
        input: {},
        attempt: 1,
        job: { id: 1, publicId: AUFTRAG, leaseNo: 1, mapDomainId: "aventuria" },
        phases,
        beginPhase: async (name, progress) => {
            if (name === options.cancelAt) throw new JobCancelled();
            phases.push({ name, progress });
        },
        checkpoint: () => undefined,
    };
}

describe("Handler des Legacy-Zugs", () => {
    it("startet das Werkzeug mit --auftrag, meldet Phasen samt zweitem Lauf und nimmt das Ergebnis", async () => {
        const started: { file: string; args: readonly string[] }[] = [];
        const log: string[] = [];
        const deps: AbgleichDeps = {
            spawnTool: (file, args) => {
                started.push({ file, args });
                return fakeTool(
                    [
                        "→ hole map-features.json live",
                        phaseZeile("I1"),
                        "✅ I1 Orte: 12 geändert",
                        phaseZeile("I2"),
                        phaseZeile("zweiter-lauf"),
                        phaseZeile("I1"),
                        ergebnisZeile({ luecken: ["I24"], befunde: 4, satz: "map1-eco2-live20261011t1405z" }),
                    ],
                    0,
                ).child;
            },
            log: (line) => log.push(line),
        };
        const job = context();
        const result = await runLegacyPullJob(job, deps);
        expect(started).toEqual([{ file: toolFile("legacy-update-cli"), args: ["--auftrag", AUFTRAG] }]);
        expect(job.phases.map((phase) => phase.name)).toEqual(["holen", "I1", "I2", "zweiter-lauf", "2-I1"]);
        // Der Balken wächst: dieselbe Formel wie beim Zuruf (`zugAnteil`).
        expect(job.phases.map((phase) => phase.progress)).toEqual([
            0,
            zugAnteil("I1", false),
            zugAnteil("I2", false),
            0.8,
            zugAnteil("I1", true),
        ]);
        expect(
            job.phases.every((phase) => phase.progress == null || (phase.progress >= 0 && phase.progress <= 1)),
        ).toBe(true);
        expect(result).toEqual({ luecken: ["I24"], befunde: 4, satz: "map1-eco2-live20261011t1405z" });
        // Die Meldungen gehen nicht ins Journal, alles andere unverändert.
        expect(log).toEqual(["→ hole map-features.json live", "✅ I1 Orte: 12 geändert"]);
    });

    it("scheitert das Werkzeug, endet der Auftrag ohne Wiederholung mit seiner Abbruchzeile", async () => {
        const deps: AbgleichDeps = {
            spawnTool: () =>
                fakeTool(
                    [phaseZeile("I1"), "❌ abgebrochen: https://avesmaps.de/api/app/map-features.php: HTTP 503"],
                    1,
                ).child,
            log: () => undefined,
        };
        const failure = await runLegacyPullJob(context(), deps).catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(JobFailure);
        expect((failure as JobFailure).code).toBe("zug_gescheitert");
        expect((failure as JobFailure).retryable).toBe(false);
        expect((failure as JobFailure).message).toContain("HTTP 503");
    });

    it("das echte Werkzeug nimmt --auftrag an; ohne Legacy endet es mit Fehler, bevor es schreibt", async () => {
        // Der echte Prozess mit dem echten Pfad: nur die kleine erste Quelle zeigt auf einen toten Port, also kein Abruf bei Legacy.
        const deps: AbgleichDeps = {
            spawnTool: (file, args) =>
                spawn(process.execPath, [file, ...args, "--ecosystem-display-endpoint", "http://127.0.0.1:9/tot"], {
                    stdio: ["ignore", "pipe", "pipe"],
                    env: { ...process.env, DATABASE_URL: "postgres://niemand@127.0.0.1:9/keine" },
                }),
            log: () => undefined,
        };
        const failure = await runLegacyPullJob(context(), deps).catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(JobFailure);
        expect((failure as JobFailure).code).toBe("zug_gescheitert");
        // Kein Aufruffehler („Unknown option“), sondern der Abruf scheiterte.
        expect((failure as JobFailure).message).not.toMatch(/Unknown option/iu);
    }, 60_000);

    it("🔴 ein Abbruch an der Phasengrenze beendet den Prozess des Werkzeugs und kommt als Abbruch an", async () => {
        let tool: ReturnType<typeof fakeTool> | undefined;
        const deps: AbgleichDeps = {
            spawnTool: () => {
                tool = fakeTool([phaseZeile("I1"), phaseZeile("I2"), phaseZeile("I3"), "nie gelesen"], 0);
                return tool.child;
            },
            log: () => undefined,
        };
        const job = context({ cancelAt: "I2" });
        await expect(runLegacyPullJob(job, deps)).rejects.toBeInstanceOf(JobCancelled);
        expect(tool?.killed()).toBe(true);
        expect(job.phases.map((phase) => phase.name)).toEqual(["holen", "I1"]);
    });
});

describe("Handler der Medien aus Legacy", () => {
    let dir: string | undefined;
    afterEach(async () => {
        if (dir !== undefined) await rm(dir, { recursive: true, force: true });
        dir = undefined;
    });

    it("holt das Manifest einmal, ruft drei Werkzeuge der Reihe nach und führt ihre Lücken zusammen", async () => {
        dir = await mkdtemp(join(tmpdir(), "abgleich-medien-"));
        const fetched: string[] = [];
        const started: { file: string; args: readonly string[] }[] = [];
        const deps: AbgleichDeps = {
            snapshotDir: dir,
            mediaRoot: join(dir, "media"),
            fetchManifest: async (url) => {
                fetched.push(url);
                return new Response(JSON.stringify({ ok: true, items: [] }), { status: 200 });
            },
            spawnTool: (file, args) => {
                started.push({ file, args });
                const gaps = file === toolFile("media-fetch-cli") ? ["dateien"] : [];
                return fakeTool([ergebnisZeile({ luecken: gaps, befunde: 2 })], 0).child;
            },
            log: () => undefined,
        };
        const job = context();
        const result = await runLegacyMediaJob(job, deps);
        expect(fetched).toEqual(["https://avesmaps.de/api/app/media-export.php"]);
        await expect(readFile(join(dir, "media-export.json"), "utf8")).resolves.toContain('"ok":true');
        expect(started.map((entry) => entry.file)).toEqual([
            toolFile("media-cli"),
            toolFile("media-fetch-cli"),
            toolFile("media-files-cli"),
        ]);
        for (const entry of started) expect(entry.args).toContain(AUFTRAG);
        expect(job.phases.map((phase) => phase.name)).toEqual(["manifest", "metadaten", "dateien", "verarbeiten"]);
        expect(result).toEqual({ luecken: ["dateien"], befunde: 6, satz: null });
    });

    it("ohne MEDIA_ROOT oder ohne Manifest beginnt nichts", async () => {
        await expect(runLegacyMediaJob(context(), { mediaRoot: "", log: () => undefined })).rejects.toMatchObject({
            code: "media_root_fehlt",
        });
        dir = await mkdtemp(join(tmpdir(), "abgleich-medien-"));
        let spawned = false;
        const failure = await runLegacyMediaJob(context(), {
            snapshotDir: dir,
            mediaRoot: join(dir, "media"),
            fetchManifest: async () => new Response("down", { status: 503 }),
            spawnTool: () => {
                spawned = true;
                return fakeTool([], 0).child;
            },
        }).catch((error: unknown) => error);
        expect((failure as JobFailure).code).toBe("manifest_gescheitert");
        expect(spawned).toBe(false);
    });
});
