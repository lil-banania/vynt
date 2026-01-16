import { NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

import { createClient as createServerClient } from "@/lib/supabase/server";

const FILE_TYPES = new Set(["usage_logs", "stripe_export"]);

export async function POST(request: Request) {
  const serverSupabase = await createServerClient();
  const {
    data: { user },
    error: userError,
  } = await serverSupabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json(
      { error: "Unable to retrieve the user." },
      { status: 401 }
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Missing server configuration." },
      { status: 500 }
    );
  }

  const formData = await request.formData();
  const file = formData.get("file");
  const auditId = formData.get("auditId");
  const fileType = formData.get("fileType");
  const rowCountValue = formData.get("rowCount");

  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "CSV file is missing." },
      { status: 400 }
    );
  }

  if (typeof auditId !== "string" || !auditId) {
    return NextResponse.json(
      { error: "Audit is missing." },
      { status: 400 }
    );
  }

  if (typeof fileType !== "string" || !FILE_TYPES.has(fileType)) {
    return NextResponse.json(
      { error: "Invalid file type." },
      { status: 400 }
    );
  }

  const adminSupabase = createAdminClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const filePath = `${auditId}/${fileType}/${Date.now()}-${file.name}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await adminSupabase.storage
    .from("audit-files")
    .upload(filePath, buffer, {
      contentType: file.type || "text/csv",
      upsert: false,
    });

  if (uploadError) {
    return NextResponse.json(
      { error: "Upload to storage failed." },
      { status: 500 }
    );
  }

  const rowCount =
    typeof rowCountValue === "string" ? Number(rowCountValue) : null;

  const { data: uploadedRecord, error: dbError } = await adminSupabase
    .from("uploaded_files")
    .insert({
      audit_id: auditId,
      file_type: fileType,
      file_name: file.name,
      file_path: filePath,
      row_count: Number.isFinite(rowCount) ? rowCount : null,
      uploaded_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (dbError || !uploadedRecord) {
    return NextResponse.json(
      { error: "Failed to save file record." },
      { status: 500 }
    );
  }

  return NextResponse.json({ fileId: uploadedRecord.id });
}
