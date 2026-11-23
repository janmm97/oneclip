import { NextResponse, type NextRequest } from "next/server";

const LOCAL_HOSTS = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/;

/**
 * The API routes check Host/Origin themselves (lib/server.ts guard). This covers
 * everything else, including server-rendered pages that read the database, so a
 * DNS-rebinding page can't read the project list either.
 */
export function proxy(req: NextRequest) {
  if (!LOCAL_HOSTS.test(req.headers.get("host") ?? "")) {
    return new NextResponse("OneClip only answers on 127.0.0.1.", { status: 403 });
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
