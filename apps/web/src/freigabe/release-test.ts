import { ref, shallowRef, type Ref, type ShallowRef } from "vue";
import {
    RELEASE_TEST_URL,
    releaseTestBeschaeftigt,
    releaseTestCommit,
    type OperationReceipt,
    type ReleaseTestKandidat,
    type ReleaseTestLauf,
    type ReleaseTestSicht,
    type ReleaseTestStartvorgang,
    type ReleaseTestTeil,
} from "@avesmaps3d/shared";
import { ApiFailure, getJson, newOperationId, postJson, type Fetcher } from "../auth/api";
import { requestConfirmation, withConfirmation } from "../auth/bestaetigen";
import { formProblems, type Phrase } from "../auth/formular";
import type { MessageKey } from "../i18n/i18n";

/**
 * Der Release-Test in der lokalen Systemsteuerung (WI-0248 L), Reiter „Umgebungen“: was die Oberfläche rechnet. Wie sie aussieht, steht in
 * `umgebungen-release-test.vue`.
 *
 * - 🔴 **Die Oberfläche rechnet keine Zeiten.** Erwartete Dauer, Fortschritt und verbleibende Zeit kommen fertig vom Starter (über den Server);
 *   hier steht nur, was der Knopf tut und wie der Bericht als Text aussieht.
 * - **Nur lokal.** Die Route gibt es nur auf dem Entwicklungsrechner; antwortet sie nicht, bleibt `sicht` leer und die Karte weg.
 * - Starten verlangt den Passkey (Stufe S, wie die Production-Freigabe); Abbrechen nicht.
 * - **Rote Teile wiederholen** (WI-0248) ist ein Start desselben Standes mit `wiederholen: true`, ebenfalls mit Passkey. Der Knopf steht nur, wenn
 *   der Lauf des Kandidaten rot oder abgebrochen ist; was übernommen wird und was nicht, entscheidet der Starter (gleiche Umgebung, belegte Teile).
 * - 🔴 **Starten reiht ein** (Vali 2026-10-26): Der Knopf reiht einen Auftrag `release_test` in die Warteschlange; den Starter ruft der Ausführer,
 *   wenn der schwere Platz frei ist. Bis zur Quittung steht „Starte Lauf …“, danach der Auftrag (`sicht.auftrag`): eingereiht mit Platz oder „wartet
 *   auf …“, dann der Lauf. Abbrechen bricht den Auftrag und den Lauf ab.
 * - 🔴 **Zwei Knöpfe** (WI-0264; Vali 2026-10-31: „Schnelltest und Volltest“): „Schnelltest“ ist der Start oben (Release-Tor, Freigabe). „Volltest“
 *   schickt denselben Start mit `volltest: true`: erst der Schnelltest, dann alles, nur Bericht, nichts geht nach Production. Er darf auch einen grün
 *   geprüften Stand prüfen; sonst sperrt ihn dasselbe wie den Schnelltest (es läuft immer nur einer).
 */

/** Warum „Release-Test starten“ gerade nicht geht. */
export type KnopfSperre =
    "nicht_verfuegbar" | "kein_kandidat" | "eingereiht" | "laeuft" | "abgestuerzt" | "startet" | "gruen";

export interface KnopfZustand {
    /** Der Stand, der geprüft würde: die jüngste Freigabe, sonst der Stage-Stand. */
    commit: string | null;
    sperre: KnopfSperre | null;
}

/**
 * Was der Knopf tut. Gesperrt, solange ein Test läuft (auch ein abgestürzter, dessen Sperre bleibt), ein Start das Testpaket baut oder dieser
 * Stand schon grün geprüft ist. Ein grüner Lauf für einen anderen Stand sperrt nichts.
 */
export function releaseTestKnopf(sicht: ReleaseTestSicht | null): KnopfZustand {
    if (sicht === null || !sicht.verfuegbar) return { commit: null, sperre: "nicht_verfuegbar" };
    const commit = releaseTestCommit(sicht.kandidat);
    if (commit === null) return { commit, sperre: "kein_kandidat" };
    const lauf = sicht.lauf;
    if (lauf?.zustand === "laeuft") return { commit, sperre: lauf.lebt === false ? "abgestuerzt" : "laeuft" };
    if (sicht.start?.zustand === "baut") return { commit, sperre: "startet" };
    // Ein Auftrag in der Warteschlange: wartend „eingereiht“; übernommen, aber noch ohne Lauf, ruft der Ausführer gerade den Starter.
    const auftrag = sicht.auftrag ?? null;
    if (auftrag !== null) return { commit, sperre: auftrag.zustand === "wartet" ? "eingereiht" : "startet" };
    // 🔴 WI-0248: Gesperrt ist ein grüner Stand nur, wenn er schon freigegeben ist (er geht dann ohnehin raus). Ein Grün ohne Freigabe (ein Lauf von
    // Hand) gibt der Druck frei, ohne neuen Lauf.
    const freigabe = sicht.kandidat?.freigabe;
    if (freigabe !== undefined && freigabe.sha === commit && freigabe.zustand === "gruen")
        return { commit, sperre: "gruen" };
    return { commit, sperre: null };
}

/** Was der Knopf „Volltest“ tut (WI-0264): wie der Schnelltest, aber ein grün geprüfter Stand sperrt ihn nicht (er prüft alles, gibt nichts frei). */
export function releaseVolltestKnopf(sicht: ReleaseTestSicht | null): KnopfZustand {
    const knopf = releaseTestKnopf(sicht);
    return knopf.sperre === "gruen" ? { ...knopf, sperre: null } : knopf;
}

/** „Rote Teile wiederholen“: ob der Knopf steht und warum er gerade gesperrt ist. */
export interface WiederholenZustand {
    /** Der Knopf steht nur, wenn der Lauf des Kandidaten rot oder abgebrochen ist und der Starter ihn als wiederholbar meldet. */
    sichtbar: boolean;
    commit: string | null;
    /** Gesperrt, solange ein Test läuft oder ein Start das Testpaket baut. */
    sperre: KnopfSperre | null;
}

/** Der Zustand des Knopfes „Rote Teile wiederholen“ für den Kandidaten (derselbe Stand wie bei „Release-Test starten“). */
export function releaseTestWiederholen(sicht: ReleaseTestSicht | null): WiederholenZustand {
    const knopf = releaseTestKnopf(sicht);
    const lauf = sicht?.lauf ?? null;
    const sichtbar =
        knopf.commit !== null &&
        lauf !== null &&
        lauf.sha === knopf.commit &&
        lauf.wiederholbar === true &&
        (lauf.zustand === "rot" || lauf.zustand === "abgebrochen");
    if (!sichtbar) return { sichtbar: false, commit: knopf.commit, sperre: null };
    const gesperrt =
        knopf.sperre === "laeuft" ||
        knopf.sperre === "abgestuerzt" ||
        knopf.sperre === "startet" ||
        knopf.sperre === "eingereiht";
    return { sichtbar: true, commit: knopf.commit, sperre: gesperrt ? knopf.sperre : null };
}

/**
 * Der Start, der gescheitert ist (der Starter nennt den Grund). Er ist der Zustand der Karte, nicht der Lauf davor: Ein roter oder grüner Lauf von
 * früher bleibt als „Vorheriger Lauf“ darunter, wird aber nie als Antwort auf den Knopf gelesen. `null`, wenn der Start nicht gescheitert ist.
 */
export function startGescheitert(sicht: ReleaseTestSicht | null): ReleaseTestStartvorgang | null {
    return sicht?.start?.zustand === "fehler" ? sicht.start : null;
}

/**
 * Gehört der gezeigte Lauf zu einem anderen Stand als der Kandidat? Dann sagt die Karte es dazu: Ein roter Lauf von gestern ist keine Antwort auf
 * den Stand von heute. `null`, wenn es keinen Lauf gibt, der Kandidat unbekannt ist oder beide derselbe Stand sind.
 */
export function andererStand(sicht: ReleaseTestSicht | null): { lauf: string; kandidat: string } | null {
    const lauf = sicht?.lauf;
    const kandidat = releaseTestCommit(sicht?.kandidat ?? null);
    if (lauf === undefined || lauf === null || lauf.zustand === "keiner" || lauf.sha === undefined) return null;
    if (kandidat === null || lauf.sha === kandidat) return null;
    return { lauf: lauf.sha, kandidat };
}

/** Der Stand, den „Abbrechen“ beendet: der Auftrag in der Warteschlange (wartend oder laufend), sonst der laufende Test, solange sein Prozess lebt. */
export function abbrechenCommit(sicht: ReleaseTestSicht | null): string | null {
    const auftrag = sicht?.auftrag ?? null;
    if (auftrag !== null) return auftrag.commit;
    const lauf = sicht?.lauf;
    return lauf?.zustand === "laeuft" && lauf.lebt !== false ? (lauf.sha ?? null) : null;
}

/**
 * Der wartende Auftrag, wie die Karte ihn zeigt: eingereiht mit Platz, dahinter worauf er wartet (der laufende Auftrag oder der Grund der
 * Warteschlange). `null`, wenn kein Auftrag wartet (keiner, oder er läuft schon: dann zeigt die Karte den Start und den Lauf).
 */
export function auftragWartet(
    sicht: ReleaseTestSicht | null,
): { platz: number | null; wartetAuf: string | null; grund: string | null } | null {
    const auftrag = sicht?.auftrag ?? null;
    if (auftrag?.zustand !== "wartet") return null;
    return { platz: auftrag.platz, wartetAuf: auftrag.wartetAuf, grund: auftrag.grund };
}

/**
 * Läuft gerade ein Test oder baut ein Start sein Paket? Dann zeigt die Karte oben den Lauf; sonst sagt sie ausdrücklich „Kein Release-Test läuft“ und stellt
 * den Knopf nach oben (WI-0248: Nach einem Abbruch sah die Karte aus, als liefe etwas). Ein abgestürzter Lauf (Prozess weg, Sperre da) läuft nicht.
 */
export function releaseTestAktiv(sicht: ReleaseTestSicht | null): boolean {
    if (sicht === null) return false;
    return (
        (sicht.auftrag ?? null) !== null ||
        (sicht.lauf?.zustand === "laeuft" && sicht.lauf.lebt !== false) ||
        sicht.start?.zustand === "baut"
    );
}

/**
 * Ist ein Versuch (`versuch`, ms seit 1970) noch ohne Antwort des Starters? Beantwortet ist er, sobald etwas läuft oder baut, oder sobald ein
 * Start vorliegt, der nicht älter ist als der Versuch (auch ein gescheiterter). Ein Start von früher ist keine Antwort.
 */
export function versuchOffen(sicht: ReleaseTestSicht | null, versuch: number | null): boolean {
    if (versuch === null) return false;
    if (releaseTestAktiv(sicht)) return false;
    const seit = Date.parse(sicht?.start?.seit ?? "");
    return !(Number.isFinite(seit) && seit >= versuch);
}

/**
 * Der Satz zu einem Stand, der sich seit dem Blick der Karte bewegt hat: „Die Stage ist inzwischen auf <sha> – neu starten?“, bei einer neuen Freigabe
 * „Die Freigabe …“. Die Regel, welcher Stand zählt, ist `releaseTestCommit`.
 */
export function standGewechselt(kandidat: ReleaseTestKandidat | null, neu: string): Phrase {
    const freigabe = kandidat?.auftrag?.sha === neu;
    return {
        key: freigabe
            ? "admin.umgebungen.releaseTest.freigabeGewechselt"
            : "admin.umgebungen.releaseTest.stageGewechselt",
        params: { sha: neu.slice(0, 7) },
    };
}

/**
 * Warum der Server (oder der Starter dahinter) einen Start abgewiesen hat, als Sätze für die rote Zeile oben in der Karte: der Satz zum Fachcode und, wenn
 * der Starter einen Grund nannte (Sperre, Fehler, kein Auftrag), dieser Grund wörtlich dahinter. Ein veralteter Stand nennt den jetzigen (`kandidat`,
 * frisch geladen). `null`, wenn der Fehler keine Abweisung des Release-Tests ist (etwa ein abgebrochener Passkey).
 */
export function abweisungVon(error: unknown, kandidat: ReleaseTestKandidat | null): Phrase[] | null {
    if (!(error instanceof ApiFailure) || !error.code.startsWith("release_test_")) return null;
    const neu = error.details?.["kandidat"];
    if (error.code === "release_test_stale" && typeof neu === "string" && neu !== "") {
        return [standGewechselt(kandidat, neu)];
    }
    const grund = error.details?.["grund"];
    const saetze = formProblems(error);
    if (typeof grund === "string" && grund.trim() !== "")
        saetze.push({ key: "admin.umgebungen.releaseTest.abgewiesenGrund", params: { grund: grund.trim() } });
    return saetze;
}

/**
 * Wie oft die Sicht neu geladen wird, solange etwas läuft oder wartet (Millisekunden); sonst gar nicht. Ein Bau des Testpakets und ein Auftrag, der
 * noch keinen Lauf hat, öfter.
 */
export function ladeTakt(sicht: ReleaseTestSicht | null): number | null {
    if (!releaseTestBeschaeftigt(sicht)) return null;
    if (sicht?.lauf?.zustand === "laeuft") return 30_000;
    return sicht?.start?.zustand === "baut" || (sicht?.auftrag ?? null) !== null ? 10_000 : 30_000;
}

/**
 * Eine Dauer, grob: unter einer Stunde in Minuten, darüber Stunden und Minuten; ab zehn Minuten auf fünf gerundet („etwa“).
 * In den Einheiten der Sprache der Seite.
 */
export function dauerGrob(ms: number, sprache: string): string {
    let minuten = Math.max(1, Math.round(ms / 60_000));
    if (minuten >= 10) minuten = Math.round(minuten / 5) * 5;
    const stunden = Math.floor(minuten / 60);
    const rest = minuten % 60;
    const einheit = (wert: number, unit: "hour" | "minute"): string =>
        new Intl.NumberFormat(sprache, { style: "unit", unit, unitDisplay: "short" }).format(wert);
    if (stunden === 0) return einheit(minuten, "minute");
    return rest === 0 ? einheit(stunden, "hour") : `${einheit(stunden, "hour")} ${einheit(rest, "minute")}`;
}

type Uebersetzer = (key: MessageKey, params?: Record<string, number | string>) => string;

/** Der Name eines Schrittes in der Sprache der Seite; die Browserteile tragen ihre Nummer. */
export function schrittName(id: string, t: Uebersetzer): string {
    const browser = /^browser-(\d)$/u.exec(id);
    if (browser?.[1] !== undefined) return t("admin.umgebungen.releaseTest.schritt.browser", { n: browser[1] });
    return t(`admin.umgebungen.releaseTest.schritt.${id}` as MessageKey);
}

/**
 * Der Name eines Teils für Menschen: „Alle Tests“ für Vitest, „Browser 2 von 4 · Gebiete, Landschaften, Darstellung“ für einen Browserteil. Der Name
 * kommt aus der Tafel der Sprache (über die Kennung), nicht aus dem Starter: Der Starter nennt ihn deutsch.
 */
export function teilBezeichnung(id: string, t: Uebersetzer): string {
    if (/^browser-\d$/u.test(id))
        return `${schrittName(id, t)} · ${t(`admin.umgebungen.releaseTest.teil.${id}` as MessageKey)}`;
    return schrittName(id, t);
}

/** Die Bereiche eines Teils in der Sprache der Seite, mit Komma verbunden. */
export function bereicheText(teil: Pick<ReleaseTestTeil, "bereiche">, t: Uebersetzer): string {
    return teil.bereiche.map((b) => t(`admin.umgebungen.releaseTest.bereich.${b}` as MessageKey)).join(", ");
}

/** Die Zahl der Fälle eines Teils als Satzteil („Fälle: 453“, geschätzt „Fälle: ≈ 453“); `null`, wenn sie nicht bekannt ist. */
export function faelleText(teil: Pick<ReleaseTestTeil, "faelle" | "faelleSchaetzung">, t: Uebersetzer): string | null {
    if (teil.faelle === undefined) return null;
    const key =
        teil.faelleSchaetzung === true
            ? "admin.umgebungen.releaseTest.teile.faelleSchaetzung"
            : "admin.umgebungen.releaseTest.teile.faelle";
    return t(key as MessageKey, { n: teil.faelle });
}

/** Eine Zeile zu einem Browserteil für den Bericht zum Kopieren: Name, Zustand, Zahl der Fälle und, was rot war. */
export function teilZeile(teil: ReleaseTestTeil, t: Uebersetzer): string {
    const stuecke = [t(`admin.umgebungen.releaseTest.teile.zustand.${teil.zustand}` as MessageKey)];
    if (teil.uebernommen) stuecke.push(t("admin.umgebungen.releaseTest.teile.uebernommen"));
    const faelle = faelleText(teil, t);
    if (faelle !== null) stuecke.push(faelle);
    if (teil.rot !== undefined && teil.rot > 0)
        stuecke.push(t("admin.umgebungen.releaseTest.teile.rot", { n: teil.rot }));
    if (teil.grund !== undefined) stuecke.push(teil.grund);
    return `- ${teilBezeichnung(teil.id, t)}: ${stuecke.join(" · ")}`;
}

/** Der Satz zur Wiederholung: was sie übernahm und was neu lief, oder warum sie nichts übernahm. */
export function wiederholungText(w: NonNullable<ReleaseTestLauf["wiederholung"]>, t: Uebersetzer): string {
    const namen = (ids: readonly string[]): string =>
        ids.map((id) => (id === "voll" ? schrittName("tests", t) : teilBezeichnung(id, t))).join(", ");
    if (w.uebernommen.length === 0)
        return t("admin.umgebungen.releaseTest.wiederholung.nichts", { grund: w.grund ?? "–" });
    return t("admin.umgebungen.releaseTest.wiederholung.uebernommen", {
        uebernommen: namen(w.uebernommen),
        neu: w.neu.length === 0 ? "–" : namen(w.neu),
    });
}

/**
 * Der Bericht zu einem roten oder abgebrochenen Test als Text für die Zwischenablage: genau das, was die Karte zeigt, mit Stand, Zeitpunkten und dem
 * Ort des Ergebnisordners (für die vollständigen Berichte). Der Starter hat Zugangsdaten schon entfernt. `null`, wenn es keinen Bericht gibt.
 */
export function berichtText(sicht: ReleaseTestSicht | null, t: Uebersetzer): string | null {
    const lauf = sicht?.lauf;
    const fehler = lauf?.fehler;
    if (lauf === undefined || lauf === null || fehler === undefined) return null;
    const zeilen: string[] = [
        t("admin.umgebungen.releaseTest.bericht.titel", {
            zustand: t(`admin.umgebungen.releaseTest.zustandWort.${lauf.zustand}` as MessageKey),
        }),
    ];
    if (lauf.sha !== undefined) zeilen.push(t("admin.umgebungen.releaseTest.bericht.sha", { sha: lauf.sha }));
    zeilen.push(t("admin.umgebungen.releaseTest.bericht.zeiten", { start: lauf.start ?? "–", ende: lauf.ende ?? "–" }));
    if (fehler.schritt !== null)
        zeilen.push(t("admin.umgebungen.releaseTest.bericht.schritt", { schritt: schrittName(fehler.schritt, t) }));
    zeilen.push(t("admin.umgebungen.releaseTest.bericht.grund"), fehler.grund);
    if (lauf.teile !== undefined && lauf.teile.length > 0) {
        zeilen.push(t("admin.umgebungen.releaseTest.bericht.teile"));
        for (const teil of lauf.teile) zeilen.push(teilZeile(teil, t));
    }
    if (lauf.wiederholung !== undefined) zeilen.push(wiederholungText(lauf.wiederholung, t));
    if (fehler.faelle.length > 0) {
        zeilen.push(
            t("admin.umgebungen.releaseTest.bericht.faelle", { n: fehler.faelle.length, gesamt: fehler.faelleGesamt }),
        );
        for (const fall of fehler.faelle) {
            // Jeder Fall nennt seinen Teil, damit man bei mehreren roten Teilen sieht, wohin er gehört.
            const teil = fall.teil === undefined ? "" : `[${teilBezeichnung(fall.teil, t)}] `;
            zeilen.push(`- ${teil}${fall.datei}${fall.name === "" ? "" : ` › ${fall.name}`}`);
            for (const zeile of fall.meldung) zeilen.push(`    ${zeile}`);
        }
    }
    if (fehler.protokollEnde.length > 0) {
        zeilen.push(
            t("admin.umgebungen.releaseTest.bericht.protokoll", {
                schritt: fehler.schritt === null ? "–" : schrittName(fehler.schritt, t),
            }),
            ...fehler.protokollEnde,
        );
    }
    if (lauf.ordner !== undefined)
        zeilen.push(t("admin.umgebungen.releaseTest.bericht.ordner", { ordner: lauf.ordner }));
    return zeilen.join("\n");
}

export interface ReleaseTest {
    /** Der Stand vom Server; `null`, solange nichts gelesen ist oder die Route nicht antwortet (nicht lokal). */
    sicht: ShallowRef<ReleaseTestSicht | null>;
    /** Die Route antwortete beim letzten Mal nicht (nicht lokal, oder der Server ist nicht erreichbar). */
    abwesend: Ref<boolean>;
    busy: Ref<boolean>;
    problems: Ref<Phrase[]>;
    /**
     * Die Abweisung des letzten Versuchs, als Sätze für die rote Zeile oben in der Karte: ein Start, den der Server oder der Starter nicht annahm, oder ein Stand,
     * der sich seit dem Blick bewegt hat. Bleibt stehen, bis der nächste Versuch beginnt (nicht nach ein paar Sekunden, nicht beim Nachladen).
     */
    abweisung: Ref<Phrase[]>;
    /** Wann der letzte Versuch abgewiesen wurde (ms seit 1970), damit die rote Zeile sagt, dass sie neu ist; `null`: keine Abweisung. */
    abgewiesenAm: Ref<number | null>;
    /**
     * 🔴 Seit wann ein Start oder eine Wiederholung unterwegs ist (ms seit 1970; Vali 2026-10-25: „nicht klar, ob ich den button gedrückt habe“).
     * Solange er läuft, zeigt die Karte nur „Starte Lauf …“ statt des alten Laufs; nach einer Abweisung sofort `null`, nach der Quittung auch:
     * Dann steht der Auftrag in der Warteschlange da (WI-0248, Vali 2026-10-26).
     */
    versuch: Ref<number | null>;
    /** Wann zuletzt gelesen wurde (ms seit 1970); `null`: noch nie. */
    geladenAm: Ref<number | null>;
    /**
     * Der eine Bericht eines Laufs (WI-0248, `bericht.md`): alles, was rot ist, und was offen ist. Erst auf Nachfrage geladen (`seiteLaden`), denn er
     * kann groß sein; `null`, solange keiner geladen ist.
     */
    seite: ShallowRef<{ readonly commit: string; readonly stempel: string; readonly text: string } | null>;
    /** `laedt`, `fehlt` (kein Bericht für diesen Lauf) oder `null`. */
    seiteZustand: Ref<"laedt" | "fehlt" | null>;
    /** `stempel` unterscheidet zwei Läufe desselben Standes (Beginn oder Ende des Laufs): Ein neuer Lauf lädt neu. */
    seiteLaden: (commit: string, stempel?: string) => Promise<string | null>;
    laden: () => Promise<void>;
    starten: () => Promise<boolean>;
    /** „Volltest“ (WI-0264): erst der Schnelltest, dann alles; nur Bericht, keine Freigabe. Passkey wie beim Start. */
    volltest: () => Promise<boolean>;
    /** „Rote Teile wiederholen“: derselbe Stand, nur die roten oder fehlenden Teile laufen neu. */
    wiederholen: () => Promise<boolean>;
    abbrechen: () => Promise<boolean>;
}

export interface ReleaseTestDeps {
    fetcher?: Fetcher;
    /** Die Uhr; Tests setzen eine feste. */
    jetzt?: () => number;
}

export function createReleaseTest(deps: ReleaseTestDeps = {}): ReleaseTest {
    const sicht = shallowRef<ReleaseTestSicht | null>(null);
    const abwesend = ref(false);
    const busy = ref(false);
    const problems = ref<Phrase[]>([]);
    const abweisung = ref<Phrase[]>([]);
    const abgewiesenAm = ref<number | null>(null);
    const versuch = ref<number | null>(null);
    const geladenAm = ref<number | null>(null);
    const seite = shallowRef<{ readonly commit: string; readonly stempel: string; readonly text: string } | null>(null);
    const seiteZustand = ref<"laedt" | "fehlt" | null>(null);
    const jetzt = deps.jetzt ?? Date.now;

    /** Lädt den Bericht dieses Laufs (einmal je Stand, bis er sich ändert); gibt den Text zurück oder `null`, wenn es keinen gibt. */
    async function seiteLaden(commit: string, stempel = ""): Promise<string | null> {
        if (seite.value?.commit === commit && seite.value.stempel === stempel) return seite.value.text;
        seiteZustand.value = "laedt";
        try {
            const antwort = await getJson<unknown>(
                `${RELEASE_TEST_URL}/bericht?commit=${encodeURIComponent(commit)}`,
                deps.fetcher,
            );
            const wert = antwort as { commit?: unknown; text?: unknown };
            if (typeof wert === "object" && wert !== null && typeof wert.text === "string" && wert.commit === commit) {
                seite.value = { commit, stempel, text: wert.text };
                seiteZustand.value = null;
                return wert.text;
            }
        } catch {
            // ein fehlender Bericht ist kein Fehler der Karte
        }
        seiteZustand.value = "fehlt";
        return null;
    }

    /** Der Versuch endet mit einer Abweisung: die Sätze, ihre Zeit, und die Karte zeigt wieder, was der Server weiß. */
    function abgewiesen(saetze: Phrase[]): void {
        abweisung.value = saetze;
        abgewiesenAm.value = saetze.length > 0 || problems.value.length > 0 ? jetzt() : null;
        versuch.value = null;
    }
    let ladeLauf: Promise<void> | null = null;

    /** Eine Antwort, mit der die Karte rechnen kann; alles andere zählt wie keine. */
    const istSicht = (wert: unknown): wert is ReleaseTestSicht =>
        typeof wert === "object" &&
        wert !== null &&
        typeof (wert as { verfuegbar?: unknown }).verfuegbar === "boolean" &&
        "kandidat" in wert;

    function laden(): Promise<void> {
        // Gleichzeitige Fragen teilen sich eine.
        ladeLauf ??= (async () => {
            try {
                const antwort = await getJson<ReleaseTestSicht>(RELEASE_TEST_URL, deps.fetcher);
                if (istSicht(antwort)) {
                    sicht.value = antwort;
                    abwesend.value = false;
                    geladenAm.value = jetzt();
                } else {
                    abwesend.value = true;
                }
            } catch {
                abwesend.value = true;
            } finally {
                ladeLauf = null;
            }
        })();
        return ladeLauf;
    }

    /**
     * Liest den Stand unmittelbar vor einem Start frisch (`?frisch=1`: Notizen neu holen, nicht aus dem Gedächtnis des Servers). Die Antwort ersetzt die Sicht.
     * `null`, wenn sie sich nicht lesen ließ; dann entscheidet die Vorprüfung des Servers.
     */
    async function frischLesen(): Promise<ReleaseTestSicht | null> {
        try {
            const antwort = await getJson<ReleaseTestSicht>(`${RELEASE_TEST_URL}?frisch=1`, deps.fetcher);
            if (!istSicht(antwort)) return null;
            sicht.value = antwort;
            abwesend.value = false;
            geladenAm.value = jetzt();
            return antwort;
        } catch {
            return null;
        }
    }

    async function ausfuehren(
        weg: "starten" | "wiederholen" | "volltest" | "abbrechen",
        commit: string,
    ): Promise<boolean> {
        busy.value = true;
        problems.value = [];
        abweisung.value = [];
        abgewiesenAm.value = null;
        let ok = false;
        let gescheitert: unknown;
        try {
            const sende = (): Promise<OperationReceipt> =>
                postJson<OperationReceipt>(
                    `${RELEASE_TEST_URL}/${weg === "abbrechen" ? "abbrechen" : "starten"}`,
                    {
                        operationId: newOperationId(),
                        commit,
                        ...(weg === "wiederholen" ? { wiederholen: true } : {}),
                        ...(weg === "volltest" ? { volltest: true } : {}),
                    },
                    deps.fetcher,
                );
            // Starten, Volltest und Wiederholen fragen den Passkey (Stufe S), Abbrechen nicht.
            if (weg !== "abbrechen") await withConfirmation(sende, requestConfirmation);
            else await sende();
            ok = true;
        } catch (error) {
            gescheitert = error;
            problems.value = formProblems(error);
        } finally {
            busy.value = false;
        }
        await laden();
        // Die Abweisung erst nach dem Laden: Ein veralteter Stand nennt den jetzigen, und der steht erst in der frischen Sicht.
        if (gescheitert !== undefined) abgewiesen(abweisungVon(gescheitert, sicht.value?.kandidat ?? null) ?? []);
        // Die Quittung ist die Antwort: Der Auftrag steht jetzt in der Warteschlange, und die frische Sicht zeigt ihn.
        else versuch.value = null;
        return ok;
    }

    /**
     * Ein Start (oder eine Wiederholung) beginnt mit einem frischen Blick auf den Stand: Hat er sich seit der Anzeige bewegt, startet nichts, sondern die Karte
     * zeigt den neuen Stand und sagt es („Die Stage ist inzwischen auf <sha> – neu starten?“). Geht der Knopf inzwischen nicht mehr (es läuft schon etwas),
     * sagt die Karte auch das, statt stumm nichts zu tun.
     */
    async function startVersuch(weg: "starten" | "wiederholen" | "volltest", angezeigt: string): Promise<boolean> {
        busy.value = true;
        problems.value = [];
        abweisung.value = [];
        abgewiesenAm.value = null;
        versuch.value = jetzt();
        let frisch: ReleaseTestSicht | null;
        try {
            frisch = await frischLesen();
        } finally {
            busy.value = false;
        }
        if (frisch !== null) {
            const knopf =
                weg === "wiederholen"
                    ? releaseTestWiederholen(frisch)
                    : weg === "volltest"
                      ? releaseVolltestKnopf(frisch)
                      : releaseTestKnopf(frisch);
            if (knopf.commit !== null && knopf.commit !== angezeigt) {
                abgewiesen([standGewechselt(frisch.kandidat, knopf.commit)]);
                return false;
            }
            if (knopf.sperre !== null) {
                abgewiesen([{ key: `admin.umgebungen.releaseTest.sperre.${knopf.sperre}` as MessageKey }]);
                return false;
            }
            if (weg === "wiederholen" && !releaseTestWiederholen(frisch).sichtbar) {
                abgewiesen([]);
                return false;
            }
        }
        return ausfuehren(weg, angezeigt);
    }

    return {
        sicht,
        abwesend,
        busy,
        problems,
        abweisung,
        abgewiesenAm,
        versuch,
        geladenAm,
        seite,
        seiteZustand,
        seiteLaden,
        laden,
        starten: () => {
            const knopf = releaseTestKnopf(sicht.value);
            if (busy.value || knopf.sperre !== null || knopf.commit === null) return Promise.resolve(false);
            return startVersuch("starten", knopf.commit);
        },
        volltest: () => {
            const knopf = releaseVolltestKnopf(sicht.value);
            if (busy.value || knopf.sperre !== null || knopf.commit === null) return Promise.resolve(false);
            return startVersuch("volltest", knopf.commit);
        },
        wiederholen: () => {
            const knopf = releaseTestWiederholen(sicht.value);
            if (busy.value || !knopf.sichtbar || knopf.sperre !== null || knopf.commit === null)
                return Promise.resolve(false);
            return startVersuch("wiederholen", knopf.commit);
        },
        abbrechen: () => {
            const commit = abbrechenCommit(sicht.value);
            if (busy.value || commit === null) return Promise.resolve(false);
            return ausfuehren("abbrechen", commit);
        },
    };
}
