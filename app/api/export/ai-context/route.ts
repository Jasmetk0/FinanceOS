import { buildAiContext } from "@/lib/server/ai-context";
import { localOnly } from "@/lib/server/local-only";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const blocked = localOnly(request);
  if (blocked) return blocked;

  const context = buildAiContext();
  const date = new Date().toISOString().slice(0, 10);

  return new Response(JSON.stringify(context, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition":
        'attachment; filename="financeos-ai-context-' + date + '.json"',
      "Cache-Control": "no-store",
    },
  });
}
