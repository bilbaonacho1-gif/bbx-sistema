// Ficha individual del cliente.
import { html, ic, money, fecha, fechaHora, cuitFmt, badge, tabs, tablaSimple, modal, campo, leerForm, validarForm, toast, toastError, confirmar, demoTag, hace, $, reemplazarHash, panelNuevo } from "../ui.js";
import { tiene, estado } from "../core.js";
import { formCliente } from "./clientes.js";
import { subirDocumento, pedirDocumento, tablaDocumentos, accionesDocumentos, tablaRequeridos, mapaTipos } from "../documentos.js";
import { pdfEstadoCuenta } from "../pdf.js";
import { asignarFormulario } from "./formularios.js";
import { rolNombre } from "../shell.js";

export default async function (el, { sb, params, query, titulo, acciones, refrescar }) {
  const { data: c, error } = await sb.from("v_clientes").select("*").eq("id", params.id).maybeSingle();
  if (error) return toastError(error);
  if (!c) { el.innerHTML = html`<div class="empty">${ic("users")}<b>Cliente inexistente</b></div>`; return; }
  titulo(c.razon_social, `${c.codigo} · CUIT ${cuitFmt(c.cuit)}`);
  const { data: conds } = await sb.from("condiciones_iva").select("*");
  const condIva = Object.fromEntries((conds ?? []).map((x) => [x.id, x.nombre]));

  const btns = [];
  if (tiene("operaciones.editar")) btns.push(html`<a class="btn btn--ghost" href="#/operaciones/nueva?cliente=${c.id}">${ic("plus", "ico-sm")} Operación</a>`);
  if (tiene("clientes.editar")) btns.push(html`<button class="btn" id="editar">${ic("edit", "ico-sm")} Editar</button>`);
  acciones(html`${btns}`);
  $("#editar")?.addEventListener("click", () => formCliente(sb, c, refrescar));

  el.innerHTML = html`
    <a class="back" href="#/clientes">${ic("arrowLeft", "ico-sm")} Clientes</a>
    <div class="detail-head"><div class="grow">
      <h2>${c.razon_social} ${badge("cliente", c.estado)}${demoTag(c)}</h2>
      <p>${c.tipo_persona === "juridica" ? "Persona jurídica" : "Persona humana"} · ${condIva[c.condicion_iva] ?? ""} · Cliente desde ${fecha(c.fecha_alta)}</p>
    </div></div>
    <dl class="sum-strip" style="margin-bottom:18px">
      <div><dt>Operaciones activas</dt><dd>${c.operaciones_activas}</dd></div>
      <div><dt>Saldo pendiente</dt><dd>${money(c.saldo_pendiente)}</dd></div>
      <div><dt>Documentación pendiente</dt><dd class="${c.documentos_pendientes ? "warn-text" : ""}">${c.documentos_pendientes}</dd></div>
      <div><dt>Contacto principal</dt><dd style="font-size:14px">${c.contacto_principal ?? "—"}</dd></div>
    </dl>
    <div class="tabs" id="tabs"></div>
    <div id="panel"></div>`;

  const items = [
    { id: "datos", label: "Datos" },
    { id: "operaciones", label: "Operaciones" },
    { id: "cuenta", label: "Estado de cuenta" },
    { id: "documentos", label: "Documentación", count: c.documentos_pendientes || "" },
    { id: "formularios", label: "Formularios" },
    { id: "notas", label: "Notas internas" },
    { id: "usuarios", label: "Accesos al portal" },
  ];
  const mostrar = (t) => {
    reemplazarHash(`#/clientes/${c.id}`, `#/clientes/${c.id}?tab=${t}`);
    const panel = panelNuevo("#panel");
    panel.innerHTML = html`<div class="skeleton" style="height:200px"></div>`;
    VISTAS[t](panel, { sb, c, condIva, recargar: () => mostrar(t) }).catch(toastError);
  };
  tabs($("#tabs"), items, query.tab || "datos", mostrar);
  mostrar(items.some((i) => i.id === query.tab) ? query.tab : "datos");
}

const dato = (l, v) => html`<div><dt>${l}</dt><dd>${v || "—"}</dd></div>`;

const VISTAS = {
  async datos(panel, { sb, c, condIva, recargar }) {
    const { data: contactos } = await sb.from("contactos").select("*").eq("cliente_id", c.id).order("es_principal", { ascending: false });
    const domicilio = [c.domicilio_calle, c.domicilio_numero, c.domicilio_piso].filter(Boolean).join(" ");
    panel.innerHTML = html`<div class="grid grid-2">
      <div class="card"><div class="card__head"><h3>Datos fiscales y empresariales</h3></div><div class="card__body"><dl class="dl">
        ${dato("Razón social", c.razon_social)}${dato("CUIT", cuitFmt(c.cuit))}
        ${dato("Condición IVA", condIva[c.condicion_iva])}${dato("Actividad", c.actividad)}
        ${dato("Nombre de fantasía", c.nombre_fantasia)}${dato("Tipo", c.tipo_persona === "juridica" ? "Persona jurídica" : "Persona humana")}
      </dl></div></div>
      <div class="card"><div class="card__head"><h3>Domicilio y contacto</h3></div><div class="card__body"><dl class="dl">
        ${dato("Domicilio fiscal", domicilio)}${dato("Localidad", [c.domicilio_localidad, c.domicilio_provincia, c.domicilio_cp].filter(Boolean).join(", "))}
        ${dato("Email", c.email)}${dato("Teléfono", c.telefono)}
        ${dato("Domicilio comercial", c.domicilio_comercial)}${dato("Alta", fecha(c.fecha_alta))}
      </dl></div></div>
      <div class="card span-2"><div class="card__head"><h3>Contactos asociados</h3>${tiene("clientes.editar") ? html`<button class="btn btn--sm btn--ghost" id="nuevo-ct">${ic("plus", "ico-sm")} Agregar</button>` : ""}</div>
        <div class="card__body--flush">${tablaSimple([
          { label: "Nombre", render: (x) => html`<b>${x.nombre} ${x.apellido}</b>${x.es_principal ? html` <span class="tag">Principal</span>` : ""}${x.es_firmante ? html` <span class="tag">Firmante</span>` : ""}` },
          { label: "Cargo", key: "cargo" }, { label: "DNI", key: "dni" }, { label: "Email", key: "email" }, { label: "Teléfono", key: "telefono" },
          { label: "", align: "right", render: (x) => tiene("clientes.editar") ? html`<button class="btn-icon" data-edit-ct="${x.id}" aria-label="Editar">${ic("edit")}</button>` : "" },
        ], contactos, { vacio: "Sin contactos" })}</div></div>
    </div>`;
    const formCt = (x) => {
      const m = modal({
        title: x ? "Editar contacto" : "Nuevo contacto",
        body: html`<form class="form" id="f-ct" novalidate>
          ${campo({ name: "nombre", label: "Nombre", value: x?.nombre, required: true, col: "f-6" })}
          ${campo({ name: "apellido", label: "Apellido", value: x?.apellido, required: true, col: "f-6" })}
          ${campo({ name: "dni", label: "DNI", value: x?.dni, col: "f-6", attrs: ' inputmode="numeric" pattern="\\d{7,8}"' })}
          ${campo({ name: "cargo", label: "Cargo", value: x?.cargo, col: "f-6" })}
          ${campo({ name: "email", label: "Email", type: "email", value: x?.email, col: "f-6" })}
          ${campo({ name: "telefono", label: "Teléfono", type: "tel", value: x?.telefono, col: "f-6" })}
          ${campo({ name: "es_principal", label: "Contacto principal", type: "checkbox", value: x?.es_principal, col: "f-6" })}
          ${campo({ name: "es_firmante", label: "Firmante autorizado", type: "checkbox", value: x?.es_firmante, col: "f-6" })}
        </form>`,
        foot: html`<button class="btn btn--ghost" data-close>Cancelar</button><button class="btn" form="f-ct">Guardar</button>`,
      });
      m.el.querySelector("form").addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!validarForm(e.target)) return;
        const d = leerForm(e.target);
        const q = x ? sb.from("contactos").update(d).eq("id", x.id) : sb.from("contactos").insert({ ...d, cliente_id: c.id });
        const { error } = await q;
        if (error) return toastError(error);
        toast("Contacto guardado"); m.close(); recargar();
      });
    };
    $("#nuevo-ct", panel)?.addEventListener("click", () => formCt(null));
    panel.addEventListener("click", (e) => { const b = e.target.closest("[data-edit-ct]"); if (b) formCt(contactos.find((x) => x.id === b.dataset.editCt)); });
  },

  async operaciones(panel, { sb, c }) {
    const { data } = await sb.from("v_operaciones").select("*").eq("cliente_id", c.id).order("fecha_inicio", { ascending: false });
    panel.innerHTML = html`<div class="card">${tablaSimple([
      { label: "Número", render: (o) => html`<a href="#/operaciones/${o.id}"><b>${o.numero}</b></a><small>${o.tipo_nombre}</small>` },
      { label: "Inicio", render: (o) => fecha(o.fecha_inicio) },
      { label: "Vencimiento", render: (o) => fecha(o.fecha_vencimiento) },
      { label: "Capital", align: "right", render: (o) => money(o.capital, o.moneda) },
      { label: "Int. devengados", align: "right", render: (o) => money(o.intereses_devengados_hoy) },
      { label: "Int. cobrados", align: "right", render: (o) => money(o.intereses_cobrados) },
      { label: "Saldo", align: "right", render: (o) => money(o.saldo_pendiente) },
      { label: "Estado", render: (o) => badge("operacion", o.estado) },
    ], data, { vacio: "El cliente no tiene operaciones" })}</div>`;
  },

  async cuenta(panel, { sb, c }) {
    const { data: movs } = tiene("cobranzas.ver")
      ? await sb.from("v_estado_cuenta").select("*").eq("cliente_id", c.id).order("fecha").order("created_at")
      : { data: [] };
    const saldo = movs?.length ? movs[movs.length - 1].saldo : 0;
    panel.innerHTML = html`<div class="card">
      <div class="card__head"><h3>Movimientos de la cuenta</h3><span class="row"><b class="num">Saldo: ${money(saldo)}</b>
        <button class="btn btn--sm btn--ghost" id="pdf-ec">${ic("download", "ico-sm")} PDF</button></span></div>
      <div class="card__body--flush">${tablaSimple([
        { label: "Fecha", render: (m) => fecha(m.fecha) },
        { label: "Concepto", render: (m) => html`${m.concepto}${m.operacion_numero ? html`<small>${m.operacion_numero}</small>` : ""}` },
        { label: "Cargo", align: "right", render: (m) => (m.sentido === "cargo" ? money(m.importe) : "") },
        { label: "Abono", align: "right", render: (m) => (m.sentido === "abono" ? money(m.importe) : m.sentido === "informativo" ? html`<span class="muted">${money(m.importe)}</span>` : "") },
        { label: "Saldo", align: "right", render: (m) => (m.sentido === "informativo" ? "" : money(m.saldo)) },
      ], movs, { vacio: "Sin movimientos" })}</div></div>`;
    $("#pdf-ec", panel).onclick = () => pdfEstadoCuenta(c, movs ?? []).catch(toastError);
  },

  async documentos(panel, { sb, c, recargar }) {
    const [tipos, { data: docs }, { data: reqs }, { data: ops }] = await Promise.all([
      mapaTipos(sb),
      sb.from("documentos").select("*").eq("cliente_id", c.id).order("created_at", { ascending: false }),
      sb.from("documentos_requeridos").select("*, operaciones(numero)").eq("cliente_id", c.id).order("created_at", { ascending: false }),
      sb.from("operaciones").select("id, numero").eq("cliente_id", c.id).order("created_at", { ascending: false }),
    ]);
    panel.innerHTML = html`<div class="stack">
      <div class="card"><div class="card__head"><h3>Documentación pendiente</h3>${tiene("documentos.editar") ? html`<button class="btn btn--sm btn--ghost" id="pedir">${ic("send", "ico-sm")} Pedir documentación</button>` : ""}</div>
        <div class="card__body--flush" id="reqs">${tablaRequeridos(reqs, { staff: true })}</div></div>
      <div class="card"><div class="card__head"><h3>Documentación presentada</h3>${tiene("documentos.editar") ? html`<button class="btn btn--sm" id="subir">${ic("upload", "ico-sm")} Subir</button>` : ""}</div>
        <div class="card__body--flush" id="docs">${tablaDocumentos(docs, { tipos, staff: true })}</div></div></div>`;
    $("#pedir", panel)?.addEventListener("click", () => pedirDocumento(sb, { cliente_id: c.id, alTerminar: recargar }));
    $("#subir", panel)?.addEventListener("click", () => subirDocumento(sb, { cliente_id: c.id, operaciones: ops ?? [], alTerminar: recargar }));
    accionesDocumentos($("#docs", panel), sb, () => docs, recargar);
    $("#reqs", panel).addEventListener("click", async (e) => {
      const b = e.target.closest("[data-dispensar]"); if (!b) return;
      if (!(await confirmar("El cliente ya no verá este pedido como pendiente.", { titulo: "Dispensar documentación", ok: "Dispensar" }))) return;
      const { error } = await sb.from("documentos_requeridos").update({ estado: "dispensado" }).eq("id", b.dataset.dispensar);
      if (error) return toastError(error);
      recargar();
    });
  },

  async formularios(panel, { sb, c, recargar }) {
    const { data } = await sb.from("formularios").select("*, plantillas_formulario(nombre, categoria), firmas(firmado_at, firmante_nombre)").eq("cliente_id", c.id).order("created_at", { ascending: false });
    panel.innerHTML = html`<div class="card"><div class="card__head"><h3>Formularios y acuerdos</h3>${tiene("formularios.editar") ? html`<button class="btn btn--sm" id="asignar">${ic("plus", "ico-sm")} Asignar formulario</button>` : ""}</div>
      <div class="card__body--flush">${tablaSimple([
        { label: "Formulario", render: (f) => html`<b>${f.plantillas_formulario?.nombre}</b><small>${f.iniciado_por_cliente ? "Iniciado por el cliente" : "Asignado por BBX"}</small>` },
        { label: "Creado", render: (f) => fecha(f.created_at) },
        { label: "Firma", render: (f) => (f.firmas?.[0] ? html`${fechaHora(f.firmas[0].firmado_at)}<small>${f.firmas[0].firmante_nombre}</small>` : "—") },
        { label: "Estado", render: (f) => badge("formulario", f.estado) },
        { label: "", align: "right", render: (f) => html`<a class="btn btn--sm btn--ghost" href="#/formularios?id=${f.id}">Ver</a>` },
      ], data, { vacio: "Sin formularios" })}</div></div>`;
    $("#asignar", panel)?.addEventListener("click", () => asignarFormulario(sb, { cliente_id: c.id, alTerminar: recargar }));
  },

  async notas(panel, { sb, c, recargar }) {
    const { data } = await sb.from("notas_internas").select("*, perfiles:autor_id(nombre, apellido, email)").eq("cliente_id", c.id).order("created_at", { ascending: false });
    panel.innerHTML = html`<div class="grid grid-3">
      <div class="card span-2"><div class="card__head"><h3>Observaciones internas</h3><span class="muted">No visibles para el cliente</span></div>
        <div class="card__body">${data?.length ? html`<ul class="timeline">${data.map((n) => html`<li><b>${[n.perfiles?.nombre, n.perfiles?.apellido].filter(Boolean).join(" ") || n.perfiles?.email || "—"}</b><span>${fechaHora(n.created_at)}</span><p style="margin-top:6px;white-space:pre-wrap">${n.texto}</p></li>`)}</ul>` : html`<p class="muted">Sin notas.</p>`}</div></div>
      ${tiene("clientes.editar") ? html`<div class="card"><div class="card__head"><h3>Nueva nota</h3></div><div class="card__body">
        <form class="form" id="f-nota">${campo({ name: "texto", label: "Texto", type: "textarea", required: true, attrs: ' maxlength="5000" rows="6"' })}
        <div class="form-actions"><button class="btn">Guardar nota</button></div></form></div></div>` : ""}
    </div>`;
    $("#f-nota", panel)?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const texto = e.target.texto.value.trim(); if (!texto) return;
      const { error } = await sb.from("notas_internas").insert({ cliente_id: c.id, texto, autor_id: estado.user.id });
      if (error) return toastError(error);
      toast("Nota guardada"); recargar();
    });
  },

  async usuarios(panel, { sb, c }) {
    const { data } = await sb.from("perfiles").select("*").eq("cliente_id", c.id);
    panel.innerHTML = html`<div class="card"><div class="card__head"><h3>Usuarios con acceso al portal</h3></div>
      <div class="card__body--flush">${tablaSimple([
        { label: "Usuario", render: (u) => html`<b>${[u.nombre, u.apellido].filter(Boolean).join(" ")}</b><small>${u.email}</small>` },
        { label: "Rol", render: (u) => rolNombre(u.rol) },
        { label: "Último acceso", render: (u) => (u.ultimo_acceso ? hace(u.ultimo_acceso) : "Nunca") },
        { label: "Estado", render: (u) => badge("usuario", u.estado) },
      ], data, { vacio: "Ningún usuario de este cliente tiene acceso todavía. Se crean al aprobar una solicitud de registro." })}</div></div>`;
  },
};
