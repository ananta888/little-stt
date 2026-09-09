# Tab-Ton, Systemton und Mikrofon

little stt kann vier Arten von Live-Quellen aufnehmen. Die Auswahl steht unter
**Live-Mikrofon → Audioquelle**, bevor eine Sitzung gestartet wird:

| Auswahl | Erfasster Ton |
| --- | --- |
| Nur Mikrofon | Gewählter Mikrofoneingang, sonst Browserstandard |
| Browser-Tab | Ton eines ausdrücklich freigegebenen Tabs, z. B. YouTube oder Zoom im Browser |
| Systemton / Bildschirm | Ton, den der Browser bei Freigabe des gesamten Bildschirms bereitstellt |
| Loopback-Audioeingang | Ein vom Betriebssystem eingerichteter Eingang für den Ton anderer Anwendungen |

Für die letzten drei Quellen ist **Zusätzlich Mikrofon aufnehmen** wählbar.
Ohne diesen Haken wird für Tab-/Bildschirmaufnahmen kein Mikrofon angefordert.
Mit Mikrofon werden beide Quellen gemeinsam transkribiert. Die vorhandenen
Vosk-/Whisper-Intervalle, Abschnittsgrenzen, Bibliothek, Freigaben und Löschregeln
bleiben erhalten. Die Quellenauswahl wird im Transkript vermerkt; Geräte-IDs werden
nicht dauerhaft gespeichert. Nach Neuladen einen Loopback-Eingang erneut wählen.

## Was plattformübergreifend möglich ist

Die Anwendung nutzt Browser-Audio-APIs und hat keinen eigenen nativen Recorder.
Eine Webseite kann nicht auf jedem Betriebssystem automatisch den gesamten
Laptop-Ton erfassen. Bildschirm-Audio hängt vom Browser, Betriebssystem und der
gewählten Freigabe ab. `audio: true` garantiert keinen Audiotrack. Die App prüft
auf tatsächlich vorhandene Audiospuren und meldet fehlenden Ton, statt auf ein
Mikrofon auszuweichen. Bildschirmfreigabe benötigt eine erneute Auswahl durch den
Nutzer beim Start. [Browser-API und Grenzen](https://developer.mozilla.org/de/docs/Web/API/MediaDevices/getDisplayMedia)

| Umgebung | Weg für Tab-Ton | Weg für andere Anwendungen / gesamten Systemton |
| --- | --- | --- |
| Windows 11 | Unterstützter Windows-Browser, z. B. Chrome, mit Tab-Audiofreigabe | Bildschirm mit Audio teilen; falls nicht angeboten, eingerichteten Loopback-Eingang wählen |
| macOS | Unterstützter Browser mit Tab-Audiofreigabe | Bildschirm-Audio nutzen, wenn angeboten; sonst z. B. BlackHole als virtuellen Eingang einrichten |
| Linux | Unterstützter Browser mit Tab-Audiofreigabe | Bildschirm-Audio nutzen, wenn angeboten; sonst PipeWire-/PulseAudio-Monitor als Eingang bereitstellen |
| Windows 11 + WSL2 | Den **Windows-Browser** verwenden | Windows-Browser nimmt Windows-Ton auf; Python/Whisper und der Webserver dürfen in WSL2 laufen |

Diese Tabelle beschreibt Aufnahmewege, keine Zusage für jede Browser-/OS-Version.
Tab-Ton kann etwa über Chromes Freigabedialog erfasst werden. Der Browser muss für
die gewählte Quelle Audio anbieten. [Chrome-Aufnahmewege](https://developer.chrome.com/docs/extensions/how-to/web-platform/screen-capture)

## Windows 11: YouTube oder Zoom aufnehmen

1. little stt in Chrome oder einem Browser mit entsprechender Tonfreigabe öffnen.
2. **Neue Aufnahme**, dann **Browser-Tab** für YouTube/Zoom-Web oder
   **Systemton / Bildschirm** für die Zoom-Desktop-App wählen.
3. Für eigene Wortbeiträge **Zusätzlich Mikrofon aufnehmen** aktivieren. Bei Bedarf
   **Audioeingänge laden** klicken und das tatsächliche Mikrofon wählen.
4. **Tonaufnahme starten** klicken. Im Browserdialog den Tab bzw. **Gesamter
   Bildschirm** wählen und **Audio teilen** aktivieren. Ohne Tonfreigabe schlägt
   der Start mit einer erklärenden Meldung fehl.
5. Erst sprechen bzw. das Video abspielen, wenn der Aufnahmezähler läuft. Nach
   dem Beenden bleibt das Transkript in der Bibliothek.

Wird kein Systemton angeboten, kann ein separat eingerichteter virtueller
Audioeingang verwendet werden. Ein Beispiel ist [VB-CABLE](https://vb-audio.com/Cable/):
Die Quellanwendung gibt an den virtuellen Wiedergabeeingang aus, little stt wählt
unter **Loopback-Audioeingang** dessen Aufnahmeausgang. Mithören muss im jeweiligen
Audiorouting zusätzlich eingerichtet werden. Der Treiber wird nicht mitgeliefert
oder automatisch installiert; es gelten seine eigenen Bedingungen.

## macOS: Systemton über einen virtuellen Eingang

Wenn der Browser keinen Bildschirmton anbietet, ist beispielsweise
[BlackHole 2ch](https://github.com/ExistentialAudio/BlackHole) ein separat
installierbarer Loopback-Treiber. little stt enthält keinen BlackHole-Code und
installiert keinen Treiber. Projekt und Treiber behalten ihre eigenen Lizenzen.

Nach der Installation:

1. In **Audio-MIDI-Setup** ein Gerät mit mehreren Ausgängen erstellen.
2. Kopfhörer/Lautsprecher und **BlackHole 2ch** aufnehmen. Einheitliche Abtastraten
   verwenden, das physische Gerät als Taktquelle und Driftkorrektur für BlackHole.
3. Dieses Mehrfachausgabegerät als Mac-Tonausgabe einstellen. Verwendet Zoom einen
   eigenen festgelegten Lautsprecher, auch dort die passende Ausgabe wählen.
4. In little stt **Loopback-Audioeingang → Audioeingänge laden → BlackHole 2ch**
   wählen. Die Browser-Audiofreigabe erlauben.
5. Falls gewünscht ein separates physisches Mikrofon zusätzlich auswählen. little
   stt mischt die beiden Browserstreams selbst.

Das Mehrfachausgabegerät ermöglicht gleichzeitig Mithören und Aufnahme. Nur die
Töne, die tatsächlich in diese Ausgabe geleitet werden, erreichen BlackHole.
[Offizielle Einrichtung des Mehrfachausgabegeräts](https://github.com/ExistentialAudio/BlackHole/wiki/Getting-Started:-Creating-a-Multi-Output-Device)

## Linux: Monitor eines Ausgangs als Eingang

Bei PipeWire mit `pipewire-pulse` bzw. einem passenden PulseAudio-Setup kann der
Monitor des verwendeten Lautsprecherausgangs als normale Aufnahmequelle angeboten
werden. Verfügbare Quellen im **Linux-Desktop**, auf dem der Browser läuft, anzeigen:

```bash
pactl list short sources
```

Den genauen Namen des gewünschten Ausgangsmonitors wählen, beispielsweise eine
Quelle mit `.monitor` am Ende. Der folgende Befehl ist ein Muster: Den Platzhalter
`NAME_DES_AUSGANGS.monitor` durch den tatsächlichen Namen ersetzen.

```bash
pactl load-module module-remap-source master=NAME_DES_AUSGANGS.monitor source_name=little_stt_system source_properties=device.description=Little_STT_System
```

`pactl` gibt eine Modulnummer aus. In little stt **Loopback-Audioeingang →
Audioeingänge laden → Little_STT_System** auswählen. Bei Bedarf den Browser neu
öffnen, wenn er die neue Quelle noch nicht anbietet. Das physische Mikrofon lässt
sich zusätzlich auswählen. Bei Wechsel des Lautsprecherausgangs prüfen, ob noch
der richtige Monitor erfasst wird. Entfernen der eingerichteten Quelle:

```bash
pactl unload-module MODULNUMMER
```

Die Modulnummer durch die bei `load-module` ausgegebene Zahl ersetzen. Diese
Konfiguration ist nicht automatisch dauerhaft und wird von little stt nicht am
System vorgenommen. [PipeWire: Remap Source](https://docs.pipewire.org/page_pulse_module_remap_source.html)

## WSL2: Aufnahme auf Windows, Verarbeitung in Linux

Für Windows-Ton den Browser auf **Windows** starten. Node/Angular-Build und
Python/Whisper können in WSL2 laufen. Im WSL-Projektverzeichnis:

```bash
uv sync
python3 scripts/download_vosk.py
cd frontend
npm ci
npm run build
cd ..
uv run uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Danach im Windows-Browser **http://localhost:8000** öffnen. WSL stellt im normalen
Setup den Zugriff auf Linux-Webanwendungen über localhost bereit; bei abweichenden
Netzwerk-/Firewall-Einstellungen die WSL-Konfiguration prüfen. Es ist kein direkter
Windows-Audiozugriff aus Python erforderlich, weil die Audioerfassung im
Windows-Browser erfolgt. [Microsoft: WSL-Netzwerkzugriff](https://learn.microsoft.com/en-us/windows/wsl/networking)

Ein Linux-Browser unter WSLg ist ein anderer Aufbau: WSLg stellt Audioein- und
-ausgabe über seinen PulseAudio-Server bereit. Daraus folgt nicht, dass dessen
Monitor alle Töne sämtlicher Windows-Programme enthält. Für Zoom auf Windows
deshalb den Windows-Browser und dessen Freigabe bzw. Windows-Loopback verwenden.
[Microsoft: WSLg-Audioarchitektur](https://devblogs.microsoft.com/commandline/wslg-architecture/)

Browserprofile und Adressen haben getrennte Bibliotheken. Bei einem Wechsel von
`127.0.0.1` zu `localhost` oder vom Linux- zum Windows-Browser erscheinen die
Transkripte der anderen Browserablage nicht automatisch.

## Mischung, Speicherung und Fehlerfälle

Audioquellen laufen im gemeinsamen AudioContext mit 16 kHz. Bei zwei Quellen
werden beide vor dem Zusammenführen mit Faktor 0,5 gewichtet; das vermeidet
Übersteuerung durch einfaches Addieren. Der resultierende Monoton wird wie bisher
als PCM16-WAV abschnittsweise an Whisper gesendet. Die gespeicherte Originalaufnahme
ist diese Mischung; getrennte Mikrofon- und Systemspuren werden nicht archiviert.
Lautstärkeunterschiede daher vor einer längeren Sitzung mit einer kurzen Aufnahme
prüfen. Kopfhörer verhindern weitgehend, dass Lautsprecherton zusätzlich über das
Mikrofon ein zweites Mal aufgenommen wird.

Die browserseitig erforderliche Videospur wird weder dargestellt noch gespeichert
oder an das Backend gesendet. Sie bleibt Bestandteil der Freigabe, bis diese
beendet wird. Beim Stoppen werden alle Audio-/Videotracks freigegeben. Ein
entfernter Audioeingang oder das Beenden der Bildschirmfreigabe beendet die
Aufnahme und sichert den Rest. Verweigerte Mikrofonfreigabe bei einer gewünschten
Mischung beendet auch die zuvor gestartete Tab-/Bildschirmfreigabe.

**Audioeingänge laden** fordert kurz die Browser-Audiofreigabe an, beendet den
Teststream sofort und liest die verfügbaren Eingangsnamen. Für einen Loopback-Mix
muss ein separates Mikrofon gewählt werden; zwei erkannte Geräte-IDs desselben
Eingangs werden abgewiesen. Bereits beigemischte Mikrofonanteile im externen
Loopback-Routing kann die App nicht automatisch erkennen.

## Validierung und Grenzen

Die CI prüft Backend-Tests sowie Frontend-Tests und Build auf Windows, macOS und
Linux. Die Audioquellentests prüfen unter anderem fehlende Tonfreigabe, unerwartete
Freigabequellen, explizite Geräteauswahl, optionalen Mikrofonzugriff und Freigabe
aller Tracks nach Abbruch oder Fehlern. Ein Browsertest mit simulierten Quellen
und realer Web-Audio-Verarbeitung prüft die gespeicherten WAVs auf enthaltenen
System- und Mikrofonton sowie die Mischung. Zusätzlich wurde die native
Tab-Freigabe im vollständigen Chromium unter Linux mit Xvfb und hörbarem Testton
bis zur erzeugten WAV-Datei praktisch geprüft. Der Chromium-Headless-Shell-Modus
ist dafür kein gleichwertiger Ersatz. Die bestehende Mikrofonaufnahme wurde
weiterhin mit echtem Vosk und lokalem Whisper geprüft.

Diese automatisierten Prüfungen ersetzen keine Freigabeprüfung an echter Hardware.
Die nativen Auswahlfenster und Loopback-Treiber von Windows/macOS sowie ein
Windows-zu-WSL2-Aufbau wurden in der Linux-Entwicklungsumgebung nicht praktisch
getestet. Für jede Zielumgebung: 20 Sekunden Systemton aufnehmen, mit und ohne
Mikrofon wiederholen, WAV anhören, Freigabe stoppen und die Bibliothek nach Neuladen
prüfen. Ein geschützter Inhalt oder eine Quelle, die der Browser/Audioeingang nicht
liefert, kann nicht durch die Anwendung erzwungen werden.
