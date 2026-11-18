"use client";

import { useRouter } from "next/navigation";

/** Volta para o checkout para o cliente revisar os dados e tentar de novo. */
export default function ReviewDataButton({ primary }: { primary: string }) {
  const router = useRouter();
  return (
    <button
      onClick={() => router.back()}
      style={{ background: primary }}
      className="mt-6 rounded-lg px-7 py-3 text-[15px] font-bold text-white transition hover:opacity-90"
    >
      Revisar dados
    </button>
  );
}
