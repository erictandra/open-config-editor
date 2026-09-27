// Ambil daftar model dari 9Router (OpenAI-compatible: GET {ROUTER_URL}/models)
export async function fetchRouterModels(env) {
  const res = await fetch(`${env.routerUrl}/models`, {
    headers: { Authorization: `Bearer ${env.routerKey}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`9Router membalas HTTP ${res.status}`);
  const body = await res.json();
  const list = Array.isArray(body) ? body : body.data;
  if (!Array.isArray(list)) throw new Error('Format respons 9Router tidak dikenali (tidak ada array "data")');
  const ids = list.map((m) => (typeof m === 'string' ? m : m?.id)).filter((id) => typeof id === 'string' && id);
  return [...new Set(ids)];
}
