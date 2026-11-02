// Portal · Estado de cuenta: movimientos, pagos, intereses cobrados, saldos y facturas.
import { html, ic, money, fecha, tabs, tablaSimple, toastError, MEDIOS, TIPOS_COMPROBANTE, nroComprobante, $ } from "../ui.js";
import { estado } from "../core.js";
import { pdfEstadoCuenta, pdfFactura } from "../pdf.js";

export default async function (el, { sb, titulo, acciones }) {
  titulo("Estado de cuenta", "Movimientos, pagos, intereses y facturas");
  const [{ data: movs, error }, { data: pagos }, { data: intereses }, { data: facturas }] = await Promise.all([
    sb.from("v_estado_cuenta").select("*").order("fecha").order("created_at"),
    sb.from("pagos").select("*, operaciones(numero)").eq("anulado", false).order("fecha", { ascending: false }),
    sb.from("intereses").select("*, operaciones(numero)").eq("tipo", "cobrado").order("fecha", { ascending: false }),
    sb.from("facturas").select("*, factura_items(*)").order("fecha_emision", { ascending: false }),
  ]);
  if (error) return toastError(error);
  const saldo = movs.length ? movs[movs.length - 1].saldo : 0;
  const sum = (r, k = "importe") => r.reduce((a, x) => a + Number(x[k] || 0), 0);
  acciones(html`<button class="btn btn--ghost" id="pdf">${ic("download", "ico-sm")} Descargar PDF</button>`);
  $("#pdf").onclick = () => pdfEstadoCuenta(estado.cliente, movs).catch(toastError);

  el.innerHTML = html`<dl class="sum-strip" style="margin-bottom:16px">
      <div><dt>Saldo actual</dt><dd>${money(saldo)}</dd></div>
      <div><dt>Total pagado</dt><dd>${money(sum(pagos ?? []))}</dd></div>
      <div><dt>Intereses cobrados por BBX</dt><dd>${money(sum(intereses ?? []))}</dd></div>
      <div><dt>Facturas</dt><dd>${facturas?.length ?? 0}</dd></div>
    </dl><div class="tabs" id="tabs"></div><div id="panel"></div>`;

  const VISTAS = {
    movimientos: () => html`<div class="card">${tablaSimple([
      { label: "Fecha", render: (m) => fecha(m.fecha) },
      { label: "Concepto", render: (m) => html`${m.concepto}${m.operacion_numero ? html`<small>${m.operacion_numero}</small>` : ""}` },
      { label: "Cargo", align: "right", render: (m) => (m.sentido === "cargo" ? money(m.importe) : "") },
      { label: "Pago", align: "right", render: (m) => (m.sentido === "abono" ? money(m.importe) : m.sentido === "informativo" ? html`<span class="muted">${money(m.importe)}</span>` : "") },
      { label: "Saldo", align: "right", render: (m) => (m.sentido === "informativo" ? "" : html`<b>${money(m.saldo)}</b>`) },
    ], movs, { vacio: "Sin movimientos" })}</div>`,
    pagos: () => html`<div class="card">${tablaSimple([
      { label: "Fecha", render: (p) => fecha(p.fecha) }, { label: "Operación", render: (p) => p.operaciones?.numero ?? "—" },
      { label: "Medio", render: (p) => html`${MEDIOS[p.medio]}<small>${p.referencia ?? ""}</small>` },
      { label: "Capital", align: "right", render: (p) => money(p.imputado_capital) }, { label: "Intereses", align: "right", render: (p) => money(p.imputado_intereses) },
      { label: "Gastos y comis.", align: "right", render: (p) => money(Number(p.imputado_gastos) + Number(p.imputado_comisiones)) },
      { label: "Total", align: "right", render: (p) => html`<b>${money(p.importe)}</b>` },
    ], pagos, { vacio: "Sin pagos" })}</div>`,
    intereses: () => html`<div class="card"><div class="card__head"><span class="muted">En las operaciones de descuento los intereses se descuentan al liquidar.</span></div>${tablaSimple([
      { label: "Fecha", render: (i) => fecha(i.fecha) }, { label: "Operación", render: (i) => i.operaciones?.numero ?? "—" },
      { label: "Detalle", render: (i) => i.observaciones ?? "" }, { label: "Importe", align: "right", render: (i) => money(i.importe) },
    ], intereses, { vacio: "Sin intereses cobrados" })}</div>`,
    facturas: () => html`<div class="card">${tablaSimple([
      { label: "Fecha", render: (f) => fecha(f.fecha_emision) },
      { label: "Comprobante", render: (f) => html`<b>${TIPOS_COMPROBANTE[f.tipo_comprobante]}</b><small class="mono">${nroComprobante(f)}</small>` },
      { label: "CAE", render: (f) => html`<span class="mono">${f.cae}</span><small>Vto. ${fecha(f.cae_vencimiento)}</small>` },
      { label: "Total", align: "right", render: (f) => money(f.importe_total) },
      { label: "", align: "right", render: (f) => html`<button class="btn btn--sm btn--ghost" data-fac="${f.id}">${ic("download", "ico-sm")} PDF</button>` },
    ], facturas, { vacio: "Todavía no tenés facturas" })}</div>`,
  };
  const panel = $("#panel");
  tabs($("#tabs"), [{ id: "movimientos", label: "Movimientos" }, { id: "pagos", label: "Pagos" }, { id: "intereses", label: "Intereses cobrados" }, { id: "facturas", label: "Facturas" }], "movimientos", (t) => { panel.innerHTML = VISTAS[t](); });
  panel.innerHTML = VISTAS.movimientos();
  panel.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-fac]"); if (!b) return;
    const f = facturas.find((x) => x.id === b.dataset.fac);
    const { data: emisor } = await sb.rpc("datos_emisor");
    pdfFactura(f, emisor ?? {}).catch(toastError);
  });
}
