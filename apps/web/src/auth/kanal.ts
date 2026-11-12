import { computed, ref, type ComputedRef, type Ref } from "vue";
import {
    KANAL_AUFBEWAHRUNG_TAGE,
    KANAL_URL,
    type KanalBericht,
    type KanalBerichte,
    type KanalBildGroesse,
    type KanalKategorie,
    type KanalListe,
    type KanalPrioritaet,
    type KanalReiter,
    type KanalStatus,
    type KanalVorgang,
    type KanalWer,
    type KanalZaehler,
    type KanalZeile,
    type OperationReceipt,
} from "@avesmaps3d/shared";
import { formatNumber, isMessageKey, locale, t } from "../i18n/i18n";
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
import { formProblems, type Phrase } from "./formular";
import { bildVorbereiten } from "./kanal-bild";

/**
 * Der Betreiber-Kanal in der Oberfläche (WI-0124, KANAL-0001 §8, Mockup `review/wi-0124-mockup/`): Was die Ansicht rechnet, steht hier;
 * wie sie aussieht, in `verwaltung-kanal.vue` und seinen Teilen. Lesen und Schreiben über `/api/kanal` (Stufe V, kein Passkey je
 * Handlung, W9). Die Regeln prüft der Server; die Oberfläche zeigt nur, was er erlaubt.
 */

export const KATEGORIE_ZUERST: Record<KanalKategorie, "claudio" | "claudia"> = {
    feinjustierung: "claudio",
    bug: "claudio",
    stoerung: "claudio",
    editor_optimierung: "claudio",
    performance: "claudio",
    idee: "claudio",
    umbau: "claudia",
    karteninhalt: "claudia",
    nutzerfrage: "claudio",
};

const nachschlagen = (key: string, fallback: string): string => (isMessageKey(key) ? t(key) : fallback);

export const kategorieName = (kategorie: string): string => nachschlagen(`kanal.kategorie.${kategorie}`, kategorie);
export const prioritaetName = (prioritaet: string): string =>
    nachschlagen(`kanal.prioritaet.${prioritaet}`, prioritaet);
export const statusName = (status: string): string => nachschlagen(`kanal.status.${status}`, status);
/** Der Zustand in Liste und Kopf: Was an die Community ging (WI-0297), heißt „an Community“ statt „akzeptiert“. */
export const zustandName = (v: { status: string; abschluss: string | null }): string =>
    v.abschluss === "an_community" ? t("kanal.status.anCommunity") : statusName(v.status);
export const stationName = (station: string): string => nachschlagen(`kanal.station.${station}`, station);
export const kontextName = (schluessel: string): string => nachschlagen(`kanal.contextKey.${schluessel}`, schluessel);

/** Der Ton des Punkts vor dem Status (Liste und Kopf). */
export function statusTon(status: KanalStatus): "neu" | "arbeit" | "abnahme" | "fertig" {
    // Zu sichten wartet wie „zu akzeptieren“ auf einen Betreiber (WI-0255 Paket 2).
    if (status === "zur_abnahme" || status === "zu_sichten") return "abnahme";
    if (status === "abgenommen") return "fertig";
    if (status === "neu" || status === "angenommen") return "neu";
    return "arbeit";
}

/** Der Ton der Priorität als Pille (dringend rot, hoch Pille, sonst leise). */
export function prioritaetTon(prioritaet: KanalPrioritaet): "gefahr" | "warnung" | "neutral" {
    if (prioritaet === "dringend") return "gefahr";
    if (prioritaet === "hoch") return "warnung";
    return "neutral";
}

/** Der Name, der für einen Eintrag steht: Person, Claudio oder Claudia. */
/** Wer aus Discord meldete (WI-0255 Paket 2): „Discord · <Anzeigename>“; der Name von Discord, keine Person der App. */
export const discordName = (name: string): string => `Discord · ${name}`;

export const werName = (wer: KanalWer | null): string =>
    wer === null
        ? "—"
        : wer.art === "person"
          ? wer.name
          : wer.art === "discord"
            ? discordName(wer.name)
            : wer.art === "claudio"
              ? "Claudio"
              : "Claudia";

export const zeit = (iso: string, now: Date): string => relativeTime(new Date(iso), now, locale.value, "zeitpunkt");

/**
 * Ab wann die Routine als „holt gerade nicht ab“ gilt: zwei Takte zu 30 Minuten ohne Abholung (Koordination 2026-10-11, Go für A). Ein
 * Satz, der einen 30-Minuten-Takt verspricht, während die Routine nicht läuft, ist ein Fehler (Arbeitsanweisung WI-0124 §6).
 */
export const ABHOLUNG_FRISCH_MS = 60 * 60_000;

/** Holt Claudio gerade ab? `zuletzt` ist `agent.zuletzt_abgeholt`, `null` heißt nie. */
export interface Abholung {
    laeuft: boolean;
    zuletzt: string | null;
}

/** Der Stand aus der letzten Abholung; `undefined` (noch nicht geladen) ergibt `null`: Dann sagt die Oberfläche nichts dazu. */
export function abholung(zuletzt: string | null | undefined, now: Date): Abholung | null {
    if (zuletzt === undefined) return null;
    return { laeuft: zuletzt !== null && now.getTime() - Date.parse(zuletzt) <= ABHOLUNG_FRISCH_MS, zuletzt };
}

/** Der Satz, wenn Claudio nicht abholt: „Claudio holt gerade nicht ab, zuletzt vor 3 Std.“ oder „Claudio hat noch nie abgeholt.“ */
export function abholSatz(stand: Abholung, now: Date): string {
    if (stand.zuletzt === null) return t("kanal.pickup.never");
    // „vor 3 Std.“ bringt seinen Punkt mit; der Satz bekommt dann keinen zweiten.
    return t("kanal.pickup.stale", {
        time: relativeTime(new Date(stand.zuletzt), now, locale.value, "abstand"),
    }).replace(/\.\.$/u, ".");
}

/** „Bis wann bleiben Meldung und Bilder“ in der Spalte Aufbewahrung des Archivs. */
export function aufbewahrung(zeile: KanalZeile, now: Date): string | null {
    if (zeile.abgelaufenAt !== null) return t("kanal.archive.deleted", { time: zeit(zeile.abgelaufenAt, now) });
    if (zeile.aufbewahrtBis === null) return null;
    return t("kanal.archive.until", {
        time: zeit(zeile.aufbewahrtBis, now),
        days: formatNumber(KANAL_AUFBEWAHRUNG_TAGE, 0),
    });
}

/** Die Geräteangabe, die beim Melden mitgeht („Rechner · Firefox 131 · 1440 × 900“); ohne Namen, ohne Kennung. */
export function geraetAngabe(
    nav: Pick<Navigator, "userAgent"> = navigator,
    fenster: Pick<Window, "innerWidth" | "innerHeight"> = window,
): string {
    const ua = nav.userAgent;
    const art = /Mobi|Android|iPhone|iPad/u.test(ua) ? t("kanal.device.phone") : t("kanal.device.desktop");
    const browser =
        /Edg\/(\d+)/u.exec(ua)?.[1] !== undefined
            ? `Edge ${/Edg\/(\d+)/u.exec(ua)![1]!}`
            : /Firefox\/(\d+)/u.exec(ua)?.[1] !== undefined
              ? `Firefox ${/Firefox\/(\d+)/u.exec(ua)![1]!}`
              : /Chrome\/(\d+)/u.exec(ua)?.[1] !== undefined
                ? `Chrome ${/Chrome\/(\d+)/u.exec(ua)![1]!}`
                : /Version\/(\d+).*Safari/u.exec(ua)?.[1] !== undefined
                  ? `Safari ${/Version\/(\d+).*Safari/u.exec(ua)![1]!}`
                  : t("kanal.device.browser");
    return `${art} · ${browser} · ${String(fenster.innerWidth)} × ${String(fenster.innerHeight)}`;
}

/** Eine gerenderte Fassung eines Bildes (nie das Original); die Route prüft das Recht. */
export const bildUrl = (id: string, groesse: KanalBildGroesse): string =>
    `${KANAL_URL}/bilder/${encodeURIComponent(id)}?groesse=${groesse}`;

/** Höchstens so viele Bilder wählt das Meldeformular auf einmal. */
export const KANAL_BILDER_JE_MELDUNG = 6;

/** Die Fachcodes der Routen als eigene Sätze (die Oberfläche zeigt nie den Text des Servers, ADR-0018). */
const KANAL_FEHLER = {
    payload_too_large: "kanal.image.tooLarge",
    unsupported_media_type: "kanal.image.notImage",
    media_file_rejected: "kanal.image.rejected",
    media_storage_unavailable: "kanal.image.noStorage",
    kanal_conflict: "kanal.error.conflict",
    kanal_transition: "kanal.error.transition",
    kanal_invalid: "kanal.error.invalid",
    kanal_rate: "kanal.error.rate",
    kanal_not_found: "kanal.error.notFound",
    kanal_forbidden: "kanal.error.forbidden",
    kanal_community_aus: "kanal.error.communityAus",
    kanal_community_ausfall: "kanal.error.communityAusfall",
} as const;

export interface MeldenEingabe {
    kategorie: KanalKategorie;
    prioritaet: KanalPrioritaet;
    titel: string;
    nachricht: string;
    schritte: string;
    ansicht: string;
    geraet: string;
}

export interface KanalDeps {
    fetcher?: Fetcher;
    reads?: ReadConfirmation;
}

export interface Kanal {
    reiter: Ref<KanalReiter>;
    liste: Ref<KanalListe | null>;
    vorgang: Ref<KanalVorgang | null>;
    zaehler: Ref<number | null>;
    loading: Ref<boolean>;
    loadProblems: Ref<Phrase[]>;
    unconfirmed: Ref<Need | null>;
    busy: Ref<string | null>;
    /** Was eine Handlung zuletzt verhinderte, als Sätze. */
    fehler: Ref<Phrase[]>;
    /**
     * Was zuletzt durchging: ein angelegter Vorgang oder eine gesendete Nachricht, mit der Erwartung (Befund Stage-Release 5c37bc88: ohne
     * Bestätigung sendete der Betreiber doppelt; Arbeitsanweisung WI-0124 §6). Steht bis zur nächsten Handlung oder bis zurück zur Liste.
     */
    bestaetigung: Ref<{ art: "angelegt" | "nachricht"; ops: string } | null>;
    /** Die Gruppe „Fix-Berichte“ im Protokoll (KANAL-0001 §3.1) und die Kennung, ab der „ältere zeigen“ weiterblättert. */
    berichte: Ref<KanalBericht[]>;
    berichteWeiter: Ref<number | null>;
    /** Der Vorgang, den der Kanal beim nächsten Öffnen zeigt (die OPS-ID in den Fix-Berichten). */
    ziel: Ref<string | null>;
    confirmAgain(): void;
    ladeListe(reiter?: KanalReiter): Promise<void>;
    ladeZaehler(): Promise<void>;
    oeffne(ops: string): Promise<void>;
    /** Die Fix-Berichte; `q` ist die Suche des Protokolls (im Server), „ältere zeigen“ blättert mit derselben. */
    ladeBerichte(aelter?: boolean, q?: string): Promise<void>;
    /** Holt Claudio gerade ab? Aus Liste und Zähler; neu gerechnet beim Öffnen und mit `takt()`. `null`: noch nicht bekannt. */
    abholung: ComputedRef<Abholung | null>;
    /** Die Uhr, nach der „vor 3 Std.“ und der Stand gerechnet werden. */
    jetzt: Ref<Date>;
    /** Neu rechnen: die Uhr stellen und die Zahl samt letzter Abholung holen (beim Öffnen und im Takt des Fensters). */
    takt(): Promise<void>;
    /** Die Suche der Vorgänge (Freitext, im Server); sie gilt in allen drei Reitern. */
    suche: Ref<string>;
    suchen(text: string): Promise<void>;
    /** Zurück zur Liste: kein Vorgang mehr, keine Sätze von vorhin. */
    schliesse(): void;
    /** Den Vorgang aus den Fix-Berichten einmal abholen. */
    nimmZiel(): string | null;
    /** Legt den Vorgang an und hängt danach die Bilder an seine OPS-Nummer; die Bestätigung kommt, wenn alles durch ist. */
    melden(eingabe: MeldenEingabe, bilder?: readonly File[]): Promise<string | null>;
    nachricht(text: string): Promise<boolean>;
    abnehmen(): Promise<boolean>;
    /** Einen Vorgang aus Discord freigeben (WI-0255 Paket 2): aus „zu sichten“ nach „neu“, an Claudio oder Claudia. */
    sichten(an: "claudio" | "claudia"): Promise<boolean>;
    /** Einen Vorgang aus Discord an die Redaktion in Production weiterleiten (WI-0297): danach „an Community“, für die Agenten verdeckt. */
    anCommunity(): Promise<boolean>;
    /** Selbst abschließen, aus jedem offenen Status (Migration 0127): `erledigt` ohne, `abgebrochen` mit Begründung. */
    abschliessen(art: "erledigt" | "abgebrochen", begruendung?: string): Promise<boolean>;
    wiederOeffnen(kommentar: string): Promise<boolean>;
    loeschen(): Promise<boolean>;
    bildEntfernen(id: string): Promise<boolean>;
    /** Ein Bild anhängen: im Browser verkleinern und ohne Metadaten neu kodieren, dann hochladen (KANAL-0001 §6.1). */
    bildAnhaengen(ops: string, datei: File): Promise<boolean>;
}

export function createKanal(deps: KanalDeps = {}): Kanal {
    const reiter = ref<KanalReiter>("offen");
    const liste = ref<KanalListe | null>(null);
    const vorgang = ref<KanalVorgang | null>(null);
    const zaehler = ref<number | null>(null);
    const loading = ref(false);
    const loadProblems = ref<Phrase[]>([]);
    const unconfirmed = ref<Need | null>(null);
    const busy = ref<string | null>(null);
    const fehler = ref<Phrase[]>([]);
    const bestaetigung = ref<{ art: "angelegt" | "nachricht"; ops: string } | null>(null);
    const berichte = ref<KanalBericht[]>([]);
    const berichteWeiter = ref<number | null>(null);
    const ziel = ref<string | null>(null);
    const suche = ref("");
    let berichteSuche = "";
    const abgeholt = ref<KanalZaehler["zuletztAbgeholt"] | null>(null);
    const jetzt = ref(new Date());
    const abholStand = computed(() =>
        abholung(abgeholt.value === null ? undefined : abgeholt.value.claudio, jetzt.value),
    );
    const reads = deps.reads ?? createReadConfirmation(requestConfirmation);
    let ticket = 0;
    // „Erneut bestätigen“ lädt, was auf die Bestätigung wartete: den offenen Vorgang oder die Liste.
    reads.onOffer(() =>
        unconfirmed.value === null ? undefined : vorgang.value !== null ? oeffne(vorgang.value.ops) : ladeListe(),
    );

    async function lies<T>(url: string, setze: (body: T) => void): Promise<void> {
        const mine = ++ticket;
        loading.value = true;
        try {
            const body = await withConfirmation(() => getJson<T>(url, deps.fetcher), reads.ask);
            if (mine !== ticket) return;
            setze(body);
            loadProblems.value = [];
            unconfirmed.value = null;
        } catch (error) {
            if (mine === ticket) {
                loadProblems.value = formProblems(error);
                unconfirmed.value = neededConfirmation(error);
            }
        } finally {
            if (mine === ticket) loading.value = false;
        }
    }

    async function ladeListe(neu?: KanalReiter): Promise<void> {
        if (neu !== undefined) reiter.value = neu;
        const q = suche.value === "" ? "" : `&q=${encodeURIComponent(suche.value)}`;
        await lies<KanalListe>(`${KANAL_URL}/vorgaenge?reiter=${reiter.value}${q}`, (body) => {
            liste.value = body;
            zaehler.value = body.zaehler.abnahme;
            abgeholt.value = body.zuletztAbgeholt;
            jetzt.value = new Date();
        });
    }

    async function ladeZaehler(): Promise<void> {
        try {
            const antwort = await getJson<KanalZaehler>(`${KANAL_URL}/zaehler`, deps.fetcher);
            zaehler.value = antwort.abnahme;
            // Ein älterer Server kennt die Abholung hier noch nicht (die Zahl kam zuerst); dann bleibt, was die Liste wusste.
            if (antwort.zuletztAbgeholt !== undefined) abgeholt.value = antwort.zuletztAbgeholt;
            jetzt.value = new Date();
        } catch {
            // Die Zahl in der Schiene ist eine Zugabe; fehlt sie, steht nichts da.
        }
    }

    async function oeffne(ops: string): Promise<void> {
        await lies<KanalVorgang>(`${KANAL_URL}/vorgaenge/${encodeURIComponent(ops)}`, (body) => {
            vorgang.value = body;
        });
    }

    async function ladeBerichte(aelter = false, q = berichteSuche): Promise<void> {
        const vor = aelter ? berichteWeiter.value : null;
        if (!aelter) berichteSuche = q.trim();
        const query = new URLSearchParams();
        if (vor !== null) query.set("vor", String(vor));
        if (berichteSuche !== "") query.set("q", berichteSuche);
        const rest = query.toString();
        await lies<KanalBerichte>(`${KANAL_URL}/aenderungen${rest === "" ? "" : `?${rest}`}`, (body) => {
            berichte.value = vor === null ? body.berichte : [...berichte.value, ...body.berichte];
            berichteWeiter.value = body.weiter;
        });
    }

    /** Eine Handlung: sendet, lädt den Vorgang und die Zahl neu; `false` mit Sätzen in `fehler`. */
    async function handle(name: string, url: string, body: Record<string, unknown>): Promise<OperationReceipt | null> {
        if (busy.value !== null) return null;
        busy.value = name;
        fehler.value = [];
        bestaetigung.value = null;
        try {
            return await withConfirmation(
                () => postJson<OperationReceipt>(url, { operationId: newOperationId(), ...body }, deps.fetcher),
                requestConfirmation,
            );
        } catch (error) {
            fehler.value =
                error instanceof ApiFailure && error.code in KANAL_FEHLER
                    ? [{ key: KANAL_FEHLER[error.code as keyof typeof KANAL_FEHLER] }]
                    : formProblems(error);
            return null;
        } finally {
            busy.value = null;
        }
    }

    async function bildAnhaengen(ops: string, datei: File): Promise<boolean> {
        if (busy.value !== null) return false;
        const vorbereitet = await bildVorbereiten(datei);
        if (!vorbereitet.ok) {
            fehler.value = [
                { key: vorbereitet.grund === "zu_gross" ? "kanal.image.tooLarge" : "kanal.image.notImage" },
            ];
            return false;
        }
        const ok =
            (await handle("bild", `${KANAL_URL}/vorgaenge/${encodeURIComponent(ops)}/bilder`, {
                file: vorbereitet.datei,
            })) !== null;
        if (ok && vorgang.value?.ops === ops) await nachHandlung();
        return ok;
    }

    async function nachHandlung(): Promise<void> {
        const ops = vorgang.value?.ops;
        await Promise.all([ops === undefined ? Promise.resolve() : oeffne(ops), ladeZaehler()]);
    }

    return {
        reiter,
        liste,
        vorgang,
        zaehler,
        loading,
        loadProblems,
        unconfirmed,
        busy,
        fehler,
        bestaetigung,
        berichte,
        berichteWeiter,
        ziel,
        abholung: abholStand,
        jetzt,
        async takt() {
            jetzt.value = new Date();
            await ladeZaehler();
        },
        suche,
        async suchen(text) {
            suche.value = text.trim();
            await ladeListe();
        },
        confirmAgain: () => reads.offer(),
        ladeListe,
        ladeZaehler,
        oeffne,
        ladeBerichte,
        schliesse() {
            vorgang.value = null;
            fehler.value = [];
            bestaetigung.value = null;
        },
        nimmZiel() {
            const ops = ziel.value;
            ziel.value = null;
            return ops;
        },
        async melden(eingabe, bilder = []) {
            const kontext: Record<string, string> = {};
            if (eingabe.ansicht.trim() !== "") kontext["ansicht"] = eingabe.ansicht.trim();
            if (eingabe.geraet.trim() !== "") kontext["geraet"] = eingabe.geraet.trim();
            const receipt = await handle("melden", `${KANAL_URL}/vorgaenge`, {
                kategorie: eingabe.kategorie,
                prioritaet: eingabe.prioritaet,
                titel: eingabe.titel.trim(),
                nachricht: eingabe.nachricht.trim(),
                ...(eingabe.schritte.trim() === "" ? {} : { schritte: eingabe.schritte.trim() }),
                kontext,
            });
            const ops = receipt?.affected[0]?.id ?? null;
            if (ops === null) return null;
            await oeffne(ops);
            await ladeZaehler();
            // Ein Bild, das scheitert, hält die übrigen an; der Vorgang steht trotzdem, sein Satz steht neben dem Fehler.
            for (const datei of bilder) if (!(await bildAnhaengen(ops, datei))) break;
            bestaetigung.value = { art: "angelegt", ops };
            return ops;
        },
        async nachricht(text) {
            const v = vorgang.value;
            if (v === null) return false;
            const ok =
                (await handle("nachricht", `${KANAL_URL}/vorgaenge/${v.ops}/nachricht`, { text: text.trim() })) !==
                null;
            if (ok) {
                await nachHandlung();
                bestaetigung.value = { art: "nachricht", ops: v.ops };
            }
            return ok;
        },
        async abnehmen() {
            const v = vorgang.value;
            if (v === null) return false;
            const ok =
                (await handle("abnehmen", `${KANAL_URL}/vorgaenge/${v.ops}/abnehmen`, { baseRevision: v.revision })) !==
                null;
            await nachHandlung();
            return ok;
        },
        async sichten(an) {
            const v = vorgang.value;
            if (v === null) return false;
            const ok =
                (await handle("sichten", `${KANAL_URL}/vorgaenge/${v.ops}/sichten`, {
                    baseRevision: v.revision,
                    an,
                })) !== null;
            await nachHandlung();
            return ok;
        },
        async anCommunity() {
            const v = vorgang.value;
            if (v === null) return false;
            // Derselbe Schlüssel wie die zwei Freigaben: Solange einer läuft, sind alle drei Knöpfe gesperrt.
            const ok =
                (await handle("sichten", `${KANAL_URL}/vorgaenge/${v.ops}/an-community`, {
                    baseRevision: v.revision,
                })) !== null;
            await nachHandlung();
            return ok;
        },
        async abschliessen(art, begruendung) {
            const v = vorgang.value;
            if (v === null) return false;
            const text = begruendung?.trim() ?? "";
            const ok =
                (await handle("abschliessen", `${KANAL_URL}/vorgaenge/${v.ops}/abschliessen`, {
                    baseRevision: v.revision,
                    art,
                    ...(text === "" ? {} : { begruendung: text }),
                })) !== null;
            await nachHandlung();
            return ok;
        },
        async wiederOeffnen(kommentar) {
            const v = vorgang.value;
            if (v === null) return false;
            const ok =
                (await handle("wieder", `${KANAL_URL}/vorgaenge/${v.ops}/wieder-oeffnen`, {
                    baseRevision: v.revision,
                    kommentar: kommentar.trim(),
                })) !== null;
            await nachHandlung();
            return ok;
        },
        async loeschen() {
            const v = vorgang.value;
            if (v === null) return false;
            const ok = (await handle("loeschen", `${KANAL_URL}/vorgaenge/${v.ops}/loeschen`, {})) !== null;
            await nachHandlung();
            return ok;
        },
        async bildEntfernen(id) {
            const ok = (await handle("bild", `${KANAL_URL}/bilder/${id}/entfernen`, {})) !== null;
            await nachHandlung();
            return ok;
        },
        bildAnhaengen,
    };
}

/** Der Wert rechts in der Schiene: nur die Zahl, damit der Name daneben ganz bleibt; keine: nichts. */
export function schienenWert(zahl: number | null): string | undefined {
    return zahl === null || zahl === 0 ? undefined : String(zahl);
}
