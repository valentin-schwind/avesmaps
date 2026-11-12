import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { leseWarteschlangeStand, type WarteschlangePause } from "@avesmaps3d/shared";
import { AUFTRAG_WRAPPER, lokalerBefehl, sudoBefehl } from "../src/jobs/dirigent/ausfuehrer.ts";
import { dirigentKonfiguration } from "../src/jobs/dirigent/konfiguration.ts";
import type { ReiheEintrag } from "../src/jobs/dirigent/plan.ts";
import { SYSTEM_CHANGED_CHANNEL } from "../src/jobs/dirigent/quelle.ts";
import { baueStand, schreibeStand } from "../src/jobs/dirigent/stand.ts";
import type { JobRow } from "../src/jobs/rows.ts";
import { SYSTEM_CHANNEL } from "../src/system/state-store.ts";

/**
 * Die Bauteile des Dirigenten ohne Datenbank (WI-0163 §5): Konfiguration aus der Umgebung, die Befehle der zwei Ausführer, die
 * Stand-Datei (Vertrag beim Schreiben, atomar, 0644).
 */

describe("Dirigent: Konfiguration (§5.3)", () => {
    it("ohne DIRIGENT_UMGEBUNGEN genau eine Umgebung aus AVESMAPS_ENV (sonst development) mit der Verbindung der Jobs", () => {
        expect(dirigentKonfiguration({ DATABASE_URL: "postgres://app" })).toEqual({
            umgebungen: [{ umgebung: "development", url: "postgres://app", ausfuehrerEnv: {} }],
            ausfuehrer: "lokal",
            standDatei: undefined,
        });
        expect(
            dirigentKonfiguration({
                AVESMAPS_ENV: "staging",
                JOBS_DATABASE_URL: "postgres://jobs",
                DATABASE_URL: "postgres://app",
                QUEUE_STAND_FILE: "/var/lib/avesmaps3d/warteschlange/stand.json",
            }),
        ).toMatchObject({
            umgebungen: [{ umgebung: "staging", url: "postgres://jobs" }],
            standDatei: "/var/lib/avesmaps3d/warteschlange/stand.json",
        });
    });

    it("DIRIGENT_UMGEBUNGEN mit DIRIGENT_DB_<UMGEBUNG>; der lokale Ausführer bekommt Umgebung und Verbindung", () => {
        const konfiguration = dirigentKonfiguration({
            DIRIGENT_UMGEBUNGEN: "staging, production",
            DIRIGENT_DB_STAGING: "postgres://stage",
            DIRIGENT_DB_PRODUCTION: "postgres://prod",
            DIRIGENT_AUSFUEHRER: "sudo",
        });
        expect(konfiguration.ausfuehrer).toBe("sudo");
        expect(konfiguration.umgebungen).toEqual([
            {
                umgebung: "staging",
                url: "postgres://stage",
                ausfuehrerEnv: { AVESMAPS_ENV: "staging", JOBS_DATABASE_URL: "postgres://stage" },
            },
            {
                umgebung: "production",
                url: "postgres://prod",
                ausfuehrerEnv: { AVESMAPS_ENV: "production", JOBS_DATABASE_URL: "postgres://prod" },
            },
        ]);
    });

    it("ein ungültiger Wert hält den Start an, ohne eine Verbindung zu nennen", () => {
        expect(() => dirigentKonfiguration({})).toThrow(/JOBS_DATABASE_URL noch DATABASE_URL/);
        expect(() => dirigentKonfiguration({ DATABASE_URL: "x", DIRIGENT_AUSFUEHRER: "ssh" })).toThrow(
            /DIRIGENT_AUSFUEHRER/,
        );
        expect(() => dirigentKonfiguration({ DIRIGENT_UMGEBUNGEN: "staging,stage" })).toThrow(/"stage"/);
        expect(() => dirigentKonfiguration({ DIRIGENT_UMGEBUNGEN: "staging,staging" })).toThrow(/zweimal/);
        expect(() =>
            dirigentKonfiguration({
                DIRIGENT_UMGEBUNGEN: "staging,production",
                DIRIGENT_DB_STAGING: "postgres://geheim",
            }),
        ).toThrow(/^DIRIGENT_DB_PRODUCTION fehlt/);
        expect(() => dirigentKonfiguration({ DATABASE_URL: "x", AVESMAPS_ENV: "prod" })).toThrow(/AVESMAPS_ENV/);
    });
});

describe("Dirigent: Ausführer (§5.2)", () => {
    it("lokal: auftrag-cli neben dem Dirigenten, mit derselben Endung, als Kind von node", () => {
        const befehl = lokalerBefehl({ id: 42, kind: "media_derive" });
        expect(befehl.command).toBe(process.execPath);
        // Die Tests laufen aus `src/`, also `.ts`; aus `dist/` wäre es `.js`.
        expect(basename(befehl.args[0] ?? "")).toBe("auftrag-cli.ts");
        expect(befehl.args.slice(1)).toEqual(["--job", "42", "--art", "media_derive"]);
        expect(lokalerBefehl("pflege").args.slice(1)).toEqual(["--pflege"]);
    });

    it("sudo: Claudios Wrapper, nicht interaktiv, Umgebung zuerst", () => {
        expect(sudoBefehl("production", { id: 7, kind: "terrain_full" })).toEqual({
            command: "sudo",
            args: ["-n", AUFTRAG_WRAPPER, "production", "7", "terrain_full"],
        });
        expect(sudoBefehl("staging", "pflege")).toEqual({
            command: "sudo",
            args: ["-n", "/usr/local/sbin/avesmaps3d-auftrag", "staging", "--pflege"],
        });
    });
});

describe("Dirigent: Quelle", () => {
    it("der abgeschriebene Kanal des Betriebszustands ist derselbe wie im Server", () => {
        expect(SYSTEM_CHANGED_CHANNEL).toBe(SYSTEM_CHANNEL);
    });
});

const NOW = Date.parse("2026-10-15T12:00:00.000Z");

function job(partial: Partial<JobRow> & { id: number; kind: string }): JobRow {
    const queuedAt = new Date(NOW - 60_000);
    return {
        publicId: `00000000-0000-4000-8000-${String(partial.id).padStart(12, "0")}`,
        kindVersion: 1,
        mapDomainId: "aventuria",
        origin: "queued",
        actorRef: null,
        externalRef: null,
        label: null,
        inputRef: {},
        state: "QUEUED",
        waitReason: null,
        priority: 50,
        queuedAt,
        notBefore: null,
        firstRequestedAt: queuedAt,
        coalescedCount: 0,
        scopeKind: "tiles",
        scopeTiles: [],
        attempt: 0,
        leaseOwner: null,
        leaseNo: 0,
        leaseExpiresAt: null,
        heartbeatAt: null,
        phase: null,
        progress: null,
        cancelRequestedAt: null,
        cancelReason: null,
        startedAt: null,
        finishedAt: null,
        rssPeakMb: null,
        arrayBufferPeakMb: null,
        cpuMs: null,
        wallMs: null,
        swapSeenMb: null,
        memExpectedMb: null,
        phaseStats: {},
        findings: [],
        result: null,
        errorCode: null,
        errorSummary: null,
        dependsOn: [],
        ...partial,
    };
}

const LAEUFT: WarteschlangePause = {
    paused: false,
    umgebung: null,
    changedAt: null,
    since: null,
    by: null,
    byLabel: null,
    reason: null,
};

describe("Dirigent: Stand-Datei (§5.1)", () => {
    const reihe: ReiheEintrag[] = [
        {
            umgebung: "staging",
            job: job({
                id: 3,
                kind: "terrain_full",
                state: "RUNNING",
                startedAt: new Date(NOW - 5_000),
                phase: "rechnen",
                progress: 1.5,
            }),
            platz: null,
            wartegrund: null,
            schwer: true,
        },
        {
            umgebung: "production",
            job: job({ id: 3, kind: "media_derive", label: "x".repeat(260) }),
            platz: 1,
            wartegrund: "waits_slot",
            schwer: false,
        },
        // Eine Art außerhalb des Vertrags fällt einzeln heraus, statt die ganze Reihe unlesbar zu machen.
        { umgebung: "staging", job: job({ id: 4, kind: "Kaputt-Art" }), platz: 2, wartegrund: null, schwer: true },
    ];

    it("🔴 der Vertrag wird beim Schreiben eingehalten: Freitexte gekürzt, ein unpassender Auftrag fällt einzeln heraus", () => {
        const { stand, verworfen } = baueStand({
            nowMs: NOW,
            dirigent: { instanz: "vps:1", release: "abc123", taktS: 2 },
            pause: LAEUFT,
            umgebungen: [
                { name: "staging", erreichbar: true, planer: true },
                { name: "production", erreichbar: true, planer: true },
            ],
            reihe,
        });
        expect(verworfen).toBe(1);
        expect(leseWarteschlangeStand(JSON.parse(JSON.stringify(stand)))).not.toBeNull();
        expect(stand.at).toBe("2026-10-15T12:00:00.000Z");
        expect(stand.auftraege.map((entry) => [entry.umgebung, entry.id, entry.state, entry.platz])).toEqual([
            ["staging", 3, "RUNNING", null],
            ["production", 3, "QUEUED", 1],
        ]);
        expect(stand.auftraege[0]).toMatchObject({ progress: 1, phase: "rechnen", schwer: true });
        expect(stand.auftraege[1]?.label).toHaveLength(200);
    });

    it("atomar geschrieben (keine temporäre Datei bleibt), Verzeichnis angelegt, lesbar für andere (0644)", async () => {
        const verzeichnis = await mkdtemp(join(tmpdir(), "stand-"));
        try {
            const pfad = join(verzeichnis, "warteschlange", "stand.json");
            const { stand } = baueStand({
                nowMs: NOW,
                dirigent: { instanz: "vps:1", release: null, taktS: 2 },
                pause: LAEUFT,
                umgebungen: [{ name: "staging", erreichbar: false, planer: false }],
                reihe: [],
            });
            await schreibeStand(pfad, stand);
            await schreibeStand(pfad, { ...stand, at: "2026-10-15T12:00:02.000Z" });
            expect(leseWarteschlangeStand(JSON.parse(await readFile(pfad, "utf8")))?.at).toBe(
                "2026-10-15T12:00:02.000Z",
            );
            expect(await readdir(join(verzeichnis, "warteschlange"))).toEqual(["stand.json"]);
            if (process.platform !== "win32") expect((await stat(pfad)).mode & 0o777).toBe(0o644);
        } finally {
            await rm(verzeichnis, { recursive: true, force: true });
        }
    });
});
