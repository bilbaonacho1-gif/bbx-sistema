// Reportes por período: resultados, intereses, originación, facturación y cartera.
import { html, ic, money, fecha, num, CATEGORIAS, hoyISO, tablaSimple, descargarCSV, toastError, $ } from "../ui.js";

export default async function (el, { sb, titulo, acciones }) {
  titulo("Reportes", "Resultados y actividad por período");
  const hoy = hoyISO();
  const per = { desde: hoy.slice(0, 8) + "01", hasta: hoy };
  acciones(html`<span class="row" style="flex-wrap:nowrap">
    <select class="select" id="rapido" aria-label="Período" style="width:auto"><option value="mes">Mes en curso</option><option value="mes_ant">Mes anterior</option><option value="trim">Últimos 3 meses</option><option value="anio">Año en curso</option><option value="custom">Personalizado</option></select>
    <input class="input" type="date" id="desde" value="${per.desde}" style="width:150px" aria-label="Desde"><input class="input" type="date" id="hasta" value="${per.hasta}" style="width:150px" aria-label="Hasta"></span>
    <button class="btn btn--ghost" id="csv">${ic("download", "ico-sm")} CSV</button><button class="btn btn--ghost" id="imprimir">Imprimir</button>`);
  let rep = null;

  async function cargar() {
    const { data, error } = await sb.rpc("reporte_periodo", { p_desde: per.desde, p_hasta: per.hasta });
    if (error) return toastError(error);
    rep = data;
    const cats = data.por_categoria ?? [];
    const ing = cats.filter((c) => c.tipo === "ingreso"), egr = cats.filter((c) => c.tipo === "egreso");
    const resultado = ["intereses_cobrados", "comisiones", "gastos_recuperados", "otros_ingresos"];
    const gastos = ["gasto_operativo", "impuestos", "honorarios", "servicios", "sueldos", "otros_egresos"];
    const s = (r) => r.reduce((a, x) => a + Number(x.importe), 0);
    const ingRes = s(ing.filter((c) => resultado.includes(c.categoria))), gasOp = s(egr.filter((c) => gastos.includes(c.categoria)));
    const tramos = { a_vencer: "A vencer", vencido_30: "1–30 días", vencido_60: "31–60 días", vencido_90: "61–90 días", vencido_mas_90: "Más de 90 días" };
    el.innerHTML = html`
      <p class="muted" style="margin-bottom:14px">Período del ${fecha(per.desde)} al ${fecha(per.hasta)}</p>
      <div class="grid grid-4 kpi-grid">
        <div class="card kpi"><div class="kpi__label">Ingresos por resultados</div><div class="kpi__value kpi__value--sm">${money(ingRes)}</div></div>
        <div class="card kpi"><div class="kpi__label">Gastos operativos</div><div class="kpi__value kpi__value--sm">${money(gasOp)}</div></div>
        <div class="card kpi"><div class="kpi__label">Resultado operativo (percibido)</div><div class="kpi__value kpi__value--sm ${ingRes - gasOp >= 0 ? "ok-text" : "danger-text"}">${money(ingRes - gasOp)}</div></div>
        <div class="card kpi"><div class="kpi__label">Operaciones originadas</div><div class="kpi__value kpi__value--sm">${num(data.operaciones_originadas?.cantidad)}</div><div class="kpi__foot">${money(data.operaciones_originadas?.capital)} de capital</div></div>
      </div>
      <div class="grid grid-2" style="margin-top:16px">
        <div class="card"><div class="card__head"><h3>Intereses del período</h3></div><div class="card__body"><dl class="dl">
          <div><dt>Devengados (lineal)</dt><dd style="font-size:18px">${money(data.intereses_devengados)}</dd></div>
          <div><dt>Cobrados</dt><dd style="font-size:18px">${money(data.intereses_cobrados)}</dd></div>
          <div><dt>Diferencia (cobrado − devengado)</dt><dd>${money(data.intereses_cobrados - data.intereses_devengados)}</dd></div>
        </dl><p class="muted" style="margin-top:12px">Una diferencia positiva indica intereses cobrados por adelantado que se devengarán en períodos siguientes.</p></div></div>
        <div class="card"><div class="card__head"><h3>Facturación (comprobantes autorizados)</h3></div><div class="card__body"><dl class="dl">
          <div><dt>Comprobantes</dt><dd>${num(data.facturado?.cantidad)}</dd></div><div><dt>Neto</dt><dd>${money(data.facturado?.neto)}</dd></div>
          <div><dt>IVA</dt><dd>${money(data.facturado?.iva)}</dd></div><div><dt>Total</dt><dd>${money(data.facturado?.total)}</dd></div></dl></div></div>
      </div>
      <div class="grid grid-2" style="margin-top:16px">
        <div class="card"><div class="card__head"><h3>Ingresos por categoría</h3></div><div class="card__body--flush">${tablaSimple([
          { label: "Categoría", render: (c) => CATEGORIAS[c.categoria] }, { label: "Mov.", align: "right", key: "cantidad" }, { label: "Importe", align: "right", render: (c) => money(c.importe) },
        ], ing, { vacio: "Sin ingresos", pie: html`<tr><td colspan="2">Total</td><td class="right num">${money(s(ing))}</td></tr>` })}</div></div>
        <div class="card"><div class="card__head"><h3>Egresos por categoría</h3></div><div class="card__body--flush">${tablaSimple([
          { label: "Categoría", render: (c) => CATEGORIAS[c.categoria] }, { label: "Mov.", align: "right", key: "cantidad" }, { label: "Importe", align: "right", render: (c) => money(c.importe) },
        ], egr, { vacio: "Sin egresos", pie: html`<tr><td colspan="2">Total</td><td class="right num">${money(s(egr))}</td></tr>` })}</div></div>
      </div>
      <div class="card" style="margin-top:16px"><div class="card__head"><h3>Cuentas por cobrar (a hoy)</h3></div><div class="card__body">
        <dl class="sum-strip">${Object.entries(tramos).map(([k, l]) => html`<div><dt>${l}</dt><dd>${money(data.cuentas_por_cobrar?.[k] ?? 0)}</dd></div>`)}</dl></div></div>`;
  }

  const rapido = (v) => {
    const d = new Date();
    const iso = (x) => new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    if (v === "mes") { per.desde = hoy.slice(0, 8) + "01"; per.hasta = hoy; }
    if (v === "mes_ant") { const a = new Date(d.getFullYear(), d.getMonth() - 1, 1), b = new Date(d.getFullYear(), d.getMonth(), 0); per.desde = iso(a); per.hasta = iso(b); }
    if (v === "trim") { per.desde = iso(new Date(d.getFullYear(), d.getMonth() - 2, 1)); per.hasta = hoy; }
    if (v === "anio") { per.desde = hoy.slice(0, 4) + "-01-01"; per.hasta = hoy; }
    $("#desde").value = per.desde; $("#hasta").value = per.hasta;
  };
  $("#rapido").onchange = (e) => { if (e.target.value !== "custom") { rapido(e.target.value); cargar(); } };
  ["desde", "hasta"].forEach((k) => $("#" + k).addEventListener("change", (e) => { per[k] = e.target.value; $("#rapido").value = "custom"; cargar(); }));
  $("#imprimir").onclick = () => print();
  $("#csv").onclick = () => {
    if (!rep) return;
    const filas = [
      ...(rep.por_categoria ?? []).map((c) => ({ concepto: `${c.tipo === "ingreso" ? "Ingreso" : "Egreso"}: ${CATEGORIAS[c.categoria]}`, importe: c.importe })),
      { concepto: "Intereses devengados", importe: rep.intereses_devengados }, { concepto: "Intereses cobrados", importe: rep.intereses_cobrados },
      { concepto: "Capital originado", importe: rep.operaciones_originadas?.capital }, { concepto: "Facturado total", importe: rep.facturado?.total },
    ];
    descargarCSV(`reporte_${per.desde}_${per.hasta}`, filas, [{ label: "Concepto", key: "concepto" }, { label: "Importe", key: "importe" }]);
  };
  await cargar();
}
