// BBX Soluciones Financieras S.A. — sin librerías.
const CONFIG = {
  whatsapp: "5491157502360", // +54 9 11 5750-2360
};

const $ = (id) => document.getElementById(id);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const root = document.documentElement;
const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

const fmtMoney = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const fmtInt = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });

const header = $("header");
const hero = $("inicio");
const intro = $("intro");
const waFloat = document.querySelector(".wa-float");

/* =========================================================
   0) Idioma (ES/EN) y tema (oscuro/claro)
   El español está en el HTML; el inglés, en este diccionario.
   ========================================================= */
const EN = {
  "q_rate": "Annual rate (TNA)",
  "q_note": "Estimate. Fees and taxes not included.",
  "q_open": "Open in the quote tool",
  "q_lbl_concept": "Concepts",
  "q_lbl_cheques": "Cheques",
  "q_lbl_contact": "Contact",
  "q_other_q": "Any other questions?",
  "q_other_a": "Message us on WhatsApp and we will reply the same day.",
  "q_other_go": "Message us on WhatsApp",
  "t_login": "Sign in",
  "t_signup": "Create account",
  "t_portal": "Client portal",
  "p1": "Client portal",
  "p2": "Your transactions, all in one place.",
  "p3": "Create your account with your company details. Once an advisor approves it, you can follow every transaction from your private portal without having to ask us.",
  "p4": "Access is enabled after you verify your email and BBX approves your request.",
  "p5": "Transactions",
  "p6": "Principal, interest, due dates and the status of each cheque.",
  "p7": "Account statement",
  "p8": "Movements, payments and invoices to download.",
  "p9": "Documents",
  "p10": "Upload what we ask for and track its review.",
  "p11": "Requests",
  "p12": "Request a cheque discount or a credit line and sign it online.",
  "t_priv": "Privacy policy",
  "t_tyc": "Terms and conditions",
  "t1": "Home",
  "t2": "About us",
  "t3": "Services",
  "t4": "Quote tool",
  "t5": "Why us",
  "t6": "Contact us",
  "t7": "Cheque purchase",
  "t8": "Post-dated cheque?",
  "t9": "<em>Cash today.</em>",
  "t10": "We buy your post-dated cheques so your company gets liquidity without waiting for the due date.",
  "t11": "Get a quote",
  "t12": "Learn more",
  "t13": "Your ECHEQs,",
  "t14": "<em>paid the same day.</em>",
  "t15": "Endorse it from your online banking and receive the transfer in your account, without leaving the office.",
  "t16": "Sell an ECHEQ",
  "t17": "How it works",
  "t18": "Clear quote",
  "t19": "Know what you get",
  "t20": "<em>before you endorse.</em>",
  "t21": "We send you the amount, rate, days and discount for your cheque in writing, so you can decide with all the information.",
  "t22": "Use the quote tool",
  "t23": "Why BBX",
  "t24": "Quote",
  "t25": "Same day",
  "t26": "Payment credited",
  "t27": "Cheques we handle",
  "t28": "Paper and ECHEQ",
  "t29": "Financial solutions for companies <em>on the move.</em>",
  "t30": "At BBX Soluciones Financieras S.A. we buy post-dated cheques and ECHEQs so companies and businesses get liquidity without waiting for the due date. We work quickly, transparently and one-on-one.",
  "t31": "See services",
  "t32": "Liquidity today for your post-dated cheques.",
  "t33": "We buy your post-dated cheque or ECHEQ and pay you today, with a detailed quote before we proceed.",
  "t34": "Drawer analysis",
  "t35": "Help with endorsement",
  "t36": "Transfer or cash",
  "t37": "Paper cheques",
  "t38": "Post-dated cheques from any bank. Endorse and get paid today, by transfer or in cash.",
  "t39": "Electronic cheques from any bank. Endorse them to us from your online banking and receive the transfer the same day.",
  "t40": "Amount, rate, days and discount in writing, after reviewing the cheque and the drawer.",
  "t41": "Quick answers",
  "t42": "What everyone asks <em>before selling a cheque.</em>",
  "t43": "Quote",
  "t44": "Simulate your cheque",
  "t45": "Simulation",
  "t46": "How much for a $500,000 cheque due in 30 days?",
  "t47": "And for $2,000,000 due in 90 days?",
  "t48": "Operate",
  "t49": "Cheques and ECHEQ",
  "t50": "Requirements",
  "t51": "What do I need to sell a cheque?",
  "t52": "How do I endorse an ECHEQ from my bank?",
  "t53": "Get paid",
  "t54": "Payment",
  "t55": "Timing",
  "t56": "How long until the payment is credited?",
  "t57": "Is the quote tool result an offer?",
  "t58": "What is <em>your cheque</em> worth today?",
  "t59": "Enter the amount, due date and rate, and instantly see an estimate of what you would get. We confirm the final quote after reviewing the cheque.",
  "t60": "Paper cheques and ECHEQ",
  "t61": "Quote confirmed the same day",
  "t62": "No hidden costs: we show you the discount",
  "t63": "How much do you get for your cheque?",
  "t64": "Cheque amount",
  "t65": "Due date",
  "t66": "Nominal annual rate · TNA (%)",
  "t67": "You get today",
  "t68": "Days to due date",
  "t69": "Discount",
  "t70": "Estimate using simple discount on the nominal annual rate (TNA, 365-day basis). The final rate depends on the drawer, the term and the type of cheque. Fees and taxes not included.",
  "t71": "Request a real quote",
  "t72": "Clear numbers <em>in every deal.</em>",
  "t73": "Every transaction starts with a written quote: amount, rate, days and discount. No fine print, with an advisor who knows your case from start to finish.",
  "t74": "Let's talk",
  "t75": "Transparency",
  "t76": "Same-day reply",
  "t77": "One-on-one service",
  "t78": "Long-term relationships",
  "t79": "The X in BBX is the <em>crossing</em> between the cheque you collect tomorrow and the cash your company needs today. We make it happen, quickly and with clear numbers.",
  "t80": "Sell your cheque in three steps",
  "t81": "Send the details",
  "t82": "Send us a photo of the cheque (front and back) or the ECHEQ details on WhatsApp: amount, payment date, bank and drawer.",
  "t83": "Get the quote",
  "t84": "We review the cheque and tell you the same day how much you get, with the rate and discount itemised.",
  "t85": "You endorse the cheque or ECHEQ and we transfer the money to your account, or you pick it up in cash.",
  "t86": "Hi, I want to sell this cheque. It is due in 60 days.",
  "t87": "Quote · Example",
  "t88": "Amount",
  "t89": "Monthly rate",
  "t90": "You get",
  "t91": "Great, let's go ahead!",
  "t92": "Transfer received",
  "t93": "$ 930.000 credited to your account",
  "t94": "Done, the payment is in your account. Thanks for choosing us!",
  "t95": "Example values, as in the quote tool.",
  "t96": "online",
  "t97": "FAQ",
  "t98": "Frequently asked questions",
  "t99": "Any other questions? Message us on WhatsApp and we will reply the same day.",
  "t100": "What does discounting a cheque mean?",
  "t101": "It means exchanging a post-dated cheque for money today. You receive the cheque amount minus a discount that depends on the rate and the days left until it is due.",
  "t102": "Which cheques do you buy?",
  "t103": "Post-dated paper cheques and ECHEQs from Argentine banks. Each transaction is assessed based on the drawer, the amount and the term.",
  "t104": "What do I need to operate?",
  "t105": "ID (DNI) and tax ID (CUIT/CUIL) of the holder or the company, the cheque or ECHEQ in your name or endorsed to you and, if you are paid by transfer, your CBU or alias. Companies also provide their bylaws and the signatory’s power of attorney.",
  "t106": "How long does it take?",
  "t107": "The quote comes the same day. Once the cheque is endorsed, payment is usually credited within 24 business hours.",
  "t108": "How do I endorse an ECHEQ?",
  "t109": "In your online banking, go to the ECHEQ section, choose the cheque, select Endorse and enter the CUIT we give you. We guide you step by step.",
  "t110": "No. It is an estimate that does not include fees or taxes. We confirm the final quote in writing after reviewing the cheque and the drawer.",
  "t111": "Let's talk about <em>your next cheque.</em>",
  "t112": "Fill in the form and an advisor will reply on WhatsApp with the quote.",
  "t113": "Monday to Friday, 10 am to 6 pm",
  "t114": "Name or company name",
  "t115": "Phone",
  "t116": "Reason for contact",
  "t117": "Sell a cheque",
  "t118": "Ask a question",
  "t119": "Message (optional)",
  "t120": "Send via WhatsApp",
  "t121": "Sending opens WhatsApp with your message ready to go.",
  "t122": "© <span id=\"year\">2026</span> BBX Soluciones Financieras S.A. All rights reserved.",
  "t123": "Legal notice",
  "t124": "This site is for information purposes only and does not constitute a public offering or financial, legal or tax advice. The rates, terms and values published, including the results of the quote tool, are for reference only, do not include fees or taxes and are not binding. Every transaction is subject to prior review of the cheque and the drawer, to acceptance by BBX Soluciones Financieras S.A. and to compliance with its internal policies. BBX Soluciones Financieras S.A. is not a financial institution covered by Law 21,526 and is not authorized or supervised by the BCRA (Central Bank of Argentina) or the CNV (National Securities Commission).",
  "t125": "Cheque transactions involve risks, including default or insolvency of the drawer, rejection or insufficient funds at maturity, formal or standing defects in the instrument and the liability that may fall on the endorser under applicable law. The values and conditions reported do not guarantee any result. Before operating, interested parties should assess their particular situation and, if necessary, consult their own advisors. This English version is provided for convenience only; in case of discrepancy, the Spanish version prevails.",
  "t126": "Previous",
  "t127": "Next",
  "t128": "Message us on WhatsApp",
  "t129": "Quote a paper cheque",
  "t130": "Ask about an ECHEQ",
  "t131": "Request a quote",
  "t132": "Due date, bank, drawer…",
  "langLabel": "Language: English"
};
const STR = {
  es: { formError: "Completá tu nombre y teléfono para que podamos responderte.", hello: "Hola BBX, quiero:", name: "Nombre", phone: "Teléfono", amount: "Importe", dueDate: "Fecha de cobro", langLabel: "Idioma: español" },
  en: { formError: "Please enter your name and phone so we can get back to you.", hello: "Hi BBX, I want to:", name: "Name", phone: "Phone", amount: "Amount", dueDate: "Due date", langLabel: EN.langLabel },
};
const i18nEls = $$("[data-i18n]").map((el) => ({ el, key: el.dataset.i18n, es: el.innerHTML }));
const i18nAttrs = $$("[data-i18n-attr]").flatMap((el) => el.dataset.i18nAttr.split(";").map((pair) => {
  const [attr, key] = pair.split(":");
  return { el, attr, key, es: el.getAttribute(attr) };
}));
let lang = root.lang === "en" ? "en" : "es";
const t = (k) => STR[lang][k];

function applyLang(next) {
  lang = next;
  root.lang = next;
  i18nEls.forEach(({ el, key, es }) => { el.innerHTML = next === "en" && EN[key] ? EN[key] : es; });
  i18nAttrs.forEach(({ el, attr, key, es }) => {
    if (key === "langLabel") return;
    el.setAttribute(attr, next === "en" && EN[key] ? EN[key] : es);
  });
  $("lang-current").textContent = next.toUpperCase();
  $("lang-btn").setAttribute("aria-label", t("langLabel"));
  $$(".lang-menu [data-lang]").forEach((b) => b.setAttribute("aria-current", String(b.dataset.lang === next)));
  wrapPhrase();
  if (!calm) requestFrame();
  $("year").textContent = new Date().getFullYear();
  try { localStorage.setItem("bbx-lang", next); } catch (e) {}
}


const langBtn = $("lang-btn");
const langMenu = $("lang-menu");
function toggleLangMenu(open) {
  langMenu.hidden = !open;
  langBtn.setAttribute("aria-expanded", String(open));
}
langBtn.addEventListener("click", (e) => { e.stopPropagation(); toggleLangMenu(langMenu.hidden); });
langMenu.addEventListener("click", (e) => {
  const b = e.target.closest("[data-lang]");
  if (!b) return;
  applyLang(b.dataset.lang);
  toggleLangMenu(false);
  langBtn.focus();
});
document.addEventListener("click", (e) => { if (!e.target.closest(".lang")) toggleLangMenu(false); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !langMenu.hidden) { toggleLangMenu(false); langBtn.focus(); } });

/* =========================================================
   1) Apertura: primero el logo solo (las piezas se arman),
      después la pantalla se abre en diagonal y aparece la portada.
   ========================================================= */
let heroShown = false;
function showHero() {
  if (heroShown) return;
  heroShown = true;
  header.classList.add("is-in");
  waFloat.classList.add("is-in");
  hero.classList.add("is-revealed");
  countUp();
}

function openIntro() {
  if (!intro || intro.classList.contains("is-open")) return;
  intro.classList.add("is-open");
  setTimeout(showHero, 200);
  setTimeout(() => intro.remove(), 1400);
}

/* Contadores de la franja de datos */
function countUp() {
  $$("[data-count]", hero).forEach((el) => {
    const end = +el.dataset.count;
    if (calm) { el.textContent = end; return; }
    const start = performance.now() + 900, dur = 1600;
    el.textContent = "0";
    const step = (now) => {
      const t = clamp((now - start) / dur);
      el.textContent = Math.round(end * easeOut(t));
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

if (root.classList.contains("no-intro") || calm || !intro) {
  if (intro) intro.remove();
  requestAnimationFrame(showHero);
} else {
  const t = setTimeout(openIntro, 2700);
  // tocar la pantalla o una tecla saltea la apertura
  intro.addEventListener("click", () => { clearTimeout(t); openIntro(); });
  addEventListener("keydown", () => { clearTimeout(t); openIntro(); }, { once: true });
}

/* =========================================================
   3) Menú
   ========================================================= */
const navToggle = $("nav-toggle");
const nav = $("nav");
navToggle.addEventListener("click", () => {
  const open = nav.classList.toggle("is-open");
  navToggle.setAttribute("aria-expanded", String(open));
  header.classList.add("is-solid");
});
nav.addEventListener("click", (e) => {
  if (e.target.closest("a")) {
    nav.classList.remove("is-open");
    navToggle.setAttribute("aria-expanded", "false");
  }
});

// enlace activo según la sección visible
const navLinks = $$('.nav a[href^="#"]:not(.btn)');
const sections = navLinks.map((a) => document.querySelector(a.getAttribute("href"))).filter(Boolean);

/* =========================================================
   4) Apariciones al bajar
   ========================================================= */
$$("[data-stagger]").forEach((group) => {
  $$(":scope > .reveal", group).forEach((el, i) => el.style.setProperty("--d", `${i * 0.12}s`));
});

// Las imágenes empiezan recortadas (sin área visible), así que se observa su sección
const revealEls = $$(".reveal, .media-reveal");
const watchTarget = (el) => (el.classList.contains("media-reveal") ? el.parentElement : el);
if (calm || !("IntersectionObserver" in window)) {
  revealEls.forEach((el) => el.classList.add("is-visible"));
} else {
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      e.target._reveal.forEach((el) => el.classList.add("is-visible"));
      io.unobserve(e.target);
    });
  }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
  revealEls.forEach((el) => {
    const t = watchTarget(el);
    (t._reveal = t._reveal || []).push(el);
    io.observe(t);
  });
}

/* =========================================================
   5) Frase que se enciende palabra por palabra
   ========================================================= */
const phrase = document.querySelector("[data-words]");
let words = [];
function wrapPhrase() {
  if (!phrase) return;
  const wrapWords = (node) => [...node.childNodes].forEach((n) => {
    if (n.nodeType === 3) {
      const frag = document.createDocumentFragment();
      n.textContent.split(/(\s+)/).forEach((tok) => {
        if (!tok) return;
        if (/^\s+$/.test(tok)) frag.appendChild(document.createTextNode(tok));
        else {
          const s = document.createElement("span");
          s.className = "w";
          s.textContent = tok;
          frag.appendChild(s);
        }
      });
      n.replaceWith(frag);
    } else if (!n.classList || !n.classList.contains("w")) wrapWords(n);
  });
  wrapWords(phrase);
  words = $$(".w", phrase);
  if (calm) words.forEach((w) => w.classList.add("is-lit"));
}
wrapPhrase();

/* =========================================================
   6) Al bajar: encabezado sólido, parallax, palabras y sección activa
   ========================================================= */
const parallax = $$("[data-parallax]");
let ticking = false;
function onScroll() {
  ticking = false;
  const y = scrollY, H = innerHeight;
  header.classList.toggle("is-solid", y > 40 || nav.classList.contains("is-open"));
  // el botón de WhatsApp aparece cuando se deja atrás la portada
  waFloat.classList.toggle("is-hidden", y < hero.offsetHeight * 0.6);

  if (!calm) {
    parallax.forEach((img) => {
      const r = img.parentElement.getBoundingClientRect();
      if (r.bottom < -100 || r.top > H + 100) return;
      const off = (r.top + r.height / 2 - H / 2) * -(+img.dataset.parallax || 0);
      img.style.transform = `translate3d(0, ${off.toFixed(1)}px, 0)`;
    });
    if (words.length) {
      const r = phrase.getBoundingClientRect();
      const p = clamp((H * 0.85 - r.top) / (r.height + H * 0.35));
      const n = Math.round(p * words.length);
      words.forEach((w, i) => w.classList.toggle("is-lit", i < n));
    }
  }

  let current = sections[0];
  sections.forEach((s) => { if (s.getBoundingClientRect().top < H * 0.4) current = s; });
  navLinks.forEach((a) => a.classList.toggle("is-current", a.getAttribute("href") === "#" + current.id));
}
const requestFrame = () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } };
addEventListener("scroll", requestFrame, { passive: true });
addEventListener("resize", requestFrame);
onScroll();

/* =========================================================
   6b) Interacción: tarjetas con inclinación 3D, X flotantes,
       portada que sigue al mouse y demo de "Cómo funciona"
   ========================================================= */
const finePointer = matchMedia("(hover: hover) and (pointer: fine)").matches;

// Tarjetas: toda la tarjeta lleva al enlace de su flecha
$$(".xcard").forEach((card) => {
  const link = card.querySelector(".xcard__go");
  card.addEventListener("click", (e) => { if (!e.target.closest("a")) link.click(); });
  if (calm || !finePointer) return;
  const tilt = card.querySelector(".xcard__tilt");
  card.addEventListener("pointermove", (e) => {
    const r = card.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    card.classList.add("is-tilting");
    tilt.style.setProperty("--ry", `${((x - 0.5) * 12).toFixed(2)}deg`);
    tilt.style.setProperty("--rx", `${((0.5 - y) * 10).toFixed(2)}deg`);
    tilt.style.setProperty("--mx", `${(x * 100).toFixed(1)}%`);
    tilt.style.setProperty("--my", `${(y * 100).toFixed(1)}%`);
  });
  card.addEventListener("pointerleave", () => {
    card.classList.remove("is-tilting");
    tilt.style.setProperty("--rx", "0deg");
    tilt.style.setProperty("--ry", "0deg");
  });
});

// X flotantes y fondo de la portada: se mueven un poco con el mouse
if (!calm && finePointer) {
  const groups = $$(".floaters");
  const heroBgs = $$(".slide__bg", hero);
  let mx = 0, my = 0, pending = false;
  addEventListener("pointermove", (e) => {
    mx = e.clientX / innerWidth - 0.5;
    my = e.clientY / innerHeight - 0.5;
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      groups.forEach((g) => { g.style.setProperty("--px", mx.toFixed(3)); g.style.setProperty("--py", my.toFixed(3)); });
      if (scrollY < innerHeight) heroBgs.forEach((b) => { b.style.transform = `translate3d(${(-mx * 18).toFixed(1)}px, ${(-my * 12).toFixed(1)}px, 0)`; });
    });
  }, { passive: true });
}
// y con el scroll (cada una a su velocidad, según --d)
if (!calm) {
  const groups = $$(".floaters");
  const syncFloaters = () => groups.forEach((g) => {
    const r = g.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight) return;
    g.style.setProperty("--sy", ((r.top + r.height / 2 - innerHeight / 2) * 0.25).toFixed(1));
  });
  addEventListener("scroll", () => requestAnimationFrame(syncFloaters), { passive: true });
  syncFloaters();
}

// Demo "Cómo funciona": pasos que avanzan solos mientras se ven, o al tocarlos
(() => {
  const steps = $$(".demo__step");
  const screens = $$(".screen");
  if (!steps.length) return;
  const STEP_MS = 5200;
  let cur = 0, t0 = performance.now(), visible = false, hold = false;

  function show(i) {
    steps[cur].classList.remove("is-active");
    steps[cur].setAttribute("aria-selected", "false");
    steps[cur].style.setProperty("--p", 0);
    screens[cur]?.classList.remove("is-active");
    if (screens[cur]) screens[cur].hidden = true;
    cur = (i + steps.length) % steps.length;
    steps[cur].classList.add("is-active");
    steps[cur].setAttribute("aria-selected", "true");
    if (screens[cur]) {
      screens[cur].hidden = false;
      // reinicia las animaciones de la pantalla
      void screens[cur].offsetWidth;
      screens[cur].classList.add("is-active");
    }
    t0 = performance.now();
  }

  steps.forEach((s, i) => {
    s.addEventListener("click", () => { show(i); });
    s.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); show(cur + 1); steps[cur].focus(); }
      if (e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); show(cur - 1); steps[cur].focus(); }
    });
  });
  const demo = document.querySelector(".demo");
  demo.addEventListener("pointerenter", () => { hold = true; });
  demo.addEventListener("pointerleave", () => { hold = false; t0 = performance.now() - (+steps[cur].style.getPropertyValue("--p") || 0) * STEP_MS; });

  if (calm) return;
  if ("IntersectionObserver" in window) {
    new IntersectionObserver((es) => {
      visible = es[0].isIntersecting;
      if (visible) t0 = performance.now();
    }, { threshold: 0.4 }).observe(demo);
  }
  const tick = (now) => {
    if (visible && !hold && !document.hidden) {
      const p = clamp((now - t0) / STEP_MS);
      steps[cur].style.setProperty("--p", p.toFixed(4));
      if (p >= 1) show(cur + 1);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();

/* =========================================================
   7) Cotizador: los resultados cuentan hasta el valor nuevo
   ========================================================= */
const montoInput = $("cot-monto");
const fechaInput = $("cot-fecha");
const tasaInput = $("cot-tasa");
const outs = {
  neto: { el: $("out-neto"), fmt: (v) => fmtMoney.format(v), value: 0 },
  dias: { el: $("out-dias"), fmt: (v) => fmtInt.format(v), value: 0 },
  desc: { el: $("out-desc"), fmt: (v) => fmtMoney.format(v), value: 0 },
};

function parseMoney(str) {
  const digits = String(str).replace(/[^\d]/g, "");
  return digits ? parseInt(digits, 10) : 0;
}
function isoDate(d) {
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d - tz).toISOString().slice(0, 10);
}
function daysUntil(value) {
  if (!value) return 0;
  const [y, m, d] = value.split("-").map(Number);
  const target = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((target - today) / 86400000));
}

const today = new Date();
fechaInput.min = isoDate(today);
const defaultDate = new Date(today);
defaultDate.setDate(defaultDate.getDate() + 60);
fechaInput.value = isoDate(defaultDate);

function tweenTo(out, to, { from = out.value, duration = 600, delay = 0 } = {}) {
  cancelAnimationFrame(out.raf);
  clearTimeout(out.timer);
  out.value = to;
  if (calm || duration === 0) { out.el.textContent = out.fmt(to); return; }
  out.el.textContent = out.fmt(from);
  out.timer = setTimeout(() => {
    const t0 = performance.now();
    const step = (now) => {
      const t = clamp((now - t0) / duration);
      out.el.textContent = out.fmt(Math.round(from + (to - from) * easeOut(t)));
      if (t < 1) out.raf = requestAnimationFrame(step);
    };
    out.raf = requestAnimationFrame(step);
  }, delay);
}

function resultado() {
  const monto = parseMoney(montoInput.value);
  const dias = daysUntil(fechaInput.value);
  const tasa = Math.max(0, parseFloat(tasaInput.value) || 0) / 100;
  // Descuento simple sobre la tasa nominal anual: importe × TNA × (días / 365)
  const descuento = Math.min(monto, monto * tasa * (dias / 365));
  return { monto, dias, descuento, neto: monto - descuento };
}

function calcular(opts) {
  const r = resultado();
  tweenTo(outs.neto, Math.round(r.neto), opts);
  tweenTo(outs.dias, r.dias, opts);
  tweenTo(outs.desc, Math.round(r.descuento), opts);
}

montoInput.addEventListener("input", () => {
  const n = parseMoney(montoInput.value);
  montoInput.value = n ? fmtInt.format(n) : "";
  calcular();
});
fechaInput.addEventListener("input", () => calcular());
tasaInput.addEventListener("input", () => calcular());


// Los resultados cuentan desde cero cuando el cotizador aparece en pantalla
calcular({ duration: 0 });
const chequeCard = document.querySelector(".cheque");
if (!calm && "IntersectionObserver" in window) {
  const seen = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) {
      calcular({ from: 0, duration: 1400, delay: 500 });
      seen.disconnect();
    }
  }, { threshold: 0.35 });
  seen.observe(chequeCard);
}

// "Pedir cotización real" pasa los datos del cotizador al formulario
$("cot-cta").addEventListener("click", () => {
  const r = resultado();
  $("c-servicio").value = "Vender un cheque";
  if (r.monto) $("c-importe").value = "$ " + fmtInt.format(r.monto);
  if (fechaInput.value) {
    const [y, m, d] = fechaInput.value.split("-");
    if (!$("c-mensaje").value) $("c-mensaje").value = `${t("dueDate")}: ${d}/${m}/${y}`;
  }
});

/* =========================================================
   8) Formulario de contacto → WhatsApp
   ========================================================= */
$$("[data-servicio]").forEach((link) => {
  link.addEventListener("click", () => { $("c-servicio").value = link.dataset.servicio; });
});

const form = $("contact-form");
const errorBox = $("form-error");
const importeInput = $("c-importe");

importeInput.addEventListener("input", () => {
  const n = parseMoney(importeInput.value);
  importeInput.value = n ? "$ " + fmtInt.format(n) : "";
});

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const nombre = $("c-nombre").value.trim();
  const tel = $("c-tel").value.trim();

  if (!nombre || !tel) {
    errorBox.textContent = t("formError");
    errorBox.hidden = false;
    (!nombre ? $("c-nombre") : $("c-tel")).focus();
    return;
  }
  errorBox.hidden = true;

  const lineas = [
    `${t("hello")} ${$("c-servicio").selectedOptions[0].textContent}.`,
    `${t("name")}: ${nombre}`,
    `${t("phone")}: ${tel}`,
  ];
  if (importeInput.value) lineas.push(`${t("amount")}: ${importeInput.value}`);
  const msg = $("c-mensaje").value.trim();
  if (msg) lineas.push(msg);

  const url = `https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent(lineas.join("\n"))}`;
  const win = window.open(url, "_blank");
  if (win) win.opener = null;
  else window.location.href = url;
});

/* =========================================================
   9) Respuestas rápidas: cada pregunta se abre debajo de su tarjeta
   ========================================================= */
function flash(el) {
  el.classList.remove("is-flash");
  void el.offsetWidth;
  el.classList.add("is-flash");
}
// Cada pregunta se abre debajo de su tarjeta; al abrir una se cierra la anterior
function simValues(sim) {
  const [monto, dias] = sim.split(",").map(Number);
  const tasa = Math.max(0, parseFloat(tasaInput.value) || 0) / 100;
  const descuento = Math.min(monto, monto * tasa * (dias / 365));   // TNA, base 365
  return { monto, dias, tasa, descuento, neto: monto - descuento };
}
function fillSim(panel) {
  const box = panel.querySelector(".qsim");
  if (!box) return;
  const v = simValues(box.dataset.sim);
  const pct = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 }).format(v.tasa * 100);
  box.querySelector(".qsim__tasa").textContent = `${pct} %`;
  const neto = { el: box.querySelector(".qsim__neto"), fmt: (x) => fmtMoney.format(x), value: 0 };
  const desc = { el: box.querySelector(".qsim__desc"), fmt: (x) => fmtMoney.format(x), value: 0 };
  tweenTo(neto, Math.round(v.neto), { from: 0, duration: 900, delay: 150 });
  tweenTo(desc, Math.round(v.descuento), { from: 0, duration: 900, delay: 150 });
}
const qitems = $$(".qitem");
function setOpen(it, open) {
  it.classList.toggle("is-open", open);
  it.querySelector(".qcard").setAttribute("aria-expanded", String(open));
  if (open) fillSim(it);
}
qitems.forEach((it) => {
  it.querySelector(".qcard").addEventListener("click", () => {
    const open = !it.classList.contains("is-open");
    qitems.forEach((o) => { if (o !== it && o.classList.contains("is-open")) setOpen(o, false); });
    setOpen(it, open);
  });
});
// "Abrir en el cotizador" pasa el importe y el plazo de la simulación
$$(".qsim__go").forEach((btn) => btn.addEventListener("click", () => {
  const v = simValues(btn.closest(".qpanel").querySelector(".qsim").dataset.sim);
  montoInput.value = fmtInt.format(v.monto);
  const d = new Date();
  d.setDate(d.getDate() + v.dias);
  fechaInput.value = isoDate(d);
  $("cotizador").scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "start" });
  setTimeout(() => { calcular({ duration: 900 }); flash(chequeCard); }, calm ? 0 : 700);
}));

$("year").textContent = new Date().getFullYear();
if (lang === "en") applyLang("en");
