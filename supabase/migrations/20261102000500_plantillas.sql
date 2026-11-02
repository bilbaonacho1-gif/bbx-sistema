-- =====================================================================
-- 05 · Plantillas base de formularios y acuerdos
-- Los textos legales son MODELOS: deben ser revisados por la asesoría
-- legal de BBX antes de usarse con clientes reales.
-- =====================================================================
insert into public.plantillas_formulario (codigo, nombre, categoria, descripcion, campos, texto_legal, requiere_firma, cliente_puede_iniciar) values
('solicitud_descuento', 'Solicitud de descuento de cheques', 'descuento_cheques',
 'Pedido de cotización y descuento de cheques de pago diferido o ECHEQ.',
 '[
   {"clave":"tipo_cheque","etiqueta":"Tipo de cheque","tipo":"select","requerido":true,"opciones":["Cheque físico","ECHEQ","Ambos"]},
   {"clave":"cantidad","etiqueta":"Cantidad de cheques","tipo":"numero","requerido":true},
   {"clave":"monto_total","etiqueta":"Monto total ($)","tipo":"numero","requerido":true},
   {"clave":"fecha_pago","etiqueta":"Fecha de pago más lejana","tipo":"fecha","requerido":true},
   {"clave":"librador","etiqueta":"Librador principal","tipo":"texto","requerido":true},
   {"clave":"librador_cuit","etiqueta":"CUIT del librador","tipo":"cuit","requerido":false},
   {"clave":"cbu","etiqueta":"CBU o alias para la acreditación","tipo":"texto","requerido":true},
   {"clave":"observaciones","etiqueta":"Observaciones","tipo":"textarea","requerido":false}
 ]',
 'MODELO. El solicitante declara que los cheques detallados son de su legítima propiedad, que provienen de operaciones comerciales lícitas y que responde por su pago en los términos de la normativa aplicable en caso de rechazo. La presente solicitud no obliga a BBX Soluciones Financieras S.A. a realizar la operación, que queda sujeta a su análisis y aprobación.',
 true, true),
('solicitud_acuerdo', 'Solicitud de acuerdo en cuenta corriente', 'acuerdo_cc',
 'Pedido de una línea de asistencia con límite y tasa pactada.',
 '[
   {"clave":"monto","etiqueta":"Límite solicitado ($)","tipo":"numero","requerido":true},
   {"clave":"plazo_dias","etiqueta":"Plazo (días)","tipo":"numero","requerido":true},
   {"clave":"destino","etiqueta":"Destino de los fondos","tipo":"select","requerido":true,"opciones":["Capital de trabajo","Pago a proveedores","Sueldos","Impuestos","Otro"]},
   {"clave":"garantia","etiqueta":"Garantía ofrecida","tipo":"texto","requerido":false},
   {"clave":"cbu","etiqueta":"CBU o alias","tipo":"texto","requerido":true},
   {"clave":"observaciones","etiqueta":"Observaciones","tipo":"textarea","requerido":false}
 ]',
 'MODELO. El solicitante declara que la información brindada es veraz y autoriza a BBX Soluciones Financieras S.A. a verificarla y a consultar bases de información crediticia. El acuerdo queda sujeto a análisis, aprobación y a la firma del contrato correspondiente.',
 true, true),
('alta_cliente', 'Formulario de alta de cliente', 'alta_cliente',
 'Información comercial y patrimonial para el legajo del cliente.',
 '[
   {"clave":"actividad","etiqueta":"Actividad principal","tipo":"texto","requerido":true},
   {"clave":"antiguedad","etiqueta":"Antigüedad en la actividad (años)","tipo":"numero","requerido":true},
   {"clave":"facturacion_anual","etiqueta":"Facturación anual estimada ($)","tipo":"numero","requerido":true},
   {"clave":"bancos","etiqueta":"Bancos con los que opera","tipo":"texto","requerido":true},
   {"clave":"origen_fondos","etiqueta":"Origen de los fondos","tipo":"textarea","requerido":true}
 ]',
 'MODELO. Declaro bajo juramento que los datos consignados son correctos y completos, y me comprometo a informar cualquier modificación.',
 true, false),
('ddjj_pep', 'Declaración jurada de Persona Expuesta Políticamente', 'declaracion',
 'Declaración exigida por la normativa de prevención de lavado de activos.',
 '[
   {"clave":"es_pep","etiqueta":"¿Es Persona Expuesta Políticamente?","tipo":"select","requerido":true,"opciones":["No","Sí"]},
   {"clave":"cargo","etiqueta":"Si respondió Sí: cargo o función","tipo":"texto","requerido":false},
   {"clave":"vinculo","etiqueta":"Vínculo con una PEP (si corresponde)","tipo":"texto","requerido":false}
 ]',
 'MODELO. Declaro bajo juramento que la información consignada es exacta y verdadera, y que tengo conocimiento de la nómina de funciones de Personas Expuestas Políticamente vigente.',
 true, false);
