<script setup lang="ts">
import { computed, nextTick, useTemplateRef, watch } from "vue";
import type { InhalteTraegerQuellenArt } from "@avesmaps3d/shared";
import AvmHinweis from "../controls/avm-hinweis.vue";
import { t } from "../i18n/i18n";
import type { QuelleZumAnhaengen } from "./quelle-per-link-steuerung";
import QuellenAnhaengen from "./quellen-anhaengen.vue";
import QuellenKlappbox from "./quellen-klappbox.vue";
import type { KlappQuelle } from "./quellen-klappbox-modell";
import { liesNeuBeiMeldung } from "./traeger-quellen-melde";
import { leseGrund, quelleAlsKlapp } from "./traeger-quellen-modell";
import { createTraegerQuellenSteuerung } from "./traeger-quellen-steuerung";
import { fehlerSatz, leseGrundSatz } from "./traeger-quellen-texte";

/**
 * Die Quellen EINES Kartenobjekts als Klappboxen, im Reiter „Quellen“ der Karteneditoren (WI-0254 §12; Vali 2026-10-27: „genau das bräuchten wir in den anderen editoren“): Orte und Herrschaftsgebiete.
 * Ersetzt die Aufzählung `quellen-liste.vue`. Das Bauteil nimmt die Art und die öffentliche Kennung des Objekts (`kind`, `id`), liest die Quellen mit dem Stand des Wikis selbst und gibt die Zahl der
 * aktiven nach außen (`zahl`, für „Quellen (n)“ im Reitertitel).
 *
 * - **Sofort speichern** (Betreiber 2026-10-28): kein Speichern-Knopf, keine Speicherleiste, kein Entwurf. Jede Handlung ist EIN Schreiben (`traeger-quellen-steuerung.ts`): Treffer wählen hängt an, die Art
 *   speichert beim Wählen, Fundstelle und Notiz beim Verlassen des Felds oder mit Enter, Lösen und Holen und „↺ Wiki-Wert“ sofort. Eine Zeile ist gesperrt, solange sie schreibt; eine Abweisung steht als
 *   Satz an der Zeile, der Wert bleibt im Feld.
 * - **Kreis:** ○ nicht aktiv („Gelöst“) · ● das Wiki zitiert dasselbe (Art, Seiten, Notiz; „Wie im Wiki“) · ◐ sonst („Weicht vom Wiki ab oder steht nicht im Wiki“) · kein Kreis, wo es keinen Lauf des WikiSync gibt; dann sagt EIN Satz
 *   über der Liste „Noch kein Abgleich mit dem Wiki“. Weicht eine Angabe vom Zitat ab, nennt die offene Zeile „Im Wiki: …“.
 * - **Bearbeitbar** nur mit dem Recht `manage_sources` (`recht`) UND dem Schreibrecht des Editors (`schreibt`: sein Recht, `MAP_EDITING`) UND wenn der Server das Objekt `aenderbar` nennt. Sonst steht die Liste
 *   lesend da, und EIN Satz nennt den Grund.
 * - „Quelle öffnen“ meldet die Kennung (`oeffneQuelle`); den Titel einer Quelle ändert man im Fenster „Inhalte bearbeiten“.
 */
const props = defineProps<{
    kind: InhalteTraegerQuellenArt;
    /** Die öffentliche Kennung des Objekts. */
    id: string;
    /** Das Recht `manage_sources`. */
    recht: boolean;
    /** Schreibt der Editor gerade (sein Schreibrecht, `MAP_EDITING`)? */
    schreibt: boolean;
    /** Die Kennung für die Testkennungen (`<kennung>-quelle`, …). */
    kennung: string;
}>();
const emit = defineEmits<{
    /** Die Zahl der aktiven Quellen, sobald gelesen ist und wenn sie sich ändert. */
    zahl: [n: number];
    /** „Quelle öffnen“: im Fenster „Inhalte bearbeiten“, Reiter Quellen, diese Quelle wählen. */
    oeffneQuelle: [sourceId: string];
}>();

const s = createTraegerQuellenSteuerung(() => ({ kind: props.kind, id: props.id }));

// Eine Rücknahme aus „Änderungen“ (WI-0265 B6g3) hat die Quellen dieses Objekts geändert: neu lesen. Was in einem Feld steht und noch nicht gespeichert ist, bleibt.
liesNeuBeiMeldung(
    () => props,
    () => s.neuLesen(),
);

watch(
    () => s.zahl.value,
    (n) => {
        if (n !== undefined) emit("zahl", n);
    },
    { immediate: true },
);

const grund = computed(() => leseGrund(props.recht, props.schreibt, s.daten.value));
const bearbeitbar = computed(() => s.daten.value !== undefined && grund.value === undefined);
const grundSatz = computed<string | undefined>(() => leseGrundSatz(grund.value));

/** Gibt es einen Lauf des WikiSync mit Zitaten? Sonst ist die Herkunft unbekannt, und die Zeilen tragen keinen Kreis. */
const lauf = computed(() => s.daten.value !== undefined && s.daten.value.wiki !== null);
const klappQuellen = computed<readonly KlappQuelle[]>(() =>
    (s.daten.value?.quellen ?? []).map((quelle) => {
        const fehler = s.fehler.value.get(quelle.sourceId);
        return quelleAlsKlapp(quelle, {
            lauf: lauf.value,
            eingabe: s.eingaben.value.get(quelle.sourceId),
            schreibt: s.schreibend.value.has(quelle.sourceId),
            fehler: fehler === undefined ? undefined : fehlerSatz(fehler),
        });
    }),
);
const schonDa = (sourceId: string): boolean =>
    s.daten.value?.quellen.some((quelle) => quelle.sourceId === sourceId && quelle.state === "active") === true;

const box = useTemplateRef<InstanceType<typeof QuellenKlappbox>>("box");
/** Eine eben angehängte Quelle klappt auf: Dort trägt man die Fundstelle ein. */
async function haengeAn(quelle: QuelleZumAnhaengen): Promise<void> {
    const id = await s.haengeAn(quelle);
    if (id === undefined) return;
    await nextTick();
    box.value?.oeffne(id);
}
</script>

<template>
    <div class="tq" :data-testid="`${kennung}-traeger-quellen`">
        <AvmHinweis v-if="s.lesefehler.value" ton="warnung" rolle="alert" :testid="`${kennung}-quellen-fehler`">
            {{ t("entwurf.lesefehler") }}
        </AvmHinweis>
        <p v-else-if="s.daten.value === undefined" class="tq__leise" :data-testid="`${kennung}-quellen-laedt`">
            {{ t("fenster.traegerQuellen.laedt") }}
        </p>
        <template v-else>
            <AvmHinweis v-if="grundSatz" ton="warnung" :testid="`${kennung}-quellen-sperre`">{{
                grundSatz
            }}</AvmHinweis>
            <AvmHinweis v-if="!lauf" :testid="`${kennung}-quellen-kein-lauf`">{{
                t("fenster.traegerQuellen.keinLauf")
            }}</AvmHinweis>
            <!-- OPS-000084: Der Fuß des Ortseditors zeigt hier ein graues „Speichern“; der Satz sagt, dass Quellen keines brauchen. Er gilt in jedem Editor, darum nennt er den Knopf nicht. -->
            <AvmHinweis v-if="bearbeitbar" :testid="`${kennung}-quellen-sofort`">{{
                t("fenster.traegerQuellen.sofort")
            }}</AvmHinweis>
            <QuellenKlappbox
                ref="box"
                :quellen="klappQuellen"
                :bearbeitbar="bearbeitbar"
                :katalog-satz="t('fenster.traegerQuellen.katalog')"
                :kennung="kennung"
                @aendere="(sourceId, angaben) => void s.aendere(sourceId, angaben)"
                @feld-schluss="void s.feldSchluss()"
                @loese="(sourceId: string) => void s.loese(sourceId)"
                @stelle-her="(sourceId: string) => void s.stelleHer(sourceId)"
                @auf-wiki="(sourceId: string) => void s.aufWiki(sourceId)"
                @oeffne="(sourceId: string) => emit('oeffneQuelle', sourceId)"
            >
                <template #anhaengen>
                    <QuellenAnhaengen
                        v-model:text="s.quelleText.value"
                        :treffer="s.quelleTreffer.value"
                        :laedt="s.quelleLaedt.value"
                        :schon-da="schonDa"
                        :gesperrt="s.anhaengenLaeuft.value ? '' : undefined"
                        :platzhalter="t('fenster.traegerQuellen.suche.platzhalter')"
                        :beschriftung="t('fenster.traegerQuellen.suche.beschriftung')"
                        :knopf="t('fenster.traegerQuellen.anhaengen')"
                        :kennung="kennung"
                        @waehle="haengeAn"
                    />
                    <AvmHinweis
                        v-if="s.anhaengenFehler.value"
                        ton="gefahr"
                        rolle="alert"
                        :testid="`${kennung}-quelle-neu-fehler`"
                    >
                        {{ fehlerSatz(s.anhaengenFehler.value) }}
                    </AvmHinweis>
                </template>
            </QuellenKlappbox>
        </template>
    </div>
</template>

<style scoped>
.tq {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    min-width: 0;
}

.tq__leise {
    margin: 0;
    color: var(--color-text-muted);
}
</style>
