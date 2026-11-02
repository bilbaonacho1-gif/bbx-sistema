// Listado de operaciones con filtros, búsqueda, totales y exportación.
import { html, ic, money, fecha, pct, badge, opciones, listado, toastError, demoTag } from "../ui.js";
import { tiene } from "../core.js";

export default async function (el, { sb, query, titulo, acciones }) {
  titulo("Operaciones", "Descuento de cheques, acuerdos en cuenta corriente y otras operaciones");
  if (tiene("operaciones.editar")) acciones(html`<a class="btn" href="#/operaciones/nueva">${ic("plus", "ico-sm")} Nueva operación</a>`);

  const [{ data, error }, { data: tipos }] = await Promise.all([
    sb.from("v_operaciones").select("*").order("created_at", { ascending: false }),
    sb.from("tipos_operacion").select("codigo, nombre").order("orden"),
  ]);
  if (error) return toastError(error);

  const sum = (rows, k) => rows.reduce((a, r) => a + Number(r[k] || 0), 0);
  listado(el, {
    rows: data,
    buscar: ["numero", "cliente_razon_social", "cliente_cuit", "tipo_nombre", "observaciones"],
    filtros: [
      { key: "estado", label: "Estado", options: opciones("operacion") },
      { key: "tipo_codigo", label: "Tipo", options: (tipos ?? []).map((t) => ({ value: t.codigo, label: t.nombre })) },
    ],
    exportar: "operaciones",
    onRow: (o) => { location.hash = "#/operaciones/" + o.id; },
    vacio: "No hay operaciones",
    pie: (rows) => html`<tr><td colspan="4">Totales (${rows.length})</td>
      <td class="right num">${money(sum(rows, "capital"))}</td><td></td>
      <td class="right num">${money(sum(rows, "intereses_devengados_hoy"))}</td>
      <td class="right num">${money(sum(rows, "intereses_cobrados"))}</td>
      <td class="right num">${money(sum(rows, "saldo_pendiente"))}</td><td></td></tr>`,
    columns: [
      { key: "numero", label: "Número", render: (o) => html`<b class="mono">${o.numero}</b>${demoTag(o)}<small>${o.tipo_nombre}</small>`, csv: (o) => o.numero },
      { key: "cliente_razon_social", label: "Cliente", render: (o) => html`<b>${o.cliente_razon_social}</b>`, csv: (o) => o.cliente_razon_social },
      { key: "fecha_inicio", label: "Inicio", render: (o) => fecha(o.fecha_inicio), csv: (o) => o.fecha_inicio },
      { key: "fecha_vencimiento", label: "Vencimiento", render: (o) => html`${fecha(o.fecha_vencimiento)}${["activa", "en_mora"].includes(o.estado) ? html`<small class="${o.dias_para_vencer < 0 ? "danger-text" : o.dias_para_vencer <= 7 ? "warn-text" : ""}">${o.dias_para_vencer < 0 ? `vencida hace ${-o.dias_para_vencer} d` : `en ${o.dias_para_vencer} d`}</small>` : ""}`, csv: (o) => o.fecha_vencimiento },
      { key: "capital", label: "Capital", align: "right", render: (o) => money(o.capital, o.moneda), csv: (o) => o.capital },
      { key: "tasa_interes", label: "Tasa", align: "right", render: (o) => html`${pct(o.tasa_interes)}<small>${o.tasa_periodo}</small>`, csv: (o) => o.tasa_interes },
      { key: "intereses_devengados_hoy", label: "Int. devengados", align: "right", render: (o) => money(o.intereses_devengados_hoy), csv: (o) => o.intereses_devengados_hoy },
      { key: "intereses_cobrados", label: "Int. cobrados", align: "right", render: (o) => money(o.intereses_cobrados), csv: (o) => o.intereses_cobrados },
      { key: "saldo_pendiente", label: "Saldo", align: "right", render: (o) => money(o.saldo_pendiente), csv: (o) => o.saldo_pendiente },
      { key: "estado", label: "Estado", render: (o) => badge("operacion", o.estado), csv: (o) => o.estado },
    ],
  });
  if (query.estado) {
    const sel = el.querySelector('[data-f="estado"]');
    sel.value = query.estado; sel.dispatchEvent(new Event("change", { bubbles: true }));
  }
}
