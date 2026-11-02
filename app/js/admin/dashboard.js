// Dashboard general: indicadores, evolución, vencimientos y actividad reciente.
import { html, ic, raw, money, moneyShort, num, fecha, hace, hoyISO, sumarDias, badge, toastError, $ } from "../ui.js";
import { areaChart, barChart, barrasH, mesCorto } from "../charts.js";
import { tiene } from "../core.js";

const PERIODOS = { "30": "Últimos 30 días", "90": "Últimos 90 días", "365": "Últimos 12 meses", "anio": "Año en curso" };

export default async function (el, { sb, titulo, acciones }) {
  titulo("Panel administrador", "Resumen general del sistema");
  let periodo = sessionStorage.getItem("bbx-periodo") || "365";
  acciones(html`<select class="select" id="periodo" aria-label="Período" style="width:auto">
    ${Object.entries(PERIODOS).map(([v, l]) => html`<option value="${v}" ${v === periodo ? raw("selected") : ""}>${l}</option>`)}</select>`);
  $("#periodo").onchange = (e) => { periodo = e.target.value; sessionStorage.setItem("bbx-periodo", periodo); cargar(); };

  async function cargar() {
    const hasta = hoyISO();
    const desde = periodo === "anio" ? hasta.slice(0, 4) + "-01-01" : sumarDias(hasta, -Number(periodo));
    const [res, venc, act] = await Promise.all([
      sb.rpc("dashboard_resumen", { p_desde: desde, p_hasta: hasta }),
      sb.from("v_vencimientos").select("*").gte("fecha", sumarDias(hasta, -30)).lte("fecha", sumarDias(hasta, 30)).order("fecha").limit(8),
      sb.from("operacion_estados").select("*, operaciones(numero, id)").order("created_at", { ascending: false }).limit(8),
    ]);
    if (res.error) return toastError(res.error);
    const d = res.data;
    const k = (icono, label, valor, foot = "", href = "") => html`
      <div class="card kpi ${href ? "kpi--link" : ""}" ${href ? raw(`data-href="${href}"`) : ""}>
        <div class="kpi__label"><span class="kpi__icon">${ic(icono, "ico-sm")}</span>${label}</div>
        <div class="kpi__value">${valor}</div><div class="kpi__foot">${foot}</div></div>`;

    el.innerHTML = html`
      ${d.solicitudes_pendientes || d.documentos_a_revisar || d.operaciones_mora ? html`<div class="row" style="margin-bottom:16px">
        ${d.solicitudes_pendientes ? html`<a class="callout" href="#/solicitudes" style="flex:1;min-width:240px">${ic("userPlus")}<div><b>${d.solicitudes_pendientes} solicitud(es) de acceso</b> esperan aprobación.</div></a>` : ""}
        ${d.documentos_a_revisar ? html`<a class="callout callout--warn" href="#/documentacion" style="flex:1;min-width:240px">${ic("folder")}<div><b>${d.documentos_a_revisar} documento(s)</b> para revisar.</div></a>` : ""}
        ${d.operaciones_mora ? html`<a class="callout callout--danger" href="#/operaciones?estado=en_mora" style="flex:1;min-width:240px">${ic("alert")}<div><b>${d.operaciones_mora} operación(es) en mora.</b></div></a>` : ""}
      </div>` : ""}
      <div class="grid grid-4 kpi-grid">
        ${k("users", "Clientes", num(d.clientes), html`<span class="pill pill--up">+${d.clientes_nuevos_mes} este mes</span> ${d.clientes_activos} activos`, "#/clientes")}
        ${k("transfer", "Operaciones activas", num(d.operaciones_activas), html`${d.operaciones_mora ? html`<span class="pill pill--down">${d.operaciones_mora} en mora</span>` : "Sin mora"}`, "#/operaciones?estado=activa")}
        ${k("clock", "Operaciones pendientes", num(d.operaciones_pendientes), "Pendientes, en análisis o aprobadas sin liquidar", "#/operaciones?estado=pendiente")}
        ${k("wallet", "Capital operado", money(d.capital_operado), html`Vigente: ${moneyShort(d.capital_vigente)}`)}
        ${k("coins", "Intereses cobrados", money(d.intereses_cobrados), "Efectivamente percibidos en el período")}
        ${k("percent", "Intereses devengados", money(d.intereses_devengados), "Ganados según el tiempo transcurrido")}
        ${k("receipt", "Facturación total", money(d.facturacion_total), "Comprobantes autorizados por ARCA", tiene("facturacion.ver") ? "#/facturacion" : "")}
        ${k("trendUp", "Saldo a cobrar", money(d.saldo_a_cobrar), "Operaciones activas y en mora", tiene("contabilidad.ver") ? "#/contabilidad?tab=cobrar" : "")}
      </div>

      <div class="grid grid-3" style="margin-top:16px">
        <div class="card span-2">
          <div class="card__head"><h2>Evolución de operaciones</h2><span class="legend"><span><i></i>Capital originado</span></span></div>
          <div class="card__body"><div id="ch-capital"></div></div>
        </div>
        <div class="card">
          <div class="card__head"><h2>Vencimientos próximos</h2><a href="#/operaciones" class="muted">Ver todo</a></div>
          <div class="card__body--flush">
            ${venc.data?.length ? html`<ul class="list">${venc.data.map((v) => html`<li>
              <span class="bullet ${v.fecha < hoyISO() ? "bullet--danger" : v.fecha <= sumarDias(hoyISO(), 7) ? "bullet--warn" : ""}"></span>
              <a class="grow" href="#/operaciones/${v.operacion_id}" style="color:inherit;text-decoration:none"><b>${v.tipo === "cheque" ? v.detalle : "Op. " + v.numero}</b><span>${v.razon_social}</span></a>
              <span class="right"><b class="num" style="display:block;font-weight:500">${fecha(v.fecha)}</b><small class="muted num">${moneyShort(v.importe)}</small></span></li>`)}</ul>`
              : html`<div class="empty">${ic("calendar")}<b>Sin vencimientos en los próximos 30 días</b></div>`}
          </div>
        </div>
      </div>

      <div class="grid grid-3" style="margin-top:16px">
        <div class="card span-2">
          <div class="card__head"><h2>Intereses cobrados por mes</h2><span class="muted">Cobrados ≠ devengados</span></div>
          <div class="card__body"><div id="ch-intereses"></div></div>
        </div>
        <div class="card">
          <div class="card__head"><h2>Cartera vigente por tipo</h2></div>
          <div class="card__body">${d.por_tipo?.length ? raw(barrasH(d.por_tipo.map((t) => ({ label: t.tipo, valor: Number(t.capital), detalle: `${t.cantidad} operación(es)` })), money)) : html`<p class="muted">Sin operaciones activas.</p>`}</div>
        </div>
      </div>

      <div class="card" style="margin-top:16px">
        <div class="card__head"><h2>Actividad reciente</h2></div>
        <div class="card__body--flush">
          ${act.data?.length ? html`<ul class="list">${act.data.map((a) => html`<li>
            <span class="bullet"></span>
            <a class="grow" href="#/operaciones/${a.operacion_id}" style="color:inherit;text-decoration:none"><b>Operación ${a.operaciones?.numero ?? ""}: ${a.estado_anterior ? html`${badge("operacion", a.estado_anterior)} → ` : ""}${badge("operacion", a.estado_nuevo)}</b>
            <span>${a.comentario ?? ""}</span></a><span class="muted nowrap">${hace(a.created_at)}</span></li>`)}</ul>`
            : html`<div class="empty">${ic("activity")}<b>Todavía no hay actividad</b></div>`}
        </div>
      </div>`;

    el.querySelectorAll("[data-href]").forEach((c) => c.addEventListener("click", () => { location.hash = c.dataset.href; }));
    const serie = d.serie_mensual ?? [];
    const etiquetas = serie.map((s) => mesCorto(s.mes));
    areaChart($("#ch-capital"), { etiquetas, series: [{ nombre: "Capital originado", valores: serie.map((s) => Number(s.capital)) }], formato: (v, eje) => (eje ? moneyShort(v) : money(v)) });
    barChart($("#ch-intereses"), { etiquetas, series: [{ nombre: "Intereses cobrados", valores: serie.map((s) => Number(s.intereses_cobrados)) }], formato: (v, eje) => (eje ? moneyShort(v) : money(v)), alto: 220 });
  }
  await cargar();
}
