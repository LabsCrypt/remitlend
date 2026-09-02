import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

interface RevealRequestBody {
  field: "email" | "phone" | "name";
  reason: string;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get("session")?.value;

  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let role: string | null = null;
  try {
    const sessionRes = await fetch(
      `${process.env.API_URL ?? "http://localhost:3001"}/auth/session`,
      {
        headers: { Authorization: `Bearer ${sessionToken}` },
      },
    );
    if (!sessionRes.ok) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const session = (await sessionRes.json()) as { role?: string };
    role = session.role ?? null;
  } catch {
    return NextResponse.json({ error: "Session validation failed" }, { status: 500 });
  }

  if (!role || !["admin", "operator"].includes(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = (await request.json()) as RevealRequestBody;

  if (!body.field || !body.reason) {
    return NextResponse.json({ error: "field and reason are required" }, { status: 400 });
  }

  const requestId = crypto.randomUUID();

  try {
    const backendRes = await fetch(
      `${process.env.API_URL ?? "http://localhost:3001"}/recipients/${id}/decrypt`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionToken}`,
          "X-Request-Id": requestId,
        },
        body: JSON.stringify({
          field: body.field,
          actor: role,
          reason: body.reason,
          request_id: requestId,
        }),
      },
    );

    if (!backendRes.ok) {
      const error = await backendRes.text();
      return NextResponse.json({ error }, { status: backendRes.status });
    }

    const data = (await backendRes.json()) as { plaintext: string };
    return NextResponse.json({ value: data.plaintext });
  } catch {
    return NextResponse.json({ error: "Decryption failed" }, { status: 500 });
  }
}
