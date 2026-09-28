import { NextResponse } from "next/server";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function localOnly(request: Request): NextResponse | null {
  const hostHeader = request.headers.get("host") || "";
  const hostname = hostHeader.replace(/^\[/, "").replace(/\].*$/, "").split(":")[0];

  if (!LOCAL_HOSTS.has(hostname)) {
    return NextResponse.json(
      { error: "FinanceOS private endpoints are available only from localhost." },
      { status: 403 },
    );
  }

  const origin = request.headers.get("origin");
  if (origin) {
    try {
      const originHost = new URL(origin).hostname;
      if (!LOCAL_HOSTS.has(originHost)) {
        return NextResponse.json(
          { error: "Cross-origin requests are not allowed." },
          { status: 403 },
        );
      }
    } catch {
      return NextResponse.json({ error: "Invalid request origin." }, { status: 400 });
    }
  }

  return null;
}
