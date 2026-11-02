# Instalación y puesta en producción

Tiempo estimado: 30–45 minutos (sin contar el trámite del certificado de ARCA).

## 1. Proyecto de Supabase

1. Crear un proyecto en <https://supabase.com/dashboard> (región São Paulo, `sa-east-1`, es la más
   cercana). Guardar la contraseña de la base en un gestor de contraseñas.
2. En **Project Settings → API** anotar:
   - **Project URL** → será `SUPABASE_URL`.
   - **anon public** (o *publishable key*) → será `SUPABASE_ANON_KEY`.
   - La **service_role** *no se usa en el frontend*. Sólo la usan las Edge Functions, que la reciben
     automáticamente.

## 2. Base de datos

### Opción A — Editor SQL (sin instalar nada)

En **SQL Editor**, pegar y ejecutar **en este orden** el contenido de:

1. `supabase/migrations/20261102000100_esquema.sql`
2. `supabase/migrations/20261102000200_funciones.sql`
3. `supabase/migrations/20261102000300_rls.sql`
4. `supabase/migrations/20261102000400_storage.sql`
5. `supabase/migrations/20261102000500_plantillas.sql`
6. `supabase/migrations/20261102000600_rpc_formularios.sql`

Opcional: `supabase/seed.sql` para cargar los **datos DEMO** (ficticios).

### Opción B — CLI de Supabase

```bash
npx supabase login
```

```bash
npx supabase link --project-ref <ref-del-proyecto>
```

```bash
npx supabase db push
```

Los buckets privados `documentos`, `plantillas` y `comprobantes` y sus políticas los crea la
migración 04. Verificar en **Storage** que los tres figuren como *Private*.

## 3. Autenticación

En **Authentication → Sign In / Providers → Email**:

- **Confirm email**: activado (obligatorio: la aprobación de un cliente exige email verificado).
- **Secure email change** y **Secure password change**: activados.
- Contraseña mínima: 10 caracteres, con minúsculas, mayúsculas y dígitos.
- **Leaked password protection**: activado (planes pagos).

En **Authentication → URL Configuration**:

- **Site URL**: la URL de producción, por ejemplo `https://bbx-sistema.vercel.app` (o el dominio propio).
- **Redirect URLs**: agregar
  - `https://<tu-dominio>/acceso/**`
  - `https://*-<tu-equipo>.vercel.app/acceso/**` (vistas previas de Vercel, opcional)
  - `http://localhost:8000/acceso/**` (desarrollo)

En **Authentication → Emails → SMTP Settings** conviene configurar un SMTP propio (por ejemplo, el
correo de la empresa o un servicio transaccional): el SMTP de prueba de Supabase tiene un límite
muy bajo de envíos por hora. Las plantillas de email se pueden traducir al español en
**Authentication → Emails → Templates**.

## 4. Vercel

El repositorio ya está conectado a Vercel. En el proyecto de Vercel:

1. **Settings → Environment Variables** (Production, Preview y Development):
   - `SUPABASE_URL` = Project URL
   - `SUPABASE_ANON_KEY` = clave anon/publishable
2. **Settings → Build & Deployment**: *Framework Preset* = **Other**, sin comando de build y
   *Output Directory* vacío (la raíz). La función `api/config.js` se publica sola.
3. Volver a desplegar (**Deployments → Redeploy**).

`vercel.json` agrega las cabeceras de seguridad (CSP, HSTS, X-Frame-Options, etc.). Si se usa un
dominio propio para Supabase (custom domain), agregarlo a `connect-src` en la CSP.

### Desarrollo local

Completar `app/config.js` con la URL y la clave anon (nunca la service_role) y servir la carpeta:

```bash
python3 -m http.server 8000
```

## 5. Primer superadministrador

La configuración inicial define **bbxsolucionesfinancieras@gmail.com** como superadministrador
inicial:

1. Entrar a `/acceso/registro.html` y registrarse con ese email (el CUIT puede ser el de BBX).
2. Abrir el email de verificación y confirmar.
3. Al verificarse, la cuenta pasa automáticamente a **superadministrador** (sólo si todavía no
   existe ninguno). Ingresar en `/acceso/`: redirige a `/admin/`.

Para cambiar ese email antes de registrarse:

```sql
update public.configuracion set valor = '"otro@dominio.com"' where clave = 'superadmin_inicial';
```

Para promover manualmente a un usuario ya registrado (desde el editor SQL):

```sql
update public.perfiles set rol = 'superadmin', estado = 'activo', cliente_id = null
 where email = 'persona@dominio.com';
```

## 6. Personal interno

Desde **Usuarios → Invitar usuario interno** (requiere la Edge Function `gestionar-usuario`). Roles:

| Rol | Puede |
|---|---|
| Superadministrador | Todo, incluida la gestión de roles |
| Administrador | Todo menos invitar usuarios y cambiar roles |
| Operador comercial | Clientes, solicitudes, operaciones (sin aprobar), documentación y formularios |
| Contable | Cobranzas, contabilidad, facturación y reportes |
| Consulta | Sólo lectura |

Los permisos de cada rol se ajustan en **Usuarios → Roles y permisos**.

## 7. Edge Functions

```bash
npx supabase functions deploy arca-factura
```

```bash
npx supabase functions deploy gestionar-usuario
```

Secretos opcionales de ambas: `ALLOWED_ORIGINS` (lista separada por comas con los dominios del
sitio, para restringir CORS). Los de ARCA están en [ARCA.md](ARCA.md).

## 8. Datos DEMO

`supabase/seed.sql` carga información **ficticia** para probar (marcada como DEMO). Antes de operar
con clientes reales:

```sql
select public.borrar_datos_demo();
```

## 9. Checklist antes de producción

- [ ] Las 6 migraciones ejecutadas sin errores.
- [ ] Confirmación de email activada y URLs de redirección cargadas.
- [ ] SMTP propio configurado.
- [ ] Variables de entorno cargadas en Vercel y redeploy hecho.
- [ ] Superadministrador inicial verificado.
- [ ] Datos DEMO borrados.
- [ ] Textos legales de las plantillas de formularios revisados por la asesoría legal.
- [ ] Edge Functions desplegadas; ARCA probado en homologación antes de pasar a producción.
- [ ] Backups: plan con PITR o exportaciones programadas.
- [ ] MFA activado para el personal interno (Authentication → Multi-Factor).
