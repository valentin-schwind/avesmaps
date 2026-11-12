import type {
    AbzugEingang,
    AbzugLauf,
    AbzugSchluessel,
    AbzugSchluesselNeu,
    AbzugSichtEinspielen,
    AbzugSichtErstellen,
} from "@avesmaps3d/shared";
import type { AdminCall } from "./verwaltung-stub.ts";

/**
 * Der Abzug für lokal ohne Datenbank (WI-0251): Stände von `GET /api/admin/system/abzug` für `stubAdmin({ answer })`. Die echten Routen gegen
 * PostgreSQL prüfen `apps/server/test/abzug-routes.test.ts` und `abzug-einspielen.test.ts`.
 */
const MINUTE = 60_000;
const ago = (ms: number): string => new Date(Date.now() - ms).toISOString();
const later = (ms: number): string => new Date(Date.now() + ms).toISOString();

export const RONDRIKAN = { art: "person" as const, name: "Rondrikan" };

/** Die Schlüssel zum Abholen auf Stage oder Production: einer gilt (zuletzt vor einer Stunde benutzt), einer ist abgelaufen. */
export const SCHLUESSEL: AbzugSchluessel[] = [
    {
        id: "7e570000-0000-4000-8000-0000000000b1",
        zustand: "gueltig",
        angelegt: ago(2 * 24 * 60 * MINUTE),
        laeuftAb: later(88 * 24 * 60 * MINUTE),
        von: "Rondrikan",
        zuletzt: ago(60 * MINUTE),
    },
    {
        id: "7e570000-0000-4000-8000-0000000000b2",
        zustand: "abgelaufen",
        angelegt: ago(120 * 24 * 60 * MINUTE),
        laeuftAb: ago(30 * 24 * 60 * MINUTE),
        von: "Rondrikan",
        zuletzt: ago(31 * 24 * 60 * MINUTE),
    },
];

/** Der frisch angelegte Schlüssel (ein Testwert, kein echter). */
export const NEUER_SCHLUESSEL: AbzugSchluesselNeu = {
    id: "7e570000-0000-4000-8000-0000000000b3",
    schluessel: `abz_${"Xq7".repeat(14)}A`,
    laeuftAb: later(90 * 24 * 60 * MINUTE),
};

/** Stage oder Production: zwei fertige Abzüge, der letzte Auftrag gelungen. */
export function abzugErstellen(patch: Partial<AbzugSichtErstellen> = {}): AbzugSichtErstellen {
    return {
        rolle: "erstellen",
        jetzt: new Date().toISOString(),
        umgebung: "staging",
        ablage: true,
        planerAktiv: true,
        laufend: null,
        letzter: {
            jobId: "7e570000-0000-4000-8000-0000000000c1",
            state: "SUCCEEDED",
            startedAt: ago(34 * MINUTE),
            finishedAt: ago(29 * MINUTE),
            ausgeloest: RONDRIKAN,
            luecken: null,
            befunde: null,
            satz: null,
            fehler: null,
        },
        abzuege: [
            {
                kennung: "20261024T101500Z-9f3a2c71",
                erstellt: ago(29 * MINUTE),
                bytes: 318 * 1024 * 1024,
                tafeln: 143,
                zeilen: 1_204_331,
                medien: 3372,
                medienBytes: 243 * 1024 * 1024,
                laeuftAb: later(24 * 60 * MINUTE - 29 * MINUTE),
            },
            {
                kennung: "20261023T181000Z-04be88d2",
                erstellt: ago(19 * 60 * MINUTE),
                bytes: 301 * 1024 * 1024,
                tafeln: 143,
                zeilen: 1_187_902,
                medien: 3361,
                medienBytes: 241 * 1024 * 1024,
                laeuftAb: later(5 * 60 * MINUTE),
            },
        ],
        schluessel: SCHLUESSEL,
        ...patch,
    };
}

/** Der Eingang einer gewählten Datei, die zu dieser Datenbank passt. */
export const EINGANG: AbzugEingang = {
    name: "avesmaps-abzug-production-20261024T101500Z-9f3a2c71.tar",
    bytes: 318 * 1024 * 1024,
    kennung: "20261024T101500Z-9f3a2c71",
    quelle: "production",
    erstellt: ago(29 * MINUTE),
    tafeln: 143,
    zeilen: 1_204_331,
    medien: 3372,
    medienBytes: 243 * 1024 * 1024,
    medienFehlend: 4,
    probleme: [],
};

export function abzugEinspielen(patch: Partial<AbzugSichtEinspielen> = {}): AbzugSichtEinspielen {
    return {
        rolle: "einspielen",
        jetzt: new Date().toISOString(),
        ablage: true,
        sicherung: true,
        eingang: null,
        lauf: null,
        schluessel: { staging: false, production: false },
        ...patch,
    };
}

export function lauf(patch: Partial<AbzugLauf> = {}): AbzugLauf {
    return {
        kennung: EINGANG.kennung,
        zustand: "fertig",
        phase: "fertig",
        tafel: null,
        fortschritt: 1,
        seit: ago(13 * MINUTE),
        ende: ago(9 * MINUTE),
        zeilen: 1_187_902,
        sicherung: "vorher-20261023T181000Z-04be88d2-20261024T102400Z.dump",
        meldung: null,
        medien: { dateien: 3372, geschrieben: 3372, offen: 0, bytes: 243 * 1024 * 1024 },
        ...patch,
    };
}

/** Das Holen läuft: Stage, 43 % der Datei sind da. */
export function laufHolen(patch: Partial<AbzugLauf> = {}): AbzugLauf {
    return lauf({
        kennung: "20261025T100000Z-abcdef12",
        zustand: "laeuft",
        phase: "holen",
        tafel: null,
        fortschritt: 0.43,
        seit: ago(2 * MINUTE),
        ende: null,
        zeilen: null,
        sicherung: null,
        medien: null,
        holen: { quelle: "staging", geladen: 900 * 1024 * 1024, gesamt: 2100 * 1024 * 1024 },
        ...patch,
    });
}

const QUITTUNG = (call: AdminCall) => ({
    status: 200,
    body: {
        operationId: call.body?.["operationId"],
        status: "applied",
        environment: "development",
        affected: [],
        derivedWork: [],
        warnings: [],
    },
});

/**
 * Beantwortet `GET /api/admin/system/abzug` (der Stand darf eine Funktion sein, damit eine Handlung ihn ändern kann) und die Handlungen des Abholens
 * (Schlüssel anlegen, widerrufen, hinterlegen, holen); alles andere bleibt dem Stub der Verwaltung.
 */
export function abzugAntwort(
    stand: AbzugSichtErstellen | AbzugSichtEinspielen | (() => AbzugSichtErstellen | AbzugSichtEinspielen),
) {
    return (call: AdminCall): { status: number; body: unknown } | undefined => {
        if (call.method === "GET" && call.path === "/api/admin/system/abzug") {
            return { status: 200, body: typeof stand === "function" ? stand() : stand };
        }
        if (call.method !== "POST") return undefined;
        if (call.path === "/api/admin/system/abzug/schluessel") return { status: 200, body: NEUER_SCHLUESSEL };
        if (
            call.path === "/api/admin/system/abzug/schluessel/widerrufen" ||
            call.path === "/api/admin/system/abzug/quelle" ||
            call.path === "/api/admin/system/abzug/holen"
        ) {
            return QUITTUNG(call);
        }
        return undefined;
    };
}
