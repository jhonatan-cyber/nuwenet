/** Cliente HTTP único del panel: JSON, sesión por cookie y errores en español. */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/${path.replace(/^\/+/, '')}`, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    ...init,
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error((data as { error?: string }).error || `Error ${response.status}`);
  return data as T;
}

export const apiGet = <T>(path: string): Promise<T> => api<T>(path);
export const apiPost = <T>(path: string, body?: unknown): Promise<T> =>
  api<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) });
