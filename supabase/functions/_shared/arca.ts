// Cliente de los web services de ARCA (ex AFIP):
//   WSAA  → autenticación con certificado (Ticket de Acceso: token + sign)
//   WSFEv1 → factura electrónica (CAE)
//
// El certificado y la clave privada se cargan como secretos de la Edge Function
// (ARCA_CERT y ARCA_KEY en formato PEM). Nunca viajan al navegador.
import forge from "npm:node-forge@1.3.1";
import { XMLParser } from "npm:fast-xml-parser@4.5.0";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

export type Ambiente = "homologacion" | "produccion";

const URLS = {
  homologacion: {
    wsaa: "https://wsaahomo.afip.gov.ar/ws/services/LoginCms",
    wsfe: "https://wswhomo.afip.gov.ar/wsfev1/service.asmx",
  },
  produccion: {
    wsaa: "https://wsaa.afip.gov.ar/ws/services/LoginCms",
    wsfe: "https://servicios1.afip.gov.ar/wsfev1/service.asmx",
  },
} as const;

const parser = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true, parseTagValue: false, trimValues: true });

export class ErrorArca extends Error {
  constructor(message: string, public detalle?: unknown, public incierto = false) {
    super(message);
  }
}

function escaparXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function soap(url: string, accion: string, cuerpo: string, timeoutMs = 30000): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: accion },
      body: cuerpo,
      signal: ctrl.signal,
    });
    const texto = await res.text();
    const xml = parser.parse(texto);
    const body = xml?.Envelope?.Body;
    if (!body) throw new ErrorArca(`Respuesta inválida de ARCA (HTTP ${res.status})`, texto.slice(0, 500), true);
    if (body.Fault) throw new ErrorArca(`ARCA: ${body.Fault.faultstring ?? "error SOAP"}`, body.Fault);
    return body;
  } catch (e) {
    if (e instanceof ErrorArca) throw e;
    throw new ErrorArca("No se pudo comunicar con ARCA", String(e), true);
  } finally {
    clearTimeout(t);
  }
}

// ---------------------------------------------------------------------
// WSAA
// ---------------------------------------------------------------------
function firmarTRA(servicio: string, certPem: string, keyPem: string): string {
  const ahora = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
  const tra =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<loginTicketRequest version="1.0"><header>` +
    `<uniqueId>${Math.floor(ahora / 1000)}</uniqueId>` +
    `<generationTime>${iso(ahora - 10 * 60 * 1000)}</generationTime>` +
    `<expirationTime>${iso(ahora + 10 * 60 * 1000)}</expirationTime>` +
    `</header><service>${servicio}</service></loginTicketRequest>`;

  const cert = forge.pki.certificateFromPem(certPem);
  const key = forge.pki.privateKeyFromPem(keyPem);
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(tra, "utf8");
  p7.addCertificate(cert);
  p7.addSigner({
    key,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() as unknown as string },
    ],
  });
  p7.sign();
  return forge.util.encode64(forge.asn1.toDer(p7.toAsn1()).getBytes());
}

/** Devuelve un Ticket de Acceso vigente (lo cachea en arca_tokens, tabla sin acceso público). */
export async function obtenerTicket(admin: SupabaseClient, ambiente: Ambiente, servicio = "wsfe") {
  const { data: cache } = await admin
    .from("arca_tokens").select("token, sign, expira_at")
    .eq("servicio", servicio).eq("ambiente", ambiente).maybeSingle();
  if (cache && new Date(cache.expira_at).getTime() - Date.now() > 5 * 60 * 1000) {
    return { token: cache.token as string, sign: cache.sign as string };
  }

  const certPem = Deno.env.get("ARCA_CERT");
  const keyPem = Deno.env.get("ARCA_KEY");
  if (!certPem || !keyPem) {
    throw new ErrorArca("Falta configurar el certificado de ARCA (secretos ARCA_CERT y ARCA_KEY)");
  }
  const cms = firmarTRA(servicio, certPem.replace(/\\n/g, "\n"), keyPem.replace(/\\n/g, "\n"));
  const body = await soap(
    URLS[ambiente].wsaa,
    "",
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">` +
      `<soapenv:Header/><soapenv:Body><wsaa:loginCms><wsaa:in0>${cms}</wsaa:in0></wsaa:loginCms></soapenv:Body></soapenv:Envelope>`,
  );
  const ticketXml = body?.loginCmsResponse?.loginCmsReturn;
  if (!ticketXml) throw new ErrorArca("WSAA no devolvió un ticket de acceso", body);
  const ticket = parser.parse(ticketXml)?.loginTicketResponse;
  const token = ticket?.credentials?.token;
  const sign = ticket?.credentials?.sign;
  const expira = ticket?.header?.expirationTime;
  if (!token || !sign) throw new ErrorArca("Ticket de acceso inválido", ticket);

  await admin.from("arca_tokens").upsert({ servicio, ambiente, token, sign, expira_at: expira });
  return { token, sign };
}

// ---------------------------------------------------------------------
// WSFEv1
// ---------------------------------------------------------------------
const NS = "http://ar.gov.afip.dif.FEV1/";

async function wsfe(ambiente: Ambiente, metodo: string, auth: string, interior = "") {
  const body = await soap(
    URLS[ambiente].wsfe,
    NS + metodo,
    `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="${NS}"><soap:Body>` +
      `<ar:${metodo}>${auth}${interior}</ar:${metodo}></soap:Body></soap:Envelope>`,
  );
  const r = body?.[`${metodo}Response`]?.[`${metodo}Result`];
  if (!r) throw new ErrorArca(`Respuesta vacía de ${metodo}`, body, metodo === "FECAESolicitar");
  return r;
}

function authXml(t: { token: string; sign: string }, cuit: string) {
  return `<ar:Auth><ar:Token>${t.token}</ar:Token><ar:Sign>${t.sign}</ar:Sign><ar:Cuit>${cuit}</ar:Cuit></ar:Auth>`;
}

const lista = <T>(x: T | T[] | undefined): T[] => (x === undefined || x === null ? [] : Array.isArray(x) ? x : [x]);

function erroresDe(r: any) {
  return lista(r?.Errors?.Err).map((e: any) => ({ codigo: e.Code, mensaje: e.Msg }));
}

export async function dummy(ambiente: Ambiente) {
  const body = await soap(
    URLS[ambiente].wsfe,
    NS + "FEDummy",
    `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="${NS}"><soap:Body><ar:FEDummy/></soap:Body></soap:Envelope>`,
  );
  return body?.FEDummyResponse?.FEDummyResult;
}

export async function ultimoAutorizado(ambiente: Ambiente, ticket: { token: string; sign: string }, cuit: string, ptoVta: number, tipo: number) {
  const r = await wsfe(ambiente, "FECompUltimoAutorizado", authXml(ticket, cuit),
    `<ar:PtoVta>${ptoVta}</ar:PtoVta><ar:CbteTipo>${tipo}</ar:CbteTipo>`);
  const errs = erroresDe(r);
  if (errs.length) throw new ErrorArca("ARCA rechazó la consulta del último comprobante", errs);
  return Number(r.CbteNro ?? 0);
}

export async function consultarComprobante(ambiente: Ambiente, ticket: { token: string; sign: string }, cuit: string, ptoVta: number, tipo: number, nro: number) {
  const r = await wsfe(ambiente, "FECompConsultar", authXml(ticket, cuit),
    `<ar:FeCompConsReq><ar:CbteTipo>${tipo}</ar:CbteTipo><ar:CbteNro>${nro}</ar:CbteNro><ar:PtoVta>${ptoVta}</ar:PtoVta></ar:FeCompConsReq>`);
  if (erroresDe(r).length) return null;
  return r.ResultGet ?? null;
}

const fecha = (d: string | null | undefined) => (d ? d.replaceAll("-", "") : "");
const dinero = (n: number | string) => Number(n).toFixed(2);
const ALICUOTAS: Record<number, number> = { 3: 0, 4: 10.5, 5: 21, 6: 27, 8: 5, 9: 2.5 };

export interface FacturaArca {
  tipo_comprobante: number; punto_venta: number; concepto: number; fecha_emision: string;
  fecha_servicio_desde?: string | null; fecha_servicio_hasta?: string | null; fecha_vto_pago?: string | null;
  receptor_doc_tipo: number; receptor_doc_nro: string; receptor_condicion_iva: number;
  importe_neto: number; importe_iva: number; importe_exento: number; importe_no_gravado: number;
  importe_tributos: number; importe_total: number; moneda: string; cotizacion: number;
  items: { alicuota_iva_id: number; importe_neto: number; importe_iva: number }[];
  asociado?: { tipo: number; punto_venta: number; numero: number; fecha: string; cuit: string } | null;
}

/** Arma el detalle FECAEDetRequest según el tipo de comprobante. */
export function armarDetalle(f: FacturaArca, numero: number): string {
  const esC = [11, 12, 13].includes(f.tipo_comprobante);
  let iva = "";
  if (!esC) {
    const grupos = new Map<number, { base: number; importe: number }>();
    for (const it of f.items) {
      if (!(it.alicuota_iva_id in ALICUOTAS)) continue;      // exento / no gravado no van en Iva
      const g = grupos.get(it.alicuota_iva_id) ?? { base: 0, importe: 0 };
      g.base += Number(it.importe_neto); g.importe += Number(it.importe_iva);
      grupos.set(it.alicuota_iva_id, g);
    }
    if (grupos.size) {
      iva = "<ar:Iva>" + [...grupos].map(([id, g]) =>
        `<ar:AlicIva><ar:Id>${id}</ar:Id><ar:BaseImp>${dinero(g.base)}</ar:BaseImp><ar:Importe>${dinero(g.importe)}</ar:Importe></ar:AlicIva>`).join("") + "</ar:Iva>";
    }
  }
  const servicios = f.concepto === 1 ? "" :
    `<ar:FchServDesde>${fecha(f.fecha_servicio_desde)}</ar:FchServDesde>` +
    `<ar:FchServHasta>${fecha(f.fecha_servicio_hasta)}</ar:FchServHasta>` +
    `<ar:FchVtoPago>${fecha(f.fecha_vto_pago)}</ar:FchVtoPago>`;
  const asoc = f.asociado ?
    `<ar:CbtesAsoc><ar:CbteAsoc><ar:Tipo>${f.asociado.tipo}</ar:Tipo><ar:PtoVta>${f.asociado.punto_venta}</ar:PtoVta>` +
    `<ar:Nro>${f.asociado.numero}</ar:Nro><ar:Cuit>${f.asociado.cuit}</ar:Cuit><ar:CbteFch>${fecha(f.asociado.fecha)}</ar:CbteFch></ar:CbteAsoc></ar:CbtesAsoc>` : "";

  const neto = esC ? Number(f.importe_total) - Number(f.importe_tributos) : Number(f.importe_neto);
  return `<ar:FECAEDetRequest>` +
    `<ar:Concepto>${f.concepto}</ar:Concepto>` +
    `<ar:DocTipo>${f.receptor_doc_tipo}</ar:DocTipo>` +
    `<ar:DocNro>${f.receptor_doc_nro.replace(/\D/g, "")}</ar:DocNro>` +
    `<ar:CbteDesde>${numero}</ar:CbteDesde><ar:CbteHasta>${numero}</ar:CbteHasta>` +
    `<ar:CbteFch>${fecha(f.fecha_emision)}</ar:CbteFch>` +
    `<ar:ImpTotal>${dinero(f.importe_total)}</ar:ImpTotal>` +
    `<ar:ImpTotConc>${dinero(esC ? 0 : f.importe_no_gravado)}</ar:ImpTotConc>` +
    `<ar:ImpNeto>${dinero(neto)}</ar:ImpNeto>` +
    `<ar:ImpOpEx>${dinero(esC ? 0 : f.importe_exento)}</ar:ImpOpEx>` +
    `<ar:ImpTrib>${dinero(f.importe_tributos)}</ar:ImpTrib>` +
    `<ar:ImpIVA>${dinero(esC ? 0 : f.importe_iva)}</ar:ImpIVA>` +
    servicios +
    `<ar:MonId>${escaparXml(f.moneda)}</ar:MonId><ar:MonCotiz>${f.cotizacion}</ar:MonCotiz>` +
    `<ar:CondicionIVAReceptorId>${f.receptor_condicion_iva}</ar:CondicionIVAReceptorId>` +
    asoc + iva +
    `</ar:FECAEDetRequest>`;
}

export async function solicitarCAE(ambiente: Ambiente, ticket: { token: string; sign: string }, cuit: string, f: FacturaArca, numero: number) {
  const req =
    `<ar:FeCAEReq><ar:FeCabReq><ar:CantReg>1</ar:CantReg><ar:PtoVta>${f.punto_venta}</ar:PtoVta>` +
    `<ar:CbteTipo>${f.tipo_comprobante}</ar:CbteTipo></ar:FeCabReq>` +
    `<ar:FeDetReq>${armarDetalle(f, numero)}</ar:FeDetReq></ar:FeCAEReq>`;
  const r = await wsfe(ambiente, "FECAESolicitar", authXml(ticket, cuit), req);
  const det = lista(r?.FeDetResp?.FECAEDetResponse)[0] ?? {};
  return {
    resultado: (det.Resultado ?? r?.FeCabResp?.Resultado ?? "R") as "A" | "R" | "P",
    cae: det.CAE || null,
    caeVto: det.CAEFchVto ? `${det.CAEFchVto.slice(0, 4)}-${det.CAEFchVto.slice(4, 6)}-${det.CAEFchVto.slice(6, 8)}` : null,
    observaciones: lista(det?.Observaciones?.Obs).map((o: any) => ({ codigo: o.Code, mensaje: o.Msg })),
    errores: erroresDe(r),
    eventos: lista(r?.Events?.Evt).map((e: any) => ({ codigo: e.Code, mensaje: e.Msg })),
  };
}
