import { ref, type Ref } from "vue";
import {
    HOEHENMODELL_REGLER,
    type AdminHoehenmodell,
    type HoehenmodellEntwurf,
    type HoehenmodellFassung,
    type HoehenmodellMessung,
    type HoehenmodellReglerId,
    type OperationReceipt,
} from "@avesmaps3d/shared";
import { formatDecimal, isMessageKey, locale, t, type MessageKey } from "../i18n/i18n";
import { relativeTime } from "../i18n/relative-time";
import { ApiFailure, getJson, newOperationId, postJson, type Fetcher } from "./api";
import {
    createReadConfirmation,
    neededConfirmation,
    requestConfirmation,
    withConfirmation,
    type Need,
    type ReadConfirmation,
} from "./bestaetigen";
import { grundProblem } from "./betriebszustand";
import { formProblems, type Phrase } from "./formular";
import { dateiName, datei, neu, offen, werteAus, type Felder } from "./hoehenmodell-test";
import type { ActionResult } from "./verwaltung";

/**
 * Der Eintrag „Höhenmodell“ der Systemsteuerung (WI-0127 SYS-13, SYS-0001 §9c, Entscheide §9c.11 und §9c.12; Blatt
 * `review/wi-0127/sys-13-blatt-1.png`). Was die Oberfläche rechnet, steht hier; wie es aussieht, in `verwaltung-hoehenmodell.vue`.
 *
 * - **Gültig:** eingestellt gegen wirksam wie im Betriebszustand, die Höhenlinien, die laufende Kette und „↺ Zurück auf Fassung N“.
 * - **Fassungen und Entwürfe** in Legacys Listenform mit Kreis (○ Entwurf · ◐ gemessen beziehungsweise nicht abgenommen · ● abgenommen).
 *   Aktivieren, Zurück und Abnehmen fragen an der Stelle nach dem Grund und danach nach dem Passkey (Frage 3 B); Messen und Verwerfen
 *   gehen mit Stufe V. Eine gewählte Zeile zeigt darunter ihre Werte.
 * - **Neuer Entwurf** aus der gewählten Fassung: nur die freigegebenen Regler (Frage 2 „A plus“), leer heißt unverändert.
 * - Kein Kanal zum Browser: Solange die Kette rechnet oder eine Messung wartet oder läuft, sieht der Eintrag alle paar Sekunden nach.
 */

export const NACHSEHEN_MS = 5000;

export type Frage =
    | { art: "waehlen"; version: number }
    | { art: "zurueck"; version: number }
    | { art: "neuRechnen"; version: number }
    | { art: "abnehmen"; version: number }
    | { art: "verwerfen"; draft: string };

/** Was an den Werten von „19 (Test)“ gerade getippt ist (WI-0240; Rechnung in `hoehenmodell-test.ts`). */
export interface TestFormular {
    felder: Felder;
    grund: string;
    /** Der gewählte Gebirgstyp der Presets (V1 „Typ wählen“). */
    typ: string;
    /** Die gewählte Kachel je Bereich (Gelände, Feinraster, Gebirgsform, Landschaften); ohne Wahl die erste. */
    kacheln: Partial<Record<string, string>>;
}

/** Wo eine Antwort hingehört: an die Fassung, den Entwurf, den Rückweg oder das Formular. */
export type Ort = string;

export const ortVon = (frage: Frage): Ort =>
    frage.art === "verwerfen"
        ? `entwurf:${frage.draft}`
        : frage.art === "zurueck"
          ? "zurueck"
          : frage.art === "neuRechnen"
            ? "neu-rechnen"
            : `fassung:${String(frage.version)}`;

/** Die gewählte Zeile: eine Fassung oder ein Entwurf. */
export type Zeile = { art: "fassung"; version: number } | { art: "entwurf"; id: string };

const zeit = (iso: string, now: Date): string => relativeTime(new Date(iso), now, locale.value, "zeitpunkt");
const nachschlagen = (prefix: string, value: string): string => {
    const key = `${prefix}.${value}`;
    return isMessageKey(key) ? t(key) : value;
};

export const reglerName = (id: string): string => nachschlagen("admin.terrain.regler", id);
export const artName = (kind: string): string => nachschlagen("status.kind", kind);
export const landschaftName = (art: string): string => nachschlagen("landscape.type", art);
export const zahl = (value: number | null): string => (value === null ? "–" : formatDecimal(value, 4));
/** Eine Änderung in Schritt mit Vorzeichen: „+12“, „−3“, „0“. */
export const schritt = (value: number | null): string =>
    value === null ? "–" : value > 0 ? `+${formatDecimal(value, 1)}` : value < 0 ? `−${formatDecimal(-value, 1)}` : "0";

/**
 * Die Nummer einer Fassung, wie sie in „Fassung {n}“ steht: „18“, die offene auf dieser Umgebung „19 (Test)“ (WI-0240; Betreiber
 * 2026-10-19: „ergänz denen namen der 19 mit (Test)“). Ob sie offen ist, sagt der Server (`test` fehlt auf Production und ohne offene
 * Fassung). Als Nummer, nicht als Name: Die Tafeln beugen „Fassung“ (polnisch „do wersji {n}“).
 */
export const fassungNummer = (stand: AdminHoehenmodell, n: number): string =>
    stand.test?.version === n ? t("admin.terrain.test.short", { n }) : String(n);

/** Die Fassung mit dieser Nummer (aus der Antwort). */
export const fassung = (stand: AdminHoehenmodell, version: number): HoehenmodellFassung | undefined =>
    stand.fassungen.find((entry) => entry.version === version);

/** Der Zustand rechts an der Karte „Gültig“: aktuell, rechnet, wartet, weicht ab oder unbekannt. */
export function gueltigZustand(stand: AdminHoehenmodell): { text: string; ton: "erfolg" | "ruhe" | "warnung" } {
    if (stand.kette !== null) {
        return stand.kette.state === "RUNNING"
            ? { text: t("admin.terrain.state.rechnet"), ton: "ruhe" }
            : { text: t("admin.terrain.state.wartet"), ton: "ruhe" };
    }
    if (stand.wirksam.version === null) return { text: t("admin.terrain.state.unbekannt"), ton: "warnung" };
    return stand.wirksam.version === stand.eingestellt.version
        ? { text: t("admin.terrain.state.aktuell"), ton: "erfolg" }
        : { text: t("admin.terrain.state.abweichend"), ton: "warnung" };
}

/** Die Feldzeilen der Karte „Gültig“. */
export function gueltigFelder(
    stand: AdminHoehenmodell,
    now: Date,
): { id: string; name: string; wert: string; ton: "erfolg" | "ruhe" | "warnung" | null }[] {
    const e = stand.eingestellt;
    const teile = [
        e.seit === null ? null : t("admin.terrain.since", { time: zeit(e.seit, now) }),
        e.wer,
        e.grund === null ? null : t("admin.system.quoted", { text: e.grund }),
    ].filter((part): part is string => part !== null && part !== "");
    const eingestellt =
        e.quelle === "datei"
            ? `${t("admin.terrain.version", { n: fassungNummer(stand, e.version) })} · ${t("admin.terrain.fromFile")}`
            : [t("admin.terrain.version", { n: fassungNummer(stand, e.version) }), ...teile].join(" · ");
    const w = stand.wirksam;
    // Die offene Fassung nennt die Revision ihrer Werte, mit der der Master gerechnet ist (WI-0240).
    const revision = w.version !== null && stand.test?.version === w.version ? stand.test.gerechnet : null;
    const wirksam =
        w.version === null
            ? w.gerechnetAm === null
                ? t("admin.terrain.effectiveNone")
                : t("admin.terrain.effectiveUnknown")
            : t(w.vorlaeufig ? "admin.terrain.effectiveProvisional" : "admin.terrain.effective", {
                  n:
                      revision === null
                          ? fassungNummer(stand, w.version)
                          : t("admin.terrain.test.shortRevision", { n: w.version, r: revision }),
                  time: w.gerechnetAm === null ? "" : zeit(w.gerechnetAm, now),
              });
    const kette = stand.kette;
    const linien =
        kette?.art === "display_heights"
            ? t("admin.terrain.contoursDrawing")
            : kette !== null
              ? t("admin.terrain.contoursAfter")
              : w.version === null
                ? t("admin.terrain.contoursUnknown")
                : t("admin.terrain.contoursFit", { n: fassungNummer(stand, w.version) });
    return [
        { id: "eingestellt", name: t("admin.terrain.field.configured"), wert: eingestellt, ton: null },
        {
            id: "wirksam",
            name: t("admin.terrain.field.effective"),
            wert: wirksam,
            ton:
                w.version === null
                    ? "warnung"
                    : w.version === e.version
                      ? "erfolg"
                      : kette === null
                        ? "warnung"
                        : "ruhe",
        },
        {
            id: "hoehenlinien",
            name: t("admin.terrain.field.contours"),
            wert: linien,
            ton: kette !== null ? "ruhe" : w.version === null ? "warnung" : "erfolg",
        },
    ];
}

/** Was die laufende Kette gerade tut, als Satz; `null` ohne Kette. */
export function ketteSatz(stand: AdminHoehenmodell): string | null {
    const kette = stand.kette;
    if (kette === null) return null;
    const art = artName(kette.art);
    if (kette.state === "RUNNING") {
        const teile = [
            art,
            kette.phase,
            kette.progress === null ? null : `${String(Math.round(kette.progress * 100))} %`,
        ];
        return t("admin.terrain.chainRunning", { what: teile.filter((part) => part !== null).join(" · ") });
    }
    const warum = kette.waitReason === null ? null : nachschlagen("status.wait", kette.waitReason);
    return [t("admin.terrain.chainQueued", { what: art }), warum].filter((part) => part !== null).join(" ");
}

/**
 * Der Name einer Fassung in der Liste: „Fassung 18 · FastScape mit regionaler Isostasie“. Das Verfahren folgt aus der Art der
 * Rückverteilung, nicht aus der Nummer: Stream Power nach Braun & Willett 2013 (FastScape) in jeder Fassung, der Abtrag kartenweit
 * zurück (globale Massenbilanz) oder im Umkreis (regionale Isostasie, `apps/server/src/terrain/domain/uplift.ts`).
 */
export const fassungName = (entry: HoehenmodellFassung, stand?: AdminHoehenmodell): string =>
    t("admin.terrain.versionNamed", {
        n: stand === undefined ? entry.version : fassungNummer(stand, entry.version),
        modell: t(entry.regional ? "admin.terrain.model.regional" : "admin.terrain.model.global"),
    });

/** Die Unterzeile einer Fassung: Rückverteilung, Abnahme. */
export function fassungUnter(entry: HoehenmodellFassung, now: Date): string {
    const verteilung = entry.regional
        ? t("admin.terrain.regional", {
              radius: zahl(entry.regler["radius"] ?? null),
              saturation: zahl(entry.regler["saturation"] ?? null),
          })
        : t("admin.terrain.global");
    const abnahme =
        entry.abnahme !== null
            ? t("admin.terrain.acceptedAt", { time: zeit(entry.abnahme.am, now) })
            : entry.inDatei
              ? t("admin.terrain.acceptedFile")
              : t("admin.terrain.notAccepted");
    return `${verteilung} · ${abnahme}`;
}

export const fassungWas = (entry: HoehenmodellFassung): string =>
    t(entry.regional ? "admin.terrain.whatRegional" : "admin.terrain.whatGlobal");

/** „Sättigung 12 statt 10 · Grundhöhe 320 statt 300“. */
export function aenderungenText(entwurf: HoehenmodellEntwurf, basis: HoehenmodellFassung | undefined): string {
    return Object.entries(entwurf.aenderungen)
        .map(([id, neu]) =>
            t("admin.terrain.change", { name: reglerName(id), neu: zahl(neu), alt: zahl(basis?.regler[id] ?? null) }),
        )
        .join(" · ");
}

export function entwurfUnter(entwurf: HoehenmodellEntwurf, basis: HoehenmodellFassung | undefined, now: Date): string {
    return [
        aenderungenText(entwurf, basis),
        t("admin.terrain.createdAt", { time: zeit(entwurf.angelegt, now) }),
        entwurf.wer,
        t("admin.system.quoted", { text: entwurf.grund }),
    ]
        .filter((part): part is string => part !== null && part !== "")
        .join(" · ");
}

/** Der Satz zur Messung eines Entwurfs: nicht gemessen, wartet, läuft, das Ergebnis oder der Fehler. */
export function messungSatz(messung: HoehenmodellMessung | null): { text: string; ton: "leise" | "gut" | "warnung" } {
    if (messung === null) return { text: t("admin.terrain.notMeasured"), ton: "leise" };
    if (messung.state === "QUEUED") return { text: t("admin.terrain.measureQueued"), ton: "leise" };
    if (messung.state === "RUNNING") {
        const teile = [
            messung.phase,
            messung.progress === null ? null : `${String(Math.round(messung.progress * 100))} %`,
        ];
        return {
            text: t("admin.terrain.measureRunning", { what: teile.filter((part) => part !== null).join(" · ") }),
            ton: "leise",
        };
    }
    if (messung.state !== "SUCCEEDED" || messung.ergebnis === null) {
        return { text: t("admin.terrain.measureFailed", { error: messung.fehler ?? messung.state }), ton: "warnung" };
    }
    const r = messung.ergebnis as {
        land?: { typisch?: number | null; mittel?: number | null };
        tiefland?: { typisch?: number | null };
        gebirge?: { typisch?: number | null };
        hoechster?: { vorher?: number; nachher?: number };
        stufenWechsel?: number | null;
    };
    return {
        text: t("admin.terrain.measured", {
            land: schritt(r.land?.typisch ?? null),
            mittel: schritt(r.land?.mittel ?? null),
            tiefland: schritt(r.tiefland?.typisch ?? null),
            gebirge: schritt(r.gebirge?.typisch ?? null),
            vorher: zahl(r.hoechster?.vorher ?? null),
            nachher: zahl(r.hoechster?.nachher ?? null),
            stufen: r.stufenWechsel == null ? "–" : formatDecimal(r.stufenWechsel * 100, 1),
        }),
        ton: "gut",
    };
}

/** Der eine Satz über dem Eintrag, wenn das Recht fehlt; die Knöpfe ruhen dann ohne eigenen Satz. */
export const nurLesenSatz = (): string =>
    t("admin.terrain.readOnly", { recht: t("auth.capability.manage_terrain_recipe") });

/**
 * Warum „Aktivieren“ an einer Fassung ruht, als Satz; `""` ruht ohne Satz (das Recht fehlt: der Satz steht einmal oben; die Fassung gilt
 * schon: das sagt die Pille); `undefined`, wenn es geht.
 */
export function aktivierenSperre(
    stand: AdminHoehenmodell,
    entry: HoehenmodellFassung,
    darf: boolean,
): string | undefined {
    if (!darf) return "";
    if (stand.eingestellt.version === entry.version) return "";
    if (stand.profil === "abgenommen" && !entry.inDatei) return t("admin.terrain.notAcceptedHere");
    return undefined;
}

/**
 * Warum „Gelände neu rechnen“ ruht (Betreiber 2026-10-17, Topographie F8): ohne Recht still (der Satz steht oben), und solange schon eine
 * Geländerechnung wartet, mit Satz. Läuft eine, geht der Knopf: Die neue wartet dahinter und sieht den neueren Stand.
 */
export function neuRechnenSperre(stand: AdminHoehenmodell, darf: boolean): string | undefined {
    if (!darf) return "";
    if (stand.kette?.state === "QUEUED") return t("admin.terrain.error.chainWaiting");
    return undefined;
}

/** Warum „Messen“ ruht; `undefined`, wenn es geht. */
export function messenSperre(
    stand: AdminHoehenmodell,
    entwurf: HoehenmodellEntwurf,
    darf: boolean,
): string | undefined {
    if (!darf) return "";
    if (stand.profil !== "voll") return t("admin.terrain.measureNotHere");
    if (entwurf.messung?.state === "QUEUED" || entwurf.messung?.state === "RUNNING") return "";
    return undefined;
}

// --- Das Formular „Neuer Entwurf“ -------------------------------------------------------------------------------------------------

export interface EntwurfFormular {
    basis: number;
    /** Je Regler der getippte Text; leer heißt unverändert. */
    werte: Record<HoehenmodellReglerId, string>;
    grund: string;
}

export function leeresFormular(basis: number): EntwurfFormular {
    return {
        basis,
        werte: Object.fromEntries(HOEHENMODELL_REGLER.map((regler) => [regler.id, ""])) as Record<
            HoehenmodellReglerId,
            string
        >,
        grund: "",
    };
}

/** Eine getippte Zahl, mit Komma oder Punkt; `null` heißt keine Zahl. */
export function leseZahl(text: string): number | null {
    const clean = text.trim().replace(/\s/gu, "").replace(",", ".");
    if (clean === "" || !/^-?\d+(\.\d+)?$/u.test(clean)) return null;
    return Number(clean);
}

/**
 * Die Änderungen des Formulars gegenüber der Basis und die Probleme je Regler (dieselben Grenzen wie der Server; das ganze Rezept prüft
 * er danach noch einmal). Ein Wert gleich der Basis gilt als unverändert.
 */
export function formularAenderungen(
    formular: EntwurfFormular,
    basis: HoehenmodellFassung,
): { aenderungen: Record<string, number>; probleme: Partial<Record<HoehenmodellReglerId, string>> } {
    const aenderungen: Record<string, number> = {};
    const probleme: Partial<Record<HoehenmodellReglerId, string>> = {};
    for (const regler of HOEHENMODELL_REGLER) {
        const text = formular.werte[regler.id];
        if (text.trim() === "") continue;
        if (regler.nurRegional && !basis.regional) {
            probleme[regler.id] = t("admin.terrain.invalid.regional");
            continue;
        }
        const value = leseZahl(text);
        if (value === null) probleme[regler.id] = t("admin.terrain.invalid.number");
        else if (regler.ganz && !Number.isInteger(value)) probleme[regler.id] = t("admin.terrain.invalid.whole");
        else if (value < regler.min || (regler.max !== null && value > regler.max)) {
            probleme[regler.id] =
                regler.max === null
                    ? t("admin.terrain.invalid.min", { min: zahl(regler.min) })
                    : t("admin.terrain.invalid.range", { min: zahl(regler.min), max: zahl(regler.max) });
        } else if (value !== basis.regler[regler.id]) aenderungen[regler.id] = value;
    }
    return { aenderungen, probleme };
}

/** Warum „Anlegen“ ruht, als Schlüssel; `undefined`, wenn es geht. */
export function formularSperre(formular: EntwurfFormular, basis: HoehenmodellFassung): MessageKey | undefined {
    const { aenderungen, probleme } = formularAenderungen(formular, basis);
    if (Object.keys(probleme).length > 0) return "admin.terrain.invalid.fix";
    if (Object.keys(aenderungen).length === 0) return "admin.terrain.invalid.noChange";
    return grundProblem(formular.grund, true);
}

// --- Zustand des Eintrags ----------------------------------------------------------------------------------------------------------

export interface HoehenmodellDeps {
    fetcher?: Fetcher;
    ask?: (need: Need) => Promise<boolean>;
    reads?: ReadConfirmation;
    setTimer?: (callback: () => void, ms: number) => unknown;
    clearTimer?: (handle: unknown) => void;
}

export interface Hoehenmodell {
    stand: Ref<AdminHoehenmodell | null>;
    loading: Ref<boolean>;
    loadProblems: Ref<Phrase[]>;
    unconfirmed: Ref<Need | null>;
    confirmAgain(): void;
    zeile: Ref<Zeile | null>;
    frage: Ref<Frage | null>;
    grund: Ref<string>;
    formular: Ref<EntwurfFormular | null>;
    busy: Ref<boolean>;
    ergebnis: Ref<{ ort: Ort; result: ActionResult } | null>;
    load(): Promise<void>;
    waehle(zeile: Zeile): void;
    ask(frage: Frage): void;
    cancel(): void;
    confirm(): Promise<ActionResult>;
    neuerEntwurf(basis: number): void;
    verwirfFormular(): void;
    anlegen(): Promise<ActionResult>;
    messen(draft: string): Promise<ActionResult>;
    follow(on: boolean): void;
    test: Ref<TestFormular>;
    /** Einen Wert tippen; gleich dem gespeicherten fällt er aus den Feldern. */
    testTippe(key: string, text: string): void;
    /** Mehrere Werte auf einmal tippen (ein Regler der Gebirgs-Presets stellt mehrere zusammen); der Grund bleibt, wie er ist. */
    testTippeMehrere(werte: Readonly<Record<string, string>>): void;
    testVerwerfen(): void;
    /** Die Werte einer Revision des Verlaufs eintragen (gespeichert wird danach mit Grund). */
    testTrageEin(werte: Readonly<Record<string, string>>, grund: string): void;
    testSpeichern(): Promise<ActionResult>;
    /** Den Stand als Datei holen (`19.json`), für den Weg ins Repository. */
    testStand(): Promise<{ name: string; inhalt: string } | null>;
}

const BASIS = "/api/admin/system/hoehenmodell";

/** Ist gerade etwas unterwegs, auf das der Eintrag wartet (Kette oder Messung)? */
export function geschiehtEtwas(stand: AdminHoehenmodell | null): boolean {
    if (stand === null) return false;
    return (
        stand.kette !== null ||
        stand.entwuerfe.some((entry) => entry.messung?.state === "QUEUED" || entry.messung?.state === "RUNNING")
    );
}

export function createHoehenmodell(deps: HoehenmodellDeps = {}): Hoehenmodell {
    const stand = ref<AdminHoehenmodell | null>(null);
    const loading = ref(false);
    const loadProblems = ref<Phrase[]>([]);
    const unconfirmed = ref<Need | null>(null);
    const zeile = ref<Zeile | null>(null);
    const frage = ref<Frage | null>(null);
    const grund = ref("");
    const formular = ref<EntwurfFormular | null>(null);
    const busy = ref(false);
    const ergebnis = ref<{ ort: Ort; result: ActionResult } | null>(null);
    const test = ref<TestFormular>({ felder: {}, grund: "", typ: "kammgebirge", kacheln: {} });
    const ask = deps.ask ?? requestConfirmation;
    const reads = deps.reads ?? createReadConfirmation(ask);
    reads.onOffer(() => (unconfirmed.value === null ? undefined : load()));
    const setTimer = deps.setTimer ?? ((callback: () => void, ms: number) => setTimeout(callback, ms));
    const clearTimer = deps.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
    let ticket = 0;
    let following = false;
    let timer: unknown = undefined;

    function planen(): void {
        if (timer !== undefined) clearTimer(timer);
        timer = undefined;
        if (!following || unconfirmed.value !== null || !geschiehtEtwas(stand.value)) return;
        timer = setTimer(() => {
            timer = undefined;
            void load();
        }, NACHSEHEN_MS);
    }

    async function load(): Promise<void> {
        const mine = ++ticket;
        loading.value = true;
        try {
            const body = await withConfirmation(() => getJson<AdminHoehenmodell>(BASIS, deps.fetcher), reads.ask);
            if (mine !== ticket) return;
            stand.value = body;
            // Die gewählte Zeile bleibt, solange es sie gibt; sonst die gültige Fassung.
            const z = zeile.value;
            const gibt =
                z !== null &&
                (z.art === "fassung"
                    ? body.fassungen.some((entry) => entry.version === z.version)
                    : body.entwuerfe.some((entry) => entry.id === z.id));
            if (!gibt) zeile.value = { art: "fassung", version: body.eingestellt.version };
            loadProblems.value = [];
            unconfirmed.value = null;
        } catch (error) {
            if (mine === ticket) {
                loadProblems.value = formProblems(error);
                unconfirmed.value = neededConfirmation(error);
            }
        } finally {
            if (mine === ticket) {
                loading.value = false;
                planen();
            }
        }
    }

    function send(path: string, body: Record<string, unknown>): Promise<OperationReceipt> {
        const sent = { operationId: newOperationId(), ...body };
        return withConfirmation(() => postJson<OperationReceipt>(`${BASIS}${path}`, sent, deps.fetcher), ask);
    }

    function problems(error: unknown): ActionResult {
        const failure = error instanceof ApiFailure ? error : undefined;
        if (failure?.code === "reauth_required" || failure?.code === "assurance_required") {
            reads.decline();
            return { ok: false, problems: [{ key: "admin.system.error.notConfirmed" }] };
        }
        if (failure?.code === "edit_conflict") {
            const by = (failure.details?.["changedBy"] as { displayName?: string } | undefined)?.displayName ?? null;
            const at = typeof failure.details?.["changedAt"] === "string" ? failure.details["changedAt"] : null;
            return { ok: false, problems: formProblems(error), conflict: { by, at } };
        }
        return { ok: false, problems: formProblems(error) };
    }

    async function run(ort: Ort, action: () => Promise<unknown>): Promise<ActionResult> {
        busy.value = true;
        ergebnis.value = null;
        let result: ActionResult;
        try {
            await action();
            result = { ok: true, problems: [] };
        } catch (error) {
            result = problems(error);
        }
        if (!result.ok) ergebnis.value = { ort, result };
        busy.value = false;
        await load();
        return result;
    }

    async function confirm(): Promise<ActionResult> {
        const offen = frage.value;
        const s = stand.value;
        if (offen === null || s === null || busy.value) return { ok: false, problems: [] };
        const pflicht = offen.art !== "verwerfen" && offen.art !== "neuRechnen";
        const fehlt = pflicht ? grundProblem(grund.value, true) : undefined;
        if (fehlt !== undefined) return { ok: false, problems: [{ key: fehlt }] };
        const reason = grund.value.trim();
        const baseRevision = s.eingestellt.revision;
        const result = await run(ortVon(offen), () => {
            switch (offen.art) {
                case "waehlen":
                    return send("/waehlen", { baseRevision, version: offen.version, reason });
                case "zurueck":
                    return send("/zurueck", { baseRevision, reason });
                case "neuRechnen":
                    return send("/neu-rechnen", {});
                case "abnehmen":
                    return send("/abnehmen", { version: offen.version, reason });
                case "verwerfen":
                    return send("/entwurf/verwerfen", { draft: offen.draft });
            }
        });
        // Wie im Betriebszustand: Ein Konflikt schließt die Frage (der neue Stand steht da); sonst bleibt der Grund stehen.
        if (result.ok || result.conflict !== undefined) {
            frage.value = null;
            grund.value = "";
        }
        return result;
    }

    async function anlegen(): Promise<ActionResult> {
        const f = formular.value;
        const s = stand.value;
        const basis = f === null || s === null ? undefined : fassung(s, f.basis);
        if (f === null || basis === undefined || busy.value) return { ok: false, problems: [] };
        const sperre = formularSperre(f, basis);
        if (sperre !== undefined) return { ok: false, problems: [{ key: sperre }] };
        const { aenderungen } = formularAenderungen(f, basis);
        const result = await run("formular", () =>
            send("/entwurf", { basis: f.basis, aenderungen, reason: f.grund.trim() }),
        );
        if (result.ok) {
            formular.value = null;
            const neu = stand.value?.entwuerfe[0];
            if (neu !== undefined) zeile.value = { art: "entwurf", id: neu.id };
        }
        return result;
    }

    async function testSpeichern(): Promise<ActionResult> {
        const s = stand.value?.test;
        const f = test.value;
        if (s === undefined || busy.value) return { ok: false, problems: [] };
        const fehlt = grundProblem(f.grund, true);
        if (offen(s, f.felder).length === 0 || fehlt !== undefined)
            return { ok: false, problems: fehlt === undefined ? [] : [{ key: fehlt }] };
        const werte = werteAus(neu(s, f.felder), datei(s));
        const result = await run("test", () =>
            send("/test", { baseRevision: s.revision, werte, reason: f.grund.trim() }),
        );
        if (result.ok || result.conflict !== undefined) test.value = { ...test.value, felder: {}, grund: "" };
        return result;
    }

    return {
        stand,
        loading,
        loadProblems,
        unconfirmed,
        confirmAgain: () => reads.offer(),
        zeile,
        frage,
        grund,
        formular,
        busy,
        ergebnis,
        load,
        waehle(next): void {
            zeile.value = next;
        },
        ask(next): void {
            frage.value = next;
            grund.value = "";
            ergebnis.value = null;
        },
        cancel(): void {
            frage.value = null;
            grund.value = "";
        },
        confirm,
        neuerEntwurf(basis): void {
            formular.value = leeresFormular(basis);
            frage.value = null;
            ergebnis.value = null;
        },
        verwirfFormular(): void {
            formular.value = null;
        },
        anlegen,
        messen: (draft) => run(`entwurf:${draft}`, () => send("/entwurf/messen", { draft })),
        follow(on): void {
            following = on;
            planen();
        },
        test,
        testTippe(key, text): void {
            const s = stand.value?.test;
            if (s === undefined || s.gesperrt) return;
            // Getippt bleibt stehen, wie es dasteht; gleich dem gespeicherten Wert zählt es nur nicht als Änderung (`offen`).
            test.value = { ...test.value, felder: { ...test.value.felder, [key]: text } };
        },
        testTippeMehrere(werte): void {
            const s = stand.value?.test;
            if (s === undefined || s.gesperrt) return;
            test.value = { ...test.value, felder: { ...test.value.felder, ...werte } };
        },
        testVerwerfen(): void {
            test.value = { ...test.value, felder: {}, grund: "" };
        },
        testTrageEin(werte, grund): void {
            const s = stand.value?.test;
            if (s === undefined || s.gesperrt) return;
            test.value = { ...test.value, felder: { ...test.value.felder, ...werte }, grund };
        },
        testSpeichern,
        async testStand() {
            const s = stand.value?.test;
            if (s === undefined) return null;
            try {
                const inhalt = await withConfirmation(
                    () => getJson<unknown>(`${BASIS}/test/stand`, deps.fetcher),
                    reads.ask,
                );
                return {
                    name: dateiName(s.version),
                    inhalt: `${JSON.stringify(inhalt, null, 4)}
`,
                };
            } catch (error) {
                ergebnis.value = { ort: "test", result: problems(error) };
                return null;
            }
        },
    };
}
