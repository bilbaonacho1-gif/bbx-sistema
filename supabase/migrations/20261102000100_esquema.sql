-- =====================================================================
-- BBX Soluciones Financieras S.A. — Esquema de base de datos
-- 01 · Tablas, catálogos y relaciones
--
-- Convenciones
--   * Montos en numeric(18,2), tasas en numeric(9,4) (porcentaje).
--   * Estados como text + CHECK, para poder ampliarlos sin migrar enums.
--   * es_demo = true marca los datos ficticios de desarrollo (seed.sql).
--   * Nada se borra físicamente desde la app: se anula o se cambia el estado.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Roles y permisos
-- ---------------------------------------------------------------------
create table public.roles (
  codigo       text primary key,
  nombre       text not null,
  descripcion  text,
  es_interno   boolean not null default true,  -- false = cliente
  orden        int not null default 0
);

create table public.permisos (
  codigo       text primary key,               -- ej. clientes.editar
  modulo       text not null,
  descripcion  text not null
);

create table public.rol_permisos (
  rol      text not null references public.roles(codigo) on delete cascade,
  permiso  text not null references public.permisos(codigo) on delete cascade,
  primary key (rol, permiso)
);

-- ---------------------------------------------------------------------
-- Entidades fiscales (personas humanas o jurídicas identificadas por CUIT)
-- Se usan para los clientes y para los libradores de cheques.
-- ---------------------------------------------------------------------
create table public.empresas (
  id                 uuid primary key default gen_random_uuid(),
  razon_social       text not null,
  cuit               text not null unique check (cuit ~ '^\d{11}$'),
  tipo_persona       text not null default 'juridica' check (tipo_persona in ('humana','juridica')),
  condicion_iva      int  not null default 1,   -- ver condiciones_iva
  actividad          text,
  fecha_constitucion date,
  domicilio_calle    text,
  domicilio_numero   text,
  domicilio_piso     text,
  domicilio_localidad text,
  domicilio_provincia text,
  domicilio_cp       text,
  es_librador        boolean not null default false,
  es_demo            boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Condiciones frente al IVA según ARCA (tabla de parámetros FEParamGetCondicionIvaReceptor)
create table public.condiciones_iva (
  id      int primary key,
  nombre  text not null
);

-- ---------------------------------------------------------------------
-- Clientes
-- ---------------------------------------------------------------------
create sequence public.seq_cliente_codigo start 1;

create table public.clientes (
  id              uuid primary key default gen_random_uuid(),
  codigo          text not null unique default ('CL-' || lpad(nextval('public.seq_cliente_codigo')::text, 5, '0')),
  empresa_id      uuid not null unique references public.empresas(id),
  nombre_fantasia text,
  email           text,
  telefono        text,
  domicilio_comercial text,
  estado          text not null default 'en_evaluacion'
                  check (estado in ('prospecto','en_evaluacion','activo','inactivo','suspendido','bloqueado')),
  ejecutivo_id    uuid,                         -- FK a perfiles (se agrega más abajo)
  fecha_alta      date not null default current_date,
  es_demo         boolean not null default false,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table public.contactos (
  id           uuid primary key default gen_random_uuid(),
  cliente_id   uuid not null references public.clientes(id) on delete cascade,
  nombre       text not null,
  apellido     text not null,
  dni          text check (dni is null or dni ~ '^\d{7,8}$'),
  cargo        text,
  email        text,
  telefono     text,
  es_principal boolean not null default false,
  es_firmante  boolean not null default false,
  es_demo      boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index on public.contactos (cliente_id);

-- ---------------------------------------------------------------------
-- Usuarios (perfil 1:1 con auth.users)
-- ---------------------------------------------------------------------
create table public.perfiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  email          text not null,
  nombre         text,
  apellido       text,
  telefono       text,
  rol            text not null default 'cliente' references public.roles(codigo),
  estado         text not null default 'pendiente'
                 check (estado in ('pendiente','activo','rechazado','suspendido')),
  cliente_id     uuid references public.clientes(id) on delete set null,
  ultimo_acceso  timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index on public.perfiles (cliente_id);

alter table public.clientes
  add constraint clientes_ejecutivo_fk foreign key (ejecutivo_id) references public.perfiles(id) on delete set null,
  add constraint clientes_created_by_fk foreign key (created_by) references public.perfiles(id) on delete set null;

-- Notas internas: nunca visibles para el cliente
create table public.notas_internas (
  id           uuid primary key default gen_random_uuid(),
  cliente_id   uuid not null references public.clientes(id) on delete cascade,
  operacion_id uuid,
  texto        text not null check (length(texto) between 1 and 5000),
  autor_id     uuid references public.perfiles(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index on public.notas_internas (cliente_id);

-- Solicitudes de registro desde la web pública
create table public.solicitudes_registro (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null unique references public.perfiles(id) on delete cascade,
  nombre         text not null,
  apellido       text not null,
  razon_social   text not null,
  cuit           text not null check (cuit ~ '^\d{11}$'),
  email          text not null,
  telefono       text,
  estado         text not null default 'pendiente' check (estado in ('pendiente','aprobada','rechazada')),
  motivo_rechazo text,
  cliente_id     uuid references public.clientes(id) on delete set null,
  revisado_por   uuid references public.perfiles(id) on delete set null,
  revisado_at    timestamptz,
  created_at     timestamptz not null default now()
);
create index on public.solicitudes_registro (estado);

-- ---------------------------------------------------------------------
-- Operaciones
-- ---------------------------------------------------------------------
create table public.tipos_operacion (
  codigo            text primary key,
  nombre            text not null,
  descripcion       text,
  modalidad_default text not null default 'vencido' check (modalidad_default in ('descuento','vencido')),
  usa_cheques       boolean not null default false,
  usa_acuerdo       boolean not null default false,
  activo            boolean not null default true,
  orden             int not null default 0
);

create sequence public.seq_operacion_numero start 1;

create table public.operaciones (
  id                  uuid primary key default gen_random_uuid(),
  numero              text not null unique
                      default ('OP-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.seq_operacion_numero')::text, 5, '0')),
  cliente_id          uuid not null references public.clientes(id),
  tipo_codigo         text not null references public.tipos_operacion(codigo),
  -- descuento: los intereses se descuentan al liquidar; vencido: se cobran con el capital
  modalidad           text not null default 'vencido' check (modalidad in ('descuento','vencido')),
  moneda              text not null default 'ARS' check (moneda in ('ARS','USD')),
  fecha_inicio        date not null default current_date,
  fecha_vencimiento   date not null,
  capital             numeric(18,2) not null check (capital > 0),
  tasa_interes        numeric(9,4) not null check (tasa_interes >= 0),   -- %
  tasa_periodo        text not null default 'mensual' check (tasa_periodo in ('mensual','anual')),
  base_dias           int  not null default 365 check (base_dias in (360,365)),
  dias                int  generated always as (fecha_vencimiento - fecha_inicio) stored,
  -- Intereses pactados para todo el plazo (calculados por trigger, editables)
  intereses_pactados  numeric(18,2) not null default 0 check (intereses_pactados >= 0),
  gastos              numeric(18,2) not null default 0 check (gastos >= 0),
  comisiones          numeric(18,2) not null default 0 check (comisiones >= 0),
  iva_comisiones      numeric(18,2) not null default 0 check (iva_comisiones >= 0),
  -- importe_total: lo que BBX debe recuperar (cheques al cobro o deuda total)
  importe_total       numeric(18,2) not null default 0,
  -- importe_liquidado: lo que BBX entrega al cliente
  importe_liquidado   numeric(18,2) not null default 0,
  estado              text not null default 'borrador'
                      check (estado in ('borrador','pendiente','en_analisis','aprobada','activa','en_mora','finalizada','cancelada','rechazada')),
  fecha_liquidacion   date,
  fecha_finalizacion  date,
  observaciones       text,                    -- visibles para el cliente
  es_demo             boolean not null default false,
  created_by          uuid references public.perfiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (fecha_vencimiento > fecha_inicio)
);
create index on public.operaciones (cliente_id);
create index on public.operaciones (estado);
create index on public.operaciones (fecha_vencimiento);

alter table public.notas_internas
  add constraint notas_operacion_fk foreign key (operacion_id) references public.operaciones(id) on delete cascade;

-- Historial de estados de cada operación
create table public.operacion_estados (
  id              bigint generated always as identity primary key,
  operacion_id    uuid not null references public.operaciones(id) on delete cascade,
  estado_anterior text,
  estado_nuevo    text not null,
  comentario      text,
  usuario_id      uuid references public.perfiles(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index on public.operacion_estados (operacion_id);

create table public.cheques (
  id               uuid primary key default gen_random_uuid(),
  operacion_id     uuid not null references public.operaciones(id) on delete cascade,
  tipo             text not null default 'fisico' check (tipo in ('fisico','echeq')),
  numero           text not null,
  banco            text not null,
  librador_cuit    text check (librador_cuit is null or librador_cuit ~ '^\d{11}$'),
  librador_nombre  text,
  librador_id      uuid references public.empresas(id) on delete set null,
  fecha_emision    date,
  fecha_pago       date not null,
  monto            numeric(18,2) not null check (monto > 0),
  estado           text not null default 'en_cartera'
                   check (estado in ('en_cartera','depositado','acreditado','rechazado','devuelto','endosado')),
  motivo_rechazo   text,
  es_demo          boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index on public.cheques (operacion_id);
create index on public.cheques (fecha_pago);

create table public.acuerdos (
  id                uuid primary key default gen_random_uuid(),
  operacion_id      uuid not null unique references public.operaciones(id) on delete cascade,
  limite            numeric(18,2) not null check (limite > 0),
  tasa_excedido     numeric(9,4),
  garantia          text,
  renovacion_automatica boolean not null default false,
  es_demo           boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Cobranzas, movimientos e intereses
--   movimientos: cuenta corriente del cliente (cargos y abonos → saldo)
--   pagos:       cobranzas recibidas, con su imputación
--   intereses:   registro de intereses DEVENGADOS y COBRADOS, separados
-- ---------------------------------------------------------------------
create table public.pagos (
  id                  uuid primary key default gen_random_uuid(),
  cliente_id          uuid not null references public.clientes(id),
  operacion_id        uuid references public.operaciones(id),
  fecha               date not null default current_date,
  medio               text not null check (medio in ('transferencia','efectivo','cheque','echeq','compensacion','acreditacion_cheque')),
  referencia          text,
  importe             numeric(18,2) not null check (importe > 0),
  imputado_capital    numeric(18,2) not null default 0 check (imputado_capital >= 0),
  imputado_intereses  numeric(18,2) not null default 0 check (imputado_intereses >= 0),
  imputado_gastos     numeric(18,2) not null default 0 check (imputado_gastos >= 0),
  imputado_comisiones numeric(18,2) not null default 0 check (imputado_comisiones >= 0),
  observaciones       text,
  anulado             boolean not null default false,
  anulado_motivo      text,
  es_demo             boolean not null default false,
  registrado_por      uuid references public.perfiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  check (imputado_capital + imputado_intereses + imputado_gastos + imputado_comisiones = importe)
);
create index on public.pagos (cliente_id);
create index on public.pagos (operacion_id);

create table public.movimientos (
  id            uuid primary key default gen_random_uuid(),
  cliente_id    uuid not null references public.clientes(id),
  operacion_id  uuid references public.operaciones(id),
  pago_id       uuid references public.pagos(id),
  fecha         date not null default current_date,
  tipo          text not null check (tipo in (
                  'alta_operacion','liquidacion','cobro_capital','cobro_intereses','cobro_gastos',
                  'cobro_comisiones','cargo_gastos','cargo_comisiones','cargo_intereses','ajuste','anulacion')),
  sentido       text not null check (sentido in ('cargo','abono','informativo')),
  concepto      text not null,
  importe       numeric(18,2) not null check (importe >= 0),
  es_demo       boolean not null default false,
  registrado_por uuid references public.perfiles(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index on public.movimientos (cliente_id, fecha);
create index on public.movimientos (operacion_id);

create table public.intereses (
  id             uuid primary key default gen_random_uuid(),
  operacion_id   uuid not null references public.operaciones(id) on delete cascade,
  cliente_id     uuid not null references public.clientes(id),
  tipo           text not null check (tipo in ('devengado','cobrado')),
  fecha          date not null,
  periodo_desde  date,
  periodo_hasta  date,
  importe        numeric(18,2) not null,
  pago_id        uuid references public.pagos(id) on delete set null,
  observaciones  text,
  es_demo        boolean not null default false,
  created_at     timestamptz not null default now()
);
create index on public.intereses (operacion_id, tipo);
create index on public.intereses (fecha);

-- ---------------------------------------------------------------------
-- Contabilidad: libro de ingresos y egresos
-- ---------------------------------------------------------------------
create table public.movimientos_contables (
  id              uuid primary key default gen_random_uuid(),
  fecha           date not null default current_date,
  tipo            text not null check (tipo in ('ingreso','egreso')),
  categoria       text not null check (categoria in (
                    'intereses_cobrados','comisiones','gastos_recuperados','desembolso','cobro_capital',
                    'gasto_operativo','impuestos','honorarios','servicios','sueldos','otros_ingresos','otros_egresos')),
  concepto        text not null,
  importe         numeric(18,2) not null check (importe > 0),
  cliente_id      uuid references public.clientes(id),
  operacion_id    uuid references public.operaciones(id),
  pago_id         uuid references public.pagos(id),
  factura_id      uuid,
  medio           text,
  comprobante_path text,
  anulado         boolean not null default false,
  automatico      boolean not null default false,   -- generado por el sistema
  es_demo         boolean not null default false,
  registrado_por  uuid references public.perfiles(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index on public.movimientos_contables (fecha);
create index on public.movimientos_contables (categoria);

-- ---------------------------------------------------------------------
-- Facturación electrónica (ARCA · WSFEv1)
-- Una factura sólo es comprobante fiscal si estado = 'autorizada' y tiene CAE.
-- Esos campos sólo los escribe la Edge Function con service_role (trigger).
-- ---------------------------------------------------------------------
create table public.arca_config (
  id                  int primary key default 1 check (id = 1),
  cuit_emisor         text check (cuit_emisor is null or cuit_emisor ~ '^\d{11}$'),
  razon_social        text,
  domicilio           text,
  condicion_iva       text default 'IVA Responsable Inscripto',
  ingresos_brutos     text,
  inicio_actividades  date,
  punto_venta         int check (punto_venta is null or punto_venta between 1 and 99998),
  ambiente            text not null default 'homologacion' check (ambiente in ('homologacion','produccion')),
  updated_at          timestamptz not null default now()
);

create table public.facturas (
  id                     uuid primary key default gen_random_uuid(),
  cliente_id             uuid not null references public.clientes(id),
  operacion_id           uuid references public.operaciones(id),
  tipo_comprobante       int not null check (tipo_comprobante in (1,2,3,6,7,8,11,12,13)),
  punto_venta            int not null,
  numero                 bigint,                -- lo asigna ARCA
  concepto               int not null default 2 check (concepto in (1,2,3)),
  fecha_emision          date not null default current_date,
  fecha_servicio_desde   date,
  fecha_servicio_hasta   date,
  fecha_vto_pago         date,
  receptor_doc_tipo      int not null default 80,
  receptor_doc_nro       text not null,
  receptor_razon_social  text not null,
  receptor_condicion_iva int not null references public.condiciones_iva(id),
  receptor_domicilio     text,
  importe_neto           numeric(18,2) not null default 0,
  importe_iva            numeric(18,2) not null default 0,
  importe_exento         numeric(18,2) not null default 0,
  importe_no_gravado     numeric(18,2) not null default 0,
  importe_tributos       numeric(18,2) not null default 0,
  importe_total          numeric(18,2) not null default 0,
  moneda                 text not null default 'PES',
  cotizacion             numeric(18,6) not null default 1,
  comprobante_asociado_id uuid references public.facturas(id),
  estado                 text not null default 'borrador'
                         check (estado in ('borrador','enviando','autorizada','rechazada','anulada')),
  cae                    text,
  cae_vencimiento        date,
  ambiente               text,
  resultado_arca         text,
  observaciones_arca     jsonb,
  errores_arca           jsonb,
  enviada_at             timestamptz,
  autorizada_at          timestamptz,
  observaciones          text,
  es_demo                boolean not null default false,
  created_by             uuid references public.perfiles(id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  check (estado <> 'autorizada' or (cae is not null and numero is not null and cae_vencimiento is not null)),
  check (concepto = 1 or (fecha_servicio_desde is not null and fecha_servicio_hasta is not null and fecha_vto_pago is not null))
);
create index on public.facturas (cliente_id);
create index on public.facturas (operacion_id);
create index on public.facturas (estado);
create unique index facturas_numero_unico on public.facturas (tipo_comprobante, punto_venta, numero, ambiente) where numero is not null;

alter table public.movimientos_contables
  add constraint mc_factura_fk foreign key (factura_id) references public.facturas(id);

create table public.factura_items (
  id               uuid primary key default gen_random_uuid(),
  factura_id       uuid not null references public.facturas(id) on delete cascade,
  descripcion      text not null,
  cantidad         numeric(14,4) not null default 1 check (cantidad > 0),
  precio_unitario  numeric(18,2) not null check (precio_unitario >= 0),
  alicuota_iva_id  int not null default 5 check (alicuota_iva_id in (1,2,3,4,5,6,8,9)),  -- 1 no gravado, 2 exento, 3 0%, 4 10,5%, 5 21%, 6 27%, 8 5%, 9 2,5%
  importe_neto     numeric(18,2) not null default 0,
  importe_iva      numeric(18,2) not null default 0,
  orden            int not null default 0
);
create index on public.factura_items (factura_id);

-- Tokens de WSAA: sin políticas RLS → sólo service_role
create table public.arca_tokens (
  servicio   text not null,
  ambiente   text not null,
  token      text not null,
  sign       text not null,
  expira_at  timestamptz not null,
  primary key (servicio, ambiente)
);

create table public.arca_log (
  id          bigint generated always as identity primary key,
  factura_id  uuid references public.facturas(id) on delete set null,
  operacion   text not null,
  ambiente    text,
  exito       boolean not null,
  detalle     jsonb,
  usuario_id  uuid references public.perfiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Documentación
-- ---------------------------------------------------------------------
create table public.tipos_documento (
  codigo        text primary key,
  nombre        text not null,
  descripcion   text,
  aplica_a      text not null default 'cliente' check (aplica_a in ('cliente','operacion')),
  persona       text not null default 'ambas' check (persona in ('humana','juridica','ambas')),
  obligatorio   boolean not null default false,
  vence         boolean not null default false,
  orden         int not null default 0
);

create table public.documentos (
  id                    uuid primary key default gen_random_uuid(),
  cliente_id            uuid not null references public.clientes(id),
  operacion_id          uuid references public.operaciones(id),
  tipo_codigo           text references public.tipos_documento(codigo),
  nombre                text not null,
  descripcion           text,
  storage_bucket        text not null default 'documentos',
  storage_path          text not null unique,
  mime_type             text,
  tamano_bytes          bigint,
  estado                text not null default 'en_revision'
                        check (estado in ('en_revision','aprobado','rechazado','vencido','archivado')),
  observacion_revision  text,
  fecha_vencimiento     date,
  visible_cliente       boolean not null default true,
  subido_por            uuid references public.perfiles(id) on delete set null,
  subido_por_cliente    boolean not null default false,
  revisado_por          uuid references public.perfiles(id) on delete set null,
  revisado_at           timestamptz,
  es_demo               boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index on public.documentos (cliente_id);
create index on public.documentos (operacion_id);

-- Documentación que BBX le pide al cliente
create table public.documentos_requeridos (
  id             uuid primary key default gen_random_uuid(),
  cliente_id     uuid not null references public.clientes(id) on delete cascade,
  operacion_id   uuid references public.operaciones(id) on delete cascade,
  tipo_codigo    text references public.tipos_documento(codigo),
  descripcion    text not null,
  estado         text not null default 'pendiente' check (estado in ('pendiente','recibido','cumplido','dispensado')),
  documento_id   uuid references public.documentos(id) on delete set null,
  fecha_limite   date,
  solicitado_por uuid references public.perfiles(id) on delete set null,
  es_demo        boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index on public.documentos_requeridos (cliente_id, estado);

-- ---------------------------------------------------------------------
-- Formularios, acuerdos y firmas
-- ---------------------------------------------------------------------
create table public.plantillas_formulario (
  id             uuid primary key default gen_random_uuid(),
  codigo         text not null unique,
  nombre         text not null,
  categoria      text not null check (categoria in ('descuento_cheques','acuerdo_cc','alta_cliente','declaracion','otro')),
  descripcion    text,
  campos         jsonb not null default '[]'::jsonb,  -- [{clave, etiqueta, tipo, requerido, opciones}]
  texto_legal    text,                               -- condiciones que el cliente acepta al firmar
  archivo_path   text,                               -- modelo descargable (bucket plantillas)
  requiere_firma boolean not null default true,
  cliente_puede_iniciar boolean not null default false,
  activo         boolean not null default true,
  version        int not null default 1,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table public.formularios (
  id              uuid primary key default gen_random_uuid(),
  plantilla_id    uuid not null references public.plantillas_formulario(id),
  cliente_id      uuid not null references public.clientes(id),
  operacion_id    uuid references public.operaciones(id),
  estado          text not null default 'pendiente'
                  check (estado in ('pendiente','completado','firmado','aprobado','rechazado','anulado')),
  datos           jsonb not null default '{}'::jsonb,
  fecha_limite    date,
  enviado_at      timestamptz,
  revisado_por    uuid references public.perfiles(id) on delete set null,
  revisado_at     timestamptz,
  observaciones   text,
  iniciado_por_cliente boolean not null default false,
  es_demo         boolean not null default false,
  created_by      uuid references public.perfiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index on public.formularios (cliente_id, estado);

-- Firma electrónica por aceptación (Ley 25.506, art. 5). No es firma digital certificada.
create table public.firmas (
  id               uuid primary key default gen_random_uuid(),
  formulario_id    uuid references public.formularios(id) on delete cascade,
  documento_id     uuid references public.documentos(id) on delete cascade,
  cliente_id       uuid not null references public.clientes(id),
  firmante_id      uuid references public.perfiles(id) on delete set null,
  firmante_nombre  text not null,
  firmante_dni     text,
  metodo           text not null default 'aceptacion_electronica',
  hash_contenido   text not null,      -- sha256 de lo firmado
  ip               text,
  user_agent       text,
  firmado_at       timestamptz not null default now(),
  check (formulario_id is not null or documento_id is not null)
);
create index on public.firmas (cliente_id);

-- ---------------------------------------------------------------------
-- Notificaciones, actividad y auditoría
-- ---------------------------------------------------------------------
create table public.notificaciones (
  id              uuid primary key default gen_random_uuid(),
  destinatario_id uuid not null references public.perfiles(id) on delete cascade,
  tipo            text not null,
  titulo          text not null,
  mensaje         text,
  enlace          text,
  leida_at        timestamptz,
  created_at      timestamptz not null default now()
);
create index on public.notificaciones (destinatario_id, leida_at);

create table public.registro_actividad (
  id          bigint generated always as identity primary key,
  usuario_id  uuid references public.perfiles(id) on delete set null,
  accion      text not null,
  detalle     jsonb,
  ip          text,
  user_agent  text,
  created_at  timestamptz not null default now()
);
create index on public.registro_actividad (usuario_id, created_at desc);

create table public.auditoria (
  id             bigint generated always as identity primary key,
  tabla          text not null,
  registro_id    text,
  accion         text not null check (accion in ('INSERT','UPDATE','DELETE')),
  datos_antes    jsonb,
  datos_despues  jsonb,
  cambios        jsonb,
  usuario_id     uuid,
  usuario_email  text,
  rol_db         text,
  ip             text,
  created_at     timestamptz not null default now()
);
create index on public.auditoria (tabla, registro_id);
create index on public.auditoria (created_at desc);

create table public.configuracion (
  clave       text primary key,
  valor       jsonb not null,
  descripcion text,
  updated_at  timestamptz not null default now()
);
