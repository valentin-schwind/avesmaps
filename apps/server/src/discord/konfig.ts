import {
    DISCORD_KANAL_MUSTER,
    DISCORD_MODI,
    type DiscordKanalWert,
    type DiscordModus,
    type DiscordSperre,
} from "@avesmaps3d/shared";
import { brueckenKonfiguration, type BrueckeKonfig } from "./community-bruecke.ts";

/**
 * Die Konfiguration des Discord-Berichts (WI-0255), nur aus der Umgebung, nie aus einer Datei im Repository. Claudio legt sie auf dem VPS in
 * der geschützten Konfiguration ab (Handover `project-control/handovers/2026-10-25-discord-bericht-an-claudio.md`):
 *
 * | Variable                      | Bedeutung                                                                                          |
 * |-------------------------------|----------------------------------------------------------------------------------------------------|
 * | `DISCORD_BERICHT`             | `aus` (Vorgabe), `senden` (Berichtskanal); ein altes `testkanal` gilt als `aus` (s. u.)                |
 * | `DISCORD_BOT_TOKEN`           | 🔴 Geheimnis: der Schlüssel des vorhandenen Bots                                                   |
 * | `DISCORD_BERICHT_KANAL`       | Kennung des bisherigen Berichtskanals (Vorgabe: gilt, bis im Reiter ein Kanal steht)               |
 * | `DISCORD_FREIGABE_STATUS`     | wahlfrei: Pfad zur Statusdatei der Freigabe; Vorgabe `FREIGABE_STATUS_FILE` der Stage (s. u.)       |
 * | `DISCORD_BERICHT_FORMULIERER` | wahlfrei: absoluter Pfad eines Programms, das den Bericht formuliert (`formulierer.ts`)             |
 * | `DISCORD_BUG_KANAL`           | wahlfrei: Kanal, in den `/bug` die Meldung kurz postet (`meldungs-post.ts`); fehlt er, nur der Dank an die Person |
 * | `DISCORD_IDEE_KANAL`          | wahlfrei: dasselbe für `/idee`                                                                      |
 *
 * **Die Quellen des Berichts sind die der Stage** (Vali 2026-10-26): Was in Production läuft, weiß die Stage aus ihrer Statusdatei der Freigabe
 * (`production.commit`) und dem `verlauf.json` ihres eigenen Release (er reicht bis zu ihrem Stand und enthält den von Production); die Werkstatt ist
 * dieser Verlauf bis zum Stand der Stage. Es gibt keine Anfrage an die Production-App und keine Verbindung zu ihrer Datenbank.
 *
 * Den Berichtskanal kann der Reiter „Discord“ überschreiben (`discord_routine.berichts_kanal`, Migration 0227): Was dort steht, gilt vor der Umgebung
 * (`wirksam`). Der Bot-Schlüssel bleibt ausschließlich hier, in der Umgebung.
 *
 * 🔴 **Es gibt genau einen Kanal, den Berichtskanal** (Vali 2026-10-26: „du sollst den testkanal nicht mehr benutzen. der einzige kanal, den du benutzen
 * darfst ist: 1523690349816447157“). Kein Modus, keine Variable und keine Spalte führt je in einen anderen Kanal: Der Modus `testkanal` und
 * `DISCORD_TESTKANAL` sind abgeschafft, die Spalte `discord_routine.test_kanal` ist mit Migration 0294 gefallen.
 * Steht `DISCORD_BERICHT` noch auf `testkanal`, wirkt das wie `aus` und der Reiter sagt es (`modusVeraltet`).
 *
 * 🔴 **Gesendet wird nur von der Stage** (`AVESMAPS_ENV=staging` und ein echtes Release; Vali 2026-10-26: „am besten ist, wenn der bot von production
 * nichts weiß“): Steht `senden` in Production oder lokal, bleibt es eine Sperre (`nicht_stage`), kein Absturz — der Reiter sagt, warum. Ein
 * Production-Prozess sendet nie, was auch in seiner Umgebung steht. Ein unbekannter Wert ist `aus`.
 */
export interface DiscordKonfig {
    modus: DiscordModus;
    /** `DISCORD_BERICHT` stand noch auf dem abgeschafften Modus `testkanal`; `modus` ist dann `aus`. */
    modusVeraltet: boolean;
    umgebung: string;
    /** 🔴 Geheim. Verlässt diesen Prozess nur im Kopf `Authorization` einer Anfrage an Discord. */
    botToken: string | undefined;
    berichtKanal: string | undefined;
    /** Die Statusdatei der Freigabe (`FREIGABE_STATUS_FILE`): daraus weiß die Stage, welcher Stand in Production läuft und ob ihre Prüfung grün ist. */
    freigabeStatus: string | undefined;
    formulierer: string | undefined;
    /**
     * Die Kanäle, in die `/bug` und `/idee` die Meldung kurz posten (Vali 2026-11-02), jeder ein eigener Wert (nie der Berichtskanal). Fehlt einer oder hat er
     * nicht die Form einer Kanalkennung, wird nichts gepostet. Gepostet wird nur von der Stage (`meldungsKanal`), wie jede Nachricht des Bots.
     */
    bugKanal: string | undefined;
    ideeKanal: string | undefined;
    /** Nur Tests: ein gestelltes `fetch` statt Discord (wie `abzug.fetch`). Aus der Umgebung nie gesetzt. */
    abruf?: ((url: string, init: RequestInit) => Promise<Response>) | undefined;
}

const KANAL = new RegExp(DISCORD_KANAL_MUSTER, "u");
const leer = (wert: string | undefined): string | undefined =>
    wert === undefined || wert.trim() === "" ? undefined : wert.trim();

export function discordKonfiguration(env: NodeJS.ProcessEnv): DiscordKonfig {
    const roh = leer(env["DISCORD_BERICHT"]);
    const modus =
        roh !== undefined && (DISCORD_MODI as readonly string[]).includes(roh) ? (roh as DiscordModus) : "aus";
    // Der alte Modus `testkanal` ist kein Modus mehr: Er sendet nirgends hin, der Reiter sagt es.
    const modusVeraltet = roh === "testkanal";
    const kanal = (wert: string | undefined): string | undefined => {
        const id = leer(wert);
        return id !== undefined && KANAL.test(id) ? id : undefined;
    };
    const umgebung = leer(env["AVESMAPS_ENV"]) ?? "development";
    const echtesRelease = (env["RELEASE_ID"] ?? "dev") !== "dev";
    return {
        modus,
        modusVeraltet,
        // Stage und Production nur mit echtem Release: Ein lokaler Server mit `AVESMAPS_ENV=staging` sendet trotzdem nicht.
        umgebung: (umgebung === "production" || umgebung === "staging") && !echtesRelease ? "development" : umgebung,
        botToken: leer(env["DISCORD_BOT_TOKEN"]),
        berichtKanal: kanal(env["DISCORD_BERICHT_KANAL"]),
        freigabeStatus: leer(env["DISCORD_FREIGABE_STATUS"]) ?? leer(env["FREIGABE_STATUS_FILE"]),
        formulierer: leer(env["DISCORD_BERICHT_FORMULIERER"]),
        bugKanal: kanal(env["DISCORD_BUG_KANAL"]),
        ideeKanal: kanal(env["DISCORD_IDEE_KANAL"]),
    };
}

/**
 * Der Kanal, in den dieser Melde-Befehl seine Meldung kurz postet, oder `null`: nur `/bug` und `/idee` (`/frage` bleibt still), nur auf der Stage
 * (`umgebung`), nur mit Bot-Schlüssel und einem gültigen Wert. Ohne ihn gibt es nur den Dank an die meldende Person, wie vor dem Post.
 */
export function meldungsKanal(konfig: DiscordKonfig, befehl: "bug" | "idee" | "frage"): string | null {
    if (konfig.umgebung !== "staging" || konfig.botToken === undefined) return null;
    if (befehl === "bug") return konfig.bugKanal ?? null;
    if (befehl === "idee") return konfig.ideeKanal ?? null;
    return null;
}

/** Der Berichtskanal aus dem Reiter (`discord_routine`): `null` heißt „nichts eingetragen, es gilt die Umgebung“. */
export interface KanaeleAusReiter {
    berichts_kanal: string | null;
}

/**
 * Die Konfiguration mit dem Berichtskanal, der wirklich gilt: ein Wert aus dem Reiter vor dem der Umgebung. Alles Übrige (Modus, Schlüssel, Umgebung,
 * Quellen der Werkstatt) bleibt, wie es ist; der Reiter kann weder einschalten noch einen Schlüssel setzen.
 */
export function wirksam(konfig: DiscordKonfig, reiter: KanaeleAusReiter): DiscordKonfig {
    return {
        ...konfig,
        berichtKanal: reiter.berichts_kanal ?? konfig.berichtKanal,
    };
}

/** Ein Kanal für die Anzeige: was im Reiter steht, was die Umgebung vorgibt, was gilt und woher es kommt. */
export function kanalWert(eigen: string | null, umgebung: string | undefined): DiscordKanalWert {
    const vorgabe = umgebung ?? null;
    return {
        eigen,
        umgebung: vorgabe,
        gilt: eigen ?? vorgabe,
        quelle: eigen !== null ? "reiter" : vorgabe !== null ? "umgebung" : "keine",
    };
}

/** Der Berichtskanal, in den diese Umgebung senden würde (nur im Modus `senden`), oder `null`. Ein anderer Kanal ist nie das Ziel. */
export function zielKanal(konfig: DiscordKonfig): string | null {
    return konfig.modus === "senden" ? (konfig.berichtKanal ?? null) : null;
}

/** Warum diese Umgebung nicht sendet, oder `null`. Die Reihenfolge sagt das Wichtigste zuerst. */
export function sendeSperre(konfig: DiscordKonfig): DiscordSperre | null {
    // Production und lokal zuerst: Dort ist „nie“ die ehrliche Antwort, nicht „gerade ausgeschaltet“. Nur die Stage sendet.
    if (konfig.umgebung !== "staging") return "nicht_stage";
    if (konfig.modus === "aus") return "aus";
    if (konfig.botToken === undefined) return "ohne_schluessel";
    if (zielKanal(konfig) === null) return "ohne_kanal";
    return null;
}

/**
 * Der Empfänger der Befehle (WI-0255 Paket 2, `routes/discord-interaktionen.ts`). Vali wählte A (2026-10-26): Die App nimmt die Befehle dort an,
 * wo der Betreiber-Kanal lebt, also wo ein Vorgang gesichtet und abgearbeitet wird. Das ist heute die Stage; nginx reicht auf avesmaps.de nur
 * die zwei Pfade an die Stage-App weiter.
 *
 * Eingeschaltet ist er nur, wenn alles stimmt:
 *
 * | Bedingung                                        | sonst                                                                  |
 * |--------------------------------------------------|------------------------------------------------------------------------|
 * | `DISCORD_PUBLIC_KEY` = 64 Hex-Zeichen            | aus: ohne Schlüssel lässt sich keine Anfrage als Discords erkennen     |
 * | `AVESMAPS_ENV` = `staging` und ein echtes Release (`RELEASE_ID` nicht `dev`) | aus: Production und lokal nie (Vali 2026-10-26)     |
 * | `KANAL` nicht `aus`                              | aus: ein Vorgang ohne Kanal sähe niemand                               |
 *
 * Aus heißt: Beide Pfade antworten 404, wie eine Route, die es nicht gibt. `DISCORD_APPLICATION_ID` ist kein Geheimnis; die Vorgabe ist die ID
 * von Avesmaps. Der öffentliche Schlüssel ist ebenfalls kein Geheimnis.
 */
export interface DiscordInteraktionenKonfig {
    /** `DISCORD_PUBLIC_KEY`, klein geschrieben. */
    schluessel: string;
    anwendung: string;
    /** Nur Tests: ein gestelltes `fetch` für die Folgeantwort an Discord. Aus der Umgebung nie gesetzt. */
    abruf?: ((url: string, init: RequestInit) => Promise<Response>) | undefined;
    /** Nur Tests: wie lange der Empfänger auf das Anlegen wartet, bevor er aufgeschoben antwortet (Vorgabe 2000 ms, Discord gibt 3 s). */
    fristMs?: number | undefined;
    /**
     * Die Brücke nach Production für Website-Meldungen (WI-0268 C8, `community-bruecke.ts`): aus den Variablen `COMMUNITY_DISCORD_BRUECKE_SCHLUESSEL` und
     * `COMMUNITY_DISCORD_BRUECKE_URL`. Fehlt sie, ist die Brücke aus, und `/offen` und `/erledigt` bleiben, wie sie waren.
     */
    bruecke?: BrueckeKonfig | undefined;
}

export const DISCORD_ANWENDUNG = "1523674862038683689";

/** `DISCORD_APPLICATION_ID` oder die Vorgabe (auch die Kommandozeile nimmt sie, `befehle-registrieren`). */
export function anwendungsKennung(env: NodeJS.ProcessEnv): string {
    const id = leer(env["DISCORD_APPLICATION_ID"]);
    return id !== undefined && KANAL.test(id) ? id : DISCORD_ANWENDUNG;
}

export function discordInteraktionenKonfiguration(env: NodeJS.ProcessEnv): DiscordInteraktionenKonfig | undefined {
    const schluessel = leer(env["DISCORD_PUBLIC_KEY"])?.toLowerCase();
    if (schluessel === undefined || !/^[0-9a-f]{64}$/u.test(schluessel)) return undefined;
    const umgebung = leer(env["AVESMAPS_ENV"]);
    if (umgebung !== "staging") return undefined;
    if ((env["RELEASE_ID"] ?? "dev") === "dev") return undefined;
    if (leer(env["KANAL"]) === "aus") return undefined;
    const bruecke = brueckenKonfiguration(env);
    return { schluessel, anwendung: anwendungsKennung(env), ...(bruecke === undefined ? {} : { bruecke }) };
}
