import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildRepoOverview, findRepoRoot, localDate, plain, tableCells } from "../src/jobs/repo-overview.ts";

/**
 * Der Reiter „Überblick“ (JOBS-0001 5.1, D2 A, D3 A/A): Alles wird aus dem Repository GELESEN, mit Datei und Zeile als Beleg. Geprüft
 * wird an einem kleinen Wegwerf-Repository mit den Formen, die die echten Dateien haben (Handover-Kopf, Work-Item-Kopf,
 * `current.md` mit „Offene Betreiberentscheidungen“ und „Datenstand“).
 */

const NOW = new Date(2026, 9, 4, 14, 30, 0);
const TODAY = "2026-10-04";

let root: string;

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "avesmaps-repo-"));
    for (const directory of ["work-items", "handovers", "planning", "decisions", "state"]) {
        await mkdir(join(root, "project-control", directory), { recursive: true });
    }
    await writeFile(join(root, "AGENTS.md"), "# Agenten\n");
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

async function write(relative: string, text: string, modified: Date = NOW): Promise<void> {
    const path = join(root, relative);
    await writeFile(path, text);
    await utimes(path, modified, modified);
}

const handover = (status: string, decision: string | null, title = "Ein Handover"): string =>
    [
        `# ${title}`,
        "",
        "| Feld | Wert |",
        "|---|---|",
        "| from | claudio |",
        "| to | claudia |",
        `| status | ${status} |`,
        ...(decision === null ? [] : [`| operator_decision_required | ${decision} |`]),
        "",
        "## Kontext",
    ].join("\n");

describe("Wurzel des Repositorys", () => {
    it("findet sie oberhalb eines Verzeichnisses; ohne Repository (die Stage) null", async () => {
        await write("project-control/state/current.md", "# Projektzustand\n");
        const inside = join(root, "apps", "server", "dist");
        await mkdir(inside, { recursive: true });
        expect(findRepoRoot(inside)).toBe(root);
        const outside = await mkdtemp(join(tmpdir(), "avesmaps-leer-"));
        try {
            expect(findRepoRoot(outside)).toBeNull();
        } finally {
            await rm(outside, { recursive: true, force: true });
        }
    });

    it("Ortszeit: das Datum des Rechners, nicht UTC", () => {
        expect(localDate(new Date(2026, 9, 4, 0, 5))).toBe("2026-10-04");
        expect(localDate(new Date(2026, 0, 9, 23, 59))).toBe("2026-01-09");
    });

    it("ohne project-control: available false, no_repository", async () => {
        const empty = await mkdtemp(join(tmpdir(), "avesmaps-leer-"));
        try {
            const overview = await buildRepoOverview({ root: empty, now: NOW });
            expect(overview).toMatchObject({ available: false, reason: "no_repository", waiting: [], sessions: [] });
        } finally {
            await rm(empty, { recursive: true, force: true });
        }
    });
});

describe("Markdown-Tabellen", () => {
    it("zerlegt Zellen, auch mit maskiertem Strich; keine Tabellenzeile ergibt null", () => {
        expect(tableCells("| a | b \\| c | d |")).toEqual(["a", "b | c", "d"]);
        expect(tableCells("kein Tabellentext")).toBeNull();
        expect(tableCells("|---|---|")).toEqual(["---", "---"]);
    });

    it("macht aus Markdown Text: kein Fettdruck, kein Code, Verweise als Beschriftung, gekürzt", () => {
        expect(plain("**Wichtig** mit `Code` und [Link](http://x)")).toBe("Wichtig mit Code und Link");
        expect(plain("a".repeat(300), 20)).toBe(`${"a".repeat(19)}…`);
    });
});

describe("Was auf den Betreiber wartet", () => {
    it("🔴 Handovers mit ACTION_REQUIRED und operator_decision_required yes, samt Zeile des Kopfes als Beleg", async () => {
        await write(
            "project-control/handovers/2026-10-04-a.md",
            handover("ACTION_REQUIRED", "yes: Freigabe des Bootstraps", "Bootstrap der Unit"),
        );
        const overview = await buildRepoOverview({ root, now: NOW });
        expect(overview.available).toBe(true);
        expect(overview.waiting).toEqual([
            {
                text: "Bootstrap der Unit",
                detail: "ACTION_REQUIRED; yes: Freigabe des Bootstraps",
                beleg: { file: "project-control/handovers/2026-10-04-a.md", line: 8 },
            },
        ]);
    });

    it("`no` wartet nicht auf ihn, `DONE` und `INFO` ebenso; ein teils gemischtes „no … yes …“ schon", async () => {
        await write("project-control/handovers/a.md", handover("ACTION_REQUIRED", "no (Planung)", "A"));
        await write("project-control/handovers/b.md", handover("DONE (Claudio 2026-10-04)", "yes", "B"));
        await write("project-control/handovers/c.md", handover("INFO", "yes", "C"));
        await write(
            "project-control/handovers/d.md",
            handover("ACTION_REQUIRED", "no für die Planung; **yes** für jeden Bootstrap", "D"),
        );
        await write("project-control/handovers/e.md", handover("BLOCKED", "yes: Entscheidung zu X", "E"));
        const overview = await buildRepoOverview({ root, now: NOW });
        expect(overview.waiting.map((entry) => entry.text)).toEqual(["D", "E"]);
    });

    it("ein fehlendes operator_decision_required gilt als yes (Handover-README), und die Seite sagt es", async () => {
        await write("project-control/handovers/f.md", handover("ACTION_REQUIRED", null, "Ohne Feld"));
        const overview = await buildRepoOverview({ root, now: NOW });
        expect(overview.waiting).toHaveLength(1);
        expect(overview.waiting[0]?.detail).toContain("fehlt");
    });

    it("die Tabelle „Offene Betreiberentscheidungen“ in current.md, Zeile für Zeile (ohne Kopf und Trenner)", async () => {
        await write(
            "project-control/state/current.md",
            [
                "# Projektzustand",
                "",
                "## 7. Offene Handovers",
                "| x | y |",
                "",
                "## 8. Offene Betreiberentscheidungen",
                "",
                "| Frage | Stand |",
                "|---|---|",
                "| Anmeldemethode (ADR-0013) | offen, vor dem ersten Editor |",
                "| WI-0055: dunkle Kante | offen, **kein** Blocker |",
                "",
                "## 9. Nummern",
                "| Nächste | WI-0076 |",
            ].join("\n"),
        );
        const overview = await buildRepoOverview({ root, now: NOW });
        expect(overview.waiting).toEqual([
            {
                text: "Anmeldemethode (ADR-0013)",
                detail: "offen, vor dem ersten Editor",
                beleg: { file: "project-control/state/current.md", line: 10 },
            },
            {
                text: "WI-0055: dunkle Kante",
                detail: "offen, kein Blocker",
                beleg: { file: "project-control/state/current.md", line: 11 },
            },
        ]);
    });
});

describe("Heute entschieden", () => {
    it("🔴 Zeilen „Betreiber <heute>: „…““: nur das heutige Datum, mit Datei und Zeile", async () => {
        await write(
            "project-control/work-items/WI-0001-x.md",
            [
                "# WI-0001: Etwas",
                "",
                `Entschieden (Betreiber ${TODAY}: „Variante B, aber mit dem Hinweis“).`,
                "Gestern (Betreiber 2026-10-03: „etwas anderes“).",
                `Ohne Zitat Betreiber ${TODAY} hat nichts gesagt.`,
            ].join("\n"),
        );
        const overview = await buildRepoOverview({ root, now: NOW });
        expect(overview.today).toBe(TODAY);
        expect(overview.decidedToday).toEqual([
            {
                text: "Variante B, aber mit dem Hinweis",
                detail: null,
                beleg: { file: "project-control/work-items/WI-0001-x.md", line: 3 },
            },
        ]);
    });

    it("verschachtelte Anführungszeichen bleiben im Gleichgewicht, „wörtlich:“ vor dem Zitat stört nicht", async () => {
        await write(
            "project-control/planning/P.md",
            `> ✅ **Entschieden** (Betreiber ${TODAY}, wörtlich: „Vorlage JOBS-0001: „alles wie empfohlen““): E1 ja.`,
        );
        const overview = await buildRepoOverview({ root, now: NOW });
        expect(overview.decidedToday.map((entry) => entry.text)).toEqual(["Vorlage JOBS-0001: „alles wie empfohlen“"]);
    });

    it("dasselbe Zitat an mehreren Stellen: ein Eintrag mit „an n Stellen“, die erste Fundstelle", async () => {
        await write("project-control/handovers/a.md", `Betreiber ${TODAY}: „alles wie empfohlen“`);
        await write("project-control/work-items/WI-0002-y.md", `x\nBetreiber ${TODAY}: „alles wie empfohlen“`);
        await write("project-control/state/current.md", `**Stand:** Betreiber ${TODAY}: „alles wie empfohlen“`);
        const overview = await buildRepoOverview({ root, now: NOW });
        expect(overview.decidedToday).toHaveLength(1);
        expect(overview.decidedToday[0]?.detail).toBe("an 3 Stellen");
    });
});

describe("Selbst entschieden", () => {
    it("🔴 nur in heute geänderten Dateien: IMPLEMENTATION DETAIL und „selbst entschieden“", async () => {
        await write(
            "project-control/work-items/WI-0003-z.md",
            "# Z\n\n- Eigene Wahl, `IMPLEMENTATION DETAIL`: ein eigener Kodierer.\n- Das ist selbst entschieden: keine Abhängigkeit.\n- gewöhnliche Zeile\n",
        );
        await write(
            "project-control/work-items/WI-0004-alt.md",
            "# Alt\n\n- `IMPLEMENTATION DETAIL`: von gestern.\n",
            new Date(2026, 9, 3, 10, 0, 0),
        );
        const overview = await buildRepoOverview({ root, now: NOW });
        expect(overview.selfDecided.map((entry) => [entry.beleg.file, entry.beleg.line])).toEqual([
            ["project-control/work-items/WI-0003-z.md", 3],
            ["project-control/work-items/WI-0003-z.md", 4],
        ]);
        expect(overview.selfDecided[0]?.text).toContain("ein eigener Kodierer");
    });

    it("Zeilen, die die Markierung nur erklären, sind keine Entscheidung", async () => {
        await write(
            "project-control/planning/J.md",
            "| selbst entschieden | Markierungen `IMPLEMENTATION DETAIL` (Kap. 2.6) und „selbst entschieden“ | Repo | D3 |\n",
        );
        const overview = await buildRepoOverview({ root, now: NOW });
        expect(overview.selfDecided).toEqual([]);
    });
});

describe("Laufende Sitzungen (D3 A: aus dem Repository abgeleitet)", () => {
    it("Work Items mit Status IN_PROGRESS, samt Besitzer und Zeile des Status", async () => {
        await write(
            "project-control/work-items/WI-0063-infopanel.md",
            [
                "# WI-0063: Infopanel und Editor-Floating-Menu",
                "",
                "| Feld | Wert |",
                "|---|---|",
                "| id | WI-0063 |",
                "| owner | claudia (Sitzung „WI-0063 Infopanel“) |",
                "| status | **IN_PROGRESS** (P0 erledigt) |",
            ].join("\n"),
        );
        await write("project-control/work-items/WI-0070-fertig.md", "# WI-0070: Fertig\n\n| status | **DONE** |\n");
        const overview = await buildRepoOverview({ root, now: NOW });
        expect(overview.sessions).toEqual([
            {
                text: "WI-0063 Infopanel und Editor-Floating-Menu",
                detail: "Besitz: claudia (Sitzung „WI-0063 Infopanel“); IN_PROGRESS (P0 erledigt)",
                beleg: { file: "project-control/work-items/WI-0063-infopanel.md", line: 7 },
            },
        ]);
    });
});

describe("Datenstand laut Dokumentation", () => {
    it("die Tabelle in current.md: Beschriftung, lokal, Stage, Beleg", async () => {
        await write(
            "project-control/state/current.md",
            [
                "## 4. Datenstand",
                "",
                "| | lokal (`avesmaps3d_dev`) | Stage |",
                "|---|---|---|",
                "| Legacy-Satz | `map161832` | `map163536` |",
                "| Gelände | DEM `8bbaa2861499` | DEM `a0d65d595b8f` |",
                "",
                "- Die Ableitungen sperren sich gegenseitig.",
            ].join("\n"),
        );
        const overview = await buildRepoOverview({ root, now: NOW });
        expect(overview.dataStand).toEqual([
            {
                label: "Legacy-Satz",
                local: "map161832",
                stage: "map163536",
                beleg: { file: "project-control/state/current.md", line: 5 },
            },
            {
                label: "Gelände",
                local: "DEM 8bbaa2861499",
                stage: "DEM a0d65d595b8f",
                beleg: { file: "project-control/state/current.md", line: 6 },
            },
        ]);
    });

    it("fehlt current.md, bleibt die Liste leer (die Seite sagt es), nichts bricht", async () => {
        const overview = await buildRepoOverview({ root, now: NOW });
        expect(overview).toMatchObject({ available: true, dataStand: [], waiting: [], decidedToday: [] });
    });
});
