// Der Ablauf der Teile eines Release-Tests (WI-0248): immer bis zum Ende, mit allen roten Fällen aller Teile.
//
// 🔴 Vorher brach der erste rote Schritt den Lauf ab. Der Betreiber sah dann EINEN Fehler, behob ihn, wartete wieder Stunden und sah den nächsten
// (erster Lauf: Vitest rot, Browserteile liefen nie; zweiter: Teil 2 rot, Teile 3 und 4 nie). Jetzt läuft jeder Teil, den es noch sinnvoll gibt:
//
//   - `voll` (Lint, Format, Typen, Vitest, Release-Bau, Besucherpaket): ein roter Schritt hält die übrigen nicht an. Nur das Besucherpaket
//     braucht den Bau (es prüft dessen Ergebnis) und entfällt mit klarem Grund, wenn der Bau rot ist.
//   - die Browserteile brauchen Installation, gemeinsamen Bau, Korpus und Martin (das stellt der Runner vorher her; fehlt eines davon, endet der
//     Lauf wie bisher sofort). Ist Martin nicht zu starten oder die Teilzuordnung unbrauchbar, entfallen die Browserteile mit dem Grund. Ein roter
//     Release-Bau hält sie NICHT an: Sie laufen gegen die Test-Vite, nicht gegen sein Ergebnis.
//
// Das Release-Tor (Profil `tor`, WI-0264) fährt stattdessen drei andere Teile in dieser Folge, jeden bis zum Ende:
//
//   - `bau`: Lint, Typen und Release-Bau (Format, Vitest und Besucherpaket entfallen); ein roter Schritt hält die übrigen nicht an.
//   - `daten`: Migrationen und Rechte auf den echten Daten des Testpakets (`apps/server/test/schreibwege-app-rolle.test.ts`).
//   - `kern-echt`: die Kernabläufe im Browser gegen den echten Server des Kandidaten. Nur dieser Teil zählt einen wackeligen Fall (erst im zweiten
//     Versuch grün) als grün; der Bericht nennt ihn trotzdem (`release-seite.ts`).
//
// Der Lauf ist am Ende rot, wenn irgendein Teil rot ist oder entfiel; die Liste der Roten nennt jeden mit seinem Teil. Die Schritte selbst
// (Prozesse, Berichte lesen) liefert der Runner über `AblaufIo`; hier steht nur die Reihenfolge und die Buchführung, damit sie mit Ersatzteilen
// prüfbar ist (`release-ablauf.test.ts`). Zeit- und Abbruchgrenzen bleiben beim Runner: Ein Schritt über seiner Grenze ist rot, die
// Gesamtzeit und die Datei ABBRUCH beenden den Lauf.
import { vitestMeldung, type VitestBericht } from "./release-grund.ts";
import type { ReleaseTeil } from "./release-nachweis.ts";
import { browserTeilGruen, playwrightAuswertung } from "./sammellauf-auswertung.ts";
import type { TeilZuordnung } from "./release-teile.ts";

/** Die Schritte der Klasse `voll` in ihrer Reihenfolge (so heißen auch ihre Protokolle). */
export const VOLL_SCHRITTE = ["lint", "format", "typen", "tests", "bau", "besucherpaket"] as const;
export type VollSchritt = (typeof VOLL_SCHRITTE)[number];

/** Die Schritte des Teils `bau` (Profil `tor`): die statische Prüfung ohne Format, dazu der Release-Bau. Es sind Schritte von `voll`, mit denselben Protokollen. */
export const BAU_SCHRITTE = ["lint", "typen", "bau"] as const satisfies readonly Exclude<VollSchritt, "tests">[];

/**
 * Die Browserteile, in denen ein wackeliger Fall (im Wiederholungsversuch grün) als grün zählt (WI-0264, Vali 2026-10-30). Nur das Tor, nur dort:
 * Alle anderen Teile und Profile halten an „kein wackeliger Fall“ fest.
 */
export const WACKELIG_GRUEN: ReadonlySet<string> = new Set(["kern-echt"]);

/** Wie ein Schritt in diesem Lauf endete; `uebernommen`: er gehört zu einem Teil, den eine Wiederholung aus dem früheren Lauf übernahm. */
export type SchrittStatus = "gruen" | "rot" | "uebersprungen" | "uebernommen";

/** Ein roter Schritt: `meldung` für die Datei `fehler.txt` und den Bericht, `kurz` für die öffentliche Notiz (nur Namen und Zahlen). */
export interface Befund {
    readonly meldung: string;
    readonly kurz: string;
}

/** Ein roter oder entfallener Schritt mit seinem Teil. */
export interface RoterEintrag extends Befund {
    /** `voll`, `bau`, `daten` oder ein Browserteil (`browser-n`, `kern-echt`). */
    readonly klasse: string;
    /** Die Kennung des Schritts (`lint` … `besucherpaket`, `daten`, `browser-n`, `kern-echt`). */
    readonly schritt: string;
    /** `rot`: lief und fiel durch; `uebersprungen`: lief nicht, weil seine Voraussetzung fehlte. */
    readonly art: "rot" | "uebersprungen";
}

export interface AblaufPlan {
    /** `voll` läuft in diesem Lauf (sonst wurde es aus einem früheren übernommen). */
    readonly voll: boolean;
    /** Profil `tor`: der Teil `bau` (Lint, Typen, Bau) läuft in diesem Lauf. Fehlt wie `false`. */
    readonly bau?: boolean;
    /** Profil `tor`: der Teil `daten` (Migrationen und Rechte auf echten Daten) läuft in diesem Lauf. Fehlt wie `false`. */
    readonly daten?: boolean;
    /** Die Browserteile, die in diesem Lauf laufen, in der Reihenfolge der Kennungen. */
    readonly browser: readonly TeilZuordnung[];
    /** Warum die Browserteile nicht laufen können (Teilzuordnung fehlt oder passt nicht zu den Specs); sonst `null`. */
    readonly browserProblem: string | null;
}

/** Was der Runner dem Ablauf gibt: je Schritt ein Befund (`null`: grün). Ein Schritt wirft nicht, außer der Lauf selbst bricht ab. */
export interface AblaufIo {
    /** Lint, Format, Typen, Bau, Besucherpaket. */
    schritt(name: Exclude<VollSchritt, "tests">): Promise<Befund | null>;
    /** Vitest fahren und seinen Bericht beurteilen; stellt danach die Datenbank für die Browserteile her (auch bei Rot). */
    vitest(): Promise<Befund | null>;
    /** Den Teil `daten` fahren (Profil `tor`): `schreibwege-app-rolle.test.ts` auf den echten Daten des Testpakets, den Bericht beurteilen. */
    daten(): Promise<Befund | null>;
    /** Sind die Voraussetzungen der Browserteile da (Martin läuft)? `null`: ja; sonst der Grund. Einmal, vor dem ersten Browserteil. */
    browserBereit(): Promise<string | null>;
    /** Einen Browserteil fahren und seinen Bericht beurteilen. */
    browser(teil: TeilZuordnung): Promise<Befund | null>;
    /** Die Prüfsumme des Rohberichts eines grünen Teils (`vitest.json`, `bau.json`, `daten.json`, `browser-n.json`, `kern-echt.json`); `undefined`, wenn es keinen gibt. */
    beleg(klasse: string): string | undefined;
}

export interface AblaufHaken {
    /** Ein Schritt ist zu Ende; `grund` bei `rot` die Kurzfassung, bei `uebersprungen` der Satz zum Entfallen. */
    schritt?: (id: string, status: SchrittStatus, grund?: string) => void;
    /** Ein Teil ist zu Ende (grün, rot oder entfallen): Der Runner trägt ihn in den Status ein. */
    teil?: (teil: ReleaseTeil) => void;
}

export interface AblaufErgebnis {
    /** Die Teile, die in DIESEM Lauf liefen oder entfielen (übernommene stehen nicht hier). */
    readonly teile: ReleaseTeil[];
    /** Alle roten und entfallenen Schritte in der Reihenfolge des Laufs. */
    readonly rot: RoterEintrag[];
}

/** Ein oder mehrere Teile sind rot oder entfielen. Die Meldung ist der Inhalt von `fehler.txt`: eine Zeile je roten Schritt. */
export class TeileRot extends Error {
    readonly eintraege: readonly RoterEintrag[];
    constructor(eintraege: readonly RoterEintrag[]) {
        super(fehlerText(eintraege));
        this.name = "TeileRot";
        this.eintraege = eintraege;
    }
}

/** Der Inhalt von `fehler.txt`: eine Zeile je rotem oder entfallenem Schritt, in der Reihenfolge des Laufs. */
export const fehlerText = (rote: readonly RoterEintrag[]): string => rote.map((r) => r.meldung).join("\n");

const fehlerSatz = (e: unknown): Befund => {
    const text = (e instanceof Error ? e.message : "unbekannter Fehler").split(/\r?\n/, 1)[0] ?? "";
    return { meldung: text, kurz: text };
};

const nummer = (id: string): string => id.replace(/^browser-/, "");

/**
 * Der Befund eines Browserteils aus Exitcode und Playwright-Bericht (`null`: grün). Grün heißt: Exit 0, kein Fehler im Lauf, mindestens ein
 * gelaufener Fall, kein roter, kein wackeliger und KEIN übersprungener (der Release-Test duldet keinen übersprungenen Fall). Ausnahme
 * `WACKELIG_GRUEN` (das Tor, Teil `kern-echt`): Ein wackeliger Fall, erst im Wiederholungsversuch grün, zählt als grün; der Bericht nennt ihn.
 * Rot nennt die Zahlen; ein Bericht, der fehlt oder nicht lesbar ist (Absturz, Zeitgrenze), nennt den Exitcode.
 */
export function browserBefund(
    teil: { readonly id: string; readonly name: string },
    exitCode: number | null,
    bericht: unknown,
): Befund | null {
    const kopf = `Browserteil ${nummer(teil.id)}`;
    if (bericht === null || typeof bericht !== "object") {
        const grund = `Bericht fehlt oder ist unlesbar (Exit ${String(exitCode)})`;
        return { meldung: `${kopf} (${teil.name}): ${grund}`, kurz: `${kopf}: ${grund}` };
    }
    const { zahlen } = playwrightAuswertung(bericht);
    const wackeligGruen = WACKELIG_GRUEN.has(teil.id);
    if (browserTeilGruen(exitCode, bericht, wackeligGruen) && zahlen.uebersprungen === 0) return null;
    const stuecke: string[] = [];
    if (zahlen.rot > 0) stuecke.push(`${String(zahlen.rot)} rot`);
    if (zahlen.wackelig > 0 && !wackeligGruen) stuecke.push(`${String(zahlen.wackelig)} wackelig`);
    if (zahlen.uebersprungen > 0) stuecke.push(`${String(zahlen.uebersprungen)} übersprungen`);
    if (zahlen.erwartet + zahlen.rot + zahlen.wackelig === 0) stuecke.push("kein Fall gelaufen");
    const fehler = (bericht as { errors?: unknown }).errors;
    if (Array.isArray(fehler) && fehler.length > 0) stuecke.push(`${String(fehler.length)} Fehler im Lauf`);
    if (stuecke.length === 0) stuecke.push(`Exit ${String(exitCode)}`);
    const text = stuecke.join(", ");
    return { meldung: `${kopf} (${teil.name}): ${text}`, kurz: `${kopf}: ${text}` };
}

/**
 * Der Befund des Teils `daten` aus Exitcode und Vitest-Bericht (`null`: grün; Profil `tor`, WI-0264). Grün heißt: Exit 0 und das Urteil der
 * Teststufe über den Bericht (`vitestMeldung`: kein roter, kein übersprungener, kein leerer Fall, die erwartete Testdatei grün). 🔴 Übersprungen ist
 * hier rot, nicht grün: Der Test überspringt sich ohne PostgreSQL still, und ein Teil, der nichts auf echten Daten geprüft hat, wäre kein Tor.
 * Rot nennt die Zahlen (`Daten: 2 rot, …`); ein Bericht, der fehlt oder nicht lesbar ist, nennt den Exitcode.
 */
export function datenBefund(exitCode: number | null, bericht: unknown, erwartet: readonly string[]): Befund | null {
    if (bericht === null || typeof bericht !== "object") {
        const text = `Daten: Bericht fehlt oder ist unlesbar (Exit ${String(exitCode)})`;
        return { meldung: text, kurz: text };
    }
    // `todo` ist dort eine Route ohne eigenen Fall: Der Test meldet sie, hält aber nichts an (schreibwege-app-rolle.test.ts, Kopf). Übersprungen
    // bleibt rot, denn ohne PostgreSQL überspringt sich der Datenteil still (WI-0264).
    const meldung = vitestMeldung(bericht as VitestBericht, erwartet, { todoGruen: true });
    if (meldung !== null) {
        const text = meldung.replace(/^Vitest: /u, "Daten: ");
        return { meldung: text, kurz: text };
    }
    return exitCode === 0 ? null : exitBefund("daten", exitCode ?? 1);
}

/** Der Befund eines Schritts, der nur einen Exitcode hat: `lint: Exit 1`. */
export const exitBefund = (name: string, code: number): Befund => ({
    meldung: `${name}: Exit ${String(code)}`,
    kurz: `${name}: Exit ${String(code)}`,
});

/** Der Befund eines Schritts, der seine Zeitgrenze überschritt. */
export const zeitBefund = (kopf: string, minuten: number): Befund => ({
    meldung: `${kopf}: Zeitüberschreitung (${String(minuten)} min)`,
    kurz: `${kopf}: Zeitüberschreitung`,
});

/**
 * Fährt die Teile des Plans bis zum Ende. Wirft nicht für einen roten Schritt, sondern sammelt: Ist `rot` leer, sind alle gelaufenen Teile grün.
 * Die Reihenfolge ist die des Runners: `voll` zuerst (Lint, Format, Typen, Vitest, Bau, Besucherpaket), dann die Browserteile nach Kennung.
 */
export async function fuehreAus(
    sha: string,
    plan: AblaufPlan,
    io: AblaufIo,
    haken: AblaufHaken = {},
): Promise<AblaufErgebnis> {
    const ergebnis: AblaufErgebnis = { teile: [], rot: [] };
    const urteil = async (frage: () => Promise<Befund | null>): Promise<Befund | null> => {
        try {
            return await frage();
        } catch (e) {
            return fehlerSatz(e);
        }
    };
    const abschliessen = (teil: ReleaseTeil): void => {
        ergebnis.teile.push(teil);
        haken.teil?.(teil);
    };

    if (plan.voll) {
        const rot: RoterEintrag[] = [];
        const fahre = async (id: VollSchritt, frage: () => Promise<Befund | null>): Promise<Befund | null> => {
            const befund = await urteil(frage);
            if (befund === null) haken.schritt?.(id, "gruen");
            else {
                rot.push({ klasse: "voll", schritt: id, art: "rot", ...befund });
                haken.schritt?.(id, "rot", befund.kurz);
            }
            return befund;
        };
        await fahre("lint", () => io.schritt("lint"));
        await fahre("format", () => io.schritt("format"));
        await fahre("typen", () => io.schritt("typen"));
        await fahre("tests", () => io.vitest());
        const bau = await fahre("bau", () => io.schritt("bau"));
        if (bau === null) await fahre("besucherpaket", () => io.schritt("besucherpaket"));
        else {
            const grund = "der Release-Bau ist rot";
            rot.push({
                klasse: "voll",
                schritt: "besucherpaket",
                art: "uebersprungen",
                meldung: `besucherpaket nicht gelaufen: ${grund}`,
                kurz: `besucherpaket nicht gelaufen: ${grund}`,
            });
            haken.schritt?.("besucherpaket", "uebersprungen", grund);
        }
        const gruen = rot.length === 0;
        const beleg = gruen ? io.beleg("voll") : undefined;
        abschliessen({
            sha,
            klasse: "voll",
            status: gruen ? "gruen" : "rot",
            exit: gruen ? 0 : 1,
            ...(beleg === undefined ? {} : { beleg }),
        });
        ergebnis.rot.push(...rot);
    }

    if (plan.bau === true) {
        // Der Teil `bau` des Tors: Lint, Typen und Release-Bau. Ein roter Schritt hält die übrigen nicht an; es gibt kein Besucherpaket, das den Bau braucht.
        const rot: RoterEintrag[] = [];
        for (const id of BAU_SCHRITTE) {
            const befund = await urteil(() => io.schritt(id));
            if (befund === null) haken.schritt?.(id, "gruen");
            else {
                rot.push({ klasse: "bau", schritt: id, art: "rot", ...befund });
                haken.schritt?.(id, "rot", befund.kurz);
            }
        }
        const gruen = rot.length === 0;
        const beleg = gruen ? io.beleg("bau") : undefined;
        abschliessen({
            sha,
            klasse: "bau",
            status: gruen ? "gruen" : "rot",
            exit: gruen ? 0 : 1,
            ...(beleg === undefined ? {} : { beleg }),
        });
        ergebnis.rot.push(...rot);
    }

    if (plan.daten === true) {
        const befund = await urteil(() => io.daten());
        if (befund === null) haken.schritt?.("daten", "gruen");
        else {
            ergebnis.rot.push({ klasse: "daten", schritt: "daten", art: "rot", ...befund });
            haken.schritt?.("daten", "rot", befund.kurz);
        }
        const beleg = befund === null ? io.beleg("daten") : undefined;
        abschliessen({
            sha,
            klasse: "daten",
            status: befund === null ? "gruen" : "rot",
            exit: befund === null ? 0 : 1,
            ...(beleg === undefined ? {} : { beleg }),
        });
    }

    if (plan.browser.length > 0) {
        let grund = plan.browserProblem;
        if (grund === null) {
            try {
                grund = await io.browserBereit();
            } catch (e) {
                grund = fehlerSatz(e).meldung;
            }
        }
        for (const teil of plan.browser) {
            if (grund !== null) {
                const satz = `Browserteil ${nummer(teil.id)} (${teil.name}) nicht gelaufen: ${grund}`;
                ergebnis.rot.push({
                    klasse: teil.id,
                    schritt: teil.id,
                    art: "uebersprungen",
                    meldung: satz,
                    kurz: `Browserteil ${nummer(teil.id)} nicht gelaufen: ${grund}`,
                });
                haken.schritt?.(teil.id, "uebersprungen", grund);
                abschliessen({ sha, klasse: teil.id, status: "uebersprungen", exit: 1, name: teil.name });
                continue;
            }
            const befund = await urteil(() => io.browser(teil));
            if (befund === null) {
                haken.schritt?.(teil.id, "gruen");
                const beleg = io.beleg(teil.id);
                abschliessen({
                    sha,
                    klasse: teil.id,
                    status: "gruen",
                    exit: 0,
                    name: teil.name,
                    ...(beleg === undefined ? {} : { beleg }),
                });
            } else {
                ergebnis.rot.push({ klasse: teil.id, schritt: teil.id, art: "rot", ...befund });
                haken.schritt?.(teil.id, "rot", befund.kurz);
                abschliessen({ sha, klasse: teil.id, status: "rot", exit: 1, name: teil.name });
            }
        }
    }
    return ergebnis;
}
