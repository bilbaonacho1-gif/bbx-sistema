-- =====================================================================
-- Pruebas de seguridad (RLS) y reglas de negocio.
-- Se corren con supabase/tests/run_local.sh sobre una base de prueba.
-- Cada bloque simula un usuario con su JWT (request.jwt.claims) y el rol
-- "authenticated", igual que hace PostgREST en Supabase.
-- =====================================================================
\set ON_ERROR_STOP 1

-- Ayudantes de prueba -------------------------------------------------
create or replace function public.t_login(p_email text) returns void language plpgsql as $$
declare v uuid;
begin
  select id into v from auth.users where email = p_email;
  if v is null then raise exception 'usuario de prueba inexistente %', p_email; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated', 'email', p_email)::text, false);
end $$;

create or replace function public.t_espera_error(p_sql text, p_contiene text default null) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if p_contiene is not null and position(lower(p_contiene) in lower(sqlerrm)) = 0 then
      raise exception 'Error inesperado en [%]: %', p_sql, sqlerrm;
    end if;
    return;
  end;
  raise exception 'Se esperaba un error y no lo hubo: %', p_sql;
end $$;
grant execute on function public.t_login(text), public.t_espera_error(text, text) to authenticated, anon;

-- Usuarios de prueba --------------------------------------------------
insert into auth.users (email, raw_app_meta_data, raw_user_meta_data, email_confirmed_at) values
  ('admin@test.local',     '{"bbx_rol":"administrador"}', '{"nombre":"Ana","apellido":"Admin"}', now()),
  ('operador@test.local',  '{"bbx_rol":"operador"}',      '{"nombre":"Omar","apellido":"Operador"}', now()),
  ('contable@test.local',  '{"bbx_rol":"contable"}',      '{"nombre":"Carla","apellido":"Contable"}', now()),
  ('consulta@test.local',  '{"bbx_rol":"consulta"}',      '{"nombre":"Ciro","apellido":"Consulta"}', now());

-- Un cliente que intenta autoasignarse rol interno por user_metadata: NO debe funcionar
insert into auth.users (email, raw_user_meta_data) values
  ('cliente1@test.local', '{"nombre":"Juan","apellido":"Cliente","razon_social":"DEMO Metalúrgica Andina S.A.","cuit":"30-99999001-7","telefono":"1100000000","bbx_rol":"superadmin"}');
insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values
  ('cliente2@test.local', '{"nombre":"Pía","apellido":"Cliente","razon_social":"DEMO Agroservicios del Litoral S.R.L.","cuit":"30999990025"}', now()),
  ('nuevo@test.local',    '{"nombre":"Nico","apellido":"Nuevo","razon_social":"DEMO Empresa Nueva S.A.","cuit":"33999990040"}', now());

do $$
begin
  assert (select rol from perfiles where email = 'cliente1@test.local') = 'cliente', 'user_metadata no puede dar rol interno';
  assert (select estado from perfiles where email = 'cliente1@test.local') = 'pendiente', 'registro queda pendiente';
  assert (select count(*) from solicitudes_registro where email = 'cliente1@test.local' and cuit = '30999990017') = 1, 'solicitud creada con CUIT normalizado';
  assert (select count(*) from notificaciones n join perfiles p on p.id = n.destinatario_id
           where p.email = 'operador@test.local' and n.tipo = 'registro') = 3, 'el personal recibe aviso de cada registro';
  assert (select estado from perfiles where email = 'admin@test.local') = 'activo', 'personal invitado queda activo';
end $$;

-- CUIT inválido: el registro se rechaza
select t_espera_error($$insert into auth.users (email, raw_user_meta_data) values
  ('malo@test.local', '{"nombre":"X","apellido":"Y","razon_social":"Z","cuit":"30999990018"}')$$, 'CUIT inválido');

-- Superadministrador inicial (email configurado) ----------------------
insert into auth.users (email, raw_user_meta_data) values
  ('bbxsolucionesfinancieras@gmail.com', '{"nombre":"BBX","apellido":"Administración","razon_social":"BBX Soluciones Financieras S.A.","cuit":"30999990033"}');
do $$ begin
  assert (select rol from perfiles where email = 'bbxsolucionesfinancieras@gmail.com') = 'cliente', 'sin verificar email no se promueve';
end $$;
update auth.users set email_confirmed_at = now() where email = 'bbxsolucionesfinancieras@gmail.com';
do $$ begin
  assert (select rol || '/' || estado from perfiles where email = 'bbxsolucionesfinancieras@gmail.com') = 'superadmin/activo', 'al verificar el email pasa a superadmin';
end $$;
-- Un segundo intento con otra cuenta no puede volver a usar el mecanismo
update configuracion set valor = '"cliente2@test.local"' where clave = 'superadmin_inicial';
update auth.users set email_confirmed_at = null where email = 'cliente2@test.local';
update auth.users set email_confirmed_at = now() where email = 'cliente2@test.local';
do $$ begin
  assert (select rol from perfiles where email = 'cliente2@test.local') = 'cliente', 'no se promueve si ya hay un superadmin';
end $$;

-- anon: sin acceso a nada ---------------------------------------------
set role anon;
select t_espera_error('select * from public.clientes', 'permission denied');
select t_espera_error('select * from public.operaciones', 'permission denied');
select t_espera_error($$select public.aprobar_solicitud('00000000-0000-0000-0000-000000000000')$$, 'permission denied');
reset role;

-- Cliente pendiente: no ve datos --------------------------------------
select t_login('cliente1@test.local');
set role authenticated;
do $$ begin
  assert (select count(*) from clientes) = 0, 'pendiente no ve clientes';
  assert (select count(*) from operaciones) = 0, 'pendiente no ve operaciones';
  assert (select count(*) from solicitudes_registro) = 1, 've sólo su propia solicitud';
  assert (select count(*) from perfiles) = 1, 've sólo su perfil';
end $$;
select t_espera_error($$select aprobar_solicitud((select id from solicitudes_registro limit 1))$$, 'No autorizado');
reset role;

-- Aprobación: exige email verificado ----------------------------------
select t_login('operador@test.local');
set role authenticated;
select t_espera_error($$select aprobar_solicitud((select id from solicitudes_registro where email = 'cliente1@test.local'))$$, 'verificó su email');
reset role;
update auth.users set email_confirmed_at = now() where email = 'cliente1@test.local';

select t_login('operador@test.local');
set role authenticated;
-- cliente1 corresponde al cliente DEMO existente con ese CUIT: se vincula a él
select aprobar_solicitud((select id from solicitudes_registro where email = 'cliente1@test.local'));
select aprobar_solicitud((select id from solicitudes_registro where email = 'cliente2@test.local'));
-- nuevo@: crea empresa + cliente + documentación requerida
select aprobar_solicitud((select id from solicitudes_registro where email = 'nuevo@test.local'));
do $$ begin
  assert (select count(*) from v_clientes where razon_social = 'DEMO Empresa Nueva S.A.' and estado = 'en_evaluacion') = 1, 'alta automática del cliente';
  assert (select count(*) from documentos_requeridos d join v_clientes c on c.id = d.cliente_id where c.razon_social = 'DEMO Empresa Nueva S.A.') >= 5, 'documentación obligatoria pedida';
end $$;
select t_espera_error($$select aprobar_solicitud((select id from solicitudes_registro where email = 'nuevo@test.local'))$$, 'ya fue');
reset role;

-- Cliente aprobado: aislamiento ---------------------------------------
select t_login('cliente1@test.local');
set role authenticated;
do $$
declare v_mio uuid := mi_cliente_id();
begin
  assert v_mio is not null, 'cliente vinculado';
  assert (select count(*) from clientes) = 1, 've sólo su cliente';
  assert (select count(*) from empresas) = 1, 've sólo su empresa (no libradores ni otros)';
  assert (select count(*) from operaciones where cliente_id <> v_mio) = 0, 'no ve operaciones ajenas';
  assert (select count(*) from operaciones) = 7, 've sus operaciones';
  assert (select count(*) from operaciones where estado = 'borrador') = 0, 'no ve borradores';
  assert (select count(*) from v_operaciones) = 7, 'la vista respeta RLS';
  assert (select count(*) from notas_internas) = 0, 'no ve notas internas';
  assert (select count(*) from movimientos_contables) = 0, 'no ve contabilidad';
  assert (select count(*) from facturas) = 0, 'no ve facturas en borrador';
  assert (select count(*) from intereses where tipo = 'devengado') = 0, 'no ve devengamientos internos';
  assert (select count(*) from intereses where tipo = 'cobrado') > 0, 've sus intereses cobrados';
  assert (select count(*) from v_estado_cuenta) > 0, 've su estado de cuenta';
  assert (select count(*) from auditoria) = 0, 'no ve auditoría';
  assert (select count(*) from perfiles) = 1, 'no ve otros usuarios';
  assert (select count(*) from notificaciones) >= 1, 've sus notificaciones';
  assert (select count(*) from configuracion) = 0, 'no ve configuración';
  assert (select count(*) from arca_config) = 0, 'no ve configuración fiscal';
end $$;
-- Escrituras prohibidas
select t_espera_error($$insert into operaciones (cliente_id, tipo_codigo, fecha_vencimiento, capital, tasa_interes) values (mi_cliente_id(), 'prestamo', current_date + 30, 1000, 1)$$);
select t_espera_error($$update perfiles set rol = 'superadmin' where id = auth.uid()$$, 'permission denied');
select t_espera_error($$update perfiles set estado = 'activo', cliente_id = null where id = auth.uid()$$, 'permission denied');
select t_espera_error($$insert into pagos (cliente_id, fecha, medio, importe, imputado_capital, registrado_por) values (mi_cliente_id(), current_date, 'efectivo', 1, 1, auth.uid())$$);
select t_espera_error($$select * from arca_tokens$$, 'permission denied');
select t_espera_error($$insert into notas_internas (cliente_id, texto, autor_id) values (mi_cliente_id(), 'x', auth.uid())$$);
select t_espera_error($$select devengar_intereses()$$, 'No autorizado');
select t_espera_error($$select dashboard_resumen()$$, 'No autorizado');
do $$
declare n int;
begin
  update clientes set estado = 'bloqueado';                       get diagnostics n = row_count; assert n = 0, 'no puede editar su cliente';
  update operaciones set capital = 1;                             get diagnostics n = row_count; assert n = 0, 'no puede editar operaciones';
  update perfiles set telefono = '1199999999' where id = auth.uid(); get diagnostics n = row_count; assert n = 1, 'puede editar su teléfono';
end $$;

-- Documentos: sólo en su carpeta y para su cliente
insert into documentos (cliente_id, tipo_codigo, nombre, storage_path, subido_por, subido_por_cliente)
values (mi_cliente_id(), 'balance', 'Balance DEMO.pdf', mi_cliente_id() || '/test-balance.pdf', auth.uid(), true);
select t_espera_error($$insert into documentos (cliente_id, nombre, storage_path, subido_por, subido_por_cliente)
  values ((select id from clientes c where false), 'x', 'x/x.pdf', auth.uid(), true)$$);
select t_espera_error($$insert into documentos (cliente_id, nombre, storage_path, subido_por, subido_por_cliente, estado)
  values (mi_cliente_id(), 'x', mi_cliente_id() || '/aprobado.pdf', auth.uid(), true, 'aprobado')$$);
select t_espera_error($$insert into documentos (cliente_id, nombre, storage_path, subido_por, subido_por_cliente)
  values (mi_cliente_id(), 'x', '00000000-0000-0000-0000-000000000000/otro.pdf', auth.uid(), true)$$);
insert into storage.objects (bucket_id, name, owner) values ('documentos', mi_cliente_id() || '/test-balance.pdf', auth.uid());
select t_espera_error($$insert into storage.objects (bucket_id, name) values ('documentos', '00000000-0000-0000-0000-000000000000/x.pdf')$$);
select t_espera_error($$insert into storage.objects (bucket_id, name) values ('plantillas', 'x/x.pdf')$$);
do $$ begin
  assert (select count(*) from storage.objects) = 1, 've sólo sus archivos';
  assert (select estado from documentos_requeridos where tipo_codigo = 'balance' and cliente_id = mi_cliente_id()) = 'recibido', 'el requerimiento pasa a recibido';
end $$;
reset role;

-- Archivo de otro cliente: invisible para cliente1
insert into storage.objects (bucket_id, name) select 'documentos', c.id || '/ajeno.pdf' from v_clientes c where c.cuit = '30999990025';
insert into documentos (cliente_id, nombre, storage_path, subido_por_cliente)
  select c.id, 'Ajeno', c.id || '/ajeno.pdf', false from v_clientes c where c.cuit = '30999990025';
select t_login('cliente1@test.local');
set role authenticated;
do $$ begin
  assert (select count(*) from storage.objects where name like '%ajeno%') = 0, 'no ve archivos de otro cliente';
  assert (select count(*) from documentos where nombre = 'Ajeno') = 0, 'no ve documentos de otro cliente';
end $$;
reset role;
select t_login('cliente2@test.local');
set role authenticated;
do $$ begin
  assert (select count(*) from storage.objects where name like '%ajeno%') = 1, 'el dueño sí lo ve';
  assert (select count(*) from operaciones) = 2, 'cliente2 ve sólo sus 2 operaciones no borrador';
end $$;
reset role;

-- Rol consulta: sólo lectura ------------------------------------------
select t_login('consulta@test.local');
set role authenticated;
do $$
declare n int;
begin
  assert (select count(*) from clientes) >= 7, 'consulta ve clientes';
  update clientes set estado = 'bloqueado'; get diagnostics n = row_count; assert n = 0, 'consulta no edita';
  assert (select count(*) from auditoria) = 0, 'consulta no ve auditoría';
  assert (dashboard_resumen() ->> 'clientes')::int >= 7, 'consulta ve el dashboard';
end $$;
select t_espera_error($$insert into facturas (cliente_id, tipo_comprobante, punto_venta, concepto, receptor_doc_nro, receptor_razon_social, receptor_condicion_iva) select id, 6, 1, 1, '1', 'x', 5 from clientes limit 1$$);
select t_espera_error($$select cambiar_estado_operacion((select id from operaciones where estado = 'pendiente' limit 1), 'aprobada')$$, 'No autorizado');
reset role;

-- Operador: no puede aprobar operaciones (no tiene operaciones.aprobar)
select t_login('operador@test.local');
set role authenticated;
select t_espera_error($$select cambiar_estado_operacion((select id from operaciones where estado = 'pendiente' limit 1), 'aprobada')$$, 'no puede aprobar');
select cambiar_estado_operacion((select id from operaciones where estado = 'pendiente' limit 1), 'en_analisis', 'Revisando libradores');
select t_espera_error($$select cambiar_estado_operacion((select id from operaciones where estado = 'en_analisis' and tipo_codigo = 'prestamo' limit 1), 'finalizada')$$, 'No se puede pasar');
-- Condiciones financieras bloqueadas tras liquidar
select t_espera_error($$update operaciones set tasa_interes = 1 where estado = 'activa'$$, 'ya fue liquidada');
select t_espera_error($$insert into cheques (operacion_id, numero, banco, fecha_pago, monto) select id, '1', 'x', current_date + 5, 100 from operaciones where estado = 'activa' and tipo_codigo = 'descuento_cheques' limit 1$$, 'ya fue liquidada');
reset role;

-- Administrador: flujo completo de una operación ----------------------
select t_login('admin@test.local');
set role authenticated;
do $$
declare v_op uuid; v_cli uuid; r record; v_pago uuid;
begin
  select id into v_cli from v_clientes where cuit = '30999990025';
  insert into operaciones (cliente_id, tipo_codigo, modalidad, fecha_inicio, fecha_vencimiento, capital, tasa_interes, gastos, comisiones, estado, created_by)
  values (v_cli, 'prestamo', 'vencido', current_date, current_date + 30, 1000000, 3, 1000, 2000, 'pendiente', auth.uid())
  returning id into v_op;
  select * into r from operaciones where id = v_op;
  -- 1.000.000 × 3% × 30 / (365/12) = 29.589,04
  assert r.intereses_pactados = 29589.04, 'interés simple mensual: ' || r.intereses_pactados;
  assert r.importe_total = 1000000 + 29589.04 + 1000 + 2000, 'importe total';
  assert r.importe_liquidado = 1000000, 'importe liquidado';
  perform cambiar_estado_operacion(v_op, 'aprobada', 'OK comité');
  perform cambiar_estado_operacion(v_op, 'activa');
  assert (select count(*) from movimientos where operacion_id = v_op) = 2, 'alta + liquidación';
  assert (select count(*) from intereses where operacion_id = v_op and tipo = 'cobrado') = 0, 'modalidad vencido: nada cobrado al liquidar';
  assert (select count(*) from operacion_estados where operacion_id = v_op) = 3, 'historial de estados';
  assert (select comentario from operacion_estados where operacion_id = v_op and estado_nuevo = 'aprobada') = 'OK comité', 'comentario guardado';

  -- Cobranza parcial imputada a intereses
  insert into pagos (cliente_id, operacion_id, medio, importe, imputado_intereses, registrado_por)
  values (v_cli, v_op, 'transferencia', 10000, 10000, auth.uid()) returning id into v_pago;
  assert (select intereses_cobrados from v_operaciones where id = v_op) = 10000, 'intereses cobrados registrados aparte';
  assert (select intereses_devengados_hoy from v_operaciones where id = v_op) = 0, 'devengado del día 0 = 0 (distinto del cobrado)';
  assert (select count(*) from movimientos_contables where pago_id = v_pago and categoria = 'intereses_cobrados') = 1, 'ingreso contable';
  -- No se puede editar, sí anular
  begin
    update pagos set importe = 1 where id = v_pago;
    raise exception 'debía fallar';
  exception when others then
    assert sqlerrm like '%no se modifica%', sqlerrm;
  end;
  update pagos set anulado = true, anulado_motivo = 'Prueba' where id = v_pago;
  assert (select intereses_cobrados from v_operaciones where id = v_op) = 0, 'anulación revierte el cobrado';
  assert (select bool_and(anulado) from movimientos_contables where pago_id = v_pago), 'asientos anulados';

  -- Cancelación total → finaliza sola
  insert into pagos (cliente_id, operacion_id, medio, importe, imputado_capital, imputado_intereses, imputado_gastos, imputado_comisiones, registrado_por)
  select v_cli, v_op, 'transferencia', importe_total, capital, intereses_pactados, gastos, comisiones, auth.uid() from operaciones where id = v_op;
  assert (select estado from operaciones where id = v_op) = 'finalizada', 'finaliza al saldarse';
  assert (select saldo from v_estado_cuenta where operacion_id = v_op order by fecha desc, created_at desc limit 1) is not null, 'saldo acumulado';

  -- Pago a operación de otro cliente: rechazado
  begin
    insert into pagos (cliente_id, operacion_id, medio, importe, imputado_capital, registrado_por)
    select c.id, v_op, 'efectivo', 1, 1, auth.uid() from clientes c where c.id <> v_cli limit 1;
    raise exception 'debía fallar';
  exception when others then
    assert sqlerrm like '%no pertenece%' or sqlerrm like '%activas%', sqlerrm;
  end;

  -- Devengamiento
  perform devengar_intereses(current_date);
  assert (select count(*) from movimientos where operacion_id = v_op and tipo = 'cobro_capital') = 1, 'movimiento de capital';
end $$;
-- Movimientos inmutables
select t_espera_error($$delete from movimientos where true$$);
select t_espera_error($$update intereses set importe = 0 where true$$);
do $$ begin
  assert (select count(*) from auditoria where tabla = 'operaciones' and usuario_id = auth.uid()) > 0, 'auditoría registra al usuario';
  assert (select count(*) from auditoria where tabla = 'pagos' and accion = 'UPDATE' and cambios ? 'anulado') = 1, 'auditoría con diferencias';
end $$;
reset role;

-- Facturación: nadie puede simular un comprobante autorizado ----------
select t_login('contable@test.local');
set role authenticated;
do $$
declare v_f uuid; v_cli uuid;
begin
  select id into v_cli from v_clientes where cuit = '30999990025';
  insert into facturas (cliente_id, tipo_comprobante, punto_venta, concepto, receptor_doc_nro, receptor_razon_social, receptor_condicion_iva, created_by)
  values (v_cli, 1, 1, 1, '30999990025', 'DEMO Agroservicios del Litoral S.R.L.', 1, auth.uid()) returning id into v_f;
  insert into factura_items (factura_id, descripcion, cantidad, precio_unitario, alicuota_iva_id) values (v_f, 'Comisión', 2, 1000, 5), (v_f, 'Exento', 1, 500, 2);
  assert (select importe_neto || '/' || importe_iva || '/' || importe_exento || '/' || importe_total from facturas where id = v_f) = '2000.00/420.00/500.00/2920.00', 'totales de la factura';
  perform set_config('t.factura', v_f::text, false);
end $$;
select t_espera_error($$insert into facturas (cliente_id, tipo_comprobante, punto_venta, concepto, receptor_doc_nro, receptor_razon_social, receptor_condicion_iva, estado, cae, numero, cae_vencimiento) select id, 1, 1, 1, '1', 'x', 1, 'autorizada', '12345678901234', 1, current_date from clientes limit 1$$, 'ARCA');
select t_espera_error($$update facturas set cae = '12345678901234' where id = current_setting('t.factura')::uuid$$, 'ARCA');
select t_espera_error($$update facturas set estado = 'autorizada', cae = '1', numero = 1, cae_vencimiento = current_date where id = current_setting('t.factura')::uuid$$, 'ARCA');
reset role;

-- Sólo el backend (Edge Function con service_role) autoriza
set role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
update facturas set estado = 'autorizada', numero = 1, cae = '76123456789012', cae_vencimiento = current_date + 10,
       ambiente = 'homologacion', resultado_arca = 'A', autorizada_at = now()
 where id = current_setting('t.factura')::uuid;
reset role;

select t_login('contable@test.local');
set role authenticated;
select t_espera_error($$update facturas set observaciones = 'cambio' where id = current_setting('t.factura')::uuid$$, 'nota de crédito');
select t_espera_error($$delete from factura_items where factura_id = current_setting('t.factura')::uuid$$, 'ARCA');
do $$ declare n int; begin delete from facturas where id = current_setting('t.factura')::uuid; get diagnostics n = row_count; assert n = 0, 'una factura autorizada no se borra'; end $$;
reset role;

select t_login('cliente2@test.local');
set role authenticated;
do $$ begin
  assert (select count(*) from facturas) = 1, 'el cliente ve su factura autorizada (y no el borrador DEMO)';
  assert (select count(*) from factura_items) = 2, 've los ítems de su factura';
end $$;
reset role;

-- Formularios y firma electrónica -------------------------------------
select t_login('nuevo@test.local');
set role authenticated;
select t_espera_error($$select iniciar_formulario((select id from plantillas_formulario where codigo = 'solicitud_descuento'), '{"tipo_cheque":"ECHEQ"}')$$, 'Falta completar');
do $$
declare v_f uuid; v_firma uuid;
begin
  v_f := iniciar_formulario((select id from plantillas_formulario where codigo = 'solicitud_descuento'),
           '{"tipo_cheque":"ECHEQ","cantidad":"2","monto_total":"1500000","fecha_pago":"2027-01-15","librador":"DEMO Librador","cbu":"demo.alias"}');
  assert (select estado from formularios where id = v_f) = 'completado', 'solicitud enviada';
  begin
    perform firmar_formulario(v_f, 'Nico Nuevo', '123', true);
    raise exception 'debía fallar';
  exception when others then assert sqlerrm like '%DNI%', sqlerrm; end;
  v_firma := firmar_formulario(v_f, 'Nico Nuevo', '30111222', true);
  assert (select length(hash_contenido) from firmas where id = v_firma) = 64, 'hash SHA-256 de lo firmado';
  assert (select estado from formularios where id = v_f) = 'firmado', 'formulario firmado';
end $$;
-- No puede firmar formularios ajenos ni alterar firmas
select t_espera_error($$select firmar_formulario((select f.id from formularios f where false), 'x', '30111222', true)$$);
select t_espera_error($$update firmas set hash_contenido = 'x' where true$$, 'permission denied');
reset role;

-- Notificaciones y actividad ------------------------------------------
select t_login('cliente1@test.local');
set role authenticated;
select registrar_actividad('login', '{"origen":"test"}');
select marcar_notificaciones_leidas();
do $$ begin
  assert (select count(*) from notificaciones where leida_at is null) = 0, 'notificaciones marcadas como leídas';
  assert (select count(*) from registro_actividad) = 1, 've su actividad';
  assert (select ultimo_acceso from perfiles where id = auth.uid()) is not null, 'último acceso';
end $$;
select t_espera_error($$select registrar_actividad('DROP TABLE x')$$, 'inválida');
reset role;

-- Gestión de usuarios -------------------------------------------------
select t_login('admin@test.local');
set role authenticated;
select t_espera_error($$select admin_actualizar_usuario((select id from perfiles where email = 'operador@test.local'), 'contable', 'activo')$$, 'No autorizado');
reset role;
select t_login('bbxsolucionesfinancieras@gmail.com');
set role authenticated;
select admin_actualizar_usuario((select id from perfiles where email = 'operador@test.local'), 'contable', 'activo');
select t_espera_error($$select admin_actualizar_usuario(auth.uid(), 'consulta', 'activo')$$, 'propio');
select admin_actualizar_usuario((select id from perfiles where email = 'consulta@test.local'), 'consulta', 'suspendido');
reset role;
select t_login('consulta@test.local');
set role authenticated;
do $$ begin
  assert (select count(*) from clientes) = 0, 'usuario suspendido pierde el acceso';
end $$;
reset role;

-- Limpieza de ayudantes
drop function public.t_login(text);
drop function public.t_espera_error(text, text);
select 'Seguridad y reglas de negocio: OK' as resultado;

-- RPCs de alta atómica (guardar_cliente / guardar_operacion) ------------
create or replace function public.t_login2(p_email text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = p_email), 'role', 'authenticated')::text, false);
$$;
select t_login2('admin@test.local');
set role authenticated;
do $$
declare v_cli uuid; v_op uuid; r record;
begin
  v_cli := guardar_cliente(null, '{"razon_social":"DEMO Prueba RPC S.A.","cuit":"33-99999005-9","tipo_persona":"juridica","condicion_iva":"1"}',
                           '{"estado":"activo","email":"demo.rpc@example.com"}', '{"nombre":"Ana","apellido":"Prueba","dni":"30111222"}');
  assert (select count(*) from contactos where cliente_id = v_cli and es_principal) = 1, 'contacto principal creado';
  begin
    perform guardar_cliente(null, '{"razon_social":"Dup","cuit":"33999990059"}', '{}');
    raise exception 'debía fallar';
  exception when unique_violation then null; end;
  v_op := guardar_operacion(null,
    jsonb_build_object('cliente_id', v_cli, 'tipo_codigo', 'descuento_cheques', 'modalidad', 'descuento', 'fecha_inicio', current_date,
                       'tasa_interes', 3, 'tasa_periodo', 'mensual', 'base_dias', 365, 'gastos', 1000, 'comisiones', 0, 'estado', 'pendiente'),
    jsonb_build_array(
      jsonb_build_object('tipo','echeq','numero','1','banco','DEMO','librador_cuit','30-99999006-8','librador_nombre','DEMO Supermercados Centrales S.A.','fecha_pago', current_date + 30, 'monto', 100000),
      jsonb_build_object('tipo','fisico','numero','2','banco','DEMO','fecha_pago', current_date + 60, 'monto', 200000)));
  select * into r from operaciones where id = v_op;
  assert r.capital = 300000, 'capital = suma de cheques: ' || r.capital;
  assert r.fecha_vencimiento = current_date + 60, 'vence con el último cheque';
  -- 100000×3%×30/30,4167 + 200000×3%×60/30,4167
  assert r.intereses_pactados = round(100000*0.03*30/(365/12.0),2) + round(200000*0.03*60/(365/12.0),2), 'interés por cheque: ' || r.intereses_pactados;
  assert r.importe_liquidado = 300000 - r.intereses_pactados - 1000, 'neto liquidado';
  -- Edición: se reemplazan los cheques
  perform guardar_operacion(v_op, jsonb_build_object('cliente_id', v_cli, 'tipo_codigo', 'descuento_cheques', 'fecha_inicio', current_date, 'tasa_interes', 3, 'gastos', 0),
    jsonb_build_array(jsonb_build_object('numero','3','banco','DEMO','fecha_pago', current_date + 30, 'monto', 50000)));
  assert (select capital from operaciones where id = v_op) = 50000, 'cheques reemplazados';
  assert (select count(*) from cheques where operacion_id = v_op) = 1, 'un cheque';
  assert (simular_operacion(1000000, 3, 'mensual', 365, current_date, current_date + 30, 'vencido') ->> 'intereses')::numeric = 29589.04, 'simulación';
end $$;
reset role;
drop function public.t_login2(text);
select 'RPCs de alta: OK' as resultado;
