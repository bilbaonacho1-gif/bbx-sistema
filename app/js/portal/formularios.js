// Portal · Formularios y acuerdos: completar, firmar, iniciar solicitudes y ver el historial.
import { html, ic, fecha, fechaHora, badge, tablaSimple, modal, campo, toast, toastError, errMsg, conCarga, cuitFmt, money, $ } from "../ui.js";
import { estado, abrirArchivo } from "../core.js";

export default async function (el, { sb, titulo, refrescar }) {
  titulo("Formularios y acuerdos", "Solicitudes, documentos para completar y firmas");
  const [{ data: forms, error }, { data: plantillas }] = await Promise.all([
    sb.from("formularios").select("*, plantillas_formulario(*), firmas(*)").order("created_at", { ascending: false }),
    sb.from("plantillas_formulario").select("*").eq("activo", true).order("nombre"),
  ]);
  if (error) return toastError(error);
  const porCompletar = forms.filter((f) => ["pendiente", "rechazado"].includes(f.estado));
  const porFirmar = forms.filter((f) => f.estado === "completado" && f.plantillas_formulario?.requiere_firma);
  const historial = forms.filter((f) => !porCompletar.includes(f) && !porFirmar.includes(f));
  const iniciables = plantillas.filter((p) => p.cliente_puede_iniciar);
  const modelos = plantillas.filter((p) => p.archivo_path);

  el.innerHTML = html`<div class="stack">
    ${iniciables.length ? html`<div class="grid grid-${Math.min(iniciables.length, 3)}">${iniciables.map((p) => html`
      <button class="card tile" data-iniciar="${p.id}" style="text-align:left;cursor:pointer;font:inherit">${ic(p.categoria === "descuento_cheques" ? "cheque" : "briefcase")}<b>${p.nombre}</b><span>${p.descripcion ?? ""}</span></button>`)}</div>` : ""}
    <div class="card"><div class="card__head"><h3>Pendientes de completar</h3></div><div class="card__body--flush">${tablaSimple([
      { label: "Formulario", render: (f) => html`<b>${f.plantillas_formulario.nombre}</b>${f.observaciones && f.estado === "rechazado" ? html`<small class="danger-text">Observado: ${f.observaciones}</small>` : html`<small>${f.plantillas_formulario.descripcion ?? ""}</small>`}` },
      { label: "Fecha límite", render: (f) => fecha(f.fecha_limite) },
      { label: "Estado", render: (f) => badge("formulario", f.estado) },
      { label: "", align: "right", render: (f) => html`<button class="btn btn--sm" data-completar="${f.id}">${ic("edit", "ico-sm")} Completar</button>` },
    ], porCompletar, { vacio: "No tenés formularios por completar" })}</div></div>
    <div class="card"><div class="card__head"><h3>Pendientes de firma</h3></div><div class="card__body--flush">${tablaSimple([
      { label: "Formulario", render: (f) => html`<b>${f.plantillas_formulario.nombre}</b><small>Enviado el ${fecha(f.enviado_at)}</small>` },
      { label: "Estado de firma", render: () => html`<span class="badge badge--warn">Sin firmar</span>` },
      { label: "", align: "right", render: (f) => html`<span class="row" style="justify-content:flex-end;flex-wrap:nowrap"><button class="btn btn--sm btn--ghost" data-completar="${f.id}">Editar</button><button class="btn btn--sm" data-firmar="${f.id}">${ic("pen", "ico-sm")} Firmar</button></span>` },
    ], porFirmar, { vacio: "No hay documentos esperando tu firma" })}</div></div>
    ${modelos.length ? html`<div class="card"><div class="card__head"><h3>Documentos disponibles para descargar</h3></div><div class="card__body--flush">${tablaSimple([
      { label: "Modelo", render: (p) => html`<b>${p.nombre}</b><small>Versión ${p.version}</small>` },
      { label: "", align: "right", render: (p) => html`<button class="btn btn--sm btn--ghost" data-modelo="${p.id}">${ic("download", "ico-sm")} Descargar</button>` },
    ], modelos)}</div></div>` : ""}
    <div class="card"><div class="card__head"><h3>Historial de documentos firmados y enviados</h3></div><div class="card__body--flush">${tablaSimple([
      { label: "Formulario", render: (f) => html`<b>${f.plantillas_formulario.nombre}</b><small>${f.iniciado_por_cliente ? "Solicitud propia" : "Pedido por BBX"}</small>` },
      { label: "Firma", render: (f) => (f.firmas?.[0] ? html`${fechaHora(f.firmas[0].firmado_at)}<small>${f.firmas[0].firmante_nombre}</small>` : html`<span class="muted">No requiere</span>`) },
      { label: "Estado", render: (f) => html`${badge("formulario", f.estado)}${f.observaciones ? html`<small>${f.observaciones}</small>` : ""}` },
      { label: "", align: "right", render: (f) => html`<button class="btn btn--sm btn--ghost" data-ver="${f.id}">Ver</button>` },
    ], historial, { vacio: "Sin historial" })}</div></div>
  </div>`;

  el.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-iniciar],[data-completar],[data-firmar],[data-ver],[data-modelo]");
    if (!b) return;
    if (b.dataset.iniciar) return completar(sb, { plantilla: plantillas.find((p) => p.id === b.dataset.iniciar) }, refrescar);
    if (b.dataset.modelo) { const p = plantillas.find((x) => x.id === b.dataset.modelo); return abrirArchivo("plantillas", p.archivo_path, p.nombre + ".pdf").catch(toastError); }
    const f = forms.find((x) => x.id === (b.dataset.completar || b.dataset.firmar || b.dataset.ver));
    if (b.dataset.completar) completar(sb, { formulario: f, plantilla: f.plantillas_formulario }, refrescar);
    if (b.dataset.firmar) firmar(sb, f, refrescar);
    if (b.dataset.ver) ver(f);
  });
}

function campoDe(c, valor) {
  const tipo = { texto: "text", textarea: "textarea", numero: "number", fecha: "date", cuit: "cuit", select: "select" }[c.tipo] ?? "text";
  return campo({ name: c.clave, label: c.etiqueta, type: tipo, value: tipo === "cuit" && valor ? cuitFmt(valor) : valor ?? "", required: !!c.requerido,
    options: c.tipo === "select" ? [{ value: "", label: "Seleccionar…" }, ...(c.opciones ?? [])] : [], col: tipo === "textarea" ? "" : "f-6", step: tipo === "number" ? "any" : undefined });
}

function completar(sb, { formulario = null, plantilla }, alTerminar) {
  const m = modal({
    title: plantilla.nombre, size: "lg",
    body: html`<form class="form" id="f-form" novalidate>
      ${plantilla.descripcion ? html`<p class="muted" style="grid-column:span 12">${plantilla.descripcion}</p>` : ""}
      ${plantilla.campos.map((c) => campoDe(c, formulario?.datos?.[c.clave]))}
      <p class="form-error" data-error hidden></p></form>`,
    foot: html`<button class="btn btn--ghost" data-close>Cancelar</button><button class="btn" form="f-form">${plantilla.requiere_firma ? "Continuar a la firma" : "Enviar"}</button>`,
  });
  const form = m.el.querySelector("form");
  form.querySelectorAll("[data-cuit]").forEach((i) => i.addEventListener("input", () => { i.value = i.value.replace(/[^\d-]/g, "").slice(0, 13); }));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const err = form.querySelector("[data-error]"); err.hidden = true;
    const datos = {};
    for (const c of plantilla.campos) {
      const el = form.elements[c.clave];
      let v = (el?.value ?? "").trim();
      if (c.tipo === "cuit") v = v.replace(/\D/g, "");
      if (c.requerido && !v) { el.setAttribute("aria-invalid", "true"); err.textContent = `Falta completar: ${c.etiqueta}`; err.hidden = false; el.focus(); return; }
      el?.setAttribute("aria-invalid", "false");
      if (v) datos[c.clave] = v;
    }
    conCarga(m.el.querySelector(".modal__foot .btn:not(.btn--ghost)"), async () => {
      let id = formulario?.id;
      const { data, error } = formulario
        ? await sb.rpc("enviar_formulario", { p_id: formulario.id, p_datos: datos })
        : await sb.rpc("iniciar_formulario", { p_plantilla: plantilla.id, p_datos: datos });
      if (error) { err.textContent = errMsg(error); err.hidden = false; return; }
      if (!formulario) id = data;
      m.close();
      if (plantilla.requiere_firma) firmar(sb, { id, datos, plantillas_formulario: plantilla }, alTerminar);
      else { toast("Formulario enviado a BBX"); alTerminar(); }
    });
  });
}

function resumenDatos(p, datos) {
  return html`<dl class="dl">${p.campos.map((c) => {
    let v = datos?.[c.clave];
    if (v && c.tipo === "fecha") v = fecha(v);
    if (v && c.tipo === "cuit") v = cuitFmt(v);
    if (v && c.tipo === "numero" && /monto|importe|limite|facturacion/i.test(c.clave)) v = money(v);
    return html`<div><dt>${c.etiqueta}</dt><dd>${v || "—"}</dd></div>`;
  })}</dl>`;
}

function firmar(sb, f, alTerminar) {
  const p = f.plantillas_formulario;
  const nombre = [estado.perfil.nombre, estado.perfil.apellido].filter(Boolean).join(" ");
  const m = modal({
    title: "Firmar: " + p.nombre, size: "lg",
    body: html`<div class="stack">
      ${resumenDatos(p, f.datos)}
      ${p.texto_legal ? html`<div class="card"><div class="card__body" style="max-height:180px;overflow:auto;white-space:pre-wrap;font-size:13px;color:var(--text-2)">${p.texto_legal}</div></div>` : ""}
      <form class="form" id="f-firma" novalidate>
        ${campo({ name: "nombre", label: "Nombre y apellido del firmante", value: nombre, required: true, col: "f-8" })}
        ${campo({ name: "dni", label: "DNI", required: true, col: "f-4", attrs: ' inputmode="numeric" pattern="\\d{7,8}" maxlength="8"' })}
        <label class="check"><input type="checkbox" name="acepto" required> <span>Leí y acepto el contenido. Entiendo que esta <b>firma electrónica por aceptación</b> queda registrada con fecha, hora, IP y una huella digital (SHA-256) del documento.</span></label>
        <p class="form-error" data-error hidden></p></form>
      <p class="muted" style="font-size:12px">Firma electrónica en los términos del art. 5 de la Ley 25.506. No reemplaza a la firma digital con certificado cuando la ley la exija.</p></div>`,
    foot: html`<button class="btn btn--ghost" data-close>Firmar más tarde</button><button class="btn" form="f-firma">${ic("pen", "ico-sm")} Firmar</button>`,
  });
  const form = m.el.querySelector("form");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const err = form.querySelector("[data-error]"); err.hidden = true;
    if (!form.acepto.checked) { err.textContent = "Tenés que aceptar el contenido para firmar."; err.hidden = false; return; }
    if (!/^\d{7,8}$/.test(form.dni.value.trim())) { err.textContent = "Ingresá un DNI válido (7 u 8 dígitos)."; err.hidden = false; return; }
    conCarga(m.el.querySelector(".modal__foot .btn:not(.btn--ghost)"), async () => {
      const { error } = await sb.rpc("firmar_formulario", { p_id: f.id, p_nombre: form.nombre.value.trim(), p_dni: form.dni.value.trim(), p_acepto: true });
      if (error) { err.textContent = errMsg(error); err.hidden = false; return; }
      toast("Documento firmado. BBX lo va a revisar."); m.close(); alTerminar();
    });
  });
  m.el.querySelector("[data-close]").addEventListener("click", () => alTerminar());
}

function ver(f) {
  const firma = f.firmas?.[0];
  modal({
    title: f.plantillas_formulario.nombre, size: "lg",
    body: html`<div class="stack"><div class="row row--between"><span class="muted">Enviado el ${fecha(f.enviado_at)}</span>${badge("formulario", f.estado)}</div>
      ${resumenDatos(f.plantillas_formulario, f.datos)}
      ${firma ? html`<div class="callout callout--ok">${ic("pen")}<div><b>Firmado por ${firma.firmante_nombre}</b> (DNI ${firma.firmante_dni}) el ${fechaHora(firma.firmado_at)}.<br><span class="mono" style="font-size:11px">SHA-256 ${firma.hash_contenido}</span></div></div>` : ""}</div>`,
  });
}
