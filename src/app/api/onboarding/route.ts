import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { verifySession, SESSION_COOKIE_NAME } from "@/lib/auth";

const EMPLOYMENT_STATUSES = [
  "Employed",
  "Self-employed",
  "Student",
  "Unemployed",
  "Retired",
  "Other",
];

const INCOME_RANGES = [
  "Under $25,000",
  "$25,000–$50,000",
  "$50,000–$100,000",
  "$100,000–$200,000",
  "$200,000+",
  "Prefer not to say",
];

const FINANCIAL_GOALS = [
  "Building credit",
  "Saving money",
  "Investing",
  "Budgeting / tracking spending",
  "Paying off debt",
  "Other",
];

export async function POST(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? verifySession(token) : null;

  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const {
    age,
    phoneNumber,
    addressStreet,
    addressCity,
    addressState,
    addressZip,
    employmentStatus,
    incomeRange,
    financialGoal,
  } = body as Record<string, unknown>;

  const ageNum = Number(age);
  if (!Number.isInteger(ageNum) || ageNum < 18 || ageNum > 120) {
    return NextResponse.json(
      { error: "Age must be a number between 18 and 120" },
      { status: 400 },
    );
  }

  const requiredStrings: Record<string, unknown> = {
    phoneNumber,
    addressStreet,
    addressCity,
    addressState,
    addressZip,
  };
  for (const [field, value] of Object.entries(requiredStrings)) {
    if (typeof value !== "string" || value.trim().length === 0) {
      return NextResponse.json(
        { error: `${field} is required` },
        { status: 400 },
      );
    }
  }

  if (
    typeof employmentStatus !== "string" ||
    !EMPLOYMENT_STATUSES.includes(employmentStatus)
  ) {
    return NextResponse.json(
      { error: "A valid employment status is required" },
      { status: 400 },
    );
  }
  if (typeof incomeRange !== "string" || !INCOME_RANGES.includes(incomeRange)) {
    return NextResponse.json(
      { error: "A valid income range is required" },
      { status: 400 },
    );
  }
  if (
    typeof financialGoal !== "string" ||
    !FINANCIAL_GOALS.includes(financialGoal)
  ) {
    return NextResponse.json(
      { error: "A valid financial goal is required" },
      { status: 400 },
    );
  }

  await pool.query(
    `INSERT INTO user_profiles
       (user_id, age, phone_number, address_street, address_city, address_state,
        address_zip, employment_status, income_range, financial_goal)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (user_id) DO UPDATE SET
       age = EXCLUDED.age,
       phone_number = EXCLUDED.phone_number,
       address_street = EXCLUDED.address_street,
       address_city = EXCLUDED.address_city,
       address_state = EXCLUDED.address_state,
       address_zip = EXCLUDED.address_zip,
       employment_status = EXCLUDED.employment_status,
       income_range = EXCLUDED.income_range,
       financial_goal = EXCLUDED.financial_goal`,
    [
      session.userId,
      ageNum,
      (phoneNumber as string).trim(),
      (addressStreet as string).trim(),
      (addressCity as string).trim(),
      (addressState as string).trim(),
      (addressZip as string).trim(),
      employmentStatus,
      incomeRange,
      financialGoal,
    ],
  );

  return NextResponse.json({ ok: true });
}
