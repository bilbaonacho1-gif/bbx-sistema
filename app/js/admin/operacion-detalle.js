// Detalle de la operación: condiciones, cheques, cobranzas, intereses, movimientos, historial y documentos.
import { html, ic, money, fecha, fechaHora, pct, cuitFmt, badge, tabs, tablaSimple, modal, campo, leerForm, conCarga, toast, toastError, errMsg, confirmar, pedirTexto, MEDIOS, hoyISO, demoTag, ESTADOS, $, reemplazarHash, panelNuevo } from "../ui.js";
import { tiene, estado } from "../core.js";
import { pdfLiquidacion } from "../pdf.js";
import { subirDocumento, pedirDocumento, tablaDocumentos, accionesDocumentos, mapaTipos } from "../documentos.js";

// Acciones disponibles según el estado (validadas también en la base)
const TRANSICIONES = {
  borrador: [["pendiente", "Enviar a pendiente", ""]],
  pendiente: [["en_analisis", "Pasar a análisis", "btn--ghost"], ["aprobada", "Aprobar", "btn--ok"], ["rechazada", "Rechazar", "btn--danger"]],
  en_analisis: [["aprobada", "Aprobar", "btn--ok"], ["rechazada", "Rechazar", "btn--danger"]],
  aprobada: [["activa", "Liquidar", ""]],
  activa: [["en_mora", "Marcar en mora", "btn--danger"]],
  en_mora: [["activa", "Regularizar", "btn--ghost"]],
  rechazada: [["pendiente", "Reabrir", "btn--ghost"]],
};

export default async function (el, { sb, params, query, titulo, acciones, refrescar }) {
  const { data: o, error } = await sb.from("v_operaciones").select("*").eq("id", params.id).maybeSingle();
  if (error) return toastError(error);
  if (!o) { el.innerHTML = html`<div class="empty">${ic("transfer")}<b>Operación inexistente</b></div>`; return; }
  const { data: cheques } = await sb.from("cheques").select("*").eq("operacion_id", o.id).order("fecha_pago");
  const { data: acuerdo } = await sb.from("acuerdos").select("*").eq("operacion_id", o.id).maybeSingle();
  titulo(`Operación ${o.numero}`, o.cliente_razon_social);

  const editable = ["borrador", "pendiente", "en_analisis", "aprobada"].includes(o.estado);
  const btns = [html`<button class="btn btn--ghost" id="pdf">${ic("download", "ico-sm")} Liquidación</button>`];
  if (editable && tiene("operaciones.editar")) btns.push(html`<a class="btn btn--ghost" href="#/operaciones/${o.id}/editar">${ic("edit", "ico-sm")} Editar</a>`);
  acciones(html`${btns}`);
  $("#pdf").onclick = () => pdfLiquidacion(o, cheques ?? []).catch(toastError);

  const trans = (TRANSICIONES[o.estado] ?? []).filter(([e]) => tiene("operaciones.editar") && (e !== "aprobada" || tiene("operaciones.aprobar")));
  el.innerHTML = html`
    <a class="back" href="#/operaciones">${ic("arrowLeft", "ico-sm")} Operaciones</a>
    <div class="detail-head">
      <div class="grow"><h2><span class="mono">${o.numero}</span> ${badge("operacion", o.estado)}${demoTag(o)}</h2>
        <p><a href="#/clientes/${o.cliente_id}">${o.cliente_razon_social}</a> · ${o.tipo_nombre} · ${o.modalidad === "descuento" ? "intereses descontados al liquidar" : "intereses al vencimiento"}</p></div>
      <div class="row">
        ${trans.map(([e, l, cls]) => html`<button class="btn ${cls}" data-estado="${e}">${l}</button>`)}
        ${["activa", "en_mora"].includes(o.estado) && tiene("cobranzas.registrar") ? html`<button class="btn" id="cobrar">${ic("coins", "ico-sm")} Registrar cobranza</button>` : ""}
        ${!["finalizada", "cancelada"].includes(o.estado) && tiene("operaciones.editar") ? html`<button class="btn btn--ghost" data-estado="cancelada">Cancelar</button>` : ""}
        ${o.estado === "borrador" && tiene("operaciones.editar") ? html`<button class="btn-icon" id="borrar" title="Eliminar borrador" aria-label="Eliminar borrador">${ic("trash")}</button>` : ""}
      </div>
    </div>
    <dl class="sum-strip" style="margin-bottom:18px">
      <div><dt>Capital</dt><dd>${money(o.capital, o.moneda)}</dd></div>
      <div><dt>Intereses pactados</dt><dd>${money(o.intereses_pactados, o.moneda)}</dd></div>
      <div><dt>Intereses devengados (hoy)</dt><dd>${money(o.intereses_devengados_hoy, o.moneda)}</dd></div>
      <div><dt>Intereses cobrados</dt><dd>${money(o.intereses_cobrados, o.moneda)}</dd></div>
      <div><dt>${o.modalidad === "descuento" ? "Neto liquidado" : "Importe entregado"}</dt><dd>${money(o.importe_liquidado, o.moneda)}</dd></div>
      <div><dt>Importe total</dt><dd>${money(o.importe_total, o.moneda)}</dd></div>
      <div><dt>Saldo pendiente</dt><dd class="${o.saldo_pendiente > 0 && o.dias_para_vencer < 0 ? "danger-text" : ""}">${money(o.saldo_pendiente, o.moneda)}</dd></div>
    </dl>
    <div class="tabs" id="tabs"></div><div id="panel"></div>`;

  // Cambios de estado
  el.querySelectorAll("[data-estado]").forEach((b) => b.addEventListener("click", async () => {
    const nuevo = b.dataset.estado;
    let comentario = null, fechaLiq = null;
    if (nuevo === "activa" && o.estado === "aprobada") {
      const r = await liquidarModal(o);
      if (!r) return; ({ comentario, fecha: fechaLiq } = r);
    } else if (["rechazada", "cancelada", "en_mora"].includes(nuevo)) {
      comentario = await pedirTexto({ titulo: `${ESTADOS.operacion[nuevo][0]}`, etiqueta: "Motivo / comentario", ok: "Confirmar" });
      if (comentario === null) return;
    } else {
      if (!(await confirmar(`¿Pasar la operación a "${ESTADOS.operacion[nuevo][0]}"?`))) return;
    }
    const { error } = await sb.rpc("cambiar_estado_operacion", { p_id: o.id, p_estado: nuevo, p_comentario: comentario, p_fecha: fechaLiq });
    if (error) return toastError(error);
    toast("Estado actualizado"); refrescar();
  }));
  $("#cobrar")?.addEventListener("click", () => cobranzaModal(sb, o, refrescar));
  $("#borrar")?.addEventListener("click", async () => {
    if (!(await confirmar("Se eliminará el borrador y sus cheques.", { titulo: "Eliminar borrador", ok: "Eliminar", peligro: true }))) return;
    const { error } = await sb.from("operaciones").delete().eq("id", o.id);
    if (error) return toastError(error);
    toast("Borrador eliminado"); location.hash = "#/operaciones";
  });

  const items = [
    { id: "detalle", label: "Condiciones" },
    { id: "cobranzas", label: "Cobranzas" },
    { id: "intereses", label: "Intereses" },
    { id: "movimientos", label: "Movimientos" },
    { id: "historial", label: "Historial" },
    { id: "documentos", label: "Documentación" },
    { id: "notas", label: "Notas internas" },
  ];
  const mostrar = (t) => {
    reemplazarHash(`#/operaciones/${o.id}`, `#/operaciones/${o.id}?tab=${t}`);
    const panel = panelNuevo("#panel");
    panel.innerHTML = html`<div class="skeleton" style="height:200px"></div>`;
    VISTAS[t](panel, { sb, o, cheques, acuerdo, recargar: () => mostrar(t), refrescar }).catch(toastError);
  };
  const ini = items.some((i) => i.id === query.tab) ? query.tab : "detalle";
  tabs($("#tabs"), items, ini, mostrar);
  mostrar(ini);
}

function liquidarModal(o) {
  return new Promise((resolve) => {
    let r = null;
    const m = modal({
      title: "Liquidar operación",
      body: html`<div class="stack"><div class="callout">${ic("info")}<div>Al liquidar se registra el desembolso de <b>${money(o.importe_liquidado, o.moneda)}</b>, la operación pasa a <b>activa</b> y sus condiciones quedan bloqueadas.
        ${o.modalidad === "descuento" ? html` Los intereses retenidos (${money(o.intereses_pactados)}) quedan como <b>cobrados por adelantado</b> y se devengan a lo largo del plazo.` : ""}</div></div>
        <form class="form" id="f-liq">${campo({ name: "fecha", label: "Fecha de liquidación", type: "date", value: hoyISO(), required: true, max: hoyISO() })}
        ${campo({ name: "comentario", label: "Comentario (opcional)", attrs: ' maxlength="300"' })}</form></div>`,
      foot: html`<button class="btn btn--ghost" data-close>Cancelar</button><button class="btn" form="f-liq">Liquidar</button>`,
      onClose: () => resolve(r),
    });
    m.el.querySelector("form").addEventListener("submit", (e) => { e.preventDefault(); r = leerForm(e.target); m.close(); });
  });
}

function cobranzaModal(sb, o, alTerminar) {
  const desc = o.modalidad === "descuento";
  const m = modal({
    title: "Registrar cobranza", size: "lg",
    body: html`<form class="form" id="f-cob" novalidate>
      <div class="callout" style="grid-column:span 12">${ic("info")}<div>Saldo pendiente: <b>${money(o.saldo_pendiente, o.moneda)}</b>. Imputá el pago a cada concepto: los <b>intereses cobrados</b> se registran por separado de los devengados.</div></div>
      ${campo({ name: "fecha", label: "Fecha", type: "date", value: hoyISO(), required: true, max: hoyISO(), col: "f-4" })}
      ${campo({ name: "medio", label: "Medio de pago", type: "select", col: "f-4", options: Object.entries(MEDIOS).filter(([k]) => k !== "acreditacion_cheque").map(([value, label]) => ({ value, label })) })}
      ${campo({ name: "referencia", label: "Referencia / comprobante", col: "f-4", attrs: ' maxlength="120"' })}
      ${campo({ name: "imputado_capital", label: "Capital", type: "money", value: 0, min: "0", col: "f-3" })}
      ${campo({ name: "imputado_intereses", label: desc ? "Intereses (ya cobrados al liquidar)" : "Intereses", type: "money", value: 0, min: "0", col: "f-3", disabled: desc })}
      ${campo({ name: "imputado_gastos", label: "Gastos", type: "money", value: 0, min: "0", col: "f-3" })}
      ${campo({ name: "imputado_comisiones", label: "Comisiones", type: "money", value: 0, min: "0", col: "f-3" })}
      ${campo({ name: "observaciones", label: "Observaciones", type: "textarea", attrs: ' rows="2" maxlength="500"' })}
      <div class="row row--between" style="grid-column:span 12"><button type="button" class="link-btn" id="todo">Imputar el saldo completo</button><b>Total: <span id="total" class="num">${money(0)}</span></b></div>
      <p class="form-error" data-error hidden></p>
    </form>`,
    foot: html`<button class="btn btn--ghost" data-close>Cancelar</button><button class="btn" form="f-cob">Registrar</button>`,
  });
  const form = m.el.querySelector("form");
  const total = () => ["imputado_capital", "imputado_intereses", "imputado_gastos", "imputado_comisiones"].reduce((a, k) => a + Number(form[k].value || 0), 0);
  form.addEventListener("input", () => { m.el.querySelector("#total").textContent = money(total()); });
  m.el.querySelector("#todo").onclick = () => {
    if (desc) { form.imputado_capital.value = o.saldo_pendiente; }
    else {
      const resto = Number(o.saldo_pendiente);
      const capPend = Math.max(0, Math.min(Number(o.capital), resto));
      form.imputado_capital.value = capPend.toFixed(2);
      form.imputado_intereses.value = Math.max(0, resto - capPend).toFixed(2);
    }
    form.dispatchEvent(new Event("input"));
  };
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const err = form.querySelector("[data-error]"); err.hidden = true;
    const d = leerForm(form);
    const t = Math.round(total() * 100) / 100;
    if (t <= 0) { err.textContent = "El total debe ser mayor a cero."; err.hidden = false; return; }
    if (t > Number(o.saldo_pendiente) + 0.009) { err.textContent = "El total supera el saldo pendiente."; err.hidden = false; return; }
    conCarga(m.el.querySelector(".modal__foot .btn:not(.btn--ghost)"), async () => {
      const { error } = await sb.from("pagos").insert({
        cliente_id: o.cliente_id, operacion_id: o.id, fecha: d.fecha, medio: d.medio, referencia: d.referencia, importe: t,
        imputado_capital: d.imputado_capital || 0, imputado_intereses: d.imputado_intereses || 0,
        imputado_gastos: d.imputado_gastos || 0, imputado_comisiones: d.imputado_comisiones || 0,
        observaciones: d.observaciones, registrado_por: estado.user.id,
      });
      if (error) { err.textContent = errMsg(error); err.hidden = false; return; }
      toast("Cobranza registrada"); m.close(); alTerminar();
    });
  });
}

const dd = (l, v) => html`<div><dt>${l}</dt><dd>${v ?? "—"}</dd></div>`;

const VISTAS = {
  async detalle(panel, { sb, o, cheques, acuerdo, recargar }) {
    const puedeCheque = tiene("operaciones.editar") && ["activa", "en_mora"].includes(o.estado);
    panel.innerHTML = html`<div class="stack">
      <div class="card"><div class="card__body"><dl class="dl dl--3">
        ${dd("Fecha de inicio", fecha(o.fecha_inicio))}${dd("Vencimiento", fecha(o.fecha_vencimiento))}${dd("Plazo", `${o.dias} días`)}
        ${dd("Tasa", `${pct(o.tasa_interes)} ${o.tasa_periodo}`)}${dd("Base de cálculo", `${o.base_dias} días`)}${dd("Moneda", o.moneda)}
        ${dd("Gastos", money(o.gastos))}${dd("Comisiones", money(o.comisiones))}${dd("IVA comisiones", money(o.iva_comisiones))}
        ${dd("Liquidada el", fecha(o.fecha_liquidacion))}${dd("Finalizada el", fecha(o.fecha_finalizacion))}${dd("Total cobrado", money(o.total_cobrado))}
      </dl>${o.observaciones ? html`<p style="margin-top:16px;white-space:pre-wrap"><span class="muted">Observaciones:</span> ${o.observaciones}</p>` : ""}</div></div>
      ${acuerdo ? html`<div class="card"><div class="card__head"><h3>Acuerdo en cuenta corriente</h3></div><div class="card__body"><dl class="dl dl--3">
        ${dd("Límite", money(acuerdo.limite))}${dd("Utilizado (capital)", money(o.capital))}${dd("Disponible", money(acuerdo.limite - o.capital))}
        ${dd("Tasa por excedido", acuerdo.tasa_excedido ? pct(acuerdo.tasa_excedido) : "—")}${dd("Garantía", acuerdo.garantia)}${dd("Renovación automática", acuerdo.renovacion_automatica ? "Sí" : "No")}
      </dl></div></div>` : ""}
      ${cheques?.length ? html`<div class="card"><div class="card__head"><h3>Cheques (${cheques.length})</h3>${puedeCheque ? html`<span class="muted">Al marcar "acreditado" se registra la cobranza automáticamente</span>` : ""}</div>
        <div class="card__body--flush">${tablaSimple([
          { label: "Cheque", render: (c) => html`<b>${c.tipo === "echeq" ? "ECHEQ" : "Físico"} ${c.numero}</b><small>${c.banco}</small>` },
          { label: "Librador", render: (c) => html`${c.librador_nombre ?? "—"}<small>${c.librador_cuit ? cuitFmt(c.librador_cuit) : ""}</small>` },
          { label: "Fecha de pago", render: (c) => fecha(c.fecha_pago) },
          { label: "Importe", align: "right", render: (c) => money(c.monto) },
          { label: "Estado", render: (c) => puedeCheque && ["en_cartera", "depositado"].includes(c.estado)
              ? html`<select class="select" data-cheque="${c.id}" style="height:32px;min-width:140px">${["en_cartera", "depositado", "acreditado", "rechazado", "endosado"].map((e) => html`<option value="${e}" ${e === c.estado ? "selected" : ""}>${ESTADOS.cheque[e][0]}</option>`)}</select>`
              : html`${badge("cheque", c.estado)}${c.motivo_rechazo ? html`<small>${c.motivo_rechazo}</small>` : ""}` },
        ], cheques)}</div></div>` : ""}
    </div>`;
    panel.addEventListener("change", async (e) => {
      const s = e.target.closest("[data-cheque]"); if (!s) return;
      const c = cheques.find((x) => x.id === s.dataset.cheque);
      const nuevo = s.value;
      let motivo = null;
      if (nuevo === "rechazado") {
        motivo = await pedirTexto({ titulo: "Cheque rechazado", etiqueta: "Motivo del rechazo", ok: "Registrar rechazo", multilinea: false });
        if (!motivo) { s.value = c.estado; return; }
      } else if (nuevo === "acreditado" && !(await confirmar(`Se registrará una cobranza de ${money(c.monto)} por la acreditación del cheque ${c.numero}.`, { titulo: "Acreditar cheque", ok: "Acreditar" }))) {
        s.value = c.estado; return;
      }
      const { error } = await sb.from("cheques").update({ estado: nuevo, motivo_rechazo: motivo }).eq("id", c.id);
      if (error) { s.value = c.estado; return toastError(error); }
      toast("Cheque actualizado"); recargar();
    });
  },

  async cobranzas(panel, { sb, o, refrescar }) {
    const { data } = await sb.from("pagos").select("*").eq("operacion_id", o.id).order("fecha", { ascending: false });
    panel.innerHTML = html`<div class="card">${tablaSimple([
      { label: "Fecha", render: (p) => fecha(p.fecha) },
      { label: "Medio", render: (p) => html`${MEDIOS[p.medio]}<small>${p.referencia ?? ""}</small>` },
      { label: "Capital", align: "right", render: (p) => money(p.imputado_capital) },
      { label: "Intereses", align: "right", render: (p) => money(p.imputado_intereses) },
      { label: "Gastos / comis.", align: "right", render: (p) => money(Number(p.imputado_gastos) + Number(p.imputado_comisiones)) },
      { label: "Total", align: "right", render: (p) => html`<b class="${p.anulado ? "muted" : ""}" style="${p.anulado ? "text-decoration:line-through" : ""}">${money(p.importe)}</b>` },
      { label: "", align: "right", render: (p) => p.anulado ? html`<span class="badge badge--danger">Anulada</span><small>${p.anulado_motivo}</small>` : tiene("cobranzas.anular") ? html`<button class="btn btn--sm btn--danger" data-anular="${p.id}">Anular</button>` : "" },
    ], data, { vacio: "Sin cobranzas registradas" })}</div>`;
    panel.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-anular]"); if (!b) return;
      const motivo = await pedirTexto({ titulo: "Anular cobranza", etiqueta: "Motivo de la anulación", ok: "Anular" });
      if (!motivo) return;
      const { error } = await sb.from("pagos").update({ anulado: true, anulado_motivo: motivo }).eq("id", b.dataset.anular);
      if (error) return toastError(error);
      toast("Cobranza anulada: se revirtieron los movimientos", "info"); refrescar();
    });
  },

  async intereses(panel, { sb, o }) {
    const { data } = await sb.from("intereses").select("*").eq("operacion_id", o.id).order("fecha");
    const dev = (data ?? []).filter((i) => i.tipo === "devengado"), cob = (data ?? []).filter((i) => i.tipo === "cobrado");
    const suma = (r) => r.reduce((a, x) => a + Number(x.importe), 0);
    panel.innerHTML = html`<div class="stack">
      <div class="callout">${ic("info")}<div><b>Devengado</b>: interés ganado por el paso del tiempo (lineal). <b>Cobrado</b>: interés efectivamente percibido. Se registran por separado.
        Devengado en tiempo real a hoy: <b>${money(o.intereses_devengados_hoy)}</b> de ${money(o.intereses_pactados)} pactados.</div></div>
      <div class="grid grid-2">
        <div class="card"><div class="card__head"><h3>Intereses devengados registrados</h3><b class="num">${money(suma(dev))}</b></div><div class="card__body--flush">${tablaSimple([
          { label: "Período", render: (i) => `${fecha(i.periodo_desde)} → ${fecha(i.periodo_hasta)}` },
          { label: "Importe", align: "right", render: (i) => money(i.importe) },
        ], dev, { vacio: "Sin devengamientos. Se generan desde Contabilidad → Devengar intereses." })}</div></div>
        <div class="card"><div class="card__head"><h3>Intereses cobrados</h3><b class="num">${money(suma(cob))}</b></div><div class="card__body--flush">${tablaSimple([
          { label: "Fecha", render: (i) => fecha(i.fecha) },
          { label: "Detalle", render: (i) => i.observaciones ?? "" },
          { label: "Importe", align: "right", render: (i) => html`<span class="${i.importe < 0 ? "danger-text" : ""}">${money(i.importe)}</span>` },
        ], cob, { vacio: "Sin intereses cobrados" })}</div></div>
      </div></div>`;
  },

  async movimientos(panel, { sb, o }) {
    const { data } = await sb.from("movimientos").select("*").eq("operacion_id", o.id).order("fecha").order("created_at");
    panel.innerHTML = html`<div class="card">${tablaSimple([
      { label: "Fecha", render: (m) => fecha(m.fecha) },
      { label: "Concepto", key: "concepto" },
      { label: "Tipo", render: (m) => html`<span class="tag">${m.sentido}</span>` },
      { label: "Importe", align: "right", render: (m) => html`<span class="${m.sentido === "abono" ? "ok-text" : m.sentido === "informativo" ? "muted" : ""}">${m.sentido === "abono" ? "−" : ""}${money(m.importe)}</span>` },
    ], data, { vacio: "Sin movimientos (se generan al liquidar)" })}</div>`;
  },

  async historial(panel, { sb, o }) {
    const { data } = await sb.from("operacion_estados").select("*, perfiles:usuario_id(nombre, apellido, email)").eq("operacion_id", o.id).order("created_at", { ascending: false });
    panel.innerHTML = html`<div class="card"><div class="card__body">${data?.length ? html`<ul class="timeline">${data.map((h) => html`<li>
      <b>${h.estado_anterior ? html`${badge("operacion", h.estado_anterior)} → ` : ""}${badge("operacion", h.estado_nuevo)}</b>
      <span>${fechaHora(h.created_at)} · ${[h.perfiles?.nombre, h.perfiles?.apellido].filter(Boolean).join(" ") || h.perfiles?.email || "Sistema"}</span>
      ${h.comentario ? html`<p style="margin-top:4px">${h.comentario}</p>` : ""}</li>`)}</ul>` : html`<p class="muted">Sin historial.</p>`}</div></div>`;
  },

  async documentos(panel, { sb, o, recargar }) {
    const [tipos, { data: docs }] = await Promise.all([mapaTipos(sb), sb.from("documentos").select("*").eq("operacion_id", o.id).order("created_at", { ascending: false })]);
    panel.innerHTML = html`<div class="card"><div class="card__head"><h3>Documentación de la operación</h3><span class="row">
      ${tiene("documentos.editar") ? html`<button class="btn btn--sm btn--ghost" id="pedir">${ic("send", "ico-sm")} Pedir</button><button class="btn btn--sm" id="subir">${ic("upload", "ico-sm")} Subir</button>` : ""}</span></div>
      <div class="card__body--flush" id="docs">${tablaDocumentos(docs, { tipos, staff: true })}</div></div>`;
    $("#subir", panel)?.addEventListener("click", () => subirDocumento(sb, { cliente_id: o.cliente_id, operacion_id: o.id, alTerminar: recargar }));
    $("#pedir", panel)?.addEventListener("click", () => pedirDocumento(sb, { cliente_id: o.cliente_id, operacion_id: o.id, alTerminar: recargar }));
    accionesDocumentos($("#docs", panel), sb, () => docs, recargar);
  },

  async notas(panel, { sb, o, recargar }) {
    const { data } = await sb.from("notas_internas").select("*, perfiles:autor_id(nombre, apellido, email)").eq("operacion_id", o.id).order("created_at", { ascending: false });
    panel.innerHTML = html`<div class="grid grid-3">
      <div class="card span-2"><div class="card__head"><h3>Notas internas</h3><span class="muted">No visibles para el cliente</span></div><div class="card__body">
        ${data?.length ? html`<ul class="timeline">${data.map((n) => html`<li><b>${[n.perfiles?.nombre, n.perfiles?.apellido].filter(Boolean).join(" ") || n.perfiles?.email}</b><span>${fechaHora(n.created_at)}</span><p style="margin-top:6px;white-space:pre-wrap">${n.texto}</p></li>`)}</ul>` : html`<p class="muted">Sin notas.</p>`}</div></div>
      ${tiene("clientes.editar") ? html`<div class="card"><div class="card__body"><form class="form" id="f-nota">${campo({ name: "texto", label: "Nueva nota", type: "textarea", required: true, attrs: ' rows="5" maxlength="5000"' })}<div class="form-actions"><button class="btn">Guardar</button></div></form></div></div>` : ""}
    </div>`;
    $("#f-nota", panel)?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const texto = e.target.texto.value.trim(); if (!texto) return;
      const { error } = await sb.from("notas_internas").insert({ cliente_id: o.cliente_id, operacion_id: o.id, texto, autor_id: estado.user.id });
      if (error) return toastError(error);
      toast("Nota guardada"); recargar();
    });
  },
};
