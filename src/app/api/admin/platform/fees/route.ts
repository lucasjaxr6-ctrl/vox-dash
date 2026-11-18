import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { json, handleError } from "@/lib/http";
import {
  getFeeConfig,
  salvarFeeConfig,
  salvarPctDaLoja,
  backfillTaxas,
} from "@/lib/platform-fees";
import { temPixPlataforma } from "@/lib/platform-pix";

// GET/PUT /api/admin/platform/fees
//
// Percentual PADRÃO da plataforma e percentual INDIVIDUAL de uma loja.
//
// Não existe liga/desliga: a cobrança é sempre ativa. O que existe é o marco
// de início (a partir de quando as vendas contam), criado sozinho na primeira
// leitura — ver lib/platform-fees.ts.
//
// A credencial da Cakto NÃO passa por aqui: vive só no ambiente (ver
// lib/cakto-plataforma.ts), porque aponta para a conta que recebe o dinheiro.

const schema = z.object({
  /** Percentuais padrão, para quem não tem taxa individual. */
  pct: z.number().min(0).max(100).optional(),
  recoveryPct: z.number().min(0).max(100).optional(),
  /** Taxa individual: `null` remove e devolve a loja ao padrão. */
  storeId: z.string().min(1).max(36).optional(),
  pctLoja: z.number().min(0).max(100).nullable().optional(),
  recoveryPctLoja: z.number().min(0).max(100).nullable().optional(),
});

export async function GET() {
  try {
    await requireAdmin();
    const cfg = await getFeeConfig();
    return json({ ...cfg, temToken: temPixPlataforma() });
  } catch (err) {
    return handleError(err);
  }
}

export async function PUT(req: Request) {
  try {
    await requireAdmin();
    const input = schema.parse(await req.json());

    if (typeof input.pct === "number" || typeof input.recoveryPct === "number") {
      await salvarFeeConfig({ pct: input.pct, recoveryPct: input.recoveryPct });
    }
    if (input.storeId && (input.pctLoja !== undefined || input.recoveryPctLoja !== undefined)) {
      await salvarPctDaLoja(input.storeId, input.pctLoja ?? null, input.recoveryPctLoja);
    }

    // Contabiliza as vendas de hoje que ainda não tinham taxa. Idempotente
    // (UNIQUE(orderId)) e barato quando não há o que preencher.
    const contabilizadas = await backfillTaxas();

    const cfg = await getFeeConfig();
    return json({ ok: true, ...cfg, temToken: temPixPlataforma(), contabilizadas });
  } catch (err) {
    return handleError(err);
  }
}
