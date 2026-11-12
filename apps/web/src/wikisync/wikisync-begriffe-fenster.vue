<script setup lang="ts">
/**
 * Das Fenster „Begriffstafel“ (WI-0253 §24, Vali 2026-10-27, F5): jedes Wort, das die Angaben der Vorkommen im Wiki benutzen („Wald“, „Hügelland“, „immergrün“), mit den Pillen, die es für uns bedeutet:
 * unsere Landschaftsarten (Ebene und Art) und unsere Klimazonen. Die Ableitung der Regelvorschläge liest diese Tafel; ändert sich etwas, sind die vorhandenen Vorschläge veraltet und werden neu abgeleitet.
 *
 * - **Startwerte** stammen aus dem Regelbuch (`regelbuch-abbildung.json`). Mehrdeutige Wörter (Gewässer, Hochland, Ebene, immergrün) starten OHNE Pille und sind markiert: Bis jemand entschieden hat, bleibt der Satzteil
 *   ein Teil ohne Regel. Eine Näherung, eine Lücke (keine passende Art im Modell) und ein übergangener Kleinstandort tragen ihre Marke.
 * - **Jede Änderung speichert sofort** (wie die Tafeln des Kanon-Etiketts): eine Pille wählen (mit Vorschlägen beim Tippen), eine Pille mit ✕ entfernen, ↺ auf den Startwert. Kein Speichern-Knopf. In Production fragt der Server
 *   dafür den Passkey (gemeinsames Fenster „Kurz bestätigen“), sonst genügt das Recht.
 * - **Nie still:** Lehnt der Server ab oder bricht die Person den Passkey ab, springt die Zeile auf den gespeicherten Wert zurück, und die Meldung steht unter der Liste.
 * - Gespeichert wird nur die Abweichung vom Startwert; ein Wort, das jemand von Hand anlegt (ein Wort des Wikis, das noch nirgends vorkam), steht mit seinen Pillen allein.
 * - **Eine Zeile je Wortfamilie:** Die Formen EINES Worts (kalt, kalte, kalten, kaltes, kälteren) stehen in einer Zeile unter ihrem Kopfwort („auch: kalte, kalten …“); eine Entscheidung gilt für alle Formen, die Zahl
 *   im Wiki ist die Summe, und die Suche findet die Zeile auch über jede Form.
 */
import { computed, nextTick, ref, shallowRef, useId, useTemplateRef, watch } from "vue";
import type { WikisyncBegriff, WikisyncBegriffe } from "@avesmaps3d/shared";
import { WIKISYNC_BEGRIFF_FILTER, WIKISYNC_WORT_MUSTER } from "@avesmaps3d/shared";
import type { FilterAbschnitt, FilterWahl } from "../controls/avm-filterknopf";
import AvmFilterknopf from "../controls/avm-filterknopf.vue";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmListenleiste from "../controls/avm-listenleiste.vue";
import AvmPille from "../controls/avm-pille.vue";
import AvmPillenknopf from "../controls/avm-pillenknopf.vue";
import AvmSperrgrund from "../controls/avm-sperrgrund.vue";
import AvmFenster from "../fenster/avm-fenster.vue";
import { t } from "../i18n/i18n";
import VerwaltungMeldung from "../auth/verwaltung-meldung.vue";
import type { Phrase } from "../auth/formular";
import type { ActionResult } from "../auth/verwaltung";
import { entprellt } from "../system/entprellt";
import { wikisyncProbleme, type Wikisync } from "./wikisync";
import WikisyncInfo from "./wikisync-info.vue";
import WikisyncPillenWahl from "./wikisync-pillen-wahl.vue";
import { begriffMarke, lageInfo, pilleGruppe, pilleName } from "./wikisync-regeln-text";
import { umgebungKurz, weitereLadenText, zahl } from "./wikisync-text";

const SEITE = 100;
const WORT = new RegExp(WIKISYNC_WORT_MUSTER, "u");

const offen = defineModel<boolean>("offen", { required: true });
const props = defineProps<{
    wikisync: Wikisync;
    /** Darf die Tafel ändern (`manage_canon_tables`); sonst nennt das Fenster den Grund. */
    darf: boolean;
    rechtSatz: (recht: string) => string;
    umgebung: string;
}>();
const ws = props.wikisync;

const suche = ref("");
const q = entprellt(suche);
const wahl = ref<FilterWahl>({});
const antwort = ref<WikisyncBegriffe | null>(null);
const zeilen = ref<WikisyncBegriff[]>([]);
const laedt = ref(false);
const probleme = ref<Phrase[]>([]);
const meldung = ref<string | null>(null);
const fehler = shallowRef<ActionResult | undefined>(undefined);
let ticket = 0;

/** Der Wunsch je Wort, solange er unterwegs ist: die Pillen, die gelten sollen, oder `zurueck` (↺). */
const wunsch = shallowRef<Readonly<Record<string, readonly string[] | "zurueck">>>({});

const sperre = computed((): string | undefined => (props.darf ? undefined : props.rechtSatz("manage_canon_tables")));
const grundId = useId();
const stand = useTemplateRef<HTMLElement>("stand");
watch(fehler, (f) => {
    if (f !== undefined) void nextTick(() => stand.value?.scrollIntoView({ block: "nearest" }));
});

function abfrage(
    offset: number,
    limit: number,
): { filter?: (typeof WIKISYNC_BEGRIFF_FILTER)[number]; q?: string; limit: number; offset: number } {
    const [filter] = wahl.value["filter"] ?? [];
    return {
        ...(filter !== undefined ? { filter: filter as (typeof WIKISYNC_BEGRIFF_FILTER)[number] } : {}),
        ...(q.value !== "" ? { q: q.value } : {}),
        limit,
        offset,
    };
}

/** Lädt die Liste neu (`neu`: von vorn, mindestens so viele Zeilen wie schon da sind) oder hängt die nächste Seite an. */
async function laden(neu: boolean): Promise<void> {
    const mine = ++ticket;
    laedt.value = true;
    try {
        const body = await ws.ladeBegriffe(
            neu ? abfrage(0, Math.min(Math.max(zeilen.value.length, SEITE), 300)) : abfrage(zeilen.value.length, SEITE),
        );
        if (mine !== ticket) return;
        antwort.value = body;
        zeilen.value = neu ? body.woerter : [...zeilen.value, ...body.woerter];
        probleme.value = [];
    } catch (error) {
        if (mine === ticket) probleme.value = wikisyncProbleme(error);
    } finally {
        if (mine === ticket) laedt.value = false;
    }
}

watch(
    offen,
    (jetzt) => {
        if (!jetzt) return;
        wahl.value = {};
        suche.value = "";
        meldung.value = null;
        fehler.value = undefined;
        zeilen.value = [];
        void laden(true);
    },
    { immediate: true },
);
watch([q, wahl], () => {
    if (!offen.value) return;
    zeilen.value = [];
    void laden(true);
});

// ── Filter ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const abschnitte = computed((): FilterAbschnitt[] => [
    {
        id: "filter",
        titel: t("admin.wikisync.begriffe.filter.titel"),
        art: "eins",
        werte: WIKISYNC_BEGRIFF_FILTER.filter((f) => f !== "alle").map((f) => ({
            wert: f,
            text: t(`admin.wikisync.begriffe.filter.${f}`),
            zahl: antwort.value?.zahlen[f] ?? 0,
        })),
    },
]);
const gefiltert = computed(() => q.value !== "" || (wahl.value["filter"]?.length ?? 0) > 0);
function setze(abschnitt: string, werte: string[]): void {
    wahl.value = { ...wahl.value, [abschnitt]: werte };
}

// ── Anzeigen und Speichern ──────────────────────────────────────────────────────────────────────────────────────────────────────
/** Die Pillen, wie die Zeile sie zeigt: der Wunsch, solange er unterwegs ist, sonst der gespeicherte Stand. */
function pillenVon(zeile: WikisyncBegriff): readonly string[] {
    const w = wunsch.value[zeile.wort];
    if (w === undefined) return zeile.pillen;
    return w === "zurueck" ? zeile.startwert : w;
}
const speichert = (wort: string): boolean => wort in wunsch.value;

function setzeWunsch(wort: string, soll: readonly string[] | "zurueck" | null): void {
    const kopie = { ...wunsch.value };
    if (soll === null) delete kopie[wort];
    else kopie[wort] = soll;
    wunsch.value = kopie;
}

/** Schickt den Wunsch eines Worts. Die Reihe im Speicher des Reiters ruft die Funktion erst auf, wenn sie an der Änderung ist; steht das Wort dann schon so da, geht nichts hinaus. */
async function schicke(wort: string): Promise<void> {
    meldung.value = null;
    fehler.value = undefined;
    const ergebnis = await ws.begriffeSpeichern(() => {
        const soll = wunsch.value[wort];
        if (soll === undefined) return null;
        const zeile = zeilen.value.find((eintrag) => eintrag.wort === wort);
        if (soll === "zurueck") return zeile !== undefined && !zeile.eigen ? null : { wort, zuruecksetzen: true };
        if (zeile !== undefined && gleich(zeile.pillen, soll)) return null;
        return { wort, pillen: [...soll] };
    });
    setzeWunsch(wort, null);
    if (!ergebnis.ok) fehler.value = ergebnis;
    else meldung.value = t("admin.wikisync.begriffe.gespeichert", { umgebung: umgebungKurz(props.umgebung) });
    await laden(true);
}

const gleich = (a: readonly string[], b: readonly string[]): boolean =>
    a.length === b.length && a.every((pille) => b.includes(pille));

function aendere(zeile: WikisyncBegriff, pillen: readonly string[]): void {
    if (sperre.value !== undefined) return;
    setzeWunsch(zeile.wort, pillen);
    void schicke(zeile.wort);
}
const fuegeHinzu = (zeile: WikisyncBegriff, pille: string): void => {
    if (!pillenVon(zeile).includes(pille)) aendere(zeile, [...pillenVon(zeile), pille]);
};
const nimmWeg = (zeile: WikisyncBegriff, pille: string): void =>
    aendere(
        zeile,
        pillenVon(zeile).filter((eine) => eine !== pille),
    );
function zurueck(zeile: WikisyncBegriff): void {
    if (sperre.value !== undefined) return;
    setzeWunsch(zeile.wort, "zurueck");
    void schicke(zeile.wort);
}

// ── Ein neues Wort ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
const neuesWort = ref("");
const neuesWortText = computed(() => neuesWort.value.trim().toLocaleLowerCase());
const neuGrund = computed((): string | undefined => {
    if (neuesWortText.value === "") return t("admin.wikisync.begriffe.neu.zuerstWort");
    if (!WORT.test(neuesWortText.value)) return t("admin.wikisync.begriffe.neu.ungueltig");
    return undefined;
});
// Das Wort kann eine Form einer Familie sein: Dann gehört die Pille zur Zeile der Familie.
const neuAbsatz = computed(() =>
    zeilen.value.find((zeile) => zeile.wort === neuesWortText.value || zeile.formen.includes(neuesWortText.value)),
);
async function neuePille(pille: string): Promise<void> {
    if (neuGrund.value !== undefined || sperre.value !== undefined) return;
    const wort = neuesWortText.value;
    let vorhanden = neuAbsatz.value;
    if (vorhanden === undefined) {
        // Die Liste zeigt nicht alle Zeilen: Gehört das Wort schon zu einer Familie, kommt die Pille zu deren Pillen dazu und ersetzt sie nicht.
        try {
            const treffer = await ws.ladeBegriffe({ q: wort, limit: 20 });
            vorhanden = treffer.woerter.find((zeile) => zeile.wort === wort || zeile.formen.includes(wort));
        } catch {
            /* Das Speichern meldet einen Fehler selbst. */
        }
    }
    if (vorhanden !== undefined) {
        fuegeHinzu(vorhanden, pille);
        neuesWort.value = "";
        return;
    }
    meldung.value = null;
    fehler.value = undefined;
    const ergebnis = await ws.begriffeSpeichern({ wort, pillen: [pille] });
    if (!ergebnis.ok) fehler.value = ergebnis;
    else {
        meldung.value = t("admin.wikisync.begriffe.gespeichert", { umgebung: umgebungKurz(props.umgebung) });
        neuesWort.value = "";
        suche.value = wort;
    }
    await laden(true);
}

const kopfZusatz = computed(() =>
    antwort.value === null ? undefined : t("admin.wikisync.begriffe.zusatz", { n: zahl(antwort.value.gesamt) }),
);
const bilanz = computed(() => {
    const a = antwort.value;
    if (a === null) return "";
    const teile = [
        t("admin.wikisync.begriffe.bilanz.woerter", { n: zahl(a.zahlen["alle"] ?? a.gesamt) }),
        t("admin.wikisync.begriffe.bilanz.offen", { n: zahl(a.zahlen["offen"] ?? 0) }),
        t("admin.wikisync.begriffe.bilanz.ohne", { n: zahl(a.zahlen["ohne"] ?? 0) }),
    ];
    if (a.quelle === "vorgabe") teile.push(t("admin.wikisync.begriffe.bilanz.vorgabe"));
    return teile.join(" · ");
});
</script>

<template>
    <AvmFenster
        v-model:offen="offen"
        bauart="werkzeug"
        breite="werkzeug"
        :titel="t('admin.wikisync.begriffe.titel')"
        :zusatz="kopfZusatz"
        testid="wsync-begriffe-fenster"
    >
        <template #leiste>
            <AvmListenleiste
                v-model="suche"
                class="wsync-begriffe__leiste"
                :platzhalter="t('admin.wikisync.begriffe.suche')"
                :beschriftung="t('admin.wikisync.begriffe.sucheName')"
                testid="wsync-begriffe-leiste"
            >
                <AvmFilterknopf
                    :abschnitte="abschnitte"
                    :wahl="wahl"
                    testid="wsync-begriffe-filter"
                    @setze="setze"
                    @loesen="wahl = {}"
                />
            </AvmListenleiste>
        </template>

        <div class="wsync-begriffe" data-testid="wsync-begriffe">
            <p class="wsync-begriffe__satz">
                {{ t("admin.wikisync.begriffe.satz") }}<WikisyncInfo :text="t('admin.wikisync.begriffe.info')" />
            </p>
            <AvmHinweis v-if="umgebung === 'production' && darf" ton="warnung" testid="wsync-begriffe-production">{{
                t("admin.wikisync.begriffe.production")
            }}</AvmHinweis>
            <AvmSperrgrund v-if="sperre !== undefined" :id="grundId" :text="sperre" />
            <AvmHinweis v-if="probleme.length > 0" ton="gefahr" rolle="alert">
                <span v-for="problem in probleme" :key="problem.key">{{ t(problem.key, problem.params) }}</span>
            </AvmHinweis>
            <p v-if="antwort !== null" class="wsync-begriffe__bilanz" data-testid="wsync-begriffe-bilanz">
                {{ bilanz }}
            </p>

            <!-- Ein neues Wort: erst das Wort, dann seine erste Pille. -->
            <div v-if="darf" class="wsync-begriffe__neu" data-testid="wsync-begriffe-neu">
                <AvmEingabe
                    v-model="neuesWort"
                    :aria-label="t('admin.wikisync.begriffe.neu.wort')"
                    :placeholder="t('admin.wikisync.begriffe.neu.wort')"
                    maxlength="40"
                    autocomplete="off"
                    testid="wsync-begriffe-neu-wort"
                />
                <WikisyncPillenWahl
                    :vergeben="neuAbsatz === undefined ? [] : pillenVon(neuAbsatz)"
                    :gesperrt="neuGrund"
                    :beschriftung="t('admin.wikisync.begriffe.neu.pille')"
                    testid="wsync-begriffe-neu-pille"
                    @waehle="neuePille"
                />
            </div>

            <div class="wsync-begriffe__tafel" role="table" :aria-label="t('admin.wikisync.begriffe.titel')">
                <div class="wsync-begriffe__raster wsync-begriffe__kopf" role="row">
                    <span role="columnheader">{{ t("admin.wikisync.begriffe.kopf.wort") }}</span>
                    <span role="columnheader">{{ t("admin.wikisync.begriffe.kopf.pillen") }}</span>
                    <span role="columnheader" class="wsync-begriffe__kopf-zahl">{{
                        t("admin.wikisync.begriffe.kopf.gesehen")
                    }}</span>
                    <span role="columnheader"></span>
                </div>
                <p v-if="antwort !== null && zeilen.length === 0" class="wsync-begriffe__leer">
                    {{ t(gefiltert ? "admin.wikisync.begriffe.keineTreffer" : "admin.wikisync.begriffe.leer") }}
                </p>
                <div
                    v-for="zeile in zeilen"
                    :key="zeile.wort"
                    class="wsync-begriffe__raster wsync-begriffe__zeile"
                    :class="{ 'is-speichert': speichert(zeile.wort) }"
                    role="row"
                    :data-wort="zeile.wort"
                >
                    <span role="cell" class="z-wort">
                        <span class="wsync-begriffe__wort">{{ zeile.wort }}</span>
                        <AvmPille
                            v-if="begriffMarke(zeile) !== null"
                            :ton="begriffMarke(zeile)!.ton"
                            :title="lageInfo(zeile.lage)"
                            >{{ begriffMarke(zeile)!.text }}</AvmPille
                        >
                        <AvmPille v-if="speichert(zeile.wort)" ton="neutral">{{
                            t("admin.wikisync.marke.speichert")
                        }}</AvmPille>
                        <AvmPille
                            v-else-if="zeile.eigen"
                            ton="neutral"
                            :title="t('admin.wikisync.begriffe.eigenInfo')"
                            >{{ t("admin.wikisync.marke.eigen") }}</AvmPille
                        >
                        <span
                            v-if="zeile.formen.length > 1"
                            class="wsync-begriffe__formen"
                            :title="t('admin.wikisync.begriffe.auchInfo')"
                            :data-testid="`wsync-begriffe-${zeile.wort}-formen`"
                            >{{ t("admin.wikisync.begriffe.auch", { formen: zeile.formen.slice(1).join(", ") }) }}</span
                        >
                        <span v-if="zeile.hinweis !== null" class="wsync-begriffe__hinweis">{{ zeile.hinweis }}</span>
                    </span>
                    <span role="cell" class="z-pillen" :data-l="t('admin.wikisync.begriffe.kopf.pillen')">
                        <template v-for="pille in pillenVon(zeile)" :key="pille">
                            <AvmPillenknopf
                                v-if="sperre === undefined"
                                :title="`${pilleGruppe(pille)} · ${pilleName(pille)}`"
                                :aria-label="
                                    t('admin.wikisync.begriffe.pilleWeg', { pille: pilleName(pille), wort: zeile.wort })
                                "
                                :testid="`wsync-begriffe-${zeile.wort}-weg-${pille}`"
                                @click="nimmWeg(zeile, pille)"
                                >{{ pilleName(pille) }}<template #zeichen>✕</template></AvmPillenknopf
                            >
                            <AvmPille v-else :title="`${pilleGruppe(pille)} · ${pilleName(pille)}`">{{
                                pilleName(pille)
                            }}</AvmPille>
                        </template>
                        <span v-if="pillenVon(zeile).length === 0" class="wsync-begriffe__keine">{{
                            t("admin.wikisync.begriffe.keinePille")
                        }}</span>
                        <WikisyncPillenWahl
                            v-if="sperre === undefined && pillenVon(zeile).length < 8"
                            :vergeben="pillenVon(zeile)"
                            :beschriftung="t('admin.wikisync.begriffe.pilleHinzuVon', { wort: zeile.wort })"
                            :testid="`wsync-begriffe-${zeile.wort}-neu`"
                            @waehle="(pille: string) => fuegeHinzu(zeile, pille)"
                        />
                    </span>
                    <span
                        role="cell"
                        class="wsync-begriffe__zahl z-ges"
                        :data-l="t('admin.wikisync.begriffe.kopf.gesehen')"
                        >{{ zeile.gesehen === null ? "—" : zahl(zeile.gesehen) }}</span
                    >
                    <span role="cell" class="wsync-begriffe__aktion z-akt">
                        <AvmKnopf
                            v-if="sperre === undefined && (zeile.eigen || wunsch[zeile.wort] !== undefined)"
                            groesse="zeile"
                            :aria-label="t('admin.wikisync.begriffe.aufStartwert', { wort: zeile.wort })"
                            :title="t('admin.wikisync.begriffe.aufStartwert', { wort: zeile.wort })"
                            :testid="`wsync-begriffe-${zeile.wort}-zurueck`"
                            @click="zurueck(zeile)"
                            ><span aria-hidden="true">↺</span></AvmKnopf
                        >
                    </span>
                </div>
            </div>
            <div v-if="antwort !== null && zeilen.length < antwort.gesamt">
                <AvmKnopf
                    groesse="zeile"
                    :gesperrt="laedt ? '' : undefined"
                    testid="wsync-begriffe-mehr"
                    @click="laden(false)"
                    >{{ weitereLadenText(zeilen.length, antwort.gesamt, SEITE) }}</AvmKnopf
                >
            </div>
            <!-- Eine Ablehnung steht unter der Tafel (und rollt herein); der Satz zum Erfolg steht im Fuß, wo er auch in einer langen Tafel zu sehen ist und nichts verschiebt. -->
            <div ref="stand" class="wsync-begriffe__stand">
                <VerwaltungMeldung :ergebnis="fehler" testid="wsync-begriffe-fehler" />
            </div>
        </div>

        <template #fuss-hinweis
            ><span role="status" data-testid="wsync-begriffe-meldung">{{
                meldung ?? t("admin.wikisync.begriffe.fuss")
            }}</span></template
        >
        <template #fuss-haupt>
            <button type="button" data-testid="wsync-begriffe-schliessen" @click="offen = false">
                {{ t("fenster.close") }}
            </button>
        </template>
    </AvmFenster>
</template>

<style scoped>
.wsync-begriffe__leiste {
    flex: 1 1 auto;
}

.wsync-begriffe {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    min-width: 0;
    container: wsync-begriffe / inline-size;
}

.wsync-begriffe__satz,
.wsync-begriffe__bilanz {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.wsync-begriffe__bilanz {
    font-variant-numeric: tabular-nums;
}

.wsync-begriffe__neu {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4) var(--space-6);
}

.wsync-begriffe__stand {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}

.wsync-begriffe__stand:empty {
    display: none;
}

.wsync-begriffe__tafel {
    min-width: 0;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel);
}

.wsync-begriffe__raster {
    box-sizing: border-box;
    display: grid;
    /* Die Spalten rechts in rem, nicht in em: Der Kopf hat eine kleinere Schrift als die Zeilen, und em ließe seine Spalten gegen die der Zeilen wandern. */
    grid-template-columns: minmax(0, 1.1fr) minmax(0, 2.4fr) 7rem 3rem;
    column-gap: var(--space-6);
    align-items: start;
    padding: var(--space-4) var(--space-8);
}

.wsync-begriffe__kopf {
    align-items: center;
    border-bottom: 1px solid var(--color-divider);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.wsync-begriffe__zeile {
    border-bottom: 1px solid var(--color-divider);
    font-size: var(--font-size-small);
}

.wsync-begriffe__zeile:last-child {
    border-bottom: 0;
}

.wsync-begriffe__zeile.is-speichert {
    background: var(--color-panel-soft);
}

.wsync-begriffe__zeile > * {
    min-width: 0;
    overflow-wrap: anywhere;
}

.z-wort {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-4);
    min-height: var(--avm-control-h);
}

.wsync-begriffe__wort {
    color: var(--color-text-strong);
    font-size: var(--font-size-body);
}

.wsync-begriffe__hinweis,
.wsync-begriffe__formen {
    flex-basis: 100%;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.z-pillen {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4);
    min-height: var(--avm-control-h);
}

.wsync-begriffe__keine {
    color: var(--color-text-muted);
    font-style: italic;
}

.wsync-begriffe__zahl {
    min-height: var(--avm-control-h);
    line-height: var(--avm-control-h);
    text-align: right;
    font-variant-numeric: tabular-nums;
}

.wsync-begriffe__kopf > * {
    white-space: nowrap;
}

.wsync-begriffe__kopf-zahl {
    text-align: right;
}

.wsync-begriffe__aktion {
    display: flex;
    justify-content: flex-end;
}

.wsync-begriffe__leer {
    margin: 0;
    padding: var(--space-10);
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

@container wsync-begriffe (max-width: 40em) {
    .wsync-begriffe__kopf {
        display: none;
    }

    .wsync-begriffe__raster.wsync-begriffe__zeile {
        grid-template-columns: minmax(0, 1fr) auto;
        grid-template-areas:
            "wort akt"
            "pillen pillen"
            "ges ges";
        row-gap: var(--space-4);
        padding: var(--space-6) var(--space-8);
    }

    .wsync-begriffe__zeile > .z-wort {
        grid-area: wort;
    }

    .wsync-begriffe__zeile > .z-pillen {
        grid-area: pillen;
    }

    .wsync-begriffe__zeile > .z-ges {
        grid-area: ges;
        min-height: 0;
        line-height: inherit;
        text-align: left;
    }

    .wsync-begriffe__zeile > .z-akt {
        grid-area: akt;
    }

    .wsync-begriffe__zeile > .z-ges::before {
        content: attr(data-l) ": " / "";
        color: var(--color-text-muted);
    }
}
</style>
