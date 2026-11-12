<script setup lang="ts">
/**
 * Das Fenster „Regelvorschläge“ (WI-0253 §24; Mockup `review/wi-0253/wikisync-mockup.html`, Vali 2026-10-25: „Kandidaten und Regelvorschläge je in einem eigenen Fenster“): Die Regeln, die aus den
 * Verbreitungs-, Vorkommens-, Herkunfts- und Regionenangaben der Vorkommen im Wiki abgeleitet werden, mit Auswahl je Vorschlag. Recht `apply_wiki_lore_rules` (ab Editor), Passkey.
 *
 * - **Die Ableitung rechnet der Server** (Auftrag `wiki_vorschau`, Bereich `vorkommen`, nur lesend); das Fenster liest das Protokoll des jüngsten Laufs und rechnet nichts. „Neu ableiten“ reiht diesen Auftrag ein.
 *   Hat sich die Begriffstafel seit dem Lauf geändert, sagt das Fenster „veraltet“ und gibt keine Übernahme frei, bis neu abgeleitet ist.
 * - **Vorgewählt ist, was vollständig und wählbar ist.** Alles andere (unvollständig, negiert, mehrdeutig, wartend, Regel der Redaktion) bleibt eine Anzeige mit Grund; ein Teilvorschlag ohne Regel ist nicht wählbar.
 *   Übernommen wird nur, was ausgewählt ist, und nie über eine Regel der Redaktion. Jede Übernahme lässt sich zurücknehmen (Liste oben unter den offenen Flächen).
 * - **Kreise:** ● vorgewählt, ◐ wählbar, aber erst nach Prüfung, ○ nicht wählbar. Der Kreis steht neben dem Kästchen; die Legende unter der Liste nennt die Wörter.
 * - **Nichts wird geraten:** Treffer sind „unbekannt“, nicht null (die Auswertung der Regeln gegen die Flächen ist ein eigenes Arbeitspaket). Eine Fläche, die es noch nicht gibt, trägt „!“ und „wartet“ (F4).
 * - **Offene Flächen (§25):** Gibt es zu einem wartenden Artikel eine Fläche gleichen Namens ohne Wiki-Schlüssel, weist ein Knopf (oben in der Übersicht und an der Bedingung) ihr den Artikel zu, nach einer Rückfrage;
 *   Recht `edit_map_objects`, in Production mit Passkey. Danach ist die Liste veraltet, bis neu abgeleitet ist; eine Zuweisung aus diesem Fenster lässt sich zurücknehmen.
 */
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, useId, useTemplateRef, watch } from "vue";
import {
    WIKISYNC_REGEL_ARTEN,
    WIKISYNC_REGEL_STATUS,
    WIKISYNC_REGEL_TYPEN,
    type WikisyncRegelAbfrage,
    type WikisyncRegelFlaechen,
    type WikisyncRegelListe,
    type WikisyncRegelOffeneFlaeche,
    type WikisyncRegelVorschlag,
} from "@avesmaps3d/shared";
import type { FilterAbschnitt, FilterWahl } from "../controls/avm-filterknopf";
import AvmBestaetigung from "../controls/avm-bestaetigung.vue";
import AvmFilterknopf from "../controls/avm-filterknopf.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKaestchen from "../controls/avm-kaestchen.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmKreis from "../controls/avm-kreis.vue";
import AvmListenleiste from "../controls/avm-listenleiste.vue";
import AvmPille from "../controls/avm-pille.vue";
import AvmSperrgrund from "../controls/avm-sperrgrund.vue";
import AvmFenster from "../fenster/avm-fenster.vue";
import { t } from "../i18n/i18n";
import VerwaltungMeldung from "../auth/verwaltung-meldung.vue";
import type { Phrase } from "../auth/formular";
import type { ActionResult } from "../auth/verwaltung";
import { entprellt } from "../system/entprellt";
import { landschaftMeldung } from "../landschaftseditor/landschaft-melde";
import { wikisyncProbleme, type Wikisync } from "./wikisync";
import WikisyncBegriffeFenster from "./wikisync-begriffe-fenster.vue";
import WikisyncInfo from "./wikisync-info.vue";
import WikisyncRegelDetail from "./wikisync-regel-detail.vue";
import WikisyncFlaechenUebersicht from "./wikisync-regel-flaechen.vue";
import {
    REGELN_KREIS_LEGENDE,
    TYP_TON,
    beziehungenText,
    regelArtName,
    regelStatusName,
    regelnKreisName,
    sperreName,
    typName,
    vorschlagKreis,
    vorschlagKurz,
} from "./wikisync-regeln-text";
import { hoereWikiSyncMeldung } from "./wikisync-melde";
import { anzahl, auftragSatz, auftragVon, datumText, weitereLadenText, zahl, zeitpunkt } from "./wikisync-text";

const SEITE = 100;

const offen = defineModel<boolean>("offen", { required: true });
const props = defineProps<{
    wikisync: Wikisync;
    /** Darf Regeln übernehmen (`apply_wiki_lore_rules`). */
    darf: boolean;
    /** Darf eine Übernahme zurücknehmen (`undo_wikisync_run`). */
    darfZurueck: boolean;
    /** Darf die Begriffstafel ändern (`manage_canon_tables`). */
    darfBegriffe: boolean;
    /** Darf einer Fläche einen Wiki-Artikel zuweisen (`edit_map_objects`). */
    darfFlaechen: boolean;
    rechtSatz: (recht: string) => string;
    umgebung: string;
}>();
const ws = props.wikisync;

const suche = ref("");
const q = entprellt(suche);
const wahl = ref<FilterWahl>({});
const liste = ref<WikisyncRegelListe | null>(null);
const zeilen = ref<WikisyncRegelVorschlag[]>([]);
const laedt = ref(false);
const probleme = ref<Phrase[]>([]);
const offenId = ref<number | null>(null);
const begriffeOffen = ref(false);
/** Die Auswahl über alle Seiten, nach Kennung des Vorschlags. Sie beginnt mit den vorgewählten des Laufs. */
const auswahl = shallowRef<ReadonlySet<number>>(new Set());
let auswahlLauf: number | null = null;
const frage = ref<
    | "uebernehmen"
    | { zurueck: number }
    | { zuweisen: WikisyncRegelOffeneFlaeche }
    | { flaecheZurueck: WikisyncRegelOffeneFlaeche }
    | null
>(null);
/** Die offenen Flächen mit Kandidat (§25), wie der Server sie aus dem Protokoll des Laufs und dem Stand der Karte liest. */
const flaechenListe = ref<WikisyncRegelFlaechen | null>(null);
const meldung = ref<string | null>(null);
const fehler = shallowRef<ActionResult | undefined>(undefined);
const stand = useTemplateRef<HTMLElement>("stand");
const grundId = useId();
let ticket = 0;

const jetzt = computed(() => {
    void ws.stand.value;
    return new Date();
});

// ── Laden ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
function abfrage(offset: number, limit: number): WikisyncRegelAbfrage {
    const a: { -readonly [K in keyof WikisyncRegelAbfrage]: WikisyncRegelAbfrage[K] } = { limit, offset };
    const art = wahl.value["art"]?.[0];
    const typ = wahl.value["typ"]?.[0];
    const status = wahl.value["status"]?.[0];
    if (art !== undefined) a.art = art as NonNullable<WikisyncRegelAbfrage["art"]>;
    if (typ !== undefined) a.typ = typ as NonNullable<WikisyncRegelAbfrage["typ"]>;
    if (status !== undefined) a.status = status as NonNullable<WikisyncRegelAbfrage["status"]>;
    if (q.value !== "") a.q = q.value.slice(0, 120);
    return a;
}

async function laden(neu: boolean): Promise<void> {
    const mine = ++ticket;
    laedt.value = true;
    try {
        const body = await ws.ladeRegeln(
            neu ? abfrage(0, Math.min(Math.max(zeilen.value.length, SEITE), 200)) : abfrage(zeilen.value.length, SEITE),
        );
        if (mine !== ticket) return;
        liste.value = body;
        zeilen.value = neu ? body.vorschlaege : [...zeilen.value, ...body.vorschlaege];
        // Die Auswahl beginnt mit den vorgewählten des Laufs; ein neuer Lauf beginnt neu.
        const lauf = body.lauf?.id ?? null;
        if (lauf !== auswahlLauf) {
            auswahlLauf = lauf;
            auswahl.value = new Set(body.vorgewaehlt);
        }
        probleme.value = [];
    } catch (error) {
        if (mine === ticket) probleme.value = wikisyncProbleme(error);
    } finally {
        if (mine === ticket) laedt.value = false;
    }
}

async function ladeFlaechen(): Promise<void> {
    try {
        flaechenListe.value = await ws.ladeRegelFlaechen();
    } catch (error) {
        probleme.value = wikisyncProbleme(error);
    }
}

watch(
    offen,
    (jetztOffen) => {
        if (!jetztOffen) return;
        wahl.value = {};
        suche.value = "";
        meldung.value = null;
        fehler.value = undefined;
        frage.value = null;
        offenId.value = null;
        zeilen.value = [];
        void laden(true);
        void ladeFlaechen();
    },
    { immediate: true },
);
// „Änderungen“ nahm eine Übernahme von Regelvorschlägen zurück (WI-0265 B8d): Die Liste liest neu, solange das Fenster offen ist.
const abmelden = hoereWikiSyncMeldung(() => {
    if (offen.value) {
        void laden(true);
        void ladeFlaechen();
    }
});
onBeforeUnmount(abmelden);
// „Änderungen“ nahm die Zuweisung eines Artikels an eine Fläche zurück (WI-0265 B8e): Die Quittung nennt die Fläche; die offenen Flächen lesen neu, solange das Fenster offen ist.
watch(landschaftMeldung, () => {
    if (offen.value) void ladeFlaechen();
});
watch([q, wahl], () => {
    if (!offen.value) return;
    zeilen.value = [];
    void laden(true);
});

/** Läuft die Ableitung (Auftrag `wiki_vorschau`)? Endet sie, liest das Fenster die neue Liste. */
const ableitung = computed(() => auftragVon(ws.stand.value, "wiki_vorschau"));
watch(
    () => ableitung.value !== undefined,
    (laeuft, lief) => {
        if (lief === true && !laeuft && offen.value) {
            zeilen.value = [];
            void laden(true);
            void ladeFlaechen();
        }
    },
);

// ── Filter ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const abschnitte = computed((): FilterAbschnitt[] => [
    {
        id: "art",
        titel: t("admin.wikisync.regeln.filter.art"),
        art: "eins",
        werte: WIKISYNC_REGEL_ARTEN.map((wert) => ({
            wert,
            text: regelArtName(wert),
            zahl: liste.value?.facetten.art[wert] ?? 0,
        })),
    },
    {
        id: "typ",
        titel: t("admin.wikisync.regeln.filter.typ"),
        art: "eins",
        werte: WIKISYNC_REGEL_TYPEN.map((wert) => ({
            wert,
            text: typName(wert),
            zahl: liste.value?.facetten.typ[wert] ?? 0,
        })),
    },
    {
        id: "status",
        titel: t("admin.wikisync.regeln.filter.status"),
        art: "eins",
        werte: WIKISYNC_REGEL_STATUS.map((wert) => ({
            wert,
            text: regelStatusName(wert),
            zahl: liste.value?.facetten.status[wert] ?? 0,
        })),
    },
]);
const gefiltert = computed(() => q.value !== "" || Object.values(wahl.value).some((werte) => (werte?.length ?? 0) > 0));
function setze(abschnitt: string, werte: string[]): void {
    wahl.value = { ...wahl.value, [abschnitt]: werte };
}

// ── Auswahl ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const waehlbareZeilen = computed(() => zeilen.value.filter((zeile) => zeile.waehlbar));
const gewaehltInZeilen = computed(() => waehlbareZeilen.value.filter((zeile) => auswahl.value.has(zeile.id)).length);
const alleGewaehlt = computed(
    () => waehlbareZeilen.value.length > 0 && gewaehltInZeilen.value === waehlbareZeilen.value.length,
);
const unbestimmt = computed(() => gewaehltInZeilen.value > 0 && !alleGewaehlt.value);
const anzahlGewaehlt = computed(() => auswahl.value.size);

function waehle(id: number, an: boolean): void {
    const kopie = new Set(auswahl.value);
    if (an) kopie.add(id);
    else kopie.delete(id);
    auswahl.value = kopie;
}
function waehleAlleGezeigten(an: boolean): void {
    const kopie = new Set(auswahl.value);
    for (const zeile of waehlbareZeilen.value) {
        if (an) kopie.add(zeile.id);
        else kopie.delete(zeile.id);
    }
    auswahl.value = kopie;
}
const waehleVorgewaehlte = (): void => {
    auswahl.value = new Set(liste.value?.vorgewaehlt ?? []);
};
const waehleKeine = (): void => {
    auswahl.value = new Set();
};

// ── Sperren und Texte ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const lauf = computed(() => liste.value?.lauf ?? null);
/** Es gibt noch keine Ableitung und keine läuft: Der Hinweis oben sagt es, die leere Liste darunter bliebe stumm. */
const ohneAbleitung = computed(() => liste.value !== null && lauf.value === null && ableitung.value === undefined);
const vorkommenGehoertWikisync = computed(
    () => ws.bereiche.value?.bereiche.find((eintrag) => eintrag.bereich === "vorkommen")?.angeschlossen === true,
);
const sperre = computed((): string | undefined => {
    if (!props.darf) return props.rechtSatz("apply_wiki_lore_rules");
    if (ws.bereiche.value !== null && !vorkommenGehoertWikisync.value) return t("admin.wikisync.regeln.sperre.legacy");
    if (lauf.value === null) return t("admin.wikisync.regeln.sperre.keinLauf");
    if (lauf.value.veraltet) return t("admin.wikisync.regeln.sperre.veraltet");
    if (lauf.value.flaechenGeaendert) return t("admin.wikisync.regeln.sperre.flaechenVeraltet");
    if (anzahlGewaehlt.value === 0) return t("admin.wikisync.regeln.sperre.nichtsGewaehlt");
    if (ws.busy.value !== null) return "";
    return undefined;
});
const ableitenSperre = computed((): string | undefined => {
    if (ableitung.value !== undefined) return t("admin.wikisync.fehler.vorschau_laeuft");
    if (ws.stand.value !== null && ws.stand.value.dump.datei === null) return t("admin.wikisync.dump.keiner");
    if (ws.busy.value !== null) return "";
    return undefined;
});
/** Warum „zuweisen“ und „zurücknehmen“ gerade nicht gehen: fehlendes Recht, oder eine andere Handlung ist unterwegs (dann ohne Satz). */
const flaechenSperre = computed((): string | undefined => {
    if (!props.darfFlaechen) return props.rechtSatz("edit_map_objects");
    if (ws.busy.value !== null) return "";
    return undefined;
});
const offeneFlaechen = computed(() => flaechenListe.value?.flaechen ?? []);
const fussHinweis = computed(() => {
    if (sperre.value !== undefined && sperre.value !== "" && anzahlGewaehlt.value > 0) return sperre.value;
    return t("admin.wikisync.regeln.fussAuswahl", {
        n: zahl(anzahlGewaehlt.value),
        m: zahl(liste.value?.vorgewaehlt.length ?? 0),
    });
});

const bilanz = computed(() => {
    const l = liste.value;
    if (l === null || l.lauf === null) return "";
    if (gefiltert.value)
        return t("admin.wikisync.regeln.bilanz.gefiltert", {
            treffer: zahl(l.gesamt),
            gesamt: zahl(l.zahlen?.vorgeschlagen ?? l.gesamt),
        });
    const z = l.zahlen;
    return [
        anzahl.vorschlaege(z?.vorgeschlagen ?? l.gesamt),
        t("admin.wikisync.regeln.bilanz.vorgewaehlt", { n: zahl(l.vorgewaehlt.length) }),
        ...((z?.wartend ?? 0) > 0 ? [t("admin.wikisync.regeln.bilanz.wartend", { n: zahl(z?.wartend ?? 0) })] : []),
        ...((z?.gleich ?? 0) > 0 ? [t("admin.wikisync.regeln.bilanz.gleich", { n: zahl(z?.gleich ?? 0) })] : []),
    ].join(" · ");
});

const laufZusatz = computed((): string | undefined => {
    const l = lauf.value;
    if (l === null) return undefined;
    return l.dumpStand === null ? undefined : t("admin.wikisync.regeln.zusatzStand", { datum: datumText(l.dumpStand) });
});

// ── Handlungen ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
function zeigeStand(): void {
    void nextTick(() => stand.value?.scrollIntoView({ block: "nearest" }));
}

async function ableiten(): Promise<void> {
    meldung.value = null;
    fehler.value = undefined;
    const ergebnis = await ws.vorschauVorkommen();
    if (!ergebnis.ok) {
        fehler.value = ergebnis;
        zeigeStand();
        return;
    }
    meldung.value = t("admin.wikisync.regeln.abgeleitetEingereiht");
    zeigeStand();
}

async function uebernehmen(): Promise<void> {
    const l = lauf.value;
    if (l === null || sperre.value !== undefined) return;
    const ids = [...auswahl.value];
    frage.value = null;
    meldung.value = null;
    fehler.value = undefined;
    const ergebnis = await ws.regelnUebernehmen(l.id, ids);
    if (!ergebnis.ok) fehler.value = ergebnis;
    else {
        meldung.value = t("admin.wikisync.regeln.uebernommen", { n: anzahl.vorschlaege(ids.length) });
        // Übernommen ist übernommen: Die Auswahl beginnt leer, damit ein zweiter Klick nicht dieselben Vorschläge noch einmal schickt.
        auswahl.value = new Set();
        if (ergebnis.problems.length > 0) fehler.value = ergebnis;
    }
    await laden(true);
    zeigeStand();
}

async function nimmZurueck(id: number): Promise<void> {
    frage.value = null;
    meldung.value = null;
    fehler.value = undefined;
    const ergebnis = await ws.regelnZuruecknehmen(id);
    if (!ergebnis.ok) fehler.value = ergebnis;
    else {
        meldung.value = t("admin.wikisync.regeln.zurueckgenommen");
        if (ergebnis.problems.length > 0) fehler.value = ergebnis;
    }
    await laden(true);
    zeigeStand();
}

function fragen(): void {
    frage.value = "uebernehmen";
    void nextTick(() => stand.value?.scrollIntoView({ block: "nearest" }));
}

/** Die Rückfrage zu einer Zuweisung oder Rücknahme: Sie steht oben unter den offenen Flächen, an der Stelle der übrigen Rückfragen und Meldungen. */
function fragenFlaeche(art: "zuweisen" | "flaecheZurueck", eintrag: WikisyncRegelOffeneFlaeche): void {
    meldung.value = null;
    fehler.value = undefined;
    frage.value = art === "zuweisen" ? { zuweisen: eintrag } : { flaecheZurueck: eintrag };
    zeigeStand();
}

async function weiseFlaecheZu(eintrag: WikisyncRegelOffeneFlaeche): Promise<void> {
    if (eintrag.kennung === null || flaechenSperre.value !== undefined) return;
    frage.value = null;
    meldung.value = null;
    fehler.value = undefined;
    const ergebnis = await ws.flaecheZuweisen(eintrag.kennung, eintrag.titel);
    if (!ergebnis.ok) fehler.value = ergebnis;
    else {
        meldung.value = t("admin.wikisync.regeln.flaechen.zugewiesen", { name: eintrag.name, titel: eintrag.titel });
        if (ergebnis.problems.length > 0) fehler.value = ergebnis;
    }
    await Promise.all([laden(true), ladeFlaechen()]);
    zeigeStand();
}

async function nimmFlaecheZurueck(eintrag: WikisyncRegelOffeneFlaeche): Promise<void> {
    if (eintrag.kennung === null || flaechenSperre.value !== undefined) return;
    frage.value = null;
    meldung.value = null;
    fehler.value = undefined;
    const ergebnis = await ws.flaecheZuruecknehmen(eintrag.kennung);
    if (!ergebnis.ok) fehler.value = ergebnis;
    else {
        meldung.value = t("admin.wikisync.regeln.flaechen.zurueckgenommen", { name: eintrag.name });
        if (ergebnis.problems.length > 0) fehler.value = ergebnis;
    }
    await Promise.all([laden(true), ladeFlaechen()]);
    zeigeStand();
}

const uebernahmen = computed(() => liste.value?.uebernahmen ?? []);
const zahlen = computed(() => liste.value?.zahlen ?? null);
</script>

<template>
    <AvmFenster
        v-model:offen="offen"
        bauart="werkzeug"
        breite="werkzeug"
        :titel="t('admin.wikisync.regeln.titel')"
        :zusatz="laufZusatz ?? t('admin.wikisync.regeln.zusatz')"
        testid="wsync-regeln-fenster"
    >
        <template #leiste>
            <AvmListenleiste
                v-model="suche"
                class="wsync-regeln__leiste"
                :platzhalter="t('admin.wikisync.regeln.suche')"
                :beschriftung="t('admin.wikisync.regeln.sucheName')"
                testid="wsync-regeln-leiste"
            >
                <AvmFilterknopf
                    :abschnitte="abschnitte"
                    :wahl="wahl"
                    testid="wsync-regeln-filter"
                    @setze="setze"
                    @loesen="wahl = {}"
                />
            </AvmListenleiste>
        </template>

        <div class="wsync-regeln" data-testid="wsync-regeln">
            <p class="wsync-regeln__satz">
                {{ t("admin.wikisync.regeln.satz") }}<WikisyncInfo :text="t('admin.wikisync.regeln.info')" />
            </p>
            <AvmHinweis v-if="probleme.length > 0" ton="gefahr" rolle="alert">
                <span v-for="problem in probleme" :key="problem.key">{{ t(problem.key, problem.params) }}</span>
            </AvmHinweis>

            <!-- Der Stand der Ableitung: läuft, fehlt, veraltet oder da -->
            <AvmHinweis v-if="ableitung !== undefined" ton="neutral" rolle="status" testid="wsync-regeln-laeuft">{{
                t("admin.wikisync.regeln.laeuft", { stand: auftragSatz(ableitung, jetzt) })
            }}</AvmHinweis>
            <AvmHinweis v-else-if="ohneAbleitung" ton="warnung" rolle="status" testid="wsync-regeln-kein-lauf">{{
                t("admin.wikisync.regeln.keinLauf")
            }}</AvmHinweis>
            <AvmHinweis
                v-else-if="lauf !== null && lauf.veraltet"
                ton="warnung"
                rolle="status"
                testid="wsync-regeln-veraltet"
                >{{ t("admin.wikisync.regeln.veraltet") }}</AvmHinweis
            >
            <AvmHinweis
                v-else-if="lauf !== null && lauf.flaechenGeaendert"
                ton="warnung"
                rolle="status"
                testid="wsync-regeln-flaechen-veraltet"
                >{{ t("admin.wikisync.regeln.flaechenVeraltet") }}</AvmHinweis
            >

            <div class="wsync-regeln__aktionen">
                <AvmKnopf groesse="zeile" :gesperrt="ableitenSperre" testid="wsync-regeln-ableiten" @click="ableiten()"
                    ><span aria-hidden="true">⇄ </span
                    >{{
                        t(lauf === null ? "admin.wikisync.regeln.ableiten" : "admin.wikisync.regeln.neuAbleiten")
                    }}</AvmKnopf
                >
                <AvmKnopf groesse="zeile" testid="wsync-regeln-begriffe" @click="begriffeOffen = true">{{
                    t("admin.wikisync.begriffe.knopf")
                }}</AvmKnopf>
                <span v-if="lauf !== null && lauf.beendetAm !== null" class="wsync-regeln__leise">{{
                    t("admin.wikisync.regeln.abgeleitetAm", { zeit: zeitpunkt(lauf.beendetAm, jetzt) })
                }}</span>
            </div>

            <p v-if="liste !== null && lauf !== null" class="wsync-regeln__bilanz" data-testid="wsync-regeln-bilanz">
                {{ bilanz }}
            </p>

            <!-- Offene Flächen: eine Fläche gleichen Namens ohne Wiki-Schlüssel bekommt ihren Artikel -->
            <WikisyncFlaechenUebersicht
                v-if="!gefiltert && offeneFlaechen.length > 0"
                :flaechen="offeneFlaechen"
                :sperre="flaechenSperre"
                :jetzt="jetzt"
                @zuweisen="(eintrag: WikisyncRegelOffeneFlaeche) => fragenFlaeche('zuweisen', eintrag)"
                @zuruecknehmen="(eintrag: WikisyncRegelOffeneFlaeche) => fragenFlaeche('flaecheZurueck', eintrag)"
            />

            <!-- Rückfrage und Rückmeldung stehen oben unter den offenen Flächen, vor der langen Liste (Vali 2026-10-27: „das müsste alles nach oben und unter die flächenerkennung“); `zeigeStand` holt sie nach jedem Klick ins Bild. -->
            <div ref="stand" class="wsync-regeln__stand">
                <AvmBestaetigung
                    v-if="frage === 'uebernehmen'"
                    :frage="t('admin.wikisync.regeln.frage', { n: anzahl.vorschlaege(anzahlGewaehlt) })"
                    :folge="t('admin.wikisync.regeln.folge')"
                    :bestaetigen="t('admin.wikisync.regeln.jetztUebernehmen')"
                    :gesperrt="sperre"
                    testid="wsync-regeln-frage"
                    @bestaetigen="uebernehmen()"
                    @abbrechen="frage = null"
                />
                <AvmBestaetigung
                    v-else-if="frage !== null && 'zuweisen' in frage"
                    :frage="
                        t('admin.wikisync.regeln.flaechen.frage', {
                            name: frage.zuweisen.name,
                            titel: frage.zuweisen.titel,
                        })
                    "
                    :folge="t('admin.wikisync.regeln.flaechen.folge')"
                    :bestaetigen="t('admin.wikisync.regeln.flaechen.jetztZuweisen')"
                    :gesperrt="flaechenSperre"
                    testid="wsync-regeln-flaeche-frage"
                    @bestaetigen="weiseFlaecheZu(frage.zuweisen)"
                    @abbrechen="frage = null"
                />
                <AvmBestaetigung
                    v-else-if="frage !== null && 'flaecheZurueck' in frage"
                    :frage="t('admin.wikisync.regeln.flaechen.zurueckFrage', { name: frage.flaecheZurueck.name })"
                    :folge="t('admin.wikisync.regeln.flaechen.zurueckFolge', { titel: frage.flaecheZurueck.titel })"
                    :bestaetigen="t('admin.wikisync.regeln.flaechen.zuruecknehmen')"
                    :gesperrt="flaechenSperre"
                    testid="wsync-regeln-flaeche-zurueck-frage"
                    @bestaetigen="nimmFlaecheZurueck(frage.flaecheZurueck)"
                    @abbrechen="frage = null"
                />
                <AvmBestaetigung
                    v-else-if="frage !== null && 'zurueck' in frage"
                    :frage="t('admin.wikisync.regeln.zurueckFrage')"
                    :folge="t('admin.wikisync.regeln.zurueckFolge')"
                    :bestaetigen="t('admin.wikisync.regeln.uebernahmen.zuruecknehmen')"
                    testid="wsync-regeln-zurueck-frage"
                    @bestaetigen="nimmZurueck(frage.zurueck)"
                    @abbrechen="frage = null"
                />
                <AvmHinweis v-if="meldung !== null" rolle="status" testid="wsync-regeln-meldung">{{
                    meldung
                }}</AvmHinweis>
                <VerwaltungMeldung :ergebnis="fehler" testid="wsync-regeln-fehler" />
            </div>

            <!-- Frühere Übernahmen: jede lässt sich zurücknehmen -->
            <section
                v-if="!gefiltert && uebernahmen.length > 0"
                class="wsync-regeln__block"
                data-testid="wsync-regeln-uebernahmen"
            >
                <h4 class="wsync-regeln__titel">{{ t("admin.wikisync.regeln.uebernahmen.titel") }}</h4>
                <ul class="wsync-regeln__uebernahmen">
                    <li v-for="u in uebernahmen" :key="u.id" :data-uebernahme="u.id">
                        <span>
                            {{
                                t("admin.wikisync.regeln.uebernahmen.zeile", {
                                    zeit: zeitpunkt(u.am, jetzt),
                                    von: u.von ?? "—",
                                    regeln: zahl(u.regeln),
                                    still: zahl(u.stillgelegt),
                                })
                            }}
                        </span>
                        <AvmPille v-if="u.zurueckgenommenAm !== null">{{
                            t("admin.wikisync.regeln.uebernahmen.zurueck", {
                                zeit: zeitpunkt(u.zurueckgenommenAm, jetzt),
                            })
                        }}</AvmPille>
                        <AvmKnopf
                            v-else
                            groesse="zeile"
                            :gesperrt="
                                darfZurueck ? (ws.busy.value !== null ? '' : undefined) : rechtSatz('undo_wikisync_run')
                            "
                            :testid="`wsync-regeln-zurueck-${u.id}`"
                            @click="frage = { zurueck: u.id }"
                            >{{ t("admin.wikisync.regeln.uebernahmen.zuruecknehmen") }}</AvmKnopf
                        >
                    </li>
                </ul>
            </section>

            <!-- Abdeckung der Angaben im Wiki (die Messung der Analyse am Dump) -->
            <section
                v-if="!gefiltert && zahlen !== null"
                class="wsync-regeln__block"
                data-testid="wsync-regeln-abdeckung"
            >
                <h4 class="wsync-regeln__titel">{{ t("admin.wikisync.regeln.abdeckung.titel") }}</h4>
                <dl class="wsync-regeln__felder">
                    <dt>{{ t("admin.wikisync.regeln.abdeckung.mitAussage") }}</dt>
                    <dd>{{ zahl(zahlen.mitAussage) }}</dd>
                    <dt>{{ t("admin.wikisync.regeln.abdeckung.vollstaendig") }}</dt>
                    <dd>{{ zahl(zahlen.vollstaendig) }}</dd>
                    <dt>{{ t("admin.wikisync.regeln.abdeckung.teilweise") }}</dt>
                    <dd>{{ zahl(zahlen.teilweise) }}</dd>
                    <dt>{{ t("admin.wikisync.regeln.abdeckung.garNicht") }}</dt>
                    <dd>{{ zahl(zahlen.garNicht) }}</dd>
                    <dt>{{ t("admin.wikisync.regeln.abdeckung.nurLebensraum") }}</dt>
                    <dd>{{ zahl(zahlen.nurLebensraum) }}</dd>
                    <dt>{{ t("admin.wikisync.regeln.abdeckung.ohneAussage") }}</dt>
                    <dd>{{ zahl(zahlen.ohneAussage) }}</dd>
                </dl>
            </section>

            <!-- Auswahl: schnelle Wege -->
            <div v-if="zeilen.length > 0" class="wsync-regeln__auswahl" data-testid="wsync-regeln-auswahl">
                <AvmKaestchen
                    art="checkbox"
                    :checked="alleGewaehlt"
                    :unbestimmt="unbestimmt"
                    :gesperrt="waehlbareZeilen.length === 0 ? t('admin.wikisync.regeln.keineWaehlbaren') : undefined"
                    testid="wsync-regeln-alle"
                    @change="waehleAlleGezeigten"
                    >{{ t("admin.wikisync.regeln.alleGezeigten") }}</AvmKaestchen
                >
                <AvmKnopf groesse="zeile" testid="wsync-regeln-vorgewaehlte" @click="waehleVorgewaehlte()">{{
                    t("admin.wikisync.regeln.vorgewaehlte")
                }}</AvmKnopf>
                <AvmKnopf
                    groesse="zeile"
                    :gesperrt="anzahlGewaehlt === 0 ? '' : undefined"
                    testid="wsync-regeln-keine"
                    @click="waehleKeine()"
                    >{{ t("admin.wikisync.regeln.keine") }}</AvmKnopf
                >
            </div>

            <div
                v-if="!ohneAbleitung"
                class="wsync-regeln__liste"
                role="table"
                :aria-label="t('admin.wikisync.regeln.titel')"
                data-testid="wsync-regeln-liste"
            >
                <div class="wsync-regeln__eintrag wsync-regeln__kopfzeile" role="row">
                    <span role="columnheader"></span>
                    <span class="wsync-regeln__zeile" role="presentation">
                        <span role="columnheader">{{ t("admin.wikisync.regeln.kopf.eintrag") }}</span>
                        <span role="columnheader">{{ t("admin.wikisync.regeln.kopf.regel") }}</span>
                        <span role="columnheader">{{ t("admin.wikisync.regeln.kopf.typ") }}</span>
                        <span role="columnheader">{{ t("admin.wikisync.regeln.filter.status") }}</span>
                        <span role="columnheader"></span>
                    </span>
                </div>
                <p v-if="liste !== null && zeilen.length === 0" class="wsync-regeln__leer">
                    {{
                        t(
                            lauf === null
                                ? "admin.wikisync.regeln.keinLauf"
                                : gefiltert
                                  ? "admin.wikisync.regeln.keineTreffer"
                                  : "admin.wikisync.regeln.keineVorschlaege",
                        )
                    }}
                </p>
                <div
                    v-for="zeile in zeilen"
                    :key="zeile.id"
                    class="wsync-regeln__karte"
                    :class="{ 'is-offen': offenId === zeile.id }"
                    role="row"
                    :data-vorschlag="zeile.id"
                >
                    <div class="wsync-regeln__eintrag">
                        <span class="wsync-regeln__wahl" role="cell">
                            <AvmKaestchen
                                art="checkbox"
                                :checked="auswahl.has(zeile.id)"
                                :gesperrt="zeile.waehlbar ? undefined : sperreName(zeile.sperre)"
                                :hinweis="t('admin.wikisync.regeln.waehlen', { name: zeile.eintrag.name })"
                                :testid="`wsync-regeln-wahl-${zeile.id}`"
                                @change="(an: boolean) => waehle(zeile.id, an)"
                                ><span class="wsync-regeln__vorleser">{{
                                    t("admin.wikisync.regeln.waehlen", { name: zeile.eintrag.name })
                                }}</span></AvmKaestchen
                            >
                            <AvmKreis
                                :fuellung="vorschlagKreis(zeile)"
                                :name="regelnKreisName(vorschlagKreis(zeile))"
                            />
                        </span>
                        <button
                            type="button"
                            class="wsync-regeln__zeile wsync-regeln__oeffner"
                            :aria-expanded="offenId === zeile.id"
                            @click="offenId = offenId === zeile.id ? null : zeile.id"
                        >
                            <span class="z-eintrag"
                                ><span class="wsync-regeln__name">{{ zeile.eintrag.name }}</span
                                ><span class="wsync-regeln__klein"
                                    >{{ regelArtName(zeile.eintrag.art) }} · {{ beziehungenText(zeile) }}</span
                                ></span
                            >
                            <span class="z-regel">{{ vorschlagKurz(zeile) }}</span>
                            <span class="z-typ"
                                ><AvmPille :ton="TYP_TON[zeile.typ]">{{ typName(zeile.typ) }}</AvmPille></span
                            >
                            <span class="z-status">{{ regelStatusName(zeile.status) }}</span>
                            <span class="z-chev wsync-regeln__chevron" aria-hidden="true">▾</span>
                        </button>
                    </div>
                    <WikisyncRegelDetail
                        v-if="offenId === zeile.id"
                        :vorschlag="zeile"
                        :gewaehlt="auswahl.has(zeile.id)"
                        :dump-stand="lauf?.dumpStand ?? null"
                        :flaechen="offeneFlaechen"
                        :zuweisen-sperre="flaechenSperre"
                        @waehle="(an: boolean) => waehle(zeile.id, an)"
                        @zuweisen="(eintrag: WikisyncRegelOffeneFlaeche) => fragenFlaeche('zuweisen', eintrag)"
                    />
                </div>
            </div>
            <div v-if="liste !== null && zeilen.length < liste.gesamt">
                <AvmKnopf
                    groesse="zeile"
                    :gesperrt="laedt ? '' : undefined"
                    testid="wsync-regeln-mehr"
                    @click="laden(false)"
                    >{{ weitereLadenText(zeilen.length, liste.gesamt, SEITE) }}</AvmKnopf
                >
            </div>
            <p class="wsync-regeln__legende" data-testid="wsync-regeln-legende">
                <span v-for="kreis in REGELN_KREIS_LEGENDE" :key="kreis" class="wsync-regeln__legende-teil">
                    <AvmKreis :fuellung="kreis" :name="regelnKreisName(kreis)" />{{ regelnKreisName(kreis) }}
                </span>
            </p>

            <AvmSperrgrund v-if="sperre !== undefined && sperre !== ''" :id="grundId" :text="sperre" />
        </div>

        <template #fuss-hinweis>{{ fussHinweis }}</template>
        <template #fuss-haupt>
            <AvmKnopf
                groesse="zeile"
                :gesperrt="sperre"
                :grund-bei="sperre !== undefined && sperre !== '' ? grundId : undefined"
                testid="wsync-regeln-uebernehmen"
                @click="fragen()"
                ><span aria-hidden="true">⇄ </span
                >{{ t("admin.wikisync.regeln.uebernehmenN", { n: zahl(anzahlGewaehlt) }) }}</AvmKnopf
            >
            <button type="button" data-testid="wsync-regeln-schliessen" @click="offen = false">
                {{ t("fenster.close") }}
            </button>
        </template>
    </AvmFenster>

    <WikisyncBegriffeFenster
        v-if="begriffeOffen"
        v-model:offen="begriffeOffen"
        :wikisync="ws"
        :darf="darfBegriffe"
        :recht-satz="rechtSatz"
        :umgebung="umgebung"
    />
</template>

<style scoped>
.wsync-regeln__leiste {
    flex: 1 1 auto;
}

.wsync-regeln {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    min-width: 0;
    container: wsync-regeln / inline-size;
}

.wsync-regeln__satz,
.wsync-regeln__bilanz,
.wsync-regeln__leise {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    font-variant-numeric: tabular-nums;
}

.wsync-regeln__aktionen {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4) var(--space-8);
}

.wsync-regeln__auswahl {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4) var(--space-8);
}

.wsync-regeln__block {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-6) var(--space-10);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel-soft);
    font-size: var(--font-size-small);
}

.wsync-regeln__titel {
    margin: 0;
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
    font-weight: var(--font-weight-regular);
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.wsync-regeln__felder {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--space-2) var(--space-8);
    margin: 0;
    font-variant-numeric: tabular-nums;
}

.wsync-regeln__felder dt {
    color: var(--color-text-muted);
}

.wsync-regeln__felder dd {
    margin: 0;
    color: var(--color-text-strong);
    text-align: right;
}

.wsync-regeln__uebernahmen {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    margin: 0;
    padding: 0;
    list-style: none;
}

.wsync-regeln__uebernahmen li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4) var(--space-8);
}

.wsync-regeln__stand {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}

.wsync-regeln__stand:empty {
    display: none;
}

.wsync-regeln__liste {
    min-width: 0;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel);
}

.wsync-regeln__eintrag {
    box-sizing: border-box;
    display: grid;
    grid-template-columns: 4.4em minmax(0, 1fr);
    align-items: center;
}

.wsync-regeln__kopfzeile {
    border-bottom: 1px solid var(--color-divider);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.wsync-regeln__zeile {
    box-sizing: border-box;
    display: grid;
    grid-template-columns: minmax(0, 1.3fr) minmax(0, 2fr) minmax(0, 10.5em) minmax(0, 9em) minmax(0, 1.5em);
    column-gap: var(--space-6);
    align-items: center;
    width: 100%;
    padding: var(--space-4) var(--space-8) var(--space-4) 0;
}

.wsync-regeln__karte {
    border-bottom: 1px solid var(--color-divider);
}

.wsync-regeln__karte:last-child {
    border-bottom: 0;
}

.wsync-regeln__karte.is-offen {
    background: var(--color-panel-soft);
}

.wsync-regeln__wahl {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding-inline: var(--space-8) 0;
}

.wsync-regeln__oeffner {
    border: 0;
    background: transparent;
    color: var(--color-text);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-small);
    text-align: left;
    transition: background-color 120ms ease;
}

.wsync-regeln__oeffner > * {
    min-width: 0;
    overflow-wrap: anywhere;
}

.wsync-regeln__oeffner:hover {
    background: var(--color-hover-wash);
}

.wsync-regeln__oeffner:active {
    background: var(--color-active-wash);
}

.wsync-regeln__oeffner:focus-visible {
    outline: none;
    box-shadow: inset var(--focus-ring);
}

.wsync-regeln__name {
    display: block;
    color: var(--color-text-strong);
    font-size: var(--font-size-body);
}

.wsync-regeln__klein {
    display: block;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.z-regel {
    color: var(--color-text);
}

.z-status {
    color: var(--color-text-muted);
}

.wsync-regeln__chevron {
    color: var(--color-link);
    text-align: center;
    transition: transform 120ms ease;
}

.wsync-regeln__karte.is-offen .wsync-regeln__chevron {
    transform: rotate(180deg);
}

.wsync-regeln__leer {
    margin: 0;
    padding: var(--space-10);
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.wsync-regeln__legende {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-12);
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.wsync-regeln__legende-teil {
    display: inline-flex;
    align-items: center;
    gap: var(--space-4);
}

/* Nur für Vorleser: der Name des Kästchens, ohne sichtbaren Platz. */
.wsync-regeln__vorleser {
    position: absolute;
    width: 0;
    height: 0;
    margin: 0;
    padding: 0;
    overflow: hidden;
    border: 0;
    clip-path: inset(50%);
    white-space: nowrap;
}

@container wsync-regeln (max-width: 44em) {
    .wsync-regeln__kopfzeile {
        display: none;
    }

    .wsync-regeln__zeile {
        grid-template-columns: minmax(0, 1fr) auto;
        grid-template-areas:
            "eintrag typ"
            "regel regel"
            "status status";
        row-gap: var(--space-2);
        padding: var(--space-6) var(--space-8) var(--space-6) 0;
    }

    .wsync-regeln__zeile > .z-eintrag {
        grid-area: eintrag;
    }

    .wsync-regeln__zeile > .z-regel {
        grid-area: regel;
    }

    .wsync-regeln__zeile > .z-typ {
        grid-area: typ;
        justify-self: end;
    }

    .wsync-regeln__zeile > .z-status {
        grid-area: status;
    }

    .wsync-regeln__zeile > .z-chev {
        display: none;
    }
}

@media (prefers-reduced-motion: reduce) {
    .wsync-regeln__oeffner,
    .wsync-regeln__chevron {
        transition: none;
    }
}
</style>
