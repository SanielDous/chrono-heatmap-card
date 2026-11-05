type Dict = Record<string, string>;

const en: Dict = {
  'card.name': 'Chrono Heatmap',
  'card.description': 'Shows the history of an entity as a heatmap with free choice of rows (hours, days, weeks, months, years).',
  'ui.no_data': 'No data',
  'ui.loading': 'Loading…',
  'ui.entity_not_found': 'Entity not available: {entity}',
  'ui.load_failed': 'Could not load data: {message}',
  'ui.on_ratio_value': '{value} % on',
  'ui.week_short': 'W{n}',

  'error.invalid_config': 'Invalid configuration.',
  'error.missing_entity': 'Please define an entity.',
  'error.invalid_option': 'Invalid value "{value}" for "{option}".',
  'error.invalid_number': '"{option}" must be a number.',
  'error.invalid_combination':
    'Columns "{column_unit}" are not possible with rows "{row_unit}". Allowed: {allowed}.',
  'error.rows': '"rows" must be a whole number between 1 and {max}.',
  'error.on_states': '"on_states" must be a non-empty list.',
  'error.min_max': '"scale.min" must be smaller than "scale.max".',
  'error.steps_count': '"scale.steps" needs at least two entries.',
  'error.step_invalid': 'Entry {index} of "scale.steps" needs a numeric "value" and a "color".',
  'error.relative_steps': 'With "scale.type: relative", step values must be between 0 and 1.',
  'error.absolute_needs_steps': 'Preset "{preset}" is relative; "scale.type: absolute" needs custom "steps".',
  'error.steps_yaml_only': 'Custom color steps can only be edited in YAML.',

  'editor.entity': 'Entity',
  'editor.title': 'Title',
  'editor.row_unit': 'Rows',
  'editor.column_unit': 'Columns',
  'editor.column_unit_helper': 'Leave empty for the default. Hour rows: minute or 5 minutes; week rows: day or hour; year rows: month or week.',
  'editor.rows': 'Number of rows',
  'editor.orientation': 'Orientation',
  'editor.source': 'Data source',
  'editor.aggregation': 'Aggregation',
  'editor.aggregation_helper': 'Leave empty to choose automatically from the entity.',
  'editor.on_states': '"On" states',
  'editor.data': 'Data',
  'editor.scale': 'Colors',
  'editor.preset': 'Color scale',
  'editor.type': 'Scale type',
  'editor.min': 'Minimum',
  'editor.max': 'Maximum',
  'editor.show_legend': 'Show legend',
  'editor.show_labels': 'Show labels',

  'unit.hour': 'Hours',
  'unit.day': 'Days',
  'unit.week': 'Weeks',
  'unit.month': 'Months',
  'unit.year': 'Years',
  'unit.minute': 'Minutes',
  'unit.5minute': '5 minutes',

  'option.horizontal': 'Horizontal',
  'option.vertical': 'Vertical',
  'option.auto': 'Automatic',
  'option.statistics': 'Statistics',
  'option.history': 'History',
  'option.mean': 'Mean',
  'option.min': 'Minimum',
  'option.max': 'Maximum',
  'option.sum': 'Sum',
  'option.last': 'Last value',
  'option.change': 'Change (consumption)',
  'option.on_ratio': 'Share of time "on"',
  'option.temperature': 'Temperature',
  'option.viridis': 'Viridis',
  'option.mono': 'Single color',
  'option.absolute': 'Absolute',
  'option.relative': 'Relative',
};

const de: Dict = {
  'card.name': 'Chrono-Heatmap',
  'card.description':
    'Zeigt den Verlauf einer Entität als Heatmap mit frei wählbaren Reihen (Stunden, Tage, Wochen, Monate, Jahre).',
  'ui.no_data': 'Keine Daten',
  'ui.loading': 'Lade…',
  'ui.entity_not_found': 'Entität nicht verfügbar: {entity}',
  'ui.load_failed': 'Daten konnten nicht geladen werden: {message}',
  'ui.on_ratio_value': '{value} % an',
  'ui.week_short': 'KW{n}',

  'error.invalid_config': 'Ungültige Konfiguration.',
  'error.missing_entity': 'Bitte eine Entität angeben.',
  'error.invalid_option': 'Ungültiger Wert „{value}“ für „{option}“.',
  'error.invalid_number': '„{option}“ muss eine Zahl sein.',
  'error.invalid_combination':
    'Spalten „{column_unit}“ sind bei Reihen „{row_unit}“ nicht möglich. Erlaubt: {allowed}.',
  'error.rows': '„rows“ muss eine ganze Zahl zwischen 1 und {max} sein.',
  'error.on_states': '„on_states“ muss eine nicht-leere Liste sein.',
  'error.min_max': '„scale.min“ muss kleiner als „scale.max“ sein.',
  'error.steps_count': '„scale.steps“ braucht mindestens zwei Einträge.',
  'error.step_invalid': 'Eintrag {index} von „scale.steps“ braucht einen numerischen „value“ und eine „color“.',
  'error.relative_steps': 'Bei „scale.type: relative“ müssen die Stufenwerte zwischen 0 und 1 liegen.',
  'error.absolute_needs_steps':
    'Preset „{preset}“ ist relativ; „scale.type: absolute“ braucht eigene „steps“.',
  'error.steps_yaml_only': 'Eigene Farbstufen können nur in YAML bearbeitet werden.',

  'editor.entity': 'Entität',
  'editor.title': 'Titel',
  'editor.row_unit': 'Reihen',
  'editor.column_unit': 'Spalten',
  'editor.column_unit_helper':
    'Leer lassen für den Standard. Stunden-Reihen: Minute oder 5 Minuten; Wochen-Reihen: Tag oder Stunde; Jahres-Reihen: Monat oder Woche.',
  'editor.rows': 'Anzahl Reihen',
  'editor.orientation': 'Ausrichtung',
  'editor.source': 'Datenquelle',
  'editor.aggregation': 'Aggregation',
  'editor.aggregation_helper': 'Leer lassen, um automatisch anhand der Entität zu wählen.',
  'editor.on_states': '„An“-Zustände',
  'editor.data': 'Daten',
  'editor.scale': 'Farben',
  'editor.preset': 'Farbskala',
  'editor.type': 'Skalentyp',
  'editor.min': 'Minimum',
  'editor.max': 'Maximum',
  'editor.show_legend': 'Legende anzeigen',
  'editor.show_labels': 'Beschriftung anzeigen',

  'unit.hour': 'Stunden',
  'unit.day': 'Tage',
  'unit.week': 'Wochen',
  'unit.month': 'Monate',
  'unit.year': 'Jahre',
  'unit.minute': 'Minuten',
  'unit.5minute': '5 Minuten',

  'option.horizontal': 'Horizontal',
  'option.vertical': 'Vertikal',
  'option.auto': 'Automatisch',
  'option.statistics': 'Statistik',
  'option.history': 'Verlauf',
  'option.mean': 'Mittelwert',
  'option.min': 'Minimum',
  'option.max': 'Maximum',
  'option.sum': 'Summe',
  'option.last': 'Letzter Wert',
  'option.change': 'Änderung (Verbrauch)',
  'option.on_ratio': 'Zeitanteil „an“',
  'option.temperature': 'Temperatur',
  'option.viridis': 'Viridis',
  'option.mono': 'Einfarbig',
  'option.absolute': 'Absolut',
  'option.relative': 'Relativ',
};

export const TRANSLATIONS: Record<string, Dict> = { en, de };

export function resolveLanguage(lang: string | undefined): string {
  const base = (lang ?? 'en').toLowerCase().split(/[-_]/)[0];
  return base in TRANSLATIONS ? base : 'en';
}

export function localize(lang: string | undefined, key: string, params: Record<string, string | number> = {}): string {
  const dict = TRANSLATIONS[resolveLanguage(lang)];
  const template = dict[key] ?? en[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
}
