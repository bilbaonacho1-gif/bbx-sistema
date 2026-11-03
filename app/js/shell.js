// Estructura común del panel y del portal: barra lateral, encabezado,
// notificaciones en tiempo real y router por hash (#/ruta/:param).
import { html, ic, esc, hace, raw, iniciales, toastError, $ } from "./ui.js";
import { ensureSprite, logo } from "./icons.js";
import { estado, salir, tiene } from "./core.js";

/**
 * nav: [{ grupo } | { path, label, icon, permiso, badge: async()=>n }]
 * rutas: [{ path: '/clientes/:id', view: () => import(...) }]
 */
export function iniciarShell({ sb, area, nav, rutas, inicio }) {
  ensureSprite();
  const p = estado.perfil;
  const nombre = [p.nombre, p.apellido].filter(Boolean).join(" ") || p.email;
  const subtitulo = area === "admin" ? rolNombre(p.rol) : (estado.cliente?.razon_social ?? "Cliente");
  const items = nav.filter((n) => n.grupo || !n.permiso || tiene(n.permiso));
  // Quitar títulos de grupo que quedaron vacíos
  const visibles = items.filter((n, i) => !n.grupo || (items[i + 1] && !items[i + 1].grupo));

  // Se conserva la bienvenida animada (si se está reproduciendo) al dibujar la estructura
  [...document.body.children].forEach((n) => { if (!n.classList.contains("bienvenida") && !n.querySelector?.("#bbx-logo")) n.remove(); });
  document.body.insertAdjacentHTML("afterbegin", html`
  <a class="sr" href="#contenido">Saltar al contenido</a>
  <div class="app" id="app">
    <aside class="side" id="side" aria-label="Navegación">
      <a class="side__brand" href="#/${inicio}" aria-label="Inicio">${raw(logo())}<span><small>${area === "admin" ? "Panel interno" : "Portal de clientes"}</small></span></a>
      <nav class="side__nav">
        ${visibles.map((n) => n.grupo ? html`<div class="side__group">${n.grupo}</div>` :
          html`<a class="side__link" href="#${n.path}" data-path="${n.path}">${ic(n.icon)}<span>${n.label}</span>${n.badge ? html`<span class="count" data-badge="${n.path}" hidden></span>` : ""}</a>`)}
      </nav>
      <div class="side__user">
        <span class="avatar">${iniciales(p.nombre, p.apellido)}</span>
        <span style="min-width:0"><b>${nombre}</b><span>${subtitulo}</span></span>
        <button class="btn-icon btn-icon--plain" id="btn-salir" title="Cerrar sesión" aria-label="Cerrar sesión">${ic("logout")}</button>
      </div>
    </aside>
    <div class="main">
      <header class="top" id="top">
        <button class="btn-icon menu-toggle" id="btn-menu" aria-label="Abrir menú" aria-controls="side" aria-expanded="false">${ic("menu")}</button>
        <div class="top__title"><h1 id="titulo">…</h1><p id="subtitulo"></p></div>
        <div class="top__actions">
          <span id="acciones-top" class="row"></span>
          <div class="rel">
            <button class="btn-icon" id="btn-notif" aria-label="Notificaciones" aria-haspopup="true" aria-expanded="false">${ic("bell")}<span class="dot" id="notif-dot" hidden></span></button>
            <div id="notif-panel" hidden></div>
          </div>
        </div>
      </header>
      <main class="view" id="contenido" tabindex="-1"></main>
    </div>
  </div>`.toString());

  ensureSprite();   // el body se reemplazó: volver a insertar el logo
  const app = $("#app");
  $("#btn-salir").onclick = () => salir();
  $("#btn-menu").onclick = () => {
    const open = app.classList.toggle("nav-open");
    $("#btn-menu").setAttribute("aria-expanded", String(open));
  };
  app.addEventListener("click", (e) => {
    if (app.classList.contains("nav-open") && (e.target === app || e.target.closest(".side__link"))) app.classList.remove("nav-open");
  });
  addEventListener("scroll", () => $("#top").classList.toggle("is-scrolled", scrollY > 4), { passive: true });

  notificaciones(sb);
  actualizarBadges(nav);
  setInterval(() => actualizarBadges(nav), 120000);

  // ------------------------- Router -------------------------
  const compiladas = rutas.map((r) => ({ ...r, re: new RegExp("^" + r.path.replace(/:(\w+)/g, "(?<$1>[^/]+)") + "$") }));
  let limpiar = null;
  async function navegar() {
    const [ruta, qs] = (location.hash.slice(1) || "/" + inicio).split("?");
    const query = Object.fromEntries(new URLSearchParams(qs || ""));
    const match = compiladas.map((r) => ({ r, m: ruta.match(r.re) })).find((x) => x.m);
    if (!match) { location.hash = "#/" + inicio; return; }
    if (match.r.permiso && !tiene(match.r.permiso)) { location.hash = "#/" + inicio; return; }
    document.querySelectorAll(".side__link").forEach((a) => a.classList.toggle("is-active", ruta === a.dataset.path || ruta.startsWith(a.dataset.path + "/")));
    limpiar?.(); limpiar = null;
    const cont = $("#contenido");
    $("#acciones-top").innerHTML = "";
    cont.innerHTML = html`<div class="stack"><div class="skeleton" style="height:96px"></div><div class="skeleton" style="height:300px"></div></div>`;
    try {
      const mod = await match.r.view();
      const ctx = { sb, params: match.m.groups ?? {}, query, titulo, acciones: (h) => { $("#acciones-top").innerHTML = String(h); }, refrescar: navegar };
      // Cada vista recibe un contenedor nuevo: así no se acumulan listeners entre recargas
      const vista = document.createElement("div");
      cont.replaceChildren(vista);
      cont.style.animation = "none"; void cont.offsetWidth; cont.style.animation = "";
      limpiar = (await mod.default(vista, ctx)) || null;
      scrollTo({ top: 0 });
    } catch (e) {
      console.error(e);
      cont.innerHTML = html`<div class="callout callout--danger">${ic("alert")}<div><b>No se pudo cargar esta sección.</b><br>${esc(e.message || e)}</div></div>`;
    }
  }
  addEventListener("hashchange", navegar);
  navegar();
}

export function titulo(t, sub = "") {
  $("#titulo").textContent = t;
  $("#subtitulo").textContent = sub;
  document.title = `${t} · BBX`;
}

const ROLES = { superadmin: "Superadministrador", administrador: "Administrador", operador: "Operador comercial", contable: "Contable", consulta: "Consulta", cliente: "Cliente" };
export const rolNombre = (r) => ROLES[r] ?? r;

async function actualizarBadges(nav) {
  for (const n of nav) {
    if (!n.badge || (n.permiso && !tiene(n.permiso))) continue;
    try {
      const v = await n.badge();
      const el = document.querySelector(`[data-badge="${n.path}"]`);
      if (el) { el.textContent = v; el.hidden = !v; }
    } catch { /* silencioso */ }
  }
}

// ---------------------------------------------------------------------
// Notificaciones (Realtime + respaldo por intervalo)
// ---------------------------------------------------------------------
function notificaciones(sb) {
  const btn = $("#btn-notif"), panel = $("#notif-panel"), dot = $("#notif-dot");
  let lista = [];
  const cargar = async () => {
    const { data } = await sb.from("notificaciones").select("*").order("created_at", { ascending: false }).limit(30);
    lista = data ?? [];
    dot.hidden = !lista.some((n) => !n.leida_at);
    if (!panel.hidden) pintar();
  };
  const pintar = () => {
    panel.className = "notif-panel";
    panel.innerHTML = html`<header><b>Notificaciones</b>${lista.some((n) => !n.leida_at) ? html`<button class="link-btn" id="notif-leer">Marcar todas como leídas</button>` : ""}</header>
      ${lista.length ? html`<ul>${lista.map((n) => html`<li class="${n.leida_at ? "" : "unread"}"><a href="${n.enlace || "#"}" data-id="${n.id}"><b>${n.titulo}</b><span class="muted">${n.mensaje ?? ""}</span><time>${hace(n.created_at)}</time></a></li>`)}</ul>`
        : html`<div class="empty">${ic("bell")}<b>Sin notificaciones</b></div>`}`;
  };
  btn.onclick = (e) => {
    e.stopPropagation();
    panel.hidden = !panel.hidden;
    btn.setAttribute("aria-expanded", String(!panel.hidden));
    if (!panel.hidden) pintar();
  };
  panel.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (e.target.closest("#notif-leer")) {
      await sb.rpc("marcar_notificaciones_leidas", { p_ids: null });
      return cargar();
    }
    const a = e.target.closest("a[data-id]");
    if (a) {
      sb.rpc("marcar_notificaciones_leidas", { p_ids: [a.dataset.id] }).then(cargar);
      panel.hidden = true;
    }
  });
  document.addEventListener("click", () => { panel.hidden = true; btn.setAttribute("aria-expanded", "false"); });

  cargar().catch(toastError);
  setInterval(cargar, 60000);
  try {
    sb.channel("notif-" + estado.user.id)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notificaciones", filter: `destinatario_id=eq.${estado.user.id}` }, cargar)
      .subscribe();
  } catch { /* sin realtime: queda el intervalo */ }
}
