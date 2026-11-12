"""Fließnetze auf Höhenrastern: D8-Richtungen, Senkenauflösung, Einzugsfläche und Strahler-Ordnung, vollständig vektorisiert.

Zwei Verwendungen derselben Maschinerie:

- Gerinne (Hydrologie): ``fliessnetz(z, maske, konditioniert=True)``. Geschlossene Senken laufen über ihren tiefsten Rand in das
  Nachbarbecken über (virtueller „Sprung“ vom Senkenboden über den Sattel), sodass jede Zelle den Rand erreicht und die
  Einzugsflächen vollständig bilanzieren: die Summe der Flächen an den Auslässen ist die Zahl der gültigen Zellen.
- Kämme (Gipfel): dasselbe auf dem invertierten Gelände (``fliessnetz(-z, ...)``). Gipfel sind dann Senken und laufen über ihren
  höchsten Schlüsselsattel in das Nachbarbecken über; Zellen mit großer „Aufwärtsfläche“ liegen auf Kämmen, und das Netz bildet den
  Gratbaum. Ohne diese Auflösung bliebe jedes Rauschmaximum ein Endpunkt, und das Kammnetz zerfiele in Einzelzellen.

Die Senkenauflösung ersetzt die übliche Prioritätswarteschlange (Priority-Flood) über alle Zellen durch den Beckengraphen: aus den
Passhöhen zwischen den Becken berechnet ein minimaler Spannbaum die Füllhöhe jedes Beckens (minimaler Engpass bis zum Rand), siehe
``regionen.py``. Die Füllhöhe einer Zelle ist max(Zellhöhe, Füllhöhe ihres Beckens).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy import ndimage
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import breadth_first_order, minimum_spanning_tree

from .regionen import _ABSTAND, _ACHTER, passkanten, steilste_richtung, zerlege, ziel_aus_richtung


@dataclass
class Fliessnetz:
    ziel: np.ndarray  # (N,) flacher Index der nächsten Zelle, -1 = Auslass bzw. Ende
    sprung: np.ndarray  # (N,) bool: Zelle liegt auf einem Senkenboden und springt über den Sattel (keine Nachbarschaftskante)
    schritt: np.ndarray  # (N,) float32 Länge des Schritts zum Ziel in Zellkanten (0 bei Sprung/Auslass)
    akkumulation: np.ndarray  # (N,) float64 Einzugsfläche in Zellen (inkl. der Zelle selbst), 0 bei ungültigen Zellen
    ebenen: list[np.ndarray]  # topologische Schichten: Quellen zuerst, jede Zelle liegt nach all ihren Zuflüssen
    gueltig: np.ndarray  # (N,) bool
    senkentiefe: np.ndarray | None  # (h, b) Tiefe unter der Füllhöhe, nur konditioniert
    form: tuple[int, int]


def akkumuliere(ziel: np.ndarray, gueltig: np.ndarray) -> tuple[np.ndarray, list[np.ndarray]]:
    """Einzugsfläche in Zellen durch schichtweises Abarbeiten (Kahn-Verfahren). Liefert auch die Schichten für weitere Durchläufe."""
    n = ziel.size
    mit_ziel = ziel >= 0
    eingang = np.bincount(ziel[mit_ziel], minlength=n).astype(np.int32)
    akk = gueltig.astype(np.float64)
    front = np.flatnonzero(gueltig & (eingang == 0))
    ebenen: list[np.ndarray] = []
    erledigt = 0
    while front.size:
        ebenen.append(front)
        erledigt += front.size
        t = ziel[front]
        m = t >= 0
        if not m.any():
            break
        fm, tm = front[m], t[m]
        u, inv, c = np.unique(tm, return_inverse=True, return_counts=True)
        akk[u] += np.bincount(inv, weights=akk[fm], minlength=u.size)
        eingang[u] -= c.astype(np.int32)
        front = u[eingang[u] == 0]
    if erledigt != int(gueltig.sum()):
        raise RuntimeError("Fließnetz enthält einen Zyklus oder verwaiste Zellen")
    return akk, ebenen


def fliessnetz(z: np.ndarray, maske: np.ndarray, *, konditioniert: bool = True) -> Fliessnetz:
    """D8-Fließnetz abwärts. ``konditioniert=False`` lässt geschlossene Senken als Endpunkte stehen."""
    h, b = z.shape
    n = h * b
    zv = np.where(maske, z, np.nan)
    richtung = steilste_richtung(zv, maske, False)
    ziel = ziel_aus_richtung(richtung)
    schritt = np.zeros(n, dtype=np.float32)
    rr = richtung.ravel()
    ok = rr >= 0
    schritt[ok] = _ABSTAND[rr[ok]]
    sprung = np.zeros(n, dtype=bool)
    tiefe = None
    gueltig = maske.ravel().copy()

    if konditioniert:
        tiefe = _loese_senken(zv, maske, richtung, ziel, sprung)
    akk, ebenen = akkumuliere(ziel, gueltig)
    return Fliessnetz(ziel, sprung, schritt, akk, ebenen, gueltig, tiefe, (h, b))


def _loese_senken(z: np.ndarray, maske: np.ndarray, richtung: np.ndarray, ziel: np.ndarray, sprung: np.ndarray) -> np.ndarray:
    """Setzt für Zellen in Beckenkernen (ohne tieferen Nachbarn) das Sprungziel und liefert die Senkentiefe je Zelle."""
    h, b = z.shape
    zf = z.ravel()
    becken = zerlege(z, maske, aufwaerts=False)
    n_reg = becken.anzahl
    if n_reg == 0:
        return np.zeros((h, b))
    region = becken.region
    reg_flach = region.ravel()
    # Randzellen: am Rasterrand oder neben ungültigen Zellen -> Auslass
    innen = ndimage.binary_erosion(maske, structure=_ACHTER, border_value=0)
    rand = np.flatnonzero((maske & ~innen).ravel())
    kanten = passkanten(z, region, n_reg, hoechste=False)

    # Kanten Region -> Auslass (Knoten n_reg): niedrigste Randzelle je Region
    rr = reg_flach[rand]
    ordnung = np.lexsort((zf[rand], rr))
    rr, rz = rr[ordnung], rand[ordnung]
    erste = np.ones(rr.size, dtype=bool)
    erste[1:] = rr[1:] != rr[:-1]
    rand_region, rand_zelle = rr[erste], rz[erste]
    rand_hoehe = zf[rand_zelle]

    knoten = n_reg + 1
    u = np.concatenate([kanten.u, rand_region.astype(np.int64)])
    v = np.concatenate([kanten.v, np.full(rand_region.size, n_reg, dtype=np.int64)])
    w = np.concatenate([kanten.hoehe, rand_hoehe])
    zu = np.concatenate([kanten.zelle_u, rand_zelle])
    zv_ = np.concatenate([kanten.zelle_v, np.full(rand_region.size, -1, dtype=np.intp)])
    schluessel = u * knoten + v
    sortiert = np.argsort(schluessel, kind="stable")
    schluessel, u, v, w, zu, zv_ = schluessel[sortiert], u[sortiert], v[sortiert], w[sortiert], zu[sortiert], zv_[sortiert]

    verschoben = w - w.min() + 1.0  # csgraph behandelt 0 als „keine Kante“
    graph = coo_matrix((verschoben, (u, v)), shape=(knoten, knoten)).tocsr()
    baum = minimum_spanning_tree(graph).tocoo()
    reihenfolge, vorgaenger = breadth_first_order(baum, n_reg, directed=False, return_predecessors=True)

    ka, kb = baum.row.astype(np.int64), baum.col.astype(np.int64)
    kind = np.where(vorgaenger[ka] == kb, ka, kb)
    elter = np.where(vorgaenger[ka] == kb, kb, ka)
    kante_idx = np.searchsorted(schluessel, np.minimum(ka, kb) * knoten + np.maximum(ka, kb))

    kante_w = np.zeros(knoten)
    kante_w[kind] = w[kante_idx]
    elter_von = np.full(knoten, -1, dtype=np.int64)
    elter_von[kind] = elter
    # Zelle im Kind bzw. im Elternbecken an der Passkante
    zelle_kind = np.full(knoten, -1, dtype=np.intp)
    zelle_eltern = np.full(knoten, -1, dtype=np.intp)
    kind_ist_u = u[kante_idx] == kind
    zelle_kind[kind] = np.where(kind_ist_u, zu[kante_idx], zv_[kante_idx])
    zelle_eltern[kind] = np.where(kind_ist_u, zv_[kante_idx], zu[kante_idx])

    # Füllhöhe: Engpass entlang des Baumes von innen nach außen (Breitensuche vom Auslass)
    fuell = np.full(knoten, -np.inf)
    ew = kante_w.tolist()
    el = elter_von.tolist()
    fl = fuell.tolist()
    for k in reihenfolge[1:].tolist():
        fl[k] = max(ew[k], fl[el[k]])
    fuell = np.array(fl)

    # Sprungziele: alle Zellen eines Beckenkerns springen in das Elternbecken (oder zum Auslass = -1)
    kern_zellen = np.flatnonzero((becken.marke > 0).ravel())
    kern_region = reg_flach[kern_zellen]
    ziel_zelle = zelle_eltern[kern_region]  # -1 bei Auslass (Elternknoten ist der Auslass, dort steht -1)
    ziel[kern_zellen] = ziel_zelle
    sprung[kern_zellen] = ziel_zelle >= 0

    tiefe = np.zeros(h * b)
    g = reg_flach >= 0
    tiefe[g] = np.maximum(fuell[reg_flach[g]] - zf[g], 0.0)
    return tiefe.reshape(h, b)


def strahler(ziel: np.ndarray, ebenen: list[np.ndarray], netz: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Strahler-Ordnung der Netzzellen. Gibt ``(ordnung, hoechste_zufluss_ordnung, zufluesse_hoechster_ordnung)`` zurück.
    Das Netz muss flussabwärts abgeschlossen sein (Schwelle auf der Einzugsfläche erfüllt das)."""
    n = ziel.size
    ordnung = np.zeros(n, dtype=np.int16)
    hoechste = np.zeros(n, dtype=np.int16)
    anzahl = np.zeros(n, dtype=np.int16)
    for ebene in ebenen:
        zellen = ebene[netz[ebene]]
        if zellen.size == 0:
            continue
        o = np.where(hoechste[zellen] == 0, 1, hoechste[zellen] + (anzahl[zellen] >= 2)).astype(np.int16)
        ordnung[zellen] = o
        t = ziel[zellen]
        behalten = (t >= 0)
        behalten[behalten] = netz[t[behalten]]
        if not behalten.any():
            continue
        t2, o2 = t[behalten], o[behalten]
        alt = hoechste[t2]
        np.maximum.at(hoechste, t2, o2)
        neu = hoechste[t2]
        anzahl[t2[neu > alt]] = 0
        np.add.at(anzahl, t2[o2 == neu], 1)
    return ordnung, hoechste, anzahl
