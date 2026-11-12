<script setup lang="ts">
import { computed } from "vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmListenleiste from "../controls/avm-listenleiste.vue";
import FensterSpalte from "../fenster/fenster-spalte.vue";
import { t } from "../i18n/i18n";
import type { Geladen } from "./medien-daten";
import { galerieName, galerieUnterzeile } from "./medien-galerien-modell";
import MedienStapelZeile from "./medien-stapel-zeile.vue";
import { zahl } from "./medien-text";
import type { MamGalleryList } from "@avesmaps3d/shared";

/**
 * Spalte 2 für das Medienobjekt „Galerien“ (WI-0068 P6; Betreiber 2026-10-12: „eine galerie ist ein medientyp, der bilder
 * sammelt“; Blatt `review/wi-0068-p6/blatt.png`, Abschnitt 1).
 *
 * - **Je Zeile ein Bildstapel** aus den ersten Bildern der Folge, das Cover zuerst — eine Galerie erkennt man am Bild, nicht am
 *   Titel. Im Bestand trägt keine der 82 Galerien einen Titel; sie heißen nach ihrem Ort.
 * - 🔴 **Ein Entwurf trägt die Marke „Entwurf“**, nicht bloß „an 0 Orten“: Ohne Ortsbindung sind seine Bilder für Besucher
 *   unsichtbar (Betreiber 2026-10-13). Eine Zahl erklärt das nicht, die Marke schon.
 * - **Die Suche geht an den Server** und sucht über Titel UND Ortsnamen; sie ist dieselbe Suche wie bei den Assets, damit niemand
 *   zwei Suchfelder lernt.
 */
const props = defineProps<{
    liste: Geladen<MamGalleryList>;
    suche: string;
    gewaehlt: string | undefined;
    telefon: boolean;
    /** Ohne `upload_media` steht „Neue Galerie“ gesperrt da: Auskunft, nie Schutz. */
    darfSchreiben: boolean;
    laeuft: boolean;
}>();
const emit = defineEmits<{
    waehle: [id: string];
    suche: [wert: string];
    erneut: [];
    neu: [];
    zurueck: [];
}>();

const zeilen = computed(() => props.liste.wert?.items ?? []);
const entwuerfe = computed(() => zeilen.value.filter((zeile) => zeile.draft).length);

const unterzeile = computed(() => {
    if (props.liste.laedt && props.liste.wert === undefined) return t("medien.treffer.laedt");
    const gesamt = props.liste.wert?.total ?? 0;
    return entwuerfe.value === 0
        ? t("medien.galerien.unterzeile", { n: zahl(gesamt) })
        : t("medien.galerien.unterzeileEntwuerfe", { n: zahl(gesamt), entwuerfe: zahl(entwuerfe.value) });
});
</script>

<template>
    <FensterSpalte
        breite="fuellen"
        :telefon="telefon"
        :titel="t('medien.objekt.galerien')"
        :unterzeile="unterzeile"
        testid="medien-spalte-galerien"
    >
        <template v-if="telefon" #zurueck>
            <AvmKnopf groesse="zeile" testid="medien-zurueck-arten" @click="emit('zurueck')">{{
                t("medien.zurueck.arten")
            }}</AvmKnopf>
        </template>
        <template #leiste>
            <!-- 🔴 Eine neue Galerie entsteht OHNE Ort: Sie ist damit ein Entwurf, ihre Bilder sind unsichtbar, bis sie
                 jemand an einen Ort bindet (Betreiber 2026-10-13, Variante A). -->
            <AvmKnopf
                groesse="zeile"
                :gesperrt="
                    !darfSchreiben ? t('medien.galerien.keinRecht') : laeuft ? t('medien.galerien.laeuft') : undefined
                "
                testid="medien-galerie-neu"
                @click="emit('neu')"
                >{{ t("medien.galerien.neu") }}</AvmKnopf
            >
            <AvmListenleiste
                :model-value="suche"
                :platzhalter="t('medien.galerien.suche.platzhalter')"
                :beschriftung="t('medien.galerien.suche.label')"
                class="galerien__leiste"
                testid="medien-galerien"
                @update:model-value="(wert: string) => emit('suche', wert)"
            />
        </template>

        <AvmHinweis v-if="liste.fehler" :ton="liste.fehler.ton" rolle="alert" testid="medien-galerien-fehler">{{
            liste.fehler.text
        }}</AvmHinweis>
        <AvmKnopf v-if="liste.fehler?.erneut" groesse="zeile" testid="medien-galerien-erneut" @click="emit('erneut')">{{
            t("medien.erneut")
        }}</AvmKnopf>

        <p
            v-if="!liste.fehler && !liste.laedt && zeilen.length === 0"
            class="galerien__leer"
            data-testid="medien-galerien-leer"
        >
            {{ suche.trim() === "" ? t("medien.galerien.leer") : t("medien.galerien.leerGesucht") }}
        </p>

        <ul
            v-if="zeilen.length > 0"
            class="galerien__liste"
            :aria-label="t('medien.objekt.galerien')"
            data-testid="medien-galerien"
        >
            <li v-for="zeile in zeilen" :key="zeile.id">
                <MedienStapelZeile
                    :name="galerieName(zeile)"
                    :unterzeile="galerieUnterzeile(zeile)"
                    :previews="zeile.previews"
                    :anzahl="zeile.items"
                    :gewaehlt="zeile.id === gewaehlt"
                    :warnung="zeile.draft"
                    :data-galerie="zeile.id"
                    :data-entwurf="zeile.draft ? 'ja' : 'nein'"
                    data-testid="medien-galerie-zeile"
                    @click="emit('waehle', zeile.id)"
                >
                    <template #marke>
                        <span v-if="zeile.draft" class="galerie-zeile__entwurf">{{
                            t("medien.galerien.entwurf")
                        }}</span>
                    </template>
                </MedienStapelZeile>
            </li>
        </ul>
        <p v-if="liste.laedt" class="galerien__satz" data-testid="medien-galerien-laedt">
            {{ t("medien.treffer.laedt") }}
        </p>
    </FensterSpalte>
</template>

<style scoped>
.galerien__leiste {
    flex: 1 1 auto;
    min-width: 0;
}

.galerien__liste {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
}

.galerien__leer,
.galerien__satz {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

/* „Entwurf“ als Marke, nicht als Zahl: sie sagt, dass Besucher nichts sehen. */
.galerie-zeile__entwurf {
    flex: none;
    padding: 1px 8px;
    border: 1px solid var(--color-warning-soft-border);
    border-radius: 999px;
    background: var(--color-warning-soft);
    color: var(--color-warning-soft-text);
    font-size: var(--font-size-caption);
}
</style>
