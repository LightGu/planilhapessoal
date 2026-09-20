const state = { clients: [], selected: null, works: [], previewUrls: [], editingWorkId: null, view: 'works', calendarDate: new Date(), scheduledWorks: [] };
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, options);
  const data = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || 'Nao foi possivel concluir a operacao.');
  return data;
}

function icon(name) { return `<i data-lucide="${name}"></i>`; }
function refreshIcons() { if (window.lucide) lucide.createIcons(); }
function escapeHtml(value = '') { const node = document.createElement('div'); node.textContent = value; return node.innerHTML; }
function initials(name) { return name.split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase(); }
function formatQuantity(value) { return Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 2 }); }
function parseLocalDate(value) { const [year, month, day] = value.split('-').map(Number); return new Date(year, month - 1, day); }
function formatDate(value, options = { day: '2-digit', month: 'short', year: 'numeric' }) { return parseLocalDate(value).toLocaleDateString('pt-BR', options); }
function formatDateRange(start, end) { return end ? `${formatDate(start)} ate ${formatDate(end)}` : formatDate(start); }
function setBusy(button, busy, label) {
  button.disabled = busy;
  if (busy) { button.dataset.label = button.innerHTML; button.textContent = label; }
  else if (button.dataset.label) button.innerHTML = button.dataset.label;
  refreshIcons();
}
function toast(message, type = '') {
  const item = document.createElement('div'); item.className = `toast ${type}`; item.textContent = message;
  $('#toastRegion').append(item); setTimeout(() => item.remove(), 3500);
}

async function loadClients(selectId) {
  try {
    state.clients = await api('/clients');
    renderClients();
    const target = state.clients.find(c => c.id === selectId) || state.clients.find(c => c.id === state.selected?.id);
    if (target) await selectClient(target);
    else if (!state.selected) renderWelcome();
  } catch (error) { toast(error.message, 'error'); }
}

function renderClients() {
  const query = $('#clientSearch').value.trim().toLocaleLowerCase('pt-BR');
  const clients = state.clients.filter(client => client.name.toLocaleLowerCase('pt-BR').includes(query));
  $('#clientTotal').textContent = `${state.clients.length} ${state.clients.length === 1 ? 'cliente' : 'clientes'}`;
  $('#clientList').innerHTML = clients.length ? clients.map(client => `
    <button class="client-item ${client.id === state.selected?.id ? 'active' : ''}" data-client-id="${client.id}">
      <span class="avatar">${escapeHtml(initials(client.name))}</span><span><strong>${escapeHtml(client.name)}</strong><small>${client.work_count} ${client.work_count === 1 ? 'obra' : 'obras'}</small></span>
    </button>`).join('') : `<div class="sidebar-empty">${query ? 'Nenhum cliente encontrado.' : 'Cadastre o primeiro cliente.'}</div>`;
  $$('.client-item').forEach(button => button.addEventListener('click', () => selectClient(state.clients.find(c => c.id === Number(button.dataset.clientId)))));
}

function renderWelcome() {
  $('#topbarTitle').textContent = 'Visao geral'; $('#newWorkButton').hidden = true;
  $('#mainArea').innerHTML = `<div class="empty-state"><div class="empty-state-inner"><span class="empty-icon">${icon('hard-hat')}</span><span class="eyebrow">CONTROLE EM UM SO LUGAR</span><h1>Organize clientes, obras e materiais</h1><p>Selecione um cliente na lateral ou crie o primeiro cadastro para comecar.</p><button class="primary-button" id="welcomeAdd">${icon('user-plus')}Adicionar cliente</button></div></div>`;
  $('#welcomeAdd').addEventListener('click', openClientDialog); refreshIcons();
}

async function selectClient(client) {
  state.selected = client; state.view = 'works'; updateViewTabs(); renderClients(); $('#sidebar').classList.remove('open');
  $('#topbarTitle').textContent = client.name; $('#newWorkButton').hidden = false;
  $('#mainArea').innerHTML = `<div class="works-grid"><div class="skeleton"></div><div class="skeleton"></div></div>`;
  try { state.works = await api(`/clients/${client.id}/works`); renderWorks(); }
  catch (error) { toast(error.message, 'error'); }
}

function renderWorks() {
  const client = state.selected;
  const materialCount = state.works.reduce((sum, work) => sum + work.materials.length, 0);
  $('#mainArea').innerHTML = `
    <div class="client-hero"><div><span class="eyebrow">CLIENTE</span><h1>${escapeHtml(client.name)}</h1><p>Acompanhe as obras e referencias de custo.</p><div class="stats"><div class="stat"><strong>${state.works.length}</strong><span>${state.works.length === 1 ? 'obra' : 'obras'}</span></div><div class="stat"><strong>${materialCount}</strong><span>${materialCount === 1 ? 'material' : 'materiais'}</span></div></div></div><div class="hero-actions"><button class="danger-button small" id="deleteClient">${icon('trash-2')}Excluir</button><button class="primary-button" id="heroAddWork">${icon('plus')}Nova obra</button></div></div>
    ${state.works.length ? `<div class="works-grid">${state.works.map(workTemplate).join('')}</div>` : `<div class="empty-state" style="min-height:340px"><div class="empty-state-inner"><span class="empty-icon">${icon('clipboard-list')}</span><h1>Nenhuma obra ainda</h1><p>Cadastre a primeira obra de ${escapeHtml(client.name)} e inclua materiais ou imagens.</p><button class="primary-button" id="emptyAddWork">${icon('plus')}Cadastrar obra</button></div></div>`}`;
  $('#heroAddWork')?.addEventListener('click', () => openWorkDialog()); $('#emptyAddWork')?.addEventListener('click', () => openWorkDialog());
  $('#deleteClient').addEventListener('click', deleteClient);
  $$('.delete-work').forEach(button => button.addEventListener('click', () => deleteWork(Number(button.dataset.workId))));
  $$('.edit-work').forEach(button => button.addEventListener('click', () => openWorkDialog(state.works.find(work => work.id === Number(button.dataset.workId))))); refreshIcons();
}

function workTemplate(work) {
  const materialsTotal = work.materials.reduce((sum, material) => sum + (Number(material.estimated_price) || 0) * (Number(material.quantity) || 1), 0);
  const servicePercentage = Number(work.service_percentage) || 0; const serviceTotal = materialsTotal * servicePercentage / 100; const budgetTotal = materialsTotal + serviceTotal;
  const materials = work.materials.length ? `<div class="material-list"><h3>Materiais</h3>${work.materials.map(material => { const quantity = Number(material.quantity) || 1; const price = Number(material.estimated_price); return `<div class="material-row"><div><span>${escapeHtml(material.name)}</span><small>${formatQuantity(quantity)} ${quantity === 1 ? 'unidade' : 'unidades'}${price ? ` x ${money.format(price)}` : ''}</small></div><strong>${price ? money.format(price * quantity) : 'Sem estimativa'}</strong></div>`; }).join('')}</div>` : '';
  const budget = `<div class="budget-summary"><div><span>Total dos materiais</span><strong>${money.format(materialsTotal)}</strong></div><div><span>${escapeHtml(work.service_name || 'Servico')} (${formatQuantity(servicePercentage)}%)</span><strong>${money.format(serviceTotal)}</strong></div><div class="grand-total"><span>Total estimado</span><strong>${money.format(budgetTotal)}</strong></div></div>`;
  const gallery = work.images.length ? `<div class="gallery">${work.images.map(image => `<a href="${image.url}" target="_blank" rel="noopener"><img src="${image.url}" alt="Imagem de ${escapeHtml(work.name)}" loading="lazy"></a>`).join('')}</div>` : '';
  const schedule = work.start_date ? `<div class="work-date">${icon('calendar-range')}<span><small>${work.end_date ? 'PERIODO PREVISTO' : 'DATA DE INICIO'}</small><strong>${formatDateRange(work.start_date, work.end_date)}</strong></span></div>` : '';
  return `<article class="work-card"><div class="work-card-header"><div><h2>${escapeHtml(work.name)}</h2><p class="description">${escapeHtml(work.description) || 'Sem descricao.'}</p></div><div class="card-actions"><button class="icon-button edit-work" data-work-id="${work.id}" title="Editar obra">${icon('pencil')}</button><button class="icon-button delete-work" data-work-id="${work.id}" title="Excluir obra">${icon('trash-2')}</button></div></div>${schedule}${materials}${budget}${gallery}</article>`;
}

function updateViewTabs() {
  $('#worksTab').classList.toggle('active', state.view === 'works'); $('#calendarTab').classList.toggle('active', state.view === 'calendar');
}

async function showCalendar() {
  state.view = 'calendar'; updateViewTabs(); $('#newWorkButton').hidden = true; $('#topbarTitle').textContent = 'Calendario de obras';
  $('#mainArea').innerHTML = '<div class="skeleton"></div>';
  try { state.scheduledWorks = await api('/works'); renderCalendar(); }
  catch (error) { toast(error.message, 'error'); }
}

function renderCalendar() {
  const focus = state.calendarDate; const year = focus.getFullYear(); const month = focus.getMonth();
  const monthName = focus.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const firstWeekday = new Date(year, month, 1).getDay(); const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthStart = new Date(year, month, 1); const monthEnd = new Date(year, month, daysInMonth);
  const monthWorks = state.scheduledWorks.filter(work => parseLocalDate(work.start_date) <= monthEnd && parseLocalDate(work.end_date || work.start_date) >= monthStart);
  const byDay = new Map(); monthWorks.forEach(work => {
    const rangeStart = parseLocalDate(work.start_date) < monthStart ? monthStart : parseLocalDate(work.start_date);
    const rangeEnd = parseLocalDate(work.end_date || work.start_date) > monthEnd ? monthEnd : parseLocalDate(work.end_date || work.start_date);
    for (let cursor = new Date(rangeStart); cursor <= rangeEnd; cursor.setDate(cursor.getDate() + 1)) { const day = cursor.getDate(); if (!byDay.has(day)) byDay.set(day, []); byDay.get(day).push(work); }
  });
  const cells = Array.from({ length: firstWeekday }, () => '<div class="calendar-day outside"></div>');
  for (let day = 1; day <= daysInMonth; day++) {
    const events = byDay.get(day) || []; const isToday = new Date().toDateString() === new Date(year, month, day).toDateString();
    cells.push(`<div class="calendar-day ${isToday ? 'today' : ''}"><span class="day-number">${day}</span><div class="day-events">${events.map(calendarEventTemplate).join('')}</div></div>`);
  }
  const agenda = monthWorks.length ? monthWorks.map(work => `<button class="agenda-item calendar-event" data-client-id="${work.client.id}"><span class="agenda-date"><strong>${formatDate(work.start_date, { day: '2-digit' })}</strong><small>${formatDate(work.start_date, { month: 'short' }).replace('.', '')}</small></span><span><strong>${escapeHtml(work.name)}</strong><small>${escapeHtml(work.client.name)}</small><em>${formatDateRange(work.start_date, work.end_date)}</em></span>${icon('chevron-right')}</button>`).join('') : '<div class="calendar-empty">Nenhuma obra marcada neste mes.</div>';
  $('#mainArea').innerHTML = `<div class="calendar-header"><div><span class="eyebrow">AGENDA DE OBRAS</span><h1>${monthName}</h1></div><div class="calendar-nav"><button class="icon-button" id="previousMonth" title="Mes anterior">${icon('chevron-left')}</button><button class="secondary-button small" id="todayMonth">Hoje</button><button class="icon-button" id="nextMonth" title="Proximo mes">${icon('chevron-right')}</button></div></div><div class="calendar-weekdays">${['Dom','Seg','Ter','Qua','Qui','Sex','Sab'].map(day => `<span>${day}</span>`).join('')}</div><div class="calendar-grid">${cells.join('')}</div><div class="calendar-agenda">${agenda}</div>`;
  $('#previousMonth').addEventListener('click', () => changeCalendarMonth(-1)); $('#nextMonth').addEventListener('click', () => changeCalendarMonth(1));
  $('#todayMonth').addEventListener('click', () => { state.calendarDate = new Date(); renderCalendar(); });
  $$('.calendar-event').forEach(event => event.addEventListener('click', () => { const client = state.clients.find(item => item.id === Number(event.dataset.clientId)); if (client) selectClient(client); })); refreshIcons();
}

function calendarEventTemplate(work) { return `<button class="calendar-event" data-client-id="${work.client.id}" title="${escapeHtml(work.name)} - ${escapeHtml(work.client.name)}"><strong>${escapeHtml(work.name)}</strong><span>${escapeHtml(work.client.name)}</span></button>`; }
function changeCalendarMonth(offset) { state.calendarDate = new Date(state.calendarDate.getFullYear(), state.calendarDate.getMonth() + offset, 1); renderCalendar(); }

function openClientDialog() {
  $('#clientForm').reset(); $('#clientError').textContent = ''; $('#clientDialog').showModal(); setTimeout(() => $('#clientName').focus(), 50);
}

async function saveClient(event) {
  event.preventDefault(); const name = $('#clientName').value.trim();
  if (name.length < 2) { $('#clientError').textContent = 'Informe um nome com pelo menos 2 caracteres.'; return; }
  setBusy($('#saveClient'), true, 'Salvando...');
  try {
    const client = await api('/clients', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    $('#clientDialog').close(); state.selected = null; await loadClients(client.id); toast('Cliente cadastrado.');
  } catch (error) { $('#clientError').textContent = error.message; }
  finally { setBusy($('#saveClient'), false); }
}

function openWorkDialog(work = null) {
  $('#workForm').reset(); $('#materialsBox').innerHTML = ''; $('#selectedMaterialsList').innerHTML = ''; $('#imagePreview').innerHTML = ''; $('#workError').textContent = '';
  state.previewUrls.forEach(URL.revokeObjectURL); state.previewUrls = []; state.editingWorkId = work?.id || null;
  $('#workDialogEyebrow').textContent = work ? 'EDITAR OBRA' : 'NOVA OBRA'; $('#workDialogTitle').textContent = work ? 'Editar obra' : 'Cadastrar obra';
  $('#workClientLabel').textContent = `Cliente: ${state.selected.name}`; $('#workName').value = work?.name || ''; $('#workDescription').value = work?.description || '';
  $('#startDate').value = work?.start_date || ''; $('#endDate').value = work?.end_date || '';
  $('#serviceName').value = work?.service_name || ''; $('#servicePercentage').value = work?.service_percentage ?? 22.12; $('#serviceSuggestion').innerHTML = '';
  if (work?.materials.length) work.materials.forEach(addCommittedMaterial); addMaterial();
  updateBudgetPreview();
  $('#workDialog').showModal(); setTimeout(() => $('#workName').focus(), 50); refreshIcons();
}

function addMaterial() {
  $('#materialsBox').innerHTML = '';
  const row = document.createElement('div'); row.className = 'material-editor';
  row.innerHTML = `<div class="composer-label"><span>ADICIONAR MATERIAL</span><small>Busque um produto para incluir no orçamento</small></div><div class="material-controls"><input class="material-input" maxlength="200" placeholder="Ex.: Cimento CP II 50 kg"><button type="button" class="secondary-button small lookup-button">${icon('search')}Buscar preco</button></div><div class="quantity-field"><label>Quantidade desejada</label><input class="quantity-input" type="number" min="0.01" max="1000000" step="0.01" value="1"></div><div class="lookup-result"></div>`;
  $('.lookup-button', row).addEventListener('click', () => lookupMaterial(row));
  $('.material-input', row).addEventListener('input', event => { delete event.target.dataset.estimated; $('.lookup-result', row).innerHTML = ''; updateBudgetPreview(); });
  $('.quantity-input', row).addEventListener('input', () => { updateSelectedTotal(row); updateBudgetPreview(); });
  $('#materialsBox').append(row); refreshIcons();
  updateBudgetPreview();
}

function addCommittedMaterial(material) {
  const quantity = Number(material.quantity) || 1; const price = Number(material.estimated_price) || 0;
  const item = document.createElement('div'); item.className = 'material-added';
  item.dataset.name = material.name; item.dataset.price = price || ''; item.dataset.quantity = quantity;
  item.innerHTML = `<span class="selected-check">${icon('check')}</span><div class="added-info"><small>ADICIONADO</small><strong>${escapeHtml(material.name)}</strong><span>${formatQuantity(quantity)} ${quantity === 1 ? 'unidade' : 'unidades'}${price ? ` x ${money.format(price)}` : ''}</span></div><strong class="added-total">${price ? money.format(price * quantity) : 'Sem estimativa'}</strong><button type="button" class="icon-button remove-added" title="Remover da lista">${icon('trash-2')}</button>`;
  $('.remove-added', item).addEventListener('click', () => { item.remove(); updateBudgetPreview(); });
  $('#selectedMaterialsList').append(item); refreshIcons(); updateBudgetPreview();
}

async function lookupMaterial(row) {
  const input = $('.material-input', row); const name = input.value.trim(); const result = $('.lookup-result', row); const button = $('.lookup-button', row);
  if (name.length < 2) { result.innerHTML = '<small class="field-error">Digite o nome do material.</small>'; return; }
  setBusy(button, true, 'Buscando...'); result.innerHTML = '<div class="loading-line">Consultando anuncios...</div>';
  try {
    const data = await api('/materials/lookup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    if (!data.examples.length) { result.innerHTML = '<div class="loading-line">Nenhum anuncio encontrado para esse termo.</div>'; return; }
    result.innerHTML = `<div class="search-guidance"><strong>Escolha uma opcao</strong><span>${data.examples.length} resultados em ${escapeHtml(data.source)}</span></div><div class="products">${data.examples.map((product, index) => `<div class="product"><img src="${product.thumbnail || ''}" alt=""><div class="product-info"><a href="${product.url}" target="_blank" rel="noopener">${escapeHtml(product.title)}</a><strong>${money.format(product.price)}</strong><button type="button" class="add-product" data-index="${index}">${icon('plus')}Adicionar este item</button></div></div>`).join('')}</div>`;
    $$('.add-product', result).forEach(selectButton => selectButton.addEventListener('click', () => {
      const product = data.examples[Number(selectButton.dataset.index)]; input.value = product.title; input.dataset.estimated = product.price; renderSelectedMaterial(row, product);
    })); refreshIcons();
  } catch (error) { result.innerHTML = `<small class="field-error">${escapeHtml(error.message)}</small>`; }
  finally { setBusy(button, false); }
}

function renderSelectedMaterial(row, product) {
  const result = $('.lookup-result', row);
  result.innerHTML = `<div class="selected-material"><span class="selected-check">${icon('check')}</span><div><small>ITEM SELECIONADO</small><strong>${escapeHtml(product.title)}</strong><span>${money.format(product.price)} por unidade</span></div><button type="button" class="secondary-button small change-product">Trocar</button><strong class="selected-total"></strong><button type="button" class="primary-button confirm-material">${icon('list-plus')}Adicionar a lista</button></div>`;
  $('.change-product', result).addEventListener('click', () => lookupMaterial(row));
  $('.confirm-material', result).addEventListener('click', () => {
    const quantity = Math.max(0.01, Number($('.quantity-input', row).value) || 1);
    addCommittedMaterial({ name: product.title, estimated_price: product.price, quantity }); addMaterial();
    toast('Material adicionado a lista.');
  });
  updateSelectedTotal(row); refreshIcons();
}

function updateBudgetPreview() {
  const preview = $('#budgetPreview'); if (!preview) return;
  const materialsTotal = $$('.material-added').reduce((sum, item) => sum + (Number(item.dataset.price) || 0) * (Number(item.dataset.quantity) || 0), 0);
  const percentage = Number($('#servicePercentage').value) || 0; const serviceTotal = materialsTotal * percentage / 100;
  preview.innerHTML = `<div><span>Materiais</span><strong>${money.format(materialsTotal)}</strong></div><div><span>Servico (${formatQuantity(percentage)}%)</span><strong>${money.format(serviceTotal)}</strong></div><div><span>Total estimado</span><strong>${money.format(materialsTotal + serviceTotal)}</strong></div>`;
}

async function suggestServicePercentage() {
  const name = $('#serviceName').value.trim(); const output = $('#serviceSuggestion');
  if (name.length < 2) { output.textContent = 'Informe o tipo de servico para pesquisar a referencia.'; return; }
  setBusy($('#suggestServiceButton'), true, 'Pesquisando...');
  try {
    const data = await api('/services/suggest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    $('#servicePercentage').value = data.percentage; updateBudgetPreview();
    output.innerHTML = `${escapeHtml(data.category)}: <strong>${formatQuantity(data.percentage)}%</strong>. <a href="${data.reference_url}" target="_blank" rel="noopener">Referencia: ${escapeHtml(data.reference)}</a>`;
  } catch (error) { output.textContent = error.message; }
  finally { setBusy($('#suggestServiceButton'), false); }
}

function updateSelectedTotal(row) {
  const total = $('.selected-total', row); const price = Number($('.material-input', row).dataset.estimated); const quantity = Number($('.quantity-input', row).value) || 0;
  if (total && price) total.textContent = `Subtotal: ${money.format(price * quantity)}`;
}

function previewImages() {
  state.previewUrls.forEach(URL.revokeObjectURL); state.previewUrls = [];
  const files = [...$('#workImages').files]; $('#workError').textContent = files.length > 8 ? 'Selecione no maximo 8 imagens.' : '';
  $('#imagePreview').innerHTML = files.slice(0, 8).map(file => { const url = URL.createObjectURL(file); state.previewUrls.push(url); return `<img src="${url}" alt="Previa de ${escapeHtml(file.name)}">`; }).join('');
}

async function saveWork(event) {
  event.preventDefault(); const name = $('#workName').value.trim(); const files = [...$('#workImages').files];
  if (name.length < 2) { $('#workError').textContent = 'Informe o nome da obra.'; return; }
  if (files.length > 8) { $('#workError').textContent = 'Selecione no maximo 8 imagens.'; return; }
  if ($('#endDate').value && !$('#startDate').value) { $('#workError').textContent = 'Informe a data de inicio antes do termino.'; return; }
  if ($('#startDate').value && $('#endDate').value < $('#startDate').value) { $('#workError').textContent = 'A data de termino nao pode ser anterior ao inicio.'; return; }
  const materials = $$('.material-added').map(item => ({ name: item.dataset.name, estimated_price: item.dataset.price || null, quantity: Number(item.dataset.quantity) || 1 }));
  setBusy($('#saveWork'), true, 'Salvando...');
  try {
    const editing = state.editingWorkId !== null; const path = editing ? `/works/${state.editingWorkId}` : `/clients/${state.selected.id}/works`;
    const work = await api(path, { method: editing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, description: $('#workDescription').value.trim(), start_date: $('#startDate').value || null, end_date: $('#endDate').value || null, service_name: $('#serviceName').value.trim(), service_percentage: Number($('#servicePercentage').value) || 0, materials }) });
    if (files.length) { const body = new FormData(); files.forEach(file => body.append('images', file)); await api(`/works/${work.id}/images`, { method: 'POST', body }); }
    $('#workDialog').close(); await loadClients(state.selected.id); toast(editing ? 'Obra atualizada.' : 'Obra cadastrada.');
  } catch (error) { $('#workError').textContent = error.message; }
  finally { setBusy($('#saveWork'), false); }
}

async function deleteClient() {
  if (!confirm(`Excluir ${state.selected.name} e todas as obras? Esta acao nao pode ser desfeita.`)) return;
  try { await api(`/clients/${state.selected.id}`, { method: 'DELETE' }); state.selected = null; state.works = []; await loadClients(); renderWelcome(); toast('Cliente excluido.'); }
  catch (error) { toast(error.message, 'error'); }
}

async function deleteWork(workId) {
  const work = state.works.find(item => item.id === workId); if (!confirm(`Excluir a obra ${work.name}?`)) return;
  try { await api(`/works/${workId}`, { method: 'DELETE' }); await loadClients(state.selected.id); toast('Obra excluida.'); }
  catch (error) { toast(error.message, 'error'); }
}

$('#newClientButton').addEventListener('click', openClientDialog); $('#clientForm').addEventListener('submit', saveClient);
$('#newWorkButton').addEventListener('click', () => openWorkDialog()); $('#workForm').addEventListener('submit', saveWork);
$('#workImages').addEventListener('change', previewImages);
$('#suggestServiceButton').addEventListener('click', suggestServicePercentage); $('#servicePercentage').addEventListener('input', updateBudgetPreview);
$('#calendarTab').addEventListener('click', showCalendar); $('#worksTab').addEventListener('click', () => { state.view = 'works'; updateViewTabs(); if (state.selected) selectClient(state.selected); else renderWelcome(); });
$('#clientSearch').addEventListener('input', renderClients); $('#menuButton').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
$$('.close-dialog').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
document.addEventListener('click', event => { if (innerWidth <= 850 && $('#sidebar').classList.contains('open') && !$('#sidebar').contains(event.target) && !$('#menuButton').contains(event.target)) $('#sidebar').classList.remove('open'); });
refreshIcons(); loadClients();
