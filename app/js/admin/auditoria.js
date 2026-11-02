// Auditoría de cambios y registro de actividad de los usuarios.
import { html, ic, fechaHora, listado, modal, tabs, toastError, $, panelNuevo } from "../ui.js";

const TABLAS = ["clientes", "empresas", "contactos", "operaciones", "cheques", "acuerdos", "pagos", "movimientos_contables", "facturas", "documentos", "formularios", "firmas", "perfiles", "rol_permisos", "configuracion", "arca_config"];
const ACCIONES = { INSERT: ["Alta", "ok"], UPDATE: ["Modificación", "info"], DELETE: ["Baja", "danger"] };

export default async function (el, { sb, titulo }) {
  titulo("Auditoría", "Quién cambió qué y cuándo");
  el.innerHTML = html`<div class="tabs" id="tabs"></div><div id="panel"></div>`;
  const ver = {
    cambios: async () => {
      const { data, error } = await sb.from("auditoria").select("*").order("created_at", { ascending: false }).limit(1000);
      if (error) throw error;
      listado(panelNuevo("#panel"), {
        rows: data, buscar: ["tabla", "usuario_email", "registro_id", "ip"], exportar: "auditoria", porPagina: 25,
        filtros: [{ key: "tabla", label: "Tabla", options: TABLAS.map((t) => ({ value: t, label: t })) }, { key: "accion", label: "Acción", options: Object.entries(ACCIONES).map(([value, [label]]) => ({ value, label })) }],
        onRow: detalle, vacio: "Sin registros",
        columns: [
          { key: "created_at", label: "Fecha", render: (a) => fechaHora(a.created_at), csv: (a) => a.created_at },
          { key: "usuario_email", label: "Usuario", render: (a) => html`${a.usuario_email ?? html`<span class="muted">${a.rol_db === "service_role" ? "Sistema (servidor)" : "Sistema"}</span>`}<small>${a.ip ?? ""}</small>`, csv: (a) => a.usuario_email ?? a.rol_db },
          { key: "accion", label: "Acción", render: (a) => html`<span class="badge badge--${ACCIONES[a.accion][1]}">${ACCIONES[a.accion][0]}</span>`, csv: (a) => a.accion },
          { key: "tabla", label: "Tabla", render: (a) => html`<span class="mono">${a.tabla}</span>` , csv: (a) => a.tabla },
          { key: "cambios", label: "Campos modificados", sort: false, render: (a) => (a.cambios ? Object.keys(a.cambios).slice(0, 4).join(", ") + (Object.keys(a.cambios).length > 4 ? "…" : "") : "—"), csv: (a) => (a.cambios ? Object.keys(a.cambios).join(" ") : "") },
        ],
      });
    },
    actividad: async () => {
      const { data, error } = await sb.from("registro_actividad").select("*, perfiles:usuario_id(email, nombre, apellido)").order("created_at", { ascending: false }).limit(1000);
      if (error) throw error;
      listado(panelNuevo("#panel"), {
        rows: data, buscar: [(r) => r.perfiles?.email, "accion", "ip"], exportar: "actividad", porPagina: 25, vacio: "Sin actividad",
        filtros: [{ key: "accion", label: "Acción", options: [...new Set(data.map((r) => r.accion))].map((a) => ({ value: a, label: a })) }],
        columns: [
          { key: "created_at", label: "Fecha", render: (r) => fechaHora(r.created_at), csv: (r) => r.created_at },
          { key: "usuario", label: "Usuario", render: (r) => r.perfiles?.email ?? "—", csv: (r) => r.perfiles?.email },
          { key: "accion", label: "Acción", render: (r) => html`<span class="tag">${r.accion}</span>`, csv: (r) => r.accion },
          { key: "ip", label: "IP", render: (r) => html`<span class="mono">${r.ip ?? "—"}</span>` },
          { key: "user_agent", label: "Navegador", render: (r) => html`<small>${(r.user_agent ?? "").slice(0, 70)}</small>` },
        ],
      });
    },
  };
  tabs($("#tabs"), [{ id: "cambios", label: "Cambios en los datos" }, { id: "actividad", label: "Actividad de usuarios" }], "cambios", (t) => ver[t]().catch(toastError));
  await ver.cambios();
}

function detalle(a) {
  const filas = a.cambios
    ? Object.entries(a.cambios).map(([k, v]) => [k, v.antes, v.despues])
    : Object.entries(a.datos_despues ?? a.datos_antes ?? {}).map(([k, v]) => [k, a.accion === "DELETE" ? v : null, a.accion === "INSERT" ? v : null]);
  const fmt = (v) => (v === null || v === undefined ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));
  modal({
    title: `${ACCIONES[a.accion][0]} en ${a.tabla}`, size: "lg",
    body: html`<p class="muted" style="margin-bottom:12px">${fechaHora(a.created_at)} · ${a.usuario_email ?? "Sistema"} · registro <span class="mono">${a.registro_id}</span></p>
      <div class="table-wrap"><table class="table"><thead><tr><th>Campo</th><th>Antes</th><th>Después</th></tr></thead>
      <tbody>${filas.map(([k, x, y]) => html`<tr><td class="mono">${k}</td><td style="word-break:break-all">${fmt(x)}</td><td style="word-break:break-all"><b>${fmt(y)}</b></td></tr>`)}</tbody></table></div>`,
  });
}
