import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { belegteDateien, hoechsteNummer, workItemNummer } from "../../../scripts/ops/anspruch-nummer.ts";

/**
 * Jede Migrations- und Work-Item-Nummer ist genau einmal vergeben (WI-0169, Prüfung des Regelwerks 2026-10-15,
 * Empfehlung 6: „Nummern und Übergabeköpfe prüft ein Werkzeug, nicht die Sorgfalt der Sitzung.“).
 *
 * Der Wächter meldet als Testfehler; er hält keinen Import und keinen Lauf an (AGENTS.md, „Blockierende Prüfungen im
 * Betrieb“, nimmt Tests aus). Wie man an eine freie Nummer kommt: AGENTS.md, „Die Anspruchsliste“.
 */

const wurzel = fileURLToPath(new URL("../../../", import.meta.url));
const anspruchCli = join(wurzel, "scripts/ops/anspruch-cli.ts");

interface Ausnahme {
    dateien: string[];
    grund: string;
}

/** Migrationsnummern, die doppelt vergeben sind und so bleiben. 🔴 Die Liste darf nur schrumpfen. */
const MIGRATIONEN_DOPPELT: Record<string, Ausnahme> = {
    "0126": {
        dateien: ["0126_production_zug.sql", "0126_sitzung_ansicht.sql"],
        grund:
            "WI-0144 (Production-Zug) und WI-0141b (Server-Reiter) nahmen am 2026-10-14 dieselbe Nummer. Der Migrationslauf " +
            "merkt sich den Dateinamen (apps/server/src/db/migrate.ts); umbenannt liefe die angewendete Migration ein zweites Mal.",
    },
    "0273": {
        dateien: ["0273_community_verknuepfen.sql", "0273_map_redact_person.sql"],
        grund:
            "WI-0268 C7 (b44730bee) und WI-0265 B7 (9326a35a4) nahmen am 2026-10-31 dieselbe Nummer; C7 lag im Worktree vor B7 und wurde nach " +
            "dem Rebase nicht gegen origin geprüft. Beide sind auf master und auf der Stage; der Lauf merkt sich den Dateinamen, umbenannt liefe eine zweimal.",
    },
};

/**
 * Zwei verschiedene Work Items unter einer Nummer. Beide bleiben unter ihrem Namenszusatz stehen und werden mit ihm
 * zitiert; ein Umbenennen träfe Code, Tests und Commits. 🔴 Die Liste darf nur schrumpfen.
 *
 * WI-0098 steht in AGENTS.md ebenfalls als doppelt vergeben, hat aber nur eine Datei (`WI-0098-klappbox-hoehe.md`): Die
 * zweite Verwendung lebte nur in Commits (`80dd6885`), und die sieht dieser Wächter nicht.
 */
const WORK_ITEMS_DOPPELT: Record<string, Ausnahme> = {
    "WI-0100": {
        dateien: ["WI-0100-testzeit-grenzzaehlung.md", "WI-0100-ziel-hinzufuegen.md"],
        grund: "Nacht zum 2026-10-07: sieben Sitzungen gleichzeitig, die Anspruchsliste wurde vor dem Nehmen nicht gelesen.",
    },
    "WI-0107": {
        dateien: ["WI-0107-externe-links-pfeil.md", "WI-0107-fuenf-landschaften-500.md"],
        grund: "2026-10-08 in zwei parallelen Sitzungen; Code und Tests zitieren beide, ein Umbenennen träfe rund zwanzig Stellen.",
    },
    "WI-0141": {
        dateien: ["WI-0141-legacy-zug-je-kategorie.md", "WI-0141-server-reiter.md"],
        grund: "2026-10-13 und 2026-10-14; der Server-Reiter heißt seitdem WI-0141b (current.md §9).",
    },
};

/**
 * Beiblätter: mehrere Dateien zu EINEM Work Item (Nachtrag, Arbeitsanweisung, Restauftrag, Entwurf eines Teils). Das ist
 * keine Doppelvergabe. Ein neues Beiblatt trägt sich hier ein; so entscheidet jemand bewusst, dass es dasselbe Work Item
 * ist und keine neue Nummer braucht.
 */
const BEIBLAETTER: Record<string, string[]> = {
    "WI-0063": [
        "WI-0063-infopanel-floating-menu.md",
        "WI-0063-p4-subject-und-lesevertrag.md",
        "WI-0063-restauftrag-2026-10-13.md",
    ],
    "WI-0065": ["WI-0065-reiseplanung-hoehenprofil.md", "WI-0065-zoelle-reisekosten-server.md"],
    "WI-0068": ["WI-0068-mam-restbau-arbeitsanweisung-2026-10-13.md", "WI-0068-media-asset-management.md"],
    "WI-0079": ["WI-0079-etappenanzeige-konzept.html", "WI-0079-etappenanzeige-routenplaner-infopanel.md"],
    "WI-0120": ["WI-0120-auth-plattform.md", "WI-0120-datenschutz-entwurf.md"],
    "WI-0124": ["WI-0124-betreiber-kanal-arbeitsanweisung.md", "WI-0124-betreiber-kanal.md"],
    "WI-0128": [
        "WI-0128-abschluss-ortseditor-2026-10-13.md",
        "WI-0128-korrektur-ort-staetten.md",
        "WI-0128-ortseditor-bau.md",
    ],
};

/** Die Dateien je Nummer, nur die Nummern mit mehr als einer Datei. */
function mehrfach(namen: readonly string[], nummer: (name: string) => string | undefined): Map<string, string[]> {
    const gruppen = new Map<string, string[]>();
    for (const name of namen) {
        const n = nummer(name);
        if (n !== undefined) gruppen.set(n, [...(gruppen.get(n) ?? []), name]);
    }
    return new Map([...gruppen].filter(([, dateien]) => dateien.length > 1).map(([n, d]) => [n, d.sort()]));
}

/** Verstöße gegen die Ausnahmelisten: neue Doppelgänger, gewachsene und veraltete Einträge. */
function verstoesse(
    gefunden: Map<string, string[]>,
    erlaubt: Record<string, string[]>,
    rat: (nummer: string) => string,
): string[] {
    const raus: string[] = [];
    for (const [nummer, dateien] of gefunden) {
        const liste = erlaubt[nummer];
        if (liste === undefined) {
            raus.push(`${nummer} steht in ${String(dateien.length)} Dateien: ${dateien.join(", ")}. ${rat(nummer)}`);
        } else if (JSON.stringify([...liste].sort()) !== JSON.stringify(dateien)) {
            raus.push(
                `${nummer}: erlaubt sind ${liste.join(", ")}, vorhanden sind ${dateien.join(", ")}. ${rat(nummer)}`,
            );
        }
    }
    for (const nummer of Object.keys(erlaubt)) {
        if (!gefunden.has(nummer)) {
            raus.push(`${nummer} ist nicht mehr mehrfach vergeben; den Eintrag aus der Ausnahmeliste entfernen.`);
        }
    }
    return raus;
}

describe("Nummern sind eindeutig", () => {
    it("jede Migrationsnummer gibt es einmal, außer den Altfällen", () => {
        const namen = readdirSync(join(wurzel, "apps/server/migrations")).filter((name) => name.endsWith(".sql"));
        expect(namen.filter((name) => !/^\d{4}_/.test(name))).toEqual([]);

        const gefunden = mehrfach(namen, (name) => name.slice(0, 4));
        const erlaubt = Object.fromEntries(Object.entries(MIGRATIONEN_DOPPELT).map(([n, a]) => [n, a.dateien]));
        expect(
            verstoesse(
                gefunden,
                erlaubt,
                () =>
                    "Eine Migration braucht eine eigene Nummer: die drei Quellen aus AGENTS.md, „Die Anspruchsliste“. " +
                    "Ist die doppelte schon angewendet, mit Begründung in MIGRATIONEN_DOPPELT eintragen.",
            ),
        ).toEqual([]);
    });

    it("jede Work-Item-Nummer gehört einem Work Item, außer den Altfällen", () => {
        const namen = readdirSync(join(wurzel, "project-control/work-items"));
        const gefunden = mehrfach(namen, workItemNummer);
        const erlaubt = {
            ...BEIBLAETTER,
            ...Object.fromEntries(Object.entries(WORK_ITEMS_DOPPELT).map(([n, a]) => [n, a.dateien])),
        };
        expect(
            verstoesse(
                gefunden,
                erlaubt,
                () =>
                    "Ein anderes Work Item braucht eine eigene Nummer (npm run anspruch, AGENTS.md „Die Anspruchsliste“); " +
                    "ein Beiblatt zum selben Work Item trägt sich in BEIBLAETTER ein.",
            ),
        ).toEqual([]);
    });

    it("die Ausnahmelisten tragen jede Nummer nur einmal und nennen einen Grund", () => {
        expect(Object.keys(BEIBLAETTER).filter((n) => n in WORK_ITEMS_DOPPELT)).toEqual([]);
        for (const ausnahme of [...Object.values(MIGRATIONEN_DOPPELT), ...Object.values(WORK_ITEMS_DOPPELT)]) {
            expect(ausnahme.grund.length).toBeGreaterThan(20);
        }
    });
});

describe("anspruch --nimm weist eine vergebene Nummer ab", () => {
    it("liest die Nummer aus dem Anspruch und trifft nur genau diese Nummer", () => {
        expect(workItemNummer("WI-0068-P4b")).toBe("WI-0068");
        expect(workItemNummer("wi-0169")).toBe("WI-0169");
        expect(workItemNummer("QR-2026-10-12")).toBeUndefined();
        expect(workItemNummer("WI-01690")).toBeUndefined();

        const dateien = ["WI-0098-klappbox-hoehe.md", "WI-00981-falsch.md", "RWI-0098-anderes.md", "README.md"];
        expect(belegteDateien("WI-0098", dateien)).toEqual(["WI-0098-klappbox-hoehe.md"]);
        expect(belegteDateien("WI-0099", dateien)).toEqual([]);
        expect(hoechsteNummer(["WI-0098-a.md", "WI-0141-b.md", "README.md", "WI-0100-c.md"])).toBe("WI-0141");
    });

    it("prüft gegen origin/master, holt vorher, und lässt Weiterarbeit mit --weiter zu", () => {
        const tmp = mkdtempSync(join(tmpdir(), "anspruch-nummer-"));
        const git = (cwd: string, ...args: string[]): void => {
            const ergebnis = spawnSync("git", args, { cwd, encoding: "utf8", shell: false });
            if (ergebnis.status !== 0) throw new Error(`git ${args.join(" ")}: ${String(ergebnis.stderr)}`);
        };
        const legeAn = (repo: string, name: string): void => {
            mkdirSync(join(repo, "project-control/work-items"), { recursive: true });
            writeFileSync(join(repo, "project-control/work-items", name), `# ${name}\n`, "utf8");
            git(repo, "add", "-A");
            git(repo, "-c", "user.name=T", "-c", "user.email=t@t.invalid", "commit", "--quiet", "-m", name);
            git(repo, "push", "--quiet", "origin", "master");
        };
        const nimm = (cwd: string, ...args: string[]) =>
            spawnSync(process.execPath, [anspruchCli, "--ordner", join(tmp, "claims"), "--bereich", "x/**", ...args], {
                cwd,
                encoding: "utf8",
                shell: false,
                env: { ...process.env, GIT_CEILING_DIRECTORIES: dirname(tmp) },
            });

        try {
            const bare = join(tmp, "origin.git");
            const schreiber = join(tmp, "schreiber");
            const sitzung = join(tmp, "sitzung");
            git(tmp, "init", "--quiet", "--bare", "--initial-branch=master", bare);
            git(tmp, "clone", "--quiet", bare, schreiber);
            legeAn(schreiber, "WI-0001-probe.md");
            git(tmp, "clone", "--quiet", bare, sitzung);
            // Kommt NACH dem Klon: Die Sitzung sieht es nur, wenn der Anspruch vorher holt.
            legeAn(schreiber, "WI-0002-spaet.md");

            const spaet = nimm(sitzung, "--nimm", "WI-0002");
            expect(spaet.status).toBe(3);
            expect(spaet.stderr).toContain("WI-0002-spaet.md");
            expect(spaet.stderr).toContain("--weiter");

            expect(nimm(sitzung, "--nimm", "WI-0001-R2").status).toBe(3);
            const weiter = nimm(sitzung, "--nimm", "WI-0001", "--weiter");
            expect(weiter.status).toBe(0);
            expect(weiter.stdout).toContain("genommen: WI-0001");
            expect(nimm(sitzung, "--nimm", "WI-0003").status).toBe(0);
            expect(nimm(sitzung, "--nimm", "QR-2026-10-15").status).toBe(0);

            // origin weg: Der letzte bekannte Stand gilt weiter, dazu eine Warnung statt eines Abbruchs.
            git(sitzung, "remote", "set-url", "origin", join(tmp, "fehlt.git"));
            const ohneNetz = nimm(sitzung, "--nimm", "WI-0002-R1");
            expect(ohneNetz.status).toBe(3);
            expect(ohneNetz.stderr).toContain("origin nicht erreichbar");
            const frei = nimm(sitzung, "--nimm", "WI-0004");
            expect(frei.status).toBe(0);
            expect(frei.stderr).toContain("origin nicht erreichbar");

            // Kein Repository: nur eine Warnung, der Anspruch geht durch.
            const leer = join(tmp, "leer");
            mkdirSync(leer);
            const ohneRepo = nimm(leer, "--nimm", "WI-0005");
            expect(ohneRepo.status).toBe(0);
            expect(ohneRepo.stderr).toContain("nicht gegen origin geprüft");
        } finally {
            rmSync(tmp, { recursive: true, force: true });
        }
    }, 60_000);
});
