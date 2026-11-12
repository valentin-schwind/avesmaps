import { setPriority } from "node:os";
import { RELEASE_TEST_SCHRITTE, type ReleaseTestLauf } from "@avesmaps3d/shared";
import {
    beendeFreigabe,
    createStarterZugang,
    freigabeKennung,
    kenntFreigabe,
    kenntVolltest,
    letztesJson,
    startArgumente,
    starteStarter,
    type StarterAbloeser,
    type StarterZugang,
    type VolltestTeil,
} from "../system/release-test.ts";
import { sanitizeSummary } from "./child-protocol.ts";
import { JobCancelled, JobFailure, type JobContext } from "./handlers.ts";

/**
 * Der Auftrag `release_test` (WI-0248; Vali 2026-10-26: Der Release-Test wird ein schwerer Auftrag der lokalen Warteschlange, mit Fortschritt im
 * Kopf). Der Ausführer rechnet nichts: Er ruft den bestehenden Starter (`scripts/dev/release-abholer.ts`) abgelöst und folgt dem Stand des Runners,
 * bis der Lauf endet. Solange belegt der Auftrag den schweren Platz, und neben ihm startet nichts (unbekannt heißt allein, `kinds.ts`).
 *
 * - **Unser Lauf** ist ein Lauf dieses Standes, der begann, nachdem der Auftrag eingereiht wurde (`input.seit`), und der Startvermerk dieses Standes
 *   ab derselben Zeit. So hängt sich ein neuer Versuch (Neustart des Dirigenten, Ablösen) an denselben Lauf, statt einen zweiten zu starten.
 * - **Phase, Anteil, Restzeit** sind der laufende Schritt des Runners (`installation` … `kern`), sein Fortschritt nach erwarteter Dauer und seine
 *   verbleibende Zeit (`eta_at`). Vor dem ersten Status des Runners (Testpaket bauen) heißt die Phase `vorbereitung`.
 * - **Ein anderer Lauf hält die Sperre** (von Hand gestartet): Der Auftrag wartet in der Phase `wartet`, bis sie frei ist, und startet dann.
 * - **Ende:** grün ist erledigt, rot ist gescheitert (ohne Wiederholung, der Bericht steht auf der Karte), abgebrochen ist abgebrochen.
 * - **Abbrechen** des Auftrags legt die Datei ABBRUCH an (über den Starter) und wartet, bis der Runner sich beendet hat; baut der Starter noch das
 *   Testpaket, wartet er auf den Runner und bricht dann ab. Ablösen (Neustart) lässt den Lauf laufen.
 * - 🔴 **Die Umgebung des Ausführers erreicht den Starter nicht** (`kindUmgebung` in `standardAbloeser`): Dort steht die Entwicklungsdatenbank.
 * - 🔴 **Die Freigabe** (WI-0248; Vali 2026-10-26: der Start ist die Production-Freigabe, „sobald der test grün war“ geht es raus): Die Route hat sie mit
 *   dem Einreihen geschrieben (Kennung `RT-<öffentliche Kennung dieses Auftrags>`). Der Ausführer startet den Lauf mit dieser Kennung
 *   (`--freigabe`), nur über einen Starter, der sie kennt (`kenntFreigabe`): Nur dann trägt der grüne Nachweis sie, und Claudios Abholer liefert genau
 *   diese SHA aus. Endet der Auftrag ohne Grün (rot, abgebrochen, gescheitert), beendet er die Freigabe (`abgebrochen` mit Grund); ein Ablösen
 *   (Neustart) nicht, der nächste Versuch hängt sich an denselben Lauf.
 * - 🔴 **Der Volltest** (`volltest: true` in der Eingabe, WI-0264; Vali 2026-10-31: „Schnelltest und Volltest“): zwei Läufe nacheinander, Teil 1 der
 *   Schnelltest (`--volltest tor`), Teil 2 der volle Lauf (`--volltest voll`), beide nur Bericht. Teil 2 startet auch nach einem roten Teil 1
 *   (alles prüfen, ein Bericht); grün ist der Auftrag nur, wenn beide grün sind. Keine Freigabe, und an seinem Ende wird keine beendet: Eine Abbruchzeile
 *   an derselben SHA überschriebe die Freigabe eines Schnelltests. Welcher Teil läuft, sagt nach einem Ablösen das Profil des Laufs (`voll`: Teil 2); wie
 *   Teil 1 endete, nennt der Lauf von Teil 2 selbst (`vorlauf`).
 */

const SHA = /^[0-9a-f]{40}$/u;
/** Wie oft der Stand des Runners gelesen wird. */
export const RELEASE_TEST_TAKT_MS = 15_000;
/** So lange darf ein Start ohne Lauf bleiben (der Starter baut höchstens 20 Minuten das Testpaket), bevor er als gescheitert gilt. */
export const RELEASE_TEST_START_FRIST_MS = 30 * 60_000;
/** So lange wartet ein Abbruch auf das Ende des Runners. */
export const RELEASE_TEST_ABBRUCH_FRIST_MS = 30 * 60_000;
/** So oft hintereinander darf der Stand nicht lesbar sein, bevor der Auftrag scheitert (bei 15 s Takt rund zehn Minuten). */
export const RELEASE_TEST_LESEFEHLER_MAX = 40;

export interface ReleaseTestJobDeps {
    zugang?: StarterZugang;
    abloesen?: StarterAbloeser;
    ausgabeOrdner?: string;
    taktMs?: number;
    warte?: (ms: number) => Promise<void>;
    jetzt?: () => number;
}

const SCHRITTE: ReadonlySet<string> = new Set(RELEASE_TEST_SCHRITTE);

/** Der Schritt, der gerade läuft: der laufende laut Starter, sonst das zuletzt beschriebene Protokoll, sonst `vorbereitung`. */
export function laufenderSchritt(lauf: ReleaseTestLauf): string {
    const laufend = lauf.schritte.find((schritt) => schritt.zustand === "laeuft")?.id;
    if (laufend !== undefined) return laufend;
    return lauf.schritt !== undefined && SCHRITTE.has(lauf.schritt) ? lauf.schritt : "vorbereitung";
}

/** Gehört der Lauf zu diesem Auftrag? Derselbe Stand, begonnen nicht vor dem Einreihen. */
export function istUnserLauf(lauf: ReleaseTestLauf | null, commit: string, seitMs: number): boolean {
    if (lauf === null || lauf.sha !== commit || lauf.zustand === "keiner") return false;
    const start = Date.parse(lauf.start ?? "");
    return Number.isFinite(start) && start >= seitMs;
}

const kurz = (text: string | null | undefined, fallback: string): string =>
    sanitizeSummary(text !== null && text !== undefined && text.trim() !== "" ? text : fallback);

export async function runReleaseTestJob(
    context: JobContext,
    deps: ReleaseTestJobDeps = {},
): Promise<Record<string, unknown>> {
    const commit = context.input["commit"];
    if (typeof commit !== "string" || !SHA.test(commit))
        throw new JobFailure("eingabe_unzulaessig", "Der Auftrag nennt keinen vollständigen Stand.", false);
    const volltest = context.input["volltest"] === true;
    // Ein Volltest wiederholt nie rote Teile (die Funktion der Datenbank lässt es nicht zu); sicher ist sicher.
    const wiederholen = context.input["wiederholen"] === true && !volltest;
    const jetzt = deps.jetzt ?? Date.now;
    const seitRoh = Date.parse(String(context.input["seit"] ?? ""));
    // Ohne Zeitpunkt des Einreihens zählt nur ein Lauf ab jetzt (ein Lauf von früher ist nie die Antwort auf diesen Auftrag).
    // `let`: Teil 2 des Volltests zählt nur Läufe ab seinem eigenen Start.
    let seitMs = Number.isFinite(seitRoh) ? seitRoh : jetzt();
    const takt = deps.taktMs ?? RELEASE_TEST_TAKT_MS;
    const warte = deps.warte ?? ((ms: number) => new Promise<void>((fertig) => setTimeout(fertig, ms)));
    const zugang = deps.zugang ?? createStarterZugang({ starter: process.env["RELEASE_TEST_STARTER"] });
    /** Die Freigabe dieses Auftrags (WI-0248): dieselbe Kennung, die die Route beim Einreihen nach `refs/notes/release-auftrag` schrieb. */
    const kennung = freigabeKennung(context.job.publicId);

    // Der Job-Prozess läuft mit niedriger Priorität (`child.ts`); unter Windows erbte der Starter sie und mit ihm Runner und Browser. Der Test soll
    // nicht langsamer laufen als von Hand gestartet: zurück auf normal (Linux erlaubt das nicht ohne Recht, dort bleibt es, wie es ist).
    try {
        setPriority(0);
    } catch {
        // ohne Recht: kein Grund zu scheitern
    }

    let gestartetAm: number | null = null;
    let starterEnde: { status: string; grund: string } | null = null;
    let lesefehler = 0;
    /** Der Teil des Volltests, der gerade läuft; beim Schnelltest `undefined`. */
    let teil: VolltestTeil | undefined = volltest ? "tor" : undefined;
    /** Wie Teil 1 des Volltests endete, sobald er endete (nach einem Ablösen aus `vorlauf` des Laufs von Teil 2). */
    let teil1: { zustand: string; grund: string | null } | null = null;
    /** Nur ein Starter, der den Volltest kennt, startet einen; beim Schnelltest einer, der die Freigabe kennt. */
    const kennt = volltest ? kenntVolltest : kenntFreigabe;
    const wort = (zustand: string): string => (zustand === "gruen" ? "grün" : zustand);

    const folgen = async (): Promise<Record<string, unknown>> => {
        await context.beginPhase("vorbereitung", 0, { restMs: null });
        for (;;) {
            context.checkpoint();
            const { lauf, fehler } = await zugang.lauf();
            if (fehler !== null) {
                lesefehler += 1;
                if (lesefehler >= RELEASE_TEST_LESEFEHLER_MAX)
                    throw new JobFailure(
                        "release_test_unavailable",
                        kurz(fehler, "Der Stand ließ sich nicht lesen."),
                        false,
                    );
                await warte(takt);
                continue;
            }
            lesefehler = 0;
            const start = lauf?.startvorgang;
            let unser = lauf !== null && istUnserLauf(lauf, commit, seitMs) ? lauf : null;
            // Nach einem Ablösen beginnt der Ausführer bei Teil 1; läuft schon Teil 2 (Profil `voll`), gilt er.
            if (unser !== null && teil === "tor" && unser.volltest === true && unser.profil === "voll") teil = "voll";
            // In Teil 2 ist nur ein Lauf im Profil `voll` der eigene, nie noch einmal der von Teil 1.
            if (unser !== null && teil === "voll" && unser.profil !== "voll") unser = null;
            if (unser !== null && teil === "tor" && (unser.zustand === "gruen" || unser.zustand === "rot")) {
                // Teil 1 ist zu Ende, grün oder rot: Teil 2 startet in jedem Fall (alles prüfen, ein Bericht). Gezählt wird ab jetzt.
                teil1 = { zustand: unser.zustand, grund: unser.grund ?? null };
                teil = "voll";
                seitMs = jetzt();
                gestartetAm = null;
                starterEnde = null;
                await context.beginPhase("vorbereitung", 0, { restMs: null });
                continue;
            }
            if (unser !== null && teil === "voll" && (unser.zustand === "gruen" || unser.zustand === "rot")) {
                const vorlauf = unser.vorlauf;
                const vorher =
                    teil1 ??
                    (vorlauf === undefined ? null : { zustand: vorlauf.zustand, grund: vorlauf.grund ?? null });
                const satz = `Volltest: Schnelltest ${vorher === null ? "unbekannt" : wort(vorher.zustand)}, voller Lauf ${wort(unser.zustand)}`;
                if (unser.zustand === "gruen" && vorher?.zustand === "gruen")
                    return {
                        zustand: "gruen",
                        commit,
                        volltest: true,
                        start: unser.start ?? null,
                        ende: unser.ende ?? null,
                    };
                const grund = unser.zustand === "rot" ? unser.grund : vorher?.grund;
                throw new JobFailure(
                    "release_test_rot",
                    kurz(`${satz}. ${grund ?? "Den Grund nennt der Bericht."}`, `${satz}.`),
                    false,
                );
            }
            if (unser !== null) {
                if (unser.zustand === "gruen")
                    return { zustand: "gruen", commit, start: unser.start ?? null, ende: unser.ende ?? null };
                if (unser.zustand === "rot")
                    throw new JobFailure(
                        "release_test_rot",
                        kurz(`Der Release-Test ist rot: ${unser.grund ?? "ohne Grund"}`, "Der Release-Test ist rot."),
                        false,
                    );
                if (unser.zustand === "abgebrochen") throw new JobCancelled();
                if (unser.lebt === false)
                    throw new JobFailure(
                        "release_test_abgestuerzt",
                        "Der Runner lebt nicht mehr; die Sperre bleibt zur Diagnose stehen.",
                        false,
                    );
                await context.beginPhase(laufenderSchritt(unser), unser.fortschritt, {
                    restMs: unser.verbleibendMs ?? null,
                });
            } else if (start !== undefined && start.commit === commit && Date.parse(start.seit) >= seitMs) {
                if (start.zustand === "fehler")
                    throw new JobFailure(
                        "release_test_start_gescheitert",
                        kurz(start.grund, "Der Start ist gescheitert."),
                        false,
                    );
                // `baut` (Testpaket) oder `gestartet` (der Runner schreibt gleich seinen Status).
                await context.beginPhase("vorbereitung", 0, { restMs: null });
            } else if (gestartetAm === null) {
                // Noch nichts von uns zu sehen: vorprüfen und starten, mit dem Starter, der die Vorprüfung beantwortet hat. 🔴 Nur einer, der die
                // Freigabe kennt: Ein älterer startete den Lauf ohne ihre Kennung, und sein Grün ginge nicht nach Production.
                // Beim Volltest nur einer, der ihn kennt: Ein älterer startete einen gewöhnlichen Lauf mit Notiz nach origin.
                const vor = await zugang.frage(
                    startArgumente(commit, wiederholen, true, undefined, teil),
                    120_000,
                    kennt,
                );
                if ("fehler" in vor) throw new JobFailure("release_test_unavailable", kurz(vor.fehler, "–"), false);
                if (!kennt(vor.wert))
                    throw new JobFailure(
                        "release_test_unavailable",
                        volltest
                            ? "Kein Starter kennt den Volltest (zu alt? Den Hauptcheckout nachziehen)."
                            : "Kein Starter kennt die Freigabe (zu alt? Den Hauptcheckout nachziehen).",
                        false,
                    );
                const status = String(vor.wert["status"] ?? "");
                const grund = typeof vor.wert["grund"] === "string" ? vor.wert["grund"] : "";
                if (status === "gruen" && !volltest) return { zustand: "gruen", commit, schonGruen: true };
                if (status === "laeuft") {
                    // Ein anderer Lauf hält die Sperre (von Hand gestartet): warten, bis er endet.
                    const andererLaeuft = lauf !== null && lauf.zustand === "laeuft";
                    await context.beginPhase("wartet", 0, {
                        restMs: andererLaeuft ? (lauf.verbleibendMs ?? null) : null,
                    });
                } else if (status === "trocken") {
                    const abgeloest = starteStarter(vor.starter, commit, wiederholen, {
                        ausgabeOrdner: deps.ausgabeOrdner,
                        abloesen: deps.abloesen,
                        // Der Volltest startet ohne Freigabe (WI-0264): Sein Grün geht nie nach Production.
                        ...(volltest ? { volltest: teil } : { freigabe: kennung }),
                    });
                    gestartetAm = jetzt();
                    abgeloest.ende.then(
                        ({ ausgabe, code }) => {
                            const wert = letztesJson(ausgabe);
                            starterEnde = {
                                status: String(wert?.["status"] ?? `exit-${String(code)}`),
                                grund: typeof wert?.["grund"] === "string" ? wert["grund"] : "",
                            };
                        },
                        (error: unknown) => {
                            starterEnde = {
                                status: "fehler",
                                grund: `Der Starter ließ sich nicht aufrufen: ${error instanceof Error ? error.message : "unbekannter Fehler"}`,
                            };
                        },
                    );
                    await context.beginPhase("vorbereitung", 0, { restMs: null });
                } else if (status === "sperre-ohne-prozess") {
                    throw new JobFailure(
                        "release_test_sperre",
                        kurz(grund, "Eine Sperre ohne lebenden Prozess."),
                        false,
                    );
                } else if (status === "kein-roter-lauf") {
                    throw new JobFailure(
                        "release_test_kein_roter_lauf",
                        kurz(grund, "Kein früherer Lauf dieses Standes zum Wiederholen."),
                        false,
                    );
                } else {
                    throw new JobFailure(
                        "release_test_fehler",
                        kurz(grund, "Der Starter nimmt den Start nicht an."),
                        false,
                    );
                }
            } else {
                // Gestartet, aber noch kein Vermerk und kein Lauf von uns.
                const ende = starterEnde as { status: string; grund: string } | null;
                if (ende !== null && ende.status === "gruen" && !volltest)
                    return { zustand: "gruen", commit, schonGruen: true };
                if (ende !== null && ende.status === "laeuft") {
                    // Zwischen Vorprüfung und Start kam ein anderer Lauf: wieder warten, dann neu versuchen.
                    gestartetAm = null;
                    starterEnde = null;
                } else if (ende !== null && !["gestartet"].includes(ende.status)) {
                    throw new JobFailure(
                        "release_test_start_gescheitert",
                        kurz(ende.grund, `Der Starter endete ohne Lauf (${ende.status}).`),
                        false,
                    );
                } else if (jetzt() - gestartetAm > RELEASE_TEST_START_FRIST_MS) {
                    throw new JobFailure(
                        "release_test_start_gescheitert",
                        "Nach dem Start erschien kein Lauf (30 Minuten).",
                        false,
                    );
                }
            }
            await warte(takt);
        }
    };

    /** Bricht unseren Lauf ab und wartet auf sein Ende; ohne Lauf ist nichts zu tun. Prüft keinen Abbruch mehr (er ist ja angefordert). */
    const brichAb = async (): Promise<void> => {
        const bis = jetzt() + RELEASE_TEST_ABBRUCH_FRIST_MS;
        let angefordert = false;
        while (jetzt() < bis) {
            const { lauf } = await zugang.lauf();
            const start = lauf?.startvorgang;
            if (lauf !== null && istUnserLauf(lauf, commit, seitMs)) {
                if (lauf.zustand !== "laeuft" || lauf.lebt === false) return;
                if (!angefordert) {
                    const antwort = await zugang.frage(["--abbrechen", commit, "--trocken", "--json"]);
                    angefordert = !("fehler" in antwort) && antwort.wert["status"] === "abbruch-angefordert";
                }
            } else {
                // Baut unser Starter noch? Dann auf den Runner warten; sonst gibt es nichts abzubrechen.
                const baut =
                    (start !== undefined &&
                        start.commit === commit &&
                        Date.parse(start.seit) >= seitMs &&
                        start.zustand !== "fehler") ||
                    (gestartetAm !== null && starterEnde === null);
                if (!baut) return;
            }
            await warte(takt);
        }
    };

    try {
        return await folgen();
    } catch (error) {
        if (error instanceof JobCancelled) await brichAb();
        // Ohne Grün endet auch die Freigabe (WI-0248): rot, abgebrochen, gescheitert. Ein Ablösen (`JobStopped`) nicht: Der nächste Versuch hängt sich an
        // denselben Lauf. Best effort; ohne grünen Nachweis mit dieser Kennung liefert ohnehin nichts aus.
        // 🔴 Nicht beim Volltest (WI-0264): Er hat keine Freigabe, und eine Abbruchzeile an derselben SHA überschriebe die eines Schnelltests.
        if (!volltest && (error instanceof JobCancelled || error instanceof JobFailure)) {
            const grund =
                error instanceof JobCancelled
                    ? "Release-Test abgebrochen"
                    : error.message || "Release-Test ohne Grün beendet";
            await beendeFreigabe(zugang, commit, kennung, grund).catch(() => undefined);
        }
        throw error;
    }
}
