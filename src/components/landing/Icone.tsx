// Ícones da landing: traço único de 1.8 em grade 24, pontas redondas, cor do
// texto. Substituem os caracteres unicode e emojis do HTML original (↯ ⌁ ◌ ◎
// ↻ ◈ ▣ 🔒 ⚡), que mudavam de desenho e de tamanho de fonte para fonte.
const DESENHOS = {
  rota: ["M3 12h6", "M9 12c3.5 0 3.5-6 7.5-6H21", "M9 12h12", "M9 12c3.5 0 3.5 6 7.5 6H21"],
  globo: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z", "M3.5 9h17", "M3.5 15h17", "M12 3c2.4 2.6 3.6 5.6 3.6 9s-1.2 6.4-3.6 9c-2.4-2.6-3.6-5.6-3.6-9S9.6 5.6 12 3Z"],
  carta: ["M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z", "m3.5 7 8.5 6 8.5-6"],
  pulso: ["M3 12h4l3-7 4 14 3-7h4"],
  sincronizar: ["M20 11.5A8 8 0 0 0 5.6 7.2L4 9", "M4 4.5V9h4.5", "M4 12.5a8 8 0 0 0 14.4 4.3L20 15", "M20 19.5V15h-4.5"],
  setaDiagonal: ["M7 17 17 7", "M8.5 7H17v8.5"],
  setaBaixo: ["M12 5v14", "m6 13 6 6 6-6"],
  setaDireita: ["M5 12h14", "m13 6 6 6-6 6"],
  check: ["m5 12.5 4.5 4.5L19 7.5"],
  raio: ["M13 3 5 14h6l-1 7 8-11h-6l1-7Z"],
  troca: ["M4 8h15", "m15 4 4 4-4 4", "M20 16H5", "m9 12-4 4 4 4"],
  reiniciar: ["M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9", "M4.5 4.5V9H9"],
  sacola: ["M5.5 8h13l-1 12h-11l-1-12Z", "M9 8a3 3 0 0 1 6 0"],
  pessoa: ["M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z", "M4.5 20c1.4-3.3 4.3-5 7.5-5s6.1 1.7 7.5 5"],
  cartao: ["M5 6h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z", "M3 10.5h18", "M7 15h4"],
  cadeado: ["M7 11h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2Z", "M8.5 11V8a3.5 3.5 0 0 1 7 0v3"],
  mais: ["M12 5v14", "M5 12h14"],
  painel: ["M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z", "M3 9h18", "M9 9v11"],
  relogio: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z", "M12 7.5V12l3 2"],
} as const;

export type NomeIcone = keyof typeof DESENHOS;

export default function Icone({ nome, tamanho = 18, traco = 1.8 }: { nome: NomeIcone; tamanho?: number; traco?: number }) {
  return (
    <svg
      width={tamanho}
      height={tamanho}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={traco}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
    >
      {DESENHOS[nome].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
