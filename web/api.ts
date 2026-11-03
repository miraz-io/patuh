export type Role = "admin" | "dpo" | "member" | "auditor";
export type Me = {
  user: { id: number; email: string; name: string; role: Role; department_id: number | null };
  org: string; demo: boolean; ai: boolean; tourActivityId: number | null; completedTours: string[];
};

const hooks = { error: (_m: string) => {}, signedOut: () => {} };
export const onError = (fn: (m: string) => void) => { hooks.error = fn; };
export const onSignedOut = (fn: () => void) => { hooks.signedOut = fn; };

// x-requested-with is the CSRF guard the server requires on every change.
export async function api<T = unknown>(url: string, method = "GET", body?: unknown): Promise<T> {
  const r = await fetch(url, { method, credentials: "same-origin", headers: { "content-type": "application/json", "x-requested-with": "patuh" }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (r.status === 401 && url !== "/api/auth/login") { hooks.signedOut(); throw new Error("Sign in required"); }
  if (!r.ok) {
    const m = ((await r.json().catch(() => ({}))) as { error?: string }).error ?? r.statusText;
    if (url !== "/api/auth/login") hooks.error(m);
    throw new Error(m);
  }
  return r.json() as Promise<T>;
}

export const canWriteDept = (me: Me, dept: number) => me.user.role === "admin" || me.user.role === "dpo" || (me.user.role === "member" && me.user.department_id === dept);
export const canSignOff = (me: Me) => me.user.role === "admin" || me.user.role === "dpo";
