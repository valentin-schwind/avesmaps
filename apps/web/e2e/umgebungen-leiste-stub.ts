import type { Page } from "@playwright/test";
import {
    RELEASE_TEST_URL,
    UMGEBUNGEN_URL,
    type FreigabeSicht,
    type ReleaseTestSicht,
    type UmgebungenStand,
} from "@avesmaps3d/shared";
import { ADMIN_CAPABILITIES, stubAdmin } from "./verwaltung-stub.ts";

/**
 * Die Lagen der Leiste „Lokal → Stage → Production“ in „Umgebungen“ (WI-0248) für die Spec und das Abnahmeblatt: Sitzung, Statusdatei der Freigabe,
 * Stand je Umgebung und Release-Test sind gestubbt. Was die Leiste rechnet, prüft `test/umgebungen-leiste.test.ts`.
 */
export const OPERATOR = [
    ...ADMIN_CAPABILITIES,
    "manage_system_settings",
    "release_to_production",
    "switch_environment",
];
export const STAGE_SHA = "a7728a1".padEnd(40, "0");
export const AUFTRAG_SHA = "b2ee1b3".padEnd(40, "0");

export const SICHT: FreigabeSicht = {
    now: "2026-10-24T08:00:00.000Z",
    datei: {
        schema: 1,
        standAt: "2026-10-24T07:59:00.000Z",
        production: { release: "b2ee1b3", commit: AUFTRAG_SHA, seit: "2026-10-18T00:17:00.000Z" },
        stage: { release: "a7728a1", commit: STAGE_SHA, seit: "2026-10-23T18:46:00.000Z" },
        stageGruen: true,
        stagePruefung: "Proben und Journal gruen; Sammellauf gruen",
        technik: { migrationen: ["0207"], rechte: [], umgebungswerte: [] },
        themen: [
            {
                id: "WI-0139",
                name: "Neuigkeiten",
                satz: "Unter „Neuigkeiten“ steht jetzt, was sich getan hat.",
                unredigiert: false,
                marken: [],
                anzahl: 3,
                bis: "b81d356",
            },
            {
                id: "WI-0249",
                name: "Höhenmodell",
                satz: "Das Gelände bekommt Nebengipfel und weichere Hügel.",
                unredigiert: false,
                marken: ["migration"],
                anzahl: 5,
                bis: "3429bab",
            },
        ],
        nachweis: "gruen",
    },
    sperre: null,
    laeuft: null,
    frueher: [
        {
            ops: "OPS-000122",
            release: "20261018T001700Z-b2ee1b3",
            at: "2026-10-18T00:17:00.000Z",
            wer: "Vali",
            art: "release",
            themen: 4,
        },
    ],
    freigabe: null,
} as unknown as FreigabeSicht;

export const STAGE_ROUTE: UmgebungenStand = {
    eigene: { releaseId: "20261023T184600Z-a7728a1" },
    gegenseite: { releaseId: "20261018T001700Z-b2ee1b3", erreichbar: true },
    lokal: null,
};

export const PRODUCTION_ROUTE: UmgebungenStand = {
    eigene: { releaseId: "20261018T001700Z-b2ee1b3" },
    gegenseite: { releaseId: "20261023T184600Z-a7728a1", erreichbar: true },
    lokal: null,
};

export const TEST: ReleaseTestSicht = {
    now: new Date().toISOString(),
    verfuegbar: true,
    fehler: null,
    // WI-0248: Geprüft und freigegeben wird der Stage-Stand; die Freigabe entsteht mit dem Start des Release-Tests (hier: wartet auf ihn).
    kandidat: {
        stage: { sha: STAGE_SHA, zeit: "2026-10-23T18:46:00Z" },
        auftrag: null,
        freigabe: {
            sha: STAGE_SHA,
            zeit: "2026-10-23T20:00:00Z",
            kennung: "RT-00000000-0000-4000-8000-000000000001",
            von: "Vali",
            zustand: "wartet",
            ausliefern: false,
            grund: "Der Release-Test hat noch nicht begonnen.",
        },
    },
    lauf: {
        zustand: "keiner",
        fertigeTeile: [],
        sperre: false,
        jetzt: new Date().toISOString(),
        schritte: [],
        erwartetMs: 8_740_000,
        erwartetSchaetzung: true,
        fortschritt: 0,
    },
    start: null,
};

export interface Lage {
    environment: "development" | "staging" | "production";
    sicht?: FreigabeSicht;
    route?: UmgebungenStand;
    test?: ReleaseTestSicht;
    /** Jede Anfrage der Seite an die API mit ihrem Pfad (für Zählungen). */
    beiAnruf?: (pfad: string) => void;
    /** Wo die Seite aufgeht und worauf `oeffne` wartet; Vorgabe: gleich im Reiter „Umgebungen“. */
    ort?: { url: string; warteAuf: string };
}

/** Öffnet „Umgebungen“ in der Lage und wartet auf die Leiste. */
export async function oeffne(page: Page, lage: Lage): Promise<void> {
    await stubAdmin(page, {
        capabilities: OPERATOR,
        role: "operator",
        person: { passkeyCount: 1 },
        environment: lage.environment,
        answer: (call) => {
            lage.beiAnruf?.(call.path);
            if (call.path.startsWith("/api/admin/system/production") && lage.sicht !== undefined)
                return { status: 200, body: lage.sicht };
            if (call.path.startsWith(UMGEBUNGEN_URL) && lage.route !== undefined)
                return { status: 200, body: lage.route };
            if (call.path.startsWith(RELEASE_TEST_URL) && lage.test !== undefined)
                return { status: 200, body: lage.test };
            if (call.path.startsWith("/api/admin/system/karteneinstellungen"))
                return {
                    status: 200,
                    body: {
                        now: new Date().toISOString(),
                        revision: 1,
                        source: "database",
                        rows: [],
                        unknownKeys: [],
                        privat: [],
                    },
                };
            return undefined;
        },
    });
    await page.goto(lage.ort?.url ?? "/?verwaltung=production");
    await page.getByTestId(lage.ort?.warteAuf ?? "umgebungen-leiste").waitFor({ timeout: 20_000 });
}
