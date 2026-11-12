<script setup lang="ts">
import { computed } from "vue";
import type { MamNavigation } from "@avesmaps3d/shared";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import type { SchienenBereich } from "../fenster/fenster-schiene";
import FensterSchiene from "../fenster/fenster-schiene.vue";
import { t } from "../i18n/i18n";
import { medienArtenBereiche, type SchieneVorschlaege } from "./medien-arten-modell";
import type { Geladen } from "./medien-daten";
import { auswahlAusKennung, auswahlKennung, type MedienAuswahl } from "./medien-zustand";

/**
 * Spalte 1 der Medienverwaltung: die Medienarten (WI-0068 §3.1). Seit dem Betreiber 2026-10-11 („denselben stil geben wie in den
 * anderen fenster (z.B. "System und Betrieb" in Systemsteuerung) und klappbar machen - standard ausgeklappt“, „keine 2. header.
 * einzeilig reicht voll“) ist sie die Schiene der Fenster (`FensterSchiene`, Guide §13.12): Bereichsköpfe in Versalien, klappbar und
 * beim Öffnen alle aufgeklappt; je Eintrag EINE Zeile, die Zählung rechts in der festen Spalte; der gewählte trägt Balken und Fläche.
 *
 * Die Zählungen kommen aus der Navigation des Servers (`GET /api/editor/media/navigation`), dieselben Bedingungen wie die Liste.
 * „PhotoBox-Uploads“ (WI-0272 S3) ist der erste echte Eintrag unter „Eingänge“: ein Korb der Liste, mit der Zahl der OFFENEN Einreichungen (die Arbeit, die wartet),
 * nicht aller; seine Teile (Offen, Rückfrage, Erledigt) stehen als Reiter über der Liste. Er steht nicht noch einmal unter „Prüfen“.
 * „Kartenvorschläge“ (OPS-000093) ist der zweite: das Medienobjekt `kartenvorschlaege`, mit der Zahl der OFFENEN Vorschläge (dieselbe, die bei den Meldungen in Community mitzählt). Es gibt den Eintrag nur mit einem der beiden
 * Rechte der Redaktion (`vorschlaege` fehlt sonst). Was es noch nicht gibt, steht gestrichelt da (Guide §13.17: gestrichelt heißt „nicht dauerhaft“) und lässt sich nicht wählen; im Moment gibt es unter den Eingängen keinen
 * solchen Eintrag mehr. Was ein Korb bedeutet, sagt die Unterzeile der Trefferspalte, wenn er gewählt ist.
 */
const props = defineProps<{
    navigation: Geladen<MamNavigation>;
    auswahl: MedienAuswahl;
    /** Die Kartenvorschläge der Redaktion (OPS-000093): nur mit einem der beiden Rechte gesetzt (`SchieneVorschlaege`). */
    vorschlaege?: SchieneVorschlaege | undefined;
}>();
const emit = defineEmits<{ waehle: [auswahl: MedienAuswahl]; erneut: [] }>();

const bereiche = computed<SchienenBereich[]>(() => medienArtenBereiche(props.navigation.wert, props.vorschlaege));

const aktiv = computed(() => auswahlKennung(props.auswahl));

function waehle(kennung: string): void {
    const auswahl = auswahlAusKennung(kennung);
    if (auswahl !== undefined) emit("waehle", auswahl);
}
</script>

<template>
    <div class="medien-arten" data-testid="medien-arten">
        <AvmHinweis
            v-if="navigation.fehler"
            :ton="navigation.fehler.ton === 'gefahr' ? 'gefahr' : 'warnung'"
            rolle="alert"
            testid="medien-arten-fehler"
        >
            {{ navigation.fehler.text }}
        </AvmHinweis>
        <AvmKnopf v-if="navigation.fehler?.erneut" groesse="zeile" testid="medien-arten-erneut" @click="emit('erneut')">
            {{ t("medien.erneut") }}
        </AvmKnopf>
        <FensterSchiene
            :model-value="aktiv"
            :bereiche="bereiche"
            :beschriftung="t('medien.arten.titel')"
            kennung="medien-arten"
            aufgeklappt
            @update:model-value="waehle"
        />
    </div>
</template>

<style scoped>
.medien-arten {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
}

/* Die Spalte gibt der Schiene keinen Rand (`breite="schiene"`); ein Fehler steht mit dem Rand der anderen Spalten. */
.medien-arten > :not(.fenster-schiene) {
    margin: var(--space-6) var(--space-10) 0;
}
</style>
