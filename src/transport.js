export async function requestJson(url, options, { timeout = 15000, fetcher = fetch } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetcher(url, { ...options, signal: controller.signal });
    let result;
    try { result = await response.json(); }
    catch { throw new Error('O servidor não respondeu corretamente. Tente novamente.'); }
    if (!response.ok) {
      const error = new Error(result.error || 'Não foi possível concluir.');
      error.status = response.status;
      throw error;
    }
    return result.data;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('A conexão demorou demais. Confira seu histórico antes de repetir uma confirmação.');
    if (error instanceof TypeError) throw new Error('Não foi possível conectar. Verifique sua internet e tente novamente.');
    throw error;
  } finally { clearTimeout(timer); }
}
