// Devpost-style list scaffolding: filter sidebar with checkboxes + counts, search pill, sort, result count.
import { $, $$, esc, SEARCH_ICON } from './util.js';

// rotating a tablet or resizing a window across the breakpoint opens/closes the filter panel to match
const WIDE = matchMedia('(min-width: 901px)');
WIDE.addEventListener('change', (e) => $$('.f-wrap').forEach((d) => { d.open = e.matches; }));

export function listShell({ id, sortOptions = [], placeholder = 'Search', tools = '' }) {
  // phones get a collapsed "Filters" toggle so the list itself is on screen first; wider screens keep the sidebar open
  return `<div class="wrap body"><div class="dp">
    <details class="f-wrap" id="${id}-fw" ${WIDE.matches ? 'open' : ''}><summary class="f-sum">Filters<b class="f-n" id="${id}-fn"></b></summary>
    <aside class="filters" id="${id}-f" aria-label="Filters"></aside></details>
    <section class="dp-main">
      <div class="dp-top"><label class="search">${SEARCH_ICON}<input type="search" id="${id}-q" placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}"></label>
        ${sortOptions.length ? `<label class="sort"><span>Sort</span><select id="${id}-s">${sortOptions.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>` : ''}${tools}</div>
      <p class="dp-count" id="${id}-n"></p>
      <div class="cards" id="${id}-l"></div>
    </section></div></div>`;
}

// groups: [{ key, label, options: [{ v, label, n }] }]  state: { key: Set }
export function renderFilters(box, groups, state, onChange) {
  box.innerHTML = groups.map((g) => `<fieldset><legend>${esc(g.label)}</legend>${g.options.map((o) => `
    <label class="chk"><input type="checkbox" data-g="${esc(g.key)}" value="${esc(o.v)}" ${state[g.key]?.has(o.v) ? 'checked' : ''}><span>${esc(o.label)}</span><b>${o.n}</b></label>`).join('')}</fieldset>`).join('')
    + (Object.values(state).some((s) => s.size) ? '<button class="link clear" type="button">Clear</button>' : '');
  const active = Object.values(state).reduce((n, s) => n + s.size, 0), badge = box.closest('details')?.querySelector('.f-n');
  if (badge) badge.textContent = active ? String(active) : '';
  $$('input', box).forEach((i) => i.addEventListener('change', () => {
    const s = (state[i.dataset.g] ||= new Set());
    i.checked ? s.add(i.value) : s.delete(i.value);
    onChange();
  }));
  $('.clear', box)?.addEventListener('click', () => { for (const k in state) state[k].clear(); onChange(); });
}
export const passes = (state, item, get) => Object.entries(state).every(([k, s]) => !s.size || s.has(String(get(item, k))));
export const tally = (xs, f) => xs.reduce((m, x) => { const k = String(f(x)); m[k] = (m[k] || 0) + 1; return m; }, {});
