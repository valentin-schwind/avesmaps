import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freigabeDateiFehler, sperreVon, type FreigabeDatei } from "@avesmaps3d/shared";
import {
    baueDatei,
    freigabeAus,
    nachweisAus,
    seitAus,
    stageGruenAus,
} from "../../../scripts/ops/freigabe-stand-cli.ts";

/**
 * Sammellauf und Production-Freigabe (Betreiber 2026-10-18 „A, ab jetzt immer“): Claudios `freigabe-stand.sh` gibt `--stage-gruen` nur
 * mit grünem Rollout UND grünem Sammellauf, `--stage-rot` bei rotem Sammellauf. Rot gewinnt, und der Knopf sagt „geprüft und rot“.
 */
describe("stageGruen aus den Angaben des Werkzeugs", () => {
    it("🔴 rot gewinnt über grün, ohne beide nicht feststellbar", () => {
        expect(stageGruenAus({ gruen: true, rot: false })).toBe(true);
        expect(stageGruenAus({ gruen: true, rot: true })).toBe(false);
        expect(stageGruenAus({ gruen: false, rot: true })).toBe(false);
        expect(stageGruenAus({ gruen: false, rot: false })).toBeNull();
    });

    it("die Sperre der Freigabe liest daraus „stage_rot“ und „stage_ungeprueft“", () => {
        const datei = (stageGruen: boolean | null) => ({
            schema: 1 as const,
            standAt: "2026-10-18T22:00:00Z",
            production: { release: "aaaaaaa", commit: "a".repeat(40), seit: null },
            stage: { release: "bbbbbbb", commit: "b".repeat(40), seit: null },
            stageGruen,
            stagePruefung: null,
            technik: { migrationen: [], rechte: [], umgebungswerte: [] },
            themen: [],
        });
        expect(sperreVon(datei(stageGruenAus({ gruen: true, rot: true })), false)).toBe("stage_rot");
        expect(sperreVon(datei(stageGruenAus({ gruen: false, rot: false })), false)).toBe("stage_ungeprueft");
        expect(sperreVon(datei(stageGruenAus({ gruen: true, rot: false })), false)).toBeNull();
    });
});

/**
 * „Für Production freigeben, nachts ausliefern“ (WI-0234): Claudios `freigabe-stand.sh` gibt die offene Nacht-Freigabe mit, damit das
 * Fenster ihren Prüfstand zeigt, und `--nachts`, sobald seine Seite nachts ausliefert. Problemfall: Eine halbe oder kaputte Angabe schrieb
 * eine Datei, die der Server als unlesbar verwürfe; dort hieße es dann „nicht eingerichtet“, und der Knopf wäre zu.
 */
describe("Nacht-Freigabe in der Statusdatei", () => {
    const basis = () => ({
        schema: 1 as const,
        standAt: "2026-10-19T12:00:00Z",
        production: { release: "aaaaaaa", commit: "a".repeat(40), seit: null },
        stage: { release: "bbbbbbb", commit: "b".repeat(40), seit: null },
        stageGruen: null,
        stagePruefung: null,
        technik: { migrationen: [], rechte: [], umgebungswerte: [] },
        themen: [],
    });

    it("🔴 alle drei Pflichtwerte oder keiner; ohne Angabe fehlt das Feld", () => {
        expect(freigabeAus({})).toBeNull();
        expect(freigabeAus({ ops: "OPS-000123", commit: "b".repeat(40), release: "bbbbbbb" })).toEqual({
            ops: "OPS-000123",
            commit: "b".repeat(40),
            release: "bbbbbbb",
            pruefung: null,
        });
        expect(() => freigabeAus({ ops: "OPS-000123" })).toThrow(/gehören zusammen/u);
        expect(() => freigabeAus({ pruefung: "Serverprüfung läuft" })).toThrow(/gehören zusammen/u);
    });

    it("🔴 eine Freigabe, die der Vertrag nicht zulässt, wird nie geschrieben; eine gültige, eine ohne und der Schalter bleiben lesbar", () => {
        expect(freigabeDateiFehler(basis())).toEqual([]);
        expect(freigabeDateiFehler({ ...basis(), nachts: true })).toEqual([]);
        const gut = {
            ops: "OPS-000123",
            commit: "b".repeat(40),
            release: "bbbbbbb",
            pruefung: "Serverprüfung heute Nacht ab 04:30",
        };
        expect(freigabeDateiFehler({ ...basis(), freigabe: gut })).toEqual([]);
        expect(freigabeDateiFehler({ ...basis(), freigabe: { ...gut, ops: "123" } })).not.toEqual([]);
        expect(freigabeDateiFehler({ ...basis(), freigabe: { ...gut, pruefung: "Zeile\nzwei" } })).not.toEqual([]);
        // Ein `bis` gibt es nicht mehr: Eine Freigabe gilt, bis sie ausgeliefert, rot, abgelöst oder abgebrochen ist.
        expect(freigabeDateiFehler({ ...basis(), freigabe: { ...gut, bis: "2026-10-20T00:00:00Z" } })).not.toEqual([]);
    });
});

/**
 * Proben und Release-Nachweis in der Statusdatei (WI-0248): Im Nachtmodus ist das Freigeben die Kandidatenbenennung; Claudios
 * `freigabe-stand.sh` gibt dafür `--proben-gruen` und `--nachweis <fehlt|laeuft|gruen|rot>` mit. Problemfälle: Eine Datei mit den neuen
 * Angaben darf ohne sie nicht anders aussehen (ein älterer Server liest streng), und ein falscher Wert darf nie eine Datei schreiben.
 */
describe("Proben und Release-Nachweis in der Statusdatei (WI-0248)", () => {
    const cli = resolve(import.meta.dirname, "../../../scripts/ops/freigabe-stand-cli.ts");
    // Ein winziges eigenes Repository: Das echte hat Hunderte Work Items, und `leseNamen` läse jedes einzeln (Dutzende Sekunden).
    let wurzel = "";
    beforeAll(() => {
        wurzel = mkdtempSync(join(tmpdir(), "avm-freigabe-cli-"));
        writeFileSync(join(wurzel, "datei.txt"), "x", "utf8");
        const git = (...args: string[]): string =>
            execFileSync(
                "git",
                ["-C", wurzel, "-c", "user.name=Test", "-c", "user.email=test@avesmaps3d.local", ...args],
                {
                    encoding: "utf8",
                },
            );
        git("init", "--quiet");
        git("add", "datei.txt");
        git("commit", "--quiet", "--no-gpg-sign", "-m", "test(WI-0248): Wurzel");
    });
    afterAll(() => {
        if (wurzel !== "") rmSync(wurzel, { recursive: true, force: true });
    });
    const lauf = (...angaben: string[]): { status: number; stdout: string; stderr: string } => {
        const ergebnis = spawnSync(
            process.execPath,
            [cli, "--repo", wurzel, "--production", "HEAD", "--stage", "HEAD", ...angaben],
            {
                encoding: "utf8",
            },
        );
        return { status: ergebnis.status ?? -1, stdout: ergebnis.stdout, stderr: ergebnis.stderr };
    };

    it("🔴 der Nachweis kennt genau vier Werte; ohne Angabe bleibt er aus, ein anderer Wert ist ein Fehler", () => {
        expect(nachweisAus(undefined)).toBeUndefined();
        for (const wert of ["fehlt", "laeuft", "gruen", "rot"] as const) expect(nachweisAus(wert)).toBe(wert);
        expect(() => nachweisAus("vielleicht")).toThrow(/--nachweis kennt nur fehlt, laeuft, gruen, rot/u);
        expect(() => nachweisAus("")).toThrow(/--nachweis/u);
        expect(() => nachweisAus("GRUEN")).toThrow(/--nachweis/u);
    });

    it("🔴 die Angaben werden nur geschrieben, wenn sie da sind; ohne sie ist die Datei dieselbe wie vorher", () => {
        const basis = { repo: wurzel, production: "HEAD", stage: "HEAD", stageGruen: null, stagePruefung: null };
        const ohne = baueDatei(basis);
        const gleich = baueDatei({ ...basis, probenGruen: false, nachweis: undefined });
        expect(Object.keys(ohne)).not.toContain("probenGruen");
        expect(Object.keys(ohne)).not.toContain("nachweis");
        expect({ ...gleich, standAt: "" }).toEqual({ ...ohne, standAt: "" });
        const mit = baueDatei({ ...basis, nachts: true, probenGruen: true, nachweis: "laeuft" });
        expect(mit).toMatchObject({ nachts: true, probenGruen: true, nachweis: "laeuft" });
        expect(freigabeDateiFehler(mit)).toEqual([]);
    });

    it("🔴 „seit“ ist die Umschaltung, wenn das Werkzeug sie nennt, sonst die Zeit des Commits (Claudio 2026-11-01)", () => {
        expect(seitAus(undefined)).toBeUndefined();
        expect(seitAus("2026-11-01T19:33:52Z")).toBe("2026-11-01T19:33:52.000Z");
        expect(() => seitAus("gestern")).toThrow(/keine Zeit/u);
        const basis = { repo: wurzel, production: "HEAD", stage: "HEAD", stageGruen: null, stagePruefung: null };
        const ohne = baueDatei(basis);
        const mit = baueDatei({ ...basis, seit: { production: "2026-11-01T19:33:52.000Z" } });
        expect(mit.production.seit).toBe("2026-11-01T19:33:52.000Z");
        expect(mit.stage.seit).toBe(ohne.stage.seit);
        expect(ohne.production.seit).toBe(ohne.stage.seit);
        expect(freigabeDateiFehler(mit)).toEqual([]);
    });

    it("🔴 `--proben-gruen` und `--nachweis` landen in der Datei und öffnen den Nachtmodus-Knopf; ein falscher Wert endet mit Exit 2", () => {
        const offen = lauf("--nachts", "--proben-gruen", "--nachweis", "fehlt");
        expect(offen.status).toBe(0);
        const datei = JSON.parse(offen.stdout) as FreigabeDatei;
        expect(datei).toMatchObject({ nachts: true, probenGruen: true, nachweis: "fehlt" });
        expect(freigabeDateiFehler(datei)).toEqual([]);

        const alt = JSON.parse(lauf("--nachts").stdout) as Record<string, unknown>;
        expect(alt).not.toHaveProperty("probenGruen");
        expect(alt).not.toHaveProperty("nachweis");

        const falsch = lauf("--nachweis", "vielleicht");
        expect(falsch.status).toBe(2);
        expect(falsch.stdout).toBe("");
        expect(falsch.stderr).toContain("--nachweis kennt nur");
    });

    it("die Schlüssel stehen so im Werkzeug, wie Claudios `freigabe-stand.sh` sie per grep erkennt", () => {
        const quelle = readFileSync(cli, "utf8");
        expect(quelle).toContain('"proben-gruen"');
        expect(quelle).toContain('"nachweis"');
    });
});
