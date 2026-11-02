-- =====================================================================
-- 06 · RPCs atómicas para los formularios del panel y Realtime
-- (SECURITY INVOKER: respetan el RLS de quien llama)
-- =====================================================================

-- Alta / edición de cliente + entidad fiscal + contacto principal en una sola transacción
create or replace function public.guardar_cliente(p_id uuid, p_empresa jsonb, p_cliente jsonb, p_contacto jsonb default null)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  v_emp uuid; v_cli uuid := p_id;
  v_cuit text := regexp_replace(coalesce(p_empresa ->> 'cuit', ''), '\D', '', 'g');
begin
  if not tiene_permiso('clientes.editar') then raise exception 'No autorizado' using errcode = '42501'; end if;
  if not cuit_valido(v_cuit) then raise exception 'CUIT inválido' using errcode = '22023'; end if;
  if coalesce(trim(p_empresa ->> 'razon_social'), '') = '' then raise exception 'Falta la razón social' using errcode = '22023'; end if;

  if v_cli is null then
    select id into v_emp from empresas where cuit = v_cuit;
    if v_emp is not null and exists (select 1 from clientes where empresa_id = v_emp) then
      raise exception 'Ya existe un cliente con el CUIT %', v_cuit using errcode = '23505';
    end if;
    if v_emp is null then
      insert into empresas (razon_social, cuit) values (trim(p_empresa ->> 'razon_social'), v_cuit) returning id into v_emp;
    end if;
    insert into clientes (empresa_id, created_by) values (v_emp, auth.uid()) returning id into v_cli;
  else
    select empresa_id into v_emp from clientes where id = v_cli;
    if v_emp is null then raise exception 'Cliente inexistente' using errcode = 'P0002'; end if;
  end if;

  update empresas set
    razon_social        = trim(p_empresa ->> 'razon_social'),
    cuit                = v_cuit,
    tipo_persona        = coalesce(p_empresa ->> 'tipo_persona', tipo_persona),
    condicion_iva       = coalesce((p_empresa ->> 'condicion_iva')::int, condicion_iva),
    actividad           = p_empresa ->> 'actividad',
    fecha_constitucion  = nullif(p_empresa ->> 'fecha_constitucion', '')::date,
    domicilio_calle     = p_empresa ->> 'domicilio_calle',
    domicilio_numero    = p_empresa ->> 'domicilio_numero',
    domicilio_piso      = p_empresa ->> 'domicilio_piso',
    domicilio_localidad = p_empresa ->> 'domicilio_localidad',
    domicilio_provincia = nullif(p_empresa ->> 'domicilio_provincia', ''),
    domicilio_cp        = p_empresa ->> 'domicilio_cp'
  where id = v_emp;

  update clientes set
    nombre_fantasia     = p_cliente ->> 'nombre_fantasia',
    email               = p_cliente ->> 'email',
    telefono            = p_cliente ->> 'telefono',
    domicilio_comercial = p_cliente ->> 'domicilio_comercial',
    estado              = coalesce(p_cliente ->> 'estado', estado),
    ejecutivo_id        = nullif(p_cliente ->> 'ejecutivo_id', '')::uuid
  where id = v_cli;

  if p_contacto is not null and coalesce(trim(p_contacto ->> 'nombre'), '') <> '' then
    insert into contactos (cliente_id, nombre, apellido, dni, cargo, email, telefono, es_principal, es_firmante)
    values (v_cli, trim(p_contacto ->> 'nombre'), coalesce(trim(p_contacto ->> 'apellido'), ''), nullif(p_contacto ->> 'dni', ''),
            p_contacto ->> 'cargo', p_contacto ->> 'email', p_contacto ->> 'telefono', true, true);
  end if;
  return v_cli;
end $$;

-- Alta / edición de operación con sus cheques y acuerdo, en una sola transacción.
-- p_cheques: [{tipo, numero, banco, librador_cuit, librador_nombre, fecha_emision, fecha_pago, monto}]
create or replace function public.guardar_operacion(p_id uuid, p_op jsonb, p_cheques jsonb default '[]', p_acuerdo jsonb default null)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  v_id uuid := p_id; v_tipo tipos_operacion%rowtype; v_estado text; ch jsonb; v_lib uuid; v_cuit text;
begin
  if not tiene_permiso('operaciones.editar') then raise exception 'No autorizado' using errcode = '42501'; end if;
  select * into v_tipo from tipos_operacion where codigo = p_op ->> 'tipo_codigo' and activo;
  if not found then raise exception 'Tipo de operación inválido' using errcode = '22023'; end if;
  if v_tipo.usa_cheques and jsonb_array_length(coalesce(p_cheques, '[]')) = 0 then
    raise exception 'Cargá al menos un cheque' using errcode = '22023';
  end if;

  if v_id is null then
    insert into operaciones (cliente_id, tipo_codigo, modalidad, moneda, fecha_inicio, fecha_vencimiento, capital, tasa_interes,
                             tasa_periodo, base_dias, gastos, comisiones, iva_comisiones, estado, observaciones, created_by)
    values ((p_op ->> 'cliente_id')::uuid, v_tipo.codigo, coalesce(p_op ->> 'modalidad', v_tipo.modalidad_default),
            coalesce(p_op ->> 'moneda', 'ARS'), (p_op ->> 'fecha_inicio')::date,
            coalesce(nullif(p_op ->> 'fecha_vencimiento', '')::date, (p_op ->> 'fecha_inicio')::date + 1),
            coalesce(nullif(p_op ->> 'capital', '')::numeric,
                     (select sum((x ->> 'monto')::numeric) from jsonb_array_elements(p_cheques) x), 0),
            (p_op ->> 'tasa_interes')::numeric, coalesce(p_op ->> 'tasa_periodo', 'mensual'), coalesce((p_op ->> 'base_dias')::int, 365),
            coalesce((p_op ->> 'gastos')::numeric, 0), coalesce((p_op ->> 'comisiones')::numeric, 0), coalesce((p_op ->> 'iva_comisiones')::numeric, 0),
            coalesce(p_op ->> 'estado', 'borrador'), p_op ->> 'observaciones', auth.uid())
    returning id into v_id;
  else
    select estado into v_estado from operaciones where id = v_id for update;
    if v_estado is null then raise exception 'Operación inexistente' using errcode = 'P0002'; end if;
    if v_estado not in ('borrador','pendiente','en_analisis','aprobada') then
      raise exception 'La operación ya fue liquidada o cerrada: no se puede editar' using errcode = '42501';
    end if;
    delete from cheques where operacion_id = v_id;
    update operaciones set
      cliente_id = (p_op ->> 'cliente_id')::uuid, tipo_codigo = v_tipo.codigo,
      modalidad = coalesce(p_op ->> 'modalidad', modalidad), moneda = coalesce(p_op ->> 'moneda', moneda),
      fecha_inicio = (p_op ->> 'fecha_inicio')::date,
      fecha_vencimiento = coalesce(nullif(p_op ->> 'fecha_vencimiento', '')::date, fecha_vencimiento),
      capital = coalesce(nullif(p_op ->> 'capital', '')::numeric, capital),
      tasa_interes = (p_op ->> 'tasa_interes')::numeric, tasa_periodo = coalesce(p_op ->> 'tasa_periodo', tasa_periodo),
      base_dias = coalesce((p_op ->> 'base_dias')::int, base_dias),
      gastos = coalesce((p_op ->> 'gastos')::numeric, 0), comisiones = coalesce((p_op ->> 'comisiones')::numeric, 0),
      iva_comisiones = coalesce((p_op ->> 'iva_comisiones')::numeric, 0), observaciones = p_op ->> 'observaciones'
    where id = v_id;
  end if;

  for ch in select * from jsonb_array_elements(coalesce(p_cheques, '[]')) loop
    v_cuit := nullif(regexp_replace(coalesce(ch ->> 'librador_cuit', ''), '\D', '', 'g'), '');
    if v_cuit is not null and not cuit_valido(v_cuit) then
      raise exception 'CUIT de librador inválido en el cheque %', ch ->> 'numero' using errcode = '22023';
    end if;
    v_lib := null;
    if v_cuit is not null then
      select id into v_lib from empresas where cuit = v_cuit;
      if v_lib is null and coalesce(trim(ch ->> 'librador_nombre'), '') <> '' then
        insert into empresas (razon_social, cuit, es_librador) values (trim(ch ->> 'librador_nombre'), v_cuit, true) returning id into v_lib;
      end if;
    end if;
    insert into cheques (operacion_id, tipo, numero, banco, librador_cuit, librador_nombre, librador_id, fecha_emision, fecha_pago, monto)
    values (v_id, coalesce(ch ->> 'tipo', 'fisico'), ch ->> 'numero', ch ->> 'banco', v_cuit, ch ->> 'librador_nombre', v_lib,
            nullif(ch ->> 'fecha_emision', '')::date, (ch ->> 'fecha_pago')::date, (ch ->> 'monto')::numeric);
  end loop;

  if v_tipo.usa_acuerdo and p_acuerdo is not null then
    insert into acuerdos (operacion_id, limite, tasa_excedido, garantia, renovacion_automatica)
    values (v_id, (p_acuerdo ->> 'limite')::numeric, nullif(p_acuerdo ->> 'tasa_excedido', '')::numeric,
            p_acuerdo ->> 'garantia', coalesce((p_acuerdo ->> 'renovacion_automatica')::boolean, false))
    on conflict (operacion_id) do update set limite = excluded.limite, tasa_excedido = excluded.tasa_excedido,
      garantia = excluded.garantia, renovacion_automatica = excluded.renovacion_automatica;
  end if;

  -- Validación final del importe a liquidar (con los cheques ya cargados)
  if (select importe_liquidado from operaciones where id = v_id) <= 0 then
    raise exception 'El importe a liquidar resulta negativo o cero: revisá tasa, gastos y comisiones' using errcode = '22023';
  end if;
  return v_id;
end $$;

-- Simulación sin guardar (para el formulario): mismos cálculos que el trigger
create or replace function public.simular_operacion(p_capital numeric, p_tasa numeric, p_periodo text, p_base int, p_inicio date, p_vencimiento date,
                                                    p_modalidad text, p_gastos numeric default 0, p_comisiones numeric default 0, p_iva numeric default 0)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'dias', p_vencimiento - p_inicio,
    'intereses', i,
    'importe_total', case when p_modalidad = 'descuento' then p_capital else p_capital + i + p_gastos + p_comisiones + p_iva end,
    'importe_liquidado', case when p_modalidad = 'descuento' then p_capital - i - p_gastos - p_comisiones - p_iva else p_capital end)
  from (select calcular_interes(p_capital, p_tasa, p_periodo, p_base, p_vencimiento - p_inicio) i) x;
$$;

revoke execute on function public.guardar_cliente(uuid, jsonb, jsonb, jsonb), public.guardar_operacion(uuid, jsonb, jsonb, jsonb),
  public.simular_operacion(numeric, numeric, text, int, date, date, text, numeric, numeric, numeric) from anon, public;
grant execute on function public.guardar_cliente(uuid, jsonb, jsonb, jsonb), public.guardar_operacion(uuid, jsonb, jsonb, jsonb),
  public.simular_operacion(numeric, numeric, text, int, date, date, text, numeric, numeric, numeric) to authenticated;

-- Datos públicos del emisor (para imprimir comprobantes desde el portal del cliente)
create or replace function public.datos_emisor()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('razon_social', razon_social, 'cuit_emisor', cuit_emisor, 'domicilio', domicilio,
                            'condicion_iva', condicion_iva, 'ingresos_brutos', ingresos_brutos, 'inicio_actividades', inicio_actividades)
    from arca_config
   where id = 1 and (es_staff() or mi_cliente_id() is not null);
$$;
revoke execute on function public.datos_emisor() from anon, public;
grant execute on function public.datos_emisor() to authenticated;

-- Notificaciones en tiempo real (Supabase Realtime respeta el RLS de la tabla)
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.notificaciones;
  end if;
end $$;
