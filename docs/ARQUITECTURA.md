# Arquitectura técnica

## Vista general

```
 Navegador (HTML/CSS/JS, módulos ES sin compilación)
   ├─ /            sitio público (existente)
   ├─ /acceso/     login · registro · recuperación
   ├─ /admin/      panel interno  ─┐
   └─ /portal/     portal cliente ─┤  supabase-js (clave anon) + JWT del usuario
                                   ▼
 Supabase
   ├─ Auth (GoTrue)       email + contraseña, verificación, recuperación, sesiones
   ├─ PostgREST           tablas, vistas y RPCs  ──►  PostgreSQL + RLS
   ├─ Storage             buckets privados (documentos, plantillas, comprobantes)
   ├─ Realtime            notificaciones al instante
   └─ Edge Functions      arca-factura (WSAA/WSFEv1) · gestionar-usuario   (service_role)
                                   │
                                   ▼
                                 ARCA
 Vercel: hosting estático + api/config.js (entrega SUPABASE_URL y la clave pública)
```

**Principio:** el navegador nunca recibe secretos. Toda regla de seguridad vive en la base
(RLS, triggers y funciones) o en Edge Functions; el frontend sólo muestra u oculta botones.

## Modelo de datos (resumen)

| Grupo | Tablas |
|---|---|
| Usuarios y permisos | `perfiles` (1:1 con `auth.users`), `roles`, `permisos`, `rol_permisos`, `solicitudes_registro` |
| Clientes | `empresas` (entidad fiscal por CUIT: clientes y libradores), `clientes`, `contactos`, `notas_internas` |
| Operaciones | `tipos_operacion`, `operaciones`, `operacion_estados`, `cheques`, `acuerdos` |
| Finanzas | `pagos` (cobranzas con imputación), `movimientos` (cuenta corriente del cliente), `intereses` (devengados y cobrados), `movimientos_contables` |
| Facturación | `facturas`, `factura_items`, `arca_config`, `arca_tokens` (sin acceso API), `arca_log`, `condiciones_iva` |
| Documentación | `tipos_documento`, `documentos`, `documentos_requeridos` |
| Formularios | `plantillas_formulario`, `formularios`, `firmas` |
| Sistema | `notificaciones`, `registro_actividad`, `auditoria`, `configuracion` |

Vistas con `security_invoker` (respetan el RLS de quien consulta): `v_operaciones`, `v_clientes`,
`v_estado_cuenta`, `v_cuentas_por_cobrar`, `v_vencimientos`.

## Cálculo de operaciones

- Interés simple. Tasa mensual: `capital × tasa × días / (base/12)`; tasa anual:
  `capital × tasa × días / base` (base 365 o 360).
- **Descuento de cheques**: el capital es la suma de los cheques y el interés se calcula cheque por
  cheque según sus días; vence con el último cheque.
- Modalidad **descuento**: los intereses, gastos y comisiones se retienen al liquidar
  → `importe_liquidado = capital − intereses − gastos − comisiones − IVA`; se cobra el nominal.
- Modalidad **vencido**: se entrega el capital y se cobra
  `capital + intereses + gastos + comisiones + IVA` al vencimiento.
- Todo lo calcula el trigger `tg_operaciones_calcular`; tras la liquidación las condiciones quedan
  bloqueadas.

## Intereses devengados ≠ cobrados

| Concepto | Cómo se registra |
|---|---|
| **Devengado** | Proporcional al tiempo transcurrido. En tiempo real en `v_operaciones.intereses_devengados_hoy`; registros contables por período con `devengar_intereses(fecha)` (tabla `intereses`, tipo `devengado`). |
| **Cobrado** | Sólo cuando entra el dinero: al liquidar una operación de descuento (retenido por adelantado) o al registrar una cobranza imputada a intereses (tabla `intereses`, tipo `cobrado`). Las anulaciones generan reversiones. |

Los reportes muestran ambos y su diferencia (intereses cobrados por adelantado pendientes de devengar).

## Flujos principales

**Registro de cliente**
1. `/acceso/registro.html` → `auth.signUp` con nombre, razón social, CUIT y teléfono.
2. Trigger `tg_nuevo_usuario`: valida CUIT, crea `perfiles` (cliente, pendiente) y la
   `solicitudes_registro`, y notifica al personal con permiso `registros.aprobar`.
3. El cliente verifica su email. Mientras esté pendiente, el portal sólo muestra "en revisión" y el
   RLS no le devuelve datos.
4. En **Solicitudes**, `aprobar_solicitud()` crea o vincula `empresas`/`clientes`, pide la
   documentación obligatoria, activa el perfil y avisa al cliente.

**Operación**: borrador/pendiente → en análisis → aprobada (requiere `operaciones.aprobar`) →
liquidada/activa (movimientos, desembolso y, en descuento, intereses cobrados) → cobranzas o
acreditación de cheques → finalizada automáticamente al saldarse. Cada cambio queda en
`operacion_estados` con usuario y comentario.

**Factura**: borrador → Edge Function `arca-factura` → autorizada (CAE) o rechazada (errores de
ARCA). Ver [ARCA.md](ARCA.md).

**Documentos**: el archivo va a Storage en `{cliente_id}/{uuid}-{nombre}` y su registro a
`documentos`. El cliente sólo puede subir a su carpeta y siempre "en revisión"; al subir algo pedido,
el requerimiento pasa a "recibido" y al aprobarse a "cumplido". Descargas con URLs firmadas de 60 s.

**Firma**: `firmar_formulario()` guarda nombre, DNI, fecha, IP, navegador y el SHA-256 de lo
firmado (plantilla, versión, texto legal y datos). Es firma electrónica por aceptación (Ley 25.506,
art. 5), no firma digital certificada.

## Frontend

- Sin framework ni build: módulos ES nativos, para mantener la simplicidad del sitio existente y
  publicarlo tal cual en Vercel.
- `core.js` resuelve configuración, sesión, protección por área y archivos; `shell.js` el layout,
  el router por hash y las notificaciones (Realtime + respaldo cada 60 s).
- `ui.js`: plantillas con escape automático (`html\`\``), formatos es-AR, tablas con búsqueda,
  filtros, orden, paginación y CSV, modales y validaciones.
- Gráficos SVG propios; PDFs con jsPDF + QR, cargados sólo cuando se usan.
- Librerías servidas desde el propio sitio (`app/vendor/`), sin CDNs de terceros.

## Evolución sugerida

- Asientos de partida doble y plan de cuentas sobre `movimientos_contables`.
- Envío de emails transaccionales (Edge Function + proveedor SMTP) además de las notificaciones internas.
- Firma digital con certificado (por ejemplo, integrando un proveedor de firma) para contratos.
- Integración bancaria para conciliar acreditaciones de ECHEQ.
- Paginación del lado del servidor cuando las tablas superen algunos miles de registros.
