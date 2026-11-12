import { KARTEN_PAKET_PFAD, KARTENVORSCHLAG_STATUS_PFAD, REISEBILD_STATUS_PFAD, STATUS_PFAD } from "@avesmaps3d/shared";
import { DISCORD_PARAMETER, istMelderErgebnis, type MelderErgebnis } from "../community/discord-verbinden";

/**
 * Der Einstieg über einen Link (WI-0120 A9, AUTH-0001 §6.3, §6.5, §6.7, §11.4). Die Verwaltung und die Kommandozeile geben
 * Links mit dem Geheimnis im Fragment aus (`/einladung#…`, `/passwort#…`, `/notzugang#…`, `/passkey#…`); Discord kehrt mit
 * `?anmeldung=<Ergebnis>` zurück.
 *
 * 🔴 VOR DEM START LESEN UND AUS DER ADRESSE NEHMEN. Direkt nach dem Start schreibt die Karte ihren Ausschnitt ins Fragment
 * (`view-state.ts`) und würde das Geheimnis überschreiben; geteilte Links bauen auf `origin + pathname` und trügen sonst
 * `/einladung` weiter. Danach steht in der Adresse `/edit` (der Link führt in den Editor-Modus), die übrigen Parameter bleiben.
 * Eine Rückkehr von Discord mit Sitzung (Verknüpfen, Bestätigen) bleibt, wo der Umweg begann; ohne Sitzung (Anmelden, Einladung)
 * und ohne Ziel (Umweg abgelaufen oder unbekannt) kommt sie über `/anmelden`, den einzigen Einstieg, den die Stage-Tür ohne
 * Anmeldung durchlässt (WI-0120 R6), und führt ebenfalls nach `/edit`, denn nur dort gibt es die Leiste und damit die Anmeldung.
 *
 * Dazu kommt die Statusseite einer Meldung (WI-0268 C2, Bedienkonzept §1.2): `/meldung#<schlüssel>`. Dasselbe Muster, aber kein Anmeldelink: Der Schlüssel kommt aus dem
 * Fragment, die Adresse danach ist die der Karte (`/`, ohne Fragment), und `Entry.status` trägt den Schlüssel zur Statusseite (`community/community-besucher.ts`).
 * Kommt ein Melder von Discord zurück (WI-0268 C8, „Mit Discord verbinden“), trägt die Adresse nur das Ergebnis (`/meldung?discord=verbunden`, `Entry.discord`) und KEINEN Schlüssel: Den stellt
 * die Seite aus `sessionStorage` wieder her (`community/discord-verbinden.ts`).
 *
 * Und die Statusseite eines Reisebilds (WI-0272 S2b): `/reisebild#<schlüssel>`, dasselbe Muster mit eigenem Feld (`Entry.reisebild`); `/meldung` und `/reisebild` bedienen nie dieselbe Seite.
 *
 * Und der Token-Link der Karten (WI-0280): `/paket#<token>`, dasselbe Muster mit eigenem Feld (`Entry.kartenPaket`).
 *
 * Der Editor-Modus (Betreiber 2026-10-09: „der editor balken … soll aber nur für editoren erscheinen, die auf /edit oder
 * &editor=true gehen (aktuell in legacy edit=1)“): `/edit`, `?editor=true` oder Legacys `?edit=1`. Er ist ein Ansichtsschalter, kein
 * Riegel (wie Legacys `edit=1`, `js/config.js`): Was jemand darf, entscheidet weiter der Server.
 *
 * Für den Umweg über Discord merkt sich die Seite den Kartenausschnitt in `sessionStorage` (der Server sieht das Fragment
 * nie) und setzt ihn bei der Rückkehr wieder ein, bevor die Karte ihn liest.
 */

export type LinkKind = "invitation" | "password_reset" | "recovery" | "passkey_enrollment";

export type EntryLink = { kind: LinkKind; token: string | null } | { kind: "login" };

/** Die Ergebnisse der Discord-Rückkehr (`DiscordOutcome` in `apps/server/src/routes/auth-discord.ts`). */
export const RETURN_OUTCOMES = [
    "ok",
    "bestaetigt",
    "verknuepft",
    "abgebrochen",
    "abgelaufen",
    "kein_zugang",
    "gesperrt",
    "discord_fehler",
    "discord_vergeben",
    "schon_verknuepft",
    "andere_person",
    "willkommen",
    "einladung_ungueltig",
    "schon_konto",
] as const;
export type ReturnOutcome = (typeof RETURN_OUTCOMES)[number];

/** Ergebnisse, die etwas Gutes melden; die anderen erklären im Fenster, was nicht ging. */
export const GOOD_OUTCOMES: ReadonlySet<ReturnOutcome> = new Set(["ok", "bestaetigt", "verknuepft", "willkommen"]);

const PATHS: Record<string, LinkKind | "login"> = {
    "/einladung": "invitation",
    "/passwort": "password_reset",
    "/notzugang": "recovery",
    "/passkey": "passkey_enrollment",
    "/anmelden": "login",
};

const TOKEN = /^[A-Za-z0-9_-]{43}$/u;

/**
 * Wohin ein Link wollte, bevor die Stage-Tür auf `/anmelden` umleitete (Befund 2026-10-18: Abnahmelinks verloren `?route=` und
 * `?tab=`). Nginx hängt die ursprüngliche Anfrage als `#ziel=<Pfad und Suche>` an (`@zur_anmeldung`, Claudios Stage-Vhost); der Server
 * sieht das Fragment danach nie. Genommen wird nur ein Pfad derselben Seite (ein Schrägstrich vorn, kein zweiter, kein Backslash) und von
 * ihm nur die Suche: Die Anmeldung gibt es nur im Editor-Modus, der Weg führt also nach `/edit` mit den Parametern des Ziels.
 */
const ZIEL = /^#ziel=(\/(?![/\\])[^\s#\\]{0,2000})$/u;
/**
 * Dasselbe Ziel in der Suche (`/anmelden?ziel=<Pfad und Suche>`, der ganze Rest der Suche, Zeichen für Zeichen). 🔴 Nur so überlebt
 * das Fragment des Links die Umleitung (Fund des Betreibers 2026-10-19: `/edit#view=political` öffnete nie): Der Browser nimmt das
 * Fragment nur mit, wenn das Ziel der Umleitung selbst keines trägt; `#ziel=` verwarf es. Das Fragment steht dann hinter `?ziel=…` und
 * geht mit nach `/edit`.
 */
const ZIEL_IN_DER_SUCHE = /^\?ziel=(\/(?![/\\])[^\s#\\]{0,2000})$/u;

/**
 * Die Suche des Ziels (`?…`, Zeichen für Zeichen wie im Link, denn `URLSearchParams` schriebe das `~` der Reise als `%7E`), `""` ohne
 * Suche, `null` ohne gültiges Ziel.
 */
function zielSuche(text: string, muster: RegExp = ZIEL): string | null {
    const match = muster.exec(text);
    if (!match) return null;
    try {
        const url = new URL(match[1]!, "https://stage.invalid");
        if (url.origin !== "https://stage.invalid" || url.searchParams.has("anmeldung")) return null;
        return url.search;
    } catch {
        return null;
    }
}

/** Der Pfad des Editor-Modus; ein Einstiegslink führt dorthin. */
export const EDITOR_PATH = "/edit";

/** Ist diese Adresse im Editor-Modus? `/edit`, `?editor=true` oder Legacys `?edit=1`. */
export function isEditorAddress(location: { pathname: string; search: string }): boolean {
    const path = location.pathname.replace(/\/+$/u, "");
    if (path === EDITOR_PATH) return true;
    const params = new URLSearchParams(location.search);
    return params.get("editor") === "true" || params.get("edit") === "1";
}

/**
 * Die Adresse, auf die ein geteilter Link zeigt: die öffentliche Karte, nie der Editor-Modus.
 *
 * 💣 Befund des Betreibers 2026-10-13: Beide Links, die er zum Teilen erzeugt hatte, trugen `/edit` —
 * `https://stage.avesmaps.de/edit?s=hHEEWwRi`. Der Teilen-Knopf baute die Adresse aus `location.pathname`, und wer im
 * Editor-Modus steht, verschickte damit einen Editor-Link. Ein geteilter Kartenausschnitt gehört auf die Karte: Wer ihn
 * bekommt, will die Ansicht sehen, nicht eine Oberfläche zum Bearbeiten.
 *
 * 🪤 Der Pfad ist nicht kosmetisch — `isEditorAddress` schaltet den Editor-Modus genau daran ein. Folgenlos war das nur,
 * solange das Editorpanel im ausgelieferten Build gar nicht existierte (bis `a77b1127`, EDIT-0001 D23).
 */
export function publicMapUrl(location: { origin: string; pathname: string }): string {
    const path = location.pathname.replace(/\/+$/u, "");
    return `${location.origin}${path === EDITOR_PATH ? "/" : location.pathname}`;
}

export interface Entry {
    link: EntryLink | null;
    outcome: ReturnOutcome | null;
    /** Die bereinigte Adresse für `history.replaceState`, oder `null`, wenn nichts zu ändern ist. */
    url: string | null;
    /**
     * Nur bei `/meldung#…` (die Statusseite einer Meldung): der Schlüssel aus dem Fragment, oder `null`, wenn er fehlte oder verstümmelt war (dann sagt das Fenster gleich „gibt
     * es nicht (mehr)“). Bei jeder anderen Adresse fehlt das Feld.
     */
    status?: string | null;
    /** Nur bei `/meldung?discord=<Ergebnis>`: wie die Rückkehr von Discord für einen Melder ausging (WI-0268 C8). */
    discord?: MelderErgebnis;
    /**
     * Nur bei `/reisebild#…` (die Statusseite eines Reisebilds, WI-0272 S2b): der Schlüssel aus dem Fragment, oder `null`, wenn er fehlte oder verstümmelt war (dann sagt das Fenster gleich „gibt es kein
     * Reisebild (mehr)“). Bei jeder anderen Adresse fehlt das Feld.
     */
    reisebild?: string | null;
    /** Nur bei `/kartenvorschlag#…` (die Statusseite eines Kartenvorschlags, WI-0275 Stufe C): der Schlüssel aus dem Fragment, oder `null`, wenn er fehlte oder verstümmelt war. */
    kartenvorschlag?: string | null;
    /** Nur bei `/paket#…` (der Token-Link der Karten, WI-0280): das Token aus dem Fragment, oder `null`, wenn es fehlte oder verstümmelt ist. */
    kartenPaket?: string | null;
}

export function readEntry(location: { pathname: string; search: string; hash: string }): Entry {
    const path = location.pathname.length > 1 ? location.pathname.replace(/\/+$/u, "") : location.pathname;
    if (path === KARTEN_PAKET_PFAD) {
        const schluessel = location.hash.replace(/^#/u, "");
        return {
            link: null,
            outcome: null,
            url: `/${location.search}`,
            kartenPaket: TOKEN.test(schluessel) ? schluessel : null,
        };
    }
    if (path === STATUS_PFAD || path === REISEBILD_STATUS_PFAD || path === KARTENVORSCHLAG_STATUS_PFAD) {
        // Der Schlüssel kommt aus dem Fragment und geht aus der Adresse, bevor die Karte ihren Ausschnitt dorthin schreibt; der Rest der Suche (Sprache …) bleibt.
        const params = new URLSearchParams(location.search);
        params.delete("anmeldung");
        const discord = params.get(DISCORD_PARAMETER);
        params.delete(DISCORD_PARAMETER);
        const search = params.toString();
        const schluessel = location.hash.replace(/^#/u, "");
        return {
            link: null,
            outcome: null,
            url: `/${search === "" ? "" : `?${search}`}`,
            // Eines der zwei Felder, je nach Adresse: Eine Meldung und ein Reisebild haben je ihr Fenster; die Rückkehr von Discord gilt nur der Meldung.
            ...(path === STATUS_PFAD
                ? {
                      status: TOKEN.test(schluessel) ? schluessel : null,
                      ...(istMelderErgebnis(discord) ? { discord } : {}),
                  }
                : path === REISEBILD_STATUS_PFAD
                  ? { reisebild: TOKEN.test(schluessel) ? schluessel : null }
                  : { kartenvorschlag: TOKEN.test(schluessel) ? schluessel : null }),
        };
    }
    const kind = PATHS[path];
    const params = new URLSearchParams(location.search);
    const rawOutcome = params.get("anmeldung");
    params.delete("anmeldung");
    // Das Ziel der Stage-Tür ist kein Parameter des Editor-Modus: gültig wird es unten eingelöst, ungültig fällt es weg.
    if (kind === "login") params.delete("ziel");
    const outcome = (RETURN_OUTCOMES as readonly string[]).includes(rawOutcome ?? "")
        ? (rawOutcome as ReturnOutcome)
        : null;
    let link: EntryLink | null = null;
    if (kind === "login") link = { kind };
    else if (kind !== undefined) {
        const token = location.hash.replace(/^#/u, "");
        link = { kind, token: TOKEN.test(token) ? token : null };
    }
    if (kind === undefined && rawOutcome === null) return { link, outcome, url: null };
    const search = params.toString();
    // Das Ziel hinter der Stage-Tür zählt nur auf `/anmelden` ohne eigene Parameter (eine Rückkehr von Discord trägt kein Fragment).
    // In der Suche (`?ziel=…`) bringt es das Fragment des Links mit; im Fragment (`#ziel=…`) hat der Browser es schon verworfen.
    const zielMitFragment =
        kind === "login" && rawOutcome === null ? zielSuche(location.search, ZIEL_IN_DER_SUCHE) : null;
    const ziel = zielMitFragment ?? (kind === "login" && search === "" ? zielSuche(location.hash) : null);
    const query = ziel ?? (search === "" ? "" : `?${search}`);
    const hash = kind === undefined || zielMitFragment !== null ? location.hash : "";
    const stays =
        kind === undefined && (outcome === null || isEditorAddress({ pathname: location.pathname, search: query }));
    const url = `${stays ? location.pathname : EDITOR_PATH}${query}${hash}`;
    return { link, outcome, url };
}

const VIEW_KEY = "avesmaps3d.anmeldung-ausschnitt";
const LINK_KEY = "avesmaps3d.anmeldung-link";
/** Länger als ein Discord-Umweg (zehn Minuten) braucht nichts zu überleben. */
const KEEP_MS = 15 * 60_000;

interface Kept<T> {
    value: T;
    at: number;
}

function keep<T>(key: string, value: T, now: number): void {
    try {
        globalThis.sessionStorage?.setItem(key, JSON.stringify({ value, at: now } satisfies Kept<T>));
    } catch {
        // Ohne Speicher (privates Fenster, gesperrte Websitedaten) beginnt die Karte nach der Rückkehr am Start.
    }
}

function take<T>(key: string, now: number, valid: (value: unknown) => value is T): T | null {
    try {
        const raw = globalThis.sessionStorage?.getItem(key);
        globalThis.sessionStorage?.removeItem(key);
        if (raw === null || raw === undefined) return null;
        const kept = JSON.parse(raw) as Partial<Kept<unknown>>;
        if (typeof kept.at !== "number" || now - kept.at > KEEP_MS || now < kept.at) return null;
        return valid(kept.value) ? kept.value : null;
    } catch {
        return null;
    }
}

/** Vor dem Umweg über Discord: den Kartenausschnitt (`#x=…`) merken. */
export function rememberView(hash: string, now: number = Date.now()): void {
    if (hash.startsWith("#") && hash.length > 1) keep(VIEW_KEY, hash, now);
}

/** Nach der Rückkehr: den gemerkten Ausschnitt einmal holen. */
export function takeRememberedView(now: number = Date.now()): string | null {
    return take(VIEW_KEY, now, (value): value is string => typeof value === "string" && value.startsWith("#"));
}

/**
 * Einen Link über den Umweg retten, wenn er erst nach einer Anmeldung mit Discord eingelöst werden kann (der erste Passkey
 * braucht eine angemeldete Person). Er bleibt höchstens 15 Minuten, nur in diesem Tab, und wird beim Lesen gelöscht.
 */
export function rememberLink(link: { kind: LinkKind; token: string }, now: number = Date.now()): void {
    keep(LINK_KEY, link, now);
}

export function takeRememberedLink(now: number = Date.now()): { kind: LinkKind; token: string } | null {
    return take(LINK_KEY, now, (value): value is { kind: LinkKind; token: string } => {
        const candidate = value as { kind?: unknown; token?: unknown } | null;
        return (
            candidate !== null &&
            typeof candidate.token === "string" &&
            TOKEN.test(candidate.token) &&
            Object.values(PATHS).includes(candidate.kind as LinkKind) &&
            candidate.kind !== "login"
        );
    });
}
