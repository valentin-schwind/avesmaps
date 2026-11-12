<script setup lang="ts">
import { computed } from "vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import KartenvorschlagAnsicht from "../community/kartenvorschlag-ansicht.vue";
import { erzeugeAnsicht } from "../community/kartenvorschlag-ansicht-zustand";
import FensterSpalte from "../fenster/fenster-spalte.vue";
import { t } from "../i18n/i18n";
import { objektName } from "./medien-text";

/**
 * Spalte 3 für das Medienobjekt „Kartenvorschläge“ (WI-0068 OPS-000093, Eingänge): der gewählte Vorschlag mit denselben Kästen, denselben Blättern „Annehmen“ und „Ablehnen“ und derselben Revisionsprüfung wie das Werkzeugfenster in
 * Community › Meldungen. Es gibt keine zweite Annahme und Ablehnung: Zustand und Schritte kommen aus `kartenvorschlag-ansicht-zustand.ts`, gezeichnet wird mit `kartenvorschlag-ansicht.vue`.
 *
 * - **Der Fuß steht oben:** Statt am unteren Rand des Werkzeugfensters stehen Satz, Ablehnen und Annehmen gleich unter dem Zustand, ohne Rollen erreichbar; ein offenes Blatt tritt an ihre Stelle.
 * - **Die Karte ruht:** Hinter der Medienverwaltung fliegt nichts; zum Ort führt ⊕ im Kasten „Ort“.
 * - Ein anderer Vorschlag in der Liste ersetzt diesen; ein Grund im Blatt „Ablehnen“ geht dabei verloren (anders als im Werkzeugfenster, das sich ablegt).
 */
const props = defineProps<{
    /** Die öffentliche Kennung des Vorschlags; `undefined`: keiner gewählt. */
    vorschlag: string | undefined;
    rechte: readonly string[];
    telefon: boolean;
}>();
const emit = defineEmits<{ zurueck: [] }>();

const z = erzeugeAnsicht({
    id: () => props.vorschlag ?? "",
    rechte: () => props.rechte,
    sichtbar: () => true,
    fliegen: false,
});

const titel = computed(() => (props.vorschlag === undefined ? objektName("kartenvorschlaege") : z.kopfTitel));
const unterzeile = computed(() => z.detail?.ort?.name);
</script>

<template>
    <FensterSpalte
        breite="inspektor"
        :telefon="telefon"
        :titel="titel"
        :unterzeile="unterzeile"
        testid="medien-spalte-vorschlag"
    >
        <template v-if="telefon" #zurueck>
            <AvmKnopf groesse="zeile" testid="medien-zurueck-vorschlaege" @click="emit('zurueck')">{{
                t("medien.zurueck.vorschlaege")
            }}</AvmKnopf>
        </template>

        <p v-if="vorschlag === undefined" class="medien-vorschlag__satz" data-testid="medien-vorschlag-keiner">
            {{ t("medien.vorschlag.keinGewaehlt") }}
        </p>
        <div v-else class="medien-vorschlag__rumpf" data-testid="medien-vorschlag">
            <KartenvorschlagAnsicht :zustand="z" teil="leiste" />
            <KartenvorschlagAnsicht :zustand="z" teil="fuss" />
            <KartenvorschlagAnsicht :zustand="z" teil="rumpf" />
        </div>
    </FensterSpalte>
</template>

<style scoped>
.medien-vorschlag__rumpf {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    min-width: 0;
}

.medien-vorschlag__satz {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}
</style>
