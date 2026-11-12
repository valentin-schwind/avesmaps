"""Bilder und Diagramme des Berichts (WI-0250 Phase A5). Alles wird aus den echten Höhen und Messwerten gezeichnet; es gibt keine erzeugten Bilder.

Die **Schummerung** ist eine Geländeschattierung (Hillshade, Lichtquelle Nordwest 45°) aus den Höhen des Rasters, mit festem Maßstab in Metern je Bildpunkt, fester
Überhöhung und fester Beleuchtung für alle Bilder eines Berichts. Dadurch haben Referenz, Vorgabe und Vorschlag **denselben Maßstab und dieselbe Beleuchtung** und lassen
sich nebeneinander lesen. NoData ist weiß. Diagramme zeichnet Matplotlib (Agg), alle als PNG, im Bericht als Daten-URI eingebettet.
"""

from __future__ import annotations

import base64
import io
import math
from typing import Any, Mapping, Sequence

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.colors import LightSource  # noqa: E402
from matplotlib.ticker import NullFormatter  # noqa: E402

from terrainlab.bewertung import front  # noqa: E402
from terrainlab.deskriptoren import Metrikvektor  # noqa: E402
from terrainlab.raster import Hoehenraster  # noqa: E402

FARBEN = {"referenz": "#262626", "vorgabe": "#2f6db5", "vorschlag": "#d9731a", "validierung": "#7a4fa3", "tor": "#9a9a9a", "gut": "#2f6db5", "zeit": "#2e8b57"}
SCHRIFT = {"font.size": 9, "axes.titlesize": 10, "axes.labelsize": 9, "legend.fontsize": 8, "figure.dpi": 100}


def data_uri(png: bytes) -> str:
    return "data:image/png;base64," + base64.b64encode(png).decode("ascii")


def _png(fig: Any) -> bytes:
    puffer = io.BytesIO()
    fig.savefig(puffer, format="png", dpi=110, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    return puffer.getvalue()


# --- Schummerung --------------------------------------------------------------------------------------------------------


def schummerung(raster: Hoehenraster, m_je_px: float = 200.0, ueberhoehung: float = 2.0, massstab_km: float | None = 10.0) -> tuple[bytes, tuple[int, int]]:
    """Hillshade aus den Höhen (Meter), auf ``m_je_px`` Meter je Bildpunkt gebracht; gibt (PNG, (Breite, Höhe)) zurück."""
    h = raster.hoehen.astype(np.float64)
    gueltig = np.isfinite(h)
    if not gueltig.any():
        raise ValueError("Raster ohne gültige Zellen")
    fuell = np.where(gueltig, h, np.nanmin(h))
    ls = LightSource(azdeg=315, altdeg=45)
    sh = ls.hillshade(fuell, vert_exag=ueberhoehung, dx=raster.zellgroesse_m, dy=raster.zellgroesse_m)
    faktor = raster.zellgroesse_m / m_je_px
    if abs(faktor - 1.0) > 1e-9:
        sh = ndimage.zoom(sh, faktor, order=1)
        gueltig = ndimage.zoom(gueltig.astype(np.float32), faktor, order=1) > 0.5
    # Fester Kontrast für alle Bilder: ebenes Gelände wird mittelgrau (Hillshade ≈ 0,707 bei Licht 45°), Hänge zum Licht heller, abgewandt dunkler.
    bild = np.where(gueltig, 255.0 * np.clip(0.62 + 1.7 * (sh - 0.7071), 0.0, 1.0), 255.0).astype(np.uint8)
    img = Image.fromarray(bild, mode="L").convert("RGB")
    if massstab_km:
        zeichner = ImageDraw.Draw(img)
        laenge = massstab_km * 1000.0 / m_je_px
        x0, y0 = 8, img.height - 12
        if laenge + 40 < img.width:
            zeichner.line([(x0, y0), (x0 + laenge, y0)], fill=(200, 30, 30), width=3)
            zeichner.text((x0, y0 - 12), f"{massstab_km:g} km", fill=(200, 30, 30))
    puffer = io.BytesIO()
    img.save(puffer, format="PNG", optimize=True)
    return puffer.getvalue(), (img.width, img.height)


# --- Diagramme ----------------------------------------------------------------------------------------------------------


def sensitivitaet_diagramm(parameter: Mapping[str, dict[str, Any]], titel: str = "") -> bytes:
    """Morris: mittlerer Betrag der elementaren Effekte je Parameter, links Abstand zur Referenz, rechts Formverlust; Streuung als Fehlerbalken."""
    with plt.rc_context(SCHRIFT):
        namen = sorted(parameter, key=lambda n: -parameter[n].get("wirkung", 0.0))
        fig, achsen = plt.subplots(1, 2, figsize=(9.5, max(3.0, 0.27 * len(namen) + 1.2)), sharey=True)
        y = np.arange(len(namen))
        for ax, schluessel, text in ((achsen[0], "d1", "Abstand zur Referenz (Plausibilität)"), (achsen[1], "form", "Formverlust (1 − Leitwert)")):
            mu = [parameter[n][schluessel]["mu_stern"] or 0.0 for n in namen]
            sg = [parameter[n][schluessel]["sigma"] or 0.0 for n in namen]
            farben = [FARBEN["vorschlag"] if parameter[n].get("im_suchraum") else FARBEN["tor"] for n in namen]
            ax.barh(y, mu, xerr=sg, color=farben, error_kw={"ecolor": "#555", "lw": 0.8, "capsize": 2})
            ax.set_title(text)
            ax.set_xlabel("μ* (Betrag des elementaren Effekts)  ±σ")
            ax.grid(axis="x", alpha=0.3)
        achsen[0].set_yticks(y)
        achsen[0].set_yticklabels(namen)
        achsen[0].invert_yaxis()
        if titel:
            fig.suptitle(titel, y=1.0)
        fig.tight_layout()
        return _png(fig)


def pareto_diagramm(kandidaten: Sequence[dict[str, Any]], vorgabe: dict[str, Any] | None, vorschlag_schluessel: dict[str, Any] | None, titel: str = "", vorschlag_text: str = "Vorschlag") -> bytes:
    """Alle Kandidaten bei 1×: Abstand zur Referenz gegen Formverlust; gefüllt halten das Formtor, grau nicht. Die Front der zulässigen ist verbunden."""
    with plt.rc_context(SCHRIFT):
        fig, ax = plt.subplots(figsize=(7.2, 4.6))
        gueltig = [k for k in kandidaten if k["d1"] is not None and k["form_verlust"] is not None]
        ok = [k for k in gueltig if k["tor_ok"]]
        nicht = [k for k in gueltig if not k["tor_ok"]]
        ax.scatter([k["d1"] for k in nicht], [k["form_verlust"] for k in nicht], s=18, c=FARBEN["tor"], alpha=0.65, label=f"verfehlt das Formtor ({len(nicht)})")
        sc = ax.scatter([k["d1"] for k in ok], [k["form_verlust"] for k in ok], s=[22 + 14 * k["n_saaten"] for k in ok], c=[k["zeit_s"] or 0.0 for k in ok], cmap="viridis", alpha=0.9,
                        edgecolors="#222", linewidths=0.4, label=f"hält das Formtor ({len(ok)}; Größe = Zahl der Saaten)")
        if ok:
            f = sorted(front([(k["d1"], k["form_verlust"]) for k in ok], (0.002, 0.01)), key=lambda i: ok[i]["d1"])
            ax.plot([ok[i]["d1"] for i in f], [ok[i]["form_verlust"] for i in f], "-", color="#222", lw=1, alpha=0.7, label="Front (Abstand, Formverlust)")
            cb = fig.colorbar(sc, ax=ax, pad=0.01)
            cb.set_label("Rechenzeit bei 1× (s)")
        if vorgabe and vorgabe.get("d1") is not None:
            ax.scatter([vorgabe["d1"]], [vorgabe["form_verlust"]], marker="*", s=170, c=FARBEN["vorgabe"], edgecolors="#000", zorder=5, label="Vorgabe des Typs")
        if vorschlag_schluessel and vorschlag_schluessel.get("d1") is not None:
            ax.scatter([vorschlag_schluessel["d1"]], [vorschlag_schluessel["form_verlust"]], marker="D", s=70, c=FARBEN["vorschlag"], edgecolors="#000", zorder=6, label=vorschlag_text)
        ax.set_xlabel("Abstand zur Optimierungsreferenz (Leitwert, 0 = gleich)")
        ax.set_ylabel("Formverlust (1 − Leitwert des Formerhalts)")
        ax.grid(alpha=0.3)
        ax.legend(loc="best", frameon=True)
        if titel:
            ax.set_title(titel)
        fig.tight_layout()
        return _png(fig)


def verteilungen_diagramm(vektoren: Sequence[tuple[str, str, Metrikvektor]], namen: Sequence[str], spalten: int = 3) -> bytes:
    """Quantilfunktionen ausgewählter Verteilungen; ``vektoren`` = (Beschriftung, Farbschlüssel, Metrikvektor), der erste ist die Referenz."""
    vorhanden = [n for n in namen if all(n in v.verteilungen for _, _, v in vektoren)]
    if not vorhanden:
        raise ValueError("keine gemeinsame Verteilung")
    with plt.rc_context(SCHRIFT):
        zeilen = math.ceil(len(vorhanden) / spalten)
        fig, achsen = plt.subplots(zeilen, spalten, figsize=(3.3 * spalten, 2.6 * zeilen), squeeze=False)
        for ax, n in zip(achsen.ravel(), vorhanden):
            for text, farbe, v in vektoren:
                q = v.verteilungen[n].quantile
                ax.plot((np.arange(len(q)) + 0.5) / len(q), q, color=FARBEN.get(farbe, "#444"), lw=1.6 if farbe != "referenz" else 2.2, label=text)
            d = vektoren[0][2].verteilungen[n]
            ax.set_title(f"{n} ({d.einheit})", fontsize=8.5)
            ax.set_xlabel("Anteil der Zellen unterhalb")
            ax.grid(alpha=0.3)
        for ax in achsen.ravel()[len(vorhanden):]:
            ax.axis("off")
        achsen.ravel()[0].legend(loc="best", fontsize=7)
        fig.tight_layout()
        return _png(fig)


def reihen_diagramm(vektoren: Sequence[tuple[str, str, Metrikvektor]], namen: Sequence[str]) -> bytes:
    """Querprofile von Kamm und Tal (mittlerer Höhenabfall über dem Abstand) der Referenz und der erzeugten Raster."""
    vorhanden = [n for n in namen if all(n in v.reihen for _, _, v in vektoren)]
    if not vorhanden:
        raise ValueError("keine gemeinsame Reihe")
    with plt.rc_context(SCHRIFT):
        fig, achsen = plt.subplots(1, len(vorhanden), figsize=(4.6 * len(vorhanden), 3.2), squeeze=False)
        for ax, n in zip(achsen[0], vorhanden):
            for text, farbe, v in vektoren:
                r = v.reihen[n]
                ok = np.isfinite(r.x) & np.isfinite(r.y)
                ax.plot(r.x[ok], r.y[ok], "-o", ms=3, color=FARBEN.get(farbe, "#444"), label=text)
            r0 = vektoren[0][2].reihen[n]
            ax.set_title(n.replace("_", " "))
            ax.set_xlabel(f"Abstand ({r0.x_einheit})")
            ax.set_ylabel(f"({r0.y_einheit})")
            ax.grid(alpha=0.3)
        achsen[0][0].legend(fontsize=7)
        fig.tight_layout()
        return _png(fig)


def linienprofile(profile: Sequence[tuple[str, str, np.ndarray, np.ndarray]], titel: str, xlabel: str, punkte: Sequence[tuple[float, float, str]] = ()) -> bytes:
    """Höhenprofile (Kamm entlang, Querschnitt quer): (Beschriftung, Farbschlüssel, x, Höhe); ``punkte`` markiert gesetzte Höhen (x, Höhe, Text)."""
    with plt.rc_context(SCHRIFT):
        fig, ax = plt.subplots(figsize=(6.6, 3.2))
        for text, farbe, x, h in profile:
            ax.plot(x, h, color=FARBEN.get(farbe, "#444"), lw=1.5, label=text)
        for x, h, text in punkte:
            ax.plot([x], [h], "v", color="#c0392b", ms=5)
            ax.annotate(text, (x, h), textcoords="offset points", xytext=(2, 4), fontsize=6.5, color="#c0392b")
        ax.set_title(titel)
        ax.set_xlabel(xlabel)
        ax.set_ylabel("Höhe (m)")
        ax.grid(alpha=0.3)
        ax.legend(fontsize=7)
        fig.tight_layout()
        return _png(fig)


def performance_diagramm(zeilen: Sequence[dict[str, Any]], titel: str = "") -> bytes:
    """Kalte Rechenzeit je Gebirge und Auflösung (logarithmisch), Balken Vorgabe gegen Vorschlag; ``zeilen``: {gebirge, aufloesung, vorgabe_ms, vorschlag_ms}."""
    with plt.rc_context(SCHRIFT):
        gebirge = sorted({z["gebirge"] for z in zeilen})
        fig, achsen = plt.subplots(1, len(gebirge), figsize=(4.6 * len(gebirge), 3.2), squeeze=False)
        for ax, g in zip(achsen[0], gebirge):
            teil = sorted((z for z in zeilen if z["gebirge"] == g), key=lambda z: z["aufloesung"])
            x = np.arange(len(teil))
            ax.bar(x - 0.2, [z["vorgabe_ms"] / 1000 for z in teil], 0.38, color=FARBEN["vorgabe"], label="Vorgabe")
            if any(z.get("vorschlag_ms") for z in teil):
                ax.bar(x + 0.2, [(z.get("vorschlag_ms") or 0) / 1000 for z in teil], 0.38, color=FARBEN["vorschlag"], label="Vorschlag")
            ax.set_xticks(x)
            ax.set_xticklabels([f"{z['aufloesung']}×" for z in teil])
            ax.set_yscale("log")
            ax.yaxis.set_minor_formatter(NullFormatter())
            ax.set_ylabel("kalte Rechenzeit (s)")
            ax.set_title(g)
            ax.grid(axis="y", alpha=0.3)
        achsen[0][0].legend(fontsize=7)
        if titel:
            fig.suptitle(titel)
        fig.tight_layout()
        return _png(fig)


def balken_phasen(phasen: Mapping[str, float], titel: str) -> bytes:
    """Ein gestapelter Balken je Fall: Anteile der Phasen an der Rechenzeit (Prozent)."""
    with plt.rc_context(SCHRIFT):
        fig, ax = plt.subplots(figsize=(6.4, 1.5))
        links = 0.0
        farben = plt.cm.tab10.colors
        for i, (n, a) in enumerate(phasen.items()):
            ax.barh([0], [a], left=links, color=farben[i % 10], label=f"{n} {a:.0f} %")
            links += a
        ax.set_xlim(0, 100)
        ax.set_yticks([])
        ax.set_xlabel("Anteil an der Rechenzeit (%)")
        ax.set_title(titel, fontsize=9)
        fig.legend(*ax.get_legend_handles_labels(), ncol=3, fontsize=7, loc="lower center", frameon=False)
        fig.subplots_adjust(bottom=0.5)
        return _png(fig)
