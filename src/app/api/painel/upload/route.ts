import { requireMerchant } from "@/lib/auth";
import { json, handleError } from "@/lib/http";
import { newId } from "@/lib/db";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

// POST /api/painel/upload (multipart: campo "file")
// Salva a imagem em public/uploads e retorna a URL pública. Apenas MERCHANT.
const MAX_BYTES = 5 * 1024 * 1024; // 5MB
const TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export async function POST(req: Request) {
  try {
    await requireMerchant();

    const formData = await req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) return json({ error: "Nenhum arquivo enviado." }, 400);
    if (file.size > MAX_BYTES) return json({ error: "Arquivo muito grande (máx. 5MB)." }, 400);

    const ext = TYPES[file.type];
    if (!ext) return json({ error: "Formato inválido. Envie PNG, JPG, WEBP ou GIF." }, 400);

    const bytes = Buffer.from(await file.arrayBuffer());
    if (!isValidImage(bytes, file.type)) return json({ error: "Arquivo de imagem inválido." }, 400);

    // Nome próprio (nunca confia no nome do usuário) → evita path traversal.
    const filename = `${newId()}.${ext}`;

    // Produção (Vercel): armazenamento em Vercel Blob (o filesystem é somente
    // leitura/efêmero). Dev/local (sem o token): grava em public/uploads.
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      try {
        const { put } = await import("@vercel/blob");
        const blob = await put(`uploads/${filename}`, bytes, {
          access: "public",
          contentType: file.type,
        });
        return json({ ok: true, url: blob.url });
      } catch (e) {
        const m = e instanceof Error ? e.message : "Falha ao enviar para o Vercel Blob.";
        return json({ error: `Upload (Blob): ${m}` }, 502);
      }
    }

    // Sem Blob configurado: só funciona em disco (dev). Na Vercel o FS é
    // somente-leitura, então avisamos em vez de estourar 500.
    if (process.env.VERCEL) {
      return json(
        {
          error:
            "Armazenamento de imagens não configurado. Na Vercel, crie um Blob Store (Storage → Blob), conecte ao projeto e faça deploy (variável BLOB_READ_WRITE_TOKEN).",
        },
        503,
      );
    }

    try {
      const dir = path.join(process.cwd(), "public", "uploads");
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, filename), bytes);
      return json({ ok: true, url: `/uploads/${filename}` });
    } catch (e) {
      const m = e instanceof Error ? e.message : "Falha ao salvar o arquivo.";
      return json({ error: `Upload (disco): ${m}` }, 500);
    }
  } catch (err) {
    return handleError(err);
  }
}

// Valida a assinatura (magic bytes) para impedir upload de não-imagem renomeada.
function isValidImage(buf: Buffer, type: string): boolean {
  if (buf.length < 12) return false;
  if (type === "image/png") return buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  if (type === "image/jpeg") return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (type === "image/gif") return buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46;
  if (type === "image/webp") return buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP";
  return false;
}
