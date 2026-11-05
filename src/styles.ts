export const STYLES = `
  :host {
    display: block;
    --chm-empty: color-mix(in srgb, var(--primary-text-color, #212121) 9%, transparent);
    --chm-future: color-mix(in srgb, var(--primary-text-color, #212121) 3%, transparent);
  }
  ha-card {
    display: block;
    padding: 12px 16px 16px;
    overflow: hidden;
    height: 100%;
    box-sizing: border-box;
  }
  .header {
    font-size: var(--ha-card-header-font-size, 1.25rem);
    font-weight: 500;
    color: var(--ha-card-header-color, var(--primary-text-color));
    line-height: 1.6;
    margin-bottom: 8px;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .body {
    position: relative;
    width: 100%;
    min-height: 40px;
  }
  svg.grid {
    display: block;
    overflow: visible;
    touch-action: manipulation;
  }
  .cell {
    cursor: pointer;
  }
  .cell.empty {
    fill: var(--chm-empty);
  }
  .cell.future {
    fill: var(--chm-future);
  }
  .cell:hover {
    stroke: var(--primary-text-color, #212121);
    stroke-width: 1;
  }
  .label {
    font-size: 10px;
    fill: var(--secondary-text-color, #727272);
    font-family: inherit;
    user-select: none;
  }
  .tooltip {
    position: absolute;
    transform: translate(-50%, calc(-100% - 6px));
    background: var(--card-background-color, #fff);
    color: var(--primary-text-color, #212121);
    border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
    border-radius: 8px;
    padding: 6px 10px;
    font-size: 12px;
    line-height: 1.4;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    pointer-events: none;
    white-space: nowrap;
    z-index: 2;
  }
  .tooltip[hidden],
  .legend[hidden] {
    display: none;
  }
  .tt-value {
    font-weight: 600;
  }
  .legend {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 10px;
    font-size: 11px;
    color: var(--secondary-text-color, #727272);
  }
  .legend-bar {
    flex: 1;
    height: 8px;
    border-radius: 4px;
  }
  .warning {
    padding: 8px 12px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--warning-color, #ff9800) 15%, transparent);
    color: var(--primary-text-color);
  }
  .loading {
    color: var(--secondary-text-color);
    font-size: 14px;
  }
`;
