# Facturación electrónica con ARCA (WSFEv1)

La plataforma emite comprobantes electrónicos a través de los web services de ARCA:

- **WSAA**: autenticación. Con el certificado de BBX se firma un "ticket de acceso" (CMS/PKCS#7) y
  ARCA devuelve `token` y `sign`, válidos por 12 horas (se guardan en `arca_tokens`, una tabla sin
  acceso desde la API).
- **WSFEv1**: `FECompUltimoAutorizado` (próximo número) y `FECAESolicitar` (CAE).

Todo ocurre en la Edge Function `supabase/functions/arca-factura`, del lado del servidor. El
certificado y la clave privada **nunca** llegan al navegador.

## Reglas que garantiza el sistema

- Una factura nace en **borrador** y no tiene validez fiscal. Su PDF dice "VISTA PREVIA — SIN
  VALIDEZ FISCAL" y no lleva CAE ni QR.
- Sólo el backend (service_role) puede escribir `estado = autorizada`, `numero`, `cae`,
  `cae_vencimiento`: un trigger en la base lo impide para cualquier usuario, incluso administradores.
- Una vez enviada o autorizada no se puede editar ni borrar: se corrige con nota de crédito.
- Si la comunicación se corta después de pedir el CAE, la función consulta `FECompConsultar` antes
  de dar el comprobante por rechazado, para no duplicar numeración.
- Cada intercambio queda en `arca_log` y en la auditoría.
- El ambiente de **homologación** marca los PDF como "HOMOLOGACIÓN · SIN VALIDEZ FISCAL".

## 1. Certificado para homologación (pruebas)

```bash
openssl genrsa -out bbx-homo.key 2048
```

```bash
openssl req -new -key bbx-homo.key -subj "/C=AR/O=BBX Soluciones Financieras S.A./CN=bbx-plataforma/serialNumber=CUIT 30XXXXXXXXX" -out bbx-homo.csr
```

1. Ingresar a ARCA con clave fiscal y adherir el servicio **WSASS – Autogestión Certificados
   Homologación**.
2. En WSASS: *Nuevo certificado* → pegar el CSR → descargar el certificado (`bbx-homo.crt`).
3. En WSASS: *Crear autorización a servicio* → servicio **wsfe** para ese certificado.

## 2. Certificado para producción

1. Generar otra clave y CSR (no reutilizar la de homologación).
2. En ARCA: **Administración de Certificados Digitales** → agregar alias → subir el CSR →
   descargar el certificado.
3. En **Administrador de Relaciones de Clave Fiscal** → *Nueva relación* → servicio
   **Facturación Electrónica** (wsfe) → asociar el certificado como representante.
4. En **Administración de puntos de venta y domicilios** dar de alta un punto de venta del tipo
   **"RECE para aplicativo y web services"** (o "Factura Electrónica - Monotributo - Web Services").

## 3. Cargar los secretos en Supabase

```bash
npx supabase secrets set ARCA_AMBIENTE=homologacion
```

```bash
npx supabase secrets set ARCA_CERT="$(cat bbx-homo.crt)" ARCA_KEY="$(cat bbx-homo.key)"
```

```bash
npx supabase functions deploy arca-factura
```

(También se pueden cargar desde **Edge Functions → Secrets** en el panel de Supabase.)

Guardar la clave privada fuera del repositorio. `.gitignore` ya excluye `*.key`, `*.pem` y `*.crt`.

## 4. Datos del emisor

En la plataforma: **Configuración → Facturación (ARCA)**: razón social, CUIT emisor, domicilio,
condición frente al IVA, Ingresos Brutos, inicio de actividades, **punto de venta** y **ambiente**.
El ambiente debe coincidir con `ARCA_AMBIENTE`; si no, la función se niega a emitir.

Con **Probar conexión con ARCA** se verifican los servidores (`FEDummy`) y la autenticación (WSAA).

## 5. Emitir

1. **Facturación → Nuevo comprobante**: cliente, tipo (A/B/C, nota de crédito/débito), concepto y
   fechas de servicio.
2. Agregar los ítems con su alícuota de IVA (en factura C no se discrimina IVA).
3. **Emitir en ARCA**. Si ARCA autoriza, queda con número y CAE; si rechaza, se muestran los
   códigos y mensajes de ARCA para corregir y reenviar.
4. Descargar el PDF con el código QR (RG 4892).

Desde 2025 ARCA exige informar la **condición frente al IVA del receptor**
(`CondicionIVAReceptorId`), que se toma de la ficha del cliente.

## 6. Pasar a producción

1. Probar varios comprobantes en homologación.
2. Cargar el certificado de producción y `ARCA_AMBIENTE=produccion`, redeplegar la función.
3. Cambiar el ambiente y el punto de venta en **Configuración → Facturación (ARCA)**.
