<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type { MamKarteDetail } from "@avesmaps3d/shared";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import FensterKarte from "../fenster/fenster-karte.vue";
import FensterSpalte from "../fenster/fenster-spalte.vue";
import FensterVerweis from "../fenster/fenster-verweis.vue";
import { t } from "../i18n/i18n";
import type { Geladen } from "./medien-daten";
import MedienKarteEntfernenFenster from "./medien-karte-entfernen-fenster.vue";
import MedienKarteBilder from "./medien-karte-bilder.vue";
import MedienKastenKarte from "./medien-kasten-karte.vue";
import MedienKastenLinks from "./medien-kasten-links.vue";
import MedienKastenOrte from "./medien-kasten-orte.vue";
import MedienKastenPublikationen from "./medien-kasten-publikationen.vue";
import { kartenUnterzeile } from "./medien-karten-modell";
import { versionenDerKarte, type KartenRolle } from "./medien-karte-neu-modell";
import { createMedienClient, type MedienClient } from "./medien-client";
import type { MedienKartenziel } from "./medien-zustand";
import type { MedienOperationen } from "./medien-operationen";
import { Handlung, operationsFehler } from "./medien-operationen";

/**
 * Spalte 3 für eine Karte der Kartensammlung (WI-0068 R5). Von oben: Bilder mit der Entscheidung der Policy an genau dieser Stelle
 * (dieselbe wie Reverse Usage), dann die Angaben (die Zeilen des Katalogs, dazu die internen; bearbeitbar im Kasten, `medien-kasten-karte.vue`),
 * die Orte und Regionen (bearbeitbar im Kasten, `medien-kasten-orte.vue`, WI-0287 Stufe 3), die Bezüge zu anderen Karten und die Fundstellen.
 *
 * - **„Im Inspector öffnen“** an einem Bild wechselt zur Ansicht des Werks (Rechte, Entstehung, Verwendungen).
 * - **„Auf Karte zeigen“** bei Orten, Herrschaftsgebieten und Regionen, die nicht stillgelegt sind; eine Region öffnet als Fläche (`MedienKartenziel`).
 * - **Bearbeiten** (Betreiber 2026-10-18 „B jetzt“): nur die Angaben und Typen, mit `upload_media`. Der Satz oben sagt, ob ein Mensch die
 *   Karte schon geändert hat: Dann lässt der Legacy-Zug sie stehen und meldet Abweichungen als Befund. Orte und Bezüge
 *   bleiben beim Import (spätere Datenzüge).
 * - **Publikationen** (WI-0287 Punkt 4): der Kasten `medien-kasten-publikationen.vue` über den Fundstellen, die Quellen des Eintrags in der Quellen-Klappbox (`quellenRecht`: neue Quelle
 *   per Link anlegen, „Quelle bearbeiten“, das öffnet `oeffneQuelle`).
 * - **Fundstellen** (WI-0287 Punkt 3): der Kasten `medien-kasten-links.vue` bearbeitet die Links; die Wiki-Zuordnung steht darunter lesend.
 * - **Bilder zuweisen, ändern, lösen, hochladen** (WI-0287): der Kasten „Bilder“ hat zwei Plätze, „Die Karte“ und „Die Vorschau“ (`medien-karte-bilder.vue`).
 * - **Entfernen und Zurückholen** (WI-0287): unten die Karte „Sonstige Aktionen zum Eintrag“ (im Inspector eines Bildes bleibt es „Handlungen“). Ein entfernter Eintrag ist stillgelegt, nie gelöscht; oben steht
 *   der Hinweis, nichts ist bearbeitbar, und „↺ Zurückholen“ macht ihn für Besucher wieder sichtbar. Gingen seine Bilder beim Entfernen an einen anderen Eintrag
 *   (Stufe 2, `handedTo`), nennt der Hinweis ihn; Zurückholen lässt sie dort.
 */
const props = defineProps<{
    karte: Geladen<MamKarteDetail>;
    telefon: boolean;
    bearbeitbar: boolean;
    /** Das Recht `manage_sources` (WI-0287): eine neue Publikation im Quellenverzeichnis anlegen und „Quelle bearbeiten“. */
    quellenRecht?: boolean | undefined;
    operationen: MedienOperationen;
    client?: MedienClient | undefined;
    /** „Vorschau erzeugen“ aus dem Inspector mit Namenskonflikt (WI-0287 Punkt 5): der Platz „Die Vorschau“ dieses Eintrags zeigt den Konflikt. */
    erzeugenAnstoss?: string | undefined;
}>();
const emit = defineEmits<{
    oeffneBild: [assetId: string];
    anstossErledigt: [];
    /** „Quelle bearbeiten“ an einer Publikation: im Fenster „Inhalte bearbeiten“, Reiter Quellen (WI-0287). */
    oeffneQuelle: [sourceId: string];
    karte: [id: string];
    aufKarte: [ziel: MedienKartenziel];
    erneut: [];
    zurueck: [];
    /**
     * Der Eintrag ist entfernt (stillgelegt) bzw. zurückgeholt: Liste, Zahlen und Wahl ziehen nach (`medien-fenster.vue`). `ziel`: der Eintrag, der die Bilder bekam;
     * `uebergeben`: Die Bilder waren vorher an einen anderen gegangen und bleiben dort.
     */
    entfernt: [id: string, ziel: { id: string; title: string } | undefined];
    zurueckgeholt: [id: string, uebergeben: boolean];
    /** Ein Bild des Eintrags ist zugewiesen, geändert, gelöst oder hochgeladen: Eintrag, Liste und Zahlen lesen neu. */
    bilderGeaendert: [];
    /** Aus dem Satz „Liegt jetzt unter Karten als …“ in die Liste, das Werk gewählt. */
    zurListe: [rolle: KartenRolle, assetId: string];
}>();

const k = computed(() => props.karte.wert);
const darfQuellen = computed(() => props.quellenRecht === true);
const satz = computed(() =>
    k.value?.editorHeld
        ? t("medien.karten.gehalten")
        : props.bearbeitbar
          ? t("medien.karten.ausLegacy")
          : t("medien.karten.nurLesen"),
);
/** Bearbeitbar ist nur ein aktiver Eintrag; ein stillgelegter lässt sich nur zurückholen. */
const aenderbar = computed(() => props.bearbeitbar && k.value?.active === true);
const linksKasten = ref<InstanceType<typeof MedienKastenLinks> | null>(null);
/** Vom Platz „Die Karte“: den Kasten „Fundstellen“ öffnen, der Fokus steht in der ersten Adresse. */
function oeffneLinks(): void {
    linksKasten.value?.oeffnen();
}
const entfernenOffen = ref(false);
/** Die Zielwahl des Entfernens liest die Liste und den gewählten Eintrag. */
const medienClient = props.client ?? createMedienClient();
function entfernt(_quittung: unknown, ziel: { id: string; title: string } | undefined): void {
    const karte = k.value;
    if (karte !== undefined) emit("entfernt", karte.id, ziel);
}
const zurueckLaeuft = ref(false);
const zurueckFehler = ref<string | undefined>(undefined);
const zurueckHandlung = new Handlung();

async function zurueckholen(): Promise<void> {
    const karte = k.value;
    if (karte === undefined || zurueckLaeuft.value) return;
    zurueckLaeuft.value = true;
    zurueckFehler.value = undefined;
    try {
        await zurueckHandlung.fuehreAus((operationId) =>
            props.operationen.karteZurueckholen(karte.id, { operationId, baseRevision: karte.revision }),
        );
        emit("zurueckgeholt", karte.id, karte.handedTo !== undefined && karte.handedTo !== null);
    } catch (error) {
        zurueckFehler.value = operationsFehler(error).text;
    } finally {
        zurueckLaeuft.value = false;
    }
}
// --- „Wird gerechnet …“ (WI-0287 Punkt 5): Solange ein Bild des Eintrags gerechnet wird (eine erzeugte Vorschau, `pending`), liest der Eintrag alle drei Sekunden neu, höchstens
// drei Minuten lang, wie der Inspector eines Werks. „Das Bild erscheint von selbst.“
const RECHNEN_TAKT = 3_000;
const RECHNEN_HOECHSTENS = 180_000;
let rechnenSeit: { id: string; seit: number } | undefined;
let rechnenTimer: ReturnType<typeof setTimeout> | undefined;
watch(
    () => k.value,
    (karte) => {
        if (rechnenTimer !== undefined) clearTimeout(rechnenTimer);
        rechnenTimer = undefined;
        if (karte === undefined || !karte.images.some((bild) => bild.technicalState === "pending")) {
            rechnenSeit = undefined;
            return;
        }
        if (rechnenSeit?.id !== karte.id) rechnenSeit = { id: karte.id, seit: Date.now() };
        if (Date.now() - rechnenSeit.seit > RECHNEN_HOECHSTENS) return;
        rechnenTimer = setTimeout(() => emit("erneut"), RECHNEN_TAKT);
    },
    { immediate: true },
);
onBeforeUnmount(() => {
    if (rechnenTimer !== undefined) clearTimeout(rechnenTimer);
});

function zeigeOrt(ziel: NonNullable<MamKarteDetail["places"][number]["target"]>): void {
    if (ziel.kind !== "place" && ziel.kind !== "territory" && ziel.kind !== "region") return;
    emit("aufKarte", { kind: ziel.kind, id: ziel.id, name: ziel.name, active: ziel.active });
}
</script>

<template>
    <FensterSpalte
        breite="inspektor"
        :telefon="telefon"
        :titel="k?.title ?? t('medien.objekt.kartensammlung')"
        :unterzeile="k ? kartenUnterzeile({ ...k, versions: versionenDerKarte(k).length }) || undefined : undefined"
        testid="medien-spalte-karte"
    >
        <template v-if="telefon" #zurueck>
            <AvmKnopf groesse="zeile" testid="medien-zurueck-karten" @click="emit('zurueck')">{{
                t("medien.zurueck.karten")
            }}</AvmKnopf>
        </template>

        <AvmHinweis v-if="karte.fehler" :ton="karte.fehler.ton" rolle="alert" testid="medien-karte-fehler">{{
            karte.fehler.text
        }}</AvmHinweis>
        <AvmKnopf v-if="karte.fehler?.erneut" groesse="zeile" testid="medien-karte-erneut" @click="emit('erneut')">{{
            t("medien.erneut")
        }}</AvmKnopf>
        <p v-if="karte.laedt && !k" class="karte__satz">{{ t("medien.treffer.laedt") }}</p>
        <p v-else-if="!k && !karte.fehler" class="karte__satz" data-testid="medien-karte-keine">
            {{ t("medien.karten.keineGewaehlt") }}
        </p>

        <template v-if="k">
            <AvmHinweis v-if="!k.active" ton="warnung" testid="medien-karte-stillgelegt-hinweis">{{
                k.handedTo
                    ? t("medien.karten.stillgelegtAn", { titel: k.handedTo.title })
                    : t("medien.karten.stillgelegt")
            }}</AvmHinweis>
            <p class="karte__satz" data-testid="medien-karte-herkunft">{{ satz }}</p>

            <MedienKarteBilder
                :karte="k"
                :bearbeitbar="aenderbar"
                :operationen="operationen"
                :client="client"
                :erzeugen-anstoss="erzeugenAnstoss"
                @oeffne-bild="(id: string) => emit('oeffneBild', id)"
                @anstoss-erledigt="emit('anstossErledigt')"
                @geaendert="emit('bilderGeaendert')"
                @links="oeffneLinks"
                @zur-liste="(rolle: KartenRolle, id: string) => emit('zurListe', rolle, id)"
            />

            <MedienKastenKarte
                :key="k.id"
                :karte="k"
                :bearbeitbar="aenderbar"
                :operationen="operationen"
                @gespeichert="emit('erneut')"
                @neu-laden="emit('erneut')"
            />

            <MedienKastenOrte
                :key="`orte-${k.id}`"
                :karte="k"
                :bearbeitbar="aenderbar"
                :operationen="operationen"
                @geaendert="emit('erneut')"
                @auf-karte="zeigeOrt"
            />

            <FensterKarte v-if="k.parent || k.related.length > 0" :titel="t('medien.karten.abschnitt.bezuege')">
                <ul class="karte__liste" data-testid="medien-karte-bezuege">
                    <li v-if="k.parent" class="karte__ort">
                        <span class="karte__l2">{{ t("medien.karten.teilVon") }}</span>
                        <button type="button" class="karte__verweis" @click="emit('karte', k.parent.id)">
                            {{ k.parent.title }}
                        </button>
                    </li>
                    <li v-for="andere in k.related" :key="andere.id" class="karte__ort">
                        <span class="karte__l2">{{ t("medien.karten.verwandt") }}</span>
                        <button type="button" class="karte__verweis" @click="emit('karte', andere.id)">
                            {{ andere.title }}
                        </button>
                    </li>
                </ul>
            </FensterKarte>

            <MedienKastenPublikationen
                v-if="aenderbar || (k.publications ?? []).length > 0"
                :key="`publikationen-${k.id}`"
                :karte="k"
                :bearbeitbar="aenderbar"
                :quellen-recht="darfQuellen"
                :operationen="operationen"
                @geaendert="emit('erneut')"
                @oeffne-quelle="(sourceId: string) => emit('oeffneQuelle', sourceId)"
            />

            <MedienKastenLinks
                v-if="aenderbar || k.links.length > 0 || k.wiki"
                :key="`links-${k.id}`"
                ref="linksKasten"
                :karte="k"
                :bearbeitbar="aenderbar"
                :operationen="operationen"
                @gespeichert="emit('erneut')"
                @neu-laden="emit('erneut')"
            >
                <template #weiteres>
                    <ul v-if="k.wiki" class="karte__liste" data-testid="medien-karte-wiki">
                        <li class="karte__ort">
                            <span class="karte__l2">{{ t("medien.karten.wiki") }}</span>
                            <FensterVerweis v-if="k.wiki.url" :ziel="k.wiki.url">{{
                                k.wiki.title ?? k.wiki.url
                            }}</FensterVerweis>
                            <span v-else>{{ k.wiki.title }}</span>
                        </li>
                    </ul>
                </template>
            </MedienKastenLinks>

            <FensterKarte v-if="bearbeitbar && k.state !== 'suppressed'" :titel="t('medien.karten.abschnitt.aktionen')">
                <div class="karte__handlungen" data-testid="medien-karte-handlungen">
                    <AvmKnopf
                        v-if="k.active"
                        art="gefahr"
                        testid="medien-karte-entfernen"
                        @click="entfernenOffen = true"
                    >
                        <template #zeichen>✕</template>
                        {{ t("medien.karten.entfernen.knopf") }}
                    </AvmKnopf>
                    <AvmKnopf
                        v-else-if="k.state === 'retired'"
                        :gesperrt="zurueckLaeuft ? t('medien.bearbeiten.sendet') : undefined"
                        testid="medien-karte-zurueckholen"
                        @click="zurueckholen"
                    >
                        <template #zeichen>↺</template>
                        {{ t("medien.karten.zurueckholen") }}
                    </AvmKnopf>
                    <AvmHinweis
                        v-if="zurueckFehler"
                        ton="gefahr"
                        rolle="alert"
                        testid="medien-karte-zurueckholen-fehler"
                        >{{ zurueckFehler }}</AvmHinweis
                    >
                </div>
            </FensterKarte>
        </template>

        <MedienKarteEntfernenFenster
            v-if="entfernenOffen && k"
            v-model:offen="entfernenOffen"
            :karte="k"
            :operationen="operationen"
            :client="medienClient"
            @fertig="entfernt"
            @neu-laden="emit('erneut')"
        />
    </FensterSpalte>
</template>

<style scoped>
.karte__satz {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.karte__handlungen {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-4);
}

.karte__liste {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    margin: 0;
    padding: 0;
    list-style: none;
}

.karte__ort {
    display: flex;
    align-items: center;
    gap: var(--space-6);
    min-width: 0;
}

.karte__text {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
}

.karte__name {
    color: var(--color-text-strong);
    font-size: var(--font-size-body);
}

.karte__l2 {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.karte__verweis {
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-link);
    cursor: pointer;
    font: inherit;
    text-align: left;
}

.karte__verweis:hover {
    color: var(--color-link-hover);
    text-decoration: underline;
}

.karte__verweis:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}
</style>
