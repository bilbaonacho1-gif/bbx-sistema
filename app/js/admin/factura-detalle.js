// Detalle de un comprobante: ítems, envío a ARCA y PDF.
import { html, ic, money, fecha, fechaHora, cuitFmt, badge, tablaSimple, campo, leerForm, toast, toastError, confirmar, conCarga, TIPOS_COMPROBANTE, ALICUOTAS, LETRA, nroComprobante, demoTag, $ } from "../ui.js";
import { tiene } from "../core.js";
import { pdfFactura } from "../pdf.js";

export default async function (el, { sb, params, titulo, acciones, refrescar }) {
  const [{ data: f, error }, { data: cfg }, { data: log }] = await Promise.all([
    sb.from("facturas").select("*, factura_items(*), clientes(id, empresas(razon_social)), operaciones(id, numero), asociado:comprobante_asociado_id(tipo_comprobante, punto_venta, numero)").eq("id", params.id).maybeSingle(),
    sb.from("arca_config").select("*").maybeSingle(),
    sb.from("arca_log").select("*").eq("factura_id", params.id).order("created_at", { ascending: false }).limit(10),
  ]);
  if (error) return toastError(error);
  if (!f) { el.innerHTML = html`<div class="empty">${ic("receipt")}<b>Comprobante inexistente</b></div>`; return; }
  f.factura_items.sort((a, b) => a.orden - b.orden);
  const editable = ["borrador", "rechazada"].includes(f.estado) && tiene("facturacion.emitir");
  const esC = LETRA[f.tipo_comprobante] === "C";
  titulo(`${TIPOS_COMPROBANTE[f.tipo_comprobante]} ${nroComprobante(f)}`, f.receptor_razon_social);
  acciones(html`<button class="btn btn--ghost" id="pdf">${ic("download", "ico-sm")} ${f.estado === "autorizada" ? "PDF" : "Vista previa (sin validez)"}</button>
    ${editable && f.factura_items.length ? html`<button class="btn" id="emitir">${ic("send", "ico-sm")} Emitir en ARCA</button>` : ""}`);

  el.innerHTML = html`
    <a class="back" href="#/facturacion">${ic("arrowLeft", "ico-sm")} Facturación</a>
    <div class="detail-head"><div class="grow">
      <h2>${TIPOS_COMPROBANTE[f.tipo_comprobante]} <span class="mono">${nroComprobante(f)}</span> ${badge("factura", f.estado)}${demoTag(f)}</h2>
      <p><a href="#/clientes/${f.cliente_id}">${f.clientes?.empresas?.razon_social}</a>${f.operaciones ? html` · <a href="#/operaciones/${f.operaciones.id}">${f.operaciones.numero}</a>` : ""} · Emisión ${fecha(f.fecha_emision)}</p>
    </div>${f.estado === "borrador" && tiene("facturacion.emitir") ? html`<button class="btn btn--danger" id="borrar">${ic("trash", "ico-sm")} Eliminar borrador</button>` : ""}</div>

    ${f.estado === "autorizada" ? html`<div class="callout callout--ok" style="margin-bottom:16px">${ic("checkCircle")}<div><b>Autorizado por ARCA.</b> CAE <span class="mono">${f.cae}</span>, vence el ${fecha(f.cae_vencimiento)}. ${f.ambiente === "homologacion" ? html`<b>Ambiente de homologación: sin validez fiscal.</b>` : ""} Para corregirlo emití una nota de crédito.</div></div>`
      : f.estado === "rechazada" ? html`<div class="callout callout--danger" style="margin-bottom:16px">${ic("xCircle")}<div><b>ARCA rechazó el comprobante.</b><ul style="margin:6px 0 0;padding-left:18px">${(f.errores_arca ?? []).map((e) => html`<li>${e.codigo ? `[${e.codigo}] ` : ""}${e.mensaje}</li>`)}</ul>Corregí los datos y volvé a enviarlo.</div></div>`
      : html`<div class="callout callout--warn" style="margin-bottom:16px">${ic("alert")}<div><b>Borrador sin validez fiscal.</b> No es un comprobante hasta que ARCA le asigne CAE.</div></div>`}

    <div class="grid grid-3" style="align-items:start">
      <div class="card span-2"><div class="card__head"><h3>Ítems</h3></div>
        <div class="card__body--flush">${tablaSimple([
          { label: "Descripción", key: "descripcion" },
          { label: "Cant.", align: "right", render: (i) => Number(i.cantidad) },
          { label: "Precio unit.", align: "right", render: (i) => money(i.precio_unitario) },
          ...(esC ? [] : [{ label: "IVA", align: "right", render: (i) => html`${ALICUOTAS[i.alicuota_iva_id]}<small>${money(i.importe_iva)}</small>` }]),
          { label: "Subtotal", align: "right", render: (i) => money(i.importe_neto) },
          ...(editable ? [{ label: "", align: "right", render: (i) => html`<button class="btn-icon btn-icon--plain" data-quitar="${i.id}" aria-label="Quitar">${ic("trash")}</button>` }] : []),
        ], f.factura_items, { vacio: "Agregá al menos un ítem" })}</div>
        ${editable ? html`<div class="card__body" style="border-top:1px solid var(--line)"><form class="form" id="f-item" novalidate>
          ${campo({ name: "descripcion", label: "Descripción", required: true, col: "f-6", attrs: ' maxlength="200"' })}
          ${campo({ name: "cantidad", label: "Cant.", type: "number", value: 1, min: "0.0001", step: "0.0001", required: true, col: "f-3" })}
          ${campo({ name: "precio_unitario", label: "Precio unit. (neto)", type: "money", required: true, min: "0", col: "f-3" })}
          ${!esC ? campo({ name: "alicuota_iva_id", label: "Alícuota IVA", type: "select", value: 5, col: "f-4", options: Object.entries(ALICUOTAS).map(([value, label]) => ({ value, label })) }) : ""}
          <div class="form-actions" style="grid-column:span ${esC ? 12 : 8};align-self:end"><button class="btn btn--ghost">${ic("plus", "ico-sm")} Agregar ítem</button></div></form></div>` : ""}
      </div>
      <div class="stack">
        <div class="card"><div class="card__head"><h3>Totales</h3></div><div class="card__body"><dl class="dl" style="grid-template-columns:1fr">
          ${esC ? "" : html`<div><dt>Neto gravado</dt><dd>${money(f.importe_neto)}</dd></div><div><dt>IVA</dt><dd>${money(f.importe_iva)}</dd></div>
          <div><dt>Exento / no gravado</dt><dd>${money(Number(f.importe_exento) + Number(f.importe_no_gravado))}</dd></div>`}
          <div><dt>Total</dt><dd style="font-size:22px">${money(f.importe_total)}</dd></div></dl></div></div>
        <div class="card"><div class="card__head"><h3>Receptor</h3></div><div class="card__body"><dl class="dl" style="grid-template-columns:1fr">
          <div><dt>Razón social</dt><dd>${f.receptor_razon_social}</dd></div><div><dt>CUIT</dt><dd>${cuitFmt(f.receptor_doc_nro)}</dd></div>
          ${f.concepto !== 1 ? html`<div><dt>Período</dt><dd>${fecha(f.fecha_servicio_desde)} al ${fecha(f.fecha_servicio_hasta)} · vto. ${fecha(f.fecha_vto_pago)}</dd></div>` : ""}
          ${f.asociado ? html`<div><dt>Comprobante asociado</dt><dd>${TIPOS_COMPROBANTE[f.asociado.tipo_comprobante]} ${nroComprobante(f.asociado)}</dd></div>` : ""}
        </dl></div></div>
        ${log?.length ? html`<div class="card"><div class="card__head"><h3>Registro ARCA</h3></div><div class="card__body--flush"><ul class="list">${log.map((l) => html`<li><span class="bullet ${l.exito ? "" : "bullet--danger"}"></span><span class="grow"><b>${l.operacion} · ${l.exito ? "OK" : "Error"}</b><span>${fechaHora(l.created_at)} · ${l.ambiente}</span></span></li>`)}</ul></div></div>` : ""}
      </div>
    </div>`;

  $("#pdf").onclick = () => pdfFactura(f, cfg).catch(toastError);
  $("#borrar")?.addEventListener("click", async () => {
    if (!(await confirmar("Se eliminará el borrador.", { titulo: "Eliminar borrador", ok: "Eliminar", peligro: true }))) return;
    const { error } = await sb.from("facturas").delete().eq("id", f.id);
    if (error) return toastError(error);
    toast("Borrador eliminado"); location.hash = "#/facturacion";
  });
  $("#f-item")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const d = leerForm(e.target);
    if (!d.descripcion || !(d.cantidad > 0) || d.precio_unitario === null) return toast("Completá descripción, cantidad y precio", "error");
    const { error } = await sb.from("factura_items").insert({ factura_id: f.id, descripcion: d.descripcion, cantidad: d.cantidad, precio_unitario: d.precio_unitario, alicuota_iva_id: Number(d.alicuota_iva_id ?? 3), orden: f.factura_items.length });
    if (error) return toastError(error);
    refrescar();
  });
  el.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-quitar]"); if (!b) return;
    const { error } = await sb.from("factura_items").delete().eq("id", b.dataset.quitar);
    if (error) return toastError(error);
    refrescar();
  });
  $("#emitir")?.addEventListener("click", async (e) => {
    if (!(await confirmar(`Se enviará a ARCA (${cfg?.ambiente ?? "homologacion"}) un comprobante por ${money(f.importe_total)}. Una vez autorizado no se puede modificar.`, { titulo: "Emitir comprobante", ok: "Emitir" }))) return;
    await conCarga(e.target.closest("button"), async () => {
      const { data, error } = await sb.functions.invoke("arca-factura", { body: { accion: "emitir", factura_id: f.id } });
      if (error) {
        let msg = error.message;
        try { const j = await error.context.json(); msg = j.error ?? msg; if (j.errores) msg += ": " + j.errores.map((x) => x.mensaje).join("; "); } catch { /* sin cuerpo */ }
        toast(msg, "error", 9000);
      } else if (data?.estado === "autorizada") {
        toast(`Autorizado. CAE ${data.cae}`);
      }
      refrescar();
    });
  });
}
