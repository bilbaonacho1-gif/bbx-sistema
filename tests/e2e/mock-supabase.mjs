// =====================================================================
// SOLO PARA PRUEBAS AUTOMÁTICAS — NO ES SUPABASE NI SE USA EN PRODUCCIÓN.
//
// Imita el subconjunto de la API de Supabase que usa el frontend
// (PostgREST /rest/v1, GoTrue /auth/v1, Storage /storage/v1, Functions)
// sobre un Postgres local con las migraciones reales aplicadas.
// Cada request corre con el rol "authenticated" (o "anon") y su JWT en
// request.jwt.claims, así que las políticas RLS se aplican de verdad.
//
// Uso: PGURL=postgres://postgres@127.0.0.1:54322/bbx_e2e node mock-supabase.mjs
// =====================================================================
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const PORT = Number(process.env.MOCK_PORT || 54321);
const SECRET = "secreto-solo-para-pruebas-locales";
const pool = new pg.Pool({ connectionString: process.env.PGURL || "postgres://postgres@127.0.0.1:54322/bbx_e2e" });
const ARCHIVOS = path.join(process.env.TMPDIR || "/tmp", "bbx-mock-storage");
fs.mkdirSync(ARCHIVOS, { recursive: true });
const claves = new Map();            // email → contraseña (sólo pruebas)
export const log = [];

// ----------------------------- JWT -----------------------------------
const b64 = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");
function firmar(payload) {
  const h = b64({ alg: "HS256", typ: "JWT" }), p = b64(payload);
  return `${h}.${p}.${crypto.createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url")}`;
}
function verificar(token) {
  try {
    const [h, p, s] = token.split(".");
    if (crypto.createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url") !== s) return null;
    const c = JSON.parse(Buffer.from(p, "base64url").toString());
    return c.exp > Date.now() / 1000 ? c : null;
  } catch { return null; }
}
export const ANON_KEY = firmar({ role: "anon", iss: "mock", exp: 4102444800 });

// ----------------------------- utilidades ----------------------------
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, prefer, range, x-client-info, accept-profile, content-profile, x-supabase-api-version, x-upsert, cache-control",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS, HEAD",
  "Access-Control-Expose-Headers": "content-range, content-type",
};
function enviar(res, status, body, headers = {}) {
  res.writeHead(status, { ...CORS, "Content-Type": "application/json", ...headers });
  res.end(body === undefined || body === null ? "" : typeof body === "string" ? body : JSON.stringify(body));
}
const leerCuerpo = (req) => new Promise((ok) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => ok(Buffer.concat(c))); });
const qi = (s) => '"' + String(s).replace(/"/g, '""') + '"';
function errorPg(res, e) {
  const status = e.code === "42501" ? 403 : e.code === "23505" ? 409 : e.code === "P0002" ? 404 : 400;
  enviar(res, status, { code: e.code, message: e.message, details: e.detail ?? null, hint: e.hint ?? null });
}

/** Ejecuta fn(client) dentro de una transacción con el rol y JWT del request. */
async function comoUsuario(claims, req, fn) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query(`set local role ${claims?.role === "authenticated" ? "authenticated" : claims?.role === "service_role" ? "service_role" : "anon"}`);
    await c.query("select set_config('request.jwt.claims', $1, true), set_config('request.headers', $2, true)",
      [JSON.stringify(claims ?? { role: "anon" }), JSON.stringify({ "x-forwarded-for": "127.0.0.1", "user-agent": req.headers["user-agent"] ?? "" })]);
    const r = await fn(c);
    await c.query("commit");
    return r;
  } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); }
}
function claimsDe(req) {
  const t = (req.headers.authorization || "").replace(/^Bearer /, "");
  const c = verificar(t);
  return c ?? { role: "anon" };
}

// ----------------------------- metadatos de FKs ----------------------
let FKS = null;
async function fks() {
  if (FKS) return FKS;
  const { rows } = await pool.query(`
    select c.conname, tc.relname as tabla, a.attname as columna, tr.relname as ref, ar.attname as ref_col,
           exists (select 1 from pg_index i where i.indrelid = c.conrelid and i.indisunique and i.indnatts = 1 and i.indkey[0] = c.conkey[1]) as unico
      from pg_constraint c join pg_class tc on tc.oid = c.conrelid join pg_class tr on tr.oid = c.confrelid
      join pg_namespace n on n.oid = tc.relnamespace
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      join pg_attribute ar on ar.attrelid = c.confrelid and ar.attnum = c.confkey[1]
     where c.contype = 'f' and n.nspname = 'public'`);
  return (FKS = rows);
}

// ----------------------------- parser de select ----------------------
function dividir(s) {
  const out = []; let d = 0, cur = "";
  for (const ch of s) { if (ch === "(") d++; if (ch === ")") d--; if (ch === "," && d === 0) { out.push(cur.trim()); cur = ""; } else cur += ch; }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
function parseSelect(s = "*") {
  return dividir(s).map((it) => {
    const m = it.match(/^(?:(\w+):)?(\w+)(?:!(\w+))?\((.*)\)$/s);
    if (m) return { rel: true, alias: m[1] || m[2], nombre: m[2], hint: m[3], hijos: parseSelect(m[4]) };
    return { rel: false, col: it.includes(":") ? it.split(":")[1] : it, alias: it.includes(":") ? it.split(":")[0] : it };
  });
}

async function embeber(c, tabla, filas, items) {
  const rels = items.filter((i) => i.rel);
  if (!rels.length || !filas.length) return;
  const meta = await fks();
  for (const r of rels) {
    // muchos-a-uno: tabla.columna → ref (por nombre de tabla, columna o constraint)
    let fk = meta.find((f) => f.tabla === tabla && (r.hint ? f.conname === r.hint : f.ref === r.nombre || f.columna === r.nombre));
    let unoAMuchos = false;
    if (!fk || (r.hint && fk.tabla !== tabla)) {
      fk = meta.find((f) => f.ref === tabla && (r.hint ? f.conname === r.hint : f.tabla === r.nombre));
      unoAMuchos = !!fk;
    }
    if (!fk) throw Object.assign(new Error(`No hay relación entre ${tabla} y ${r.nombre}`), { code: "PGRST200" });
    const destino = unoAMuchos ? fk.tabla : fk.ref;
    for (const fila of filas) {
      let sub;
      if (unoAMuchos) {
        sub = (await c.query(`select * from public.${qi(destino)} where ${qi(fk.columna)} = $1`, [fila[fk.ref_col]])).rows;
        await embeber(c, destino, sub, r.hijos);
        sub = sub.map((x) => proyectar(x, r.hijos));
        fila[r.alias] = fk.unico ? sub[0] ?? null : sub;
      } else {
        const v = fila[fk.columna];
        sub = v == null ? [] : (await c.query(`select * from public.${qi(destino)} where ${qi(fk.ref_col)} = $1`, [v])).rows;
        await embeber(c, destino, sub, r.hijos);
        fila[r.alias] = sub[0] ? proyectar(sub[0], r.hijos) : null;
      }
    }
  }
}
function proyectar(fila, items) {
  if (items.some((i) => !i.rel && i.col === "*")) {
    const o = { ...fila };
    for (const i of items) if (i.rel) o[i.alias] = fila[i.alias];
    return o;
  }
  const o = {};
  for (const i of items) o[i.alias] = fila[i.rel ? i.alias : i.col];
  return o;
}

// ----------------------------- filtros -------------------------------
const RESERVADOS = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);
function where(params, vals) {
  const conds = [];
  for (const [k, v] of params) {
    if (RESERVADOS.has(k)) continue;
    const m = v.match(/^(not\.)?(eq|neq|gt|gte|lt|lte|like|ilike|is|in)\.(.*)$/s);
    if (!m) continue;
    const [, neg, op, raw] = m;
    let sql;
    if (op === "in") {
      const lista = raw.replace(/^\(|\)$/g, "").match(/("([^"]|\\")*"|[^,]+)/g) ?? [];
      const ph = lista.map((x) => { vals.push(x.replace(/^"|"$/g, "")); return "$" + vals.length; });
      sql = `${qi(k)}::text in (${ph.join(",") || "null"})`;
    } else if (op === "is") {
      sql = `${qi(k)} is ${raw === "null" ? "null" : raw === "true" ? "true" : "false"}`;
    } else {
      vals.push(raw);
      const o = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=", like: "like", ilike: "ilike" }[op];
      sql = `${qi(k)}::text ${o} $${vals.length}::text`;
      if (["gt", "gte", "lt", "lte"].includes(op)) sql = `${qi(k)} ${o} $${vals.length}`;
    }
    conds.push(neg ? `not (${sql})` : sql);
  }
  return conds.length ? " where " + conds.join(" and ") : "";
}
function orden(params) {
  const o = params.get("order");
  if (!o) return "";
  return " order by " + o.split(",").map((x) => {
    const [col, ...mods] = x.split(".");
    return `${qi(col)} ${mods.includes("desc") ? "desc" : "asc"}${mods.includes("nullsfirst") ? " nulls first" : mods.includes("nullslast") ? " nulls last" : ""}`;
  }).join(", ");
}

// ----------------------------- REST ----------------------------------
async function rest(req, res, url) {
  const claims = claimsDe(req);
  const partes = url.pathname.replace("/rest/v1/", "").split("/");
  const params = url.searchParams;
  const body = ["POST", "PATCH", "PUT"].includes(req.method) ? JSON.parse((await leerCuerpo(req)).toString() || "null") : null;
  const prefer = req.headers.prefer || "";
  const objeto = (req.headers.accept || "").includes("vnd.pgrst.object");

  try {
    if (partes[0] === "rpc") {
      const fn = partes[1];
      const args = body ?? Object.fromEntries([...params]);
      const nombres = Object.keys(args);
      const vals = nombres.map((k) => { const v = args[k]; if (v === null) return null; if (Array.isArray(v)) return v.some((x) => x && typeof x === "object") || !v.length ? JSON.stringify(v) : "{" + v.join(",") + "}"; return typeof v === "object" ? JSON.stringify(v) : String(v); });
      const r = await comoUsuario(claims, req, (c) => c.query(`select public.${qi(fn)}(${nombres.map((k, i) => `${qi(k)} => $${i + 1}`).join(", ")}) as r`, vals));
      return enviar(res, 200, JSON.stringify(r.rows[0]?.r ?? null));
    }
    const tabla = partes[0];
    const items = parseSelect(params.get("select") || "*");
    const vals = [];

    if (req.method === "GET" || req.method === "HEAD") {
      const sql = `select * from public.${qi(tabla)}${where(params, vals)}${orden(params)}${params.get("limit") ? " limit " + Number(params.get("limit")) : ""}${params.get("offset") ? " offset " + Number(params.get("offset")) : ""}`;
      const { filas, total } = await comoUsuario(claims, req, async (c) => {
        const r = await c.query(sql, vals);
        let total = null;
        if (prefer.includes("count=")) total = (await c.query(`select count(*)::int n from public.${qi(tabla)}${where(params, [])}`, vals)).rows[0].n;
        await embeber(c, tabla, r.rows, items);
        return { filas: r.rows.map((x) => proyectar(x, items)), total };
      });
      const rango = { "Content-Range": `0-${Math.max(filas.length - 1, 0)}/${total ?? "*"}` };
      if (req.method === "HEAD") return enviar(res, 200, null, rango);
      if (objeto) {
        if (filas.length !== 1) return enviar(res, 406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: `The result contains ${filas.length} rows`, hint: null });
        return enviar(res, 200, filas[0], rango);
      }
      return enviar(res, 200, filas, rango);
    }

    if (req.method === "POST") {
      const filas = Array.isArray(body) ? body : [body];
      const upsert = prefer.includes("resolution=merge-duplicates");
      const out = await comoUsuario(claims, req, async (c) => {
        const res2 = [];
        let pk = null;
        if (upsert) pk = (await c.query(`select a.attname from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey) where i.indrelid = $1::regclass and i.indisprimary`, ["public." + tabla])).rows.map((x) => x.attname);
        for (const f of filas) {
          const cols = Object.keys(f);
          const v = cols.map((k) => (f[k] !== null && typeof f[k] === "object" ? JSON.stringify(f[k]) : f[k]));
          let sql = `insert into public.${qi(tabla)} (${cols.map(qi).join(",")}) values (${cols.map((_, i) => "$" + (i + 1)).join(",")})`;
          if (upsert) sql += ` on conflict (${pk.map(qi).join(",")}) do update set ${cols.filter((x) => !pk.includes(x)).map((x) => `${qi(x)} = excluded.${qi(x)}`).join(", ")}`;
          res2.push(...(await c.query(sql + " returning *", v)).rows);
        }
        await embeber(c, tabla, res2, items);
        return res2.map((x) => proyectar(x, items));
      });
      if (!prefer.includes("return=representation")) return enviar(res, 201, null);
      return enviar(res, 201, objeto ? out[0] : out);
    }

    if (req.method === "PATCH") {
      const cols = Object.keys(body);
      const v = cols.map((k) => (body[k] !== null && typeof body[k] === "object" ? JSON.stringify(body[k]) : body[k]));
      const w = where(params, v);
      const out = await comoUsuario(claims, req, (c) => c.query(`update public.${qi(tabla)} set ${cols.map((k, i) => `${qi(k)} = $${i + 1}`).join(", ")}${w} returning *`, v));
      if (!prefer.includes("return=representation")) return enviar(res, 204, null);
      return enviar(res, 200, objeto ? out.rows[0] : out.rows);
    }

    if (req.method === "DELETE") {
      await comoUsuario(claims, req, (c) => c.query(`delete from public.${qi(tabla)}${where(params, vals)}`, vals));
      return enviar(res, 204, null);
    }
  } catch (e) {
    log.push({ url: url.pathname + url.search, error: e.message });
    return errorPg(res, e);
  }
  enviar(res, 405, { message: "no soportado" });
}

// ----------------------------- AUTH ----------------------------------
async function usuario(id) {
  const { rows } = await pool.query("select * from auth.users where id = $1", [id]);
  const u = rows[0];
  if (!u) return null;
  return { id: u.id, aud: "authenticated", role: "authenticated", email: u.email, email_confirmed_at: u.email_confirmed_at,
    app_metadata: u.raw_app_meta_data ?? {}, user_metadata: u.raw_user_meta_data ?? {}, created_at: u.created_at };
}
async function sesion(id) {
  const u = await usuario(id);
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return { access_token: firmar({ sub: id, role: "authenticated", email: u.email, aud: "authenticated", exp }), token_type: "bearer",
    expires_in: 3600, expires_at: exp, refresh_token: firmar({ sub: id, typ: "refresh", exp: exp + 86400 }), user: u };
}
async function auth(req, res, url) {
  const ruta = url.pathname.replace("/auth/v1/", "");
  const body = req.method === "GET" ? {} : JSON.parse((await leerCuerpo(req)).toString() || "{}");
  try {
    if (ruta === "token" && url.searchParams.get("grant_type") === "password") {
      const { rows } = await pool.query("select id, email_confirmed_at, banned from auth.users left join lateral (select false banned) b on true where lower(email) = lower($1)", [body.email]);
      if (!rows[0] || claves.get(body.email.toLowerCase()) !== body.password) return enviar(res, 400, { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" });
      if (!rows[0].email_confirmed_at) return enviar(res, 400, { code: 400, error_code: "email_not_confirmed", msg: "Email not confirmed" });
      return enviar(res, 200, await sesion(rows[0].id));
    }
    if (ruta === "token" && url.searchParams.get("grant_type") === "refresh_token") {
      const c = verificar(body.refresh_token);
      if (!c) return enviar(res, 400, { code: 400, msg: "Invalid Refresh Token" });
      return enviar(res, 200, await sesion(c.sub));
    }
    if (ruta === "signup") {
      const { rows } = await pool.query("select 1 from auth.users where lower(email) = lower($1)", [body.email]);
      if (rows[0]) return enviar(res, 422, { code: 422, error_code: "user_already_exists", msg: "User already registered" });
      const ins = await pool.query("insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id", [body.email, body.data ?? {}])
        .catch((e) => { throw Object.assign(new Error("Database error saving new user"), { status: 500, causa: e.message }); });
      claves.set(body.email.toLowerCase(), body.password);
      return enviar(res, 200, await usuario(ins.rows[0].id));
    }
    if (ruta === "user") {
      const c = claimsDe(req);
      if (c.role !== "authenticated") return enviar(res, 401, { code: 401, msg: "invalid JWT" });
      if (req.method === "PUT") {
        if (body.password) { const u = await usuario(c.sub); claves.set(u.email.toLowerCase(), body.password); }
      }
      return enviar(res, 200, await usuario(c.sub));
    }
    if (ruta === "logout") return enviar(res, 204, null);
    if (ruta === "recover") return enviar(res, 200, {});
  } catch (e) {
    log.push({ url: url.pathname, error: e.causa ?? e.message });
    return enviar(res, e.status ?? 400, { code: e.status ?? 400, msg: e.message });
  }
  enviar(res, 404, { msg: "no soportado" });
}

// ----------------------------- STORAGE -------------------------------
async function storage(req, res, url) {
  const claims = claimsDe(req);
  const ruta = decodeURIComponent(url.pathname.replace("/storage/v1/", ""));
  try {
    let m;
    if (req.method === "POST" && (m = ruta.match(/^object\/sign\/([^/]+)\/(.+)$/))) {
      const [, bucket, nombre] = m;
      const r = await comoUsuario(claims, req, (c) => c.query("select 1 from storage.objects where bucket_id = $1 and name = $2", [bucket, nombre]));
      if (!r.rows.length) return enviar(res, 400, { statusCode: "404", error: "not_found", message: "Object not found" });
      const token = firmar({ bucket, nombre, exp: Math.floor(Date.now() / 1000) + 60 });
      return enviar(res, 200, { signedURL: `/object/sign/${bucket}/${encodeURIComponent(nombre)}?token=${token}` });
    }
    if (req.method === "GET" && (m = ruta.match(/^object\/sign\/([^/]+)\/(.+)$/))) {
      const t = verificar(url.searchParams.get("token") || "");
      if (!t || t.bucket !== m[1] || t.nombre !== m[2]) return enviar(res, 400, { message: "invalid token" });
      const f = path.join(ARCHIVOS, crypto.createHash("sha1").update(m[1] + "/" + m[2]).digest("hex"));
      res.writeHead(200, { ...CORS, "Content-Type": "application/octet-stream" });
      return res.end(fs.existsSync(f) ? fs.readFileSync(f) : Buffer.from("archivo de prueba"));
    }
    if (req.method === "POST" && (m = ruta.match(/^object\/([^/]+)\/(.+)$/))) {
      const [, bucket, nombre] = m;
      const datos = await leerCuerpo(req);
      await comoUsuario(claims, req, (c) => c.query("insert into storage.objects (bucket_id, name, owner) values ($1, $2, $3)", [bucket, nombre, claims.sub ?? null]));
      fs.writeFileSync(path.join(ARCHIVOS, crypto.createHash("sha1").update(bucket + "/" + nombre).digest("hex")), datos);
      return enviar(res, 200, { Key: `${bucket}/${nombre}`, Id: crypto.randomUUID() });
    }
    if (req.method === "DELETE" && (m = ruta.match(/^object\/([^/]+)$/))) {
      const body = JSON.parse((await leerCuerpo(req)).toString() || "{}");
      await comoUsuario(claims, req, (c) => c.query("delete from storage.objects where bucket_id = $1 and name = any($2)", [m[1], body.prefixes ?? []]));
      return enviar(res, 200, []);
    }
  } catch (e) {
    log.push({ url: url.pathname, error: e.message });
    return enviar(res, 400, { statusCode: "403", error: "Unauthorized", message: "new row violates row-level security policy" });
  }
  enviar(res, 404, { message: "no soportado" });
}

// ----------------------------- FUNCTIONS -----------------------------
async function functions(req, res, url) {
  const nombre = url.pathname.split("/").pop();
  if (nombre === "arca-factura") {
    // Sin certificado de ARCA: la función real respondería lo mismo (no simula CAE).
    const body = JSON.parse((await leerCuerpo(req)).toString() || "{}");
    if (body.accion === "estado") return enviar(res, 200, { ambiente: "homologacion", configurado: false, faltantes: ["certificado (ARCA_CERT)", "clave privada (ARCA_KEY)"], servidores: { error: "sin conexión (prueba local)" }, autenticacion: null });
    return enviar(res, 502, { error: "Falta configurar el certificado de ARCA (secretos ARCA_CERT y ARCA_KEY)" });
  }
  if (nombre === "gestionar-usuario") return enviar(res, 200, { ok: true });
  enviar(res, 404, { error: "función inexistente" });
}

// ----------------------------- servidor ------------------------------
export function crearUsuarioPrueba(email, clave) { claves.set(email.toLowerCase(), clave); }

export const servidor = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") { res.writeHead(204, CORS); return res.end(); }
  const url = new URL(req.url, "http://localhost");
  if (url.pathname.startsWith("/rest/v1/")) return rest(req, res, url);
  if (url.pathname.startsWith("/auth/v1/")) return auth(req, res, url);
  if (url.pathname.startsWith("/storage/v1/")) return storage(req, res, url);
  if (url.pathname.startsWith("/functions/v1/")) return functions(req, res, url);
  enviar(res, 404, { message: "ruta desconocida (mock)" });
});

if (import.meta.url === `file://${process.argv[1]}`) {
  servidor.listen(PORT, () => console.log(`Mock de Supabase en http://localhost:${PORT} · anon key: ${ANON_KEY}`));
}
