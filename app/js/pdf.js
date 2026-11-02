// Comprobantes en PDF (jsPDF se carga sólo cuando hace falta).
//
// * Factura AUTORIZADA (con CAE): formato de comprobante electrónico con el
//   código QR de ARCA (RG 4892).
// * Factura en BORRADOR o RECHAZADA: se genera sólo como vista previa, con la
//   marca "SIN VALIDEZ FISCAL" y sin CAE ni QR. Nunca se presenta como comprobante.
// * Liquidaciones y estados de cuenta: documentos informativos.
import { money, fecha, cuitFmt, TIPOS_COMPROBANTE, LETRA, ALICUOTAS, nroComprobante, fechaHora } from "./ui.js";

let cargado = null;
function cargarScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = src; s.onload = res; s.onerror = () => rej(new Error("No se pudo cargar " + src));
    document.head.append(s);
  });
}
async function libs() {
  cargado ??= Promise.all([cargarScript("/app/vendor/jspdf-2.5.2.umd.min.js"), cargarScript("/app/vendor/qrcode-generator-1.4.4.js")]);
  await cargado;
  return { jsPDF: window.jspdf.jsPDF, qrcode: window.qrcode };
}

const AZUL = [10, 15, 26], ACENTO = [30, 91, 255], GRIS = [110, 118, 135], LINEA = [220, 224, 232];
const COND_IVA = { 1: "IVA Responsable Inscripto", 4: "IVA Sujeto Exento", 5: "Consumidor Final", 6: "Responsable Monotributo", 7: "Sujeto No Categorizado", 8: "Proveedor del Exterior", 9: "Cliente del Exterior", 10: "IVA Liberado", 13: "Monotributista Social", 15: "IVA No Alcanzado", 16: "Monotributo Trabajador Independiente Promovido" };

function encabezado(doc, titulo, sub) {
  doc.setFillColor(...AZUL); doc.rect(0, 0, 210, 26, "F");
  doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(18); doc.text("BBX", 14, 15);
  doc.setFont("helvetica", "normal"); doc.setFontSize(6.5); doc.text("SOLUCIONES FINANCIERAS S.A.", 14, 20);
  doc.setFontSize(12); doc.setFont("helvetica", "bold"); doc.text(titulo, 196, 13, { align: "right" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.text(sub, 196, 19, { align: "right" });
  doc.setTextColor(...AZUL);
}

function pie(doc, texto) {
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setDrawColor(...LINEA); doc.line(14, 284, 196, 284);
    doc.setFontSize(7); doc.setTextColor(...GRIS);
    doc.text(texto, 14, 289);
    doc.text(`Página ${i} de ${n}`, 196, 289, { align: "right" });
  }
}

function tabla(doc, y, cols, filas, { anchoTotal = 182, x0 = 14 } = {}) {
  doc.setFillColor(242, 244, 248); doc.rect(x0, y - 5, anchoTotal, 8, "F");
  doc.setFontSize(8); doc.setFont("helvetica", "bold"); doc.setTextColor(...GRIS);
  let x = x0 + 2;
  cols.forEach((c) => { doc.text(c.label, c.right ? x + c.w - 4 : x, y, { align: c.right ? "right" : "left" }); x += c.w; });
  doc.setFont("helvetica", "normal"); doc.setTextColor(...AZUL);
  y += 8;
  for (const f of filas) {
    if (y > 270) { doc.addPage(); y = 20; }
    x = x0 + 2;
    let alto = 1;
    cols.forEach((c, i) => {
      const txt = doc.splitTextToSize(String(f[i] ?? ""), c.w - 4);
      alto = Math.max(alto, txt.length);
      doc.text(txt, c.right ? x + c.w - 4 : x, y, { align: c.right ? "right" : "left" });
      x += c.w;
    });
    y += 4.5 * alto + 2;
    doc.setDrawColor(...LINEA); doc.line(x0, y - 4, x0 + anchoTotal, y - 4);
  }
  return y;
}

function marcaAgua(doc, texto) {
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.saveGraphicsState();
    doc.setGState(new doc.GState({ opacity: 0.12 }));
    doc.setTextColor(200, 30, 30); doc.setFont("helvetica", "bold"); doc.setFontSize(44);
    doc.text(texto, 105, 160, { align: "center", angle: 35 });
    doc.restoreGraphicsState();
  }
}

/** Factura / nota: f incluye items; emisor = arca_config */
export async function pdfFactura(f, emisor) {
  const { jsPDF, qrcode } = await libs();
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const autorizada = f.estado === "autorizada" && f.cae;
  const letra = LETRA[f.tipo_comprobante];

  // Cabecera fiscal
  doc.setDrawColor(...AZUL); doc.setLineWidth(0.3); doc.rect(14, 12, 182, 44);
  doc.line(105, 26, 105, 56);
  doc.setFillColor(255, 255, 255); doc.rect(97, 12, 16, 14, "FD");
  doc.setFont("helvetica", "bold"); doc.setFontSize(20); doc.text(letra, 105, 22, { align: "center" });
  doc.setFontSize(6); doc.text(`COD. ${String(f.tipo_comprobante).padStart(2, "0")}`, 105, 25, { align: "center" });

  doc.setFontSize(12.5); doc.text(doc.splitTextToSize(emisor?.razon_social || "BBX Soluciones Financieras S.A.", 74), 18, 20);
  doc.setFont("helvetica", "normal"); doc.setFontSize(8);
  doc.text(doc.splitTextToSize(`Domicilio: ${emisor?.domicilio || "—"}`, 82).concat(`Condición frente al IVA: ${emisor?.condicion_iva || "—"}`), 18, 34);

  doc.setFont("helvetica", "bold"); doc.setFontSize(13);
  doc.text(TIPOS_COMPROBANTE[f.tipo_comprobante].toUpperCase(), 118, 20);
  doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
  doc.text([
    `Punto de venta: ${String(f.punto_venta).padStart(5, "0")}    Comp. Nro: ${f.numero ? String(f.numero).padStart(8, "0") : "—"}`,
    `Fecha de emisión: ${fecha(f.fecha_emision)}`,
    `CUIT: ${cuitFmt(emisor?.cuit_emisor)}`,
    `Ingresos Brutos: ${emisor?.ingresos_brutos || "—"}`,
    `Inicio de actividades: ${fecha(emisor?.inicio_actividades)}`,
  ], 110, 34);

  if (f.concepto !== 1) {
    doc.setDrawColor(...LINEA); doc.rect(14, 58, 182, 8);
    doc.text(`Período facturado desde: ${fecha(f.fecha_servicio_desde)}   hasta: ${fecha(f.fecha_servicio_hasta)}   Vencimiento del pago: ${fecha(f.fecha_vto_pago)}`, 18, 63.5);
  }
  const yR = f.concepto !== 1 ? 68 : 58;
  doc.setDrawColor(...LINEA); doc.rect(14, yR, 182, 20);
  doc.setFont("helvetica", "bold"); doc.text("Receptor", 18, yR + 5.5);
  doc.setFont("helvetica", "normal");
  doc.text([
    `${f.receptor_doc_tipo === 80 ? "CUIT" : "Documento"}: ${f.receptor_doc_tipo === 80 ? cuitFmt(f.receptor_doc_nro) : f.receptor_doc_nro}    Razón social: ${f.receptor_razon_social}`,
    `Condición frente al IVA: ${COND_IVA[f.receptor_condicion_iva] ?? f.receptor_condicion_iva}`,
    `Domicilio: ${f.receptor_domicilio || "—"}`,
  ], 18, yR + 10.5);

  const esC = letra === "C";
  const cols = esC
    ? [{ label: "Descripción", w: 102 }, { label: "Cant.", w: 18, right: true }, { label: "Precio unit.", w: 30, right: true }, { label: "Subtotal", w: 32, right: true }]
    : [{ label: "Descripción", w: 78 }, { label: "Cant.", w: 16, right: true }, { label: "Precio unit.", w: 28, right: true }, { label: "IVA", w: 18, right: true }, { label: "Subtotal c/IVA", w: 42, right: true }];
  const filas = (f.factura_items ?? []).map((it) => esC
    ? [it.descripcion, Number(it.cantidad), money(it.precio_unitario), money(it.importe_neto)]
    : [it.descripcion, Number(it.cantidad), money(it.precio_unitario), ALICUOTAS[it.alicuota_iva_id], money(Number(it.importe_neto) + Number(it.importe_iva))]);
  let y = tabla(doc, yR + 30, cols, filas);

  y = Math.max(y + 4, 200);
  doc.setDrawColor(...LINEA); doc.rect(110, y, 86, esC ? 14 : 34);
  doc.setFontSize(9);
  const totales = esC ? [["Importe total", f.importe_total]] : [
    ["Importe neto gravado", f.importe_neto], ["Importe exento", f.importe_exento], ["Importe no gravado", f.importe_no_gravado],
    ["IVA", f.importe_iva], ["Importe total", f.importe_total]];
  totales.forEach(([l, v], i) => {
    const ultimo = i === totales.length - 1;
    doc.setFont("helvetica", ultimo ? "bold" : "normal");
    doc.text(l, 114, y + 7 + i * 6); doc.text(money(v), 192, y + 7 + i * 6, { align: "right" });
  });

  const yC = 246;
  if (autorizada) {
    const datosQR = {
      ver: 1, fecha: f.fecha_emision, cuit: Number(emisor.cuit_emisor), ptoVta: f.punto_venta, tipoCmp: f.tipo_comprobante,
      nroCmp: Number(f.numero), importe: Number(f.importe_total), moneda: f.moneda, ctz: Number(f.cotizacion),
      tipoDocRec: f.receptor_doc_tipo, nroDocRec: Number(String(f.receptor_doc_nro).replace(/\D/g, "")), tipoCodAut: "E", codAut: Number(f.cae),
    };
    const url = "https://www.afip.gob.ar/fe/qr/?p=" + btoa(JSON.stringify(datosQR));
    const qr = qrcode(0, "M"); qr.addData(url); qr.make();
    doc.addImage(qr.createDataURL(4, 0), "GIF", 14, yC, 30, 30);
    doc.setFont("helvetica", "bold"); doc.setFontSize(9);
    doc.text("Comprobante autorizado", 48, yC + 8);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
    doc.text([`CAE: ${f.cae}`, `Fecha de vto. de CAE: ${fecha(f.cae_vencimiento)}`, f.ambiente === "homologacion" ? "AMBIENTE DE HOMOLOGACIÓN (PRUEBAS) — SIN VALIDEZ FISCAL" : ""], 48, yC + 14);
    if (f.ambiente === "homologacion") marcaAgua(doc, "HOMOLOGACIÓN · SIN VALIDEZ FISCAL");
  } else {
    doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(200, 30, 30);
    doc.text("VISTA PREVIA — DOCUMENTO SIN VALIDEZ FISCAL", 14, yC + 8);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(...AZUL);
    doc.text("Este comprobante todavía no fue autorizado por ARCA (no tiene CAE).", 14, yC + 14);
    marcaAgua(doc, "BORRADOR · SIN VALIDEZ FISCAL");
  }
  pie(doc, `Generado el ${fechaHora(new Date())} desde la plataforma BBX`);
  doc.save(`${TIPOS_COMPROBANTE[f.tipo_comprobante].replace(/\s+/g, "_")}_${autorizada ? nroComprobante(f) : "BORRADOR"}.pdf`);
}

/** Liquidación de una operación (documento informativo) */
export async function pdfLiquidacion(op, cheques = []) {
  const { jsPDF } = await libs();
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  encabezado(doc, "Liquidación de operación", `${op.numero} · ${fecha(op.fecha_liquidacion || op.fecha_inicio)}`);
  doc.setFontSize(10); doc.setFont("helvetica", "bold");
  doc.text(op.cliente_razon_social ?? "", 14, 38);
  doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(...GRIS);
  doc.text(`CUIT ${cuitFmt(op.cliente_cuit)} · ${op.tipo_nombre} · Modalidad: ${op.modalidad === "descuento" ? "intereses descontados al liquidar" : "intereses al vencimiento"}`, 14, 43);
  doc.setTextColor(...AZUL);
  let y = 55;
  if (cheques.length) {
    y = tabla(doc, y, [{ label: "Cheque", w: 26 }, { label: "Banco", w: 38 }, { label: "Librador", w: 54 }, { label: "Pago", w: 24 }, { label: "Importe", w: 40, right: true }],
      cheques.map((c) => [`${c.tipo === "echeq" ? "ECHEQ" : "Físico"} ${c.numero}`, c.banco, c.librador_nombre || cuitFmt(c.librador_cuit), fecha(c.fecha_pago), money(c.monto)]));
    y += 6;
  }
  const filas = [
    ["Capital / valor nominal", money(op.capital)],
    [`Tasa ${op.tasa_periodo} ${String(op.tasa_interes).replace(".", ",")} % · base ${op.base_dias} días · ${op.dias} días`, ""],
    ["Intereses pactados", money(op.intereses_pactados)],
    ["Gastos", money(op.gastos)],
    ["Comisiones", money(op.comisiones)],
    ["IVA sobre comisiones", money(op.iva_comisiones)],
    [op.modalidad === "descuento" ? "Importe neto liquidado" : "Importe entregado", money(op.importe_liquidado)],
    [op.modalidad === "descuento" ? "Total a cobrar al vencimiento (cheques)" : "Total a devolver", money(op.importe_total)],
  ];
  y = tabla(doc, y, [{ label: "Concepto", w: 130 }, { label: "Importe", w: 52, right: true }], filas);
  doc.setFontSize(8); doc.setTextColor(...GRIS);
  doc.text(doc.splitTextToSize("Documento informativo. No válido como factura. Los comprobantes fiscales se emiten por separado con CAE de ARCA.", 182), 14, y + 8);
  pie(doc, `BBX Soluciones Financieras S.A. · Generado el ${fechaHora(new Date())}`);
  doc.save(`Liquidacion_${op.numero}.pdf`);
}

/** Estado de cuenta de un cliente */
export async function pdfEstadoCuenta(cliente, movimientos) {
  const { jsPDF } = await libs();
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  encabezado(doc, "Estado de cuenta", `Al ${fecha(new Date().toISOString())}`);
  doc.setFontSize(10); doc.setFont("helvetica", "bold"); doc.text(cliente.razon_social ?? "", 14, 38);
  doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(...GRIS);
  doc.text(`CUIT ${cuitFmt(cliente.cuit)} · Cliente ${cliente.codigo ?? ""}`, 14, 43); doc.setTextColor(...AZUL);
  const y = tabla(doc, 55, [{ label: "Fecha", w: 22 }, { label: "Concepto", w: 76 }, { label: "Cargo", w: 28, right: true }, { label: "Abono", w: 28, right: true }, { label: "Saldo", w: 28, right: true }],
    movimientos.map((m) => [fecha(m.fecha), m.concepto, m.sentido === "cargo" ? money(m.importe) : "", m.sentido === "abono" ? money(m.importe) : "", m.sentido === "informativo" ? "" : money(m.saldo)]));
  const saldo = movimientos.length ? movimientos[movimientos.length - 1].saldo : 0;
  doc.setFont("helvetica", "bold"); doc.setFontSize(10);
  doc.text(`Saldo: ${money(saldo)}`, 196, y + 6, { align: "right" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...GRIS);
  doc.text("Documento informativo. No válido como factura.", 14, y + 6);
  pie(doc, `BBX Soluciones Financieras S.A. · Generado el ${fechaHora(new Date())}`);
  doc.save(`Estado_de_cuenta_${(cliente.razon_social ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\W+/g, "_")}.pdf`);
}
