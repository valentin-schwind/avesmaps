// „Rote Teile wiederholen“ (WI-0248): Für dieselbe SHA laufen nur die roten oder fehlenden Teile neu, die grünen werden übernommen.
//
// 🔴 Wann eine Übernahme gilt: nur wenn die Umgebung des neuen Laufs dieselbe ist wie die des alten (Fingerabdruck aus Node, PostgreSQL, Martin,
// Browser, Testpaket, Lockfile, Runner und den Prüfwerkzeugen; `release-runner.ts`). Ein grüner Teil sagt nur etwas über die Umgebung, in der er
// lief. Weicht sie ab, läuft ALLES neu, und das Laufbuch nennt den Grund („Umgebung verändert (Testpaket, Lockfile)“). Ausnahme ist die
// Fortsetzung (`PRUEFCODE`): Weicht nur das Prüfprogramm ab, rechnet das neue das Urteil aus den übernommenen Belegen.
//
// 🔴 Was übernommen wird, ist belegt: Jeder grüne Teil trägt die Prüfsumme seines Rohberichts (`beleg`, `vitest.json` oder `browser-n.json`).
// Die Wiederholung kopiert den Rohbericht in den neuen Ergebnisordner und prüft die Summe vor und nach dem Kopieren; stimmt sie nicht, läuft der
// Teil neu. So bleiben die Belege des Nachweises (`belege`) auch für übernommene Teile Dateien des neuen Ordners.
//
// Der Nachweis wird erst grün, wenn alle Teile seines Profils (B: voll und kern) dieser SHA grün sind (`releaseGruen`, unverändert). Nichts wiederholt sich von selbst:
// Die Wiederholung startet nur auf Knopfdruck oder mit `release-abholer.ts --wiederholen <sha>`.
import { constants, copyFileSync, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { leseLaufBuch } from "./release-laufbuch.ts";
import { BELEG_JE_TEIL, RELEASE_KLASSEN, type ReleaseTeil, type ReleaseVorlauf } from "./release-nachweis.ts";

/** Welcher Rohbericht zu welchem Teil gehört (so heißen auch die Belege im Nachweis). */
export const BELEG_DATEI: Readonly<Record<string, string>> = BELEG_JE_TEIL;

/** Der Name eines Laufordners unter `.release-runs`: `<sha40>` oder der umbenannte `<sha40>-<Zeit>[-n]`. */
export const LAUF_ORDNER = /^[0-9a-f]{40}(?:-\d{8}T\d{6}Z(?:-\d+)?)?$/;

/** Ein früherer Lauf, soweit die Wiederholung ihn braucht. */
export interface AltLauf {
    readonly name: string;
    readonly ordner: string;
    readonly sha: string;
    /** `status` der `status.json`: `gruen`, `rot`, `timeout`, `abgebrochen` oder `laeuft`. */
    readonly status: string;
    readonly umgebung: string;
    /** Beginn in Millisekunden (`status.json`, sonst die Anlegezeit des Ordners). */
    readonly start: number;
    readonly teile: readonly ReleaseTeil[];
    /** Die Bestandteile seines Fingerabdrucks aus dem Laufbuch; `undefined` bei einem Lauf aus der Zeit davor. */
    readonly komponenten: Readonly<Record<string, string>> | undefined;
    /** Ein Lauf des Volltests (`nurBericht` in `status.json`, WI-0264): Er schrieb keine Notiz; „Rote Teile wiederholen“ setzt ihn nie fort. */
    readonly nurBericht: boolean;
    /** Das Prüfprofil laut `status.json`; `undefined` bei einem Lauf aus der Zeit davor. */
    readonly profil: string | undefined;
}

const HEX64 = /^[a-f0-9]{64}$/;

/** Liest einen früheren Lauf aus seinem Ordner; `undefined`, wenn der Name nicht passt oder `status.json` fehlt oder kaputt ist. */
export function liesAltLauf(ordner: string, name: string): AltLauf | undefined {
    if (!LAUF_ORDNER.test(name)) return undefined;
    try {
        const roh: unknown = JSON.parse(readFileSync(join(ordner, "status.json"), "utf8"));
        if (typeof roh !== "object" || roh === null) return undefined;
        const s = roh as Record<string, unknown>;
        // Der Runner schreibt die SHA immer in den Status; fehlt sie (halb geschriebener Lauf), gilt der Anfang des Ordnernamens.
        const sha = typeof s["sha"] === "string" && /^[0-9a-f]{40}$/.test(s["sha"]) ? s["sha"] : name.slice(0, 40);
        let start = typeof s["start"] === "string" ? Date.parse(s["start"]) : Number.NaN;
        if (!Number.isFinite(start)) {
            const st = statSync(ordner);
            start = st.birthtimeMs > 0 ? st.birthtimeMs : st.mtimeMs;
        }
        const teile = Array.isArray(s["teile"])
            ? (s["teile"] as unknown[]).flatMap((t): ReleaseTeil[] => {
                  const e = (t ?? {}) as Record<string, unknown>;
                  if (
                      typeof e["sha"] !== "string" ||
                      typeof e["klasse"] !== "string" ||
                      typeof e["status"] !== "string" ||
                      typeof e["exit"] !== "number"
                  )
                      return [];
                  return [
                      {
                          sha: e["sha"],
                          klasse: e["klasse"],
                          status: e["status"],
                          exit: e["exit"],
                          ...(typeof e["name"] === "string" ? { name: e["name"] } : {}),
                          ...(typeof e["beleg"] === "string" ? { beleg: e["beleg"] } : {}),
                      },
                  ];
              })
            : [];
        return {
            name,
            ordner,
            sha,
            status: typeof s["status"] === "string" ? s["status"] : "",
            umgebung: typeof s["umgebung"] === "string" ? s["umgebung"] : "",
            start,
            teile,
            komponenten: leseLaufBuch(ordner)?.komponenten,
            nurBericht: s["nurBericht"] === true,
            profil: typeof s["profil"] === "string" ? s["profil"] : undefined,
        };
    } catch {
        return undefined;
    }
}

/** Teil 1 eines Volltests für Teil 2 (`--vorlauf`): Status und Profil des Ordners; ohne lesbaren Status `unbekannt`. Wirft nie. */
export function liesVorlauf(ordner: string, name: string): ReleaseVorlauf {
    const alt = liesAltLauf(ordner, name);
    return {
        ordner: name,
        status: alt?.status === undefined || alt.status === "" ? "unbekannt" : alt.status,
        ...(alt?.profil === undefined ? {} : { profil: alt.profil }),
    };
}

/** Alle Läufe zu einer SHA (`<sha>` und die umbenannten `<sha>-<Zeit>`), der jüngste zuerst. Nur lesen. */
export function laeufeFuer(laeufe: string, sha: string): AltLauf[] {
    let namen: string[];
    try {
        namen = readdirSync(laeufe).filter((n) => LAUF_ORDNER.test(n) && n.startsWith(sha));
    } catch {
        return [];
    }
    return namen
        .flatMap((n) => {
            const lauf = liesAltLauf(join(laeufe, n), n);
            return lauf === undefined || lauf.sha !== sha ? [] : [lauf];
        })
        .sort((a, b) => b.start - a.start || (a.name < b.name ? 1 : -1));
}

/** Prüfsumme einer Datei (wie `fingerprint` in `release-pruefsumme.ts`); `undefined`, wenn es sie nicht gibt. */
export type PruefsummeVon = (pfad: string) => string | undefined;

export interface Uebernehmbar {
    /** Die Teile, die sich übernehmen lassen: grün, mit Beleg, und der Rohbericht stimmt mit dem Beleg überein. */
    readonly gut: readonly string[];
    /** Grüne Teile, deren Beleg fehlt oder nicht stimmt: Sie laufen neu. */
    readonly schlecht: readonly { readonly klasse: string; readonly grund: string }[];
}

/** Welche Teile eines früheren Laufs lassen sich übernehmen? Rote, entfallene und fehlende nie. */
export function uebernehmbareTeile(
    alt: AltLauf,
    pruefsumme: PruefsummeVon,
    klassen: readonly string[] = RELEASE_KLASSEN,
): Uebernehmbar {
    const gut: string[] = [];
    const schlecht: { klasse: string; grund: string }[] = [];
    for (const klasse of klassen) {
        const eintraege = alt.teile.filter((t) => t.klasse === klasse);
        const teil = eintraege[0];
        if (eintraege.length !== 1 || teil === undefined) continue;
        if (teil.status !== "gruen" || teil.exit !== 0 || teil.sha !== alt.sha) continue;
        const datei = BELEG_DATEI[klasse];
        if (datei === undefined) continue;
        if (teil.beleg === undefined || !HEX64.test(teil.beleg)) {
            schlecht.push({ klasse, grund: "Beleg fehlt" });
            continue;
        }
        const summe = existsSync(join(alt.ordner, datei)) ? pruefsumme(join(alt.ordner, datei)) : undefined;
        if (summe === undefined) schlecht.push({ klasse, grund: "Rohbericht fehlt" });
        else if (summe !== teil.beleg)
            schlecht.push({ klasse, grund: "Rohbericht stimmt nicht mit dem Beleg überein" });
        else gut.push(klasse);
    }
    return { gut, schlecht };
}

const KOMPONENTEN_NAME: Readonly<Record<string, string>> = {
    node: "Node",
    platform: "Plattform",
    arch: "Plattform",
    postgres: "PostgreSQL",
    martin: "Martin",
    browser: "Browser",
    fixtures: "Testpaket",
    lock: "Lockfile",
    runner: "Runner",
    vertrag: "Prüfwerkzeuge",
};

/**
 * Welche Bestandteile der Umgebung sind anders als beim alten Lauf (deutsche Namen, ohne Doppelte)? Leer, wenn der alte Lauf seine Bestandteile
 * nicht aufbewahrt hat; dann bleibt nur, dass der Fingerabdruck abweicht.
 */
export function unterschiede(
    alt: Readonly<Record<string, string>> | undefined,
    neu: Readonly<Record<string, string>>,
): string[] {
    if (alt === undefined) return [];
    const namen = new Set<string>();
    for (const schluessel of new Set([...Object.keys(alt), ...Object.keys(neu)]))
        if (alt[schluessel] !== neu[schluessel]) namen.add(KOMPONENTEN_NAME[schluessel] ?? schluessel);
    return [...namen];
}

/**
 * Bestandteile, die das Urteil rechnen, nicht die Umgebung, in der die Tests liefen: Runner und Prüfwerkzeuge. Weichen nur sie ab (oder der
 * Browserordner nur in dem, was Playwright beim Laufen selbst schreibt), wird ein Lauf FORTGESETZT: Die grünen Teile werden mit ihren Belegen
 * übernommen, das neue Prüfprogramm rechnet das Urteil. Release-Test d1feba8 (2026-10-24): alle Teile grün, rot nur die Schlussprüfung wegen
 * der `debug.log` des Browsers; nach der Korrektur hätte die alte Regel alle 3½ Stunden neu verlangt, nur weil sich der Runner geändert hatte.
 * Node, PostgreSQL, Martin, Testpaket, Lockfile und Plattform sind die Umgebung der Tests: Weicht eins davon ab, läuft weiterhin alles neu.
 */
export const PRUEFCODE: ReadonlySet<string> = new Set(["runner", "vertrag"]);

export interface Wiederholung {
    /** Die Teile (`voll`, `browser-n`), die aus dem alten Lauf übernommen werden. */
    readonly uebernehmen: readonly string[];
    /** Die Teile, die neu laufen, in der Reihenfolge der Klassen. */
    readonly neu: readonly string[];
    /** Warum nichts übernommen wird (Umgebung verändert, anderer Stand); sonst `null`. */
    readonly grund: string | null;
}

/**
 * Plant die Wiederholung gegen einen früheren Lauf. Übernommen wird, wenn die SHA gleich ist und die Umgebung der Tests auch; weicht nur der
 * Prüfcode ab (`PRUEFCODE`) oder der Browserordner nur in seinen flüchtigen Dateien (`browserUnveraendertSeit(Start des alten Laufs)`), ist
 * es eine Fortsetzung. Sonst läuft alles neu, mit Grund. `neu` ist der Fingerabdruck des neuen Laufs (gesamt und in Bestandteilen).
 */
export function planeWiederholung(
    alt: AltLauf,
    neu: { readonly sha: string; readonly umgebung: string; readonly komponenten: Readonly<Record<string, string>> },
    pruefsumme: PruefsummeVon,
    browserUnveraendertSeit: (startMs: number) => boolean = () => false,
    klassen: readonly string[] = RELEASE_KLASSEN,
): Wiederholung {
    const alle = [...klassen];
    if (alt.sha !== neu.sha)
        return {
            uebernehmen: [],
            neu: alle,
            grund: "Der frühere Lauf gehört zu einem anderen Stand: alle Teile laufen neu",
        };
    let fortsetzung: string | null = null;
    if (alt.umgebung !== neu.umgebung) {
        const anders =
            alt.komponenten === undefined
                ? undefined
                : [...new Set([...Object.keys(alt.komponenten), ...Object.keys(neu.komponenten)])].filter(
                      (k) => alt.komponenten?.[k] !== neu.komponenten[k],
                  );
        const nurPruefcode =
            anders !== undefined &&
            anders.length > 0 &&
            anders.every((k) => PRUEFCODE.has(k) || (k === "browser" && browserUnveraendertSeit(alt.start)));
        if (!nurPruefcode) {
            const was = unterschiede(alt.komponenten, neu.komponenten);
            return {
                uebernehmen: [],
                neu: alle,
                grund: `Umgebung verändert (${was.length === 0 ? "Fingerabdruck weicht ab" : was.join(", ")}): alle Teile laufen neu`,
            };
        }
        fortsetzung = `Fortsetzung: nur ${unterschiede(alt.komponenten, neu.komponenten).join(", ")} geändert${anders.includes("browser") ? " (Browser nur in seinen Protokollen)" : ""}, die Umgebung der Tests ist dieselbe`;
    }
    const { gut, schlecht } = uebernehmbareTeile(alt, pruefsumme, klassen);
    const beleg =
        schlecht.length === 0
            ? null
            : `Beleg nicht verwendbar (${schlecht.map((s) => `${s.klasse}: ${s.grund}`).join("; ")}): diese Teile laufen neu`;
    return {
        uebernehmen: gut,
        neu: alle.filter((k) => !gut.includes(k)),
        grund: fortsetzung === null ? beleg : beleg === null ? fortsetzung : `${fortsetzung}; ${beleg}`,
    };
}

/**
 * Übernimmt die Teile `klassen`: kopiert ihren Rohbericht aus dem alten in den neuen Ergebnisordner (nie über eine vorhandene Datei) und
 * prüft die Summe nach dem Kopieren noch einmal. Gibt die Einträge für den neuen Status zurück. Wirft, wenn eine Summe nicht stimmt; dann
 * hat der Runner ein Problem, das er nicht überspielt.
 */
export function uebernimmTeile(
    alt: AltLauf,
    ziel: string,
    klassen: readonly string[],
    pruefsumme: PruefsummeVon,
): ReleaseTeil[] {
    const eintraege: ReleaseTeil[] = [];
    for (const klasse of klassen) {
        const teil = alt.teile.find((t) => t.klasse === klasse);
        const datei = BELEG_DATEI[klasse];
        if (teil === undefined || datei === undefined || teil.beleg === undefined)
            throw new Error(`Übernahme von ${klasse}: Teil oder Beleg fehlt`);
        copyFileSync(join(alt.ordner, datei), join(ziel, datei), constants.COPYFILE_EXCL);
        if (pruefsumme(join(ziel, datei)) !== teil.beleg)
            throw new Error(`Übernahme von ${klasse}: Prüfsumme nach dem Kopieren stimmt nicht`);
        eintraege.push({ ...teil });
    }
    return eintraege;
}
