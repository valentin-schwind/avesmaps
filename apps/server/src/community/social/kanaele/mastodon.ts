import type { MastodonGrenzen } from "@avesmaps3d/shared";
import type { MastodonZugang } from "./konfiguration.ts";

/**
 * Die Anbindung an Mastodon (WI-0268 C12a; Fachkonzept §15.7, Recherche `project-control/discovery/social-zeichengrenzen-2026-10-31.md` §2). Nur diese Datei redet mit der Instanz; sie kennt keine Datenbank.
 *
 * - **Grenzen lesen** (`leseGrenzen`): `GET /api/v2/instance` ohne Anmeldung - `configuration.statuses.max_characters`, `characters_reserved_per_url`, `max_media_attachments` und
 *   `configuration.media_attachments` (`description_limit`, `image_size_limit`, `supported_mime_types`). Gemessen, nicht geglaubt: Nennt die Instanz Zeichengrenze oder Länge einer Adresse nicht, ist das ein Fehler
 *   und keine Vorgabe (ein Fork wie glitch-soc kann andere Werte haben).
 * - **Senden** (`sende`): `POST /api/v1/statuses` mit `Idempotency-Key`, Sichtbarkeit `public`. Mit Bild zuerst `POST /api/v2/media` (mit Bildbeschreibung), bei 202 wartet `ladeBildHoch` auf die Verarbeitung.
 * - **Zurücknehmen** (`nimmZurueck`): `DELETE /api/v1/statuses/:id`; „nicht (mehr) da“ (404, 410) zählt als zurückgenommen.
 * - 🔴 **Nie ein echter Aufruf im Test:** Alles geht durch `deps.fetch`; Tests stellen die Instanz.
 * - 🔴 **Grenzen des Aufrufs:** Zeitgrenze je Aufruf (15 s), kein Folgen von Weiterleitungen (`redirect: "manual"`), Antwort höchstens 1 MB, die Kennung eines Beitrags wird geprüft, bevor sie in einen Pfad kommt.
 * - 🔴 **Fehlertexte ohne Zugangsschlüssel und ohne Adresse der Instanz:** Jeder Text ist ein fester Satz mit dem Code der Antwort; nur bei 422 kommt ein gekürzter, bereinigter Auszug der Antwort der Instanz dazu
 *   (`entschaerfe` nimmt Schlüssel und Host heraus).
 */

export interface MastodonDeps {
    /** Der Aufruf; Tests stellen die Instanz, damit nie ein echter Aufruf hinausgeht. */
    fetch?: typeof globalThis.fetch;
    /** Zeitgrenze je Aufruf in Millisekunden. */
    timeoutMs?: number;
    /** Wartet; Tests ersetzen es. */
    warte?: (ms: number) => Promise<void>;
}

export const ZEITGRENZE_MS = 15_000;
const ANTWORT_MAX = 1_000_000;
const MEDIA_VERSUCHE = 12;
const MEDIA_ABSTAND_MS = 1_000;

/** Ein Fehler des Kanals mit kurzem Satz. `dauerhaft` heißt: ein neuer Versuch ändert nichts (Schlüssel abgelehnt, Beitrag abgelehnt); sonst lohnt es sich später noch einmal. */
export class MastodonFehler extends Error {
    readonly dauerhaft: boolean;
    readonly status: number | undefined;

    constructor(satz: string, dauerhaft: boolean, status?: number) {
        super(satz);
        this.name = "MastodonFehler";
        this.dauerhaft = dauerhaft;
        this.status = status;
    }
}

interface Antwort {
    readonly status: number;
    readonly json: unknown;
}

// eslint-disable-next-line no-control-regex
const STEUERZEICHEN = /[\u0000-\u001f\u007f]/gu;

/** Ein Auszug der Fehlermeldung der Instanz: eine Zeile, ohne Steuerzeichen, Schlüssel und Host, höchstens 140 Zeichen. */
function auszug(json: unknown, zugang: MastodonZugang): string {
    const roh = typeof json === "object" && json !== null ? (json as { error?: unknown }).error : undefined;
    if (typeof roh !== "string") return "";
    const rein = zugang.entschaerfe(roh).replace(STEUERZEICHEN, " ").replace(/\s+/gu, " ").trim();
    return rein.length > 140 ? `${rein.slice(0, 139)}…` : rein;
}

/** Der Satz zu einer Antwort, die nicht in Ordnung war. */
function fehlerZu(status: number, json: unknown, zugang: MastodonZugang): MastodonFehler {
    const code = String(status);
    if (status === 401)
        return new MastodonFehler(`Mastodon hat den Zugangsschlüssel abgelehnt (${code})`, true, status);
    if (status === 403) return new MastodonFehler(`Das Konto darf das bei Mastodon nicht (${code})`, true, status);
    if (status === 413) return new MastodonFehler(`Die Datei ist Mastodon zu groß (${code})`, true, status);
    if (status === 422) {
        const text = auszug(json, zugang);
        return new MastodonFehler(
            `Mastodon lehnt den Beitrag ab (${code})${text === "" ? "" : `: ${text}`}`,
            true,
            status,
        );
    }
    if (status === 429) return new MastodonFehler(`Mastodon bremst gerade (${code})`, false, status);
    if (status >= 500) return new MastodonFehler(`Mastodon meldet einen Fehler (${code})`, false, status);
    if (status >= 300 && status < 400)
        return new MastodonFehler(`Mastodon leitet weiter, der Hub folgt nicht (${code})`, true, status);
    return new MastodonFehler(`Mastodon lehnt die Anfrage ab (${code})`, true, status);
}

interface Aufruf {
    readonly methode: "GET" | "POST" | "DELETE";
    readonly pfad: string;
    readonly anmelden: boolean;
    readonly kopf?: Record<string, string>;
    readonly body?: string | FormData;
}

/** Ein Aufruf mit Zeitgrenze, ohne Weiterleitung. Gibt Status und gelesenes JSON zurück; wirft nur, wenn keine Antwort kam. */
async function aufruf(zugang: MastodonZugang, deps: MastodonDeps, a: Aufruf): Promise<Antwort> {
    const hole = deps.fetch ?? globalThis.fetch;
    let antwort: Response;
    try {
        antwort = await hole(zugang.adresse(a.pfad), {
            method: a.methode,
            redirect: "manual",
            headers: { Accept: "application/json", ...(a.kopf ?? {}), ...(a.anmelden ? zugang.anmeldeKopf() : {}) },
            ...(a.body === undefined ? {} : { body: a.body }),
            signal: AbortSignal.timeout(deps.timeoutMs ?? ZEITGRENZE_MS),
        });
    } catch (fehler) {
        // Nie der Text des Fehlers: Er enthielte die Adresse der Instanz.
        const zeit =
            (fehler as { name?: unknown }).name === "TimeoutError" ||
            (fehler as { name?: unknown }).name === "AbortError";
        throw new MastodonFehler(
            zeit ? "Mastodon hat nicht rechtzeitig geantwortet" : "Mastodon war nicht erreichbar",
            false,
        );
    }
    return { status: antwort.status, json: await leseJson(antwort) };
}

/** Der JSON-Rumpf einer Antwort; eine Antwort, die keiner ist (oder nicht zu lesen war), zählt als leer: Dann entscheidet der Status. */
async function leseJson(antwort: Response): Promise<unknown> {
    try {
        const text = (await antwort.text()).slice(0, ANTWORT_MAX);
        return text === "" ? null : (JSON.parse(text) as unknown);
    } catch {
        return null;
    }
}

const istObjekt = (wert: unknown): wert is Record<string, unknown> =>
    typeof wert === "object" && wert !== null && !Array.isArray(wert);

const ganzeZahl = (wert: unknown): number | undefined =>
    typeof wert === "number" && Number.isSafeInteger(wert) && wert >= 0 ? wert : undefined;

// --- Grenzen lesen ------------------------------------------------------------------------------------------------------------------

/** Die Vorgaben von Mastodon, wo die Instanz einen Wert nicht nennt, der nur Bilder betrifft (nicht die Zählung): 1500 Zeichen Beschreibung, 16 MiB, vier Bilder. */
const BILD_VORGABE = {
    bilder: 4,
    beschreibung: 1500,
    bildBytes: 16 * 1024 * 1024,
    bildTypen: ["image/jpeg", "image/png", "image/gif", "image/webp"],
} as const;

/** Liest die Grenzen aus der Antwort von `/api/v2/instance`. Wirft, wenn Zeichengrenze oder Länge einer Adresse fehlen. */
export function grenzenAus(json: unknown): MastodonGrenzen {
    const config = istObjekt(json) && istObjekt(json["configuration"]) ? json["configuration"] : undefined;
    const statuses = config !== undefined && istObjekt(config["statuses"]) ? config["statuses"] : undefined;
    const medien =
        config !== undefined && istObjekt(config["media_attachments"]) ? config["media_attachments"] : undefined;
    const zeichen = ganzeZahl(statuses?.["max_characters"]);
    const adresse = ganzeZahl(statuses?.["characters_reserved_per_url"]);
    if (zeichen === undefined || zeichen < 1 || adresse === undefined || adresse < 1) {
        throw new MastodonFehler("Die Instanz nennt ihre Grenzen nicht (Zeichen und Länge einer Adresse)", true);
    }
    const rohTypen = medien?.["supported_mime_types"];
    const typen = Array.isArray(rohTypen)
        ? (rohTypen as unknown[]).filter(
              (typ): typ is string => typeof typ === "string" && /^image\/[a-z0-9][a-z0-9.+-]*$/u.test(typ),
          )
        : [];
    return {
        zeichen,
        adresse,
        bilder: ganzeZahl(statuses?.["max_media_attachments"]) ?? BILD_VORGABE.bilder,
        beschreibung: ganzeZahl(medien?.["description_limit"]) ?? BILD_VORGABE.beschreibung,
        bildBytes: ganzeZahl(medien?.["image_size_limit"]) ?? BILD_VORGABE.bildBytes,
        bildTypen: typen.length > 0 ? typen : [...BILD_VORGABE.bildTypen],
    };
}

/** Liest die Grenzen der Instanz (`GET /api/v2/instance`, ohne Anmeldung). */
export async function leseGrenzen(zugang: MastodonZugang, deps: MastodonDeps = {}): Promise<MastodonGrenzen> {
    const antwort = await aufruf(zugang, deps, { methode: "GET", pfad: "/api/v2/instance", anmelden: false });
    if (antwort.status !== 200) throw fehlerZu(antwort.status, antwort.json, zugang);
    return grenzenAus(antwort.json);
}

// --- Senden -------------------------------------------------------------------------------------------------------------------------

const KENNUNG = /^[0-9A-Za-z_-]{1,64}$/u;

/** Die Dateiendung zum Typ; Mastodon erkennt den Typ an den Bytes, die Endung hilft nur dem Namen. */
function endungZu(mime: string): string {
    const rest = mime.split("/")[1] ?? "bin";
    return rest.replace(/[^a-z0-9]/gu, "").slice(0, 8) || "bin";
}

/**
 * Lädt ein Bild hoch (`POST /api/v2/media`, mit Bildbeschreibung). Antwortet die Instanz mit 202, wird das Bild noch verarbeitet: Dann fragt der Aufruf `GET /api/v1/media/:id` (206 heißt „noch nicht fertig“)
 * höchstens zwölfmal im Abstand einer Sekunde.
 */
export async function ladeBildHoch(
    zugang: MastodonZugang,
    bild: { bytes: Uint8Array; mime: string; beschreibung: string },
    deps: MastodonDeps = {},
): Promise<string> {
    const form = new FormData();
    form.append("file", new Blob([Buffer.from(bild.bytes)], { type: bild.mime }), `bild.${endungZu(bild.mime)}`);
    if (bild.beschreibung.trim() !== "") form.append("description", bild.beschreibung);
    const antwort = await aufruf(zugang, deps, { methode: "POST", pfad: "/api/v2/media", anmelden: true, body: form });
    if (antwort.status !== 200 && antwort.status !== 202) throw fehlerZu(antwort.status, antwort.json, zugang);
    const id = istObjekt(antwort.json) ? antwort.json["id"] : undefined;
    if (typeof id !== "string" || !KENNUNG.test(id)) {
        throw new MastodonFehler("Mastodon nannte keine Kennung des hochgeladenen Bildes", false);
    }
    if (antwort.status === 200) return id;
    const warte = deps.warte ?? ((ms: number) => new Promise<void>((fertig) => setTimeout(fertig, ms)));
    for (let versuch = 0; versuch < MEDIA_VERSUCHE; versuch += 1) {
        await warte(MEDIA_ABSTAND_MS);
        const stand = await aufruf(zugang, deps, { methode: "GET", pfad: `/api/v1/media/${id}`, anmelden: true });
        if (stand.status === 200) return id;
        if (stand.status !== 206) throw fehlerZu(stand.status, stand.json, zugang);
    }
    throw new MastodonFehler("Mastodon hat das Bild nicht rechtzeitig verarbeitet", false);
}

export interface Gesendet {
    /** Die Kennung des Beitrags bei Mastodon (für das Zurücknehmen). */
    readonly id: string;
    /** Die Adresse des Beitrags dort (`https`). */
    readonly url: string;
}

/** Sendet einen Beitrag (`POST /api/v1/statuses`, öffentlich, mit `Idempotency-Key`). Dieselbe Kennung noch einmal liefert den schon gesendeten Beitrag, nie einen zweiten. */
export async function sende(
    zugang: MastodonZugang,
    beitrag: {
        text: string;
        bildId?: string | undefined;
        idempotenz: string;
        /** Wer es sieht; der Hub sendet `public`, die Prüfung der Zählregel nur `private` (Testkonto, sofort wieder gelöscht). */
        sichtbarkeit?: "public" | "private" | undefined;
    },
    deps: MastodonDeps = {},
): Promise<Gesendet> {
    const body = JSON.stringify({
        status: beitrag.text,
        visibility: beitrag.sichtbarkeit ?? "public",
        ...(beitrag.bildId === undefined ? {} : { media_ids: [beitrag.bildId] }),
    });
    const antwort = await aufruf(zugang, deps, {
        methode: "POST",
        pfad: "/api/v1/statuses",
        anmelden: true,
        kopf: { "Content-Type": "application/json", "Idempotency-Key": beitrag.idempotenz },
        body,
    });
    if (antwort.status !== 200) throw fehlerZu(antwort.status, antwort.json, zugang);
    const json = istObjekt(antwort.json) ? antwort.json : {};
    const id = json["id"];
    if (typeof id !== "string" || !KENNUNG.test(id)) {
        throw new MastodonFehler("Mastodon nannte keine Kennung des Beitrags", true);
    }
    const adresse = [json["url"], json["uri"]].find(
        (wert): wert is string =>
            typeof wert === "string" &&
            wert.length <= 1000 &&
            /^https:\/\/\S+$/u.test(wert) &&
            wert.replace(STEUERZEICHEN, "") === wert,
    );
    if (adresse === undefined) {
        throw new MastodonFehler("Mastodon nannte keine Adresse des Beitrags; bitte dort nachsehen", true);
    }
    return { id, url: adresse };
}

/** Löscht einen Beitrag (`DELETE /api/v1/statuses/:id`). Ist er dort nicht (mehr) da (404, 410), ist das Ziel erreicht. */
export async function nimmZurueck(zugang: MastodonZugang, externId: string, deps: MastodonDeps = {}): Promise<void> {
    if (!KENNUNG.test(externId))
        throw new MastodonFehler("Die Kennung des Beitrags bei Mastodon ist unbrauchbar", true);
    const antwort = await aufruf(zugang, deps, {
        methode: "DELETE",
        pfad: `/api/v1/statuses/${externId}`,
        anmelden: true,
    });
    if (antwort.status === 200 || antwort.status === 404 || antwort.status === 410) return;
    throw fehlerZu(antwort.status, antwort.json, zugang);
}
