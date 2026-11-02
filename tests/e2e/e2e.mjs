// Prueba de punta a punta de la plataforma con Playwright contra el mock de Supabase.
// Requiere un Postgres local con el stub, las migraciones y el seed (ver README de tests).
//   PGURL=postgres://postgres@127.0.0.1:54322/bbx_e2e node e2e.mjs
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { createRequire } from "node:module";
import { servidor, ANON_KEY, crearUsuarioPrueba, log as logMock } from "./mock-supabase.mjs";

// Playwright viene preinstalado globalmente (o con: npm i -D playwright)
const { chromium } = createRequire(import.meta.url)("playwright");
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SALIDA = process.env.CAPTURAS || path.join(RAIZ, "tests/e2e/capturas");
fs.mkdirSync(SALIDA, { recursive: true });
const db = new pg.Pool({ connectionString: process.env.PGURL || "postgres://postgres@127.0.0.1:54322/bbx_e2e" });
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".png": "image/png", ".json": "application/json" };

// Servidor estático del sitio (con la configuración apuntando al mock)
const web = http.createServer((req, res) => {
  const u = new URL(req.url, "http://localhost");
  if (u.pathname === "/app/config.js") {
    res.writeHead(200, { "Content-Type": "text/javascript" });
    return res.end(`window.BBX_CONFIG = { supabaseUrl: "http://localhost:54321", supabaseAnonKey: "${ANON_KEY}" };`);
  }
  let f = path.join(RAIZ, decodeURIComponent(u.pathname));
  if (f.endsWith("/")) f += "index.html";
  if (!f.startsWith(RAIZ) || !fs.existsSync(f)) { res.writeHead(404); return res.end("404"); }
  res.writeHead(200, { "Content-Type": MIME[path.extname(f)] ?? "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});

const errores = [];
let pagina = null;
let paso = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
async function captura(page, nombre) { await page.screenshot({ path: path.join(SALIDA, `${String(++paso).padStart(2, "0")}-${nombre}.png`), fullPage: false }); }
async function esperarVista(page) {
  await page.waitForFunction(() => !document.querySelector("#contenido .skeleton"), null, { timeout: 15000 });
  await page.waitForTimeout(250);
}
async function elegir(page, sel, texto) {
  await page.waitForSelector(sel);
  await page.waitForFunction(({ sel, texto }) => [...document.querySelector(sel).options].some((o) => o.textContent.includes(texto)), { sel, texto });
  const v = await page.$eval(sel, (el, t) => [...el.options].find((o) => o.textContent.includes(t))?.value, texto);
  if (v === undefined) throw new Error(`No hay opción "${texto}" en ${sel}`);
  await page.selectOption(sel, v);
}
async function descargar(page, selector, nombre) {
  const [d] = await Promise.all([page.waitForEvent("download", { timeout: 15000 }), page.click(selector)]);
  const destino = path.join(SALIDA, nombre);
  await d.saveAs(destino);
  const cab = fs.readFileSync(destino).subarray(0, 5).toString();
  if (cab !== "%PDF-") throw new Error(`${nombre} no es un PDF válido`);
  ok(`PDF descargado: ${d.suggestedFilename()}`);
}
async function ir(page, hash, nombre) {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await esperarVista(page);
  const err = await page.$(".callout--danger b");
  if (err && /No se pudo cargar/.test(await err.textContent())) throw new Error(`La vista ${hash} no cargó: ${await page.textContent(".callout--danger")}`);
  if (nombre) await captura(page, nombre);
  ok(`vista ${hash}`);
}

async function main() {
  await new Promise((r) => servidor.listen(54321, r));
  await new Promise((r) => web.listen(8000, r));

  // Usuarios de prueba
  await db.query(`insert into auth.users (email, raw_app_meta_data, raw_user_meta_data, email_confirmed_at) values
    ('admin@bbx.test', '{"bbx_rol":"superadmin"}', '{"nombre":"Ana","apellido":"Administradora"}', now()) on conflict do nothing`);
  crearUsuarioPrueba("admin@bbx.test", "Prueba12345");

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  pagina = page;
  page.on("pageerror", (e) => errores.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/WebSocket|realtime|ERR_CONNECTION_REFUSED|status of 4\d\d|status of 50\d/.test(m.text())) errores.push(`console: ${m.text()}`); });
  page.on("dialog", (d) => d.accept());

  console.log("Sitio público");
  await page.goto("http://localhost:8000/");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1200);
  await captura(page, "sitio-publico");
  if (!(await page.isVisible('a[href="/acceso/"]'))) throw new Error("Falta el botón Iniciar sesión en el sitio");
  ok("botones Iniciar sesión / Crear cuenta");

  console.log("Registro de cliente");
  await page.goto("http://localhost:8000/acceso/registro.html");
  await captura(page, "registro");
  await page.fill('[name="nombre"]', "Lucía");
  await page.fill('[name="apellido"]', "Prueba");
  await page.fill('[name="razon_social"]', "DEMO Ferretería del Sur S.R.L.");
  await page.fill('[name="cuit"]', "33999990059");
  await page.fill('[name="telefono"]', "+54 11 0000-9999");
  await page.fill('[name="email"]', "lucia@cliente.test");
  await page.fill('[name="password"]', "Cliente12345");
  await page.fill('[name="password2"]', "Cliente12345");
  await page.check('[name="acepto"]');
  await page.click("#f-registro button.btn");
  await page.waitForSelector(".callout--ok", { timeout: 10000 });
  await captura(page, "registro-ok");
  ok("solicitud enviada");
  await db.query("update auth.users set email_confirmed_at = now() where email = 'lucia@cliente.test'");

  // Un cliente pendiente que intenta entrar ve la pantalla de "en revisión"
  await page.goto("http://localhost:8000/acceso/");
  await page.fill('[name="email"]', "lucia@cliente.test");
  await page.fill('[name="password"]', "Cliente12345");
  await page.click("#f-login button.btn");
  await page.waitForSelector("text=Tu solicitud está en revisión", { timeout: 10000 });
  await captura(page, "cliente-pendiente");
  ok("cliente pendiente no accede al portal");
  await page.click("#salir");
  await page.waitForURL(/acceso/);

  console.log("Panel administrativo");
  await page.goto("http://localhost:8000/acceso/");
  await captura(page, "login");
  await page.fill('[name="email"]', "admin@bbx.test");
  await page.fill('[name="password"]', "malaclave");
  await page.click("#f-login button.btn");
  await page.waitForSelector("[data-error]:not([hidden])");
  ok("contraseña incorrecta rechazada");
  await page.fill('[name="password"]', "Prueba12345");
  await page.click("#f-login button.btn");
  await page.waitForURL(/\/admin\//);
  await esperarVista(page);
  await page.waitForSelector("#ch-capital svg");
  await captura(page, "dashboard");
  ok("dashboard");

  // Aprobar la solicitud
  await ir(page, "#/solicitudes", "solicitudes");
  await page.click("[data-aprobar]");
  await page.click("[data-ok]");
  await page.waitForURL(/#\/clientes\//);
  await esperarVista(page);
  await captura(page, "cliente-aprobado");
  ok("solicitud aprobada → cliente creado");
  for (const t of ["operaciones", "cuenta", "documentos", "formularios", "notas", "usuarios", "datos"]) {
    await page.click(`[data-tab="${t}"]`);
    await page.waitForFunction(() => !document.querySelector("#panel .skeleton"));
  }
  ok("ficha del cliente: todas las pestañas");

  // Asignar un formulario al nuevo cliente
  await page.click('[data-tab="formularios"]');
  await page.waitForSelector("#asignar");
  await page.click("#asignar");
  await page.selectOption('#f-asig [name="plantilla_id"]', { label: "Formulario de alta de cliente" });
  await page.click('button[form="f-asig"]');
  await page.waitForSelector(".toast");
  ok("formulario asignado");

  await ir(page, "#/clientes", "clientes");
  await page.click("#nuevo");
  await page.fill('#f-cliente [name="razon_social"]', "DEMO Transporte Andino S.A.");
  await page.fill('#f-cliente [name="cuit"]', "30999990010");
  await page.click('button[form="f-cliente"]');
  await page.waitForSelector("#f-cliente [data-error]:not([hidden])");
  ok("CUIT inválido rechazado en el alta");
  await page.fill('#f-cliente [name="cuit"]', "20999990011");
  await page.fill('#f-cliente [name="ct_nombre"]', "Raúl");
  await page.fill('#f-cliente [name="ct_apellido"]', "Andino");
  await page.click('button[form="f-cliente"]');
  await page.waitForURL(/#\/clientes\/[0-9a-f-]{36}/);
  await esperarVista(page);
  ok("cliente creado desde el panel");

  // Nueva operación de descuento de cheques
  await ir(page, "#/operaciones", "operaciones");
  await ir(page, "#/operaciones/nueva");
  await elegir(page, '#f-op [name="cliente_id"]', "DEMO Ferretería del Sur");
  await page.selectOption('#f-op [name="tipo_codigo"]', "descuento_cheques");
  const filas = page.locator("#cheques tr");
  await filas.nth(0).locator('[data-k="numero"]').fill("77700001");
  await filas.nth(0).locator('[data-k="banco"]').fill("Banco DEMO");
  await filas.nth(0).locator('[data-k="librador_cuit"]').fill("30999990068");
  await filas.nth(0).locator('[data-k="librador_nombre"]').fill("DEMO Supermercados Centrales S.A.");
  await filas.nth(0).locator('[data-k="monto"]').fill("1500000");
  await page.click("#add-ch");
  await filas.nth(1).locator('[data-k="numero"]').fill("77700002");
  await filas.nth(1).locator('[data-k="banco"]').fill("Banco DEMO");
  await filas.nth(1).locator('[data-k="monto"]').fill("900000");
  await page.fill('#f-op [name="comisiones"]', "10000");
  await page.click("#iva21");
  await captura(page, "operacion-nueva");
  await page.click("#guardar");
  await page.waitForURL(/#\/operaciones\/[0-9a-f-]{36}/);
  await esperarVista(page);
  ok("operación creada con 2 cheques");
  await page.click('[data-estado="aprobada"]');
  await page.click(".modal [data-ok]");
  await esperarVista(page);
  await page.click('[data-estado="activa"]');
  await page.click('button[form="f-liq"]');
  await esperarVista(page);
  await captura(page, "operacion-liquidada");
  if (!(await page.textContent(".detail-head")).includes("Activa")) throw new Error("La operación no quedó activa");
  ok("operación aprobada y liquidada");
  await descargar(page, "#pdf", "liquidacion.pdf");
  await page.selectOption("[data-cheque] >> nth=0", "acreditado");
  await page.click(".modal [data-ok]");
  await esperarVista(page);
  for (const t of ["cobranzas", "intereses", "movimientos", "historial", "documentos", "notas"]) {
    await page.click(`[data-tab="${t}"]`);
    await page.waitForFunction(() => !document.querySelector("#panel .skeleton"));
  }
  await page.click('[data-tab="intereses"]');
  await page.waitForTimeout(300);
  await captura(page, "operacion-intereses");
  ok("cheque acreditado y pestañas de la operación");

  // Cobranza sobre un préstamo DEMO activo
  const prest = (await db.query("select id from operaciones where tipo_codigo = 'prestamo' and estado = 'activa' order by created_at limit 1")).rows[0].id;
  await ir(page, "#/operaciones/" + prest);
  await page.click("#cobrar");
  await page.fill('#f-cob [name="imputado_intereses"]', "50000");
  await page.click('button[form="f-cob"]');
  await page.waitForSelector(".toast--ok");
  await esperarVista(page);
  ok("cobranza registrada");

  await ir(page, "#/documentacion", "documentacion");
  await ir(page, "#/formularios", "formularios");
  await ir(page, "#/contabilidad", "contabilidad");
  for (const t of ["cobrar", "intereses", "cobranzas"]) { await page.click(`[data-tab="${t}"]`); await page.waitForTimeout(400); }
  await page.click('[data-tab="intereses"]');
  await page.waitForSelector("#f-dev");
  await page.click("#f-dev button");
  await page.waitForSelector(".toast");
  await captura(page, "contabilidad-intereses");
  ok("devengamiento de intereses");
  await page.click("#nuevo");
  await page.fill('#f-mc [name="concepto"]', "DEMO · Papelería");
  await page.fill('#f-mc [name="importe"]', "12500");
  await page.click('button[form="f-mc"]');
  await page.waitForSelector(".toast--ok");
  ok("gasto registrado");

  // Facturación: borrador + ítem + intento de emisión sin certificado
  await ir(page, "#/facturacion", "facturacion");
  await page.click("#nueva");
  await elegir(page, '#f-fac [name="cliente_id"]', "DEMO Metalúrgica Andina");
  await page.waitForTimeout(500);
  await page.click('button[form="f-fac"]');
  await page.waitForURL(/#\/facturacion\/[0-9a-f-]{36}/);
  await esperarVista(page);
  await page.fill('#f-item [name="descripcion"]', "Comisión por gestión (DEMO)");
  await page.fill('#f-item [name="precio_unitario"]', "25000");
  await page.click("#f-item button");
  await esperarVista(page);
  await page.waitForSelector("#emitir");
  await captura(page, "factura-borrador");
  await descargar(page, "#pdf", "factura-vista-previa.pdf");
  await page.click("#emitir");
  await page.click(".modal [data-ok]");
  await page.waitForSelector(".toast--error", { timeout: 10000 });
  await esperarVista(page);
  const estadoF = (await db.query("select estado, cae from facturas where importe_total = 30250 order by created_at desc limit 1")).rows[0];
  if (estadoF.cae) throw new Error("Una factura obtuvo CAE sin ARCA");
  ok(`sin certificado no hay CAE (estado: ${estadoF.estado})`);

  await ir(page, "#/reportes", "reportes");
  await ir(page, "#/usuarios", "usuarios");
  await page.click('[data-tab="permisos"]'); await page.waitForTimeout(400);
  await ir(page, "#/configuracion", "configuracion");
  for (const t of ["arca", "tipos", "plantillas", "documentos"]) { await page.click(`[data-tab="${t}"]`); await page.waitForTimeout(400); }
  await page.click('[data-tab="arca"]'); await page.waitForSelector("#probar"); await page.click("#probar"); await page.waitForSelector("#res .callout");
  await captura(page, "configuracion-arca");
  ok("configuración ARCA y prueba de conexión");
  await ir(page, "#/auditoria", "auditoria");
  await page.click('[data-tab="actividad"]'); await page.waitForTimeout(400);

  // Vista celular del panel
  await page.setViewportSize({ width: 390, height: 844 });
  await ir(page, "#/dashboard", "dashboard-celular");
  await page.click("#btn-menu"); await page.waitForTimeout(400);
  await captura(page, "menu-celular");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.keyboard.press("Escape");
  await page.click("#btn-salir");
  await page.waitForURL(/acceso/);
  ok("cierre de sesión");

  console.log("Portal del cliente");
  await page.fill('[name="email"]', "lucia@cliente.test");
  await page.fill('[name="password"]', "Cliente12345");
  await page.click("#f-login button.btn");
  await page.waitForURL(/\/portal\//);
  await esperarVista(page);
  await captura(page, "portal-cuenta");
  ok("portal: mi cuenta");
  await ir(page, "#/operaciones", "portal-operaciones");
  await page.click("table tbody tr >> nth=0");
  await esperarVista(page);
  await captura(page, "portal-operacion");
  await ir(page, "#/estado-cuenta", "portal-estado-cuenta");
  await descargar(page, "#pdf", "estado-de-cuenta.pdf");
  for (const t of ["pagos", "intereses", "facturas"]) { await page.click(`[data-tab="${t}"]`); await page.waitForTimeout(200); }
  await ir(page, "#/documentacion", "portal-documentacion");
  // Subir documento pedido
  await page.click("[data-cumplir] >> nth=0");
  const pdf = path.join(SALIDA, "prueba.pdf");
  fs.writeFileSync(pdf, "%PDF-1.4\n%prueba DEMO\n");
  await page.setInputFiles('#f-doc input[type="file"]', pdf);
  await page.click('button[form="f-doc"]');
  await page.waitForSelector(".toast--ok", { timeout: 10000 });
  await esperarVista(page);
  ok("documento subido por el cliente");
  // Formularios: completar el asignado y firmar
  await ir(page, "#/formularios", "portal-formularios");
  await page.click("[data-completar] >> nth=0");
  await page.fill('#f-form [name="actividad"]', "Ferretería");
  await page.fill('#f-form [name="antiguedad"]', "12");
  await page.fill('#f-form [name="facturacion_anual"]', "150000000");
  await page.fill('#f-form [name="bancos"]', "Banco DEMO");
  await page.fill('#f-form [name="origen_fondos"]', "Actividad comercial");
  await page.click('button[form="f-form"]');
  await page.waitForSelector("#f-firma");
  await page.fill('#f-firma [name="dni"]', "30111222");
  await page.check('#f-firma [name="acepto"]');
  await captura(page, "portal-firma");
  await page.click('button[form="f-firma"]');
  await page.waitForSelector(".toast--ok");
  ok("formulario completado y firmado");
  // Solicitud de descuento iniciada por el cliente
  await esperarVista(page);
  await page.locator("[data-iniciar]", { hasText: "descuento de cheques" }).evaluate((b) => b.click());
  await page.selectOption('#f-form [name="tipo_cheque"]', "ECHEQ");
  await page.fill('#f-form [name="cantidad"]', "3");
  await page.fill('#f-form [name="monto_total"]', "4500000");
  await page.fill('#f-form [name="fecha_pago"]', "2027-03-15");
  await page.fill('#f-form [name="librador"]', "DEMO Librador S.A.");
  await page.fill('#f-form [name="cbu"]', "demo.alias.cbu");
  await page.click('button[form="f-form"]');
  await page.waitForSelector("#f-firma");
  await page.fill('#f-firma [name="dni"]', "30111222");
  await page.check('#f-firma [name="acepto"]');
  await page.click('button[form="f-firma"]');
  await page.waitForSelector(".toast--ok");
  await esperarVista(page);
  await captura(page, "portal-formularios-firmados");
  ok("solicitud de descuento enviada y firmada");

  // El cliente no puede entrar al panel
  await page.goto("http://localhost:8000/admin/");
  await page.waitForURL(/\/portal\//);
  ok("un cliente que abre /admin/ vuelve al portal");

  await page.setViewportSize({ width: 390, height: 844 });
  await ir(page, "#/cuenta", "portal-celular");

  // Verificaciones de datos en la base
  const firmas = (await db.query("select count(*)::int n from firmas f join perfiles p on p.id = f.firmante_id where p.email = 'lucia@cliente.test'")).rows[0].n;
  if (firmas !== 2) throw new Error("Se esperaban 2 firmas del cliente, hay " + firmas);
  const notif = (await db.query("select count(*)::int n from notificaciones n join perfiles p on p.id = n.destinatario_id where p.email = 'admin@bbx.test'")).rows[0].n;
  if (!notif) throw new Error("El administrador no recibió notificaciones");
  ok(`firmas registradas (${firmas}) y notificaciones al administrador (${notif})`);

  await browser.close();
  servidor.close(); web.close(); await db.end();

  const erroresMock = logMock.filter((l) => !/No autorizado|permission denied|row-level|ARCA/i.test(l.error));
  if (errores.length || erroresMock.length) {
    console.log("\nErrores:\n" + [...errores, ...erroresMock.map((l) => `api ${l.url}: ${l.error}`)].join("\n"));
    process.exit(1);
  }
  console.log(`\nOK — capturas en ${SALIDA}`);
}

main().catch(async (e) => {
  console.error("\nFALLÓ:", e.message);
  if (pagina) { await pagina.screenshot({ path: path.join(SALIDA, "ERROR.png") }).catch(() => {}); console.error("URL:", pagina.url()); }
  if (errores.length) console.error(errores.join("\n"));
  if (logMock.length) console.error(logMock.slice(-8).map((l) => `api ${l.url}: ${l.error}`).join("\n"));
  process.exit(1);
});
