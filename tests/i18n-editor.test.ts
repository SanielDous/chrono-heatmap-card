import { describe, expect, it } from 'vitest';
import { normalizeConfig, PRESET_NAMES } from '../src/config';
import { formFieldNames, getConfigFormSchema, type FormSchemaItem } from '../src/editor';
import { localize, resolveLanguage, TRANSLATIONS } from '../src/i18n';

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('i18n', () => {
  const languages = Object.keys(TRANSLATIONS).filter((l) => l !== 'en');

  it('ships the expected languages', () => {
    expect(Object.keys(TRANSLATIONS).sort()).toEqual(['de', 'en', 'es', 'fr', 'it', 'nl', 'pl', 'sv']);
  });

  it.each(languages)('%s has exactly the English keys', (lang) => {
    expect(Object.keys(TRANSLATIONS[lang]).sort()).toEqual(Object.keys(TRANSLATIONS.en).sort());
  });

  it.each(languages)('%s keeps the placeholders of every key', (lang) => {
    for (const [key, text] of Object.entries(TRANSLATIONS.en)) {
      expect(placeholders(TRANSLATIONS[lang][key]), `${lang} ${key}`).toEqual(placeholders(text));
    }
  });

  it.each(languages)('%s has no empty or untrimmed strings', (lang) => {
    for (const [key, text] of Object.entries(TRANSLATIONS[lang])) {
      expect(text.trim(), `${lang} ${key}`).toBe(text);
      expect(text, `${lang} ${key}`).not.toBe('');
    }
  });

  it.each([
    ['en', 'en'],
    ['en-GB', 'en'],
    ['de', 'de'],
    ['de-CH', 'de'],
    ['fr-FR', 'fr'],
    ['fr-CA', 'fr'],
    ['nl-BE', 'nl'],
    ['es-419', 'es'],
    ['ES_es', 'es'],
    ['it', 'it'],
    ['pl', 'pl'],
    ['sv-SE', 'sv'],
    ['pt', 'en'],
    ['pt-BR', 'en'],
    ['zh-Hans', 'en'],
    ['constructor', 'en'],
    ['', 'en'],
    [undefined, 'en'],
  ])('resolves %s to %s', (lang, expected) => {
    expect(resolveLanguage(lang)).toBe(expected);
  });

  it('falls back to English for unknown languages and fills params', () => {
    expect(localize('pt', 'ui.entity_not_found', { entity: 'sensor.x' })).toBe(
      'Entity not available: sensor.x',
    );
    expect(localize('de-DE', 'ui.no_data')).toBe('Keine Daten');
    expect(localize('fr-FR', 'ui.week_short', { n: 7 })).toBe('S7');
    expect(localize('sv', 'ui.week_short', { n: 7 })).toBe('V7');
    expect(localize('nl-BE', 'ui.entity_not_found', { entity: 'sensor.x' })).toBe(
      'Entiteit niet beschikbaar: sensor.x',
    );
  });

  it('returns the key for unknown keys', () => {
    expect(localize('en', 'nope')).toBe('nope');
    expect(localize('fr', 'nope')).toBe('nope');
  });
});

describe('getConfigFormSchema', () => {
  const form = getConfigFormSchema('en');

  it('shows the same boolean defaults as the card uses', () => {
    const flat = (items: FormSchemaItem[]): FormSchemaItem[] =>
      items.flatMap((i) => (i.schema ? flat(i.schema) : [i]));
    const items = flat(form.schema);
    const normalized = normalizeConfig({ type: 'x', entity: 'sensor.a' });
    for (const key of ['show_legend', 'show_labels', 'newest_first'] as const) {
      expect(items.find((i) => i.name === key)?.default).toBe(normalized[key]);
    }
  });

  it('writes only known config keys', () => {
    expect(formFieldNames(form.schema).sort()).toEqual(
      [
        'aggregation',
        'column_unit',
        'entity',
        'newest_first',
        'on_states',
        'orientation',
        'row_unit',
        'rows',
        'scale.max',
        'scale.min',
        'scale.preset',
        'scale.reverse',
        'scale.type',
        'show_labels',
        'show_legend',
        'source',
        'title',
      ].sort(),
    );
  });

  it('labels every field', () => {
    for (const name of formFieldNames(form.schema)) {
      const leaf = name.split('.').at(-1)!;
      expect(form.computeLabel({ name: leaf })).not.toBe(`editor.${leaf}`);
    }
  });

  it('disables the visual editor for custom steps', () => {
    expect(() =>
      form.assertConfig({
        type: 'x',
        entity: 'sensor.a',
        scale: {
          steps: [
            { value: 0, color: 'red' },
            { value: 1, color: 'blue' },
          ],
        },
      }),
    ).toThrow();
    expect(() => form.assertConfig({ type: 'x', entity: 'sensor.a' })).not.toThrow();
  });

  it('labels every preset in every language', () => {
    for (const lang of Object.keys(TRANSLATIONS)) {
      for (const preset of PRESET_NAMES) {
        expect(TRANSLATIONS[lang][`option.${preset}`], `${lang} ${preset}`).toBeTruthy();
      }
    }
  });

  it('localizes to German', () => {
    expect(getConfigFormSchema('de').computeLabel({ name: 'row_unit' })).toBe('Reihen');
  });
});
