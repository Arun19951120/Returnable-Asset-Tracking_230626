// Client-side helpers that call the local JSON API routes

// Short-TTL cache + in-flight de-duplication: concurrent mounts share one
// request, repeat reads within TTL skip the network. Writes invalidate.
const CACHE_TTL_MS = 3000;
const cache = new Map<string, { at: number; promise: Promise<unknown[]> }>();

function invalidate(collection: string) {
  cache.delete(collection);
}

export async function fetchAll<T>(collection: string): Promise<T[]> {
  const hit = cache.get(collection);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return hit.promise as Promise<T[]>;
  }
  const promise = fetch(`/api/data/${collection}`)
    .then((res) => (res.ok ? res.json() : []))
    .catch(() => {
      invalidate(collection);
      return [];
    });
  cache.set(collection, { at: Date.now(), promise });
  return promise as Promise<T[]>;
}

export async function fetchOne<T>(collection: string, id: string): Promise<T | null> {
  const res = await fetch(`/api/data/${collection}/${id}`);
  if (!res.ok) return null;
  return res.json();
}

export async function addDocument(
  collection: string,
  data: Record<string, unknown>
): Promise<{ id: string }> {
  const res = await fetch(`/api/data/${collection}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  invalidate(collection);
  return res.json();
}

export async function updateDocument(
  collection: string,
  id: string,
  data: Record<string, unknown>
): Promise<void> {
  await fetch(`/api/data/${collection}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  invalidate(collection);
}

export async function deleteDocument(
  collection: string,
  id: string
): Promise<void> {
  await fetch(`/api/data/${collection}/${id}`, { method: "DELETE" });
  invalidate(collection);
}

export async function logAudit(
  entry: Omit<import("./types").AuditLog, "id" | "timestamp">
): Promise<void> {
  await addDocument("audit_logs", {
    ...entry,
    timestamp: new Date().toISOString(),
  });
}
