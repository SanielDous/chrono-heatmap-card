import { AGGREGATIONS, COLUMN_UNITS, MAX_ROWS, PRESET_NAMES, ROW_UNITS, type CardConfig } from './config';
import { localize } from './i18n';

/* Schema format of HA's `getConfigForm()` (ha-form). Kept loose on purpose: HA owns this format. */
export interface FormSchemaItem {
  name: string;
  type?: 'grid' | 'expandable';
  title?: string;
  required?: boolean;
  selector?: Record<string, unknown>;
  schema?: FormSchemaItem[];
  flatten?: boolean;
}

export interface ConfigForm {
  schema: FormSchemaItem[];
  computeLabel: (schema: FormSchemaItem) => string | undefined;
  computeHelper: (schema: FormSchemaItem) => string | undefined;
  assertConfig: (config: CardConfig) => void;
}

/** HA sets <html lang>; getConfigForm() is static and gets no hass object. */
function uiLanguage(): string {
  if (typeof document !== 'undefined' && document.documentElement.lang) return document.documentElement.lang;
  if (typeof navigator !== 'undefined' && navigator.language) return navigator.language;
  return 'en';
}

export function getConfigFormSchema(lang: string = uiLanguage()): ConfigForm {
  const t = (key: string) => localize(lang, key);
  const select = (values: readonly string[], prefix: string) => ({
    select: {
      mode: 'dropdown',
      options: values.map((value) => ({ value, label: t(`${prefix}.${value}`) })),
    },
  });

  const schema: FormSchemaItem[] = [
    { name: 'entity', required: true, selector: { entity: {} } },
    { name: 'title', selector: { text: {} } },
    {
      name: '',
      type: 'grid',
      schema: [
        { name: 'row_unit', selector: select(ROW_UNITS, 'unit') },
        { name: 'column_unit', selector: select(COLUMN_UNITS, 'unit') },
        { name: 'rows', selector: { number: { min: 1, max: MAX_ROWS, mode: 'box' } } },
        { name: 'orientation', selector: select(['horizontal', 'vertical'], 'option') },
      ],
    },
    {
      name: '',
      type: 'expandable',
      title: t('editor.data'),
      schema: [
        { name: 'source', selector: select(['auto', 'statistics', 'history'], 'option') },
        { name: 'aggregation', selector: select(AGGREGATIONS, 'option') },
        { name: 'on_states', selector: { text: { multiple: true } } },
      ],
    },
    {
      name: 'scale',
      type: 'expandable',
      title: t('editor.scale'),
      schema: [
        {
          name: '',
          type: 'grid',
          schema: [
            { name: 'preset', selector: select(PRESET_NAMES, 'option') },
            { name: 'type', selector: select(['absolute', 'relative'], 'option') },
            { name: 'min', selector: { number: { mode: 'box', step: 'any' } } },
            { name: 'max', selector: { number: { mode: 'box', step: 'any' } } },
          ],
        },
      ],
    },
    {
      name: '',
      type: 'grid',
      schema: [
        { name: 'show_legend', selector: { boolean: {} } },
        { name: 'show_labels', selector: { boolean: {} } },
      ],
    },
  ];

  return {
    schema,
    computeLabel: (s) => (s.name ? t(`editor.${s.name}`) : undefined),
    computeHelper: (s) => {
      if (s.name === 'column_unit') return t('editor.column_unit_helper');
      if (s.name === 'aggregation') return t('editor.aggregation_helper');
      return undefined;
    },
    assertConfig: (config) => {
      if (config.scale?.steps !== undefined) throw new Error(t('error.steps_yaml_only'));
    },
  };
}

/** All config keys the form can write (for tests). */
export function formFieldNames(items: FormSchemaItem[], prefix = ''): string[] {
  return items.flatMap((i) => {
    if (i.schema) return formFieldNames(i.schema, i.name ? `${prefix}${i.name}.` : prefix);
    return [`${prefix}${i.name}`];
  });
}
