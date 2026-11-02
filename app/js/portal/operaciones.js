// Portal · Mis operaciones.
import { html, money, fecha, pct, badge, listado, toastError } from "../ui.js";

const ESTADOS_CLIENTE = [
  { value: "pendiente", label: "Pendiente" }, { value: "en_analisis", label: "En análisis" }, { value: "aprobada", label: "Aprobada" },
  { value: "activa", label: "Activa" }, { value: "en_mora", label: "En mora" }, { value: "finalizada", label: "Finalizada" },
];

export default async function (el, { sb, titulo }) {
  titulo("Mis operaciones", "Capital, intereses, vencimientos y estados");
  const { data, error } = await sb.from("v_operaciones").select("*").order("fecha_inicio", { ascending: false });
  if (error) return toastError(error);
  const activas = data.filter((o) => ["activa", "en_mora"].includes(o.estado));
  const s = (r, k) => r.reduce((a, x) => a + Number(x[k] || 0), 0);
  el.innerHTML = html`<dl class="sum-strip" style="margin-bottom:16px">
      <div><dt>Operaciones activas</dt><dd>${activas.length}</dd></div>
      <div><dt>Capital vigente</dt><dd>${money(s(activas, "capital"))}</dd></div>
      <div><dt>Intereses pagados (histórico)</dt><dd>${money(s(data, "intereses_cobrados"))}</dd></div>
      <div><dt>Saldo pendiente</dt><dd>${money(s(activas, "saldo_pendiente"))}</dd></div>
    </dl><div id="lista"></div>`;
  listado(el.querySelector("#lista"), {
    rows: data, buscar: ["numero", "tipo_nombre"], exportar: "mis-operaciones",
    filtros: [{ key: "estado", label: "Estado", options: ESTADOS_CLIENTE }],
    onRow: (o) => { location.hash = "#/operaciones/" + o.id; }, vacio: "Todavía no tenés operaciones",
    columns: [
      { key: "numero", label: "Operación", render: (o) => html`<b class="mono">${o.numero}</b><small>${o.tipo_nombre}</small>`, csv: (o) => o.numero },
      { key: "fecha_inicio", label: "Inicio", render: (o) => fecha(o.fecha_inicio), csv: (o) => o.fecha_inicio },
      { key: "fecha_vencimiento", label: "Vencimiento", render: (o) => fecha(o.fecha_vencimiento), csv: (o) => o.fecha_vencimiento },
      { key: "capital", label: "Capital", align: "right", render: (o) => money(o.capital, o.moneda), csv: (o) => o.capital },
      { key: "tasa_interes", label: "Tasa", align: "right", render: (o) => html`${pct(o.tasa_interes)}<small>${o.tasa_periodo}</small>`, csv: (o) => o.tasa_interes },
      { key: "intereses_pactados", label: "Intereses", align: "right", render: (o) => money(o.intereses_pactados, o.moneda), csv: (o) => o.intereses_pactados },
      { key: "saldo_pendiente", label: "Saldo", align: "right", render: (o) => money(o.saldo_pendiente, o.moneda), csv: (o) => o.saldo_pendiente },
      { key: "estado", label: "Estado", render: (o) => badge("operacion", o.estado), csv: (o) => o.estado },
    ],
  });
}
