<script setup lang="ts">
import { computed, ref } from "vue";
import { INHALTE_WERK_TYPEN, type InhalteWerkSortierung } from "@avesmaps3d/shared";
import AvmAuswahl from "../controls/avm-auswahl.vue";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import type { MenueOption } from "../controls/avm-menueknopf";
import { formatNumber, t, type MessageKey } from "../i18n/i18n";
import InhalteKatalogListe from "./inhalte-katalog-liste.vue";
import { jahrIstZahl, kreisDesWerks } from "./inhalte-literatur-modell";
import { typName } from "./inhalte-literatur-texte";
import type { LiteraturSteuerung } from "./inhalte-literatur-steuerung";
import type { AnlegenZustand } from "./inhalte-katalog-steuerung";

/**
 * Spalte 1 des Reiters „Literatur“ (WI-0254, Runde 2; Mockup `review/wi-0254/inhalte-editor-korpora-mockup.html`): der Katalog der Werke
 * in der Form der Reiter (`inhalte-katalog-liste.vue`) mit den Worten der Literatur, der Unterzeile „Produkttyp · Regelsystem · Jahr ·
 * Orte“ und dem Formular zum Anlegen.
 *
 * - **✚ Neu** öffnet eine Zeile mit Titel und Produkttyp. Ein gleichlautender Titel ist kein Beweis für dasselbe Werk: Es wird nie etwas
 *   zusammengelegt oder abgelehnt.
 */
const props = defineProps<{
    steuerung: LiteraturSteuerung;
    darfSchreiben: boolean;
    telefon: boolean;
}>();

const emit = defineEmits<{ gewaehlt: [id: string] }>();

const s = props.steuerung;
const gesamt = computed(() => s.liste.value?.zahlen.aktiv ?? 0);
const zahlen = computed(() => {
    const z = s.liste.value?.zahlen;
    return {
        voll: Math.max(0, (z?.aktiv ?? 0) - (z?.editor ?? 0)),
        halb: z?.editor ?? 0,
        "halb-rechts": 0,
        leer: z?.stillgelegt ?? 0,
    };
});
const unterzeile = computed(() => {
    const liste = s.liste.value;
    if (liste === undefined) return s.listeLaedt.value ? t("inhalte.laedt") : "";
    return liste.total === gesamt.value
        ? t("inhalte.literatur.unterzeile", { n: formatNumber(liste.total, 0) })
        : t("inhalte.literatur.unterzeileGefiltert", {
              treffer: formatNumber(liste.total, 0),
              gesamt: formatNumber(gesamt.value, 0),
          });
});

const SORT_NAMEN: Readonly<Record<InhalteWerkSortierung, MessageKey>> = {
    title: "inhalte.sortierung.title",
    title_desc: "inhalte.sortierung.title_desc",
    year: "inhalte.sortierung.year",
};
const sortierungen = computed<readonly MenueOption[]>(() =>
    (Object.keys(SORT_NAMEN) as InhalteWerkSortierung[]).map((wert) => ({ wert, text: t(SORT_NAMEN[wert]) })),
);
const sortierName = computed(() => t(SORT_NAMEN[s.sortierung.value]));
const sortierZeichen = (wert: string): { art: "name" | "menge"; umgekehrt: boolean } => ({
    art: wert === "year" ? "menge" : "name",
    umgekehrt: wert === "title_desc",
});

const wechselFrage = computed(() => {
    const ziel = s.zeilen.value.find((zeile) => zeile.id === s.wechselWunsch.value);
    return t("inhalte.wechsel.frage", { name: ziel?.title ?? "" });
});

// --- Neu ---
const neuerTitel = ref("");
const neueArt = ref<string>("gruppenabenteuer");
const artOptionen = computed(() => INHALTE_WERK_TYPEN.map((typ) => ({ wert: typ, text: typName(typ) })));
const anlegenSatz = computed(() => {
    const z: AnlegenZustand = s.anlegen.value;
    return z.art === "abgelehnt" ? z.satz : undefined;
});
const neuOk = computed(() => neuerTitel.value.trim() !== "" && s.anlegen.value.art !== "laeuft");
async function anlegen(): Promise<void> {
    if (!neuOk.value) return;
    await s.legeAn(neuerTitel.value, neueArt.value);
    if (s.anlegen.value.art === "aus") neuerTitel.value = "";
}
</script>

<template>
    <InhalteKatalogListe
        :steuerung="s"
        kennung="literatur"
        zeichen="literatur"
        :titel="t('inhalte.literatur.titel')"
        :unterzeile="unterzeile"
        :suche-platzhalter="t('inhalte.literatur.suche.platzhalter')"
        :suche-beschriftung="t('inhalte.literatur.suche.beschriftung')"
        :leer-text="t('inhalte.literatur.leer')"
        :fehler-text="t('inhalte.literatur.liste.fehler')"
        :legende-beschriftung="t('inhalte.literatur.kreis.legende')"
        :mit-legende="s.liste.value !== undefined"
        :zahlen="zahlen"
        :sortierungen="sortierungen"
        :sortier-name="sortierName"
        :sortier-zeichen="sortierZeichen"
        :zeile-unter="
            (zeile) =>
                t('inhalte.literatur.zeile.unter', {
                    meta: [
                        typName(zeile.productType),
                        zeile.edition,
                        zeile.year === undefined
                            ? undefined
                            : jahrIstZahl(zeile.year)
                              ? t('inhalte.literatur.jahr', { jahr: zeile.year })
                              : zeile.year,
                    ]
                        .filter((teil): teil is string => teil !== undefined && teil !== '')
                        .join(' · '),
                    n: formatNumber(zeile.orte, 0),
                })
        "
        :kreis="kreisDesWerks"
        :kreis-name="
            (zeile) =>
                zeile.stillgelegt
                    ? t('inhalte.kreis.leer')
                    : zeile.herkunft === 'editor'
                      ? t('inhalte.kreis.halb')
                      : t('inhalte.kreis.voll')
        "
        :wechsel-frage="wechselFrage"
        :darf-schreiben="darfSchreiben"
        :telefon="telefon"
        @gewaehlt="(id: string) => emit('gewaehlt', id)"
    >
        <template #neu>
            <form
                v-if="s.anlegen.value.art !== 'aus'"
                class="liste__neu"
                data-testid="inhalte-literatur-neu-form"
                @submit.prevent="anlegen"
            >
                <label class="liste__neu-label">
                    <span>{{ t("inhalte.literatur.neu.titel") }}</span>
                    <AvmEingabe
                        v-model="neuerTitel"
                        :placeholder="t('inhalte.neu.titel.platzhalter')"
                        testid="inhalte-neu-titel"
                    />
                </label>
                <label class="liste__neu-label">
                    <span>{{ t("inhalte.literatur.neu.art") }}</span>
                    <AvmAuswahl v-model="neueArt" :optionen="artOptionen" testid="inhalte-neu-art" />
                </label>
                <div class="liste__neu-knoepfe">
                    <AvmKnopf
                        typ="submit"
                        art="gefuellt"
                        groesse="zeile"
                        :gesperrt="neuOk ? undefined : t('inhalte.literatur.neu.unvollstaendig')"
                        testid="inhalte-neu-anlegen"
                    >
                        {{ t("inhalte.neu.anlegen") }}
                    </AvmKnopf>
                    <AvmKnopf
                        groesse="zeile"
                        :aria-label="t('inhalte.neu.abbrechen')"
                        testid="inhalte-neu-abbrechen"
                        @click="s.schliesseAnlegen()"
                        >✕</AvmKnopf
                    >
                </div>
                <AvmHinweis v-if="anlegenSatz" ton="warnung" rolle="alert" testid="inhalte-neu-satz">{{
                    anlegenSatz
                }}</AvmHinweis>
                <p class="liste__leise">{{ t("inhalte.literatur.neu.hinweis") }}</p>
            </form>
        </template>
    </InhalteKatalogListe>
</template>

<style scoped>
.liste__leise {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.liste__neu {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    padding: var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel-soft);
}

.liste__neu-label {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.liste__neu-knoepfe {
    display: flex;
    gap: var(--space-6);
}
</style>
