<script setup lang="ts">
import { computed, ref } from "vue";
import type { InhalteQuellenSortierung } from "@avesmaps3d/shared";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import type { MenueOption } from "../controls/avm-menueknopf";
import { formatNumber, t, type MessageKey } from "../i18n/i18n";
import InhalteKatalogListe from "./inhalte-katalog-liste.vue";
import type { AnlegenZustand, QuellenSteuerung } from "./inhalte-quellen-steuerung";
import { kreisDerQuelle } from "./inhalte-quellen-modell";

/**
 * Spalte 1 des Reiters „Quellen“ (WI-0254; Mockup `review/wi-0254/inhalte-editor-korpora-mockup.html`): der Katalog der Quellen in der Form
 * der Reiter (`inhalte-katalog-liste.vue`) mit den Worten der Quellen, ihrer Unterzeile (Quellentyp und Verwendungen) und dem Formular
 * zum Anlegen.
 *
 * - **✚ Neu** öffnet eine Zeile mit Adresse und Titel: Die Adresse ist die Identität einer Quelle. Eine bekannte Adresse legt nichts an,
 *   sondern wählt die vorhandene Quelle. Eine Quelle ohne Adresse legt dieser Reiter nicht an (offene Fachentscheidung, WI-0254 §10).
 */
const props = defineProps<{
    steuerung: QuellenSteuerung;
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
        ? t("inhalte.quellen.unterzeile", { n: formatNumber(liste.total, 0) })
        : t("inhalte.quellen.unterzeileGefiltert", {
              treffer: formatNumber(liste.total, 0),
              gesamt: formatNumber(gesamt.value, 0),
          });
});

const SORT_NAMEN: Readonly<Record<InhalteQuellenSortierung, MessageKey>> = {
    title: "inhalte.sortierung.title",
    title_desc: "inhalte.sortierung.title_desc",
    uses: "inhalte.sortierung.uses",
};
const sortierungen = computed<readonly MenueOption[]>(() =>
    (Object.keys(SORT_NAMEN) as InhalteQuellenSortierung[]).map((wert) => ({ wert, text: t(SORT_NAMEN[wert]) })),
);
const sortierName = computed(() => t(SORT_NAMEN[s.sortierung.value]));
const sortierZeichen = (wert: string): { art: "name" | "menge"; umgekehrt: boolean } => ({
    art: wert === "uses" ? "menge" : "name",
    umgekehrt: wert === "title_desc",
});

/** Der Name des Quellentyps in den Worten des Infopanels. */
const typName = (typ: string): string => t(`infoPanel.sourceType.${typ}` as MessageKey);

const wechselFrage = computed(() => {
    const ziel = s.zeilen.value.find((zeile) => zeile.id === s.wechselWunsch.value);
    return t("inhalte.wechsel.frage", { name: ziel?.title ?? "" });
});

// --- Neu ---
const neueAdresse = ref("");
const neuerTitel = ref("");
const anlegenSatz = computed(() => {
    const z: AnlegenZustand = s.anlegen.value;
    if (z.art !== "abgelehnt") return undefined;
    return z.code === "source_exists" ? t("inhalte.neu.bekannt") : z.satz;
});
const adresseOk = computed(() => /^https?:\/\/\S+$/u.test(neueAdresse.value.trim()));
const neuOk = computed(() => adresseOk.value && neuerTitel.value.trim() !== "" && s.anlegen.value.art !== "laeuft");
async function anlegen(): Promise<void> {
    if (!neuOk.value) return;
    await s.legeAn(neueAdresse.value, neuerTitel.value);
    if (s.anlegen.value.art === "aus") {
        neueAdresse.value = "";
        neuerTitel.value = "";
    }
}
</script>

<template>
    <InhalteKatalogListe
        :steuerung="s"
        kennung="quellen"
        zeichen="quellen"
        :titel="t('inhalte.quellen.titel')"
        :unterzeile="unterzeile"
        :suche-platzhalter="t('inhalte.quellen.suche.platzhalter')"
        :suche-beschriftung="t('inhalte.quellen.suche.beschriftung')"
        :leer-text="t('inhalte.quellen.leer')"
        :fehler-text="t('inhalte.liste.fehler')"
        :legende-beschriftung="t('inhalte.kreis.legende')"
        :mit-legende="s.liste.value !== undefined"
        :zahlen="zahlen"
        :sortierungen="sortierungen"
        :sortier-name="sortierName"
        :sortier-zeichen="sortierZeichen"
        :zeile-unter="
            (zeile) =>
                t('inhalte.quellen.zeile.unter', {
                    typ: typName(zeile.sourceType),
                    n: formatNumber(zeile.uses, 0),
                })
        "
        :kreis="kreisDerQuelle"
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
                data-testid="inhalte-quellen-neu-form"
                @submit.prevent="anlegen"
            >
                <label class="liste__neu-label">
                    <span>{{ t("inhalte.neu.adresse") }}</span>
                    <AvmEingabe
                        v-model="neueAdresse"
                        :placeholder="t('inhalte.neu.adresse.platzhalter')"
                        :ungueltig="neueAdresse.trim() !== '' && !adresseOk"
                        testid="inhalte-neu-adresse"
                    />
                </label>
                <label class="liste__neu-label">
                    <span>{{ t("inhalte.neu.titel") }}</span>
                    <AvmEingabe
                        v-model="neuerTitel"
                        :placeholder="t('inhalte.neu.titel.platzhalter')"
                        testid="inhalte-neu-titel"
                    />
                </label>
                <div class="liste__neu-knoepfe">
                    <AvmKnopf
                        typ="submit"
                        art="gefuellt"
                        groesse="zeile"
                        :gesperrt="neuOk ? undefined : t('inhalte.neu.unvollstaendig')"
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
                <p class="liste__leise">{{ t("inhalte.neu.hinweis") }}</p>
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
