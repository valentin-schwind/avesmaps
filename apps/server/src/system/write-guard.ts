import type { FastifyInstance, FastifyRequest } from "fastify";
import type { SystemLock, SystemLockedDetails } from "@avesmaps3d/shared";
import { ApiError } from "../http/api-error.ts";

/**
 * Die Naht an den Schreibwegen (WI-0127 SYS-4, SYS-0001 §3.3, §4.4; Betreiber E4 „unterscheide zwischen system und karte“).
 *
 * Jede Route mit `POST`, `PUT`, `PATCH` oder `DELETE` erklärt in ihren Optionen eine Klasse (`config.writeClass`), so wie sie ihr Recht
 * erklärt (`config.auth`); `apps/server/test/system-write-classes.test.ts` zählt alle Routen und verlangt sie. Ein Wächter am Root
 * prüft die Klasse gegen den Betriebszustand im Speicher dieser Instanz (`app.systemState`), bevor die Route läuft:
 *
 * | Klasse     | was                                                                     | Kartensperre     | Systemsperre        |
 * |------------|-------------------------------------------------------------------------|------------------|---------------------|
 * | `map`      | Kartendaten und Inhalte (Editor, Medien, Quellen, Literatur)            | 423 `map_locked` | offen               |
 * | `system`   | Einstellungen und Verwaltung, die etwas gewährt oder einrichtet         | offen            | 423 `system_locked` |
 * | `security` | Sicherheitshandgriffe: sperren, Sitzungen beenden, entziehen, Sperren   | offen            | offen               |
 * | `account`  | das eigene Konto und die Anmeldung: Passwort, Passkey, Abmelden         | offen            | offen               |
 * | `public`   | ohne Anmeldung: Kurzlink, Rechnen per POST, Meldungen und Statusseite   | offen            | offen               |
 * | `import`   | einen Import auslösen (Abgleiche, WI-0127 SYS-14)                       | offen            | offen               |
 * | `kanal`    | der Betreiber-Kanal (WI-0124): melden, antworten, abnehmen, löschen      | offen            | offen               |
 * | `community`| die Redaktion der Community (WI-0268): sichten, abschließen, moderieren  | offen            | offen               |
 *
 * - **Meldungen der Community** (WI-0268): Der Eingang (Meldeformular, Statusseite) schreibt `public`, die Redaktion `community`; beide hängen
 *   an keiner Sperre. Gemeldet wird gerade dann, wenn etwas gesperrt ist, und ein Legacy-Zug (Kartensperre) darf die Formulare nicht abschalten.
 * - **Das Umschalten selbst** (`/api/admin/system/mode`, `/lock`) ist `security`: Eine Sperre lässt sich immer lösen, sonst sperrte sie
 *   sich selbst ein. Die Kommandozeile (`betrieb-normal`, `sperre-loesen`) geht ohnehin an HTTP vorbei.
 * - **Mit Richtung** (`by_direction`): Die Route weiß erst im Handler, ob sie gewährt (Rolle hoch, Zugang zurück: `system`) oder
 *   schützt (Rolle herab: `security`), und ruft dann `assertWritable(request, klasse)`.
 * - 🔴 **Unbekannter Zustand** (Datenbank weg, Zeile unlesbar, Stand älter als 30 s): `map` und `system` antworten 503
 *   `system_state_unknown` mit `Retry-After` (fail-closed, Claudio 2026-10-09 Punkt 4), denn eine Sperre könnte gesetzt sein. Alle
 *   übrigen Klassen hängen an keiner Sperre und laufen weiter; ihre eigenen Fehler (`database_unavailable`, `auth_unavailable`) bleiben.
 * - **Wann:** als `preHandler`, also nach Anmeldung, Recht und Schemaprüfung. Wer nicht darf, bekommt 401/403 und erfährt nichts über
 *   die Sperre; eine Route mit Richtung prüft ohnehin erst im Handler.
 * - **Laufendes** endet normal; die Sperre gilt für Anfragen, die nach ihrem Eintreffen auf dieser Instanz beginnen (das `NOTIFY` der
 *   Migration 0087 trägt sie binnen einer Sekunde zu jeder Instanz).
 * - **Importe** (`import`): Die Kartensperre hält Importe nicht an (Betreiber 2026-10-10, SYS-0001 §9a Frage 3: „nein auf keinen fall“),
 *   also auch nicht ihren Start aus der Verwaltung; die Systemsperre betrifft Rechte und Einstellungen, keinen Zug. Was eine Person
 *   bewusst gesetzt hat, hebt kein Import auf (AGENTS.md „Blockierende Prüfungen im Betrieb“).
 * - Der eingeschränkte Betrieb für HTTP (503 `restricted_mode` ohne Zugangsrecht, §4.4) ist der App-Hook der Tür (SYS-3), nicht diese
 *   Naht; `/ws` prüft ihn am Handschlag (`routes/realtime.ts`).
 */

declare module "fastify" {
    interface FastifyContextConfig {
        /** Die Klasse des Schreibwegs (SYS-4); jede Route mit POST, PUT, PATCH oder DELETE trägt eine. */
        writeClass?: RouteWriteClass;
    }
}

export const WRITE_CLASSES = [
    "map",
    "system",
    "security",
    "account",
    "public",
    "import",
    "kanal",
    "community",
] as const;
export type WriteClass = (typeof WRITE_CLASSES)[number];
/** Was eine Route erklärt: eine Klasse, oder `by_direction`, wenn erst der Inhalt entscheidet. */
export type RouteWriteClass = WriteClass | "by_direction";

export const WRITE_METHODS: ReadonlySet<string> = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const LOCKED: Record<SystemLock, { code: "map_locked" | "system_locked"; message: string }> = {
    map: {
        code: "map_locked",
        message: "Die Karte ist gerade gesperrt: Änderungen an Kartendaten und Inhalten sind angehalten.",
    },
    system: {
        code: "system_locked",
        message: "Das System ist gerade gesperrt: Änderungen an Einstellungen und Verwaltung sind angehalten.",
    },
};

/** 503 `system_state_unknown`; `Retry-After` setzt der Fehlerhandler für jedes 503. */
export function systemStateUnknown(): ApiError {
    return new ApiError(503, "system_state_unknown", "Der Betriebszustand ist gerade nicht bekannt.");
}

/**
 * Darf diese Anfrage jetzt in dieser Klasse schreiben? Wirft 423 `map_locked`/`system_locked` oder 503 `system_state_unknown`. Ohne
 * Speicher (eine Instanz ohne Datenbank) gilt der Zustand als unbekannt, wie in `app.ts` festgehalten.
 */
export async function assertWritable(request: FastifyRequest, writeClass: WriteClass): Promise<void> {
    if (writeClass !== "map" && writeClass !== "system") return;
    const store = request.server.systemState;
    const snapshot = store?.snapshot();
    if (store === undefined || snapshot === undefined || snapshot.source === "unknown") throw systemStateUnknown();
    const locked = writeClass === "map" ? snapshot.mapLock : snapshot.systemLock;
    if (locked !== true) return;
    const setter = store.lockSetter(writeClass);
    const details: SystemLockedDetails = { since: setter?.since?.toISOString() ?? null };
    if (setter?.reason != null && (await mayReadReason(request))) details.reason = setter.reason;
    const { code, message } = LOCKED[writeClass];
    throw new ApiError(423, code, message, details);
}

/** Den Grund sieht nur, wer die Verwaltung lesen darf (SYS-0001 §4.6); scheitert die Frage, bleibt er weg. */
async function mayReadReason(request: FastifyRequest): Promise<boolean> {
    try {
        return (await request.auth.capabilities()).has("view_operations");
    } catch {
        return false;
    }
}

/**
 * Der Wächter am Root (vor allen `register`-Aufrufen, wie `registerAuth`). Eine schreibende Route ohne Klasse behandelt er wie `map`,
 * die strengste: Fällt eine trotz des Tests durch, ist sie gesperrt statt offen.
 */
export function registerWriteGuard(app: FastifyInstance): void {
    app.addHook("preHandler", async (request) => {
        if (!WRITE_METHODS.has(request.method) || request.is404) return;
        const declared = request.routeOptions.config.writeClass;
        if (declared === "by_direction") return;
        await assertWritable(request, declared ?? "map");
    });
}
