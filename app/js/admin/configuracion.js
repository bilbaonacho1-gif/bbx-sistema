// Configuración: empresa, valores por defecto, ARCA, tipos de operación, plantillas y tipos de documento.
import { html, ic, campo, leerForm, validarForm, bindCuit, conCarga, toast, toastError, errMsg, modal, tabs, tablaSimple, cuitFmt, fechaHora, $, reemplazarHash, panelNuevo } from "../ui.js";
import { subirArchivo, abrirArchivo } from "../core.js";

export default async function (el, { sb, query, titulo }) {
  titulo("Configuración", "Parámetros del sistema");
  el.innerHTML = html`<div class="tabs" id="tabs"></div><div id="panel"></div>`;
  let actual = query.tab || "empresa";
  const pintar = () => { reemplazarHash("#/configuracion", "#/configuracion?tab=" + actual); VISTAS[actual](panelNuevo("#panel"), sb, pintar).catch(toastError); };
  tabs($("#tabs"), [
    { id: "empresa", label: "Empresa" }, { id: "arca", label: "Facturación (ARCA)" }, { id: "tipos", label: "Tipos de operación" },
    { id: "plantillas", label: "Formularios" }, { id: "documentos", label: "Tipos de documento" },
  ], actual, (t) => { actual = t; pintar(); });
  pintar();
}

async function guardarConfig(sb, clave, valor) {
  const { error } = await sb.from("configuracion").upsert({ clave, valor });
  if (error) throw error;
}

const VISTAS = {
  async empresa(panel, sb) {
    const { data } = await sb.from("configuracion").select("*").in("clave", ["empresa", "operaciones"]);
    const emp = data.find((d) => d.clave === "empresa")?.valor ?? {}, ops = data.find((d) => d.clave === "operaciones")?.valor ?? {};
    panel.innerHTML = html`<div class="grid grid-2">
      <div class="card"><div class="card__head"><h3>Datos institucionales</h3></div><div class="card__body"><form class="form" id="f-emp">
        ${campo({ name: "razon_social", label: "Razón social", value: emp.razon_social, required: true })}
        ${campo({ name: "email", label: "Email de contacto", type: "email", value: emp.email, col: "f-6" })}
        ${campo({ name: "telefono", label: "Teléfono", value: emp.telefono, col: "f-6" })}
        ${campo({ name: "domicilio", label: "Domicilio", value: emp.domicilio })}
        <div class="form-actions"><button class="btn">Guardar</button></div></form></div></div>
      <div class="card"><div class="card__head"><h3>Valores por defecto de nuevas operaciones</h3></div><div class="card__body"><form class="form" id="f-ops">
        ${campo({ name: "tasa_mensual_default", label: "Tasa mensual (%)", type: "number", step: "0.0001", value: ops.tasa_mensual_default, col: "f-6" })}
        ${campo({ name: "base_dias", label: "Base de días", type: "select", value: ops.base_dias ?? 365, col: "f-6", options: [{ value: 365, label: "365" }, { value: 360, label: "360" }] })}
        ${campo({ name: "gastos_default", label: "Gastos por defecto ($)", type: "money", value: ops.gastos_default, col: "f-6" })}
        <div class="form-actions"><button class="btn">Guardar</button></div></form></div></div></div>`;
    $("#f-emp", panel).onsubmit = async (e) => { e.preventDefault(); if (!validarForm(e.target)) return; try { await guardarConfig(sb, "empresa", leerForm(e.target)); toast("Guardado"); } catch (ex) { toastError(ex); } };
    $("#f-ops", panel).onsubmit = async (e) => { e.preventDefault(); const d = leerForm(e.target); d.base_dias = Number(d.base_dias); try { await guardarConfig(sb, "operaciones", { ...ops, ...d }); toast("Guardado"); } catch (ex) { toastError(ex); } };
  },

  async arca(panel, sb) {
    const [{ data: c }, { data: log }] = await Promise.all([
      sb.from("arca_config").select("*").maybeSingle(),
      sb.from("arca_log").select("*").order("created_at", { ascending: false }).limit(15),
    ]);
    panel.innerHTML = html`<div class="grid grid-3" style="align-items:start">
      <div class="card span-2"><div class="card__head"><h3>Datos del emisor</h3></div><div class="card__body"><form class="form" id="f-arca" novalidate>
        ${campo({ name: "razon_social", label: "Razón social del emisor", value: c?.razon_social, col: "f-8" })}
        ${campo({ name: "cuit_emisor", label: "CUIT emisor", type: "cuit", value: c?.cuit_emisor ? cuitFmt(c.cuit_emisor) : "", col: "f-4" })}
        ${campo({ name: "domicilio", label: "Domicilio comercial", value: c?.domicilio, col: "f-8" })}
        ${campo({ name: "punto_venta", label: "Punto de venta (web services)", type: "number", value: c?.punto_venta, min: "1", step: "1", col: "f-4", help: "Debe estar dado de alta en ARCA como RECE / web services" })}
        ${campo({ name: "condicion_iva", label: "Condición frente al IVA", type: "select", value: c?.condicion_iva, col: "f-4", options: ["IVA Responsable Inscripto", "Responsable Monotributo", "IVA Sujeto Exento"] })}
        ${campo({ name: "ingresos_brutos", label: "Ingresos Brutos", value: c?.ingresos_brutos, col: "f-4" })}
        ${campo({ name: "inicio_actividades", label: "Inicio de actividades", type: "date", value: c?.inicio_actividades, col: "f-4" })}
        ${campo({ name: "ambiente", label: "Ambiente", type: "select", value: c?.ambiente ?? "homologacion", col: "f-6", options: [{ value: "homologacion", label: "Homologación (pruebas)" }, { value: "produccion", label: "Producción" }], help: "Debe coincidir con el certificado cargado en la Edge Function" })}
        <p class="form-error" data-error hidden></p>
        <div class="form-actions"><button class="btn">Guardar</button></div></form></div></div>
      <div class="stack">
        <div class="card"><div class="card__head"><h3>Certificado y conexión</h3></div><div class="card__body">
          <p class="muted" style="margin-bottom:12px">El certificado y la clave privada <b>no se cargan acá</b>: se guardan como secretos de la Edge Function <span class="mono">arca-factura</span> (ver docs/ARCA.md). Nunca llegan al navegador.</p>
          <button class="btn btn--ghost btn--block" id="probar">${ic("refresh", "ico-sm")} Probar conexión con ARCA</button>
          <div id="res" style="margin-top:12px"></div></div></div>
      </div>
      <div class="card span-2"><div class="card__head"><h3>Registro de comunicaciones con ARCA</h3></div><div class="card__body--flush">${tablaSimple([
        { label: "Fecha", render: (l) => fechaHora(l.created_at) }, { label: "Operación", key: "operacion" }, { label: "Ambiente", key: "ambiente" },
        { label: "Resultado", render: (l) => html`<span class="badge ${l.exito ? "badge--ok" : "badge--danger"}">${l.exito ? "OK" : "Error"}</span>` },
      ], log, { vacio: "Sin comunicaciones todavía" })}</div></div></div>`;
    const form = $("#f-arca", panel); bindCuit(form);
    form.onsubmit = async (e) => {
      e.preventDefault();
      const err = form.querySelector("[data-error]"); err.hidden = true;
      if (!validarForm(form)) { err.textContent = "Revisá el CUIT."; err.hidden = false; return; }
      const d = leerForm(form);
      const { error } = await sb.from("arca_config").update(d).eq("id", 1);
      if (error) { err.textContent = errMsg(error); err.hidden = false; return; }
      toast("Datos fiscales guardados");
    };
    $("#probar", panel).onclick = (e) => conCarga(e.currentTarget, async () => {
      const r = $("#res", panel);
      const { data, error } = await sb.functions.invoke("arca-factura", { body: { accion: "estado" } });
      if (error) {
        let msg = error.message; try { msg = (await error.context.json()).error ?? msg; } catch { /* */ }
        r.innerHTML = html`<div class="callout callout--danger">${ic("xCircle")}<div><b>No se pudo consultar.</b> ${msg}<br><span class="muted">¿Está desplegada la Edge Function arca-factura?</span></div></div>`;
        return;
      }
      const ok = data.configurado && data.autenticacion === "ok";
      r.innerHTML = html`<div class="callout ${ok ? "callout--ok" : "callout--warn"}">${ic(ok ? "checkCircle" : "alert")}<div>
        <b>Ambiente: ${data.ambiente}</b><br>
        ${data.faltantes?.length ? html`Falta: ${data.faltantes.join(", ")}.<br>` : ""}
        Servidores ARCA: ${data.servidores?.AppServer ? `App ${data.servidores.AppServer} · DB ${data.servidores.DbServer} · Auth ${data.servidores.AuthServer}` : (data.servidores?.error ?? "—")}<br>
        Autenticación WSAA: ${data.autenticacion === "ok" ? "correcta" : data.autenticacion?.error ?? "no probada"}</div></div>`;
    });
  },

  async tipos(panel, sb, recargar) {
    const { data } = await sb.from("tipos_operacion").select("*").order("orden");
    panel.innerHTML = html`<div class="card"><div class="card__head"><h3>Tipos de operación</h3><button class="btn btn--sm" id="nuevo">${ic("plus", "ico-sm")} Nuevo tipo</button></div>
      <div class="card__body--flush">${tablaSimple([
        { label: "Nombre", render: (t) => html`<b>${t.nombre}</b><small class="mono">${t.codigo}</small>` },
        { label: "Descripción", key: "descripcion" },
        { label: "Intereses", render: (t) => (t.modalidad_default === "descuento" ? "Descontados" : "Al vencimiento") },
        { label: "Usa", render: (t) => [t.usa_cheques && "cheques", t.usa_acuerdo && "acuerdo"].filter(Boolean).join(", ") || "—" },
        { label: "Activo", render: (t) => (t.activo ? html`<span class="badge badge--ok">Sí</span>` : html`<span class="badge">No</span>`) },
        { label: "", align: "right", render: (t) => html`<button class="btn btn--sm btn--ghost" data-edit="${t.codigo}">Editar</button>` },
      ], data)}</div></div>`;
    const form = (t) => {
      const m = modal({
        title: t ? "Editar tipo de operación" : "Nuevo tipo de operación",
        body: html`<form class="form" id="f-tipo" novalidate>
          ${campo({ name: "codigo", label: "Código", value: t?.codigo, required: true, col: "f-6", disabled: !!t, attrs: ' pattern="[a-z_]{3,40}"', help: "minúsculas y guion bajo" })}
          ${campo({ name: "nombre", label: "Nombre", value: t?.nombre, required: true, col: "f-6" })}
          ${campo({ name: "descripcion", label: "Descripción", value: t?.descripcion })}
          ${campo({ name: "modalidad_default", label: "Intereses por defecto", type: "select", value: t?.modalidad_default ?? "vencido", col: "f-6", options: [{ value: "vencido", label: "Al vencimiento" }, { value: "descuento", label: "Descontados al liquidar" }] })}
          ${campo({ name: "orden", label: "Orden", type: "number", value: t?.orden ?? 10, col: "f-6" })}
          ${campo({ name: "usa_cheques", label: "Lleva cheques", type: "checkbox", value: t?.usa_cheques, col: "f-4" })}
          ${campo({ name: "usa_acuerdo", label: "Lleva acuerdo", type: "checkbox", value: t?.usa_acuerdo, col: "f-4" })}
          ${campo({ name: "activo", label: "Activo", type: "checkbox", value: t ? t.activo : true, col: "f-4" })}</form>`,
        foot: html`<button class="btn btn--ghost" data-close>Cancelar</button><button class="btn" form="f-tipo">Guardar</button>`,
      });
      m.el.querySelector("form").onsubmit = async (e) => {
        e.preventDefault(); if (!validarForm(e.target)) return;
        const d = leerForm(e.target);
        const { error } = t ? await sb.from("tipos_operacion").update(d).eq("codigo", t.codigo) : await sb.from("tipos_operacion").insert(d);
        if (error) return toastError(error);
        toast("Guardado"); m.close(); recargar();
      };
    };
    $("#nuevo", panel).onclick = () => form(null);
    panel.onclick = (e) => { const b = e.target.closest("[data-edit]"); if (b) form(data.find((t) => t.codigo === b.dataset.edit)); };
  },

  async plantillas(panel, sb, recargar) {
    const { data } = await sb.from("plantillas_formulario").select("*").order("nombre");
    panel.innerHTML = html`<div class="card"><div class="card__head"><h3>Plantillas de formularios y acuerdos</h3><button class="btn btn--sm" id="nuevo">${ic("plus", "ico-sm")} Nueva plantilla</button></div>
      <div class="card__body--flush">${tablaSimple([
        { label: "Nombre", render: (p) => html`<b>${p.nombre}</b><small>${p.descripcion ?? ""}</small>` },
        { label: "Campos", render: (p) => p.campos.length },
        { label: "Firma", render: (p) => (p.requiere_firma ? "Sí" : "No") },
        { label: "Cliente puede iniciarla", render: (p) => (p.cliente_puede_iniciar ? "Sí" : "No") },
        { label: "Modelo", render: (p) => (p.archivo_path ? html`<button class="link-btn" data-modelo="${p.id}">Descargar</button>` : "—") },
        { label: "Activa", render: (p) => (p.activo ? html`<span class="badge badge--ok">Sí</span>` : html`<span class="badge">No</span>`) },
        { label: "", align: "right", render: (p) => html`<button class="btn btn--sm btn--ghost" data-edit="${p.id}">Editar</button>` },
      ], data)}</div></div>`;
    const form = (p) => {
      const m = modal({
        title: p ? "Editar plantilla" : "Nueva plantilla", size: "lg",
        body: html`<form class="form" id="f-pl" novalidate>
          ${campo({ name: "codigo", label: "Código", value: p?.codigo, required: true, col: "f-4", disabled: !!p, attrs: ' pattern="[a-z_]{3,40}"' })}
          ${campo({ name: "nombre", label: "Nombre", value: p?.nombre, required: true, col: "f-8" })}
          ${campo({ name: "categoria", label: "Categoría", type: "select", value: p?.categoria ?? "otro", col: "f-6", options: [{ value: "descuento_cheques", label: "Descuento de cheques" }, { value: "acuerdo_cc", label: "Acuerdo en cuenta corriente" }, { value: "alta_cliente", label: "Alta de cliente" }, { value: "declaracion", label: "Declaración jurada" }, { value: "otro", label: "Otro" }] })}
          ${campo({ name: "descripcion", label: "Descripción", value: p?.descripcion, col: "f-6" })}
          ${campo({ name: "campos", label: "Campos (JSON)", type: "textarea", value: JSON.stringify(p?.campos ?? [{ clave: "campo", etiqueta: "Campo", tipo: "texto", requerido: true }], null, 2), attrs: ' rows="10" style="font-family:var(--mono);font-size:12px"', help: 'Tipos: texto, textarea, numero, fecha, cuit, select (con "opciones": [...])' })}
          ${campo({ name: "texto_legal", label: "Texto que el cliente acepta al firmar", type: "textarea", value: p?.texto_legal, attrs: ' rows="4"' })}
          ${campo({ name: "requiere_firma", label: "Requiere firma", type: "checkbox", value: p ? p.requiere_firma : true, col: "f-4" })}
          ${campo({ name: "cliente_puede_iniciar", label: "El cliente puede iniciarlo", type: "checkbox", value: p?.cliente_puede_iniciar, col: "f-4" })}
          ${campo({ name: "activo", label: "Activa", type: "checkbox", value: p ? p.activo : true, col: "f-4" })}
          <label class="field"><span>Modelo descargable (PDF o DOCX, opcional)</span><input class="input" type="file" name="archivo" accept=".pdf,.docx" style="padding-top:8px"></label>
          <p class="form-error" data-error hidden></p></form>`,
        foot: html`<button class="btn btn--ghost" data-close>Cancelar</button><button class="btn" form="f-pl">Guardar</button>`,
      });
      const f = m.el.querySelector("form");
      f.onsubmit = async (e) => {
        e.preventDefault();
        const err = f.querySelector("[data-error]"); err.hidden = true;
        if (!validarForm(f)) return;
        const d = leerForm(f);
        try {
          d.campos = JSON.parse(d.campos);
          if (!Array.isArray(d.campos) || d.campos.some((c) => !c.clave || !c.etiqueta || !["texto", "textarea", "numero", "fecha", "cuit", "select"].includes(c.tipo))) throw new Error("Cada campo necesita clave, etiqueta y un tipo válido.");
        } catch (ex) { err.textContent = "JSON de campos inválido: " + ex.message; err.hidden = false; return; }
        const file = f.archivo.files[0];
        try {
          if (file) d.archivo_path = await subirArchivo("plantillas", d.codigo ?? p.codigo, file);
          if (p) d.version = (p.version ?? 1) + 1;
          const { error } = p ? await sb.from("plantillas_formulario").update(d).eq("id", p.id) : await sb.from("plantillas_formulario").insert(d);
          if (error) throw error;
          toast("Plantilla guardada"); m.close(); recargar();
        } catch (ex) { err.textContent = errMsg(ex); err.hidden = false; }
      };
    };
    $("#nuevo", panel).onclick = () => form(null);
    panel.onclick = (e) => {
      const b = e.target.closest("[data-edit]"); if (b) form(data.find((p) => p.id === b.dataset.edit));
      const mo = e.target.closest("[data-modelo]"); if (mo) { const p = data.find((x) => x.id === mo.dataset.modelo); abrirArchivo("plantillas", p.archivo_path).catch(toastError); }
    };
  },

  async documentos(panel, sb, recargar) {
    const { data } = await sb.from("tipos_documento").select("*").order("orden");
    panel.innerHTML = html`<div class="card"><div class="card__head"><h3>Tipos de documento</h3><span class="muted">Los obligatorios se piden automáticamente al dar de alta un cliente</span></div>
      <div class="card__body--flush">${tablaSimple([
        { label: "Documento", render: (t) => html`<b>${t.nombre}</b><small class="mono">${t.codigo}</small>` },
        { label: "Aplica a", render: (t) => (t.aplica_a === "cliente" ? "Legajo del cliente" : "Operación") },
        { label: "Persona", render: (t) => ({ ambas: "Todas", humana: "Humana", juridica: "Jurídica" })[t.persona] },
        { label: "Obligatorio", render: (t) => html`<input type="checkbox" data-oblig="${t.codigo}" ${t.obligatorio ? "checked" : ""} aria-label="Obligatorio" style="accent-color:var(--accent)">` },
        { label: "Vence", render: (t) => (t.vence ? "Sí" : "No") },
      ], data)}</div></div>`;
    panel.querySelectorAll("[data-oblig]").forEach((cb) => { cb.checked = data.find((t) => t.codigo === cb.dataset.oblig).obligatorio; });
    panel.onchange = async (e) => {
      const cb = e.target.closest("[data-oblig]"); if (!cb) return;
      const { error } = await sb.from("tipos_documento").update({ obligatorio: cb.checked }).eq("codigo", cb.dataset.oblig);
      if (error) { cb.checked = !cb.checked; return toastError(error); }
      toast("Actualizado");
    };
  },
};
