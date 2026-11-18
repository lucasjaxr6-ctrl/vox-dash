"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminClient() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function createProduct() {
    setMsg(null);
    const reais = parseFloat(price.replace(",", "."));
    if (!name.trim() || Number.isNaN(reais) || reais <= 0) {
      setMsg("Informe nome e preço válidos.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          priceCents: Math.round(reais * 100), // converte p/ centavos
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg(data?.error ?? "Erro ao criar produto.");
        return;
      }
      setName("");
      setPrice("");
      setMsg("Produto criado!");
      router.refresh(); // recarrega os dados do server component
    } catch {
      setMsg("Erro de rede.");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <label className="mb-1 block text-xs font-semibold text-mid">
            Nome do produto
          </label>
          <input
            className={input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: Camiseta Azul"
          />
        </div>
        <div className="w-32">
          <label className="mb-1 block text-xs font-semibold text-mid">
            Preço (R$)
          </label>
          <input
            className={input}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="10,00"
            inputMode="decimal"
          />
        </div>
        <button
          onClick={createProduct}
          disabled={busy}
          className="rounded-lg bg-brand px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-hover disabled:opacity-60"
        >
          {busy ? "..." : "Adicionar"}
        </button>
      </div>
      {msg && <p className="text-sm text-mid">{msg}</p>}

      <button onClick={logout} className="text-sm text-low underline">
        Sair
      </button>
    </div>
  );
}

const input =
  "w-full rounded-lg border border-line-strong px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20";
