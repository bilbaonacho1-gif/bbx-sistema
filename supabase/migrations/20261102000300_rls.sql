-- =====================================================================
-- 03 · Row Level Security, privilegios y catálogos base
--
-- Principios
--   * RLS activado en TODAS las tablas.
--   * anon (sin sesión) no accede a ninguna tabla ni función.
--   * Personal interno: acceso según permisos de su rol (tiene_permiso).
--   * Clientes: sólo filas de su propio cliente (mi_cliente_id) y sólo lectura,
--     salvo subir documentos. Todo lo demás pasa por RPCs que validan.
-- =====================================================================

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Privilegios
-- ---------------------------------------------------------------------
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon, public;
alter default privileges in schema public revoke all on tables    from anon;
alter default privileges in schema public revoke all on functions from anon, public;

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

-- Perfiles: el usuario sólo puede tocar sus datos de contacto
revoke update on public.perfiles from authenticated;
grant update (nombre, apellido, telefono) on public.perfiles to authenticated;
revoke insert, delete on public.perfiles from authenticated;

-- Tablas que sólo se escriben desde triggers/RPC
revoke insert, update, delete on public.auditoria, public.registro_actividad, public.operacion_estados,
  public.movimientos, public.intereses, public.firmas, public.solicitudes_registro, public.arca_log
  from authenticated;
revoke all on public.arca_tokens from authenticated;
revoke insert, delete on public.notificaciones from authenticated;
revoke update on public.notificaciones from authenticated;   -- se marcan leídas por RPC

-- Funciones internas que no deben llamarse por API
revoke execute on function
  public.notificar(uuid, text, text, text, text),
  public.notificar_permiso(text, text, text, text, text),
  public.notificar_cliente(uuid, text, text, text, text),
  public.recalcular_factura(uuid),
  public.tg_updated_at(), public.tg_auditar(), public.tg_nuevo_usuario(), public.tg_usuario_email(), public.tg_usuario_confirmado(),
  public.tg_perfiles_proteger(), public.tg_operaciones_calcular(), public.tg_cheques_cambios(),
  public.tg_operaciones_estado(), public.tg_pagos_alta(), public.tg_pagos_cambios(), public.tg_inmutable(),
  public.tg_factura_items(), public.tg_factura_items_total(), public.tg_facturas_proteger(),
  public.tg_facturas_autorizada(), public.tg_documentos(), public.tg_doc_requerido_alta(), public.tg_formularios_alta()
from authenticated;

-- ---------------------------------------------------------------------
-- Políticas
-- Nota: (select f()) hace que Postgres evalúe la función una sola vez por consulta.
-- ---------------------------------------------------------------------

-- Catálogos: lectura para cualquier usuario activo; escritura con configuracion.editar
create policy roles_select on public.roles for select to authenticated using (true);
create policy permisos_select on public.permisos for select to authenticated using ((select es_staff()));
create policy rol_permisos_select on public.rol_permisos for select to authenticated using ((select es_staff()));
create policy rol_permisos_write on public.rol_permisos for all to authenticated
  using ((select tiene_permiso('usuarios.gestionar'))) with check ((select tiene_permiso('usuarios.gestionar')));

create policy condiciones_iva_select on public.condiciones_iva for select to authenticated using (true);
create policy tipos_operacion_select on public.tipos_operacion for select to authenticated using (true);
create policy tipos_operacion_write on public.tipos_operacion for all to authenticated
  using ((select tiene_permiso('configuracion.editar'))) with check ((select tiene_permiso('configuracion.editar')));
create policy tipos_documento_select on public.tipos_documento for select to authenticated using (true);
create policy tipos_documento_write on public.tipos_documento for all to authenticated
  using ((select tiene_permiso('configuracion.editar'))) with check ((select tiene_permiso('configuracion.editar')));
create policy configuracion_select on public.configuracion for select to authenticated using ((select es_staff()));
create policy configuracion_write on public.configuracion for all to authenticated
  using ((select tiene_permiso('configuracion.editar'))) with check ((select tiene_permiso('configuracion.editar')));

-- Perfiles
create policy perfiles_select on public.perfiles for select to authenticated
  using (id = auth.uid() or (select tiene_permiso('usuarios.ver')) or (select tiene_permiso('registros.aprobar')));
create policy perfiles_update_propio on public.perfiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Solicitudes de registro
create policy solicitudes_select on public.solicitudes_registro for select to authenticated
  using (user_id = auth.uid() or (select tiene_permiso('registros.aprobar')));

-- Empresas: el cliente ve sólo la suya
create policy empresas_select on public.empresas for select to authenticated
  using ((select tiene_permiso('clientes.ver'))
         or id = (select empresa_id from public.clientes where id = (select mi_cliente_id())));
create policy empresas_insert on public.empresas for insert to authenticated
  with check ((select tiene_permiso('clientes.editar')) or (select tiene_permiso('operaciones.editar')));
create policy empresas_update on public.empresas for update to authenticated
  using ((select tiene_permiso('clientes.editar'))) with check ((select tiene_permiso('clientes.editar')));

-- Clientes
create policy clientes_select on public.clientes for select to authenticated
  using ((select tiene_permiso('clientes.ver')) or id = (select mi_cliente_id()));
create policy clientes_insert on public.clientes for insert to authenticated
  with check ((select tiene_permiso('clientes.editar')));
create policy clientes_update on public.clientes for update to authenticated
  using ((select tiene_permiso('clientes.editar'))) with check ((select tiene_permiso('clientes.editar')));

create policy contactos_select on public.contactos for select to authenticated
  using ((select tiene_permiso('clientes.ver')) or cliente_id = (select mi_cliente_id()));
create policy contactos_write on public.contactos for all to authenticated
  using ((select tiene_permiso('clientes.editar'))) with check ((select tiene_permiso('clientes.editar')));

-- Notas internas: sólo personal
create policy notas_select on public.notas_internas for select to authenticated
  using ((select tiene_permiso('clientes.ver')));
create policy notas_insert on public.notas_internas for insert to authenticated
  with check ((select tiene_permiso('clientes.editar')) and autor_id = auth.uid());

-- Operaciones: el cliente no ve borradores
create policy operaciones_select on public.operaciones for select to authenticated
  using ((select tiene_permiso('operaciones.ver'))
         or (cliente_id = (select mi_cliente_id()) and estado <> 'borrador'));
create policy operaciones_insert on public.operaciones for insert to authenticated
  with check ((select tiene_permiso('operaciones.editar')) and estado in ('borrador','pendiente'));
create policy operaciones_update on public.operaciones for update to authenticated
  using ((select tiene_permiso('operaciones.editar'))) with check ((select tiene_permiso('operaciones.editar')));
create policy operaciones_delete on public.operaciones for delete to authenticated
  using ((select tiene_permiso('operaciones.editar')) and estado = 'borrador');

create policy op_estados_select on public.operacion_estados for select to authenticated
  using ((select tiene_permiso('operaciones.ver'))
         or exists (select 1 from public.operaciones o where o.id = operacion_id
                     and o.cliente_id = (select mi_cliente_id()) and o.estado <> 'borrador'));

create policy cheques_select on public.cheques for select to authenticated
  using ((select tiene_permiso('operaciones.ver'))
         or exists (select 1 from public.operaciones o where o.id = operacion_id
                     and o.cliente_id = (select mi_cliente_id()) and o.estado <> 'borrador'));
create policy cheques_write on public.cheques for all to authenticated
  using ((select tiene_permiso('operaciones.editar'))) with check ((select tiene_permiso('operaciones.editar')));

create policy acuerdos_select on public.acuerdos for select to authenticated
  using ((select tiene_permiso('operaciones.ver'))
         or exists (select 1 from public.operaciones o where o.id = operacion_id
                     and o.cliente_id = (select mi_cliente_id()) and o.estado <> 'borrador'));
create policy acuerdos_write on public.acuerdos for all to authenticated
  using ((select tiene_permiso('operaciones.editar'))) with check ((select tiene_permiso('operaciones.editar')));

-- Cobranzas, movimientos e intereses
create policy pagos_select on public.pagos for select to authenticated
  using ((select tiene_permiso('cobranzas.ver')) or cliente_id = (select mi_cliente_id()));
create policy pagos_insert on public.pagos for insert to authenticated
  with check ((select tiene_permiso('cobranzas.registrar')) and registrado_por = auth.uid() and not anulado);
create policy pagos_update on public.pagos for update to authenticated
  using ((select tiene_permiso('cobranzas.anular'))) with check ((select tiene_permiso('cobranzas.anular')));

create policy movimientos_select on public.movimientos for select to authenticated
  using ((select tiene_permiso('cobranzas.ver')) or cliente_id = (select mi_cliente_id()));

create policy intereses_select on public.intereses for select to authenticated
  using ((select tiene_permiso('contabilidad.ver')) or (select tiene_permiso('operaciones.ver'))
         or (cliente_id = (select mi_cliente_id()) and tipo = 'cobrado'));

-- Contabilidad: sólo personal
create policy mc_select on public.movimientos_contables for select to authenticated
  using ((select tiene_permiso('contabilidad.ver')));
create policy mc_insert on public.movimientos_contables for insert to authenticated
  with check ((select tiene_permiso('contabilidad.editar')) and not automatico and registrado_por = auth.uid());
create policy mc_update on public.movimientos_contables for update to authenticated
  using ((select tiene_permiso('contabilidad.editar'))) with check ((select tiene_permiso('contabilidad.editar')));

-- Facturación
create policy arca_config_select on public.arca_config for select to authenticated
  using ((select tiene_permiso('facturacion.ver')));
create policy arca_config_write on public.arca_config for all to authenticated
  using ((select tiene_permiso('configuracion.editar'))) with check ((select tiene_permiso('configuracion.editar')));

create policy facturas_select on public.facturas for select to authenticated
  using ((select tiene_permiso('facturacion.ver'))
         or (cliente_id = (select mi_cliente_id()) and estado = 'autorizada'));
create policy facturas_insert on public.facturas for insert to authenticated
  with check ((select tiene_permiso('facturacion.emitir')));
create policy facturas_update on public.facturas for update to authenticated
  using ((select tiene_permiso('facturacion.emitir'))) with check ((select tiene_permiso('facturacion.emitir')));
create policy facturas_delete on public.facturas for delete to authenticated
  using ((select tiene_permiso('facturacion.emitir')) and estado = 'borrador');

create policy factura_items_select on public.factura_items for select to authenticated
  using (exists (select 1 from public.facturas f where f.id = factura_id));   -- hereda el RLS de facturas
create policy factura_items_write on public.factura_items for all to authenticated
  using ((select tiene_permiso('facturacion.emitir'))) with check ((select tiene_permiso('facturacion.emitir')));

create policy arca_log_select on public.arca_log for select to authenticated
  using ((select tiene_permiso('facturacion.ver')));
-- arca_tokens: sin políticas (sólo service_role)

-- Documentación
create policy documentos_select on public.documentos for select to authenticated
  using ((select tiene_permiso('documentos.ver'))
         or (cliente_id = (select mi_cliente_id()) and visible_cliente));
create policy documentos_insert_staff on public.documentos for insert to authenticated
  with check ((select tiene_permiso('documentos.editar')) and subido_por = auth.uid() and not subido_por_cliente);
create policy documentos_insert_cliente on public.documentos for insert to authenticated
  with check (cliente_id = (select mi_cliente_id()) and subido_por = auth.uid() and subido_por_cliente
              and estado = 'en_revision' and visible_cliente and revisado_por is null
              and storage_bucket = 'documentos' and split_part(storage_path, '/', 1) = cliente_id::text
              and (operacion_id is null or exists (select 1 from public.operaciones o where o.id = operacion_id and o.cliente_id = documentos.cliente_id)));
create policy documentos_update on public.documentos for update to authenticated
  using ((select tiene_permiso('documentos.editar'))) with check ((select tiene_permiso('documentos.editar')));

create policy doc_req_select on public.documentos_requeridos for select to authenticated
  using ((select tiene_permiso('documentos.ver')) or cliente_id = (select mi_cliente_id()));
create policy doc_req_write on public.documentos_requeridos for all to authenticated
  using ((select tiene_permiso('documentos.editar'))) with check ((select tiene_permiso('documentos.editar')));

-- Formularios y firmas
create policy plantillas_select on public.plantillas_formulario for select to authenticated
  using ((select es_staff()) or (activo and (select mi_cliente_id()) is not null));
create policy plantillas_write on public.plantillas_formulario for all to authenticated
  using ((select tiene_permiso('configuracion.editar'))) with check ((select tiene_permiso('configuracion.editar')));

create policy formularios_select on public.formularios for select to authenticated
  using ((select tiene_permiso('formularios.ver')) or cliente_id = (select mi_cliente_id()));
create policy formularios_insert on public.formularios for insert to authenticated
  with check ((select tiene_permiso('formularios.editar')) and not iniciado_por_cliente);
create policy formularios_update on public.formularios for update to authenticated
  using ((select tiene_permiso('formularios.editar'))) with check ((select tiene_permiso('formularios.editar')));

create policy firmas_select on public.firmas for select to authenticated
  using ((select tiene_permiso('formularios.ver')) or cliente_id = (select mi_cliente_id()));

-- Notificaciones: cada uno las suyas
create policy notificaciones_select on public.notificaciones for select to authenticated
  using (destinatario_id = auth.uid());

-- Actividad y auditoría: sólo lectura con permiso
create policy actividad_select on public.registro_actividad for select to authenticated
  using (usuario_id = auth.uid() or (select tiene_permiso('auditoria.ver')));
create policy auditoria_select on public.auditoria for select to authenticated
  using ((select tiene_permiso('auditoria.ver')));

-- ---------------------------------------------------------------------
-- Catálogos base (no son datos financieros)
-- ---------------------------------------------------------------------
insert into public.roles (codigo, nombre, descripcion, es_interno, orden) values
  ('superadmin',    'Superadministrador', 'Acceso total, incluida la gestión de roles', true, 1),
  ('administrador', 'Administrador',      'Gestión integral de clientes, operaciones y contabilidad', true, 2),
  ('operador',      'Operador comercial', 'Clientes, operaciones y documentación', true, 3),
  ('contable',      'Contable',           'Contabilidad, cobranzas y facturación', true, 4),
  ('consulta',      'Consulta',           'Sólo lectura', true, 5),
  ('cliente',       'Cliente',            'Acceso al portal privado', false, 9);

insert into public.permisos (codigo, modulo, descripcion) values
  ('dashboard.ver',        'Dashboard',     'Ver indicadores generales'),
  ('clientes.ver',         'Clientes',      'Consultar clientes'),
  ('clientes.editar',      'Clientes',      'Crear y editar clientes'),
  ('registros.aprobar',    'Clientes',      'Aprobar o rechazar solicitudes de acceso'),
  ('operaciones.ver',      'Operaciones',   'Consultar operaciones'),
  ('operaciones.editar',   'Operaciones',   'Crear y editar operaciones'),
  ('operaciones.aprobar',  'Operaciones',   'Aprobar operaciones'),
  ('cobranzas.ver',        'Cobranzas',     'Consultar cobranzas y movimientos'),
  ('cobranzas.registrar',  'Cobranzas',     'Registrar cobranzas'),
  ('cobranzas.anular',     'Cobranzas',     'Anular cobranzas'),
  ('contabilidad.ver',     'Contabilidad',  'Consultar movimientos contables'),
  ('contabilidad.editar',  'Contabilidad',  'Registrar ingresos, gastos y devengamientos'),
  ('facturacion.ver',      'Facturación',   'Consultar facturas'),
  ('facturacion.emitir',   'Facturación',   'Emitir facturas electrónicas en ARCA'),
  ('documentos.ver',       'Documentación', 'Consultar documentación'),
  ('documentos.editar',    'Documentación', 'Subir y pedir documentación'),
  ('documentos.revisar',   'Documentación', 'Aprobar o rechazar documentación'),
  ('formularios.ver',      'Formularios',   'Consultar formularios y firmas'),
  ('formularios.editar',   'Formularios',   'Asignar y revisar formularios'),
  ('reportes.ver',         'Reportes',      'Ver reportes por período'),
  ('usuarios.ver',         'Usuarios',      'Consultar usuarios'),
  ('usuarios.gestionar',   'Usuarios',      'Invitar usuarios y cambiar roles'),
  ('configuracion.editar', 'Configuración', 'Editar parámetros, plantillas y datos fiscales'),
  ('auditoria.ver',        'Auditoría',     'Consultar auditoría y actividad');

-- administrador: todo menos gestión de usuarios
insert into public.rol_permisos (rol, permiso)
select 'administrador', codigo from public.permisos where codigo not in ('usuarios.gestionar');

insert into public.rol_permisos (rol, permiso) values
  ('operador','dashboard.ver'), ('operador','clientes.ver'), ('operador','clientes.editar'), ('operador','registros.aprobar'),
  ('operador','operaciones.ver'), ('operador','operaciones.editar'), ('operador','cobranzas.ver'),
  ('operador','documentos.ver'), ('operador','documentos.editar'), ('operador','documentos.revisar'),
  ('operador','formularios.ver'), ('operador','formularios.editar'), ('operador','facturacion.ver'),
  ('contable','dashboard.ver'), ('contable','clientes.ver'), ('contable','operaciones.ver'),
  ('contable','cobranzas.ver'), ('contable','cobranzas.registrar'), ('contable','cobranzas.anular'),
  ('contable','contabilidad.ver'), ('contable','contabilidad.editar'),
  ('contable','facturacion.ver'), ('contable','facturacion.emitir'), ('contable','reportes.ver'),
  ('contable','documentos.ver'),
  ('consulta','dashboard.ver'), ('consulta','clientes.ver'), ('consulta','operaciones.ver'), ('consulta','cobranzas.ver'),
  ('consulta','contabilidad.ver'), ('consulta','facturacion.ver'), ('consulta','documentos.ver'),
  ('consulta','formularios.ver'), ('consulta','reportes.ver');

insert into public.condiciones_iva (id, nombre) values
  (1, 'IVA Responsable Inscripto'),
  (4, 'IVA Sujeto Exento'),
  (5, 'Consumidor Final'),
  (6, 'Responsable Monotributo'),
  (7, 'Sujeto No Categorizado'),
  (8, 'Proveedor del Exterior'),
  (9, 'Cliente del Exterior'),
  (10, 'IVA Liberado – Ley N° 19.640'),
  (13, 'Monotributista Social'),
  (15, 'IVA No Alcanzado'),
  (16, 'Monotributo Trabajador Independiente Promovido');

insert into public.tipos_operacion (codigo, nombre, descripcion, modalidad_default, usa_cheques, usa_acuerdo, orden) values
  ('descuento_cheques', 'Descuento de cheques', 'Compra de cheques de pago diferido y ECHEQ', 'descuento', true, false, 1),
  ('acuerdo_cc',        'Acuerdo en cuenta corriente', 'Línea de asistencia con límite y tasa pactada', 'vencido', false, true, 2),
  ('prestamo',          'Préstamo a plazo', 'Asistencia financiera con devolución al vencimiento', 'vencido', false, false, 3),
  ('otra',              'Otra operación financiera', 'Operación configurable', 'vencido', false, false, 9);

insert into public.tipos_documento (codigo, nombre, aplica_a, persona, obligatorio, vence, orden) values
  ('dni',               'DNI del titular o representante (frente y dorso)', 'cliente', 'ambas', true, false, 1),
  ('constancia_cuit',   'Constancia de inscripción en ARCA', 'cliente', 'ambas', true, false, 2),
  ('estatuto',          'Estatuto o contrato social', 'cliente', 'juridica', true, false, 3),
  ('acta_autoridades',  'Acta de designación de autoridades', 'cliente', 'juridica', true, true, 4),
  ('poder',             'Poder del firmante', 'cliente', 'juridica', false, true, 5),
  ('balance',           'Último balance certificado', 'cliente', 'juridica', true, true, 6),
  ('ddjj_ganancias',    'DDJJ de Ganancias', 'cliente', 'humana', false, true, 7),
  ('ddjj_pep',          'Declaración jurada PEP', 'cliente', 'ambas', true, false, 8),
  ('ddjj_licitud',      'Declaración jurada de licitud de fondos', 'cliente', 'ambas', true, false, 9),
  ('cbu',               'Constancia de CBU', 'cliente', 'ambas', true, false, 10),
  ('cheque_imagen',     'Imagen del cheque (frente y dorso)', 'operacion', 'ambas', false, false, 20),
  ('liquidacion',       'Liquidación de la operación', 'operacion', 'ambas', false, false, 21),
  ('contrato',          'Contrato o acuerdo firmado', 'operacion', 'ambas', false, false, 22),
  ('otro',              'Otro', 'cliente', 'ambas', false, false, 99);

insert into public.arca_config (id) values (1);

insert into public.configuracion (clave, valor, descripcion) values
  ('empresa', '{"razon_social":"BBX Soluciones Financieras S.A.","email":"bbxsolucionesfinancieras@gmail.com","telefono":"","domicilio":""}', 'Datos institucionales'),
  ('superadmin_inicial', '"bbxsolucionesfinancieras@gmail.com"', 'Email que se convierte en superadministrador al verificarse, si no hay ninguno'),
  ('operaciones', '{"tasa_mensual_default":3.5,"base_dias":365,"gastos_default":0,"comision_default_pct":0}', 'Valores por defecto de nuevas operaciones');
