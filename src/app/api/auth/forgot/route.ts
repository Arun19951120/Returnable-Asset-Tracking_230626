import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

// Normalize a phone number for comparison: keep digits only (ignore spaces,
// dashes, "+", country-code punctuation differences).
function normalizePhone(v: string): string {
  return (v || "").replace(/\D/g, "");
}

// Self-service password reset: verify the email + mobile number match a user,
// then set a new password. No admin step required.
export async function POST(req: NextRequest) {
  const { email, phone, newPassword } = await req.json();

  if (!email || typeof email !== "string") {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }
  if (!phone || typeof phone !== "string") {
    return NextResponse.json({ error: "Mobile number is required" }, { status: 400 });
  }
  if (!newPassword || typeof newPassword !== "string" || newPassword.length < 6) {
    return NextResponse.json({ error: "New password must be at least 6 characters" }, { status: 400 });
  }

  const usersPath = path.join(process.cwd(), "data", "users.json");
  const users = JSON.parse(fs.readFileSync(usersPath, "utf-8")) as Record<string, unknown>[];

  const inputPhone = normalizePhone(phone);
  const idx = users.findIndex(
    (u) =>
      String(u.email).toLowerCase() === email.trim().toLowerCase() &&
      normalizePhone(String(u.phone ?? "")) !== "" &&
      normalizePhone(String(u.phone ?? "")) === inputPhone
  );

  if (idx === -1) {
    return NextResponse.json(
      { error: "No account matches that email and mobile number." },
      { status: 404 }
    );
  }

  // Store as base64 passwordHash (same scheme the login route already accepts),
  // and clear any legacy plaintext password field.
  users[idx].passwordHash = Buffer.from(newPassword).toString("base64");
  delete users[idx].password;
  fs.writeFileSync(usersPath, JSON.stringify(users, null, 2) + "\n");

  return NextResponse.json({
    ok: true,
    message: "Password reset successfully. You can now sign in with your new password.",
  });
}
