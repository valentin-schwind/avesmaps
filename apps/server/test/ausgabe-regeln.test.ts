import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
    gleicheAb,
    kennungVon,
    leseGitleaks,
    leseTrufflehog,
    pfadFehler,
    PFLICHT_TEXTE,
    relativZumBaum,
    scanneText,
    waehleAusgabe,
    type BaumEintrag,
    type BekannterFund,
} from "../../../scripts/ausgabe/ausgabe-regeln.ts";

/**
 * Die Regeln der öffentlichen Ausgabe (`scripts/ausgabe/ausgabe-regeln.ts`, WI-0303 P1, P2). Problemfälle: Eine private Datei (Arbeitsregeln,
 * Planung, Betrieb) ginge mit hinaus; ein Workflow im Zweig liefe dort bei jedem Push; ein Name der Liste oder ein Geheimnis rutschte durch;
 * ein bekannter Fund hielte nach einer verschobenen Zeile wieder an; ein bestätigtes Geheimnis ginge hinaus, weil es als bekannt eingetragen
 * ist; der Musterscan fände seine eigenen Muster.
 */
const blob = (pfad: string, modus = "100644"): BaumEintrag => ({ modus, objekt: "0".repeat(40), pfad });
const pflicht = PFLICHT_TEXTE.map((p) => blob(`oeffentlich/${p}`));
/** Setzt Attrappen aus Teilen zusammen: Wörtlich hielte der Musterscan diese Datei an. */
const teile = (...stuecke: string[]): string => stuecke.join("");

describe("waehleAusgabe", () => {
    it("🔴 nimmt die Positivliste, legt oeffentlich/ an die Wurzel und lässt alles Private draußen", () => {
        const { eintraege, fehler } = waehleAusgabe([
            ...pflicht,
            blob("oeffentlich/.env.example"),
            blob("apps/server/src/app.ts"),
            blob("packages/shared/src/index.ts"),
            blob("docs/schnittstellen/karten-api.md"),
            blob("package.json"),
            blob("AGENTS.md"),
            blob("CLAUDE.md"),
            blob("README.md"),
            blob("docs/regeln/entwicklung.md"),
            blob("docs/planning/kapitel.md"),
            blob("project-control/state/current.md"),
            blob("ops/production/deploy.sh"),
            blob(".claude/skills/work-item/SKILL.md"),
            blob(".github/workflows/oeffentliche-ausgabe.yml"),
            blob("assets/fonts/OFL-FacultyGlyphic.txt"),
            blob("assets/anderes.png"),
        ]);
        expect(fehler).toEqual([]);
        expect(eintraege.map((e) => e.pfad)).toEqual([
            ".env.example",
            "CONTRIBUTING.md",
            "LEGAL.md",
            "LICENSE",
            "NOTICE.md",
            "README.md",
            "SECURITY.md",
            "apps/server/src/app.ts",
            "assets/fonts/OFL-FacultyGlyphic.txt",
            "docs/schnittstellen/karten-api.md",
            "package.json",
            "packages/shared/src/index.ts",
        ]);
    });

    it("🔴 hält an bei Link, Submodul, doppeltem Pfad und fehlendem Pflichttext", () => {
        const { fehler } = waehleAusgabe([
            ...pflicht.filter((e) => !e.pfad.endsWith("/LICENSE")),
            blob("apps/web/link", "120000"),
            blob("tools/fremd", "160000"),
            blob("oeffentlich/package.json"),
            blob("package.json"),
        ]);
        expect(fehler).toEqual([
            "symbolischer Link: apps/web/link",
            "Submodul: tools/fremd",
            "doppelt im Zweig: package.json (aus oeffentlich/ und aus dem Stand)",
            "fehlt an der Wurzel: LICENSE (gehört nach oeffentlich/)",
        ]);
    });
});

describe("pfadFehler", () => {
    const fehlerVon = (pfad: string, groesse = 10): string | undefined => pfadFehler({ pfad, groesse });

    it("🔴 Workflows, Umgebungs- und Schlüsseldateien gehen nie hinaus, das Beispiel schon", () => {
        expect(fehlerVon(".github/workflows/ci.yml")).toMatch(/^Workflow im Zweig/);
        expect(fehlerVon(".env")).toBe("Umgebungsdatei: .env");
        expect(fehlerVon("apps/server/.env.production")).toBe("Umgebungsdatei: apps/server/.env.production");
        expect(fehlerVon("apps/server/test/fixtures/server.pem")).toMatch(/^Schlüssel- oder Zugangsdatei/);
        expect(fehlerVon("tools/id_ed25519")).toMatch(/^Schlüssel- oder Zugangsdatei/);
        expect(fehlerVon(".npmrc")).toMatch(/^Schlüssel- oder Zugangsdatei/);
        expect(fehlerVon("apps/web/big.bin", 51 * 1024 * 1024)).toBe("Datei über 50 MiB: apps/web/big.bin");
        expect(fehlerVon(".env.example")).toBeUndefined();
        expect(fehlerVon("apps/server/.env.example")).toBeUndefined();
        expect(fehlerVon(".github/ISSUE_TEMPLATE/fehler.md")).toBeUndefined();
        expect(fehlerVon("apps/server/src/auth/key-rotation.ts")).toBeUndefined();
    });
});

describe("scanneText", () => {
    const regelnIn = (text: string): string[] => scanneText("x.ts", text).map((f) => f.regel);

    it("🔴 findet die Namen der Liste, nicht aber das Monatskürzel einer Datumsangabe", () => {
        expect(regelnIn(`// Fund von ${teile("Not", "tel")}s Testbild`)).toEqual(["name-dritter"]);
        expect(regelnIn(`zeichnerin: "Hannah ${teile("Möll", "mann")}"`)).toEqual(["name-dritter"]);
        expect(regelnIn(`["${teile("Ja", "n")}", "${teile("Mi", "ra")}"]`)).toEqual(["name-dritter", "name-dritter"]);
        expect(regelnIn(`"last_modified": "Mon, 26 ${teile("Ja", "n")} 2026 20:18:50 GMT"`)).toEqual([]);
        expect(regelnIn(`Ina Kramer, Thomas, Vali`)).toEqual([]);
    });

    it("🔴 findet Geheimnisse dieses Projekts und private Schlüssel, mit Zeile und Kennung statt Wert", () => {
        const token = teile("gh", "p_", "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0");
        const text = [
            "ok",
            teile("-----BEGIN OPENSSH ", "PRIVATE KEY-----"),
            `const t = "${token}";`,
            `DATABASE_URL=${teile("postgres", "://app:geheim@127.0.0.1/db")}`,
            `const k = "${teile("av", "k_", "x".repeat(32))}";`,
        ].join("\n");
        const funde = scanneText("x.ts", text);
        expect(funde.map((f) => [f.regel, f.zeile])).toEqual([
            ["privater-schluessel", 2],
            ["github-token", 3],
            ["datenbank-kennwort", 4],
            ["karten-schluessel", 5],
        ]);
        expect(funde[1]?.kennung).toBe(kennungVon(token));
        expect(JSON.stringify(funde)).not.toContain(token);
    });

    it("🔴 findet in den eigenen Dateien nichts: die Muster stehen nur in Teilen da", () => {
        for (const datei of [
            "../../../scripts/ausgabe/ausgabe-regeln.ts",
            "../../../scripts/ausgabe/ausgabe.ts",
            "./ausgabe-regeln.test.ts",
        ]) {
            expect(scanneText(datei, readFileSync(new URL(datei, import.meta.url), "utf8"))).toEqual([]);
        }
    });
});

describe("Berichte der Scanner", () => {
    it("🔴 liest gitleaks und trufflehog mit Pfaden relativ zum Baum, unter Windows wie unter Linux", () => {
        expect(relativZumBaum("C:\\tmp\\baum\\apps\\a.ts", "C:\\tmp\\baum")).toBe("apps/a.ts");
        expect(relativZumBaum("/tmp/baum/apps/a.ts", "/tmp/baum/")).toBe("apps/a.ts");
        const gitleaks = leseGitleaks(
            JSON.stringify([{ RuleID: "generic-api-key", File: "/tmp/baum/apps/a.ts", StartLine: 7, Secret: "s3" }]),
            "/tmp/baum",
        );
        expect(gitleaks).toEqual([
            { werkzeug: "gitleaks", regel: "generic-api-key", datei: "apps/a.ts", zeile: 7, kennung: kennungVon("s3") },
        ]);
        const zeilen = [
            `{"level":"info","msg":"running source"}`,
            JSON.stringify({
                DetectorName: "Postgres",
                Verified: true,
                Raw: "r4",
                SourceMetadata: { Data: { Filesystem: { file: "/tmp/baum/apps/b.ts", line: 3 } } },
            }),
            "",
        ].join("\n");
        expect(leseTrufflehog(zeilen, "/tmp/baum")).toEqual([
            {
                werkzeug: "trufflehog",
                regel: "Postgres",
                datei: "apps/b.ts",
                zeile: 3,
                kennung: kennungVon("r4"),
                bestaetigt: true,
            },
        ]);
    });
});

describe("gleicheAb", () => {
    const bekannt: BekannterFund = {
        werkzeug: "gitleaks",
        regel: "r",
        datei: "a.ts",
        kennung: "k1",
        grund: "Attrappe",
    };

    it("🔴 erkennt einen bekannten Fund auch in einer anderen Zeile, hält bei neuem und bestätigtem an", () => {
        const verschoben = { werkzeug: "gitleaks" as const, regel: "r", datei: "a.ts", zeile: 99, kennung: "k1" };
        const andererWert = { ...verschoben, kennung: "k2" };
        const bestaetigt = { ...verschoben, werkzeug: "trufflehog" as const, bestaetigt: true };
        const trufflehogBekannt: BekannterFund = { ...bekannt, werkzeug: "trufflehog" };
        const { neu, ungenutzt } = gleicheAb([verschoben, andererWert, bestaetigt], [bekannt, trufflehogBekannt]);
        expect(neu).toEqual([andererWert, bestaetigt]);
        expect(ungenutzt).toEqual([]);
        expect(gleicheAb([], [bekannt]).ungenutzt).toEqual([bekannt]);
    });

    it("🔴 jeder eingetragene Fund hat einen Grund", () => {
        const datei = new URL("../../../scripts/ausgabe/bekannte-funde.json", import.meta.url);
        const { funde } = JSON.parse(readFileSync(datei, "utf8")) as { funde: BekannterFund[] };
        expect(funde.length).toBeGreaterThan(0);
        expect(funde.filter((f) => f.grund.trim().length === 0 || !/^[0-9a-f]{16}$/.test(f.kennung))).toEqual([]);
    });
});
