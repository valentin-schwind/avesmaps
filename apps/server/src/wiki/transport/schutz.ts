import { join } from "node:path";
import { WikiTransportFehler } from "./fehler.ts";
import { PAUSE_403_MS, PAUSE_429_MIN_MS, UNTERBRECHER_PAUSE_MS, UNTERBRECHER_SCHWELLE } from "./konstanten.ts";
import { leseDatei, schreibeAtomar, type TaktOrt } from "./ort.ts";

/**
 * Der Schutz vor dem Hämmern (WI-0253 B-1; Akzeptanzkriterium 2: „403/429 pausiert statt zu hämmern“): eine Pause und ein Unterbrecher, beide
 * für ALLE Prozesse des Hosts, denn das Wiki sperrt eine IP, keinen Prozess. Der Zustand liegt neben dem Vermerk des Takts
 * (`schutz.json`) und wird unter derselben Sperre gelesen und geschrieben.
 *
 * - **403** (`gesperrt`): das Wiki hat uns ausgesperrt (Spamfalle, robots). Keine Wiederholung, eine lange Pause für alle.
 * - **429 / 503 mit Wartezeit, die nicht abzuwarten ist** (`gedrosselt`): Pause mindestens die genannte Zeit, mindestens fünf Minuten.
 * - **Unterbrecher:** drei Fehler in Folge (Verbindung, 5xx, unlesbare Antwort, Serverfehler im Körper) öffnen ihn für zehn Minuten. Danach
 *   darf EINE Anfrage hinaus (halboffen): Gelingt sie, schließt er sich, scheitert sie, öffnet ein einziger Fehler ihn wieder.
 *
 * Eine Pause hält Läufe an (sie wirft `pausiert`), sie lässt niemanden schlafen: Ein Auftrag, der eine Stunde wartet, belegt einen Platz in
 * der Warteschlange und sieht aus wie ein hängender.
 */

export type SchutzAnlass = "gesperrt" | "gedrosselt" | "serverfehler";

export interface SchutzLage {
    /** Ende der Pause (Unix-Millisekunden) oder `null`. */
    pauseBisMs: number | null;
    /** Warum: `http_403`, `http_429` oder `unterbrecher`. */
    grund: string | null;
    fehlerFolge: number;
}

export interface Schutz {
    lage(): Promise<SchutzLage>;
    /** Wirft `pausiert`, solange eine Pause gilt. */
    pruefeFrei(): Promise<void>;
    meldeErfolg(): Promise<void>;
    meldeFehler(anlass: SchutzAnlass, retryAfterMs?: number | null): Promise<SchutzLage>;
}

export interface SchutzOptionen {
    pause403Ms?: number | undefined;
    pause429MinMs?: number | undefined;
    unterbrecherSchwelle?: number | undefined;
    unterbrecherPauseMs?: number | undefined;
}

const DATEI = "schutz.json";
const LEER: SchutzLage = { pauseBisMs: null, grund: null, fehlerFolge: 0 };

function parse(roh: string | null): SchutzLage {
    if (roh === null) return LEER;
    try {
        const wert = JSON.parse(roh) as Record<string, unknown>;
        const bis = wert["pauseBisMs"];
        const grund = wert["grund"];
        const folge = wert["fehlerFolge"];
        return {
            pauseBisMs: typeof bis === "number" && Number.isFinite(bis) ? bis : null,
            grund: typeof grund === "string" ? grund : null,
            fehlerFolge: typeof folge === "number" && Number.isInteger(folge) && folge >= 0 ? folge : 0,
        };
    } catch {
        // Ein zerstörter Schutz-Zustand ist keine Entwarnung, aber auch keine Dauersperre: Der Takt (20 s) gilt unabhängig davon weiter.
        return LEER;
    }
}

export function erzeugeSchutz(ort: TaktOrt, optionen: SchutzOptionen = {}): Schutz {
    const pause403Ms = optionen.pause403Ms ?? PAUSE_403_MS;
    const pause429MinMs = optionen.pause429MinMs ?? PAUSE_429_MIN_MS;
    const schwelle = optionen.unterbrecherSchwelle ?? UNTERBRECHER_SCHWELLE;
    const unterbrecherPauseMs = optionen.unterbrecherPauseMs ?? UNTERBRECHER_PAUSE_MS;

    const lade = async (verzeichnis: string): Promise<SchutzLage> => parse(await leseDatei(join(verzeichnis, DATEI)));
    const speichere = (verzeichnis: string, lage: SchutzLage): Promise<void> =>
        schreibeAtomar(join(verzeichnis, DATEI), `${JSON.stringify(lage)}\n`);

    return {
        async lage(): Promise<SchutzLage> {
            return lade(await ort.ordner());
        },

        async pruefeFrei(): Promise<void> {
            const lage = await lade(await ort.ordner());
            if (lage.pauseBisMs !== null && lage.pauseBisMs > ort.jetzt()) {
                throw new WikiTransportFehler(
                    "pausiert",
                    `Die Wiki-Anfragen pausieren (${lage.grund ?? "unbekannt"}); nichts geht hinaus, bis die Pause vorbei ist`,
                    { bis: lage.pauseBisMs, wiederholbar: true },
                );
            }
        },

        async meldeErfolg(): Promise<void> {
            await ort.mitSperre(async (verzeichnis) => {
                const lage = await lade(verzeichnis);
                if (lage.fehlerFolge === 0) return;
                await speichere(verzeichnis, { ...lage, fehlerFolge: 0 });
            });
        },

        async meldeFehler(anlass: SchutzAnlass, retryAfterMs: number | null = null): Promise<SchutzLage> {
            return ort.mitSperre(async (verzeichnis) => {
                const jetzt = ort.jetzt();
                const alt = await lade(verzeichnis);
                let neu: SchutzLage;
                if (anlass === "gesperrt") {
                    neu = { pauseBisMs: jetzt + pause403Ms, grund: "http_403", fehlerFolge: alt.fehlerFolge };
                } else if (anlass === "gedrosselt") {
                    neu = {
                        pauseBisMs: jetzt + Math.max(retryAfterMs ?? 0, pause429MinMs),
                        grund: "http_429",
                        fehlerFolge: alt.fehlerFolge,
                    };
                } else {
                    const folge = alt.fehlerFolge + 1;
                    // Geöffnet bleibt er auf der Schwelle minus eins stehen: Nach der Pause öffnet ein einziger weiterer Fehler ihn wieder.
                    neu =
                        folge >= schwelle
                            ? {
                                  pauseBisMs: jetzt + unterbrecherPauseMs,
                                  grund: "unterbrecher",
                                  fehlerFolge: schwelle - 1,
                              }
                            : { ...alt, fehlerFolge: folge };
                }
                // Eine längere Pause bleibt, wenn eine kürzere dazukommt.
                if (alt.pauseBisMs !== null && alt.pauseBisMs > jetzt && alt.pauseBisMs > (neu.pauseBisMs ?? 0)) {
                    neu = { ...neu, pauseBisMs: alt.pauseBisMs, grund: alt.grund };
                }
                await speichere(verzeichnis, neu);
                return neu;
            });
        },
    };
}
