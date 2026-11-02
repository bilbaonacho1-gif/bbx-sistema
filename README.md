# BBX Soluciones Financieras S.A. — Plataforma integral

Ecosistema digital de BBX: el **sitio web público**, un **panel administrativo interno** y un
**portal privado para clientes**, conectados a una base de datos real en **Supabase**
(PostgreSQL + Auth + Storage + Row Level Security) y publicados en **Vercel**.

| Área | Ruta | Quién entra |
|---|---|---|
| Sitio público | `/` | Cualquiera. Botones **Iniciar sesión** y **Crear cuenta** |
| Acceso | `/acceso/` · `/acceso/registro.html` · `/acceso/recuperar.html` | Login, registro de clientes, recuperación de contraseña |
| Panel administrativo | `/admin/` | Personal de BBX, según su rol |
| Portal de clientes | `/portal/` | Clientes aprobados, sólo con sus propios datos |

## Qué incluye

**Panel administrativo**
- **Dashboard**: clientes, operaciones activas y pendientes, capital operado, intereses cobrados y
  devengados (por separado), facturación, saldo a cobrar, vencimientos, actividad y gráficos.
- **Clientes**: alta y edición con validación de CUIT, ficha individual con datos fiscales y de
  empresa, contactos, operaciones, estado de cuenta, documentación presentada y pendiente,
  formularios, notas internas (nunca visibles para el cliente) y accesos al portal.
- **Solicitudes**: los registros de la web quedan pendientes; se aprueban (creando o vinculando el
  cliente) o se rechazan con motivo. Se exige email verificado.
- **Operaciones**: descuento de cheques (con cheques y libradores), acuerdos en cuenta corriente,
  préstamos y tipos configurables. Simulación en vivo, estados con historial, liquidación,
  cobranzas con imputación, acreditación y rechazo de cheques, intereses **devengados** y
  **cobrados** registrados por separado, movimientos, documentos, notas, filtros y CSV.
- **Contabilidad**: libro de ingresos y egresos (con asientos automáticos), cuentas por cobrar con
  antigüedad, devengamiento de intereses, cobranzas y comprobantes adjuntos.
- **Facturación electrónica ARCA**: borradores, ítems con IVA, envío a **WSFEv1** desde una Edge
  Function con certificado propio, CAE, notas de crédito/débito y PDF con QR.
  **Una factura sólo es comprobante si ARCA le asignó CAE**: la base de datos impide marcarla como
  autorizada desde el navegador.
- **Documentación** y **formularios**: bandeja de revisión, pedidos al cliente, plantillas
  configurables y constancia de firma electrónica.
- **Reportes por período**, **usuarios y permisos por rol**, **configuración** y **auditoría**
  (quién cambió qué y cuándo, más el registro de actividad).

**Portal del cliente**: Mi cuenta, Mis operaciones, Estado de cuenta (movimientos, pagos, intereses
cobrados, saldos y facturas), Documentación (pendiente, presentada, descargas y carga de archivos) y
Formularios (solicitudes de descuento y de acuerdo, documentos para completar, firma electrónica e
historial).

## Estructura

```
index.html, css/, js/, img/   Sitio público existente (HTML/CSS/JS sin compilación)
acceso/                       Login, registro, recuperación y nueva contraseña
admin/  portal/               Páginas de entrada del panel y del portal
app/css/app.css               Sistema de diseño de la plataforma
app/js/                       Lógica del frontend (módulos ES, sin compilación)
  core.js                     Conexión a Supabase, sesión, protección de rutas, archivos
  shell.js                    Barra lateral, notificaciones en tiempo real y router
  ui.js charts.js pdf.js      Componentes, gráficos SVG y comprobantes PDF
  admin/  portal/             Pantallas de cada área
app/vendor/                   supabase-js, jsPDF y qrcode-generator (servidos desde el sitio)
app/config.js                 Configuración pública para desarrollo local
api/config.js                 Vercel Function: entrega SUPABASE_URL y la clave pública
supabase/migrations/          Esquema, funciones, RLS, Storage, plantillas y RPCs
supabase/seed.sql             Datos DEMO ficticios (opcional)
supabase/functions/           Edge Functions: arca-factura y gestionar-usuario
supabase/tests/               Pruebas de seguridad y negocio en SQL
tests/e2e/                    Prueba de punta a punta con Playwright
docs/                         Instalación, ARCA, arquitectura y seguridad
vercel.json                   Cabeceras de seguridad (CSP, HSTS, etc.)
```

## Puesta en marcha

Ver **[docs/INSTALACION.md](docs/INSTALACION.md)**. En resumen:

1. Crear un proyecto en Supabase y ejecutar las migraciones de `supabase/migrations/` (en orden).
2. Configurar Auth (confirmación de email y URLs de redirección).
3. En Vercel, cargar las variables `SUPABASE_URL` y `SUPABASE_ANON_KEY` y volver a desplegar.
4. Registrarse con **bbxsolucionesfinancieras@gmail.com** y verificar el email: esa cuenta pasa a
   ser el superadministrador inicial.
5. (Opcional) Cargar los datos DEMO con `supabase/seed.sql`.
6. Para facturar: desplegar las Edge Functions y cargar el certificado de ARCA
   ([docs/ARCA.md](docs/ARCA.md)).

## Seguridad en una línea

RLS en todas las tablas, `anon` sin acceso, cada cliente ve sólo lo suyo, permisos por rol,
documentos en buckets privados con URLs firmadas de 60 s, auditoría por triggers, campos fiscales
protegidos, cierre de sesión por inactividad y **ninguna clave secreta en el frontend**.
Detalle en [docs/SEGURIDAD.md](docs/SEGURIDAD.md).

## Pruebas

```bash
PGHOST=127.0.0.1 PGPORT=54322 PGUSER=postgres supabase/tests/run_local.sh
```

```bash
tests/e2e/preparar-db.sh && node tests/e2e/e2e.mjs
```

Ver [tests/README.md](tests/README.md).

## Datos DEMO

`supabase/seed.sql` carga clientes, operaciones y movimientos **ficticios**: todas las razones
sociales empiezan con "DEMO", los registros tienen `es_demo = true` y los CUIT usan el rango
inventado 99999xxx. No genera facturas autorizadas. Se borran con
`select public.borrar_datos_demo();` desde el editor SQL de Supabase.
