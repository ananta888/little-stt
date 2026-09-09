# Mitwirken

Das Projekt bleibt eine kleine lokale Anwendung mit Angular und Python.
Einrichtung und Start sind in der [README](README.md) beschrieben.

Der [Lernplan](docs/LERNPLAN.md) enthält die vorgesehenen Arbeitspakete für
Datensammlung, Vosk-Anpassung und Modellvergleich. Noch nicht umgesetzte
Trainingsfunktionen sollen in Oberfläche und Dokumentation als geplant erkennbar
bleiben.

Für Änderungen einen Branch anlegen, die Änderung kurz beschreiben und einen
Pull Request öffnen. Bei Fehlerberichten helfen Betriebssystem, Browser,
Audioformat und reproduzierbare Schritte. Persönliche Aufnahmen, Transkripte,
Zugangsdaten und heruntergeladene Modelle gehören nicht in Issues oder Commits.

Vor einem Pull Request aus dem Projektverzeichnis prüfen:

```bash
uv sync --locked
uv run pytest
cd frontend
npm ci
npm run build
```

Die CI prüft Backend-Tests und Angular-Build ohne Modelldownload. Änderungen an
Erkennung, Audioverarbeitung oder Modellauslieferung zusätzlich mit einer lokalen
Aufnahme und den echten Modellen prüfen; verwendetes Format und Ergebnis im
Pull Request angeben.

Beiträge zum Projekt stehen unter derselben [BSD-3-Clause-Lizenz](LICENSE).
Bestehende Lizenzhinweise von Abhängigkeiten und Modellen bleiben erhalten.
