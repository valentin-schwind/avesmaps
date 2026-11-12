import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Value } from "@sinclair/typebox/value";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ReleaseNotizen, kurzinfoAus, releaseStamm } from "@avesmaps3d/shared";
import {
    NotizenFehler,
    bereicheAus,
    beschreibungAus,
    geruest,
    nurDoku,
    pruefe,
    sammle,
    sammleVerlauf,
    werAus,
} from "../src/versionen/notizen.ts";

/**
 * Das Werkzeug der Release-Notizen (WI-0137, VERSION-0001 §2) an einem Git-Repository im Temp-Ordner.
 *
 * - 🔴 Merges fallen weg; nur die erste Zeile; keine E-Mail-Adresse in der Datei; Doku nach Dateien, nicht nach Präfix.
 * - 🔴 Weigerung bei einem `--seit`, der kein Vorfahre ist.
 * - Gerüst: drei Überschriften, die Gedächtnisstütze nur als Kommentar (liest sich als leere Kurzinfo).
 * - `--pruefen`: fremde Überschrift ist ein Fehler; fehlende oder leere Kurzinfo ein Hinweis.
 */

let repo: string;
let start: string;
let ende: string;
let seitenzweig: string;

const git = (...args: string[]): string => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
async function commit(
    datei: string,
    inhalt: string,
    nachricht: string,
    autor = "Claudia <claudia@avesmaps3d.local>",
): Promise<string> {
    await mkdir(join(repo, datei, ".."), { recursive: true });
    await writeFile(join(repo, datei), inhalt);
    git("add", datei);
    git("commit", "-q", "-m", nachricht, "--author", autor);
    return git("rev-parse", "HEAD");
}

beforeAll(async () => {
    repo = await mkdtemp(join(tmpdir(), "release-notizen-"));
    git("init", "-q", "-b", "master");
    git("config", "user.name", "Test");
    git("config", "user.email", "test@example.invalid");
    git("config", "commit.gpgsign", "false");
    await mkdir(join(repo, "project-control", "work-items"), { recursive: true });
    await writeFile(
        join(repo, "project-control", "work-items", "WI-0128-ortseditor.md"),
        "# WI-0128: Ortseditor, Bau nach EDIT-0001\n",
    );
    await writeFile(join(repo, "project-control", "work-items", "WI-0137-versionen.md"), "# WI-0137 · Versionen\n");
    start = await commit("README.md", "start\n", "chore: Anfang");
    await commit(
        "apps/web/src/ort.ts",
        "1\n",
        "feat(WI-0128 E12): Ort verschieben\n\nLange Beschreibung, die nicht mitkommt.",
    );
    await commit("project-control/state/current.md", "stand\n", "feat(WI-0128): nur der Stand, trotzdem Doku");
    // Ein Seitenzweig mit Merge: der Merge fällt weg, der Commit darin bleibt.
    git("checkout", "-q", "-b", "seite");
    seitenzweig = await commit(
        "apps/server/src/x.ts",
        "x\n",
        "fix: Zahl stimmt wieder",
        "Claudio <claudio@avesmaps3d.local>",
    );
    git("checkout", "-q", "master");
    await commit("docs/plan.md", "plan\n", "docs(WI-0137): Bauplan", "Valentin Schwind <mail@example.invalid>");
    git("merge", "-q", "--no-ff", "seite", "-m", "Merge branch 'seite'");
    ende = git("rev-parse", "HEAD");
});

afterAll(async () => {
    await rm(repo, { recursive: true, force: true });
});

describe("Release-Notizen: Werkzeug", () => {
    it("🔴 Merges fallen weg, nur die erste Zeile, Namen ohne E-Mail, Doku nach Dateien", async () => {
        const notizen = await sammle(repo, start, ende, "Probe");
        expect(Value.Check(ReleaseNotizen, notizen)).toBe(true);
        expect(notizen.commits.map((c) => [c.betreff, c.wer, c.doku])).toEqual([
            ["docs(WI-0137): Bauplan", "Valentin", true],
            ["fix: Zahl stimmt wieder", "Claudio", false],
            ["feat(WI-0128): nur der Stand, trotzdem Doku", "Claudia", true],
            ["feat(WI-0128 E12): Ort verschieben", "Claudia", false],
        ]);
        expect(JSON.stringify(notizen)).not.toMatch(/@/u);
        expect(notizen.commits.some((c) => c.sha === seitenzweig)).toBe(true);
        expect(notizen.pakete).toEqual({ "WI-0128": "Ortseditor, Bau nach EDIT-0001", "WI-0137": "Versionen" });
        expect(notizen).toMatchObject({ schema: 1, titel: "Probe", von: start, bis: ende });
        expect(releaseStamm(notizen.datum, notizen.bis)).toMatch(/^\d{4}-\d{2}-\d{2}-[0-9a-f]{8}$/u);
    });

    it("🔴 weigert sich bei einem --seit, der kein Vorfahre ist, und bei Unbekanntem", async () => {
        await expect(sammle(repo, ende, start)).rejects.toThrow(NotizenFehler);
        await expect(sammle(repo, "gibt-es-nicht", ende)).rejects.toThrow(/kein Commit/u);
        await expect(sammle(repo, ende, ende)).rejects.toThrow(/derselbe/u);
    });

    it("das Gerüst hat drei leere Überschriften; die Gedächtnisstütze ist Kommentar und wird nicht gezeigt", async () => {
        const text = geruest(await sammle(repo, start, ende));
        expect(text).toContain("## Anschauen");
        expect(text).toContain("## Prüfen");
        expect(text).toContain("## Beachten");
        expect(text).toContain("neu: E12 · Ort verschieben");
        expect(kurzinfoAus(text)).toEqual({ abschnitte: [], fremd: [] });
    });

    it("Hilfen: Doku an Dateien, Namen abgebildet", () => {
        expect(nurDoku(["project-control/x.md", "docs/y.md", "AGENTS.md"])).toBe(true);
        expect(nurDoku(["project-control/x.md", "apps/web/src/a.ts"])).toBe(false);
        expect(nurDoku([])).toBe(false);
        expect(werAus("Valentin Schwind")).toBe("Valentin");
        expect(werAus("Claudia")).toBe("Claudia");
        expect(werAus("Jemand Neues")).toBe("Jemand Neues");
    });
});

describe("Release-Notizen: --pruefen", () => {
    it("🔴 fremde Überschrift ist ein Fehler, fehlende und leere Kurzinfo sind Hinweise; kaputte Datei ein Fehler", async () => {
        const ordner = await mkdtemp(join(tmpdir(), "release-pruefen-"));
        try {
            const notizen = await sammle(repo, start, ende);
            const stamm = releaseStamm(notizen.datum, notizen.bis);
            await writeFile(join(ordner, `${stamm}.json`), JSON.stringify(notizen));
            expect(await pruefe(ordner)).toEqual([
                { datei: `${stamm}.md`, art: "hinweis", text: expect.stringContaining("fehlt") },
            ]);

            await writeFile(join(ordner, `${stamm}.md`), geruest(notizen));
            expect(await pruefe(ordner)).toEqual([
                { datei: `${stamm}.md`, art: "hinweis", text: expect.stringContaining("leer") },
            ]);

            await writeFile(
                join(ordner, `${stamm}.md`),
                "# Was ist neu?\n\n## Anschauen\n- Zoomstufe 8\n\n## Sonstiges\n- falsch\n",
            );
            expect(await pruefe(ordner)).toEqual([
                { datei: `${stamm}.md`, art: "fehler", text: expect.stringContaining("„Sonstiges“") },
            ]);

            await writeFile(join(ordner, "2026-01-01-abcdef01.json"), "{kaputt");
            await writeFile(join(ordner, "2026-01-02-abcdef02.md"), "# Was ist neu?\n");
            const befunde = await pruefe(ordner);
            expect(befunde.filter((b) => b.art === "fehler").map((b) => b.datei)).toEqual([
                "2026-01-01-abcdef01.json",
                `${stamm}.md`,
                "2026-01-02-abcdef02.md",
            ]);
        } finally {
            await rm(ordner, { recursive: true, force: true });
        }
    });

    it("die Dateien des Nachtrags im Repository sind gültig (nur Hinweise auf fehlende Kurzinfo)", async () => {
        const befunde = await pruefe(join(import.meta.dirname, "../../../config/releases"));
        expect(befunde.filter((b) => b.art === "fehler")).toEqual([]);
        expect(befunde.length).toBeGreaterThanOrEqual(6);
    });
});

describe("Release-Notizen: Verlauf mit Beschreibung und Bereich (WI-0255 §3e)", () => {
    it("feat und fix der Anwendung tragen ihre Beschreibung und ihre Bereiche; Doku-Commits nicht", async () => {
        const verlauf = await sammleVerlauf(repo, ende);
        const nach = (titel: string) => verlauf.commits.find((commit) => commit.titel === titel)!;
        expect(nach("feat(WI-0128 E12): Ort verschieben")).toMatchObject({
            beschreibung: "Lange Beschreibung, die nicht mitkommt.",
            bereich: ["oberflaeche"],
        });
        expect(nach("fix: Zahl stimmt wieder")).toMatchObject({ beschreibung: "", bereich: ["server"] });
        expect(nach("feat(WI-0128): nur der Stand, trotzdem Doku")).not.toHaveProperty("beschreibung");
        expect(nach("docs(WI-0137): Bauplan")).not.toHaveProperty("bereich");
    });

    it("die Bereiche aus den Dateien: Editor vor dem allgemeinen Web-Teil, Tests und Doku zählen nicht", () => {
        expect(
            bereicheAus([
                "apps/web/src/wegeditor/wegeditor-fenster.vue",
                "apps/web/src/fenster/quellen-klappbox.vue",
                "apps/web/src/i18n/de.ts",
                "apps/web/test/weg-verlauf.test.ts",
                "packages/shared/src/navigation/wegeditor.ts",
            ]),
        ).toEqual(["editor", "oberflaeche", "server"]);
        expect(bereicheAus(["apps/web/src/route-planner/planer.vue", "apps/server/migrations/0240_x.sql"])).toEqual([
            "karte",
            "daten",
        ]);
        expect(bereicheAus(["docs/x.md", "apps/server/test/a.test.ts"])).toEqual([]);
    });

    it("die Beschreibung ohne Neu-, Achtung-, Testzeilen und Trailer, gekürzt", () => {
        const text = [
            "Der Reiter Quellen ist bearbeitbar.",
            "",
            "- Tests: Modell der Klappbox.",
            "Neu: Im Wegeditor lassen sich Quellen ändern.",
            "Achtung: neu laden.",
            "",
            "Co-Authored-By: Claude <noreply@anthropic.com>",
        ].join("\n");
        expect(beschreibungAus(text)).toBe("Der Reiter Quellen ist bearbeitbar.");
        const lang = beschreibungAus("Wort ".repeat(400));
        expect(lang.length).toBe(800);
        expect(lang.endsWith("…")).toBe(true);
    });
});
