import { NextResponse } from "next/server";
import { localOnly } from "@/lib/server/local-only";
import {
  listConnections,
  removeConnection,
  saveConnection,
} from "@/lib/server/repository";
import {
  validateTrading212,
  type Trading212Credentials,
} from "@/lib/server/integrations/trading212";
import {
  validateKraken,
  type KrakenCredentials,
} from "@/lib/server/integrations/kraken";
import {
  validatePhantom,
  type PhantomCredentials,
} from "@/lib/server/integrations/phantom";
import type { ProviderId } from "@/lib/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const blocked = localOnly(request);
  if (blocked) return blocked;
  return NextResponse.json({ connections: listConnections() });
}

export async function POST(request: Request) {
  const blocked = localOnly(request);
  if (blocked) return blocked;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const provider = String(body.provider || "") as ProviderId;
    const environment = String(body.environment || "live");
    const apiKey = String(body.apiKey || "").trim();
    const apiSecret = String(body.apiSecret || "").trim();
    const address = String(body.address || "").trim();

    if (provider === "trading212") {
      if (!["live", "demo"].includes(environment)) {
        return NextResponse.json({ error: "Invalid Trading 212 environment." }, { status: 400 });
      }
      const credentials: Trading212Credentials = { apiKey, apiSecret };
      await validateTrading212(environment, credentials);
      saveConnection("trading212", "Trading 212", environment, credentials);
    } else if (provider === "kraken") {
      const credentials: KrakenCredentials = { apiKey, apiSecret };
      await validateKraken(credentials);
      saveConnection("kraken", "Kraken", "live", credentials);
    } else if (provider === "phantom") {
      const credentials: PhantomCredentials = { address };
      await validatePhantom(credentials);
      saveConnection(
        "phantom",
        "Phantom",
        "solana-mainnet",
        credentials,
      );
    } else {
      return NextResponse.json({ error: "Unsupported provider." }, { status: 400 });
    }

    return NextResponse.json({ ok: true, connections: listConnections() });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const blocked = localOnly(request);
  if (blocked) return blocked;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const provider = String(body.provider || "") as ProviderId;
    if (
      provider !== "trading212" &&
      provider !== "kraken" &&
      provider !== "phantom"
    ) {
      return NextResponse.json({ error: "Unsupported provider." }, { status: 400 });
    }

    removeConnection(provider);
    return NextResponse.json({ ok: true, connections: listConnections() });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
