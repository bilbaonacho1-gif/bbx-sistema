// Animación de bienvenida al iniciar sesión.
//
// Se reproduce una sola vez por inicio de sesión (la marca la pone acceso.js),
// mientras se cargan los datos del panel o del portal por debajo:
//   1. El logo se arma pieza por pieza (como en la apertura del sitio).
//   2. Aparecen "Soluciones Financieras S.A." y el saludo con el nombre.
//   3. Pasa un brillo azul y la pantalla se abre en diagonal, como la X.
// Un clic o una tecla la saltean. Con "reducir movimiento" no se muestra.
import { esc } from "./ui.js";

const MARCA = "bbx-bienvenida";
const DURACION_MIN = 2700;   // ms antes de abrir, aunque los datos ya estén

export function pedirBienvenida() {
  try { sessionStorage.setItem(MARCA, "1"); } catch { /* sin storage: sin animación */ }
}

export function debeMostrarse() {
  let pedida = false;
  try { pedida = sessionStorage.getItem(MARCA) === "1"; sessionStorage.removeItem(MARCA); } catch { /* */ }
  return pedida && !matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const LOGO = `<svg class="bv__marca" viewBox="275 481 770 329" aria-hidden="true">
  <use class="bv-p bv-b1" href="#bbx-b" fill="#fff"/>
  <g mask="url(#bbx-m1)"><use class="bv-p bv-b2" href="#bbx-b" x="247" fill="#fff"/></g>
  <g mask="url(#bbx-m2)">
    <path class="bv-p bv-x2" fill="url(#bbx-g2)" d="M760 558H813L897.5 641.6L863 679.8L793 600L760 571Z"/>
    <path class="bv-p bv-x1" fill="url(#bbx-g1)" d="M976 481H1043L808 740H741Z"/>
  </g>
  <path class="bv-p bv-x3" fill="#fff" d="M918.6 665.7L1044 809H976L884 703.9Z"/>
</svg>`;

/** Crea la animación. Devuelve { saludar(nombre, area), listo() }. */
export function iniciarBienvenida() {
  const inicio = performance.now();
  const el = document.createElement("div");
  el.className = "bienvenida";
  el.setAttribute("role", "presentation");
  el.innerHTML = `
    <div class="bv__mitad bv__mitad--a"><span class="bv__fondo"></span></div>
    <div class="bv__mitad bv__mitad--b"><span class="bv__fondo"></span></div>
    <div class="bv__centro">
      <div class="bv__logo">${LOGO}<span class="bv__brillo"></span></div>
      <p class="bv__razon">Soluciones Financieras S.A.</p>
      <span class="bv__linea"></span>
      <p class="bv__saludo" aria-live="polite"></p>
      <p class="bv__area"></p>
    </div>`;
  document.body.append(el);

  let abierta = false, listoDatos = false, eliminada = false;
  const abrir = () => {
    if (abierta || eliminada) return;
    abierta = true;
    el.classList.add("is-open");
    setTimeout(quitar, 1300);
  };
  const quitar = () => {
    if (eliminada) return;
    eliminada = true;
    el.remove();
    removeEventListener("keydown", saltear);
  };
  const saltear = () => { if (listoDatos) abrir(); else el.classList.add("is-rapida"); };
  el.addEventListener("click", saltear);
  addEventListener("keydown", saltear);

  return {
    saludar(nombre, area) {
      const n = (nombre || "").trim().split(/\s+/)[0];
      el.querySelector(".bv__saludo").innerHTML = n ? `Hola, <b>${esc(n)}</b>` : "Bienvenido";
      el.querySelector(".bv__area").textContent = area === "admin" ? "Panel administrativo" : "Portal de clientes";
    },
    /** Los datos ya cargaron: abrir cuando termine la animación (o ya, si la saltearon). */
    listo() {
      listoDatos = true;
      if (el.classList.contains("is-rapida")) return abrir();
      setTimeout(abrir, Math.max(0, DURACION_MIN - (performance.now() - inicio)));
    },
    quitar,
  };
}
