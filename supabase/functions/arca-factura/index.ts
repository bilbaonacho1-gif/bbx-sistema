// Edge Function: emisión de comprobantes electrónicos en ARCA (WSFEv1).
//
// POST /functions/v1/arca-factura
//   { "accion": "estado" }                         → verifica configuración y servidores de ARCA
//   { "accion": "emitir", "factura_id": "<uuid>" } → pide el CAE para una factura en borrador
//
// Requiere el permiso facturacion.emitir. La factura sólo queda "autorizada" si ARCA
// devuelve Resultado = A con CAE; si no, queda "rechazada" con los errores de ARCA.
// Secretos: ARCA_CERT, ARCA_KEY (PEM) y ARCA_AMBIENTE (homologacion | produccion).
import { clienteAdmin, ErrorHttp, exigirPermiso, json, manejar } from "../_shared/comun.ts";
import {
  type Ambiente, consultarComprobante, dummy, ErrorArca, type FacturaArca, obtenerTicket, solicitarCAE, ultimoAutorizado,
} from "../_shared/arca.ts";

const AMBIENTE = (Deno.env.get("ARCA_AMBIENTE") ?? "homologacion") as Ambiente;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(manejar(async (req) => {
  const { userId } = await exigirPermiso(req, "facturacion.emitir");
  const admin = clienteAdmin();
  const body = await req.json().catch(() => ({}));

  const { data: cfg } = await admin.from("arca_config").select("*").eq("id", 1).single();
  const log = (operacion: string, exito: boolean, detalle: unknown, factura_id: string | null = null) =>
    admin.from("arca_log").insert({ operacion, exito, detalle, factura_id, ambiente: AMBIENTE, usuario_id: userId });

  if (body.accion === "estado") {
    const faltantes = [
      !cfg?.cuit_emisor && "CUIT emisor",
      !cfg?.punto_venta && "punto de venta",
      !Deno.env.get("ARCA_CERT") && "certificado (ARCA_CERT)",
      !Deno.env.get("ARCA_KEY") && "clave privada (ARCA_KEY)",
    ].filter(Boolean);
    let servidores: unknown = null;
    try { servidores = await dummy(AMBIENTE); } catch (e) { servidores = { error: (e as Error).message }; }
    let autenticacion: unknown = null;
    if (!faltantes.length) {
      try { await obtenerTicket(admin, AMBIENTE); autenticacion = "ok"; }
      catch (e) { autenticacion = { error: (e as Error).message, detalle: (e as ErrorArca).detalle }; }
    }
    await log("estado", !faltantes.length && autenticacion === "ok", { faltantes, servidores, autenticacion });
    return json(req, { ambiente: AMBIENTE, configurado: faltantes.length === 0, faltantes, servidores, autenticacion });
  }

  if (body.accion !== "emitir" || !UUID.test(body.factura_id ?? "")) {
    throw new ErrorHttp(400, "Acción o factura inválida");
  }
  if (!cfg?.cuit_emisor || !cfg?.punto_venta) {
    throw new ErrorHttp(422, "Completá el CUIT emisor y el punto de venta en Configuración → Facturación");
  }
  if (cfg.ambiente !== AMBIENTE) {
    throw new ErrorHttp(422, `El ambiente configurado (${cfg.ambiente}) no coincide con el certificado cargado (${AMBIENTE})`);
  }

  // Bloqueo optimista: sólo una solicitud por factura a la vez
  const { data: f, error: eLock } = await admin.from("facturas")
    .update({ estado: "enviando", enviada_at: new Date().toISOString(), ambiente: AMBIENTE, punto_venta: cfg.punto_venta })
    .eq("id", body.factura_id).in("estado", ["borrador", "rechazada"])
    .select("*, factura_items(*), asociado:comprobante_asociado_id(tipo_comprobante, punto_venta, numero, fecha_emision, estado)")
    .maybeSingle();
  if (eLock) throw new ErrorHttp(500, "No se pudo bloquear la factura");
  if (!f) throw new ErrorHttp(409, "La factura no existe o ya fue enviada");

  const volverABorrador = async (motivo: unknown) => {
    await admin.from("facturas").update({ estado: "rechazada", errores_arca: motivo, resultado_arca: "R" }).eq("id", f.id);
  };

  if (!f.factura_items?.length || Number(f.importe_total) <= 0) {
    await volverABorrador([{ mensaje: "La factura no tiene ítems o su total es cero" }]);
    throw new ErrorHttp(422, "La factura no tiene ítems o su total es cero");
  }
  const esNota = [2, 3, 7, 8, 12, 13].includes(f.tipo_comprobante);
  if (esNota && f.asociado?.estado !== "autorizada") {
    await volverABorrador([{ mensaje: "Las notas de crédito/débito requieren un comprobante asociado autorizado" }]);
    throw new ErrorHttp(422, "Las notas de crédito/débito requieren un comprobante asociado autorizado");
  }

  const datos: FacturaArca = {
    ...f,
    items: f.factura_items,
    asociado: esNota ? {
      tipo: f.asociado.tipo_comprobante, punto_venta: f.asociado.punto_venta, numero: Number(f.asociado.numero),
      fecha: f.asociado.fecha_emision, cuit: cfg.cuit_emisor,
    } : null,
  };

  let numero = 0;
  try {
    const ticket = await obtenerTicket(admin, AMBIENTE);
    numero = (await ultimoAutorizado(AMBIENTE, ticket, cfg.cuit_emisor, cfg.punto_venta, f.tipo_comprobante)) + 1;

    let r;
    try {
      r = await solicitarCAE(AMBIENTE, ticket, cfg.cuit_emisor, datos, numero);
    } catch (e) {
      // Si la comunicación se cortó, ARCA pudo haber autorizado igual: se verifica antes de reintentar.
      if (e instanceof ErrorArca && e.incierto) {
        const c = await consultarComprobante(AMBIENTE, ticket, cfg.cuit_emisor, cfg.punto_venta, f.tipo_comprobante, numero).catch(() => null);
        if (c?.CodAutorizacion && Number(c.ImpTotal) === Number(f.importe_total) && String(c.DocNro) === f.receptor_doc_nro.replace(/\D/g, "")) {
          r = {
            resultado: "A" as const, cae: c.CodAutorizacion,
            caeVto: `${c.FchVto.slice(0, 4)}-${c.FchVto.slice(4, 6)}-${c.FchVto.slice(6, 8)}`,
            observaciones: [{ codigo: "BBX", mensaje: "Recuperado con FECompConsultar tras un corte de comunicación" }],
            errores: [], eventos: [],
          };
        } else {
          throw e;
        }
      } else {
        throw e;
      }
    }

    if (r.resultado === "A" && r.cae && r.caeVto) {
      const { error } = await admin.from("facturas").update({
        estado: "autorizada", numero, cae: r.cae, cae_vencimiento: r.caeVto, resultado_arca: "A",
        observaciones_arca: r.observaciones.length ? r.observaciones : null, errores_arca: null,
        autorizada_at: new Date().toISOString(),
      }).eq("id", f.id);
      if (error) throw new ErrorHttp(500, "ARCA autorizó el comprobante pero no se pudo guardar: revisar arca_log", { numero, cae: r.cae });
      await log("emitir", true, { numero, cae: r.cae, observaciones: r.observaciones, eventos: r.eventos }, f.id);
      return json(req, { estado: "autorizada", numero, cae: r.cae, cae_vencimiento: r.caeVto, observaciones: r.observaciones });
    }

    const motivo = [...r.errores, ...r.observaciones];
    await admin.from("facturas").update({
      estado: "rechazada", resultado_arca: r.resultado, errores_arca: motivo.length ? motivo : [{ mensaje: "Rechazada sin detalle" }],
      observaciones_arca: r.observaciones.length ? r.observaciones : null,
    }).eq("id", f.id);
    await log("emitir", false, { numero, ...r }, f.id);
    return json(req, { estado: "rechazada", errores: motivo }, 422);
  } catch (e) {
    if (e instanceof ErrorHttp) throw e;
    const detalle = e instanceof ErrorArca ? e.detalle : String(e);
    await volverABorrador([{ mensaje: (e as Error).message, detalle }]);
    await log("emitir", false, { numero, error: (e as Error).message, detalle }, f.id);
    throw new ErrorHttp(502, (e as Error).message, detalle);
  }
}));
