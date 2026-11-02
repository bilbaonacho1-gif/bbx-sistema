// Pantallas de acceso: iniciar sesión, registro, recuperación y nueva contraseña.
import { html, raw, esc, cuitValido, errMsg, $ } from "./ui.js";
import { icon, ensureSprite, logo } from "./icons.js";
import { sb, cargarConfig, registrar } from "./core.js";

ensureSprite();
document.querySelectorAll("[data-logo]").forEach((el) => el.insertAdjacentHTML("afterbegin", logo()));
document.querySelectorAll("[data-ico]").forEach((el) => el.insertAdjacentHTML("afterbegin", icon(el.dataset.ico)));
document.querySelectorAll("[data-ver-clave]").forEach((b) => {
  b.innerHTML = icon("eye");
  b.addEventListener("click", () => {
    const i = b.parentElement.querySelector("input");
    const ver = i.type === "password";
    i.type = ver ? "text" : "password";
    b.innerHTML = icon(ver ? "eyeOff" : "eye");
    b.setAttribute("aria-label", ver ? "Ocultar contraseña" : "Mostrar contraseña");
  });
});
document.querySelectorAll("[data-cuit]").forEach((el) => el.addEventListener("input", () => {
  const d = el.value.replace(/\D/g, "").slice(0, 11);
  el.value = d.length > 10 ? `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}` : d.length > 2 ? `${d.slice(0, 2)}-${d.slice(2)}` : d;
}));

// Los textos de aviso son literales propios; los datos del usuario se escapan con html``.
const aviso = (tipo, texto) => {
  $("#aviso").innerHTML = html`<div class="callout callout--${tipo}" style="margin-bottom:18px">${raw(icon(tipo === "ok" ? "checkCircle" : tipo === "danger" ? "alert" : "info"))}<div>${typeof texto === "string" ? raw(texto) : texto}</div></div>`;
};
const errorForm = (form, msg) => { const e = form.querySelector("[data-error]"); e.textContent = msg; e.hidden = !msg; };
const claveFuerte = (c) => c.length >= 10 && /[a-z]/.test(c) && /[A-Z]/.test(c) && /\d/.test(c);
function medidor(input) {
  const barra = input.parentElement.querySelector(".pw-meter i");
  if (!barra) return;
  input.addEventListener("input", () => {
    const c = input.value;
    const p = [c.length >= 10, /[a-z]/.test(c) && /[A-Z]/.test(c), /\d/.test(c), /[^\w]/.test(c), c.length >= 14].filter(Boolean).length;
    barra.style.width = (p / 5) * 100 + "%";
    barra.style.background = p <= 2 ? "var(--danger)" : p === 3 ? "var(--warn)" : "var(--ok)";
  });
}
async function cargando(btn, fn) {
  const txt = btn.textContent; btn.disabled = true; btn.innerHTML = '<span class="spin"></span>' + esc(txt);
  try { return await fn(); } finally { btn.disabled = false; btn.textContent = txt; }
}
const destinoSeguro = (next) => (next && /^\/(admin|portal)\//.test(next) ? next : null);

const pagina = document.body.dataset.pagina;
const cfg = await cargarConfig();
if (!cfg) {
  aviso("warn", "La plataforma todavía no está conectada a Supabase. Configurá <b>SUPABASE_URL</b> y <b>SUPABASE_ANON_KEY</b> (ver docs/INSTALACION.md).");
  document.querySelectorAll("form button").forEach((b) => (b.disabled = true));
} else {
  const cliente = await sb();
  const params = new URLSearchParams(location.search);

  if (pagina === "login") {
    if (params.get("motivo") === "inactividad") aviso("info", "Cerramos tu sesión por inactividad. Volvé a ingresar.");
    if (params.get("verificado")) aviso("ok", "¡Email verificado! BBX va a revisar tu solicitud y te avisaremos cuando tu acceso esté habilitado.");
    if (params.get("clave") === "ok") aviso("ok", "Contraseña actualizada. Ya podés ingresar.");
    const { data: { session } } = await cliente.auth.getSession();
    if (session && !params.get("motivo")) await redirigir(cliente, session.user.id, params.get("next"));

    const form = $("#f-login");
    form.addEventListener("submit", (e) => {
      e.preventDefault(); errorForm(form, "");
      const email = form.email.value.trim(), password = form.password.value;
      if (!email || !password) return errorForm(form, "Ingresá tu email y contraseña.");
      cargando(form.querySelector("button.btn"), async () => {
        const { data, error } = await cliente.auth.signInWithPassword({ email, password });
        if (error) {
          const m = /Email not confirmed/i.test(error.message) ? "Todavía no verificaste tu email. Revisá tu casilla (y el spam)."
            : /Invalid login credentials/i.test(error.message) ? "Email o contraseña incorrectos."
            : /rate|too many/i.test(error.message) ? "Demasiados intentos. Esperá unos minutos." : errMsg(error);
          return errorForm(form, m);
        }
        await registrar("login");
        await redirigir(cliente, data.user.id, params.get("next"));
      });
    });
  }

  if (pagina === "registro") {
    const form = $("#f-registro");
    medidor(form.password);
    form.addEventListener("submit", (e) => {
      e.preventDefault(); errorForm(form, "");
      for (const el of form.elements) if (el.name) el.setAttribute("aria-invalid", el.checkValidity() ? "false" : "true");
      const d = Object.fromEntries(["nombre", "apellido", "razon_social", "cuit", "telefono", "email", "password", "password2"].map((k) => [k, form[k].value.trim()]));
      if (!d.nombre || !d.apellido || !d.razon_social || !d.telefono || !d.email) return errorForm(form, "Completá todos los campos obligatorios.");
      if (!form.email.checkValidity()) return errorForm(form, "El email no es válido.");
      if (!cuitValido(d.cuit)) { form.cuit.setAttribute("aria-invalid", "true"); return errorForm(form, "El CUIT no es válido. Revisá los 11 dígitos."); }
      if (!claveFuerte(form.password.value)) return errorForm(form, "La contraseña debe tener al menos 10 caracteres, con mayúsculas, minúsculas y números.");
      if (form.password.value !== form.password2.value) return errorForm(form, "Las contraseñas no coinciden.");
      if (!form.acepto.checked) return errorForm(form, "Tenés que aceptar la declaración para continuar.");
      cargando(form.querySelector("button.btn"), async () => {
        const { error } = await cliente.auth.signUp({
          email: d.email, password: form.password.value,
          options: {
            data: { nombre: d.nombre, apellido: d.apellido, razon_social: d.razon_social, cuit: d.cuit.replace(/\D/g, ""), telefono: d.telefono },
            emailRedirectTo: location.origin + "/acceso/?verificado=1",
          },
        });
        if (error) {
          const m = /already registered|already exists/i.test(error.message) ? "Ya existe una cuenta con ese email. Probá iniciar sesión o recuperar tu contraseña."
            : /CUIT/i.test(error.message) ? "El CUIT no es válido." : /Database error/i.test(error.message) ? "No pudimos registrar la solicitud. Revisá los datos e intentá de nuevo." : errMsg(error);
          return errorForm(form, m);
        }
        await cliente.auth.signOut();
        form.hidden = true;
        document.querySelector(".auth__box > p").hidden = true;
        aviso("ok", html`<b>¡Listo! Revisá tu email (${d.email}).</b><br>Te enviamos un enlace para verificar tu cuenta. Después, un asesor de BBX revisa tu solicitud y te avisamos cuando tu acceso esté habilitado.`);
      });
    });
  }

  if (pagina === "recuperar") {
    const form = $("#f-recuperar");
    form.addEventListener("submit", (e) => {
      e.preventDefault(); errorForm(form, "");
      if (!form.email.checkValidity() || !form.email.value) return errorForm(form, "Ingresá un email válido.");
      cargando(form.querySelector("button.btn"), async () => {
        await cliente.auth.resetPasswordForEmail(form.email.value.trim(), { redirectTo: location.origin + "/acceso/nueva-clave.html" });
        // Mismo mensaje exista o no la cuenta (no revela qué emails están registrados)
        form.hidden = true;
        aviso("ok", "Si el email corresponde a una cuenta, vas a recibir un enlace para crear una nueva contraseña. Revisá también el spam.");
      });
    });
  }

  if (pagina === "nueva-clave") {
    const form = $("#f-nueva");
    medidor(form.password);
    // El enlace del email trae un código (PKCE) que supabase-js canjea por una sesión temporal
    let { data: { session } } = await cliente.auth.getSession();
    cliente.auth.onAuthStateChange((ev, s) => { if (s) session = s; });
    setTimeout(() => { if (!session) aviso("danger", "El enlace es inválido o venció. <a href='/acceso/recuperar.html'>Pedí uno nuevo</a>."); }, 2500);
    form.addEventListener("submit", (e) => {
      e.preventDefault(); errorForm(form, "");
      if (!claveFuerte(form.password.value)) return errorForm(form, "La contraseña debe tener al menos 10 caracteres, con mayúsculas, minúsculas y números.");
      if (form.password.value !== form.password2.value) return errorForm(form, "Las contraseñas no coinciden.");
      cargando(form.querySelector("button.btn"), async () => {
        const { error } = await cliente.auth.updateUser({ password: form.password.value });
        if (error) return errorForm(form, /different from the old/i.test(error.message) ? "La nueva contraseña debe ser distinta de la anterior." : errMsg(error));
        await registrar("cambio_clave");
        await cliente.auth.signOut();
        location.replace("/acceso/?clave=ok");
      });
    });
  }
}

async function redirigir(cliente, uid, next) {
  const { data: p } = await cliente.from("perfiles").select("rol").eq("id", uid).maybeSingle();
  const destino = destinoSeguro(next);
  const area = p && p.rol !== "cliente" ? "/admin/" : "/portal/";
  location.replace(destino && destino.startsWith(area) ? destino : area);
}

