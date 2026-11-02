// Alta y edición de operaciones (con cheques o acuerdo según el tipo) y simulación en vivo.
import { html, ic, money, campo, leerForm, validarForm, bindCuit, conCarga, toast, errMsg, hoyISO, sumarDias, diasEntre, cuitFmt, cuitValido, raw, $, $$ } from "../ui.js";

export default async function (el, { sb, params, query, titulo }) {
  const editando = !!params.id;
  const [{ data: clientes }, { data: tipos }, { data: cfg }, opRes] = await Promise.all([
    sb.from("v_clientes").select("id, razon_social, cuit, estado").in("estado", ["activo", "en_evaluacion"]).order("razon_social"),
    sb.from("tipos_operacion").select("*").eq("activo", true).order("orden"),
    sb.from("configuracion").select("valor").eq("clave", "operaciones").maybeSingle(),
    editando ? sb.from("operaciones").select("*, cheques(*), acuerdos(*)").eq("id", params.id).single() : Promise.resolve({ data: null }),
  ]);
  const def = cfg?.valor ?? {};
  const op = opRes.data;
  if (editando && !["borrador", "pendiente", "en_analisis", "aprobada"].includes(op?.estado)) {
    el.innerHTML = html`<div class="callout callout--warn">${ic("lock")}<div><b>Esta operación ya fue liquidada o cerrada.</b> Sus condiciones financieras no se pueden modificar. <a href="#/operaciones/${params.id}">Volver</a></div></div>`;
    return;
  }
  titulo(editando ? `Editar ${op.numero}` : "Nueva operación", "Las condiciones se pueden modificar hasta la liquidación");
  const v = op ?? {
    cliente_id: query.cliente ?? "", tipo_codigo: tipos?.[0]?.codigo, modalidad: tipos?.[0]?.modalidad_default, moneda: "ARS",
    fecha_inicio: hoyISO(), fecha_vencimiento: sumarDias(hoyISO(), 30), tasa_interes: def.tasa_mensual_default ?? 3.5,
    tasa_periodo: "mensual", base_dias: def.base_dias ?? 365, gastos: def.gastos_default ?? 0, comisiones: 0, iva_comisiones: 0, estado: "pendiente",
  };
  const acuerdo = op?.acuerdos?.[0] ?? op?.acuerdos ?? {};
  const tipoDe = (c) => tipos.find((t) => t.codigo === c) ?? {};

  el.innerHTML = html`
    <a class="back" href="${editando ? "#/operaciones/" + op.id : "#/operaciones"}">${ic("arrowLeft", "ico-sm")} Volver</a>
    <form id="f-op" novalidate class="grid grid-3" style="align-items:start">
      <div class="stack span-2">
        <div class="card"><div class="card__head"><h3>Cliente y tipo</h3></div><div class="card__body"><div class="form">
          ${campo({ name: "cliente_id", label: "Cliente", type: "select", value: v.cliente_id, required: true, col: "f-8",
            options: [{ value: "", label: "Seleccionar cliente…" }, ...(clientes ?? []).map((c) => ({ value: c.id, label: `${c.razon_social} · ${cuitFmt(c.cuit)}${c.estado !== "activo" ? " (en evaluación)" : ""}` }))] })}
          ${campo({ name: "tipo_codigo", label: "Tipo de operación", type: "select", value: v.tipo_codigo, required: true, col: "f-4", options: tipos.map((t) => ({ value: t.codigo, label: t.nombre })) })}
          ${campo({ name: "modalidad", label: "Cobro de intereses", type: "select", value: v.modalidad, col: "f-6",
            options: [{ value: "descuento", label: "Descontados al liquidar (descuento)" }, { value: "vencido", label: "Al vencimiento, junto con el capital" }] })}
          ${campo({ name: "moneda", label: "Moneda", type: "select", value: v.moneda, col: "f-3", options: [{ value: "ARS", label: "Pesos (ARS)" }, { value: "USD", label: "Dólares (USD)" }] })}
          ${!editando ? campo({ name: "estado", label: "Guardar como", type: "select", value: v.estado, col: "f-3", options: [{ value: "pendiente", label: "Pendiente" }, { value: "borrador", label: "Borrador" }] }) : ""}
        </div></div></div>

        <div class="card"><div class="card__head"><h3>Condiciones</h3></div><div class="card__body"><div class="form">
          ${campo({ name: "fecha_inicio", label: "Fecha de inicio", type: "date", value: v.fecha_inicio, required: true, col: "f-4" })}
          <div class="field f-4" data-sin-cheques>${campo({ name: "fecha_vencimiento", label: "Vencimiento", type: "date", value: v.fecha_vencimiento, required: true })}</div>
          <div class="field f-4" data-sin-cheques>${campo({ name: "capital", label: "Capital", type: "money", value: v.capital, required: true, min: "0.01" })}</div>
          ${campo({ name: "tasa_interes", label: "Tasa de interés (%)", type: "number", value: v.tasa_interes, required: true, min: "0", step: "0.0001", col: "f-4" })}
          ${campo({ name: "tasa_periodo", label: "Período de la tasa", type: "select", value: v.tasa_periodo, col: "f-4", options: [{ value: "mensual", label: "Mensual" }, { value: "anual", label: "Nominal anual" }] })}
          ${campo({ name: "base_dias", label: "Base de cálculo", type: "select", value: v.base_dias, col: "f-4", options: [{ value: 365, label: "365 días" }, { value: 360, label: "360 días" }] })}
          ${campo({ name: "gastos", label: "Gastos", type: "money", value: v.gastos, min: "0", col: "f-4" })}
          ${campo({ name: "comisiones", label: "Comisiones", type: "money", value: v.comisiones, min: "0", col: "f-4" })}
          <label class="field f-4"><span>IVA sobre comisiones</span><div class="input-wrap">
            <input class="input" name="iva_comisiones" type="number" step="0.01" min="0" value="${v.iva_comisiones}" inputmode="decimal">
            <button type="button" class="btn-icon" id="iva21" title="Calcular 21 %" aria-label="Calcular IVA 21 %">${ic("percent", "ico-sm")}</button></div></label>
          ${campo({ name: "observaciones", label: "Observaciones (visibles para el cliente)", type: "textarea", value: v.observaciones, attrs: ' maxlength="2000" rows="3"' })}
        </div></div></div>

        <div class="card" data-cheques><div class="card__head"><h3>Cheques</h3><button type="button" class="btn btn--sm btn--ghost" id="add-ch">${ic("plus", "ico-sm")} Agregar cheque</button></div>
          <div class="card__body"><div class="table-wrap"><table class="table"><thead><tr><th>Tipo</th><th>Número</th><th>Banco</th><th>CUIT librador</th><th>Librador</th><th>Fecha de pago</th><th class="th-right">Importe</th><th></th></tr></thead>
          <tbody id="cheques"></tbody></table></div>
          <p class="muted" style="margin-top:10px">El capital y el vencimiento salen de los cheques. Los intereses se calculan cheque por cheque según sus días.</p></div></div>

        <div class="card" data-acuerdo><div class="card__head"><h3>Acuerdo en cuenta corriente</h3></div><div class="card__body"><div class="form">
          ${campo({ name: "ac_limite", label: "Límite del acuerdo", type: "money", value: acuerdo.limite, min: "0.01", col: "f-4" })}
          ${campo({ name: "ac_tasa_excedido", label: "Tasa por excedido (%)", type: "number", value: acuerdo.tasa_excedido, step: "0.0001", col: "f-4" })}
          ${campo({ name: "ac_garantia", label: "Garantía", value: acuerdo.garantia, col: "f-4" })}
          ${campo({ name: "ac_renovacion", label: "Renovación automática", type: "checkbox", value: acuerdo.renovacion_automatica })}
        </div><p class="muted" style="margin-top:10px">El capital es el monto utilizado del acuerdo sobre el que se calculan los intereses.</p></div></div>
      </div>

      <div class="card" style="position:sticky;top:96px">
        <div class="card__head"><h3>Simulación</h3><span class="muted">Interés simple</span></div>
        <div class="card__body"><dl class="dl" style="grid-template-columns:1fr" id="sim"></dl>
          <p class="form-error" data-error hidden style="margin-top:14px"></p>
          <div class="form-actions" style="margin-top:14px"><button class="btn btn--block" id="guardar">${editando ? "Guardar cambios" : "Crear operación"}</button></div>
        </div>
      </div>
    </form>`;

  const form = $("#f-op");
  const tbody = $("#cheques");
  bindCuit(form);

  const filaCheque = (c = {}) => {
    const tr = document.createElement("tr");
    tr.innerHTML = html`
      <td><select class="select" data-k="tipo" style="min-width:100px"><option value="echeq" ${c.tipo === "echeq" ? raw("selected") : ""}>ECHEQ</option><option value="fisico" ${c.tipo === "fisico" ? raw("selected") : ""}>Físico</option></select></td>
      <td><input class="input" data-k="numero" value="${c.numero ?? ""}" required style="min-width:100px"></td>
      <td><input class="input" data-k="banco" value="${c.banco ?? ""}" required style="min-width:130px"></td>
      <td><input class="input" data-k="librador_cuit" value="${c.librador_cuit ? cuitFmt(c.librador_cuit) : ""}" data-cuit inputmode="numeric" style="min-width:130px"></td>
      <td><input class="input" data-k="librador_nombre" value="${c.librador_nombre ?? ""}" style="min-width:160px"></td>
      <td><input class="input" type="date" data-k="fecha_pago" value="${c.fecha_pago ?? sumarDias(hoyISO(), 30)}" required></td>
      <td><input class="input right" type="number" step="0.01" min="0.01" data-k="monto" value="${c.monto ?? ""}" required style="min-width:130px"></td>
      <td><button type="button" class="btn-icon btn-icon--plain" data-quitar aria-label="Quitar cheque">${ic("trash")}</button></td>`;
    tbody.append(tr);
    bindCuit(tr);
  };
  (op?.cheques?.length ? op.cheques : [{}]).forEach(filaCheque);
  $("#add-ch").onclick = () => { filaCheque(); simular(); };
  tbody.addEventListener("click", (e) => { if (e.target.closest("[data-quitar]")) { e.target.closest("tr").remove(); simular(); } });

  const leerCheques = () => $$("tr", tbody).map((tr) => Object.fromEntries($$("[data-k]", tr).map((i) => [i.dataset.k, i.dataset.k === "librador_cuit" ? i.value.replace(/\D/g, "") : i.value.trim()])));

  const ajustarTipo = () => {
    const t = tipoDe(form.tipo_codigo.value);
    $("[data-cheques]").hidden = !t.usa_cheques;
    $("[data-acuerdo]").hidden = !t.usa_acuerdo;
    $$("[data-sin-cheques]").forEach((x) => { x.hidden = !!t.usa_cheques; x.querySelectorAll("input").forEach((i) => (i.disabled = !!t.usa_cheques)); });
    $$("input", tbody).forEach((i) => (i.disabled = !t.usa_cheques));
  };
  form.tipo_codigo.addEventListener("change", () => { form.modalidad.value = tipoDe(form.tipo_codigo.value).modalidad_default; ajustarTipo(); simular(); });

  const interes = (cap, tasa, per, base, dias) => Math.round(cap * tasa / 100 * Math.max(dias, 0) / (per === "mensual" ? base / 12 : base) * 100) / 100;
  function simular() {
    const d = leerForm(form), t = tipoDe(d.tipo_codigo);
    const tasa = Number(d.tasa_interes || 0), base = Number(d.base_dias), per = d.tasa_periodo;
    let capital, dias, intereses, venc;
    if (t.usa_cheques) {
      const ch = leerCheques().filter((c) => Number(c.monto) > 0 && c.fecha_pago);
      capital = ch.reduce((a, c) => a + Number(c.monto), 0);
      intereses = ch.reduce((a, c) => a + interes(Number(c.monto), tasa, per, base, diasEntre(d.fecha_inicio, c.fecha_pago)), 0);
      venc = ch.map((c) => c.fecha_pago).sort().pop() ?? d.fecha_inicio;
      dias = diasEntre(d.fecha_inicio, venc);
    } else {
      capital = Number(d.capital || 0); venc = d.fecha_vencimiento; dias = diasEntre(d.fecha_inicio, venc);
      intereses = interes(capital, tasa, per, base, dias);
    }
    const g = Number(d.gastos || 0), co = Number(d.comisiones || 0), iva = Number(d.iva_comisiones || 0);
    const desc = d.modalidad === "descuento";
    const total = desc ? capital : capital + intereses + g + co + iva;
    const liq = desc ? capital - intereses - g - co - iva : capital;
    const mon = d.moneda;
    $("#sim").innerHTML = html`
      <div><dt>${t.usa_cheques ? "Valor nominal de los cheques" : "Capital"}</dt><dd>${money(capital, mon)}</dd></div>
      <div><dt>Plazo</dt><dd>${dias > 0 ? `${dias} días · vence ${venc.split("-").reverse().join("/")}` : "—"}</dd></div>
      <div><dt>Intereses pactados</dt><dd>${money(intereses, mon)}</dd></div>
      <div><dt>Gastos + comisiones + IVA</dt><dd>${money(g + co + iva, mon)}</dd></div>
      <div><dt>${desc ? "Neto a liquidar al cliente" : "Importe a entregar"}</dt><dd style="font-size:20px;color:${liq > 0 ? "var(--text)" : "var(--danger)"}">${money(liq, mon)}</dd></div>
      <div><dt>${desc ? "A cobrar al vencimiento (cheques)" : "Total a devolver"}</dt><dd>${money(total, mon)}</dd></div>`;
  }
  form.addEventListener("input", simular);
  $("#iva21").onclick = () => { form.iva_comisiones.value = (Number(form.comisiones.value || 0) * 0.21).toFixed(2); simular(); };
  ajustarTipo(); simular();

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const err = form.querySelector("[data-error]"); err.hidden = true;
    const t = tipoDe(form.tipo_codigo.value);
    if (!validarForm(form)) { err.textContent = "Revisá los campos marcados."; err.hidden = false; return; }
    const cheques = t.usa_cheques ? leerCheques() : [];
    if (t.usa_cheques) {
      if (!cheques.length) { err.textContent = "Cargá al menos un cheque."; err.hidden = false; return; }
      const malo = cheques.find((c) => !c.numero || !c.banco || !c.fecha_pago || !(Number(c.monto) > 0) || (c.librador_cuit && !cuitValido(c.librador_cuit)) || c.fecha_pago <= form.fecha_inicio.value);
      if (malo) { err.textContent = "Revisá los cheques: número, banco, fecha de pago posterior al inicio, importe y CUIT del librador."; err.hidden = false; return; }
    } else if (form.fecha_vencimiento.value <= form.fecha_inicio.value) {
      err.textContent = "El vencimiento debe ser posterior al inicio."; err.hidden = false; return;
    }
    const d = leerForm(form);
    const acuerdoDatos = t.usa_acuerdo ? { limite: d.ac_limite, tasa_excedido: d.ac_tasa_excedido, garantia: d.ac_garantia, renovacion_automatica: d.ac_renovacion } : null;
    if (t.usa_acuerdo && !(Number(d.ac_limite) > 0)) { err.textContent = "Indicá el límite del acuerdo."; err.hidden = false; return; }
    const opDatos = { cliente_id: d.cliente_id, tipo_codigo: d.tipo_codigo, modalidad: d.modalidad, moneda: d.moneda, fecha_inicio: d.fecha_inicio,
      fecha_vencimiento: t.usa_cheques ? null : d.fecha_vencimiento, capital: t.usa_cheques ? null : d.capital, tasa_interes: d.tasa_interes,
      tasa_periodo: d.tasa_periodo, base_dias: Number(d.base_dias), gastos: d.gastos ?? 0, comisiones: d.comisiones ?? 0, iva_comisiones: d.iva_comisiones ?? 0,
      observaciones: d.observaciones, estado: d.estado };
    conCarga($("#guardar"), async () => {
      const { data: id, error } = await sb.rpc("guardar_operacion", { p_id: op?.id ?? null, p_op: opDatos, p_cheques: cheques, p_acuerdo: acuerdoDatos });
      if (error) { err.textContent = errMsg(error); err.hidden = false; return; }
      toast(editando ? "Operación actualizada" : "Operación creada");
      location.hash = "#/operaciones/" + id;
    });
  });
}
