import type { CardConfig } from '../src/config';

export interface GalleryItem {
  id: string;
  config: Omit<CardConfig, 'type'>;
  /** sections-grid width in columns (12 = full section) */
  wide?: boolean;
}

export const GALLERY: GalleryItem[] = [
  {
    id: 'day-hour-temperature',
    config: { entity: 'sensor.outdoor_temperature', title: 'Outdoor · days × hours' },
  },
  {
    id: 'hour-5min-power',
    config: { entity: 'sensor.house_power', title: 'Power · hours × 5 min', row_unit: 'hour' },
  },
  {
    id: 'hour-minute-power',
    config: {
      entity: 'sensor.house_power',
      title: 'Power · hours × minutes',
      row_unit: 'hour',
      column_unit: 'minute',
      rows: 6,
      scale: { preset: 'mono' },
    },
  },
  {
    id: 'week-day-energy',
    config: {
      entity: 'sensor.house_energy',
      title: 'Energy · weeks × days',
      row_unit: 'week',
      scale: { preset: 'mono' },
    },
  },
  {
    id: 'week-hour-energy',
    config: {
      entity: 'sensor.house_energy',
      title: 'Energy · weeks × hours',
      row_unit: 'week',
      column_unit: 'hour',
      rows: 4,
    },
  },
  {
    id: 'month-day-temperature',
    config: {
      entity: 'sensor.outdoor_temperature',
      title: 'Outdoor · months × days',
      row_unit: 'month',
      rows: 12,
    },
  },
  {
    id: 'year-month-temperature',
    config: {
      entity: 'sensor.outdoor_temperature',
      title: 'Outdoor · years × months',
      row_unit: 'year',
      rows: 3,
    },
  },
  {
    id: 'year-week-energy',
    config: {
      entity: 'sensor.house_energy',
      title: 'Energy · years × weeks',
      row_unit: 'year',
      column_unit: 'week',
      rows: 3,
    },
  },
  {
    id: 'day-hour-door',
    config: { entity: 'binary_sensor.front_door', title: 'Front door · share open', rows: 10 },
  },
  {
    id: 'vertical-co2',
    config: {
      entity: 'sensor.office_co2',
      title: 'CO₂ with gaps · vertical',
      orientation: 'vertical',
      rows: 10,
      scale: {
        steps: [
          { value: 400, color: '#1a9850' },
          { value: 800, color: '#fee08b' },
          { value: 1200, color: '#d73027' },
        ],
      },
    },
  },
  {
    id: 'day-hour-co2',
    config: {
      entity: 'sensor.office_co2',
      title: 'Office CO₂ · automatic scale',
      rows: 7,
    },
  },
  {
    id: 'day-hour-humidity',
    config: { entity: 'sensor.bathroom_humidity', title: 'Bathroom humidity', rows: 7 },
  },
  {
    id: 'day-hour-battery',
    config: { entity: 'sensor.phone_battery', title: 'Phone battery · reversed traffic light', rows: 7 },
  },
  {
    id: 'no-labels',
    config: {
      entity: 'sensor.outdoor_temperature',
      title: 'Minimal',
      rows: 7,
      show_labels: false,
      show_legend: false,
    },
  },
  {
    id: 'missing-entity',
    config: { entity: 'sensor.does_not_exist', title: 'Missing entity' },
  },
];
