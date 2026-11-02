-- =====================================================================
-- DATOS DEMO — FICTICIOS, SÓLO PARA DESARROLLO Y PRUEBAS
--
-- * Todas las razones sociales empiezan con "DEMO" y los registros tienen es_demo = true.
-- * Los CUIT usan el rango ficticio 99999xxx (dígito verificador válido para que
--   pasen las validaciones). No corresponden a personas ni empresas reales.
-- * No se generan facturas autorizadas: sólo borradores (sin CAE, sin validez fiscal).
-- * Para borrar todo:  select public.borrar_datos_demo();
-- =====================================================================

create or replace function public.borrar_datos_demo()
returns void language plpgsql security definer set search_path = public as $$
begin
  if not es_backend() then raise exception 'Sólo desde la consola SQL' using errcode = '42501'; end if;
  alter table movimientos disable trigger trg_movimientos_inmutable;
  alter table intereses disable trigger trg_intereses_inmutable;
  alter table movimientos_contables disable trigger trg_mc_inmutable;
  alter table facturas disable trigger trg_facturas_proteger;
  delete from firmas where cliente_id in (select id from clientes where es_demo);
  delete from formularios where es_demo;
  delete from documentos_requeridos where es_demo or cliente_id in (select id from clientes where es_demo);
  delete from documentos where es_demo;
  delete from factura_items where factura_id in (select id from facturas where es_demo);
  delete from facturas where es_demo;
  delete from movimientos_contables where es_demo;
  delete from intereses where es_demo;
  delete from movimientos where es_demo;
  delete from pagos where es_demo;
  delete from notas_internas where cliente_id in (select id from clientes where es_demo);
  delete from operaciones where es_demo;
  update perfiles set cliente_id = null where cliente_id in (select id from clientes where es_demo);
  delete from clientes where es_demo;
  delete from empresas where es_demo;
  alter table movimientos enable trigger trg_movimientos_inmutable;
  alter table intereses enable trigger trg_intereses_inmutable;
  alter table movimientos_contables enable trigger trg_mc_inmutable;
  alter table facturas enable trigger trg_facturas_proteger;
end $$;
revoke execute on function public.borrar_datos_demo() from public, anon, authenticated;

do $$
declare
  hoy date := current_date;
  e1 uuid; e2 uuid; e3 uuid; e4 uuid; e5 uuid; e6 uuid; l1 uuid; l2 uuid; l3 uuid;
  c1 uuid; c2 uuid; c3 uuid; c4 uuid; c5 uuid; c6 uuid;
  op uuid; f uuid;
begin
  -- Entidades fiscales -------------------------------------------------
  insert into empresas (razon_social, cuit, tipo_persona, condicion_iva, actividad, domicilio_calle, domicilio_numero, domicilio_localidad, domicilio_provincia, domicilio_cp, es_demo)
  values ('DEMO Metalúrgica Andina S.A.', '30999990017', 'juridica', 1, 'Fabricación de estructuras metálicas', 'Av. DEMO', '1200', 'San Martín', 'Buenos Aires', '1650', true)
  returning id into e1;
  insert into empresas (razon_social, cuit, tipo_persona, condicion_iva, actividad, domicilio_calle, domicilio_numero, domicilio_localidad, domicilio_provincia, domicilio_cp, es_demo)
  values ('DEMO Agroservicios del Litoral S.R.L.', '30999990025', 'juridica', 1, 'Servicios agrícolas', 'Ruta DEMO km', '34', 'Rafaela', 'Santa Fe', '2300', true)
  returning id into e2;
  insert into empresas (razon_social, cuit, tipo_persona, condicion_iva, actividad, domicilio_calle, domicilio_numero, domicilio_localidad, domicilio_provincia, domicilio_cp, es_demo)
  values ('DEMO Distribuidora Patagónica S.A.', '30999990033', 'juridica', 1, 'Distribución mayorista de alimentos', 'Calle DEMO', '455', 'Neuquén', 'Neuquén', '8300', true)
  returning id into e3;
  insert into empresas (razon_social, cuit, tipo_persona, condicion_iva, actividad, domicilio_calle, domicilio_numero, domicilio_localidad, domicilio_provincia, domicilio_cp, es_demo)
  values ('DEMO Constructora Río Sur S.A.', '33999990016', 'juridica', 1, 'Construcción de obras civiles', 'Bv. DEMO', '89', 'Córdoba', 'Córdoba', '5000', true)
  returning id into e4;
  insert into empresas (razon_social, cuit, tipo_persona, condicion_iva, actividad, domicilio_calle, domicilio_numero, domicilio_localidad, domicilio_provincia, domicilio_cp, es_demo)
  values ('DEMO Laura Gómez', '27999990016', 'humana', 6, 'Comercio minorista', 'Pasaje DEMO', '17', 'Mendoza', 'Mendoza', '5500', true)
  returning id into e5;
  insert into empresas (razon_social, cuit, tipo_persona, condicion_iva, actividad, domicilio_calle, domicilio_numero, domicilio_localidad, domicilio_provincia, domicilio_cp, es_demo)
  values ('DEMO Textil Norte S.A.', '30999990041', 'juridica', 1, 'Industria textil', 'Av. DEMO Norte', '3021', 'San Miguel de Tucumán', 'Tucumán', '4000', true)
  returning id into e6;

  insert into empresas (razon_social, cuit, tipo_persona, es_librador, es_demo) values
    ('DEMO Supermercados Centrales S.A.', '30999990068', 'juridica', true, true) returning id into l1;
  insert into empresas (razon_social, cuit, tipo_persona, es_librador, es_demo) values
    ('DEMO Logística Federal S.A.', '33999990024', 'juridica', true, true) returning id into l2;
  insert into empresas (razon_social, cuit, tipo_persona, es_librador, es_demo) values
    ('DEMO Alimentos del Valle S.A.', '33999990032', 'juridica', true, true) returning id into l3;

  -- Clientes -----------------------------------------------------------
  insert into clientes (empresa_id, email, telefono, estado, fecha_alta, es_demo) values (e1, 'demo.andina@example.com', '+54 11 0000-0001', 'activo', hoy - 400, true) returning id into c1;
  insert into clientes (empresa_id, email, telefono, estado, fecha_alta, es_demo) values (e2, 'demo.litoral@example.com', '+54 342 000-0002', 'activo', hoy - 300, true) returning id into c2;
  insert into clientes (empresa_id, email, telefono, estado, fecha_alta, es_demo) values (e3, 'demo.patagonica@example.com', '+54 299 000-0003', 'activo', hoy - 200, true) returning id into c3;
  insert into clientes (empresa_id, email, telefono, estado, fecha_alta, es_demo) values (e4, 'demo.riosur@example.com', '+54 351 000-0004', 'en_evaluacion', hoy - 10, true) returning id into c4;
  insert into clientes (empresa_id, email, telefono, estado, fecha_alta, es_demo) values (e5, 'demo.gomez@example.com', '+54 261 000-0005', 'activo', hoy - 150, true) returning id into c5;
  insert into clientes (empresa_id, email, telefono, estado, fecha_alta, es_demo) values (e6, 'demo.textil@example.com', '+54 381 000-0006', 'inactivo', hoy - 700, true) returning id into c6;

  insert into contactos (cliente_id, nombre, apellido, dni, cargo, email, telefono, es_principal, es_firmante, es_demo) values
    (c1, 'DEMO Martín', 'Ferreyra', '99000001', 'Presidente', 'demo.mferreyra@example.com', '+54 11 0000-1001', true, true, true),
    (c1, 'DEMO Sofía', 'Ibarra', '99000002', 'Tesorera', 'demo.sibarra@example.com', '+54 11 0000-1002', false, false, true),
    (c2, 'DEMO Julián', 'Paz', '99000003', 'Socio gerente', 'demo.jpaz@example.com', '+54 342 000-1003', true, true, true),
    (c3, 'DEMO Carla', 'Moreno', '99000004', 'Directora financiera', 'demo.cmoreno@example.com', '+54 299 000-1004', true, true, true),
    (c4, 'DEMO Pablo', 'Quiroga', '99000005', 'Presidente', 'demo.pquiroga@example.com', '+54 351 000-1005', true, true, true),
    (c5, 'DEMO Laura', 'Gómez', '99000006', 'Titular', 'demo.gomez@example.com', '+54 261 000-1006', true, true, true),
    (c6, 'DEMO Ricardo', 'Sosa', '99000007', 'Gerente', 'demo.rsosa@example.com', '+54 381 000-1007', true, true, true);

  -- Documentación pedida
  insert into documentos_requeridos (cliente_id, tipo_codigo, descripcion, estado, fecha_limite, es_demo) values
    (c1, 'balance', 'Último balance certificado', 'pendiente', hoy + 15, true),
    (c3, 'acta_autoridades', 'Acta de designación de autoridades vigente', 'pendiente', hoy + 7, true),
    (c4, 'estatuto', 'Estatuto o contrato social', 'pendiente', hoy + 10, true),
    (c4, 'constancia_cuit', 'Constancia de inscripción en ARCA', 'pendiente', hoy + 10, true),
    (c4, 'ddjj_pep', 'Declaración jurada PEP', 'pendiente', hoy + 10, true),
    (c5, 'cbu', 'Constancia de CBU', 'pendiente', hoy + 5, true);

  -- Operaciones --------------------------------------------------------
  -- 1) Descuento de cheques activo (c1)
  insert into operaciones (cliente_id, tipo_codigo, modalidad, fecha_inicio, fecha_vencimiento, capital, tasa_interes, gastos, comisiones, estado, observaciones, es_demo)
  values (c1, 'descuento_cheques', 'descuento', hoy - 20, hoy + 40, 1, 3.5, 15000, 25000, 'aprobada', 'DEMO · Cheques de clientes de la metalúrgica', true)
  returning id into op;
  insert into cheques (operacion_id, tipo, numero, banco, librador_cuit, librador_nombre, librador_id, fecha_emision, fecha_pago, monto, es_demo) values
    (op, 'echeq',  '90000101', 'Banco DEMO Nación', '30999990068', 'DEMO Supermercados Centrales S.A.', l1, hoy - 25, hoy + 25, 4200000, true),
    (op, 'echeq',  '90000102', 'Banco DEMO Nación', '30999990068', 'DEMO Supermercados Centrales S.A.', l1, hoy - 25, hoy + 40, 3800000, true),
    (op, 'fisico', '00451230', 'Banco DEMO Provincia', '33999990024', 'DEMO Logística Federal S.A.', l2, hoy - 22, hoy + 32, 2500000, true);
  update operaciones set estado = 'activa', fecha_liquidacion = hoy - 20 where id = op;

  -- 2) Descuento finalizado (c1): cheques acreditados
  insert into operaciones (cliente_id, tipo_codigo, modalidad, fecha_inicio, fecha_vencimiento, capital, tasa_interes, gastos, comisiones, estado, es_demo)
  values (c1, 'descuento_cheques', 'descuento', hoy - 120, hoy - 60, 1, 3.8, 10000, 18000, 'aprobada', true)
  returning id into op;
  insert into cheques (operacion_id, tipo, numero, banco, librador_cuit, librador_nombre, librador_id, fecha_pago, monto, es_demo) values
    (op, 'echeq', '90000071', 'Banco DEMO Galicia', '33999990032', 'DEMO Alimentos del Valle S.A.', l3, hoy - 75, 3000000, true),
    (op, 'echeq', '90000072', 'Banco DEMO Galicia', '33999990032', 'DEMO Alimentos del Valle S.A.', l3, hoy - 60, 2600000, true);
  update operaciones set estado = 'activa', fecha_liquidacion = hoy - 120 where id = op;
  update cheques set estado = 'acreditado' where operacion_id = op;

  -- 3) Préstamo a plazo activo con intereses al vencimiento (c2)
  insert into operaciones (cliente_id, tipo_codigo, modalidad, fecha_inicio, fecha_vencimiento, capital, tasa_interes, gastos, comisiones, estado, es_demo)
  values (c2, 'prestamo', 'vencido', hoy - 45, hoy + 45, 8000000, 3.2, 20000, 40000, 'aprobada', true)
  returning id into op;
  update operaciones set estado = 'activa', fecha_liquidacion = hoy - 45 where id = op;
  insert into pagos (cliente_id, operacion_id, fecha, medio, referencia, importe, imputado_capital, imputado_intereses, imputado_gastos, imputado_comisiones, es_demo, observaciones)
  values (c2, op, hoy - 15, 'transferencia', 'DEMO-TRF-0001', 1060000, 0, 1000000, 20000, 40000, true, 'Pago parcial DEMO: intereses, gastos y comisiones');

  -- 4) Acuerdo en cuenta corriente activo (c3)
  insert into operaciones (cliente_id, tipo_codigo, modalidad, fecha_inicio, fecha_vencimiento, capital, tasa_interes, tasa_periodo, comisiones, estado, observaciones, es_demo)
  values (c3, 'acuerdo_cc', 'vencido', hoy - 60, hoy + 120, 12000000, 42, 'anual', 60000, 'aprobada', 'DEMO · Acuerdo para capital de trabajo', true)
  returning id into op;
  insert into acuerdos (operacion_id, limite, tasa_excedido, garantia, renovacion_automatica, es_demo)
  values (op, 15000000, 60, 'Fianza de los socios (DEMO)', true, true);
  update operaciones set estado = 'activa', fecha_liquidacion = hoy - 60 where id = op;

  -- 5) Préstamo vencido en mora (c5)
  insert into operaciones (cliente_id, tipo_codigo, modalidad, fecha_inicio, fecha_vencimiento, capital, tasa_interes, gastos, estado, es_demo)
  values (c5, 'prestamo', 'vencido', hoy - 100, hoy - 10, 1500000, 4, 8000, 'aprobada', true)
  returning id into op;
  update operaciones set estado = 'activa', fecha_liquidacion = hoy - 100 where id = op;
  update operaciones set estado = 'en_mora' where id = op;
  insert into pagos (cliente_id, operacion_id, fecha, medio, referencia, importe, imputado_capital, imputado_intereses, es_demo)
  values (c5, op, hoy - 5, 'transferencia', 'DEMO-TRF-0002', 500000, 300000, 200000, true);

  -- 6) Operaciones pendientes de aprobación
  insert into operaciones (cliente_id, tipo_codigo, modalidad, fecha_inicio, fecha_vencimiento, capital, tasa_interes, gastos, comisiones, estado, es_demo)
  values (c2, 'descuento_cheques', 'descuento', hoy, hoy + 75, 1, 3.6, 12000, 20000, 'pendiente', true)
  returning id into op;
  insert into cheques (operacion_id, tipo, numero, banco, librador_cuit, librador_nombre, librador_id, fecha_pago, monto, es_demo) values
    (op, 'echeq', '90000201', 'Banco DEMO Santander', '33999990024', 'DEMO Logística Federal S.A.', l2, hoy + 60, 1800000, true),
    (op, 'echeq', '90000202', 'Banco DEMO Santander', '33999990024', 'DEMO Logística Federal S.A.', l2, hoy + 75, 1950000, true);

  insert into operaciones (cliente_id, tipo_codigo, modalidad, fecha_inicio, fecha_vencimiento, capital, tasa_interes, estado, es_demo)
  values (c4, 'prestamo', 'vencido', hoy, hoy + 90, 5000000, 3.4, 'en_analisis', true);

  insert into operaciones (cliente_id, tipo_codigo, modalidad, fecha_inicio, fecha_vencimiento, capital, tasa_interes, estado, es_demo)
  values (c3, 'prestamo', 'vencido', hoy, hoy + 60, 2500000, 3.3, 'borrador', true);

  -- 7) Operaciones históricas finalizadas (para los gráficos)
  for i in 2..10 loop
    insert into operaciones (cliente_id, tipo_codigo, modalidad, fecha_inicio, fecha_vencimiento, capital, tasa_interes, comisiones, estado, es_demo)
    values (case when i % 2 = 0 then c1 else c3 end, 'prestamo', 'vencido',
            (date_trunc('month', hoy) - (i || ' months')::interval)::date + 3,
            (date_trunc('month', hoy) - (i || ' months')::interval)::date + 33,
            1000000 + i * 350000, 3.5, 10000, 'aprobada', true)
    returning id into op;
    update operaciones set estado = 'activa', fecha_liquidacion = fecha_inicio where id = op;
    insert into pagos (cliente_id, operacion_id, fecha, medio, referencia, importe, imputado_capital, imputado_intereses, imputado_comisiones, es_demo)
    select cliente_id, id, fecha_vencimiento, 'transferencia', 'DEMO-HIST-' || i, importe_total, capital, intereses_pactados, comisiones + gastos, true
      from operaciones where id = op;
  end loop;

  -- Gastos operativos manuales (contabilidad)
  insert into movimientos_contables (fecha, tipo, categoria, concepto, importe, medio, es_demo) values
    (hoy - 35, 'egreso', 'honorarios', 'DEMO · Honorarios estudio contable', 450000, 'transferencia', true),
    (hoy - 33, 'egreso', 'servicios',  'DEMO · Hosting y servicios digitales', 85000, 'tarjeta', true),
    (hoy - 5,  'egreso', 'impuestos',  'DEMO · Impuesto sobre los ingresos brutos', 210000, 'transferencia', true);

end $$;

-- Devengamiento lineal hasta hoy (se ejecuta como backend)
do $$
declare r record; v_desde date; v_hasta date; v_imp numeric;
begin
  for r in select * from operaciones where es_demo and estado in ('activa','en_mora','finalizada') and intereses_pactados > 0 loop
    v_desde := r.fecha_inicio;
    v_hasta := least(current_date, r.fecha_vencimiento);
    continue when v_hasta <= v_desde;
    v_imp := case when v_hasta = r.fecha_vencimiento then r.intereses_pactados
                  else round(r.intereses_pactados * (v_hasta - v_desde) / r.dias, 2) end;
    insert into intereses (operacion_id, cliente_id, tipo, fecha, periodo_desde, periodo_hasta, importe, es_demo, observaciones)
    values (r.id, r.cliente_id, 'devengado', v_hasta, v_desde, v_hasta, v_imp, true, 'Devengamiento lineal (DEMO)');
  end loop;
end $$;

-- Factura en BORRADOR (sin CAE: no tiene validez fiscal hasta que ARCA la autorice)
do $$
declare f uuid; c uuid; o uuid;
begin
  select c.id into c from clientes c join empresas e on e.id = c.empresa_id where e.cuit = '30999990025';
  select id into o from operaciones where cliente_id = c and tipo_codigo = 'prestamo' and estado = 'activa' limit 1;
  insert into facturas (cliente_id, operacion_id, tipo_comprobante, punto_venta, concepto, fecha_emision,
                        fecha_servicio_desde, fecha_servicio_hasta, fecha_vto_pago,
                        receptor_doc_tipo, receptor_doc_nro, receptor_razon_social, receptor_condicion_iva, observaciones, es_demo)
  values (c, o, 1, 1, 2, current_date, date_trunc('month', current_date)::date, current_date, current_date + 10,
          80, '30999990025', 'DEMO Agroservicios del Litoral S.R.L.', 1, 'DEMO · Borrador de ejemplo', true)
  returning id into f;
  insert into factura_items (factura_id, descripcion, cantidad, precio_unitario, alicuota_iva_id) values
    (f, 'Comisión por otorgamiento (DEMO)', 1, 40000, 5),
    (f, 'Gastos administrativos (DEMO)', 1, 20000, 5);
end $$;

-- Formularios asignados
insert into formularios (plantilla_id, cliente_id, estado, fecha_limite, es_demo)
select p.id, c.id, 'pendiente', current_date + 10, true
  from plantillas_formulario p, clientes c join empresas e on e.id = c.empresa_id
 where p.codigo in ('alta_cliente','ddjj_pep') and e.cuit in ('33999990016','27999990016');
