import { localOnly } from "@/lib/server/local-only";
import { getDiagnostics } from "@/lib/server/diagnostics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const blocked = localOnly(request);
  if (blocked) return blocked;

  const data = getDiagnostics();
  const date = new Date().toISOString().slice(0, 10);

  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition":
        'attachment; filename="financeos-diagnostics-' + date + '.json"',
      "Cache-Control": "no-store",
    },
  });
}
