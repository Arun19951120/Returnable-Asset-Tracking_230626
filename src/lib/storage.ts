// Client-side helpers that call the local JSON API routes

export async function fetchAll<T>(collection: string): Promise<T[]> {
  const res = await fetch(`/api/data/${collection}`);
  if (!res.ok) return [];
  return res.json();
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
}

export async function deleteDocument(
  collection: string,
  id: string
): Promise<void> {
  await fetch(`/api/data/${collection}/${id}`, { method: "DELETE" });
}

export async function logAudit(
  entry: Omit<import("./types").AuditLog, "id" | "timestamp">
): Promise<void> {
  await addDocument("audit_logs", {
    ...entry,
    timestamp: new Date().toISOString(),
  });
}
