import { destroyCurrentSession } from "@/lib/session";
import { json, handleError } from "@/lib/http";

export async function POST() {
  try {
    await destroyCurrentSession();
    return json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
