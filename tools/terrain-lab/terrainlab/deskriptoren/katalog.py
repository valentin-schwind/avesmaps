"""Katalog aller Metrikfamilien als Markdown-Tabellen (Quelle der Tabellen in ``docs/deskriptoren.md``).

``python -m terrainlab deskriptoren --katalog`` gibt den Katalog aus. Er entsteht aus einem echten Lauf auf einer synthetischen Fläche,
damit er nie von den tatsächlich erzeugten Metriken abweicht.
"""

from __future__ import annotations

from .kern import GRUPPEN, GRUPPEN_TITEL, Metrikvektor, familie


def _zelle(text: str) -> str:
    return text.replace("|", "\\|").replace("\n", " ")


def katalog_markdown(vektor: Metrikvektor) -> str:
    teile: list[str] = []
    for gruppe in GRUPPEN:
        familien: dict[str, tuple[str, str, str, str]] = {}
        for m in vektor.je_gruppe(gruppe):
            familien.setdefault(m.familie, (m.einheit, m.art, m.kosten, m.beschreibung))
        if not familien:
            continue
        teile.append(f"### {GRUPPEN_TITEL[gruppe]}\n")
        teile.append("| Metrik | Einheit | Art | Kosten | Definition |")
        teile.append("|---|---|---|---|---|")
        for name, (einheit, art, kosten, text) in familien.items():
            teile.append(f"| `{name}` | {_zelle(einheit)} | {art} | {kosten} | {_zelle(text)} |")
        teile.append("")
        verteilungen = {familie(n): v for n, v in vektor.verteilungen.items() if v.gruppe == gruppe}
        reihen = {n: r for n, r in vektor.reihen.items() if r.gruppe == gruppe}
        if verteilungen or reihen:
            teile.append("Verteilungen (Quantilfunktion, Grundlage des Wasserstein-Abstands) und Reihen dieser Gruppe:\n")
            teile.append("| Name | Einheit | Inhalt |")
            teile.append("|---|---|---|")
            for name, v in verteilungen.items():
                teile.append(f"| `{name}` | {_zelle(v.einheit)} | Verteilung: {_zelle(v.beschreibung)} |")
            for name, r in reihen.items():
                teile.append(f"| `{name}` | {_zelle(r.x_einheit)} → {_zelle(r.y_einheit)} | Reihe: {_zelle(r.beschreibung)} |")
            teile.append("")
    return "\n".join(teile)
