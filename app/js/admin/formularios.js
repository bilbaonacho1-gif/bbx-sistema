// Formularios y acuerdos: asignación, revisión y constancia de firma.
import { html, ic, fecha, fechaHora, badge, opciones, listado, modal, campo, leerForm, toast, toastError, pedirTexto, cuitFmt, money } from "../ui.js";
import { tiene, estado } from "../core.js";

export default async function (el, { sb, query, titulo, acciones, refrescar }) {
  titulo("Formularios y acuerdos", "Solicitudes de los clientes, formularios asignados y firmas");
  if (tiene("formularios.editar")) {
    acciones(html`<button class="btn" id="asignar">${ic("plus", "ico-sm")} Asignar formulario</button>`);
    document.getElementById("asignar").onclick = () => asignarFormulario(sb, { alTerminar: refrescar });
  }
  const { data, error } = await sb.from("formularios")
    .select("*, plantillas_formulario(nombre, categoria, campos, texto_legal, requiere_firma), clientes(id, empresas(razon_social, cuit)), firmas(*)")
    .order("created_at", { ascending: false });
  if (error) return toastError(error);
  const razon = (f) => f.clientes?.empresas?.razon_social ?? "—";

  listado(el, {
    rows: data, buscar: [razon, (f) => f.plantillas_formulario?.nombre], exportar: "formularios",
    filtros: [{ key: "estado", label: "Estado", options: opciones("formulario") }],
    onRow: (f) => verFormulario(sb, f, refrescar), vacio: "No hay formularios",
    columns: [
      { key: "created_at", label: "Fecha", render: (f) => html`${fecha(f.created_at)}<small>${f.iniciado_por_cliente ? "Iniciado por el cliente" : "Asignado por BBX"}</small>` },
      { key: "plantilla", label: "Formulario", render: (f) => html`<b>${f.plantillas_formulario?.nombre}</b>`, sort: (f) => f.plantillas_formulario?.nombre, csv: (f) => f.plantillas_formulario?.nombre },
      { key: "cliente", label: "Cliente", render: (f) => html`<a href="#/clientes/${f.cliente_id}?tab=formularios">${razon(f)}</a>`, sort: razon, csv: razon },
      { key: "fecha_limite", label: "Límite", render: (f) => fecha(f.fecha_limite) },
      { key: "firma", label: "Firma", sort: false, render: (f) => (f.firmas?.[0] ? html`${ic("pen", "ico-sm")} ${fechaHora(f.firmas[0].firmado_at)}` : f.plantillas_formulario?.requiere_firma ? html`<span class="muted">Pendiente</span>` : html`<span class="muted">No requiere</span>`), csv: (f) => f.firmas?.[0]?.firmado_at ?? "" },
      { key: "estado", label: "Estado", render: (f) => badge("formulario", f.estado), csv: (f) => f.estado },
    ],
  });
  if (query.id) { const f = data.find((x) => x.id === query.id); if (f) verFormulario(sb, f, refrescar); }
}

function valorCampo(c, v) {
  if (v === undefined || v === null || v === "") return "—";
  if (c.tipo === "fecha") return fecha(v);
  if (c.tipo === "cuit") return cuitFmt(v);
  if (c.tipo === "numero" && /monto|importe|limite|facturacion/i.test(c.clave)) return money(v);
  return String(v);
}

function verFormulario(sb, f, alTerminar) {
  const p = f.plantillas_formulario ?? {};
  const firma = f.firmas?.[0];
  const puedeRevisar = tiene("formularios.editar") && (f.estado === "firmado" || (f.estado === "completado" && !p.requiere_firma));
  const m = modal({
    title: p.nombre, size: "lg",
    body: html`<div class="stack">
      <div class="row row--between"><span>${f.clientes?.empresas?.razon_social} · CUIT ${cuitFmt(f.clientes?.empresas?.cuit)}</span>${badge("formulario", f.estado)}</div>
      <dl class="dl">${(p.campos ?? []).map((c) => html`<div><dt>${c.etiqueta}</dt><dd style="white-space:pre-wrap">${valorCampo(c, f.datos?.[c.clave])}</dd></div>`)}</dl>
      ${f.observaciones ? html`<div class="callout callout--warn">${ic("info")}<div><b>Observaciones:</b> ${f.observaciones}</div></div>` : ""}
      ${firma ? html`<div class="card"><div class="card__head"><h3>Constancia de firma electrónica</h3></div><div class="card__body"><dl class="dl">
          <div><dt>Firmante</dt><dd>${firma.firmante_nombre} · DNI ${firma.firmante_dni}</dd></div>
          <div><dt>Fecha y hora</dt><dd>${fechaHora(firma.firmado_at)}</dd></div>
          <div><dt>IP</dt><dd class="mono">${firma.ip ?? "—"}</dd></div>
          <div><dt>Método</dt><dd>Aceptación electrónica (firma electrónica, Ley 25.506)</dd></div>
          <div style="grid-column:1/-1"><dt>Huella SHA-256 del contenido firmado</dt><dd class="mono" style="font-size:11.5px">${firma.hash_contenido}</dd></div>
        </dl></div></div>` : p.requiere_firma ? html`<p class="muted">Todavía no fue firmado por el cliente.</p>` : ""}
      ${p.texto_legal ? html`<details><summary class="muted" style="cursor:pointer">Texto aceptado</summary><p class="muted" style="margin-top:8px;white-space:pre-wrap">${p.texto_legal}</p></details>` : ""}
    </div>`,
    foot: puedeRevisar ? html`<button class="btn btn--danger" data-obs>Observar</button><button class="btn btn--ok" data-ok>${ic("check", "ico-sm")} Aprobar</button>` : html`<button class="btn btn--ghost" data-close>Cerrar</button>`,
  });
  const revisar = async (aprobar) => {
    let obs = null;
    if (!aprobar) { obs = await pedirTexto({ titulo: "Observar formulario", etiqueta: "Qué tiene que corregir el cliente", ok: "Enviar observación" }); if (!obs) return; }
    const { error } = await sb.rpc("revisar_formulario", { p_id: f.id, p_aprobar: aprobar, p_observaciones: obs });
    if (error) return toastError(error);
    toast(aprobar ? "Formulario aprobado" : "Observación enviada al cliente", aprobar ? "ok" : "info");
    m.close(); alTerminar?.();
  };
  m.el.querySelector("[data-ok]")?.addEventListener("click", () => revisar(true));
  m.el.querySelector("[data-obs]")?.addEventListener("click", () => revisar(false));
}

export async function asignarFormulario(sb, { cliente_id = null, alTerminar } = {}) {
  const [{ data: plantillas }, { data: clientes }] = await Promise.all([
    sb.from("plantillas_formulario").select("id, nombre").eq("activo", true).order("nombre"),
    cliente_id ? Promise.resolve({ data: [] }) : sb.from("v_clientes").select("id, razon_social").order("razon_social"),
  ]);
  const m = modal({
    title: "Asignar formulario",
    body: html`<form class="form" id="f-asig" novalidate>
      ${!cliente_id ? campo({ name: "cliente_id", label: "Cliente", type: "select", required: true, options: [{ value: "", label: "Seleccionar…" }, ...clientes.map((c) => ({ value: c.id, label: c.razon_social }))] }) : ""}
      ${campo({ name: "plantilla_id", label: "Formulario", type: "select", required: true, options: [{ value: "", label: "Seleccionar…" }, ...plantillas.map((p) => ({ value: p.id, label: p.nombre }))] })}
      ${campo({ name: "fecha_limite", label: "Fecha límite", type: "date" })}
      <p class="muted">El cliente recibe una notificación y lo completa y firma desde su portal.</p></form>`,
    foot: html`<button class="btn btn--ghost" data-close>Cancelar</button><button class="btn" form="f-asig">Asignar</button>`,
  });
  m.el.querySelector("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const d = leerForm(e.target);
    if (!d.plantilla_id || (!cliente_id && !d.cliente_id)) return toast("Completá cliente y formulario", "error");
    const { error } = await sb.from("formularios").insert({ plantilla_id: d.plantilla_id, cliente_id: cliente_id ?? d.cliente_id, fecha_limite: d.fecha_limite, created_by: estado.user.id });
    if (error) return toastError(error);
    toast("Formulario asignado"); m.close(); alTerminar?.();
  });
}
