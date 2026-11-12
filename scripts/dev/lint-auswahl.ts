// Lint und Format in `vor-dem-push` (Hauptorchestrierung 2026-10-18, Lücke geschlossen).
//
// 🔴 Anlass: Claudios Prüfung nach dem Push war seit 05:40 am Lint rot (zehn Fehler aus drei Strängen, darunter zwei echte
// `vue/no-mutating-props`), und ihre Tests liefen deshalb drei Stunden gar nicht: `vor-dem-push` fuhr weder ESLint noch Prettier, auch nicht in
// der vollen Stufe. Dieselbe Lücke hatte beim Format schon der Memory „vor-dem-push prüft kein Format“ benannt.
//
// Die Regel (billig halten): Jeder Lauf prüft die Dateien, die der Push gegenüber `origin/master` ändert (ESLint nur Code, Prettier alles, was
// es kennt; ausgenommene Dateien überspringen beide selbst). `--voll` prüft alles (`npm run lint`, `npm run format:check`, wie Claudios Prüfung),
// ebenso eine Änderung, die sich nicht bestimmen lässt. Gemessen am 2026-10-18 auf einem ausgelasteten Rechner: ESLint über alles 52 s, Prettier
// über alles 80 s; ESLint ist nicht typbewusst und braucht keinen Bau.

/** Die Endungen, die ESLint hier prüft (Konfiguration `eslint.config.mjs`: TypeScript, JavaScript, Vue). */
const LINT_ENDUNG = /\.(ts|mts|cts|js|mjs|cjs|vue)$/;

export interface Pruefung {
    /** `alles`: das ganze Repository (die npm-Skripte); `geaendert`: nur die genannten Dateien; `keine`: nichts zu prüfen. */
    readonly modus: "alles" | "geaendert" | "keine";
    /** Pfade relativ zur Wurzel mit `/`; nur bei `geaendert`. */
    readonly dateien: readonly string[];
}

export interface LintPlan {
    readonly lint: Pruefung;
    readonly format: Pruefung;
}

const ALLES: Pruefung = { modus: "alles", dateien: [] };

function waehle(dateien: readonly string[]): Pruefung {
    return dateien.length === 0 ? { modus: "keine", dateien: [] } : { modus: "geaendert", dateien };
}

/**
 * Was Lint und Format prüfen. `geaendert` sind die Pfade der Änderung (`undefined`: nicht bestimmbar), `vorhanden` fragt, ob die Datei im
 * geprüften Stand liegt (eine gelöschte Datei gibt es nicht zu prüfen).
 */
export function planeLintUndFormat(optionen: {
    readonly geaendert: readonly string[] | undefined;
    readonly voll: boolean;
    readonly vorhanden: (pfad: string) => boolean;
}): LintPlan {
    const { geaendert, voll, vorhanden } = optionen;
    if (voll || geaendert === undefined) return { lint: ALLES, format: ALLES };
    const da = [...new Set(geaendert.map((p) => p.split("\\").join("/")))].filter(vorhanden).sort();
    return { lint: waehle(da.filter((p) => LINT_ENDUNG.test(p))), format: waehle(da) };
}

/** Teilt eine Liste in Stücke, damit eine Befehlszeile nie zu lang wird (Windows: rund 32.000 Zeichen). */
export function inStuecken<T>(liste: readonly T[], groesse: number): T[][] {
    const stuecke: T[][] = [];
    for (let i = 0; i < liste.length; i += groesse) stuecke.push(liste.slice(i, i + groesse));
    return stuecke;
}

/**
 * Welche Zeilen ein roter Lint- oder Format-Schritt zeigt: die Datei (ESLint „stylish“: der Pfad in einer eigenen Zeile), jeden Fund, die Summe;
 * von Prettier die Zeilen `[warn]` mit den Dateien.
 */
export const ROT_LINT = /^\s*\d+:\d+\s+(error|warning)|✖|\[warn\]|^\S.*\.(ts|mts|cts|js|mjs|cjs|vue)\s*$/;
