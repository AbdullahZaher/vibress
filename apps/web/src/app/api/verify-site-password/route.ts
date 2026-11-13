import { NextRequest, NextResponse } from "next/server";

const API_BASE = process.env.API_URL || "http://127.0.0.1:7780";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { password } = body || {};

    if (!password || typeof password !== "string") {
      return NextResponse.json(
        { errors: [{ message: "Password is required" }] },
        { status: 400 },
      );
    }

    const hostHeader = request.headers.get("x-forwarded-host") || request.headers.get("host") || undefined;
    const res = await fetch(`${API_BASE}/api/content/v1/verify-site-password`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(hostHeader ? { "x-forwarded-host": hostHeader } : {}),
      },
      body: JSON.stringify({ password }),
    });

    const data = await res.json();

    if (!res.ok || !data.valid) {
      return NextResponse.json(
        { valid: false, message: "Invalid password" },
        { status: 401 },
      );
    }

    const response = NextResponse.json({ valid: true });
    const setCookie = res.headers.get("set-cookie");
    if (!setCookie) {
      // The API owns cookie signing; without its Set-Cookie this client cannot
      // mint a token and must not fall back to a shared secret.
      return NextResponse.json(
        { valid: false, message: "Site access could not be established" },
        { status: 502 },
      );
    }
    response.headers.set("set-cookie", setCookie);

    return response;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Verification failed";
    return NextResponse.json({ errors: [{ message: msg }] }, { status: 500 });
  }
}
