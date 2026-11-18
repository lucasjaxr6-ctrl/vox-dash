import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { HttpError } from "./auth";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

/**
 * Converte erros em respostas seguras.
 * NUNCA devolve stack trace ou mensagem interna ao cliente em produção.
 */
export function handleError(err: unknown) {
  if (err instanceof ZodError) {
    // Erros de validação podem ser detalhados (ajudam o frontend) sem risco.
    return json(
      { error: "Dados inválidos", issues: err.flatten().fieldErrors },
      400,
    );
  }
  if (err instanceof HttpError) {
    return json({ error: err.message }, err.status);
  }
  // Erro inesperado: loga internamente, devolve mensagem genérica.
  console.error("[unexpected error]", err);
  return json({ error: "Erro interno" }, 500);
}
