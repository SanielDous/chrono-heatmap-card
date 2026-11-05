import { describe, expect, it } from 'vitest';
import { formFieldNames, getConfigFormSchema } from '../src/editor';
import { localize, TRANSLATIONS } from '../src/i18n';

describe('i18n', () => {
  it('German has every English key', () => {
    const missing = Object.keys(TRANSLATIONS.en).filter((k) => !(k in TRANSLATIONS.de));
    expect(missing).toEqual([]);
  });

  it('falls back to English for unknown languages and fills params', () => {
    expect(localize('fr', 'ui.entity_not_found', { entity: 'sensor.x' })).toBe('Entity not available: sensor.x');
    expect(localize('de-DE', 'ui.no_data')).toBe('Keine Daten');
  });

  it('returns the key for unknown keys', () => {
    expect(localize('en', 'nope')).toBe('nope');
  });
});

describe('getConfigFormSchema', () => {
  const form = getConfigFormSchema('en');

  it('writes only known config keys', () => {
    expect(formFieldNames(form.schema).sort()).toEqual(
      [
        'aggregation',
        'column_unit',
        'entity',
        'on_states',
        'orientation',
        'row_unit',
        'rows',
        'scale.max',
        'scale.min',
        'scale.preset',
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

  it('localizes to German', () => {
    expect(getConfigFormSchema('de').computeLabel({ name: 'row_unit' })).toBe('Reihen');
  });
});
