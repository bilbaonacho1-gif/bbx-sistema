// Módulo de clientes: listado y alta/edición.
import { html, ic, money, cuitFmt, badge, opciones, listado, modal, campo, leerForm, validarForm, bindCuit, conCarga, toast, toastError, errMsg, demoTag, raw } from "../ui.js";
import { tiene } from "../core.js";

export default async function (el, { sb, titulo, acciones }) {
  titulo("Clientes", "Personas y empresas que operan con BBX");
  if (tiene("clientes.editar")) {
    acciones(html`<button class="btn" id="nuevo">${ic("plus", "ico-sm")} Nuevo cliente</button>`);
    document.getElementById("nuevo").onclick = () => formCliente(sb, null, (id) => { location.hash = "#/clientes/" + id; });
  }
  const { data, error } = await sb.from("v_clientes").select("*").order("created_at", { ascending: false });
  if (error) return toastError(error);

  listado(el, {
    rows: data,
    buscar: ["razon_social", "cuit", "codigo", "contacto_principal", "email", (r) => cuitFmt(r.cuit)],
    filtros: [{ key: "estado", label: "Estado", options: opciones("cliente") }, { key: "tipo_persona", label: "Tipo", options: [{ value: "juridica", label: "Persona jurídica" }, { value: "humana", label: "Persona humana" }] }],
    exportar: "clientes",
    onRow: (r) => { location.hash = "#/clientes/" + r.id; },
    vacio: "Todavía no hay clientes",
    columns: [
      { key: "codigo", label: "Código", render: (r) => html`<span class="mono">${r.codigo}</span>` , csv: (r) => r.codigo },
      { key: "razon_social", label: "Razón social", render: (r) => html`<b>${r.razon_social}</b>${demoTag(r)}<small>CUIT ${cuitFmt(r.cuit)}</small>`, csv: (r) => r.razon_social },
      { key: "cuit", label: "CUIT", render: (r) => cuitFmt(r.cuit), csv: (r) => cuitFmt(r.cuit), sort: false },
      { key: "estado", label: "Estado", render: (r) => badge("cliente", r.estado), csv: (r) => r.estado },
      { key: "contacto_principal", label: "Contacto", render: (r) => html`${r.contacto_principal ?? "—"}<small>${r.email ?? ""}</small>`, csv: (r) => r.contacto_principal },
      { key: "operaciones_activas", label: "Op. activas", align: "right" },
      { key: "saldo_pendiente", label: "Saldo pendiente", align: "right", render: (r) => money(r.saldo_pendiente), csv: (r) => r.saldo_pendiente },
      { key: "documentos_pendientes", label: "Doc. pend.", align: "right", render: (r) => r.documentos_pendientes ? html`<span class="warn-text">${r.documentos_pendientes}</span>` : "0" },
    ].filter((c) => c.key !== "cuit"),
  });
}

const PROVINCIAS = ["Buenos Aires", "Ciudad Autónoma de Buenos Aires", "Catamarca", "Chaco", "Chubut", "Córdoba", "Corrientes", "Entre Ríos", "Formosa", "Jujuy", "La Pampa", "La Rioja", "Mendoza", "Misiones", "Neuquén", "Río Negro", "Salta", "San Juan", "San Luis", "Santa Cruz", "Santa Fe", "Santiago del Estero", "Tierra del Fuego", "Tucumán"];

/** Modal de alta o edición de cliente (c = fila de v_clientes o null). */
export async function formCliente(sb, c, alGuardar) {
  const [{ data: conds }, { data: staff }] = await Promise.all([
    sb.from("condiciones_iva").select("*").order("id"),
    sb.from("perfiles").select("id, nombre, apellido, email, rol").neq("rol", "cliente").eq("estado", "activo"),
  ]);
  const v = c ?? { tipo_persona: "juridica", condicion_iva: 1, estado: "en_evaluacion" };
  const m = modal({
    title: c ? "Editar cliente" : "Nuevo cliente", size: "lg",
    body: html`<form class="form" id="f-cliente" novalidate>
      <div class="fieldset-title" style="border:0;margin:0;padding:0">Datos fiscales</div>
      ${campo({ name: "tipo_persona", label: "Tipo de persona", type: "select", value: v.tipo_persona, col: "f-4", options: [{ value: "juridica", label: "Persona jurídica" }, { value: "humana", label: "Persona humana" }] })}
      ${campo({ name: "razon_social", label: "Razón social / nombre completo", value: v.razon_social, required: true, col: "f-8", attrs: ' maxlength="200"' })}
      ${campo({ name: "cuit", label: "CUIT", type: "cuit", value: v.cuit ? cuitFmt(v.cuit) : "", required: true, col: "f-4", help: "Se valida el dígito verificador" })}
      ${campo({ name: "condicion_iva", label: "Condición frente al IVA", type: "select", value: v.condicion_iva, col: "f-4", options: (conds ?? []).map((x) => ({ value: x.id, label: x.nombre })) })}
      ${campo({ name: "fecha_constitucion", label: "Fecha de constitución / nacimiento", type: "date", value: v.fecha_constitucion, col: "f-4" })}
      ${campo({ name: "actividad", label: "Actividad principal", value: v.actividad, col: "f-8" })}
      ${campo({ name: "nombre_fantasia", label: "Nombre de fantasía", value: v.nombre_fantasia, col: "f-4" })}
      <div class="fieldset-title">Domicilio fiscal</div>
      ${campo({ name: "domicilio_calle", label: "Calle", value: v.domicilio_calle, col: "f-6" })}
      ${campo({ name: "domicilio_numero", label: "Número", value: v.domicilio_numero, col: "f-3" })}
      ${campo({ name: "domicilio_piso", label: "Piso / depto.", value: v.domicilio_piso, col: "f-3" })}
      ${campo({ name: "domicilio_localidad", label: "Localidad", value: v.domicilio_localidad, col: "f-4" })}
      ${campo({ name: "domicilio_provincia", label: "Provincia", type: "select", value: v.domicilio_provincia ?? "", col: "f-4", options: [{ value: "", label: "Seleccionar…" }, ...PROVINCIAS] })}
      ${campo({ name: "domicilio_cp", label: "Código postal", value: v.domicilio_cp, col: "f-4" })}
      <div class="fieldset-title">Contacto y relación comercial</div>
      ${campo({ name: "email", label: "Email", type: "email", value: v.email, col: "f-6" })}
      ${campo({ name: "telefono", label: "Teléfono", type: "tel", value: v.telefono, col: "f-6" })}
      ${campo({ name: "domicilio_comercial", label: "Domicilio comercial", value: v.domicilio_comercial, col: "f-6" })}
      ${campo({ name: "estado", label: "Estado", type: "select", value: v.estado, col: "f-3", options: opciones("cliente") })}
      ${campo({ name: "ejecutivo_id", label: "Ejecutivo", type: "select", value: v.ejecutivo_id ?? "", col: "f-3", options: [{ value: "", label: "Sin asignar" }, ...(staff ?? []).map((s) => ({ value: s.id, label: [s.nombre, s.apellido].filter(Boolean).join(" ") || s.email }))] })}
      ${!c ? html`<div class="fieldset-title">Contacto principal (firmante)</div>
        ${campo({ name: "ct_nombre", label: "Nombre", col: "f-4" })}
        ${campo({ name: "ct_apellido", label: "Apellido", col: "f-4" })}
        ${campo({ name: "ct_dni", label: "DNI", col: "f-4", attrs: ' inputmode="numeric" pattern="\\d{7,8}"', help: "7 u 8 dígitos" })}
        ${campo({ name: "ct_cargo", label: "Cargo", col: "f-4" })}
        ${campo({ name: "ct_email", label: "Email", type: "email", col: "f-4" })}
        ${campo({ name: "ct_telefono", label: "Teléfono", type: "tel", col: "f-4" })}` : ""}
      <p class="form-error" data-error hidden></p>
    </form>`,
    foot: html`<button class="btn btn--ghost" data-close>Cancelar</button><button class="btn" form="f-cliente">${c ? "Guardar cambios" : "Crear cliente"}</button>`,
  });
  const form = m.el.querySelector("form");
  bindCuit(form);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const err = form.querySelector("[data-error]"); err.hidden = true;
    if (!validarForm(form)) { err.textContent = "Revisá los campos marcados (el CUIT debe ser válido)."; err.hidden = false; return; }
    const d = leerForm(form);
    const empresa = Object.fromEntries(Object.entries(d).filter(([k]) => /^(razon_social|cuit|tipo_persona|condicion_iva|actividad|fecha_constitucion|domicilio_)/.test(k)));
    const cliente = { nombre_fantasia: d.nombre_fantasia, email: d.email, telefono: d.telefono, domicilio_comercial: d.domicilio_comercial, estado: d.estado, ejecutivo_id: d.ejecutivo_id };
    const contacto = !c && d.ct_nombre ? { nombre: d.ct_nombre, apellido: d.ct_apellido ?? "", dni: d.ct_dni, cargo: d.ct_cargo, email: d.ct_email, telefono: d.ct_telefono } : null;
    conCarga(form.closest(".modal").querySelector(".modal__foot .btn:not(.btn--ghost)"), async () => {
      const { data: id, error } = await sb.rpc("guardar_cliente", { p_id: c?.id ?? null, p_empresa: empresa, p_cliente: cliente, p_contacto: contacto });
      if (error) { err.textContent = errMsg(error); err.hidden = false; return; }
      toast(c ? "Cliente actualizado" : "Cliente creado");
      m.close();
      alGuardar?.(id);
    });
  });
}
