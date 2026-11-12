import { readFileSync } from "node:fs";
import type { Page, Response } from "@playwright/test";

/**
 * Die Wegwerf-Welt für Browserfälle OHNE Stubs (WI-0252): echter Fastify, echte Datenbank, echte Daten, die Sitzung einer Testperson.
 *
 * 🔴 Anlass: „Wege löschen“ und „Flächen vereinigen“ waren in allen Browserfällen grün (Stubs) und gingen auf der Stage nicht. Erst echte
 * Daten zeigten, woran es hing: Ränder, die sich selbst kreuzen (500 „side location conflict“), eine Nachbarabfrage, die an großen
 * Flächen 99 s brauchte (503 an der Zeitgrenze), ein Grau ohne sichtbaren Grund. Stubs sehen das nie.
 *
 * Die Welt ist NIE die Entwicklungsdatenbank, die Stage oder Production: ein eigener PostgreSQL-Cluster (`initdb`), darin die Kopie der
 * Entwicklungsdatenbank (`pg_dump` nur lesend), ein eigener Fastify und eine eigene Vite auf eigenen Ports, `AUTH_INSECURE_COOKIE=1`,
 * `MAP_EDITING=testwelt`, eine Person mit der Rolle `editor` und eine Sitzung über das echte `createSession` (`session-store.ts`).
 * Das Rezept steht in den Notizen der Sitzungen („Echte Bedienprobe in einer Wegwerf-Welt“); die Fälle schreiben in diese Welt (löschen
 * Wege, vereinigen Flächen) und holen es mit ↺ zurück, soweit der Vertrag es kann.
 *
 * Die Fälle fahren nur, wenn ihre Datei genannt ist (`spec-auswahl.ts`, `NUR_GENANNT`) und `WELT_TOKEN_DATEI` auf die Datei mit dem
 * Sitzungs-Token zeigt; `E2E_PORT` ist die Vite der Welt, `PORT` ihr Fastify (wie jeder Browserlauf mit eigenem Server).
 */
export const WELT_TOKEN_DATEI = process.env["WELT_TOKEN_DATEI"];

/** Warum ein Fall ohne Welt überspringt: sichtbar, nie stilles Grün. */
export const OHNE_WELT =
    "keine Wegwerf-Welt: WELT_TOKEN_DATEI nennt die Datei mit dem Sitzungs-Token der Testperson (Rezept: wegeditor-echt.spec.ts, welt.ts)";

/**
 * Wer angemeldet wird: `editor` ist die Testperson (`WELT_TOKEN_DATEI`); die Tor-Welt (`scripts/dev/tor-welt.ts`, WI-0264) legt daneben
 * `editor2` (ein fremder Bearbeiter, etwa für eine Sperre) und `admin` (Systemsteuerung, Form und Gebirge) an, als `…-editor2.txt` und `…-admin.txt`.
 */
export type WeltPerson = "editor" | "editor2" | "admin";

/** Das Sitzungs-Token einer Person der Welt (für Cookie oder `request` mit eigenem Kontext). */
export function weltToken(wer: WeltPerson = "editor"): string {
    const datei = wer === "editor" ? WELT_TOKEN_DATEI! : WELT_TOKEN_DATEI!.replace(/(\.txt)?$/u, `-${wer}.txt`);
    return readFileSync(datei, "utf8").trim();
}

/** Meldet die Seite als eine Person der Welt an: das Cookie der Sitzung, vor dem ersten Laden der Karte. */
export async function meldeAn(page: Page, wer: WeltPerson = "editor"): Promise<void> {
    const token = weltToken(wer);
    await page.goto("/");
    await page.context().addCookies([{ name: "avesmaps-session", value: token, url: page.url() }]);
}

export interface Beobachtung {
    /** Jede Anfrage an die Editor-Routen, die mit 5xx endete (mit Adresse und Antwort), und jeder Fehler der Seite. */
    readonly fehler: string[];
    /** Alle Antworten der Editor-Routen, damit ein Fall nach einer bestimmten sucht. */
    readonly antworten: { url: string; methode: string; status: number; ms: number }[];
}

/**
 * Hört mit, was zwischen Seite und echtem Server geht. Ein 5xx oder ein Fehler der Seite ist ein Befund, auch wenn die Oberfläche ihn
 * wegsteckt (so verdeckte das Grau der Flächen alle 500er und 503er der Prüfung).
 */
export function beobachte(page: Page): Beobachtung {
    const b: Beobachtung = { fehler: [], antworten: [] };
    const start = new Map<string, number>();
    page.on("request", (r) => start.set(r.url() + r.method(), Date.now()));
    page.on("response", (r: Response) => {
        const url = r.url();
        if (!url.includes("/api/editor/") || url.includes("/locks")) return;
        const methode = r.request().method();
        const ms = Date.now() - (start.get(url + methode) ?? Date.now());
        b.antworten.push({ url: new URL(url).pathname + new URL(url).search, methode, status: r.status(), ms });
        if (r.status() >= 500) b.fehler.push(`${methode} ${new URL(url).pathname} -> ${String(r.status())}`);
    });
    page.on("pageerror", (e) => b.fehler.push(`Fehler der Seite: ${e.message.slice(0, 200)}`));
    return b;
}
