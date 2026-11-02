// Facturación electrónica: comprobantes emitidos y alta de borradores.
import { html, ic, money, fecha, cuitFmt, badge, opciones, listado, modal, campo, leerForm, validarForm, conCarga, toast, toastError, errMsg, TIPOS_COMPROBANTE, nroComprobante, hoyISO, sumarDias, demoTag } from "../ui.js";
import { tiene, estado } from "../core.js";

export default async function (el, { sb, query, titulo, acciones }) {
  titulo("Facturación", "Comprobantes electrónicos autorizados por ARCA");
  if (tiene("facturacion.emitir")) {
    acciones(html`<button class="btn" id="nueva">${ic("plus", "ico-sm")} Nuevo comprobante</button>`);
    document.getElementById("nueva").onclick = () => nuevaFactura(sb, { cliente_id: query.cliente, operacion_id: query.operacion });
  }
  const [{ data, error }, { data: cfg }] = await Promise.all([
    sb.from("facturas").select("*, clientes(empresas(razon_social)), operaciones(numero)").order("created_at", { ascending: false }),
    sb.from("arca_config").select("*").maybeSingle(),
  ]);
  if (error) return toastError(error);
  const aut = data.filter((f) => f.estado === "autorizada");
  const signo = (f) => ([3, 8, 13].includes(f.tipo_comprobante) ? -1 : 1);

  el.innerHTML = html`
    ${!cfg?.cuit_emisor || !cfg?.punto_venta ? html`<div class="callout callout--warn" style="margin-bottom:16px">${ic("alert")}<div><b>Facturación no configurada.</b> Cargá el CUIT emisor, el punto de venta y el certificado de ARCA en <a href="#/configuracion?tab=arca">Configuración → ARCA</a>. Mientras tanto podés preparar borradores, que <b>no tienen validez fiscal</b>.</div></div>` : ""}
    ${cfg?.ambiente === "homologacion" ? html`<div class="callout" style="margin-bottom:16px">${ic("info")}<div>Ambiente de <b>homologación (pruebas)</b>: los CAE que se obtengan no tienen validez fiscal.</div></div>` : ""}
    <div class="grid grid-3" style="margin-bottom:16px">
      <div class="card kpi"><div class="kpi__label">Comprobantes autorizados</div><div class="kpi__value kpi__value--sm">${aut.length}</div></div>
      <div class="card kpi"><div class="kpi__label">Total facturado (neto de notas de crédito)</div><div class="kpi__value kpi__value--sm">${money(aut.reduce((a, f) => a + signo(f) * Number(f.importe_total), 0))}</div></div>
      <div class="card kpi"><div class="kpi__label">Borradores / rechazados</div><div class="kpi__value kpi__value--sm">${data.filter((f) => ["borrador", "rechazada"].includes(f.estado)).length}</div></div>
    </div><div id="lista"></div>`;

  listado(el.querySelector("#lista"), {
    rows: data, buscar: [(f) => f.clientes?.empresas?.razon_social, "receptor_doc_nro", (f) => nroComprobante(f), "cae"], exportar: "facturas",
    filtros: [{ key: "estado", label: "Estado", options: opciones("factura") }, { key: "tipo_comprobante", label: "Tipo", options: Object.entries(TIPOS_COMPROBANTE).map(([value, label]) => ({ value, label })) }],
    onRow: (f) => { location.hash = "#/facturacion/" + f.id; }, vacio: "No hay comprobantes",
    columns: [
      { key: "fecha_emision", label: "Fecha", render: (f) => fecha(f.fecha_emision), csv: (f) => f.fecha_emision },
      { key: "tipo_comprobante", label: "Comprobante", render: (f) => html`<b>${TIPOS_COMPROBANTE[f.tipo_comprobante]}</b>${demoTag(f)}<small class="mono">${nroComprobante(f)}</small>`, csv: (f) => `${TIPOS_COMPROBANTE[f.tipo_comprobante]} ${nroComprobante(f)}` },
      { key: "receptor_razon_social", label: "Receptor", render: (f) => html`<b>${f.receptor_razon_social}</b><small>${cuitFmt(f.receptor_doc_nro)}${f.operaciones?.numero ? " · " + f.operaciones.numero : ""}</small>`, csv: (f) => f.receptor_razon_social },
      { key: "cae", label: "CAE", render: (f) => (f.cae ? html`<span class="mono">${f.cae}</span><small>Vto. ${fecha(f.cae_vencimiento)}</small>` : html`<span class="muted">—</span>`), csv: (f) => f.cae ?? "" },
      { key: "importe_total", label: "Total", align: "right", render: (f) => money(f.importe_total), csv: (f) => f.importe_total },
      { key: "estado", label: "Estado", render: (f) => badge("factura", f.estado), csv: (f) => f.estado },
    ],
  });
}

export async function nuevaFactura(sb, { cliente_id = null, operacion_id = null } = {}) {
  const [{ data: clientes }, { data: conds }, { data: cfg }] = await Promise.all([
    sb.from("v_clientes").select("*").order("razon_social"),
    sb.from("condiciones_iva").select("*").order("id"),
    sb.from("arca_config").select("*").maybeSingle(),
  ]);
  const emisorMono = /monotribut|exento/i.test(cfg?.condicion_iva ?? "");
  const m = modal({
    title: "Nuevo comprobante (borrador)", size: "lg",
    body: html`<form class="form" id="f-fac" novalidate>
      <div class="callout" style="grid-column:span 12">${ic("info")}<div>Se crea como <b>borrador sin validez fiscal</b>. Después agregás los ítems y lo enviás a ARCA para obtener el CAE.</div></div>
      ${campo({ name: "cliente_id", label: "Cliente", type: "select", value: cliente_id ?? "", required: true, col: "f-8", options: [{ value: "", label: "Seleccionar…" }, ...clientes.map((c) => ({ value: c.id, label: `${c.razon_social} · ${cuitFmt(c.cuit)}` }))] })}
      ${campo({ name: "operacion_id", label: "Operación asociada", type: "select", value: operacion_id ?? "", col: "f-4", options: [{ value: "", label: "Ninguna" }] })}
      ${campo({ name: "tipo_comprobante", label: "Tipo de comprobante", type: "select", col: "f-4", options: Object.entries(TIPOS_COMPROBANTE).filter(([k]) => (emisorMono ? Number(k) >= 11 : Number(k) < 11)).map(([value, label]) => ({ value, label })) })}
      ${campo({ name: "concepto", label: "Concepto", type: "select", value: 2, col: "f-4", options: [{ value: 2, label: "Servicios" }, { value: 1, label: "Productos" }, { value: 3, label: "Productos y servicios" }] })}
      ${campo({ name: "fecha_emision", label: "Fecha de emisión", type: "date", value: hoyISO(), required: true, col: "f-4", help: "ARCA admite hasta 10 días antes/después para servicios" })}
      ${campo({ name: "fecha_servicio_desde", label: "Servicio desde", type: "date", value: hoyISO().slice(0, 8) + "01", col: "f-4" })}
      ${campo({ name: "fecha_servicio_hasta", label: "Servicio hasta", type: "date", value: hoyISO(), col: "f-4" })}
      ${campo({ name: "fecha_vto_pago", label: "Vencimiento del pago", type: "date", value: sumarDias(hoyISO(), 10), col: "f-4" })}
      ${campo({ name: "receptor_razon_social", label: "Razón social del receptor", required: true, col: "f-8" })}
      ${campo({ name: "receptor_doc_nro", label: "CUIT del receptor", type: "cuit", required: true, col: "f-4" })}
      ${campo({ name: "receptor_condicion_iva", label: "Condición IVA del receptor", type: "select", col: "f-6", options: conds.map((c) => ({ value: c.id, label: c.nombre })) })}
      ${campo({ name: "receptor_domicilio", label: "Domicilio del receptor", col: "f-6" })}
      <div class="field" data-asoc hidden>${campo({ name: "comprobante_asociado_id", label: "Comprobante asociado (para notas)", type: "select", options: [{ value: "", label: "Seleccionar…" }] })}</div>
      ${campo({ name: "observaciones", label: "Observaciones internas", type: "textarea", attrs: ' rows="2"' })}
      <p class="form-error" data-error hidden></p></form>`,
    foot: html`<button class="btn btn--ghost" data-close>Cancelar</button><button class="btn" form="f-fac">Crear borrador</button>`,
  });
  const form = m.el.querySelector("form");
  const llenarCliente = async () => {
    const c = clientes.find((x) => x.id === form.cliente_id.value);
    if (!c) return;
    form.receptor_razon_social.value = c.razon_social;
    form.receptor_doc_nro.value = cuitFmt(c.cuit);
    form.receptor_condicion_iva.value = c.condicion_iva;
    form.receptor_domicilio.value = [c.domicilio_calle, c.domicilio_numero, c.domicilio_localidad, c.domicilio_provincia].filter(Boolean).join(" ");
    if (!emisorMono) form.tipo_comprobante.value = Number(c.condicion_iva) === 1 ? "1" : "6";
    const [{ data: ops }, { data: facs }] = await Promise.all([
      sb.from("operaciones").select("id, numero").eq("cliente_id", c.id).neq("estado", "borrador").order("created_at", { ascending: false }),
      sb.from("facturas").select("id, tipo_comprobante, punto_venta, numero").eq("cliente_id", c.id).eq("estado", "autorizada").in("tipo_comprobante", [1, 6, 11]),
    ]);
    form.operacion_id.innerHTML = `<option value="">Ninguna</option>` + (ops ?? []).map((o) => `<option value="${o.id}" ${o.id === operacion_id ? "selected" : ""}>${o.numero}</option>`).join("");
    form.comprobante_asociado_id.innerHTML = `<option value="">Seleccionar…</option>` + (facs ?? []).map((f) => `<option value="${f.id}">${TIPOS_COMPROBANTE[f.tipo_comprobante]} ${nroComprobante(f)}</option>`).join("");
  };
  const ajustar = () => {
    const nota = [2, 3, 7, 8, 12, 13].includes(Number(form.tipo_comprobante.value));
    form.querySelector("[data-asoc]").hidden = !nota;
    const serv = Number(form.concepto.value) !== 1;
    ["fecha_servicio_desde", "fecha_servicio_hasta", "fecha_vto_pago"].forEach((k) => { form[k].closest(".field").hidden = !serv; form[k].required = serv; });
  };
  form.cliente_id.addEventListener("change", llenarCliente);
  form.tipo_comprobante.addEventListener("change", ajustar);
  form.concepto.addEventListener("change", ajustar);
  ajustar(); if (cliente_id) llenarCliente();

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const err = form.querySelector("[data-error]"); err.hidden = true;
    if (!validarForm(form)) { err.textContent = "Revisá los campos marcados."; err.hidden = false; return; }
    const d = leerForm(form);
    const nota = [2, 3, 7, 8, 12, 13].includes(Number(d.tipo_comprobante));
    if (nota && !d.comprobante_asociado_id) { err.textContent = "Elegí el comprobante asociado."; err.hidden = false; return; }
    const serv = Number(d.concepto) !== 1;
    conCarga(m.el.querySelector(".modal__foot .btn:not(.btn--ghost)"), async () => {
      const { data: f, error } = await sb.from("facturas").insert({
        cliente_id: d.cliente_id, operacion_id: d.operacion_id, tipo_comprobante: Number(d.tipo_comprobante), punto_venta: cfg?.punto_venta ?? 1,
        concepto: Number(d.concepto), fecha_emision: d.fecha_emision,
        fecha_servicio_desde: serv ? d.fecha_servicio_desde : null, fecha_servicio_hasta: serv ? d.fecha_servicio_hasta : null, fecha_vto_pago: serv ? d.fecha_vto_pago : null,
        receptor_doc_tipo: 80, receptor_doc_nro: d.receptor_doc_nro, receptor_razon_social: d.receptor_razon_social,
        receptor_condicion_iva: Number(d.receptor_condicion_iva), receptor_domicilio: d.receptor_domicilio,
        comprobante_asociado_id: nota ? d.comprobante_asociado_id : null, observaciones: d.observaciones, created_by: estado.user.id,
      }).select("id").single();
      if (error) { err.textContent = errMsg(error); err.hidden = false; return; }
      m.close(); location.hash = "#/facturacion/" + f.id;
    });
  });
}
