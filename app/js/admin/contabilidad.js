// Módulo contable: libro de ingresos y egresos, cuentas por cobrar, intereses y cobranzas.
import { html, ic, money, fecha, badge, listado, modal, campo, leerForm, validarForm, conCarga, toast, toastError, errMsg, confirmar, CATEGORIAS, MEDIOS, hoyISO, sumarDias, tabs, tablaSimple, $, reemplazarHash, panelNuevo } from "../ui.js";
import { tiene, estado, subirArchivo, abrirArchivo, validarArchivo } from "../core.js";
import { barChart, mesCorto } from "../charts.js";

export default async function (el, { sb, query, titulo, acciones }) {
  titulo("Contabilidad", "Ingresos, egresos, intereses y cuentas por cobrar");
  const ini = hoyISO().slice(0, 8) + "01";
  const per = { desde: sessionStorage.getItem("bbx-cont-desde") || sumarDias(ini, -150), hasta: sessionStorage.getItem("bbx-cont-hasta") || hoyISO() };
  acciones(html`<span class="row" style="flex-wrap:nowrap">
    <input class="input" type="date" id="desde" value="${per.desde}" aria-label="Desde" style="width:150px">
    <input class="input" type="date" id="hasta" value="${per.hasta}" aria-label="Hasta" style="width:150px"></span>
    ${tiene("contabilidad.editar") ? html`<button class="btn" id="nuevo">${ic("plus", "ico-sm")} Registrar</button>` : ""}`);

  el.innerHTML = html`<div class="tabs" id="tabs"></div><div id="panel"></div>`;
  let actual = query.tab || "libro";
  const pintar = () => { reemplazarHash("#/contabilidad", "#/contabilidad?tab=" + actual); VISTAS[actual](panelNuevo("#panel"), { sb, per, recargar: pintar }).catch(toastError); };
  tabs($("#tabs"), [
    { id: "libro", label: "Movimientos contables" }, { id: "cobrar", label: "Cuentas por cobrar" },
    { id: "intereses", label: "Intereses devengados y cobrados" }, { id: "cobranzas", label: "Cobranzas" },
  ], actual, (t) => { actual = t; pintar(); });
  ["desde", "hasta"].forEach((k) => $("#" + k).addEventListener("change", (e) => { per[k] = e.target.value; sessionStorage.setItem("bbx-cont-" + k, e.target.value); pintar(); }));
  $("#nuevo")?.addEventListener("click", () => registrarMovimiento(sb, () => { actual = "libro"; pintar(); }));
  pintar();
}

const sum = (r, k = "importe") => r.reduce((a, x) => a + Number(x[k] || 0), 0);

const VISTAS = {
  async libro(panel, { sb, per, recargar }) {
    const { data, error } = await sb.from("movimientos_contables").select("*, clientes(empresas(razon_social)), operaciones(numero)")
      .gte("fecha", per.desde).lte("fecha", per.hasta).order("fecha", { ascending: false }).order("created_at", { ascending: false });
    if (error) throw error;
    const vig = data.filter((m) => !m.anulado);
    const ing = vig.filter((m) => m.tipo === "ingreso"), egr = vig.filter((m) => m.tipo === "egreso");
    const resultado = ["intereses_cobrados", "comisiones", "gastos_recuperados", "otros_ingresos"];
    const gastos = ["gasto_operativo", "impuestos", "honorarios", "servicios", "sueldos", "otros_egresos"];
    panel.innerHTML = html`<div class="grid grid-4 kpi-grid" style="margin-bottom:16px">
        <div class="card kpi"><div class="kpi__label">Ingresos por resultados</div><div class="kpi__value kpi__value--sm ok-text">${money(sum(ing.filter((m) => resultado.includes(m.categoria))))}</div><div class="kpi__foot">Intereses, comisiones y gastos cobrados</div></div>
        <div class="card kpi"><div class="kpi__label">Gastos operativos</div><div class="kpi__value kpi__value--sm danger-text">${money(sum(egr.filter((m) => gastos.includes(m.categoria))))}</div><div class="kpi__foot">Honorarios, impuestos, servicios…</div></div>
        <div class="card kpi"><div class="kpi__label">Desembolsos</div><div class="kpi__value kpi__value--sm">${money(sum(egr.filter((m) => m.categoria === "desembolso")))}</div><div class="kpi__foot">Capital entregado a clientes</div></div>
        <div class="card kpi"><div class="kpi__label">Recupero de capital</div><div class="kpi__value kpi__value--sm">${money(sum(ing.filter((m) => m.categoria === "cobro_capital")))}</div><div class="kpi__foot">Capital cobrado</div></div>
      </div><div id="lista"></div>`;
    listado($("#lista", panel), {
      rows: data, buscar: ["concepto", (m) => m.clientes?.empresas?.razon_social, (m) => m.operaciones?.numero], exportar: "movimientos-contables",
      filtros: [{ key: "tipo", label: "Tipo", options: [{ value: "ingreso", label: "Ingresos" }, { value: "egreso", label: "Egresos" }] },
        { key: "categoria", label: "Categoría", options: Object.entries(CATEGORIAS).map(([value, label]) => ({ value, label })) }],
      vacio: "Sin movimientos en el período",
      pie: (rows) => { const v = rows.filter((m) => !m.anulado); return html`<tr><td colspan="4">Ingresos ${money(sum(v.filter((m) => m.tipo === "ingreso")))} · Egresos ${money(sum(v.filter((m) => m.tipo === "egreso")))}</td><td class="right num">${money(sum(v.filter((m) => m.tipo === "ingreso")) - sum(v.filter((m) => m.tipo === "egreso")))}</td><td></td></tr>`; },
      columns: [
        { key: "fecha", label: "Fecha", render: (m) => fecha(m.fecha), csv: (m) => m.fecha },
        { key: "concepto", label: "Concepto", render: (m) => html`<b style="${m.anulado ? "text-decoration:line-through" : ""}">${m.concepto}</b><small>${[m.clientes?.empresas?.razon_social, m.operaciones?.numero, m.medio && (MEDIOS[m.medio] ?? m.medio)].filter(Boolean).join(" · ")}</small>`, csv: (m) => m.concepto },
        { key: "categoria", label: "Categoría", render: (m) => html`<span class="tag">${CATEGORIAS[m.categoria]}</span>${m.automatico ? html`<small>Automático</small>` : ""}`, csv: (m) => CATEGORIAS[m.categoria] },
        { key: "tipo", label: "Tipo", render: (m) => html`<span class="badge ${m.tipo === "ingreso" ? "badge--ok" : "badge--danger"}">${m.tipo === "ingreso" ? "Ingreso" : "Egreso"}</span>${m.anulado ? html` <span class="badge">Anulado</span>` : ""}`, csv: (m) => m.tipo + (m.anulado ? " (anulado)" : "") },
        { key: "importe", label: "Importe", align: "right", render: (m) => html`<span class="${m.tipo === "ingreso" ? "ok-text" : ""}">${m.tipo === "egreso" ? "−" : ""}${money(m.importe)}</span>`, csv: (m) => (m.tipo === "egreso" ? -m.importe : m.importe) },
        { key: "acc", label: "", sort: false, align: "right", csv: false, render: (m) => html`<span class="row" style="justify-content:flex-end;flex-wrap:nowrap">
          ${m.comprobante_path ? html`<button class="btn-icon" data-comp="${m.id}" aria-label="Comprobante">${ic("download")}</button>` : ""}
          ${!m.automatico && !m.anulado && tiene("contabilidad.editar") ? html`<button class="btn btn--sm btn--danger" data-anular="${m.id}">Anular</button>` : ""}</span>` },
      ],
    });
    panel.addEventListener("click", async (e) => {
      const c = e.target.closest("[data-comp]"), a = e.target.closest("[data-anular]");
      if (c) { const m = data.find((x) => x.id === c.dataset.comp); abrirArchivo("comprobantes", m.comprobante_path).catch(toastError); }
      if (a) {
        if (!(await confirmar("El movimiento queda registrado como anulado (no se borra).", { titulo: "Anular movimiento", ok: "Anular", peligro: true }))) return;
        const { error } = await sb.from("movimientos_contables").update({ anulado: true }).eq("id", a.dataset.anular);
        if (error) return toastError(error);
        toast("Movimiento anulado", "info"); recargar();
      }
    });
  },

  async cobrar(panel, { sb }) {
    const { data, error } = await sb.from("v_cuentas_por_cobrar").select("*").order("fecha_vencimiento");
    if (error) throw error;
    const tramos = { a_vencer: "A vencer", vencido_30: "Vencido 1–30 d", vencido_60: "Vencido 31–60 d", vencido_90: "Vencido 61–90 d", vencido_mas_90: "Vencido +90 d" };
    panel.innerHTML = html`<dl class="sum-strip" style="margin-bottom:16px">${Object.entries(tramos).map(([k, l]) => html`<div><dt>${l}</dt><dd class="${k !== "a_vencer" && sum(data.filter((d) => d.tramo === k), "saldo") > 0 ? "danger-text" : ""}">${money(sum(data.filter((d) => d.tramo === k), "saldo"))}</dd></div>`)}
      <div><dt>Total a cobrar</dt><dd>${money(sum(data, "saldo"))}</dd></div></dl><div id="lista"></div>`;
    listado($("#lista", panel), {
      rows: data, buscar: ["numero", "razon_social"], exportar: "cuentas-por-cobrar", onRow: (r) => { location.hash = "#/operaciones/" + r.operacion_id; },
      filtros: [{ key: "tramo", label: "Antigüedad", options: Object.entries(tramos).map(([value, label]) => ({ value, label })) }],
      vacio: "No hay saldos pendientes",
      columns: [
        { key: "numero", label: "Operación", render: (r) => html`<b class="mono">${r.numero}</b>` , csv: (r) => r.numero },
        { key: "razon_social", label: "Cliente" },
        { key: "fecha_vencimiento", label: "Vencimiento", render: (r) => fecha(r.fecha_vencimiento), csv: (r) => r.fecha_vencimiento },
        { key: "tramo", label: "Antigüedad", render: (r) => html`<span class="badge ${r.tramo === "a_vencer" ? "badge--info" : "badge--danger"}">${tramos[r.tramo]}</span>`, csv: (r) => tramos[r.tramo] },
        { key: "estado", label: "Estado", render: (r) => badge("operacion", r.estado), csv: (r) => r.estado },
        { key: "importe_total", label: "Importe total", align: "right", render: (r) => money(r.importe_total), csv: (r) => r.importe_total },
        { key: "saldo", label: "Saldo", align: "right", render: (r) => html`<b>${money(r.saldo)}</b>`, csv: (r) => r.saldo },
      ],
    });
  },

  async intereses(panel, { sb, per, recargar }) {
    const { data, error } = await sb.from("intereses").select("tipo, fecha, importe").gte("fecha", per.desde).lte("fecha", per.hasta);
    if (error) throw error;
    const meses = [...new Set(data.map((i) => i.fecha.slice(0, 7)))].sort();
    const porMes = (t) => meses.map((m) => sum(data.filter((i) => i.tipo === t && i.fecha.startsWith(m))));
    panel.innerHTML = html`<div class="stack">
      <div class="callout">${ic("info")}<div>Los <b>intereses devengados</b> se reconocen proporcionalmente al tiempo transcurrido; los <b>cobrados</b> son los efectivamente percibidos (en las operaciones de descuento se cobran por adelantado al liquidar). Nunca se mezclan.</div></div>
      <div class="grid grid-3">
        <div class="card kpi"><div class="kpi__label">Devengados registrados</div><div class="kpi__value kpi__value--sm">${money(sum(data.filter((i) => i.tipo === "devengado")))}</div></div>
        <div class="card kpi"><div class="kpi__label">Cobrados</div><div class="kpi__value kpi__value--sm">${money(sum(data.filter((i) => i.tipo === "cobrado")))}</div></div>
        <div class="card kpi"><div class="kpi__label">Devengamiento</div><div class="kpi__foot" style="font-size:12.5px">Registra el devengado de todas las operaciones vigentes hasta una fecha.</div>
          ${tiene("contabilidad.editar") ? html`<form class="row" id="f-dev"><input class="input" type="date" name="hasta" value="${hoyISO()}" max="${hoyISO()}" style="flex:1" aria-label="Devengar hasta"><button class="btn btn--sm">Devengar</button></form>` : ""}</div>
      </div>
      <div class="card"><div class="card__head"><h3>Por mes</h3><span class="legend"><span><i></i>Devengados</span><span><i class="l3"></i>Cobrados</span></span></div>
        <div class="card__body">${meses.length ? html`<div id="ch"></div>` : html`<p class="muted">Sin registros en el período.</p>`}</div></div>
      <div class="card">${tablaSimple([{ label: "Mes", render: (m) => mesCorto(m) }, { label: "Devengados", align: "right", render: (m) => money(porMes("devengado")[meses.indexOf(m)]) }, { label: "Cobrados", align: "right", render: (m) => money(porMes("cobrado")[meses.indexOf(m)]) }], meses)}</div>
    </div>`;
    if (meses.length) barChart($("#ch", panel), { etiquetas: meses.map(mesCorto), series: [{ nombre: "Devengados", valores: porMes("devengado") }, { nombre: "Cobrados", valores: porMes("cobrado"), clase: "bar--2" }], formato: (v) => money(v) });
    $("#f-dev", panel)?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector("button");
      conCarga(btn, async () => {
        const { data: n, error } = await sb.rpc("devengar_intereses", { p_hasta: e.target.hasta.value });
        if (error) return toastError(error);
        toast(n ? `Se registraron ${n} devengamiento(s)` : "No había intereses pendientes de devengar", n ? "ok" : "info");
        recargar();
      });
    });
  },

  async cobranzas(panel, { sb, per }) {
    const { data, error } = await sb.from("pagos").select("*, clientes(empresas(razon_social)), operaciones(numero)").gte("fecha", per.desde).lte("fecha", per.hasta).order("fecha", { ascending: false });
    if (error) throw error;
    listado(panel, {
      rows: data, buscar: [(p) => p.clientes?.empresas?.razon_social, (p) => p.operaciones?.numero, "referencia"], exportar: "cobranzas",
      filtros: [{ key: "medio", label: "Medio", options: Object.entries(MEDIOS).map(([value, label]) => ({ value, label })) }],
      onRow: (p) => p.operacion_id && (location.hash = "#/operaciones/" + p.operacion_id + "?tab=cobranzas"),
      vacio: "Sin cobranzas en el período",
      pie: (rows) => html`<tr><td colspan="3">Total</td><td class="right num">${money(sum(rows.filter((p) => !p.anulado), "imputado_capital"))}</td><td class="right num">${money(sum(rows.filter((p) => !p.anulado), "imputado_intereses"))}</td><td class="right num">${money(sum(rows.filter((p) => !p.anulado)))}</td></tr>`,
      columns: [
        { key: "fecha", label: "Fecha", render: (p) => fecha(p.fecha), csv: (p) => p.fecha },
        { key: "cliente", label: "Cliente", render: (p) => html`<b>${p.clientes?.empresas?.razon_social}</b><small>${p.operaciones?.numero ?? ""}</small>`, csv: (p) => p.clientes?.empresas?.razon_social },
        { key: "medio", label: "Medio", render: (p) => html`${MEDIOS[p.medio]}${p.anulado ? html` <span class="badge badge--danger">Anulada</span>` : ""}`, csv: (p) => MEDIOS[p.medio] },
        { key: "imputado_capital", label: "Capital", align: "right", render: (p) => money(p.imputado_capital), csv: (p) => p.imputado_capital },
        { key: "imputado_intereses", label: "Intereses", align: "right", render: (p) => money(p.imputado_intereses), csv: (p) => p.imputado_intereses },
        { key: "importe", label: "Total", align: "right", render: (p) => html`<b>${money(p.importe)}</b>`, csv: (p) => p.importe },
      ],
    });
  },
};

async function registrarMovimiento(sb, alTerminar) {
  const { data: clientes } = await sb.from("v_clientes").select("id, razon_social").order("razon_social");
  const catIng = ["otros_ingresos", "comisiones", "gastos_recuperados", "intereses_cobrados"];
  const catEgr = ["gasto_operativo", "honorarios", "impuestos", "servicios", "sueldos", "otros_egresos"];
  const m = modal({
    title: "Registrar ingreso o gasto", size: "lg",
    body: html`<form class="form" id="f-mc" novalidate>
      <div class="callout" style="grid-column:span 12">${ic("info")}<div>Las cobranzas de operaciones y los desembolsos se registran solos. Usá esta opción para gastos operativos u otros ingresos. Para intereses de una operación, registrá la cobranza desde la operación.</div></div>
      ${campo({ name: "tipo", label: "Tipo", type: "select", col: "f-4", options: [{ value: "egreso", label: "Egreso / gasto" }, { value: "ingreso", label: "Ingreso" }] })}
      ${campo({ name: "categoria", label: "Categoría", type: "select", col: "f-4", options: catEgr.map((c) => ({ value: c, label: CATEGORIAS[c] })) })}
      ${campo({ name: "fecha", label: "Fecha", type: "date", value: hoyISO(), required: true, col: "f-4" })}
      ${campo({ name: "concepto", label: "Concepto", required: true, col: "f-8", attrs: ' maxlength="200"' })}
      ${campo({ name: "importe", label: "Importe", type: "money", required: true, min: "0.01", col: "f-4" })}
      ${campo({ name: "medio", label: "Medio", type: "select", col: "f-4", options: [{ value: "transferencia", label: "Transferencia" }, { value: "efectivo", label: "Efectivo" }, { value: "tarjeta", label: "Tarjeta" }, { value: "debito", label: "Débito automático" }] })}
      ${campo({ name: "cliente_id", label: "Cliente (opcional)", type: "select", col: "f-8", options: [{ value: "", label: "Sin cliente" }, ...(clientes ?? []).map((c) => ({ value: c.id, label: c.razon_social }))] })}
      <label class="field"><span>Comprobante (opcional)</span><input class="input" type="file" name="archivo" accept=".pdf,.jpg,.jpeg,.png" style="padding-top:8px"></label>
      <p class="form-error" data-error hidden></p></form>`,
    foot: html`<button class="btn btn--ghost" data-close>Cancelar</button><button class="btn" form="f-mc">Registrar</button>`,
  });
  const form = m.el.querySelector("form");
  form.tipo.addEventListener("change", () => {
    const cats = form.tipo.value === "ingreso" ? catIng : catEgr;
    form.categoria.innerHTML = cats.map((c) => `<option value="${c}">${CATEGORIAS[c]}</option>`).join("");
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const err = form.querySelector("[data-error]"); err.hidden = true;
    if (!validarForm(form)) return;
    const d = leerForm(form); const file = form.archivo.files[0];
    if (file) { const p = validarArchivo(file); if (p) { err.textContent = p; err.hidden = false; return; } }
    conCarga(m.el.querySelector(".modal__foot .btn:not(.btn--ghost)"), async () => {
      try {
        const comprobante_path = file ? await subirArchivo("comprobantes", d.cliente_id ?? "bbx", file) : null;
        const { error } = await sb.from("movimientos_contables").insert({ ...d, comprobante_path, registrado_por: estado.user.id, automatico: false });
        if (error) throw error;
        toast("Movimiento registrado"); m.close(); alTerminar();
      } catch (ex) { err.textContent = errMsg(ex); err.hidden = false; }
    });
  });
}
