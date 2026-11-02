// Solicitudes de acceso al portal: aprobar (creando o vinculando el cliente) o rechazar.
import { html, ic, cuitFmt, fechaHora, badge, listado, modal, campo, toast, toastError, pedirTexto, conCarga, errMsg, hace } from "../ui.js";

export default async function (el, { sb, titulo, refrescar }) {
  titulo("Solicitudes de acceso", "Registros desde la web pública pendientes de aprobación");
  const { data, error } = await sb.from("solicitudes_registro").select("*").order("created_at", { ascending: false });
  if (error) return toastError(error);

  listado(el, {
    rows: data,
    buscar: ["razon_social", "cuit", "email", "nombre", "apellido"],
    filtros: [{ key: "estado", label: "Estado", options: [{ value: "pendiente", label: "Pendientes" }, { value: "aprobada", label: "Aprobadas" }, { value: "rechazada", label: "Rechazadas" }] }],
    vacio: "No hay solicitudes",
    columns: [
      { key: "created_at", label: "Recibida", render: (s) => html`${fechaHora(s.created_at)}<small>${hace(s.created_at)}</small>` },
      { key: "nombre", label: "Solicitante", render: (s) => html`<b>${s.nombre} ${s.apellido}</b><small>${s.email}</small>` },
      { key: "razon_social", label: "Empresa", render: (s) => html`<b>${s.razon_social}</b><small>CUIT ${cuitFmt(s.cuit)}</small>` },
      { key: "telefono", label: "Teléfono" },
      { key: "estado", label: "Estado", render: (s) => html`${badge("solicitud", s.estado)}${s.motivo_rechazo ? html`<small>${s.motivo_rechazo}</small>` : ""}` },
      { key: "acc", label: "", sort: false, align: "right", render: (s) => s.estado === "pendiente"
          ? html`<span class="row" style="justify-content:flex-end;flex-wrap:nowrap"><button class="btn btn--sm btn--ok" data-aprobar="${s.id}">${ic("check", "ico-sm")} Aprobar</button><button class="btn btn--sm btn--danger" data-rechazar="${s.id}">Rechazar</button></span>`
          : s.cliente_id ? html`<a class="btn btn--sm btn--ghost" href="#/clientes/${s.cliente_id}">Ver cliente</a>` : "" },
    ],
  });
  // Mostrar primero las pendientes
  const sel = el.querySelector('[data-f="estado"]'); sel.value = "pendiente"; sel.dispatchEvent(new Event("change", { bubbles: true }));

  el.addEventListener("click", async (e) => {
    const a = e.target.closest("[data-aprobar]"), r = e.target.closest("[data-rechazar]");
    if (a) aprobar(data.find((s) => s.id === a.dataset.aprobar));
    if (r) {
      const motivo = await pedirTexto({ titulo: "Rechazar solicitud", etiqueta: "Motivo (se le informa al solicitante)", ok: "Rechazar" });
      if (!motivo) return;
      const { error } = await sb.rpc("rechazar_solicitud", { p_solicitud: r.dataset.rechazar, p_motivo: motivo });
      if (error) return toastError(error);
      toast("Solicitud rechazada", "info"); refrescar();
    }
  });

  async function aprobar(s) {
    const { data: existente } = await sb.from("v_clientes").select("id, razon_social, codigo").eq("cuit", s.cuit).maybeSingle();
    const m = modal({
      title: "Aprobar acceso",
      body: html`<div class="stack">
        <dl class="dl"><div><dt>Solicitante</dt><dd>${s.nombre} ${s.apellido}</dd></div><div><dt>Email</dt><dd>${s.email}</dd></div>
          <div><dt>Empresa declarada</dt><dd>${s.razon_social}</dd></div><div><dt>CUIT</dt><dd>${cuitFmt(s.cuit)}</dd></div></dl>
        ${existente
          ? html`<div class="callout">${ic("link")}<div>Ya existe el cliente <b>${existente.razon_social}</b> (${existente.codigo}) con ese CUIT. El usuario quedará vinculado a ese cliente.</div></div>`
          : html`<div class="callout callout--ok">${ic("userPlus")}<div>Se creará un cliente nuevo <b>en evaluación</b> con la documentación obligatoria pedida.</div></div>`}
        <p class="muted">El solicitante debe haber verificado su email. Al aprobar recibe una notificación y puede ingresar al portal.</p>
        <p class="form-error" data-error hidden></p></div>`,
      foot: html`<button class="btn btn--ghost" data-close>Cancelar</button><button class="btn btn--ok" data-ok>${ic("check", "ico-sm")} Aprobar acceso</button>`,
    });
    const btn = m.el.querySelector("[data-ok]");
    btn.onclick = () => conCarga(btn, async () => {
      const { data: clienteId, error } = await sb.rpc("aprobar_solicitud", { p_solicitud: s.id, p_cliente_id: existente?.id ?? null });
      if (error) { const er = m.el.querySelector("[data-error]"); er.textContent = errMsg(error); er.hidden = false; return; }
      toast("Acceso aprobado"); m.close();
      location.hash = "#/clientes/" + clienteId;
    });
  }
}
