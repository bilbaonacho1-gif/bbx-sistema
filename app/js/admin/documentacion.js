// Documentación: bandeja de revisión y pedidos pendientes de todos los clientes.
import { html, ic, fecha, tamano, badge, opciones, listado, toastError } from "../ui.js";
import { accionesDocumentos, mapaTipos } from "../documentos.js";
import { tiene } from "../core.js";

export default async function (el, { sb, titulo, refrescar }) {
  titulo("Documentación", "Documentos presentados y pedidos pendientes");
  const [tipos, { data: docs, error }, { data: reqs }] = await Promise.all([
    mapaTipos(sb),
    sb.from("documentos").select("*, clientes(id, empresas(razon_social)), operaciones(numero)").order("created_at", { ascending: false }).limit(1000),
    sb.from("documentos_requeridos").select("*, clientes(id, empresas(razon_social)), operaciones(numero)").in("estado", ["pendiente", "recibido"]).order("fecha_limite", { nullsFirst: false }),
  ]);
  if (error) return toastError(error);
  const razon = (r) => r.clientes?.empresas?.razon_social ?? "—";

  el.innerHTML = html`<div class="tabs" id="t"><button class="is-on" data-v="docs">Documentos <span class="count">${docs.filter((d) => d.estado === "en_revision").length || ""}</span></button><button data-v="reqs">Pedidos pendientes <span class="count">${reqs?.length || ""}</span></button></div><div id="v"></div>`;

  // Cada pestaña se dibuja en un contenedor nuevo (así no se acumulan listeners)
  const contenedor = () => {
    const nuevo = document.createElement("div");
    el.querySelector("#v").replaceWith(nuevo);
    nuevo.id = "v";
    return nuevo;
  };

  const verDocs = () => {
    const v = contenedor();
    accionesDocumentos(v, sb, () => docs, refrescar);
    listado(v, {
      rows: docs, buscar: [razon, "nombre", (d) => tipos[d.tipo_codigo]], exportar: "documentos",
      filtros: [{ key: "estado", label: "Estado", options: opciones("documento") }],
      vacio: "No hay documentos",
      columns: [
        { key: "created_at", label: "Recibido", render: (d) => html`${fecha(d.created_at)}<small>${d.subido_por_cliente ? "por el cliente" : "por BBX"}</small>` },
        { key: "cliente", label: "Cliente", render: (d) => html`<a href="#/clientes/${d.cliente_id}?tab=documentos"><b>${razon(d)}</b></a>${d.operaciones?.numero ? html`<small>${d.operaciones.numero}</small>` : ""}`, sort: (d) => razon(d), csv: razon },
        { key: "tipo_codigo", label: "Documento", render: (d) => html`<b>${tipos[d.tipo_codigo] ?? "Documento"}</b><small>${d.nombre}${d.tamano_bytes ? " · " + tamano(d.tamano_bytes) : ""}</small>`, csv: (d) => tipos[d.tipo_codigo] },
        { key: "estado", label: "Estado", render: (d) => badge("documento", d.estado), csv: (d) => d.estado },
        { key: "acc", label: "", sort: false, align: "right", csv: false, render: (d) => html`<span class="row" style="justify-content:flex-end;flex-wrap:nowrap">
          <button class="btn-icon" data-abrir="${d.id}" aria-label="Descargar">${ic("download")}</button>
          ${d.estado === "en_revision" && tiene("documentos.revisar") ? html`<button class="btn btn--sm btn--ok" data-aprobar="${d.id}">Aprobar</button><button class="btn btn--sm btn--danger" data-rechazar="${d.id}">Rechazar</button>` : ""}</span>` },
      ],
    });
    const sel = v.querySelector('[data-f="estado"]');
    if (docs.some((d) => d.estado === "en_revision")) { sel.value = "en_revision"; sel.dispatchEvent(new Event("change", { bubbles: true })); }
  };
  const verReqs = () => {
    const v = contenedor();
    listado(v, {
      rows: reqs ?? [], buscar: [razon, "descripcion"], exportar: "documentacion-pendiente", vacio: "No hay pedidos pendientes",
      columns: [
        { key: "cliente", label: "Cliente", render: (r) => html`<a href="#/clientes/${r.cliente_id}?tab=documentos"><b>${razon(r)}</b></a>`, sort: razon, csv: razon },
        { key: "descripcion", label: "Documentación pedida", render: (r) => html`${r.descripcion}${r.operaciones?.numero ? html`<small>${r.operaciones.numero}</small>` : ""}` },
        { key: "fecha_limite", label: "Fecha límite", render: (r) => html`<span class="${r.fecha_limite && r.fecha_limite < new Date().toISOString().slice(0, 10) ? "danger-text" : ""}">${fecha(r.fecha_limite)}</span>` },
        { key: "estado", label: "Estado", render: (r) => badge("requerido", r.estado) },
      ],
    });
  };
  el.querySelector("#t").addEventListener("click", (e) => {
    const b = e.target.closest("[data-v]"); if (!b) return;
    el.querySelectorAll("#t button").forEach((x) => x.classList.toggle("is-on", x === b));
    (b.dataset.v === "docs" ? verDocs : verReqs)();
  });
  verDocs();
}
