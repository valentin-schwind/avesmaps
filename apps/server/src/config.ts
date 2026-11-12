import { isIP } from "node:net";
import {
    MAP_EDITING_MODES,
    WARTESCHLANGE_UMGEBUNGEN,
    type AbgleichAusfuehrung,
    type AbgleichAusfuehrungen,
    type HoehenmodellProfil,
    type KanalSchalter,
    type MapEditingMode,
    type WarteschlangeUmgebung,
} from "@avesmaps3d/shared";
import { abgleicheModes } from "./abgleiche/ausfuehrung.ts";
import { abzugKonfiguration, type AbzugConfig } from "./abzug/konfig.ts";
import {
    discordInteraktionenKonfiguration,
    discordKonfiguration,
    type DiscordInteraktionenKonfig,
    type DiscordKonfig,
} from "./discord/konfig.ts";
import { kanalSchalter } from "./kanal/schalter.ts";
import { hoehenmodellProfil } from "./terrain/hoehenmodell-profil.ts";
import { loadAuthConfig, type AuthConfig } from "./auth/config.ts";
import { jobsProfileName } from "./jobs/profile.ts";

/** Die Profile der Tür (`AUTH_GATE`, SYS-0001 §3.8); die Entscheidung je Profil steht in `auth/gate.ts`. */
export const GATE_PROFILES = ["members", "public"] as const;
export type GateProfile = (typeof GATE_PROFILES)[number];

/**
 * Runtime configuration. Values come from the environment only, never from committed files,
 * so development, staging and production stay isolated (chapters 10.4, 10.151).
 */
export interface ServerConfig {
    port: number;
    host: string;
    /**
     * Die anonyme Besucherstatistik (WI-0138, BESUCH-0001 §4). 🔴 Ohne `VISITOR_SALT` zählt der Server Aufrufe weiter, aber keine
     * eindeutigen Besucher: Eine Kennung mit einem Schlüssel aus dem Quelltext wäre zurückrechenbar (Legacys Befund A23) und damit
     * eine Scheinanonymität. Eine fehlende Zahl ist besser.
     */
    besucher?: { salt: string | undefined } | undefined;
    /**
     * Die öffentlichen Adressen dieser Maschine für „Wer fragt“ unter Status › API (WI-0307): Anfragen von dort sind eigene Proben und
     * zählen nicht als Dritte (`API_ZAEHLER_EIGENE_ADRESSEN`, durch Komma getrennt, IPv4 oder IPv6). 🔴 Der Wert steht nur in der `.env`
     * der Umgebung, nie im Code. Ein ungültiger Eintrag hält den Start NICHT an (eine Statistik ist kein Grund für einen Ausfall); er fällt
     * weg und der Server sagt beim Start, wie viele es waren.
     */
    apiZaehler?: { eigeneAdressen: string[]; verworfen: number } | undefined;
    releaseId: string;
    databaseUrl: string | undefined;
    /** Directory holding the built raster tile pyramids; Nginx serves it in production. */
    tileRoot: string | undefined;
    /**
     * Root of the media store (`incoming`, `private`, `master`, `derivatives`, `published`), WI-0063 MEDIA-M6.
     * Optional like `tileRoot`: a missing value must not keep the server from starting. `/media/` then answers 503 and
     * says so once at startup (`routes/media.ts`, MEDIA-M12) instead of serving silent 404s. Staging and production
     * have separate roots; in production Nginx serves the same path from `published/` and this server is not involved.
     */
    mediaRoot?: string | undefined;
    /**
     * Die Statusseite der Queue (WI-0074): `/api/jobs/*`, `/api/events`, `/api/status/*` und `/ws`. Ohne Angabe nur lokal an
     * (`RELEASE_ID` fehlt oder ist `dev`); `STATUS_PAGE=on` oder `off` überstimmt das. 🔴 Auf Stage und Production an: Sehen
     * können sie nur Editoren und Admins (`auth/status-view.ts`, WI-0120 A11), und Production folgt den Schaltern der Stage
     * (`ops/production/schalter-abgleich.sh`, Betreiber 2026-10-14). Dass es auf Production an bleibt, hat der Betreiber am
     * 2026-10-16 vorbehaltlich eines Berichts von Claudio bestätigt (WI-0197 §1). Vorher galt „aus, bis Auth geklärt ist“ (2026-10-04).
     */
    statusPage?: boolean | undefined;
    /** Das Profil der Variablen der Queue (`config/jobs/<name>.json`); ohne `JOBS_PROFILE` siehe `jobsProfileName`. */
    jobsProfile?: string | undefined;
    /** Die Anmeldung (WI-0120); ohne Wert ist sie aus (Tests, Releases ohne `AVESMAPS_ENV`). */
    auth?: AuthConfig | undefined;
    /**
     * Das Profil der Tür (`AUTH_GATE`, WI-0127 SYS-3, SYS-0001 §3.8, §4.3): `members` lässt im Normalbetrieb nur angemeldete Sitzungen
     * dieser Umgebung durch (Stage), `public` alle (Production). Ohne Wert `members` (`gateProfile`).
     */
    authGate?: GateProfile | undefined;
    /**
     * Ob die Karte bearbeitet werden darf (`MAP_EDITING`, WI-0128 E9, EDIT-0001 §4.6): `off` oder `testwelt`. Ohne Wert `off`, lokal
     * `testwelt` (`mapEditingMode`). Fehlt das Feld (Tests mit eigener Konfiguration), gilt `off`.
     */
    mapEditing?: MapEditingMode | undefined;
    /**
     * Wie Aufträge der Abgleiche ausgeführt werden (`ABGLEICHE`, WI-0127 SYS-14, SYS-14b): je Quelle `worker`, `korridor` oder `aus`;
     * ohne Wert lokal `worker`, sonst `aus` (`abgleicheModes`). Ein einzelner Wert gilt für alle Quellen (Tests); fehlt das Feld, `aus`.
     */
    abgleiche?: AbgleichAusfuehrung | AbgleichAusfuehrungen | undefined;
    /**
     * Ob der Betreiber-Kanal „Claudia & Claudio“ hier lebt (`KANAL`, WI-0124; Betreiber 2026-10-13: „dann deaktiviert noch "Claudia und
     * Claudio" für production“): `an` oder `aus`. Ohne Wert `an`. Bei `aus` fällt die Capability `use_operator_channel` aus jeder Session
     * (Eintrag und Glocke verschwinden von selbst), und `/api/kanal/*` antwortet 410 mit Satz. Grund: Die Kanal-Routine liest nur den Kanal
     * der Stage, und ohne Jobs-Worker würde dort nie ein Bild entstehen — eine Meldung ginge ins Leere.
     */
    kanal?: KanalSchalter | undefined;
    /**
     * Die Production-Freigabe (FREIGABE-0001, F3): Claudios Statusdatei (`FREIGABE_STATUS_FILE`), geschrieben von
     * `npm run freigabe:stand`. Der Server kennt weder Git noch Production und rechnet nichts nach; ohne die Datei heißt es
     * „nicht eingerichtet“, und der Weg nach Production bleibt zu. Lokal fehlt sie.
     */
    freigabe?: { statusFile: string | undefined } | undefined;
    /**
     * Die Sicherung (WI-0127 SYS-9, SYS-0001 §3.6, §9e): Claudios Statusdatei (`BACKUP_STATUS_FILE`) und das Verzeichnis für den Auftrag
     * „Sicherung jetzt“ (`BACKUP_REQUEST_DIR`). Beide setzt Claudio je Umgebung; ohne die Datei heißt die Sicherung „nicht
     * eingerichtet“, ohne das Verzeichnis ist der Knopf aus. Lokal fehlen beide.
     */
    backup?: { statusFile: string | undefined; requestDir: string | undefined } | undefined;
    /**
     * Das Profil des Höhenmodells (`HOEHENMODELL`, WI-0127 SYS-13, SYS-0001 §9c.8): `voll` wählt jede ausgelieferte Fassung und misst,
     * `abgenommen` (Production) wählt nur Fassungen aus `accepted` der Datei und misst nie. Ohne Wert `abgenommen` auf Production
     * (`AVESMAPS_ENV=production`), sonst `voll`; fehlt das Feld (Tests), `voll`.
     */
    hoehenmodell?: HoehenmodellProfil | undefined;
    /**
     * Der Systemzustand (WI-0127 SYS-8, SYS-0001 §3.6, §3.7): Claudios `system.json` (`SYSTEM_STATUS_FILE`, Platten, Dienste, Tür von außen,
     * Größen) und die Loopback-Adresse von Martin (`MARTIN_URL`, etwa `http://127.0.0.1:3010`, für die Probe `/health`). Beide setzt
     * Claudio je Umgebung; ohne sie steht dort „unbekannt“, kein Fehler.
     */
    systemzustand?: { statusFile: string | undefined; martinUrl: string | undefined } | undefined;
    /**
     * Die gemeinsame Warteschlange (WI-0163 §5.1): der Stand, den der Dirigent auf dem Host schreibt (`QUEUE_STAND_FILE`, auf dem VPS
     * `/var/lib/avesmaps3d/warteschlange/stand.json`), und wie diese Umgebung darin heißt (`AVESMAPS_ENV`, sonst `development`). Ohne
     * die Datei zeigt die App nur die eigene Tafel, wie bis WI-0163; fehlt das Feld (Tests mit eigener Konfiguration), ebenso.
     */
    warteschlange?: { standFile: string | undefined; umgebung: WarteschlangeUmgebung } | undefined;
    /**
     * Die Gegenseite für das Umgebungsmenü (WI-0180 §9, Claudio 2026-10-16): `/health` der jeweils anderen Umgebung auf Loopback
     * (`GEGENSEITE_HEALTH_URL`, Stage `http://127.0.0.1:3000/health`, Production `http://127.0.0.1:3100/health`). Claudio setzt sie
     * je Umgebung; lokal fehlt sie, dann ist die Gegenseite „unbekannt“. Kein Port als Vorgabe im Code.
     */
    umgebungen?: { gegenseiteHealthUrl: string | undefined } | undefined;
    /**
     * Der Weg der Sonderrollen von Production zur Stage (WI-0279 E9, `auth/sonderrollen-abgleich.ts`). `schluessel` kennen beide, `url` nur die
     * Stage: Sie zeigt auf Loopback von Production. Ohne Schlüssel gibt es die Route nicht und keinen Abruf.
     */
    sonderrollenAbgleich?: { schluessel: string | undefined; url: string | undefined } | undefined;
    /**
     * Der Release-Test auf dem Entwicklungsrechner (WI-0248 L). 🔴 Nur LOKAL gesetzt (`releaseTestLokal`): Ohne dieses Feld meldet der Server die
     * Routen `/api/admin/system/release-test` gar nicht an, auf Stage und Production gibt es sie nicht. `starter` überschreibt den Pfad des
     * Starters (`RELEASE_TEST_STARTER`); ohne Wert gilt der Werkzeugklon `C:/avesmaps3d-data/release-werkzeug`, sonst dieser Checkout. `ausgabe` ist
     * der Ordner für die Ausgabe des abgelösten Starters (`starter-<sha12>.log`); nur Tests setzen ihn, sonst gilt `<Datenwurzel>/release-abholer`.
     */
    releaseTest?: { starter: string | undefined; ausgabe?: string | undefined } | undefined;
    /**
     * Der Abzug für lokal (WI-0251, `abzug/konfig.ts`): Stage und Production erstellen und liefern ihn aus (`erstellen`, Ablage `ABZUG_ROOT`),
     * der Entwicklungsrechner spielt ihn ein (`einspielen`). Ohne dieses Feld meldet der Server die Routen gar nicht an.
     */
    abzug?: AbzugConfig | undefined;
    /**
     * Der Discord-Tagesbericht (WI-0255, `discord/konfig.ts`): Modus, Bot-Schlüssel, Kanäle und die Quellen der Werkstatt. 🔴 Gesendet wird nur in
     * Production; ohne dieses Feld (Tests) gilt `aus`.
     */
    discord?: DiscordKonfig | undefined;
    /**
     * Die Befehle `/hilfe`, `/bug`, `/idee`, `/frage` (WI-0255 Paket 2, `discord/konfig.ts`): nur mit `DISCORD_PUBLIC_KEY`, auf Stage oder
     * Production mit echtem Release und wo der Kanal lebt. Ohne dieses Feld antworten beide Pfade 404.
     */
    discordInteraktionen?: DiscordInteraktionenKonfig | undefined;
}

/**
 * Läuft dieser Server auf dem Entwicklungsrechner? Beides muss stimmen: Die Anmeldung läuft als `development` (`AVESMAPS_ENV=development`, oder
 * ohne Namen, weil `RELEASE_ID` fehlt oder `dev` ist), und `RELEASE_ID` fehlt oder ist `dev`. Ein benanntes Stage oder Production ist nie lokal,
 * ein Server mit einem echten Release auch dann nicht, wenn jemand `AVESMAPS_ENV=development` setzt.
 */
export function releaseTestLokal(environment: NodeJS.ProcessEnv, auth: AuthConfig): boolean {
    return auth.environment === "development" && (environment["RELEASE_ID"] ?? "dev") === "dev";
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): ServerConfig {
    const port = Number.parseInt(environment["PORT"] ?? "3000", 10);
    if (!Number.isInteger(port) || port <= 0) {
        throw new Error(`PORT is not a valid port number: ${environment["PORT"]}`);
    }
    const auth = loadAuthConfig(environment);
    const abzug = abzugKonfiguration(environment, auth);
    return {
        port,
        host: environment["HOST"] ?? "127.0.0.1",
        releaseId: environment["RELEASE_ID"] ?? "dev",
        databaseUrl: environment["DATABASE_URL"],
        tileRoot: environment["TILE_ROOT"],
        mediaRoot: environment["MEDIA_ROOT"],
        statusPage: statusPageEnabled(environment),
        jobsProfile: jobsProfileName(environment),
        auth,
        authGate: gateProfile(environment),
        mapEditing: mapEditingMode(environment),
        abgleiche: abgleicheModes(environment),
        kanal: kanalSchalter(environment),
        backup: { statusFile: environment["BACKUP_STATUS_FILE"], requestDir: environment["BACKUP_REQUEST_DIR"] },
        freigabe: { statusFile: environment["FREIGABE_STATUS_FILE"] },
        hoehenmodell: hoehenmodellProfil(environment),
        systemzustand: { statusFile: environment["SYSTEM_STATUS_FILE"], martinUrl: environment["MARTIN_URL"] },
        warteschlange: { standFile: environment["QUEUE_STAND_FILE"], umgebung: warteschlangeUmgebung(environment) },
        umgebungen: { gegenseiteHealthUrl: environment["GEGENSEITE_HEALTH_URL"] },
        sonderrollenAbgleich: {
            schluessel: environment["SONDERROLLEN_ABGLEICH_SCHLUESSEL"] || undefined,
            url: environment["SONDERROLLEN_ABGLEICH_URL"] || undefined,
        },
        besucher: { salt: environment["VISITOR_SALT"] },
        apiZaehler: apiZaehlerEigeneAdressen(environment),
        ...(releaseTestLokal(environment, auth)
            ? { releaseTest: { starter: environment["RELEASE_TEST_STARTER"] } }
            : {}),
        ...(abzug === undefined ? {} : { abzug }),
        discord: discordKonfiguration(environment),
        discordInteraktionen: discordInteraktionenKonfiguration(environment),
    };
}

/**
 * Der Schalter des Ortseditors aus `MAP_EDITING` (WI-0128 E9, EDIT-0001 §4.6, §5.1 N1). 🔴 Ohne Wert `off`: Vergisst eine Umgebung den
 * Wert, schreibt dort niemand die Karte. Nur lokal (`RELEASE_ID` fehlt oder ist `dev`, und es ist nicht Production) ist die Vorgabe
 * `testwelt`, wie die Statusseite. Ein anderer Wert hält den Start an wie ein ungültiger `PORT`.
 *
 * 🔴 **Betreiberentscheidung vom 2026-10-15:** Auch Production darf `testwelt`, ausdrücklich gesetzt, und zwar NEBEN dem Legacy-Zug je
 * Kategorie. Wörtlich: „Auch auf avesmaps.de soll man Orte bearbeiten können. Mir ist klar, dass Teständerungen dort für Besucher
 * sichtbar sind, bis der nächste Legacy-Zug sie überschreibt.“ Davor, am selben Tag: „JA ICH WEISS DASS EDITIEREN DURCH LEGACY ZÜGE
 * ÜBERSCHRIEBEN WIRD UND WILL HIERMIT EXPLIZIT KLARSTELLEN DASS MIR DAS EGAL IST, DA WIR SONST NICHT DAS EDITIEREN TESTEN KÖNNEN“.
 * Damit sind zwei Startsperren gefallen: `testwelt` in Production (Kap. 9.77 „bis zum Umstieg schreibt dort niemand“) und
 * `zugUndEditorNichtZugleich` (WI-0141 §3.6, Claudio 2026-10-13). Was der nächste Zug überschreibt, steht in WI-0128 §10.5.
 */
export function mapEditingMode(environment: NodeJS.ProcessEnv): MapEditingMode {
    const value = environment["MAP_EDITING"];
    if (value === undefined || value === "") {
        const lokal = (environment["RELEASE_ID"] ?? "dev") === "dev" && environment["AVESMAPS_ENV"] !== "production";
        return lokal ? "testwelt" : "off";
    }
    if ((MAP_EDITING_MODES as readonly string[]).includes(value)) return value as MapEditingMode;
    throw new Error(`MAP_EDITING must be "off" or "testwelt": ${value}`);
}

/**
 * Wie diese Umgebung im Stand der gemeinsamen Warteschlange heißt (WI-0163 §5.3): `AVESMAPS_ENV`, sonst `development`, dieselbe Regel
 * wie beim Dirigenten. Einen unbekannten Wert weist schon die Anmeldung beim Start ab (`loadAuthConfig`); hier gilt er dann nicht.
 */
export function warteschlangeUmgebung(environment: NodeJS.ProcessEnv): WarteschlangeUmgebung {
    const named = environment["AVESMAPS_ENV"];
    return named !== undefined && (WARTESCHLANGE_UMGEBUNGEN as readonly string[]).includes(named)
        ? (named as WarteschlangeUmgebung)
        : "development";
}

/** `API_ZAEHLER_EIGENE_ADRESSEN`: gültige IP-Adressen bleiben, der Rest wird gezählt und fällt weg. */
export function apiZaehlerEigeneAdressen(environment: NodeJS.ProcessEnv): {
    eigeneAdressen: string[];
    verworfen: number;
} {
    const eintraege = (environment["API_ZAEHLER_EIGENE_ADRESSEN"] ?? "")
        .split(",")
        .map((eintrag) => eintrag.trim())
        .filter((eintrag) => eintrag !== "");
    const eigeneAdressen = eintraege.filter((eintrag) => isIP(eintrag) !== 0);
    return { eigeneAdressen, verworfen: eintraege.length - eigeneAdressen.length };
}

/** Die Statusseite: ausdrücklich `STATUS_PAGE=on`/`off`, sonst nur lokal (ohne `RELEASE_ID` oder mit `dev`). */
export function statusPageEnabled(environment: NodeJS.ProcessEnv): boolean {
    const flag = environment["STATUS_PAGE"];
    if (flag === "on") return true;
    if (flag === "off") return false;
    return (environment["RELEASE_ID"] ?? "dev") === "dev";
}

/**
 * Das Profil der Tür aus `AUTH_GATE` (SYS-0001 §3.8). 🔴 Ohne Wert gilt `members`, das heutige Verhalten der Stage: Vergisst eine
 * Umgebung den Wert, steht sie hinter der Anmeldung, statt still offen zu sein. Production setzt `public` ausdrücklich, und Claudios
 * Postflight prüft dort einen anonymen Seitenaufruf (200). Ein anderer Wert hält den Start an wie ein ungültiger `PORT`: Ein Tippfehler
 * fällt beim Ausrollen auf, nicht erst einem Besucher.
 */
export function gateProfile(environment: NodeJS.ProcessEnv): GateProfile {
    const value = environment["AUTH_GATE"];
    if (value === undefined || value === "") return "members";
    if ((GATE_PROFILES as readonly string[]).includes(value)) return value as GateProfile;
    throw new Error(`AUTH_GATE must be "members" or "public": ${value}`);
}
