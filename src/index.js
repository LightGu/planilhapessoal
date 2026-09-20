const json = (data, status = 200) => Response.json(data, { status });
const error = (message, status = 400) => json({ error: message }, status);
const publicUrl = (env, filename) => `${env.SUPABASE_URL}/storage/v1/object/public/work-images/${filename}`;

function client(env) {
  const headers = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };
  return async (path, options = {}) => {
    const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, { ...options, headers: { ...headers, ...options.headers } });
    if (!response.ok) throw new Error(await response.text());
    return response.status === 204 ? null : response.json();
  };
}

function workPayload(work, materials, images, env) {
  return {
    id: work.id, name: work.name, description: work.description || '', service_name: work.service_name || '',
    service_percentage: Number(work.service_percentage), start_date: work.start_date, end_date: work.end_date, client_id: work.client_id,
    materials: materials.filter(item => item.work_id === work.id).map(item => ({ id: item.id, name: item.name, estimated_price: item.estimated_price, quantity: Number(item.quantity) })),
    images: images.filter(item => item.work_id === work.id).map(item => ({ id: item.id, filename: item.filename, url: publicUrl(env, item.filename) })),
  };
}

async function worksFor(db, filter, env) {
  const works = await db(`works?select=*&${filter}&order=id.desc`);
  if (!works.length) return [];
  const ids = works.map(work => work.id).join(',');
  const [materials, images] = await Promise.all([
    db(`materials?select=*&work_id=in.(${ids})`), db(`work_images?select=*&work_id=in.(${ids})`),
  ]);
  return works.map(work => workPayload(work, materials, images, env));
}

function validWork(body) {
  const name = String(body.name || '').trim();
  if (name.length < 2) return [null, 'Informe o nome da obra.'];
  const start_date = body.start_date || null, end_date = body.end_date || null;
  if (end_date && !start_date) return [null, 'Informe a data de inicio antes do termino.'];
  if (end_date && end_date < start_date) return [null, 'A data de termino nao pode ser anterior ao inicio.'];
  return [{ name, description: String(body.description || '').trim(), service_name: String(body.service_name || '').trim(), service_percentage: Math.max(0, Math.min(Number(body.service_percentage) || 0, 100)), start_date, end_date, materials: Array.isArray(body.materials) ? body.materials.slice(0, 50) : [] }, null];
}

async function saveMaterials(db, workId, materials) {
  const rows = materials.filter(item => String(item.name || '').trim()).map(item => ({ work_id: workId, name: String(item.name).trim().slice(0, 200), estimated_price: item.estimated_price === null || item.estimated_price === '' ? null : Number(item.estimated_price), quantity: Math.max(.01, Math.min(Number(item.quantity) || 1, 1000000)) }));
  if (rows.length) await db('materials', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(rows) });
}

async function handleApi(request, env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return error('O servidor ainda nao possui as credenciais do Supabase.', 503);
  const db = client(env), url = new URL(request.url), path = url.pathname.replace('/api', ''), method = request.method;
  try {
    if (path === '/clients' && method === 'GET') {
      const [clients, works] = await Promise.all([db('clients?select=id,name&order=name.asc'), db('works?select=client_id')]);
      return json(clients.map(item => ({ ...item, work_count: works.filter(work => work.client_id === item.id).length })));
    }
    if (path === '/clients' && method === 'POST') {
      const name = String((await request.json()).name || '').trim();
      if (name.length < 2) return error('Informe um nome com pelo menos 2 caracteres.');
      const rows = await db('clients', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ name }) });
      return json({ ...rows[0], work_count: 0 }, 201);
    }
    const clientMatch = path.match(/^\/clients\/(\d+)(?:\/works)?$/);
    if (clientMatch) {
      const clientId = Number(clientMatch[1]);
      if (!path.endsWith('/works') && method === 'DELETE') { await db(`clients?id=eq.${clientId}`, { method: 'DELETE' }); return new Response(null, { status: 204 }); }
      if (path.endsWith('/works') && method === 'GET') return json(await worksFor(db, `client_id=eq.${clientId}`, env));
      if (path.endsWith('/works') && method === 'POST') {
        const [body, message] = validWork(await request.json()); if (message) return error(message);
        const rows = await db('works', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ ...body, materials: undefined, client_id: clientId }) });
        await saveMaterials(db, rows[0].id, body.materials); return json((await worksFor(db, `id=eq.${rows[0].id}`, env))[0], 201);
      }
    }
    const workMatch = path.match(/^\/works\/(\d+)(?:\/images)?$/);
    if (workMatch) {
      const workId = Number(workMatch[1]);
      if (!path.endsWith('/images') && method === 'DELETE') { await db(`works?id=eq.${workId}`, { method: 'DELETE' }); return new Response(null, { status: 204 }); }
      if (!path.endsWith('/images') && method === 'PUT') {
        const [body, message] = validWork(await request.json()); if (message) return error(message);
        await db(`works?id=eq.${workId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ ...body, materials: undefined }) });
        await db(`materials?work_id=eq.${workId}`, { method: 'DELETE' }); await saveMaterials(db, workId, body.materials);
        return json((await worksFor(db, `id=eq.${workId}`, env))[0]);
      }
      if (path.endsWith('/images') && method === 'POST') {
        const files = (await request.formData()).getAll('images').filter(file => file instanceof File);
        if (files.length > 8) return error('Envie no maximo 8 imagens.');
        const saved = [];
        for (const file of files) {
          if (!file.type.startsWith('image/')) return error('Envie apenas imagens.');
          const filename = `${crypto.randomUUID()}.${file.name.split('.').pop().toLowerCase()}`;
          const response = await fetch(`${env.SUPABASE_URL}/storage/v1/object/work-images/${filename}`, { method: 'POST', headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': file.type }, body: file });
          if (!response.ok) throw new Error(await response.text());
          await db('work_images', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ work_id: workId, filename }) }); saved.push(filename);
        }
        return json({ saved }, 201);
      }
    }
    if (path === '/works' && method === 'GET') {
      const works = await worksFor(db, 'start_date=not.is.null', env), clients = await db('clients?select=id,name');
      return json(works.map(work => ({ ...work, client: clients.find(client => client.id === work.client_id) })));
    }
    if (path === '/materials/lookup' && method === 'POST') {
      const name = String((await request.json()).name || '').trim();
      if (name.length < 2) return error('Digite um material para pesquisar.');
      const response = await fetch(`https://api.mercadolibre.com/sites/MLB/search?q=${encodeURIComponent(name)}&limit=6`);
      const data = await response.json();
      const examples = (data.results || []).filter(item => Number(item.price) > 0).map(item => ({ title: item.title, price: Number(item.price), url: item.permalink, thumbnail: item.thumbnail?.replace('http://', 'https://'), condition: item.condition }));
      return json({ name, estimated_price: examples.length ? examples.sort((a, b) => a.price - b.price)[Math.floor(examples.length / 2)].price : null, examples, source: 'Mercado Livre' });
    }
    if (path === '/services/suggest' && method === 'POST') {
      const name = String((await request.json()).name || '').toLowerCase();
      const match = [['eletric', 'Instalacao eletrica', 25.84], ['hidraulic', 'Instalacao hidraulica', 24.18], ['ar condicionado', 'Instalacao predial especializada', 22.12], ['fornecimento', 'Fornecimento de materiais e equipamentos', 14.02]].find(item => name.includes(item[0])) || [null, 'Construcao ou reforma de edificacao', 22.12];
      return json({ percentage: match[2], category: match[1], reference: 'Acordao 2622/2013 - Plenario do TCU', reference_url: 'https://pesquisa.apps.tcu.gov.br/doc/acordao-completo/2622/2013/Plen%C3%A1rio' });
    }
    return error('Rota nao encontrada.', 404);
  } catch (cause) { console.error(cause); return error('Nao foi possivel concluir a operacao.', 503); }
}

export default { fetch: (request, env) => new URL(request.url).pathname.startsWith('/api/') ? handleApi(request, env) : env.ASSETS.fetch(request) };
