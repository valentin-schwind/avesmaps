<script setup lang="ts">
import { computed, ref } from "vue";
import type { InhalteKorporaSortierung } from "@avesmaps3d/shared";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import type { MenueOption } from "../controls/avm-menueknopf";
import { formatNumber, t, type MessageKey } from "../i18n/i18n";
import InhalteKatalogListe from "./inhalte-katalog-liste.vue";
import type { AnlegenZustand, KatalogFilter } from "./inhalte-katalog-steuerung";
import {
    ANZEIGEFORM_FILTER,
    anzeigeformVon,
    kreisDesKorpus,
    schluesselSiehtGutAus,
    type AnzeigeformFilter,
} from "./inhalte-korpora-modell";
import type { KorporaSteuerung } from "./inhalte-korpora-steuerung";

/**
 * Spalte 1 des Reiters „Korpora“ (WI-0254, Runde 4; Mockup `review/wi-0254/inhalte-editor-korpora-mockup.html`): der Katalog der Korpora in der Form der
 * Reiter (`inhalte-katalog-liste.vue`) mit den Worten der Korpora, dem Filter nach Anzeigeform statt Herkunft und der Unterzeile „Schlüssel · Anzeigeform ·
 * Quellen“.
 *
 * - **✚ Neu** öffnet eine Zeile mit der registrierbaren Domain als Schlüssel (unveränderlich) und, wenn schon bekannt, dem Namen des Angebots. Ein bekannter
 *   Schlüssel legt nichts an, sondern wählt den vorhandenen Korpus.
 * - Einen stillgelegten Korpus gibt es nicht: Die Legende kennt nur ● aus Legacy und ◐ von der Redaktion.
 */
const props = defineProps<{
    steuerung: KorporaSteuerung;
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
        leer: 0,
    };
});
const unterzeile = computed(() => {
    const liste = s.liste.value;
    if (liste === undefined) return s.listeLaedt.value ? t("inhalte.laedt") : "";
    return liste.total === gesamt.value
        ? t("inhalte.korpora.unterzeile", { n: formatNumber(liste.total, 0) })
        : t("inhalte.korpora.unterzeileGefiltert", {
              treffer: formatNumber(liste.total, 0),
              gesamt: formatNumber(gesamt.value, 0),
          });
});

const SORT_NAMEN: Readonly<Record<InhalteKorporaSortierung, MessageKey>> = {
    title: "inhalte.sortierung.title",
    title_desc: "inhalte.sortierung.title_desc",
};
const sortierungen = computed<readonly MenueOption[]>(() =>
    (Object.keys(SORT_NAMEN) as InhalteKorporaSortierung[]).map((wert) => ({ wert, text: t(SORT_NAMEN[wert]) })),
);
const sortierName = computed(() => t(SORT_NAMEN[s.sortierung.value]));
const sortierZeichen = (wert: string): { art: "name" | "menge"; umgekehrt: boolean } => ({
    art: "name",
    umgekehrt: wert === "title_desc",
});

const FORM_NAMEN: Readonly<Record<Exclude<AnzeigeformFilter, "alle">, MessageKey>> = {
    belegstelle: "inhalte.korpora.form.belegstelle",
    werk: "inhalte.korpora.form.werk",
    unentschieden: "inhalte.korpora.form.unentschieden",
};
const alsFilter = (wert: string | undefined): AnzeigeformFilter =>
    ANZEIGEFORM_FILTER.find((eins) => eins === wert) ?? "alle";
const filter = computed<KatalogFilter>(() => ({
    abschnitte: [
        {
            id: "form",
            titel: t("inhalte.korpora.filter.form"),
            art: "eins",
            werte: (Object.keys(FORM_NAMEN) as (keyof typeof FORM_NAMEN)[]).map((wert) => ({
                wert,
                text: t(FORM_NAMEN[wert]),
            })),
        },
    ],
    wahl: { form: s.anzeigeform.value === "alle" ? [] : [s.anzeigeform.value] },
    setze: (_abschnitt, werte) => {
        s.anzeigeform.value = alsFilter(werte[0]);
    },
    loese: () => {
        s.anzeigeform.value = "alle";
    },
}));

const wechselFrage = computed(() => {
    const ziel = s.zeilen.value.find((zeile) => zeile.id === s.wechselWunsch.value);
    return t("inhalte.wechsel.frage", { name: ziel?.title ?? "" });
});

// --- Neu ---
const neuerSchluessel = ref("");
const neuerName = ref("");
const anlegenSatz = computed(() => {
    const z: AnlegenZustand = s.anlegen.value;
    if (z.art !== "abgelehnt") return undefined;
    return z.code === "corpus_exists" ? t("inhalte.korpora.neu.bekannt") : z.satz;
});
const schluesselOk = computed(() => schluesselSiehtGutAus(neuerSchluessel.value));
const neuOk = computed(() => schluesselOk.value && s.anlegen.value.art !== "laeuft");
async function anlegen(): Promise<void> {
    if (!neuOk.value) return;
    await s.legeAn(neuerSchluessel.value, neuerName.value);
    if (s.anlegen.value.art === "aus") {
        neuerSchluessel.value = "";
        neuerName.value = "";
    }
}
</script>

<template>
    <InhalteKatalogListe
        :steuerung="s"
        kennung="korpora"
        zeichen="korpora"
        :titel="t('inhalte.korpora.titel')"
        :unterzeile="unterzeile"
        :suche-platzhalter="t('inhalte.korpora.suche.platzhalter')"
        :suche-beschriftung="t('inhalte.korpora.suche.beschriftung')"
        :leer-text="t('inhalte.korpora.leer')"
        :fehler-text="t('inhalte.korpora.liste.fehler')"
        :legende-beschriftung="t('inhalte.korpora.kreis.legende')"
        :mit-legende="s.liste.value !== undefined"
        :zahlen="zahlen"
        :legende-namen="{ voll: t('inhalte.kreis.voll'), halb: t('inhalte.kreis.halb') }"
        :filter="filter"
        :sortierungen="sortierungen"
        :sortier-name="sortierName"
        :sortier-zeichen="sortierZeichen"
        :zeile-unter="
            (zeile) =>
                t('inhalte.korpora.zeile.unter', {
                    key: zeile.key,
                    form: t(FORM_NAMEN[anzeigeformVon(zeile.form)]),
                    n: formatNumber(zeile.quellen, 0),
                })
        "
        :kreis="kreisDesKorpus"
        :kreis-name="(zeile) => (zeile.herkunft === 'editor' ? t('inhalte.kreis.halb') : t('inhalte.kreis.voll'))"
        :wechsel-frage="wechselFrage"
        :darf-schreiben="darfSchreiben"
        :telefon="telefon"
        @gewaehlt="(id: string) => emit('gewaehlt', id)"
    >
        <template #neu>
            <form
                v-if="s.anlegen.value.art !== 'aus'"
                class="liste__neu"
                data-testid="inhalte-korpora-neu-form"
                @submit.prevent="anlegen"
            >
                <label class="liste__neu-label">
                    <span>{{ t("inhalte.korpora.neu.schluessel") }}</span>
                    <AvmEingabe
                        v-model="neuerSchluessel"
                        :placeholder="t('inhalte.korpora.neu.schluessel.platzhalter')"
                        :ungueltig="neuerSchluessel.trim() !== '' && !schluesselOk"
                        testid="inhalte-neu-schluessel"
                    />
                </label>
                <label class="liste__neu-label">
                    <span>{{ t("inhalte.korpora.neu.name") }}</span>
                    <AvmEingabe
                        v-model="neuerName"
                        :placeholder="t('inhalte.korpora.neu.name.platzhalter')"
                        testid="inhalte-neu-korpusname"
                    />
                </label>
                <div class="liste__neu-knoepfe">
                    <AvmKnopf
                        typ="submit"
                        art="gefuellt"
                        groesse="zeile"
                        :gesperrt="neuOk ? undefined : t('inhalte.korpora.neu.unvollstaendig')"
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
                <p class="liste__leise">{{ t("inhalte.korpora.neu.hinweis") }}</p>
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
