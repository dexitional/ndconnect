export type Row = Record<string, any>;
export async function api<T = any>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch("/api" + path, {
    ...options,
    headers: {
      ...(options.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...options.headers,
    },
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("The server returned an unexpected response.");
  }
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}
export const post = (path: string, body?: unknown) =>
  api(path, {
    method: "POST",
    body: body instanceof FormData ? body : JSON.stringify(body || {}),
  });
export const patch = (path: string, body: unknown) =>
  api(path, { method: "PATCH", body: JSON.stringify(body) });
export const remove = (path: string) => api(path, { method: "DELETE" });
