# Pruebas

## 1. Base de datos: seguridad y reglas de negocio (SQL)

Corre sobre un PostgreSQL 15+ local, con un *stub* que reproduce lo mínimo de Supabase
(roles `anon`/`authenticated`/`service_role`, `auth.users`, `auth.uid()`, `storage.objects`).

```bash
PGHOST=127.0.0.1 PGPORT=54322 PGUSER=postgres supabase/tests/run_local.sh
```

Crea la base `bbx_test`, aplica `supabase/tests/00_stub_supabase.sql`, las migraciones y el seed, y
ejecuta `supabase/tests/10_seguridad.sql` (aislamiento entre clientes, roles, facturas, firmas,
inmutabilidad, cálculos, cobranzas, auditoría…). Si una aserción falla, el script se detiene con el
mensaje del caso.

## 2. Punta a punta (Playwright)

`tests/e2e/mock-supabase.mjs` es un servidor **sólo para pruebas** que imita la API de Supabase
(REST, Auth, Storage y Functions) sobre el Postgres local. Cada request se ejecuta con el rol
`authenticated` y el JWT del usuario, así que se aplican las políticas RLS reales.

```bash
cd tests/e2e && npm install
```

```bash
PGHOST=127.0.0.1 PGPORT=54322 PGUSER=postgres ./preparar-db.sh
```

```bash
node e2e.mjs
```

Recorre: sitio público, registro de un cliente, pantalla de "en revisión", login del
administrador, dashboard, aprobación de la solicitud, ficha completa, alta de cliente (con CUIT
inválido rechazado), operación de descuento con 2 cheques → aprobación → liquidación →
acreditación, cobranza, contabilidad y devengamiento, factura en borrador (sin CAE sin ARCA),
reportes, usuarios, configuración, auditoría, vista celular, portal del cliente, carga de
documento, formulario completado y firmado, solicitud de descuento, PDFs y bloqueo de `/admin/`
para clientes. Falla ante cualquier error de JavaScript. Las capturas quedan en
`tests/e2e/capturas/`.
