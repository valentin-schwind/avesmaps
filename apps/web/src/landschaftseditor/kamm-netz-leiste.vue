<script setup lang="ts">
import { computed, ref } from "vue";
import { PUNKT_HOEHE_GRENZEN, type LinienRang } from "@avesmaps3d/shared";
import EditorZeichen from "../controls/editor-zeichen.vue";
import { phoneViewport } from "../controls/phone-viewport";
import EntwurfLeiste from "../fenster/entwurf-leiste.vue";
import { formatNumber, isMessageKey, t, type MessageKey } from "../i18n/i18n";
import type { KammNetz, KammWerkzeug } from "./kamm-netz-anbindung";
import { istKamm, netzHatTeile } from "./kamm-netz";
import { kammHoehenZeigen } from "./kamm-hoehen-schalter";
import { vorschauDeckkraft } from "./gebirge-vorschau-karte";
import KammZeichen, { type KammZeichenName } from "./kamm-zeichen.vue";

/**
 * Die Leiste von „Kämme zeichnen“ (WI-0245 D2) nach dem Mockup des Betreibers (2026-10-21: „ein mockup für die inzwischen zu
 * großgewordene "Kämme editieren" leiste … mach das auch für sie in der eigenschaftsleiste, wenn sie aufgrund der breite da rein
 * wandert“): EINE Zeile nur Zeichen, der Name jedes Knopfs im Tooltip aus den Sprachtafeln, und eine leise zweite Zeile.
 *
 * - Zeile: ✎ und Gebirge mit der Zahl ungespeicherter Schritte · Kamm, Nebengipfel, Wählen · Hauptkamm, Nebenkamm (für den nächsten Kamm
 *   und den gewählten) · ↕ „Höhe ziehen“ und das Feld der Höhe der gewählten Punkte in Schritt, dahinter „Höhen beschriften“ (WI-0249 P9; die
 *   Treppe des Mockups „keine bedeutung, weglassen“) · Löschen, Alles leeren · ⌖ Gebirge · Auge mit Regler (Deckkraft des Bilds im Umriss) ·
 *   ↶ ↷ · ✕ Verwerfen · ✓ Fertig.
 * - Das Feld (WI-0249 P9): die Höhe der Auswahl, die gilt; eine Vorgabe des Modells blass, verschiedene Höhen leer mit „verschieden“. Beim
 *   Zeichnen ohne Auswahl kein Wert (neue Punkte haben keine eigene Höhe). Jede Eingabe wirkt sofort an allen gewählten
 *   Punkten und ist bis Enter oder Verlassen EIN Schritt; leer ist die Vorgabe. Solange das Feld den Fokus hat, bleibt der getippte Text stehen.
 * - Darunter: ⓘ (die Gesten im Tooltip) · Kämme und Nebengipfel · Hauptkämme und Nebenkämme · Typ · rechts die Gestenzeile des gewählten
 *   Werkzeugs (OPS-055, OPS-057: „Wählen“ nennt Ziehen, Doppelklick und Entf, die Zeichenwerkzeuge den Weg zu „Wählen“); sie steht auch im
 *   Tooltip, wenn der Platz sie kürzt.
 * - Lage, Rand, Fensterlage und die Frage beim Verlassen kommen von der gemeinsamen Leiste (`entwurf-leiste.vue`, Slots `zeile`, `unten`).
 * - **Flüsse als Täler** (WI-0259, OPS-071): Der Zähler unten nennt auch die Flüsse der Fläche (das Zeichen „Tal“ in der Farbe der Flüsse).
 *   Steigt ein Fluss mit eigenen Höhen in Fließrichtung, beginnt die Gestenzeile mit „!“ und nennt ihn (in den Warnfarben), sonst nennt sie in
 *   „Wählen“ an Gebirgen mit Flüssen, wie sie sich wählen und in der Höhe ändern lassen. „Löschen“ gilt auch den eigenen Höhen gewählter
 *   Flusspunkte und Seen (`loeschArt`), nie dem Verlauf; ist nichts davon gewählt, ist der Knopf gesperrt und sagt, was zu wählen ist.
 */
const props = defineProps<{
    netz: KammNetz;
    rand?: { links: number; rechts: number } | undefined;
}>();
const emit = defineEmits<{ hoehe: [px: number] }>();

const lauf = computed(() => props.netz.laufend.value);
const WERKZEUGE: readonly { werkzeug: KammWerkzeug; zeichen: KammZeichenName }[] = [
    { werkzeug: "kamm", zeichen: "kamm" },
    { werkzeug: "nebengipfel", zeichen: "nebengipfel" },
    { werkzeug: "mulde", zeichen: "mulde" },
    { werkzeug: "waehlen", zeichen: "waehlen" },
];
const RAENGE: readonly { rang: LinienRang; zeichen: KammZeichenName }[] = [
    { rang: "haupt", zeichen: "hauptkamm" },
    { rang: "neben", zeichen: "nebenkamm" },
    { rang: "tal", zeichen: "tal" },
];
const stand = computed(() => {
    // Der Entwurf ändert sich mit jedem Schritt; die Leiste liest ihn mit.
    void lauf.value?.bearbeitung.stand.value;
    return props.netz.netz();
});
const bearbeitungLage = computed(() => lauf.value?.bearbeitung.lage.value);
const gewaehlt = computed(() => lauf.value?.gewaehlt);
const gewaehlterKamm = computed(() => gewaehlt.value !== undefined && istKamm(stand.value, gewaehlt.value));
/** Was das Feld zeigt (WI-0249 P9): die Höhe der Auswahl, eigen oder die des Geländes; `gemischt` bei verschiedenen Höhen. */
const feld = computed(
    (): { h: number | undefined; vorgabe: boolean; gemischt: boolean; frei: boolean; titel: string } => {
        void lauf.value?.bearbeitung.stand.value;
        void lauf.value?.zugNetz;
        void lauf.value?.daten;
        const punkte = props.netz.auswahlPunkte();
        // Ohne Auswahl kein Wert: Neue Punkte haben keine eigene Höhe (WI-0249; Vali wählte 2026-10-26, kein Startwert).
        if (punkte.length === 0)
            return {
                h: undefined,
                vorgabe: true,
                gemischt: false,
                frei: false,
                titel: t("landschaftseditor.kaemme.hoeheNichts"),
            };
        // Ohne eigene Höhe die Höhe des Geländes aus der Vorschau, blass (wie die Zahl auf der Karte).
        const werte = punkte.map((p) => props.netz.hoeheVon(p)).filter((w) => w !== undefined);
        const erste = werte[0];
        const gleich = erste !== undefined && werte.every((w) => w.h === erste.h);
        return {
            h: gleich ? erste.h : undefined,
            vorgabe: !werte.some((w) => w.eigen),
            gemischt: !gleich,
            frei: true,
            titel: t("landschaftseditor.kaemme.hoeheTitel"),
        };
    },
);
/** Der getippte Text, solange das Feld den Fokus hat; sonst zeigt es den Stand. */
const getippt = ref<string | undefined>(undefined);
const feldText = computed(() => getippt.value ?? (feld.value.h === undefined ? "" : String(feld.value.h)));
/** Der Rang, der gilt: der des gewählten Kamms, sonst der für den nächsten. */
const rang = computed(() =>
    gewaehlterKamm.value ? stand.value.kaemme[gewaehlt.value!]!.rang : (lauf.value?.rang ?? "neben"),
);
const haupt = computed(() => stand.value.kaemme.filter((k) => k.rang === "haupt").length);
const typName = computed(() => {
    void lauf.value?.bearbeitung.stand.value;
    const typ = props.netz.typ();
    const schluessel = `landschaftseditor.gebirge.typ.${typ ?? "keins"}`;
    return isMessageKey(schluessel) ? t(schluessel) : (typ ?? "");
});
/** Die ganze Zählung als Satz: für Vorleser und Tooltip der zweiten Zeile. */
const zahl = computed(() =>
    [
        t("landschaftseditor.verlauf.netz", {
            kaemme: formatNumber(stand.value.kaemme.filter((k) => k.rang !== "tal").length, 0),
            gipfel: formatNumber(stand.value.nebengipfel.length, 0),
        }),
        t("landschaftseditor.kaemme.raenge", {
            haupt: formatNumber(haupt.value, 0),
            neben: formatNumber(stand.value.kaemme.filter((k) => k.rang === "neben").length, 0),
        }),
        ...(stand.value.kaemme.some((k) => k.rang === "tal")
            ? [
                  `${t("landschaftseditor.kaemme.rang.tal")} ${formatNumber(stand.value.kaemme.filter((k) => k.rang === "tal").length, 0)}`,
              ]
            : []),
        ...((stand.value.mulden?.length ?? 0) > 0
            ? [`${t("landschaftseditor.kaemme.werkzeug.mulde")} ${formatNumber(stand.value.mulden!.length, 0)}`]
            : []),
        ...(fluesse.value > 0
            ? [t("landschaftseditor.kaemme.fluesseZahl", { n: formatNumber(fluesse.value, 0) })]
            : []),
        t("landschaftseditor.kaemme.typ", { typ: typName.value }),
    ].join(" · "),
);
/**
 * Die Gestenzeile je Werkzeug (OPS-055, OPS-057): Was die Maus (am Telefon der Finger) im gewählten Werkzeug kann. „Wählen“ nennt die
 * Gesten des Bearbeitens (Ziehen, Doppelklick, Entf), die Zeichenwerkzeuge das Setzen und den Weg zu „Wählen“ für das Fertige.
 */
const GESTEN = {
    kamm: ["landschaftseditor.kaemme.gesten", "landschaftseditor.kaemme.gestenFinger"],
    nebengipfel: ["landschaftseditor.kaemme.gestenPunkt", "landschaftseditor.kaemme.gestenPunktFinger"],
    mulde: ["landschaftseditor.kaemme.gestenPunkt", "landschaftseditor.kaemme.gestenPunktFinger"],
    waehlen: ["landschaftseditor.kaemme.gestenWaehlen", "landschaftseditor.kaemme.gestenWaehlenFinger"],
} as const satisfies Record<KammWerkzeug, readonly [MessageKey, MessageKey]>;
const gesten = computed(() => {
    const [maus, finger] = GESTEN[lauf.value?.werkzeug ?? "kamm"];
    const basis = t(phoneViewport.value ? finger : maus);
    // Die Flüsse stehen nur in „Wählen“ (WI-0259): Steigt einer, steht das vorn („!“ wie an der Karte), sonst ein Satz, wie sie sich ändern lassen.
    if (lauf.value?.werkzeug !== "waehlen") return basis;
    if (steigende.value.length > 0)
        return `${t("landschaftseditor.kaemme.steigt", { namen: steigende.value.join(", ") })} · ${basis}`;
    return fluesse.value > 0 ? `${t("landschaftseditor.kaemme.gestenFluss")} · ${basis}` : basis;
});
const warnt = computed(() => lauf.value?.werkzeug === "waehlen" && steigende.value.length > 0);
/** Die Flüsse der Fläche und die, die steigen (WI-0259); die Leiste liest den Entwurf, die Gewässer und die Vorschau mit. */
const fluesse = computed(() => {
    void lauf.value?.daten;
    return props.netz.zahlFluesse();
});
const steigende = computed(() => {
    void lauf.value?.bearbeitung.stand.value;
    void lauf.value?.zugNetz;
    void lauf.value?.daten;
    void lauf.value?.werkzeug;
    return props.netz.steigende();
});
/** Was „Löschen“ und Entf an der Auswahl tun (WI-0259). */
const loeschArt = computed(() => {
    void lauf.value?.bearbeitung.stand.value;
    void lauf.value?.auswahl;
    return props.netz.loeschArt();
});
const loeschTitel = computed(() => {
    if (loeschArt.value === "teile") return t("landschaftseditor.kaemme.loeschen");
    if (loeschArt.value === "hoehen") return t("landschaftseditor.kaemme.hoeheWeg");
    return gewaehlt.value === undefined
        ? t("landschaftseditor.kaemme.nichtsGewaehlt")
        : t("landschaftseditor.kaemme.hoeheNichtsWeg");
});
const deckkraft = (ereignis: Event): void => {
    vorschauDeckkraft.value = Number((ereignis.target as HTMLInputElement).value);
};
const leer = computed(() => !netzHatTeile(stand.value));
function setzeHoehe(ereignis: Event): void {
    const roh = (ereignis.target as HTMLInputElement).value.trim();
    getippt.value = roh;
    const zahl = Number(roh);
    if (roh !== "" && !Number.isFinite(zahl)) return;
    props.netz.hoehe(roh === "" ? null : zahl);
}
/** „Höhen beschriften“: gemerkt je Browser (`kamm-hoehen-schalter.ts`). */
function schalteHoehen(): void {
    kammHoehenZeigen.value = !kammHoehenZeigen.value;
}
/** Enter oder Verlassen: der Schritt ist fertig, das Feld zeigt wieder den Stand (auch die Vorgabe nach leerem Feld). */
function feldFertig(): void {
    getippt.value = undefined;
    lauf.value?.bearbeitung.feldVerlassen();
}
</script>

<template>
    <EntwurfLeiste
        v-if="lauf"
        :bearbeitung="lauf.bearbeitung"
        zeichen="bearbeiten"
        :titel="t('landschaftseditor.kaemme.titel')"
        :objekt="lauf.name"
        :gesten="gesten"
        :rand="rand"
        testid="kamm-netz-leiste"
        immer
        @hoehe="(px: number) => emit('hoehe', px)"
    >
        <template #zeile="{ fertigGrund }">
            <span class="kl__kopf" :title="t('landschaftseditor.kaemme.titel')">
                <span class="kl__stift" aria-hidden="true"><EditorZeichen name="bearbeiten" /></span>
                <span class="kl__name einzeilig">{{ lauf.name }}</span>
                <span
                    class="kl__zahl"
                    :class="{ 'is-offen': (bearbeitungLage?.ungespeichert ?? 0) > 0 }"
                    :title="t('modusleiste.ungespeichert', { n: String(bearbeitungLage?.ungespeichert ?? 0) })"
                    data-testid="kamm-netz-leiste-ungespeichert"
                    >{{ bearbeitungLage?.ungespeichert ?? 0 }}<span class="kl__punkt" aria-hidden="true"
                /></span>
            </span>
            <span class="kl__gruppe" role="radiogroup" :aria-label="t('landschaftseditor.kaemme.werkzeug.titel')">
                <button
                    v-for="w in WERKZEUGE"
                    :key="w.werkzeug"
                    type="button"
                    role="radio"
                    class="kl__knopf"
                    :aria-checked="lauf.werkzeug === w.werkzeug"
                    :title="t(`landschaftseditor.kaemme.werkzeug.${w.werkzeug}`)"
                    :aria-label="t(`landschaftseditor.kaemme.werkzeug.${w.werkzeug}`)"
                    :data-testid="`kamm-netz-werkzeug-${w.werkzeug}`"
                    @click="netz.werkzeug(w.werkzeug)"
                >
                    <KammZeichen :name="w.zeichen" />
                </button>
            </span>
            <span class="kl__gruppe" role="radiogroup" :aria-label="t('landschaftseditor.kaemme.rang.titel')">
                <button
                    v-for="r in RAENGE"
                    :key="r.rang"
                    type="button"
                    role="radio"
                    class="kl__knopf kl__knopf--rang"
                    :aria-checked="rang === r.rang"
                    :title="t(`landschaftseditor.kaemme.rang.${r.rang}`)"
                    :aria-label="t(`landschaftseditor.kaemme.rang.${r.rang}`)"
                    :data-testid="`kamm-netz-rang-${r.rang}`"
                    @click="netz.rang(r.rang)"
                >
                    <KammZeichen :name="r.zeichen" />
                </button>
            </span>
            <span class="kl__hoehe">
                <button
                    type="button"
                    class="kl__knopf"
                    :aria-pressed="lauf.hoehenZug"
                    :title="t('landschaftseditor.kaemme.hoeheZiehen')"
                    :aria-label="t('landschaftseditor.kaemme.hoeheZiehen')"
                    data-testid="kamm-netz-hoehe-ziehen"
                    @click="netz.hoehenZiehen()"
                >
                    <KammZeichen name="hoehe" />
                </button>
                <input
                    type="number"
                    :min="PUNKT_HOEHE_GRENZEN.min"
                    :max="PUNKT_HOEHE_GRENZEN.max"
                    step="50"
                    :class="{ 'is-vorgabe': feld.vorgabe }"
                    :value="feldText"
                    :disabled="!feld.frei"
                    :placeholder="feld.gemischt ? '' : t('landschaftseditor.kaemme.hoeheVorgabe')"
                    :title="feld.gemischt ? t('landschaftseditor.kaemme.hoeheGemischt') : feld.titel"
                    :aria-label="t('landschaftseditor.kaemme.hoehe')"
                    data-testid="kamm-netz-hoehe"
                    :data-vorgabe="feld.vorgabe"
                    :data-gemischt="feld.gemischt"
                    @input="setzeHoehe"
                    @keydown.enter="feldFertig"
                    @blur="feldFertig"
                />
                <button
                    type="button"
                    class="kl__knopf"
                    :aria-pressed="kammHoehenZeigen"
                    :title="t('landschaftseditor.kaemme.hoehenZeigen')"
                    :aria-label="t('landschaftseditor.kaemme.hoehenZeigen')"
                    data-testid="kamm-netz-hoehen-zeigen"
                    @click="schalteHoehen"
                >
                    <KammZeichen name="beschriftung" />
                </button>
            </span>
            <span class="kl__gruppe">
                <button
                    type="button"
                    class="kl__knopf kl__knopf--gefahr"
                    :disabled="loeschArt === undefined"
                    :title="loeschTitel"
                    :aria-label="t('landschaftseditor.kaemme.loeschen')"
                    data-testid="kamm-netz-loeschen"
                    @click="netz.loesche()"
                >
                    <KammZeichen name="loeschen" />
                </button>
                <button
                    type="button"
                    class="kl__knopf kl__knopf--gefahr"
                    :disabled="leer"
                    :title="leer ? t('landschaftseditor.kaemme.schonLeer') : t('landschaftseditor.kaemme.leeren')"
                    :aria-label="t('landschaftseditor.kaemme.leeren')"
                    data-testid="kamm-netz-leeren"
                    @click="netz.leere()"
                >
                    <KammZeichen name="leeren" />
                </button>
            </span>
            <button
                type="button"
                class="kl__knopf"
                :title="t('landschaftseditor.kaemme.ganzZeigen')"
                :aria-label="t('landschaftseditor.kaemme.ganzZeigen')"
                data-testid="kamm-netz-ganz"
                @click="netz.zeigeGebirge()"
            >
                <KammZeichen name="ziel" />
            </button>
            <label class="kl__vorschau" :title="t('landschaftseditor.kaemme.vorschau')">
                <KammZeichen name="auge" />
                <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    :value="vorschauDeckkraft"
                    :aria-label="t('landschaftseditor.kaemme.vorschau')"
                    data-testid="kamm-netz-vorschau"
                    @input="deckkraft"
                />
            </label>
            <span class="kl__gruppe">
                <button
                    type="button"
                    class="kl__knopf"
                    :disabled="!bearbeitungLage?.zurueck"
                    :title="t('modusleiste.zurueck')"
                    :aria-label="t('modusleiste.zurueck')"
                    data-testid="kamm-netz-leiste-zurueck"
                    @click="lauf.bearbeitung.zurueck()"
                >
                    <KammZeichen name="zurueck" />
                </button>
                <button
                    type="button"
                    class="kl__knopf"
                    :disabled="!bearbeitungLage?.wieder"
                    :title="t('modusleiste.wieder')"
                    :aria-label="t('modusleiste.wieder')"
                    data-testid="kamm-netz-leiste-wieder"
                    @click="lauf.bearbeitung.wieder()"
                >
                    <KammZeichen name="wieder" />
                </button>
            </span>
            <span class="kl__gruppe kl__abschluss">
                <button
                    type="button"
                    class="kl__knopf"
                    :disabled="(bearbeitungLage?.ungespeichert ?? 0) === 0"
                    :title="
                        (bearbeitungLage?.ungespeichert ?? 0) === 0
                            ? t('modusleiste.nichtsZuVerwerfen')
                            : t('modusleiste.verwerfen')
                    "
                    :aria-label="t('modusleiste.verwerfen')"
                    data-testid="kamm-netz-leiste-verwerfen"
                    @click="lauf.bearbeitung.verwerfen()"
                >
                    <KammZeichen name="verwerfen" />
                </button>
                <button
                    type="button"
                    class="kl__knopf kl__knopf--fertig"
                    :disabled="fertigGrund !== undefined || (bearbeitungLage?.ungespeichert ?? 0) === 0"
                    :title="fertigGrund ?? t('modusleiste.fertig')"
                    :aria-label="t('modusleiste.fertig')"
                    data-testid="kamm-netz-leiste-fertig"
                    @click="void lauf.bearbeitung.fertig()"
                >
                    <KammZeichen name="fertig" />
                </button>
            </span>
        </template>
        <template #unten>
            <p class="kl__unten" :title="zahl">
                <span class="kl__info" :title="gesten" :aria-label="gesten" role="img"
                    ><KammZeichen name="info"
                /></span>
                <span class="kl__zaehler" data-testid="kamm-netz-zahl" :aria-label="zahl">
                    <span :title="t('landschaftseditor.kaemme.werkzeug.kamm')"
                        ><KammZeichen name="kamm" />{{
                            formatNumber(stand.kaemme.filter((k) => k.rang !== "tal").length, 0)
                        }}</span
                    >
                    <span :title="t('landschaftseditor.kaemme.werkzeug.nebengipfel')"
                        ><KammZeichen name="nebengipfel" />{{ formatNumber(stand.nebengipfel.length, 0) }}</span
                    >
                    <span
                        v-if="fluesse > 0"
                        class="kl__fluss"
                        :title="t('landschaftseditor.kaemme.fluesse')"
                        data-testid="kamm-netz-fluesse"
                        ><KammZeichen name="tal" />{{ formatNumber(fluesse, 0) }}</span
                    >
                    <span
                        v-if="stand.kaemme.some((k) => k.rang === 'tal')"
                        :title="t('landschaftseditor.kaemme.rang.tal')"
                        ><KammZeichen name="tal" />{{
                            formatNumber(stand.kaemme.filter((k) => k.rang === "tal").length, 0)
                        }}</span
                    >
                    <span v-if="(stand.mulden?.length ?? 0) > 0" :title="t('landschaftseditor.kaemme.werkzeug.mulde')"
                        ><KammZeichen name="mulde" />{{ formatNumber(stand.mulden!.length, 0) }}</span
                    >
                    <span class="kl__trenner" aria-hidden="true" />
                    <span class="kl__rot" :title="t('landschaftseditor.kaemme.rang.haupt')"
                        ><KammZeichen name="hauptkamm" />{{ formatNumber(haupt, 0) }}</span
                    >
                    <span class="kl__rot" :title="t('landschaftseditor.kaemme.rang.neben')"
                        ><KammZeichen name="nebenkamm" />{{
                            formatNumber(stand.kaemme.filter((k) => k.rang === "neben").length, 0)
                        }}</span
                    >
                    <span class="kl__trenner" aria-hidden="true" />
                    <span :title="t('landschaftseditor.kaemme.typ', { typ: typName })"
                        ><KammZeichen name="typ" />{{ typName }}</span
                    >
                </span>
                <span
                    class="kl__hinweis einzeilig"
                    :class="{ 'is-warnung': warnt }"
                    :title="gesten"
                    data-testid="kamm-netz-gesten"
                    >{{ gesten }}</span
                >
            </p>
        </template>
    </EntwurfLeiste>
</template>

<style scoped>
/* Eine Zeile nur Zeichen (Mockup des Betreibers); im Fenster oder schmal bricht sie in Gruppen um. */
.kl__kopf,
.kl__gruppe,
.kl__hoehe,
.kl__vorschau {
    display: inline-flex;
    gap: var(--space-1);
    align-items: center;
}

.kl__kopf {
    gap: var(--space-3);
    min-width: 0;
    margin-right: var(--space-2);
}

.kl__abschluss {
    margin-left: auto;
}

.kl__stift {
    color: var(--color-edit-edge);
}

.kl__name {
    max-width: 9ch;
    color: var(--color-text-strong);
}

.kl__zahl {
    display: inline-flex;
    gap: var(--space-2);
    align-items: center;
    padding: 0 var(--space-3);
    border-radius: 999px;
    background: var(--color-panel-muted);
    color: var(--color-text);
    font-variant-numeric: tabular-nums;
}

.kl__punkt {
    width: 0.5em;
    height: 0.5em;
    border-radius: 50%;
    background: var(--color-text-muted);
}

.kl__zahl.is-offen .kl__punkt {
    background: var(--color-edit-edge);
}

.kl__knopf {
    display: inline-grid;
    place-items: center;
    width: 2.25rem;
    height: 2.25rem;
    padding: 0;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel);
    color: var(--color-text);
    cursor: pointer;
    transition:
        border-color 120ms,
        background-color 120ms;
}

.kl__knopf:hover:not(:disabled) {
    border-color: var(--color-accent-brown);
}

.kl__knopf:focus-visible {
    outline: 2px solid var(--color-accent-brown);
    outline-offset: 1px;
}

.kl__knopf[aria-checked="true"],
.kl__knopf[aria-pressed="true"] {
    border-color: var(--color-accent-brown);
    background: var(--color-panel-active);
    color: var(--color-text-strong);
}

.kl__knopf:disabled {
    cursor: not-allowed;
    opacity: 0.45;
}

.kl__knopf--rang,
.kl__knopf--gefahr,
.kl__rot {
    color: var(--color-edit-edge);
}

/* Das Zeichen „Tal“ der Flüsse in der Farbe der Flüsse (WI-0259), wie auf der Karte und im Profil. */
.kl__fluss {
    color: var(--color-profile-river);
}

.kl__knopf--fertig:not(:disabled) {
    border-color: var(--color-accent-brown);
    background: var(--color-accent-brown);
    color: var(--color-panel);
}

/* Fünf Ziffern ohne Pfeile: Die Zeile soll mit ↕ und „Höhen beschriften“ nicht breiter werden als vorher (WI-0249 P9). */
.kl__hoehe input {
    width: 6ch;
    font: inherit;
    appearance: textfield;
}

.kl__hoehe input::-webkit-inner-spin-button,
.kl__hoehe input::-webkit-outer-spin-button {
    margin: 0;
    appearance: none;
}

/* Eine Vorgabe des Modells steht blass, ein eigener Wert kräftig (WI-0249 P9). */
.kl__hoehe input.is-vorgabe {
    color: var(--color-text-muted);
}

.kl__vorschau input {
    width: 6ch;
    accent-color: var(--color-accent-brown);
}

/*
 * Die zweite Zeile darf die Leiste nie breiter machen: Ohne `min-width: 0` und `overflow: hidden` meldete der einzeilige Hinweis seine ganze
 * Breite als Mindestbreite, und in der Fensterlage scrollte das angedockte Fenster seitlich (Prüfbank 2026-10-21, 1920 × 1080).
 */
.kl__unten {
    min-width: 0;
    overflow: hidden;
    display: flex;
    gap: var(--space-4);
    align-items: center;
    margin: 0;
    padding: 0 var(--space-10) var(--space-6);
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.kl__zaehler {
    display: inline-flex;
    gap: var(--space-4);
    align-items: center;
    font-variant-numeric: tabular-nums;
}

.kl__zaehler > span {
    display: inline-flex;
    gap: var(--space-1);
    align-items: center;
}

.kl__trenner {
    width: 1px;
    height: 1em;
    background: var(--color-border);
}

.kl__hinweis {
    flex: 1;
    min-width: 0;
    text-align: right;
}

/* Steigt ein Fluss, trägt die Gestenzeile die Warnfarben (WI-0259), wie das „!“ an der Karte. */
.kl__hinweis.is-warnung {
    color: var(--color-warning-soft-text);
}
</style>
