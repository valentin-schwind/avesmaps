<script setup lang="ts">
/**
 * Der Reiter „Kartenserien“ der Systemsteuerung (WI-0220 Schnitt 2). Vorlage ist der abgenommene Entwurf Fassung 4
 * (https://claude.ai/artifact/EtbpKjmwJakR42UvVWpXCk; Betreiber 2026-10-18: „Kartenserien, Fassung 4 - passt! … das mockup ist das
 * interaktive blatt“): links die Liste mit Übersicht, Name, Größe und Pillen, ▲▼ für die Reihenfolge im Fächer; rechts die gewählte
 * Serie mit Name und Beschreibung, Sichtbarkeit (Alle · Nur Editoren · Niemand), Vorgabe, Bild im Fächermenü, Infos, Lizenz und
 * Herkunft. Darunter der Papierkorb. Was die Oberfläche rechnet, steht in `kartenserien.ts`.
 *
 * - Auf Production ändert dieser Reiter nichts (Vorlage, Weg nach Production „A von Stage übernehmen“); der Server weist es ab.
 * - Hochladen und Ersetzen (Schnitt 3): „Neue Kartenserie“ oben, „Ersetzen“ an der Serie; der Ablauf (Hochladen · Prüfen · Warten ·
 *   Zerlegen · Umschalten) steht bei der Serie, neue Serien „in Arbeit“ über der Liste, bis sie zerlegt sind. Solange etwas läuft,
 *   liest der Reiter alle vier Sekunden nach. Ein abgebrochener Upload setzt mit derselben Datei fort.
 * - Fassungen (Schnitt 3): die Revisionen der Pyramide; „Zurück auf diese Fassung“ tauscht nur den Zeiger.
 * - Schnitt 4: „Nach Production übernehmen“ an der Serie (nur die Betreiber, `release_to_production`, Passkey) mit dem Stand der
 *   letzten Übernahme; auf Production statt Ersetzen und Papierkorb ein Hinweis. Der Papierkorb nennt seine Frist
 *   (`kartenserien-papierkorb.vue`).
 */
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from "vue";
import {
    KARTENSERIE_PAPIERKORB_TAGE,
    KARTENSERIE_STUFEN,
    KARTENSERIE_THUMB_VORGABE,
    permissionIsEvidenced,
    type AdminKartenserie,
    type KartenserieAuftrag,
    type KartenserieStufe,
    type KartenserieTexte,
    type KartenserieUpload,
    type KartenserieUploadZiel,
} from "@avesmaps3d/shared";
import AvmBestaetigung from "../controls/avm-bestaetigung.vue";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmPille from "../controls/avm-pille.vue";
import AvmSegmente from "../controls/avm-segmente.vue";
import AvmTextbereich from "../controls/avm-textbereich.vue";
import FensterKarte from "../fenster/fenster-karte.vue";
import { formatNumber, t } from "../i18n/i18n";
import { authState } from "../auth/session-state";
import VerwaltungLadeproblem from "../auth/verwaltung-ladeproblem.vue";
import VerwaltungMeldung from "../auth/verwaltung-meldung.vue";
import { label } from "../auth/verwaltung-text";
import KartenserieAusschnitt from "./kartenserie-ausschnitt.vue";
import { kachelUrl, kachelVorlage } from "./kartenserie-kacheln";
import KartenserieAblauf from "./kartenserie-ablauf.vue";
import KartenserieHochladen from "./kartenserie-hochladen.vue";
import KartenserienPapierkorb from "./kartenserien-papierkorb.vue";
import { createHochladen } from "./hochladen";
import {
    ablauf,
    geaendertText,
    kachelZahl,
    laeuftEtwas,
    letzteUeberallFuerAlle,
    stufeGesperrt,
    stufenSatz,
    uebernahmeGesperrt,
    uebernahmeSatz,
    type Kartenserien,
} from "./kartenserien";

const props = defineProps<{
    kartenserien: Kartenserien;
    telefon: boolean;
}>();

const k = props.kartenserien;
const darf = authState.value.capabilities.includes("manage_map_series");
const production = authState.value.environment === "production";
/** Nach Production übernehmen die Betreiber und der Kartograph (WI-0279, E8: ein enges Recht nur für diese Übernahme). */
const darfProduction =
    authState.value.capabilities.includes("release_to_production") ||
    authState.value.capabilities.includes("release_map_series");
const jetzt = ref(new Date());
onMounted(() => {
    jetzt.value = new Date();
    void k.load();
});

const stand = computed(() => k.stand.value);
const serien = computed(() => stand.value?.serien ?? []);
const gewaehltId = ref<string | null>(null);
const gewaehlt = computed<AdminKartenserie | undefined>(
    () => serien.value.find((e) => e.serie.id === gewaehltId.value) ?? serien.value[0],
);
watch(serien, (liste) => {
    if (!liste.some((e) => e.serie.id === gewaehltId.value)) gewaehltId.value = liste[0]?.serie.id ?? null;
});

/**
 * Gesperrt für die ganze Seite, und zwar so lange, wie die Seite offen ist: ohne Recht, auf Production, ohne Tafel. Dieser Grund steht
 * EINMAL oben (Hinweiskasten auf Production, sonst die leise Zeile `kartenserien-nur-lesen`); die gesperrten Bedienelemente zeigen
 * darauf (`bei`) und tragen den Satz nur als `title`. Sonst stünde er an jedem ▲/▼ der Liste, unter jedem Feld und an jedem Knopf
 * (Befund Production 2026-10-25: elfmal, und die Spalte der Pfeile zerdrückte die Zeilen der Liste Silbe für Silbe).
 */
const dauerGrund = computed<string | undefined>(() => {
    if (!darf) return t("admin.kartenserien.readOnly", { recht: t("auth.capability.manage_map_series") });
    if (production) return t("admin.kartenserien.production");
    if (stand.value?.source !== "database") return t("admin.kartenserien.source.unprovisioned");
    return undefined;
});
/** Gesperrt mit Grund: der der ganzen Seite, oder solange ein Schreibweg läuft (kurz, an jedem Element, wie überall im Haus). */
const sperrGrund = computed<string | undefined>(
    () => dauerGrund.value ?? (k.busy.value !== null ? t("admin.kartenserien.busy") : undefined),
);
/** Die Kennung des Satzes oben, auf den `aria-describedby` der gesperrten Elemente zeigt. */
const dauerGrundId = useId();
/** `grundBei` eines Elements: nur wenn SEIN Grund der der ganzen Seite ist; ein eigener Grund (läuft schon, Vorgabe …) steht am Element. */
const bei = (grund: string | undefined): string | undefined =>
    grund !== undefined && grund === dauerGrund.value ? dauerGrundId : undefined;

// ── Übersicht und Bild aus den Kacheln der Serie ──────────────────────────────────────────────────────────────────────────────
const vorlagen = ref<Record<string, string | null>>({});
watch(
    serien,
    async (liste) => {
        for (const e of liste) {
            if (e.serie.id in vorlagen.value) continue;
            const vorlage = await kachelVorlage(e.serie.id);
            vorlagen.value = { ...vorlagen.value, [e.serie.id]: vorlage };
        }
    },
    { immediate: true },
);
const uebersicht = (id: string): string | null => {
    const vorlage = vorlagen.value[id];
    return vorlage ? kachelUrl(vorlage, 0, 0, 0) : null;
};
const bild = (e: AdminKartenserie): string | null => {
    const vorlage = vorlagen.value[e.serie.id];
    const { x, y } = e.serie.thumb ?? KARTENSERIE_THUMB_VORGABE;
    return vorlage ? kachelUrl(vorlage, 5, x, y) : null;
};

// ── Texte: Name und Beschreibung oben, Lizenz und Herkunft unten (eigener Bearbeiten-Modus) ───────────────────────────────────
const name = ref("");
const beschreibung = ref("");
const lizenzOffen = ref(false);
const ausschnittOffen = ref(false);
const loeschenOffen = ref(false);
const uebernahmeOffen = ref(false);
const lizenz = ref<Record<"author" | "origin" | "derivation" | "permissionStatement" | "attribution", string>>({
    author: "",
    origin: "",
    derivation: "",
    permissionStatement: "",
    attribution: "",
});
watch(
    gewaehlt,
    (e) => {
        name.value = e?.serie.label ?? "";
        beschreibung.value = e?.serie.description ?? "";
        lizenzOffen.value = false;
        ausschnittOffen.value = false;
        loeschenOffen.value = false;
        uebernahmeOffen.value = false;
    },
    { immediate: true },
);
function texteSchreiben(texte: KartenserieTexte): void {
    const e = gewaehlt.value;
    if (e === undefined || sperrGrund.value !== undefined) return;
    void k.handle(e.serie.id, { art: "texte", texte });
}
function nameVerlassen(): void {
    const e = gewaehlt.value;
    if (e !== undefined && name.value.trim() !== "" && name.value.trim() !== e.serie.label)
        texteSchreiben({ label: name.value.trim() });
    else if (e !== undefined) name.value = e.serie.label;
}
function beschreibungVerlassen(): void {
    const e = gewaehlt.value;
    if (e !== undefined && beschreibung.value !== e.serie.description)
        texteSchreiben({ description: beschreibung.value });
}
function lizenzBearbeiten(): void {
    const s = gewaehlt.value?.serie;
    if (s === undefined) return;
    lizenz.value = {
        author: s.author,
        origin: s.origin,
        derivation: s.derivation,
        permissionStatement: s.permission.statement,
        attribution: s.attribution,
    };
    lizenzOffen.value = true;
}
async function lizenzSpeichern(): Promise<void> {
    const s = gewaehlt.value?.serie;
    if (s === undefined) return;
    const vorher = {
        author: s.author,
        origin: s.origin,
        derivation: s.derivation,
        permissionStatement: s.permission.statement,
        attribution: s.attribution,
    };
    const texte = Object.fromEntries(
        (Object.keys(lizenz.value) as (keyof typeof vorher)[])
            .filter((feld) => lizenz.value[feld] !== vorher[feld])
            .map((feld) => [feld, lizenz.value[feld]]),
    ) as KartenserieTexte;
    if (Object.keys(texte).length === 0) {
        lizenzOffen.value = false;
        return;
    }
    if (await k.handle(s.id, { art: "texte", texte })) lizenzOffen.value = false;
}

// ── Sichtbarkeit, Vorgabe, Reihenfolge, Bild, Papierkorb ──────────────────────────────────────────────────────────────────────
const stufenOptionen = computed(() => {
    const e = gewaehlt.value;
    return KARTENSERIE_STUFEN.map((stufe) => {
        const grund = e === undefined ? undefined : stufeGesperrt(e, stufe, serien.value);
        return {
            value: stufe as string,
            label: label("admin.kartenserien.sicht", stufe),
            gesperrt: e === undefined || sperrGrund.value !== undefined || grund !== undefined,
            ...(grund === undefined ? {} : { hinweis: grund }),
        };
    });
});
const stufe = computed<string>({
    get: () => gewaehlt.value?.stufe ?? "alle",
    set: (wert) => {
        const e = gewaehlt.value;
        if (e !== undefined && wert !== e.stufe)
            void k.handle(e.serie.id, { art: "stufe", stufe: wert as KartenserieStufe });
    },
});
const vorgabeGrund = computed<string | undefined>(() => {
    const e = gewaehlt.value;
    if (e === undefined) return "";
    if (e.stufe !== "alle") return t("admin.kartenserien.vorgabe.nicht");
    if (e.serie.labelsInImage) return t("admin.kartenserien.error.labelsInImage");
    return sperrGrund.value;
});
function vorgabeSetzen(): void {
    const e = gewaehlt.value;
    if (e !== undefined) void k.handle(e.serie.id, { art: "vorgabe" });
}
function verschiebe(e: AdminKartenserie, richtung: "hoch" | "runter"): void {
    void k.handle(e.serie.id, { art: "reihe", richtung });
}
async function bildUebernehmen(thumb: { x: number; y: number }): Promise<void> {
    const e = gewaehlt.value;
    if (e === undefined) return;
    const istGareth = thumb.x === KARTENSERIE_THUMB_VORGABE.x && thumb.y === KARTENSERIE_THUMB_VORGABE.y;
    if (await k.handle(e.serie.id, { art: "thumb", thumb: istGareth ? null : thumb })) ausschnittOffen.value = false;
}
const loeschenGrund = computed<string | undefined>(() => {
    const e = gewaehlt.value;
    if (e === undefined) return "";
    if (e.istVorgabe) return t("admin.kartenserien.error.defaultVisible");
    if (letzteUeberallFuerAlle(e, serien.value)) return t("admin.kartenserien.error.lastSeries");
    return sperrGrund.value;
});
async function loeschen(): Promise<void> {
    const e = gewaehlt.value;
    if (e !== undefined && (await k.handle(e.serie.id, { art: "papierkorb" }))) loeschenOffen.value = false;
}
function wiederherstellen(id: string): void {
    void k.handle(id, { art: "wiederherstellen" });
}

// ── Nach Production übernehmen (Schnitt 4) ─────────────────────────────────────────────────────────────────────────────────────
const uebernahmeGrund = computed<string | undefined>(() => {
    const e = gewaehlt.value;
    if (e === undefined) return "";
    const sonst =
        stand.value?.source !== "database"
            ? t("admin.kartenserien.source.unprovisioned")
            : k.busy.value !== null
              ? t("admin.kartenserien.busy")
              : undefined;
    return uebernahmeGesperrt(e, { darf: darfProduction, sonst });
});
const uebernahmeFolge = computed(() => {
    const e = gewaehlt.value;
    if (e === undefined) return "";
    const fassung = e.fassung?.revision ?? "";
    return e.stufe === "alle"
        ? t("admin.kartenserien.uebernahme.folgeAlle", { fassung })
        : t("admin.kartenserien.uebernahme.folgeEditoren", { fassung });
});
async function uebernehmen(): Promise<void> {
    const e = gewaehlt.value;
    if (e !== undefined && (await k.uebernehmen(e.serie.id))) uebernahmeOffen.value = false;
}

const unterzeile = (e: AdminKartenserie): string =>
    t("admin.kartenserien.zeile.unter", {
        px: formatNumber(e.serie.sourcePixels, 0),
        zoom: e.serie.maxNativeZoom,
        kacheln: formatNumber(kachelZahl(e.serie.maxNativeZoom), 0),
    });
const fehler = computed(() =>
    k.ergebnis.value !== null && k.ergebnis.value.id === gewaehlt.value?.serie.id ? k.ergebnis.value.result : null,
);
const faecher = computed(() => serien.value.filter((e) => e.stufe !== "niemand"));

// ── Hochladen, Ersetzen, Fassungen (Schnitt 3) ─────────────────────────────────────────────────────────────────────────────────
const hochladen = createHochladen();
const formular = ref<null | { art: "neu" } | { art: "ersetzen" | "quelle"; id: string; label: string }>(null);
/** Die zuletzt gewählte Datei: Fortsetzen nach einem Abbruch nimmt sie wieder, solange die Seite offen ist. */
const letzteDatei = ref<File | null>(null);
const vorhanden = computed(() => [
    ...serien.value.map((e) => e.serie.id),
    ...(stand.value?.papierkorb ?? []).map((p) => p.id),
    ...(stand.value?.inArbeit ?? []).map((e) => e.id),
]);
async function losHochladen(datei: File, ziel: KartenserieUploadZiel, kante: number): Promise<void> {
    formular.value = null;
    letzteDatei.value = datei;
    await hochladen.starte(datei, ziel, kante);
    await k.load();
}
async function fortsetzen(upload: KartenserieUpload, datei: File | null = letzteDatei.value): Promise<void> {
    if (datei === null) return;
    letzteDatei.value = datei;
    await hochladen.setzeFort(datei, upload);
    await k.load();
}
function fortsetzenMitDatei(upload: KartenserieUpload, event: Event): void {
    const datei = (event.target as HTMLInputElement).files?.[0] ?? null;
    if (datei !== null) void fortsetzen(upload, datei);
}
/** Der Upload, den dieser Browser gerade führt (für Anhalten und Fortsetzen). */
const meinUpload = computed(() => hochladen.stand.value);
const ablaufVon = (id: string, auftrag: KartenserieAuftrag | null) =>
    ablauf(meinUpload.value?.serie === id ? meinUpload.value : null, auftrag);
const hochladenZustand = (id: string): "laeuft" | "angehalten" | undefined => {
    const u = meinUpload.value;
    if (u === null || u.serie !== id) return undefined;
    return u.phase === "hochladen" ? "laeuft" : u.phase === "angehalten" ? "angehalten" : undefined;
};
function weiter(id: string): void {
    const upload = stand.value?.uploads.find((u) => u.ziel.id === id);
    if (upload !== undefined) void fortsetzen(upload);
}
/** Neue Serien, die dieser Browser gerade hochlädt, aber die der Server noch nicht „in Arbeit“ führt (Zeile entsteht beim Abschluss). */
const neuImBrowser = computed(() => {
    const u = meinUpload.value;
    if (u === null || u.art !== "neu" || u.phase === "fertig") return null;
    return (stand.value?.inArbeit ?? []).some((e) => e.id === u.serie) ? null : u;
});
/** Unterbrochene Uploads, die nicht dieser Browser gerade führt: Fortsetzen braucht die Datei noch einmal. */
const unterbrochen = computed(() =>
    (stand.value?.uploads ?? []).filter((u) => meinUpload.value?.uploadId !== u.uploadId),
);
const ersetzenGrund = computed<string | undefined>(() => {
    const e = gewaehlt.value;
    if (e === undefined) return "";
    if (e.auftrag !== null && (e.auftrag.state === "QUEUED" || e.auftrag.state === "RUNNING"))
        return t("admin.kartenserien.hochladen.laeuftSchon");
    if (meinUpload.value?.serie === e.serie.id && meinUpload.value.phase !== "fertig")
        return t("admin.kartenserien.hochladen.laeuftSchon");
    return sperrGrund.value;
});
const neuGrund = computed<string | undefined>(() =>
    meinUpload.value !== null && meinUpload.value.phase === "hochladen"
        ? t("admin.kartenserien.hochladen.laeuftSchon")
        : sperrGrund.value,
);
function fassungZurueck(revision: string): void {
    const e = gewaehlt.value;
    if (e !== undefined) void k.handle(e.serie.id, { art: "fassung", revision });
}
const gb = (bytes: number): string => formatNumber(bytes / 1024 ** 3, 0);
const platzSatz = computed(() =>
    stand.value?.platz
        ? t("admin.kartenserien.platz", {
              frei: gb(stand.value.platz.freiBytes),
              grenze: gb(stand.value.platz.grenzeBytes),
          })
        : null,
);

// Solange ein Auftrag wartet oder rechnet, liest der Reiter alle vier Sekunden nach (Fortschritt und Umschalten).
let takt: ReturnType<typeof setInterval> | undefined;
watch(
    () => laeuftEtwas(stand.value),
    (an) => {
        clearInterval(takt);
        takt = an ? setInterval(() => void k.load(), 4_000) : undefined;
    },
    { immediate: true },
);
onBeforeUnmount(() => clearInterval(takt));
const datum = (iso: string): string => new Date(iso).toLocaleDateString();
</script>

<template>
    <div class="kartenserien" :class="{ 'kartenserien--telefon': props.telefon }" data-testid="kartenserien">
        <VerwaltungLadeproblem
            :problems="k.loadProblems.value"
            :fehlt="k.unconfirmed.value"
            testid="kartenserien-ladefehler"
            @bestaetigen="k.confirmAgain()"
            ><span>{{ t("admin.kartenserien.loadFailed") }}</span></VerwaltungLadeproblem
        >
        <p v-if="stand === null && k.loading.value" class="kartenserien__leise">{{ t("admin.loading") }}</p>
        <template v-if="stand !== null">
            <AvmHinweis>
                <strong>{{ t("admin.kartenserien.leadFirst") }}</strong>
                {{ " " }}{{ t("admin.kartenserien.lead") }}
            </AvmHinweis>
            <!-- Der Grund der Sperre, EINMAL für die ganze Seite; auf Production der Kasten, der auch sagt, wo eine Serie stattdessen herkommt. -->
            <AvmHinweis v-if="production" :id="dauerGrundId" data-testid="kartenserien-production-hinweis">{{
                t("admin.kartenserien.uebernahme.dort")
            }}</AvmHinweis>
            <p
                v-else-if="dauerGrund !== undefined"
                :id="dauerGrundId"
                class="kartenserien__leise"
                data-testid="kartenserien-nur-lesen"
            >
                {{ dauerGrund }}
            </p>

            <div class="kartenserien__oben">
                <span v-if="platzSatz" class="kartenserien__leise" data-testid="kartenserien-platz">{{
                    platzSatz
                }}</span>
                <AvmKnopf
                    art="gefuellt"
                    :gesperrt="neuGrund"
                    :grund-bei="bei(neuGrund)"
                    testid="kartenserien-neu"
                    @click="formular = { art: 'neu' }"
                >
                    <span aria-hidden="true">✚ </span>{{ t("admin.kartenserien.hochladen.titelNeu") }}
                </AvmKnopf>
            </div>
            <KartenserieHochladen
                v-if="formular !== null"
                :ziel="formular"
                :vorhanden="vorhanden"
                :gesperrt="sperrGrund"
                @los="losHochladen"
                @abbrechen="formular = null"
            />
            <KartenserieAblauf
                v-if="neuImBrowser && ablaufVon(neuImBrowser.serie, null)"
                :titel="t('admin.kartenserien.ablauf.titelNeu', { name: neuImBrowser.serie })"
                :sicht="ablaufVon(neuImBrowser.serie, null)!"
                :fuss="t('admin.kartenserien.hochladen.fussNeu')"
                :hochladen="hochladenZustand(neuImBrowser.serie)"
                testid="kartenserien-ablauf-neu"
                @anhalten="hochladen.halteAn()"
                @fortsetzen="weiter(neuImBrowser.serie)"
            />
            <template v-for="e in stand.inArbeit" :key="e.id">
                <KartenserieAblauf
                    v-if="ablaufVon(e.id, e.auftrag)"
                    :titel="t('admin.kartenserien.ablauf.titelNeu', { name: e.label })"
                    :sicht="ablaufVon(e.id, e.auftrag)!"
                    :fuss="t('admin.kartenserien.hochladen.fussNeu')"
                    :testid="`kartenserien-arbeit-${e.id}`"
                />
                <div
                    v-if="e.auftrag !== null && (e.auftrag.state === 'FAILED' || e.auftrag.state === 'CANCELLED')"
                    class="kartenserien__aktionen"
                >
                    <AvmKnopf
                        art="gefahr"
                        :gesperrt="sperrGrund"
                        :testid="`kartenserien-arbeit-weg-${e.id}`"
                        @click="k.handle(e.id, { art: 'papierkorb' })"
                    >
                        <span aria-hidden="true">✕ </span>{{ t("admin.kartenserien.aktion.papierkorb") }}
                    </AvmKnopf>
                </div>
            </template>
            <AvmHinweis
                v-for="u in unterbrochen"
                :key="u.uploadId"
                ton="warnung"
                :data-testid="`kartenserien-unterbrochen-${u.ziel.id}`"
            >
                {{
                    t("admin.kartenserien.hochladen.unterbrochen", {
                        name: u.ziel.art === "neu" ? u.ziel.anlage.label : u.ziel.id,
                        von: formatNumber(u.empfangen / 1024 ** 2, 0),
                        bis: formatNumber(u.bytes / 1024 ** 2, 0),
                    })
                }}
                <label class="kartenserien__datei">
                    <input
                        class="kartenserien__datei-eingabe"
                        type="file"
                        accept="image/png"
                        :disabled="sperrGrund !== undefined"
                        :data-testid="`kartenserien-fortsetzen-${u.ziel.id}`"
                        @change="fortsetzenMitDatei(u, $event)"
                    />
                    {{ t("admin.kartenserien.hochladen.fortsetzenDatei") }}
                </label>
            </AvmHinweis>

            <div class="kartenserien__rumpf">
                <ul
                    class="kartenserien__liste"
                    :aria-label="t('admin.kartenserien.liste')"
                    data-testid="kartenserien-liste"
                >
                    <li v-for="(e, index) in serien" :key="e.serie.id" class="kartenserien__eintrag">
                        <button
                            type="button"
                            class="kartenserien__zeile"
                            :aria-current="e.serie.id === gewaehlt?.serie.id ? 'true' : undefined"
                            :data-testid="`kartenserien-zeile-${e.serie.id}`"
                            @click="gewaehltId = e.serie.id"
                        >
                            <img
                                v-if="uebersicht(e.serie.id)"
                                class="kartenserien__uebersicht"
                                :src="uebersicht(e.serie.id)!"
                                alt=""
                            />
                            <span v-else class="kartenserien__uebersicht" aria-hidden="true"></span>
                            <span class="kartenserien__text">
                                <span class="kartenserien__name">{{ e.serie.label }}</span>
                                <span class="kartenserien__unter">{{ unterzeile(e) }}</span>
                                <span class="kartenserien__pillen">
                                    <AvmPille v-if="e.istVorgabe">{{ t("admin.kartenserien.pille.vorgabe") }}</AvmPille>
                                    <AvmPille v-if="e.stufe === 'editoren'" ton="lokal">{{
                                        t("admin.kartenserien.pille.editoren")
                                    }}</AvmPille>
                                    <AvmPille v-if="e.stufe === 'niemand'" ton="warnung">{{
                                        t("admin.kartenserien.pille.niemand")
                                    }}</AvmPille>
                                </span>
                            </span>
                        </button>
                        <span class="kartenserien__reihe">
                            <AvmKnopf
                                groesse="zeile"
                                :gesperrt="index === 0 ? '' : sperrGrund"
                                :grund-bei="index === 0 ? undefined : bei(sperrGrund)"
                                :aria-label="t('admin.kartenserien.reihe.hoch')"
                                :testid="`kartenserien-hoch-${e.serie.id}`"
                                @click="verschiebe(e, 'hoch')"
                                >▲</AvmKnopf
                            >
                            <AvmKnopf
                                groesse="zeile"
                                :gesperrt="index === serien.length - 1 ? '' : sperrGrund"
                                :grund-bei="index === serien.length - 1 ? undefined : bei(sperrGrund)"
                                :aria-label="t('admin.kartenserien.reihe.runter')"
                                :testid="`kartenserien-runter-${e.serie.id}`"
                                @click="verschiebe(e, 'runter')"
                                >▼</AvmKnopf
                            >
                        </span>
                    </li>
                </ul>

                <section
                    v-if="gewaehlt"
                    class="kartenserien__detail"
                    :data-testid="`kartenserien-detail-${gewaehlt.serie.id}`"
                >
                    <label class="kartenserien__feld">
                        <span class="kartenserien__leise">{{ t("admin.kartenserien.feld.name") }}</span>
                        <AvmEingabe
                            v-model="name"
                            :gesperrt="sperrGrund"
                            :grund-bei="bei(sperrGrund)"
                            maxlength="60"
                            testid="kartenserien-name"
                            @blur="nameVerlassen"
                            @keyup.enter="nameVerlassen"
                        />
                    </label>
                    <label class="kartenserien__feld">
                        <span class="kartenserien__leise">{{ t("admin.kartenserien.feld.beschreibung") }}</span>
                        <AvmTextbereich
                            v-model="beschreibung"
                            :zeilen="2"
                            :gesperrt="sperrGrund"
                            :grund-bei="bei(sperrGrund)"
                            maxlength="300"
                            testid="kartenserien-beschreibung"
                            @blur="beschreibungVerlassen"
                        />
                    </label>
                    <span v-if="geaendertText(gewaehlt, jetzt)" class="kartenserien__leise">{{
                        geaendertText(gewaehlt, jetzt)
                    }}</span>
                    <VerwaltungMeldung v-if="fehler" :ergebnis="fehler" testid="kartenserien-meldung" />

                    <!-- Auf Production gibt es hier keine Aktionen; warum, sagt der Kasten oben (`kartenserien-production-hinweis`). -->
                    <div v-if="!production" class="kartenserien__aktionen">
                        <AvmKnopf
                            :gesperrt="ersetzenGrund"
                            :grund-bei="bei(ersetzenGrund)"
                            testid="kartenserien-ersetzen"
                            @click="formular = { art: 'ersetzen', id: gewaehlt.serie.id, label: gewaehlt.serie.label }"
                        >
                            <span aria-hidden="true">⇄ </span>{{ t("admin.kartenserien.aktion.ersetzen") }}
                        </AvmKnopf>
                        <AvmKnopf
                            v-if="gewaehlt.quelleDa === false"
                            :gesperrt="ersetzenGrund"
                            :grund-bei="bei(ersetzenGrund)"
                            testid="kartenserien-quelle"
                            @click="formular = { art: 'quelle', id: gewaehlt.serie.id, label: gewaehlt.serie.label }"
                        >
                            <span aria-hidden="true">✚ </span>{{ t("admin.kartenserien.aktion.quelle") }}
                        </AvmKnopf>
                        <AvmKnopf
                            :gesperrt="uebernahmeGrund"
                            :grund-bei="bei(uebernahmeGrund)"
                            testid="kartenserien-uebernehmen"
                            @click="uebernahmeOffen = true"
                        >
                            <span aria-hidden="true">→ </span>{{ t("admin.kartenserien.aktion.uebernehmen") }}
                        </AvmKnopf>
                        <AvmKnopf
                            art="gefahr"
                            :gesperrt="loeschenGrund"
                            :grund-bei="bei(loeschenGrund)"
                            testid="kartenserien-loeschen"
                            @click="loeschenOffen = true"
                        >
                            <span aria-hidden="true">✕ </span>{{ t("admin.kartenserien.aktion.papierkorb") }}
                        </AvmKnopf>
                    </div>
                    <AvmBestaetigung
                        v-if="loeschenOffen"
                        :frage="t('admin.kartenserien.papierkorb.frage', { name: gewaehlt.serie.label })"
                        :folge="t('admin.kartenserien.papierkorb.folge', { tage: KARTENSERIE_PAPIERKORB_TAGE })"
                        :bestaetigen="t('admin.kartenserien.papierkorb.bestaetigen')"
                        :gesperrt="loeschenGrund"
                        testid="kartenserien-loeschen-frage"
                        @bestaetigen="loeschen"
                        @abbrechen="loeschenOffen = false"
                    />
                    <AvmBestaetigung
                        v-if="uebernahmeOffen"
                        :frage="t('admin.kartenserien.uebernahme.frage', { name: gewaehlt.serie.label })"
                        :folge="`${uebernahmeFolge} ${t('admin.kartenserien.uebernahme.hinweis')}`"
                        :bestaetigen="t('admin.kartenserien.uebernahme.bestaetigen')"
                        :gesperrt="uebernahmeGrund"
                        testid="kartenserien-uebernehmen-frage"
                        @bestaetigen="uebernehmen"
                        @abbrechen="uebernahmeOffen = false"
                    />
                    <span
                        v-if="!production && uebernahmeSatz(gewaehlt, jetzt)"
                        class="kartenserien__leise"
                        data-testid="kartenserien-uebernahme-stand"
                        >{{ uebernahmeSatz(gewaehlt, jetzt) }}</span
                    >

                    <KartenserieAblauf
                        v-if="ablaufVon(gewaehlt.serie.id, gewaehlt.auftrag)"
                        :titel="t('admin.kartenserien.ablauf.titelErsetzen')"
                        :sicht="ablaufVon(gewaehlt.serie.id, gewaehlt.auftrag)!"
                        :fuss="t('admin.kartenserien.hochladen.fussErsetzen')"
                        :hochladen="hochladenZustand(gewaehlt.serie.id)"
                        testid="kartenserien-ablauf"
                        @anhalten="hochladen.halteAn()"
                        @fortsetzen="weiter(gewaehlt.serie.id)"
                    />

                    <FensterKarte :titel="t('admin.kartenserien.sicht.titel')" data-testid="kartenserien-sichtbarkeit">
                        <div class="kartenserien__einstellungen">
                            <div class="kartenserien__einst">
                                <span class="kartenserien__was">
                                    <span class="kartenserien__wasname">{{ t("admin.kartenserien.sicht.frage") }}</span>
                                    <span class="kartenserien__leise">{{ stufenSatz(gewaehlt) }}</span>
                                </span>
                                <AvmSegmente
                                    v-model="stufe"
                                    :options="stufenOptionen"
                                    :label="t('admin.kartenserien.sicht.frage')"
                                    :gestapelt="props.telefon"
                                    testid="kartenserien-stufe"
                                />
                            </div>
                            <div class="kartenserien__einst">
                                <span class="kartenserien__was">
                                    <span class="kartenserien__wasname">{{
                                        t("admin.kartenserien.vorgabe.name")
                                    }}</span>
                                    <!-- Warum der Knopf gesperrt ist, sagt sein eigener Satz rechts; links steht er nicht noch einmal. -->
                                    <span class="kartenserien__leise">{{
                                        gewaehlt.istVorgabe
                                            ? t("admin.kartenserien.vorgabe.ist")
                                            : t("admin.kartenserien.vorgabe.kann")
                                    }}</span>
                                </span>
                                <span class="kartenserien__feld-ohne-mass">
                                    <AvmPille v-if="gewaehlt.istVorgabe" testid="kartenserien-ist-vorgabe"
                                        >● {{ t("admin.kartenserien.pille.vorgabe") }}</AvmPille
                                    >
                                    <AvmKnopf
                                        v-else
                                        :gesperrt="vorgabeGrund"
                                        :grund-bei="bei(vorgabeGrund)"
                                        testid="kartenserien-vorgabe"
                                        @click="vorgabeSetzen"
                                    >
                                        <span aria-hidden="true">● </span>{{ t("admin.kartenserien.vorgabe.setzen") }}
                                    </AvmKnopf>
                                </span>
                            </div>
                        </div>
                        <p class="kartenserien__leise">{{ t("admin.kartenserien.sicht.inhalte") }}</p>
                    </FensterKarte>

                    <FensterKarte :titel="t('admin.kartenserien.thumb.titel')" data-testid="kartenserien-bild">
                        <div class="kartenserien__bildzeile">
                            <img v-if="bild(gewaehlt)" class="kartenserien__bild" :src="bild(gewaehlt)!" alt="" />
                            <span class="kartenserien__was">
                                <span class="kartenserien__leise">
                                    {{
                                        t(
                                            "admin.kartenserien.thumb.ausschnitt",
                                            gewaehlt.serie.thumb ?? KARTENSERIE_THUMB_VORGABE,
                                        )
                                    }}
                                    <template v-if="gewaehlt.serie.thumb === undefined">
                                        {{ t("admin.kartenserien.thumb.gareth") }}</template
                                    >
                                </span>
                                <AvmKnopf
                                    v-if="!ausschnittOffen"
                                    :gesperrt="sperrGrund"
                                    :grund-bei="bei(sperrGrund)"
                                    testid="kartenserien-ausschnitt-oeffnen"
                                    @click="ausschnittOffen = true"
                                >
                                    <span aria-hidden="true">◎ </span>{{ t("admin.kartenserien.thumb.waehlen") }}
                                </AvmKnopf>
                            </span>
                        </div>
                        <KartenserieAusschnitt
                            v-if="ausschnittOffen"
                            :series-id="gewaehlt.serie.id"
                            :name="gewaehlt.serie.label"
                            :thumb="gewaehlt.serie.thumb ?? KARTENSERIE_THUMB_VORGABE"
                            :gesperrt="sperrGrund"
                            @uebernehmen="bildUebernehmen"
                            @abbrechen="ausschnittOffen = false"
                        />
                        <span class="kartenserien__leise">{{ t("admin.kartenserien.thumb.vorschau") }}</span>
                        <div class="kartenserien__faecher" data-testid="kartenserien-faecher">
                            <figure
                                v-for="e in faecher"
                                :key="e.serie.id"
                                class="kartenserien__fach"
                                :class="{ 'kartenserien__fach--vorgabe': e.istVorgabe }"
                            >
                                <img v-if="bild(e)" :src="bild(e)!" alt="" />
                                <figcaption>
                                    {{ e.serie.label
                                    }}<template v-if="e.stufe === 'editoren'">
                                        · {{ t("admin.kartenserien.faecher.editoren") }}</template
                                    >
                                </figcaption>
                            </figure>
                        </div>
                    </FensterKarte>

                    <FensterKarte :titel="t('admin.kartenserien.infos.titel')" data-testid="kartenserien-infos">
                        <dl class="kartenserien__daten">
                            <dt>{{ t("admin.kartenserien.infos.kennung") }}</dt>
                            <dd>
                                <code>{{ gewaehlt.serie.id }}</code>
                            </dd>
                            <dt>{{ t("admin.kartenserien.infos.quelle") }}</dt>
                            <dd>
                                {{
                                    t("admin.kartenserien.infos.quelleWert", {
                                        px: formatNumber(gewaehlt.serie.sourcePixels, 0),
                                    })
                                }}
                                <span class="kartenserien__leise">· {{ t("admin.kartenserien.infos.sicherung") }}</span>
                            </dd>
                            <dt>{{ t("admin.kartenserien.infos.kacheln") }}</dt>
                            <dd>
                                {{
                                    t("admin.kartenserien.infos.kachelnWert", {
                                        kacheln: formatNumber(kachelZahl(gewaehlt.serie.maxNativeZoom), 0),
                                        zoom: gewaehlt.serie.maxNativeZoom,
                                    })
                                }}
                            </dd>
                            <dt>{{ t("admin.kartenserien.infos.fassung") }}</dt>
                            <dd>
                                <code v-if="gewaehlt.fassung">{{ gewaehlt.fassung.revision }}</code
                                ><template v-else>{{ t("admin.kartenserien.infos.fassungUnbekannt") }}</template>
                            </dd>
                            <dt>{{ t("admin.kartenserien.infos.beschriftung") }}</dt>
                            <dd>
                                {{
                                    gewaehlt.serie.labelsInImage
                                        ? t("admin.kartenserien.infos.imBild")
                                        : t("admin.kartenserien.infos.ohne")
                                }}
                            </dd>
                        </dl>
                    </FensterKarte>

                    <FensterKarte :titel="t('admin.kartenserien.fassungen.titel')" data-testid="kartenserien-fassungen">
                        <ul v-if="gewaehlt.fassungen.length > 0" class="kartenserien__korb">
                            <li
                                v-for="f in gewaehlt.fassungen"
                                :key="f.revision"
                                :data-testid="`kartenserien-fassung-${f.revision}`"
                            >
                                <span
                                    ><code>{{ f.revision }}</code>
                                    <span class="kartenserien__leise"
                                        >· {{ f.seit ? datum(f.seit) : "" }} ·
                                        {{
                                            f.aktuell
                                                ? t("admin.kartenserien.fassungen.aktiv")
                                                : t("admin.kartenserien.fassungen.vorige")
                                        }}</span
                                    ></span
                                >
                                <AvmKnopf
                                    v-if="!f.aktuell"
                                    :gesperrt="sperrGrund"
                                    :grund-bei="bei(sperrGrund)"
                                    :testid="`kartenserien-fassung-zurueck-${f.revision}`"
                                    @click="fassungZurueck(f.revision)"
                                >
                                    <span aria-hidden="true">↺ </span>{{ t("admin.kartenserien.fassungen.zurueck") }}
                                </AvmKnopf>
                            </li>
                        </ul>
                        <span class="kartenserien__leise">{{
                            gewaehlt.fassungen.length > 1
                                ? t("admin.kartenserien.fassungen.satzMehrere")
                                : t("admin.kartenserien.fassungen.satzEine")
                        }}</span>
                    </FensterKarte>

                    <FensterKarte :titel="t('admin.kartenserien.lizenz.titel')" data-testid="kartenserien-lizenz">
                        <AvmHinweis v-if="!permissionIsEvidenced(gewaehlt.serie)" ton="warnung">{{
                            t("admin.kartenserien.lizenz.ohneNachweis")
                        }}</AvmHinweis>
                        <dl class="kartenserien__daten">
                            <dt>{{ t("admin.kartenserien.lizenz.lizenz") }}</dt>
                            <dd>
                                <a :href="stand.license.uri" target="_blank" rel="noopener noreferrer">{{
                                    stand.license.name
                                }}</a>
                            </dd>
                            <template
                                v-for="feld in [
                                    'author',
                                    'origin',
                                    'derivation',
                                    'permissionStatement',
                                    'attribution',
                                ] as const"
                                :key="feld"
                            >
                                <dt>{{ label("admin.kartenserien.lizenz", feld) }}</dt>
                                <dd v-if="lizenzOffen">
                                    <AvmTextbereich
                                        v-model="lizenz[feld]"
                                        :zeilen="feld === 'author' || feld === 'attribution' ? 1 : 3"
                                        :testid="`kartenserien-lizenz-${feld}`"
                                    />
                                </dd>
                                <dd v-else>
                                    {{
                                        feld === "permissionStatement"
                                            ? gewaehlt.serie.permission.statement
                                            : gewaehlt.serie[feld]
                                    }}
                                </dd>
                            </template>
                        </dl>
                        <div class="kartenserien__aktionen">
                            <template v-if="lizenzOffen">
                                <AvmKnopf testid="kartenserien-lizenz-abbrechen" @click="lizenzOffen = false">{{
                                    t("admin.kartenserien.lizenz.abbrechen")
                                }}</AvmKnopf>
                                <AvmKnopf
                                    art="gefuellt"
                                    :gesperrt="sperrGrund"
                                    :grund-bei="bei(sperrGrund)"
                                    testid="kartenserien-lizenz-speichern"
                                    @click="lizenzSpeichern"
                                    >{{ t("admin.kartenserien.lizenz.speichern") }}</AvmKnopf
                                >
                            </template>
                            <AvmKnopf
                                v-else
                                :gesperrt="sperrGrund"
                                :grund-bei="bei(sperrGrund)"
                                testid="kartenserien-lizenz-bearbeiten"
                                @click="lizenzBearbeiten"
                            >
                                <span aria-hidden="true">✎ </span>{{ t("admin.kartenserien.lizenz.bearbeiten") }}
                            </AvmKnopf>
                        </div>
                        <span class="kartenserien__leise">{{ t("admin.kartenserien.lizenz.abnahme") }}</span>
                    </FensterKarte>
                </section>
            </div>

            <KartenserienPapierkorb
                :papierkorb="stand.papierkorb"
                :gesperrt="sperrGrund"
                :grund-bei="bei(sperrGrund)"
                @wiederherstellen="wiederherstellen"
            />
        </template>
    </div>
</template>

<style scoped>
.kartenserien {
    display: grid;
    gap: var(--space-10);
    align-content: start;
}

.kartenserien__leise {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

/* Die Leiste oben: der freie Platz links, der EINE Auslöser „Neue Kartenserie“ rechts. */
.kartenserien__oben {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-6) var(--space-10);
}

.kartenserien__datei {
    position: relative;
    display: inline-block;
    margin-left: var(--space-6);
    text-decoration: underline;
    cursor: pointer;
}

.kartenserien__datei-eingabe {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
}

.kartenserien__rumpf {
    display: grid;
    grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
    gap: var(--space-16);
    align-items: start;
}

.kartenserien--telefon .kartenserien__rumpf {
    grid-template-columns: minmax(0, 1fr);
}

.kartenserien__liste {
    display: grid;
    gap: var(--space-4);
    margin: 0;
    padding: 0;
    list-style: none;
}

.kartenserien__eintrag {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--space-4);
    align-items: center;
}

.kartenserien__zeile {
    display: grid;
    grid-template-columns: 4.75rem minmax(0, 1fr);
    gap: var(--space-8);
    align-items: center;
    padding: var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel);
    color: var(--color-text);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: background 120ms ease;
}

.kartenserien__zeile:hover {
    background: var(--color-hover-wash);
}

.kartenserien__zeile[aria-current="true"] {
    background: var(--color-active-wash);
    border-color: var(--color-border-strong);
}

.kartenserien__zeile:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.kartenserien__uebersicht {
    width: 4.75rem;
    height: 4.75rem;
    border-radius: var(--radius-sm);
    background: var(--color-panel-muted);
    display: block;
}

.kartenserien__text {
    display: grid;
    gap: var(--space-2);
    min-width: 0;
}

.kartenserien__name {
    color: var(--color-text-strong);
    font-size: var(--font-size-reading);
}

.kartenserien__unter {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    overflow-wrap: anywhere;
}

.kartenserien__pillen,
.kartenserien__aktionen {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
}

.kartenserien__reihe {
    display: grid;
    gap: var(--space-2);
}

.kartenserien__detail {
    display: grid;
    gap: var(--space-8);
    min-width: 0;
}

.kartenserien__feld {
    display: grid;
    gap: var(--space-2);
}

/*
 * Die Einstellungszeilen eines Kastens teilen EIN Raster (Guide §8, „Seiten mit vielen Einstellungen“): Das Feld beginnt im Goldenen
 * Schnitt, aber nie schmaler, als die Auswahl ungekürzt braucht (Betreiber 2026-10-18 zur Sichtbarkeit: „gibt dem feld rechts bei
 * sichtbarkeit zur auswahl doch mehr platz“). Braucht sie mehr, rückt der Beginn für ALLE Zeilen gemeinsam nach links; die Felder
 * fluchten weiter (Unterraster).
 */
.kartenserien__einstellungen {
    display: grid;
    grid-template-columns: minmax(0, 61.8fr) minmax(max-content, 38.2fr);
    column-gap: var(--space-8);
    row-gap: var(--space-10);
}

.kartenserien__einst {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: subgrid;
    align-items: center;
}

/* Ein Feld mit langem Sperrgrund darunter zählt nicht für die Breite der Feldspalte: Der Satz bricht in der Spalte um. */
.kartenserien__feld-ohne-mass {
    contain: inline-size;
    min-width: 0;
}

.kartenserien--telefon .kartenserien__einstellungen {
    grid-template-columns: minmax(0, 1fr);
}

.kartenserien__was {
    display: grid;
    gap: var(--space-2);
    min-width: 0;
}

.kartenserien__wasname {
    color: var(--color-text-strong);
}

.kartenserien__bildzeile {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-10);
    align-items: center;
}

.kartenserien__bild {
    width: 5.25rem;
    height: 5.25rem;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
}

.kartenserien__faecher {
    display: flex;
    gap: var(--space-8);
    padding: var(--space-8);
    overflow-x: auto;
    border-radius: var(--radius-md);
    background: var(--color-panel-muted);
}

.kartenserien__fach {
    display: grid;
    justify-items: center;
    gap: var(--space-2);
    margin: 0;
    font-size: var(--font-size-caption);
    color: var(--color-text-muted);
}

.kartenserien__fach img {
    width: 4rem;
    height: 4rem;
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-strong);
}

.kartenserien__fach--vorgabe img {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
}

.kartenserien__daten {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: var(--space-2) var(--space-12);
    margin: 0;
}

.kartenserien__daten dt {
    color: var(--color-text-muted);
}

.kartenserien__daten dd {
    margin: 0;
    min-width: 0;
    overflow-wrap: anywhere;
    font-variant-numeric: tabular-nums;
}

.kartenserien__korb {
    display: grid;
    gap: var(--space-4);
    margin: 0;
    padding: 0;
    list-style: none;
}

.kartenserien__korb li {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-8);
    align-items: center;
    justify-content: space-between;
}
</style>
