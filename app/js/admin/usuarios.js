// Usuarios, roles y permisos.
import { html, ic, hace, badge, listado, modal, campo, leerForm, validarForm, conCarga, toast, toastError, errMsg, confirmar, tabs, $, panelNuevo } from "../ui.js";
import { tiene, estado } from "../core.js";
import { rolNombre } from "../shell.js";

export default async function (el, { sb, titulo, acciones, refrescar }) {
  titulo("Usuarios", "Personal interno, clientes con acceso y permisos por rol");
  if (tiene("usuarios.gestionar")) {
    acciones(html`<button class="btn" id="invitar">${ic("userPlus", "ico-sm")} Invitar usuario interno</button>`);
    $("#invitar").onclick = () => invitar(sb, refrescar);
  }
  el.innerHTML = html`<div class="tabs" id="tabs"></div><div id="panel"></div>`;
  const ver = { usuarios: () => vistaUsuarios(panelNuevo("#panel"), sb, refrescar), permisos: () => vistaPermisos(panelNuevo("#panel"), sb) };
  tabs($("#tabs"), [{ id: "usuarios", label: "Usuarios" }, { id: "permisos", label: "Roles y permisos" }], "usuarios", (t) => ver[t]().catch(toastError));
  await ver.usuarios();
}

async function vistaUsuarios(panel, sb, refrescar) {
  const [{ data, error }, { data: roles }] = await Promise.all([
    sb.from("perfiles").select("*, clientes!perfiles_cliente_id_fkey(empresas(razon_social))").order("created_at", { ascending: false }),
    sb.from("roles").select("*").order("orden"),
  ]);
  if (error) throw error;
  listado(panel, {
    rows: data, buscar: ["email", "nombre", "apellido", (u) => u.clientes?.empresas?.razon_social], exportar: "usuarios",
    filtros: [{ key: "rol", label: "Rol", options: roles.map((r) => ({ value: r.codigo, label: r.nombre })) }, { key: "estado", label: "Estado", options: [{ value: "activo", label: "Activo" }, { value: "pendiente", label: "Pendiente" }, { value: "suspendido", label: "Suspendido" }, { value: "rechazado", label: "Rechazado" }] }],
    vacio: "Sin usuarios",
    columns: [
      { key: "nombre", label: "Usuario", render: (u) => html`<b>${[u.nombre, u.apellido].filter(Boolean).join(" ") || "—"}</b>${u.id === estado.user.id ? html` <span class="tag">Vos</span>` : ""}<small>${u.email}</small>`, csv: (u) => u.email },
      { key: "rol", label: "Rol", render: (u) => html`${rolNombre(u.rol)}${u.clientes?.empresas?.razon_social ? html`<small>${u.clientes.empresas.razon_social}</small>` : ""}`, csv: (u) => u.rol },
      { key: "ultimo_acceso", label: "Último acceso", render: (u) => (u.ultimo_acceso ? hace(u.ultimo_acceso) : html`<span class="muted">Nunca</span>`), csv: (u) => u.ultimo_acceso ?? "" },
      { key: "estado", label: "Estado", render: (u) => badge("usuario", u.estado), csv: (u) => u.estado },
      { key: "acc", label: "", sort: false, align: "right", csv: false, render: (u) => tiene("usuarios.gestionar") && u.id !== estado.user.id ? html`<button class="btn btn--sm btn--ghost" data-editar="${u.id}">Gestionar</button>` : "" },
    ],
  });
  panel.addEventListener("click", (e) => { const b = e.target.closest("[data-editar]"); if (b) editar(sb, data.find((u) => u.id === b.dataset.editar), roles, refrescar); });
}

async function editar(sb, u, roles, refrescar) {
  const { data: clientes } = await sb.from("v_clientes").select("id, razon_social").order("razon_social");
  const m = modal({
    title: "Gestionar usuario",
    body: html`<form class="form" id="f-u" novalidate>
      <p class="muted" style="grid-column:span 12">${u.email}</p>
      ${campo({ name: "rol", label: "Rol", type: "select", value: u.rol, col: "f-6", options: roles.filter((r) => r.codigo !== "superadmin" || estado.perfil.rol === "superadmin").map((r) => ({ value: r.codigo, label: r.nombre })) })}
      ${campo({ name: "estado", label: "Estado", type: "select", value: u.estado, col: "f-6", options: [{ value: "activo", label: "Activo" }, { value: "pendiente", label: "Pendiente" }, { value: "suspendido", label: "Suspendido" }] })}
      <div class="field" data-cli>${campo({ name: "cliente_id", label: "Cliente vinculado", type: "select", value: u.cliente_id ?? "", options: [{ value: "", label: "Ninguno" }, ...clientes.map((c) => ({ value: c.id, label: c.razon_social }))] })}</div>
      <p class="muted" style="grid-column:span 12">Suspender un usuario también bloquea su inicio de sesión en Supabase Auth.</p>
      <p class="form-error" data-error hidden></p></form>`,
    foot: html`<button class="btn btn--ghost" data-close>Cancelar</button><button class="btn" form="f-u">Guardar</button>`,
  });
  const form = m.el.querySelector("form");
  const aj = () => { form.querySelector("[data-cli]").hidden = form.rol.value !== "cliente"; };
  form.rol.addEventListener("change", aj); aj();
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const err = form.querySelector("[data-error]"); err.hidden = true;
    const d = leerForm(form);
    conCarga(m.el.querySelector(".modal__foot .btn:not(.btn--ghost)"), async () => {
      const cambiaEstado = d.estado !== u.estado && (d.estado === "suspendido" || u.estado === "suspendido");
      const { error } = await sb.rpc("admin_actualizar_usuario", { p_id: u.id, p_rol: d.rol, p_estado: d.estado, p_cliente_id: d.rol === "cliente" ? d.cliente_id : null });
      if (error) { err.textContent = errMsg(error); err.hidden = false; return; }
      if (cambiaEstado) {
        const { error: e2 } = await sb.functions.invoke("gestionar-usuario", { body: { accion: "estado", user_id: u.id, estado: d.estado } });
        if (e2) toast("Se actualizó el perfil, pero no se pudo bloquear/desbloquear el login (revisá la Edge Function).", "error", 8000);
      }
      toast("Usuario actualizado"); m.close(); refrescar();
    });
  });
}

function invitar(sb, refrescar) {
  const m = modal({
    title: "Invitar usuario interno",
    body: html`<form class="form" id="f-inv" novalidate>
      ${campo({ name: "nombre", label: "Nombre", required: true, col: "f-6" })}
      ${campo({ name: "apellido", label: "Apellido", required: true, col: "f-6" })}
      ${campo({ name: "email", label: "Email", type: "email", required: true })}
      ${campo({ name: "rol", label: "Rol", type: "select", options: [
        { value: "operador", label: "Operador comercial" }, { value: "contable", label: "Contable" }, { value: "consulta", label: "Consulta" },
        { value: "administrador", label: "Administrador" }, ...(estado.perfil.rol === "superadmin" ? [{ value: "superadmin", label: "Superadministrador" }] : [])] })}
      <p class="muted" style="grid-column:span 12">Recibe un email para crear su contraseña. La invitación la envía Supabase Auth desde el servidor.</p>
      <p class="form-error" data-error hidden></p></form>`,
    foot: html`<button class="btn btn--ghost" data-close>Cancelar</button><button class="btn" form="f-inv">Enviar invitación</button>`,
  });
  const form = m.el.querySelector("form");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const err = form.querySelector("[data-error]"); err.hidden = true;
    if (!validarForm(form)) return;
    const d = leerForm(form);
    conCarga(m.el.querySelector(".modal__foot .btn:not(.btn--ghost)"), async () => {
      const { error } = await sb.functions.invoke("gestionar-usuario", { body: { accion: "invitar", ...d, redirect: location.origin + "/acceso/nueva-clave.html" } });
      if (error) {
        let msg = error.message; try { msg = (await error.context.json()).error ?? msg; } catch { /* */ }
        err.textContent = msg; err.hidden = false; return;
      }
      toast("Invitación enviada"); m.close(); refrescar();
    });
  });
}

async function vistaPermisos(panel, sb) {
  const [{ data: roles }, { data: permisos }, { data: rp }] = await Promise.all([
    sb.from("roles").select("*").eq("es_interno", true).order("orden"),
    sb.from("permisos").select("*").order("modulo"),
    sb.from("rol_permisos").select("*"),
  ]);
  const set = new Set((rp ?? []).map((x) => x.rol + "|" + x.permiso));
  const editable = tiene("usuarios.gestionar");
  panel.innerHTML = html`<div class="card"><div class="card__head"><h3>Matriz de permisos</h3><span class="muted">El superadministrador tiene todos los permisos</span></div>
    <div class="table-wrap"><table class="table"><thead><tr><th>Módulo</th><th>Permiso</th>${roles.filter((r) => r.codigo !== "superadmin").map((r) => html`<th class="center">${r.nombre}</th>`)}</tr></thead>
    <tbody>${permisos.map((p) => html`<tr><td class="muted">${p.modulo}</td><td>${p.descripcion}<small class="mono">${p.codigo}</small></td>
      ${roles.filter((r) => r.codigo !== "superadmin").map((r) => html`<td class="center"><input type="checkbox" aria-label="${r.nombre}: ${p.descripcion}" data-rol="${r.codigo}" data-permiso="${p.codigo}" ${set.has(r.codigo + "|" + p.codigo) ? "checked" : ""} ${editable ? "" : "disabled"} style="accent-color:var(--accent);width:16px;height:16px"></td>`)}</tr>`)}</tbody></table></div></div>`;
  panel.querySelectorAll("input[type=checkbox]").forEach((cb) => { if (set.has(cb.dataset.rol + "|" + cb.dataset.permiso)) cb.checked = true; });
  panel.addEventListener("change", async (e) => {
    const cb = e.target.closest("[data-rol]"); if (!cb) return;
    const fila = { rol: cb.dataset.rol, permiso: cb.dataset.permiso };
    if (!cb.checked && !(await confirmar(`Quitar "${fila.permiso}" al rol ${rolNombre(fila.rol)}.`, { titulo: "Quitar permiso", ok: "Quitar" }))) { cb.checked = true; return; }
    const { error } = cb.checked ? await sb.from("rol_permisos").insert(fila) : await sb.from("rol_permisos").delete().match(fila);
    if (error) { cb.checked = !cb.checked; return toastError(error); }
    toast("Permiso actualizado");
  });
}
