import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ANMELDUNG_SPERRE_MS, SITZUNG_MAX_ALTER_MS, STAPEL_ANONYM } from "./konstanten.ts";
import { leseDatei, schreibeAtomar, type TaktOrt } from "./ort.ts";
import { stapelGroesse, type StapelStatus } from "./stapel.ts";

/**
 * Die Bot-Anmeldung (WI-0253 B-1, B1-Vertrag; Legacy `sync.php`, `avesmapsWikiBotSitzungSicherstellen`): vorbereitet und nur gegen den
 * Testserver erprobt. Das Konto `Avesmaps` hat Bot-Recht (`apihighlimits`); das Recht wirkt nur NACH einer angemeldeten Sitzung.
 *
 * Vier Zustände, und „unversucht“ ist einer davon (ohne ihn wäre „noch nicht angemeldet“ von „abgelehnt“ nicht zu unterscheiden, und jede
 * Abfrage meldete sich neu an):
 *   - `unversucht`: Zugangsdaten da, es gab noch keinen Anlass zur Anmeldung;
 *   - `anonym`: keine brauchbaren Zugangsdaten, alles läuft mit 50 Titeln je Abfrage;
 *   - `bot`: angemeldet, 500 Titel je Abfrage;
 *   - `gescheitert`: Zugangsdaten da, die Anmeldung wurde abgelehnt (Code und Grund stehen im Status; kein Passwort, kein Benutzername).
 *
 * 🔴 ZUGANGSDATEN NUR AUS EINER DATEI AUSSERHALB DES REPOSITORYS (`WIKI_BOT_ZUGANG_DATEI`, JSON mit `bot_username` und `bot_password`, die
 * Namen aus Legacys `config.local.php`). Ein Pfad im Repository wird abgewiesen, ohne die Datei zu öffnen. Das Passwort steht im POST-Rumpf,
 * nie in einer Adresse, einem Protokoll, einer Fehlermeldung oder dem Status; der Status nennt nur, OB etwas hinterlegt ist.
 *
 * Die Sitzung liegt als Cookie-Ablage (`anmeldung.json`, 0660) im Ordner des Takts und wird von allen Prozessen des Hosts wiederverwendet
 * (Legacy: ohne Ablage meldete sich jeder Schritt neu an und zahlte zwei gedrosselte Anfragen). Sie gilt 900 Sekunden. Eine abgelehnte
 * Anmeldung wird 15 Minuten nicht wiederholt (keine Login-Schleife, ein falsches Botpasswort sperrt das Konto sonst).
 */

export type { StapelStatus as AnmeldeStatus } from "./stapel.ts";

export interface Zugangsdaten {
    benutzer: string;
    passwort: string;
}

export type ZugangsLage =
    | { art: "nicht_konfiguriert" }
    | {
          art: "unbrauchbar";
          code: "pfad_nicht_absolut" | "im_repository" | "nicht_lesbar" | "kein_json" | "unvollstaendig";
      }
    | { art: "ok"; zugang: Zugangsdaten };

/** Was der Status über die Anmeldung sagt. Kein Benutzername, kein Passwort, kein Cookie. */
export interface AnmeldeAuskunft {
    status: StapelStatus;
    /** Sind brauchbare Zugangsdaten da? (Nur ja oder nein.) */
    hinterlegt: boolean;
    /** Kurzcode des Grundes, wenn der Zustand nicht `bot` ist und es einen gibt. */
    grundCode: string | null;
    grund: string | null;
    /** Wie viele Titel je Abfrage gelten: 500 nur mit nachgewiesener Anmeldung, sonst 50. */
    titelBudget: number;
    /** `true`, wenn das Wiki 500 Titel trotz Anmeldung abgewiesen hat (`toomanyvalues`): Degradation, sichtbar. */
    budgetAbgewiesen: boolean;
    sitzungAlterMs: number | null;
}

interface Sitzung {
    cookies: Record<string, string>;
    seit: number;
    budgetAbgewiesen: boolean;
}
interface Fehlschlag {
    code: string;
    grund: string;
    seit: number;
}
interface Ablage {
    sitzung: Sitzung | null;
    fehlschlag: Fehlschlag | null;
}

/** Eine Anfrage, wie die Anmeldung sie dem Client übergibt (der sie durch Takt und Schutz schickt). */
export interface AnmeldeAnfrage {
    methode: "GET" | "POST";
    params: Record<string, string>;
    cookies: Record<string, string>;
}
export interface AnmeldeAntwort {
    daten: Record<string, unknown>;
    /** Die `Set-Cookie`-Zeilen der Antwort, roh. */
    setCookies: readonly string[];
}
export type AnmeldeSender = (anfrage: AnmeldeAnfrage) => Promise<AnmeldeAntwort>;

export interface AnmeldungOptionen {
    /** Pfad der Zugangsdatei (`WIKI_BOT_ZUGANG_DATEI`). */
    zugangsdatei: string | undefined;
    /** Die Wurzel des Repositorys, außerhalb derer die Zugangsdatei liegen muss; Tests setzen sie. */
    repositoryWurzel?: string | undefined;
}

export interface Anmeldung {
    /** Die Auskunft OHNE jede Anfrage an das Wiki. */
    status(): Promise<AnmeldeAuskunft>;
    /** Der Cookie-Kopf einer noch brauchbaren Sitzung (auch ohne Anmeldeversuch, sie kostet nichts), sonst `null`. */
    cookieKopf(): Promise<string | null>;
    /** Meldet an, wenn nötig und erlaubt; höchstens ein Versuch zugleich in diesem Prozess. Wirft nur Transportfehler. */
    sicherstellen(sende: AnmeldeSender): Promise<AnmeldeAuskunft>;
    /** Wirft die Sitzung weg (`assertuserfailed`). */
    verwirf(): Promise<void>;
    /** Merkt, dass das Wiki 500 Titel abgewiesen hat (`toomanyvalues`): ab jetzt 50. */
    meldeBudgetAbgewiesen(): Promise<void>;
}

/** Wurzel dieses Repositorys, vom Ort dieser Datei aus (`apps/server/src/wiki/transport` oder `apps/server/dist/wiki/transport`). */
function repositoryWurzelStandard(): string {
    return resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
}

function imVerzeichnis(wurzel: string, pfad: string): boolean {
    const rest = relative(wurzel, pfad);
    return rest === "" || (!rest.startsWith("..") && !isAbsolute(rest));
}

export async function liesZugang(pfad: string | undefined, repositoryWurzel: string): Promise<ZugangsLage> {
    if (pfad === undefined) return { art: "nicht_konfiguriert" };
    if (!isAbsolute(pfad)) return { art: "unbrauchbar", code: "pfad_nicht_absolut" };
    // Vor dem Öffnen: Eine Datei im Repository ist nie ein Ort für ein Geheimnis, auch nicht zum Lesen.
    if (imVerzeichnis(repositoryWurzel, resolve(pfad))) return { art: "unbrauchbar", code: "im_repository" };
    let roh: string;
    try {
        roh = await readFile(pfad, "utf8");
    } catch {
        return { art: "unbrauchbar", code: "nicht_lesbar" };
    }
    let wert: unknown;
    try {
        wert = JSON.parse(roh);
    } catch {
        return { art: "unbrauchbar", code: "kein_json" };
    }
    const objekt = (typeof wert === "object" && wert !== null ? wert : {}) as Record<string, unknown>;
    const benutzer = typeof objekt["bot_username"] === "string" ? objekt["bot_username"].trim() : "";
    const passwort = typeof objekt["bot_password"] === "string" ? objekt["bot_password"] : "";
    // Ein halber Zugang ist keiner: Mit nur dem Benutzernamen wäre die Anmeldung ein garantiert scheiternder Fremdaufruf.
    if (benutzer === "" || passwort.trim() === "") return { art: "unbrauchbar", code: "unvollstaendig" };
    // Das Passwort wird NICHT getrimmt: Leerzeichen am Rand könnten echt sein.
    return { art: "ok", zugang: { benutzer, passwort } };
}

/** `Set-Cookie`-Zeilen in einen Cookie-Bestand einrühren: nur das erste Paar je Zeile; leer oder `deleted` nimmt den Cookie zurück. */
export function cookiesAusKopfzeilen(
    zeilen: readonly string[],
    bestand: Record<string, string> = {},
): Record<string, string> {
    const neu = { ...bestand };
    for (const zeile of zeilen) {
        const paar = (zeile.split(";")[0] ?? "").trim();
        const gleich = paar.indexOf("=");
        if (gleich < 1) continue;
        const name = paar.slice(0, gleich).trim();
        const wert = paar.slice(gleich + 1);
        if (name === "") continue;
        if (wert === "" || wert.toLowerCase() === "deleted") delete neu[name];
        else neu[name] = wert;
    }
    return neu;
}

export function cookieKopfVon(cookies: Readonly<Record<string, string>>): string {
    return Object.entries(cookies)
        .map(([name, wert]) => `${name}=${wert}`)
        .join("; ");
}

/**
 * Die Antwort von `action=login`. 💣 MediaWiki antwortet auch auf eine abgelehnte Anmeldung mit HTTP 200: Der Befund steht nur im Rumpf.
 * Der `code` ist die eigentliche Auskunft (der Text ist für mehrere Ursachen derselbe): `wrongpassword` (Botpasswort falsch oder
 * zurückgezogen), `botpasswords-restriction-failed` (IP-Bereich), `nosuchuser`.
 */
export function loginErgebnis(
    daten: Record<string, unknown>,
): { ok: true } | { ok: false; code: string; grund: string } {
    const login = (typeof daten["login"] === "object" && daten["login"] !== null ? daten["login"] : {}) as Record<
        string,
        unknown
    >;
    if (login["result"] === "Success") return { ok: true };
    const grundRoh = login["reason"];
    const fehler = (typeof daten["error"] === "object" && daten["error"] !== null ? daten["error"] : {}) as Record<
        string,
        unknown
    >;
    let code = "";
    let grund = "";
    if (typeof grundRoh === "object" && grundRoh !== null) {
        const reason = grundRoh as Record<string, unknown>;
        code = typeof reason["code"] === "string" ? reason["code"].trim() : "";
        grund = typeof reason["text"] === "string" ? reason["text"].trim() : code;
    } else if (typeof grundRoh === "string") {
        grund = grundRoh.trim();
    }
    if (code === "" && typeof fehler["code"] === "string") code = fehler["code"].trim();
    if (grund === "") grund = code !== "" ? code : typeof login["result"] === "string" ? login["result"] : "";
    return {
        ok: false,
        code: code === "" ? "unbekannt" : code,
        grund: grund === "" ? "Grund unbekannt" : grund.slice(0, 200),
    };
}

const DATEI = "anmeldung.json";

function parseAblage(roh: string | null): Ablage {
    const leer: Ablage = { sitzung: null, fehlschlag: null };
    if (roh === null) return leer;
    try {
        const wert = JSON.parse(roh) as Record<string, unknown>;
        const sitzungRoh = wert["sitzung"] as Record<string, unknown> | null | undefined;
        const fehlRoh = wert["fehlschlag"] as Record<string, unknown> | null | undefined;
        let sitzung: Sitzung | null = null;
        if (
            sitzungRoh &&
            typeof sitzungRoh["seit"] === "number" &&
            typeof sitzungRoh["cookies"] === "object" &&
            sitzungRoh["cookies"] !== null
        ) {
            const cookies: Record<string, string> = {};
            for (const [name, cookie] of Object.entries(sitzungRoh["cookies"] as Record<string, unknown>)) {
                if (typeof cookie === "string") cookies[name] = cookie;
            }
            sitzung = { cookies, seit: sitzungRoh["seit"], budgetAbgewiesen: sitzungRoh["budgetAbgewiesen"] === true };
        }
        const fehlschlag =
            fehlRoh && typeof fehlRoh["seit"] === "number" && typeof fehlRoh["code"] === "string"
                ? {
                      code: fehlRoh["code"],
                      grund: typeof fehlRoh["grund"] === "string" ? fehlRoh["grund"] : "",
                      seit: fehlRoh["seit"],
                  }
                : null;
        return { sitzung, fehlschlag };
    } catch {
        return leer;
    }
}

export function erzeugeAnmeldung(ort: TaktOrt, optionen: AnmeldungOptionen): Anmeldung {
    const wurzel = optionen.repositoryWurzel ?? repositoryWurzelStandard();
    let laufend: Promise<AnmeldeAuskunft> | null = null;

    const ablage = async (): Promise<{ verzeichnis: string; inhalt: Ablage }> => {
        const verzeichnis = await ort.ordner();
        return { verzeichnis, inhalt: parseAblage(await leseDatei(join(verzeichnis, DATEI))) };
    };
    const speichere = (verzeichnis: string, inhalt: Ablage): Promise<void> =>
        // 0660: Sitzungs-Cookies (kein Passwort, sie laufen ab). Stage und Production laufen unter zwei Dienstbenutzern und teilen den Takt;
        // der Ordner ist 0770 mit ACL nur für diese beiden (`ops/production/wiki-einrichten.sh`). Mit 0600 endeten die Aufträge des anderen mit
        // `takt_nicht_nutzbar` (Entscheidung Claudia 2026-10-25 auf Claudios Frage zu 47f312320).
        schreibeAtomar(join(verzeichnis, DATEI), `${JSON.stringify(inhalt)}\n`, 0o660);

    /** Brauchbar: mit Cookies, nicht älter als 900 s und nicht aus der Zukunft (eine verstellte Uhr machte sie sonst unbegrenzt haltbar). */
    const brauchbar = (sitzung: Sitzung | null, jetzt: number): sitzung is Sitzung => {
        if (sitzung === null || Object.keys(sitzung.cookies).length === 0) return false;
        const alter = jetzt - sitzung.seit;
        return alter >= 0 && alter < SITZUNG_MAX_ALTER_MS;
    };

    const auskunft = (lage: ZugangsLage, inhalt: Ablage, jetzt: number): AnmeldeAuskunft => {
        const hinterlegt = lage.art === "ok";
        if (!hinterlegt) {
            const code = lage.art === "unbrauchbar" ? `zugang_${lage.code}` : "keine_zugangsdaten";
            return {
                status: "anonym",
                hinterlegt: false,
                grundCode: code,
                grund: lage.art === "unbrauchbar" ? "Zugangsdaten unbrauchbar" : "keine Zugangsdaten hinterlegt",
                titelBudget: STAPEL_ANONYM,
                budgetAbgewiesen: false,
                sitzungAlterMs: null,
            };
        }
        if (brauchbar(inhalt.sitzung, jetzt)) {
            const abgewiesen = inhalt.sitzung.budgetAbgewiesen;
            return {
                status: "bot",
                hinterlegt: true,
                grundCode: abgewiesen ? "api_zu_viele_werte" : null,
                grund: abgewiesen ? "das Wiki hat 500 Titel je Abfrage abgewiesen: es gelten 50" : null,
                titelBudget: stapelGroesse("bot", abgewiesen),
                budgetAbgewiesen: abgewiesen,
                sitzungAlterMs: jetzt - inhalt.sitzung.seit,
            };
        }
        const schlag = inhalt.fehlschlag;
        if (schlag !== null && jetzt - schlag.seit >= 0 && jetzt - schlag.seit < ANMELDUNG_SPERRE_MS) {
            return {
                status: "gescheitert",
                hinterlegt: true,
                grundCode: schlag.code,
                grund: schlag.grund,
                titelBudget: STAPEL_ANONYM,
                budgetAbgewiesen: false,
                sitzungAlterMs: null,
            };
        }
        return {
            status: "unversucht",
            hinterlegt: true,
            grundCode: null,
            grund: null,
            titelBudget: STAPEL_ANONYM,
            budgetAbgewiesen: false,
            sitzungAlterMs: null,
        };
    };

    const lese = async (): Promise<{ lage: ZugangsLage; verzeichnis: string; inhalt: Ablage }> => {
        const { verzeichnis, inhalt } = await ablage();
        return { lage: await liesZugang(optionen.zugangsdatei, wurzel), verzeichnis, inhalt };
    };

    async function anmelden(sende: AnmeldeSender, zugang: Zugangsdaten): Promise<void> {
        const tokenAntwort = await sende({
            methode: "POST",
            params: { action: "query", meta: "tokens", type: "login" },
            cookies: {},
        });
        const query = tokenAntwort.daten["query"] as { tokens?: { logintoken?: unknown } } | undefined;
        const token = query?.tokens?.logintoken;
        let cookies = cookiesAusKopfzeilen(tokenAntwort.setCookies);
        const merke = (code: string, grund: string): Promise<void> =>
            ort.mitSperre((verzeichnis) =>
                speichere(verzeichnis, { sitzung: null, fehlschlag: { code, grund, seit: ort.jetzt() } }),
            );
        if (typeof token !== "string" || token === "") {
            await merke("kein_login_token", "das Wiki lieferte kein Login-Token");
            return;
        }
        const loginAntwort = await sende({
            methode: "POST",
            params: { action: "login", lgname: zugang.benutzer, lgpassword: zugang.passwort, lgtoken: token },
            cookies,
        });
        const ergebnis = loginErgebnis(loginAntwort.daten);
        if (!ergebnis.ok) {
            // Nur Code und Grund aus der Antwort des Wikis; nie der Benutzername, nie das Passwort.
            await merke(ergebnis.code, ergebnis.grund);
            return;
        }
        cookies = cookiesAusKopfzeilen(loginAntwort.setCookies, cookies);
        if (Object.keys(cookies).length === 0) {
            await merke("keine_sitzung", "die Anmeldung gelang, aber das Wiki setzte keine Sitzung");
            return;
        }
        await ort.mitSperre((verzeichnis) =>
            speichere(verzeichnis, {
                sitzung: { cookies, seit: ort.jetzt(), budgetAbgewiesen: false },
                fehlschlag: null,
            }),
        );
    }

    return {
        async status(): Promise<AnmeldeAuskunft> {
            const { lage, inhalt } = await lese();
            return auskunft(lage, inhalt, ort.jetzt());
        },

        async cookieKopf(): Promise<string | null> {
            const { lage, inhalt } = await lese();
            if (lage.art !== "ok" || !brauchbar(inhalt.sitzung, ort.jetzt())) return null;
            return cookieKopfVon(inhalt.sitzung.cookies);
        },

        async sicherstellen(sende: AnmeldeSender): Promise<AnmeldeAuskunft> {
            if (laufend !== null) return laufend;
            const arbeit = (async (): Promise<AnmeldeAuskunft> => {
                const { lage, inhalt } = await lese();
                const vorher = auskunft(lage, inhalt, ort.jetzt());
                // Nur aus „unversucht“ wird angemeldet: anonym hat nichts, womit, bot hat schon, gescheitert wartet seine Sperrfrist ab.
                if (lage.art !== "ok" || vorher.status !== "unversucht") return vorher;
                await anmelden(sende, lage.zugang);
                const { inhalt: danach } = await ablage();
                return auskunft(lage, danach, ort.jetzt());
            })();
            laufend = arbeit;
            try {
                return await arbeit;
            } finally {
                laufend = null;
            }
        },

        async verwirf(): Promise<void> {
            await ort.mitSperre(async (verzeichnis) => {
                const inhalt = parseAblage(await leseDatei(join(verzeichnis, DATEI)));
                await speichere(verzeichnis, { sitzung: null, fehlschlag: inhalt.fehlschlag });
            });
        },

        async meldeBudgetAbgewiesen(): Promise<void> {
            await ort.mitSperre(async (verzeichnis) => {
                const inhalt = parseAblage(await leseDatei(join(verzeichnis, DATEI)));
                if (inhalt.sitzung === null) return;
                await speichere(verzeichnis, { ...inhalt, sitzung: { ...inhalt.sitzung, budgetAbgewiesen: true } });
            });
        },
    };
}
