// Minimal typings for the parts of the Home Assistant frontend `hass` object this card uses.

export interface HassEntity {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown> & {
    friendly_name?: string;
    unit_of_measurement?: string;
    device_class?: string;
    state_class?: string;
  };
  last_changed: string;
  last_updated: string;
}

export interface HassLocale {
  language: string;
  number_format?: string;
  time_format?: string;
  /** "local" = browser time zone, "server" = HA server time zone */
  time_zone?: 'local' | 'server' | string;
  /** "language" | "monday" | ... | "sunday" */
  first_weekday?: string;
}

export interface HomeAssistant {
  states: Record<string, HassEntity>;
  language?: string;
  locale: HassLocale;
  config: { time_zone: string; unit_system?: { temperature?: string } };
  themes?: { darkMode?: boolean };
  callWS<T>(msg: Record<string, unknown>): Promise<T>;
  formatEntityName?: (stateObj: HassEntity) => string;
}
