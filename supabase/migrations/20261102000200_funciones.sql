-- =====================================================================
-- 02 · Funciones auxiliares, triggers de negocio, auditoría y RPCs
-- =====================================================================

-- ---------------------------------------------------------------------
-- Auxiliares de seguridad (SECURITY DEFINER para poder leer perfiles
-- dentro de las políticas RLS sin recursión)
-- ---------------------------------------------------------------------
create or replace function public.es_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from perfiles p join roles r on r.codigo = p.rol
    where p.id = auth.uid() and p.estado = 'activo' and r.es_interno
  );
$$;

create or replace function public.tiene_permiso(p_permiso text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from perfiles p join roles r on r.codigo = p.rol
    where p.id = auth.uid() and p.estado = 'activo' and r.es_interno
      and (p.rol = 'superadmin'
           or exists (select 1 from rol_permisos rp where rp.rol = p.rol and rp.permiso = p_permiso))
  );
$$;

create or replace function public.mi_cliente_id()
returns uuid language sql stable security definer set search_path = public as $$
  select p.cliente_id from perfiles p
  where p.id = auth.uid() and p.estado = 'activo' and p.rol = 'cliente';
$$;

-- Lista de permisos del usuario actual (para armar el menú en el frontend)
create or replace function public.mis_permisos()
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct x.permiso), '{}') from (
    select pe.codigo as permiso
      from perfiles p join permisos pe on p.rol = 'superadmin'
     where p.id = auth.uid() and p.estado = 'activo'
    union
    select rp.permiso
      from perfiles p join roles r on r.codigo = p.rol and r.es_interno
      join rol_permisos rp on rp.rol = p.rol
     where p.id = auth.uid() and p.estado = 'activo'
  ) x;
$$;

-- ¿La llamada viene del backend (service_role) o de una conexión directa
-- sin JWT (migraciones, consola SQL)? Las requests de usuarios siempre traen JWT.
create or replace function public.es_backend()
returns boolean language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'sin_jwt')
         in ('service_role', 'sin_jwt');
$$;

create or replace function public.ip_request()
returns text language sql stable as $$
  select nullif(split_part(coalesce(
    nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-forwarded-for',
    nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-real-ip', ''), ',', 1), '');
$$;

create or replace function public.user_agent_request()
returns text language sql stable as $$
  select left(nullif(current_setting('request.headers', true), '')::jsonb ->> 'user-agent', 300);
$$;

-- Dígito verificador de CUIT/CUIL
create or replace function public.cuit_valido(p text)
returns boolean language plpgsql immutable as $$
declare
  pesos int[] := array[5,4,3,2,7,6,5,4,3,2];
  s int := 0; dv int;
begin
  if p is null or p !~ '^\d{11}$' then return false; end if;
  for i in 1..10 loop s := s + substr(p, i, 1)::int * pesos[i]; end loop;
  dv := 11 - (s % 11);
  if dv = 11 then dv := 0; elsif dv = 10 then return false; end if;
  return dv = substr(p, 11, 1)::int;
end $$;

-- ---------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------
create or replace function public.tg_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

do $$
declare t text;
begin
  foreach t in array array['empresas','clientes','contactos','perfiles','operaciones','cheques','acuerdos',
                           'facturas','documentos','documentos_requeridos','plantillas_formulario','formularios','arca_config','configuracion']
  loop
    execute format('create trigger trg_%1$s_updated before update on public.%1$I for each row execute function public.tg_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Auditoría genérica (quién cambió qué y cuándo)
-- ---------------------------------------------------------------------
create or replace function public.tg_auditar()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_antes jsonb; v_despues jsonb; v_cambios jsonb; v_id text;
begin
  if tg_op in ('UPDATE','DELETE') then v_antes := to_jsonb(old); end if;
  if tg_op in ('INSERT','UPDATE') then v_despues := to_jsonb(new); end if;
  v_id := coalesce(v_despues ->> 'id', v_antes ->> 'id', v_despues ->> 'codigo', v_antes ->> 'codigo', v_despues ->> 'clave');

  if tg_op = 'UPDATE' then
    select jsonb_object_agg(k, jsonb_build_object('antes', v_antes -> k, 'despues', v_despues -> k))
      into v_cambios
      from jsonb_object_keys(v_despues) k
     where k not in ('updated_at') and (v_antes -> k) is distinct from (v_despues -> k);
    if v_cambios is null then return new; end if;   -- nada relevante cambió
  end if;

  insert into auditoria (tabla, registro_id, accion, datos_antes, datos_despues, cambios, usuario_id, usuario_email, rol_db, ip)
  values (tg_table_name, v_id, tg_op, v_antes, v_despues, v_cambios, auth.uid(),
          nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email',
          coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', current_user),
          ip_request());
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['empresas','clientes','contactos','perfiles','solicitudes_registro','notas_internas',
                           'operaciones','cheques','acuerdos','pagos','movimientos','intereses','movimientos_contables',
                           'facturas','factura_items','arca_config','documentos','documentos_requeridos',
                           'plantillas_formulario','formularios','firmas','rol_permisos','tipos_operacion','configuracion']
  loop
    execute format('create trigger trg_%1$s_auditoria after insert or update or delete on public.%1$I for each row execute function public.tg_auditar()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Notificaciones
-- ---------------------------------------------------------------------
create or replace function public.notificar(p_dest uuid, p_tipo text, p_titulo text, p_mensaje text default null, p_enlace text default null)
returns void language sql security definer set search_path = public as $$
  insert into notificaciones (destinatario_id, tipo, titulo, mensaje, enlace)
  select p_dest, p_tipo, p_titulo, p_mensaje, p_enlace where p_dest is not null;
$$;

-- A todo el personal activo que tenga un permiso
create or replace function public.notificar_permiso(p_permiso text, p_tipo text, p_titulo text, p_mensaje text default null, p_enlace text default null)
returns void language sql security definer set search_path = public as $$
  insert into notificaciones (destinatario_id, tipo, titulo, mensaje, enlace)
  select p.id, p_tipo, p_titulo, p_mensaje, p_enlace
    from perfiles p join roles r on r.codigo = p.rol and r.es_interno
   where p.estado = 'activo'
     and (p.rol = 'superadmin' or exists (select 1 from rol_permisos rp where rp.rol = p.rol and rp.permiso = p_permiso));
$$;

-- A todos los usuarios activos de un cliente
create or replace function public.notificar_cliente(p_cliente uuid, p_tipo text, p_titulo text, p_mensaje text default null, p_enlace text default null)
returns void language sql security definer set search_path = public as $$
  insert into notificaciones (destinatario_id, tipo, titulo, mensaje, enlace)
  select p.id, p_tipo, p_titulo, p_mensaje, p_enlace
    from perfiles p where p.cliente_id = p_cliente and p.rol = 'cliente' and p.estado = 'activo';
$$;

-- ---------------------------------------------------------------------
-- Alta de usuario (trigger en auth.users)
--   * Personal interno: lo crea la Edge Function gestionar-usuario poniendo
--     app_metadata.bbx_rol (los usuarios no pueden escribir app_metadata).
--   * Clientes: se registran desde la web → perfil pendiente + solicitud.
-- ---------------------------------------------------------------------
create or replace function public.tg_nuevo_usuario()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_rol  text := new.raw_app_meta_data ->> 'bbx_rol';
  m      jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_cuit text := regexp_replace(coalesce(m ->> 'cuit', ''), '\D', '', 'g');
begin
  if v_rol is not null and exists (select 1 from roles where codigo = v_rol and es_interno) then
    insert into perfiles (id, email, nombre, apellido, telefono, rol, estado)
    values (new.id, new.email, m ->> 'nombre', m ->> 'apellido', m ->> 'telefono', v_rol, 'activo');
    return new;
  end if;

  -- Usuario creado a mano desde el panel de Supabase (sin datos de registro):
  -- queda pendiente y sin solicitud; un superadmin le asigna rol después.
  if not (m ? 'cuit') then
    insert into perfiles (id, email, nombre, apellido, rol, estado)
    values (new.id, new.email, m ->> 'nombre', m ->> 'apellido', 'cliente', 'pendiente');
    return new;
  end if;

  if coalesce(trim(m ->> 'nombre'), '') = '' or coalesce(trim(m ->> 'apellido'), '') = ''
     or coalesce(trim(m ->> 'razon_social'), '') = '' then
    raise exception 'Faltan datos obligatorios del registro' using errcode = '22023';
  end if;
  if not cuit_valido(v_cuit) then
    raise exception 'CUIT inválido' using errcode = '22023';
  end if;

  insert into perfiles (id, email, nombre, apellido, telefono, rol, estado)
  values (new.id, new.email, trim(m ->> 'nombre'), trim(m ->> 'apellido'), trim(m ->> 'telefono'), 'cliente', 'pendiente');

  insert into solicitudes_registro (user_id, nombre, apellido, razon_social, cuit, email, telefono)
  values (new.id, trim(m ->> 'nombre'), trim(m ->> 'apellido'), left(trim(m ->> 'razon_social'), 200), v_cuit, new.email, trim(m ->> 'telefono'));

  perform notificar_permiso('registros.aprobar', 'registro',
    'Nueva solicitud de acceso',
    format('%s %s (%s, CUIT %s) pidió acceso al portal.', trim(m ->> 'nombre'), trim(m ->> 'apellido'), trim(m ->> 'razon_social'), v_cuit),
    '#/solicitudes');
  return new;
end $$;

create trigger trg_auth_nuevo_usuario
  after insert on auth.users for each row execute function public.tg_nuevo_usuario();

-- Superadministrador inicial: la cuenta cuyo email figura en
-- configuracion.superadmin_inicial pasa a superadmin al verificar su email,
-- sólo si todavía no existe ningún superadmin activo.
create or replace function public.promover_superadmin_inicial(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_email text; v_conf timestamptz; v_obj text;
begin
  select email, email_confirmed_at into v_email, v_conf from auth.users where id = p_user;
  select valor #>> '{}' into v_obj from configuracion where clave = 'superadmin_inicial';
  if v_conf is null or v_obj is null or lower(v_email) <> lower(v_obj) then return; end if;
  if exists (select 1 from perfiles where rol = 'superadmin' and estado = 'activo') then return; end if;
  update perfiles set rol = 'superadmin', estado = 'activo', cliente_id = null where id = p_user;
  update solicitudes_registro set estado = 'aprobada', revisado_at = now() where user_id = p_user and estado = 'pendiente';
end $$;
revoke execute on function public.promover_superadmin_inicial(uuid) from public, anon, authenticated;

create or replace function public.tg_usuario_confirmado()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.email_confirmed_at is not null and (tg_op = 'INSERT' or old.email_confirmed_at is null) then
    perform promover_superadmin_inicial(new.id);
  end if;
  return new;
end $$;

create trigger trg_auth_usuario_confirmado
  after insert or update of email_confirmed_at on auth.users
  for each row execute function public.tg_usuario_confirmado();

-- Mantener el email del perfil sincronizado
create or replace function public.tg_usuario_email()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.email is distinct from old.email then
    update perfiles set email = new.email where id = new.id;
  end if;
  return new;
end $$;

create trigger trg_auth_usuario_email
  after update of email on auth.users for each row execute function public.tg_usuario_email();

-- El usuario no puede cambiarse rol, estado ni cliente (defensa además de los GRANT por columna)
create or replace function public.tg_perfiles_proteger()
returns trigger language plpgsql as $$
begin
  -- current_user es 'authenticated' en requests directas; dentro de las RPC
  -- SECURITY DEFINER (aprobar_solicitud, etc.) es el dueño de la función.
  if current_user in ('authenticated','anon') and not tiene_permiso('usuarios.gestionar')
     and (new.rol is distinct from old.rol or new.estado is distinct from old.estado
          or new.cliente_id is distinct from old.cliente_id or new.email is distinct from old.email) then
    raise exception 'No autorizado a modificar rol, estado o cliente' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger trg_perfiles_proteger before update on public.perfiles
  for each row execute function public.tg_perfiles_proteger();

-- ---------------------------------------------------------------------
-- Operaciones: cálculo de intereses e importes
-- ---------------------------------------------------------------------
-- Interés simple: tasa mensual → días / (base/12); tasa anual → días / base
create or replace function public.calcular_interes(p_capital numeric, p_tasa numeric, p_periodo text, p_base int, p_dias int)
returns numeric language sql immutable as $$
  select round(
    p_capital * p_tasa / 100 * greatest(p_dias, 0)
    / case when p_periodo = 'mensual' then p_base / 12.0 else p_base::numeric end
  , 2);
$$;

create or replace function public.tg_operaciones_calcular()
returns trigger language plpgsql as $$
declare
  v_tipo tipos_operacion%rowtype;
  v_cant int; v_suma numeric; v_int numeric; v_venc date;
  financieros_cambiaron boolean;
begin
  select * into v_tipo from tipos_operacion where codigo = new.tipo_codigo;

  -- Una vez liquidada, la operación no puede cambiar sus condiciones financieras
  if tg_op = 'UPDATE' and old.estado in ('activa','en_mora','finalizada','cancelada') then
    financieros_cambiaron := (new.capital, new.tasa_interes, new.tasa_periodo, new.base_dias, new.fecha_inicio,
                              new.fecha_vencimiento, new.intereses_pactados, new.gastos, new.comisiones,
                              new.iva_comisiones, new.modalidad, new.cliente_id, new.tipo_codigo)
                         is distinct from
                             (old.capital, old.tasa_interes, old.tasa_periodo, old.base_dias, old.fecha_inicio,
                              old.fecha_vencimiento, old.intereses_pactados, old.gastos, old.comisiones,
                              old.iva_comisiones, old.modalidad, old.cliente_id, old.tipo_codigo);
    if financieros_cambiaron and not es_backend() then
      raise exception 'La operación % ya fue liquidada: sus condiciones financieras no se pueden modificar', old.numero
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- Descuento de cheques: capital, vencimiento e intereses salen de los cheques cargados
  if v_tipo.usa_cheques and tg_op = 'UPDATE' then
    select count(*), sum(monto), max(fecha_pago),
           sum(calcular_interes(monto, new.tasa_interes, new.tasa_periodo, new.base_dias, fecha_pago - new.fecha_inicio))
      into v_cant, v_suma, v_venc, v_int
      from cheques where operacion_id = new.id and estado not in ('devuelto');
    if v_cant > 0 then
      new.capital := v_suma;
      new.fecha_vencimiento := greatest(v_venc, new.fecha_inicio + 1);
      new.intereses_pactados := v_int;
    end if;
  end if;

  if not coalesce(v_tipo.usa_cheques and v_cant > 0, false) then
    new.intereses_pactados := calcular_interes(new.capital, new.tasa_interes, new.tasa_periodo, new.base_dias,
                                               new.fecha_vencimiento - new.fecha_inicio);
  end if;

  if new.modalidad = 'descuento' then
    new.importe_total := new.capital;
    new.importe_liquidado := new.capital - new.intereses_pactados - new.gastos - new.comisiones - new.iva_comisiones;
  else
    new.importe_total := new.capital + new.intereses_pactados + new.gastos + new.comisiones + new.iva_comisiones;
    new.importe_liquidado := new.capital;
  end if;

  -- (al dar de alta un descuento todavía no hay cheques: se valida al cargarlos)
  if new.importe_liquidado <= 0 and not (tg_op = 'INSERT' and v_tipo.usa_cheques) then
    raise exception 'El importe a liquidar resulta negativo o cero: revisá tasa, gastos y comisiones' using errcode = '22023';
  end if;
  return new;
end $$;

create trigger trg_operaciones_calcular before insert or update on public.operaciones
  for each row execute function public.tg_operaciones_calcular();

-- Cheques: recalcular la operación y registrar acreditaciones
create or replace function public.tg_cheques_cambios()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_op operaciones%rowtype;
begin
  select * into v_op from operaciones where id = coalesce(new.operacion_id, old.operacion_id);

  if tg_op = 'INSERT' or tg_op = 'DELETE'
     or (new.monto, new.fecha_pago, new.estado) is distinct from (old.monto, old.fecha_pago, old.estado) then
    if v_op.estado in ('borrador','pendiente','en_analisis','aprobada') then
      update operaciones set updated_at = now() where id = v_op.id;   -- dispara el recálculo
    elsif tg_op <> 'UPDATE' or new.monto is distinct from old.monto or new.fecha_pago is distinct from old.fecha_pago then
      raise exception 'La operación % ya fue liquidada: no se pueden agregar, quitar ni modificar cheques', v_op.numero
        using errcode = '42501';
    end if;
  end if;

  if tg_op = 'UPDATE' and new.estado is distinct from old.estado then
    if new.estado = 'acreditado' and v_op.estado in ('activa','en_mora') then
      insert into pagos (cliente_id, operacion_id, fecha, medio, referencia, importe, imputado_capital, registrado_por, es_demo, observaciones)
      values (v_op.cliente_id, v_op.id, least(current_date, greatest(new.fecha_pago, coalesce(v_op.fecha_liquidacion, new.fecha_pago))), 'acreditacion_cheque',
              format('Cheque %s · %s', new.numero, new.banco), new.monto, new.monto, auth.uid(), new.es_demo,
              'Generado automáticamente al acreditarse el cheque');
    elsif new.estado = 'rechazado' then
      perform notificar_permiso('operaciones.ver', 'cheque_rechazado', 'Cheque rechazado',
        format('Cheque %s (%s) de la operación %s fue rechazado.', new.numero, new.banco, v_op.numero),
        '#/operaciones/' || v_op.id);
      perform notificar_cliente(v_op.cliente_id, 'cheque_rechazado', 'Cheque rechazado',
        format('El cheque %s de la operación %s fue rechazado. Comunicate con BBX.', new.numero, v_op.numero),
        '#/operaciones/' || v_op.id);
    end if;
  end if;
  return coalesce(new, old);
end $$;

create trigger trg_cheques_cambios after insert or update or delete on public.cheques
  for each row execute function public.tg_cheques_cambios();

-- Cambios de estado de la operación: historial + efectos contables al liquidar
create or replace function public.tg_operaciones_estado()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_coment text := nullif(current_setting('bbx.comentario', true), '');
  v_demo boolean := new.es_demo;
begin
  if tg_op = 'INSERT' then
    insert into operacion_estados (operacion_id, estado_anterior, estado_nuevo, comentario, usuario_id)
    values (new.id, null, new.estado, coalesce(v_coment, 'Alta de la operación'), auth.uid());
    return new;
  end if;
  if new.estado is not distinct from old.estado then return new; end if;

  insert into operacion_estados (operacion_id, estado_anterior, estado_nuevo, comentario, usuario_id)
  values (new.id, old.estado, new.estado, v_coment, auth.uid());

  -- Liquidación: la operación pasa a activa
  if new.estado = 'activa' and old.estado in ('borrador','pendiente','en_analisis','aprobada') then
    insert into movimientos (cliente_id, operacion_id, fecha, tipo, sentido, concepto, importe, registrado_por, es_demo)
    values
      (new.cliente_id, new.id, coalesce(new.fecha_liquidacion, current_date), 'alta_operacion', 'cargo',
       format('Alta de la operación %s', new.numero), new.importe_total, auth.uid(), v_demo),
      (new.cliente_id, new.id, coalesce(new.fecha_liquidacion, current_date), 'liquidacion', 'informativo',
       format('Liquidación de la operación %s (importe entregado)', new.numero), new.importe_liquidado, auth.uid(), v_demo);

    insert into movimientos_contables (fecha, tipo, categoria, concepto, importe, cliente_id, operacion_id, automatico, registrado_por, es_demo)
    values (coalesce(new.fecha_liquidacion, current_date), 'egreso', 'desembolso',
            format('Desembolso operación %s', new.numero), new.importe_liquidado, new.cliente_id, new.id, true, auth.uid(), v_demo);

    -- En la modalidad "descuento" los intereses, gastos y comisiones se retienen al liquidar:
    -- quedan COBRADOS hoy (por adelantado) y se DEVENGAN a lo largo del plazo.
    if new.modalidad = 'descuento' then
      if new.intereses_pactados > 0 then
        insert into intereses (operacion_id, cliente_id, tipo, fecha, importe, observaciones, es_demo)
        values (new.id, new.cliente_id, 'cobrado', coalesce(new.fecha_liquidacion, current_date), new.intereses_pactados,
                'Intereses retenidos en la liquidación (cobrados por adelantado)', v_demo);
        insert into movimientos_contables (fecha, tipo, categoria, concepto, importe, cliente_id, operacion_id, automatico, registrado_por, es_demo)
        values (coalesce(new.fecha_liquidacion, current_date), 'ingreso', 'intereses_cobrados',
                format('Intereses retenidos operación %s', new.numero), new.intereses_pactados, new.cliente_id, new.id, true, auth.uid(), v_demo);
      end if;
      if new.comisiones + new.iva_comisiones > 0 then
        insert into movimientos_contables (fecha, tipo, categoria, concepto, importe, cliente_id, operacion_id, automatico, registrado_por, es_demo)
        values (coalesce(new.fecha_liquidacion, current_date), 'ingreso', 'comisiones',
                format('Comisiones retenidas operación %s', new.numero), new.comisiones + new.iva_comisiones, new.cliente_id, new.id, true, auth.uid(), v_demo);
      end if;
      if new.gastos > 0 then
        insert into movimientos_contables (fecha, tipo, categoria, concepto, importe, cliente_id, operacion_id, automatico, registrado_por, es_demo)
        values (coalesce(new.fecha_liquidacion, current_date), 'ingreso', 'gastos_recuperados',
                format('Gastos retenidos operación %s', new.numero), new.gastos, new.cliente_id, new.id, true, auth.uid(), v_demo);
      end if;
    end if;

    perform notificar_cliente(new.cliente_id, 'operacion', 'Operación liquidada',
      format('La operación %s fue liquidada.', new.numero), '#/operaciones/' || new.id);
  elsif new.estado in ('aprobada','rechazada') then
    perform notificar_cliente(new.cliente_id, 'operacion',
      case new.estado when 'aprobada' then 'Operación aprobada' else 'Operación rechazada' end,
      format('La operación %s cambió a estado %s.', new.numero, new.estado), '#/operaciones/' || new.id);
  end if;
  return new;
end $$;

create trigger trg_operaciones_estado after insert or update of estado on public.operaciones
  for each row execute function public.tg_operaciones_estado();

-- ---------------------------------------------------------------------
-- Cobranzas: imputación → movimientos, intereses cobrados y contabilidad
-- ---------------------------------------------------------------------
create or replace function public.saldo_operacion(p_op uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select o.importe_total
         - case when o.modalidad = 'descuento'
                then coalesce((select sum(p.imputado_capital) from pagos p where p.operacion_id = o.id and not p.anulado), 0)
                else coalesce((select sum(p.importe) from pagos p where p.operacion_id = o.id and not p.anulado), 0) end
    from operaciones o where o.id = p_op;
$$;

create or replace function public.tg_pagos_alta()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_op operaciones%rowtype;
  v_ref text;
begin
  if new.operacion_id is not null then
    select * into v_op from operaciones where id = new.operacion_id;
    if v_op.cliente_id <> new.cliente_id then
      raise exception 'La operación no pertenece al cliente indicado' using errcode = '22023';
    end if;
    if v_op.estado not in ('activa','en_mora') then
      raise exception 'Sólo se pueden registrar cobranzas sobre operaciones activas o en mora' using errcode = '22023';
    end if;
    if v_op.modalidad = 'descuento' and new.imputado_intereses > 0 then
      raise exception 'En operaciones con descuento los intereses ya se cobraron al liquidar' using errcode = '22023';
    end if;
  end if;
  v_ref := coalesce(' · ' || v_op.numero, '');

  insert into movimientos (cliente_id, operacion_id, pago_id, fecha, tipo, sentido, concepto, importe, registrado_por, es_demo)
  select new.cliente_id, new.operacion_id, new.id, new.fecha, t.tipo, 'abono', t.concepto || v_ref, t.importe, new.registrado_por, new.es_demo
    from (values ('cobro_capital', 'Cobro de capital', new.imputado_capital),
                 ('cobro_intereses', 'Cobro de intereses', new.imputado_intereses),
                 ('cobro_gastos', 'Cobro de gastos', new.imputado_gastos),
                 ('cobro_comisiones', 'Cobro de comisiones', new.imputado_comisiones)) t(tipo, concepto, importe)
   where t.importe > 0;

  if new.imputado_intereses > 0 then
    insert into intereses (operacion_id, cliente_id, tipo, fecha, importe, pago_id, es_demo, observaciones)
    values (new.operacion_id, new.cliente_id, 'cobrado', new.fecha, new.imputado_intereses, new.id, new.es_demo, 'Cobranza');
  end if;

  insert into movimientos_contables (fecha, tipo, categoria, concepto, importe, cliente_id, operacion_id, pago_id, medio, automatico, registrado_por, es_demo)
  select new.fecha, 'ingreso', t.cat, t.concepto || v_ref, t.importe, new.cliente_id, new.operacion_id, new.id, new.medio, true, new.registrado_por, new.es_demo
    from (values ('cobro_capital', 'Cobro de capital', new.imputado_capital),
                 ('intereses_cobrados', 'Intereses cobrados', new.imputado_intereses),
                 ('gastos_recuperados', 'Gastos cobrados', new.imputado_gastos),
                 ('comisiones', 'Comisiones cobradas', new.imputado_comisiones)) t(cat, concepto, importe)
   where t.importe > 0;

  -- Si la deuda quedó saldada, la operación se finaliza
  if new.operacion_id is not null and saldo_operacion(new.operacion_id) <= 0 then
    perform set_config('bbx.comentario', 'Finalizada automáticamente: saldo cancelado', true);
    update operaciones set estado = 'finalizada', fecha_finalizacion = new.fecha where id = new.operacion_id;
    perform set_config('bbx.comentario', '', true);
  end if;

  perform notificar_cliente(new.cliente_id, 'pago', 'Pago registrado',
    format('Registramos un pago de $ %s%s.', to_char(new.importe, 'FM999G999G999G990D00'), v_ref), '#/estado-cuenta');
  return new;
end $$;

create trigger trg_pagos_alta after insert on public.pagos
  for each row execute function public.tg_pagos_alta();

create or replace function public.tg_pagos_cambios()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.importe, new.imputado_capital, new.imputado_intereses, new.imputado_gastos, new.imputado_comisiones,
      new.cliente_id, new.operacion_id, new.fecha)
     is distinct from
     (old.importe, old.imputado_capital, old.imputado_intereses, old.imputado_gastos, old.imputado_comisiones,
      old.cliente_id, old.operacion_id, old.fecha) then
    raise exception 'Una cobranza registrada no se modifica: anulala y registrala de nuevo' using errcode = '42501';
  end if;
  if old.anulado and not new.anulado then
    raise exception 'Una cobranza anulada no se puede reactivar' using errcode = '42501';
  end if;
  if new.anulado and not old.anulado then
    if coalesce(trim(new.anulado_motivo), '') = '' then
      raise exception 'Indicá el motivo de la anulación' using errcode = '22023';
    end if;
    insert into movimientos (cliente_id, operacion_id, pago_id, fecha, tipo, sentido, concepto, importe, registrado_por, es_demo)
    values (new.cliente_id, new.operacion_id, new.id, current_date, 'anulacion', 'cargo',
            'Anulación de cobranza: ' || new.anulado_motivo, new.importe, auth.uid(), new.es_demo);
    if new.imputado_intereses > 0 then
      insert into intereses (operacion_id, cliente_id, tipo, fecha, importe, pago_id, es_demo, observaciones)
      values (new.operacion_id, new.cliente_id, 'cobrado', current_date, -new.imputado_intereses, new.id, new.es_demo, 'Reversión por anulación de cobranza');
    end if;
    update movimientos_contables set anulado = true where pago_id = new.id;
    -- Si la operación estaba finalizada por este pago, vuelve a activa
    if new.operacion_id is not null and saldo_operacion(new.operacion_id) > 0 then
      perform set_config('bbx.comentario', 'Reabierta por anulación de cobranza', true);
      update operaciones set estado = case when fecha_vencimiento < current_date then 'en_mora' else 'activa' end,
                             fecha_finalizacion = null
       where id = new.operacion_id and estado = 'finalizada';
      perform set_config('bbx.comentario', '', true);
    end if;
  end if;
  return new;
end $$;

create trigger trg_pagos_cambios before update on public.pagos
  for each row execute function public.tg_pagos_cambios();

-- Movimientos, intereses y asientos automáticos no se editan ni borran desde la app
create or replace function public.tg_inmutable()
returns trigger language plpgsql as $$
begin
  if not es_backend() then
    if tg_table_name = 'movimientos_contables' and tg_op = 'UPDATE'
       and (to_jsonb(new) - 'anulado') = (to_jsonb(old) - 'anulado') and not old.automatico then
      return new;   -- se permite anular un asiento manual
    end if;
    raise exception 'Los registros de % no se modifican: registrá un ajuste o una anulación', tg_table_name
      using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;

create trigger trg_movimientos_inmutable before update or delete on public.movimientos
  for each row execute function public.tg_inmutable();
create trigger trg_intereses_inmutable before update or delete on public.intereses
  for each row execute function public.tg_inmutable();
create trigger trg_mc_inmutable before update or delete on public.movimientos_contables
  for each row when (pg_trigger_depth() = 0) execute function public.tg_inmutable();

-- ---------------------------------------------------------------------
-- Facturación: totales y protección de los datos fiscales
-- ---------------------------------------------------------------------
create or replace function public.alicuota_iva(p_id int)
returns numeric language sql immutable as $$
  select case p_id when 3 then 0 when 4 then 10.5 when 5 then 21 when 6 then 27 when 8 then 5 when 9 then 2.5 else 0 end;
$$;

create or replace function public.recalcular_factura(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_tipo int;
begin
  select tipo_comprobante into v_tipo from facturas where id = p_id;
  update facturas f set
    importe_neto       = coalesce(x.neto, 0),
    importe_iva        = coalesce(x.iva, 0),
    importe_exento     = coalesce(x.exento, 0),
    importe_no_gravado = coalesce(x.no_gravado, 0),
    importe_total      = coalesce(x.neto, 0) + coalesce(x.iva, 0) + coalesce(x.exento, 0) + coalesce(x.no_gravado, 0) + f.importe_tributos
  from (
    select sum(importe_neto) filter (where alicuota_iva_id not in (1,2)) as neto,
           sum(importe_iva) as iva,
           sum(importe_neto) filter (where alicuota_iva_id = 2) as exento,
           sum(importe_neto) filter (where alicuota_iva_id = 1) as no_gravado
      from factura_items where factura_id = p_id
  ) x
  where f.id = p_id and f.estado in ('borrador','rechazada');
end $$;

create or replace function public.tg_factura_items()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_f facturas%rowtype;
begin
  select * into v_f from facturas where id = coalesce(new.factura_id, old.factura_id);
  if v_f.estado not in ('borrador','rechazada') then
    raise exception 'La factura ya fue enviada a ARCA: no se pueden modificar sus ítems' using errcode = '42501';
  end if;
  if tg_op <> 'DELETE' then
    new.importe_neto := round(new.cantidad * new.precio_unitario, 2);
    -- Factura C (monotributo/exento): no se discrimina IVA
    if v_f.tipo_comprobante in (11,12,13) then
      new.alicuota_iva_id := 3;
      new.importe_iva := 0;
    else
      new.importe_iva := round(new.importe_neto * alicuota_iva(new.alicuota_iva_id) / 100, 2);
    end if;
  end if;
  return coalesce(new, old);
end $$;

create trigger trg_factura_items_calc before insert or update or delete on public.factura_items
  for each row execute function public.tg_factura_items();

create or replace function public.tg_factura_items_total()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform recalcular_factura(coalesce(new.factura_id, old.factura_id));
  return null;
end $$;

create trigger trg_factura_items_total after insert or update or delete on public.factura_items
  for each row execute function public.tg_factura_items_total();

-- Sólo el backend (Edge Function con service_role) puede marcar una factura como
-- enviada/autorizada, asignar número o CAE. Así nadie puede "simular" un comprobante.
create or replace function public.tg_facturas_proteger()
returns trigger language plpgsql as $$
begin
  if es_backend() then return coalesce(new, old); end if;

  if tg_op = 'DELETE' then
    if old.estado <> 'borrador' then
      raise exception 'Sólo se pueden eliminar facturas en borrador' using errcode = '42501';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.estado <> 'borrador' or new.cae is not null or new.numero is not null or new.cae_vencimiento is not null
       or new.resultado_arca is not null or new.autorizada_at is not null then
      raise exception 'Las facturas se crean en borrador; el CAE lo asigna ARCA' using errcode = '42501';
    end if;
    return new;
  end if;

  if old.estado not in ('borrador','rechazada') then
    raise exception 'La factura % ya fue enviada a ARCA y no se puede modificar. Para corregirla emití una nota de crédito.', coalesce(old.numero::text, old.id::text)
      using errcode = '42501';
  end if;
  if new.estado not in ('borrador','rechazada') and new.estado <> 'anulada'
     or (new.cae, new.numero, new.cae_vencimiento, new.resultado_arca, new.autorizada_at, new.enviada_at, new.ambiente)
        is distinct from (old.cae, old.numero, old.cae_vencimiento, old.resultado_arca, old.autorizada_at, old.enviada_at, old.ambiente) then
    raise exception 'Los datos fiscales (estado, número, CAE) sólo los asigna ARCA' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger trg_facturas_proteger before insert or update or delete on public.facturas
  for each row execute function public.tg_facturas_proteger();

create or replace function public.tg_facturas_autorizada()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.estado = 'autorizada' and old.estado is distinct from 'autorizada' then
    perform notificar_cliente(new.cliente_id, 'factura', 'Nueva factura disponible',
      format('Se emitió el comprobante %s-%s.', lpad(new.punto_venta::text, 5, '0'), lpad(new.numero::text, 8, '0')),
      '#/estado-cuenta');
  end if;
  return new;
end $$;

create trigger trg_facturas_autorizada after update of estado on public.facturas
  for each row execute function public.tg_facturas_autorizada();

-- ---------------------------------------------------------------------
-- Documentos: avisos y requerimientos
-- ---------------------------------------------------------------------
create or replace function public.tg_documentos()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_razon text;
begin
  if tg_op = 'INSERT' then
    if new.subido_por_cliente then
      select e.razon_social into v_razon from clientes c join empresas e on e.id = c.empresa_id where c.id = new.cliente_id;
      perform notificar_permiso('documentos.revisar', 'documento', 'Nuevo documento para revisar',
        format('%s subió "%s".', v_razon, new.nombre), '#/clientes/' || new.cliente_id || '?tab=documentos');
      update documentos_requeridos set estado = 'recibido', documento_id = new.id
       where id = (select id from documentos_requeridos
                    where cliente_id = new.cliente_id and estado = 'pendiente'
                      and tipo_codigo is not distinct from new.tipo_codigo
                      and (operacion_id is null or operacion_id is not distinct from new.operacion_id)
                    order by created_at limit 1);
    else
      perform notificar_cliente(new.cliente_id, 'documento', 'Nuevo documento disponible',
        format('BBX compartió "%s".', new.nombre), '#/documentacion');
    end if;
    return new;
  end if;

  if new.estado is distinct from old.estado then
    if new.estado = 'aprobado' then
      update documentos_requeridos set estado = 'cumplido' where documento_id = new.id;
    elsif new.estado = 'rechazado' then
      update documentos_requeridos set estado = 'pendiente', documento_id = null where documento_id = new.id;
    end if;
    if new.estado in ('aprobado','rechazado') then
      perform notificar_cliente(new.cliente_id, 'documento',
        case new.estado when 'aprobado' then 'Documento aprobado' else 'Documento rechazado' end,
        format('"%s"%s', new.nombre, coalesce(': ' || new.observacion_revision, '')), '#/documentacion');
    end if;
  end if;
  return new;
end $$;

create trigger trg_documentos after insert or update on public.documentos
  for each row execute function public.tg_documentos();

create or replace function public.tg_doc_requerido_alta()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform notificar_cliente(new.cliente_id, 'documento', 'Documentación pendiente',
    format('BBX te pidió: %s.', new.descripcion), '#/documentacion');
  return new;
end $$;

create trigger trg_doc_requerido_alta after insert on public.documentos_requeridos
  for each row when (pg_trigger_depth() = 0) execute function public.tg_doc_requerido_alta();

create or replace function public.tg_formularios_alta()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_nombre text;
begin
  select nombre into v_nombre from plantillas_formulario where id = new.plantilla_id;
  if not new.iniciado_por_cliente then
    perform notificar_cliente(new.cliente_id, 'formulario', 'Formulario para completar',
      format('Tenés pendiente: %s.', v_nombre), '#/formularios');
  end if;
  return new;
end $$;

create trigger trg_formularios_alta after insert on public.formularios
  for each row execute function public.tg_formularios_alta();

-- =====================================================================
-- RPCs (lo que la app llama con supabase.rpc)
-- =====================================================================

-- Registro de actividad (login, logout, descargas…)
create or replace function public.registrar_actividad(p_accion text, p_detalle jsonb default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  if p_accion !~ '^[a-z_.]{2,40}$' then raise exception 'Acción inválida' using errcode = '22023'; end if;
  insert into registro_actividad (usuario_id, accion, detalle, ip, user_agent)
  values (auth.uid(), p_accion, p_detalle, ip_request(), user_agent_request());
  if p_accion = 'login' then
    update perfiles set ultimo_acceso = now() where id = auth.uid();
  end if;
end $$;

create or replace function public.marcar_notificaciones_leidas(p_ids uuid[] default null)
returns void language sql security definer set search_path = public as $$
  update notificaciones set leida_at = now()
   where destinatario_id = auth.uid() and leida_at is null and (p_ids is null or id = any(p_ids));
$$;

-- Aprobar una solicitud: crea (o vincula) empresa + cliente y habilita el portal
create or replace function public.aprobar_solicitud(p_solicitud uuid, p_cliente_id uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  s solicitudes_registro%rowtype;
  v_empresa uuid; v_cliente uuid; v_confirmado timestamptz;
begin
  if not tiene_permiso('registros.aprobar') then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  select * into s from solicitudes_registro where id = p_solicitud for update;
  if not found then raise exception 'Solicitud inexistente' using errcode = 'P0002'; end if;
  if s.estado <> 'pendiente' then raise exception 'La solicitud ya fue %', s.estado using errcode = '22023'; end if;

  select email_confirmed_at into v_confirmado from auth.users where id = s.user_id;
  if v_confirmado is null then
    raise exception 'El solicitante todavía no verificó su email' using errcode = '22023';
  end if;

  if p_cliente_id is not null then
    v_cliente := p_cliente_id;
    if not exists (select 1 from clientes where id = v_cliente) then
      raise exception 'Cliente inexistente' using errcode = 'P0002';
    end if;
  else
    select id into v_empresa from empresas where cuit = s.cuit;
    if v_empresa is null then
      insert into empresas (razon_social, cuit, tipo_persona)
      values (s.razon_social, s.cuit, case when left(s.cuit, 2) in ('30','33','34') then 'juridica' else 'humana' end)
      returning id into v_empresa;
    end if;
    select id into v_cliente from clientes where empresa_id = v_empresa;
    if v_cliente is null then
      insert into clientes (empresa_id, email, telefono, estado, created_by)
      values (v_empresa, s.email, s.telefono, 'en_evaluacion', auth.uid())
      returning id into v_cliente;
      insert into contactos (cliente_id, nombre, apellido, email, telefono, es_principal, es_firmante)
      values (v_cliente, s.nombre, s.apellido, s.email, s.telefono, true, true);
      -- Documentación obligatoria para el alta
      insert into documentos_requeridos (cliente_id, tipo_codigo, descripcion, solicitado_por)
      select v_cliente, t.codigo, t.nombre, auth.uid()
        from tipos_documento t, empresas e
       where e.id = v_empresa and t.aplica_a = 'cliente' and t.obligatorio
         and t.persona in ('ambas', e.tipo_persona);
    end if;
  end if;

  update perfiles set estado = 'activo', cliente_id = v_cliente where id = s.user_id;
  update solicitudes_registro
     set estado = 'aprobada', cliente_id = v_cliente, revisado_por = auth.uid(), revisado_at = now()
   where id = s.id;

  perform notificar(s.user_id, 'registro', 'Tu acceso fue aprobado',
    'Ya podés usar el portal de clientes de BBX.', '#/cuenta');
  return v_cliente;
end $$;

create or replace function public.rechazar_solicitud(p_solicitud uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare s solicitudes_registro%rowtype;
begin
  if not tiene_permiso('registros.aprobar') then raise exception 'No autorizado' using errcode = '42501'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Indicá el motivo' using errcode = '22023'; end if;
  select * into s from solicitudes_registro where id = p_solicitud for update;
  if not found or s.estado <> 'pendiente' then raise exception 'Solicitud inexistente o ya revisada' using errcode = '22023'; end if;
  update solicitudes_registro set estado = 'rechazada', motivo_rechazo = trim(p_motivo), revisado_por = auth.uid(), revisado_at = now()
   where id = s.id;
  update perfiles set estado = 'rechazado' where id = s.user_id;
  perform notificar(s.user_id, 'registro', 'Solicitud de acceso rechazada', trim(p_motivo), null);
end $$;

-- Gestión de usuarios internos (rol/estado). La invitación la hace la Edge Function.
create or replace function public.admin_actualizar_usuario(p_id uuid, p_rol text, p_estado text, p_cliente_id uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_actual perfiles%rowtype; v_mi_rol text;
begin
  if not tiene_permiso('usuarios.gestionar') then raise exception 'No autorizado' using errcode = '42501'; end if;
  select rol into v_mi_rol from perfiles where id = auth.uid();
  select * into v_actual from perfiles where id = p_id for update;
  if not found then raise exception 'Usuario inexistente' using errcode = 'P0002'; end if;
  if not exists (select 1 from roles where codigo = p_rol) then raise exception 'Rol inexistente' using errcode = '22023'; end if;
  if (p_rol = 'superadmin' or v_actual.rol = 'superadmin') and v_mi_rol <> 'superadmin' then
    raise exception 'Sólo un superadministrador puede asignar o quitar ese rol' using errcode = '42501';
  end if;
  if p_id = auth.uid() and (p_rol <> v_actual.rol or p_estado <> 'activo') then
    raise exception 'No podés cambiar tu propio rol ni suspender tu usuario' using errcode = '42501';
  end if;
  if p_rol = 'cliente' and p_estado = 'activo' and coalesce(p_cliente_id, v_actual.cliente_id) is null then
    raise exception 'Un usuario cliente activo debe estar vinculado a un cliente' using errcode = '22023';
  end if;
  update perfiles set rol = p_rol, estado = p_estado,
                      cliente_id = case when p_rol = 'cliente' then coalesce(p_cliente_id, cliente_id) else null end
   where id = p_id;
end $$;

-- Cambio de estado de una operación con validación de transiciones
create or replace function public.cambiar_estado_operacion(p_id uuid, p_estado text, p_comentario text default null, p_fecha date default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_op operaciones%rowtype;
  permitidas jsonb := '{
    "borrador":    ["pendiente","cancelada"],
    "pendiente":   ["en_analisis","aprobada","rechazada","cancelada","borrador"],
    "en_analisis": ["aprobada","rechazada","pendiente","cancelada"],
    "aprobada":    ["activa","cancelada","en_analisis"],
    "activa":      ["en_mora","finalizada","cancelada"],
    "en_mora":     ["activa","finalizada","cancelada"],
    "finalizada":  [],
    "cancelada":   [],
    "rechazada":   ["pendiente"]
  }';
begin
  if not tiene_permiso('operaciones.editar') then raise exception 'No autorizado' using errcode = '42501'; end if;
  if p_estado = 'aprobada' and not tiene_permiso('operaciones.aprobar') then
    raise exception 'Tu rol no puede aprobar operaciones' using errcode = '42501';
  end if;
  select * into v_op from operaciones where id = p_id for update;
  if not found then raise exception 'Operación inexistente' using errcode = 'P0002'; end if;
  if not (permitidas -> v_op.estado) ? p_estado then
    raise exception 'No se puede pasar de % a %', v_op.estado, p_estado using errcode = '22023';
  end if;
  if p_estado = 'activa' and v_op.estado = 'aprobada' then
    if (select usa_cheques from tipos_operacion where codigo = v_op.tipo_codigo)
       and not exists (select 1 from cheques where operacion_id = p_id) then
      raise exception 'Cargá al menos un cheque antes de liquidar' using errcode = '22023';
    end if;
  end if;
  if p_estado = 'finalizada' and saldo_operacion(p_id) > 0 then
    raise exception 'La operación tiene saldo pendiente: registrá la cobranza o cancelala' using errcode = '22023';
  end if;
  perform set_config('bbx.comentario', coalesce(p_comentario, ''), true);
  update operaciones
     set estado = p_estado,
         fecha_liquidacion = case when p_estado = 'activa' then coalesce(p_fecha, current_date) else fecha_liquidacion end,
         fecha_finalizacion = case when p_estado in ('finalizada','cancelada') then coalesce(p_fecha, current_date) else fecha_finalizacion end
   where id = p_id;
  perform set_config('bbx.comentario', '', true);
end $$;

-- Devengamiento lineal de intereses hasta una fecha (por períodos sin superponer)
create or replace function public.devengar_intereses(p_hasta date default current_date)
returns int language plpgsql security definer set search_path = public as $$
declare
  r record; v_desde date; v_hasta date; v_importe numeric; v_n int := 0; v_acum numeric;
begin
  if not tiene_permiso('contabilidad.editar') then raise exception 'No autorizado' using errcode = '42501'; end if;
  for r in
    select o.* from operaciones o
     where o.estado in ('activa','en_mora','finalizada') and o.intereses_pactados > 0 and o.fecha_inicio < p_hasta
  loop
    select max(periodo_hasta), coalesce(sum(importe), 0) into v_desde, v_acum
      from intereses where operacion_id = r.id and tipo = 'devengado';
    v_desde := coalesce(v_desde, r.fecha_inicio);
    v_hasta := least(p_hasta, r.fecha_vencimiento);
    continue when v_hasta <= v_desde;
    if v_hasta = r.fecha_vencimiento then
      v_importe := r.intereses_pactados - v_acum;              -- último tramo: ajusta el redondeo
    else
      v_importe := round(r.intereses_pactados * (v_hasta - v_desde) / r.dias, 2);
    end if;
    continue when v_importe = 0;
    insert into intereses (operacion_id, cliente_id, tipo, fecha, periodo_desde, periodo_hasta, importe, es_demo, observaciones)
    values (r.id, r.cliente_id, 'devengado', v_hasta, v_desde, v_hasta, v_importe, r.es_demo, 'Devengamiento lineal');
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- Revisión de documentos
create or replace function public.revisar_documento(p_id uuid, p_estado text, p_observacion text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not tiene_permiso('documentos.revisar') then raise exception 'No autorizado' using errcode = '42501'; end if;
  if p_estado not in ('aprobado','rechazado','en_revision','vencido','archivado') then
    raise exception 'Estado inválido' using errcode = '22023';
  end if;
  if p_estado = 'rechazado' and coalesce(trim(p_observacion), '') = '' then
    raise exception 'Indicá el motivo del rechazo' using errcode = '22023';
  end if;
  update documentos set estado = p_estado, observacion_revision = nullif(trim(p_observacion), ''),
                        revisado_por = auth.uid(), revisado_at = now()
   where id = p_id;
  if not found then raise exception 'Documento inexistente' using errcode = 'P0002'; end if;
end $$;

-- Validación de los campos de un formulario contra su plantilla
create or replace function public.validar_datos_formulario(p_campos jsonb, p_datos jsonb)
returns void language plpgsql immutable as $$
declare c jsonb; v text;
begin
  if jsonb_typeof(p_datos) <> 'object' then raise exception 'Datos inválidos' using errcode = '22023'; end if;
  if length(p_datos::text) > 20000 then raise exception 'El formulario es demasiado grande' using errcode = '22023'; end if;
  for c in select * from jsonb_array_elements(p_campos) loop
    v := trim(coalesce(p_datos ->> (c ->> 'clave'), ''));
    if coalesce((c ->> 'requerido')::boolean, false) and v = '' then
      raise exception 'Falta completar: %', c ->> 'etiqueta' using errcode = '22023';
    end if;
    if v <> '' and c ->> 'tipo' = 'numero' and v !~ '^-?\d+(\.\d+)?$' then
      raise exception 'Valor numérico inválido en: %', c ->> 'etiqueta' using errcode = '22023';
    end if;
    if v <> '' and c ->> 'tipo' = 'fecha' and v !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'Fecha inválida en: %', c ->> 'etiqueta' using errcode = '22023';
    end if;
    if v <> '' and c ->> 'tipo' = 'cuit' and not cuit_valido(regexp_replace(v, '\D', '', 'g')) then
      raise exception 'CUIT inválido en: %', c ->> 'etiqueta' using errcode = '22023';
    end if;
  end loop;
end $$;

-- El cliente completa un formulario asignado
create or replace function public.enviar_formulario(p_id uuid, p_datos jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare f formularios%rowtype; p plantillas_formulario%rowtype;
begin
  select * into f from formularios where id = p_id for update;
  if not found or (f.cliente_id is distinct from mi_cliente_id() and not tiene_permiso('formularios.editar')) then
    raise exception 'Formulario inexistente' using errcode = 'P0002';
  end if;
  if f.estado not in ('pendiente','completado','rechazado') then
    raise exception 'El formulario ya fue firmado o cerrado' using errcode = '22023';
  end if;
  select * into p from plantillas_formulario where id = f.plantilla_id;
  perform validar_datos_formulario(p.campos, p_datos);
  update formularios set datos = p_datos, estado = 'completado', enviado_at = now() where id = p_id;
  if not p.requiere_firma then
    perform notificar_permiso('formularios.ver', 'formulario', 'Formulario recibido',
      format('Se completó "%s".', p.nombre), '#/formularios');
  end if;
end $$;

-- El cliente inicia una solicitud (p. ej. descuento de cheques) desde el portal
create or replace function public.iniciar_formulario(p_plantilla uuid, p_datos jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare p plantillas_formulario%rowtype; v_id uuid; v_cliente uuid := mi_cliente_id();
begin
  if v_cliente is null then raise exception 'No autorizado' using errcode = '42501'; end if;
  select * into p from plantillas_formulario where id = p_plantilla and activo and cliente_puede_iniciar;
  if not found then raise exception 'Formulario no disponible' using errcode = 'P0002'; end if;
  perform validar_datos_formulario(p.campos, p_datos);
  insert into formularios (plantilla_id, cliente_id, estado, datos, enviado_at, iniciado_por_cliente, created_by)
  values (p.id, v_cliente, 'completado', p_datos, now(), true, auth.uid())
  returning id into v_id;
  if not p.requiere_firma then
    perform notificar_permiso('formularios.ver', 'formulario', 'Nueva solicitud desde el portal',
      format('Un cliente envió "%s".', p.nombre), '#/formularios');
  end if;
  return v_id;
end $$;

-- Firma electrónica por aceptación: guarda hash de lo firmado, IP y navegador
create or replace function public.firmar_formulario(p_id uuid, p_nombre text, p_dni text, p_acepto boolean)
returns uuid language plpgsql security definer set search_path = public, extensions as $$  -- pgcrypto vive en extensions
declare f formularios%rowtype; p plantillas_formulario%rowtype; v_firma uuid; v_hash text;
begin
  if not p_acepto then raise exception 'Tenés que aceptar los términos para firmar' using errcode = '22023'; end if;
  if coalesce(trim(p_nombre), '') = '' or coalesce(p_dni, '') !~ '^\d{7,8}$' then
    raise exception 'Indicá nombre completo y DNI (7 u 8 dígitos)' using errcode = '22023';
  end if;
  select * into f from formularios where id = p_id for update;
  if not found or f.cliente_id is distinct from mi_cliente_id() then
    raise exception 'Formulario inexistente' using errcode = 'P0002';
  end if;
  if f.estado <> 'completado' then raise exception 'Primero completá el formulario' using errcode = '22023'; end if;
  select * into p from plantillas_formulario where id = f.plantilla_id;
  if not p.requiere_firma then raise exception 'Este formulario no requiere firma' using errcode = '22023'; end if;

  v_hash := encode(digest(convert_to(
    jsonb_build_object('formulario', f.id, 'plantilla', p.codigo, 'version', p.version,
                       'texto_legal', p.texto_legal, 'datos', f.datos)::text, 'UTF8'), 'sha256'), 'hex');

  insert into firmas (formulario_id, cliente_id, firmante_id, firmante_nombre, firmante_dni, hash_contenido, ip, user_agent)
  values (f.id, f.cliente_id, auth.uid(), trim(p_nombre), p_dni, v_hash, ip_request(), user_agent_request())
  returning id into v_firma;

  update formularios set estado = 'firmado' where id = f.id;
  perform notificar_permiso('formularios.ver', 'formulario', 'Formulario firmado',
    format('Se firmó "%s".', p.nombre), '#/formularios');
  return v_firma;
end $$;

create or replace function public.revisar_formulario(p_id uuid, p_aprobar boolean, p_observaciones text default null)
returns void language plpgsql security definer set search_path = public as $$
declare f formularios%rowtype; v_nombre text;
begin
  if not tiene_permiso('formularios.editar') then raise exception 'No autorizado' using errcode = '42501'; end if;
  select * into f from formularios where id = p_id for update;
  if not found then raise exception 'Formulario inexistente' using errcode = 'P0002'; end if;
  if f.estado not in ('completado','firmado') then raise exception 'El formulario no está listo para revisar' using errcode = '22023'; end if;
  if not p_aprobar and coalesce(trim(p_observaciones), '') = '' then
    raise exception 'Indicá el motivo del rechazo' using errcode = '22023';
  end if;
  update formularios set estado = case when p_aprobar then 'aprobado' else 'rechazado' end,
                         observaciones = nullif(trim(p_observaciones), ''), revisado_por = auth.uid(), revisado_at = now()
   where id = p_id;
  select nombre into v_nombre from plantillas_formulario where id = f.plantilla_id;
  perform notificar_cliente(f.cliente_id, 'formulario',
    case when p_aprobar then 'Formulario aprobado' else 'Formulario observado' end,
    format('%s%s', v_nombre, coalesce(': ' || nullif(trim(p_observaciones), ''), '')), '#/formularios');
end $$;

-- El cliente pide actualizar sus datos (no los edita directamente)
create or replace function public.solicitar_actualizacion_datos(p_mensaje text)
returns void language plpgsql security definer set search_path = public as $$
declare v_cliente uuid := mi_cliente_id(); v_razon text;
begin
  if v_cliente is null then raise exception 'No autorizado' using errcode = '42501'; end if;
  if coalesce(trim(p_mensaje), '') = '' or length(p_mensaje) > 2000 then
    raise exception 'Escribí qué datos querés actualizar (máx. 2000 caracteres)' using errcode = '22023';
  end if;
  select e.razon_social into v_razon from clientes c join empresas e on e.id = c.empresa_id where c.id = v_cliente;
  perform notificar_permiso('clientes.editar', 'actualizacion_datos', 'Pedido de actualización de datos',
    format('%s: %s', v_razon, trim(p_mensaje)), '#/clientes/' || v_cliente);
end $$;

-- =====================================================================
-- Vistas (security_invoker: respetan el RLS de quien consulta)
-- =====================================================================
create or replace view public.v_operaciones with (security_invoker = true) as
select
  o.*,
  e.razon_social as cliente_razon_social,
  e.cuit         as cliente_cuit,
  t.nombre       as tipo_nombre,
  -- Devengado a hoy (lineal, en tiempo real)
  case when o.estado in ('activa','en_mora','finalizada') and o.dias > 0
       then round(o.intereses_pactados * least(greatest(least(current_date, coalesce(o.fecha_finalizacion, current_date)) - o.fecha_inicio, 0), o.dias) / o.dias, 2)
       else 0 end as intereses_devengados_hoy,
  coalesce(i.devengado_registrado, 0) as intereses_devengados_registrados,
  coalesce(i.cobrado, 0)              as intereses_cobrados,
  coalesce(pg.cobrado, 0)             as total_cobrado,
  case when o.estado in ('activa','en_mora') then saldo_operacion(o.id) else 0 end as saldo_pendiente,
  o.fecha_vencimiento - current_date  as dias_para_vencer,
  coalesce(ch.cantidad, 0)            as cantidad_cheques
from operaciones o
join clientes c on c.id = o.cliente_id
join empresas e on e.id = c.empresa_id
join tipos_operacion t on t.codigo = o.tipo_codigo
left join lateral (
  select sum(importe) filter (where tipo = 'devengado') as devengado_registrado,
         sum(importe) filter (where tipo = 'cobrado')   as cobrado
    from intereses where operacion_id = o.id) i on true
left join lateral (
  select sum(importe) as cobrado from pagos where operacion_id = o.id and not anulado) pg on true
left join lateral (
  select count(*) as cantidad from cheques where operacion_id = o.id) ch on true;

create or replace view public.v_clientes with (security_invoker = true) as
select
  c.*,
  e.razon_social, e.cuit, e.tipo_persona, e.condicion_iva, e.actividad,
  e.domicilio_calle, e.domicilio_numero, e.domicilio_piso, e.domicilio_localidad, e.domicilio_provincia, e.domicilio_cp,
  (select count(*) from operaciones o where o.cliente_id = c.id and o.estado in ('activa','en_mora')) as operaciones_activas,
  (select coalesce(sum(saldo_operacion(o.id)), 0) from operaciones o where o.cliente_id = c.id and o.estado in ('activa','en_mora')) as saldo_pendiente,
  (select count(*) from documentos_requeridos d where d.cliente_id = c.id and d.estado in ('pendiente','recibido')) as documentos_pendientes,
  (select concat_ws(' ', ct.nombre, ct.apellido) from contactos ct where ct.cliente_id = c.id and ct.es_principal limit 1) as contacto_principal
from clientes c
join empresas e on e.id = c.empresa_id;

-- Estado de cuenta con saldo acumulado
create or replace view public.v_estado_cuenta with (security_invoker = true) as
select
  m.*,
  o.numero as operacion_numero,
  sum(case m.sentido when 'cargo' then m.importe when 'abono' then -m.importe else 0 end)
    over (partition by m.cliente_id order by m.fecha, m.created_at, m.id) as saldo
from movimientos m
left join operaciones o on o.id = m.operacion_id;

-- Cuentas por cobrar con antigüedad
create or replace view public.v_cuentas_por_cobrar with (security_invoker = true) as
select
  o.id as operacion_id, o.numero, o.cliente_id, e.razon_social, o.tipo_codigo, o.estado,
  o.fecha_vencimiento, o.importe_total,
  saldo_operacion(o.id) as saldo,
  current_date - o.fecha_vencimiento as dias_vencido,
  case
    when o.fecha_vencimiento >= current_date then 'a_vencer'
    when current_date - o.fecha_vencimiento <= 30 then 'vencido_30'
    when current_date - o.fecha_vencimiento <= 60 then 'vencido_60'
    when current_date - o.fecha_vencimiento <= 90 then 'vencido_90'
    else 'vencido_mas_90' end as tramo
from operaciones o
join clientes c on c.id = o.cliente_id
join empresas e on e.id = c.empresa_id
where o.estado in ('activa','en_mora') and saldo_operacion(o.id) > 0;

-- Próximos vencimientos (operaciones y cheques)
create or replace view public.v_vencimientos with (security_invoker = true) as
select 'operacion'::text as tipo, o.id as operacion_id, o.numero, o.cliente_id, e.razon_social,
       o.fecha_vencimiento as fecha, saldo_operacion(o.id) as importe, o.estado, null::text as detalle
  from operaciones o join clientes c on c.id = o.cliente_id join empresas e on e.id = c.empresa_id
 where o.estado in ('activa','en_mora')
union all
select 'cheque', o.id, o.numero, o.cliente_id, e.razon_social, ch.fecha_pago, ch.monto, ch.estado,
       format('Cheque %s · %s', ch.numero, ch.banco)
  from cheques ch join operaciones o on o.id = ch.operacion_id
  join clientes c on c.id = o.cliente_id join empresas e on e.id = c.empresa_id
 where ch.estado in ('en_cartera','depositado') and o.estado in ('activa','en_mora');

-- =====================================================================
-- Indicadores del panel y reportes
-- =====================================================================
create or replace function public.dashboard_resumen(p_desde date default (current_date - 365), p_hasta date default current_date)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare r jsonb;
begin
  if not tiene_permiso('dashboard.ver') then raise exception 'No autorizado' using errcode = '42501'; end if;
  select jsonb_build_object(
    'clientes',            (select count(*) from clientes where estado <> 'prospecto'),
    'clientes_activos',    (select count(*) from clientes where estado = 'activo'),
    'clientes_nuevos_mes', (select count(*) from clientes where fecha_alta >= date_trunc('month', current_date)),
    'operaciones_activas', (select count(*) from operaciones where estado in ('activa','en_mora')),
    'operaciones_mora',    (select count(*) from operaciones where estado = 'en_mora'),
    'operaciones_pendientes', (select count(*) from operaciones where estado in ('pendiente','en_analisis','aprobada')),
    'solicitudes_pendientes', (select count(*) from solicitudes_registro where estado = 'pendiente'),
    'capital_operado',     (select coalesce(sum(capital), 0) from operaciones
                             where estado in ('activa','en_mora','finalizada') and fecha_inicio between p_desde and p_hasta),
    'capital_vigente',     (select coalesce(sum(capital), 0) from operaciones where estado in ('activa','en_mora')),
    'saldo_a_cobrar',      (select coalesce(sum(saldo), 0) from v_cuentas_por_cobrar),
    'intereses_cobrados',  (select coalesce(sum(importe), 0) from intereses where tipo = 'cobrado' and fecha between p_desde and p_hasta),
    'intereses_devengados',(select coalesce(sum(intereses_devengados_hoy), 0) from v_operaciones
                             where estado in ('activa','en_mora','finalizada') and fecha_inicio between p_desde and p_hasta),
    'facturacion_total',   (select coalesce(sum(case when tipo_comprobante in (3,8,13) then -importe_total else importe_total end), 0)
                              from facturas where estado = 'autorizada' and fecha_emision between p_desde and p_hasta),
    'documentos_a_revisar',(select count(*) from documentos where estado = 'en_revision'),
    'serie_mensual', (
      select coalesce(jsonb_agg(jsonb_build_object('mes', to_char(m, 'YYYY-MM'),
               'capital', coalesce(cap, 0), 'intereses_cobrados', coalesce(ic, 0), 'operaciones', coalesce(n, 0)) order by m), '[]')
        from generate_series(date_trunc('month', p_hasta::timestamp) - interval '11 months', date_trunc('month', p_hasta::timestamp), interval '1 month') m
        left join lateral (select sum(capital) cap, count(*) n from operaciones
                            where estado in ('activa','en_mora','finalizada') and date_trunc('month', fecha_inicio) = m) a on true
        left join lateral (select sum(importe) ic from intereses where tipo = 'cobrado' and date_trunc('month', fecha) = m) b on true),
    'por_tipo', (
      select coalesce(jsonb_agg(jsonb_build_object('tipo', t.nombre, 'capital', x.cap, 'cantidad', x.n) order by x.cap desc), '[]')
        from (select tipo_codigo, sum(capital) cap, count(*) n from operaciones where estado in ('activa','en_mora') group by 1) x
        join tipos_operacion t on t.codigo = x.tipo_codigo)
  ) into r;
  return r;
end $$;

create or replace function public.reporte_periodo(p_desde date, p_hasta date)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare r jsonb;
begin
  if not tiene_permiso('reportes.ver') then raise exception 'No autorizado' using errcode = '42501'; end if;
  select jsonb_build_object(
    'desde', p_desde, 'hasta', p_hasta,
    'por_categoria', (select coalesce(jsonb_agg(jsonb_build_object('tipo', tipo, 'categoria', categoria, 'importe', total, 'cantidad', n) order by tipo, total desc), '[]')
                        from (select tipo, categoria, sum(importe) total, count(*) n from movimientos_contables
                               where not anulado and fecha between p_desde and p_hasta group by 1, 2) x),
    'intereses_cobrados', (select coalesce(sum(importe), 0) from intereses where tipo = 'cobrado' and fecha between p_desde and p_hasta),
    'intereses_devengados', (
      -- devengamiento lineal de cada operación dentro del período
      select coalesce(sum(round(o.intereses_pactados *
               greatest(least(p_hasta + 1, o.fecha_vencimiento, coalesce(o.fecha_finalizacion, o.fecha_vencimiento)) - greatest(p_desde, o.fecha_inicio), 0)
               / nullif(o.dias, 0), 2)), 0)
        from operaciones o where o.estado in ('activa','en_mora','finalizada')),
    'operaciones_originadas', (select jsonb_build_object('cantidad', count(*), 'capital', coalesce(sum(capital), 0))
                                 from operaciones where estado in ('activa','en_mora','finalizada') and fecha_liquidacion between p_desde and p_hasta),
    'facturado', (select jsonb_build_object('cantidad', count(*), 'neto', coalesce(sum(importe_neto), 0), 'iva', coalesce(sum(importe_iva), 0), 'total', coalesce(sum(importe_total), 0))
                    from facturas where estado = 'autorizada' and fecha_emision between p_desde and p_hasta),
    'cuentas_por_cobrar', (select coalesce(jsonb_object_agg(tramo, total), '{}') from
                            (select tramo, sum(saldo) total from v_cuentas_por_cobrar group by tramo) x)
  ) into r;
  return r;
end $$;
