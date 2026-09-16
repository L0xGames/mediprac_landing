import { type NextRequest, NextResponse } from "next/server";
import { parseQuizVisitUpdate, recordQuizVisit } from "@/lib/quiz-visits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const update = parseQuizVisitUpdate(body);
  if (!update) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  try {
    await recordQuizVisit(update);
    return NextResponse.json({ ok: true }, { status: 202 });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
