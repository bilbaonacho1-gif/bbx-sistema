# Seguridad

## Implementado

| Tema | Cómo |
|---|---|
| Autenticación | Supabase Auth con email y contraseña, flujo PKCE, contraseña de 10+ caracteres con mayúsculas, minúsculas y números. |
| Verificación de email | Obligatoria para aprobar un cliente (lo controla `aprobar_solicitud`). |
| Recuperación de contraseña | Enlace por email a `/acceso/nueva-clave.html`. El mensaje es el mismo exista o no la cuenta (no revela emails). |
| Aprobación administrativa | Todo registro queda pendiente; sin aprobación el RLS no devuelve ningún dato. |
| Roles y permisos | Tabla `rol_permisos`; las políticas usan `tiene_permiso()`. El rol se asigna sólo desde el servidor (`app_metadata`) o por la RPC con permiso `usuarios.gestionar`. Un usuario no puede cambiarse su propio rol, estado ni cliente (GRANT por columna + trigger). |
| RLS | Activado en todas las tablas. `anon` no tiene privilegios. Clientes: sólo filas de su `cliente_id`, sin borradores, sin notas internas, sin contabilidad, sin devengamientos ni facturas no autorizadas. |
| Escrituras sensibles | Movimientos, intereses, firmas, auditoría y solicitudes sólo se escriben desde triggers/RPCs. Movimientos e intereses son inmutables (se anulan con contraasientos). |
| Facturas | Sólo el backend puede marcar una factura como autorizada o escribir número/CAE. Facturas enviadas o autorizadas no se modifican ni borran. |
| Documentos | Buckets privados con límite de 15 MB y tipos permitidos. El cliente sólo sube a su carpeta y sólo descarga archivos registrados y visibles para él. URLs firmadas de 60 segundos. |
| Auditoría | Trigger genérico en las tablas de negocio: antes, después, diferencias, usuario, email, rol e IP. Sin políticas de modificación. |
| Registro de actividad | Login, logout, descargas y cambios de contraseña con IP y navegador. |
| Sesiones | Cierre automático tras 30 minutos sin actividad; rotación de refresh tokens; cierre de sesión al suspender un usuario (ban en Auth vía Edge Function). |
| Validación | En el navegador (HTML5, CUIT con dígito verificador, contraseñas) y nuevamente en la base (CHECKs, `cuit_valido`, `validar_datos_formulario`, RPCs). |
| XSS | Todo dato se inserta con plantillas que escapan HTML; CSP estricta sin scripts inline (salvo uno con hash). |
| Cabeceras | CSP, HSTS, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy, COOP (`vercel.json`). Las áreas privadas no se cachean ni se indexan. |
| Secretos | Ninguna clave privada en el repositorio ni en el frontend. `api/config.js` rechaza entregar una service_role por error. Certificado de ARCA como secreto de Edge Function. |
| CSV | Las exportaciones neutralizan fórmulas (`=`, `+`, `-`, `@`) para evitar inyección en Excel. |

## Pruebas automáticas

`supabase/tests/10_seguridad.sql` verifica, entre otras cosas:

- `anon` no puede leer tablas ni llamar RPCs.
- Un registro no puede autoasignarse un rol interno por `user_metadata`.
- Cliente pendiente: no ve nada. Cliente aprobado: sólo lo suyo (clientes, empresas, operaciones,
  archivos), sin borradores, notas internas, contabilidad ni facturas en borrador.
- El cliente no puede crear operaciones, pagos, notas, ni cambiar su rol/estado.
- Archivos: no puede subir ni ver archivos de otro cliente.
- Rol consulta: sólo lectura. Operador: no puede aprobar operaciones.
- Nadie (salvo el backend) puede poner CAE ni marcar una factura como autorizada.
- Movimientos e intereses inmutables; anulación de cobranzas con reversión.
- Firma con DNI válido y hash SHA-256; usuario suspendido pierde el acceso.

`tests/e2e/e2e.mjs` recorre la aplicación real en el navegador contra la base con RLS.

## Recomendaciones de configuración

- Activar **MFA** (TOTP) para el personal interno.
- Activar **Leaked password protection** y revisar los **rate limits** de Auth.
- SMTP propio con SPF/DKIM para que los emails de verificación no vayan a spam.
- Backups con **PITR**.
- Revisar periódicamente **Database → Advisors** (seguridad y rendimiento) en Supabase.
- Restringir CORS de las Edge Functions con el secreto `ALLOWED_ORIGINS`.
- Mantener la lista de personal con acceso al mínimo necesario y revisar la auditoría.
