import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

// Forgot-password: if the email belongs to a user, notify administrators
// so they can reset it from Administration → Password Reset.
export async function POST(req: NextRequest) {
  const { email } = await req.json();
  if (!email || typeof email !== "string") {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }

  const usersPath = path.join(process.cwd(), "data", "users.json");
  const users = JSON.parse(fs.readFileSync(usersPath, "utf-8")) as { email: string; displayName?: string }[];
  const user = users.find((u) => u.email.toLowerCase() === email.toLowerCase());

  if (user) {
    const notifPath = path.join(process.cwd(), "data", "notifications.json");
    const notifications = JSON.parse(fs.readFileSync(notifPath, "utf-8")) as Record<string, unknown>[];
    notifications.unshift({
      id: `notif-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
      title: "🔑 Password Reset Request",
      message: `${user.displayName ?? user.email} (${user.email}) requested a password reset. Go to Administration → Password Reset to set a new password.`,
      type: "warning",
      read: false,
      createdAt: new Date().toISOString(),
    });
    fs.writeFileSync(notifPath, JSON.stringify(notifications, null, 2) + "\n");
  }

  // Same response whether or not the account exists (no email enumeration)
  return NextResponse.json({
    ok: true,
    message: "If that account exists, the administrator has been notified and will reset your password.",
  });
}
