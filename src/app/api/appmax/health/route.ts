import { randomUUID } from "crypto";
import { NextResponse } from "next/server";

// GET/POST /api/appmax/health
// URL de validação/health check da Appmax. Requisito deles: a resposta precisa
// trazer o campo `external_id` em formato UUID e DINÂMICO (um valor diferente a
// cada chamada — nunca fixo). Por isso geramos um UUID novo por request e
// desligamos qualquer cache.
export const dynamic = "force-dynamic";

function payload() {
  return NextResponse.json(
    { external_id: randomUUID(), status: "ok" },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}

export function GET() {
  return payload();
}
export function POST() {
  return payload();
}
