// Inline SVG icons from the sprite at /img/icons.svg.
export const icon = (name, cls = '') => `<svg class="i ${cls}" aria-hidden="true"><use href="/img/icons.svg#${name}"></use></svg>`;
