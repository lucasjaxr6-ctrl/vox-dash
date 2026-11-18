// Quanto tempo depois do evento cada e-mail sai. Sem "server-only": o formulário do
// painel usa os mesmos limites que o servidor confere.

export type KindTempo = "pix" | "paid" | "separation" | "tracking" | "recovery" | "pixrecovery";

const SETE_DIAS = 7 * 24 * 60;

/**
 * Em minutos. `padrao` é o comportamento de sempre: quem não mexer não percebe nada.
 *
 * Reengajamento não desce de 5 minutos: antes disso o cliente ainda pode estar
 * preenchendo. Os e-mails de Pix podem esperar o quanto o lojista quiser porque olham
 * a validade real na hora de sair: código vencido vira botão para gerar outro.
 */
export const TEMPOS_EMAIL: Record<KindTempo, { padrao: number; min: number; max: number }> = {
  pix: { padrao: 0, min: 0, max: SETE_DIAS },
  paid: { padrao: 0, min: 0, max: SETE_DIAS },
  separation: { padrao: 10, min: 0, max: SETE_DIAS },
  tracking: { padrao: 0, min: 0, max: SETE_DIAS },
  pixrecovery: { padrao: 15, min: 5, max: SETE_DIAS },
  recovery: { padrao: 15, min: 5, max: SETE_DIAS },
};

export const TEMPOS_PADRAO = Object.fromEntries(
  Object.entries(TEMPOS_EMAIL).map(([k, r]) => [k, r.padrao]),
) as Record<KindTempo, number>;

/** Lê o que está salvo. Valor ausente ou fora do limite vale o padrão. */
export function lerTempos(salvo: unknown): Record<KindTempo, number> {
  let dados: unknown = salvo;
  if (typeof salvo === "string") {
    try {
      dados = JSON.parse(salvo);
    } catch {
      dados = null;
    }
  }
  const objeto = (dados && typeof dados === "object" ? dados : {}) as Record<string, unknown>;
  const tempos = { ...TEMPOS_PADRAO };
  for (const k of Object.keys(TEMPOS_EMAIL) as KindTempo[]) {
    const v = objeto[k];
    const { min, max } = TEMPOS_EMAIL[k];
    if (typeof v === "number" && Number.isInteger(v) && v >= min && v <= max) tempos[k] = v;
  }
  return tempos;
}

/** "20 minutos", "1 hora", "7 dias". */
export function textoTempo(minutos: number): string {
  const plural = (n: number, palavra: string) => `${n} ${palavra}${n === 1 ? "" : "s"}`;
  if (minutos > 0 && minutos % 1440 === 0) return plural(minutos / 1440, "dia");
  if (minutos > 0 && minutos % 60 === 0) return plural(minutos / 60, "hora");
  return plural(minutos, "minuto");
}
