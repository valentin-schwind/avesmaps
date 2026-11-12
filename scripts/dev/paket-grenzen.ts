// Die Grenzen des Besucherpakets und das Urteil des Wächters (WI-0235). Rein, damit der Test sie ohne Bau prüft.
import type { Klasse } from "./paket-herkunft.ts";

/**
 * Höchstes Start-JS in KB gzip (Node, Stufe 6; Nginx packt mit vergleichbarer Größe). Verlauf in WI-0235 §6; zuletzt nach Schnitt 1
 * (Editorfenster nachladen): 932 KB. Release-Test 2026-10-26 auf 08a5d3d6b: 1.037 KB, rot; die Fenster „Inhalte bearbeiten“ und der Reiter
 * WikiSync waren schon nachgeladen, im Start lagen ihre Verträge aus `shared` (alle Module ohne Merkmal `sideEffects`): mit
 * `"sideEffects": false` in `packages/shared/package.json` 1.004 KB, die Grenze blieb bei 1.025.
 * 2026-10-29: Release-Test auf d80313c07 wieder rot, 1.032 KB (neue Verträge in `shared` für WI-0257 und WI-0253: ein Modul mit einer
 * gebrauchten Konstante brachte alle seine TypeBox-Schemata mit). Behoben in `apps/web/vite.config.ts` ohne Eingriff in die Bauteile:
 * TypeBox-Baufunktionen als reine Aufrufe (`treeshake.manualPureFunctions`, ungenutzte Schemata fallen: -20 KB) und die Statusseite
 * (seit der Gruppe `gemeinsam` im Start) aus ihr heraus (-8 KB): 1.004 KB; die Grenze blieb bei 1.025.
 * 2026-11-01: Volltest auf ec5be0515 rot, 1.184 KB (Community, Reisebilder, Screenshot, Texte dazu). Die seltenen Fenster laden nach (-98 KB), die Wörter der Verwaltung in der deutschen
 * Tafel auch (`apps/web/src/i18n/spaete-texte.ts`, -78 KB): 1.008 KB; die Grenze blieb bei 1.025.
 * 2026-11-08: Wetter (WI-0288, `prototyp/wetter-kontinental`) rot, 1.043 KB. Vom Wetter-Editor steht nur seine Hülle im Start (`wettereditor/wettereditor-huelle.ts`;
 * Steuerung, Modell, Speicher, Wiki-Suche und Leseweg laden nach, für Editoren mit `ladeEditorVor`), was die Wetterschalter aus `shared` brauchen, liegt in eigenen
 * kleinen Modulen (`wetter/reisetag.ts`, `wetter/arten.ts`, sonst kamen die Tafeln des Wetters mit): 1.031 KB. Dazu die Wörter der sieben Editoren im späten Teil der
 * Tafel (nur Editoren sehen sie, und sie bekommen ihn vor dem Einhängen): 1.004 KB; die Grenze blieb bei 1.025.
 * 🔴 Sperrklinke (Hauptorchestrierung 2026-10-19, Wahl B): die Grenze ist der Stand +10 %. Nach jeder Optimierung wird sie wieder auf
 * Stand +10 % gesenkt; gehoben wird sie nur mit dem Wort des Betreibers. Ein roter Wächter macht den Sammellauf rot und hält damit die
 * Production-Freigabe zu; er geht an die Hauptorchestrierung, die den Betreiber fragt: heben oder optimieren.
 */
export const GRENZE_START_JS_GZIP_KB = 1_025;

/** Was eine rote Grenze verlangt, so steht es in der Meldung. */
export const REGEL_BEI_ROT = "Paket über der Grenze: optimieren oder den Betreiber um Anhebung bitten.";

/**
 * Ist der Editor abgetrennt (Nachladen erst mit Editorrechten, wie in Legacy)? Bis dahin meldet der Wächter den Editoranteil nur; danach
 * ist jedes Byte der Klasse „Editor“ im Startpaket rot.
 */
export const EDITOR_GETRENNT = false;

export interface PaketMessung {
    readonly jsRoh: number;
    readonly jsGzip: number;
    readonly cssRoh: number;
    readonly cssGzip: number;
    readonly klassen: Readonly<Record<Klasse, { readonly roh: number; readonly gzip: number }>>;
    /** Quellen der Klasse „Editor“ im Startpaket, größte zuerst. */
    readonly editorQuellen: readonly { readonly quelle: string; readonly bytes: number }[];
}

export interface PaketGrenzen {
    readonly startJsGzipKb: number;
    readonly editorGetrennt: boolean;
}

export function pruefePaket(
    messung: PaketMessung,
    grenzen: PaketGrenzen = { startJsGzipKb: GRENZE_START_JS_GZIP_KB, editorGetrennt: EDITOR_GETRENNT },
): { gruen: boolean; zeilen: string[] } {
    const kb = (n: number): string => `${Math.round(n / 1024).toLocaleString("de-DE")} KB`;
    const zeilen: string[] = [];
    const groesseGruen = messung.jsGzip <= grenzen.startJsGzipKb * 1024;
    zeilen.push(
        `  ${groesseGruen ? "grün" : "ROT "}  Start-JS ${kb(messung.jsGzip)} gzip, Grenze ${grenzen.startJsGzipKb.toLocaleString("de-DE")} KB (scripts/dev/paket-grenzen.ts)`,
    );
    if (!groesseGruen) zeilen.push(`  ROT   ${REGEL_BEI_ROT}`);
    const editor = messung.klassen.Editor.roh;
    const groesste = messung.editorQuellen
        .slice(0, 5)
        .map((q) => `${q.quelle.replace(/^(\.\.\/)+/, "")} ${kb(q.bytes)}`)
        .join(", ");
    let editorGruen = true;
    if (!grenzen.editorGetrennt) {
        zeilen.push(`  Meldung  Editor im Startpaket: ${kb(editor)} roh; noch nicht abgetrennt, darum nur gemeldet`);
    } else if (editor > 0) {
        editorGruen = false;
        zeilen.push(
            `  ROT   Editor im Startpaket: ${kb(editor)} roh, obwohl er nachgeladen werden soll; größte: ${groesste}`,
        );
    } else {
        zeilen.push("  grün  kein Editor-Code im Startpaket");
    }
    return { gruen: groesseGruen && editorGruen, zeilen };
}
