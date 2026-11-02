// Gráficos SVG livianos e interactivos (sin dependencias).
import { esc } from "./ui.js";

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
export const mesCorto = (yyyymm) => MESES[Number(yyyymm.slice(5, 7)) - 1] + " " + yyyymm.slice(2, 4);

function escala(max) {
  if (max <= 0) return { top: 1, paso: 0.25 };
  const exp = Math.pow(10, Math.floor(Math.log10(max)));
  const n = max / exp;
  const top = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * exp;
  return { top, paso: top / 4 };
}

/**
 * Área + línea. series: [{ nombre, valores: number[], clase }], etiquetas: string[]
 */
export function areaChart(el, { etiquetas, series, formato = (v) => v, alto = 260 }) {
  const W = 720, H = alto, padL = 64, padR = 12, padT = 16, padB = 30;
  const max = Math.max(...series.flatMap((s) => s.valores), 0);
  const { top, paso } = escala(max);
  const x = (i) => padL + (etiquetas.length <= 1 ? 0 : (i * (W - padL - padR)) / (etiquetas.length - 1));
  const y = (v) => padT + (H - padT - padB) * (1 - v / top);
  const id = "g" + Math.random().toString(36).slice(2, 8);

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Gráfico"><defs>
    <linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1E5BFF" stop-opacity=".45"/><stop offset="1" stop-color="#1E5BFF" stop-opacity="0"/></linearGradient></defs>`;
  for (let v = 0; v <= top + 1e-9; v += paso) {
    svg += `<line class="grid-line" x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}"/>`;
    svg += `<text class="axis" x="${padL - 10}" y="${y(v) + 4}" text-anchor="end">${esc(formato(v, true))}</text>`;
  }
  etiquetas.forEach((l, i) => { svg += `<text class="axis" x="${x(i)}" y="${H - 8}" text-anchor="middle">${esc(l)}</text>`; });
  series.forEach((s, si) => {
    const pts = s.valores.map((v, i) => `${x(i)},${y(v)}`);
    if (si === 0 && pts.length) svg += `<path d="M${x(0)},${y(0)} L${pts.join(" L")} L${x(s.valores.length - 1)},${y(0)} Z" fill="url(#${id})"/>`;
    svg += `<polyline class="area-line ${s.clase ?? ""}" points="${pts.join(" ")}"/>`;
  });
  svg += `<line class="hover-line" x1="0" x2="0" y1="${padT}" y2="${H - padB}" visibility="hidden"/>`;
  series.forEach(() => { svg += `<circle class="hover-dot" r="4.5" visibility="hidden"/>`; });
  svg += `<rect x="${padL}" y="0" width="${W - padL - padR}" height="${H}" fill="transparent" data-hit/></svg>`;

  el.classList.add("chart");
  el.innerHTML = svg + `<div class="chart-tip" hidden></div>`;
  const s = el.querySelector("svg"), tip = el.querySelector(".chart-tip"), line = s.querySelector(".hover-line"), dots = [...s.querySelectorAll(".hover-dot")];
  const mover = (ev) => {
    const r = s.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(etiquetas.length - 1, Math.round(((px - padL) / (W - padL - padR)) * (etiquetas.length - 1))));
    line.setAttribute("x1", x(i)); line.setAttribute("x2", x(i)); line.setAttribute("visibility", "visible");
    dots.forEach((d, si) => { d.setAttribute("cx", x(i)); d.setAttribute("cy", y(series[si].valores[i])); d.setAttribute("visibility", "visible"); });
    tip.hidden = false;
    tip.style.left = (x(i) / W) * r.width + "px";
    tip.style.top = (y(series[0].valores[i]) / H) * r.height + "px";
    tip.innerHTML = `<span class="muted">${esc(etiquetas[i])}</span>` + series.map((se) => `<b>${esc(formato(se.valores[i]))}</b><span class="muted">${esc(se.nombre)}</span>`).join("");
  };
  const salir = () => { tip.hidden = true; line.setAttribute("visibility", "hidden"); dots.forEach((d) => d.setAttribute("visibility", "hidden")); };
  s.addEventListener("pointermove", mover);
  s.addEventListener("pointerleave", salir);
}

/** Barras verticales agrupadas. series: [{ nombre, valores, clase }] */
export function barChart(el, { etiquetas, series, formato = (v) => v, alto = 240 }) {
  const W = 720, H = alto, padL = 64, padR = 8, padT = 12, padB = 30;
  const max = Math.max(...series.flatMap((s) => s.valores), 0);
  const { top, paso } = escala(max);
  const y = (v) => padT + (H - padT - padB) * (1 - v / top);
  const grupo = (W - padL - padR) / Math.max(etiquetas.length, 1);
  const bw = Math.min(26, (grupo * 0.7) / series.length);
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Gráfico de barras">`;
  for (let v = 0; v <= top + 1e-9; v += paso) {
    svg += `<line class="grid-line" x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${padL - 10}" y="${y(v) + 4}" text-anchor="end">${esc(formato(v, true))}</text>`;
  }
  etiquetas.forEach((l, i) => {
    const cx = padL + grupo * i + grupo / 2;
    svg += `<text class="axis" x="${cx}" y="${H - 8}" text-anchor="middle">${esc(l)}</text>`;
    series.forEach((s, si) => {
      const v = s.valores[i] || 0;
      const bx = cx - (bw * series.length) / 2 + si * bw + 1;
      svg += `<rect class="bar ${s.clase ?? ""}" x="${bx}" y="${y(v)}" width="${bw - 2}" height="${Math.max(0, y(0) - y(v))}" rx="4" data-i="${i}" data-s="${si}"/>`;
    });
  });
  svg += `</svg>`;
  el.classList.add("chart");
  el.innerHTML = svg + `<div class="chart-tip" hidden></div>`;
  const s = el.querySelector("svg"), tip = el.querySelector(".chart-tip");
  s.addEventListener("pointermove", (ev) => {
    const b = ev.target.closest("rect[data-i]");
    if (!b) { tip.hidden = true; return; }
    const r = s.getBoundingClientRect(), i = Number(b.dataset.i), si = Number(b.dataset.s);
    tip.hidden = false;
    tip.style.left = ((Number(b.getAttribute("x")) + bw / 2) / W) * r.width + "px";
    tip.style.top = (Number(b.getAttribute("y")) / H) * r.height + "px";
    tip.innerHTML = `<span class="muted">${esc(etiquetas[i])} · ${esc(series[si].nombre)}</span><b>${esc(formato(series[si].valores[i]))}</b>`;
  });
  s.addEventListener("pointerleave", () => { tip.hidden = true; });
}

/** Barras horizontales simples (participación). items: [{ label, valor, detalle }] */
export function barrasH(items, formato) {
  const max = Math.max(...items.map((i) => i.valor), 1);
  return `<div class="bars-h">${items.map((i) => `<div class="bh-row"><span>${esc(i.label)}</span><b class="num">${esc(formato(i.valor))}</b>
    <div class="bh-track"><div class="bh-fill" style="width:${(i.valor / max) * 100}%"></div></div>${i.detalle ? `<small class="muted">${esc(i.detalle)}</small>` : ""}</div>`).join("")}</div>`;
}
