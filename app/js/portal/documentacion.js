// Portal · Documentación: pendiente, presentada, archivos de BBX y carga de nuevos documentos.
import { html, ic, toastError, $ } from "../ui.js";
import { estado } from "../core.js";
import { subirDocumento, tablaDocumentos, accionesDocumentos, tablaRequeridos, mapaTipos } from "../documentos.js";

export default async function (el, { sb, titulo, acciones, refrescar }) {
  titulo("Documentación", "Documentación presentada, pendiente y archivos para descargar");
  const cliente_id = estado.perfil.cliente_id;
  const [tipos, { data: docs, error }, { data: reqs }, { data: ops }] = await Promise.all([
    mapaTipos(sb),
    sb.from("documentos").select("*").order("created_at", { ascending: false }),
    sb.from("documentos_requeridos").select("*, operaciones(numero)").neq("estado", "dispensado").order("created_at", { ascending: false }),
    sb.from("operaciones").select("id, numero").order("created_at", { ascending: false }),
  ]);
  if (error) return toastError(error);
  const mios = docs.filter((d) => d.subido_por_cliente), deBbx = docs.filter((d) => !d.subido_por_cliente);
  acciones(html`<button class="btn" id="subir">${ic("upload", "ico-sm")} Subir documento</button>`);
  const subir = (tipo_codigo = null, operacion_id = null) => subirDocumento(sb, { cliente_id, tipo_codigo, operacion_id, porCliente: true, operaciones: ops ?? [], alTerminar: refrescar });
  $("#subir").onclick = () => subir();

  el.innerHTML = html`<div class="stack">
    <div class="callout">${ic("shield")}<div>Tus archivos se guardan de forma <b>privada</b>: sólo vos y el personal autorizado de BBX pueden verlos. Los enlaces de descarga duran 60 segundos.</div></div>
    <div class="card"><div class="card__head"><h3>Documentación pendiente</h3></div><div class="card__body--flush" id="reqs">${tablaRequeridos(reqs, { staff: false })}</div></div>
    <div class="card"><div class="card__head"><h3>Documentación presentada</h3><span class="muted">Estado de revisión</span></div><div class="card__body--flush" id="mios">${tablaDocumentos(mios, { tipos })}</div></div>
    <div class="card"><div class="card__head"><h3>Archivos de BBX para descargar</h3></div><div class="card__body--flush" id="bbx">${tablaDocumentos(deBbx, { tipos })}</div></div>
  </div>`;
  accionesDocumentos($("#mios"), sb, () => docs, refrescar);
  accionesDocumentos($("#bbx"), sb, () => docs, refrescar);
  $("#reqs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-cumplir]"); if (!b) return;
    subir(b.dataset.tipo || null, b.dataset.op || null);
  });
}
