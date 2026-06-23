import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export async function POST(req: NextRequest) {
  const { email, password } = await req.json();
  const filePath = path.join(process.cwd(), "data", "users.json");
  const users = JSON.parse(fs.readFileSync(filePath, "utf-8"));

  const user = users.find((u: { email: string; password?: string; passwordHash?: string }) => {
    if (u.email !== email) return false;
    // Check plain password field
    if (u.password && u.password === password) return true;
    // Check base64-encoded passwordHash (set by admin password reset)
    if (u.passwordHash && u.passwordHash === btoa(password)) return true;
    return false;
  });

  if (!user) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  // Never send password fields to client
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { password: _p, passwordHash: _h, ...safeUser } = user;
  return NextResponse.json(safeUser);
}
