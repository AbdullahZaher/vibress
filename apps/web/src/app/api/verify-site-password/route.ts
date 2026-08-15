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

    const res = await fetch(`${API_BASE}/api/content/v1/verify-site-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
    if (setCookie) {
      response.headers.set("set-cookie", setCookie);
    } else {
      const secret =
        process.env.VIBRESS_ENCRYPTION_KEY || "vibress-site-privacy-secret";
      const timestamp = Date.now().toString();
      const enc = new TextEncoder();
      const key = await crypto.subtle.importKey(
        "raw",
        enc.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      const sigBuffer = await crypto.subtle.sign(
        "HMAC",
        key,
        enc.encode(`v1:${timestamp}`),
      );
      const hex = Array.from(new Uint8Array(sigBuffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      const token = `v1.${timestamp}.${hex}`;

      response.cookies.set("vb_site_auth", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 30 * 24 * 60 * 60,
      });
    }

    return response;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Verification failed";
    return NextResponse.json({ errors: [{ message: msg }] }, { status: 500 });
  }
}
