// Utilidades compartidas por las Edge Functions.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

const ORIGENES = (Deno.env.get("ALLOWED_ORIGINS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);

export function cors(req: Request): HeadersInit {
  const origin = req.headers.get("origin") ?? "";
  // Si no se configuró ALLOWED_ORIGINS se acepta cualquier origen (el JWT sigue siendo obligatorio).
  const permitido = ORIGENES.length === 0 || ORIGENES.includes(origin) ? origin || "*" : ORIGENES[0];
  return {
    "Access-Control-Allow-Origin": permitido,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(req), "Content-Type": "application/json; charset=utf-8" },
  });
}

export class ErrorHttp extends Error {
  constructor(public status: number, message: string, public detalle?: unknown) {
    super(message);
  }
}

/** Cliente con la sesión del usuario que llama (respeta RLS). */
export function clienteUsuario(req: Request): SupabaseClient {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) throw new ErrorHttp(401, "Falta la sesión");
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Cliente con service_role: SÓLO del lado del servidor. Nunca se expone al navegador. */
export function clienteAdmin(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Verifica el JWT y que el usuario tenga el permiso indicado. Devuelve su id. */
export async function exigirPermiso(req: Request, permiso: string): Promise<{ userId: string; db: SupabaseClient }> {
  const db = clienteUsuario(req);
  const jwt = req.headers.get("Authorization")!.slice(7);
  const { data: u, error } = await db.auth.getUser(jwt);
  if (error || !u?.user) throw new ErrorHttp(401, "Sesión inválida o vencida");
  const { data: ok, error: e2 } = await db.rpc("tiene_permiso", { p_permiso: permiso });
  if (e2) throw new ErrorHttp(500, "No se pudo verificar el permiso");
  if (!ok) throw new ErrorHttp(403, "No tenés permiso para esta acción");
  return { userId: u.user.id, db };
}

export function manejar(fn: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
    if (req.method !== "POST") return json(req, { error: "Método no permitido" }, 405);
    try {
      return await fn(req);
    } catch (e) {
      if (e instanceof ErrorHttp) return json(req, { error: e.message, detalle: e.detalle }, e.status);
      console.error(e);
      return json(req, { error: "Error interno" }, 500);
    }
  };
}
