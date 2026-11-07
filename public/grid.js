// AG Grid wrappers: one Midnight Cobalt theme, three tables (Preflight, Payouts, Rules).
import { esc, pill, DECISION_LABEL, statusPill, money } from './util.js';
import { threadModel } from './thread.js';

const AG = window.agGrid;
if (AG.ModuleRegistry && AG.AllCommunityModule) AG.ModuleRegistry.registerModules([AG.AllCommunityModule]);

export const theme = AG.themeQuartz.withParams({
  fontFamily: "'Inter', system-ui, sans-serif",
  foregroundColor: '#001435',
  textColor: '#001435',
  subtleTextColor: '#545D68',
  backgroundColor: '#FFFFFF',
  headerBackgroundColor: '#F5F7FA',
  headerTextColor: '#545D68',
  headerFontWeight: 600,
  headerFontSize: 11.5,
  oddRowBackgroundColor: '#FFFFFF',
  rowHoverColor: '#F1F6FD',
  selectedRowBackgroundColor: '#E6F0FB',
  borderColor: '#D9DEE5',
  rowBorder: { color: '#EAEDF1' },
  columnBorder: false,
  accentColor: '#0070E0',
  checkboxCheckedBackgroundColor: '#0070E0',
  inputFocusBorder: { color: '#0070E0' },
  wrapperBorder: false,
  wrapperBorderRadius: 0,
  rowHeight: 52,
  headerHeight: 44,
  fontSize: 14,
  spacing: 6,
  cellHorizontalPadding: 12,
});

// micro-thread: six dots, coloured by state, cut where the route stops
const DOT = { pass: '#0070E0', note: '#0070E0', live: '#0070E0', review: '#C58A2C', block: '#C34452', wait: '#CBD5E1', idle: '#CBD5E1', off: 'none' };
export function microThread(row) {
  const m = threadModel(row);
  const res = m.nodes[5];
  const fill = (n) => (n.key === 'result' && n.state === 'pass' ? '#16845B' : DOT[n.state]);
  const lines = m.nodes.slice(0, -1).map((n, i) => {
    const off = m.cut >= 0 && i >= m.cut;
    return `<line x1="${6 + i * 18}" x2="${24 + i * 18}" y1="8" y2="8" stroke="${off ? '#CBD5E1' : ['idle', 'wait'].includes(m.nodes[i + 1].state) ? '#60CDFF' : '#0070E0'}" ${off || ['idle', 'wait'].includes(m.nodes[i + 1].state) ? 'stroke-dasharray="2 3"' : ''}/>`;
  }).join('');
  const dots = m.nodes.map((n, i) => `<circle cx="${6 + i * 18}" cy="8" r="${n.state === 'block' ? 4.5 : 3.6}" fill="${fill(n)}" stroke="${n.state === 'off' ? '#CBD5E1' : fill(n)}" ${n.state === 'off' ? 'stroke-dasharray="1.5 1.5"' : ''}/>`).join('');
  const word = m.cut >= 0 ? `Stops at ${m.nodes[m.cut].label}` : res.state !== 'idle' ? `Result ${res.value}` : 'Waiting for PayPal';
  return `<svg class="micro" viewBox="0 0 102 16" role="img" aria-label="${esc(word)}" style="width:102px;height:16px;stroke-width:1.5">${lines}${dots}</svg>`;
}

const firstIssue = (r) => {
  const order = { block: 0, review: 1, note: 2 };
  const x = (r.findings || []).filter((f) => f.severity !== 'pass').sort((a, b) => order[a.severity] - order[b.severity])[0];
  return x ? x.title : 'All published checks passed';
};
const RISK = ['blocked', 'review', 'eligible'];

export function createBatchGrid(el, { onSelect, onEdit, isVisible, autoHeight }) {
  const columnDefs = [
    { headerName: 'Check', field: 'decision', width: 118, pinned: 'left',
      cellRenderer: (p) => pill(p.value, DECISION_LABEL[p.value] || p.value),
      comparator: (a, b) => RISK.indexOf(a) - RISK.indexOf(b) },
    { headerName: 'Thread', colId: 'thread', width: 128, sortable: false, cellRenderer: (p) => microThread(p.data) },
    { headerName: 'Ref', field: 'ref', width: 96, cellClass: 'cell-mono' },
    { headerName: 'Recipient', field: 'name', minWidth: 130, flex: 1, cellRenderer: (p) => esc(p.value || '—') },
    { headerName: 'Receiver', field: 'receiver', minWidth: 170, flex: 1.2, editable: (p) => !p.data.payout,
      cellRenderer: (p) => p.value ? esc(p.value) : '<span class="cell-muted">missing</span>' },
    { headerName: 'Route', colId: 'route', width: 96, cellClass: 'cell-mono', valueGetter: (p) => `${p.data.fromCountry || '??'}→${p.data.country || '??'}` },
    { headerName: 'Amount', colId: 'amount', width: 118, type: 'rightAligned', cellClass: 'cell-mono',
      valueGetter: (p) => money(p.data.amount, p.data.currency),
      comparator: (_a, _b, na, nb) => Number(na.data.amount) - Number(nb.data.amount) },
    { headerName: 'Why', colId: 'issue', minWidth: 180, flex: 1.4, valueGetter: (p) => firstIssue(p.data), tooltipValueGetter: (p) => firstIssue(p.data) },
    { headerName: 'Approve', field: 'approved', width: 98, cellDataType: 'boolean',
      editable: (p) => p.data.decision === 'eligible' && !p.data.payout,
      cellRenderer: (p) => {
        if (p.data.payout) return '<span class="cell-muted">Sent</span>';
        if (p.data.decision === 'blocked') return '<span class="cell-muted">—</span>';
        if (p.data.decision === 'review' && !p.data.acknowledged) return '<span class="cell-warn">Confirm</span>';
        return p.value ? '<span class="tick" aria-label="Approved">✓</span>' : '<span class="cell-muted">No</span>';
      } },
    { headerName: 'PayPal', colId: 'paypal', width: 118, valueGetter: (p) => p.data.payout?.status || '',
      cellRenderer: (p) => p.value ? statusPill(p.value) + (p.data.payout.demo ? ' <span class="st demo">Demo</span>' : '') : '<span class="cell-muted">—</span>' },
  ];
  const api = AG.createGrid(el, {
    theme, columnDefs, rowData: [],
    domLayout: autoHeight ? 'autoHeight' : 'normal',
    defaultColDef: { sortable: true, resizable: true, suppressHeaderMenuButton: true },
    getRowId: (p) => p.data.ref,
    rowSelection: { mode: 'singleRow', checkboxes: false, enableClickSelection: true },
    singleClickEdit: true, stopEditingWhenCellsLoseFocus: true, animateRows: true,
    tooltipShowDelay: 400,
    quickFilterText: '',
    isExternalFilterPresent: () => true,
    doesExternalFilterPass: (n) => isVisible(n.data),
    onSelectionChanged: (e) => { const r = e.api.getSelectedRows()[0]; if (r) onSelect(r.ref); },
    onCellValueChanged: (e) => { if (e.oldValue !== e.newValue) onEdit(e.data.ref, { [e.colDef.field]: e.newValue }); },
    overlayNoRowsTemplate: '<span class="cell-muted">No rows match this filter.</span>',
  });
  return {
    api,
    setRows(rows, selected) { api.setGridOption('rowData', rows); if (selected) api.getRowNode(selected)?.setSelected(true, true); },
    refilter: () => api.onFilterChanged(),
    search: (q) => api.setGridOption('quickFilterText', q),
    layout: (auto) => api.setGridOption('domLayout', auto ? 'autoHeight' : 'normal'),
  };
}

export function createRulesGrid(el, { onSelect, kind }) {
  const yes = (v, a = 'Yes', b = 'No') => (v ? pill('eligible', a) : pill('blocked', b));
  const country = [
    { headerName: 'Country', field: 'name', flex: 1.2, minWidth: 150 },
    { headerName: 'Code', field: 'code', width: 80, cellClass: 'cell-mono' },
    { headerName: 'Feature', field: 'featureSet', flex: 1.4, minWidth: 190 },
    { headerName: 'Send', field: 'canSendPayouts', width: 96, cellRenderer: (p) => yes(p.value) },
    { headerName: 'Receive', field: 'canReceivePayouts', width: 104, cellRenderer: (p) => yes(p.value) },
    { headerName: 'Conversion', field: 'automaticConversion', width: 140, cellRenderer: (p) => p.value === 'Available' ? pill('eligible', 'Automatic') : pill('review', 'Excluded') },
    { headerName: 'Local', field: 'localCurrency', width: 92, cellClass: 'cell-mono', valueFormatter: (p) => p.value || '—' },
  ];
  const currency = [
    { headerName: 'Currency', field: 'name', flex: 1.2, minWidth: 170 },
    { headerName: 'Code', field: 'code', width: 80, cellClass: 'cell-mono' },
    { headerName: 'Payment', field: 'payment', width: 106, cellRenderer: (p) => yes(p.value) },
    { headerName: 'Conversion', field: 'autoConvert', width: 124, cellRenderer: (p) => yes(p.value, 'Automatic', 'None') },
    { headerName: 'Decimals', field: 'decimals', width: 108, cellRenderer: (p) => (p.value ? '<span class="cell-mono">0.00</span>' : pill('review', 'Whole')) },
    { headerName: 'Scope', field: 'inCountryOnly', flex: 1, minWidth: 140, valueFormatter: (p) => (p.value ? `In ${p.value} only` : 'Cross-border') },
  ];
  return AG.createGrid(el, {
    theme, rowData: [], domLayout: 'normal',
    defaultColDef: { sortable: true, resizable: true, suppressHeaderMenuButton: true },
    rowSelection: { mode: 'singleRow', checkboxes: false, enableClickSelection: true },
    getRowId: (p) => p.data.code,
    onSelectionChanged: (e) => { const r = e.api.getSelectedRows()[0]; if (r) onSelect(r); },
    columnDefs: kind === 'currency' ? currency : country,
  });
}
