// Utilidades de interfaz: plantillas seguras, formatos, avisos, modales, tablas y formularios.
import { icon } from "./icons.js";

// ---------------------------------------------------------------------
// Plantillas HTML con escape automático (evita XSS con datos de la base)
// ---------------------------------------------------------------------
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(String(s ?? ""));
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
function render(v) {
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(render).join("");
  if (v === false || v === null || v === undefined) return "";
  return esc(v);
}
export function html(strings, ...vals) {
  let out = "";
  strings.forEach((s, i) => { out += s + (i < vals.length ? render(vals[i]) : ""); });
  return new Raw(out);
}
export const ic = (name, cls) => raw(icon(name, cls));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---------------------------------------------------------------------
// Formatos (es-AR)
// ---------------------------------------------------------------------
const fmtARS = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 2 });
const fmtUSD = new Intl.NumberFormat("es-AR", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
const fmtCompact = new Intl.NumberFormat("es-AR", { notation: "compact", maximumFractionDigits: 1 });
const fmtNum = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });
export const money = (n, moneda = "ARS") => (n === null || n === undefined || n === "" ? "—" : (moneda === "USD" ? fmtUSD : fmtARS).format(Number(n)));
export const moneyShort = (n) => "$ " + fmtCompact.format(Number(n || 0));
export const num = (n) => (n === null || n === undefined ? "—" : fmtNum.format(Number(n)));
export const pct = (n) => (n === null || n === undefined ? "—" : fmtNum.format(Number(n)) + " %");
export function fecha(v) {
  if (!v) return "—";
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { const [y, m, d] = s.split("-"); return `${d}/${m}/${y}`; }
  const d = new Date(s);
  return isNaN(d) ? "—" : d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
}
export function fechaHora(v) {
  if (!v) return "—";
  const d = new Date(v);
  return d.toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
export function hace(v) {
  const s = (Date.now() - new Date(v).getTime()) / 1000;
  if (s < 60) return "recién";
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  if (s < 86400 * 7) return `hace ${Math.floor(s / 86400)} d`;
  return fecha(v);
}
export const hoyISO = () => isoLocal(new Date());
export function isoLocal(d) { const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 10); }
export const sumarDias = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return isoLocal(d); };
export const diasEntre = (a, b) => Math.round((new Date(b + "T12:00:00") - new Date(a + "T12:00:00")) / 86400000);
export const cuitFmt = (c) => { const s = String(c ?? "").replace(/\D/g, ""); return s.length === 11 ? `${s.slice(0, 2)}-${s.slice(2, 10)}-${s.slice(10)}` : (c || "—"); };
export const iniciales = (n = "", a = "") => ((n[0] || "") + (a[0] || "")).toUpperCase() || "··";
export const tamano = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB");

export function cuitValido(c) {
  const s = String(c ?? "").replace(/\D/g, "");
  if (!/^\d{11}$/.test(s)) return false;
  const w = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = w.reduce((a, x, i) => a + x * Number(s[i]), 0);
  let dv = 11 - (suma % 11);
  if (dv === 11) dv = 0; else if (dv === 10) return false;
  return dv === Number(s[10]);
}

// ---------------------------------------------------------------------
// Estados → etiqueta + color
// ---------------------------------------------------------------------
export const ESTADOS = {
  operacion: {
    borrador: ["Borrador", ""], pendiente: ["Pendiente", "warn"], en_analisis: ["En análisis", "info"],
    aprobada: ["Aprobada", "accent"], activa: ["Activa", "ok"], en_mora: ["En mora", "danger"],
    finalizada: ["Finalizada", ""], cancelada: ["Cancelada", ""], rechazada: ["Rechazada", "danger"],
  },
  cliente: {
    prospecto: ["Prospecto", ""], en_evaluacion: ["En evaluación", "warn"], activo: ["Activo", "ok"],
    inactivo: ["Inactivo", ""], suspendido: ["Suspendido", "danger"], bloqueado: ["Bloqueado", "danger"],
  },
  documento: {
    en_revision: ["En revisión", "warn"], aprobado: ["Aprobado", "ok"], rechazado: ["Rechazado", "danger"],
    vencido: ["Vencido", "danger"], archivado: ["Archivado", ""],
  },
  requerido: { pendiente: ["Pendiente", "warn"], recibido: ["Recibido", "info"], cumplido: ["Cumplido", "ok"], dispensado: ["Dispensado", ""] },
  formulario: {
    pendiente: ["Pendiente", "warn"], completado: ["Completado", "info"], firmado: ["Firmado", "accent"],
    aprobado: ["Aprobado", "ok"], rechazado: ["Observado", "danger"], anulado: ["Anulado", ""],
  },
  factura: {
    borrador: ["Borrador · sin validez fiscal", ""], enviando: ["Enviando a ARCA", "info"],
    autorizada: ["Autorizada (CAE)", "ok"], rechazada: ["Rechazada por ARCA", "danger"], anulada: ["Anulada", ""],
  },
  cheque: {
    en_cartera: ["En cartera", "info"], depositado: ["Depositado", "accent"], acreditado: ["Acreditado", "ok"],
    rechazado: ["Rechazado", "danger"], devuelto: ["Devuelto", ""], endosado: ["Endosado", ""],
  },
  usuario: { pendiente: ["Pendiente", "warn"], activo: ["Activo", "ok"], rechazado: ["Rechazado", "danger"], suspendido: ["Suspendido", "danger"] },
  solicitud: { pendiente: ["Pendiente", "warn"], aprobada: ["Aprobada", "ok"], rechazada: ["Rechazada", "danger"] },
};
export function badge(tipo, estado) {
  const [label, tone] = ESTADOS[tipo]?.[estado] ?? [estado ?? "—", ""];
  return html`<span class="badge ${tone ? "badge--" + tone : ""}">${label}</span>`;
}
export const opciones = (tipo) => Object.entries(ESTADOS[tipo]).map(([v, [l]]) => ({ value: v, label: l }));

export const TIPOS_COMPROBANTE = {
  1: "Factura A", 2: "Nota de Débito A", 3: "Nota de Crédito A",
  6: "Factura B", 7: "Nota de Débito B", 8: "Nota de Crédito B",
  11: "Factura C", 12: "Nota de Débito C", 13: "Nota de Crédito C",
};
export const LETRA = { 1: "A", 2: "A", 3: "A", 6: "B", 7: "B", 8: "B", 11: "C", 12: "C", 13: "C" };
export const ALICUOTAS = { 3: "0 %", 4: "10,5 %", 5: "21 %", 6: "27 %", 8: "5 %", 9: "2,5 %", 2: "Exento", 1: "No gravado" };
export const MEDIOS = { transferencia: "Transferencia", efectivo: "Efectivo", cheque: "Cheque", echeq: "ECHEQ", compensacion: "Compensación", acreditacion_cheque: "Acreditación de cheque" };
export const CATEGORIAS = {
  intereses_cobrados: "Intereses cobrados", comisiones: "Comisiones", gastos_recuperados: "Gastos recuperados",
  desembolso: "Desembolsos", cobro_capital: "Cobro de capital", gasto_operativo: "Gasto operativo",
  impuestos: "Impuestos", honorarios: "Honorarios", servicios: "Servicios", sueldos: "Sueldos",
  otros_ingresos: "Otros ingresos", otros_egresos: "Otros egresos",
};
export const nroComprobante = (f) => f.numero ? `${String(f.punto_venta).padStart(5, "0")}-${String(f.numero).padStart(8, "0")}` : "Sin número";

// ---------------------------------------------------------------------
// Errores de Supabase → mensajes claros
// ---------------------------------------------------------------------
export function errMsg(e) {
  if (!e) return "Ocurrió un error inesperado.";
  const m = e.message || String(e);
  if (e.code === "42501" && /row-level security|permission denied/i.test(m)) return "No tenés permiso para realizar esta acción.";
  if (e.code === "23505") return "Ya existe un registro con esos datos (por ejemplo, el CUIT o el número).";
  if (e.code === "23503") return "El registro está vinculado a otros datos y no se puede modificar así.";
  if (e.code === "23514") return "Algún valor no es válido. Revisá los importes y las fechas.";
  if (/Failed to fetch|NetworkError/i.test(m)) return "No hay conexión con el servidor. Revisá tu conexión a internet.";
  if (/JWT expired/i.test(m)) return "Tu sesión venció. Volvé a ingresar.";
  return m;
}

// ---------------------------------------------------------------------
// Avisos
// ---------------------------------------------------------------------
export function toast(msg, tipo = "ok", ms = 4200) {
  let cont = $(".toasts");
  if (!cont) { cont = document.createElement("div"); cont.className = "toasts"; cont.setAttribute("aria-live", "polite"); document.body.append(cont); }
  const el = document.createElement("div");
  el.className = `toast toast--${tipo}`;
  el.innerHTML = html`${ic(tipo === "error" ? "xCircle" : tipo === "info" ? "info" : "checkCircle")}<div>${msg}</div>`;
  cont.append(el);
  setTimeout(() => { el.style.transition = "opacity .3s"; el.style.opacity = "0"; setTimeout(() => el.remove(), 320); }, ms);
}
export const toastError = (e) => toast(errMsg(e), "error", 6500);

// ---------------------------------------------------------------------
// Modales
// ---------------------------------------------------------------------
export function modal({ title, body = "", foot = "", size = "", onClose } = {}) {
  const bg = document.createElement("div");
  bg.className = "modal-bg";
  bg.innerHTML = html`<div class="modal ${size ? "modal--" + size : ""}" role="dialog" aria-modal="true" aria-labelledby="modal-t">
    <div class="modal__head"><h2 id="modal-t">${title}</h2><button class="btn-icon btn-icon--plain" data-close aria-label="Cerrar">${ic("x")}</button></div>
    <div class="modal__body">${body}</div>
    ${foot ? html`<div class="modal__foot">${foot}</div>` : ""}
  </div>`;
  const prevFocus = document.activeElement;
  const close = () => { bg.remove(); document.removeEventListener("keydown", onKey); prevFocus?.focus?.(); onClose?.(); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  bg.addEventListener("click", (e) => { if (e.target === bg || e.target.closest("[data-close]")) close(); });
  document.addEventListener("keydown", onKey);
  document.body.append(bg);
  // Foco inicial en el primer campo, salvo que el usuario ya esté escribiendo en otro
  setTimeout(() => { if (!bg.contains(document.activeElement)) (bg.querySelector("input:not([type=hidden]), select, textarea") || bg.querySelector(".modal"))?.focus?.(); }, 30);
  return { el: bg, body: bg.querySelector(".modal__body"), close };
}

export function confirmar(texto, { titulo = "Confirmar", ok = "Confirmar", peligro = false } = {}) {
  return new Promise((resolve) => {
    let r = false;
    const m = modal({
      title: titulo, body: html`<p class="muted">${texto}</p>`,
      foot: html`<button class="btn btn--ghost" data-close>Cancelar</button><button class="btn ${peligro ? "btn--danger" : ""}" data-ok>${ok}</button>`,
      onClose: () => resolve(r),
    });
    m.el.querySelector("[data-ok]").addEventListener("click", () => { r = true; m.close(); });
  });
}

export function pedirTexto({ titulo, etiqueta, requerido = true, ok = "Aceptar", multilinea = true, valor = "" }) {
  return new Promise((resolve) => {
    let r = null;
    const m = modal({
      title: titulo,
      body: html`<form class="form" id="pt-form">${campo({ name: "t", label: etiqueta, type: multilinea ? "textarea" : "text", required: requerido, value: valor })}</form>`,
      foot: html`<button class="btn btn--ghost" data-close>Cancelar</button><button class="btn" form="pt-form">${ok}</button>`,
      onClose: () => resolve(r),
    });
    m.el.querySelector("form").addEventListener("submit", (e) => {
      e.preventDefault();
      const v = e.target.t.value.trim();
      if (requerido && !v) { e.target.t.setAttribute("aria-invalid", "true"); return; }
      r = v; m.close();
    });
  });
}

// ---------------------------------------------------------------------
// Formularios
// ---------------------------------------------------------------------
/** Genera un campo de formulario. type: text|email|number|money|date|select|textarea|checkbox|cuit|tel|password */
export function campo({ name, label, type = "text", value = "", required = false, options = [], help = "", col = "", placeholder = "", min, max, step, attrs = "", disabled = false }) {
  const req = required ? raw(" required") : "";
  const dis = disabled ? raw(" disabled") : "";
  const ex = raw(attrs);
  const id = "f-" + name + "-" + Math.random().toString(36).slice(2, 7);
  let ctrl;
  if (type === "select") {
    ctrl = html`<select class="select" id="${id}" name="${name}"${req}${dis}${ex}>
      ${options.map((o) => { const opt = typeof o === "object" ? o : { value: o, label: o };
        return html`<option value="${opt.value}" ${String(opt.value) === String(value ?? "") ? raw("selected") : ""}>${opt.label}</option>`; })}
    </select>`;
  } else if (type === "textarea") {
    ctrl = html`<textarea class="textarea" id="${id}" name="${name}" placeholder="${placeholder}"${req}${dis}${ex}>${value ?? ""}</textarea>`;
  } else if (type === "checkbox") {
    return html`<label class="check ${col}"><input type="checkbox" name="${name}" ${value ? raw("checked") : ""}${dis}${ex}> <span>${label}</span></label>`;
  } else {
    const t = type === "money" ? "number" : type === "cuit" ? "text" : type;
    const st = step ?? (type === "money" ? "0.01" : type === "number" ? "any" : "");
    const extra = type === "cuit" ? raw(' inputmode="numeric" maxlength="13" data-cuit') : type === "money" ? raw(' inputmode="decimal"') : "";
    ctrl = html`<input class="input" id="${id}" name="${name}" type="${t}" value="${value ?? ""}" placeholder="${placeholder}"
      ${min !== undefined ? raw(`min="${esc(min)}"`) : ""} ${max !== undefined ? raw(`max="${esc(max)}"`) : ""} ${st ? raw(`step="${esc(st)}"`) : ""}${extra}${req}${dis}${ex}>`;
  }
  return html`<label class="field ${col}" for="${id}"><span>${label}${required ? html`<i>*</i>` : ""}</span>${ctrl}${help ? html`<small>${help}</small>` : ""}</label>`;
}

/** Lee un formulario: strings recortados, vacíos → null, números para type=number, booleanos para checkbox. */
export function leerForm(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === "checkbox") out[el.name] = el.checked;
    else if (el.type === "number") out[el.name] = el.value === "" ? null : Number(el.value);
    else if (el.type === "file") continue;
    else { const v = el.value.trim(); out[el.name] = v === "" ? null : (el.dataset.cuit !== undefined ? v.replace(/\D/g, "") : v); }
  }
  return out;
}

/** Valida con las reglas HTML5 + CUIT. Marca los campos y devuelve true/false. */
export function validarForm(form) {
  let ok = true; let primero = null;
  for (const el of form.elements) {
    if (!el.name || el.disabled || el.type === "hidden") continue;
    let valido = el.checkValidity();
    if (valido && el.dataset.cuit !== undefined && el.value.trim()) valido = cuitValido(el.value);
    el.setAttribute("aria-invalid", valido ? "false" : "true");
    if (!valido) { ok = false; primero ??= el; }
  }
  primero?.focus();
  return ok;
}

export function bindCuit(root) {
  root.querySelectorAll("[data-cuit]").forEach((el) => el.addEventListener("input", () => {
    const d = el.value.replace(/\D/g, "").slice(0, 11);
    el.value = d.length > 10 ? `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}` : d.length > 2 ? `${d.slice(0, 2)}-${d.slice(2)}` : d;
  }));
}

/** Botón en estado "cargando" mientras corre una promesa. */
export async function conCarga(btn, fn) {
  if (!btn) return fn();
  const prev = btn.innerHTML; btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span>' + btn.textContent.trim();
  try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = prev; }
}

// ---------------------------------------------------------------------
// Tablas
// ---------------------------------------------------------------------
/**
 * Listado con búsqueda, filtros, orden y paginación (del lado del cliente).
 * columns: [{ key, label, render(row), align: 'right', sort: true|fn, csv(row) }]
 */
export function listado(container, { columns, rows = [], buscar = [], filtros = [], porPagina = 15, onRow, vacio = "No hay registros", acciones = "", exportar = null, cards = true, pie = null }) {
  const st = { q: "", f: {}, sort: null, dir: 1, page: 0, rows };
  container.innerHTML = html`
    <div class="toolbar">
      ${buscar.length ? html`<label class="input-wrap">${ic("search")}<input class="input" type="search" placeholder="Buscar…" data-q aria-label="Buscar"></label>` : ""}
      ${filtros.map((f) => html`<select class="select" data-f="${f.key}" aria-label="${f.label}">
        <option value="">${f.label}: todos</option>${f.options.map((o) => html`<option value="${o.value}">${o.label}</option>`)}</select>`)}
      <span class="spacer"></span>
      ${exportar ? html`<button class="btn btn--ghost btn--sm" data-csv>${ic("download", "ico-sm")} CSV</button>` : ""}
      ${acciones}
    </div>
    <div class="card"><div class="table-wrap" data-tabla></div><div data-pager></div></div>`;

  const filtrar = () => {
    let r = st.rows;
    if (st.q) {
      const q = st.q.toLowerCase();
      r = r.filter((x) => buscar.some((k) => String(typeof k === "function" ? k(x) : x[k] ?? "").toLowerCase().includes(q)));
    }
    for (const [k, v] of Object.entries(st.f)) if (v) r = r.filter((x) => String(x[k]) === v);
    if (st.sort) {
      const col = columns.find((c) => c.key === st.sort);
      const get = typeof col.sort === "function" ? col.sort : (x) => x[col.key];
      r = [...r].sort((a, b) => { const A = get(a), B = get(b); return (A > B ? 1 : A < B ? -1 : 0) * st.dir; });
    }
    return r;
  };

  const pintar = () => {
    const r = filtrar();
    const pages = Math.max(1, Math.ceil(r.length / porPagina));
    st.page = Math.min(st.page, pages - 1);
    const vis = r.slice(st.page * porPagina, (st.page + 1) * porPagina);
    container.querySelector("[data-tabla]").innerHTML = r.length ? html`
      <table class="table ${cards ? "table--cards" : ""}">
        <thead><tr>${columns.map((c) => html`<th class="${c.sort !== false ? "sortable" : ""} ${c.align === "right" ? "th-right" : ""}" data-sort="${c.key}">${c.label}${st.sort === c.key ? html`<span class="arrow">${st.dir > 0 ? "↑" : "↓"}</span>` : ""}</th>`)}</tr></thead>
        <tbody>${vis.map((x, i) => html`<tr class="${onRow ? "clickable" : ""}" data-i="${st.page * porPagina + i}">${columns.map((c) =>
          html`<td class="${c.align === "right" ? "right num" : ""}" data-label="${c.label}">${c.render ? c.render(x) : x[c.key] ?? "—"}</td>`)}</tr>`)}</tbody>
        ${pie ? html`<tfoot>${pie(r)}</tfoot>` : ""}
      </table>` : html`<div class="empty">${ic("inbox")}<b>${vacio}</b>${st.q || Object.values(st.f).some(Boolean) ? "Probá con otros filtros." : ""}</div>`;
    container.querySelector("[data-pager]").innerHTML = r.length > porPagina ? html`
      <div class="pager"><span>${r.length} registros · página ${st.page + 1} de ${pages}</span>
        <span class="row"><button class="btn-icon" data-pg="-1" aria-label="Anterior" ${st.page === 0 ? raw("disabled") : ""}>${ic("chevronLeft")}</button>
        <button class="btn-icon" data-pg="1" aria-label="Siguiente" ${st.page >= pages - 1 ? raw("disabled") : ""}>${ic("chevronRight")}</button></span></div>` : r.length ? html`<div class="pager"><span>${r.length} registros</span></div>` : "";
    st.visibles = r;
  };

  container.addEventListener("input", (e) => {
    if (e.target.matches("[data-q]")) { st.q = e.target.value.trim(); st.page = 0; pintar(); }
  });
  container.addEventListener("change", (e) => {
    if (e.target.matches("[data-f]")) { st.f[e.target.dataset.f] = e.target.value; st.page = 0; pintar(); }
  });
  container.addEventListener("click", (e) => {
    const th = e.target.closest("th[data-sort]");
    if (th && th.classList.contains("sortable")) { st.dir = st.sort === th.dataset.sort ? -st.dir : 1; st.sort = th.dataset.sort; pintar(); return; }
    const pg = e.target.closest("[data-pg]");
    if (pg) { st.page += Number(pg.dataset.pg); pintar(); return; }
    if (e.target.closest("[data-csv]")) {
      descargarCSV(exportar, st.visibles, columns.filter((c) => c.csv !== false));
      return;
    }
    const tr = e.target.closest("tr[data-i]");
    if (tr && onRow && !e.target.closest("a, button, input, select")) onRow(st.visibles[Number(tr.dataset.i)]);
  });
  pintar();
  return { set(rows) { st.rows = rows; pintar(); }, filtrados: () => filtrar() };
}

export function tablaSimple(columns, rows, { vacio = "Sin registros", pie = null, cards = true, onRowAttr = null } = {}) {
  if (!rows?.length) return html`<div class="empty">${ic("inbox")}<b>${vacio}</b></div>`;
  return html`<div class="table-wrap"><table class="table ${cards ? "table--cards" : ""}">
    <thead><tr>${columns.map((c) => html`<th class="${c.align === "right" ? "th-right" : ""}">${c.label}</th>`)}</tr></thead>
    <tbody>${rows.map((x) => html`<tr ${onRowAttr ? raw(onRowAttr(x)) : ""}>${columns.map((c) => html`<td class="${c.align === "right" ? "right num" : ""}" data-label="${c.label}">${c.render ? c.render(x) : x[c.key] ?? "—"}</td>`)}</tr>`)}</tbody>
    ${pie ? html`<tfoot>${pie}</tfoot>` : ""}
  </table></div>`;
}

export function descargarCSV(nombre, rows, columns) {
  const limpiar = (v) => {
    let s = v instanceof Raw ? v.s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : String(v ?? "");
    s = s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    if (/^[=+\-@]/.test(s)) s = "'" + s;          // evita inyección de fórmulas en Excel
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const lineas = [columns.map((c) => limpiar(c.label)).join(";")];
  for (const r of rows) lineas.push(columns.map((c) => limpiar(c.csv ? c.csv(r) : c.render ? c.render(r) : r[c.key])).join(";"));
  const blob = new Blob(["﻿" + lineas.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${nombre}-${hoyISO()}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export const vacio = (titulo, texto = "", iconName = "inbox") => html`<div class="empty">${ic(iconName)}<b>${titulo}</b>${texto}</div>`;
export const cargando = () => html`<div class="stack"><div class="skeleton" style="height:96px"></div><div class="skeleton" style="height:260px"></div></div>`;
export const demoTag = (row) => (row?.es_demo ? html` <span class="demo-flag">Demo</span>` : "");

/** Reemplaza el contenedor de una pestaña por uno nuevo (descarta listeners viejos). */
export function panelNuevo(sel = "#panel") {
  const viejo = document.querySelector(sel);
  const nuevo = document.createElement("div");
  if (!viejo) return nuevo;            // el usuario ya cambió de sección: se dibuja fuera de pantalla
  nuevo.id = viejo.id;
  viejo.replaceWith(nuevo);
  return nuevo;
}

/** Reemplaza la URL (sin navegar) sólo si el usuario sigue en la misma sección. */
export function reemplazarHash(base, nuevo) {
  if (location.hash.split("?")[0] === base) history.replaceState(null, "", nuevo);
}

/** Pestañas: devuelve html y conecta el cambio. */
export function tabs(container, items, actual, onChange) {
  container.innerHTML = html`${items.map((t) => html`<button type="button" class="${t.id === actual ? "is-on" : ""}" data-tab="${t.id}">${t.label}${t.count ? html`<span class="count">${t.count}</span>` : ""}</button>`)}`;
  container.onclick = (e) => {
    const b = e.target.closest("[data-tab]"); if (!b) return;
    container.querySelectorAll("button").forEach((x) => x.classList.toggle("is-on", x === b));
    onChange(b.dataset.tab);
  };
}
