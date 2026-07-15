import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";

export async function POST(req: NextRequest) {
  const { email, password, displayName, role, organization, phone } = await req.json();
  const filePath = path.join(process.cwd(), "data", "users.json");
  const users = JSON.parse(fs.readFileSync(filePath, "utf-8"));

  if (users.find((u: { email: string }) => u.email === email)) {
    return NextResponse.json({ error: "Email already registered" }, { status: 409 });
  }

  const newUser = {
    uid: `user-${uuid().slice(0, 8)}`,
    email,
    password,
    displayName,
    role: role ?? "Employee",
    organization: organization ?? "",
    phone: phone ?? "",
    projects: [],
    allowedLocations: [],
  };

  users.push(newUser);
  fs.writeFileSync(filePath, JSON.stringify(users, null, 2));

  const { password: _, ...safeUser } = newUser;
  return NextResponse.json(safeUser);
}
