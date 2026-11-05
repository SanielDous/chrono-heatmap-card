// Stand-ins for what Home Assistant provides around a card: <ha-card> and the theme CSS variables.

class HaCardShim extends HTMLElement {
  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>
      :host {
        display: block;
        background: var(--ha-card-background, var(--card-background-color, #fff));
        border-radius: var(--ha-card-border-radius, 12px);
        border: var(--ha-card-border-width, 1px) solid var(--ha-card-border-color, var(--divider-color, #e0e0e0));
        box-shadow: var(--ha-card-box-shadow, none);
        color: var(--primary-text-color);
        transition: all 0.3s ease-out;
        position: relative;
      }
    </style><slot></slot>`;
  }
}

if (!customElements.get('ha-card')) customElements.define('ha-card', HaCardShim);

/** Approximation of HA's default theme (light + dark). */
export const THEME_CSS = `
  :root {
    color-scheme: light;
    --primary-color: #009ac7;
    --accent-color: #ff9800;
    --primary-background-color: #fafafa;
    --secondary-background-color: #e5e5e5;
    --card-background-color: #ffffff;
    --primary-text-color: #212121;
    --secondary-text-color: #727272;
    --disabled-text-color: #bdbdbd;
    --divider-color: rgba(0, 0, 0, 0.12);
    --warning-color: #ffa600;
    --ha-card-border-radius: 12px;
    --ha-card-header-font-size: 1.25rem;
    font-family: Roboto, 'Noto Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }
  :root[data-theme='dark'] {
    color-scheme: dark;
    --primary-color: #009ac7;
    --primary-background-color: #111111;
    --secondary-background-color: #282828;
    --card-background-color: #1c1c1c;
    --primary-text-color: #e1e1e1;
    --secondary-text-color: #9b9b9b;
    --disabled-text-color: #6f6f6f;
    --divider-color: rgba(225, 225, 225, 0.12);
  }
`;
