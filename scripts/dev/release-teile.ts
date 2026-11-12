// Die vier Browserteile des Release-Tests nach Thema (WI-0248): Zuordnung der Spec-Dateien lesen, prüfen und an Playwright übergeben.
//
// 🔴 Die Zuordnung steht in `apps/web/e2e/release-teile.json` (Name, Bereiche, Dateimuster je Teil). Vorher teilte `--shard=n/4` nur nach Anzahl: der
// Inhalt eines Teils war gemischt und verschob sich mit jedem neuen Test. Jetzt hat jeder Teil ein Thema, und ein Test (`release-teile.test.ts`)
// hält fest, dass jede Spec der Hauptconfig in genau einem Teil liegt und keine fehlt. Die Kennungen `browser-1` bis `browser-4` sind der Vertrag
// mit dem Nachweis Version 3 und dem Starter und ändern sich nicht.
//
// 🔴 Der Runner liest die Zuordnung aus dem Klon des KANDIDATEN: Specs und Zuordnung gehören zusammen. Fehlt sie dort oder passt sie nicht zu den
// Specs, laufen die Browserteile nicht (klarer Grund, roter Lauf), die übrigen Teile aber schon.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { istHauptconfigSpec, NUR_GENANNT } from "../../apps/web/e2e/spec-auswahl.ts";

/** Wo die Zuordnung im Repository liegt (relativ zur Wurzel). */
export const TEILE_DATEI = "apps/web/e2e/release-teile.json";
/** Wo die Specs liegen (relativ zur Wurzel). */
export const E2E_ORDNER = "apps/web/e2e";

export const TEIL_IDS = ["browser-1", "browser-2", "browser-3", "browser-4"] as const;
/**
 * `kern`: die feste Browser-Stichprobe der Kernabläufe (Prüfprofil B, `release-kern.json`); `kern-echt`: die Kernabläufe des Release-Tors gegen
 * den echten Server (Profil `tor`, WI-0264, `release-tor.json`).
 */
export type TeilId = (typeof TEIL_IDS)[number] | "kern" | "kern-echt";

export interface ReleaseTeilDefinition {
    readonly id: TeilId;
    /** Der Name des Teils, deutsch (die Systemsteuerung zeigt ihn in der Sprache der Seite über die Kennung). */
    readonly name: string;
    /** Kennungen der Themenbereiche (`admin.umgebungen.releaseTest.bereich.<kennung>`). */
    readonly bereiche: readonly string[];
    /** Dateimuster relativ zu `e2e/`; `*` steht für beliebige Zeichen im Namen (nicht über `/`). */
    readonly dateien: readonly string[];
}

export interface ReleaseTeileDatei {
    readonly version: 1;
    readonly teile: readonly ReleaseTeilDefinition[];
}

/** Die Zuordnung ist nicht lesbar oder unbrauchbar: Der Satz ist pfadfrei und steht in der Begründung des Laufs. */
export class TeileFehler extends Error {
    constructor(text: string) {
        super(text);
        this.name = "TeileFehler";
    }
}

const KENNUNG = /^[a-z][a-z0-9-]{0,40}$/;

const istTeilId = (wert: unknown): wert is TeilId =>
    typeof wert === "string" && (TEIL_IDS as readonly string[]).includes(wert);

/** Prüft die Form der Datei: genau die vier Teile in der Reihenfolge der Kennungen, je mit Name, Bereichen und Mustern. Wirft `TeileFehler`. */
export function pruefeTeileDatei(roh: unknown): ReleaseTeileDatei {
    if (typeof roh !== "object" || roh === null) throw new TeileFehler("Teilzuordnung ist kein Objekt");
    const datei = roh as { version?: unknown; teile?: unknown };
    if (datei.version !== 1) throw new TeileFehler("Teilzuordnung: unbekannte Version");
    if (!Array.isArray(datei.teile) || datei.teile.length !== TEIL_IDS.length)
        throw new TeileFehler(`Teilzuordnung: genau ${String(TEIL_IDS.length)} Teile erwartet`);
    const teile: ReleaseTeilDefinition[] = datei.teile.map((eintrag: unknown, i): ReleaseTeilDefinition => {
        const t = (eintrag ?? {}) as { id?: unknown; name?: unknown; bereiche?: unknown; dateien?: unknown };
        const erwartet = TEIL_IDS[i];
        if (!istTeilId(t.id) || t.id !== erwartet)
            throw new TeileFehler(`Teilzuordnung: Teil ${String(i + 1)} muss ${erwartet ?? "?"} heißen`);
        if (typeof t.name !== "string" || t.name.trim() === "" || t.name.length > 80)
            throw new TeileFehler(`Teilzuordnung: ${t.id} braucht einen Namen`);
        const bereiche = t.bereiche;
        if (
            !Array.isArray(bereiche) ||
            bereiche.length === 0 ||
            !bereiche.every((b): b is string => typeof b === "string" && KENNUNG.test(b))
        )
            throw new TeileFehler(`Teilzuordnung: ${t.id} braucht Bereiche (Kennungen aus Kleinbuchstaben)`);
        const dateien = t.dateien;
        if (
            !Array.isArray(dateien) ||
            dateien.length === 0 ||
            !dateien.every(
                (d): d is string =>
                    typeof d === "string" && /^[A-Za-z0-9._*/-]+$/.test(d) && !d.includes("..") && !d.startsWith("/"),
            )
        )
            throw new TeileFehler(`Teilzuordnung: ${t.id} braucht Dateimuster (Namen mit * als Platzhalter)`);
        return { id: t.id, name: t.name.trim(), bereiche, dateien };
    });
    if (new Set(teile.map((t) => t.name)).size !== teile.length) throw new TeileFehler("Teilzuordnung: Namen doppelt");
    return { version: 1, teile };
}

/** Liest und prüft `release-teile.json` unter `wurzel`. Wirft `TeileFehler` (fehlt, kein JSON, falsche Form). */
export function leseTeileDatei(wurzel: string): ReleaseTeileDatei {
    let text: string;
    try {
        text = readFileSync(join(wurzel, TEILE_DATEI), "utf8");
    } catch {
        throw new TeileFehler(`Teilzuordnung fehlt (${TEILE_DATEI})`);
    }
    let roh: unknown;
    try {
        roh = JSON.parse(text);
    } catch {
        throw new TeileFehler(`Teilzuordnung ist kein gültiges JSON (${TEILE_DATEI})`);
    }
    return pruefeTeileDatei(roh);
}

/** Alle Specs, die die Hauptconfig fährt (Pfade relativ zu `e2e/`, mit `/`, sortiert). Liest den Ordner von der Platte. */
export function listeSpecs(e2e: string): string[] {
    const gefunden: string[] = [];
    const gehe = (ordner: string, vorne: string): void => {
        for (const eintrag of readdirSync(ordner, { withFileTypes: true })) {
            const name = vorne === "" ? eintrag.name : `${vorne}/${eintrag.name}`;
            if (eintrag.isDirectory()) gehe(join(ordner, eintrag.name), name);
            else if (istHauptconfigSpec(name)) gefunden.push(name);
        }
    };
    gehe(e2e, "");
    return gefunden.sort();
}

/** Zeichen mit Bedeutung in einem regulären Ausdruck maskieren. */
const maskiere = (text: string): string => text.replace(/[.+?^${}()|[\]\\]/g, "\\$&");

/** Ein Dateimuster als regulärer Ausdruck über den ganzen Namen; `*` bleibt innerhalb eines Ordners. */
export function musterRegex(muster: string): RegExp {
    const teile = muster.split("*").map(maskiere);
    return new RegExp(`^${teile.join("[^/]*")}$`);
}

export interface TeilZuordnung {
    readonly id: TeilId;
    readonly name: string;
    readonly bereiche: readonly string[];
    /** Die Specs des Teils (Namen relativ zu `e2e/`, sortiert). */
    readonly specs: readonly string[];
}

export interface Zuordnung {
    readonly teile: readonly TeilZuordnung[];
    /** Specs, die in keinem Teil liegen. */
    readonly fehlend: readonly string[];
    /** Specs, die in mehr als einem Teil liegen, mit den Kennungen. */
    readonly mehrfach: readonly { readonly datei: string; readonly teile: readonly TeilId[] }[];
    /** Muster ohne Treffer: ein Rest einer gelöschten oder umbenannten Spec. */
    readonly leereMuster: readonly { readonly teil: TeilId; readonly muster: string }[];
}

/** Ordnet die Specs den Teilen zu. Eine Spec in mehreren Teilen steht in `mehrfach` und zählt für den ERSTEN Teil. */
export function ordneZu(datei: ReleaseTeileDatei, specs: readonly string[]): Zuordnung {
    const muster = datei.teile.map((t) => ({ teil: t, regeln: t.dateien.map((m) => ({ m, re: musterRegex(m) })) }));
    const je = new Map<TeilId, string[]>(datei.teile.map((t) => [t.id, []]));
    const fehlend: string[] = [];
    const mehrfach: { datei: string; teile: TeilId[] }[] = [];
    const getroffen = new Set<string>();
    for (const spec of specs) {
        const treffer = muster.filter((p) => p.regeln.some((r) => r.re.test(spec)));
        for (const p of muster)
            for (const r of p.regeln) if (r.re.test(spec)) getroffen.add(`${p.teil.id}\u0000${r.m}`);
        const erster = treffer[0];
        if (erster === undefined) {
            fehlend.push(spec);
            continue;
        }
        je.get(erster.teil.id)?.push(spec);
        if (treffer.length > 1) mehrfach.push({ datei: spec, teile: treffer.map((p) => p.teil.id) });
    }
    const leereMuster = muster.flatMap((p) =>
        p.regeln
            .filter((r) => !getroffen.has(`${p.teil.id}\u0000${r.m}`))
            .map((r) => ({ teil: p.teil.id, muster: r.m })),
    );
    return {
        teile: datei.teile.map((t) => ({
            id: t.id,
            name: t.name,
            bereiche: t.bereiche,
            specs: [...(je.get(t.id) ?? [])].sort(),
        })),
        fehlend,
        mehrfach,
        leereMuster,
    };
}

/**
 * Ist die Zuordnung für einen Lauf brauchbar? `null`, wenn jede Spec in genau einem Teil liegt und jeder Teil mindestens eine hat; sonst ein Satz
 * mit den ersten Namen. Leere Muster verhindern den Lauf nicht (sie prüft nur der Test): Sie sind Aufräumarbeit, keine Lücke.
 */
export function zuordnungProblem(z: Zuordnung): string | null {
    const beispiele = (liste: readonly string[]): string =>
        `${liste.slice(0, 3).join(", ")}${liste.length > 3 ? ` und ${String(liste.length - 3)} weitere` : ""}`;
    if (z.fehlend.length > 0)
        return `Teilzuordnung unvollständig: ${String(z.fehlend.length)} Spec(s) in keinem Teil (${beispiele(z.fehlend)})`;
    if (z.mehrfach.length > 0)
        return `Teilzuordnung doppelt: ${String(z.mehrfach.length)} Spec(s) in mehreren Teilen (${beispiele(z.mehrfach.map((m) => m.datei))})`;
    const leer = z.teile.find((t) => t.specs.length === 0);
    if (leer !== undefined) return `Teilzuordnung: ${leer.id} enthält keine Spec`;
    return null;
}

/** Liest Datei und Specs unter `wurzel` und ordnet zu. Wirft `TeileFehler`, wenn die Datei fehlt oder unbrauchbar ist. */
export function ladeZuordnung(wurzel: string): Zuordnung {
    return ordneZu(leseTeileDatei(wurzel), listeSpecs(join(wurzel, E2E_ORDNER)));
}

export const KERN_DATEI = "apps/web/e2e/release-kern.json";
export const TOR_DATEI = "apps/web/e2e/release-tor.json";

/**
 * Alle Specs, die ein Teil NENNEN darf: die der Hauptconfig und die Proben, die nur auf Nennung laufen (`NUR_GENANNT`, etwa `wegeditor-echt`).
 * Die Stichprobe von Profil B nimmt nur Hauptconfig-Specs; das Tor fährt gerade die Proben gegen den echten Server und nennt sie beim Namen.
 */
export function listeSpecsMitGenannten(e2e: string): string[] {
    const nur = NUR_GENANNT.map((name) => new RegExp(`(?:^|/)${maskiere(name)}\\.spec\\.ts$`));
    const gefunden: string[] = [];
    const gehe = (ordner: string, vorne: string): void => {
        for (const eintrag of readdirSync(ordner, { withFileTypes: true })) {
            const name = vorne === "" ? eintrag.name : `${vorne}/${eintrag.name}`;
            if (eintrag.isDirectory()) gehe(join(ordner, eintrag.name), name);
            else if (istHauptconfigSpec(name) || nur.some((re) => re.test(name))) gefunden.push(name);
        }
    };
    gehe(e2e, "");
    return gefunden.sort();
}

/** Eine feste Auswahl von Specs aus einer JSON-Datei (`name`, `bereiche`, `specs`) als Teil `id`; `vorhandene` liefert die Specs, die es geben darf. */
function ladeAuswahl(
    wurzel: string,
    datei: string,
    id: TeilId,
    bezeichnung: string,
    vorhandene: (e2e: string) => string[],
): TeilZuordnung {
    let roh: { name?: unknown; bereiche?: unknown; specs?: unknown };
    try {
        roh = JSON.parse(readFileSync(join(wurzel, datei), "utf8")) as typeof roh;
    } catch {
        throw new TeileFehler(`${bezeichnung} fehlt oder ist kein JSON (${datei})`);
    }
    const specs = Array.isArray(roh.specs) ? roh.specs.filter((x): x is string => typeof x === "string") : [];
    if (typeof roh.name !== "string" || specs.length === 0)
        throw new TeileFehler(`${bezeichnung}: Name oder Specs fehlen`);
    const vorhanden = new Set(vorhandene(join(wurzel, E2E_ORDNER)));
    const fehlt = specs.filter((x) => !vorhanden.has(x));
    if (fehlt.length > 0) throw new TeileFehler(`${bezeichnung}: Spec fehlt (${fehlt.join(", ")})`);
    const bereiche = Array.isArray(roh.bereiche) ? roh.bereiche.filter((x): x is string => typeof x === "string") : [];
    return { id, name: roh.name, bereiche, specs: [...new Set(specs)].sort() };
}

/**
 * Die feste Browser-Stichprobe der Kernabläufe (Prüfprofil B, Betreiberentscheidung 2026-10-24): ein Teil `kern` aus den Specs in
 * `release-kern.json`. Wirft `TeileFehler`, wenn die Datei fehlt oder eine genannte Spec nicht (mehr) zur Hauptconfig gehört.
 */
export function ladeKern(wurzel: string): TeilZuordnung {
    return ladeAuswahl(wurzel, KERN_DATEI, "kern", "Kern-Stichprobe", listeSpecs);
}

/**
 * Die Kernabläufe des Release-Tors (Profil `tor`, WI-0264): ein Teil `kern-echt` aus den Specs in `release-tor.json`, gefahren gegen den echten Server
 * des Kandidaten. Anders als `kern` dürfen die Specs auch Proben sein, die nur auf Nennung laufen (`NUR_GENANNT`). Wirft `TeileFehler`.
 */
export function ladeTor(wurzel: string): TeilZuordnung {
    return ladeAuswahl(wurzel, TOR_DATEI, "kern-echt", "Tor-Kernabläufe", listeSpecsMitGenannten);
}

/**
 * Das Argument für `playwright test`, das genau diese Specs wählt. 🪤 Playwright liest jedes Argument als regulären Ausdruck über den
 * Dateipfad (ein bloßer Name `info-panel.spec.ts` träfe auch `legacy-info-panel.spec.ts`); darum ein Ausdruck mit Ordner und Endanker. In der
 * Schreibweise `/…/` (Playwright nimmt sie wörtlich), ohne Leerzeichen und Anführungszeichen, damit der Aufruf ohne Shell nichts zerlegt.
 */
export function playwrightFilter(specs: readonly string[]): string {
    if (specs.length === 0) throw new TeileFehler("Kein Spec für den Filter");
    const namen = specs.map((s) => maskiere(s).replace(/\//g, "\\/"));
    return `/\\/e2e\\/(?:${namen.join("|")})$/`;
}
