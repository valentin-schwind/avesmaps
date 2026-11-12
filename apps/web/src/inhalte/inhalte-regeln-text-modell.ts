import type {
    InhalteRegelTextErgebnis,
    InhalteRegelTextOption,
    InhalteRegelTextProblem,
    InhalteRegelTextUebernommen,
} from "@avesmaps3d/shared";
import { formatNumber, t, tPlural } from "../i18n/i18n";

/**
 * „Regeln als Text“ im Reiter „Vorkommen“ (WI-0254 §13 und §14) als reine Rechnung, ohne Vue, von Vitest geprüft: der Text ist die einzige Quelle, jede Antwort auf eine Rückfrage ist ein Ersatz im Text
 * (Zeile ab 0, von, bis ausschließlich), danach wird neu geprüft. Hier stehen der Ersatz, das „aktuell“ einer Vorschau, der Zeilenbereich für die Markierung im Feld, das Anhängen eines Blocks vom Rückweg „Als
 * Text“, die Marken der Zeilennummern und die Sätze zum Plan des Übernehmens. Gelesen und aufgelöst wird allein auf dem Server (Vertrag `packages/shared/src/inhalte-regeln-text.ts`).
 */

/** Der Beispielstapel des Entwurfs: Alle Namen sind echte Einträge, Flächen, Orte und Quellen der Datenbank. Er erscheint nur auf Wunsch („Beispiel“), nie von selbst: „Übernehmen“ legte sonst echte Regeln an. */
export const TEXT_BEISPIEL = `# Beispielstapel: Funde aus Reisehandbüchern
Quelle: [[Geographia Aventurica]], S. 112
Vierblättrige Einbeere (Flora)
| Verbreitung = [[Wald]] Klima boreal bis gemäßigt
| Herkunft = [[Wald]] oder [[Auenlandschaft]] Klima Gemäßigte Zone
    außer [[Gebirge]]
Bleiche Alara (Flora)
| Verbreitung = südlich der Linie [[Havena]]–[[Perricum]]
| Regionen = [[Wald]] in [[Kaiserwald]] (wartet)
| Herkunft = [[Aeltikan]]
Alprute (Flora)
| Verbreitung = [[Wald]] oder [[Sumpf]]

Quelle: [[Handelsherr und Kiepenkerl]], S. 88
Alant (Flora)
| Verbreitung = [[Auenlandschaft]] oder [[Flussland/Flusstal]]
Aal
| Vorkommen = [[See]] oder [[Meer]]
Sturmwurz (Flora)
| Herkunft = [[Wüste]] oder [[Steppe]] in [[Khom]]`;

/** Was im leeren Feld steht: der Aufbau in drei Zeilen. Es ist die Schreibweise selbst und wird nicht übersetzt. */
export const TEXT_PLATZHALTER = `# Beispiel
Quelle: [[Titel]], S. 12
Alprute (Flora)
| Verbreitung = [[Wald]] Klima boreal bis gemäßigt,
    [[Steppe]] in [[Aventurien]]`;

/** Der Aufbau des Texts für die Kurzreferenz, wie die Schreibweise ihn nennt (Schlüsselwörter und Zeichen sind die Schreibweise und bleiben, wie sie sind). */
export const TEXT_AUFBAU = `# Kommentar
Quelle: [[Titel]], S. 12
Name (Kategorie)
| Beziehung = Glied, Glied: Glied außer Glied; nächste Regel
    Fortsetzung der Zeile darüber`;

/** Die Kategorien in der Folge der Schreibweise (`Flora`, `Fauna`, `Ware`/`Waren`, `Spezies`). */
export const TEXT_KATEGORIEN = ["flora", "fauna", "ware", "spezies"] as const;

/** Ein Ersatz im Text: Zeile (ab 0), Spalten von und bis (bis ausschließlich) in dieser Zeile und der neue Text. */
export type TextErsatz = InhalteRegelTextOption["ersatz"];

const zeilenVon = (text: string): string[] => text.split("\n");

/**
 * Ein Ersatz im Text. 🪤 Die Stelle gehört zum Text der Prüfung: Ist der Text seither anders, kann sie ins Leere zeigen oder mitten ins Wort. Passt sie nicht (Zeile da, von ≤ bis ≤ Länge der Zeile), kommt
 * `undefined` und der Text bleibt, wie er ist; die Oberfläche sperrt die Antworten außerdem, solange die Vorschau veraltet ist.
 */
export function wendeErsatzAn(text: string, ersatz: TextErsatz): string | undefined {
    const zeilen = zeilenVon(text);
    const alt = zeilen[ersatz.zeile];
    if (alt === undefined || ersatz.von > ersatz.bis || ersatz.bis > alt.length) return undefined;
    zeilen[ersatz.zeile] = alt.slice(0, ersatz.von) + ersatz.text + alt.slice(ersatz.bis);
    return zeilen.join("\n");
}

/** Gehört die Vorschau zum Text, wie er jetzt dasteht? Dann ist sie „aktuell“; sonst ist der Text seit „Prüfen“ geändert. */
export const istAktuell = (
    ergebnis: InhalteRegelTextErgebnis | undefined,
    geprueft: string | undefined,
    text: string,
): boolean => ergebnis !== undefined && geprueft === text;

/**
 * Die Zeichen im Feld, die die Zeilen `von` bis `bis` (beide einschließlich, ab 0) umfassen: vom Anfang der ersten bis zum Ende der letzten, ohne deren Zeilenumbruch. Zeilen hinter dem Ende des Texts zählen nicht
 * mit; liegt `von` dahinter, ist der Bereich leer am Ende des Texts.
 */
export function zeilenBereich(text: string, von: number, bis: number): { anfang: number; ende: number } {
    const zeilen = zeilenVon(text);
    let anfang = 0;
    for (let i = 0; i < von && i < zeilen.length; i++) anfang += (zeilen[i] ?? "").length + 1;
    anfang = Math.min(anfang, text.length);
    let ende = anfang;
    for (let i = von; i <= bis && i < zeilen.length; i++) ende += (zeilen[i] ?? "").length + (i < bis ? 1 : 0);
    return { anfang, ende: Math.min(ende, text.length) };
}

/** Ein Text, der nichts Eigenes enthält: leer oder noch der Beispielstapel. Ihn ersetzt ein Block vom Rückweg, statt ihn zu ergänzen. */
export const istUnberuehrt = (text: string): boolean => text.trim() === "" || text === TEXT_BEISPIEL;

/**
 * Den Block eines Eintrags („Als Text“ am Regel-Abschnitt) an den Text hängen: ans Ende, durch eine Leerzeile getrennt. Steht noch nichts Eigenes im Feld (leer oder das Beispiel), ersetzt der Block den Text.
 * `von` und `bis` sind die Zeilen (ab 0, einschließlich), die der Block danach im Text einnimmt, damit die Ansicht ihn markieren kann.
 */
export function haengeBlockAn(text: string, block: string): { text: string; von: number; bis: number } {
    const neu = block.replace(/\s+$/u, "");
    const vorhandene = istUnberuehrt(text) ? "" : `${text.replace(/\s+$/u, "")}\n\n`;
    const von = vorhandene === "" ? 0 : zeilenVon(vorhandene).length - 1;
    return { text: vorhandene + neu, von, bis: von + zeilenVon(neu).length - 1 };
}

/** Alle Befunde der Vorschau: die losen, die der Einträge (samt Quelle-Zeile) und die der Regeln. */
export const alleProbleme = (ergebnis: InhalteRegelTextErgebnis): InhalteRegelTextProblem[] => [
    ...ergebnis.lose,
    ...ergebnis.eintraege.flatMap((e) => [...e.probleme, ...e.regeln.flatMap((r) => r.probleme)]),
];

/** Die Marken der Zeilennummern am Rand: Zeile (ab 0) → `fehler` oder `frage`; ein Fehler geht vor. */
export function zeilenMarken(ergebnis: InhalteRegelTextErgebnis | undefined): ReadonlyMap<number, "fehler" | "frage"> {
    const marken = new Map<number, "fehler" | "frage">();
    if (ergebnis === undefined) return marken;
    for (const problem of alleProbleme(ergebnis)) {
        if (marken.get(problem.zeile) !== "fehler")
            marken.set(problem.zeile, problem.art === "fehler" ? "fehler" : "frage");
    }
    return marken;
}

/** Was „Übernehmen“ jetzt täte, in den Zahlen des Servers. */
export type TextPlan = InhalteRegelTextErgebnis["plan"];

/** Ist nichts zu tun? Dann gibt es nichts zu übernehmen (alles „gibt es schon“, eine Rückfrage oder ein Fehler). */
export const planLeer = (plan: TextPlan): boolean => plan.regeln === 0 && plan.quellen === 0 && plan.anlegen === 0;

/** „3 Einträge“, „1 Eintrag“. */
export const eintraegeText = (n: number): string =>
    tPlural("inhalte.vorkommen.text.n.eintraege", n, { n: formatNumber(n, 0) });
/** „an 3 Einträgen“ (nach „an“): die Form hinter dem Wort. */
const eintraegeAnText = (n: number): string =>
    tPlural("inhalte.vorkommen.text.n.eintraegeAn", n, { n: formatNumber(n, 0) });
const regelnText = (n: number): string => tPlural("inhalte.vorkommen.text.n.regeln", n, { n: formatNumber(n, 0) });
export const rueckfragenText = (n: number): string =>
    tPlural("inhalte.vorkommen.text.n.rueckfragen", n, { n: formatNumber(n, 0) });
export const fehlerText = (n: number): string =>
    tPlural("inhalte.vorkommen.text.n.fehler", n, { n: formatNumber(n, 0) });

/** Die Aufschrift des Knopfs „Übernehmen“: Regeln und Einträge, sonst nur Quellen, sonst nur neue Einträge, sonst „nichts Neues“. */
export function uebernehmenText(plan: TextPlan): string {
    if (plan.regeln > 0)
        return t("inhalte.vorkommen.text.uebernehmen.regeln", {
            regeln: regelnText(plan.regeln),
            eintraege: eintraegeAnText(plan.eintraege),
        });
    if (plan.quellen > 0)
        return t("inhalte.vorkommen.text.uebernehmen.quelle", { eintraege: eintraegeAnText(plan.quellen) });
    if (plan.anlegen > 0)
        return t("inhalte.vorkommen.text.uebernehmen.anlegen", { eintraege: eintraegeText(plan.anlegen) });
    return t("inhalte.vorkommen.text.uebernehmen.nichts");
}

/** Was zum Plan sonst noch gehört, in Sätzen unter dem Knopf: die Quelle an Einträgen, neue Einträge. Leer, wo es nichts ist, das der Knopf nicht schon nennt. */
export function planZusaetze(plan: TextPlan): string[] {
    const zusaetze: string[] = [];
    if (plan.regeln > 0 && plan.quellen > 0)
        zusaetze.push(t("inhalte.vorkommen.text.plan.quelle", { eintraege: eintraegeAnText(plan.quellen) }));
    if (plan.regeln > 0 && plan.anlegen > 0)
        zusaetze.push(t("inhalte.vorkommen.text.plan.anlegen", { eintraege: eintraegeText(plan.anlegen) }));
    return zusaetze;
}

/**
 * Der Satz nach dem Übernehmen aus der Quittung: was angelegt wurde und was übersprungen. `entwurfOffen`: Der gewählte Eintrag trägt im Fenster einen Entwurf mit Änderungen; der zeigt den alten Stand und
 * bekommt beim Speichern 409 (das Fenster verwirft ihn nicht von selbst).
 */
export function uebernommenSatz(quittung: InhalteRegelTextUebernommen, entwurfOffen: boolean): string {
    const teile: string[] = [];
    if (quittung.regeln > 0)
        teile.push(
            t("inhalte.vorkommen.text.meldung.regeln", {
                regeln: regelnText(quittung.regeln),
                eintraege: eintraegeAnText(quittung.eintraege),
            }),
        );
    if (quittung.quellen > 0)
        teile.push(t("inhalte.vorkommen.text.meldung.quellen", { eintraege: eintraegeAnText(quittung.quellen) }));
    if (quittung.angelegt > 0)
        teile.push(t("inhalte.vorkommen.text.meldung.angelegt", { eintraege: eintraegeText(quittung.angelegt) }));
    if (teile.length === 0) teile.push(t("inhalte.vorkommen.text.meldung.nichts"));
    if (quittung.schon > 0)
        teile.push(t("inhalte.vorkommen.text.meldung.schon", { n: formatNumber(quittung.schon, 0) }));
    const verbunden = teile.join("; ");
    const satz = `${verbunden.charAt(0).toLocaleUpperCase()}${verbunden.slice(1)}.`;
    return entwurfOffen ? `${satz} ${t("inhalte.vorkommen.text.meldung.entwurf")}` : satz;
}

/** „Z. 4“ oder „Z. 5–6“: Zeilen zählen im Text von 1 an, im Vertrag von 0. */
export const zeilenText = (von: number, bis: number): string =>
    von === bis
        ? t("inhalte.vorkommen.text.zeile", { n: formatNumber(von + 1, 0) })
        : t("inhalte.vorkommen.text.zeilen", { von: formatNumber(von + 1, 0), bis: formatNumber(bis + 1, 0) });
