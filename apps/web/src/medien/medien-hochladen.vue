<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, watch } from "vue";
import {
    KARTE_VERSION_MAX,
    MEDIA_CREATION_METHODS,
    MEDIA_EVIDENCE_KINDS,
    MEDIA_KARTE_DATEI,
    MEDIA_RIGHTS_BASES,
    type MediaCreationMethod,
    type MediaLicenseInfo,
} from "@avesmaps3d/shared";
import AvmAuswahl from "../controls/avm-auswahl.vue";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmTextbereich from "../controls/avm-textbereich.vue";
import { t } from "../i18n/i18n";
import {
    WEG_TEXT,
    belegFelder,
    type HochladeRolle,
    type HochladeStand,
    type HochladenWeg,
    type SatzTon,
} from "./medien-formular-modell";
import { datumZeit, entstehungName, groesse, rechtsgrundName } from "./medien-text";

/**
 * Das gemeinsame Formular „Neues … hochladen“ der Medienverwaltung (WI-0068 P4b, WI-0126 §11j, Gesamtmockup Version 6 und 7): nur
 * die Felder. Das Fenster drumherum (`medien-hochladen-fenster.vue`) hält Stand, Prüfung und Senden; MAM-Fenster und Ortseditor
 * (EDIT-0001 E19) betten dasselbe Fenster ein.
 *
 * - **Zwei Spalten:** links die Datei mit Vorschau, der Name in der Liste und die Herkunft „Hochgeladen von · Am · Weg“ (automatisch,
 *   getrennt vom Urheber); rechts Erstellung und Rechte samt Beleg. Ist der Platz zu schmal, stehen sie untereinander.
 * - **Was nicht gilt, steht nicht da:** Werkzeug, Modell und Prompt nur bei „KI-erzeugt“, die Lizenz nur bei der Grundlage „Lizenz“,
 *   beim Beleg nur die Felder seiner Art.
 * - **Freigeben beim Hochladen** (WI-0282): Mit `review_media_rights` ein Kästchen, auch am eigenen Bild; ohne das Recht steht dort ein Satz.
 * - Befunde stehen am Feld, dazu `aria-invalid`; der Satz der Policy steht unter dem Formular.
 * - **Karte und Vorschau der Kartensammlung** (WI-0287, Rollen `map_full` und `map_preview`): JPEG, PNG, WebP oder PDF (ein PDF zeigt „PDF“ statt der Vorschau); unter dem Namen
 *   ist Platz für den Hinweis auf einen gleichnamigen Eintrag der Liste (Platz `nach-titel`), bei der Karte das Feld „Version“ (`versionSatz`, Stufe 2).
 */
const props = defineProps<{
    rolle: HochladeRolle;
    /** Wer hochlädt (Anzeigename der Sitzung); die Provenienz setzt der Server. */
    hochlader: string;
    /** Wo hochgeladen wird: im Ortseditor oder in der Medienverwaltung. */
    weg: HochladenWeg;
    lizenzen: readonly MediaLicenseInfo[];
    befunde: ReadonlyMap<string, string>;
    satz: { text: string; ton: SatzTon };
    /** Ein Hinweis zur gewählten Datei, der kein Befund ist (ein Wappen wird zum Quadrat aufgefüllt). */
    dateiHinweis?: string | undefined;
    /** Während des Sendens: alle Felder ruhen. */
    gesperrt: boolean;
    /** Wer `review_media_rights` hat, gibt das Bild gleich beim Hochladen frei (WI-0282). */
    kannFreigeben?: boolean | undefined;
    /**
     * Mehrere Dateien auf einmal (Stapel, WI-0068 MAM-R3): Die Dateien zeigt der Platz `dateien`, und den Titel vergibt die Galerie beim
     * Einordnen nach der Namensregel; das Namensfeld entfällt.
     */
    ohneTitel?: boolean | undefined;
    /**
     * Nur diese Entstehungen stehen zur Wahl (WI-0281: ein Typbild ohne KI nur Foto, Zeichnung, Scan); „unbekannt“ bleibt als Anfang stehen und ist ein Befund, bis
     * ein Mensch wählt. Dazu steht der Satz, warum (`entstehungSatz`).
     */
    entstehungen?: readonly MediaCreationMethod[] | undefined;
    entstehungSatz?: string | undefined;
    /**
     * Nur eine Karte der Kartensammlung (WI-0287 Stufe 2, Entwurf Feld `f-version`): Unter dem Namen steht das Feld „Version“ (die Bezeichnung, `v-model:version`) mit diesem
     * Satz darunter („Leer lassen, wenn es nur eine gibt.“ bzw. „Diese Karte hat schon eine Version. Die neue kommt dazu.“). Ohne den Satz kein Feld.
     */
    versionSatz?: string | undefined;
}>();
const stand = defineModel<HochladeStand>("stand", { required: true });
const datei = defineModel<File | undefined>("datei", { required: true });
const version = defineModel<string>("version", { default: "" });

const id = useId();
const kennung = (feld: string): string => `${id}-${feld}`;
const befund = (pfad: string): string | undefined => props.befunde.get(pfad);
const ruht = computed(() => (props.gesperrt ? "" : undefined));

const ki = computed(() => stand.value.entstehung.art === "ai_generated");
const lizenz = computed(() => stand.value.rechte.grundlage === "license");
const beleg = computed(() => belegFelder(stand.value.beleg.art));
const svgErlaubt = computed(() => props.rolle === "coat");
const karte = computed(() => props.rolle === "map_full" || props.rolle === "map_preview");
const annehmen = computed(() =>
    karte.value
        ? MEDIA_KARTE_DATEI.types.join(",")
        : ["image/png", "image/webp", "image/jpeg", "image/gif", ...(svgErlaubt.value ? ["image/svg+xml"] : [])].join(
              ",",
          ),
);
const istPdf = computed(() => datei.value?.type === "application/pdf");
/** Der Satz in der leeren Ablage: welche Dateien und wie groß. */
const typenSatz = computed(() =>
    t(
        props.rolle === "map_full"
            ? "medien.formular.typenKarte"
            : props.rolle === "map_preview"
              ? "medien.formular.typenKartenvorschau"
              : svgErlaubt.value
                ? "medien.formular.typenWappen"
                : "medien.formular.typenBild",
    ),
);

const artOptionen = computed(() =>
    MEDIA_CREATION_METHODS.filter(
        (art) => props.entstehungen === undefined || art === "unknown" || props.entstehungen.includes(art),
    ).map((art) => ({
        wert: art,
        // „unbekannt“ ist dort, wo es nicht gilt, nur der Anfang der Wahl.
        text:
            art === "unknown" && props.entstehungen !== undefined && !props.entstehungen.includes(art)
                ? t("medien.formular.bitteWaehlen")
                : entstehungName(art),
    })),
);
const grundlageOptionen = computed(() => [
    { wert: "", text: t("medien.formular.bitteWaehlen") },
    ...MEDIA_RIGHTS_BASES.map((basis) => ({ wert: basis, text: rechtsgrundName(basis) })),
]);
const lizenzOptionen = computed(() => [
    { wert: "", text: t("medien.formular.bitteWaehlen") },
    ...props.lizenzen.map((eintrag) => ({ wert: eintrag.key, text: eintrag.displayName })),
]);
const belegOptionen = computed(() => [
    { wert: "", text: t("medien.formular.belegKeiner") },
    ...MEDIA_EVIDENCE_KINDS.map((art) => ({ wert: art, text: t(`medien.beleg.${art}`) })),
]);

// --- Die Datei: wählen oder ziehen, Vorschau aus dem Speicher des Browsers ---

const vorschau = ref<string | undefined>(undefined);
watch(
    datei,
    (neu) => {
        if (vorschau.value !== undefined) URL.revokeObjectURL(vorschau.value);
        vorschau.value = neu === undefined ? undefined : URL.createObjectURL(neu);
    },
    { immediate: true },
);
onBeforeUnmount(() => {
    if (vorschau.value !== undefined) URL.revokeObjectURL(vorschau.value);
});

const ziehtUeber = ref(false);
function gewaehlt(event: Event): void {
    const eingabe = event.target as HTMLInputElement;
    datei.value = eingabe.files?.[0] ?? datei.value;
    eingabe.value = "";
}
function abgelegt(event: DragEvent): void {
    ziehtUeber.value = false;
    if (props.gesperrt) return;
    const neu = event.dataTransfer?.files[0];
    if (neu !== undefined) datei.value = neu;
}
function belegGewaehlt(event: Event): void {
    const eingabe = event.target as HTMLInputElement;
    stand.value.beleg.datei = eingabe.files?.[0] ?? stand.value.beleg.datei;
    eingabe.value = "";
}

const jetzt = datumZeit(new Date().toISOString());
</script>

<template>
    <div class="hochladen" data-testid="medien-hochladen">
        <div class="hochladen__spalten">
            <section class="hochladen__links">
                <slot v-if="$slots.dateien" name="dateien" />
                <label
                    v-else
                    class="hochladen__ablage"
                    :class="{
                        'is-ueber': ziehtUeber,
                        'is-ungueltig': befund('file') !== undefined,
                        'is-gesperrt': gesperrt,
                    }"
                    data-testid="medien-hochladen-ablage"
                    @dragover.prevent="ziehtUeber = !gesperrt"
                    @dragleave="ziehtUeber = false"
                    @drop.prevent="abgelegt"
                >
                    <input
                        class="hochladen__datei-eingabe"
                        type="file"
                        :accept="annehmen"
                        :disabled="gesperrt"
                        :aria-invalid="befund('file') !== undefined ? 'true' : undefined"
                        data-testid="medien-hochladen-datei"
                        @change="gewaehlt"
                    />
                    <span class="hochladen__vorschau" :class="`hochladen__vorschau--${rolle}`">
                        <span v-if="istPdf" class="hochladen__pdf" data-testid="medien-hochladen-pdf">PDF</span>
                        <img v-else-if="vorschau" :src="vorschau" alt="" data-testid="medien-hochladen-vorschau" />
                        <span v-else class="hochladen__plus" aria-hidden="true">↥</span>
                    </span>
                    <span class="hochladen__ablage-text">
                        <strong>{{ datei ? datei.name : t("medien.formular.dateiWaehlen") }}</strong>
                        <span class="hochladen__klein">{{
                            datei
                                ? istPdf
                                    ? t("medien.formular.pdfGroesse", { groesse: groesse(datei.size) })
                                    : groesse(datei.size)
                                : typenSatz
                        }}</span>
                    </span>
                </label>
                <span
                    v-if="!$slots.dateien && befund('file')"
                    class="hochladen__befund"
                    role="alert"
                    data-testid="medien-hochladen-dateibefund"
                    >{{ befund("file") }}</span
                >
                <span
                    v-else-if="!$slots.dateien && dateiHinweis"
                    class="hochladen__klein"
                    data-testid="medien-hochladen-dateihinweis"
                    >{{ dateiHinweis }}</span
                >

                <p v-if="ohneTitel" class="hochladen__klein" data-testid="medien-hochladen-titelregel">
                    {{ t("medien.stapel.titelRegel") }}
                </p>
                <div v-else class="hochladen__zeilen">
                    <label :for="kennung('titel')">{{ t("medien.formular.name") }}</label>
                    <span class="hochladen__wert">
                        <AvmEingabe
                            :id="kennung('titel')"
                            v-model="stand.titel"
                            :ungueltig="befund('title') !== undefined"
                            :gesperrt="ruht"
                            testid="medien-hochladen-titel"
                        />
                        <span v-if="befund('title')" class="hochladen__befund">{{ befund("title") }}</span>
                    </span>
                    <template v-if="versionSatz !== undefined">
                        <label :for="kennung('version')">{{ t("medien.karten.version.feld") }}</label>
                        <span class="hochladen__wert">
                            <AvmEingabe
                                :id="kennung('version')"
                                v-model="version"
                                :placeholder="t('medien.karten.version.platzhalter')"
                                :gesperrt="ruht"
                                :maxlength="KARTE_VERSION_MAX"
                                testid="medien-hochladen-version"
                            />
                            <span class="hochladen__klein" data-testid="medien-hochladen-version-satz">{{
                                versionSatz
                            }}</span>
                        </span>
                    </template>
                </div>

                <slot name="nach-titel" />

                <dl class="hochladen__herkunft" data-testid="medien-hochladen-herkunft">
                    <dt>{{ t("medien.formular.hochgeladenVon") }}</dt>
                    <dd>{{ hochlader }}</dd>
                    <dt>{{ t("medien.formular.am") }}</dt>
                    <dd>{{ jetzt }}</dd>
                    <dt>{{ t("medien.formular.weg") }}</dt>
                    <dd>
                        {{ t(WEG_TEXT[weg]) }}
                    </dd>
                </dl>
                <p class="hochladen__klein">{{ t("medien.inspektor.urheberNichtHochlader") }}</p>
            </section>

            <section class="hochladen__rechts">
                <fieldset class="hochladen__gruppe" :disabled="gesperrt">
                    <legend>{{ t("medien.formular.erstellung") }}</legend>
                    <div class="hochladen__zeilen">
                        <label :for="kennung('art')">{{ t("medien.formular.art") }}</label>
                        <span class="hochladen__wert">
                            <AvmAuswahl
                                :id="kennung('art')"
                                v-model="stand.entstehung.art"
                                :optionen="artOptionen"
                                :aria-invalid="befund('creationMethod') !== undefined ? 'true' : undefined"
                                testid="medien-hochladen-art"
                            />
                            <span v-if="befund('creationMethod')" class="hochladen__befund">{{
                                entstehungSatz ?? befund("creationMethod")
                            }}</span>
                            <span
                                v-else-if="entstehungSatz !== undefined"
                                class="hochladen__klein"
                                data-testid="medien-hochladen-art-satz"
                                >{{ entstehungSatz }}</span
                            >
                        </span>
                        <label :for="kennung('urheber')">{{ t("medien.formular.urheber") }}</label>
                        <AvmEingabe
                            :id="kennung('urheber')"
                            v-model="stand.rechte.urheber"
                            :placeholder="t('medien.formular.urheberHinweis')"
                            testid="medien-hochladen-urheber"
                        />
                        <template v-if="ki">
                            <label :for="kennung('werkzeug')">{{ t("medien.formular.werkzeug") }}</label>
                            <AvmEingabe :id="kennung('werkzeug')" v-model="stand.entstehung.werkzeug" />
                            <label :for="kennung('modell')">{{ t("medien.formular.modell") }}</label>
                            <AvmEingabe :id="kennung('modell')" v-model="stand.entstehung.modell" />
                            <label :for="kennung('prompt')" class="oben">{{ t("medien.formular.prompt") }}</label>
                            <span class="hochladen__wert">
                                <AvmTextbereich
                                    :id="kennung('prompt')"
                                    v-model="stand.entstehung.prompt"
                                    :zeilen="3"
                                    :ungueltig="befund('creation.prompt') !== undefined"
                                    testid="medien-hochladen-prompt"
                                />
                                <span class="hochladen__klein">{{ t("medien.formular.nurEditoren") }}</span>
                            </span>
                            <label :for="kennung('negativ')" class="oben">{{ t("medien.formular.negativ") }}</label>
                            <AvmTextbereich
                                :id="kennung('negativ')"
                                v-model="stand.entstehung.negativPrompt"
                                :zeilen="2"
                            />
                        </template>
                    </div>
                </fieldset>

                <fieldset class="hochladen__gruppe" :disabled="gesperrt">
                    <legend>{{ t("medien.formular.rechte") }}</legend>
                    <div class="hochladen__zeilen">
                        <label :for="kennung('grundlage')">{{ t("medien.formular.grundlage") }}</label>
                        <span class="hochladen__wert">
                            <AvmAuswahl
                                :id="kennung('grundlage')"
                                v-model="stand.rechte.grundlage"
                                :optionen="grundlageOptionen"
                                :aria-invalid="befund('rights.basis') !== undefined ? 'true' : undefined"
                                testid="medien-hochladen-grundlage"
                            />
                            <span v-if="befund('rights.basis')" class="hochladen__befund">{{
                                befund("rights.basis")
                            }}</span>
                        </span>
                        <template v-if="lizenz">
                            <label :for="kennung('lizenz')">{{ t("medien.formular.lizenz") }}</label>
                            <span class="hochladen__wert">
                                <AvmAuswahl
                                    :id="kennung('lizenz')"
                                    v-model="stand.rechte.lizenz"
                                    :optionen="lizenzOptionen"
                                    :aria-invalid="befund('rights.licenseKey') !== undefined ? 'true' : undefined"
                                    testid="medien-hochladen-lizenz"
                                />
                                <span v-if="befund('rights.licenseKey')" class="hochladen__befund">{{
                                    befund("rights.licenseKey")
                                }}</span>
                            </span>
                        </template>
                        <label :for="kennung('namensnennung')">{{ t("medien.formular.namensnennung") }}</label>
                        <span class="hochladen__wert">
                            <AvmEingabe
                                :id="kennung('namensnennung')"
                                v-model="stand.rechte.namensnennung"
                                :placeholder="t('medien.formular.namensnennungHinweis')"
                                :ungueltig="befund('rights.attribution') !== undefined"
                                testid="medien-hochladen-namensnennung"
                            />
                            <span v-if="befund('rights.attribution')" class="hochladen__befund">{{
                                befund("rights.attribution")
                            }}</span>
                        </span>
                        <label :for="kennung('inhaber')">{{ t("medien.formular.rechteinhaber") }}</label>
                        <AvmEingabe
                            :id="kennung('inhaber')"
                            v-model="stand.rechte.rechteinhaber"
                            :placeholder="t('medien.formular.rechteinhaberHinweis')"
                        />
                        <label :for="kennung('herkunft')">{{ t("medien.formular.herkunft") }}</label>
                        <AvmEingabe
                            :id="kennung('herkunft')"
                            v-model="stand.herkunft"
                            :placeholder="t('medien.formular.herkunftHinweis')"
                            testid="medien-hochladen-herkunft-feld"
                        />
                        <label :for="kennung('beleg')">{{ t("medien.formular.beleg") }}</label>
                        <AvmAuswahl
                            :id="kennung('beleg')"
                            v-model="stand.beleg.art"
                            :optionen="belegOptionen"
                            testid="medien-hochladen-beleg"
                        />
                        <div
                            v-if="stand.beleg.art !== ''"
                            class="hochladen__beleg breit"
                            data-testid="medien-hochladen-belegkasten"
                        >
                            <span v-if="beleg.datei" class="hochladen__beleg-datei">
                                <label class="hochladen__beleg-knopf">
                                    <input
                                        class="hochladen__datei-eingabe"
                                        type="file"
                                        accept=".pdf,.txt,.eml,.png,.jpg,.jpeg,.gif,.webp"
                                        data-testid="medien-hochladen-belegdatei"
                                        @change="belegGewaehlt"
                                    />
                                    <span class="avm-versalmitte">{{ t("medien.formular.belegAnhaengen") }}</span>
                                </label>
                                <span class="hochladen__klein">{{
                                    stand.beleg.datei
                                        ? `${stand.beleg.datei.name} (${groesse(stand.beleg.datei.size)})`
                                        : t("medien.formular.belegOhneDatei")
                                }}</span>
                            </span>
                            <span v-if="befund('evidence.file')" class="hochladen__befund">{{
                                befund("evidence.file")
                            }}</span>
                            <AvmEingabe
                                v-if="beleg.adresse"
                                v-model="stand.beleg.adresse"
                                :aria-label="t('medien.formular.belegAdresse')"
                                :placeholder="t('medien.formular.belegAdresseHinweis')"
                                :ungueltig="befund('evidence.url') !== undefined"
                                testid="medien-hochladen-belegadresse"
                            />
                            <span v-if="befund('evidence.url')" class="hochladen__befund">{{
                                befund("evidence.url")
                            }}</span>
                            <AvmTextbereich
                                v-if="beleg.text"
                                v-model="stand.beleg.text"
                                :zeilen="2"
                                :aria-label="t('medien.formular.belegText')"
                                :placeholder="
                                    t(
                                        stand.beleg.art === 'operator_note'
                                            ? 'medien.formular.belegNotizHinweis'
                                            : 'medien.formular.belegTextHinweis',
                                    )
                                "
                                :ungueltig="befund('evidence.text') !== undefined"
                                testid="medien-hochladen-belegtext"
                            />
                            <span v-if="befund('evidence.text')" class="hochladen__befund">{{
                                befund("evidence.text")
                            }}</span>
                            <span class="hochladen__klein">{{ t("medien.formular.belegPrivat") }}</span>
                        </div>
                        <label :for="kennung('notiz')">{{ t("medien.formular.rechtenotiz") }}</label>
                        <AvmEingabe
                            :id="kennung('notiz')"
                            v-model="stand.rechte.rechtenotiz"
                            :placeholder="t('medien.formular.rechtenotizHinweis')"
                        />
                        <span class="hochladen__beschriftung">{{ t("medien.formular.pruefung") }}</span>
                        <div v-if="kannFreigeben" class="hochladen__klein">
                            <label class="hochladen__freigabe">
                                <input
                                    v-model="stand.freigeben"
                                    type="checkbox"
                                    :disabled="stand.rechte.grundlage === 'unknown'"
                                    data-testid="medien-hochladen-freigeben"
                                />
                                {{ t("medien.formular.freigeben") }}
                            </label>
                        </div>
                        <span v-else class="hochladen__klein" data-testid="medien-hochladen-pruefung">{{
                            t(
                                rolle === "social_post"
                                    ? "community.social.bild.rechteWarten"
                                    : "medien.formular.pruefungSpaeter",
                            )
                        }}</span>
                    </div>
                </fieldset>
            </section>
        </div>

        <AvmHinweis
            :ton="satz.ton === 'warnung' ? 'warnung' : 'neutral'"
            rolle="status"
            testid="medien-hochladen-satz"
            >{{ satz.text }}</AvmHinweis
        >
    </div>
</template>

<style scoped>
.hochladen {
    display: flex;
    flex-direction: column;
    gap: var(--divider-gap);
}

/* Zwei Blöcke nebeneinander, wo Platz ist (Guide §12.6 „Andere Blöcke nebeneinander“), sonst untereinander. */
.hochladen__spalten {
    display: flex;
    flex-wrap: wrap;
    gap: var(--divider-gap);
}

.hochladen__links {
    display: flex;
    flex: 1 1 var(--avm-fenster-spalte);
    flex-direction: column;
    gap: var(--space-8);
    min-width: 0;
}

.hochladen__rechts {
    display: flex;
    flex: 1.6 1 var(--avm-fenster-lesespalte);
    flex-direction: column;
    gap: var(--space-8);
    min-width: 0;
}

/* Die Ablage: ein Knopf in Gestalt einer Fläche; das Feld selbst ist unsichtbar, die Beschriftung nimmt Klick und Fokus. */
.hochladen__ablage {
    display: flex;
    align-items: center;
    gap: var(--space-8);
    padding: var(--space-8);
    border: 1px dashed var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-panel-soft);
    cursor: pointer;
    transition:
        background-color 120ms ease,
        border-color 120ms ease,
        box-shadow 120ms ease;
}

.hochladen__ablage:hover,
.hochladen__ablage.is-ueber {
    border-color: var(--color-accent-strong);
    background: var(--color-hover-wash);
}

.hochladen__ablage:has(.hochladen__datei-eingabe:focus-visible) {
    box-shadow: var(--focus-ring);
}

.hochladen__ablage.is-ungueltig {
    border-color: var(--color-danger-soft-border);
}

.hochladen__ablage.is-gesperrt {
    border-color: var(--color-disabled-border);
    background: var(--color-disabled-bg);
    color: var(--color-disabled-text);
    cursor: not-allowed;
}

.hochladen__datei-eingabe {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
}

.hochladen__vorschau {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: var(--avm-fenster-kachel);
    overflow: hidden;
    border-radius: var(--radius-sm);
    background: var(--color-panel);
}

.hochladen__vorschau--coat {
    aspect-ratio: 1;
}

.hochladen__vorschau--header,
.hochladen__vorschau--map_full,
.hochladen__vorschau--map_preview {
    aspect-ratio: 16 / 9;
}

.hochladen__pdf {
    color: var(--color-accent-strong);
    font-size: var(--font-size-small);
}

.hochladen__vorschau img {
    width: 100%;
    height: 100%;
    object-fit: contain;
}

.hochladen__vorschau--header img {
    object-fit: cover;
}

.hochladen__plus {
    color: var(--color-text-muted);
    font-size: var(--font-size-title);
}

.hochladen__ablage-text {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
    overflow-wrap: anywhere;
}

.hochladen__freigabe {
    display: inline-flex;
    align-items: center;
    gap: var(--space-4);
    cursor: pointer;
}

.hochladen__zeilen {
    display: grid;
    grid-template-columns: var(--avm-field-label-w) minmax(0, 1fr);
    align-items: center;
    gap: var(--space-6) var(--space-8);
}

.hochladen__zeilen > label,
.hochladen__beschriftung {
    color: var(--color-text);
    font-size: var(--font-size-body);
}

.hochladen__zeilen > label.oben {
    align-self: start;
    margin-top: var(--space-6);
}

.hochladen__zeilen > .breit {
    grid-column: 1 / -1;
}

.hochladen__wert {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
}

.hochladen__gruppe {
    min-width: 0;
    margin: 0;
    padding: var(--space-6) var(--space-10) var(--space-10);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-md);
}

.hochladen__gruppe > legend {
    padding: 0 var(--space-4);
    color: var(--color-accent-strong);
    font-size: var(--font-size-small);
}

.hochladen__herkunft {
    display: grid;
    grid-template-columns: var(--avm-field-label-w) minmax(0, 1fr);
    gap: var(--space-4) var(--space-8);
    margin: 0;
    font-size: var(--font-size-body);
}

.hochladen__herkunft dt {
    color: var(--color-text-muted);
}

.hochladen__herkunft dd {
    margin: 0;
    color: var(--color-text);
}

.hochladen__beleg {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    padding: var(--space-8);
    border-radius: var(--radius-md);
    background: var(--color-panel-soft);
}

.hochladen__beleg-datei {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-8);
}

.hochladen__beleg-knopf {
    display: inline-flex;
    align-items: center;
    min-height: var(--avm-control-h);
    padding: 0 var(--space-8);
    border: 1px solid var(--color-button-soft-border);
    border-radius: var(--radius-md);
    background: var(--color-button-soft);
    color: var(--color-button-soft-text);
    cursor: pointer;
    font-size: var(--font-size-small);
    transition:
        background-color 120ms ease,
        border-color 120ms ease,
        box-shadow 120ms ease;
}

.hochladen__beleg-knopf:hover {
    border-color: var(--color-border-strong);
    background: var(--color-button-soft-hover);
}

.hochladen__beleg-knopf:active {
    background: var(--color-button-soft-active);
}

.hochladen__beleg-knopf:has(.hochladen__datei-eingabe:focus-visible) {
    box-shadow: var(--focus-ring);
}

.hochladen__klein {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    line-height: var(--leading-snug);
}

.hochladen__befund {
    color: var(--color-danger-soft-text);
    font-size: var(--font-size-caption);
    line-height: var(--leading-snug);
}

@media (prefers-reduced-motion: reduce) {
    .hochladen__ablage,
    .hochladen__beleg-knopf {
        transition: none;
    }
}
</style>
