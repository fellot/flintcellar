// Flint Cellar SPA

const STORAGE_KEY = 'flintCellarStateV1';
const INIT_FLAG = 'initializedFromJsonV1';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** State persisted in localStorage
 * {
 *   initializedFromJsonV1: true,
 *   adjustments: { [id]: number }, // bottles consumed count
 *   logs: [ { id, bottle, date, rating, notes, quantity } ],
 *   freeNotes: [ { id: 'note-...', date, title, notes } ]
 * }
 */
let wines = [];
let state = {
  [INIT_FLAG]: false,
  adjustments: {},
  logs: [],
  freeNotes: [],
};

async function loadWines() {
  const res = await fetch('wines.json');
  if (!res.ok) throw new Error('Failed to load wines.json');
  return res.json();
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      state = { [INIT_FLAG]: false, adjustments: {}, logs: [], freeNotes: [], ...parsed };
    }
  } catch (e) {
    console.warn('Failed to parse saved state; resetting.');
    localStorage.removeItem(STORAGE_KEY);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function todayISO() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function getRemainingMap() {
  const map = {};
  for (const w of wines) {
    const consumed = state.adjustments[w.id] || 0;
    map[w.id] = Math.max(0, (w.quantity ?? 1) - consumed);
  }
  return map;
}

function initConsumedFromJsonOnce() {
  if (state[INIT_FLAG]) return;
  let changed = false;
  for (const w of wines) {
    if (w.status === 'consumed') {
      const qty = w.quantity ?? 1;
      if ((state.adjustments[w.id] || 0) < qty) {
        state.adjustments[w.id] = qty;
        state.logs.push({
          id: w.id,
          bottle: w.bottle,
          date: w.consumedDate || todayISO(),
          rating: w.rating || null,
          notes: w.notes || '',
          quantity: qty,
        });
        changed = true;
      }
    }
  }
  state[INIT_FLAG] = true;
  if (changed) saveState();
}

function uniqueValues(field) {
  return Array.from(new Set(wines.map(w => (w[field] || '').trim()).filter(Boolean))).sort((a,b)=>a.localeCompare(b));
}

function renderFilters() {
  const styles = uniqueValues('style');
  const countries = uniqueValues('country');
  const locations = uniqueValues('location');

  function fill(containerId, values, key) {
    const el = document.getElementById(containerId);
    el.innerHTML = '';
    for (const v of values) {
      const id = `${key}-${v.replace(/\W+/g, '_')}`;
      const wrap = document.createElement('label');
      wrap.innerHTML = `<input type="checkbox" value="${v}"> ${v}`;
      el.appendChild(wrap);
    }
  }
  fill('filterStyle', styles, 'style');
  fill('filterCountry', countries, 'country');
  fill('filterLocation', locations, 'location');
}

function getActiveFilters() {
  const style = $$('#filterStyle input:checked').map(i => i.value);
  const country = $$('#filterCountry input:checked').map(i => i.value);
  const location = $$('#filterLocation input:checked').map(i => i.value);
  const onlyInCellar = $('#onlyInCellar').checked;
  const onlyHaveQty = $('#onlyHaveQty').checked;
  const query = ($('#search').value || '').trim().toLowerCase();
  const sortBy = $('#sortBy').value;
  return { style, country, location, onlyInCellar, onlyHaveQty, query, sortBy };
}

function cardTag(text) {
  const span = document.createElement('span');
  span.className = 'tag';
  span.textContent = text;
  return span;
}

function sortWines(list, sortBy) {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const cmp = (a,b,field) => collator.compare(String(a[field] ?? ''), String(b[field] ?? ''));
  switch (sortBy) {
    case 'name': return list.sort((a,b)=>cmp(a,b,'bottle'));
    case 'vintage': return list.sort((a,b)=> (a.vintage??0)-(b.vintage??0));
    case 'peakYear': return list.sort((a,b)=> (a.peakYear??0)-(b.peakYear??0));
    case 'country': return list.sort((a,b)=>cmp(a,b,'country'));
    case 'style': return list.sort((a,b)=>cmp(a,b,'style'));
    case 'location':
    default:
      return list.sort((a,b)=>cmp(a,b,'location'));
  }
}

function renderStats(filtered, remainingMap) {
  const totalInCellar = wines.reduce((acc, w) => acc + (remainingMap[w.id] || 0), 0);
  const inView = filtered.reduce((acc, w) => acc + (remainingMap[w.id] || 0), 0);
  const byStyle = filtered.reduce((m,w)=>{ const r=(remainingMap[w.id]||0); if(!r) return m; m[w.style]= (m[w.style]||0)+r; return m;},{});
  const bits = [`Total in cellar: ${totalInCellar}`, `In view: ${inView}`];
  const styleBits = Object.entries(byStyle).sort().map(([k,v])=>`${k}: ${v}`);
  $('#stats').textContent = `${bits.join(' • ')}${styleBits.length? ' • '+styleBits.join(' | '): ''}`;
}

function renderGrid() {
  const grid = $('#grid');
  grid.innerHTML = '';
  const remainingMap = getRemainingMap();
  const f = getActiveFilters();
  const q = f.query;
  let list = wines.filter(w => {
    const remaining = remainingMap[w.id] || 0;
    if (f.onlyHaveQty && remaining <= 0) return false;
    if (f.onlyInCellar && (remaining <= 0)) return false;
    if (f.style.length && !f.style.includes(w.style)) return false;
    if (f.country.length && !f.country.includes(w.country)) return false;
    if (f.location.length && !f.location.includes(w.location)) return false;
    if (q) {
      const hay = [w.bottle, w.grapes, w.country, w.region, w.style, w.location].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  list = sortWines(list, f.sortBy);

  for (const w of list) {
    const t = document.getElementById('wineCardTmpl');
    const node = t.content.firstElementChild.cloneNode(true);
    // Style accent by wine style
    if (w.style) node.dataset.style = w.style;
    const remaining = remainingMap[w.id] || 0;
    const thumb = $('.thumb', node);
    thumb.src = w.bottle_image || '';
    thumb.alt = `${w.bottle} image`;
    $('.qty-badge', node).textContent = `x${remaining}`;
    $('.title', node).textContent = `${w.bottle} (${w.vintage ?? 'NV'})`;
    const meta = $('.meta', node);
    meta.textContent = `${w.country} • ${w.region} • ${w.style} • Peak ${w.peakYear ?? '–'} • ${w.drinkingWindow ?? ''}`;
    const tags = $('.tags', node);
    tags.append(
      cardTag(w.style || 'Style'),
      cardTag(w.grapes || 'Unknown grapes'),
      cardTag(w.location || 'No location'),
    );
    const consumeBtn = $('.consume', node);
    consumeBtn.disabled = remaining <= 0;
    consumeBtn.addEventListener('click', () => openConsumeModal(w, remaining));
    $('.details', node).addEventListener('click', () => openDetailsModal(w, remaining));
    grid.appendChild(node);
  }

  renderStats(list, remainingMap);
  if (list.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No wines match your filters. Try clearing search or toggles.';
    grid.appendChild(empty);
  }
}

function setStars(container, value, onChange) {
  container.innerHTML = '';
  for (let i = 1; i <= 5; i++) {
    const s = document.createElement('span');
    s.className = 'star' + (i <= (value||0) ? ' active' : '');
    s.textContent = '★';
    s.addEventListener('click', () => onChange(i));
    container.appendChild(s);
  }
}

function openModal(title, bodyBuilder, footerBuilder) {
  const dialog = $('#modal');
  $('#modalTitle').textContent = title;
  const body = $('#modalBody');
  const footer = $('#modalFooter');
  body.innerHTML = '';
  footer.innerHTML = '';
  bodyBuilder(body);
  footerBuilder(footer);
  dialog.showModal();
}

function closeModal() {
  $('#modal').close();
}

$('#modalClose')?.addEventListener('click', closeModal);

function openConsumeModal(w, remaining) {
  let quantity = Math.min(1, remaining || 1);
  let date = todayISO();
  let rating = null;
  let notes = '';

  openModal(`Consume: ${w.bottle} (${w.vintage ?? 'NV'})`, (body) => {
    const wrap = document.createElement('div');
    wrap.className = 'form-grid';
    wrap.innerHTML = `
      <label>Quantity
        <input id="c-qty" type="number" min="1" max="${Math.max(1, remaining)}" step="1" value="${quantity}" />
      </label>
      <label>Date
        <input id="c-date" type="date" value="${date}" />
      </label>
      <label>Rating
        <div id="c-stars" class="stars" role="slider" aria-valuemin="0" aria-valuemax="5" aria-valuenow="0"></div>
      </label>
      <label style="grid-column: 1/-1">Notes
        <textarea id="c-notes" rows="5" placeholder="Tasting impressions, food pairing, occasion..."></textarea>
      </label>
    `;
    body.appendChild(wrap);

    const qtyInput = $('#c-qty');
    qtyInput.addEventListener('input', () => {
      const v = Number(qtyInput.value || '1');
      if (Number.isFinite(v)) quantity = Math.max(1, Math.min(remaining || 1, v));
    });
    const dateInput = $('#c-date');
    dateInput.addEventListener('change', () => date = dateInput.value || todayISO());
    const notesEl = $('#c-notes');
    notesEl.addEventListener('input', () => notes = notesEl.value);
    const starsEl = $('#c-stars');
    setStars(starsEl, rating, (v) => { rating = v; setStars(starsEl, rating, () => {}); });
  }, (footer) => {
    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', () => {
      addConsumptionLog(w, { date, rating, notes, quantity: quantity || 1 });
      closeModal();
    });
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn outline';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', closeModal);
    footer.append(cancelBtn, saveBtn);
  });
}

function openDetailsModal(w, remaining) {
  openModal(`${w.bottle} (${w.vintage ?? 'NV'})`, (body) => {
    const left = Math.max(0, remaining || 0);
    const div = document.createElement('div');
    div.innerHTML = `
      <div style="display:grid;grid-template-columns:120px 1fr;gap:12px;align-items:start">
        <img src="${w.bottle_image || ''}" alt="${w.bottle}" class="thumb" style="height:160px"/>
        <div>
          <div><strong>Country:</strong> ${w.country || ''}</div>
          <div><strong>Region:</strong> ${w.region || ''}</div>
          <div><strong>Style:</strong> ${w.style || ''}</div>
          <div><strong>Grapes:</strong> ${w.grapes || ''}</div>
          <div><strong>Vintage:</strong> ${w.vintage ?? 'NV'}</div>
          <div><strong>Location:</strong> ${w.location || ''}</div>
          <div><strong>Drinking window:</strong> ${w.drinkingWindow || ''}</div>
          <div><strong>Peak year:</strong> ${w.peakYear ?? ''}</div>
          <div><strong>Remaining:</strong> ${left}</div>
          ${w.technical_sheet ? `<div><a href="${w.technical_sheet}" target="_blank" rel="noopener">Technical sheet ↗</a></div>` : ''}
        </div>
      </div>
      <div style="margin-top:8px">
        <div><strong>Food pairing:</strong> ${w.foodPairingNotes || ''}</div>
        <div><strong>Meal idea:</strong> ${w.mealToHaveWithThisWine || ''}</div>
      </div>
    `;
    body.appendChild(div);
  }, (footer) => {
    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn';
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', closeModal);
    footer.append(closeBtn);
  });
}

function addConsumptionLog(w, { date, rating, notes, quantity }) {
  const q = Math.max(1, Math.min((getRemainingMap()[w.id] || 1), quantity || 1));
  state.logs.push({ id: w.id, bottle: w.bottle, date: date || todayISO(), rating: rating ?? null, notes: notes || '', quantity: q });
  state.adjustments[w.id] = (state.adjustments[w.id] || 0) + q;
  saveState();
  renderGrid();
  renderJournal();
}

function renderJournal() {
  const list = $('#journalList');
  list.innerHTML = '';
  const itemsLogs = state.logs.map(l => ({ kind: 'log', ...l }));
  const itemsNotes = (state.freeNotes || []).map(n => ({ kind: 'note', ...n }));
  const items = [...itemsLogs, ...itemsNotes].sort((a,b)=> (b.date||'').localeCompare(a.date||''));
  for (const log of items) {
    if (log.kind === 'note') {
      const art = document.createElement('article');
      art.className = 'entry';
      const icon = document.createElement('div');
      icon.className = 'thumb';
      icon.style.display = 'grid';
      icon.style.placeItems = 'center';
      icon.style.fontSize = '24px';
      icon.textContent = '✎';
      const info = document.createElement('div');
      info.className = 'info';
      const title = document.createElement('div');
      title.innerHTML = `<strong>${log.title || 'Note'}</strong>`;
      const details = document.createElement('div');
      details.textContent = `${log.date}`;
      const note = document.createElement('div');
      note.style.color = 'var(--muted)';
      note.textContent = log.notes || '';
      info.append(title, details, note);
      const actions = document.createElement('div');
      actions.className = 'actions';
      const delBtn = document.createElement('button');
      delBtn.className = 'btn';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', () => {
        const idx = state.freeNotes.findIndex(x => x.id === log.id);
        if (idx >= 0) { state.freeNotes.splice(idx, 1); saveState(); renderJournal(); }
      });
      actions.append(delBtn);
      art.append(icon, info, actions);
      list.appendChild(art);
      continue;
    }
    const w = wines.find(x => x.id === log.id);
    const art = document.createElement('article');
    art.className = 'entry';
    if (w?.style) art.dataset.style = w.style;
    const img = document.createElement('img');
    img.className = 'thumb';
    img.src = w?.bottle_image || '';
    img.alt = w?.bottle || log.bottle;
    const info = document.createElement('div');
    info.className = 'info';
    const title = document.createElement('div');
    title.innerHTML = `<strong>${log.bottle}</strong> ${w?.vintage ?? ''} — <span title="quantity">x${log.quantity || 1}</span>`;
    const details = document.createElement('div');
    const stars = Number(log.rating || 0);
    const starStr = stars ? '★'.repeat(stars) : '';
    details.textContent = `${log.date}${starStr ? ' • ' + starStr : ''}`;
    const note = document.createElement('div');
    note.style.color = 'var(--muted)';
    note.textContent = log.notes || '';
    info.append(title, details, note);
    const actions = document.createElement('div');
    actions.className = 'actions';
    const editBtn = document.createElement('button');
    editBtn.className = 'btn outline';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => openEditLogModal(log));
    const delBtn = document.createElement('button');
    delBtn.className = 'btn';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', () => deleteLog(log));
    actions.append(editBtn, delBtn);
    art.append(img, info, actions);
    list.appendChild(art);
  }
}

function openEditLogModal(log) {
  let date = log.date || todayISO();
  let rating = log.rating || null;
  let notes = log.notes || '';
  let quantity = log.quantity || 1;
  const wine = wines.find(w => w.id === log.id);
  const maxQty = (wine?.quantity ?? 1) - ((state.adjustments[log.id] || 0) - (log.quantity || 1));

  openModal(`Edit log: ${log.bottle}`, (body) => {
    const wrap = document.createElement('div');
    wrap.className = 'form-grid';
    wrap.innerHTML = `
      <label>Quantity
        <input id="e-qty" type="number" min="1" max="${Math.max(1, maxQty)}" step="1" value="${quantity}" />
      </label>
      <label>Date
        <input id="e-date" type="date" value="${date}" />
      </label>
      <label>Rating
        <div id="e-stars" class="stars"></div>
      </label>
      <label style="grid-column: 1/-1">Notes
        <textarea id="e-notes" rows="5"></textarea>
      </label>
    `;
    body.appendChild(wrap);
    $('#e-notes').value = notes;
    $('#e-notes').addEventListener('input', () => notes = $('#e-notes').value);
    $('#e-date').addEventListener('change', () => date = $('#e-date').value);
    const qtyInput = $('#e-qty');
    qtyInput.addEventListener('input', () => {
      const v = Number(qtyInput.value || '1');
      if (Number.isFinite(v)) quantity = Math.max(1, Math.min(maxQty, v));
    });
    setStars($('#e-stars'), rating, (v)=>{ rating = v; setStars($('#e-stars'), rating, ()=>{}); });
  }, (footer) => {
    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', () => {
      applyEditLog(log, { date, rating, notes, quantity });
      closeModal();
    });
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn outline';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', closeModal);
    footer.append(cancelBtn, saveBtn);
  });
}

function applyEditLog(log, changes) {
  // Adjust adjustments by delta quantity
  const oldQty = log.quantity || 1;
  const newQty = Math.max(1, changes.quantity || 1);
  const delta = newQty - oldQty;
  state.adjustments[log.id] = Math.max(0, (state.adjustments[log.id] || 0) + delta);
  Object.assign(log, { ...changes, quantity: newQty });
  saveState();
  renderGrid();
  renderJournal();
}

function deleteLog(log) {
  // Return quantity to cellar
  const idx = state.logs.indexOf(log);
  if (idx >= 0) {
    state.logs.splice(idx, 1);
    state.adjustments[log.id] = Math.max(0, (state.adjustments[log.id] || 0) - (log.quantity || 1));
    saveState();
    renderGrid();
    renderJournal();
  }
}

function openNewFreeNoteModal() {
  let title = '';
  let date = todayISO();
  let notes = '';
  openModal('New Journal Note', (body) => {
    const wrap = document.createElement('div');
    wrap.className = 'form-grid';
    wrap.innerHTML = `
      <label>Title
        <input id="n-title" type="text" placeholder="Occasion, theme, etc." />
      </label>
      <label>Date
        <input id="n-date" type="date" value="${date}" />
      </label>
      <label style="grid-column:1/-1">Notes
        <textarea id="n-notes" rows="6" placeholder="Notes not tied to a single bottle..."></textarea>
      </label>
    `;
    body.appendChild(wrap);
    $('#n-title').addEventListener('input', () => title = $('#n-title').value);
    $('#n-date').addEventListener('change', () => date = $('#n-date').value);
    $('#n-notes').addEventListener('input', () => notes = $('#n-notes').value);
  }, (footer) => {
    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', () => {
      const id = `note-${Date.now()}`;
      state.freeNotes.push({ id, title, date, notes });
      saveState();
      closeModal();
      renderJournal();
    });
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn outline';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', closeModal);
    footer.append(cancelBtn, saveBtn);
  });
}

function attachEvents() {
  // Tabs
  $$('.tab').forEach(tab => tab.addEventListener('click', () => {
    $$('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const target = tab.dataset.tab;
    $$('.view').forEach(v => v.classList.remove('active'));
    if (target === 'cellar') $('#cellarView').classList.add('active');
    else $('#journalView').classList.add('active');
  }));

  // Controls
  ['keyup','change','input'].forEach(evt => {
    $('#search').addEventListener(evt, renderGrid);
    $('#sortBy').addEventListener(evt, renderGrid);
    $('#onlyInCellar').addEventListener(evt, renderGrid);
    $('#onlyHaveQty').addEventListener(evt, renderGrid);
  });
  $('#search').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.target.value=''; renderGrid(); } });
  document.addEventListener('keydown', (e) => { if (e.key === '/') { e.preventDefault(); $('#search').focus(); } });

  // Dynamic filter checkboxes
  $('#cellarView').addEventListener('change', (e) => {
    if (e.target.matches('#filterStyle input, #filterCountry input, #filterLocation input')) {
      renderGrid();
    }
  });

  // Export/Reset
  $('#exportStateBtn').addEventListener('click', () => {
    const payload = JSON.stringify(state, null, 2);
    navigator.clipboard?.writeText(payload).catch(()=>{});
    openModal('Export State', (body) => {
      const pre = document.createElement('pre');
      pre.style.whiteSpace = 'pre-wrap';
      pre.textContent = payload;
      body.appendChild(pre);
    }, (footer) => {
      const closeBtn = document.createElement('button');
      closeBtn.className = 'btn';
      closeBtn.textContent = 'Close';
      closeBtn.addEventListener('click', closeModal);
      footer.append(closeBtn);
    });
  });
  $('#clearStateBtn').addEventListener('click', () => {
    openModal('Reset local data?', (body) => {
      const p = document.createElement('p');
      p.textContent = 'This clears local changes (consumption logs). wines.json is untouched.';
      body.appendChild(p);
    }, (footer) => {
      const cancel = document.createElement('button');
      cancel.className = 'btn outline';
      cancel.textContent = 'Cancel';
      cancel.addEventListener('click', closeModal);
      const confirm = document.createElement('button');
      confirm.className = 'btn';
      confirm.textContent = 'Reset';
      confirm.addEventListener('click', () => {
        localStorage.removeItem(STORAGE_KEY);
        state = { [INIT_FLAG]: false, adjustments: {}, logs: [], freeNotes: [] };
        closeModal();
        initConsumedFromJsonOnce();
        renderGrid();
        renderJournal();
      });
      footer.append(cancel, confirm);
    });
  });

  $('#newNoteBtn').addEventListener('click', openNewFreeNoteModal);
}

async function main() {
  loadState();
  wines = await loadWines();
  renderFilters();
  attachEvents();
  initConsumedFromJsonOnce();
  renderGrid();
  renderJournal();
}

main().catch(err => {
  console.error(err);
  const mainEl = document.querySelector('main');
  const div = document.createElement('div');
  div.style.color = 'tomato';
  div.textContent = 'Failed to load wines. See console for details.';
  mainEl.prepend(div);
});
