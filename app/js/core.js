// Conexión con Supabase, sesión del usuario y protección de las áreas privadas.
//
// La URL del proyecto y la clave pública (anon / publishable) se leen de:
//   1) window.BBX_CONFIG (archivo /app/config.js), o
//   2) /api/config (función de Vercel que lee las variables de entorno).
// Nunca se usa la clave service_role en el navegador.
import { html, ic, esc } from "./ui.js";
import { ensureSprite, logo } from "./icons.js";
import { debeMostrarse, iniciarBienvenida } from "./bienvenida.js";

let _sb = null;
let _cfg = null;
export const estado = { user: null, perfil: null, permisos: new Set(), cliente: null };

const INACTIVIDAD_MIN = 30;   // cierre de sesión automático por inactividad

export async function cargarConfig() {
  if (_cfg) return _cfg;
  const w = window.BBX_CONFIG;
  if (w?.supabaseUrl && w?.supabaseAnonKey) return (_cfg = w);
  try {
    const r = await fetch("/api/config", { cache: "no-store" });
    if (r.ok) {
      const c = await r.json();
      if (c.supabaseUrl && c.supabaseAnonKey) return (_cfg = c);
    }
  } catch { /* sin función de config (desarrollo local) */ }
  return null;
}

export async function sb() {
  if (_sb) return _sb;
  const cfg = await cargarConfig();
  if (!cfg) throw new Error("SIN_CONFIG");
  if (/service_role/.test(atobSeguro(cfg.supabaseAnonKey))) {
    throw new Error("La clave configurada es service_role: nunca debe usarse en el navegador.");
  }
  _sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce", storageKey: "bbx-auth" },
    global: { headers: { "x-client-info": "bbx-plataforma/1.0" } },
  });
  return _sb;
}

function atobSeguro(jwt) {
  try { return atob(String(jwt).split(".")[1].replace(/-/g, "+").replace(/_/g, "/")); } catch { return ""; }
}

export const tiene = (p) => estado.perfil?.rol === "superadmin" || estado.permisos.has(p);
export const esStaff = () => estado.perfil && estado.perfil.rol !== "cliente" && estado.perfil.estado === "activo";

export async function registrar(accion, detalle = null) {
  try { await (await sb()).rpc("registrar_actividad", { p_accion: accion, p_detalle: detalle }); } catch { /* no bloqueante */ }
}

export async function salir(motivo) {
  try { await registrar("logout", motivo ? { motivo } : null); await (await sb()).auth.signOut(); } catch { /* sigue */ }
  location.replace("/acceso/" + (motivo ? "?motivo=" + encodeURIComponent(motivo) : ""));
}

/** Pantalla de carga con el logo */
export function splash() {
  ensureSprite();
  let el = document.querySelector(".splash");
  if (!el) { el = document.createElement("div"); el.className = "splash"; el.innerHTML = logo(); document.body.append(el); }
  return () => el.remove();
}

export function pantallaMensaje({ icono = "info", titulo, texto, acciones = "" }) {
  document.body.innerHTML = "";
  ensureSprite();
  const div = document.createElement("div");
  div.className = "center-screen";
  div.innerHTML = html`<div class="card center-card">${ic(icono)}<h1>${titulo}</h1><p>${texto}</p><div class="row" style="justify-content:center">${acciones}</div></div>`;
  document.body.append(div);
}

export function pantallaSinConfig() {
  pantallaMensaje({
    icono: "settings",
    titulo: "Falta conectar Supabase",
    texto: html`Configurá <b>SUPABASE_URL</b> y <b>SUPABASE_ANON_KEY</b> como variables de entorno en Vercel, o completá <code>/app/config.js</code> para desarrollo local. Ver <code>docs/INSTALACION.md</code>.`,
    acciones: html`<a class="btn btn--ghost" href="/">Volver al sitio</a>`,
  });
}

/**
 * Protege un área. area = 'admin' | 'portal'.
 * Verifica sesión, perfil, estado y rol; si algo no corresponde, redirige.
 */
export async function proteger(area) {
  // Después de iniciar sesión se muestra la bienvenida animada; si no, la pantalla de carga simple.
  ensureSprite();
  const bienvenida = debeMostrarse() ? iniciarBienvenida() : null;
  const quitar = bienvenida ? () => bienvenida.listo() : splash();
  let cliente;
  try { cliente = await sb(); } catch (e) {
    if (e.message === "SIN_CONFIG") return pantallaSinConfig();
    return pantallaMensaje({ icono: "alert", titulo: "Error de configuración", texto: esc(e.message) });
  }
  const { data: { session } } = await cliente.auth.getSession();
  if (!session) {
    location.replace("/acceso/?next=" + encodeURIComponent(location.pathname + location.hash));
    return null;
  }
  estado.user = session.user;

  const { data: perfil, error } = await cliente.from("perfiles").select("*").eq("id", session.user.id).maybeSingle();
  if (error || !perfil) {
    quitar();
    pantallaMensaje({ icono: "alert", titulo: "No pudimos cargar tu perfil", texto: "Intentá de nuevo en unos minutos.",
      acciones: html`<button class="btn" id="reintentar">Reintentar</button>` });
    document.getElementById("reintentar").onclick = () => location.reload();
    return null;
  }
  estado.perfil = perfil;
  bienvenida?.saludar(perfil.nombre, perfil.rol === "cliente" ? "portal" : "admin");

  if (perfil.estado === "suspendido" || perfil.estado === "rechazado") {
    quitar();
    pantallaMensaje({ icono: "lock", titulo: perfil.estado === "suspendido" ? "Acceso suspendido" : "Solicitud rechazada",
      texto: "Tu acceso no está habilitado. Si creés que es un error, comunicate con BBX.",
      acciones: html`<button class="btn btn--ghost" id="salir">Cerrar sesión</button>` });
    document.getElementById("salir").onclick = () => salir();
    return null;
  }

  const interno = perfil.rol !== "cliente";
  if (area === "admin" && !interno) { location.replace("/portal/"); return null; }
  if (area === "portal" && interno) { location.replace("/admin/"); return null; }

  if (perfil.estado === "pendiente") {
    quitar();
    pantallaMensaje({ icono: "clock", titulo: "Tu solicitud está en revisión",
      texto: "Recibimos tu registro. Un asesor de BBX lo va a revisar y te avisaremos por email cuando tu acceso esté habilitado.",
      acciones: html`<a class="btn btn--ghost" href="/">Ir al sitio</a><button class="btn btn--ghost" id="salir">Cerrar sesión</button>` });
    document.getElementById("salir").onclick = () => salir();
    return null;
  }

  if (interno) {
    const { data: permisos } = await cliente.rpc("mis_permisos");
    estado.permisos = new Set(permisos ?? []);
  } else if (perfil.cliente_id) {
    const { data: c } = await cliente.from("v_clientes").select("*").eq("id", perfil.cliente_id).maybeSingle();
    estado.cliente = c;
  }

  cliente.auth.onAuthStateChange((ev) => { if (ev === "SIGNED_OUT") location.replace("/acceso/"); });
  vigilarInactividad();
  quitar();
  return { sb: cliente, ...estado };
}

function vigilarInactividad() {
  let t;
  const reset = () => { clearTimeout(t); t = setTimeout(() => salir("inactividad"), INACTIVIDAD_MIN * 60 * 1000); };
  ["pointerdown", "keydown", "scroll", "visibilitychange"].forEach((ev) => addEventListener(ev, reset, { passive: true }));
  reset();
}

/** Sube un archivo a Storage y devuelve su ruta. */
export async function subirArchivo(bucket, carpeta, file) {
  const cliente = await sb();
  const limpio = file.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.\-]+/g, "_").slice(-80);
  const ruta = `${carpeta}/${crypto.randomUUID()}-${limpio}`;
  const { error } = await cliente.storage.from(bucket).upload(ruta, file, { contentType: file.type, upsert: false });
  if (error) throw error;
  return ruta;
}

/** Abre un archivo privado con una URL firmada de 60 segundos. */
export async function abrirArchivo(bucket, ruta, nombre) {
  const cliente = await sb();
  const { data, error } = await cliente.storage.from(bucket).createSignedUrl(ruta, 60, nombre ? { download: nombre } : undefined);
  if (error) throw error;
  registrar("descarga", { bucket, ruta });
  window.open(data.signedUrl, "_blank", "noopener");
}

export const TIPOS_ARCHIVO = ".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx";
export const MAX_ARCHIVO = 15 * 1024 * 1024;
export function validarArchivo(file) {
  const okTipo = /\.(pdf|jpe?g|png|webp|docx|xlsx)$/i.test(file.name);
  if (!okTipo) return "Formato no permitido. Usá PDF, JPG, PNG, WEBP, DOCX o XLSX.";
  if (file.size > MAX_ARCHIVO) return "El archivo supera los 15 MB.";
  return null;
}
