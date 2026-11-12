import { computed, onBeforeUnmount, ref, shallowRef, watch, type Ref, type ShallowRef } from "vue";
import type {
    MamAssetSummary,
    MamNavigation,
    MamGalleryList,
    MamKarteDetail,
    MamKartenListe,
    MamTypeImageList,
    MediaAssetDetail,
    MediaGalleryDetail,
    MediaUsageResult,
    PhotoboxGalerien,
    PhotoboxOrtReisebilder,
} from "@avesmaps3d/shared";
import { istAbbruch, medienFehler, type MedienClient, type MedienFehler } from "./medien-client";
import { istObjekt, listenSchluessel, MEDIEN_SEITE, suchanfrage, type MedienZustand } from "./medien-zustand";

/**
 * Was die drei Spalten laden (WI-0068 P3): Navigation einmal je Öffnen, die Liste je Suche (seitenweise), Inspector, Verwendungen und
 * Galerie je Asset. Jede Frage hat ihren eigenen Abbruch; eine ältere Antwort überschreibt nie eine jüngere.
 *
 * Die Suche im Kopf wartet kurz auf das Ende des Tippens (`TIPP_PAUSE_MS`); jede andere Änderung fragt sofort.
 */
export const TIPP_PAUSE_MS = 250;
/** Wie viele Galerien eines Assets der Inspector höchstens holt (heute trägt jedes Bild höchstens eine). */
const GALERIEN_MAX = 3;

export interface Geladen<T> {
    wert: T | undefined;
    laedt: boolean;
    fehler: MedienFehler | undefined;
}

const leer = <T>(): Geladen<T> => ({ wert: undefined, laedt: false, fehler: undefined });

export interface MedienListe {
    items: MamAssetSummary[];
    total: number;
    /** Lädt gerade eine Seite (die erste oder eine weitere). */
    laedt: boolean;
    fehler: MedienFehler | undefined;
}

export interface MedienDaten {
    navigation: ShallowRef<Geladen<MamNavigation>>;
    liste: ShallowRef<MedienListe>;
    detail: ShallowRef<Geladen<MediaAssetDetail>>;
    verwendung: ShallowRef<Geladen<MediaUsageResult>>;
    /** Die Galerien, in denen das gewählte Asset steht. */
    galerien: ShallowRef<MediaGalleryDetail[]>;
    /** Die 37 Typbildkategorien; geladen, solange das Medienobjekt „Typbilder“ gewählt ist. */
    typbilder: ShallowRef<Geladen<MamTypeImageList>>;
    /** Die Galerien; geladen, solange das Medienobjekt „Galerien“ gewählt ist. */
    galerienListe: ShallowRef<Geladen<MamGalleryList>>;
    /** Die gewählte Galerie als Ganzes (Folge, Cover, Bindungen). */
    galerie: ShallowRef<Geladen<MediaGalleryDetail>>;
    /** Die Kartensammlung (WI-0068 R5); geladen, solange das Medienobjekt „Kartensammlung“ gewählt ist. */
    kartenListe: ShallowRef<Geladen<MamKartenListe>>;
    /** Die gewählte Karte als Ganzes. */
    karte: ShallowRef<Geladen<MamKarteDetail>>;
    /** „Stillgelegte anzeigen“ unter der Liste der Kartensammlung (WI-0287); eine Änderung lädt die Liste neu. */
    kartenStillgelegte: Ref<boolean>;
    /** Die PhotoBox-Galerien; geladen, solange das Medienobjekt gewählt ist. */
    photoboxListe: ShallowRef<Geladen<PhotoboxGalerien>>;
    /** Die Reisebilder der gewählten PhotoBox-Galerie. */
    photoboxGalerie: ShallowRef<Geladen<PhotoboxOrtReisebilder>>;
    mehrLaden(): void;
    erneutListe(): void;
    erneutNavigation(): void;
    erneutAsset(): void;
    erneutTypbilder(): void;
    erneutGalerien(): void;
    erneutKarten(): void;
    erneutPhotobox(): void;
}

export function useMedienDaten(offen: Ref<boolean>, zustand: Ref<MedienZustand>, client: MedienClient): MedienDaten {
    const navigation = shallowRef<Geladen<MamNavigation>>(leer());
    const liste = shallowRef<MedienListe>({ items: [], total: 0, laedt: false, fehler: undefined });
    const detail = shallowRef<Geladen<MediaAssetDetail>>(leer());
    const verwendung = shallowRef<Geladen<MediaUsageResult>>(leer());
    const galerien = shallowRef<MediaGalleryDetail[]>([]);
    const typbilder = shallowRef<Geladen<MamTypeImageList>>(leer());
    const galerienListe = shallowRef<Geladen<MamGalleryList>>(leer());
    const galerie = shallowRef<Geladen<MediaGalleryDetail>>(leer());
    const kartenListe = shallowRef<Geladen<MamKartenListe>>(leer());
    const karte = shallowRef<Geladen<MamKarteDetail>>(leer());
    const kartenStillgelegte = ref(false);
    const photoboxListe = shallowRef<Geladen<PhotoboxGalerien>>(leer());
    const photoboxGalerie = shallowRef<Geladen<PhotoboxOrtReisebilder>>(leer());

    const abbrueche = new Map<string, AbortController>();
    function neu(name: string): AbortSignal {
        abbrueche.get(name)?.abort();
        const controller = new AbortController();
        abbrueche.set(name, controller);
        return controller.signal;
    }

    async function ladeNavigation(): Promise<void> {
        const signal = neu("navigation");
        navigation.value = { ...navigation.value, laedt: true, fehler: undefined };
        try {
            const wert = await client.navigation(signal);
            if (!signal.aborted) navigation.value = { wert, laedt: false, fehler: undefined };
        } catch (error) {
            if (!istAbbruch(error, signal))
                navigation.value = { wert: undefined, laedt: false, fehler: medienFehler(error) };
        }
    }

    /**
     * Die Typbildkategorien. Eigene Frage, eigener Abbruch: Sie hängt an der Facette, nicht an Suche, Filter oder Seite — die 37
     * Kategorien sind eine feste Liste, die der Browser filtert und sortiert.
     */
    async function ladeTypbilder(): Promise<void> {
        const signal = neu("typbilder");
        typbilder.value = { ...typbilder.value, laedt: true, fehler: undefined };
        try {
            const wert = await client.typbilder(signal);
            if (!signal.aborted) typbilder.value = { wert, laedt: false, fehler: undefined };
        } catch (error) {
            if (!istAbbruch(error, signal))
                typbilder.value = { wert: undefined, laedt: false, fehler: medienFehler(error) };
        }
    }

    /** Die PhotoBox-Galerien als Liste der Spalte 2; die Suche filtert über den Ortsnamen auf dem Server. */
    async function ladePhotoboxListe(): Promise<void> {
        const signal = neu("photobox");
        photoboxListe.value = { ...photoboxListe.value, laedt: true, fehler: undefined };
        try {
            const wert = await client.photoboxGalerien(zustand.value.q, signal);
            if (!signal.aborted) photoboxListe.value = { wert, laedt: false, fehler: undefined };
        } catch (error) {
            if (!istAbbruch(error, signal))
                photoboxListe.value = { wert: undefined, laedt: false, fehler: medienFehler(error) };
        }
    }

    /** Die Reisebilder der gewählten PhotoBox-Galerie; ohne Wahl leer. */
    async function ladePhotoboxGalerie(kennung: string | undefined): Promise<void> {
        const signal = neu("photobox-galerie");
        if (kennung === undefined) {
            photoboxGalerie.value = leer();
            return;
        }
        photoboxGalerie.value = { wert: undefined, laedt: true, fehler: undefined };
        try {
            const wert = await client.photoboxGalerie(kennung, signal);
            if (!signal.aborted) photoboxGalerie.value = { wert, laedt: false, fehler: undefined };
        } catch (error) {
            if (!istAbbruch(error, signal))
                photoboxGalerie.value = { wert: undefined, laedt: false, fehler: medienFehler(error) };
        }
    }

    /** Die Galerien als LISTE der Spalte 2; die Suche filtert über Titel und Ortsnamen auf dem Server. */
    async function ladeGalerieListe(): Promise<void> {
        const signal = neu("galerien");
        galerienListe.value = { ...galerienListe.value, laedt: true, fehler: undefined };
        try {
            const wert = await client.galerien(zustand.value.q, signal);
            if (!signal.aborted) galerienListe.value = { wert, laedt: false, fehler: undefined };
        } catch (error) {
            if (!istAbbruch(error, signal))
                galerienListe.value = { wert: undefined, laedt: false, fehler: medienFehler(error) };
        }
    }

    /** Die gewählte Galerie als Ganzes; ohne Wahl leer. */
    async function ladeGalerie(id: string | undefined): Promise<void> {
        const signal = neu("galerie-detail");
        if (id === undefined) {
            galerie.value = leer();
            return;
        }
        galerie.value = { ...galerie.value, laedt: true, fehler: undefined };
        try {
            const wert = await client.galerie(id, signal);
            if (!signal.aborted) galerie.value = { wert, laedt: false, fehler: undefined };
        } catch (error) {
            if (!istAbbruch(error, signal))
                galerie.value = { wert: undefined, laedt: false, fehler: medienFehler(error) };
        }
    }

    /** Die erste Seite (`von vorn`) oder die nächste. */
    /** Die Kartensammlung als LISTE der Spalte 2; die Suche filtert auf dem Server. */
    async function ladeKartenListe(): Promise<void> {
        const signal = neu("karten");
        kartenListe.value = { ...kartenListe.value, laedt: true, fehler: undefined };
        try {
            const wert = await client.karten(zustand.value.q, signal, kartenStillgelegte.value);
            if (!signal.aborted) kartenListe.value = { wert, laedt: false, fehler: undefined };
        } catch (error) {
            if (!istAbbruch(error, signal)) {
                kartenListe.value = { wert: undefined, laedt: false, fehler: medienFehler(error) };
            }
        }
    }
    /** Die gewählte Karte; ohne Wahl leer. */
    async function ladeKarte(id: string | undefined): Promise<void> {
        const signal = neu("karte-detail");
        if (id === undefined) {
            karte.value = leer();
            return;
        }
        karte.value = { ...karte.value, laedt: true, fehler: undefined };
        try {
            const wert = await client.karte(id, signal);
            if (!signal.aborted) karte.value = { wert, laedt: false, fehler: undefined };
        } catch (error) {
            if (!istAbbruch(error, signal))
                karte.value = { wert: undefined, laedt: false, fehler: medienFehler(error) };
        }
    }

    async function ladeListe(vonVorn: boolean): Promise<void> {
        const signal = neu("liste");
        const vorher = vonVorn ? [] : liste.value.items;
        liste.value = { items: vorher, total: vonVorn ? 0 : liste.value.total, laedt: true, fehler: undefined };
        try {
            const seite = await client.suche(suchanfrage(zustand.value, vorher.length, MEDIEN_SEITE), signal);
            if (signal.aborted) return;
            liste.value = { items: [...vorher, ...seite.items], total: seite.total, laedt: false, fehler: undefined };
        } catch (error) {
            if (!istAbbruch(error, signal))
                liste.value = { items: vorher, total: 0, laedt: false, fehler: medienFehler(error) };
        }
    }

    /**
     * Lädt das Asset. `behalten` (neu laden DESSELBEN Assets, etwa nach dem Speichern eines Kastens oder nach einem Konflikt): Der alte Stand
     * bleibt stehen, bis der neue da ist. Sonst fiele der Inspector kurz leer, und ein offener Kasten verlöre die Eingaben.
     */
    async function ladeAsset(id: string | undefined, { behalten = false }: { behalten?: boolean } = {}): Promise<void> {
        const signal = neu("asset");
        if (id === undefined) {
            galerien.value = [];
            detail.value = leer();
            verwendung.value = leer();
            return;
        }
        const bleibt = behalten && detail.value.wert?.asset.id === id;
        if (!bleibt) galerien.value = [];
        detail.value = { wert: bleibt ? detail.value.wert : undefined, laedt: true, fehler: undefined };
        verwendung.value = { wert: bleibt ? verwendung.value.wert : undefined, laedt: true, fehler: undefined };
        const [d, v] = await Promise.allSettled([client.asset(id, signal), client.verwendung(id, signal)]);
        if (signal.aborted) return;
        detail.value =
            d.status === "fulfilled"
                ? { wert: d.value, laedt: false, fehler: undefined }
                : { wert: undefined, laedt: false, fehler: medienFehler(d.reason) };
        verwendung.value =
            v.status === "fulfilled"
                ? { wert: v.value, laedt: false, fehler: undefined }
                : { wert: undefined, laedt: false, fehler: medienFehler(v.reason) };
        if (v.status === "fulfilled") await ladeGalerien(v.value, signal);
    }

    /** Die Galerien, in denen das Asset steht: der Inspector zeigt sie mit ihrer Folge und ihrem Cover (WI-0068 §9). */
    async function ladeGalerien(usage: MediaUsageResult, signal: AbortSignal): Promise<void> {
        const ids = [...new Set(usage.usages.flatMap((entry) => (entry.gallery === null ? [] : [entry.gallery.id])))];
        if (ids.length === 0) return;
        const antworten = await Promise.allSettled(ids.slice(0, GALERIEN_MAX).map((id) => client.galerie(id, signal)));
        if (signal.aborted) return;
        galerien.value = antworten.flatMap((antwort) => (antwort.status === "fulfilled" ? [antwort.value] : []));
    }

    let tippen: ReturnType<typeof setTimeout> | undefined;
    const schluessel = computed(() => listenSchluessel(zustand.value));
    let letzteSuche = zustand.value.q;

    watch(
        offen,
        (jetzt) => {
            if (!jetzt) {
                for (const controller of abbrueche.values()) controller.abort();
                return;
            }
            void ladeNavigation();
            if (istObjekt(zustand.value.auswahl)) void ladeObjekt();
            else void ladeListe(true);
            void ladeAsset(zustand.value.asset);
        },
        { immediate: true },
    );
    /** Welches Medienobjekt die Trefferspalte gerade zeigt; `undefined`, wenn dort eine Assetliste steht. */
    function ladeObjekt(): void {
        const auswahl = zustand.value.auswahl;
        if (!istObjekt(auswahl)) return;
        if (auswahl.objekt === "typbilder") void ladeTypbilder();
        else if (auswahl.objekt === "kartensammlung") void ladeKartenListe();
        else if (auswahl.objekt === "photobox") void ladePhotoboxListe();
        // Die Kartenvorschläge (OPS-000093) lädt ihre Liste selbst (`KartenvorschlaegeListe`); hier ist nichts zu holen.
        else if (auswahl.objekt === "kartenvorschlaege") return;
        else void ladeGalerieListe();
    }

    // Die Facette entscheidet, WAS die Trefferspalte lädt: ein Medienobjekt fragt die Assetsuche nie (und umgekehrt).
    watch(
        () => (istObjekt(zustand.value.auswahl) ? zustand.value.auswahl.objekt : undefined),
        (objekt) => {
            if (!offen.value) return;
            if (objekt === undefined) void ladeListe(true);
            else ladeObjekt();
        },
    );
    // Die Suche wirkt auch auf die Galerien; sie filtert dort auf dem Server.
    watch(
        () => zustand.value.q,
        () => {
            if (!offen.value) return;
            const auswahl = zustand.value.auswahl;
            if (istObjekt(auswahl) && auswahl.objekt === "galerien") void ladeGalerieListe();
            if (istObjekt(auswahl) && auswahl.objekt === "kartensammlung") void ladeKartenListe();
            if (istObjekt(auswahl) && auswahl.objekt === "photobox") void ladePhotoboxListe();
        },
    );
    watch(kartenStillgelegte, () => {
        const auswahl = zustand.value.auswahl;
        if (offen.value && istObjekt(auswahl) && auswahl.objekt === "kartensammlung") void ladeKartenListe();
    });
    watch(
        () => zustand.value.galerie,
        (id) => {
            if (offen.value) void ladeGalerie(id);
        },
        { immediate: true },
    );
    watch(
        () => zustand.value.karte,
        (id) => {
            if (offen.value) void ladeKarte(id);
        },
        { immediate: true },
    );
    watch(
        () => zustand.value.photoboxGalerie,
        (kennung) => {
            if (offen.value) void ladePhotoboxGalerie(kennung);
        },
        { immediate: true },
    );
    watch(schluessel, () => {
        if (!offen.value || istObjekt(zustand.value.auswahl)) return;
        clearTimeout(tippen);
        const nurGetippt = zustand.value.q !== letzteSuche;
        letzteSuche = zustand.value.q;
        if (nurGetippt) tippen = setTimeout(() => void ladeListe(true), TIPP_PAUSE_MS);
        else void ladeListe(true);
    });
    watch(
        () => zustand.value.asset,
        (id) => {
            if (offen.value) void ladeAsset(id);
        },
    );

    onBeforeUnmount(() => {
        clearTimeout(tippen);
        for (const controller of abbrueche.values()) controller.abort();
    });

    return {
        navigation,
        liste,
        detail,
        verwendung,
        galerien,
        typbilder,
        galerienListe,
        galerie,
        kartenListe,
        karte,
        kartenStillgelegte,
        photoboxListe,
        photoboxGalerie,
        mehrLaden: () => void ladeListe(false),
        erneutListe: () => void ladeListe(true),
        erneutNavigation: () => void ladeNavigation(),
        erneutAsset: () => void ladeAsset(zustand.value.asset, { behalten: true }),
        erneutTypbilder: () => void ladeTypbilder(),
        erneutGalerien: () => {
            void ladeGalerieListe();
            void ladeGalerie(zustand.value.galerie);
        },
        erneutPhotobox: () => {
            void ladePhotoboxListe();
            void ladePhotoboxGalerie(zustand.value.photoboxGalerie);
        },
        erneutKarten: () => {
            void ladeKartenListe();
            void ladeKarte(zustand.value.karte);
        },
    };
}
