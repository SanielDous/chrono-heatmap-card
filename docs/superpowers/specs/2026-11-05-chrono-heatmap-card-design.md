# Chrono Heatmap Card – Design

Stand: 2026-11-05 · Status: Entwurf zur Freigabe

## 1. Absicht & Warum

Eine Home-Assistant-Dashboard-Karte, die den Verlauf **einer** Entität als Heatmap zeigt – inspiriert von
[kandsten/ha-heatmap-card](https://github.com/kandsten/ha-heatmap-card), aber mit freier Wahl der Zeitraster:
Reihen sind nicht nur Tage, sondern wahlweise Stunden, Tage, Wochen, Monate oder Jahre; die Spalten sind die
jeweils sinnvolle Unterteilung (z. B. Stunde → 5-Minuten-Blöcke, Jahr → Monate).

Zweites, gleichrangiges Ziel: ein **schneller Entwicklungszyklus**. Eine lokale Testseite mit Mock-Daten zeigt
die Karte so, wie sie in HA aussehen wird (Hot Reload), und die CI liefert pro PR Screenshots.

## 2. Ziele, Nicht-Ziele, Anti-Ziele

**Ziele (v1)**

- Eine Entität pro Karte, alle fünf Reihentypen (hour/day/week/month/year).
- Numerische Sensoren (Mittel/Min/Max/Summe/Letzter/Änderung) und An/Aus-Entitäten (Anteil „an“).
- Datenquelle automatisch (Statistik wo möglich, sonst Historie), überschreibbar.
- 3 Farb-Presets + eigene Farbstufen per YAML; absolute und relative Skalen.
- Tooltip, Klick → More-Info, Legende, Achsenbeschriftung.
- Visueller Editor über `getConfigForm`.
- UI-Texte Englisch (Pflicht) und Deutsch.
- Dev-Testseite mit Mock-`hass`, CI mit Lint/Typecheck/Tests/Build/Screenshots, automatische Releases, HACS-Custom-Repo-fähig.

**Nicht-Ziele (v1, ggf. später)**

- Mehrere Entitäten pro Karte.
- Vor-/Zurückblättern in der Zeit.
- Eigener (custom) Editor, Bearbeitung von Farbstufen im visuellen Editor.
- Echtes HA im lokalen Setup oder in der CI; Devcontainer; Docker.
- Screenshot-Vergleich gegen Baselines (Screenshots sind nur zum Anschauen).
- Aufnahme in den HACS-Standard-Store/Marketplace (später geplant, jetzt nur Custom Repo).

**Anti-Ziele (wäre ein Fehlschlag, auch wenn es „funktioniert“)**

- Abhängigkeit von internen `ha-*`-Elementen außer `ha-card` – HA garantiert sie nicht, und genau das hat 2026
  viele Custom Cards gebrochen.
- Falsche Zeitzuordnung (Sommerzeit, Zeitzone, Wochenbeginn) – lieber leere Zellen als falsche Werte.
- Testseite, die deutlich anders aussieht als die Karte in HA.

## 3. Rahmenbedingungen

- Nur aktuelle HA-Version (Stand Nov. 2026); keine Rückwärtskompatibilität.
- Karte ist ein Standard-Custom-Element, eine einzige gebündelte JS-Datei, alle Abhängigkeiten mitgebündelt.
- Pakete kommen lokal ausschließlich aus der Firmen-Artifactory (`gb40-npmjs-remote`, nur mit VPN). Sie liefert nur
  bereits gecachte und gescannte Versionen; neue Versionen hängen. Deshalb exakt gepinnte Abhängigkeiten,
  `minimumReleaseAge` und Overrides in `pnpm-workspace.yaml`. Die GitHub-CI nutzt die öffentliche Registry.
- Lokale Umgebung: Windows 11 mit WSL2, **kein Docker Desktop**.
- Hosting: GitHub, GitHub Actions. Lizenz: MIT (bestehend).

## 4. Entschiedenes „Wie“

### 4.1 Name

- Element/Typ: `chrono-heatmap-card` → YAML `type: custom:chrono-heatmap-card`.
- Bundle: `dist/chrono-heatmap-card.js`. Repo-Name bleibt `ha-heatmap-card`; `hacs.json` setzt `filename`.
- _(Vorschlag von Claude, vom Nutzer erbeten – kann beim Review geändert werden.)_

### 4.2 Tech-Stack

| Bereich        | Wahl                                                  |
| -------------- | ----------------------------------------------------- |
| Sprache        | TypeScript (strict)                                   |
| UI             | Plain Custom Element mit Shadow DOM, kein Framework\* |
| Build          | Vite im Library-Modus, ein ES-Modul als Ausgabe       |
| Paketmanager   | pnpm                                                  |
| Datum/Zeitzone | `date-fns` + `@date-fns/tz`                           |
| Farben         | eigene kleine Interpolation, keine Farbbibliothek     |
| Rendering      | SVG                                                   |
| Unit-Tests     | Vitest                                                |
| Screenshots    | Playwright                                            |
| Lint/Format    | ESLint + Prettier                                     |

\* Ursprünglich Lit. Lit ist über die Artifactory in keiner Version abrufbar (Stand 2026-11-05), daher
_Claudes Entscheidung während der Umsetzung_: kein Framework. HA erlaubt das ausdrücklich. Die Karte rendert das
Raster als einen SVG-String, wenn sich Daten oder Größe ändern; der Tooltip ist ein eigenes Element. Ein späterer
Umstieg auf Lit ist möglich, sobald es verfügbar ist.

### 4.3 Rasterlogik

Eine **Reihe** ist eine Periode (`row_unit`), eine **Spalte** eine Unterteilung (`column_unit`). Erlaubte Kombinationen:

| `row_unit` | erlaubte `column_unit` (fett = Standard) | Spalten                        |
| ---------- | ---------------------------------------- | ------------------------------ |
| hour       | minute, **5minute**                      | 60 / 12                        |
| day        | **hour**                                 | 24 (23/25 an Sommerzeit-Tagen) |
| week       | **day**, hour                            | 7 / 168                        |
| month      | **day**                                  | 28–31                          |
| year       | **month**, week                          | 12 / 52–53                     |

- `rows` (Anzahl, Standard je `row_unit` sinnvoll, z. B. day → 14): die letzten N Perioden, die aktuelle (angefangene) zuletzt.
- Kürzere Reihen (Monat mit 28 Tagen, 23-h-Tag) werden **mit leeren Zellen** aufgefüllt; „keine Daten“, „Zukunft“ und
  „fehlend“ sind optisch als leer erkennbar (keine Farbe der Skala).
- 25-h-Tag (Zeitumstellung Herbst): die doppelte Stunde bekommt eine eigene Spalte, Tage haben dann 25 Spalten –
  Raster ist so breit wie die längste Reihe. _(Detail-Darstellung ist Builder-Entscheidung, Bedingung: kein Wert wird verschluckt oder doppelt gezählt.)_
- `orientation: horizontal | vertical` – horizontal = Reihen untereinander, Zeit innerhalb der Reihe von links nach rechts; vertical vertauscht.
- Zeitzone, Wochenbeginn und Zahlen/Datumsformat folgen dem HA-Profil des Nutzers (`hass.locale`: Zeitzone server/lokal,
  `first_weekday`, Sprache). Fehlt eine Angabe → Server-Zeitzone (`hass.config.time_zone`) und Locale-Standard.

### 4.4 Daten

**Quelle** – `source: auto | statistics | history` (Standard `auto`):

- `statistics`: WebSocket `recorder/statistics_during_period`. Es werden **nur die Perioden `5minute` und `hour`**
  abgefragt; Tage/Wochen/Monate werden clientseitig aus Stundenwerten gebildet, damit Zeitzone und Wochenbeginn
  exakt dem Nutzerprofil folgen.
- `history`: WebSocket `history/history_during_period`; Aggregation clientseitig.
- `auto`: Statistik, wenn die Entität Statistiken hat und die Spalteneinheit es erlaubt (`minute` → immer Historie);
  sonst Historie. An/Aus-Entitäten → immer Historie.
- Datenlücken aufgrund der Recorder-Aufbewahrung (Historie und 5-Minuten-Statistik, Standard 10 Tage) werden als leere Zellen gezeigt.

**Aggregation** – `aggregation: mean | min | max | sum | last | change | on_ratio`:

- Standard: `state_class: total` / `total_increasing` → `change`; numerisch sonst → `mean`; nicht-numerisch → `on_ratio`.
- Aus Historie ist `mean` zeitgewichtet. `on_ratio` = zeitgewichteter Anteil der Zelle, in der der Zustand „an“ war (0–100 %).
- „An“-Zustände: Option `on_states` (Liste), Standard `["on"]`.

**Live-Update**: Ändert sich der Zustand der Entität, wird die aktuelle Zelle aktualisiert. Die Karte soll nicht bei jedem
`hass`-Update neu rechnen – Abo nur auf das Nötige (z. B. `context-request`) bzw. gedrosselt. _(Mechanik ist Builder-Entscheidung.)_

### 4.5 Darstellung

**Farbskalen** – genau drei Presets in v1:

1. `temperature` – absolute Skala, mehrfarbiger Verlauf (kalt blau → grün → gelb → orange → rot), Stützwerte in °C;
   bei °F-Einheit umgerechnet. Standard für `device_class: temperature`.
2. `viridis` – relative Skala (farbenblind-tauglich). Standard für alles andere, inkl. `on_ratio` (0–100 %).
3. `mono` – relative Skala von transparent/hell zur Theme-Primärfarbe.

Konfiguration:

```yaml
scale:
  preset: temperature # oder viridis | mono
  type: absolute | relative # Preset bringt einen Standard mit
  min: 0 # relative Skala: feste Grenzen (sonst aus Daten)
  max: 3000
  steps: # eigene Stufen, nur YAML; überschreibt Preset
    - { value: 0, color: '#2c7bb6' }
    - { value: 20, color: '#ffffbf' }
    - { value: 30, color: '#d7191c' }
```

Lineare Interpolation zwischen den Stufen.

**Interaktion & Beschriftung** (vom Nutzer so angenommen, wird nach Test nachjustiert):

- Tooltip beim Hovern/Tippen: Zeitraum der Zelle + formatierter Wert mit Einheit (bzw. „keine Daten“).
- Klick auf die Karte/Zelle öffnet den More-Info-Dialog der Entität (Event `hass-more-info`).
- Legende mit Farbskala und Min/Max-Werten (`show_legend`, Standard an).
- Achsenbeschriftungen für Reihen und Spalten (`show_labels`, Standard an), locale-formatiert, bei Platzmangel ausgedünnt.
- Titel `title`, Standard = Name der Entität (`hass.formatEntityName` o. ä.).

**Größe & Theme**

- Zellen passen sich der Kartenbreite an (Mindestgröße, darunter Beschriftung ausdünnen). `getGridOptions`: Standard
  12 Spalten, Höhe `auto`; `getCardSize` für Masonry.
- Hülle ist `ha-card`; Text, Rahmen, „leer“-Zellen über HA-Theme-Variablen; Hell- und Dunkelmodus.

### 4.6 Editor & Kartenauswahl

- `getConfigForm()` mit Feldern: entity, title, row_unit, column_unit (nur gültige Optionen sichtbar), rows, orientation,
  source, aggregation, scale.preset/type/min/max, show_legend, show_labels.
- `assertConfig` deaktiviert den visuellen Editor, wenn `scale.steps` gesetzt ist (nur YAML).
- Labels/Hilfetexte über eigene Übersetzungen (en/de).
- Eintrag in `window.customCards` (Name, Beschreibung, `preview: true`), `getStubConfig` wählt einen passenden Sensor mit Fallback.
- `setConfig` validiert und wirft verständliche Fehler (z. B. ungültige Kombination row/column_unit).

### 4.7 Sprachen

Englisch + Deutsch für alle eigenen Texte (Editor, Tooltip, Legende, Fehler). Auswahl über die HA-Sprache, Fallback Englisch.

### 4.8 Lokales Dev-Setup

- `pnpm dev` startet den Vite-Devserver mit **Testseite** (Hot Reload). Läuft unter WSL2, kein Docker.
- Die Testseite enthält:
  - ein **Mock-`hass`**, das die genutzten WebSocket-Befehle (`recorder/statistics_during_period`,
    `history/history_during_period`, ggf. `recorder/list_statistic_ids`) mit generierten Daten beantwortet sowie
    `states`, `locale`, `config`, Formatierer und `language` bereitstellt;
  - mehrere **Szenarien** mit deterministischen (geseedeten) Daten: Innentemperatur, Leistung (W), Energiezähler
    (`total_increasing`), `binary_sensor` (Tür/Präsenz), Datenlücken, Sommerzeit-Wechsel;
  - Galerie mehrerer Karten nebeneinander (je Reihentyp) **und** ein YAML-Eingabefeld zum freien Ausprobieren;
  - Umschalter Hell/Dunkel und Sprache en/de;
  - eine nachgebaute `ha-card` und HA-Theme-Variablen, damit das Aussehen dem echten HA möglichst nahekommt.
- Grenze: Der `getConfigForm`-Editor wird von HA gerendert und ist auf der Testseite nicht sichtbar; er wird per
  Unit-Test geprüft und vom Nutzer im echten HA angeschaut.
- `pnpm build` erzeugt `dist/chrono-heatmap-card.js` zum manuellen Kopieren nach `config/www`.

### 4.9 CI/CD (GitHub Actions)

- **PR & Push**: install → lint → typecheck → unit tests → build → HACS-Validierung → Playwright-Screenshots der Testseite
  (feste Uhrzeit, feste Seeds, Linux-Runner, hell + dunkel, en + de wo sinnvoll).
- Screenshots werden als **Artefakt** hochgeladen; ein **PR-Kommentar** verlinkt das Artefakt (bei neuem Push aktualisiert statt neu angelegt).
  Für PRs aus Forks entfällt der Kommentar (nur Artefakt).
- **Release beim Merge auf `main`**: semantic-release analysiert Conventional Commits, erhöht die Version (SemVer),
  erstellt Tag, GitHub Release mit `chrono-heatmap-card.js` als Asset und pflegt das CHANGELOG.
- Conventional Commits werden im PR geprüft. _(Claudes Entscheidung: Squash-Merge, PR-Titel wird per Lint geprüft.)_

## 4.10 Präzisierungen nach Builder-Check (Claudes Entscheidungen)

1. **Editor & ungültige Kombination**: `getConfigForm` ist statisch. `column_unit` ist im Editor ein Select mit allen
   Einheiten plus „Standard“ (leer = Standard aus Tabelle 4.3). Eine ungültige Kombination lässt `setConfig` mit
   verständlicher Meldung (en/de) scheitern; HA zeigt dann die Fehlerkarte in der Vorschau. Config-Form bleibt `row_unit` + `column_unit`.
2. **Skalen-Semantik**:
   - `type: absolute` → `steps[].value` sind Rohwerte in der Einheit der Entität. `min`/`max` werden ignoriert.
   - `type: relative` → `steps[].value` sind Positionen 0–1, die auf `[min, max]` abgebildet werden; `min`/`max` aus der
     Config, sonst aus den sichtbaren Daten.
   - Presets: `temperature` = absolute (Stützwerte °C, bei °F-Entität umgerechnet); `viridis`, `mono` = relative.
     `type: absolute` mit `viridis`/`mono` ohne eigene `steps` ist ein Config-Fehler.
   - Eigene `steps`: Standard-`type` ist `absolute`; keine Einheitenumrechnung bei eigenen Stufen.
   - `on_ratio`: Wertebereich fest 0–100 % (min 0, max 1) solange nicht überschrieben.
3. **year × week**: Wochen beginnen am `first_weekday` des Nutzers. Eine Woche gehört zu dem Jahr, in dem ihr erster Tag
   liegt. Spalte = Wochenindex ab der ersten Woche, die im Jahr beginnt (0-basiert); Tage am Jahresanfang vor dieser
   ersten Woche gehören zur letzten Woche des Vorjahres. Daraus ergeben sich 52 oder 53 Spalten.
4. **Interaktion Touch vs. Maus**: Maus: Hover = Tooltip, Klick auf Zelle = More-Info. Touch: Tippen = Tooltip, erneutes
   Tippen auf dieselbe Zelle = More-Info. Klick auf den Titel öffnet immer More-Info.
5. **Release**: semantic-release committet **nicht** zurück nach `main`; Änderungsnotizen nur in den GitHub Releases
   (kein CHANGELOG-File). Start der Versionierung bei `0.x` (Tag `v0.0.0` auf dem Initial-Commit), `feat` → Minor.
   Version wird beim Build aus dem Release-Tag ins Bundle geschrieben.
6. **Datenmenge**: Stundenstatistiken auch für year/month-Views sind akzeptiert (≈ 8.760 Werte pro Jahr). Optimierung später.
7. **Aktuelle (unfertige) Periode**: Die Datenschicht arbeitet mit **Basis-Buckets** (1 min, 5 min oder 1 h – je nach
   Spalteneinheit). Basis-Buckets, für die (noch) keine Statistik existiert, werden aus der Historie berechnet
   (Zeitraum ab Ende der letzten Statistik bis jetzt). Basis-Buckets überlappen nie → keine Doppelzählung. Zellen
   werden aus Basis-Buckets aggregiert (`mean` zeitgewichtet, `min`/`max`, `change` = Summe der Änderungen,
   `sum` = Summe der Bucket-Mittelwerte, `last` = letzter Wert, `on_ratio` zeitgewichtet).

## 5. Dem Builder überlassen

- Genauer Code-Aufbau, Dateistruktur, interne Schnittstellen.
- Mechanik von Abo/Drosselung für Live-Updates.
- Konkrete Farbwerte der Presets (innerhalb der beschriebenen Charakteristik), Zellabstände, Typografie.
- Details der DST-Darstellung im Rahmen von 4.3.
- Standardwerte für `rows` je Reihentyp.
- Node-Version (aktuelle LTS), konkrete Action-Versionen.

## 6. Claudes Entscheidungen (zur Prüfung)

- Name `chrono-heatmap-card`.
- Nur `5minute`/`hour`-Statistiken abfragen, größere Einheiten clientseitig bilden (wegen Zeitzone/Wochenbeginn).
- Erlaubte row/column-Kombinationen wie Tabelle 4.3 (inkl. week×hour und year×week).
- Drei Presets: temperature, viridis, mono.
- `on_states` Standard `["on"]`.
- Squash-Merge + PR-Titel-Lint für Conventional Commits.
- Farbstufen nur per YAML; visueller Editor wird dann deaktiviert.
