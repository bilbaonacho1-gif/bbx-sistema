// Portal · Detalle de una operación del cliente.
import { html, ic, money, fecha, fechaHora, pct, cuitFmt, badge, tablaSimple, toastError, MEDIOS, $ } from "../ui.js";
import { pdfLiquidacion } from "../pdf.js";

export default async function (el, { sb, params, titulo, acciones }) {
  const { data: o, error } = await sb.from("v_operaciones").select("*").eq("id", params.id).maybeSingle();
  if (error) return toastError(error);
  if (!o) { el.innerHTML = html`<div class="empty">${ic("transfer")}<b>Operación inexistente</b></div>`; return; }
  const [{ data: cheques }, { data: pagos }, { data: hist }, { data: acuerdo }] = await Promise.all([
    sb.from("cheques").select("*").eq("operacion_id", o.id).order("fecha_pago"),
    sb.from("pagos").select("*").eq("operacion_id", o.id).eq("anulado", false).order("fecha", { ascending: false }),
    sb.from("operacion_estados").select("estado_anterior, estado_nuevo, created_at").eq("operacion_id", o.id).order("created_at", { ascending: false }),
    sb.from("acuerdos").select("*").eq("operacion_id", o.id).maybeSingle(),
  ]);
  titulo(`Operación ${o.numero}`, o.tipo_nombre);
  acciones(html`<button class="btn btn--ghost" id="pdf">${ic("download", "ico-sm")} Liquidación (PDF)</button>`);
  $("#pdf").onclick = () => pdfLiquidacion(o, cheques ?? []).catch(toastError);

  el.innerHTML = html`
    <a class="back" href="#/operaciones">${ic("arrowLeft", "ico-sm")} Mis operaciones</a>
    <div class="detail-head"><div class="grow"><h2><span class="mono">${o.numero}</span> ${badge("operacion", o.estado)}</h2>
      <p>${o.tipo_nombre} · ${o.modalidad === "descuento" ? "intereses descontados al liquidar" : "intereses al vencimiento"}</p></div></div>
    <dl class="sum-strip" style="margin-bottom:16px">
      <div><dt>Capital</dt><dd>${money(o.capital, o.moneda)}</dd></div>
      <div><dt>Intereses</dt><dd>${money(o.intereses_pactados, o.moneda)}</dd></div>
      <div><dt>Gastos y comisiones</dt><dd>${money(Number(o.gastos) + Number(o.comisiones) + Number(o.iva_comisiones), o.moneda)}</dd></div>
      <div><dt>${o.modalidad === "descuento" ? "Neto recibido" : "Importe recibido"}</dt><dd>${money(o.importe_liquidado, o.moneda)}</dd></div>
      <div><dt>Vencimiento</dt><dd>${fecha(o.fecha_vencimiento)}</dd></div>
      <div><dt>Saldo pendiente</dt><dd>${money(o.saldo_pendiente, o.moneda)}</dd></div>
    </dl>
    <div class="grid grid-3" style="align-items:start">
      <div class="stack span-2">
        <div class="card"><div class="card__head"><h3>Condiciones</h3></div><div class="card__body"><dl class="dl dl--3">
          <div><dt>Inicio</dt><dd>${fecha(o.fecha_inicio)}</dd></div><div><dt>Plazo</dt><dd>${o.dias} días</dd></div>
          <div><dt>Tasa</dt><dd>${pct(o.tasa_interes)} ${o.tasa_periodo}</dd></div><div><dt>Total</dt><dd>${money(o.importe_total, o.moneda)}</dd></div>
          <div><dt>Intereses pagados</dt><dd>${money(o.intereses_cobrados, o.moneda)}</dd></div><div><dt>Total pagado</dt><dd>${money(o.total_cobrado, o.moneda)}</dd></div>
        </dl>${o.observaciones ? html`<p style="margin-top:14px;white-space:pre-wrap" class="muted">${o.observaciones}</p>` : ""}</div></div>
        ${acuerdo ? html`<div class="card"><div class="card__head"><h3>Acuerdo en cuenta corriente</h3></div><div class="card__body"><dl class="dl dl--3">
          <div><dt>Límite</dt><dd>${money(acuerdo.limite)}</dd></div><div><dt>Utilizado</dt><dd>${money(o.capital)}</dd></div><div><dt>Disponible</dt><dd>${money(acuerdo.limite - o.capital)}</dd></div></dl></div></div>` : ""}
        ${cheques?.length ? html`<div class="card"><div class="card__head"><h3>Cheques</h3></div><div class="card__body--flush">${tablaSimple([
          { label: "Cheque", render: (c) => html`<b>${c.tipo === "echeq" ? "ECHEQ" : "Físico"} ${c.numero}</b><small>${c.banco}</small>` },
          { label: "Librador", render: (c) => html`${c.librador_nombre ?? "—"}<small>${c.librador_cuit ? cuitFmt(c.librador_cuit) : ""}</small>` },
          { label: "Fecha de pago", render: (c) => fecha(c.fecha_pago) },
          { label: "Importe", align: "right", render: (c) => money(c.monto) },
          { label: "Estado", render: (c) => badge("cheque", c.estado) },
        ], cheques)}</div></div>` : ""}
        <div class="card"><div class="card__head"><h3>Pagos</h3></div><div class="card__body--flush">${tablaSimple([
          { label: "Fecha", render: (p) => fecha(p.fecha) }, { label: "Medio", render: (p) => MEDIOS[p.medio] },
          { label: "Capital", align: "right", render: (p) => money(p.imputado_capital) }, { label: "Intereses", align: "right", render: (p) => money(p.imputado_intereses) },
          { label: "Total", align: "right", render: (p) => html`<b>${money(p.importe)}</b>` },
        ], pagos, { vacio: "Sin pagos registrados" })}</div></div>
      </div>
      <div class="card"><div class="card__head"><h3>Historial</h3></div><div class="card__body">${hist?.length ? html`<ul class="timeline">${hist.map((h) => html`<li><b>${badge("operacion", h.estado_nuevo)}</b><span>${fechaHora(h.created_at)}</span></li>`)}</ul>` : html`<p class="muted">Sin movimientos.</p>`}</div></div>
    </div>`;
}
