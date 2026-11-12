<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef } from "vue";
import type { MamKarteDetail } from "@avesmaps3d/shared";
import AvmHinweis from "../controls/avm-hinweis.vue";
import FensterKarte from "../fenster/fenster-karte.vue";
import type { QuelleZumAnhaengen } from "../fenster/quelle-per-link-steuerung";
import QuellenAnhaengen from "../fenster/quellen-anhaengen.vue";
import QuellenKlappbox from "../fenster/quellen-klappbox.vue";
import type { KlappAngaben, KlappQuelle } from "../fenster/quellen-klappbox-modell";
import { formatNumber, t } from "../i18n/i18n";
import { createPublikationenSteuerung, type PublikationenOptionen } from "./medien-karte-publikationen-steuerung";
import MedienKastenKnopf from "./medien-kasten-knopf.vue";
import type { MedienOperationen } from "./medien-operationen";

/**
 * Der Kasten „Publikationen (n)“ einer Karte der Kartensammlung (WI-0287 Stufe 1, Punkt 4; Entwurf Fassung 5: `kastenPublikation`, `pubZeile`, `zeichnePubTreffer`). Die Quellen des Eintrags
 * (`citymap_source`) in der Quellen-Klappbox der Karteneditoren, mit Umschlagbild und Folge (`publikationen`), keine zweite Liste; gesucht wird mit `QuellenAnhaengen`.
 *
 * - **Sofort speichern** (Betreiber 2026-10-28): „✚ Publikation“ im Kopf öffnet die Suche, ein Treffer hängt an und klappt auf, die Fundstelle speichert beim Verlassen des Felds, Lösen, Wiederherstellen
 *   und „↑ Zuerst zeigen“ sofort (`medien-karte-publikationen-steuerung.ts`). Die erste aktive ist der Band; bei mehr als einer sagt ein Satz, dass Besucher alle unter „Bände“ sehen.
 * - **Rechte:** Anhängen, Fundstelle, Lösen, Holen und Reihenfolge mit dem Recht der Sammlung (`bearbeitbar`). Eine neue Quelle im Verzeichnis anlegen (per Link) und „Quelle bearbeiten“ nur mit
 *   `manage_sources` (`quellenRecht`); ohne es sagt die Suche, wer neue Publikationen anlegt. Stillgelegte Einträge und Reviewer lesen nur.
 */
const props = defineProps<{
    karte: MamKarteDetail;
    bearbeitbar: boolean;
    /** Das Recht `manage_sources`: eine neue Quelle per Link anlegen und „Quelle bearbeiten“. */
    quellenRecht: boolean;
    operationen: MedienOperationen;
    /** Nur Tests: eine eigene Suche. */
    optionen?: PublikationenOptionen | undefined;
}>();
const emit = defineEmits<{
    /** Eine Publikation hat sich geändert: Eintrag (Revision, Liste) neu lesen. */
    geaendert: [];
    /** „Quelle bearbeiten“: im Fenster „Inhalte bearbeiten“, Reiter Quellen, diese Quelle wählen. */
    oeffneQuelle: [sourceId: string];
}>();

const s = createPublikationenSteuerung(
    () => props.karte,
    props.operationen,
    () => emit("geaendert"),
    props.optionen,
);
const suchOffen = ref(false);
const publikationen = computed(() => props.karte.publications ?? []);
const aktive = computed(() => publikationen.value.filter((p) => p.state === "active").length);
const titel = computed(() =>
    aktive.value > 0
        ? t("medien.karten.publikationen.titel", { n: formatNumber(aktive.value, 0) })
        : t("medien.karten.abschnitt.publikationen"),
);
const klappQuellen = computed<readonly KlappQuelle[]>(() =>
    publikationen.value.map((p) => ({
        id: p.sourceId,
        titel: p.title,
        art: null,
        seiten: s.eingaben.value.get(p.sourceId) ?? p.pages ?? "",
        notiz: "",
        typ: p.sourceType,
        offiziell: p.offiziell,
        url: p.url,
        kreis: null,
        state: p.state,
        neu: false,
        schreibt: s.schreibend.value.has(p.sourceId),
        fehler: s.fehler.value.get(p.sourceId),
        bild: p.umschlag?.url ?? null,
    })),
);
const schonDa = (sourceId: string): boolean =>
    publikationen.value.some((p) => p.sourceId === sourceId && p.state === "active");

const box = useTemplateRef<InstanceType<typeof QuellenKlappbox>>("box");
async function haengeAn(quelle: QuelleZumAnhaengen): Promise<void> {
    const id = await s.haengeAn(quelle);
    if (id === undefined) return;
    suchOffen.value = false;
    await nextTick();
    box.value?.oeffne(id);
}
function aendere(sourceId: string, angaben: KlappAngaben): void {
    if (angaben.pages !== undefined) s.seiten(sourceId, angaben.pages);
}
</script>

<template>
    <FensterKarte :titel="titel" data-testid="medien-kasten-publikationen">
        <template #etikett>
            <MedienKastenKnopf
                v-if="bearbeitbar"
                zeichen="✚"
                testid="medien-publikation-neu"
                :aria-expanded="suchOffen"
                @click="suchOffen = !suchOffen"
                >{{ t("medien.karten.publikationen.neu") }}</MedienKastenKnopf
            >
        </template>
        <div v-if="suchOffen && bearbeitbar" class="publikationen__suche">
            <QuellenAnhaengen
                v-model:text="s.quelleText.value"
                :treffer="s.quelleTreffer.value"
                :laedt="s.quelleLaedt.value"
                :schon-da="schonDa"
                :gesperrt="s.anhaengenLaeuft.value ? '' : undefined"
                :platzhalter="
                    quellenRecht ? t('medien.karten.publikationen.sucheLink') : t('medien.karten.publikationen.suche')
                "
                :beschriftung="t('medien.karten.publikationen.beschriftung')"
                :knopf="t('medien.karten.publikationen.neu')"
                kennung="medien-publikation"
                umschlag
                :per-link="quellenRecht"
                :kein-treffer="quellenRecht ? undefined : t('medien.karten.publikationen.keinRecht')"
                @waehle="haengeAn"
            />
            <AvmHinweis
                v-if="s.anhaengenFehler.value"
                ton="gefahr"
                rolle="alert"
                testid="medien-publikation-anhaengen-fehler"
                >{{ s.anhaengenFehler.value }}</AvmHinweis
            >
        </div>
        <QuellenKlappbox
            ref="box"
            :quellen="klappQuellen"
            :bearbeitbar="bearbeitbar"
            katalog-satz=""
            kennung="medien-publikation"
            publikationen
            :oeffnen="quellenRecht"
            @aendere="aendere"
            @feld-schluss="void s.feldSchluss()"
            @loese="(sourceId: string) => void s.loese(sourceId)"
            @stelle-her="(sourceId: string) => void s.stelleHer(sourceId)"
            @zuerst="(sourceId: string) => void s.zuerst(sourceId)"
            @oeffne="(sourceId: string) => emit('oeffneQuelle', sourceId)"
        />
        <AvmHinweis v-if="s.geloest.value" rolle="status" testid="medien-publikation-geloest">{{
            t("medien.karten.publikationen.geloest")
        }}</AvmHinweis>
        <p v-if="aktive > 1" class="publikationen__satz" data-testid="medien-publikationen-baende">
            {{ t("medien.karten.publikationen.baende") }}
        </p>
    </FensterKarte>
</template>

<style scoped>
.publikationen__suche {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
}

.publikationen__satz {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}
</style>
