// Portal · Mi cuenta: resumen, datos de la empresa y perfil del usuario.
import { html, ic, money, cuitFmt, fecha, badge, campo, leerForm, validarForm, toast, toastError, errMsg, pedirTexto, conCarga, $ } from "../ui.js";
import { estado, sb as cliente } from "../core.js";

export default async function (el, { sb, titulo }) {
  const c = estado.cliente;
  titulo("Mi cuenta", `Bienvenido, ${c?.razon_social ?? estado.perfil.nombre ?? ""}`);
  if (!c) { el.innerHTML = html`<div class="callout callout--warn">${ic("alert")}<div>Tu usuario todavía no está vinculado a un cliente. Comunicate con BBX.</div></div>`; return; }

  const [{ data: ops }, { count: docsPend }, { count: formsPend }, { data: ec }, { data: conds }] = await Promise.all([
    sb.from("v_operaciones").select("estado, saldo_pendiente, fecha_vencimiento, numero, id").order("fecha_vencimiento"),
    sb.from("documentos_requeridos").select("id", { count: "exact", head: true }).eq("estado", "pendiente"),
    sb.from("formularios").select("id", { count: "exact", head: true }).in("estado", ["pendiente", "rechazado", "completado"]),
    sb.from("v_estado_cuenta").select("saldo").order("fecha", { ascending: false }).order("created_at", { ascending: false }).limit(1),
    sb.from("condiciones_iva").select("*"),
  ]);
  const activas = (ops ?? []).filter((o) => ["activa", "en_mora"].includes(o.estado));
  const prox = activas.find((o) => o.fecha_vencimiento >= new Date().toISOString().slice(0, 10));
  const condIva = Object.fromEntries((conds ?? []).map((x) => [x.id, x.nombre]));
  const p = estado.perfil;

  el.innerHTML = html`
    ${docsPend ? html`<a class="callout callout--warn" href="#/documentacion" style="margin-bottom:16px;display:flex">${ic("folder")}<div>Tenés <b>${docsPend} documento(s) pendiente(s)</b> de presentar.</div></a>` : ""}
    <div class="grid grid-4 kpi-grid">
      <a class="card tile" href="#/operaciones">${ic("transfer")}<b>Mis operaciones</b><span>${activas.length} operación(es) activa(s)${prox ? ` · próximo vencimiento ${fecha(prox.fecha_vencimiento)}` : ""}</span></a>
      <a class="card tile" href="#/estado-cuenta">${ic("chart")}<b>Estado de cuenta</b><span>Saldo ${money(ec?.[0]?.saldo ?? 0)} · movimientos y pagos</span></a>
      <a class="card tile" href="#/documentacion">${ic("file")}<b>Documentación</b><span>Presentada y pendiente${docsPend ? ` · ${docsPend} pendiente(s)` : ""}</span></a>
      <a class="card tile" href="#/formularios">${ic("pen")}<b>Formularios</b><span>Descuentos y acuerdos${formsPend ? ` · ${formsPend} por completar` : ""}</span></a>
    </div>

    <div class="grid grid-3" style="margin-top:16px;align-items:start">
      <div class="card span-2"><div class="card__head"><h3>Datos de la empresa</h3><button class="btn btn--sm btn--ghost" id="actualizar">${ic("edit", "ico-sm")} Pedir actualización</button></div>
        <div class="card__body"><dl class="dl">
          <div><dt>Razón social</dt><dd>${c.razon_social}</dd></div><div><dt>CUIT</dt><dd>${cuitFmt(c.cuit)}</dd></div>
          <div><dt>Condición frente al IVA</dt><dd>${condIva[c.condicion_iva] ?? "—"}</dd></div><div><dt>Actividad</dt><dd>${c.actividad || "—"}</dd></div>
          <div><dt>Domicilio fiscal</dt><dd>${[c.domicilio_calle, c.domicilio_numero, c.domicilio_piso, c.domicilio_localidad, c.domicilio_provincia].filter(Boolean).join(" ") || "—"}</dd></div>
          <div><dt>Contacto</dt><dd>${[c.email, c.telefono].filter(Boolean).join(" · ") || "—"}</dd></div>
        </dl></div></div>
      <div class="card"><div class="card__head"><h3>Estado de la cuenta</h3></div><div class="card__body"><dl class="dl" style="grid-template-columns:1fr">
        <div><dt>Situación</dt><dd>${badge("cliente", c.estado)}</dd></div>
        <div><dt>Número de cliente</dt><dd class="mono">${c.codigo}</dd></div>
        <div><dt>Cliente desde</dt><dd>${fecha(c.fecha_alta)}</dd></div>
        <div><dt>Saldo pendiente</dt><dd style="font-size:20px">${money(c.saldo_pendiente)}</dd></div>
      </dl></div></div>
    </div>

    <div class="grid grid-2" style="margin-top:16px;align-items:start">
      <div class="card"><div class="card__head"><h3>Mis datos de usuario</h3></div><div class="card__body"><form class="form" id="f-perfil" novalidate>
        ${campo({ name: "nombre", label: "Nombre", value: p.nombre, required: true, col: "f-6" })}
        ${campo({ name: "apellido", label: "Apellido", value: p.apellido, required: true, col: "f-6" })}
        ${campo({ name: "telefono", label: "Teléfono", type: "tel", value: p.telefono, col: "f-6" })}
        ${campo({ name: "email", label: "Email", value: p.email, col: "f-6", disabled: true })}
        <div class="form-actions"><button class="btn">Guardar</button></div></form></div></div>
      <div class="card"><div class="card__head"><h3>Cambiar contraseña</h3></div><div class="card__body"><form class="form" id="f-clave" novalidate>
        ${campo({ name: "clave", label: "Nueva contraseña", type: "password", required: true, attrs: ' minlength="10" autocomplete="new-password"', help: "Mínimo 10 caracteres, con mayúsculas, minúsculas y números." })}
        ${campo({ name: "clave2", label: "Repetir contraseña", type: "password", required: true, attrs: ' minlength="10" autocomplete="new-password"' })}
        <p class="form-error" data-error hidden></p>
        <div class="form-actions"><button class="btn">Actualizar contraseña</button></div></form></div></div>
    </div>`;

  $("#actualizar").onclick = async () => {
    const msg = await pedirTexto({ titulo: "Pedir actualización de datos", etiqueta: "¿Qué datos hay que actualizar?", ok: "Enviar a BBX" });
    if (!msg) return;
    const { error } = await sb.rpc("solicitar_actualizacion_datos", { p_mensaje: msg });
    if (error) return toastError(error);
    toast("Pedido enviado. Un asesor lo va a revisar.");
  };
  $("#f-perfil").onsubmit = async (e) => {
    e.preventDefault(); if (!validarForm(e.target)) return;
    const d = leerForm(e.target);
    const { error } = await sb.from("perfiles").update({ nombre: d.nombre, apellido: d.apellido, telefono: d.telefono }).eq("id", p.id);
    if (error) return toastError(error);
    Object.assign(p, d); toast("Datos actualizados");
  };
  $("#f-clave").onsubmit = (e) => {
    e.preventDefault();
    const f = e.target, err = f.querySelector("[data-error]"); err.hidden = true;
    const clave = f.clave.value;
    if (clave.length < 10 || !/[a-z]/.test(clave) || !/[A-Z]/.test(clave) || !/\d/.test(clave)) { err.textContent = "La contraseña debe tener al menos 10 caracteres, con mayúsculas, minúsculas y números."; err.hidden = false; return; }
    if (clave !== f.clave2.value) { err.textContent = "Las contraseñas no coinciden."; err.hidden = false; return; }
    conCarga(f.querySelector("button"), async () => {
      const { error } = await (await cliente()).auth.updateUser({ password: clave });
      if (error) { err.textContent = errMsg(error); err.hidden = false; return; }
      f.reset(); toast("Contraseña actualizada");
    });
  };
}
