// Form editor for the demo playground, built from the card's own editor schema (the one HA's visual editor shows),
// kept in sync with the YAML both ways.
import type { CardConfig } from '../src/config';
import { normalizeConfig } from '../src/config';
import { getConfigFormSchema, type FormSchemaItem } from '../src/editor';
import { SCENARIOS } from './scenarios';

type Config = Record<string, unknown>;

export interface PlaygroundForm {
  /** Show these values in the form (after the YAML changed). */
  setConfig(config: Config): void;
}

/** Path of a field in the config: `['rows']`, `['scale', 'preset']`. */
function getIn(config: Config, path: string[]): unknown {
  let v: unknown = config;
  for (const key of path) v = v && typeof v === 'object' ? (v as Config)[key] : undefined;
  return v;
}

/** Set (or delete, for undefined) a field; empty parent objects are removed. */
export function setIn(config: Config, path: string[], value: unknown): Config {
  const [key, ...rest] = path;
  const next = { ...config };
  if (rest.length) {
    const child = setIn((next[key] as Config) ?? {}, rest, value);
    if (Object.keys(child).length) next[key] = child;
    else delete next[key];
  } else if (value === undefined) {
    delete next[key];
  } else {
    next[key] = value;
  }
  return next;
}

/** What the card uses when the field is left out, as shown in the form (`auto` where it depends on the entity). */
function defaultText(config: Config, path: string[]): string {
  let normalized: unknown;
  try {
    normalized = normalizeConfig({ ...(config as unknown as CardConfig), entity: 'sensor.x' });
  } catch {
    return '';
  }
  const v = getIn(normalized as Config, path);
  if (v === undefined) return 'auto';
  return Array.isArray(v) ? v.join(', ') : String(v);
}

export function createPlaygroundForm(
  container: HTMLElement,
  lang: string,
  initial: Config,
  onChange: (config: Config) => void,
): PlaygroundForm {
  const form = getConfigFormSchema(lang);
  let config = initial;
  const updaters: (() => void)[] = [];

  const change = (path: string[], value: unknown) => {
    config = setIn(config, path, value);
    for (const u of updaters) u(); // defaults can depend on other fields (rows on row_unit)
    onChange(config);
  };

  function field(item: FormSchemaItem, path: string[]): HTMLElement {
    const wrap = document.createElement('label');
    wrap.className = 'field';
    const title = document.createElement('span');
    title.className = 'field-label';
    title.textContent = form.computeLabel(item) ?? item.name;
    const key = document.createElement('code');
    key.textContent = path.join('.');
    title.append(' ', key);
    wrap.append(title);

    const sel = item.selector ?? {};
    let input: HTMLInputElement | HTMLSelectElement;
    let update: () => void;

    if ('boolean' in sel) {
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.addEventListener('change', () => {
        // the default is left out of the YAML, so it stays short
        const def = String(item.default ?? defaultText(config, path)) === 'true';
        change(path, box.checked === def ? undefined : box.checked);
      });
      update = () => {
        const v = getIn(config, path);
        box.checked = typeof v === 'boolean' ? v : defaultText(config, path) === 'true';
      };
      input = box;
      wrap.classList.add('field-boolean');
    } else if ('select' in sel || 'entity' in sel) {
      const select = document.createElement('select');
      const options =
        'entity' in sel
          ? SCENARIOS.map((s) => ({
              value: s.entity_id,
              label: `${String(s.attributes.friendly_name ?? s.entity_id)} (${s.entity_id})`,
            }))
          : ((sel.select as { options: { value: string; label: string }[] }).options ?? []);
      select.addEventListener('change', () => change(path, select.value || undefined));
      update = () => {
        const v = getIn(config, path);
        const def = item.required ? undefined : defaultText(config, path);
        select.replaceChildren(
          ...(def !== undefined ? [new Option(`– default: ${def} –`, '')] : []),
          ...options.map((o) => new Option(o.label, o.value)),
        );
        if (typeof v === 'string' && !options.some((o) => o.value === v)) select.append(new Option(v, v));
        select.value = typeof v === 'string' ? v : '';
      };
      input = select;
    } else if ('number' in sel) {
      const num = document.createElement('input');
      const { min, max } = sel.number as { min?: number; max?: number };
      num.type = 'number';
      if (min !== undefined) num.min = String(min);
      if (max !== undefined) num.max = String(max);
      num.step = 'any';
      num.addEventListener('change', () => change(path, num.value === '' ? undefined : Number(num.value)));
      update = () => {
        const v = getIn(config, path);
        num.value = typeof v === 'number' ? String(v) : '';
        num.placeholder = `default: ${defaultText(config, path)}`;
      };
      input = num;
    } else {
      const multiple = (sel.text as { multiple?: boolean } | undefined)?.multiple;
      const text = document.createElement('input');
      text.addEventListener('change', () => {
        const raw = text.value.trim();
        const value = multiple
          ? raw
            ? raw
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean)
            : undefined
          : raw || undefined;
        change(path, value);
      });
      update = () => {
        const v = getIn(config, path);
        text.value = Array.isArray(v) ? v.join(', ') : typeof v === 'string' ? v : '';
        text.placeholder = multiple ? `default: ${defaultText(config, path)} (comma separated)` : '';
      };
      input = text;
    }
    wrap.append(input);
    const helper = form.computeHelper(item);
    if (helper) {
      const h = document.createElement('span');
      h.className = 'field-helper';
      h.textContent = helper;
      wrap.append(h);
    }
    updaters.push(update);
    return wrap;
  }

  function build(items: FormSchemaItem[], path: string[]): HTMLElement[] {
    return items.map((item) => {
      const sub = item.name ? [...path, item.name] : path;
      if (item.type === 'expandable') {
        const details = document.createElement('details');
        const summary = document.createElement('summary');
        summary.textContent = item.title ?? item.name;
        details.append(summary, ...build(item.schema ?? [], sub));
        return details;
      }
      if (item.type === 'grid') {
        const grid = document.createElement('div');
        grid.className = 'field-grid';
        grid.append(...build(item.schema ?? [], sub));
        return grid;
      }
      return field(item, sub);
    });
  }

  container.replaceChildren(...build(form.schema, []));
  for (const u of updaters) u();

  return {
    setConfig(next) {
      config = next;
      for (const u of updaters) u();
    },
  };
}
