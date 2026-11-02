// Documentación compartida por el panel y el portal: subir, listar, pedir y revisar.
import { html, ic, fecha, tamano, badge, modal, campo, leerForm, conCarga, toast, toastError, errMsg, tablaSimple, pedirTexto, raw } from "./ui.js";
import { subirArchivo, abrirArchivo, validarArchivo, TIPOS_ARCHIVO, estado, tiene } from "./core.js";

/** Modal para subir un documento. porCliente = true desde el portal. */
export async function subirDocumento(sb, { cliente_id, operacion_id = null, tipo_codigo = null, porCliente = false, operaciones = [], alTerminar }) {
  const { data: tipos } = await sb.from("tipos_documento").select("*").order("orden");
  const m = modal({
    title: "Subir documento",
    body: html`<form class="form" id="f-doc" novalidate>
      ${campo({ name: "tipo_codigo", label: "Tipo de documento", type: "select", value: tipo_codigo ?? "", required: true,
        options: [{ value: "", label: "Seleccionar…" }, ...(tipos ?? []).map((t) => ({ value: t.codigo, label: t.nombre }))] })}
      ${operaciones.length ? campo({ name: "operacion_id", label: "Operación (opcional)", type: "select", value: operacion_id ?? "",
        options: [{ value: "", label: "Documentación general" }, ...operaciones.map((o) => ({ value: o.id, label: o.numero }))] }) : ""}
      ${campo({ name: "descripcion", label: "Descripción (opcional)", attrs: ' maxlength="300"' })}
      ${!porCliente ? html`${campo({ name: "fecha_vencimiento", label: "Vence el (opcional)", type: "date", col: "f-6" })}
        <label class="check f-6" style="align-self:end;padding-bottom:10px"><input type="checkbox" name="visible_cliente" checked> <span>Visible para el cliente</span></label>` : ""}
      <label class="drop" data-drop>${ic("upload")}<b>Elegí o arrastrá el archivo</b><span class="muted" data-nombre>PDF, JPG, PNG, WEBP, DOCX o XLSX · hasta 15 MB</span>
        <input type="file" name="archivo" accept="${TIPOS_ARCHIVO}" hidden required></label>
      <p class="form-error" data-error hidden></p>
    </form>`,
    foot: html`<button class="btn btn--ghost" data-close>Cancelar</button><button class="btn" form="f-doc">${ic("upload", "ico-sm")} Subir</button>`,
  });
  const form = m.el.querySelector("form"), input = form.archivo, drop = form.querySelector("[data-drop]"), err = form.querySelector("[data-error]");
  const mostrar = () => { form.querySelector("[data-nombre]").textContent = input.files[0] ? `${input.files[0].name} · ${tamano(input.files[0].size)}` : ""; };
  input.addEventListener("change", mostrar);
  ["dragover", "dragenter"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("is-over"); }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove("is-over")));
  drop.addEventListener("drop", (e) => { e.preventDefault(); if (e.dataTransfer.files[0]) { input.files = e.dataTransfer.files; mostrar(); } });

  form.addEventListener("submit", (e) => {
    e.preventDefault(); err.hidden = true;
    const file = input.files[0];
    const d = leerForm(form);
    if (!d.tipo_codigo) { err.textContent = "Elegí el tipo de documento."; err.hidden = false; return; }
    if (!file) { err.textContent = "Elegí un archivo."; err.hidden = false; return; }
    const problema = validarArchivo(file);
    if (problema) { err.textContent = problema; err.hidden = false; return; }
    conCarga(m.el.querySelector(".modal__foot .btn:not(.btn--ghost)"), async () => {
      try {
        const ruta = await subirArchivo("documentos", cliente_id, file);
        const fila = {
          cliente_id, operacion_id: d.operacion_id ?? operacion_id, tipo_codigo: d.tipo_codigo,
          nombre: file.name.slice(0, 200), descripcion: d.descripcion, storage_bucket: "documentos", storage_path: ruta,
          mime_type: file.type, tamano_bytes: file.size, subido_por: estado.user.id, subido_por_cliente: porCliente,
          estado: porCliente ? "en_revision" : "aprobado", visible_cliente: porCliente ? true : d.visible_cliente !== false,
          fecha_vencimiento: d.fecha_vencimiento ?? null,
        };
        if (!porCliente) { fila.revisado_por = estado.user.id; fila.revisado_at = new Date().toISOString(); }
        const { error } = await sb.from("documentos").insert(fila);
        if (error) {
          await sb.storage.from("documentos").remove([ruta]).catch(() => {});
          throw error;
        }
        toast(porCliente ? "Documento enviado. BBX lo va a revisar." : "Documento cargado");
        m.close(); alTerminar?.();
      } catch (ex) { err.textContent = errMsg(ex); err.hidden = false; }
    });
  });
}

export async function pedirDocumento(sb, { cliente_id, operacion_id = null, alTerminar }) {
  const { data: tipos } = await sb.from("tipos_documento").select("*").order("orden");
  const m = modal({
    title: "Pedir documentación al cliente",
    body: html`<form class="form" id="f-req" novalidate>
      ${campo({ name: "tipo_codigo", label: "Tipo", type: "select", options: [{ value: "", label: "Otro / libre" }, ...(tipos ?? []).map((t) => ({ value: t.codigo, label: t.nombre }))] })}
      ${campo({ name: "descripcion", label: "Qué necesitás", required: true, attrs: ' maxlength="300"' })}
      ${campo({ name: "fecha_limite", label: "Fecha límite", type: "date" })}
      <p class="muted">El cliente recibe una notificación y lo ve en su portal.</p>
    </form>`,
    foot: html`<button class="btn btn--ghost" data-close>Cancelar</button><button class="btn" form="f-req">Pedir</button>`,
  });
  const form = m.el.querySelector("form");
  form.tipo_codigo.addEventListener("change", () => {
    if (!form.descripcion.value) form.descripcion.value = form.tipo_codigo.selectedOptions[0].textContent;
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const d = leerForm(form);
    if (!d.descripcion) { form.descripcion.setAttribute("aria-invalid", "true"); return; }
    const { error } = await sb.from("documentos_requeridos").insert({ ...d, cliente_id, operacion_id, solicitado_por: estado.user.id });
    if (error) return toastError(error);
    toast("Pedido enviado al cliente"); m.close(); alTerminar?.();
  });
}

/** Tabla de documentos (panel o portal). */
export function tablaDocumentos(docs, { tipos = {}, staff = false } = {}) {
  return tablaSimple([
    { label: "Documento", render: (d) => html`<b>${tipos[d.tipo_codigo] ?? d.tipo_codigo ?? "Documento"}</b><small>${d.nombre}${d.tamano_bytes ? " · " + tamano(d.tamano_bytes) : ""}</small>` },
    { label: "Subido", render: (d) => html`${fecha(d.created_at)}<small>${d.subido_por_cliente ? "por el cliente" : "por BBX"}</small>` },
    { label: "Estado", render: (d) => html`${badge("documento", d.estado)}${d.observacion_revision ? html`<small>${d.observacion_revision}</small>` : ""}` },
    ...(staff ? [{ label: "Visible", render: (d) => (d.visible_cliente ? "Sí" : html`<span class="muted">Interno</span>`) }] : []),
    { label: "", align: "right", render: (d) => html`<span class="row" style="justify-content:flex-end;flex-wrap:nowrap">
        <button class="btn-icon" data-abrir="${d.id}" title="Descargar" aria-label="Descargar">${ic("download")}</button>
        ${staff && tiene("documentos.revisar") && d.estado === "en_revision" ? html`<button class="btn btn--sm btn--ok" data-aprobar="${d.id}">Aprobar</button><button class="btn btn--sm btn--danger" data-rechazar="${d.id}">Rechazar</button>` : ""}
      </span>` },
  ], docs, { vacio: "No hay documentos cargados" });
}

/** Conecta los botones de una tabla de documentos. */
export function accionesDocumentos(root, sb, docs, refrescar) {
  root.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-abrir],[data-aprobar],[data-rechazar]");
    if (!b) return;
    const id = b.dataset.abrir || b.dataset.aprobar || b.dataset.rechazar;
    const d = docs().find((x) => x.id === id);
    if (!d) return;
    try {
      if (b.dataset.abrir) return await abrirArchivo(d.storage_bucket, d.storage_path, d.nombre);
      if (b.dataset.aprobar) {
        const { error } = await sb.rpc("revisar_documento", { p_id: id, p_estado: "aprobado", p_observacion: null });
        if (error) throw error;
        toast("Documento aprobado");
      } else {
        const motivo = await pedirTexto({ titulo: "Rechazar documento", etiqueta: "Motivo (lo ve el cliente)", ok: "Rechazar" });
        if (!motivo) return;
        const { error } = await sb.rpc("revisar_documento", { p_id: id, p_estado: "rechazado", p_observacion: motivo });
        if (error) throw error;
        toast("Documento rechazado: se avisó al cliente", "info");
      }
      refrescar();
    } catch (ex) { toastError(ex); }
  });
}

export function tablaRequeridos(reqs, { staff = false } = {}) {
  return tablaSimple([
    { label: "Documentación pedida", render: (r) => html`<b>${r.descripcion}</b>${r.operaciones?.numero ? html`<small>Operación ${r.operaciones.numero}</small>` : ""}` },
    { label: "Fecha límite", render: (r) => html`<span class="${r.fecha_limite && r.estado === "pendiente" && r.fecha_limite < new Date().toISOString().slice(0, 10) ? "danger-text" : ""}">${fecha(r.fecha_limite)}</span>` },
    { label: "Estado", render: (r) => badge("requerido", r.estado) },
    { label: "", align: "right", render: (r) => staff
        ? (r.estado === "pendiente" && tiene("documentos.editar") ? html`<button class="btn btn--sm btn--ghost" data-dispensar="${r.id}">Dispensar</button>` : "")
        : (r.estado === "pendiente" ? html`<button class="btn btn--sm" data-cumplir="${r.id}" data-tipo="${r.tipo_codigo ?? ""}" data-op="${r.operacion_id ?? ""}">${ic("upload", "ico-sm")} Subir</button>` : "") },
  ], reqs, { vacio: "No hay documentación pendiente" });
}

export async function mapaTipos(sb) {
  const { data } = await sb.from("tipos_documento").select("codigo, nombre");
  return Object.fromEntries((data ?? []).map((t) => [t.codigo, t.nombre]));
}

export { raw };
