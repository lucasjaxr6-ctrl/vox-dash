"use client";

import React, { useState } from "react";
import type { GatewayMeta } from "@/lib/gateways";

// Logo do gateway.
//
// Ladrilho BRANCO de propósito: as logos vêm em formatos mistos e várias são
// JPG, que não tem transparência — o fundo branco já está gravado na imagem.
// Tentar um fundo que acompanha o tema deixaria essas com um retângulo branco
// solto dentro de um ladrilho escuro. Um ladrilho branco uniforme, pequeno e
// com anel sutil, lê como marca nos dois temas.
//
// Se a imagem não carregar, cai na inicial colorida que existia antes: melhor
// um "A" num círculo do que um quadrado vazio.
export default function GatewayLogo({
  gateway,
  size = 44,
}: {
  gateway: Pick<GatewayMeta, "name" | "logo" | "letter" | "bg">;
  size?: number;
}) {
  const [falhou, setFalhou] = useState(false);

  if (falhou || !gateway.logo) {
    return (
      <span
        className={`flex flex-shrink-0 items-center justify-center rounded-full text-sm font-black text-white ${gateway.bg}`}
        style={{ width: size, height: size }}
        aria-hidden
      >
        {gateway.letter}
      </span>
    );
  }

  return (
    // SEM recuo e `object-contain`: a imagem vai de borda a borda pelo lado
    // maior, mantendo a proporção — nunca estica nem vaza. Os arquivos são os
    // ORIGINAIS, só reduzidos de peso; recortar a moldura deles quebrava a
    // composição da marca.
    //
    // `rounded-full` corta os cantos: nas logos de fundo colorido isso vira um
    // ícone de app; nas de fundo branco os cantos são vazios mesmo.
    <span
      className="flex flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-white ring-1 ring-inset ring-black/10"
      style={{ width: size, height: size }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={gateway.logo}
        alt={gateway.name}
        loading="lazy"
        decoding="async"
        onError={() => setFalhou(true)}
        className="h-full w-full object-contain"
      />
    </span>
  );
}
