import { wikiAbrufErlaubt } from "../config.ts";
import { WikiTransportFehler } from "./fehler.ts";
import {
    erzeugeAnmeldung,
    type AnmeldeAnfrage,
    type AnmeldeAntwort,
    type AnmeldeAuskunft,
    type Anmeldung,
} from "./anmeldung.ts";
import {
    ANFRAGE_MAX_ZEICHEN,
    BACKOFF_BASIS_MS,
    TIMEOUT_INTERAKTIV_MS,
    TIMEOUT_MS,
    WARTE_MAX_MS,
    WIEDERHOLUNGEN,
    WIKI_API_URL,
    WIKI_USER_AGENT,
} from "./konstanten.ts";
import { erzeugeTaktOrt, type TaktOrt } from "./ort.ts";
import { erzeugeSchutz, type Schutz, type SchutzLage, type SchutzOptionen } from "./schutz.ts";
import { baueAbfrage } from "./stapel.ts";
import { erzeugeTakt, type Takt, type TaktOptionen } from "./takt.ts";

/**
 * Der Client der MediaWiki-API des Wiki Aventurica (WI-0253 B-1): LESEND (`action=query`, `parse`) und die Anmeldung. Kein Schreiben ins Wiki,
 * keine Dateien, keine Spezialseiten (die robots.txt verbietet `Spezial:`, der Bild-Hotlink löste am 20.08.2026 die Spamfalle aus).
 *
 * Jede Anfrage geht durch dieselben Schleusen, in dieser Reihenfolge:
 *   1. **Schutz** (`schutz.ts`): gilt eine Pause (403, 429, Unterbrecher), geht nichts hinaus;
 *   2. **Anmeldung** (`anmeldung.ts`): für Stapel wird, wenn nötig, einmal angemeldet; ein Abruf, auf den ein Mensch wartet
 *      (`interaktiv`), meldet nie an (er holt EINEN Titel, die Anmeldung hebt nur die Stapelgröße und kostet zwei gedrosselte Anfragen);
 *   3. **Takt** (`takt.ts`): mindestens 20 s plus Jitter für alle Anfragen des Hosts, die Anmelde-POSTs eingeschlossen;
 *      `interaktiv` wartet nicht und weist mit `belegt` ab, ohne einen Platz zu belegen;
 *   4. **die Länge**: Pfad plus Abfrage über 8.000 Zeichen scheitern vor jeder Anfrage (`url_zu_lang`), nicht als 414 des Wikis.
 *
 * Die Antwort wird gelesen, nicht geglaubt (HTTP 200 ist kein „gesund“): MediaWiki liefert `assertuserfailed`, `toomanyvalues` und
 * Serverfehler als 200 mit einem `error`-Objekt. `assertuserfailed` verwirft die Sitzung und meldet EINMAL je Aufruf neu an;
 * `toomanyvalues` setzt die Stapelgröße auf 50 zurück und ist laut. 429 und 503 warten ihr `Retry-After` ab, aber höchstens fünf Minuten
 * und höchstens zweimal; dann hält der Aufruf an, und die Pause gilt für alle. 403 wiederholt nichts und pausiert eine Stunde. Drei
 * Fehler in Folge öffnen den Unterbrecher.
 *
 * Tests richten `apiUrl` und `fetch` auf einen lokalen Testserver; das Wiki Aventurica sieht nie einen Testlauf.
 */

export interface WikiClientOptionen extends TaktOptionen, SchutzOptionen {
    /** Der Ordner des Takts (`WIKI_TAKT_ROOT`); `undefined`: nicht eingerichtet, dann geht nichts hinaus. */
    taktVerzeichnis: string | undefined;
    /** Pfad der Datei mit den Zugangsdaten des Bot-Kontos (`WIKI_BOT_ZUGANG_DATEI`). */
    zugangsdatei?: string | undefined;
    repositoryWurzel?: string | undefined;
    /**
     * Die Umgebung des Prozesses für die harte Sperre (`wikiAbrufErlaubt`); ohne Angabe `process.env`. Sie gilt nur, wenn `apiUrl` fehlt, der
     * Client also das ECHTE Wiki ansprechen würde; ein Test mit eigenem Server (`apiUrl`) ist davon nicht berührt.
     */
    environment?: NodeJS.ProcessEnv | undefined;
    apiUrl?: string | undefined;
    fetch?: typeof fetch | undefined;
    wiederholungen?: number | undefined;
    backoffBasisMs?: number | undefined;
    warteMaxMs?: number | undefined;
    timeoutMs?: number | undefined;
    interaktivTimeoutMs?: number | undefined;
    jetzt?: (() => number) | undefined;
    schlafe?: ((ms: number, signal?: AbortSignal) => Promise<void>) | undefined;
    sperreWartetMs?: number | undefined;
    sperreVeraltetMs?: number | undefined;
}

export interface FrageOptionen {
    /** Ein Mensch wartet: kein Anmelden, kein Warten auf den Takt, keine Wiederholung, kurze Zeitgrenze. */
    interaktiv?: boolean | undefined;
    signal?: AbortSignal | undefined;
}

/** Der Stand des Transports, gelesen OHNE jede Anfrage an das Wiki. */
export interface WikiStatus {
    taktNutzbar: boolean;
    /** Wann wäre ein Platz frei (0: sofort); `null`, wenn der Takt nicht nutzbar ist. */
    taktFreiInMs: number | null;
    pause: { bisMs: number; grund: string } | null;
    fehlerFolge: number;
    anmeldung: AnmeldeAuskunft | null;
}

export interface WikiClient {
    status(): Promise<WikiStatus>;
    /** Eine lesende Abfrage; gibt den JSON-Körper zurück (`format=json`, `formatversion=2`). */
    frage(params: Readonly<Record<string, string>>, optionen?: FrageOptionen): Promise<Record<string, unknown>>;
}

interface Roh {
    status: number | null;
    retryAfterMs: number | null;
    daten: Record<string, unknown> | null;
    setCookies: string[];
}

type Urteil =
    | { art: "ok"; daten: Record<string, unknown> }
    | { art: "gesperrt" }
    | { art: "gedrosselt"; retryAfterMs: number | null }
    | {
          art: "vorlaeufig";
          status: number | null;
          retryAfterMs: number | null;
          apiCode?: string;
          grund: "http" | "verbindung" | "antwort" | "api";
      }
    | { art: "http"; status: number }
    | { art: "assert" }
    | { art: "zuvielewerte" }
    | { art: "api"; code: string; info: string | undefined };

/** Fehler der API, die „später“ heißen: Das Wiki ist belastet oder schreibgeschützt, wir haben nichts falsch gemacht. */
function vorlaeufigerApiCode(code: string): boolean {
    return code === "ratelimited" || code === "maxlag" || code === "readonly" || code.startsWith("internal_api_error");
}

/** `Retry-After` in Millisekunden: Sekunden oder ein HTTP-Datum; alles andere ist unbekannt (`null`). */
export function retryAfterMs(wert: string | null, jetzt: number): number | null {
    if (wert === null) return null;
    const text = wert.trim();
    if (/^\d+$/u.test(text)) return Number(text) * 1000;
    const datum = Date.parse(text);
    return Number.isNaN(datum) ? null : Math.max(0, datum - jetzt);
}

function bewerte(roh: Roh): Urteil {
    const status = roh.status;
    if (status === null) return { art: "vorlaeufig", status: null, retryAfterMs: null, grund: "verbindung" };
    if (status === 403) return { art: "gesperrt" };
    if (status === 429) return { art: "gedrosselt", retryAfterMs: roh.retryAfterMs };
    if (status === 502 || status === 503 || status === 504 || status >= 500) {
        return { art: "vorlaeufig", status, retryAfterMs: roh.retryAfterMs, grund: "http" };
    }
    if (status >= 300) return { art: "http", status };
    if (roh.daten === null) return { art: "vorlaeufig", status, retryAfterMs: null, grund: "antwort" };
    const fehler = roh.daten["error"];
    if (typeof fehler === "object" && fehler !== null) {
        const angaben = fehler as Record<string, unknown>;
        const code = typeof angaben["code"] === "string" ? angaben["code"] : "unbekannt";
        const info = typeof angaben["info"] === "string" ? angaben["info"].slice(0, 200) : undefined;
        if (code === "assertuserfailed" || code === "assertbotfailed") return { art: "assert" };
        if (code === "toomanyvalues") return { art: "zuvielewerte" };
        if (vorlaeufigerApiCode(code)) {
            return { art: "vorlaeufig", status, retryAfterMs: roh.retryAfterMs, apiCode: code, grund: "api" };
        }
        return { art: "api", code, info };
    }
    return { art: "ok", daten: roh.daten };
}

export function erzeugeWikiClient(optionen: WikiClientOptionen): WikiClient {
    // 🔴 Vor allem anderen, ohne Anfrage: Ein echter Client entsteht nur dort, wo ein Abruf erlaubt ist (Stage oder Production, echtes Release,
    // Takt-Ordner). Lokal wirft der Erzeuger; `fetch` wird nie berührt.
    if (optionen.apiUrl === undefined) {
        const urteil = wikiAbrufErlaubt(optionen.environment ?? process.env);
        if (!urteil.erlaubt) throw new WikiTransportFehler("abruf_gesperrt", urteil.text);
    }
    const apiUrl = optionen.apiUrl ?? WIKI_API_URL;
    const fetchFn = optionen.fetch ?? fetch;
    const wiederholungen = optionen.wiederholungen ?? WIEDERHOLUNGEN;
    const backoffBasisMs = optionen.backoffBasisMs ?? BACKOFF_BASIS_MS;
    const warteMaxMs = optionen.warteMaxMs ?? WARTE_MAX_MS;
    const timeoutMs = optionen.timeoutMs ?? TIMEOUT_MS;
    const interaktivTimeoutMs = optionen.interaktivTimeoutMs ?? TIMEOUT_INTERAKTIV_MS;
    const zufall = optionen.zufall ?? Math.random;

    const ort: TaktOrt = erzeugeTaktOrt({
        verzeichnis: optionen.taktVerzeichnis,
        jetzt: optionen.jetzt,
        schlafe: optionen.schlafe,
        sperreWartetMs: optionen.sperreWartetMs,
        sperreVeraltetMs: optionen.sperreVeraltetMs,
    });
    const takt: Takt = erzeugeTakt(ort, optionen);
    const schutz: Schutz = erzeugeSchutz(ort, optionen);
    const anmeldung: Anmeldung = erzeugeAnmeldung(ort, {
        zugangsdatei: optionen.zugangsdatei,
        repositoryWurzel: optionen.repositoryWurzel,
    });

    /** Eine einzelne Anfrage an das Wiki, ohne Takt und ohne Urteil. Ein Fehler der Verbindung wird `status: null`, nie geworfen. */
    async function sendeHttp(
        methode: "GET" | "POST",
        params: Readonly<Record<string, string>>,
        cookieKopf: string | null,
        zeitgrenzeMs: number,
        signal: AbortSignal | undefined,
    ): Promise<Roh> {
        const abfrage = baueAbfrage({ format: "json", formatversion: "2", ...params });
        const kopf: Record<string, string> = { "User-Agent": WIKI_USER_AGENT, Accept: "application/json" };
        if (cookieKopf !== null) kopf["Cookie"] = cookieKopf;
        // 🔴 Das Passwort steht im Rumpf eines POST, nie in der Adresse.
        const zeitgrenze = AbortSignal.timeout(zeitgrenzeMs);
        try {
            const antwort = await fetchFn(methode === "GET" ? `${apiUrl}?${abfrage}` : apiUrl, {
                method: methode,
                headers: methode === "POST" ? { ...kopf, "Content-Type": "application/x-www-form-urlencoded" } : kopf,
                ...(methode === "POST" ? { body: abfrage } : {}),
                // Eine Weiterleitung heißt hier „falscher Ort“, nie „folge ihr“ (Cookies und Passwort würden mitgehen).
                redirect: "manual",
                signal: signal === undefined ? zeitgrenze : AbortSignal.any([signal, zeitgrenze]),
            });
            const text = await antwort.text();
            let daten: Record<string, unknown> | null = null;
            try {
                const wert: unknown = JSON.parse(text);
                if (typeof wert === "object" && wert !== null && !Array.isArray(wert))
                    daten = wert as Record<string, unknown>;
            } catch {
                daten = null;
            }
            return {
                status: antwort.status,
                retryAfterMs: retryAfterMs(antwort.headers.get("retry-after"), ort.jetzt()),
                daten,
                setCookies: antwort.headers.getSetCookie(),
            };
        } catch {
            if (signal?.aborted === true) throw new WikiTransportFehler("abgebrochen", "Abgebrochen");
            return { status: null, retryAfterMs: null, daten: null, setCookies: [] };
        }
    }

    /** Der Fehler zu einem Urteil, das keinen Erfolg ist; vermerkt es im Schutz. `vorlaeufig` zählt der Aufrufer selbst (einmal je Aufruf). */
    async function fehlerAus(urteil: Exclude<Urteil, { art: "ok" }>): Promise<WikiTransportFehler> {
        switch (urteil.art) {
            case "gesperrt": {
                const lage = await schutz.meldeFehler("gesperrt");
                return new WikiTransportFehler(
                    "http_403",
                    "Das Wiki hat die Anfrage mit 403 abgewiesen; die Anfragen pausieren",
                    {
                        status: 403,
                        bis: lage.pauseBisMs ?? undefined,
                        wiederholbar: true,
                    },
                );
            }
            case "gedrosselt": {
                const lage = await schutz.meldeFehler("gedrosselt", urteil.retryAfterMs);
                return new WikiTransportFehler("http_429", "Das Wiki bremst mit 429; die Anfragen pausieren", {
                    status: 429,
                    bis: lage.pauseBisMs ?? undefined,
                    wiederholbar: true,
                });
            }
            case "vorlaeufig":
                return new WikiTransportFehler(
                    urteil.grund === "verbindung"
                        ? "verbindung"
                        : urteil.grund === "antwort"
                          ? "antwort_ungueltig"
                          : "http_fehler",
                    urteil.grund === "api"
                        ? "Das Wiki meldet einen vorübergehenden Fehler der API"
                        : urteil.grund === "http"
                          ? "Das Wiki antwortet mit einem Serverfehler"
                          : urteil.grund === "antwort"
                            ? "Die Antwort des Wiki ist kein JSON-Objekt"
                            : "Das Wiki ist nicht erreichbar",
                    { status: urteil.status ?? undefined, apiCode: urteil.apiCode, wiederholbar: true },
                );
            case "http":
                return new WikiTransportFehler("http_fehler", "Das Wiki antwortet unerwartet", {
                    status: urteil.status,
                });
            case "assert":
                return new WikiTransportFehler("anmeldung_verloren", "Die Bot-Sitzung ist weg (assertuserfailed)", {
                    wiederholbar: true,
                });
            case "zuvielewerte":
                return new WikiTransportFehler(
                    "api_zu_viele_werte",
                    "Das Wiki nimmt so viele Titel nicht an (toomanyvalues); es gelten 50",
                    {
                        apiCode: "toomanyvalues",
                        wiederholbar: true,
                    },
                );
            case "api":
                return new WikiTransportFehler("api_fehler", "Das Wiki meldet einen Fehler der API", {
                    apiCode: urteil.code,
                    apiInfo: urteil.info,
                });
        }
    }

    /** Die Anfrage der Anmeldung: durch Schutz und Takt, aber ohne Wiederholung. Einen Fehler im Körper wertet die Anmeldung selbst. */
    const sendeAnmeldung = async (anfrage: AnmeldeAnfrage): Promise<AnmeldeAntwort> => {
        await schutz.pruefeFrei();
        await takt.nimm();
        const cookies = Object.entries(anfrage.cookies);
        const roh = await sendeHttp(
            anfrage.methode,
            anfrage.params,
            cookies.length === 0 ? null : cookies.map(([name, wert]) => `${name}=${wert}`).join("; "),
            timeoutMs,
            undefined,
        );
        const urteil = bewerte(roh);
        if (urteil.art === "ok" || urteil.art === "api" || urteil.art === "assert" || urteil.art === "zuvielewerte") {
            await schutz.meldeErfolg();
            return { daten: roh.daten ?? {}, setCookies: roh.setCookies };
        }
        const fehler = await fehlerAus(urteil);
        if (urteil.art === "vorlaeufig") await schutz.meldeFehler("serverfehler");
        throw fehler;
    };

    return {
        async status(): Promise<WikiStatus> {
            try {
                const lage: SchutzLage = await schutz.lage();
                return {
                    taktNutzbar: true,
                    taktFreiInMs: await takt.freiInMs(),
                    pause:
                        lage.pauseBisMs !== null && lage.pauseBisMs > ort.jetzt()
                            ? { bisMs: lage.pauseBisMs, grund: lage.grund ?? "unbekannt" }
                            : null,
                    fehlerFolge: lage.fehlerFolge,
                    anmeldung: await anmeldung.status(),
                };
            } catch (fehler) {
                if (fehler instanceof WikiTransportFehler && fehler.code === "takt_nicht_nutzbar") {
                    return { taktNutzbar: false, taktFreiInMs: null, pause: null, fehlerFolge: 0, anmeldung: null };
                }
                throw fehler;
            }
        },

        async frage(
            params: Readonly<Record<string, string>>,
            optionenFrage: FrageOptionen = {},
        ): Promise<Record<string, unknown>> {
            const interaktiv = optionenFrage.interaktiv === true;
            const signal = optionenFrage.signal;

            // Zu lang scheitert vor jedem Platz im Takt: Ein Platz für eine Anfrage, die nie hinausgeht, wäre verschenkt. Mit `assert=user` gerechnet.
            const pfad = new URL(apiUrl).pathname;
            const laenge =
                pfad.length + 1 + baueAbfrage({ format: "json", formatversion: "2", assert: "user", ...params }).length;
            if (laenge > ANFRAGE_MAX_ZEICHEN) {
                throw new WikiTransportFehler(
                    "url_zu_lang",
                    `Die Abfrage ist ${String(laenge)} Zeichen lang, erlaubt sind ${String(ANFRAGE_MAX_ZEICHEN)}`,
                );
            }

            await schutz.pruefeFrei();
            // Ein Abruf, auf den ein Mensch wartet, meldet nie an; eine noch brauchbare Sitzung nutzt er trotzdem (`cookieKopf`).
            if (!interaktiv) await anmeldung.sicherstellen(sendeAnmeldung);

            const versuche = interaktiv ? 0 : wiederholungen;
            let versuch = 0;
            let erneuert = false;
            let wartenMs = 0;
            for (;;) {
                if (versuch === 0 && wartenMs === 0) {
                    if (interaktiv) {
                        const platz = await takt.versuche();
                        if (!platz.frei) {
                            throw new WikiTransportFehler(
                                "belegt",
                                "Der Takt der Wiki-Anfragen ist belegt; später noch einmal versuchen",
                                {
                                    bis: ort.jetzt() + platz.freiInMs,
                                    wiederholbar: true,
                                },
                            );
                        }
                    } else {
                        await takt.nimm(signal);
                    }
                } else {
                    // Auch der Wiederholversuch reserviert seinen Platz (Legacy-Lehre 25.08.2026): Sonst läse der nächste Prozess einen
                    // Platz von vor Minuten und feuerte unmittelbar hinter dem Wiederholversuch, ausgerechnet nach einem 429.
                    if (wartenMs > 0) await ort.schlafe(wartenMs, signal);
                    await schutz.pruefeFrei();
                    await takt.nimm(signal);
                }
                wartenMs = 0;

                const cookieKopf = await anmeldung.cookieKopf();
                const roh = await sendeHttp(
                    "GET",
                    cookieKopf === null ? params : { ...params, assert: "user" },
                    cookieKopf,
                    interaktiv ? interaktivTimeoutMs : timeoutMs,
                    signal,
                );
                const urteil = bewerte(roh);

                if (urteil.art === "ok") {
                    await schutz.meldeErfolg();
                    return urteil.daten;
                }
                if (urteil.art === "assert" && !interaktiv && !erneuert && cookieKopf !== null) {
                    // Eine übernommene Sitzung kann abgelaufen sein: wegwerfen, einmal frisch anmelden, dieselbe Anfrage noch einmal.
                    erneuert = true;
                    await anmeldung.verwirf();
                    await anmeldung.sicherstellen(sendeAnmeldung);
                    continue;
                }
                if (urteil.art === "zuvielewerte" && cookieKopf !== null) await anmeldung.meldeBudgetAbgewiesen();

                let endurteil: Exclude<Urteil, { art: "ok" }> = urteil;
                if (urteil.art === "vorlaeufig" || urteil.art === "gedrosselt") {
                    const bremse = urteil.retryAfterMs;
                    const zuLang = bremse !== null && bremse > warteMaxMs;
                    if (versuch < versuche && !zuLang) {
                        wartenMs = Math.max(bremse ?? 0, backoffBasisMs * (versuch + 1)) + Math.floor(zufall() * 500);
                        versuch += 1;
                        continue;
                    }
                    // Eine Wartezeit, die kein Lauf abwartet, gilt für alle als Pause (auch ein 503 mit `Retry-After`).
                    if (zuLang) endurteil = { art: "gedrosselt", retryAfterMs: bremse };
                }
                const fehler = await fehlerAus(endurteil);
                // Einmal je Aufruf, nicht je Versuch: Sonst öffnete ein einziger Aufruf mit drei Versuchen den Unterbrecher.
                if (endurteil.art === "vorlaeufig") await schutz.meldeFehler("serverfehler");
                throw fehler;
            }
        },
    };
}
